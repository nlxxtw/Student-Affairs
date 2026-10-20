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
const ROLE_NAME = "ShuzhiXuegongLicenseAdminFcRole";
const POLICY_NAME = "ShuzhiXuegongLicenseAdminTablestoreAccess";

async function serverlessCredential() {
  const all = yaml.load(fs.readFileSync(path.join(os.homedir(), ".s", "access.yaml"), "utf8")) || {};
  const encrypted = all[ACCESS_ALIAS];
  if (!encrypted) throw new Error(`Serverless Devs 中不存在凭据别名 ${ACCESS_ALIAS}。`);
  const Credential = CredentialModule.default || CredentialModule;
  const candidate = await new Credential().decrypt(encrypted);
  const accountId = String(candidate.AccountID || "");
  if (!candidate.AccessKeyID || !candidate.AccessKeySecret || !/^[0-9]{8,32}$/.test(accountId)) throw new Error("Serverless Devs 部署凭据不完整。");
  return { accessKeyId: candidate.AccessKeyID, accessKeySecret: candidate.AccessKeySecret, accountId };
}
function errorCode(error) { return String(error && (error.code || error.data && error.data.Code || error.message) || ""); }
function isMissing(error, kind) { return new RegExp(`EntityNotExist\\.${kind}|NoSuchEntity|not exist`, "i").test(errorCode(error)); }

async function main() {
  const region = String(process.argv[2] || "");
  const instance = String(process.argv[3] || "");
  if (!/^[a-z0-9-]+$/.test(region) || !/^[a-z0-9-]+$/.test(instance)) throw new Error("用法：node provision-admin-ram.cjs <region> <instance>");
  const credential = await serverlessCredential();
  const client = new Ram.default(new OpenApiCore.$OpenApiUtil.Config({ accessKeyId: credential.accessKeyId, accessKeySecret: credential.accessKeySecret, endpoint: "ram.aliyuncs.com" }));
  const runtime = new Dara.RuntimeOptions({ readTimeout: 10000, connectTimeout: 10000, autoretry: true, maxAttempts: 3 });
  let roleArn = "", roleCreated = false, policyCreated = false, policyUpdated = false;
  try {
    const response = await client.getRoleWithOptions(new Ram.GetRoleRequest({ roleName: ROLE_NAME }), runtime);
    roleArn = response.body && response.body.role && response.body.role.arn || "";
  } catch (error) {
    if (!isMissing(error, "Role")) throw error;
    const trust = { Version: "1", Statement: [{ Effect: "Allow", Action: "sts:AssumeRole", Principal: { Service: ["fc.aliyuncs.com"] } }] };
    const response = await client.createRoleWithOptions(new Ram.CreateRoleRequest({ roleName: ROLE_NAME, description: "数智学工独立授权管理后台访问授权与审计表", assumeRolePolicyDocument: JSON.stringify(trust), maxSessionDuration: 3600 }), runtime);
    roleArn = response.body && response.body.role && response.body.role.arn || "";
    roleCreated = true;
  }
  const licenseResource = `acs:ots:${region}:${credential.accountId}:instance/${instance}/table/shuzhi_licenses`;
  const auditResource = `acs:ots:${region}:${credential.accountId}:instance/${instance}/table/shuzhi_license_audit`;
  const policyDocument = { Version: "1", Statement: [{ Effect: "Allow", Action: ["ots:GetRange", "ots:PutRow", "ots:UpdateRow", "ots:DeleteRow"], Resource: [licenseResource, auditResource] }] };
  try {
    await client.getPolicyWithOptions(new Ram.GetPolicyRequest({ policyName: POLICY_NAME, policyType: "Custom" }), runtime);
    await client.createPolicyVersionWithOptions(new Ram.CreatePolicyVersionRequest({
      policyName: POLICY_NAME,
      policyDocument: JSON.stringify(policyDocument),
      setAsDefault: true,
      rotateStrategy: "DeleteOldestNonDefaultVersionWhenLimitExceeded"
    }), runtime);
    policyUpdated = true;
  } catch (error) {
    if (!isMissing(error, "Policy")) throw error;
    await client.createPolicyWithOptions(new Ram.CreatePolicyRequest({ policyName: POLICY_NAME, description: "仅允许授权管理后台读写指定授权表和审计表", policyDocument: JSON.stringify(policyDocument) }), runtime);
    policyCreated = true;
  }
  try {
    await client.attachPolicyToRoleWithOptions(new Ram.AttachPolicyToRoleRequest({ roleName: ROLE_NAME, policyName: POLICY_NAME, policyType: "Custom" }), runtime);
  } catch (error) {
    if (!/EntityAlreadyExists\.Role\.Policy|already.*attached/i.test(errorCode(error))) throw error;
  }
  if (!/^acs:ram::[0-9]+:role\//.test(roleArn)) throw new Error("RAM 管理执行角色创建后未返回有效 ARN。");
  console.log(JSON.stringify({ ok: true, roleArn, roleCreated, policyCreated, policyUpdated, policyName: POLICY_NAME }));
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: errorCode(error), error: error.message })); process.exitCode = 1; });
