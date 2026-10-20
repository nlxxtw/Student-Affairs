"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));
const baselineFile = path.join(__dirname, "fixtures", "ui-font-sizes-before.json");
const cases = [
  ["workbench", "/?goto=dashboard", ["body", ".logo .t1", ".logo .t2", ".nav-item", ".ptitle", ".btn", ".in"]],
  ["tasks", "/?goto=tasks", ["body", ".ptitle", ".btn", ".tip"]],
  ["growth", "/?goto=counselorGrowth", ["body", ".ptitle", ".btn"]],
  ["dorm", "/?goto=dorm", ["body", ".ptitle", ".btn"]],
  ["login", "/login.html", ["body", ".brand-name b", ".brand-copy h1", ".auth-content h1", ".intro", ".btn"]],
  ["merge", "/assets/excel-merge-tool.html", ["body", "h1", "button", "input"]],
  ["check", "/assets/excel-check-tool.html", ["body", "h1", "button", "input"]],
  ["match", "/assets/data-match-tool.html", ["body", "h1", "button", "input"]],
  ["summary", "/assets/academic-summary-tool.html", ["body", "h1", "button", "input"]],
  ["analysis", "/assets/academic-analysis-tool.html", ["body", "h1", "button", "input"]],
  ["organization", "/student-org.html?embedded=1", ["body", "h1", "button", "input"]]
];

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], observed = {};
    page.on("pageerror", error => errors.push(error.message));
    for (const [name, url, selectors] of cases) {
      if (name === "login") await page.context().clearCookies();
      await page.goto(origin + url, { waitUntil: "networkidle" });
      if (url.startsWith("/?goto=")) {
        await page.waitForSelector("#content");
        await page.evaluate(view => goto(view), url.split("=")[1]);
      }
      observed[name] = await page.evaluate(selectors => Object.fromEntries(selectors.flatMap(selector => {
        const element = document.querySelector(selector);
        return element ? [[selector, Number.parseFloat(getComputedStyle(element).fontSize)]] : [];
      })), selectors);
      assert.ok(Object.keys(observed[name]).length >= 2, name + " must expose representative text");
      if (name === "login") await page.goto(origin + "/", { waitUntil: "networkidle" });
    }
    if (process.env.QA_FONT_CAPTURE_BASELINE === "1") {
      fs.writeFileSync(baselineFile, JSON.stringify(observed, null, 2) + "\n");
      console.log("Captured isolated UI font baseline");
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    for (const [name, sizes] of Object.entries(baseline)) {
      for (const [selector, size] of Object.entries(sizes)) {
        assert.ok(Math.abs(observed[name][selector] - size - 1) < 0.02, `${name} ${selector}: expected ${size + 1}px, got ${observed[name][selector]}px`);
      }
    }
    await page.goto(origin + "/?goto=employment", { waitUntil: "networkidle" });
    await page.evaluate(() => employmentSwitchTab("destination"));
    if (process.env.UI_QA_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.UI_QA_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.UI_QA_SCREENSHOT_DIR, "font-sizes-desktop.png"), fullPage: true });
    }
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.context().clearCookies();
      await page.goto(origin + "/login.html", { waitUntil: "networkidle" });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `login overflow at ${width}px`);
      assert.ok(await page.locator(".auth-content h1").isVisible());
      if (width === 320 && process.env.UI_QA_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.UI_QA_SCREENSHOT_DIR, "font-sizes-login-mobile.png"), fullPage: true });
    }
    assert.deepStrictEqual(errors, []);
    console.log("qa-ui-font-sizes: passed (computed +1px across workbench, modules, login, organization and 5 tools; login responsive widths)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
