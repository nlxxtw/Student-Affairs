"use strict";
const assert = require("assert");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(async () => { saveTermList(["2026-2027-1学期"]); localStorage.setItem("nnuzc_current_term", "2026-2027-1学期"); await workbench.legacy.flushStore(); });
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(async () => {
      ORG_DEPTS.push({ name: "测试学院", code: "QA" });
      ORG_MAJORS.push({ name: "测试专业", dept: "测试学院", code: "QA01" });
      ORG_CLASSES.push({ name: "节次测试班", dept: "测试学院", major: "测试专业", grade: "2023" }); saveOrgs();
      const fixture = [
        ["span", "跨段实践课程", "第2-9节", 1, "1-3"],
        ["morning", "上午实训", "第1-5节", 1, "1-3"],
        ["single", "单节课程", "第4节", 1, "1-3"],
        ["evening", "晚间课程", "第9-10节", 1, "1-3"],
        ["other-day", "周二课程", "第3-4节", 2, "1-3"],
        ["other-week", "其他周课程", "第3-4节", 1, "4-6"]
      ];
      fixture.forEach(([id, course, section, day, weeks]) => courseSchedules.push({ id, course, section, day, weeks, term: CURRENT_TERM, cls: "节次测试班", teacher: "测试教师", category: "实践", location: "测试教学楼" }));
      persistCourseSchedules(); await workbench.legacy.flushStore();
      courseTimetableState.terms = [CURRENT_TERM]; courseTimetableState.classes = ["节次测试班"]; courseTimetableState.week = 2; await goto("courseTimetable");
    });
    const rows = page.locator(".ct-grid tbody tr");
    const monday = i => rows.nth(i).locator(".ct-cell").nth(0);
    const expected = [
      ["跨段实践课程", "上午实训"],
      ["单节课程"],
      [],
      [],
      ["晚间课程"]
    ];
    for (let i = 0; i < expected.length; i++) {
      assert.deepStrictEqual((await monday(i).locator(".ct-course-title strong").allTextContents()).sort(), expected[i].sort(), `courses assigned to group ${i}`);
      assert.doesNotMatch(await monday(i).innerText(), /周二课程|其他周课程/);
    }
    assert.match(await monday(0).innerText(), /第2-9节/);
    assert.doesNotMatch(await page.locator(".ct-board").innerText(), /本时段：|全程 第/);
    assert.strictEqual(await page.locator(".ct-board .ct-course").filter({ hasText: "跨段实践课程" }).count(), 1);
    assert.strictEqual(await rows.nth(1).locator(".ct-cell").nth(1).locator(".ct-course-title strong").innerText(), "周二课程");
    await monday(0).locator(".ct-course").filter({ hasText: "跨段实践课程" }).getByTitle("编辑课程").click();
    assert.strictEqual(await page.locator("#ctFormSection").inputValue(), "第2-9节", "course must edit original full range");
    await page.evaluate(() => closeModal());
    assert.strictEqual(await page.evaluate(() => courseSchedules.filter(r => r.id === "span").length), 1, "rendering must not duplicate stored records");
    await page.evaluate(() => { courseTimetableState.classes = []; renderPage("courseTimetable"); });
    assert.doesNotMatch(await monday(3).innerText(), /跨段实践课程/, "all-class mode must show a course only in its starting group");
    const exported = await page.evaluate(() => {
      const original = downloadXlsxFile; let data;
      try { downloadXlsxFile = (name, rows) => { data = rows; }; courseTimetableExport(); }
      finally { downloadXlsxFile = original; }
      return data;
    });
    assert.strictEqual(exported.length, 6, "export must contain five original courses, not repeated display cards");
    assert.strictEqual(exported.filter(row => row[7] === "跨段实践课程").length, 1);
    assert.strictEqual(exported.find(row => row[7] === "跨段实践课程")[9], "第2-9节");
    // Odd final period and an empty slot must keep the correct row time and add defaults.
    await page.evaluate(() => {
      const settings = getTermSettings(); settings[CURRENT_TERM] = Object.assign({}, settings[CURRENT_TERM], { periods: courseTimetablePeriods(CURRENT_TERM).slice(0, 9) }); saveTermSettings(settings); renderPage("courseTimetable");
    });
    assert.match(await rows.last().locator(".ct-time").innerText(), /第9节/);
    await rows.last().locator(".ct-cell").nth(6).click();
    assert.strictEqual(await page.locator("#ctFormSection").inputValue(), "第9节");
    assert.strictEqual(await page.locator("#ctFormDay").inputValue(), "7");
    await page.evaluate(() => closeModal());
    await page.evaluate(() => document.querySelector(".ct-scroll").scrollTo(0, 0));
    await page.locator(".ct-board").screenshot({ path: path.join(os.tmpdir(), "shuzhi-timetable-periods-restored.png") });
    assert.deepStrictEqual(errors, []);
    console.log("qa-timetable-periods: passed (start-period placement, full original ranges, single periods, day/week filters, original edit range, no record duplication, odd final period and empty slot)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
