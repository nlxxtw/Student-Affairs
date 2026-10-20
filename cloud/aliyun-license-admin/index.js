"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const TableStore = require("tablestore");
const { LicenseAdminService, apiError } = require("./admin-core");
const { TablestoreAdminRepository, TablestoreAuditRepository } = require("./tablestore-admin-repository");
const { verifyPassword, signSession, verifySession, parseCookies, sessionCookie, clearCookie, LoginLimiter, safeEqual } = require("./auth");

const COOKIE_NAME = "sz_license_admin";
const SESSION_MS = 30 * 60 * 1000;
const loginLimiter = new LoginLimiter();
const apiAttempts = new Map();
let cachedService = null;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

function response(statusCode, body, contentType, headers = {}) {
  return { statusCode, headers: Object.assign({}, SECURITY_HEADERS, { "Content-Type": contentType }, headers), body };
}
function json(statusCode, value, headers) { return response(statusCode, JSON.stringify(value), "application/json; charset=utf-8", headers); }
function text(statusCode, value, contentType, headers) { return response(statusCode, value, contentType || "text/plain; charset=utf-8", headers); }

function parseEvent(event) {
  const input = typeof event === "string" || Buffer.isBuffer(event) ? JSON.parse(String(event || "{}")) : (event || {});
  const rawBody = input.body ? (input.isBase64Encoded ? Buffer.from(input.body, "base64").toString("utf8") : String(input.body)) : "";
  if (Buffer.byteLength(rawBody, "utf8") > 1024 * 1024) throw apiError(413, "BODY_TOO_LARGE", "请求内容过大。");
  let body = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch (_error) { throw apiError(400, "INVALID_JSON", "请求格式错误。"); }
  const headers = {};
  for (const [key, value] of Object.entries(input.headers || {})) headers[String(key).toLowerCase()] = String(value);
  const rawPath = String(input.rawPath || input.path || "/");
  const queryText = String(input.rawQueryString || "");
  const url = new URL(`${rawPath}${queryText ? `?${queryText}` : ""}`, "https://license-admin.invalid");
  return {
    method: String(input.requestContext && input.requestContext.http && input.requestContext.http.method || input.httpMethod || input.method || "GET").toUpperCase(),
    path: url.pathname,
    query: url.searchParams,
    headers,
    body,
    sourceIp: String(input.requestContext && input.requestContext.http && input.requestContext.http.sourceIp || input.requestContext && input.requestContext.identity && input.requestContext.identity.sourceIp || "unknown"),
    requestId: String(input.requestContext && input.requestContext.requestId || input.requestContext && input.requestContext.http && input.requestContext.http.requestId || input.requestId || "")
  };
}

function rateLimit(request) {
  const key = `${request.sourceIp}:${request.path}`;
  const now = Date.now();
  const recent = (apiAttempts.get(key) || []).filter((time) => now - time < 60000);
  if (recent.length >= 120) throw apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试。");
  recent.push(now); apiAttempts.set(key, recent);
  if (apiAttempts.size > 2000) for (const [item, values] of apiAttempts) if (!values.some((time) => now - time < 60000)) apiAttempts.delete(item);
}

function requiredEnvironment() {
  const config = {
    username: String(process.env.ADMIN_USERNAME || "admin"),
    passwordHash: String(process.env.ADMIN_PASSWORD_HASH || ""),
    sessionSecret: String(process.env.ADMIN_SESSION_SECRET || ""),
    pepper: String(process.env.LICENSE_CODE_PEPPER || ""),
    codeEncryptionKey: String(process.env.LICENSE_CODE_ENCRYPTION_KEY || "")
  };
  let codeKeyBytes = Buffer.alloc(0);
  try { codeKeyBytes = Buffer.from(config.codeEncryptionKey, "base64url"); } catch (_error) {}
  if (!config.passwordHash || config.sessionSecret.length < 32 || !config.pepper || codeKeyBytes.length !== 32) throw new Error("授权管理后台安全配置不完整。");
  return config;
}

function serviceFor(context) {
  if (cachedService) return cachedService;
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
  cachedService = new LicenseAdminService({
    repository: new TablestoreAdminRepository(TableStore, client, process.env.TABLESTORE_LICENSE_TABLE || "shuzhi_licenses"),
    auditRepository: new TablestoreAuditRepository(TableStore, client, process.env.TABLESTORE_AUDIT_TABLE || "shuzhi_license_audit"),
    pepper: requiredEnvironment().pepper,
    codeEncryptionKey: requiredEnvironment().codeEncryptionKey,
    product: process.env.LICENSE_PRODUCT || "shuzhi-xuegong"
  });
  return cachedService;
}

function sessionFor(request, config) {
  const token = parseCookies(request.headers.cookie || "")[COOKIE_NAME];
  return verifySession(token, config.sessionSecret);
}
function requireSession(request, config) {
  const session = sessionFor(request, config);
  if (!session) throw apiError(401, "ADMIN_LOGIN_REQUIRED", "管理员登录已失效，请重新登录。");
  return session;
}
function requireCsrf(request, session) {
  if (!safeEqual(request.headers["x-csrf-token"] || "", session.csrf || "")) throw apiError(403, "CSRF_REJECTED", "安全校验失败，请刷新页面后重试。");
}

function staticAsset(pathname) {
  const assets = {
    "/admin": ["admin.html", "text/html; charset=utf-8"],
    "/admin/": ["admin.html", "text/html; charset=utf-8"],
    "/admin/admin.js": ["admin.js", "application/javascript; charset=utf-8"],
    "/admin/admin.css": ["admin.css", "text/css; charset=utf-8"]
  };
  const item = assets[pathname];
  if (!item) return null;
  return text(200, fs.readFileSync(path.join(__dirname, "public", item[0]), "utf8"), item[1], { "Cache-Control": item[0] === "admin.html" ? "no-store" : "private, max-age=300" });
}

function csvEscape(value) {
  const textValue = String(value === null || value === undefined ? "" : value);
  return /[",\r\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}
function licensesCsv(licenses) {
  const rows = [["授权编号", "激活码保存状态", "客户姓名", "小红书ID", "微信名或微信号", "状态", "设备上限", "已绑定设备", "到期时间", "备注", "创建时间", "更新时间"]];
  for (const item of licenses) rows.push([item.id, item.codeAvailable ? "可在后台显示" : "旧接口生成，已强制停用", item.customerName || item.customer, item.customerXhsId, item.customerWechat, item.status, item.maxDevices, item.activeDevices, item.expiresAt ? new Date(item.expiresAt).toISOString() : "", item.note, item.createdAt ? new Date(item.createdAt).toISOString() : "", item.updatedAt ? new Date(item.updatedAt).toISOString() : ""]);
  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
}

async function applicationHandler(event, context, overrides = {}) {
  try {
    const directInput = typeof event === "string" || Buffer.isBuffer(event) ? JSON.parse(String(event || "{}")) : (event || {});
    if (!directInput.requestContext && !directInput.httpMethod && directInput.maintenanceAction) {
      const service = overrides.service || serviceFor(context);
      const requestId = String(context && context.requestId || directInput.requestId || crypto.randomUUID());
      if (directInput.maintenanceAction === "inspect-unrecoverable") return await service.unrecoverableSummary();
      if (directInput.maintenanceAction === "revoke-unrecoverable") return await service.forceRevokeUnrecoverable("deployment-maintenance", "direct-fc-invoke", requestId);
      throw apiError(400, "UNKNOWN_MAINTENANCE_ACTION", "未知的维护操作。");
    }
    const request = parseEvent(event);
    rateLimit(request);
    if (request.method === "GET" && request.path === "/health") return json(200, { ok: true, service: "shuzhi-license-admin", features: ["customer-contacts-v1", "encrypted-code-display-v1", "license-delete-v1", "legacy-code-forced-revocation-v1", "issuance-audit-v1"], time: Date.now() });
    if (request.method === "GET") {
      const asset = staticAsset(request.path);
      if (asset) return asset;
    }
    const config = overrides.config || requiredEnvironment();
    const service = overrides.service || serviceFor(context);
    if (request.method === "POST" && request.path === "/v1/admin/login") {
      const limit = loginLimiter.check(request.sourceIp);
      if (!limit.allowed) return json(429, { code: "LOGIN_LOCKED", error: "登录失败次数过多，请15分钟后重试。" }, { "Retry-After": String(limit.retryAfter) });
      const usernameOk = safeEqual(String(request.body.username || ""), config.username);
      const passwordOk = usernameOk && await verifyPassword(request.body.password, config.passwordHash);
      if (!usernameOk || !passwordOk) {
        loginLimiter.fail(request.sourceIp);
        await service.audit("ADMIN_LOGIN_FAILED", String(request.body.username || "").slice(0, 80), request.sourceIp, "", {});
        return json(401, { code: "LOGIN_FAILED", error: "账号或密码错误。" });
      }
      loginLimiter.success(request.sourceIp);
      const now = Date.now();
      const csrf = crypto.randomBytes(24).toString("base64url");
      const token = signSession({ user: config.username, csrf, iat: now, exp: now + SESSION_MS, jti: crypto.randomUUID() }, config.sessionSecret);
      await service.audit("ADMIN_LOGIN_SUCCESS", config.username, request.sourceIp, "", {});
      return json(200, { ok: true, user: config.username, csrf, expiresAt: now + SESSION_MS }, { "Set-Cookie": sessionCookie(COOKIE_NAME, token, Math.floor(SESSION_MS / 1000)) });
    }
    const session = requireSession(request, config);
    if (request.method === "GET" && request.path === "/v1/admin/me") return json(200, { authenticated: true, user: session.user, csrf: session.csrf, expiresAt: session.exp });
    if (request.method === "POST" && request.path === "/v1/admin/logout") {
      requireCsrf(request, session);
      await service.audit("ADMIN_LOGOUT", session.user, request.sourceIp, "", {});
      return json(200, { ok: true }, { "Set-Cookie": clearCookie(COOKIE_NAME) });
    }
    if (request.method === "GET" && request.path === "/v1/admin/licenses") return json(200, await service.list({ query: request.query.get("query"), status: request.query.get("status") }));
    if (request.method === "GET" && request.path === "/v1/admin/licenses/export.csv") {
      const result = await service.list({ query: request.query.get("query"), status: request.query.get("status") });
      return text(200, licensesCsv(result.licenses), "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="license-metadata-${new Date().toISOString().slice(0, 10)}.csv"` });
    }
    if (request.method === "GET" && request.path === "/v1/admin/audit") return json(200, await service.auditList(request.query.get("limit")));
    if (request.method === "POST" && request.path === "/v1/admin/licenses/batch") {
      requireCsrf(request, session);
      return json(201, await service.createBatch(request.body, session.user, request.sourceIp, request.requestId));
    }
    let match = request.path.match(/^\/v1\/admin\/licenses\/(lic_[a-f0-9]{16})$/i);
    if (request.method === "PATCH" && match) {
      requireCsrf(request, session);
      return json(200, await service.update(match[1], request.body, session.user, request.sourceIp));
    }
    if (request.method === "DELETE" && match) {
      requireCsrf(request, session);
      return json(200, await service.deleteLicense(match[1], session.user, request.sourceIp));
    }
    match = request.path.match(/^\/v1\/admin\/licenses\/(lic_[a-f0-9]{16})\/code\/reveal$/i);
    if (request.method === "POST" && match) {
      requireCsrf(request, session);
      return json(200, await service.revealCode(match[1], session.user, request.sourceIp));
    }
    match = request.path.match(/^\/v1\/admin\/licenses\/(lic_[a-f0-9]{16})\/(revoke|restore)$/i);
    if (request.method === "POST" && match) {
      requireCsrf(request, session);
      return json(200, await service.setStatus(match[1], match[2].toLowerCase() === "revoke" ? "revoked" : "active", session.user, request.sourceIp));
    }
    match = request.path.match(/^\/v1\/admin\/licenses\/(lic_[a-f0-9]{16})\/devices\/(\d+)\/deactivate$/i);
    if (request.method === "POST" && match) {
      requireCsrf(request, session);
      return json(200, await service.deactivateDevice(match[1], Number(match[2]), session.user, request.sourceIp));
    }
    return json(404, { code: "NOT_FOUND", error: "接口不存在。" });
  } catch (error) {
    console.error(JSON.stringify({ message: error.message, code: error.code || "INTERNAL_ERROR", requestId: context && context.requestId }));
    const status = Number(error.statusCode) || 500;
    return json(status, { code: error.code || "INTERNAL_ERROR", error: status >= 500 ? "授权管理服务暂时不可用。" : error.message });
  }
}

exports.handler = applicationHandler;
exports.applicationHandler = applicationHandler;
exports.parseEvent = parseEvent;
exports.licensesCsv = licensesCsv;
