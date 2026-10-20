"use strict";

const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const OSS = require(path.join(__dirname, ".deploy-tools", "node_modules", "ali-oss"));
const CredentialModule = require(path.join(__dirname, ".deploy-tools", "node_modules", "@serverless-devs", "credential"));
const yaml = require(path.join(__dirname, ".deploy-tools", "node_modules", "js-yaml"));

const ACCESS_ALIAS = "shuzhi-xuegong-deploy";

async function serverlessCredential() {
  const accessFile = path.join(os.homedir(), ".s", "access.yaml");
  const all = yaml.load(fs.readFileSync(accessFile, "utf8")) || {};
  const encrypted = all[ACCESS_ALIAS];
  if (!encrypted) throw new Error(`Serverless Devs 中不存在凭据别名 ${ACCESS_ALIAS}。`);
  const Credential = CredentialModule.default || CredentialModule;
  const candidate = await new Credential().decrypt(encrypted);
  const accessKeyId = candidate.AccessKeyID || candidate.accessKeyID || candidate.accessKeyId;
  const accessKeySecret = candidate.AccessKeySecret || candidate.accessKeySecret;
  const stsToken = candidate.SecurityToken || candidate.securityToken || candidate.stsToken;
  if (!accessKeyId || !accessKeySecret) throw new Error("Serverless Devs 凭据不完整。");
  return { accessKeyId, accessKeySecret, stsToken };
}

function safeObjectKey(value) {
  const key = String(value || "");
  if (!/^releases\/[A-Za-z0-9!_.*'()\-/]+$/.test(key) || key.includes("..")) throw new Error(`OSS 对象路径不安全：${key}`);
  return key;
}

function releaseSignaturePayload(release) {
  return JSON.stringify(["shuzhi-update-v1", String(release.version || ""), String(release.channel || "stable"), String(release.platform || ""), String(release.objectKey || ""), String(release.sha256 || "").toLowerCase(), Number(release.size), String(release.releaseNotes || ""), String(release.publishedAt || ""), release.mandatory === true, String(release.minSupportedVersion || "")]);
}

function compareVersion(left, right) {
  const parse = (value) => { const match = /^V?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(String(value || "")); return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null; };
  const a = parse(left), b = parse(right);
  if (!a || !b) throw new Error("发布版本号格式无效。");
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

function retentionPlan(objects, currentPackageKey, limit = 2) {
  const packagePattern = /^releases\/(V\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\/[^/]+\.zip$/i;
  const candidates = (Array.isArray(objects) ? objects : []).map((object) => {
    const name = String(object && object.name || "");
    const match = packagePattern.exec(name);
    return match ? { name, version: match[1], lastModified: String(object.lastModified || "") } : null;
  }).filter(Boolean).sort((left, right) => compareVersion(right.version, left.version) || right.lastModified.localeCompare(left.lastModified) || right.name.localeCompare(left.name));
  const keep = new Set([String(currentPackageKey)]);
  for (const candidate of candidates) {
    if (keep.size >= Math.max(1, Number(limit) || 2)) break;
    keep.add(candidate.name);
  }
  return {
    retained: candidates.filter((candidate) => keep.has(candidate.name)).map((candidate) => candidate.name),
    removed: candidates.filter((candidate) => !keep.has(candidate.name)).map((candidate) => candidate.name)
  };
}

async function cleanupOldPackages(client, currentPackageKey) {
  const listed = await client.listV2({ prefix: "releases/", "max-keys": 1000 });
  const plan = retentionPlan(listed.objects || [], currentPackageKey, 2);
  for (const objectKey of plan.removed) await client.delete(objectKey);
  return plan;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256"), descriptor = fs.openSync(file, "r"), buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

async function remoteSha256(client, objectKey) {
  const result = await client.getStream(objectKey);
  const hash = crypto.createHash("sha256"); let size = 0;
  await new Promise((resolve, reject) => {
    result.stream.on("data", (chunk) => { size += chunk.length; hash.update(chunk); });
    result.stream.on("end", resolve); result.stream.on("error", reject);
  });
  return { size, sha256: hash.digest("hex") };
}

async function main() {
  const bucket = String(process.argv[2] || "");
  const region = String(process.argv[3] || "");
  const packagePath = path.resolve(String(process.argv[4] || ""));
  const manifestPath = path.resolve(String(process.argv[5] || ""));
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^cn-[a-z0-9-]+$/.test(region)) throw new Error("Bucket 或地域格式无效。");
  if (!fs.statSync(packagePath).isFile() || !fs.statSync(manifestPath).isFile()) throw new Error("升级包或清单文件不存在。");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  const release = manifest && Array.isArray(manifest.releases) && manifest.releases[0];
  if (!release || manifest.schemaVersion !== 1 || release.channel !== "stable" || release.platform !== "win32-x64" || !/^V?\d+\.\d+\.\d+(?:[-+].*)?$/.test(String(release.version || "")) || !/^[a-f0-9]{64}$/i.test(String(release.sha256 || ""))) throw new Error("发布清单格式或字段无效。");
  const packageKey = safeObjectKey(release.objectKey);
  const manifestKey = "releases/current.json";
  const packageSize = fs.statSync(packagePath).size;
  if (Number(release.size) !== packageSize) throw new Error("发布清单中的文件大小与升级包不一致。");
  const packageSha256 = sha256File(packagePath);
  if (packageSha256 !== String(release.sha256).toLowerCase()) throw new Error("发布清单中的 SHA-256 与升级包不一致。");
  release.releaseNotes = String(release.releaseNotes || "").slice(0, 8000);
  release.minSupportedVersion = String(release.minSupportedVersion || "");
  release.mandatory = release.mandatory === true;

  const secretPath = path.join(__dirname, "deployment-secrets.json");
  const deploymentSecrets = JSON.parse(fs.readFileSync(secretPath, "utf8").replace(/^\uFEFF/, ""));
  if (!deploymentSecrets.privateKey) throw new Error("缺少用于签署更新清单的发行私钥。");
  release.signature = crypto.sign(null, Buffer.from(releaseSignaturePayload(release), "utf8"), deploymentSecrets.privateKey).toString("base64url");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { encoding: "utf8", mode: 0o600 });

  const credential = await serverlessCredential();
  const client = new OSS({ region: `oss-${region}`, bucket, accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret, stsToken: credential.stsToken || undefined, secure: true });
  try {
    const currentResult = await client.get(manifestKey);
    const currentManifest = JSON.parse(Buffer.from(currentResult.content).toString("utf8").replace(/^\uFEFF/, ""));
    const current = currentManifest && Array.isArray(currentManifest.releases) && currentManifest.releases[0];
    if (current && current.version) {
      const comparison = compareVersion(release.version, current.version);
      if (comparison < 0) throw new Error(`拒绝将当前版本从 ${current.version} 降级为 ${release.version}。`);
      if (comparison === 0 && (String(current.sha256).toLowerCase() !== packageSha256 || Number(current.size) !== packageSize || String(current.objectKey) !== packageKey)) throw new Error("同一版本号对应的升级包内容发生变化，请先提升版本号。");
    }
  } catch (error) {
    if (!/NoSuchKey|NoSuchObject|not exist/i.test(String(error && (error.code || error.message) || ""))) throw error;
  }
  const headers = { "x-oss-server-side-encryption": "AES256" };
  await client.multipartUpload(packageKey, packagePath, { parallel: 3, partSize: 5 * 1024 * 1024, headers });
  const uploaded = await client.head(packageKey);
  const remoteSize = Number(uploaded.res && uploaded.res.headers && uploaded.res.headers["content-length"] || 0);
  if (remoteSize !== packageSize) throw new Error("OSS 回读的升级包大小不一致，未发布清单。");
  const remoteIntegrity = await remoteSha256(client, packageKey);
  if (remoteIntegrity.size !== packageSize || remoteIntegrity.sha256 !== packageSha256) throw new Error("OSS 回读的升级包 SHA-256 不一致，未发布清单。");
  await client.put(manifestKey, manifestPath, { headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, headers) });
  const manifestHead = await client.head(manifestKey);
  const retention = await cleanupOldPackages(client, packageKey);
  console.log(JSON.stringify({ ok: true, bucket, region, packageKey, packageSize, manifestKey, manifestBytes: Number(manifestHead.res && manifestHead.res.headers && manifestHead.res.headers["content-length"] || 0), retainedPackageKeys: retention.retained, deletedPackageKeys: retention.removed }));
}

if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
else module.exports = { compareVersion, retentionPlan };
