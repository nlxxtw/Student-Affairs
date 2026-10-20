"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { LicenseAdminService, hashCode } = require("../admin-core");
const { hashPassword, verifyPassword, signSession, verifySession } = require("../auth");
const { LicenseService } = require("../../aliyun-license/license-core");

class SharedMemoryRepository {
  constructor() { this.records = new Map(); }
  async list() { return Array.from(this.records.values()).map((item) => structuredClone(item)); }
  async get(hash) { return this.records.has(hash) ? structuredClone(this.records.get(hash)) : null; }
  async getById(id) { const item = Array.from(this.records.values()).find((record) => record.id === id); return item ? structuredClone(item) : null; }
  async create(record) { if (this.records.has(record.licenseHash)) return false; this.records.set(record.licenseHash, structuredClone(record)); return true; }
  async compareAndSwap(current, updated) { const stored = this.records.get(current.licenseHash); if (!stored || stored.revision !== current.revision) return false; this.records.set(updated.licenseHash, structuredClone(updated)); return true; }
  async delete(current) { const stored = this.records.get(current.licenseHash); if (!stored || stored.revision !== current.revision) return false; this.records.delete(current.licenseHash); return true; }
}
class MemoryAuditRepository {
  constructor() { this.events = []; }
  async append(event) { this.events.unshift(structuredClone(event)); }
  async list(limit) { return this.events.slice(0, limit).map((item) => structuredClone(item)); }
}

async function coreFlow() {
  const pepper = "test-pepper-value-with-sufficient-entropy";
  const codeEncryptionKey = Buffer.alloc(32, 3).toString("base64url");
  const repository = new SharedMemoryRepository();
  const auditRepository = new MemoryAuditRepository();
  const keyPair = crypto.generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  let now = Date.UTC(2026, 7, 24, 8, 0, 0);
  const admin = new LicenseAdminService({ repository, auditRepository, pepper, codeEncryptionKey, now: () => now });
  const publicService = new LicenseService({ repository, pepper, privateKey: keyPair.privateKey, offlineGraceDays: 180 });

  const batch = await admin.createBatch({ count: 2, customerName: "张老师", customerXhsId: "小红书-张老师", customerWechat: "wx_zhang", maxDevices: 5, note: "自动化" }, "admin", "127.0.0.1", "req-create-1");
  assert.equal(batch.items.length, 2);
  assert.notEqual(batch.items[0].code, batch.items[1].code);
  assert.equal(batch.items[0].license.customerName, "张老师");
  assert.equal(batch.items[0].license.customerXhsId, "小红书-张老师");
  assert.equal(batch.items[0].license.customerWechat, "wx_zhang");
  assert.equal(batch.items[0].license.codeAvailable, true);
  const storedFirst = repository.records.get(Array.from(repository.records.keys())[0]);
  assert.ok(storedFirst.encryptedCode && storedFirst.encryptedCode.ciphertext);
  assert.equal(storedFirst.issuanceChannel, "license-admin-v1");
  assert.equal(storedFirst.createdBy, "admin");
  assert.equal(storedFirst.createdFromIp, "127.0.0.1");
  assert.equal(storedFirst.creationRequestId, "req-create-1");
  assert.equal(JSON.stringify(storedFirst).includes(batch.items[0].code), false, "Tablestore record must not contain plaintext activation codes");
  assert.equal((await admin.revealCode(batch.items[0].license.id, "admin", "127.0.0.1")).code, batch.items[0].code);
  assert.equal((await admin.list({ query: batch.items[0].code })).licenses.length, 1);
  assert.equal((await admin.list()).stats.total, 2);
  assert.equal((await admin.list({ query: "wx_zhang" })).licenses.length, 2);
  const first = batch.items[0];
  const tokens = [];
  for (let index = 0; index < 5; index++) {
    const deviceHash = crypto.createHash("sha256").update(`admin-test-${index}`).digest("hex");
    const result = await publicService.activate({ code: first.code, deviceHash, deviceName: `设备${index + 1}`, product: "shuzhi-xuegong" });
    tokens.push({ token: result.token, deviceHash });
  }
  await assert.rejects(() => publicService.activate({ code: first.code, deviceHash: crypto.createHash("sha256").update("sixth").digest("hex"), product: "shuzhi-xuegong" }), (error) => error.code === "DEVICE_LIMIT_REACHED");
  let item = (await admin.get(first.license.id));
  assert.equal(item.activeDevices, 5);
  assert.deepEqual(item.devices.map((device) => device.slot), [1, 2, 3, 4, 5]);
  await assert.rejects(() => admin.update(first.license.id, { maxDevices: 4 }, "admin", "127.0.0.1"), (error) => error.code === "DEVICE_LIMIT_TOO_SMALL");
  item = await admin.deactivateDevice(first.license.id, 3, "admin", "127.0.0.1");
  assert.equal(item.activeDevices, 4);
  assert.deepEqual(item.devices.map((device) => device.slot), [1, 2, 4, 5]);
  await assert.rejects(() => publicService.verify({ deviceHash: tokens[2].deviceHash, product: "shuzhi-xuegong" }, tokens[2].token), (error) => error.code === "DEVICE_DEACTIVATED");
  item = await admin.setStatus(first.license.id, "revoked", "admin", "127.0.0.1"); assert.equal(item.status, "revoked");
  await assert.rejects(() => publicService.verify({ deviceHash: tokens[0].deviceHash, product: "shuzhi-xuegong" }, tokens[0].token), (error) => error.code === "LICENSE_REVOKED");
  item = await admin.setStatus(first.license.id, "active", "admin", "127.0.0.1"); assert.equal(item.status, "active");
  now += 1000;
  item = await admin.update(first.license.id, { customerName: "新客户", customerXhsId: "xhs_new", customerWechat: "wx_new", note: "新备注", maxDevices: 6, expiresAt: now + 86400000 }, "admin", "127.0.0.1");
  assert.equal(item.customer, "新客户"); assert.equal(item.customerName, "新客户"); assert.equal(item.customerXhsId, "xhs_new"); assert.equal(item.customerWechat, "wx_new"); assert.equal(item.maxDevices, 6); assert.equal(item.note, "新备注");
  const deleted = batch.items[1];
  assert.equal((await admin.deleteLicense(deleted.license.id, "admin", "127.0.0.1")).ok, true);
  assert.equal((await admin.list()).stats.total, 1);
  await assert.rejects(() => publicService.activate({ code: deleted.code, deviceHash: crypto.createHash("sha256").update("deleted-license").digest("hex"), product: "shuzhi-xuegong" }), (error) => error.code === "LICENSE_NOT_FOUND");
  const legacyCode = "LEGAC-Y2345-ABCDE-6789Z";
  const legacyHash = hashCode(legacyCode, pepper);
  await repository.create({ id: `lic_${legacyHash.slice(0, 16)}`, licenseHash: legacyHash, product: "shuzhi-xuegong", status: "active", maxDevices: 5, customer: "旧接口客户", devices: [], revision: 1, createdAt: now - 1000, updatedAt: now - 1000 });
  let legacySummary = await admin.unrecoverableSummary();
  assert.equal(legacySummary.matched, 1);
  assert.equal(legacySummary.active, 1);
  const forced = await admin.forceRevokeUnrecoverable("deployment-maintenance", "direct-fc-invoke", "req-maint-1");
  assert.equal(forced.updated, 1);
  assert.equal(forced.activeRemaining, 0);
  const legacy = (await admin.list()).licenses.find((license) => license.id === `lic_${legacyHash.slice(0, 16)}`);
  assert.equal(legacy.status, "revoked");
  assert.equal(legacy.codeAvailable, false);
  assert.equal(legacy.issuanceChannel, "legacy-hash-only");
  assert.ok(legacy.forcedRevokedAt);
  await assert.rejects(() => admin.setStatus(legacy.id, "active", "admin", "127.0.0.1"), (error) => error.code === "UNRECOVERABLE_LICENSE_CANNOT_RESTORE");
  const forcedAgain = await admin.forceRevokeUnrecoverable("deployment-maintenance", "direct-fc-invoke", "req-maint-2");
  assert.equal(forcedAgain.updated, 0);
  assert.equal(forcedAgain.alreadyEnforced, 1);
  legacySummary = await admin.unrecoverableSummary();
  assert.equal(legacySummary.active, 0);
  const audit = await admin.auditList();
  for (const action of ["LICENSE_BATCH_CREATED", "LICENSE_CODE_VIEWED", "DEVICE_DEACTIVATED", "LICENSE_REVOKED", "LICENSE_RESTORED", "LICENSE_UPDATED", "LICENSE_DELETED", "LICENSE_LEGACY_FORCED_REVOKED", "LICENSE_LEGACY_REVOCATION_COMPLETED"]) assert.ok(audit.events.some((event) => event.action === action), `missing audit ${action}`);
}

async function authFlow() {
  const password = "Correct-Horse-Battery-2026";
  const encoded = await hashPassword(password, Buffer.alloc(16, 7));
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  const sessionSecret = "session-secret-that-is-definitely-long-enough";
  const token = signSession({ user: "admin", csrf: "csrf-token", exp: 10000 }, sessionSecret);
  assert.equal(verifySession(token, sessionSecret, 9999).user, "admin");
  assert.equal(verifySession(`${token}x`, sessionSecret, 9999), null);
  assert.equal(verifySession(token, sessionSecret, 10000), null);
}

async function handlerFlow() {
  const password = "Handler-Test-Password-2026";
  const passwordHash = await hashPassword(password, Buffer.alloc(16, 9));
  const config = { username: "admin", passwordHash, sessionSecret: "handler-session-secret-that-is-long-enough", pepper: "handler-pepper", codeEncryptionKey: Buffer.alloc(32, 9).toString("base64url") };
  const repository = new SharedMemoryRepository();
  const auditRepository = new MemoryAuditRepository();
  const service = new LicenseAdminService({ repository, auditRepository, pepper: config.pepper, codeEncryptionKey: config.codeEncryptionKey });
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD_HASH = passwordHash;
  process.env.ADMIN_SESSION_SECRET = config.sessionSecret;
  process.env.LICENSE_CODE_PEPPER = config.pepper;
  process.env.LICENSE_CODE_ENCRYPTION_KEY = config.codeEncryptionKey;
  const { applicationHandler } = require("../index");
  const event = (method, path, body, headers = {}) => ({ requestContext: { http: { method, sourceIp: "127.0.0.1" } }, rawPath: path, headers, body: body ? JSON.stringify(body) : "" });
  const wrongPassword = await applicationHandler(event("POST", "/v1/admin/login", { username: "admin", password: "wrong-password" }), {}, { config, service });
  assert.equal(wrongPassword.statusCode, 401);
  assert.match(JSON.parse(wrongPassword.body).error, /账号或密码错误/);
  const login = await applicationHandler(event("POST", "/v1/admin/login", { username: "admin", password }), {}, { config, service });
  assert.equal(login.statusCode, 200);
  const loginBody = JSON.parse(login.body);
  const cookie = login.headers["Set-Cookie"].split(";")[0];
  const me = await applicationHandler(event("GET", "/v1/admin/me", null, { cookie }), {}, { config, service });
  assert.equal(me.statusCode, 200);
  const denied = await applicationHandler(event("POST", "/v1/admin/licenses/batch", { count: 1 }, { cookie }), {}, { config, service });
  assert.equal(denied.statusCode, 403);
  const created = await applicationHandler(event("POST", "/v1/admin/licenses/batch", { count: 2, customerName: "接口测试", customerXhsId: "xhs_api", customerWechat: "wx_api", maxDevices: 5 }, { cookie, "x-csrf-token": loginBody.csrf }), {}, { config, service });
  assert.equal(created.statusCode, 201);
  assert.equal(JSON.parse(created.body).items.length, 2);
  assert.equal(JSON.parse(created.body).items[0].license.customerXhsId, "xhs_api");
  const createdBody = JSON.parse(created.body);
  const listed = await applicationHandler(event("GET", "/v1/admin/licenses", null, { cookie }), {}, { config, service });
  assert.equal(JSON.parse(listed.body).licenses.length, 2);
  assert.equal(JSON.parse(listed.body).licenses[0].codeAvailable, true);
  assert.equal(listed.body.includes(createdBody.items[0].code), false, "list API must not return plaintext activation codes");
  assert.equal(listed.body.includes("encryptedCode"), false, "list API must not return encrypted code payloads");
  const revealed = await applicationHandler(event("POST", `/v1/admin/licenses/${createdBody.items[0].license.id}/code/reveal`, {}, { cookie, "x-csrf-token": loginBody.csrf }), {}, { config, service });
  assert.equal(revealed.statusCode, 200);
  assert.equal(JSON.parse(revealed.body).code, createdBody.items[0].code);
  const removed = await applicationHandler(event("DELETE", `/v1/admin/licenses/${createdBody.items[1].license.id}`, {}, { cookie, "x-csrf-token": loginBody.csrf }), {}, { config, service });
  assert.equal(removed.statusCode, 200);
  assert.equal((await service.list()).stats.total, 1);
  const exported = await applicationHandler(event("GET", "/v1/admin/licenses/export.csv", null, { cookie }), {}, { config, service });
  assert.match(exported.body, /授权编号,激活码保存状态,客户姓名,小红书ID,微信名或微信号/);
  const html = await applicationHandler(event("GET", "/admin", null), {}, { config, service });
  assert.equal(html.statusCode, 200); assert.match(html.body, /授权管理后台/); assert.doesNotMatch(html.body, /loginTotp|动态验证码/); assert.match(html.headers["Content-Security-Policy"], /default-src 'none'/);
  const maintenance = await applicationHandler({ maintenanceAction: "inspect-unrecoverable" }, { requestId: "maintenance-test" }, { config, service });
  assert.equal(maintenance.matched, 0);
}

(async () => {
  await authFlow();
  await coreFlow();
  await handlerFlow();
  console.log("aliyun-license-admin: passed (password auth, encrypted code reveal, provenance, legacy forced revocation, code search, delete, CSRF, device limit, revoke, unbind, audit, static UI)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
