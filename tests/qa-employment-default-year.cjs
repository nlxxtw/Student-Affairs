"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")].find(p => p && fs.existsSync(p));
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(origin + "/?goto=employment", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      students = ["2025届", "2027届", "2026", "2027", ""].map((year, i) => ({ id: String(i), name: "测试" + i, cls: "测试班", dept: "测试学院", major: "测试专业", graduateYear: year, status: "在校" }));
      goto("dashboard"); goto("employment");
    });
    const yearSelect = () => page.locator('#content select[onchange*="SetGraduateYear"]');
    assert.strictEqual(await yearSelect().inputValue(), "2027届", "entry defaults to newest cohort");
    assert.strictEqual(await yearSelect().locator("option").count(), 4, "equivalent cohort labels are deduplicated");
    assert.strictEqual(await page.evaluate(() => employmentIntentionFiltered().length), 2);
    await yearSelect().selectOption("2025届");
    await page.evaluate(() => renderPage("employment"));
    assert.strictEqual(await yearSelect().inputValue(), "2025届", "rerender preserves manual selection");
    await page.evaluate(() => employmentSwitchTab("destination"));
    assert.strictEqual(await yearSelect().inputValue(), "2027届", "tracking also defaults to newest");
    assert.strictEqual(await page.locator(".employment-tracking-select").count(), 2);
    await yearSelect().selectOption("");
    await page.evaluate(() => employmentSwitchTab("intention"));
    assert.strictEqual(await yearSelect().inputValue(), "2025届");
    await page.evaluate(() => { goto("dashboard"); goto("employment"); });
    assert.strictEqual(await yearSelect().inputValue(), "2027届", "reentry resets default");
    await page.evaluate(() => employmentSwitchTab("destination"));
    assert.strictEqual(await yearSelect().inputValue(), "2027届");
    await page.evaluate(() => { students = []; goto("dashboard"); goto("employment"); });
    assert.strictEqual(await yearSelect().inputValue(), "", "empty data falls back to all cohorts");
    console.log("qa-employment-default-year: passed");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
