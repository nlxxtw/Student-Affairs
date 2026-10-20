"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "admin-secrets.json");
const value = JSON.parse(fs.readFileSync(target, "utf8"));
const rotate = process.argv.includes("--rotate");
let existing = Buffer.alloc(0);
try { existing = Buffer.from(String(value.codeEncryptionKey || ""), "base64url"); } catch (_error) {}
if (existing.length === 32 && !rotate) {
  console.log("License code encryption key is ready.");
  process.exit(0);
}
value.codeEncryptionKey = crypto.randomBytes(32).toString("base64url");
value.codeEncryptionKeyCreatedAt = new Date().toISOString();
const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
fs.renameSync(temporary, target);
console.log(rotate ? "License code encryption key rotated; no key material was printed." : "License code encryption key created; no key material was printed.");
