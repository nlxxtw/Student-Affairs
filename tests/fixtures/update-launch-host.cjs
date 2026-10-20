"use strict";

const fs = require("fs");
const path = require("path");

const configPath = process.argv[2];
if (!configPath) throw new Error("missing launcher test config");
const config = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
const { launchWindowsUpdater } = require(path.join(config.projectRoot, "update-launcher.js"));
const child = launchWindowsUpdater({
  installer: path.join(config.installRoot, "scripts", "update-bootstrap.ps1"),
  root: config.installRoot,
  packageFile: config.packageFile,
  sha256: config.sha256,
  version: config.version,
  parentProcessId: process.pid,
  logPath: path.join(config.installRoot, "data", "updates", "launcher-e2e.log")
});
child.once("error", (error) => {
  fs.writeFileSync(path.join(config.installRoot, "data", "updates", "launcher-host-error.txt"), error.stack || error.message, "utf8");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  fs.writeFileSync(path.join(config.installRoot, "data", "updates", "launcher-dispatcher-exit.json"), JSON.stringify({ code, signal }), "utf8");
});
// 更新器应主动结束此宿主进程。该计时器仅保证宿主在测试失败时不会自行退出。
setInterval(() => {}, 1000);
