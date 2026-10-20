"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const secretPath = path.join(root, "deployment-secrets.json");
const publicKeyPath = path.join(root, "generated-public-key.pem");
const rotate = process.argv.includes("--rotate");
if (fs.existsSync(secretPath) && !rotate) {
  console.log("部署密钥已存在，未重新生成。如需轮换，请运行 node prepare-deployment.cjs --rotate。");
  process.exit(0);
}
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});
const output = {
  version: 2,
  createdAt: new Date().toISOString(),
  privateKey,
  publicKey,
  codePepper: crypto.randomBytes(48).toString("base64url")
};
fs.writeFileSync(secretPath, JSON.stringify(output, null, 2), { encoding: "utf8", mode: 0o600, flag: rotate ? "w" : "wx" });
fs.writeFileSync(publicKeyPath, publicKey, { encoding: "utf8", mode: 0o644, flag: rotate ? "w" : "wx" });
console.log(rotate
  ? "部署密钥和客户端公钥已完成轮换；旧密钥已被覆盖且未输出到终端。"
  : "部署密钥和客户端公钥已生成；私钥未输出到终端。请勿上传 deployment-secrets.json。");
