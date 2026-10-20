"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
    await page.goto(origin + "/?goto=student", { waitUntil: "networkidle" });

    const suggestion = await page.evaluate(() => importSmartMatchSuggestion("政治面貌", "中国共产主义青年团团员", political));
    assert.equal(suggestion.value, "共青团员");
    assert.equal(suggestion.kind, "alias");

    await page.evaluate(() => {
      window.__qaSmartRows = [{ "政治面貌": "中国共产主义青年团团员" }, { "政治面貌": "中国共产主义青年团团员" }];
      window.__qaSmartPromise = importConfirmApproximateMatches("学生管理", window.__qaSmartRows, ["政治面貌"]);
    });
    const layer = page.locator("#importSmartMatchLayer");
    await layer.waitFor({ state: "visible" });
    assert.match(await layer.innerText(), /发现 1 项非标准填写/);
    assert.match(await layer.innerText(), /中国共产主义青年团团员/);
    assert.match(await layer.innerText(), /共青团员/);
    assert.match(await layer.innerText(), /第 2、3 行/);
    assert.deepEqual(await page.evaluate(() => window.__qaSmartRows.map(row => row["政治面貌"])), ["中国共产主义青年团团员", "中国共产主义青年团团员"], "opening the dialog must not silently rewrite values");
    assert.equal(await layer.locator("select[data-smart-match-index='0'] option:checked").innerText(), "共青团员");
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    const applied = await page.evaluate(() => window.__qaSmartPromise);
    assert.deepEqual(applied, { confirmed: true, applied: 2, unresolved: 0 });
    assert.deepEqual(await page.evaluate(() => window.__qaSmartRows.map(row => row["政治面貌"])), ["共青团员", "共青团员"]);

    await page.evaluate(() => {
      window.__qaSmartRows = [{ "政治面貌": "中国共产主义青年团团员" }];
      window.__qaSmartPromise = importConfirmApproximateMatches("学生管理", window.__qaSmartRows, ["政治面貌"]);
    });
    await layer.waitFor({ state: "visible" });
    await layer.locator("select[data-smart-match-index='0']").selectOption({ label: "群众" });
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    assert.equal((await page.evaluate(() => window.__qaSmartRows[0]["政治面貌"])), "群众", "the user must be able to choose another standard value");

    await page.evaluate(() => {
      window.__qaSmartRows = [{ "政治面貌": "无法判断的面貌" }];
      window.__qaSmartPromise = importConfirmApproximateMatches("学生管理", window.__qaSmartRows, ["政治面貌"]);
    });
    await layer.waitFor({ state: "visible" });
    assert.equal(await layer.locator("select[data-smart-match-index='0']").inputValue(), "-1", "low-confidence matches must not be preselected");
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    const unresolved = await page.evaluate(async () => ({ result: await window.__qaSmartPromise, value: window.__qaSmartRows[0]["政治面貌"], errors: importEnumRows("学生管理", window.__qaSmartRows, ["政治面貌"]).length }));
    assert.equal(unresolved.value, "无法判断的面貌");
    assert.equal(unresolved.result.unresolved, 1);
    assert.equal(unresolved.errors, 1, "kept invalid values must still be rejected by normal import validation");

    await page.evaluate(() => {
      window.__qaSmartRows = [{ "性别": "男性" }];
      window.__qaSmartPromise = importConfirmApproximateMatches("学生管理", window.__qaSmartRows, ["性别"]);
    });
    await layer.waitFor({ state: "visible" });
    await layer.getByRole("button", { name: "取消并返回" }).click();
    const cancelled = await page.evaluate(async () => ({ result: await window.__qaSmartPromise, value: window.__qaSmartRows[0]["性别"] }));
    assert.deepEqual(cancelled.result, { confirmed: false, applied: 0, unresolved: 1 });
    assert.equal(cancelled.value, "男性", "cancel must leave the parsed import data untouched");

    await page.evaluate(() => {
      window.__qaXssTriggered = false;
      const row = { "政治面貌": '<img src=x onerror="window.__qaXssTriggered=true">' };
      Object.defineProperty(row, "__importRowNumber", { value: 17, enumerable: false });
      window.__qaSmartRows = [row];
      window.__qaSmartPromise = importConfirmApproximateMatches("学生管理", window.__qaSmartRows, ["政治面貌"]);
    });
    await layer.waitFor({ state: "visible" });
    assert.match(await layer.innerText(), /第 17 行/, "the confirmation dialog must preserve the source workbook row number");
    assert.equal(await layer.locator("img").count(), 0, "imported text must never be interpreted as dialog HTML");
    assert.equal(await page.evaluate(() => window.__qaXssTriggered), false, "imported event-handler text must not execute");
    await layer.getByRole("button", { name: "取消并返回" }).click();

    await page.evaluate(() => {
      window.__qaSmartRows = [{ "自定义状态": "__keep" }];
      window.__qaSmartPromise = importConfirmApproximateMatches("测试导入", window.__qaSmartRows, [{ label: "自定义状态", options: ["__keep__", "正常"] }]);
    });
    await layer.waitFor({ state: "visible" });
    await layer.locator("select[data-smart-match-index='0']").selectOption({ label: "__keep__" });
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    assert.equal(await page.evaluate(() => window.__qaSmartRows[0]["自定义状态"]), "__keep__", "a real option named like the former sentinel must remain selectable");

    const overflow = await page.evaluate(async () => {
      const rows = Array.from({ length: IMPORT_SMART_MATCH_MAX_ISSUES + 1 }, (_, index) => ({ "性别": "未知性别" + index }));
      const result = await importConfirmApproximateMatches("学生管理", rows, ["性别"]);
      return { result, layer: !!document.getElementById("importSmartMatchLayer") };
    });
    assert.equal(overflow.result.confirmed, false);
    assert.equal(overflow.result.tooMany, true, "too many distinct invalid values must be rejected before building a huge dialog");
    assert.equal(overflow.layer, false);

    await page.evaluate(() => {
      const importTerm = "2026-2027-1学期"; if (getTermList().indexOf(importTerm) < 0) saveTermList(getTermList().concat(importTerm));
      let term = document.getElementById("aiImportTerm"); if (!term) { term = document.createElement("select"); term.id = "aiImportTerm"; document.body.appendChild(term); }
      term.innerHTML = `<option value="${importTerm}">${importTerm}</option>`; term.value = importTerm;
      aiImportState = { rows: [{ "是否贫困生": "有" }], map: { "是否贫困生": "是否贫困生" } };
      window.__qaFundSmartPromise = aiImportDo();
    });
    await layer.waitFor({ state: "visible" });
    assert.match(await layer.innerText(), /资助情况[\s\S]*是否贫困生[\s\S]*有[\s\S]*是/);
    await layer.getByRole("button", { name: "取消并返回" }).click();
    await page.evaluate(() => window.__qaFundSmartPromise);
    assert.equal(await page.evaluate(() => aiImportState.rows[0]["是否贫困生"]), "有", "cancelling the legacy smart fund import must leave its parsed row unchanged");

    const unsafeHeader = await page.evaluate(async () => {
      try { await parseWorkbookToRows(new File(["__proto__,姓名\n污染,测试"], "unsafe.csv", { type: "text/csv" }), ["姓名"]); return ""; }
      catch (error) { return error.message; }
    });
    assert.match(unsafeHeader, /不安全字段名/);
    const physicalRow = await page.evaluate(async () => {
      const rows = await parseWorkbookToRows(new File(["导入说明\n\n政治面貌\n中国共产主义青年团团员"], "row-number.csv", { type: "text/csv" }), ["政治面貌"]);
      return { rowNumber: rows[0].__importRowNumber, issueRow: importSmartMatchIssues("学生管理", rows, ["政治面貌"])[0].occurrences[0].rowNumber };
    });
    assert.deepEqual(physicalRow, { rowNumber: 4, issueRow: 4 }, "blank and preamble lines must not shift the reported source row number");
    const oversized = await page.evaluate(async () => {
      try { await smartReadWorkbook({ name: "oversized.csv", size: IMPORT_FILE_MAX_BYTES + 1, text: async () => "姓名\n测试" }); return ""; }
      catch (error) { return error.message; }
    });
    assert.match(oversized, /不能超过 20MB/);

    await page.evaluate(async () => {
      openMappedImportWizard({
        name: "党团员发展",
        fields: [{ key: "political", label: "政治面貌", options: political }],
        file: new File(["政治面貌\n中国共产主义青年团团员"], "party-smart-match.csv", { type: "text/csv" }),
        apply: () => ({ ok: 1, skip: 0 })
      });
      await mappedImportNext();
      await mappedImportNext();
      mappedImportNext();
    });
    await layer.waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => window.__mappedImportState.mappedRows[0].political), "中国共产主义青年团团员", "mapped wizard must wait for confirmation before rewriting");
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    await page.waitForFunction(() => window.__mappedImportState.step === 3);
    assert.equal(await page.evaluate(() => window.__mappedImportState.validRows[0].political), "共青团员", "mapped wizard must validate the confirmed standard value");
    await page.evaluate(() => closeModal());

    await page.evaluate(() => {
      if (!ORG_DEPTS.some(item => item.name === "智能匹配测试学院")) ORG_DEPTS.push({ name: "智能匹配测试学院", code: "SMART" });
      if (!ORG_MAJORS.some(item => item.name === "智能匹配测试专业")) ORG_MAJORS.push({ name: "智能匹配测试专业", code: "SMART01", dept: "智能匹配测试学院" });
      if (!ORG_GRADES.some(item => item.name === "2026级")) ORG_GRADES.push({ name: "2026级" });
      if (!ORG_CLASSES.some(item => item.name === "智能匹配测试班")) ORG_CLASSES.push({ name: "智能匹配测试班", dept: "智能匹配测试学院", major: "智能匹配测试专业", grade: "2026级" });
      stuImport();
      const input = document.getElementById("stuImportFile"), transfer = new DataTransfer();
      transfer.items.add(new File(["学号,姓名,班级,学籍状态,政治面貌\nSMART001,匹配测试学生,智能匹配测试班,在校,中国共产主义青年团团员"], "student-smart-match.csv", { type: "text/csv" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.evaluate(async () => { await stuImportNext(); await stuImportNext(); stuImportNext(); });
    await layer.waitFor({ state: "visible" });
    assert.match(await layer.innerText(), /政治面貌[\s\S]*中国共产主义青年团团员/);
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    await page.waitForFunction(() => document.getElementById("stuImpSummary")?.style.display === "");
    assert.equal(await page.locator("#kOk").innerText(), "1");
    assert.equal(await page.locator("#kFail").innerText(), "0", "confirmed student political-status alias must pass the original validator");
    await page.evaluate(() => closeModal());

    await page.evaluate(() => {
      maintImport("class");
      document.getElementById("maintImportText").value = "班级名称\t年级\t专业\t所属学院\t学历\n智能匹配新增班\t2026级\t智能匹配测试专业\t智能匹配测试学院\t本科学历";
      window.__qaMaintPreviewPromise = maintImportPreview("class");
    });
    await layer.waitFor({ state: "visible" });
    assert.match(await layer.innerText(), /学历[\s\S]*本科学历[\s\S]*本科/);
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    await page.evaluate(() => window.__qaMaintPreviewPromise);
    assert.equal(await page.evaluate(() => window.__maintImportData.ok[0].level), "本科", "pasted base-data imports must also use the explicit matching flow");
    await page.evaluate(() => closeModal());

    await page.goto(origin + "/?goto=studentOrgHome", { waitUntil: "networkidle" });
    const orgFrame = page.frameLocator("iframe").first();
    await orgFrame.locator("body").waitFor();
    await orgFrame.locator("body").evaluate(() => {
      window.__qaOrgRows = [["任务标题", "优先级", "阶段"], ["测试任务", "紧急", "未开始"]];
      window.__qaOrgPromise = confirmStudentOrgImportMatches("task", window.__qaOrgRows);
    });
    await layer.waitFor({ state: "visible" });
    assert.match(await layer.innerText(), /优先级[\s\S]*紧急[\s\S]*阶段[\s\S]*未开始/);
    await layer.getByRole("button", { name: "确认并应用修正" }).click();
    const orgResult = await orgFrame.locator("body").evaluate(async () => ({ confirmed: await window.__qaOrgPromise, row: window.__qaOrgRows[1] }));
    assert.equal(orgResult.confirmed, true);
    assert.deepEqual(orgResult.row, ["测试任务", "高", "待办"], "student-organization imports must use the same explicit smart-match confirmation flow");
    const orgWrite = await orgFrame.locator("body").evaluate(() => {
      const before = DB.tasks.length;
      importTaskRows(window.__qaOrgRows);
      const validWritten = DB.tasks.length === before + 1 && DB.tasks[0].title === "测试任务" && DB.tasks[0].priority === "high" && DB.tasks[0].stage === "todo";
      const beforeInvalid = DB.tasks.length;
      importTaskRows([["任务标题", "优先级", "阶段"], ["不应写入", "未知优先级", "未知阶段"]]);
      return { validWritten, invalidRejected: DB.tasks.length === beforeInvalid };
    });
    assert.equal(orgWrite.validWritten, true, "confirmed corrections must be written through the real student-organization task importer");
    assert.equal(orgWrite.invalidRejected, true, "kept invalid fixed-option values must still be rejected by the real importer");
    assert.deepEqual(errors, []);
    console.log("Import smart matching: suggestions, explicit confirmation, manual override, keep and cancel passed.");
  } finally {
    await browser.close();
  }
}).catch(error => { console.error(error); process.exitCode = 1; });
