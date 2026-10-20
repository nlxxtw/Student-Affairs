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
    await page.goto(origin + "/?goto=dorm", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__DORM_SPATIAL__ && typeof window.applyDormDistribution === "function");
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0, ORG_DEPTS.length, { name: "测试学院", code: "DB" });
      ORG_MAJORS.splice(0, ORG_MAJORS.length, { name: "测试专业", dept: "测试学院", code: "DB01" });
      ORG_GRADES.splice(0, ORG_GRADES.length, { name: "2026" });
      ORG_CLASSES.splice(0, ORG_CLASSES.length, { name: "测试1班", dept: "测试学院", major: "测试专业", grade: "2026" });
      saveOrgs();
      students = [
        { id: "DB001", name: "住宿测试甲", status: "在校", dept: "测试学院", major: "测试专业", grade: "2026", cls: "测试1班" },
        { id: "DB002", name: "住宿测试乙", status: "在校", dept: "测试学院", major: "测试专业", grade: "2026", cls: "测试1班" },
        { id: "DB003", name: "住宿测试丙", status: "在校", dept: "测试学院", major: "测试专业", grade: "2026", cls: "测试1班" }
      ];
      dormDistRecords = [];
      persistStudents();
      applyDormDistribution("DB001", { accom: "校内", zone: "南区", building: "测试1栋", room: "101", bed: "1" });
      applyDormDistribution("DB002", { accom: "校内", zone: "南区", building: "测试1栋", room: "101", bed: "2" });
      applyDormDistribution("DB003", { accom: "校内", zone: "南区", building: "测试1栋", room: "102", bed: "1" });
      const state = __DORM_SPATIAL__.getState();
      const room = state.rooms.find(item => item.building === "测试1栋" && item.room === "101");
      state.leaders.push({ id: "leader-db001", roomId: room.id, studentId: "DB001", role: "dorm_leader", status: "current", effectiveFrom: new Date().toISOString(), effectiveTo: "", changeReason: "测试", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      __DORM_SPATIAL__.restoreState(state);
      await workbench.legacy.flushStore();
      setQueryReady("dorm", true);
      await goto("dorm");
      dormSpatialSetTab("distribution");
    });

    const clearButton = page.getByRole("button", { name: /批量清除住宿/ });
    await clearButton.click();
    await page.getByText("请先勾选要批量清除住宿的学生", { exact: true }).waitFor();

    for (const id of ["DB001", "DB002"]) await page.locator(`.dorm-batch-cb[value="${id}"]`).check();
    await clearButton.click();
    assert.match(await page.locator("#modalTitle").innerText(), /批量清除住宿（2人）/);
    const confirmation = await page.locator("#modalBody").innerText();
    assert.match(confirmation, /释放当前床位/);
    assert.match(confirmation, /结束宿舍长身份/);
    assert.match(confirmation, /保留入住历史/);
    assert.match(confirmation, /不会删除学生和宿舍资源/);
    await page.getByRole("button", { name: "确认清除", exact: true }).click();
    await page.waitForFunction(() => !document.getElementById("modal").classList.contains("show"));
    await page.evaluate(async () => { await workbench.legacy.flushStore(); });

    const result = await page.evaluate(() => {
      const selected = students.filter(student => ["DB001", "DB002"].includes(student.id));
      const untouched = students.find(student => student.id === "DB003");
      const state = __DORM_SPATIAL__.getState();
      return {
        selected: selected.map(student => ({ id: student.id, values: [student.accom, student.zone, student.building, student.room, student.bed] })),
        untouched: [untouched.accom, untouched.zone, untouched.building, untouched.room, untouched.bed],
        records: dormDistRecords.map(record => String(record.studentId || record.id)),
        currentAssignments: state.assignments.filter(item => item.status === "current").map(item => item.studentId),
        endedAssignments: state.assignments.filter(item => item.status === "ended").map(item => item.studentId),
        currentLeaders: state.leaders.filter(item => item.status === "current").map(item => item.studentId),
        endedLeaders: state.leaders.filter(item => item.status === "ended").map(item => item.studentId),
        selectedCount: dormBatchSel.size
      };
    });
    assert.deepStrictEqual(result.selected, [
      { id: "DB001", values: ["", "", "", "", ""] },
      { id: "DB002", values: ["", "", "", "", ""] }
    ]);
    assert.deepStrictEqual(result.untouched, ["校内", "南区", "测试1栋", "102", "1"]);
    assert.deepStrictEqual(result.records, ["DB003"]);
    assert.deepStrictEqual(result.currentAssignments, ["DB003"]);
    assert.deepStrictEqual(result.endedAssignments.sort(), ["DB001", "DB002"]);
    assert.deepStrictEqual(result.currentLeaders, []);
    assert.deepStrictEqual(result.endedLeaders, ["DB001"]);
    assert.strictEqual(result.selectedCount, 0);

    await page.reload({ waitUntil: "networkidle" });
    const persisted = await page.evaluate(() => ({
      cleared: students.filter(student => ["DB001", "DB002"].includes(student.id)).every(student => [student.accom, student.zone, student.building, student.room, student.bed].every(value => value === "")),
      untouched: students.find(student => student.id === "DB003").building,
      records: dormDistRecords.map(record => String(record.studentId || record.id)),
      history: __DORM_SPATIAL__.getState().assignments.filter(item => item.status === "ended").map(item => item.studentId).sort()
    }));
    assert.deepStrictEqual(persisted, { cleared: true, untouched: "测试1栋", records: ["DB003"], history: ["DB001", "DB002"] });
    assert.deepStrictEqual(errors, []);
    console.log("Dorm batch clear: confirmation / atomic clear / bed and leader release / history / persistence passed.");
  } finally {
    await browser.close();
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
