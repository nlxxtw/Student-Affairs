"use strict";

const fs = require("fs");
const path = require("path");

/* 激活码授权已停用。保留空实现，兼容仍调用 installTestLicense 的旧回归脚手架。 */
function installTestLicense(tempRoot) {
  const dataDir = path.join(tempRoot, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "license-config.json"), JSON.stringify({
    enabled: false,
    apiUrl: "",
    product: "shuzhi-xuegong",
    publicKey: "",
    requestTimeoutMs: 1000
  }));
}

module.exports = { installTestLicense };
