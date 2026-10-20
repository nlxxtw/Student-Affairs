"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const TableStore = require("tablestore");

async function loadCredential() {
  const tools = path.join(__dirname, "..", "aliyun-license", ".deploy-tools", "node_modules");
  const yaml = require(path.join(tools, "js-yaml"));
  const CredentialModule = require(path.join(tools, "@serverless-devs", "credential"));
  const all = yaml.load(fs.readFileSync(path.join(os.homedir(), ".s", "access.yaml"), "utf8")) || {};
  const encrypted = all["shuzhi-xuegong-deploy"];
  if (!encrypted) throw new Error("找不到 Serverless Devs 临时部署凭据。");
  const Credential = CredentialModule.default || CredentialModule;
  const value = await new Credential().decrypt(encrypted);
  return { accessKeyId: value.AccessKeyID, accessKeySecret: value.AccessKeySecret };
}

async function main() {
  const endpoint = String(process.argv[2] || "");
  const instancename = String(process.argv[3] || "");
  if (!/^https:\/\/[a-z0-9.-]+$/.test(endpoint) || !/^[a-z0-9-]+$/.test(instancename)) throw new Error("用法：node init-admin-table.js <TableStore Endpoint> <实例名称>");
  const credential = await loadCredential();
  const client = new TableStore.Client({ accessKeyId: credential.accessKeyId, secretAccessKey: credential.accessKeySecret, endpoint, instancename });
  const params = {
    tableMeta: { tableName: "shuzhi_license_audit", primaryKey: [{ name: "event_key", type: "STRING" }] },
    tableOptions: { timeToLive: -1, maxVersions: 1 },
    reservedThroughput: { capacityUnit: { read: 0, write: 0 } }
  };
  await new Promise((resolve, reject) => client.createTable(params, (error) => {
    if (error && !/TableAlreadyExist|OTSObjectAlreadyExist/i.test(String(error.code || error.message))) return reject(error);
    console.log(error ? "审计表 shuzhi_license_audit 已存在。" : "审计表 shuzhi_license_audit 创建成功。"); resolve();
  }));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: error.code || "", error: error.message })); process.exitCode = 1; });
