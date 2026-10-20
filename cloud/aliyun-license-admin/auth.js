"use strict";

const crypto = require("crypto");
const { promisify } = require("util");

const scryptAsync = promisify(crypto.scrypt);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (String(password || "").length < 12) throw new Error("管理员密码至少需要12个字符。");
  const derived = await scryptAsync(String(password), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${Buffer.from(salt).toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltText, expectedText] = parts;
  const expected = Buffer.from(expectedText, "base64url");
  const actual = await scryptAsync(String(password || ""), Buffer.from(saltText, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function base64urlJson(value) { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function signSession(payload, secret) {
  const encoded = base64urlJson(payload);
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
function verifySession(token, secret, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest("base64url");
  if (!safeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload.user || !payload.exp || now >= Number(payload.exp)) return null;
    return payload;
  } catch (_error) { return null; }
}
function parseCookies(value) {
  const output = {};
  for (const item of String(value || "").split(";")) {
    const index = item.indexOf("=");
    if (index > 0) output[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return output;
}
function sessionCookie(name, token, maxAgeSeconds) { return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`; }
function clearCookie(name) { return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`; }

class LoginLimiter {
  constructor() { this.entries = new Map(); }
  check(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || now >= entry.blockedUntil) return { allowed: true };
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) };
  }
  fail(key, now = Date.now()) {
    const old = this.entries.get(key) || { failures: [], blockedUntil: 0 };
    const failures = old.failures.filter((time) => now - time < 15 * 60 * 1000).concat(now);
    const blockedUntil = failures.length >= 5 ? now + 15 * 60 * 1000 : 0;
    this.entries.set(key, { failures, blockedUntil });
    return { failures: failures.length, blockedUntil };
  }
  success(key) { this.entries.delete(key); }
}

module.exports = { hashPassword, verifyPassword, signSession, verifySession, parseCookies, sessionCookie, clearCookie, LoginLimiter, safeEqual };
