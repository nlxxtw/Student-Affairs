"use strict";

const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeCode(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function hashCode(code, pepper) { return crypto.createHmac("sha256", pepper).update(normalizeCode(code), "utf8").digest("hex"); }
function randomCode() {
  const bytes = crypto.randomBytes(20);
  const raw = Array.from(bytes, (value) => ALPHABET[value % ALPHABET.length]).join("");
  return raw.match(/.{1,5}/g).join("-");
}
function encryptionKey(value) {
  let key;
  try { key = Buffer.from(String(value || ""), "base64url"); }
  catch (_error) { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new Error("授权码加密密钥必须是32字节的Base64URL值。");
  return key;
}
function encryptCode(code, keyValue, licenseId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  cipher.setAAD(Buffer.from(`shuzhi-license-code:${licenseId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(String(code || "").toUpperCase(), "utf8"), cipher.final()]);
  return { version: 1, algorithm: "A256GCM", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
}
function decryptCode(payload, keyValue, licenseId) {
  if (!payload || Number(payload.version) !== 1 || payload.algorithm !== "A256GCM") throw apiError(409, "LICENSE_CODE_UNAVAILABLE", "该授权码属于历史记录，无法恢复明文。");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(keyValue), Buffer.from(String(payload.iv || ""), "base64url"));
    decipher.setAAD(Buffer.from(`shuzhi-license-code:${licenseId}`, "utf8"));
    decipher.setAuthTag(Buffer.from(String(payload.tag || ""), "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(String(payload.ciphertext || ""), "base64url")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error && error.code === "LICENSE_CODE_UNAVAILABLE") throw error;
    throw apiError(409, "LICENSE_CODE_DECRYPT_FAILED", "授权码加密数据无法解密，请检查后台加密密钥。");
  }
}
function activeDevices(record) {
  return (Array.isArray(record.devices) ? record.devices : []).map((item, index) => item ? Object.assign({ slot: index + 1 }, item) : null).filter(Boolean);
}
function publicLicense(record) {
  const devices = activeDevices(record);
  return {
    id: record.id,
    product: record.product,
    status: record.status,
    customer: record.customer || "",
    customerName: record.customerName || record.customer || "",
    customerXhsId: record.customerXhsId || "",
    customerWechat: record.customerWechat || "",
    note: record.note || "",
    maxDevices: Number(record.maxDevices || 5),
    activeDevices: devices.length,
    devices: devices.map((item) => ({ slot: item.slot, name: item.name || "未命名设备", activatedAt: item.activatedAt || null, lastSeenAt: item.lastSeenAt || null })),
    expiresAt: record.expiresAt || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    revision: Number(record.revision || 1),
    codeAvailable: !!record.encryptedCode,
    issuanceChannel: record.issuanceChannel || (record.encryptedCode ? "license-admin-v1" : "legacy-hash-only"),
    forcedRevokedAt: record.forcedRevokedAt || null
  };
}

function cleanText(value, max) { return String(value || "").trim().slice(0, max); }
function cleanStatus(value) { return value === "revoked" ? "revoked" : "active"; }

class LicenseAdminService {
  constructor(options) {
    this.repository = options.repository;
    this.auditRepository = options.auditRepository;
    this.pepper = options.pepper;
    this.codeEncryptionKey = options.codeEncryptionKey;
    this.product = options.product || "shuzhi-xuegong";
    this.now = options.now || (() => Date.now());
    if (!this.repository || !this.auditRepository || !this.pepper || !this.codeEncryptionKey) throw new Error("授权管理服务配置不完整。");
    encryptionKey(this.codeEncryptionKey);
  }

  async audit(action, actor, sourceIp, licenseId, detail = {}) {
    await this.auditRepository.append({ action, actor, sourceIp, licenseId: licenseId || "", detail, createdAt: this.now() });
  }

  async list(input = {}) {
    const query = cleanText(input.query, 120).toLowerCase();
    const status = input.status === "active" || input.status === "revoked" ? input.status : "";
    let records = await this.repository.list();
    if (status) records = records.filter((item) => item.status === status);
    if (query) {
      const normalizedQuery = normalizeCode(query);
      const queryHash = normalizedQuery.length >= 16 && normalizedQuery.length <= 64 ? hashCode(normalizedQuery, this.pepper) : "";
      records = records.filter((item) => (queryHash && item.licenseHash === queryHash) || [item.id, item.customerName, item.customer, item.customerXhsId, item.customerWechat, item.note].some((value) => String(value || "").toLowerCase().includes(query)));
    }
    records.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
    const licenses = records.map(publicLicense);
    return {
      licenses,
      stats: {
        total: licenses.length,
        active: licenses.filter((item) => item.status === "active").length,
        revoked: licenses.filter((item) => item.status === "revoked").length,
        boundDevices: licenses.reduce((sum, item) => sum + item.activeDevices, 0)
      }
    };
  }

  async get(id) {
    const record = await this.repository.getById(cleanText(id, 80));
    if (!record) throw apiError(404, "LICENSE_NOT_FOUND", "授权记录不存在。");
    return publicLicense(record);
  }

  async createBatch(input, actor, sourceIp, requestId = "") {
    const count = Number(input.count || 1);
    if (!Number.isInteger(count) || count < 1 || count > 200) throw apiError(400, "INVALID_COUNT", "单次生成数量必须为1至200。");
    const maxDevices = Number(input.maxDevices || 5);
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 50) throw apiError(400, "INVALID_DEVICE_LIMIT", "设备上限必须为1至50。");
    const hasCustomerName = Object.prototype.hasOwnProperty.call(input, "customerName");
    const customerName = cleanText(input.customerName || input.customerPrefix || input.customer, 120) || "未填写";
    const customerXhsId = cleanText(input.customerXhsId, 120);
    const customerWechat = cleanText(input.customerWechat, 120);
    const note = cleanText(input.note, 500);
    const expiresAt = input.expiresAt ? Number(input.expiresAt) : null;
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= this.now())) throw apiError(400, "INVALID_EXPIRY", "授权到期时间必须晚于当前时间。");
    const output = [];
    for (let index = 0; index < count; index++) {
      let created = null;
      for (let attempt = 0; attempt < 8 && !created; attempt++) {
        const code = randomCode();
        const licenseHash = hashCode(code, this.pepper);
        const now = this.now();
        const customer = hasCustomerName || count === 1 ? customerName : `${customerName}-${String(index + 1).padStart(String(count).length, "0")}`;
        const id = `lic_${licenseHash.slice(0, 16)}`;
        const record = {
          id,
          licenseHash,
          encryptedCode: encryptCode(code, this.codeEncryptionKey, id),
          issuanceChannel: "license-admin-v1",
          createdBy: cleanText(actor, 80),
          createdFromIp: cleanText(sourceIp, 80),
          creationRequestId: cleanText(requestId, 120),
          product: this.product,
          status: "active",
          maxDevices,
          customer,
          customerName: customer,
          customerXhsId,
          customerWechat,
          note,
          expiresAt,
          devices: [],
          revision: 1,
          createdAt: now,
          updatedAt: now
        };
        if (await this.repository.create(record)) created = { code, license: publicLicense(record) };
      }
      if (!created) throw apiError(503, "CODE_GENERATION_FAILED", "激活码生成失败，请重试。");
      output.push(created);
    }
    await this.audit("LICENSE_BATCH_CREATED", actor, sourceIp, "", { count, maxDevices, customerName, expiresAt, requestId: cleanText(requestId, 120), issuanceChannel: "license-admin-v1" });
    return { items: output, count: output.length };
  }

  async mutate(id, actor, sourceIp, action, detail, updater) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.repository.getById(cleanText(id, 80));
      if (!current) throw apiError(404, "LICENSE_NOT_FOUND", "授权记录不存在。");
      const updated = updater(JSON.parse(JSON.stringify(current)));
      updated.revision = Number(current.revision || 1) + 1;
      updated.updatedAt = this.now();
      if (await this.repository.compareAndSwap(current, updated)) {
        await this.audit(action, actor, sourceIp, current.id, detail);
        return publicLicense(updated);
      }
    }
    throw apiError(409, "CONCURRENT_UPDATE", "授权记录正在被其他请求修改，请重试。");
  }

  async update(id, input, actor, sourceIp) {
    return this.mutate(id, actor, sourceIp, "LICENSE_UPDATED", {}, (record) => {
      if (Object.prototype.hasOwnProperty.call(input, "customerName") || Object.prototype.hasOwnProperty.call(input, "customer")) {
        record.customerName = cleanText(Object.prototype.hasOwnProperty.call(input, "customerName") ? input.customerName : input.customer, 120);
        record.customer = record.customerName;
      }
      if (Object.prototype.hasOwnProperty.call(input, "customerXhsId")) record.customerXhsId = cleanText(input.customerXhsId, 120);
      if (Object.prototype.hasOwnProperty.call(input, "customerWechat")) record.customerWechat = cleanText(input.customerWechat, 120);
      if (Object.prototype.hasOwnProperty.call(input, "note")) record.note = cleanText(input.note, 500);
      if (Object.prototype.hasOwnProperty.call(input, "expiresAt")) {
        const expiresAt = input.expiresAt ? Number(input.expiresAt) : null;
        if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= this.now())) throw apiError(400, "INVALID_EXPIRY", "授权到期时间必须晚于当前时间。");
        record.expiresAt = expiresAt;
      }
      if (Object.prototype.hasOwnProperty.call(input, "maxDevices")) {
        const maxDevices = Number(input.maxDevices);
        const devices = activeDevices(record);
        if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 50) throw apiError(400, "INVALID_DEVICE_LIMIT", "设备上限必须为1至50。");
        if (maxDevices < devices.length) throw apiError(409, "DEVICE_LIMIT_TOO_SMALL", `当前已有${devices.length}台设备，不能将上限降至${maxDevices}。`);
        record.maxDevices = maxDevices;
        record.devices = devices.map((item) => ({ hash: item.hash, name: item.name, activatedAt: item.activatedAt, lastSeenAt: item.lastSeenAt }));
      }
      return record;
    });
  }

  async setStatus(id, status, actor, sourceIp) {
    const next = cleanStatus(status);
    return this.mutate(id, actor, sourceIp, next === "revoked" ? "LICENSE_REVOKED" : "LICENSE_RESTORED", { status: next }, (record) => {
      if (next === "active" && !record.encryptedCode) throw apiError(409, "UNRECOVERABLE_LICENSE_CANNOT_RESTORE", "历史授权码明文不可恢复，已强制停用，不能恢复启用。");
      record.status = next;
      return record;
    });
  }

  async unrecoverableSummary() {
    const records = (await this.repository.list()).filter((record) => !record.encryptedCode);
    return {
      matched: records.length,
      active: records.filter((record) => record.status === "active").length,
      revoked: records.filter((record) => record.status === "revoked").length,
      items: records.map((record) => ({
        id: record.id,
        status: record.status,
        customer: record.customerName || record.customer || "",
        forcedRevokedAt: record.forcedRevokedAt || null
      }))
    };
  }

  async forceRevokeUnrecoverable(actor, sourceIp, requestId = "") {
    const candidates = (await this.repository.list()).filter((record) => !record.encryptedCode);
    let updated = 0;
    let alreadyEnforced = 0;
    for (const candidate of candidates) {
      let completed = false;
      for (let attempt = 0; attempt < 8 && !completed; attempt++) {
        const current = await this.repository.getById(candidate.id);
        if (!current || current.encryptedCode) { completed = true; continue; }
        if (current.status === "revoked" && current.forcedRevokedAt && current.issuanceChannel === "legacy-hash-only") {
          alreadyEnforced++;
          completed = true;
          continue;
        }
        const now = this.now();
        const next = JSON.parse(JSON.stringify(current));
        next.status = "revoked";
        next.issuanceChannel = "legacy-hash-only";
        next.forcedRevokedAt = now;
        next.forcedRevokedBy = cleanText(actor, 80);
        next.forcedRevocationReason = "activation-code-plaintext-unrecoverable";
        next.forcedRevocationRequestId = cleanText(requestId, 120);
        next.revision = Number(current.revision || 1) + 1;
        next.updatedAt = now;
        if (await this.repository.compareAndSwap(current, next)) {
          updated++;
          completed = true;
          await this.audit("LICENSE_LEGACY_FORCED_REVOKED", actor, sourceIp, current.id, {
            previousStatus: current.status,
            activeDevices: activeDevices(current).length,
            requestId: cleanText(requestId, 120),
            reason: next.forcedRevocationReason
          });
        }
      }
      if (!completed) throw apiError(409, "CONCURRENT_UPDATE", `授权记录 ${candidate.id} 正在被其他请求修改，请重试。`);
    }
    const summary = await this.unrecoverableSummary();
    if (summary.active > 0) throw apiError(409, "LEGACY_REVOCATION_INCOMPLETE", `仍有 ${summary.active} 条历史授权未停用，请重试。`);
    await this.audit("LICENSE_LEGACY_REVOCATION_COMPLETED", actor, sourceIp, "", {
      matched: summary.matched,
      updated,
      alreadyEnforced,
      activeRemaining: summary.active,
      requestId: cleanText(requestId, 120)
    });
    return { matched: summary.matched, updated, alreadyEnforced, activeRemaining: summary.active, items: summary.items };
  }

  async revealCode(id, actor, sourceIp) {
    const record = await this.repository.getById(cleanText(id, 80));
    if (!record) throw apiError(404, "LICENSE_NOT_FOUND", "授权记录不存在。");
    if (!record.encryptedCode) throw apiError(409, "LICENSE_CODE_UNAVAILABLE", "该授权码是升级前生成的历史记录，原系统未保存明文，无法恢复。");
    const code = decryptCode(record.encryptedCode, this.codeEncryptionKey, record.id);
    if (hashCode(code, this.pepper) !== record.licenseHash) throw apiError(409, "LICENSE_CODE_INTEGRITY_FAILED", "授权码完整性校验失败，已拒绝显示。");
    await this.audit("LICENSE_CODE_VIEWED", actor, sourceIp, record.id, {});
    return { id: record.id, code };
  }

  async deleteLicense(id, actor, sourceIp) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await this.repository.getById(cleanText(id, 80));
      if (!current) throw apiError(404, "LICENSE_NOT_FOUND", "授权记录不存在或已删除。");
      if (await this.repository.delete(current)) {
        await this.audit("LICENSE_DELETED", actor, sourceIp, current.id, {
          customerName: current.customerName || current.customer || "",
          status: current.status,
          activeDevices: activeDevices(current).length,
          codeAvailable: !!current.encryptedCode
        });
        return { ok: true, id: current.id };
      }
    }
    throw apiError(409, "CONCURRENT_UPDATE", "授权记录正在被其他请求修改，请重试。");
  }

  async deactivateDevice(id, slot, actor, sourceIp) {
    const slotNumber = Number(slot);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 50) throw apiError(400, "INVALID_SLOT", "设备槽位无效。");
    return this.mutate(id, actor, sourceIp, "DEVICE_DEACTIVATED", { slot: slotNumber }, (record) => {
      const devices = Array.isArray(record.devices) ? record.devices.slice() : [];
      if (!devices[slotNumber - 1]) throw apiError(404, "DEVICE_NOT_FOUND", "该设备已解除绑定或不存在。");
      devices[slotNumber - 1] = null;
      record.devices = devices;
      return record;
    });
  }

  async auditList(limit = 200) {
    return { events: await this.auditRepository.list(Math.max(1, Math.min(500, Number(limit || 200)))) };
  }
}

module.exports = { LicenseAdminService, apiError, normalizeCode, hashCode, randomCode, activeDevices, publicLicense, encryptCode, decryptCode };
