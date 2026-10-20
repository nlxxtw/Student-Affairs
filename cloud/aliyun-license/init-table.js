"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const TableStore = require("tablestore");

async function loadCredential() {
  if (process.env.ALIBABA_CLOUD_ACCESS_KEY_ID && process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET) {
    return { accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID, accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET };
  }
  const tools = path.join(__dirname, ".deploy-tools", "node_modules");
  const yaml = require(path.join(tools, "js-yaml"));
  const CredentialModule = require(path.join(tools, "@serverless-devs", "credential"));
  const all = yaml.load(fs.readFileSync(path.join(os.homedir(), ".s", "access.yaml"), "utf8")) || {};
  const encrypted = all[process.env.SERVERLESS_DEVS_ACCESS || "shuzhi-xuegong-deploy"];
  if (!encrypted) throw new Error("找不到 Serverless Devs 部署凭据。");
  const Credential = CredentialModule.default || CredentialModule;
  const value = await new Credential().decrypt(encrypted);
  return { accessKeyId: value.AccessKeyID, accessKeySecret: value.AccessKeySecret };
}

async function main() {
  const endpoint = process.env.TABLESTORE_ENDPOINT || process.argv[2];
  const instancename = process.env.TABLESTORE_INSTANCE || process.argv[3];
  if (!/^https:\/\/[a-z0-9.-]+$/.test(String(endpoint || "")) || !/^[a-z0-9-]+$/.test(String(instancename || ""))) {
    throw new Error("用法：node init-table.js <TableStore Endpoint> <实例名称>");
  }
  const credential = await loadCredential();
  if (!credential.accessKeyId || !credential.accessKeySecret) throw new Error("部署凭据不完整。");
  const client = new TableStore.Client({ accessKeyId: credential.accessKeyId, secretAccessKey: credential.accessKeySecret, endpoint, instancename });
  const tableName = process.env.TABLESTORE_LICENSE_TABLE || "shuzhi_licenses";
  const params = {
    tableMeta: { tableName, primaryKey: [{ name: "license_hash", type: "STRING" }] },
    tableOptions: { timeToLive: -1, maxVersions: 1 },
    reservedThroughput: { capacityUnit: { read: 0, write: 0 } }
  };
  await new Promise((resolve, reject) => client.createTable(params, (error) => {
    if (error && !/TableAlreadyExist|OTSObjectAlreadyExist/i.test(String(error.code || error.message))) return reject(error);
    console.log(error ? `数据表 ${tableName} 已存在。` : `数据表 ${tableName} 创建成功。`);
    resolve();
  }));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: error.code || "", error: error.message })); process.exitCode = 1; });
