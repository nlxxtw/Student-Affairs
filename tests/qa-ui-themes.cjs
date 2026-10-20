"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-ui-themes-"));
const port = Number(process.env.XIANGCAI_UI_QA_PORT || 18881);
const origin = `http://127.0.0.1:${port}`;
const screenshotDir = process.env.UI_QA_SCREENSHOT_DIR ? path.resolve(process.env.UI_QA_SCREENSHOT_DIR) : "";
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
  throw new Error("isolated UI QA server did not start");
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
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(origin, { waitUntil: "networkidle" });

  const options = await page.$$eval("#uiThemeToggle option", (nodes) => nodes.map((node) => ({ value: node.value, text: node.textContent.trim() })));
  assert.deepStrictEqual(options.map((item) => item.value), ["classic", "tech", "bluework"], "theme selector must only expose classic, tech and bluework");
  assert.match(options[2].text, /蓝白工作台/, "new blue-white workbench option is missing");

  for (const removedTheme of ["aurora", "screen"]) {
    await page.evaluate((value) => localStorage.setItem("xiangcai_ui_theme", value), removedTheme);
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.locator("html").getAttribute("data-theme"), null, `${removedTheme} must no longer be applied`);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem("xiangcai_ui_theme")), "classic", `${removedTheme} must migrate to classic`);
    assert.strictEqual(await page.locator("#uiThemeToggle").inputValue(), "classic", `${removedTheme} migration is not reflected in the selector`);
  }

  await page.locator("#uiThemeToggle").selectOption("bluework");
  assert.strictEqual(await page.locator("html").getAttribute("data-theme"), "bluework", "blue-white workbench was not applied");
  await page.evaluate(() => window.goto("dashboard"));
  const blueVisual = await page.evaluate(() => ({
    sidebar: getComputedStyle(document.querySelector(".sidebar")).backgroundImage,
    activeColor: getComputedStyle(document.querySelector('.nav-item[data-view="dashboard"]')).color,
    hero: getComputedStyle(document.querySelector("#siDashboard .si-hero")).backgroundImage,
    welcome: getComputedStyle(document.querySelector("#siDashboard .si-hero h2"), "::before").content,
    overflow: document.documentElement.scrollWidth - window.innerWidth
  }));
  assert.match(blueVisual.sidebar, /rgb\(251, 253, 255\)/, "blue-white sidebar is not using the light palette");
  assert.strictEqual(blueVisual.activeColor, "rgb(255, 255, 255)", "active navigation item lacks blue-workbench contrast");
  assert.match(blueVisual.hero, /rgb\(216, 236, 255\)/, "blue-white welcome banner is missing");
  assert.match(blueVisual.welcome, /WELCOME/, "welcome treatment inspired by the reference UI is missing");
  assert.ok(blueVisual.overflow <= 1, "blue-white dashboard causes horizontal overflow");
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, "蓝白工作台.png"), fullPage: false });
  }

  await page.evaluate(() => window.goto("cockpit"));
  await page.waitForSelector("#szCockpit");
  const cockpitVisual = await page.evaluate(() => ({
    surface: getComputedStyle(document.querySelector("#szCockpit")).backgroundImage,
    panel: getComputedStyle(document.querySelector("#szCockpit .sc-panel")).backgroundImage,
    outside: getComputedStyle(document.querySelector(".content")).backgroundImage,
    text: getComputedStyle(document.querySelector("#szCockpit")).color
  }));
  assert.match(cockpitVisual.surface, /rgb\(18, 84, 154\)/, "cockpit is not using the brighter blue surface");
  assert.match(cockpitVisual.panel, /25, 91, 164/, "cockpit panels are still using the near-black palette: "+cockpitVisual.panel);
  assert.match(cockpitVisual.outside, /rgb\(220, 236, 255\)/, "cockpit outer canvas is not light blue");
  assert.strictEqual(cockpitVisual.text, "rgb(244, 251, 255)", "cockpit text contrast is incorrect");
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "明亮大屏驾驶舱.png"), fullPage: false });

  console.log("UI 主题回归通过：已删除极光/大屏主题，蓝白工作台与明亮驾驶舱渲染正常。");
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

