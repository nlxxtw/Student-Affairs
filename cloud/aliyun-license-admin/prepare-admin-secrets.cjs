"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { hashPassword } = require("./auth");

async function main() {
  const username = String(process.argv[2] || "admin").trim();
  const password = String(process.env.SZ_LICENSE_ADMIN_PASSWORD || "");
  if (!/^[A-Za-z0-9_.@-]{3,80}$/.test(username)) throw new Error("管理员账号格式无效。");
  if (password.length < 12) throw new Error("管理员密码至少需要12个字符。");
  const output = {
    version: 2,
    createdAt: new Date().toISOString(),
    username,
    passwordHash: await hashPassword(password),
    sessionSecret: crypto.randomBytes(48).toString("base64url"),
    codeEncryptionKey: crypto.randomBytes(32).toString("base64url")
  };
  const target = path.join(__dirname, "admin-secrets.json");
  fs.writeFileSync(target, JSON.stringify(output, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log("Admin password security configuration created.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
