"use strict";

const crypto = require("crypto");
const TableStore = require("tablestore");
const { LicenseService, apiError } = require("./license-core");
const { TablestoreLicenseRepository } = require("./tablestore-repository");
const { UpdateReleaseService } = require("./update-release");

const attempts = new Map();

function json(statusCode, value) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, body: JSON.stringify(value) };
}

function parseEvent(event) {
  const input = typeof event === "string" || Buffer.isBuffer(event) ? JSON.parse(String(event || "{}")) : (event || {});
  let body = {};
  if (input.body) {
    const raw = input.isBase64Encoded ? Buffer.from(input.body, "base64").toString("utf8") : String(input.body);
    try { body = raw ? JSON.parse(raw) : {}; } catch (_error) { throw apiError(400, "INVALID_JSON", "请求格式错误。"); }
  }
  const headers = {};
  for (const [key, value] of Object.entries(input.headers || {})) headers[key.toLowerCase()] = value;
  return { method: String(input.requestContext && input.requestContext.http && input.requestContext.http.method || input.httpMethod || input.method || "GET").toUpperCase(), path: String(input.rawPath || input.path || "/"), headers, body, sourceIp: String(input.requestContext && input.requestContext.http && input.requestContext.http.sourceIp || input.requestContext && input.requestContext.identity && input.requestContext.identity.sourceIp || "unknown") };
}

function privateKeyPem() {
  if (process.env.LICENSE_PRIVATE_KEY_B64) return Buffer.from(process.env.LICENSE_PRIVATE_KEY_B64, "base64").toString("utf8");
  return String(process.env.LICENSE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}
function sha256(value) { return crypto.createHash("sha256").update(String(value), "utf8").digest("hex"); }

function rateLimit(request) {
  const bearer = String(request.headers && request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const identity = bearer ? `token:${sha256(bearer).slice(0, 24)}` : `ip:${request.sourceIp}`;
  const key = `${identity}:${request.path}`;
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((time) => now - time < 60 * 1000);
  if (recent.length >= 30) throw apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。");
  recent.push(now); attempts.set(key, recent);
  const aggregateKey = `ip-total:${request.sourceIp}`;
  const aggregate = (attempts.get(aggregateKey) || []).filter((time) => now - time < 60 * 1000);
  if (aggregate.length >= 300) throw apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。");
  aggregate.push(now); attempts.set(aggregateKey, aggregate);
  if (attempts.size > 1000) for (const [item, values] of attempts) if (!values.some((time) => now - time < 60 * 1000)) attempts.delete(item);
}

function serviceFor(context) {
  const endpoint = process.env.TABLESTORE_ENDPOINT;
  const instancename = process.env.TABLESTORE_INSTANCE;
  const credentials = context && context.credentials || {};
  if (!endpoint || !instancename) throw new Error("TABLESTORE_ENDPOINT 和 TABLESTORE_INSTANCE 必须配置。");
  const client = new TableStore.Client({
    accessKeyId: credentials.accessKeyId || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    secretAccessKey: credentials.accessKeySecret || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    stsToken: credentials.securityToken || process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
    endpoint,
    instancename
  });
  return new LicenseService({
    repository: new TablestoreLicenseRepository(TableStore, client, process.env.TABLESTORE_LICENSE_TABLE || "shuzhi_licenses"),
    pepper: process.env.LICENSE_CODE_PEPPER,
    privateKey: privateKeyPem(),
    defaultProduct: process.env.LICENSE_PRODUCT || "shuzhi-xuegong",
    verifyIntervalHours: Number(process.env.LICENSE_VERIFY_HOURS || 72),
    offlineGraceDays: Number(process.env.LICENSE_OFFLINE_DAYS || 180)
  });
}

function updateServiceFor(context, service) {
  return new UpdateReleaseService({
    licenseService: service,
    bucket: process.env.UPDATE_OSS_BUCKET || "",
    region: process.env.UPDATE_OSS_REGION || "cn-hangzhou",
    manifestKey: process.env.UPDATE_MANIFEST_KEY || "releases/current.json",
    credentials: context && context.credentials || {}
  });
}

async function applicationHandler(event, context) {
  try {
    const request = parseEvent(event);
    rateLimit(request);
    if (request.method === "GET" && request.path === "/health") return json(200, { ok: true, service: "shuzhi-license", features: ["legacy-issuance-retired-v1"], time: Date.now() });
    if (request.method === "POST" && request.path === "/v1/admin/licenses") return json(410, { code: "LEGACY_ISSUANCE_RETIRED", error: "旧版授权生成接口已永久停用，请使用授权管理平台生成激活码。" });
    const service = serviceFor(context);
    if (request.method === "POST" && request.path === "/v1/licenses/activate") return json(200, await service.activate(request.body));
    const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (request.method === "POST" && request.path === "/v1/licenses/verify") return json(200, await service.verify(request.body, bearer));
    if (request.method === "POST" && request.path === "/v1/licenses/deactivate") return json(200, await service.deactivate(request.body, bearer));
    if (request.method === "POST" && request.path === "/v1/updates/check") return json(200, await updateServiceFor(context, service).check(request.body, bearer));
    return json(404, { code: "NOT_FOUND", error: "接口不存在。" });
  } catch (error) {
    console.error(JSON.stringify({ message: error.message, code: error.code || "INTERNAL_ERROR", requestId: context && context.requestId }));
    const status = Number(error.statusCode) || 500;
    return json(status, { code: error.code || "INTERNAL_ERROR", error: status >= 500 ? "授权服务暂时不可用。" : error.message });
  }
}

exports.handler = applicationHandler;
exports.applicationHandler = applicationHandler;
