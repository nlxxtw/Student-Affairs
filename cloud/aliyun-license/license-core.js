"use strict";

const crypto = require("crypto");

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeCode(value) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function hashCode(code, pepper) { return crypto.createHmac("sha256", pepper).update(normalizeCode(code), "utf8").digest("hex"); }
function activeSlots(record) { return (record.devices || []).filter(Boolean); }

class LicenseService {
  constructor(options) {
    this.repository = options.repository;
    this.pepper = options.pepper;
    this.privateKey = options.privateKey;
    this.publicKey = options.publicKey || crypto.createPublicKey(this.privateKey).export({ type: "spki", format: "pem" });
    this.defaultProduct = options.defaultProduct || "shuzhi-xuegong";
    this.verifyIntervalMs = Math.max(1, Number(options.verifyIntervalHours || 72)) * 60 * 60 * 1000;
    this.offlineGraceMs = Math.max(1, Number(options.offlineGraceDays || 180)) * 24 * 60 * 60 * 1000;
    if (!this.pepper || !this.privateKey) throw new Error("LICENSE_CODE_PEPPER 和 LICENSE_PRIVATE_KEY 必须配置。");
  }

  sign(record, deviceHash, now = Date.now()) {
    const payload = {
      version: 1,
      licenseId: record.id,
      licenseHash: record.licenseHash,
      product: record.product,
      deviceHash,
      issuedAt: now,
      verifiedAt: now,
      nextVerifyAt: now + this.verifyIntervalMs,
      offlineUntil: Math.min(now + this.offlineGraceMs, record.expiresAt || Number.MAX_SAFE_INTEGER),
      expiresAt: record.expiresAt || null
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = crypto.sign(null, Buffer.from(encoded, "utf8"), this.privateKey).toString("base64url");
    return `${encoded}.${signature}`;
  }

  verifySignedToken(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 2 || !crypto.verify(null, Buffer.from(parts[0], "utf8"), this.publicKey, Buffer.from(parts[1], "base64url"))) throw apiError(401, "INVALID_TOKEN", "授权凭证无效。");
    let payload;
    try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
    catch (_error) { throw apiError(401, "INVALID_TOKEN", "授权凭证无效。"); }
    return payload;
  }

  validateDeviceInput(input) {
    const deviceHash = String(input.deviceHash || "");
    const product = String(input.product || this.defaultProduct);
    if (!/^[a-f0-9]{64}$/i.test(deviceHash)) throw apiError(400, "INVALID_DEVICE", "设备指纹无效。");
    if (!/^[a-z0-9-]{3,64}$/i.test(product)) throw apiError(400, "INVALID_PRODUCT", "产品标识无效。");
    return { deviceHash: deviceHash.toLowerCase(), product, deviceName: String(input.deviceName || "未命名设备").trim().slice(0, 80) || "未命名设备" };
  }

  assertRecordUsable(record, product, now) {
    if (!record) throw apiError(404, "LICENSE_NOT_FOUND", "激活码不存在或输入错误。");
    if (record.product !== product) throw apiError(403, "PRODUCT_MISMATCH", "激活码不适用于当前产品。");
    if (!record.encryptedCode) throw apiError(403, "LICENSE_REVOKED", "历史授权码已强制停用，请联系管理员重新签发。");
    if (record.status !== "active") throw apiError(403, "LICENSE_REVOKED", "激活码已停用，请联系管理员。");
    if (record.expiresAt && now >= record.expiresAt) throw apiError(403, "LICENSE_EXPIRED", "激活码已到期。");
  }

  async createLicense(input = {}) {
    void input;
    throw apiError(410, "LEGACY_ISSUANCE_RETIRED", "旧版授权生成能力已永久停用，请使用授权管理平台生成激活码。");
  }

  publicLicense(record) {
    return { id: record.id, product: record.product, status: record.status, maxDevices: record.maxDevices, activeDevices: activeSlots(record).length, customer: record.customer, note: record.note, expiresAt: record.expiresAt, createdAt: record.createdAt, updatedAt: record.updatedAt, devices: activeSlots(record).map((item, index) => ({ slot: index + 1, name: item.name, activatedAt: item.activatedAt, lastSeenAt: item.lastSeenAt })) };
  }

  async activate(input) {
    const code = normalizeCode(input.code);
    if (code.length < 16 || code.length > 64) throw apiError(400, "INVALID_CODE", "请输入有效的激活码。");
    const device = this.validateDeviceInput(input);
    const licenseHash = hashCode(code, this.pepper);
    for (let attempt = 0; attempt < 8; attempt++) {
      const record = await this.repository.get(licenseHash);
      const now = Date.now();
      this.assertRecordUsable(record, device.product, now);
      const devices = Array.isArray(record.devices) ? record.devices.slice(0, record.maxDevices) : [];
      let slot = devices.findIndex((item) => item && item.hash === device.deviceHash);
      if (slot < 0) {
        slot = devices.findIndex((item) => !item);
        if (slot < 0 && devices.length < record.maxDevices) slot = devices.length;
        if (slot < 0) throw apiError(409, "DEVICE_LIMIT_REACHED", `此激活码最多绑定 ${record.maxDevices} 台设备，请先在原设备解除激活。`);
        devices[slot] = { hash: device.deviceHash, name: device.deviceName, activatedAt: now, lastSeenAt: now };
      } else {
        devices[slot] = Object.assign({}, devices[slot], { name: device.deviceName, lastSeenAt: now });
      }
      const updated = Object.assign({}, record, { devices, revision: record.revision + 1, updatedAt: now });
      if (await this.repository.compareAndSwap(record, updated)) return { token: this.sign(updated, device.deviceHash, now), slot: slot + 1, activeDevices: activeSlots(updated).length, maxDevices: updated.maxDevices };
    }
    throw apiError(409, "CONCURRENT_UPDATE", "设备绑定发生并发冲突，请重试。");
  }

  async verify(input, token) {
    const signed = this.verifySignedToken(token);
    const device = this.validateDeviceInput(input);
    if (signed.deviceHash !== device.deviceHash || signed.product !== device.product) throw apiError(401, "DEVICE_MISMATCH", "授权凭证与当前设备不匹配。");
    for (let attempt = 0; attempt < 8; attempt++) {
      const record = await this.repository.get(signed.licenseHash);
      const now = Date.now();
      this.assertRecordUsable(record, device.product, now);
      const slot = (record.devices || []).findIndex((item) => item && item.hash === device.deviceHash);
      if (slot < 0) throw apiError(403, "DEVICE_DEACTIVATED", "当前设备已解除激活。");
      const devices = record.devices.slice();
      devices[slot] = Object.assign({}, devices[slot], { lastSeenAt: now });
      const updated = Object.assign({}, record, { devices, revision: record.revision + 1, updatedAt: now });
      if (await this.repository.compareAndSwap(record, updated)) return { token: this.sign(updated, device.deviceHash, now), activeDevices: activeSlots(updated).length, maxDevices: updated.maxDevices };
    }
    throw apiError(409, "CONCURRENT_UPDATE", "授权验证发生并发冲突，请重试。");
  }

  async deactivate(input, token) {
    const signed = this.verifySignedToken(token);
    const device = this.validateDeviceInput(input);
    if (signed.deviceHash !== device.deviceHash || signed.product !== device.product) throw apiError(401, "DEVICE_MISMATCH", "授权凭证与当前设备不匹配。");
    for (let attempt = 0; attempt < 8; attempt++) {
      const record = await this.repository.get(signed.licenseHash);
      if (!record) return { ok: true };
      const slot = (record.devices || []).findIndex((item) => item && item.hash === device.deviceHash);
      if (slot < 0) return { ok: true };
      const devices = record.devices.slice(); devices[slot] = null;
      const updated = Object.assign({}, record, { devices, revision: record.revision + 1, updatedAt: Date.now() });
      if (await this.repository.compareAndSwap(record, updated)) return { ok: true };
    }
    throw apiError(409, "CONCURRENT_UPDATE", "解除激活发生并发冲突，请重试。");
  }
}

module.exports = { LicenseService, apiError, normalizeCode, hashCode };
