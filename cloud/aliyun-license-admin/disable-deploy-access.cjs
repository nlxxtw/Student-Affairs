"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const tools = path.join(__dirname, "..", "aliyun-license", ".deploy-tools", "node_modules");
const Ram = require(path.join(tools, "@alicloud", "ram20150501"));
const OpenApiCore = require(path.join(tools, "@alicloud", "openapi-core"));
const Dara = require(path.join(tools, "@darabonba", "typescript"));
const yaml = require(path.join(tools, "js-yaml"));
const CredentialModule = require(path.join(tools, "@serverless-devs", "credential"));

const ACCESS_ALIAS = "shuzhi-xuegong-deploy";
const USER_NAME = "shuzhi-xuegong-deploy";

async function main() {
  const accessFile = path.join(os.homedir(), ".s", "access.yaml");
  const all = yaml.load(fs.readFileSync(accessFile, "utf8")) || {};
  const encrypted = all[ACCESS_ALIAS];
  if (!encrypted) throw new Error(`Serverless Devs 中不存在凭据别名 ${ACCESS_ALIAS}。`);
  const Credential = CredentialModule.default || CredentialModule;
  const credential = await new Credential().decrypt(encrypted);
  if (!credential.AccessKeyID || !credential.AccessKeySecret) throw new Error("临时部署凭据不完整。");

  const client = new Ram.default(new OpenApiCore.$OpenApiUtil.Config({
    accessKeyId: credential.AccessKeyID,
    accessKeySecret: credential.AccessKeySecret,
    endpoint: "ram.aliyuncs.com"
  }));
  const runtime = new Dara.RuntimeOptions({ readTimeout: 10000, connectTimeout: 10000, autoretry: true, maxAttempts: 3 });
  const response = await client.listAccessKeysWithOptions(new Ram.ListAccessKeysRequest({ userName: USER_NAME }), runtime);
  const keys = response.body && response.body.accessKeys && response.body.accessKeys.accessKey || [];
  if (!keys.some((item) => item.accessKeyId === credential.AccessKeyID)) throw new Error("当前部署密钥不属于预期的临时 RAM 用户，已停止清理。");
  await client.updateAccessKeyWithOptions(new Ram.UpdateAccessKeyRequest({ userName: USER_NAME, userAccessKeyId: credential.AccessKeyID, status: "Inactive" }), runtime);
  console.log(JSON.stringify({ ok: true, userName: USER_NAME, accessKeyDisabled: true }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: String(error.code || ""), error: error.message }));
  process.exitCode = 1;
});
