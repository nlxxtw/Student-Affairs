"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")].find(file => file && fs.existsSync(file));

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(origin + "/?goto=party", { waitUntil: "networkidle" });
    const engineState = await page.evaluate(async () => ({ type: typeof window.PartyImportEngine, url: location.href, scripts: Array.from(document.scripts).map(script => script.src), sourceStatus: await fetch("/party-import-engine.js").then(response => response.status) }));
    assert.equal(engineState.type, "object", JSON.stringify({ engineState, pageErrors }));
    assert.deepEqual(await page.evaluate(() => ({ stages: PARTY_STAGES, league: PARTY_LEAGUE_STATUSES, political, engineStages: PartyImportEngine.PARTY_STAGES, engineLeague: PartyImportEngine.PARTY_LEAGUE_STATUSES, enginePolitical: PartyImportEngine.POLITICAL_OPTIONS })), {
      stages: ["群众", "共青团员", "递交入党申请书", "入党积极分子", "发展对象", "中共预备党员", "中共党员"],
      league: ["团员", "非团员", "已推优", "保留团员的中共党员", "退团"],
      political: ["中共党员", "中共预备党员", "共青团员", "群众", "其他民主党派"],
      engineStages: ["群众", "共青团员", "递交入党申请书", "入党积极分子", "发展对象", "中共预备党员", "中共党员"],
      engineLeague: ["团员", "非团员", "已推优", "保留团员的中共党员", "退团"],
      enginePolitical: ["中共党员", "中共预备党员", "共青团员", "群众", "其他民主党派"]
    });
    assert.equal(await page.getByRole("button", { name: /导入名册/ }).count(), 1);
    assert.equal(await page.getByRole("button", { name: /下载导入模板/ }).count(), 1);

    await page.evaluate(async () => {
      ORG_DEPTS.splice(0, ORG_DEPTS.length, { name: "测试学院", code: "QA" });
      ORG_MAJORS.splice(0, ORG_MAJORS.length, { name: "测试专业", code: "QA01", dept: "测试学院", years: "4" });
      ORG_CLASSES.splice(0, ORG_CLASSES.length, { name: "测试班", dept: "测试学院", major: "测试专业", grade: "2026", counselor: "测试教师" });
      ORG_GRADES.splice(0, ORG_GRADES.length, { name: "2026" });
      saveOrgs();
      students.length = 0;
      students.push({ id: "000123", name: "导入测试学生", political: "群众", status: "在校", dept: "测试学院", major: "测试专业", grade: "2026", cls: "测试班", phone: "13800000000", party: { stage: "群众", leagueStatus: "非团员", history: [{ stage: "群众", date: "2025-09-01" }] } });
      persistStudents();
      await window.workbench.legacy.flushStore();
    });

    const template = await page.evaluate(() => {
      const original = window.downloadXlsxFile;
      let captured;
      window.downloadXlsxFile = (sheet, rows, fileName, options) => { captured = { sheet, rows, fileName, options }; };
      try { partyImportTemplate(); } finally { window.downloadXlsxFile = original; }
      return captured;
    });
    assert.equal(template.sheet, "党团员发展导入模板");
    assert.deepEqual(template.rows[0], ["学号 *", "姓名", "政治面貌", "团员身份", "当前发展阶段", "确定日期", "所属党支部", "培养联系人", "入党介绍人", "材料状态", "本次节点备注", "初级党课状态", "初级党课日期", "初级党课培训单位", "初级党课培训结果", "中级党课状态", "中级党课日期", "中级党课培训单位", "中级党课培训结果", "高级党课状态", "高级党课日期", "高级党课培训单位", "高级党课培训结果"]);
    assert.equal(template.rows.length, 2, "party template must contain only the header and row 2 example");
    assert.equal(template.rows[1][0], "20240001");
    assert.match(template.rows[1].join(" | "), /张三.*入党积极分子.*已结业.*学院党校/);
    assert.equal(template.options.freezeColumns, 2);
    assert.equal(template.options.columnWidths.length, template.rows[0].length);
    assert.deepEqual(template.options.fixedOptions["政治面貌"], ["中共党员", "中共预备党员", "共青团员", "群众", "其他民主党派"]);
    assert.deepEqual(template.options.fixedOptions["团员身份"], ["团员", "非团员", "已推优", "保留团员的中共党员", "退团"]);
    assert.deepEqual(template.options.fixedOptions["当前发展阶段"], ["群众", "共青团员", "递交入党申请书", "入党积极分子", "发展对象", "中共预备党员", "中共党员"]);
    assert.deepEqual(template.options.fixedOptions["初级党课状态"], ["未参加", "培训中", "已结业", "未通过"]);
    assert.deepEqual(template.options.fixedOptions["中级党课状态"], ["未参加", "培训中", "已结业", "未通过"]);
    assert.deepEqual(template.options.fixedOptions["高级党课状态"], ["未参加", "培训中", "已结业", "未通过"]);

    await page.getByRole("button", { name: /导入名册/ }).click();
    await page.locator("#mappedImportFile").setInputFiles({
      name: "party.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("学号,姓名,政治面貌,团员身份,当前发展阶段,确定日期,所属党支部,培养联系人,入党介绍人,材料状态,本次节点备注,初级党课状态,初级党课日期,初级党课培训单位,初级党课培训结果\n000123,导入测试学生,共青团员,已推优,入党积极分子,2026-10-13,学生第一党支部,王老师,,齐全,批量导入,已结业,2026-09-15,学院党校,优秀", "utf8")
    });
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: /下一步/ }).click();
    await page.getByRole("button", { name: /校验数据/ }).click();
    await page.getByRole("button", { name: /确认导入 1 条/ }).click();
    await page.waitForFunction(() => /导入完成/.test(document.getElementById("modalBody").innerText));
    assert.equal(await page.evaluate(() => students[0].party.stage), "入党积极分子");
    assert.equal(await page.evaluate(() => students[0].phone), "13800000000");
    assert.equal(await page.evaluate(() => students[0].party.history.filter(node => node.stage === "入党积极分子").length), 1);
    assert.deepEqual(await page.evaluate(() => students[0].party.training.primary), { status: "已结业", date: "2026-09-15", organizer: "学院党校", result: "优秀" });
    const exported = await page.evaluate(() => {
      const original = window.downloadXlsxFile;
      let rows;
      window.downloadXlsxFile = (_sheet, data) => { rows = data; };
      try { exportParty(); } finally { window.downloadXlsxFile = original; }
      return rows;
    });
    assert.deepEqual(exported[0], ["学院", "专业", "班级", "学号", "姓名", "政治面貌", "团员身份", "当前发展阶段", "确定日期", "所属党支部", "培养联系人", "入党介绍人", "材料状态", "本次节点备注", "初级党课状态", "初级党课日期", "初级党课培训单位", "初级党课培训结果", "中级党课状态", "中级党课日期", "中级党课培训单位", "中级党课培训结果", "高级党课状态", "高级党课日期", "高级党课培训单位", "高级党课培训结果", "发展历程"]);
    assert.equal(exported[1][10], "王老师");
    assert.equal(exported[1][14], "已结业");
    assert.equal(exported[1][16], "学院党校");
    assert.match(exported[1][26], /群众.*入党积极分子/);
    await page.getByRole("button", { name: "完成" }).click();

    const tampered = await page.evaluate(async () => {
      const baseValue = window.__workbenchStoreSync.values().nnuzc_students;
      const response = await fetch("/api/party/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseValue, rows: [{ sid: "000123", stage: "伪造阶段" }] }) });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(tampered.status, 400);
    assert.match(tampered.body.error, /当前发展阶段/);
    const oversized = await page.evaluate(async () => {
      const baseValue = window.__workbenchStoreSync.values().nnuzc_students;
      const response = await fetch("/api/party/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseValue, rows: new Array(2001).fill({ sid: "000123", stage: "群众" }) }) });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(oversized.status, 400);
    assert.match(oversized.body.error, /2000/);

    const concurrency = await page.evaluate(async () => {
      const initialStore = await fetch("/api/store").then(response => response.json());
      const staleBase = initialStore.nnuzc_students;
      const remoteStudents = JSON.parse(staleBase);
      remoteStudents[0].phone = "13900000000";
      const remoteResponse = await fetch("/api/store/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: [{ key: "nnuzc_students", method: "PUT", baseValue: staleBase, value: JSON.stringify(remoteStudents) }] }) });
      const partyBody = { baseValue: staleBase, rows: [{ sid: "000123", name: "导入测试学生", stage: "发展对象", date: "2026-10-14" }] };
      const mergedResponse = await fetch("/api/party/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(partyBody) });
      const merged = await mergedResponse.json();
      const retriedResponse = await fetch("/api/party/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(partyBody) });
      const afterRetry = await fetch("/api/store").then(response => response.json());
      const conflictBase = afterRetry.nnuzc_students;
      const remoteBranch = JSON.parse(conflictBase);
      remoteBranch[0].party.branch = "远端支部";
      const branchResponse = await fetch("/api/store/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operations: [{ key: "nnuzc_students", method: "PUT", baseValue: conflictBase, value: JSON.stringify(remoteBranch) }] }) });
      const conflictResponse = await fetch("/api/party/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseValue: conflictBase, rows: [{ sid: "000123", stage: "发展对象", branch: "本地支部" }] }) });
      const finalStore = await fetch("/api/store").then(response => response.json());
      return {
        remoteStatus: remoteResponse.status,
        mergedStatus: mergedResponse.status,
        retryStatus: retriedResponse.status,
        branchStatus: branchResponse.status,
        conflictStatus: conflictResponse.status,
        mergedStudents: JSON.parse(merged.storeValues.nnuzc_students),
        finalStudents: JSON.parse(finalStore.nnuzc_students)
      };
    });
    assert.equal(concurrency.remoteStatus, 200);
    assert.equal(concurrency.mergedStatus, 200);
    assert.equal(concurrency.retryStatus, 200);
    assert.equal(concurrency.branchStatus, 200);
    assert.equal(concurrency.conflictStatus, 409);
    assert.equal(concurrency.mergedStudents[0].phone, "13900000000", "unrelated concurrent edits must merge");
    assert.equal(concurrency.mergedStudents[0].party.stage, "发展对象");
    assert.equal(concurrency.finalStudents[0].party.branch, "远端支部", "same-field conflict must keep the committed value");
    assert.equal(concurrency.finalStudents[0].party.history.filter(node => node.stage === "发展对象").length, 1, "retry must remain idempotent");

    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => students.find(student => student.id === "000123").party.stage), "发展对象");
    assert.equal(await page.evaluate(() => students.find(student => student.id === "000123").phone), "13900000000");
    assert.equal(await page.evaluate(() => students.find(student => student.id === "000123").party.branch), "远端支部");
    assert.equal(await page.evaluate(() => students.find(student => student.id === "000123").party.history.filter(node => node.stage === "入党积极分子").length), 1);
    assert.deepEqual(pageErrors, []);
    console.log("qa-party-import-browser: passed (UI, template options, API validation, persistence, reload)");
  } finally {
    await browser.close();
  }
}, { academicWarning: false }).catch(error => { console.error(error); process.exitCode = 1; });
