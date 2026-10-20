"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { LicenseClient } = require("../license-client");
const { LicenseService, hashCode } = require("../cloud/aliyun-license/license-core");

function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }
class MemoryRepository {
  constructor() { this.rows = new Map(); }
  async get(hash) { return clone(this.rows.get(hash)); }
  async create(row) { if (this.rows.has(row.licenseHash)) return false; this.rows.set(row.licenseHash, clone(row)); return true; }
  async compareAndSwap(current, updated) { const row = this.rows.get(current.licenseHash); if (!row || row.revision !== current.revision) return false; this.rows.set(current.licenseHash, clone(updated)); return true; }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "shuzhi-license-client-"));
  const dataDir = path.join(temp, "data"); fs.mkdirSync(dataDir);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const repository = new MemoryRepository();
  const pepper = "client-qa-pepper-value-at-least-32-bytes";
  const service = new LicenseService({ repository, pepper, privateKey, publicKey, verifyIntervalHours: 1, offlineGraceDays: 180 });
  const code = "ABCDE-FGHJK-MNPQR-STUVW";
  const seededLicenseHash = hashCode(code, pepper);
  const createdAt = Date.now();
  await repository.create({ id: `lic_${seededLicenseHash.slice(0, 16)}`, licenseHash: seededLicenseHash, encryptedCode: { version: 1 }, issuanceChannel: "license-admin-v1", product: "shuzhi-xuegong", status: "active", maxDevices: 5, customer: "本机客户端测试", note: "", expiresAt: null, devices: [], revision: 1, createdAt, updatedAt: createdAt });
  const issued = { code };
  const server = http.createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    try {
      let result;
      if (request.url === "/v1/licenses/activate") result = await service.activate(body);
      else if (request.url === "/v1/licenses/verify") result = await service.verify(body, String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""));
      else if (request.url === "/v1/licenses/deactivate") result = await service.deactivate(body, String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""));
      else throw Object.assign(new Error("not found"), { statusCode: 404 });
      response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(result));
    } catch (error) { response.writeHead(error.statusCode || 400, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: error.message, code: error.code })); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  /* 即便外部配置被改成 enabled:false，正式版的强制门禁也必须继续生效。 */
  fs.writeFileSync(path.join(temp, "license-config.json"), JSON.stringify({ enabled: false, apiUrl: `http://127.0.0.1:${port}`, product: "shuzhi-xuegong", publicKey, requestTimeoutMs: 3000 }));
  const client = new LicenseClient({ root: temp, dataDir, appVersion: "V-QA", forceEnabled: true });
  assert.strictEqual(client.publicStatus().required, true);
  assert.strictEqual(client.publicStatus().valid, false);
  const activated = await client.activate(issued.code);
  assert.strictEqual(activated.valid, true);
  assert.ok(fs.existsSync(path.join(dataDir, "license-state.json")));
  assert.strictEqual((await client.refresh(true)).valid, true);
  const [licenseHash] = repository.rows.keys();
  let cloudRecord = repository.rows.get(licenseHash);
  repository.rows.set(licenseHash, Object.assign({}, cloudRecord, { devices: [], revision: cloudRecord.revision + 1 }));
  const unbound = await client.ensureUsable(true);
  assert.strictEqual(unbound.valid, false, "admin device unbind must invalidate the client");
  assert.strictEqual(unbound.code, "DEVICE_DEACTIVATED");
  assert.strictEqual(fs.existsSync(path.join(dataDir, "license-state.json")), false, "device-unbound credentials must be removed locally");
  assert.strictEqual((await client.activate(issued.code)).valid, true, "the same active license may bind the device again");
  cloudRecord = repository.rows.get(licenseHash);
  repository.rows.set(licenseHash, Object.assign({}, cloudRecord, { status: "revoked", revision: cloudRecord.revision + 1 }));
  const revoked = await client.ensureUsable(true);
  assert.strictEqual(revoked.valid, false, "server-side revocation must never enter offline grace");
  assert.strictEqual(revoked.code, "LICENSE_REVOKED");
  assert.strictEqual(fs.existsSync(path.join(dataDir, "license-state.json")), false, "revoked credentials must be removed locally");
  assert.strictEqual(client.publicStatus().valid, false);
  cloudRecord = repository.rows.get(licenseHash);
  repository.rows.set(licenseHash, Object.assign({}, cloudRecord, { status: "active", revision: cloudRecord.revision + 1 }));
  assert.strictEqual((await client.activate(issued.code)).valid, true);
  repository.rows.delete(licenseHash);
  const deleted = await client.ensureUsable(true);
  assert.strictEqual(deleted.valid, false, "deleted cloud license must invalidate the client");
  assert.strictEqual(deleted.code, "LICENSE_NOT_FOUND");
  assert.strictEqual(fs.existsSync(path.join(dataDir, "license-state.json")), false, "deleted-license credentials must be removed locally");
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
  console.log("qa-license: passed (forced gate, device unbind, revocation and deletion clear stale local credentials)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
