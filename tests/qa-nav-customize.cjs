"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-nav-customize-"));
const port = Number(process.env.XIANGCAI_NAV_QA_PORT || 18879);
const origin = `http://127.0.0.1:${port}`;
let child;
let browser;

function loadPlaywright() {
  const candidates = [
    process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, "playwright"),
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright")
  ].filter(Boolean);
  const candidate = candidates.find((item) => fs.existsSync(item));
  if (!candidate) throw new Error("Playwright is unavailable");
  return require(candidate);
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  const executable = candidates.find((item) => fs.existsSync(item));
  if (!executable) throw new Error("Microsoft Edge executable was not found");
  return executable;
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("isolated navigation QA server did not start");
}

async function main() {
  await assertPortAvailable();
  for (const name of ["web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "license-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js", "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js", "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "index.html", "login.html", "other-violation-module.js", "学生组织管理.html"]) {
    fs.copyFileSync(path.join(root, name), path.join(temp, name));
  }
  fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
  fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
  installTestLicense(temp);
  fs.mkdirSync(path.join(temp, "assets"));
  for (const name of ["html2pdf.bundle.min.js", "jszip.min.js", "xlsx.full.min.js", "academic-warning-editor-template.html", "login-logo.png", "login-logo-icon.png", "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-field-template.xlsx", "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js", "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css"]) {
    fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
  }
  fs.copyFileSync(path.join(root, "assets", "tool-history-client.js"), path.join(temp, "assets", "tool-history-client.js"));
  for (const asset of ["workbench-ui.js", "workbench-ui.css"]) fs.copyFileSync(path.join(root, "assets", asset), path.join(temp, "assets", asset));
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  await waitForServer();
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ executablePath: findEdge(), headless: true });
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });

  const menuViews = await page.$$eval("#nav .nav-item[data-view],#nav .nav-sub-item[data-view]", (nodes) => [...new Set(nodes.map((node) => node.dataset.view))].sort());
  await page.evaluate(() => window.goto("navCustomize"));
  const checkboxViews = await page.$$eval("#navCustomizePage [data-nav-custom-view]", (nodes) => nodes.map((node) => node.dataset.navCustomView).sort());
  assert.deepStrictEqual(checkboxViews, menuViews, "each second-level menu must have a checkbox");
  assert.strictEqual(await page.locator('#navCustomizePage [data-nav-custom-view="navCustomize"]').isDisabled(), true, "recovery entry must stay visible");
  assert.strictEqual(await page.locator('#navCustomizePage [draggable="true"]').count(), 0, "drag sorting is forbidden");
  assert.doesNotMatch((await page.locator("#navCustomizePage button").allTextContents()).join(" "), /上移|下移|排序|移动/, "position controls are forbidden");

  await page.locator('#navCustomizePage [data-nav-custom-view="portrait"]').uncheck();
  await page.waitForFunction(() => document.querySelector('#nav .nav-item[data-view="portrait"]').classList.contains("hidden"));
  await page.evaluate(() => window.workbench.legacy.flushStore());
  const databaseValue = await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_nav_visibility_v1);
  assert.ok(databaseValue.hiddenViews.includes("portrait"), "unchecked state must be stored in SQLite");

  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => window.goto("navCustomize"));
  assert.strictEqual(await page.locator('#navCustomizePage [data-nav-custom-view="portrait"]').isChecked(), false, "unchecked state must survive reload");
  assert.strictEqual(await page.locator('#nav .nav-item[data-view="portrait"]').evaluate((node) => node.classList.contains("hidden")), true, "unchecked menu must stay hidden after reload");

  await page.evaluate(() => window.navVisibilityReset());
  await page.waitForFunction(() => !document.querySelector('#nav .nav-item[data-view="portrait"]').classList.contains("hidden"));
  await page.evaluate(() => window.workbench.legacy.flushStore());
  assert.strictEqual(await page.locator('#navCustomizePage [data-nav-custom-view]:not(:checked)').count(), 0, "restore-all must check every menu");
  console.log(`自定义导航栏回归通过：${menuViews.length} 个二级菜单全部覆盖，显隐与 SQLite 持久化正常。`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("close", resolve));
    child.kill();
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

