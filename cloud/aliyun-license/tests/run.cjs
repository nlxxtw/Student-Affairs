"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { LicenseService, hashCode } = require("../license-core");
const { ossSignedGetUrl, validateManifest } = require("../update-release");
const { retentionPlan } = require("../publish-update.cjs");

function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }
class MemoryRepository {
  constructor() { this.rows = new Map(); }
  async get(hash) { return clone(this.rows.get(hash)); }
  async create(record) { if (this.rows.has(record.licenseHash)) return false; this.rows.set(record.licenseHash, clone(record)); return true; }
  async compareAndSwap(current, updated) {
    await new Promise((resolve) => setImmediate(resolve));
    const saved = this.rows.get(current.licenseHash);
    if (!saved || saved.revision !== current.revision) return false;
    this.rows.set(current.licenseHash, clone(updated)); return true;
  }
}

function device(index) { return { deviceHash: crypto.createHash("sha256").update(`device-${index}`).digest("hex"), deviceName: `设备 ${index}`, product: "shuzhi-xuegong" }; }

async function main() {
  const { applicationHandler } = require("../index");
  const retired = await applicationHandler({ requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } }, rawPath: "/v1/admin/licenses", headers: {}, body: "{}" }, {});
  assert.strictEqual(retired.statusCode, 410);
  assert.strictEqual(JSON.parse(retired.body).code, "LEGACY_ISSUANCE_RETIRED");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const repository = new MemoryRepository();
  const pepper = "qa-pepper-value-with-at-least-32-bytes";
  const service = new LicenseService({ repository, pepper, privateKey, publicKey, verifyIntervalHours: 24, offlineGraceDays: 180 });
  await assert.rejects(() => service.createLicense({ customer: "测试客户", maxDevices: 5 }), (error) => error.code === "LEGACY_ISSUANCE_RETIRED");
  const code = "ABCDE-FGHJK-MNPQR-STUVW";
  const licenseHash = hashCode(code, pepper);
  const now = Date.now();
  const record = { id: `lic_${licenseHash.slice(0, 16)}`, licenseHash, encryptedCode: { version: 1 }, issuanceChannel: "license-admin-v1", product: "shuzhi-xuegong", status: "active", maxDevices: 5, customer: "测试客户", note: "", expiresAt: null, devices: [], revision: 1, createdAt: now, updatedAt: now };
  assert.equal(await repository.create(record), true);
  const created = { code, license: service.publicLicense(record) };
  assert.strictEqual(created.license.maxDevices, 5);
  const legacyCode = "ZXCVB-NMASD-FGHJK-QWERT";
  const legacyHash = hashCode(legacyCode, pepper);
  assert.equal(await repository.create({ id: `lic_${legacyHash.slice(0, 16)}`, licenseHash: legacyHash, product: "shuzhi-xuegong", status: "active", maxDevices: 5, customer: "旧授权", devices: [], revision: 1, createdAt: now, updatedAt: now }), true);
  await assert.rejects(() => service.activate(Object.assign({ code: legacyCode }, device(99))), (error) => error.code === "LICENSE_REVOKED");

  const activations = await Promise.all([1, 2, 3, 4, 5].map((index) => service.activate(Object.assign({ code: created.code }, device(index)))));
  assert.deepStrictEqual(activations.map((item) => item.slot).sort(), [1, 2, 3, 4, 5]);
  await assert.rejects(() => service.activate(Object.assign({ code: created.code }, device(6))), (error) => error.code === "DEVICE_LIMIT_REACHED");

  const repeated = await service.activate(Object.assign({ code: created.code }, device(1)));
  assert.strictEqual(repeated.slot, 1, "同一设备重复激活不得占用新槽位");
  const signedPayload = JSON.parse(Buffer.from(repeated.token.split(".")[0], "base64url").toString("utf8"));
  assert.strictEqual(Math.round((signedPayload.offlineUntil - signedPayload.verifiedAt) / 86400000), 180, "离线授权期限必须为 180 天");
  const verified = await service.verify(device(1), repeated.token);
  assert.ok(verified.token && verified.activeDevices === 5);
  await assert.rejects(() => service.verify(device(2), repeated.token), (error) => error.code === "DEVICE_MISMATCH");

  await service.deactivate(device(1), repeated.token);
  const replacement = await service.activate(Object.assign({ code: created.code }, device(6)));
  assert.strictEqual(replacement.activeDevices, 5, "解除激活后应释放一个设备名额");
  const tampered = replacement.token.replace(/^./, replacement.token[0] === "a" ? "b" : "a");
  await assert.rejects(() => service.verify(device(6), tampered), (error) => error.code === "INVALID_TOKEN");

  const signedUrl = new URL(ossSignedGetUrl("example-bucket", "cn-hangzhou", "releases/current.json", {
    accessKeyId: "sts-access-key",
    accessKeySecret: "sts-access-secret",
    securityToken: "sts-security-token"
  }, 60));
  const expires = signedUrl.searchParams.get("Expires");
  const expectedSignature = crypto.createHmac("sha1", "sts-access-secret")
    .update(`GET\n\n\n${expires}\n/example-bucket/releases/current.json?security-token=sts-security-token`, "utf8")
    .digest("base64");
  assert.strictEqual(signedUrl.searchParams.get("security-token"), "sts-security-token");
  assert.strictEqual(signedUrl.searchParams.get("Signature"), expectedSignature, "STS 安全令牌必须进入 OSS V1 CanonicalizedResource");
  const signedManifestRelease = validateManifest({ schemaVersion: 1, releases: [{ version: "V5.1.2", channel: "stable", platform: "win32-x64", objectKey: "releases/V5.1.2/test.zip", sha256: "c".repeat(64), size: 123, signature: "signed-release-value" }] }, "win32-x64", "stable", "V5.1.1");
  assert.strictEqual(signedManifestRelease.signature, "signed-release-value", "FC must pass the release signature to the client");
  const retention = retentionPlan([
    { name: "releases/V5.0.1/old.zip", lastModified: "2026-01-01" },
    { name: "releases/V5.1.1/previous.zip", lastModified: "2026-02-01" },
    { name: "releases/V5.2.0/current.zip", lastModified: "2026-03-01" },
    { name: "releases/current.json", lastModified: "2026-03-01" },
    { name: "backups/do-not-delete.zip", lastModified: "2025-01-01" }
  ], "releases/V5.2.0/current.zip", 2);
  assert.deepStrictEqual(retention.retained, ["releases/V5.2.0/current.zip", "releases/V5.1.1/previous.zip"]);
  assert.deepStrictEqual(retention.removed, ["releases/V5.0.1/old.zip"]);
  console.log("aliyun-license core: passed (legacy issuance retired, 5-device CAS limit, verify, deactivate, signature, OSS STS signature, 2-package retention)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
