"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { LicenseClient } = require("../license-client");
const { UpdateClient } = require("../update-client");

const root = path.resolve(__dirname, "..");
const liveDataDir = path.join(root, "data");
const liveLicenseState = path.join(liveDataDir, "license-state.json");
const fromVersion = String(process.argv[2] || "V5.0.1");
const expectedVersion = String(process.argv[3] || "V5.2.1");

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fileHandle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fileHandle, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally {
    fs.closeSync(fileHandle);
  }
  return hash.digest("hex");
}

async function main() {
  if (!fs.existsSync(liveLicenseState)) throw new Error("本机尚无可用于云端联调的授权状态。");

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "shuzhi-update-e2e-"));
  const temporaryLicenseState = path.join(temporaryDir, "license-state.json");
  fs.copyFileSync(liveLicenseState, temporaryLicenseState);

  try {
    const licenseClient = new LicenseClient({
      root,
      dataDir: liveDataDir,
      statePath: temporaryLicenseState,
      appVersion: fromVersion,
      forceEnabled: true
    });
    const updateClient = new UpdateClient({
      root,
      dataDir: temporaryDir,
      appVersion: fromVersion,
      licenseClient
    });

    const checked = await updateClient.check(true);
    if (fromVersion === expectedVersion) {
      if (checked.available) throw new Error(`当前 ${expectedVersion} 被错误识别为仍需更新。`);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        currentVersion: expectedVersion,
        cloudReachable: true,
        currentVersionUpToDate: true
      }, null, 2)}\n`);
      return;
    }
    if (!checked.available || !checked.latest || checked.latest.version !== expectedVersion) {
      throw new Error(`云端未向 ${fromVersion} 返回预期的 ${expectedVersion} 更新：${JSON.stringify(checked.latest || null)}`);
    }

    const downloaded = await updateClient.download();
    const actualHash = sha256File(downloaded.file);
    if (actualHash !== checked.latest.sha256) throw new Error("下载后的独立 SHA-256 复核失败。");

    const restartedOldClient = new UpdateClient({
      root,
      dataDir: temporaryDir,
      appVersion: fromVersion,
      licenseClient
    });
    if (!restartedOldClient.downloadedPackage()) throw new Error("本机服务重启后没有恢复已校验的升级包。");

    const currentClient = new UpdateClient({
      root,
      dataDir: temporaryDir,
      appVersion: expectedVersion,
      licenseClient: new LicenseClient({
        root,
        dataDir: liveDataDir,
        statePath: temporaryLicenseState,
        appVersion: expectedVersion,
        forceEnabled: true
      })
    });
    const currentCheck = await currentClient.check(true);
    if (currentCheck.available) throw new Error(`当前 ${expectedVersion} 被错误识别为仍需更新。`);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      fromVersion,
      toVersion: checked.latest.version,
      platform: checked.latest.platform,
      packageBytes: downloaded.size,
      sha256Verified: true,
      signedDownloadUrlReceived: true,
      downloadedFromOss: true,
      restoredAfterServiceRestart: true,
      currentVersionUpToDate: true
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
