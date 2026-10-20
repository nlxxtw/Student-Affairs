"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Ram = require(path.join(__dirname, ".deploy-tools", "node_modules", "@alicloud", "ram20150501"));
const OpenApiCore = require(path.join(__dirname, ".deploy-tools", "node_modules", "@alicloud", "openapi-core"));
const Dara = require(path.join(__dirname, ".deploy-tools", "node_modules", "@darabonba", "typescript"));
const yaml = require(path.join(__dirname, ".deploy-tools", "node_modules", "js-yaml"));
const CredentialModule = require(path.join(__dirname, ".deploy-tools", "node_modules", "@serverless-devs", "credential"));

const ACCESS_ALIAS = "shuzhi-xuegong-deploy";
const ROLE_NAME = "ShuzhiXuegongLicenseFcRole";
const POLICY_NAME = "ShuzhiXuegongLicenseTablestoreAccess";

async function serverlessCredential() {
  const accessFile = path.join(os.homedir(), ".s", "access.yaml");
  const all = yaml.load(fs.readFileSync(accessFile, "utf8")) || {};
  const encrypted = all[ACCESS_ALIAS];
  if (!encrypted) throw new Error(`Serverless Devs 中不存在凭据别名 ${ACCESS_ALIAS}。`);
  const Credential = CredentialModule.default || CredentialModule;
  const candidate = await new Credential().decrypt(encrypted);
  const accessKeyId = candidate.AccessKeyID || candidate.accessKeyID || candidate.accessKeyId;
  const accessKeySecret = candidate.AccessKeySecret || candidate.accessKeySecret;
  const accountId = String(candidate.AccountID || candidate.accountID || candidate.accountId || "");
  if (!accessKeyId || !accessKeySecret || !/^[0-9]{8,32}$/.test(accountId)) throw new Error("Serverless Devs 凭据缺少 AccountID 或 AccessKey。");
  return { accessKeyId, accessKeySecret, accountId };
}

function errorCode(error) {
  return String(error && (error.code || error.data && error.data.Code || error.message) || "");
}

function isMissing(error, kind) {
  return new RegExp(`EntityNotExist\\.${kind}|NoSuchEntity|not exist`, "i").test(errorCode(error));
}

async function main() {
  const region = String(process.argv[2] || "");
  const instance = String(process.argv[3] || "");
  const updateBucket = String(process.argv[4] || "");
  if (!/^[a-z0-9-]+$/.test(region) || !/^[a-z0-9-]+$/.test(instance) || (updateBucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(updateBucket))) throw new Error("用法：node provision-ram.cjs <region> <instance> [update-bucket]");
  const credential = await serverlessCredential();
  const config = new OpenApiCore.$OpenApiUtil.Config({ accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret, endpoint: "ram.aliyuncs.com" });
  const client = new Ram.default(config);
  const runtime = new Dara.RuntimeOptions({ readTimeout: 10000, connectTimeout: 10000, autoretry: true, maxAttempts: 3 });
  let roleArn = "", roleCreated = false, policyCreated = false, policyUpdated = false;
  try {
    const response = await client.getRoleWithOptions(new Ram.GetRoleRequest({ roleName: ROLE_NAME }), runtime);
    roleArn = response.body && response.body.role && response.body.role.arn || "";
  } catch (error) {
    if (!isMissing(error, "Role")) throw error;
    const trust = { Version: "1", Statement: [{ Effect: "Allow", Action: "sts:AssumeRole", Principal: { Service: ["fc.aliyuncs.com"] } }] };
    const response = await client.createRoleWithOptions(new Ram.CreateRoleRequest({ roleName: ROLE_NAME, description: "数智学工授权云函数访问指定 Tablestore 表", assumeRolePolicyDocument: JSON.stringify(trust), maxSessionDuration: 3600 }), runtime);
    roleArn = response.body && response.body.role && response.body.role.arn || "";
    roleCreated = true;
  }
  const statements = [{ Effect: "Allow", Action: ["ots:GetRow", "ots:PutRow", "ots:UpdateRow"], Resource: `acs:ots:${region}:${credential.accountId}:instance/${instance}/table/shuzhi_licenses` }];
  if (updateBucket) statements.push({ Effect: "Allow", Action: ["oss:GetObject"], Resource: `acs:oss:*:*:${updateBucket}/releases/*` });
  const policyDocument = { Version: "1", Statement: statements };
  try {
    const current = await client.getPolicyWithOptions(new Ram.GetPolicyRequest({ policyName: POLICY_NAME, policyType: "Custom" }), runtime);
    const existingText = current.body && current.body.defaultPolicyVersion && current.body.defaultPolicyVersion.policyDocument || "";
    let existing = null;
    try { existing = JSON.parse(decodeURIComponent(existingText)); } catch (_error) { try { existing = JSON.parse(existingText); } catch (_ignored) {} }
    if (JSON.stringify(existing) !== JSON.stringify(policyDocument)) {
      await client.createPolicyVersionWithOptions(new Ram.CreatePolicyVersionRequest({ policyName: POLICY_NAME, policyDocument: JSON.stringify(policyDocument), setAsDefault: true, rotateStrategy: "DeleteOldestNonDefaultVersionWhenLimitExceeded" }), runtime);
      policyUpdated = true;
    }
  } catch (error) {
    if (!isMissing(error, "Policy")) throw error;
    await client.createPolicyWithOptions(new Ram.CreatePolicyRequest({ policyName: POLICY_NAME, description: "仅允许数智学工授权函数读写指定授权表", policyDocument: JSON.stringify(policyDocument) }), runtime);
    policyCreated = true;
  }
  try {
    await client.attachPolicyToRoleWithOptions(new Ram.AttachPolicyToRoleRequest({ roleName: ROLE_NAME, policyName: POLICY_NAME, policyType: "Custom" }), runtime);
  } catch (error) {
    if (!/EntityAlreadyExists\.Role\.Policy/i.test(errorCode(error))) throw error;
  }
  if (!/^acs:ram::\d+:role\//.test(roleArn)) throw new Error("RAM 执行角色创建后未返回有效 ARN。");
  console.log(JSON.stringify({ ok: true, roleArn, roleCreated, policyCreated, policyUpdated, policyName: POLICY_NAME, updateBucket: updateBucket || null }));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: errorCode(error), error: error.message })); process.exitCode = 1; });
