"use strict";
const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const term = "2026-2027-1学期";
      saveTermList([term]); localStorage.setItem("nnuzc_current_term", term);
      const settings = getTermSettings(); settings[term] = { startDate: "2026-09-14", totalWeeks: 19 }; saveTermSettings(settings);
      ORG_DEPTS.push({ name: "测试学院", code: "QA" });
      ORG_MAJORS.push({ name: "测试专业", dept: "测试学院", code: "QA01" });
      ORG_CLASSES.push({ name: "测试班", dept: "测试学院", major: "测试专业", grade: "2023" });
      saveOrgs();
      courseSchedules.push({ id: "keep-schedule", term, cls: "测试班", day: 1, weeks: "1-19", course: "保留课表测试课程", section: "第1-2节", teacher: "测试教师" });
      persistCourseSchedules(); await workbench.legacy.flushStore();
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => goto("classroom"));
    assert.doesNotMatch(await page.locator("#content").innerText(), /本学期课表/);
    assert.strictEqual(await page.locator("#courseScheduleTable").count(), 0);
    assert.strictEqual(await page.getByRole("button", { name: /记录考勤/ }).count(), 1);
    assert.match(await page.locator("#content").innerText(), /班级考勤记录统计/);
    await page.evaluate(async () => {
      courseTimetableState.terms = [CURRENT_TERM]; courseTimetableState.classes = ["测试班"]; courseTimetableState.week = 1;
      await goto("courseTimetable");
    });
    assert.match(await page.locator("#content").innerText(), /保留课表测试课程/);
    assert.strictEqual(await page.evaluate(() => courseScheduleRows(CURRENT_TERM).some(row => row.id === "keep-schedule")), true, "standalone period/week helpers must retain shared schedule rows");
    await page.evaluate(() => courseTimetableOpenSettings());
    assert.ok(await page.locator("#ctPeriodList").count());
    await page.evaluate(() => closeModal());
    for (const text of ["AI 智能识别", "PDF", "导入", "模板"]) assert.match(await page.locator("#content").innerText(), new RegExp(text));
    assert.strictEqual(await page.evaluate(() => courseScheduleMatches(CURRENT_TERM, "测试班", "2026-09-14").rows.some(row => row.id === "keep-schedule")), true, "attendance must still match shared schedule data");
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => courseSchedules.some(row => row.id === "keep-schedule")), true, "removing the view must preserve stored schedules");
    await page.evaluate(() => goto("classroom"));
    assert.doesNotMatch(await page.locator("#content").innerText(), /本学期课表/);
    assert.deepStrictEqual(errors, []);
    console.log("qa-classroom-timetable-removal: passed (classroom card removed, attendance retained, standalone schedule/imports preserved, matching and reload persistence)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
