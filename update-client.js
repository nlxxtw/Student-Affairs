"use strict";

/*
 * 数智学工程序更新客户端。
 * 更新服务器只返回短期 OSS 下载地址；本机仅下载并校验，不保存 OSS 凭据。
 * 业务数据目录 data/、附件、备份和便携密钥不在更新包替换范围内。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const DEFAULT_CONFIG = Object.freeze({ enabled: false, channel: "stable", checkIntervalHours: 24, maxPackageBytes: 2 * 1024 * 1024 * 1024 });
const MAX_NOTES_LENGTH = 8000;

function readJson(file, fallback) {
  try { const value = JSON.parse(fs.readFileSync(file, "utf8")); return value && typeof value === "object" ? value : fallback; }
  catch (_error) { return fallback; }
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}
function sha256File(file) {
  const hash = crypto.createHash("sha256"), descriptor = fs.openSync(file, "r"), buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}
function versionParts(value) {
  const match = /^V?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/i.exec(String(value || "").trim());
  if (!match) return null;
  return { raw: String(value), parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] || "" };
}
function compareVersion(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) throw new Error("版本号格式无效。");
  for (let index = 0; index < 3; index++) if (a.parts[index] !== b.parts[index]) return a.parts[index] > b.parts[index] ? 1 : -1;
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en");
}
function platformId() { return `${process.platform}-${process.arch}`; }
function publicRelease(release) {
  if (!release) return null;
  return { version: release.version, platform: release.platform, size: release.size, sha256: release.sha256, releaseNotes: release.releaseNotes, publishedAt: release.publishedAt, mandatory: release.mandatory === true, minSupportedVersion: release.minSupportedVersion || "", downloadExpiresAt: release.downloadExpiresAt || "" };
}
function releaseSignaturePayload(release) {
  return JSON.stringify(["shuzhi-update-v1", String(release.version || ""), String(release.channel || "stable"), String(release.platform || ""), String(release.objectKey || ""), String(release.sha256 || "").toLowerCase(), Number(release.size), String(release.releaseNotes || ""), String(release.publishedAt || ""), release.mandatory === true, String(release.minSupportedVersion || "")]);
}
function ensureFreeSpace(directory, requiredBytes, label) {
  if (typeof fs.statfsSync !== "function") return;
  fs.mkdirSync(directory, { recursive: true });
  const stats = fs.statfsSync(directory);
  const available = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(available) && available < requiredBytes) throw new Error(`${label}所需磁盘空间不足，至少还需要 ${Math.ceil((requiredBytes - available) / 1024 / 1024)} MB。`);
}

class UpdateClient {
  constructor(options) {
    this.root = options.root;
    this.dataDir = options.dataDir;
    this.appVersion = options.appVersion;
    this.licenseClient = options.licenseClient || null;
    this.configPath = options.configPath || path.join(this.root, "update-config.json");
    this.statePath = path.join(this.dataDir, "update-state.json");
    this.downloadDir = path.join(this.dataDir, "updates", "downloads");
    this.config = Object.assign({}, DEFAULT_CONFIG, readJson(this.configPath, {}));
    this.available = null; // 短期下载链接仅留在内存，重启服务后必须重新检查。
    this.downloaded = null;
    this.downloadPromise = null;
    this.progress = { phase: "idle", percent: 0, message: "" };
    this.restoreDownloaded();
  }

  enabled() { return this.config.enabled === true; }
  intervalMs() { return Math.max(1, Math.min(168, Number(this.config.checkIntervalHours) || 24)) * 60 * 60 * 1000; }
  maxPackageBytes() { return Math.max(1024 * 1024, Math.min(8 * 1024 * 1024 * 1024, Number(this.config.maxPackageBytes) || DEFAULT_CONFIG.maxPackageBytes)); }
  state() { return readJson(this.statePath, { version: 1, lastCheckedAt: "", lastError: "", latest: null, downloaded: null }); }
  saveState(next) { atomicWriteJson(this.statePath, Object.assign({ version: 1 }, next)); }
  setProgress(phase, percent, message) {
    this.progress = { phase: String(phase || "idle"), percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))), message: String(message || "") };
  }
  restoreDownloaded() {
    const state = this.state(), saved = state.downloaded, latest = state.latest;
    if (!saved || !latest) return;
    try {
      const fileName = String(saved.fileName || "");
      if (!fileName || fileName !== path.basename(fileName) || !fileName.toLowerCase().endsWith(".zip")) throw new Error("文件名无效");
      if (!versionParts(saved.version) || String(saved.version) !== String(latest.version) || compareVersion(saved.version, this.appVersion) <= 0) throw new Error("版本已失效");
      if (String(latest.platform) !== platformId() || !/^[a-f0-9]{64}$/i.test(String(latest.sha256 || ""))) throw new Error("版本清单无效");
      const file = path.resolve(this.downloadDir, fileName);
      if (path.dirname(file) !== path.resolve(this.downloadDir) || !fs.existsSync(file)) throw new Error("文件不存在");
      const size = fs.statSync(file).size;
      if (size !== Number(saved.size) || size !== Number(latest.size) || sha256File(file) !== String(latest.sha256).toLowerCase()) throw new Error("文件校验失败");
      this.downloaded = { file, version: String(saved.version), sha256: String(latest.sha256).toLowerCase(), size, verifiedAt: String(saved.verifiedAt || "") };
      this.setProgress("ready", 100, "升级包已下载并通过校验，可直接安装。");
    } catch (_error) {
      this.downloaded = null;
      this.saveState(Object.assign({}, state, { downloaded: null }));
    }
  }
  publicStatus() {
    const state = this.state();
    return { enabled: this.enabled(), channel: String(this.config.channel || "stable"), currentVersion: this.appVersion, platform: platformId(), lastCheckedAt: state.lastCheckedAt || "", lastError: state.lastError || "", latest: publicRelease(this.available) || state.latest || null, downloaded: this.downloaded ? { version: this.downloaded.version, fileName: path.basename(this.downloaded.file), size: this.downloaded.size, verifiedAt: this.downloaded.verifiedAt } : null, progress: Object.assign({}, this.progress) };
  }
  validateRelease(value) {
    if (!value || typeof value !== "object") throw new Error("更新服务器返回格式无效。");
    if (value.available !== true) return null;
    const release = value.release;
    if (!release || typeof release !== "object") throw new Error("更新服务器未提供版本信息。");
    if (!versionParts(release.version) || !/^[a-z0-9]+-[a-z0-9]+$/i.test(String(release.platform || ""))) throw new Error("更新版本或平台信息无效。");
    if (String(release.platform) !== platformId()) throw new Error("该更新包不适用于当前系统平台。");
    if (!/^https:\/\//i.test(String(release.downloadUrl || ""))) throw new Error("更新下载地址必须使用 HTTPS。");
    if (!/^[a-f0-9]{64}$/i.test(String(release.sha256 || ""))) throw new Error("更新包完整性信息无效。");
    const size = Number(release.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > this.maxPackageBytes()) throw new Error("更新包大小超出安全限制。");
    if (compareVersion(release.version, this.appVersion) <= 0) return null;
    if (release.minSupportedVersion && compareVersion(this.appVersion, release.minSupportedVersion) < 0) throw new Error("当前版本过旧，需先联系维护人员获取基础升级包。");
    const publicKey = String(this.config.publicKey || (this.licenseClient && this.licenseClient.config && this.licenseClient.config.publicKey) || "");
    if (publicKey) {
      if (!/^[A-Za-z0-9_-]{64,256}$/.test(String(release.signature || ""))) throw new Error("更新版本缺少有效的数字签名。");
      let signatureValid = false;
      try { signatureValid = crypto.verify(null, Buffer.from(releaseSignaturePayload(Object.assign({}, release, { size })), "utf8"), publicKey, Buffer.from(String(release.signature), "base64url")); } catch (_error) {}
      if (!signatureValid) throw new Error("更新版本数字签名验证失败。");
    }
    return { version: String(release.version), platform: String(release.platform), downloadUrl: String(release.downloadUrl), downloadExpiresAt: String(release.downloadExpiresAt || ""), sha256: String(release.sha256).toLowerCase(), size, releaseNotes: String(release.releaseNotes || "").slice(0, MAX_NOTES_LENGTH), publishedAt: String(release.publishedAt || ""), mandatory: release.mandatory === true, minSupportedVersion: String(release.minSupportedVersion || "") };
  }
  async check(force) {
    if (!this.enabled()) return Object.assign(this.publicStatus(), { checked: false, message: "更新服务尚未启用。" });
    const old = this.state();
    if (!force && old.lastCheckedAt && Date.now() - Date.parse(old.lastCheckedAt) < this.intervalMs()) return Object.assign(this.publicStatus(), { checked: false, cached: true });
    try {
      if (!this.licenseClient || typeof this.licenseClient.requestAuthorized !== "function") {
        throw new Error("在线更新已随激活码授权一并停用。请联系作者获取新版本安装包。");
      }
      const result = await this.licenseClient.requestAuthorized("/v1/updates/check", { appVersion: this.appVersion, platform: platformId(), channel: String(this.config.channel || "stable") });
      const nextAvailable = this.validateRelease(result);
      const keepDownloaded = !!(this.downloaded && nextAvailable && this.downloaded.version === nextAvailable.version && this.downloaded.sha256 === nextAvailable.sha256 && this.downloaded.size === nextAvailable.size);
      this.available = nextAvailable;
      if (!keepDownloaded) this.downloaded = null;
      this.setProgress(keepDownloaded ? "ready" : "idle", keepDownloaded ? 100 : 0, keepDownloaded ? "升级包已下载并通过校验，可直接安装。" : "");
      this.saveState({ lastCheckedAt: new Date().toISOString(), lastError: "", latest: publicRelease(this.available), downloaded: keepDownloaded ? { version: this.downloaded.version, fileName: path.basename(this.downloaded.file), size: this.downloaded.size, verifiedAt: this.downloaded.verifiedAt } : null });
      return Object.assign(this.publicStatus(), { checked: true, available: !!this.available });
    } catch (error) {
      this.saveState(Object.assign({}, old, { lastCheckedAt: new Date().toISOString(), lastError: String(error && error.message || "检查更新失败。").slice(0, 500) }));
      throw error;
    }
  }
  async download() {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = this.performDownload();
    try { return await this.downloadPromise; }
    finally { this.downloadPromise = null; }
  }
  async performDownload() {
    if (this.downloaded && fs.existsSync(this.downloaded.file)) {
      this.setProgress("ready", 100, "升级包已下载并通过校验，可直接安装。");
      return Object.assign({}, this.downloaded, { fileName: path.basename(this.downloaded.file), reused: true });
    }
    if (!this.available || this.available.downloadExpiresAt && Date.parse(this.available.downloadExpiresAt) <= Date.now()) {
      this.setProgress("checking", 1, "下载地址已失效，正在重新检查更新…");
      await this.check(true);
    }
    if (!this.available) throw new Error("当前没有可下载的更新版本。");
    fs.mkdirSync(this.downloadDir, { recursive: true });
    ensureFreeSpace(this.downloadDir, this.available.size + 256 * 1024 * 1024, "下载升级包");
    const safeVersion = this.available.version.replace(/[^0-9A-Za-z._-]/g, "_");
    const target = path.join(this.downloadDir, `数智学工-${safeVersion}-${this.available.platform}.zip`);
    const partial = `${target}.part`;
    for (const file of [target, partial]) { try { fs.unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; } }
    this.setProgress("downloading", 1, "正在连接更新服务器…");
    try {
      await downloadToFile(this.available.downloadUrl, partial, this.available.size, this.maxPackageBytes(), (received, total) => {
        const percent = total > 0 ? Math.min(88, Math.max(2, Math.round(received / total * 88))) : 2;
        this.setProgress("downloading", percent, `正在下载升级包：${percent}%`);
      });
      this.setProgress("verifying", 92, "下载完成，正在校验 SHA-256…");
      const actual = sha256File(partial);
      if (actual !== this.available.sha256) throw new Error("更新包校验失败，文件已删除。请重新检查更新后再试。");
      fs.renameSync(partial, target);
      this.downloaded = { file: target, version: this.available.version, sha256: actual, size: fs.statSync(target).size, verifiedAt: new Date().toISOString() };
      const old = this.state();
      this.saveState(Object.assign({}, old, { lastError: "", latest: publicRelease(this.available), downloaded: { version: this.downloaded.version, fileName: path.basename(target), size: this.downloaded.size, verifiedAt: this.downloaded.verifiedAt } }));
      this.setProgress("ready", 100, "升级包已下载并通过校验，可直接安装。");
      return Object.assign({}, this.downloaded, { fileName: path.basename(target) });
    } catch (error) {
      try { fs.unlinkSync(partial); } catch (_error) {}
      this.setProgress("error", 0, String(error && error.message || "下载更新包失败。"));
      throw error;
    }
  }
  downloadedPackage() { return this.downloaded && fs.existsSync(this.downloaded.file) ? Object.assign({}, this.downloaded) : null; }
}

function downloadToFile(rawUrl, target, expectedSize, maxBytes, onProgress) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("更新下载地址必须使用 HTTPS。");
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/octet-stream" }, timeout: 30000 }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`下载更新包失败（${response.statusCode}）。`)); return; }
      const length = Number(response.headers["content-length"] || 0);
      if (length && (!Number.isSafeInteger(length) || length !== expectedSize || length > maxBytes)) { response.resume(); reject(new Error("更新包大小与版本清单不一致。")); return; }
      const output = fs.createWriteStream(target, { flags: "wx", mode: 0o600 });
      let received = 0, settled = false, finished = false;
      const fail = (error) => { if (settled) return; settled = true; try { output.destroy(); } catch (_error) {} try { fs.unlinkSync(target); } catch (_error) {} reject(error); };
      response.on("data", (chunk) => { received += chunk.length; if (typeof onProgress === "function") onProgress(received, expectedSize); if (received > maxBytes || received > expectedSize) { response.destroy(new Error("更新包大小超出版本清单限制。")); } });
      response.on("error", fail); output.on("error", fail);
      output.on("finish", () => { if (!settled && received === expectedSize) finished = true; else if (!settled) fail(new Error("更新包下载不完整。")); });
      output.on("close", () => { if (!settled && finished) { settled = true; resolve(); } });
      response.pipe(output);
    });
    request.on("timeout", () => request.destroy(new Error("下载更新包超时。")));
    request.on("error", reject);
  });
}

module.exports = { UpdateClient, compareVersion, platformId, releaseSignaturePayload };
