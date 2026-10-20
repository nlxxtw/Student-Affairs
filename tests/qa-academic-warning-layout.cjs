"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.academicWarningTerms = [{ id: 101, term: "2025-2026-1", rows: Array.from({ length: 82 }, (_, i) => ({ _rid: "layout-" + i, "学号": "852304" + String(i).padStart(2, "0"), "姓名": "测试学生", "学院": "信息工程学院", "年级": "2025", "班级": "852304通信", "专业": "通信工程", "不及格门数": 5, "预警等级": "红色预警", "备注": "需跟进学业情况", courses: [] })) }];
    });
    for (const width of [1440, 1024, 768, 430]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => openEditAcademicWarningTerm(101));
      const metrics = await page.locator("#awTableWrap").evaluate(wrap => {
        const td = wrap.querySelector("tbody tr td:last-child");
        return { clipped: td.scrollWidth > td.clientWidth + 1, scrollable: wrap.scrollWidth > wrap.clientWidth + 1, scrollbarHeight: wrap.offsetHeight - wrap.clientHeight, overflowX: getComputedStyle(wrap).overflowX, contained: wrap.getBoundingClientRect().right <= innerWidth, height: wrap.clientHeight };
      });
      assert.strictEqual(metrics.clipped, false, `action links must not be clipped at ${width}px`);
      if (width <= 1024) assert.strictEqual(metrics.scrollable, true, `table must allow horizontal scrolling at ${width}px`);
      if (metrics.scrollable) assert.ok(metrics.scrollbarHeight >= 10, `horizontal scrollbar must reserve visible space at ${width}px`);
      assert.match(metrics.overflowX, /auto|scroll/);
      assert.strictEqual(metrics.contained, true);
      const toolbarContained = await page.locator(".ae-bar").evaluate(bar => {
        const modal = bar.closest(".modal").getBoundingClientRect();
        return Array.from(bar.querySelectorAll("button,input")).every(control => control.getBoundingClientRect().right <= modal.right);
      });
      assert.strictEqual(toolbarContained, true, `filter and toolbar controls must remain inside the modal at ${width}px`);
      assert.ok(metrics.height > 100, `table must retain usable height at ${width}px`);
      await page.locator("#awTableWrap").evaluate(wrap => { wrap.scrollLeft = wrap.scrollWidth; });
      const visible = await page.locator("#awTbody tr").first().locator("a.danger").evaluate(link => {
        const r = link.getBoundingClientRect(), w = link.closest("#awTableWrap").getBoundingClientRect();
        return r.left >= w.left && r.right <= w.right;
      });
      assert.strictEqual(visible, true, `delete link must be reachable by horizontal scrolling at ${width}px`);
      if (process.env.QA_LAYOUT_SCREENSHOTS && [1024, 430].includes(width)) await page.screenshot({ path: path.join(os.tmpdir(), `academic-warning-layout-${width}.png`) });
      await page.evaluate(() => academicWarningEditQuery(101));
      assert.strictEqual(await page.locator("#awTbody tr").count(), 20, "query must retain pagination");
      await page.evaluate(() => closeModal());
    }
    console.log("qa-academic-warning-layout: passed (4 widths, unclipped actions, horizontal scrolling, query/pagination)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
