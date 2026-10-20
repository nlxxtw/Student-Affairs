"use strict";

/*
 * 数智学工本机授权客户端。
 * - 云端只接收激活码哈希对应的查询凭据和不可逆设备指纹。
 * - 云端签发的 Ed25519 凭证与当前设备绑定，复制 license-state.json 无法换机使用。
 * - 云端临时不可用时，允许使用最近一次验证凭证中的离线宽限期。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { execFileSync } = require("child_process");

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  apiUrl: "",
  product: "shuzhi-xuegong",
  verifyIntervalHours: 72,
  offlineGraceDays: 180,
  requestTimeoutMs: 10000,
  publicKey: ""
});

/* 服务端已经明确判定授权不可用时，绝不能继续套用 180 天离线宽限。
   离线宽限只用于断网、超时、限流和服务端临时故障。 */
const DEFINITIVE_LICENSE_REJECTION_CODES = new Set([
  "LICENSE_NOT_FOUND",
  "PRODUCT_MISMATCH",
  "LICENSE_REVOKED",
  "LICENSE_EXPIRED",
  "DEVICE_MISMATCH",
  "DEVICE_DEACTIVATED"
]);

function isDefinitiveLicenseRejection(error) {
  if (!error) return false;
  if (DEFINITIVE_LICENSE_REJECTION_CODES.has(String(error.code || "").toUpperCase())) return true;
  return [401, 403, 404].includes(Number(error.statusCode));
}

function base64urlDecode(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function readJsonFile(file, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function windowsMachineGuid() {
  if (process.platform !== "win32") return "";
  try {
    const output = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match ? match[1].trim() : "";
  } catch (_error) {
    return "";
  }
}

function stableMachineSource(dataDir) {
  const registryId = windowsMachineGuid();
  if (registryId) return `windows:${registryId}`;
  const fallbackPath = path.join(dataDir, "device-id");
  try {
    const existing = fs.readFileSync(fallbackPath, "utf8").trim();
    if (/^[a-f0-9-]{32,64}$/i.test(existing)) return `portable:${existing}`;
  } catch (_error) {}
  const generated = crypto.randomUUID();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(fallbackPath, generated, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return `portable:${generated}`;
}

function validateApiUrl(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch (_error) { throw new Error("授权服务器地址无效。"); }
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("授权服务器必须使用 HTTPS。");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function requestJson(url, options, timeoutMs) {
  const body = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body), "utf8");
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    if (body) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": body.length });
    const request = client.request(url, { method: options.method || "GET", headers, timeout: timeoutMs }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 512 * 1024) { request.destroy(new Error("授权服务器响应过大。")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        let result = {};
        try { result = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; }
        catch (_error) { reject(new Error("授权服务器返回了无效数据。")); return; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(result.error || `授权服务器请求失败（${response.statusCode}）。`);
          error.statusCode = response.statusCode;
          error.code = result.code || "LICENSE_SERVER_ERROR";
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    request.on("timeout", () => request.destroy(new Error("连接授权服务器超时。")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

class LicenseClient {
  constructor(options) {
    this.root = options.root;
    this.dataDir = options.dataDir;
    this.appVersion = options.appVersion;
    this.configPath = options.configPath || path.join(this.root, "license-config.json");
    this.statePath = options.statePath || path.join(this.dataDir, "license-state.json");
    this.config = Object.assign({}, DEFAULT_CONFIG, readJsonFile(this.configPath, {}));
    /* 正式商业版可强制启用授权，防止通过修改外部 JSON 配置绕过激活门禁。 */
    this.config.enabled = options.forceEnabled === true || this.config.enabled === true;
    this.config.product = String(this.config.product || DEFAULT_CONFIG.product);
    this.deviceHash = sha256(`${this.config.product}|${stableMachineSource(this.dataDir)}`);
  }

  isEnabled() { return this.config.enabled; }

  clearLocalState() {
    try { fs.unlinkSync(this.statePath); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }

  rejectedStatus(error) {
    return {
      required: true,
      valid: false,
      state: String(error && error.code || "").toUpperCase() === "LICENSE_EXPIRED" ? "expired" : "revoked",
      code: error && error.code || "LICENSE_REJECTED",
      error: error && error.message || "当前授权已被服务端停用。",
      deviceName: os.hostname()
    };
  }

  publicStatus() {
    if (!this.isEnabled()) return { required: false, valid: true, state: "disabled" };
    try {
      const state = this.readVerifiedState();
      const now = Date.now();
      return {
        required: true,
        valid: now < state.payload.offlineUntil,
        state: now < state.payload.offlineUntil ? "active" : "expired",
        licenseId: String(state.payload.licenseId || ""),
        expiresAt: state.payload.expiresAt || null,
        lastVerifiedAt: state.payload.verifiedAt || null,
        nextVerificationAt: state.payload.nextVerifyAt || null,
        offlineUntil: state.payload.offlineUntil || null,
        deviceName: os.hostname()
      };
    } catch (error) {
      return { required: true, valid: false, state: "inactive", error: error.message, deviceName: os.hostname() };
    }
  }

  readVerifiedState() {
    const state = readJsonFile(this.statePath, null);
    if (!state || !state.token) throw new Error("本机尚未激活。");
    const payload = this.verifyToken(state.token);
    return { token: state.token, payload };
  }

  verifyToken(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) throw new Error("本机授权凭证格式无效。");
    if (!this.config.publicKey) throw new Error("授权公钥尚未配置。");
    let payload;
    try { payload = JSON.parse(base64urlDecode(parts[0]).toString("utf8")); }
    catch (_error) { throw new Error("本机授权凭证内容无效。"); }
    const signatureValid = crypto.verify(null, Buffer.from(parts[0], "utf8"), this.config.publicKey, base64urlDecode(parts[1]));
    if (!signatureValid) throw new Error("本机授权凭证签名无效。");
    if (payload.product !== this.config.product || payload.deviceHash !== this.deviceHash) throw new Error("本机授权凭证与当前设备不匹配。");
    for (const field of ["verifiedAt", "nextVerifyAt", "offlineUntil"]) if (!Number.isFinite(Number(payload[field]))) throw new Error("本机授权凭证时间无效。");
    if (payload.expiresAt && Date.now() >= Number(payload.expiresAt)) throw new Error("激活码已到期。");
    return payload;
  }

  endpoint(pathname) {
    const base = validateApiUrl(this.config.apiUrl);
    base.pathname = `${base.pathname.replace(/\/+$/, "")}${pathname}`;
    return base;
  }

  async activate(code) {
    if (!this.isEnabled()) throw new Error("授权功能尚未启用。");
    const normalized = normalizeCode(code);
    if (normalized.length < 16 || normalized.length > 64) throw new Error("请输入有效的激活码。");
    const result = await requestJson(this.endpoint("/v1/licenses/activate"), {
      method: "POST",
      body: { code: normalized, deviceHash: this.deviceHash, deviceName: os.hostname().slice(0, 80), product: this.config.product, appVersion: this.appVersion }
    }, Number(this.config.requestTimeoutMs) || DEFAULT_CONFIG.requestTimeoutMs);
    const payload = this.verifyToken(result.token);
    atomicWriteJson(this.statePath, { version: 1, token: result.token, savedAt: Date.now() });
    return Object.assign(this.publicStatus(), { slot: result.slot, activeDevices: result.activeDevices, maxDevices: result.maxDevices, payload });
  }

  async refresh(force = false) {
    if (!this.isEnabled()) return this.publicStatus();
    const state = this.readVerifiedState();
    if (!force && Date.now() < Number(state.payload.nextVerifyAt)) return this.publicStatus();
    let result;
    try {
      result = await requestJson(this.endpoint("/v1/licenses/verify"), {
        method: "POST",
        headers: { Authorization: `Bearer ${state.token}` },
        body: { deviceHash: this.deviceHash, product: this.config.product, appVersion: this.appVersion }
      }, Number(this.config.requestTimeoutMs) || DEFAULT_CONFIG.requestTimeoutMs);
    } catch (error) {
      if (isDefinitiveLicenseRejection(error)) {
        this.clearLocalState();
        error.licenseInvalidated = true;
      }
      throw error;
    }
    this.verifyToken(result.token);
    atomicWriteJson(this.statePath, { version: 1, token: result.token, savedAt: Date.now() });
    return this.publicStatus();
  }

  async ensureUsable(forceOnline = false) {
    if (!this.isEnabled()) return this.publicStatus();
    let state;
    try { state = this.readVerifiedState(); }
    catch (error) { return { required: true, valid: false, state: "inactive", error: error.message }; }
    if (Date.now() >= Number(state.payload.offlineUntil)) return { required: true, valid: false, state: "expired", error: "授权验证已超过离线宽限期，请联网后重新验证。" };
    if (forceOnline || Date.now() >= Number(state.payload.nextVerifyAt)) {
      try { return await this.refresh(true); }
      catch (error) {
        if (isDefinitiveLicenseRejection(error)) return this.rejectedStatus(error);
        if (Date.now() >= Number(state.payload.offlineUntil)) return { required: true, valid: false, state: "expired", error: error.message };
        return Object.assign(this.publicStatus(), { warning: `授权服务器暂时不可用，当前处于离线宽限期：${error.message}` });
      }
    }
    return this.publicStatus();
  }

  async deactivate() {
    if (!this.isEnabled()) return { ok: true };
    const state = this.readVerifiedState();
    await requestJson(this.endpoint("/v1/licenses/deactivate"), {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
      body: { deviceHash: this.deviceHash, product: this.config.product }
    }, Number(this.config.requestTimeoutMs) || DEFAULT_CONFIG.requestTimeoutMs);
    this.clearLocalState();
    return { ok: true };
  }

  /* 供更新服务等与授权绑定的云端能力使用。
     不暴露激活码或设备原始标识；服务端可返回新 token，以延续既有的授权复核链路。 */
  async requestAuthorized(pathname, extraBody) {
    if (!this.isEnabled()) throw new Error("授权功能尚未启用，无法检查更新。");
    const state = this.readVerifiedState();
    const result = await requestJson(this.endpoint(pathname), {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
      body: Object.assign({}, extraBody || {}, { deviceHash: this.deviceHash, product: this.config.product, appVersion: this.appVersion })
    }, Number(this.config.requestTimeoutMs) || DEFAULT_CONFIG.requestTimeoutMs);
    if (result && result.token) {
      this.verifyToken(result.token);
      atomicWriteJson(this.statePath, { version: 1, token: result.token, savedAt: Date.now() });
    }
    return result;
  }
}

module.exports = { LicenseClient, normalizeCode, sha256, isDefinitiveLicenseRejection };
