"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      const term = CURRENT_TERM;
      for (let i = 0; i < 5; i++) courseSchedules.push({ id: "layout-" + i, term, cls: "布局测试班" + i, day: 1, weeks: "1-19", section: "第1-2节", course: "专业综合设计与实践及跨专业创新课程" + i, category: i === 1 ? "综合实验实践课程" : "实验", teacher: "测试教师", location: "测试教学楼-101" });
      persistCourseSchedules(); await workbench.legacy.flushStore();
      courseTimetableState.terms = [term]; courseTimetableState.classes = []; courseTimetableState.week = 1;
      await goto("courseTimetable");
    });
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const issues = await page.evaluate(() => {
        const issues = [];
        const rect = el => el.getBoundingClientRect();
        const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
        const cell = document.querySelector(".ct-cell");
        const count = cell.querySelector(".ct-cell-count");
        for (const card of cell.querySelectorAll(".ct-course")) {
          const title = card.querySelector("strong"), category = card.querySelector("i"), actions = card.querySelector(".ct-course-actions");
          if (overlaps(rect(count), rect(card))) issues.push("count overlaps card");
          if (overlaps(rect(title), rect(category))) issues.push("category overlaps title");
          if (overlaps(rect(title), rect(actions)) || overlaps(rect(category), rect(actions))) issues.push("actions overlap heading");
          if (title.scrollWidth > title.clientWidth + 1 || title.scrollHeight > title.clientHeight + 1) issues.push("title clipped");
          if (rect(category).right > rect(card).right - 1) issues.push("category outside card");
        }
        return issues;
      });
      assert.deepStrictEqual(issues, [], `layout at ${width}px`);
    }
    assert.strictEqual(await page.locator(".ct-cell").first().locator(".ct-course").count(), 4);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator(".ct-cell-more").first().click();
    assert.strictEqual(await page.locator(".ct-cell").first().locator(".ct-course").count(), 5);
    await page.locator(".ct-cell-more").first().click();
    assert.strictEqual(await page.locator(".ct-cell").first().locator(".ct-course").count(), 4);
    const card = page.locator(".ct-course").first();
    await card.hover();
    await card.getByTitle("编辑课程").click();
    assert.match(await page.locator("#modal").innerText(), /编辑课程/);
    await page.evaluate(() => closeModal());
    const screenshot = path.join(os.tmpdir(), "shuzhi-timetable-layout-fixed.png");
    await page.locator(".ct-board").screenshot({ path: screenshot });
    assert.deepStrictEqual(errors, []);
    console.log("qa-timetable-layout: passed (4 viewport widths, long headings/categories, count, expand/collapse, edit); screenshot: " + screenshot);
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
