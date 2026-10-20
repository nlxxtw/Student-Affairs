"use strict";

/* OSS 发行清单仅由 FC 读取；客户端只获取按授权签发的短期 GetObject 地址。 */
const crypto = require("crypto");
const https = require("https");
const { apiError } = require("./license-core");

function compareVersion(left, right) {
  const parse = (value) => { const match = /^V?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(String(value || "")); return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null; };
  const a = parse(left), b = parse(right); if (!a || !b) throw apiError(400, "INVALID_VERSION", "版本号格式无效。");
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
function requestBuffer(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 8000, headers: { Accept: "application/json" } }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(apiError(502, "UPDATE_MANIFEST_UNAVAILABLE", "更新清单暂不可用。")); return; }
      const chunks = []; let size = 0;
      response.on("data", (chunk) => { size += chunk.length; if (size > maxBytes) request.destroy(apiError(502, "UPDATE_MANIFEST_INVALID", "更新清单过大。")); else chunks.push(chunk); });
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("timeout", () => request.destroy(apiError(504, "UPDATE_MANIFEST_TIMEOUT", "读取更新清单超时。")));
    request.on("error", reject);
  });
}
function ossSignedGetUrl(bucket, region, objectKey, credentials, expiresSeconds) {
  const accessKeyId = String(credentials && credentials.accessKeyId || ""), accessKeySecret = String(credentials && credentials.accessKeySecret || ""), securityToken = String(credentials && credentials.securityToken || "");
  if (!accessKeyId || !accessKeySecret) throw new Error("FC 临时访问凭据不可用。");
  if (!/^[a-z0-9-]{3,63}$/i.test(bucket) || !/^cn-[a-z0-9-]+$/i.test(region) || !/^[A-Za-z0-9!_.*'()\-/]+$/.test(objectKey) || objectKey.includes("..")) throw new Error("OSS 更新路径配置无效。");
  const expires = Math.floor(Date.now() / 1000) + expiresSeconds;
  /* security-token 是 OSS V1 签名认可的子资源。使用 FC 角色的 STS
     临时凭据时，它既要出现在 URL 中，也必须进入 CanonicalizedResource。 */
  const canonicalizedResource = `/${bucket}/${objectKey}${securityToken ? `?security-token=${securityToken}` : ""}`;
  const stringToSign = `GET\n\n\n${expires}\n${canonicalizedResource}`;
  const signature = crypto.createHmac("sha1", accessKeySecret).update(stringToSign, "utf8").digest("base64");
  const query = new URLSearchParams({ OSSAccessKeyId: accessKeyId, Expires: String(expires), Signature: signature });
  if (securityToken) query.set("security-token", securityToken);
  return `https://${bucket}.oss-${region}.aliyuncs.com/${objectKey.split("/").map(encodeURIComponent).join("/")}?${query.toString()}`;
}
function validateManifest(manifest, platform, channel, currentVersion) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.releases)) throw apiError(502, "UPDATE_MANIFEST_INVALID", "更新清单格式无效。");
  const candidates = manifest.releases.filter((item) => item && item.channel === channel && item.platform === platform && typeof item.objectKey === "string" && item.objectKey.startsWith("releases/") && /^[a-f0-9]{64}$/i.test(String(item.sha256 || "")) && Number.isSafeInteger(Number(item.size)) && Number(item.size) > 0 && /^V?\d+\.\d+\.\d+/.test(String(item.version || "")) && !String(item.objectKey).includes(".."));
  candidates.sort((a, b) => compareVersion(b.version, a.version));
  const newest = candidates[0];
  if (!newest || compareVersion(newest.version, currentVersion) <= 0) return null;
  if (newest.minSupportedVersion && compareVersion(currentVersion, newest.minSupportedVersion) < 0) throw apiError(409, "UPDATE_BASE_VERSION_TOO_OLD", "当前版本过旧，请联系维护人员获取基础升级包。");
  return { version: String(newest.version), channel: String(newest.channel), platform: String(newest.platform), objectKey: newest.objectKey, sha256: String(newest.sha256).toLowerCase(), size: Number(newest.size), releaseNotes: String(newest.releaseNotes || "").slice(0, 8000), publishedAt: String(newest.publishedAt || ""), mandatory: newest.mandatory === true, minSupportedVersion: String(newest.minSupportedVersion || ""), signature: String(newest.signature || "") };
}

class UpdateReleaseService {
  constructor(options) { this.licenseService = options.licenseService; this.bucket = String(options.bucket || ""); this.region = String(options.region || ""); this.manifestKey = String(options.manifestKey || "releases/current.json"); this.credentials = options.credentials || {}; }
  enabled() { return !!this.bucket; }
  async check(input, token) {
    if (!this.enabled()) return { available: false, disabled: true };
    const verified = await this.licenseService.verify(input, token);
    const platform = String(input.platform || ""), channel = String(input.channel || "stable"), currentVersion = String(input.appVersion || "");
    if (!/^[a-z0-9]+-[a-z0-9]+$/i.test(platform) || !/^[a-z0-9-]{1,32}$/i.test(channel)) throw apiError(400, "INVALID_UPDATE_REQUEST", "更新请求参数无效。");
    const manifestUrl = ossSignedGetUrl(this.bucket, this.region, this.manifestKey, this.credentials, 60);
    let manifest; try { manifest = JSON.parse((await requestBuffer(manifestUrl, 256 * 1024)).toString("utf8").replace(/^\uFEFF/, "")); } catch (error) { if (error.statusCode) throw error; throw apiError(502, "UPDATE_MANIFEST_INVALID", "更新清单不是有效 JSON。", ); }
    const release = validateManifest(manifest, platform, channel, currentVersion);
    if (!release) return { available: false, token: verified.token };
    return { available: true, token: verified.token, release: Object.assign({}, release, { downloadUrl: ossSignedGetUrl(this.bucket, this.region, release.objectKey, this.credentials, 10 * 60), downloadExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }) };
  }
}

module.exports = { UpdateReleaseService, ossSignedGetUrl, validateManifest, compareVersion };
