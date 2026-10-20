"use strict";

// Full Excel/UI/persistence regression. Every resident and all resources are
// synthetic; the helper starts a disposable checkout with its own test license.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const XLSX = require("../assets/xlsx.full.min.js");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));

function excel(name, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "导入数据");
  return { name: name + ".xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(XLSX.write(workbook, { type: "array", bookType: "xlsx" })) };
}

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    const errors = [], dialogs = [], saveTimings = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    page.on("requestfinished", request => { if (request.url().endsWith("/api/store/batch")) saveTimings.push(request.timing()); });
    await page.goto(origin + "/?goto=dorm", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__DORM_SPATIAL__ && typeof window.dormSpatialImportRooms === "function");
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0, ORG_DEPTS.length, { name: "虚构学院", code: "DORMQA" });
      ORG_MAJORS.splice(0, ORG_MAJORS.length, { name: "虚构专业", dept: "虚构学院", code: "DORMQA01", years: "4" });
      ORG_CLASSES.splice(0, ORG_CLASSES.length, { name: "虚构测试班", dept: "虚构学院", major: "虚构专业", grade: "2026" });
      saveOrgs();
      students.splice(0, students.length, ...Array.from({ length: 2000 }, (_, i) => ({ id: "DORM-LARGE-" + String(i).padStart(4, "0"), name: "虚构宿舍测试" + i, status: "在校", cls: "虚构测试班", dept: "虚构学院", major: "虚构专业", grade: "2026" })));
      persistStudents();
      await workbench.legacy.flushStore();
      window.__dormImportCalls = {};
      function wrap(owner, key, label) {
        const original = owner[key]; if (typeof original !== "function") return;
        owner[key] = function(...args) {
          const start = performance.now();
          try { return original.apply(this, args); }
          finally { const value = __dormImportCalls[label] || (__dormImportCalls[label] = { calls: 0, ms: 0, maxMs: 0 }); const duration = performance.now() - start; value.calls++; value.ms += duration; value.maxMs = Math.max(value.maxMs, duration); }
        };
      }
      for (const key of ["dormImportApplyRows", "dormImportValidate", "dormImportMissingResources", "dormApplyRowsAtomically", "persistStudents", "persistDormDist", "saveOrgs", "sortWorkbenchCollections", "renderPage", "goto"]) wrap(window, key, key);
      for (const key of ["onAccommodationChanged", "onStudentDataChanged", "syncFromLegacy"]) wrap(__DORM_SPATIAL__, key, "spatial." + key);
      window.__dormImportLongTasks = [];
      window.__dormImportObserver = new PerformanceObserver(list => list.getEntries().forEach(entry => window.__dormImportLongTasks.push({ start: entry.startTime, duration: entry.duration })));
      window.__dormImportObserver.observe({ type: "longtask", buffered: false });
    });

    async function preview(file) {
      await page.locator("#mappedImportFile").setInputFiles(file);
      await page.getByRole("button", { name: /下一步/ }).click();
      await page.locator(".import-preview").waitFor();
      await page.getByRole("button", { name: /下一步/ }).click();
      await page.locator(".import-field-table").waitFor();
      await page.getByRole("button", { name: /校验数据/ }).click();
      await page.locator(".import-summary").waitFor();
    }
    async function finish() {
      await page.getByText("导入完成", { exact: true }).waitFor();
      await page.getByRole("button", { name: "完成", exact: true }).click();
    }
    async function snapshot() {
      return page.evaluate(() => {
        const spatial = __DORM_SPATIAL__.getState(), ids = new Set(students.filter(s => s.id.startsWith("DORM-LARGE-")).map(s => s.id));
        return {
          residents: students.filter(s => ids.has(s.id)).map(s => [s.id, s.accom, s.zone, s.building, s.room, s.bed]).sort(),
          records: dormDistRecords.filter(r => ids.has(r.studentId)).map(r => [r.studentId, r.accom, r.zone, r.building, r.room, r.bed]).sort(),
          buildings: spatial.buildings.map(b => [b.zone, b.building]).sort(),
          rooms: spatial.rooms.map(r => [r.zone, r.building, r.room, r.bedCount]).sort(),
          assignments: spatial.assignments.filter(a => a.status === "current" && ids.has(a.studentId)).map(a => [a.studentId, a.roomId, a.bedNo]).sort()
        };
      });
    }

    const rows = [["学号", "姓名", "住宿情况", "区位", "宿舍楼", "房间号", "床位号"]];
    for (let i = 0; i < 2000; i++) rows.push(["DORM-LARGE-" + String(i).padStart(4, "0"), "虚构宿舍测试" + i, "校内", "虚构东区", "虚构楼" + (Math.floor(i / 200) + 1), String(100 + Math.floor(i / 4) % 50), String(i % 4 + 1)]);
    const startedAt = await page.evaluate(() => performance.now());
    await page.evaluate(() => dormImport());
    await preview(excel("2000条虚构住宿信息", rows));
    assert.match(await page.locator("#modalBody").innerText(), /校验通过/);
    assert.match(await page.getByRole("button", { name: /确认导入/ }).innerText(), /2000/);

    let releaseSave, signalStarted, saveRequests = 0;
    const held = new Promise(resolve => { releaseSave = resolve; });
    const saveStarted = new Promise(resolve => { signalStarted = resolve; });
    await page.route("**/api/store/batch", async route => { saveRequests++; signalStarted(); await held; await route.continue(); });
    const commitStart = Date.now();
    await page.getByRole("button", { name: /确认导入/ }).click();
    await Promise.race([saveStarted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("import did not reach persistence in 15 seconds")), 15000); timer.unref(); })]);
    try {
      assert.strictEqual(await page.getByText("导入完成", { exact: true }).count(), 0, "must wait for the durable write before reporting success");
      assert.strictEqual(await page.getByRole("button", { name: /确认导入/ }).isDisabled(), true, "commit button is disabled while pending");
      await page.evaluate(() => { mappedImportCommit(); mappedImportCommit(); });
      assert.strictEqual(saveRequests, 1, "repeated commit attempts must not start another batch");
    } finally { releaseSave(); }
    await finish();
    const commitMs = Date.now() - commitStart;
    await page.unroute("**/api/store/batch");
    assert.strictEqual(dialogs.filter(message => /自动新增/.test(message)).length, 1, "one confirmation covers all new rooms");
    const imported = await snapshot();
    assert.strictEqual(imported.records.length, 2000);
    assert.strictEqual(imported.assignments.length, 2000);
    assert.strictEqual(imported.rooms.length, 500);
    assert.strictEqual(imported.buildings.length, 10);
    assert.ok(imported.residents.every(row => row[1] === "校内" && row[5]), "all student projections must have a bed");
    assert.strictEqual(new Set(imported.assignments.map(row => row[1] + ":" + row[2])).size, 2000, "no duplicate occupied bed");
    const timing = await page.evaluate(start => ({ elapsedMs: performance.now() - start, longTasks: __dormImportLongTasks.filter(task => task.start >= start).map(task => task.duration) }), startedAt);
    console.log(JSON.stringify({ phase: "2000-row import", commitMs, maxLongTaskMs: Math.round(Math.max(0, ...timing.longTasks)), saveRequests, calls: await page.evaluate(() => __dormImportCalls), saveTimings: saveTimings.map(t => ({ requestStart: t.requestStart, responseStart: t.responseStart, responseEnd: t.responseEnd })) }));
    assert.ok(commitMs < 15000, "2000-row import must finish within 15 seconds: " + commitMs + " ms");
    assert.ok(Math.max(0, ...timing.longTasks) < 3000, "import must not freeze the main thread for 3 seconds");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__DORM_SPATIAL__);
    assert.deepStrictEqual(await snapshot(), imported, "refresh must preserve all 2000 records, rooms and occupied beds");

    await page.evaluate(() => dormSpatialSetTab("resources"));
    const card = title => page.locator(".card").filter({ has: page.locator(".dsp-resource-head b", { hasText: title }) });
    async function resourcePreview(title, name, data) {
      await card(title).getByRole("button", { name: "导入", exact: true }).click();
      await preview(excel(name, data));
    }
    const buildingRows = [["区位", "宿舍楼"], ["虚构南区", "重复测试楼"], ["虚构南区", "重复测试楼"], ["虚构南区", "重复测试楼"]];
    await resourcePreview("区位与楼栋资源", "楼栋重复行", buildingRows);
    assert.match(await page.locator(".import-warnings").innerText(), /自动去重 2 行.*保留 1 条/);
    assert.match(await page.getByRole("button", { name: /确认导入/ }).innerText(), /1 条/);
    await page.getByRole("button", { name: /确认导入/ }).click(); await finish();
    assert.strictEqual(await page.evaluate(() => __DORM_SPATIAL__.getState().buildings.filter(b => b.building === "重复测试楼").length), 1);
    const roomRows = [["区位", "宿舍楼", "楼层", "宿舍号", "床位数"], ["虚构南区", "重复测试楼", "1", "0101", "4"], ["虚构南区", "重复测试楼", "1", "0101", "4"]];
    await resourcePreview("宿舍房间与床位", "房间重复行", roomRows);
    assert.match(await page.locator(".import-warnings").innerText(), /自动去重 1 行.*保留 1 条/);
    await page.getByRole("button", { name: /确认导入/ }).click(); await finish();
    const beforeConflict = await snapshot();
    assert.strictEqual(beforeConflict.rooms.filter(row => row[1] === "重复测试楼" && row[2] === "0101").length, 1);
    await resourcePreview("宿舍房间与床位", "同房间床位冲突", [...roomRows.slice(0, 2), ["虚构南区", "重复测试楼", "1", "0101", "6"]]);
    assert.match(await page.locator(".import-errors").innerText(), /冲突/);
    assert.strictEqual(await page.getByRole("button", { name: /确认导入/ }).isDisabled(), true, "conflicting capacity rows must not be submitted");
    await page.evaluate(() => closeModal());
    assert.deepStrictEqual(await snapshot(), beforeConflict, "conflicting preview never writes data");
    await page.reload({ waitUntil: "networkidle" }); await page.waitForFunction(() => window.__DORM_SPATIAL__);
    assert.deepStrictEqual(await snapshot(), beforeConflict, "deduplicated resource imports must survive reload");
    assert.deepStrictEqual(errors, []);
    console.log(JSON.stringify({ test: "qa-dorm-import-large-browser", residents: 2000, rooms: 500, buildings: 10, commitMs, wizardElapsedMs: Math.round(timing.elapsedMs), maxLongTaskMs: Math.round(Math.max(0, ...timing.longTasks)), longTasks: timing.longTasks.length, saveRequests, durableReload: true, duplicateBuildings: "3 rows -> 1", duplicateRooms: "2 rows -> 1", conflictingCapacityBlocked: true }));
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
