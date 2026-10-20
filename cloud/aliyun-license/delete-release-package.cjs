"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const OSS = require(path.join(__dirname, ".deploy-tools", "node_modules", "ali-oss"));
const CredentialModule = require(path.join(__dirname, ".deploy-tools", "node_modules", "@serverless-devs", "credential"));
const yaml = require(path.join(__dirname, ".deploy-tools", "node_modules", "js-yaml"));

async function credentials() {
  const all = yaml.load(fs.readFileSync(path.join(os.homedir(), ".s", "access.yaml"), "utf8")) || {};
  const encrypted = all["shuzhi-xuegong-deploy"];
  if (!encrypted) throw new Error("缺少发布凭据 shuzhi-xuegong-deploy。");
  const Credential = CredentialModule.default || CredentialModule;
  const value = await new Credential().decrypt(encrypted);
  const accessKeyId = value.AccessKeyID || value.accessKeyID || value.accessKeyId;
  const accessKeySecret = value.AccessKeySecret || value.accessKeySecret;
  const stsToken = value.SecurityToken || value.securityToken || value.stsToken;
  if (!accessKeyId || !accessKeySecret) throw new Error("发布凭据不完整。");
  return { accessKeyId, accessKeySecret, stsToken };
}

async function main() {
  const bucket = String(process.argv[2] || ""), region = String(process.argv[3] || ""), objectKey = String(process.argv[4] || "");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^cn-[a-z0-9-]+$/.test(region)) throw new Error("Bucket 或地域格式无效。");
  if (!/^releases\/V\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\/[^/]+\.zip$/.test(objectKey) || objectKey.includes("..")) throw new Error("只允许删除指定版本目录中的 ZIP 升级包。");
  const auth = await credentials();
  const client = new OSS({ region: `oss-${region}`, bucket, accessKeyId: auth.accessKeyId, accessKeySecret: auth.accessKeySecret, stsToken: auth.stsToken || undefined, secure: true });
  const currentResult = await client.get("releases/current.json");
  const currentManifest = JSON.parse(Buffer.from(currentResult.content).toString("utf8").replace(/^\uFEFF/, ""));
  const current = currentManifest && Array.isArray(currentManifest.releases) && currentManifest.releases[0];
  if (current && current.objectKey === objectKey) throw new Error("拒绝删除 current.json 当前指向的升级包。");
  await client.head(objectKey);
  await client.delete(objectKey);
  const listed = await client.listV2({ prefix: "releases/", "max-keys": 1000 });
  const packages = (listed.objects || []).map((item) => String(item.name || "")).filter((name) => /\.zip$/i.test(name));
  if (packages.includes(objectKey)) throw new Error("升级包删除后仍可在 OSS 列表中发现。");
  console.log(JSON.stringify({ ok: true, deletedPackageKey: objectKey, currentVersion: current && current.version || "", currentObjectKey: current && current.objectKey || "", remainingPackageKeys: packages }));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
