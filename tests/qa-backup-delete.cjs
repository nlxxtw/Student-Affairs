"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));

withIsolatedWorkbench(async (origin, control) => {
  let cookie = "";
  async function call(url, method = "GET", body) {
    const response = await fetch(origin + url, {
      method,
      headers: { Origin: origin, Connection: "close", Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal(response.ok, true, `${method} ${url}: ${JSON.stringify(data)}`);
    return data;
  }
  async function enter() { cookie = ""; await call("/api/auth/enter", "POST"); }
  const artifactSuffixes = ["", "-wal", "-shm", "-journal", ".attachments", ".portable-data-key.json", ".academic-warning-template.bin", ".academic-warning-template.json"];

  await enter();
  const backup = await call("/api/backups", "POST", { note: "删除完整性测试" });
  await control.restart(async temp => {
    const file = path.join(temp, backup.relative_path);
    assert.equal(fs.existsSync(file), true, "primary backup fixture must exist");
    assert.equal(fs.existsSync(file + ".attachments"), true, "attachment snapshot fixture must exist");
    assert.equal(fs.existsSync(file + ".portable-data-key.json"), true, "portable key snapshot fixture must exist");
    fs.writeFileSync(file + "-wal", "simulated sqlite sidecar");
    fs.writeFileSync(file + "-shm", "simulated sqlite sidecar");
    fs.writeFileSync(file + "-journal", "simulated sqlite sidecar");
  });
  await enter();
  const deleted = await call(`/api/backups/${encodeURIComponent(backup.id)}`, "DELETE");
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.verified, true, "delete response must only succeed after artifact verification");
  assert.deepStrictEqual(deleted.remainingArtifacts, []);
  assert.equal((await call("/api/backups")).some(row => row.id === backup.id), false);
  await control.restart(async temp => {
    const file = path.join(temp, backup.relative_path);
    artifactSuffixes.forEach(suffix => assert.equal(fs.existsSync(file + suffix), false, `backup artifact remained: ${suffix || "primary"}`));
  });
  await enter();
  assert.equal((await call("/api/backups")).some(row => row.id === backup.id), false, "deleted backup must not return after restart");

  const partial = await call("/api/backups", "POST", { note: "刷新自愈测试" });
  await control.restart(async temp => {
    const file = path.join(temp, partial.relative_path);
    fs.rmSync(file, { force: true });
    assert.equal(fs.existsSync(file + ".attachments"), true, "partial fixture must retain a sidecar directory");
  });
  await enter();
  const afterRefresh = await call("/api/backups");
  assert.equal(afterRefresh.some(row => row.id === partial.id), false, "refresh must remove a stale backup record when the primary file is gone");
  await control.restart(async temp => {
    const file = path.join(temp, partial.relative_path);
    artifactSuffixes.forEach(suffix => assert.equal(fs.existsSync(file + suffix), false, `stale artifact remained after refresh: ${suffix || "primary"}`));
    const database = new DatabaseSync(path.join(temp, "data", "workbench.db"));
    try { assert.equal(database.prepare("SELECT COUNT(*) AS count FROM web_backup_records WHERE id=?").get(partial.id).count, 0, "stale registry row remained"); }
    finally { database.close(); }
  });
  await enter();
  assert.equal((await call("/api/backups")).some(row => row.id === partial.id), false, "stale backup must not return after a second restart");

  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.goto(origin + "/?goto=backup", { waitUntil: "networkidle" });
    const pageState = await page.evaluate(async () => { await goto("backup"); await workbench.legacy.backupCreate(); await desktopBackupRender(); return { view: currentView, rows: await workbench.legacy.backupList(), host: document.getElementById("desktopBackupRows")?.innerText || "" }; });
    assert.equal(pageState.rows.length, 1, JSON.stringify(pageState));
    assert.match(pageState.host, /删除/, JSON.stringify(pageState));
    await page.getByRole("button", { name: /删除/ }).waitFor();
    await page.getByRole("button", { name: /删除/ }).click();
    await page.getByText("暂无备份。", { exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText("暂无备份。", { exact: true }).waitFor();
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
  console.log("qa-backup-delete: passed (complete artifacts, verified deletion, stale sidecar/index repair, UI refresh, restart persistence)");
}).catch(error => { console.error(error); process.exitCode = 1; });
