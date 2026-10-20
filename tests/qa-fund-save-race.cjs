"use strict";

const assert = require("assert");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const { chromium } = require(path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright"));

withIsolatedWorkbench(async origin => {
  const entry = await fetch(origin);
  assert.strictEqual(entry.status, 200);
  const cookie = entry.headers.get("set-cookie").split(";")[0];
  async function write(key, value) {
    const response = await fetch(origin + "/api/store/" + key, {
      method: "PUT",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(value) })
    });
    assert(response.ok, await response.text());
  }
  await write("nnuzc_orgs", { depts: [{ code: "qa", name: "测试学院" }], majors: [{ code: "qa-major", name: "测试专业", dept: "测试学院" }], classes: [{ name: "测试班", dept: "测试学院", major: "测试专业", grade: "2025" }], grades: [], dorms: [], enrollTypes: [] });
  await write("nnuzc_term_list", ["2025-2026-2学期", "2024-2025-1学期"]);
  await write("nnuzc_current_term", "2025-2026-2学期");
  await write("nnuzc_students", [
    { id: "qa-one", name: "测试甲", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2025", status: "在校" },
    { id: "qa-two", name: "测试乙", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2025", status: "在校" }
  ]);
  const edge = path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe");
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const context = await browser.newContext();
    const [name, value] = cookie.split("=");
    await context.addCookies([{ name, value, url: origin }]);
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(() => goto("fund"));
    for (let iteration = 0; iteration < 20; iteration++) {
      await page.evaluate(i => {
        const v = level => ({ isPoor: false, poorLevel: level, national: false, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "测试" });
        applyFundRecord("qa-one", "测试甲", "测试学院", "2025", "测试班", "2025-2026-2学期", v("未评定等级"));
        applyFundRecord("qa-one", "测试甲", "测试学院", "2025", "测试班", "2024-2025-1学期", v("一般困难"));
        applyFundRecord("qa-one", "测试甲", "测试学院", "2025", "测试班", "2025-2026-2学期", v("特别困难"));
        applyFundRecord("qa-two", "测试乙", "测试学院", "2025", "测试班", "2025-2026-2学期", v(i % 2 ? "一般困难" : "未评定等级"));
      }, iteration);
      await page.evaluate(() => workbench.legacy.flushStore());
    }
    await page.evaluate(() => {
      openEditFundTerm(fundTermByTerm("2025-2026-2学期").id);
      openEditFund("qa-two", "2025-2026-2学期");
    });
    await page.selectOption("#fLevel", "比较困难");
    let releaseSave, saveStarted;
    const held = new Promise(resolve => { releaseSave = resolve; });
    const started = new Promise(resolve => { saveStarted = resolve; });
    let delayed = false;
    await page.route("**/api/store/batch", async route => {
      if (!delayed) { delayed = true; saveStarted(); await held; }
      await route.continue();
    });
    await page.locator("#modalOk").click();
    await started;
    await page.waitForTimeout(120);
    const editorBeforeConfirmation = await page.locator("#fLevel").count();
    releaseSave();
    assert.strictEqual(editorBeforeConfirmation, 1, "fund editor was replaced before save confirmation");
    await page.evaluate(() => workbench.legacy.flushStore());
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => fundRecords.find(row => row.studentId === "qa-two" && row.term === "2025-2026-2学期")?.poorLevel), "比较困难");
    await page.unroute("**/api/store/batch");
    await page.evaluate(() => {
      goto("fund");
      openEditFundTerm(fundTermByTerm("2025-2026-2学期").id);
      openEditFund("qa-two", "2025-2026-2学期");
    });
    await page.selectOption("#fLevel", "一般困难");
    await page.route("**/api/store/batch", route => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: "COLLABORATION_CONFLICT", error: "其他用户已修改同一字段" })
    }));
    await page.locator("#modalOk").click();
    await page.locator("[data-modal-save-error]").waitFor();
    assert.strictEqual(await page.locator("#fLevel").inputValue(), "一般困难", "failed save discarded the edit form");
    assert.strictEqual(await page.evaluate(() => __workbenchStoreSync.failed()), true, "failed save did not retain a collaboration draft");
    assert.deepStrictEqual(failures, []);
    await context.close();
  } finally { await browser.close(); }
  console.log("qa-fund-save-race: passed");
}).catch(error => { console.error(error); process.exitCode = 1; });
