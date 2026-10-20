"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function requiredText(value, name) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`缺少更新启动参数：${name}。`);
  return result;
}

function launchWindowsUpdater(options = {}) {
  if (process.platform !== "win32") throw new Error("当前平台不支持 Windows 更新引导程序。");
  const installer = path.resolve(requiredText(options.installer, "installer"));
  const dispatcher = path.join(path.dirname(installer), "start-update-bootstrap.ps1");
  const root = path.resolve(requiredText(options.root, "root"));
  const packageFile = path.resolve(requiredText(options.packageFile, "packageFile"));
  const sha256 = requiredText(options.sha256, "sha256");
  const version = requiredText(options.version, "version");
  const logPath = path.resolve(requiredText(options.logPath, "logPath"));
  const parentProcessId = Number(options.parentProcessId);
  if (!Number.isInteger(parentProcessId) || parentProcessId <= 0) throw new Error("更新启动参数 parentProcessId 无效。");
  if (!fs.existsSync(installer)) throw new Error("更新安装组件缺失。");
  if (!fs.existsSync(dispatcher)) throw new Error("独立更新启动组件缺失。");
  if (!fs.existsSync(packageFile)) throw new Error("已下载的更新包不存在。");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logHandle = fs.openSync(logPath, "a");
  let logClosed = false;
  const closeLog = () => {
    if (logClosed) return;
    logClosed = true;
    try { fs.closeSync(logHandle); } catch (_ignored) {}
  };
  let child;
  try {
    // 不可 detached/unref：部分 Windows 环境会出现进程创建成功但脚本未执行。
    // 普通 PowerShell 子进程在结束指定的旧 Node 进程后仍会继续执行。
    child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", dispatcher, "-Bootstrap", installer, "-Root", root, "-Package", packageFile, "-ExpectedSha256", sha256, "-ExpectedVersion", version, "-ParentProcessId", String(parentProcessId), "-LogPath", logPath], {
      windowsHide: true,
      stdio: ["ignore", logHandle, logHandle]
    });
  } catch (error) {
    closeLog();
    throw error;
  }
  child.once("exit", closeLog);
  child.once("error", closeLog);
  return child;
}

module.exports = { launchWindowsUpdater };
