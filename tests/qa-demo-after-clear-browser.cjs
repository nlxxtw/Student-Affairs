"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?goto=backup", { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0, ORG_DEPTS.length, { name: "清空测试学院", code: "QC" });
      ORG_MAJORS.splice(0, ORG_MAJORS.length, { name: "清空测试专业", dept: "清空测试学院", code: "QC01" });
      ORG_GRADES.splice(0, ORG_GRADES.length, { name: "2026级" });
      ORG_CLASSES.splice(0, ORG_CLASSES.length, { name: "清空测试1班", dept: "清空测试学院", major: "清空测试专业", grade: "2026级" });
      saveOrgs();
      students = [{ id: "CLEAR001", name: "清空流程测试", status: "在校", dept: "清空测试学院", major: "清空测试专业", grade: "2026级", cls: "清空测试1班" }];
      persistStudents();
      await workbench.legacy.flushStore();
    });
    assert.equal((await page.evaluate(() => workbench.legacy.demoStatus())).hasRealData, true);

    page.on("dialog", async dialog => {
      if (dialog.type() === "prompt") await dialog.accept("清空本地全部数据");
      else await dialog.accept();
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.getByRole("button", { name: "清空本地全部数据", exact: true }).click()
    ]);

    const status = await page.evaluate(() => workbench.legacy.demoStatus());
    const store = await page.evaluate(() => workbench.legacy.readStoreSnapshot());
    assert.equal(status.active, false, JSON.stringify(status));
    assert.equal(status.hasRealData, false, JSON.stringify(status));
    assert.equal(status.canLoad, true, JSON.stringify(status));
    assert.equal(store.nnuzc_students, undefined, "cleared student data must not be written back during reload");

    /* 系统内置空配置和参考目录可以载入演示；用户修改这些内容后仍必须受到保护。 */
    await page.evaluate(async () => {
      employmentResourceRecords[0].title += "（用户修改）";
      employmentResourcePersist();
      await workbench.legacy.flushStore();
    });
    assert.equal((await page.evaluate(() => workbench.legacy.demoStatus())).hasRealData, true, "modified built-in employment resource must count as real data");
    await page.evaluate(async () => {
      employmentResourceRecords[0].title = "国家大学生就业服务平台";
      employmentResourcePersist();
      await workbench.legacy.flushStore();
    });
    assert.equal((await page.evaluate(() => workbench.legacy.demoStatus())).hasRealData, false, "restored built-in employment resource must not block demo data");
    await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem("nnuzc_dorm_spatial_v1"));
      state.settings.defaultBedCount = 6;
      localStorage.setItem("nnuzc_dorm_spatial_v1", JSON.stringify(state));
      await workbench.legacy.flushStore();
    });
    assert.equal((await page.evaluate(() => workbench.legacy.demoStatus())).hasRealData, true, "custom dorm setting must count as real data");
    await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem("nnuzc_dorm_spatial_v1"));
      state.settings.defaultBedCount = 4;
      localStorage.setItem("nnuzc_dorm_spatial_v1", JSON.stringify(state));
      await workbench.legacy.flushStore();
    });
    assert.equal((await page.evaluate(() => workbench.legacy.demoStatus())).hasRealData, false, "empty default dorm state must not block demo data");
    const loaded = await page.evaluate(() => workbench.legacy.demoLoad());
    assert.equal(loaded.status.active, true, JSON.stringify(loaded));
    assert.deepEqual(errors, []);
    console.log("Demo data after full browser clear: clean snapshot / reload / load passed.");
  } finally {
    await browser.close();
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
