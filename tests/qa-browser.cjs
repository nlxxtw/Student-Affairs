"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-browser-"));
const port = Number(process.env.XIANGCAI_BROWSER_QA_PORT || 18873);
const origin = `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let browser;
let serverDiagnostics = "";

function loadPlaywright() {
  const candidates = [
    process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, "playwright"),
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error("Playwright is unavailable; set CODEX_NODE_MODULES to its node_modules directory");
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("Microsoft Edge executable was not found; set EDGE_PATH");
  return executable;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch (_error) {}
    await delay(100);
  }
  throw new Error("isolated browser server did not start");
}

async function assertIsolatedPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => reject(new Error(`isolated browser QA port ${port} is already in use; refusing to write test data to an existing service (${error.code || error.message})`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function writeStore(cookie, key, value) {
  const response = await fetch(`${origin}/api/store/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify({ value: JSON.stringify(value) })
  });
  assert.strictEqual(response.status, 200, `could not seed ${key}`);
}

async function verifyPunishmentActions(page, type, recordId) {
  try {
  await page.evaluate(async () => { await window.workbench.legacy.flushStore(); });
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate((targetType) => { window.punishTab = targetType; setQueryReady("punishment", true); window.goto("punishment"); }, type);
  await page.waitForTimeout(50);
  const actionLinks = page.locator("#content [data-punish-action]");
  const actionCount = await actionLinks.count();
  assert.ok(actionCount >= 3, `${type} punishment row is missing action buttons`);

  await page.locator('#content [data-punish-action="view"]').first().click();
  assert.match(await page.locator("#modalTitle").textContent(), type === "school" ? /校级处分详情/ : /学院处分详情/);
  await page.evaluate(() => window.closeModal());

  await page.locator('#content [data-punish-action="edit"]').first().click();
  assert.strictEqual(await page.locator("#pEditId").inputValue(), recordId, `${type} punishment edit opened the wrong record`);
  await page.evaluate(() => window.closeModal());

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('#content [data-punish-action="delete"]').first().click();
  await page.waitForFunction((id) => !punishments.some((record) => String(record.id) === String(id)), recordId, { timeout: 5000 });
  await page.evaluate(async () => { await window.workbench.legacy.flushStore(); });
  await page.reload({ waitUntil: "networkidle" });
  assert.strictEqual(await page.evaluate((id) => punishments.some((record) => String(record.id) === String(id)), recordId), false, `${type} punishment delete did not remove the record after reload`);
  } catch (error) {
    console.error("Punishment action diagnostics:", await page.evaluate(() => ({ view: currentView, tab: window.punishTab, query: queryState.punishment, filter: viewFilter.punishment, modal: document.querySelector('#mask').className, content: document.querySelector('#content').innerText.slice(0,1500), records: punishments.map(row => ({id:row.id,type:row.type})) })).catch(() => null));
    throw error;
  }
}

async function verifySearchableFilters(page) {
  await page.evaluate(() => window.goto("student"));
  await page.waitForTimeout(80);
  const multi = page.locator('.zf-query .qf-multi[data-qf="dept"]');
  assert.strictEqual(await multi.count(), 1, "student department multi-filter is missing");
  assert.strictEqual(await multi.locator('.sf-search-input').count(), 1, "multi-filter search box was not installed");
  await multi.locator('.qf-multi-trigger').click();
  await multi.locator('.sf-search-input').fill("测试学院");
  assert.strictEqual(await multi.locator('.qf-multi-opt:not(.sf-search-hidden) input[type="checkbox"]').count(), 1, "multi-filter search did not narrow options");
  assert.strictEqual(await multi.locator('.qf-multi-opt input[type="checkbox"]').count() > 0, true, "multi-filter must retain visible checkbox inputs");
  await page.keyboard.press("Escape");

  await page.evaluate(() => window.goto("talks"));
  await page.waitForTimeout(80);
  const talkMulti = page.locator('#talksBar .qf-multi[data-qf="dept"]');
  assert.strictEqual(await talkMulti.count(), 1, "talk department multi-filter is missing");
  assert.strictEqual(await talkMulti.locator('.sf-search-input').count(), 1, "talk multi-filter search box was not installed");
  await talkMulti.locator('.qf-multi-trigger').click();
  await talkMulti.locator('.sf-search-input').fill("测试学院");
  const exactTalkOption = talkMulti.locator('.qf-multi-opt:not(.sf-search-hidden) input[type="checkbox"][value="测试学院"]');
  assert.strictEqual(await exactTalkOption.count(), 1, "talk multi-filter search did not retain the exact matching option");
  await exactTalkOption.check();
  assert.strictEqual(await exactTalkOption.isChecked(), true, "talk multi-filter checkbox selection failed");
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "sfQaHost";
    host.innerHTML = '<select data-searchable-filter aria-label="班级"><option value="">全部</option><option value="0929">0929电子商务</option><option value="0930">0930物流管理</option></select>';
    document.body.appendChild(host);
    window.__sfQaChanged = 0;
    host.querySelector("select").addEventListener("change", () => { window.__sfQaChanged += 1; });
    window.SearchableFilterSelects.scan(host);
  });
  const nativeFilter = page.locator('#sfQaHost .sf-native-select');
  assert.strictEqual(await nativeFilter.count(), 1, "native filter select was not enhanced");
  await nativeFilter.locator('.sf-native-trigger').click();
  await nativeFilter.locator('.sf-search-input').fill("物流");
  assert.strictEqual(await nativeFilter.locator('.sf-native-option:not(.sf-search-hidden)').count(), 1, "native filter search did not narrow options");
  await nativeFilter.locator('.sf-native-option:not(.sf-search-hidden)').click();
  assert.deepStrictEqual(await page.evaluate(() => ({ value: document.querySelector("#sfQaHost select").value, changes: window.__sfQaChanged })), { value: "0930", changes: 1 }, "native filter did not preserve select value/change behavior");
  await page.evaluate(() => document.getElementById("sfQaHost").remove());
}

async function verifyCounselorGrowth(page) {
  await page.evaluate(() => window.goto("counselorGrowth"));
  await page.waitForTimeout(100);
  assert.match(await page.locator("#content").innerText(), /辅导员成长档案[\s\S]*本年度成果[\s\S]*尚未上传支撑材料/);
  assert.strictEqual(await page.locator('#nav .nav-item[data-view="counselorGrowth"]').count(), 1, "counselor growth navigation is missing");

  await page.getByRole("button", { name: "👤 个人档案" }).click();
  assert.strictEqual(await page.locator("#modal.cg-profile-modal .cg-profile-dialog").count(), 1, "counselor profile modal layout was not applied");
  assert.match(await page.locator("#modalBody").innerText(), /年度成长材料[\s\S]*基本信息[\s\S]*专业发展方向[\s\S]*导出个人信息预览/);
  await page.fill("#cgProfileName", "测试辅导员");
  await page.fill("#cgProfileUnit", "测试学院");
  await page.fill("#cgProfilePosition", "专职辅导员");
  await page.locator('input[name="cgProfileDirection"][value="思想政治教育"]').check();
  await page.locator('input[name="cgProfileDirection"][value="学风建设"]').check();
  assert.match(await page.locator("#cgProfilePreviewLines").innerText(), /测试辅导员[\s\S]*测试学院[\s\S]*专职辅导员[\s\S]*思想政治教育、学风建设/);
  assert.match(await page.locator("#cgProfileDirectionCount").innerText(), /已选择 2 个方向/);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(150);
  const mobileProfile = await page.locator("#modal.cg-profile-modal").evaluate((node) => ({ modalWidth: node.getBoundingClientRect().width, viewportWidth: window.innerWidth, computedWidth: getComputedStyle(node).width, minWidth: getComputedStyle(node).minWidth, maxWidth: getComputedStyle(node).maxWidth, inlineWidth: node.style.width, directionColumns: getComputedStyle(node.querySelector(".cg-profile-directions")).gridTemplateColumns.split(" ").length }));
  assert.ok(mobileProfile.modalWidth <= mobileProfile.viewportWidth && mobileProfile.directionColumns === 1, "counselor profile modal does not fit narrow screens: " + JSON.stringify(mobileProfile));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "保存个人档案" }).click();
  await page.evaluate(() => window.workbench.legacy.flushStore());
  const profileSaved = await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_counselor_profile_v1);
  assert.deepStrictEqual(profileSaved, { name: "测试辅导员", unit: "测试学院", position: "专职辅导员", directions: ["思想政治教育", "学风建设"] }, "counselor profile was not persisted independently");

  await page.getByRole("button", { name: "＋ 新增成果", exact: true }).first().click();
  assert.strictEqual(await page.locator("#modal.cg-record-modal .cg-record-dialog").count(), 1, "counselor record modal layout was not applied");
  assert.match(await page.locator("#modalBody").innerText(), /成果基本信息[\s\S]*类别专属信息[\s\S]*支撑材料附件/);
  assert.match(await page.locator("#cgUploadTip").innerText(), /一次选择多个文件[\s\S]*单个不超过 100MB[\s\S]*分批追加[\s\S]*重新选择文件会替换/);
  assert.strictEqual(await page.locator("#cgFiles").evaluate(node => node.multiple && node.getAttribute("aria-describedby")==="cgUploadTip"), true, "attachment multi-select hint is not associated with the input");
  assert.strictEqual(await page.locator(".cg-record-flags .cg-record-flag").count(), 2, "archive markers were not rendered as two selectable cards");
  assert.match(await page.locator(".cg-record-flags").innerText(), /代表性成果[\s\S]*重点展示[\s\S]*已归档[\s\S]*台账中标示/);
  assert.strictEqual(await page.locator("#cgEvidenceChecklist, #cgContribution, #cgMilestoneTitle, #cgTags, #cgSourceUrl, #cgNotes, #cgRecordStage").count(), 0, "retired sections or fields remain in the record editor");
  await page.locator("#modalOk").click();
  assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), "cgTitle", "missing title did not focus the required field");
  await page.fill("#cgTitle", "成长成果预览测试");
  assert.strictEqual(await page.locator("#cgRecordPreviewTitle").innerText(), "成长成果预览测试", "record title preview did not update");
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForFunction(() => document.querySelector("#modal.cg-record-modal").getBoundingClientRect().width <= window.innerWidth);
  const mobileRecord = await page.locator("#modal.cg-record-modal").evaluate((node) => ({ modalWidth: node.getBoundingClientRect().width, viewportWidth: window.innerWidth, computedWidth:getComputedStyle(node).width, inlineWidth:node.style.width, minWidth:getComputedStyle(node).minWidth, maxWidth:getComputedStyle(node).maxWidth, scrollWidth:node.scrollWidth, formColumns: getComputedStyle(node.querySelector(".cg-record-section .cg-form")).gridTemplateColumns.split(" ").length, flagColumns: getComputedStyle(node.querySelector(".cg-record-flags")).gridTemplateColumns.split(" ").length }));
  assert.ok(mobileRecord.modalWidth <= mobileRecord.viewportWidth && mobileRecord.formColumns === 1 && mobileRecord.flagColumns === 1, "counselor record modal does not fit narrow screens: " + JSON.stringify(mobileRecord));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#cgRecordType").selectOption("personal_award");
  assert.match(await page.locator("#cgRecordPreviewMeta").innerText(), /个人获奖/, "record category preview did not update");
  await page.fill("#cgTitle", "辅导员成长模块回归荣誉");
  await page.fill("#cgResultDate", "2026-09-15");
  await page.fill("#cgRole", "获奖人");
  await page.locator("#cgRecordLevel").selectOption({ label: "校级" });
  await page.check("#cgRepresentative");
  assert.strictEqual(await page.locator(".cg-record-flag:has(#cgRepresentative:checked)").count(), 1, "selected representative card did not activate");
  await page.waitForTimeout(180);
  const selectedFlagStyle = await page.locator(".cg-record-flags").evaluate((node) => { const cards=node.querySelectorAll(".cg-record-flag");return { display:getComputedStyle(cards[0]).display, selected:getComputedStyle(cards[0]).backgroundColor, unselected:getComputedStyle(cards[1]).backgroundColor }; });
  assert.ok(selectedFlagStyle.display === "flex" && selectedFlagStyle.selected !== selectedFlagStyle.unselected, "archive marker card selection is not visually distinct: " + JSON.stringify(selectedFlagStyle));
  await page.locator(".cg-record-flag:has(#cgArchived)").click();
  assert.strictEqual(await page.locator("#cgArchived").isChecked(), true, "archive card is not clickable");
  await page.locator(".cg-record-flag:has(#cgArchived)").click();
  const evidencePath = path.join(temp, "counselor-growth-evidence.txt");
  fs.writeFileSync(evidencePath, "counselor growth attachment QA", "utf8");
  await page.setInputFiles("#cgFiles", evidencePath);
  await page.locator("#modalOk").click();
  await page.waitForTimeout(100);
  await page.evaluate(() => window.workbench.legacy.flushStore());
  const stored = await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_counselor_growth_records_v1);
  assert.strictEqual(stored.length, 1, "counselor growth record was not persisted to SQLite");
  assert.deepStrictEqual({ type: stored[0].type, title: stored[0].title, representative: stored[0].representative }, { type: "personal_award", title: "辅导员成长模块回归荣誉", representative: true });
  for (const retired of ["stage", "milestoneTitle", "milestoneDate", "contribution", "tags", "notes", "sourceUrl", "evidenceItems"]) assert.strictEqual(Object.hasOwn(stored[0], retired), false, "retired field was persisted: " + retired);
  assert.strictEqual(stored[0].attachments.length, 1, "counselor growth evidence attachment was not persisted");
  const attachmentResult = await page.evaluate(async (attachmentId) => { const response=await fetch("/attachments/"+attachmentId); return { status:response.status, text:await response.text() }; }, stored[0].attachments[0].id);
  assert.deepStrictEqual(attachmentResult, { status:200, text:"counselor growth attachment QA" }, "counselor growth evidence attachment could not be decrypted and read");
  const materialCatalog = await page.evaluate(() => { const original=window.downloadXlsxFile,output=[];window.downloadXlsxFile=(sheet,rows,file)=>output.push({sheet,rows,file});window.counselorGrowthExportMaterials();window.downloadXlsxFile=original;return output; });
  assert.strictEqual(materialCatalog.length, 1, "supporting attachment catalog was not exported");
  const catalogLink = materialCatalog.flatMap(item => item.rows || []).flat().find(value => typeof value === "string" && value.startsWith("/attachments/"));
  assert.strictEqual(new URL(catalogLink, origin).searchParams.get("name"), "counselor-growth-evidence.txt", "catalog download must carry the original filename");
  await page.evaluate(recordId => counselorGrowthView(recordId), stored[0].id);
  const detailLink = await page.locator("#drawerBody .cg-file a").first().getAttribute("href");
  assert.strictEqual(new URL(detailLink, origin).searchParams.get("name"), "counselor-growth-evidence.txt", "detail download must carry the original filename");
  await page.locator("#drawerClose").click();
  await page.evaluate(() => { const key="nnuzc_counselor_growth_records_v1",rows=JSON.parse(localStorage.getItem(key));Object.assign(rows[0],{stage:"已获奖",milestoneTitle:"旧节点",contribution:"旧贡献",evidenceItems:[{label:"旧材料",done:true}]});localStorage.setItem(key,JSON.stringify(rows));window.goto("counselorGrowth"); });
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_records_v1"))[0]);
  assert.strictEqual(migrated.attachments.length, 1, "retired-field migration removed a supporting attachment");
  for (const retired of ["stage", "milestoneTitle", "contribution", "evidenceItems"]) assert.strictEqual(Object.hasOwn(migrated, retired), false, "retired field survived migration: " + retired);

  await page.evaluate((recordId) => window.counselorGrowthOpenRecord(recordId), stored[0].id);
  const evidenceLink = await page.locator("#cgExistingFiles a").first().getAttribute("href");
  assert.strictEqual(new URL(evidenceLink, origin).searchParams.get("name"), "counselor-growth-evidence.txt", "editor download must carry the original filename");
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await page.locator("#modalOk").click();
  await page.waitForTimeout(300);
  assert.deepStrictEqual(await page.evaluate(async () => { const report=await window.workbench.legacy.attachmentMaintenance(); return { totalFiles:report.totalFiles, orphanCount:report.orphanCount }; }), { totalFiles:0, orphanCount:0 }, "removed counselor growth evidence attachment was not cleaned up");

  assert.strictEqual(await page.getByRole("button", { name: "计划与复盘", exact: true }).count(), 0, "retired plan and review tab is still visible");
  assert.strictEqual(await page.evaluate(() => typeof window.counselorGrowthOpenPlan), "undefined", "retired plan editor is still registered");

  await page.evaluate(() => window.counselorGrowthOpenRecord());
  await page.fill("#cgTitle", "独立指导学生获奖测试");
  await page.fill("#cgResultDate", "2026-09-01");
  await page.fill("#cgRole", "指导教师");
  await page.locator("#cgRecordLevel").selectOption({ label: "省部级" });
  await page.fill("#cgStudentNames", "测试学生甲、测试学生乙");
  await page.locator("#cgGuidanceRole").selectOption("第一指导教师");
  await page.fill("#cgPrize", "一等奖");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(100);
  const standalone = await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_records_v1")).find((row) => row.title === "独立指导学生获奖测试"));
  assert.deepStrictEqual({ type: standalone.type, students: standalone.studentNames, prize: standalone.prize }, { type: "guided_student_award", students: ["测试学生甲", "测试学生乙"], prize: "一等奖" }, "standalone guided student award was not saved correctly");
  for (const forbidden of ["relatedStudentIds", "relatedAchievementIds", "sourceSnapshot", "sourceSnapshots", "source"]) assert.strictEqual(Object.prototype.hasOwnProperty.call(standalone, forbidden), false, `standalone record leaked relation field: ${forbidden}`);

  await page.evaluate((id) => window.counselorGrowthToggleArchive(id), standalone.id);
  assert.strictEqual(await page.evaluate((id) => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_records_v1")).find((row) => row.id === id).archived, standalone.id), true, "growth archive flag was not saved");
  await page.evaluate(() => window.counselorGrowthSetTab("ledger"));
  assert.strictEqual(await page.locator("#cgScope").count(), 0, "retired scope filter is still visible");
  assert.strictEqual(await page.locator("#cgStage").count(), 0, "retired status filter is still visible");
  assert.match(await page.locator("#content").innerText(), /独立指导学生获奖测试[\s\S]*已归档/, "archived growth record disappeared after scope filter removal");
  await page.evaluate((id) => window.counselorGrowthToggleArchive(id), standalone.id);

  await page.evaluate((id) => window.counselorGrowthOpenRecord(id), standalone.id);
  await page.fill("#cgTitle", "独立指导学生获奖测试（修改）");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(80);
  const editHistory = await page.evaluate((id) => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_history_v1")).find((row) => row.recordId === id && row.action === "编辑"), standalone.id);
  assert.ok(editHistory && editHistory.before.title === "独立指导学生获奖测试", "growth edit history snapshot was not saved");
  await page.evaluate((historyId) => window.counselorGrowthRestoreHistory(historyId), editHistory.id);
  assert.strictEqual(await page.evaluate((id) => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_records_v1")).find((row) => row.id === id).title, standalone.id), "独立指导学生获奖测试", "growth history restore failed");
  await page.evaluate((historyId) => { const key="nnuzc_counselor_growth_history_v1",rows=JSON.parse(localStorage.getItem(key)),item=rows.find(row=>row.id===historyId);item.before.stage="已获奖";item.after.stage="已获奖";localStorage.setItem(key,JSON.stringify(rows));window.goto("counselorGrowth"); }, editHistory.id);
  const migratedHistory = await page.evaluate((historyId) => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_history_v1")).find(row=>row.id===historyId), editHistory.id);
  assert.strictEqual(Object.hasOwn(migratedHistory.before, "stage") || Object.hasOwn(migratedHistory.after, "stage"), false, "retired status survived history migration");

  await page.evaluate(() => window.counselorGrowthOpenSettings());
  await page.fill("#cgSettingLevels", "行业级");
  assert.strictEqual(await page.locator("#cgSettingStages").count(), 0, "retired status dictionary is still visible");
  await page.fill("#cgSettingDirections", "数字思政");
  await page.fill("#cgSettingTypes", "育人案例");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(80);
  const customSettings = await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_settings_v1")));
  assert.deepStrictEqual({ level: customSettings.extraLevels[0], direction: customSettings.extraDirections[0], type: customSettings.customTypes[0].label }, { level: "行业级", direction: "数字思政", type: "育人案例" }, "growth custom dictionaries were not saved");
  assert.strictEqual(Object.hasOwn(customSettings, "extraStages"), false, "retired status dictionary was persisted");
  await page.evaluate(() => { const key="nnuzc_counselor_growth_settings_v1",value=JSON.parse(localStorage.getItem(key));value.extraStages=["待认定"];value.customTypes[0].stages=["撰写中"];localStorage.setItem(key,JSON.stringify(value));window.goto("counselorGrowth"); });
  const migratedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_settings_v1")));
  assert.strictEqual(Object.hasOwn(migratedSettings, "extraStages") || Object.hasOwn(migratedSettings.customTypes[0], "stages"), false, "retired status settings survived migration");
  await page.evaluate(() => window.counselorGrowthOpenRecord());
  assert.strictEqual(await page.locator('#cgRecordType option', { hasText: "育人案例" }).count(), 1, "custom growth category is unavailable in the record form");
  assert.strictEqual(await page.locator('#cgRecordLevel option', { hasText: "行业级" }).count(), 1, "custom growth level is unavailable in the record form");
  await page.evaluate(() => window.closeModal());

  await page.evaluate(() => window.counselorGrowthOpenImport());
  assert.match(await page.locator("#modalBody").innerText(), /点击下载导入模板[\s\S]*支持 \.xlsx、\.xls、\.csv 文件/);
  const growthImportPath = path.join(temp, "counselor-growth-import.csv");
  fs.writeFileSync(growthImportPath, "\ufeff成果类别,成果名称,级别,成果日期,本人角色,代表性成果\n论文,成长档案独立导入论文,校级,2025-06-01,第一作者,是\n", "utf8");
  await page.setInputFiles("#mappedImportFile", growthImportPath);
  await page.getByRole("button", { name: "下一步 →", exact: true }).click();
  await page.getByRole("button", { name: "下一步 →", exact: true }).click();
  await page.getByRole("button", { name: "校验数据 →", exact: true }).click();
  await page.getByRole("button", { name: /确认导入 1 条/ }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_counselor_growth_records_v1")).some((row) => row.title === "成长档案独立导入论文" && row.type === "paper" && row.representative)), true, "standalone growth CSV import failed");

  await page.evaluate(() => window.counselorGrowthSetTab("stats"));
  assert.match(await page.locator("#content").innerText(), /年度对比[\s\S]*2026[\s\S]*生成完整年度材料 Word/);
  const exports = await page.evaluate(() => {
    const originalXlsx = window.downloadXlsxFile, originalDocx = window.downloadDocxFile;
    const result = { xlsx: [], docx: [] };
    window.downloadXlsxFile = (sheet, rows, file) => result.xlsx.push({ sheet, rows, file });
    window.downloadDocxFile = (file, content) => result.docx.push({ file, content });
    counselorGrowthDownloadTemplate(); counselorGrowthExportExcel(); counselorGrowthExportWord();
    window.downloadXlsxFile = originalXlsx; window.downloadDocxFile = originalDocx;
    return result;
  });
  assert.strictEqual(exports.xlsx.length, 2, "growth template and summary exports were not generated");
  assert.strictEqual(exports.docx.length, 1, "growth annual Word summary was not generated");
  assert.match(exports.docx[0].content, /辅导员年度成长材料[\s\S]*个人信息[\s\S]*测试辅导员[\s\S]*测试学院[\s\S]*思想政治教育、学风建设[\s\S]*成果分类目录[\s\S]*独立指导学生获奖测试[\s\S]*测\*\*\*\*[\s\S]*人工确认/);
  await page.evaluate(() => window.counselorGrowthSetTab("history"));
  assert.match(await page.locator("#content").innerText(), /修改历史[\s\S]*恢复此版本/);
}

async function verifyRequestedMultiSelectCoverage(page) {
  const periodOrder = await page.evaluate(() => {
    const scrambled = [
      { id: 97001, term: "2024-2025-2学期", rows: [] },
      { id: 97002, term: "2026-2027-1学期", rows: [] },
      { id: 97003, term: "2025-2026-2学期", rows: [] },
      { id: 97004, term: "2026-2027-2学期", rows: [] }
    ];
    const previous = window.academicWarningTerms;
    window.academicWarningTerms = scrambled.slice();
    saveAcademicWarningTerms();
    const stored = JSON.parse(localStorage.getItem("nnuzc_academic_warnings")).map((row) => row.term);
    const host = document.createElement("tbody");
    host.innerHTML = renderAcademicWarningTermRows(scrambled);
    const rendered = Array.from(host.querySelectorAll("tr td:first-child"), (cell) => cell.textContent.trim());
    const years = sortAcademicYearsDesc(["2024-2025学年", "2026-2027学年", "2025-2026学年"]);
    window.academicWarningTerms = previous;
    saveAcademicWarningTerms();
    return { stored, rendered, years };
  });
  assert.deepStrictEqual(periodOrder.stored, ["2026-2027-2学期", "2026-2027-1学期", "2025-2026-2学期", "2024-2025-2学期"], "academic-warning save changed newest-first term order");
  assert.deepStrictEqual(periodOrder.rendered, periodOrder.stored, "academic-warning list is not rendered in newest-first term order");
  assert.deepStrictEqual(periodOrder.years, ["2026-2027学年", "2025-2026学年", "2024-2025学年"], "academic-year options are not newest first");

  await page.evaluate(() => {
    const probeTerm = "2026-2027-1学期";
    const terms = getTermList();
    if (!terms.includes(probeTerm)) { terms.push(probeTerm); saveTermList(terms); }
  });
  await page.evaluate(() => window.goto("achievement"));
  await page.waitForTimeout(80);
  const achievementNames = await page.locator("#content .ae-filter .qf-multi").evaluateAll((nodes) => nodes.map((node) => node.dataset.qf).sort());
  assert.deepStrictEqual(achievementNames, ["achievementCategory", "achievementClass", "achievementDept", "achievementGrade", "achievementLevel", "achievementMajor", "achievementSource", "achievementTerm"], "achievement query fields were not all converted to multi-select checkboxes");
  assert.strictEqual(await page.locator("#content .ae-filter .qf-single, #content .ae-filter select").count(), 0, "achievement query bar still contains single-select fields");
  await page.locator('.qf-multi[data-qf="achievementTerm"] .qf-multi-trigger').click();
  await page.locator('.qf-multi[data-qf="achievementTerm"] input[type="checkbox"][value="2025-2026-2学期"]').check();
  await page.locator('.qf-multi[data-qf="achievementTerm"] input[type="checkbox"][value="2026-2027-1学期"]').check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  assert.deepStrictEqual(await page.evaluate(() => achievementFilter.term.slice().sort()), ["2025-2026-2学期", "2026-2027-1学期"], "achievement multi-term query did not retain multiple checked terms");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  assert.strictEqual(await page.locator("#content .ae-filter .qf-multi-text").evaluateAll((nodes) => nodes.every((node) => node.textContent.trim() !== "请选择" && node.textContent.trim().length > 0)), true, "achievement query field names disappeared after reset");

  const workViews = {
    meeting: ["viewTerms_meeting", "dept", "major", "grade", "cls"],
    talks: ["viewTerms_talks", "dept", "major", "grade", "cls", "status"],
    keycare: ["viewTerms_keycare", "keyCareStatus"],
    psych: ["dept", "major", "grade", "cls", "status"],
    home: ["viewTerms_home", "dept", "major", "grade", "cls", "status"],
    events: ["viewTerms_events", "dept", "major", "grade", "cls", "status"],
    checkClass: ["viewTerms_checkClass", "dept", "grade", "cls"],
    checkDorm: ["viewTerms_checkDorm", "hygiene"],
    help: ["viewTerms_help", "type"]
  };
  const workFieldLabels = {
    meeting: ["学期", "学院", "专业", "年级", "班级"],
    talks: ["学期", "学号", "姓名", "学院", "专业", "年级", "班级", "学籍状态"],
    keycare: ["学期", "个案状态"],
    psych: ["学号", "姓名", "学院", "专业", "年级", "班级", "学籍状态"],
    home: ["学期", "学号", "姓名", "学院", "专业", "年级", "班级", "学籍状态"],
    events: ["学期", "学号", "姓名", "学院", "专业", "年级", "班级", "学籍状态"],
    checkClass: ["学期", "学院", "年级", "班级", "课程名称", "任课教师"],
    checkDorm: ["学期", "楼栋", "宿舍号", "卫生情况"],
    help: ["学期", "学号", "姓名", "帮扶类型"]
  };
  for (const [view, expected] of Object.entries(workViews)) {
    await page.evaluate((target) => window.goto(target), view);
    await page.waitForTimeout(50);
    const actual = await page.locator("#content .qf-multi").evaluateAll((nodes) => nodes.map((node) => node.dataset.qf));
    for (const name of expected) assert.ok(actual.includes(name), `${view} is missing multi-select query field ${name}`);
    assert.strictEqual(await page.locator("#content .qf-bar .qf-single, #content .qf-bar select").count(), 0, `${view} query bar still contains a single-select field`);
    assert.strictEqual(await page.locator("#content .qf-multi").evaluateAll((nodes) => nodes.every((node) => node.querySelectorAll('.qf-multi-opt input[type="checkbox"]').length > 0)), true, `${view} contains a multi-select field without checkbox options`);
    assert.strictEqual(await page.locator("#content .qf-multi-text").evaluateAll((nodes) => nodes.every((node) => node.textContent.trim() !== "请选择" && node.textContent.trim().length > 0)), true, `${view} contains a multi-select query field without a visible field name`);
    assert.deepStrictEqual(await page.locator("#content .qf-bar .filter-item > label").allTextContents(), workFieldLabels[view], `${view} query controls are missing the external field labels shown above the inputs`);
  }
  await page.evaluate(() => window.goto("talks"));
  await page.locator('.qf-multi[data-qf="viewTerms_talks"] .qf-multi-trigger').click();
  await page.locator('.qf-multi[data-qf="viewTerms_talks"] input[type="checkbox"][value="2026-2027-1学期"]').check();
  await page.keyboard.press("Escape");
  await page.locator("#talksBar").getByRole("button", { name: "查询", exact: true }).click();
  assert.deepStrictEqual(await page.evaluate(() => viewTermMulti.talks.slice().sort()), ["2025-2026-2学期", "2026-2027-1学期"], "work-record multi-term query did not retain multiple checked terms");
  await page.locator("#talksBar").getByRole("button", { name: "重置", exact: true }).click();
}

async function searchableFilterAudit(scope, view) {
  const findings = await scope.locator("html").evaluate((_root, targetView) => {
    const selector = [
      "select[data-searchable-filter]", ".qf-bar select", ".filter-bar select",
      "[class*='filter'] select", "[class*='Filter'] select", "[id*='filter'] select", "[id*='Filter'] select",
      ".zf-query select", ".dr-roster-filters select", ".si-filter select", ".filter-item select",
      ".toolbar select.in", "select[data-qf]", "select[aria-label*='筛选']"
    ].join(",");
    const label = (node) => node.id || node.getAttribute("data-qf") || node.getAttribute("aria-label") || node.outerHTML.slice(0, 100);
    const missingQf = Array.from(document.querySelectorAll(".qf-single,.qf-multi")).filter((node) => !node.querySelector(".sf-search-input")).map(label);
    const missingNative = Array.from(document.querySelectorAll(selector)).filter((select) => {
      if (select.multiple || Number(select.size || 0) > 1) return false;
      if (select.matches("[data-native-select],.ui-theme-select,.stu-pager-size")) return false;
      if (select.closest(".qf-single,.qf-multi,.sf-native-select,.import-field-table")) return false;
      return select.dataset.sfEnhanced !== "1";
    }).map(label);
    return { view: targetView, missingQf, missingNative };
  }, view);
  return findings.missingQf.length || findings.missingNative.length ? findings : null;
}

async function main() {
  await assertIsolatedPortAvailable();
  for (const name of ["web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "license-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js", "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js", "counselor-growth-module.js", "custom-fields-module.js", "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "index.html", "login.html", "other-violation-module.js", "学生组织管理.html"]) {
    fs.copyFileSync(path.join(root, name), path.join(temp, name));
  }
  installTestLicense(temp);
  fs.mkdirSync(path.join(temp, "assets"));
  for (const name of ["workbench-ui.js", "workbench-ui.css", "tool-history-client.js", "html2pdf.bundle.min.js", "jszip.min.js", "xlsx.full.min.js", "academic-warning-template.doc", "academic-warning-editor-template.html", "login-logo.png", "login-logo-icon.png", "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js", "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css", "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-field-template.xlsx"]) {
    fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
  }
  fs.mkdirSync(path.join(temp, "scripts"));
  for (const name of ["generate-academic-warning.ps1", "validate-academic-warning-template.ps1"]) fs.copyFileSync(path.join(root, "scripts", name), path.join(temp, "scripts", name));
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], {
    cwd: temp,
    env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }),
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr.on("data", chunk => { serverDiagnostics = (serverDiagnostics + chunk.toString()).slice(-12000); });
  await waitForServer();

  const directEntry = await fetch(`${origin}/`, { redirect: "manual" });
  assert.strictEqual(directEntry.status, 200, "opening the workbench must not redirect to login");
  const rawCookie = String(directEntry.headers.get("set-cookie") || "").split(";")[0];
  const cookie = rawCookie.split("=");
  assert.strictEqual(cookie[0], "xiangcai_session");
  const seedStudents = [
    { id: "qa-punish-school", name: "处分测试甲", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", graduateYear: "2026届", status: "在校", accom: "校内", building: "7栋", room: "427", bed: "1", customFields: [{ name: "旧自定义字段", value: "应清理" }], customFieldValues: { legacy: "应清理" } },
    { id: "qa-punish-college", name: "处分测试乙", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", graduateYear: "2026届", status: "在校", accom: "校内", building: "7栋", room: "427", bed: "2" }
  ];
  const seedPunishments = [
    { id: 20260812001, type: "school", studentId: "qa-punish-school", term: "2025-2026-2学期", date: "2026-08-12", level: "警告", status: "处分中", content: "校级处分操作回归测试" },
    { id: "punishment_college_特殊字符_&_<tag>_20260812", type: "college", studentId: "qa-punish-college", term: "2025-2026-2学期", date: "2026-08-12", level: "警告", status: "处分中", content: "学院处分操作回归测试" }
  ];
  await writeStore(rawCookie, "nnuzc_orgs", {
    depts: [{ name: "测试学院", code: "QA" }],
    majors: [{ name: "测试专业", code: "QA01", dept: "测试学院" }],
    classes: [{ name: "测试班", dept: "测试学院", major: "测试专业", grade: "2025" }]
  });
  await writeStore(rawCookie, "nnuzc_term_list", ["2025-2026-2学期"]);
  await writeStore(rawCookie, "nnuzc_current_term", "2025-2026-2学期");
  await writeStore(rawCookie, "nnuzc_term_settings", { "2025-2026-2学期": { startDate: "2026-08-10", totalWeeks: 20 } });
  await writeStore(rawCookie, "nnuzc_students", seedStudents);
  await writeStore(rawCookie, "nnuzc_punishments", seedPunishments);
  await writeStore(rawCookie, "nnuzc_course_schedules", [{
    id: "qa-course-schedule", term: "2025-2026-2学期", cls: "测试班", day: 3, weeks: "1-16", course: "课表自动匹配课程", category: "实验", section: "第3-4节", teacher: "课表教师", location: "课表地点"
  }]);
  await writeStore(rawCookie, "nnuzc_home", [{
    id: "qa-home-detail", term: "2025-2026-2学期", sid: "qa-punish-school", name: "处分测试甲", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", status: "在校",
    date: "2026-08-12", channel: "电话", topic: "家校沟通详情回归", content: "这是仅在详情中显示的完整沟通内容。", result: "这是仅在详情中显示的完整结果反馈。"
  }]);
  await writeStore(rawCookie, "nnuzc_employment_intentions", [
    { id: "qa-employment-intention", sid: "qa-punish-school", name: "处分测试甲", cls: "测试班", intention: "市场就业", graduateSchool: "", graduateMajor: "", englishStatus: "", issues: "暂无" },
    { id: "qa-employment-intention-2", sid: "qa-punish-college", name: "处分测试乙", cls: "测试班", intention: "拟升学-研究生", graduateSchool: "测试大学", graduateMajor: "测试专业", englishStatus: "四级通过", issues: "暂无" }
  ]);
  await writeStore(rawCookie, "nnuzc_employment", [{ id: "qa-employment-tracking", sid: "qa-punish-school", name: "处分测试甲", cls: "测试班", company: "测试单位", industry: "信息服务", type: "签约就业", date: "2026-06-30", note: "" }]);
  await writeStore(rawCookie, "nnuzc_certificate_records", [{
    id: "qa-cert-personal", folder: "qa-punish-school处分测试甲", sid: "qa-punish-school", name: "处分测试甲", attachment: null,
    data: { role: "学生获奖人", term: "2025-2026-2学期", category: "学科竞赛", level: "省级", awardName: "证书增强回归奖项", edition: "2026", track: "个人组", prize: "一等奖", organization: "测试组委会", issuingOrganization: "测试组委会", date: "2026-06-01", teachers: "测试教师", members: "", certificateNo: "QA-CERT-001", verificationUrl: "https://example.edu/verify/QA-CERT-001", evidence: "证书增强自动化回归" },
    status: "pending", recognitionStatus: "done", fieldConfidence: { awardName: 70 }, fieldEvidence: { awardName: "证书标题" }, fieldReviewed: {}, rawText: "证书增强回归 OCR", imageQuality: { width: 1200, height: 800, warnings: ["分辨率偏低"] }, verificationStatus: "未核验", createdAt: "2026-08-12 12:00", createdBy: "本机管理员", createdRole: "sa"
  }]);
  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ executablePath: findEdge(), headless: true });
  const entryContext = await browser.newContext();
  const entryPage = await entryContext.newPage();
  await entryPage.goto(`${origin}/`, { waitUntil: "networkidle" });
  assert.ok(await entryPage.locator("#content").count(), "direct entry must render the workbench page");
  await entryContext.close();
  const context = await browser.newContext();
  await context.addCookies([{ name: cookie[0], value: cookie.slice(1).join("="), url: origin }]);
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().includes("/api/ai/test?mock-upstream-unauthorized=1")) badResponses.push(`${response.status()} ${response.url()}`); });

  await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  if (process.env.QA_TASKS_ONLY === "1" || process.env.QA_STUDENT_PICKER_ONLY === "1") {
    await require('./startup-review-helper.cjs')(page);
    const checks = require("./productivity-browser-checks.cjs");
    if (process.env.QA_TASKS_ONLY === "1") await checks.verifyTasks(page);
    if (process.env.QA_STUDENT_PICKER_ONLY === "1") await checks.verifyStudentPicker(page);
    assert.deepStrictEqual(pageErrors, []);
    assert.deepStrictEqual(consoleErrors, []);
    assert.deepStrictEqual(badResponses, []);
    console.log("qa-browser: productivity focused verification passed");
    return;
  }
  if (process.env.QA_CHECKCLASS_MULTI_ONLY === "1") {
    await require('./startup-review-helper.cjs')(page);
    await page.evaluate(async () => {
      ORG_DEPTS.push({name:"多选学院",code:"MULTI"});
      ORG_MAJORS.push({name:"多选专业",code:"MULTI01",dept:"多选学院"});
      ORG_CLASSES.push({name:"多选二班",dept:"多选学院",major:"多选专业",grade:"2026"});
      students.push(ensureStudentNested({id:"qa-multi-student",name:"多选学生",dept:"多选学院",major:"多选专业",grade:"2026",cls:"多选二班",status:"在校"}));
      for(let i=1;i<=34;i++)students.push(ensureStudentNested({id:"qa-roster-"+String(i).padStart(2,"0"),name:"完整名单学生"+i,dept:i%2?"测试学院":"多选学院",major:i%2?"测试专业":"多选专业",grade:i%2?"2025":"2026",cls:i%2?"测试班":"多选二班",status:"在校"}));
      students.push(ensureStudentNested({id:"qa-roster-inactive-1",name:"休学学生",dept:"测试学院",major:"测试专业",grade:"2025",cls:"测试班",status:"休学"}));
      students.push(ensureStudentNested({id:"qa-roster-inactive-2",name:"毕业学生",dept:"多选学院",major:"多选专业",grade:"2026",cls:"多选二班",status:"毕业"}));
      courseSchedules.push({id:"qa-multi-schedule",term:CURRENT_TERM,cls:"多选二班",day:3,weeks:"1-16",course:"多选课程",section:"第5-6节",teacher:"多选教师"});
      saveOrgs();persistStudents();await window.workbench.legacy.flushStore();
      goto("checkClass");openCheckClassForm();
    });
    async function toggle(id,value,checked=true) {
      const picker=page.locator(`#${id}Picker`);
      await picker.locator('.qf-multi-trigger').click();
      await picker.locator(`.qf-multi-opt input[value="${value}"]`).setChecked(checked);
      await page.keyboard.press("Escape");
    }
    await toggle("ccDept","测试学院");
    assert.deepStrictEqual(await page.locator('#ccCls option').evaluateAll(items=>items.map(o=>o.value)),["测试班"]);
    await toggle("ccDept","多选学院");
    await toggle("ccGrade","2025");
    assert.deepStrictEqual(await page.locator('#ccCls option').evaluateAll(items=>items.map(o=>o.value)),["测试班"]);
    await toggle("ccGrade","2026");
    await toggle("ccCls","测试班");await toggle("ccCls","多选二班");
    assert.deepStrictEqual(await page.evaluate(()=>ccFormValues("ccCls").sort()),["多选二班","测试班"].sort());
    const roster=await page.evaluate(()=>({
      selectable:ccBehaviorStudents().filter(s=>String(s.id).startsWith("qa-roster-")).map(s=>s.id),
      rendered:Array.from(document.querySelectorAll("#ccAbsentOptions .cc-absent-option b")).map(node=>node.textContent).filter(id=>id.startsWith("qa-roster-"))
    }));
    assert.strictEqual(roster.selectable.length,34,"only all 34 active test students should be selectable");
    assert.strictEqual(roster.rendered.length,34,"multi-class attendance roster must not be truncated to 30 students");
    assert.ok(!roster.selectable.some(id=>id.includes("inactive")),"non-enrolled students must not appear in the attendance roster");
    await page.evaluate(()=>ccBehaviorAdd("qa-roster-inactive-1"));
    assert.ok(!(await page.evaluate(()=>ccBehaviorSelected.absent.includes("qa-roster-inactive-1"))),"non-enrolled students must not be addable to the attendance roster");
    await page.fill("#ccDate","2026-08-12");await page.locator("#ccDate").press("Tab");
    assert.strictEqual(await page.locator("#ccSchedule option").count(),3);
    await page.locator("#ccSchedule").selectOption("qa-multi-schedule");
    assert.strictEqual(await page.locator("#ccTeacher").inputValue(),"多选教师");
    assert.strictEqual(await page.evaluate(()=>ccFormValues("ccCls").length),2);
    await page.fill("#ccCourse","多选查课专项");await page.fill("#ccHeadcount","30");
    await page.evaluate(()=>{ccBehaviorAdd("qa-punish-school");ccBehaviorAdd("qa-multi-student");});
    assert.strictEqual(await page.locator("#ccAttended").inputValue(),"28");
    await page.locator("#modalOk").click();
    await page.waitForFunction(()=>checkClassRecords.some(r=>r.course==="多选查课专项"));
    const probe=await page.evaluate(async()=>{
      await window.workbench.legacy.flushStore();
      const r=checkClassRecords.find(r=>r.course==="多选查课专项");
      ccFilter.cls=["多选二班"];
      const matches=checkClassApplyFilter().some(x=>x.id===r.id);
      ccFilter.dept=["测试学院"];const mismatch=checkClassApplyFilter().some(x=>x.id===r.id);
      ccFilter.dept=[];ccFilter.cls=[];checkClassRender();
      const synced=["qa-punish-school","qa-multi-student"].every(id=>students.find(s=>s.id===id).classroom.some(x=>x.sourceCheckClassId===r.id));
      return {classes:r.classes.slice().sort(),departments:r.departments.slice().sort(),grades:r.grades.slice().sort(),matches,mismatch,synced};
    });
    assert.deepStrictEqual(probe,{classes:["多选二班","测试班"].sort(),departments:["多选学院","测试学院"].sort(),grades:["2025","2026"],matches:true,mismatch:false,synced:true});
    assert.match(await page.locator("#checkClassBody").innerText(),/多选二班/);
    const roundtrip=await page.evaluate(()=>{
      let data;const original=downloadXlsxFile;
      try{downloadXlsxFile=function(name,rows){data=rows;};exportCheckClass();}finally{downloadXlsxFile=original;}
      const row={};data[0].forEach(function(h,i){row[h]=data[1][i];});row["课程"]="多选查课导入回读";
      const plan=[{type:"checkClass",records:[row]}],errors=smartImportPreflight(plan);
      const result=errors.length?null:smartImportApplyPlan(plan),record=checkClassRecords.find(r=>r.course===row["课程"]);
      return {exportClasses:row["班级"],errors,ok:result&&result.ok,classes:record&&record.classes.slice().sort(),absent:record&&record.absentStudentIds.slice().sort()};
    });
    assert.deepStrictEqual(roundtrip,{exportClasses:"测试班、多选二班",errors:[],ok:1,classes:["多选二班","测试班"].sort(),absent:["qa-multi-student","qa-punish-school"].sort()});

    await page.reload({waitUntil:"networkidle"});
    await page.evaluate(()=>{goto("checkClass");openCheckClassForm(checkClassRecords.find(r=>r.course==="多选查课专项").id);});
    assert.strictEqual(await page.locator('#ccClsPicker input:checked').count(),2);
    assert.strictEqual(await page.locator('#ccDeptPicker input:checked').count(),2);
    assert.strictEqual(await page.locator('#ccGradePicker input:checked').count(),2);
    await toggle("ccDept","多选学院",false);
    assert.deepStrictEqual(await page.evaluate(()=>ccFormValues("ccCls")),["测试班"]);
    assert.deepStrictEqual(await page.evaluate(()=>ccBehaviorSelected.absent),["qa-punish-school"]);
    await page.locator("#modalOk").click();
    await page.waitForFunction(()=>checkClassRecords.find(r=>r.course==="多选查课专项").classes.length===1);
    assert.strictEqual(await page.evaluate(()=>students.find(s=>s.id==="qa-multi-student").classroom.some(r=>r.sourceCheckClassId===checkClassRecords.find(c=>c.course==="多选查课专项").id)),false);
    await page.evaluate(()=>{checkClassRecords.push({id:"qa-multi-legacy",cls:"测试班",dept:"测试学院",grade:"2025",term:CURRENT_TERM});openCheckClassForm("qa-multi-legacy");});
    assert.deepStrictEqual(await page.evaluate(()=>ccFormValues("ccCls")),["测试班"]);
    assert.deepStrictEqual(pageErrors,[]);assert.deepStrictEqual(consoleErrors,[]);assert.deepStrictEqual(badResponses,[]);
    console.log("qa-checkclass-multi: passed (active-status roster, complete multi-class roster, checkbox interaction, linked filters, cross-college/grade save, attendance sync, reload, edit pruning, legacy compatibility)");
    return;
  }
  if (process.env.QA_ATTENDANCE_LEAVE_ONLY === "1") {
    await page.evaluate(() => { window.goto("checkClass"); window.openCheckClassForm(); });
    assert.ok(await page.locator('[data-cc-behavior="personalLeave"]').count(),"check-class form is missing the personal-leave tab");
    assert.ok(await page.locator('[data-cc-behavior="sickLeave"]').count(),"check-class form is missing the sick-leave tab");
    assert.match(await page.locator("#modalBody").innerText(),/应到人数（非必填）[\s\S]*实到人数（非必填）[\s\S]*请假总人数（非必填）[\s\S]*迟到人数（非必填）/);
    await page.locator("#ccCls").selectOption("测试班", { force: true });
    await page.evaluate(() => ccSyncClassOrgMeta());
    await page.locator("#ccCourse").fill("事假病假字段专项测试");
    await page.locator('[data-cc-behavior="personalLeave"]').click();
    await page.evaluate(() => ccBehaviorAdd("qa-punish-school"));
    await page.locator('[data-cc-behavior="sickLeave"]').click();
    await page.evaluate(() => ccBehaviorAdd("qa-punish-college"));
    for(const selector of ["#ccHeadcount","#ccAttended","#ccLeave","#ccLate"])await page.locator(selector).fill("");
    await page.locator("#modalOk").click();
    await page.waitForTimeout(80);
    const saved=await page.evaluate(() => {
      const record=checkClassRecords.find(item=>item.course==="事假病假字段专项测试"),personal=students.find(item=>item.id==="qa-punish-school"),sick=students.find(item=>item.id==="qa-punish-college");
      return {record:record&&{headcount:record.headcount,attended:record.attended,leave:record.leave,late:record.late,personalLeaveStudentIds:record.personalLeaveStudentIds,sickLeaveStudentIds:record.sickLeaveStudentIds,leaveStudentIds:record.leaveStudentIds},personalLinked:(personal.classroom||[]).some(item=>item.sourceCheckClassId===record.id&&item.type==="事假"),sickLinked:(sick.classroom||[]).some(item=>item.sourceCheckClassId===record.id&&item.type==="病假")};
    });
    assert.deepStrictEqual(saved,{record:{headcount:"",attended:"",leave:"",late:"",personalLeaveStudentIds:["qa-punish-school"],sickLeaveStudentIds:["qa-punish-college"],leaveStudentIds:["qa-punish-school","qa-punish-college"]},personalLinked:true,sickLinked:true},"personal/sick leave attendance or optional counts did not persist correctly");
    const checkClassText=await page.locator("#checkClassBody").innerText();
    assert.match(checkClassText,/请假总人数[\s\S]*事假名单[\s\S]*病假名单/);
    assert.match(checkClassText,/qa-punish-school 处分测试甲[\s\S]*qa-punish-college 处分测试乙/);
    await page.evaluate(() => {window.goto("classroom");setQueryReady("classroom",true);renderPage("classroom");});
    const classroomText=await page.locator("#content").innerText();
    assert.match(classroomText,/课堂考勤记录/);
    assert.match(classroomText,/处分测试甲[\s\S]*事假/);
    assert.match(classroomText,/处分测试乙[\s\S]*病假/);
    await page.evaluate(() => window.openClassroom());
    assert.deepStrictEqual((await page.locator('#absType option').allTextContents()).filter(item=>/假/.test(item)),["事假","病假","公假"],"classroom attendance types must contain all three leave types");
    await page.evaluate(() => {closeModal();window.courseTimetableOpenAttendance("测试班","2025-2026-2学期");});
    await page.waitForTimeout(60);
    assert.ok(await page.locator('[data-cc-behavior="personalLeave"]').count(),"timetable attendance entry is missing personal leave");
    assert.ok(await page.locator('[data-cc-behavior="sickLeave"]').count(),"timetable attendance entry is missing sick leave");
    await page.evaluate(() => {
      closeModal();
      const legacy={id:"qa-legacy-leave",term:"2025-2026-2学期",date:"2026-08-14",cls:"测试班",course:"历史请假兼容测试",leaveStudentIds:["qa-punish-school"],leave:"1",absentStudentIds:[],lateStudentIds:[],earlyStudentIds:[]};
      checkClassRecords.push(legacy);
      const student=students.find(item=>item.id==="qa-punish-school");
      (student.classroom=student.classroom||[]).push({id:"qa-legacy-leave-detail",term:legacy.term,date:legacy.date,course:legacy.course,type:"请假",sourceCheckClassId:legacy.id,sourceCheckClassType:"请假",reason:"查课记录同步：请假"});
      persistCheckClass();persistStudents();openCheckClassForm(legacy.id);
    });
    await page.locator('[data-cc-behavior="personalLeave"]').click();
    assert.match(await page.locator("#ccAbsentSelected").innerText(),/qa-punish-school[\s\S]*处分测试甲/,"legacy generic leave was not loaded into the personal-leave list");
    await page.locator("#modalOk").click();
    await page.waitForTimeout(80);
    const legacyMigrated=await page.evaluate(() => {
      const record=checkClassRecords.find(item=>item.id==="qa-legacy-leave"),student=students.find(item=>item.id==="qa-punish-school");
      return {personal:record.personalLeaveStudentIds,sick:record.sickLeaveStudentIds,linked:(student.classroom||[]).some(item=>item.sourceCheckClassId===record.id&&item.type==="事假"&&item.reason==="查课记录同步：事假")};
    });
    assert.deepStrictEqual(legacyMigrated,{personal:["qa-punish-school"],sick:[],linked:true},"legacy generic leave did not migrate safely to the editable personal-leave structure");
    assert.deepStrictEqual(pageErrors, [], `attendance leave page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `attendance leave console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `attendance leave HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Personal/sick leave attendance and optional attendance counts QA passed across check-class, classroom, and timetable entries.");
    return;
  }
  if (process.env.QA_ORG_EDIT_ONLY === "1") {
    await page.evaluate(() => { window.goto("maint"); window.openDeptEdit("__index__0"); });
    assert.strictEqual(await page.locator("#odCode").isEditable(),true,"college code is still readonly");
    await page.locator("#odCode").fill("QA-NEW");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.openMajorEdit("__index__0"));
    assert.strictEqual(await page.locator("#omCode").isEditable(),true,"major code is still readonly");
    await page.locator("#omCode").fill("QA01-NEW");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.openClassEdit("测试班"));
    assert.strictEqual(await page.locator("#ocName").isEditable(),true,"class name is still readonly");
    await page.locator("#ocName").fill("测试班（新）");
    await page.locator("#modalOk").click();
    const result=await page.evaluate(() => ({
      dept:ORG_DEPTS[0],major:ORG_MAJORS[0],cls:ORG_CLASSES[0],
      students:students.map(item=>({id:item.id,cls:item.cls,deptCode:item.deptCode,majorCode:item.majorCode})),
      schedule:courseSchedules[0]&&courseSchedules[0].cls,
      home:homeRecords[0]&&homeRecords[0].cls,
      storedHome:(JSON.parse(localStorage.getItem("nnuzc_home")||"[]")[0]||{}).cls,
      storedEmployment:(JSON.parse(localStorage.getItem("nnuzc_employment")||"[]")[0]||{}).cls
    }));
    assert.strictEqual(result.dept.code,"QA-NEW");
    assert.strictEqual(result.major.code,"QA01-NEW");
    assert.strictEqual(result.cls.name,"测试班（新）");
    assert.ok(result.students.every(item=>item.cls==="测试班（新）"&&item.deptCode==="QA-NEW"&&item.majorCode==="QA01-NEW"),"organization edits were not synchronized to students");
    assert.deepStrictEqual([result.schedule,result.home,result.storedHome,result.storedEmployment],["测试班（新）","测试班（新）","测试班（新）","测试班（新）"],"class rename was not synchronized to related modules");
    assert.deepStrictEqual(pageErrors, [], `organization edit page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `organization edit console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `organization edit HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Editable college code, major code, and synchronized class-name rename QA passed.");
    return;
  }
  if (process.env.QA_DORM_SPATIAL_ONLY === "1") {
    await page.evaluate(() => { window.confirm=()=>true; window.goto("dorm"); });
    assert.ok(await page.evaluate(() => !!window.__DORM_SPATIAL__),"spatial dorm module did not initialize");
    assert.match(await page.locator("#content").innerText(),/立体化公寓管理[\s\S]*空间总览[\s\S]*住宿分布[\s\S]*公寓资源/);
    assert.match(await page.locator(".dsp-overview-hero").innerText(),/宿舍空间概览[\s\S]*入住率[\s\S]*已住[\s\S]*空床/);
    assert.strictEqual(await page.locator(".dsp-kpis>div").count(),6,"spatial overview KPI cards are incomplete");
    assert.match(await page.locator(".dsp-building-card").innerText(),/7栋[\s\S]*1 间宿舍[\s\S]*427室/);
    const desktopLayout=await page.locator(".dsp-room-row").first().evaluate(node=>({display:getComputedStyle(node).display,overflowX:getComputedStyle(node).overflowX,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}));
    assert.strictEqual(desktopLayout.display,"grid","room cards are not using the responsive grid layout");
    assert.ok(desktopLayout.scrollWidth<=desktopLayout.clientWidth+2&&desktopLayout.overflowX!=="auto","desktop room grid still relies on horizontal scrolling");
    await page.setViewportSize({width:520,height:900});await page.waitForTimeout(40);
    const mobileLayout=await page.locator(".dsp-page").evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,kpiColumns:getComputedStyle(document.querySelector(".dsp-kpis")).gridTemplateColumns.split(" ").length,bedColumns:getComputedStyle(document.querySelector(".dsp-beds")).gridTemplateColumns.split(" ").length,wide:Array.from(node.querySelectorAll("*")).filter(item=>item.getBoundingClientRect().right>node.getBoundingClientRect().right+2).slice(0,8).map(item=>({tag:item.tagName,cls:item.className,width:item.getBoundingClientRect().width,right:item.getBoundingClientRect().right}))}));
    assert.ok(mobileLayout.scrollWidth<=mobileLayout.clientWidth+2,`mobile spatial overview has horizontal overflow: ${JSON.stringify(mobileLayout)}`);
    assert.deepStrictEqual([mobileLayout.kpiColumns,mobileLayout.bedColumns],[2,1],"mobile KPI or bed-card layout did not collapse as designed");
    await page.setViewportSize({width:1280,height:720});
    const initial=await page.evaluate(() => ({summary:window.__DORM_SPATIAL__.summary(),state:window.__DORM_SPATIAL__.getState()}));
    assert.strictEqual(initial.summary.rooms,1,"existing accommodation was not migrated to a room resource");
    assert.strictEqual(initial.summary.occupied,2,"existing residents were not migrated to current assignments");
    assert.ok(initial.summary.configured>=4,"default configurable beds were not generated");
    assert.strictEqual(initial.state.schemaVersion,3,"spatial dorm schema was not upgraded to the bed-note resource version");
    assert.ok(initial.state.buildings.some(item=>item.building==="7栋"),"existing dorm building was not migrated into public resources");
    if(process.env.QA_DORM_LOCATE_ONLY === "1"){
      await page.evaluate(()=>{
        const source=students.find(s=>s.id==="qa-punish-school");
        students.push(Object.assign({},source,{id:"qa-punish-school-extra",room:"428"}),Object.assign({},source,{id:"qa-off-campus",name:"校外测试",accom:"校外",building:"",room:"",bed:""}),Object.assign({},source,{id:"qa-no-dorm",name:"未分配测试",accom:"",building:"",room:"",bed:""}));
        persistStudents();window.__DORM_SPATIAL__.onStudentDataChanged();
        dormSpatialSetFilter("zone","不存在的区位");dormSpatialSetTab("resources");goto("student");stuQuery();
      });
      await page.locator('#stuTbody tr[data-sid="qa-punish-school"] a[title="查看该生宿舍情况"]').click();
      assert.strictEqual(await page.locator('.dsp-tab[aria-selected="true"]').innerText(),"空间总览");
      assert.strictEqual(await page.locator('#dspSpatialKeyword').inputValue(),"qa-punish-school");
      assert.strictEqual(await page.locator('.dsp-room').count(),1,"student location matched a duplicate name or partial student ID");
      assert.match(await page.locator('.dsp-room').innerText(),/427室[\s\S]*处分测试甲[\s\S]*处分测试乙/);
      assert.match(await page.locator('.dsp-page [role="status"]').innerText(),/qa-punish-school[\s\S]*427室[\s\S]*1号床/);
      await page.getByRole('button',{name:'清除筛选',exact:true}).click();
      assert.strictEqual(await page.locator('.dsp-room').count(),2,"clear filters did not restore all rooms");
      await page.evaluate(()=>dormSpatialLocateStudent("qa-punish-school-extra"));
      assert.match(await page.locator('.dsp-room').innerText(),/428室/);
      await page.evaluate(()=>dormSpatialSetFilter("keyword","427"));
      assert.match(await page.locator('.dsp-room').innerText(),/427室/);
      for(const [id,message] of [["qa-off-campus","该生为校外住宿"],["qa-no-dorm","该生暂无可展示的校内宿舍"]]){
        await page.evaluate(id=>dormSpatialLocateStudent(id),id);
        assert.strictEqual(await page.locator('.dsp-room').count(),0);
        assert.match(await page.locator('.dsp-empty').innerText(),new RegExp(message));
      }
      assert.deepStrictEqual(pageErrors,[],`browser runtime errors: ${JSON.stringify(pageErrors)}`);
      assert.deepStrictEqual(consoleErrors,[],`browser console errors: ${JSON.stringify(consoleErrors)}`);
      assert.deepStrictEqual(badResponses,[],`same-origin resource errors: ${JSON.stringify(badResponses)}`);
      console.log("Student name to spatial dorm QA passed: exact identity, stale filters, roommates, reset, off-campus and unassigned.");
      return;
    }
    await page.evaluate(() => {const student=students.find(item=>item.id==="qa-punish-school");Object.assign(student,{gender:"男",phone:"13800000000",counsel:"测试辅导员",ethnic:"汉",political:"共青团员",source:"江苏南京",address:"测试家庭住址",photo:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="});renderPage("dorm");});
    assert.strictEqual(await page.locator(".dsp-operation-tip").first().innerText(),"点击宿舍号编辑宿舍，点击床号查看学生信息","building header operation hint is missing or incorrect");
    await page.locator(".dsp-bed-number").filter({hasText:"1号床"}).first().click();
    assert.match(await page.locator("#modalTitle").innerText(),/学生信息 · 处分测试甲/,"occupied bed number did not open the resident profile");
    await page.evaluate(() => closeModal());
    const residentLink=page.locator('.dsp-student-link').filter({hasText:"处分测试甲"}).first();
    assert.strictEqual(await residentLink.count(),1,"spatial bed card does not expose a clickable resident");
    await residentLink.click();
    assert.match(await page.locator("#modalTitle").innerText(),/学生信息 · 处分测试甲/);
    const profileText=await page.locator("#modalBody").innerText();
    for(const label of ["姓名","学号","性别","学院","专业","年级","班级","住宿情况","区位","楼栋","房间号","床位号","手机号","辅导员","民族","政治面貌","生源地","家庭住址"])assert.match(profileText,new RegExp(label),`spatial resident profile is missing roster field: ${label}`);
    assert.strictEqual(await page.locator('#modalBody [data-roster-field="phone"] b').innerText(),"13800000000","spatial resident profile phone did not sync from student management");
    assert.strictEqual(await page.locator('#modalBody .dsp-student-photo img[alt="处分测试甲的学籍照片"]').count(),1,"spatial resident profile did not display the enrollment photo");
    assert.deepStrictEqual(await page.locator("#modalBody [data-roster-field]").evaluateAll(nodes=>nodes.map(node=>node.dataset.rosterField)),await page.evaluate(()=>window.getDormRosterFieldDefinitions().filter(field=>field[0]!=="idPhoto").map(field=>field[0])),"spatial resident profile fields diverged from the roster definition");
    await page.evaluate(() => closeModal());
    await page.evaluate(() => {students.find(item=>item.id==="qa-punish-school").phone="13900000000";window.dormSpatialOpenStudent("qa-punish-school");});
    assert.strictEqual(await page.locator('#modalBody [data-roster-field="phone"] b').innerText(),"13900000000","spatial resident profile phone did not refresh after the student-management record changed");
    await page.evaluate(() => {students.find(item=>item.id==="qa-punish-school").phone="13800000000";closeModal();});
    const syncResult=await page.evaluate(() => {
      const original=students.find(item=>item.id==="qa-punish-school"),index=students.indexOf(original),snapshot=JSON.parse(JSON.stringify(original)),api=window.__DORM_SPATIAL__,notify=api.onStudentDataChanged;
      let notices=0;api.onStudentDataChanged=function(options){notices++;return notify(options);};
      students.splice(index,1,Object.assign({},original,{name:"公寓同步测试学生",dept:"同步测试学院",major:"同步测试专业",grade:"2099级",cls:"同步测试班",gender:"女",ethnic:"回族",political:"中共党员",source:"同步测试生源地",address:"同步测试家庭住址",phone:"13700000000",counsel:"同步测试辅导员"}));
      persistStudents();renderPage("dorm");window.dormSpatialOpenStudent("qa-punish-school");
      window.__restoreDormStudentSource=function(){const current=students.findIndex(item=>item.id==="qa-punish-school");students.splice(current,1,snapshot);api.onStudentDataChanged=notify;persistStudents();};
      return {notices:notices};
    });
    assert.strictEqual(syncResult.notices,1,"student management persistence did not notify spatial dorm synchronization");
    const syncedFields=await page.locator("#modalBody [data-roster-field]").evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.rosterField,node.querySelector("b").innerText])));
    assert.deepStrictEqual({name:syncedFields.name,dept:syncedFields.dept,major:syncedFields.major,grade:syncedFields.grade,cls:syncedFields.cls,gender:syncedFields.gender,ethnic:syncedFields.ethnic,political:syncedFields.political,source:syncedFields.source,address:syncedFields.address,phone:syncedFields.phone,counsel:syncedFields.counsel},{name:"公寓同步测试学生",dept:"同步测试学院",major:"同步测试专业",grade:"2099级",cls:"同步测试班",gender:"女",ethnic:"回族",political:"中共党员",source:"同步测试生源地",address:"同步测试家庭住址",phone:"13700000000",counsel:"同步测试辅导员"},"spatial dorm student profile did not refresh all student-management fields");
    await page.evaluate(() => {closeModal();window.__restoreDormStudentSource();delete window.__restoreDormStudentSource;});
    if(process.env.QA_DORM_STUDENT_PROFILE_ONLY==="1"){
      assert.deepStrictEqual(pageErrors, [], `spatial resident profile page errors: ${JSON.stringify(pageErrors)}`);
      assert.deepStrictEqual(consoleErrors, [], `spatial resident profile console errors: ${JSON.stringify(consoleErrors)}`);
      assert.deepStrictEqual(badResponses, [], `spatial resident profile HTTP errors: ${JSON.stringify(badResponses)}`);
      console.log("Spatial dorm resident profile and enrollment-photo QA passed.");
      return;
    }
    const migrationGuard=await page.evaluate(() => {
      const original=window.__DORM_SPATIAL__.getState();
      ORG_DORMS.splice(0,ORG_DORMS.length,{zone:"东区",building:"7栋"},{zone:"迁移区",building:"空置楼"});saveOrgs();
      window.__DORM_SPATIAL__.restoreState({schemaVersion:1,settings:original.settings,rooms:original.rooms,assignments:original.assignments,leaders:original.leaders,audit:original.audit});
      const once=window.__DORM_SPATIAL__.getState(),count=once.buildings.length;
      window.__DORM_SPATIAL__.migrateLegacyBuildings();window.__DORM_SPATIAL__.migrateLegacyBuildings();
      const twice=window.__DORM_SPATIAL__.getState(),shadow=ORG_DORMS.map(item=>item.building).sort();
      window.__DORM_SPATIAL__.restoreState(original);
      return {schemaVersion:once.schemaVersion,hasEmptyBuilding:once.buildings.some(item=>item.zone==="迁移区"&&item.building==="空置楼"),count,idempotentCount:twice.buildings.length,shadowHasEmpty:shadow.includes("空置楼")};
    });
    assert.strictEqual(migrationGuard.schemaVersion,3,"legacy spatial schema was not upgraded");
    assert.strictEqual(migrationGuard.hasEmptyBuilding,true,"unused legacy building was lost during migration");
    assert.strictEqual(migrationGuard.idempotentCount,migrationGuard.count,"repeated legacy migration created duplicate buildings");
    assert.strictEqual(migrationGuard.shadowHasEmpty,true,"compatibility shadow was not synchronized from apartment resources");
    const roomId=initial.state.rooms[0].id;
    const noteIsolationBefore=await page.evaluate(() => ({students:JSON.stringify(students),records:JSON.stringify(dormDistRecords),summary:window.__DORM_SPATIAL__.summary()}));
    await page.evaluate((id) => window.dormSpatialEditBedNote(id,"4"),roomId);
    assert.match(await page.locator("#modalBody").innerText(),/仅用于登记床位上的其他学生[\s\S]*不会查找或修改学生管理、住宿分布、入住人数、床位冲突和宿舍长信息/);
    await page.locator("#dspNoteStudentName").fill("外部登记学生");
    await page.locator("#dspNoteStudentNo").fill("EXT-001");
    await page.locator("#dspNoteDept").fill("外部学院");
    await page.locator("#dspNoteClass").fill("外部班级");
    await page.locator("#dspNoteCounselor").fill("外部辅导员");
    await page.locator("#dspNoteRemark").fill("仅作床位情况登记");
    await page.locator("#modalOk").click();await page.waitForTimeout(80);
    const noteIsolationAfter=await page.evaluate((id) => {const state=window.__DORM_SPATIAL__.getState(),saved=state.bedNotes.find(item=>item.roomId===id&&item.bedNo==="4");window.__DORM_SPATIAL__.restoreState(state);const restored=window.__DORM_SPATIAL__.getState().bedNotes.find(item=>item.roomId===id&&item.bedNo==="4");return {students:JSON.stringify(students),records:JSON.stringify(dormDistRecords),summary:window.__DORM_SPATIAL__.summary(),saved:saved&&{studentName:saved.studentName,studentNo:saved.studentNo,dept:saved.dept,className:saved.className,counselor:saved.counselor,remark:saved.remark},restored:!!restored,audit:state.audit.some(item=>item.actionType==="BED_NOTE_CREATE")};},roomId);
    assert.deepStrictEqual({students:noteIsolationAfter.students,records:noteIsolationAfter.records,summary:noteIsolationAfter.summary},{students:noteIsolationBefore.students,records:noteIsolationBefore.records,summary:noteIsolationBefore.summary},"independent bed note changed student, accommodation, or occupancy data");
    assert.deepStrictEqual(noteIsolationAfter.saved,{studentName:"外部登记学生",studentNo:"EXT-001",dept:"外部学院",className:"外部班级",counselor:"外部辅导员",remark:"仅作床位情况登记"},"bed note did not retain the registered student and counselor details");
    assert.strictEqual(noteIsolationAfter.restored&&noteIsolationAfter.audit,true,"bed note did not survive state normalization or write an audit record");
    await page.evaluate((id) => window.dormSpatialEditBedNote(id,"4"),roomId);
    await page.locator("#dspNoteRemark").fill("修改后的独立备注");
    await page.locator("#modalOk").click();await page.waitForTimeout(50);
    const noteEditGuard=await page.evaluate((id) => {const state=window.__DORM_SPATIAL__.getState(),notes=state.bedNotes.filter(item=>item.roomId===id&&item.bedNo==="4");return {count:notes.length,remark:notes[0]&&notes[0].remark,students:JSON.stringify(students),records:JSON.stringify(dormDistRecords),summary:window.__DORM_SPATIAL__.summary(),audit:state.audit.some(item=>item.actionType==="BED_NOTE_UPDATE")};},roomId);
    assert.deepStrictEqual({count:noteEditGuard.count,remark:noteEditGuard.remark,audit:noteEditGuard.audit},{count:1,remark:"修改后的独立备注",audit:true},"editing a bed note duplicated it or failed to update the remark");
    assert.deepStrictEqual({students:noteEditGuard.students,records:noteEditGuard.records,summary:noteEditGuard.summary},{students:noteIsolationBefore.students,records:noteIsolationBefore.records,summary:noteIsolationBefore.summary},"editing a bed note affected linked accommodation data");
    await page.evaluate((id) => window.dormSpatialOpenBed(id,"4"),roomId);
    assert.match(await page.locator("#modalBody").innerText(),/不占用系统床位[\s\S]*外部登记学生[\s\S]*外部辅导员/,"bed note was not visible from the spatial bed card");
    await page.evaluate(() => {window.confirm=()=>true;});
    await page.evaluate((id) => window.dormSpatialDeleteBedNote(id,"4"),roomId);await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate((id) => !window.__DORM_SPATIAL__.getState().bedNotes.some(item=>item.roomId===id&&item.bedNo==="4"),roomId),true,"bed note could not be cleared independently");
    await page.evaluate((id) => window.dormSpatialOpenRoom(id),roomId);
    assert.match(await page.locator("#modalBody").innerText(),/处分测试乙[\s\S]*编辑住宿/,"room detail did not expose personal accommodation editing");
    await page.evaluate(() => window.dormSpatialEditResident("qa-punish-college"));
    assert.match(await page.locator("#modalTitle").innerText(),/编辑住宿信息/);
    await page.locator("#dEditBed").fill("3");
    await page.locator("#modalOk").click();
    await page.waitForTimeout(80);
    const editedAccommodation=await page.evaluate(() => {
      const student=students.find(item=>item.id==="qa-punish-college"),record=dormDistRecords.find(item=>String(item.studentId||item.id)===student.id),assignment=window.__DORM_SPATIAL__.getState().assignments.find(item=>item.studentId===student.id&&item.status==="current");
      return {studentBed:student.bed,recordBed:record&&record.bed,assignmentBed:assignment&&assignment.bedNo};
    });
    assert.deepStrictEqual(editedAccommodation,{studentBed:"3",recordBed:"3",assignmentBed:"3"},"personal accommodation edit did not update all linked projections");
    await page.evaluate(() => window.dormSpatialEditResident("qa-punish-college"));
    await page.locator("#dEditBed").fill("2");
    await page.locator("#modalOk").click();
    await page.waitForTimeout(80);
    assert.deepStrictEqual(await page.evaluate(() => {const student=students.find(item=>item.id==="qa-punish-college"),assignment=window.__DORM_SPATIAL__.getState().assignments.find(item=>item.studentId===student.id&&item.status==="current");return {studentBed:student.bed,assignmentBed:assignment&&assignment.bedNo};}),{studentBed:"2",assignmentBed:"2"},"personal accommodation edit could not restore the original bed");
    const conflictGuard=await page.evaluate(() => {
      const before=dormDistributionRow(students.find(item=>item.id==="qa-punish-college"));
      const ok=applyDormDistribution("qa-punish-college",{accom:"校内",building:"7栋",room:"427",bed:"1"});
      const after=dormDistributionRow(students.find(item=>item.id==="qa-punish-college"));
      return {ok,beforeBed:before.bed,afterBed:after.bed};
    });
    assert.deepStrictEqual(conflictGuard,{ok:false,beforeBed:"2",afterBed:"2"},"shared accommodation writer did not block a duplicate bed");
    const validationGuard=await page.evaluate(() => {
      const incomplete=applyDormDistribution("qa-punish-college",{accom:"校内",building:"",room:"",bed:""});
      const outOfRange=applyDormDistribution("qa-punish-college",{accom:"校内",building:"7栋",room:"427",bed:"99"});
      const rent=applyDormDistribution("qa-punish-college",{accom:"租房"}),afterRent=dormDistributionRow(students.find(item=>item.id==="qa-punish-college"));
      const restored=applyDormDistribution("qa-punish-college",{accom:"校内",zone:"",building:"7栋",room:"427",bed:"2"});
      return {incomplete,outOfRange,rent,cleared:[afterRent.zone,afterRent.building,afterRent.room,afterRent.bed],restored};
    });
    assert.deepStrictEqual(validationGuard,{incomplete:false,outOfRange:false,rent:true,cleared:["","","",""],restored:true},"shared accommodation writer did not enforce complete/capacity rules or clear off-campus location");
    const renameGuard=await page.evaluate(() => {
      const student=students.find(item=>item.id==="qa-punish-college");student.id="qa-punish-college-renamed";const forward=dormRenameStudentId("qa-punish-college",student.id),forwardState=window.__DORM_SPATIAL__.getState(),forwardRecord=dormDistRecords.some(item=>String(item.studentId||item.id)===student.id);student.id="qa-punish-college";const backward=dormRenameStudentId("qa-punish-college-renamed",student.id),backState=window.__DORM_SPATIAL__.getState();persistStudents();return {forward,forwardRecord,forwardAssignment:forwardState.assignments.some(item=>item.studentId==="qa-punish-college-renamed"&&item.status==="current"),backward,backAssignment:backState.assignments.some(item=>item.studentId==="qa-punish-college"&&item.status==="current")};
    });
    assert.deepStrictEqual(renameGuard,{forward:true,forwardRecord:true,forwardAssignment:true,backward:true,backAssignment:true},"student ID change left orphaned accommodation data");
    const normalizationGuard=await page.evaluate(() => {
      const original=window.__DORM_SPATIAL__.getState();window.__DORM_SPATIAL__.restoreState({settings:{defaultBedCount:4,maxBedCount:30},rooms:[{id:"bad-room",zone:"测试区",building:"测试楼",floor:"1",room:"101",bedCount:99999}],assignments:[{id:"a1",studentId:"dup",roomId:"bad-room",bedNo:"1",status:"current",updatedAt:"2026-01-01"},{id:"a2",studentId:"dup",roomId:"bad-room",bedNo:"2",status:"current",updatedAt:"2026-02-01"}],leaders:[],audit:[]});const repaired=window.__DORM_SPATIAL__.getState();window.__DORM_SPATIAL__.restoreState(original);return {bedCount:repaired.rooms[0].bedCount,current:repaired.assignments.filter(item=>item.studentId==="dup"&&item.status==="current").length,ended:repaired.assignments.filter(item=>item.studentId==="dup"&&item.status==="ended").length};
    });
    assert.deepStrictEqual(normalizationGuard,{bedCount:4,current:1,ended:1},"corrupted spatial state was not bounded and repaired");
    const atomicGuard=await page.evaluate(() => {const result=dormApplyRowsAtomically([{id:"qa-punish-college",bed:"3"},{id:"qa-punish-school",bed:"3"}],row=>{const student=students.find(item=>item.id===row.id);return {student,fields:{accom:"校内",building:"7栋",room:"427",bed:row.bed}};});return {failed:result.failed,beds:students.filter(item=>item.id==="qa-punish-school"||item.id==="qa-punish-college").sort((a,b)=>a.id.localeCompare(b.id)).map(item=>item.bed)};});
    assert.deepStrictEqual(atomicGuard,{failed:true,beds:["2","1"]},"multi-row accommodation mutation did not roll back atomically after a later conflict");
    const importResourceGuard=await page.evaluate(() => {
      const snapshot=dormMutationSnapshot(),messages=[],row={"学号":"qa-punish-college","住宿情况":"校内","区位":"导入测试区","楼栋":"导入测试楼","房间号":"806","床位号":"6"};
      window.confirm=(message)=>{messages.push(String(message));return false;};
      const cancelled=dormImportApplyRows([row]),afterCancel=window.__DORM_SPATIAL__.getState(),studentAfterCancel=dormDistributionRow(students.find(item=>item.id==="qa-punish-college"));
      window.confirm=(message)=>{messages.push(String(message));return true;};
      const accepted=dormImportApplyRows([row]),afterAccept=window.__DORM_SPATIAL__.getState(),studentAfterAccept=dormDistributionRow(students.find(item=>item.id==="qa-punish-college")),room=afterAccept.rooms.find(item=>item.zone==="导入测试区"&&item.building==="导入测试楼"&&item.room==="806");
      dormMutationRollback(snapshot);
      return {cancelled:cancelled.cancelled,cancelLeftNoRoom:!afterCancel.rooms.some(item=>item.building==="导入测试楼"&&item.room==="806"),cancelLeftStudent:[studentAfterCancel.building,studentAfterCancel.room,studentAfterCancel.bed],accepted:{failed:accepted.failed,addedRooms:accepted.addedRooms},room:room&&{bedCount:room.bedCount,status:room.status},acceptedStudent:[studentAfterAccept.zone,studentAfterAccept.building,studentAfterAccept.room,studentAfterAccept.bed],prompted:messages.some(message=>message.includes("尚未在“公寓资源”中建立")&&message.includes("自动新增这些宿舍楼、房间及所需床位"))};
    });
    assert.deepStrictEqual(importResourceGuard,{cancelled:true,cancelLeftNoRoom:true,cancelLeftStudent:["7栋","427","2"],accepted:{failed:false,addedRooms:1},room:{bedCount:6,status:"active"},acceptedStudent:["导入测试区","导入测试楼","806","6"],prompted:true},"dorm import did not confirm, cancel cleanly, or auto-create a capacity-safe room resource");
    const importResourceRollbackGuard=await page.evaluate(() => {
      const before=dormMutationSnapshot();window.confirm=()=>true;
      const result=dormImportApplyRows([{"学号":"qa-punish-school","住宿情况":"校内","区位":"回滚测试区","楼栋":"回滚测试楼","房间号":"907","床位号":"7"},{"学号":"qa-punish-college","住宿情况":"校内","区位":"回滚测试区","楼栋":"回滚测试楼","房间号":"907","床位号":"7"}]),state=window.__DORM_SPATIAL__.getState();
      return {failed:result.failed,roomGone:!state.rooms.some(item=>item.building==="回滚测试楼"&&item.room==="907"),buildingGone:!state.buildings.some(item=>item.building==="回滚测试楼"),studentsRestored:JSON.stringify(students)===JSON.stringify(before.students),recordsRestored:JSON.stringify(dormDistRecords)===JSON.stringify(before.records)};
    });
    assert.deepStrictEqual(importResourceRollbackGuard,{failed:true,roomGone:true,buildingGone:true,studentsRestored:true,recordsRestored:true},"auto-created apartment resources were not rolled back with a failed accommodation import");
    const studentImportAtomicGuard=await page.evaluate(() => {const beforeRecords=JSON.stringify(dormDistRecords);const result=writeImportedRows([{"学号":"qa-punish-school","姓名":"处分测试甲","班级":"测试班","学籍状态":"在校","住宿情况":"校内","楼栋":"7栋","房间号":"427","床位号":"3"},{"学号":"qa-punish-college","姓名":"处分测试乙","班级":"测试班","学籍状态":"在校","住宿情况":"校内","楼栋":"7栋","房间号":"427","床位号":"3"}],"cover");return {result,beds:students.filter(item=>item.id==="qa-punish-school"||item.id==="qa-punish-college").sort((a,b)=>a.id.localeCompare(b.id)).map(item=>item.bed),recordsRestored:JSON.stringify(dormDistRecords)===beforeRecords};});
    assert.deepStrictEqual(studentImportAtomicGuard,{result:false,beds:["2","1"],recordsRestored:true},"student import did not roll back student and dorm projections after a bed conflict");
    const smartImportAtomicGuard=await page.evaluate(() => {const beforeRecords=JSON.stringify(dormDistRecords);const report=smartImportApplyPlan([{type:"dorm",records:[{"学号":"qa-punish-school","住宿情况":"校内","楼栋":"7栋","房间号":"427","床位号":"3"},{"学号":"qa-punish-college","住宿情况":"校内","楼栋":"7栋","房间号":"427","床位号":"3"}]}]);return {ok:report.ok,hasRollbackError:report.errors.some(item=>String(item).includes("已回滚")),beds:students.filter(item=>item.id==="qa-punish-school"||item.id==="qa-punish-college").sort((a,b)=>a.id.localeCompare(b.id)).map(item=>item.bed),recordsRestored:JSON.stringify(dormDistRecords)===beforeRecords};});
    assert.deepStrictEqual(smartImportAtomicGuard,{ok:0,hasRollbackError:true,beds:["2","1"],recordsRestored:true},"smart import did not roll back accommodation conflicts atomically");
    await page.evaluate((id) => window.dormSpatialSetLeader(id,"qa-punish-school"),roomId);
    assert.strictEqual(await page.evaluate(() => window.__DORM_SPATIAL__.studentRole("qa-punish-school")),"宿舍长");
    await page.evaluate(() => {
      const student=students.find(item=>item.id==="qa-punish-school"),oldStatus=student.status;
      student.status="毕业";
      if(!window.dormApplyGraduationTransitions([{student,oldStatus}],"qa-graduation"))throw new Error("graduation checkout failed");
    });
    const graduated=await page.evaluate(() => {
      const student=students.find(item=>item.id==="qa-punish-school"),state=window.__DORM_SPATIAL__.getState();
      return {student:{status:student.status,accom:student.accom,zone:student.zone,building:student.building,room:student.room,bed:student.bed},hasLegacy:dormDistRecords.some(record=>String(record.studentId||record.id)===student.id),current:state.assignments.filter(item=>item.studentId===student.id&&item.status==="current").length,ended:state.assignments.filter(item=>item.studentId===student.id&&item.status==="ended").length,currentLeader:state.leaders.filter(item=>item.studentId===student.id&&item.status==="current").length,audit:state.audit.some(item=>item.targetId===student.id&&item.actionType==="AUTO_CHECKOUT_GRADUATION"),summary:window.__DORM_SPATIAL__.summary()};
    });
    assert.deepStrictEqual(graduated.student,{status:"毕业",accom:"",zone:"",building:"",room:"",bed:""},"graduation did not clear current accommodation fields");
    assert.strictEqual(graduated.hasLegacy,false,"graduation did not clear dormDistRecords projection");
    assert.strictEqual(graduated.current,0,"graduation left a current assignment");
    assert.ok(graduated.ended>=1,"graduation did not preserve an ended assignment history");
    assert.strictEqual(graduated.currentLeader,0,"graduation did not end the dorm leader role");
    assert.strictEqual(graduated.audit,true,"graduation audit was not written");
    assert.strictEqual(graduated.summary.occupied,1,"released bed was not reflected in occupancy statistics");
    await page.evaluate(() => {const student=students.find(item=>item.id==="qa-punish-school");student.status="在校";persistStudents();window.goto("dorm");});
    assert.deepStrictEqual(await page.evaluate(() => {const student=students.find(item=>item.id==="qa-punish-school");return [student.accom,student.building,student.room,student.bed];}),["","","",""],"restoring in-school status incorrectly restored the old bed");
    await page.evaluate((id) => window.dormSpatialOpenRoom(id),roomId);
    assert.match(await page.locator("#modalBody").innerText(),/入住历史[\s\S]*处分测试甲[\s\S]*毕业自动退宿/,"room detail did not expose preserved checkout history");
    await page.evaluate(() => closeModal());
    await page.evaluate(() => window.dormSpatialSetTab("resources"));
    assert.match(await page.locator("#content").innerText(),/床位参数[\s\S]*默认床位数[\s\S]*单间安全上限[\s\S]*区位与楼栋资源[\s\S]*宿舍房间与床位/);
    await page.evaluate(() => {window.maintTab="d6";window.goto("maint");});
    assert.doesNotMatch(await page.locator("#content").innerText(),/宿舍信息/,"legacy dorm maintenance entry is still visible");
    await page.evaluate(() => window.goto("dorm"));
    const maxGuard=await page.evaluate(() => {const before=window.__DORM_SPATIAL__.getState().settings.maxBedCount;document.getElementById("dspDefaultBeds").value="2";document.getElementById("dspMaxBeds").value="2";window.dormSpatialSaveSettings();return {before,after:window.__DORM_SPATIAL__.getState().settings.maxBedCount};});
    assert.deepStrictEqual(maxGuard,{before:30,after:30},"bed safety maximum was allowed below an existing room capacity");
    const referencedDeleteGuard=await page.evaluate((id) => {const deleted=window.dormSpatialDeleteRoom(id),state=window.__DORM_SPATIAL__.getState();return {deleted,exists:state.rooms.some(room=>room.id===id)};},roomId);
    assert.deepStrictEqual(referencedDeleteGuard,{deleted:false,exists:true},"room with accommodation history was deleted");
    const deleteBuildingId=await page.evaluate(() => window.__DORM_SPATIAL__.ensureBuilding("删除测试区","删除测试楼").id);
    await page.evaluate(() => window.dormSpatialAddRoom());
    await page.locator("#dspRoomZone").fill("删除测试区");
    await page.locator("#dspRoomBuilding").fill("删除测试楼");
    await page.locator("#dspRoomFloor").fill("1");
    await page.locator("#dspRoomNo").fill("101");
    await page.locator("#dspRoomBeds").fill("2");
    await page.locator("#modalOk").click();
    const deleteRoomId=await page.evaluate(() => window.__DORM_SPATIAL__.getState().rooms.find(room=>room.building==="删除测试楼"&&room.room==="101").id);
    assert.strictEqual(await page.evaluate((id) => window.dormSpatialDeleteBuilding(id),deleteBuildingId),false,"building with room resources was deleted");
    assert.strictEqual(await page.evaluate((id) => window.dormSpatialDeleteRoom(id),deleteRoomId),true,"unused room resource could not be deleted");
    assert.strictEqual(await page.evaluate((id) => window.dormSpatialDeleteBuilding(id),deleteBuildingId),true,"unused building resource could not be deleted");
    const deletionAudit=await page.evaluate(() => {const state=window.__DORM_SPATIAL__.getState();return {roomGone:!state.rooms.some(room=>room.building==="删除测试楼"),buildingGone:!state.buildings.some(item=>item.building==="删除测试楼"),shadowGone:!ORG_DORMS.some(item=>item.building==="删除测试楼"),roomAudit:state.audit.some(item=>item.actionType==="RESOURCE_DELETE"),buildingAudit:state.audit.some(item=>item.actionType==="BUILDING_DELETE")};});
    assert.deepStrictEqual(deletionAudit,{roomGone:true,buildingGone:true,shadowGone:true,roomAudit:true,buildingAudit:true},"resource deletion did not clean state, compatibility shadow, or audit correctly");
    const graduationEmptyRoom=await page.evaluate((id) => {
      const messages=[];window.confirm=(message)=>{messages.push(String(message));return true;};
      const student=students.find(item=>item.id==="qa-punish-college"),oldStatus=student.status;student.status="毕业";
      const ok=window.dormApplyGraduationTransitions([{student,oldStatus}],"qa-empty-room-graduation"),state=window.__DORM_SPATIAL__.getState();
      return {ok,roomGone:!state.rooms.some(room=>room.id===id),historyKept:state.assignments.some(item=>item.roomId===id&&item.studentId===student.id&&item.status==="ended"),prompted:messages.some(message=>message.includes("已无人入住，是否删除该房间号")),studentAccommodation:[student.accom,student.zone,student.building,student.room,student.bed]};
    },roomId);
    assert.deepStrictEqual(graduationEmptyRoom,{ok:true,roomGone:true,historyKept:true,prompted:true,studentAccommodation:["","","","",""]},"graduation checkout did not prompt for and safely delete the newly empty room");
    assert.deepStrictEqual(pageErrors, [], `spatial dorm page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `spatial dorm console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `spatial dorm HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Spatial dorm, configurable beds, leader role, and graduation checkout QA passed.");
    return;
  }
  if (process.env.QA_SITUATION_CLASS_MEMBERS_ONLY === "1") {
    await page.evaluate(() => {
      const first=students.find(student=>student.id==="qa-punish-school"),second=students.find(student=>student.id==="qa-punish-college");
      first.political="中共预备党员";
      first.party={stage:"群众",leagueStatus:"非团员"};
      second.political="共青团员";
      second.party={stage:"中共党员",leagueStatus:"退团"};
      persistStudents();
      window.goto("dashboard");
    });
    await page.waitForTimeout(100);
    assert.deepStrictEqual((await page.locator(".si-class-table thead th").allTextContents()).slice(-2),["党员人数","团员人数"],"class distribution is missing party/league columns");
    const counts=await page.locator(".si-class-table tbody .si-class-count").allTextContents();
    assert.deepStrictEqual(counts,["2","1","1"],"class total and party/league counts are incorrect");
    await page.locator('.si-class-count[title="查看班级学生名单"]').click();
    assert.match(await page.locator("#modalTitle").textContent(),/测试班 · 学生名单/);
    assert.match(await page.locator("#modalBody").innerText(),/处分测试甲[\s\S]*处分测试乙|处分测试乙[\s\S]*处分测试甲/);
    await page.evaluate(() => closeModal());
    await page.locator('.si-class-count[title="查看党员名单"]').click();
    assert.match(await page.locator("#modalTitle").textContent(),/党员（含预备党员）名单/);
    assert.deepStrictEqual(await page.locator(".si-member-table thead th").allTextContents(),["学院","专业","年级","班级","学号","姓名","性别","民族","政治面貌","团员身份","手机号","学籍状态"],"party member popup is missing basic information");
    assert.match(await page.locator("#modalBody").innerText(),/处分测试甲[\s\S]*中共预备党员/);
    assert.doesNotMatch(await page.locator("#modalBody").innerText(),/处分测试乙/);
    await page.evaluate(() => closeModal());
    await page.locator('.si-class-count[title="查看团员名单"]').click();
    assert.match(await page.locator("#modalTitle").textContent(),/团员名单/);
    assert.match(await page.locator("#modalBody").innerText(),/处分测试乙[\s\S]*共青团员/);
    assert.doesNotMatch(await page.locator("#modalBody").innerText(),/处分测试甲/);
    assert.deepStrictEqual(pageErrors, [], `class member popup page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `class member popup console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `class member popup HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Situation overview class party/league member QA passed.");
    return;
  }
  if (process.env.QA_DORM_MASTER_SYNC_ONLY === "1") {
    const result=await page.evaluate(() => {
      const first=students.find(student=>student.id==="qa-punish-school"),second=students.find(student=>student.id==="qa-punish-college");
      first.status="在校";second.status="在校";
      const firstSaved=applyDormDistribution(first.id,{accom:"校内",zone:"东区",building:"测试公寓",room:"301",bed:"1"});
      const secondSaved=applyDormDistribution(second.id,{accom:"校内",zone:"错误区位",building:"测试公寓",room:"301",bed:"2"});
      const master=window.__DORM_SPATIAL__.buildingRows().find(item=>item.building==="测试公寓");
      const persisted=JSON.parse(localStorage.getItem("nnuzc_orgs")||"{}").dorms||[];
      return {firstSaved,secondSaved,master:{zone:master&&master.zone,building:master&&master.building},first:dormDistributionRow(first),second:dormDistributionRow(second),persisted:persisted.some(item=>item.building==="测试公寓"&&item.zone==="东区")};
    });
    assert.deepStrictEqual({firstSaved:result.firstSaved,secondSaved:result.secondSaved,master:result.master,persisted:result.persisted},{firstSaved:true,secondSaved:true,master:{zone:"东区",building:"测试公寓"},persisted:true},"dorm save did not create or preserve authoritative dorm master data");
    assert.strictEqual(result.first.zone,"东区");
    assert.strictEqual(result.second.zone,"东区","existing dorm master zone was not authoritative");
    await page.evaluate(() => { window.goto("dorm"); });
    await page.evaluate(() => window.dormSpatialSetTab("distribution"));
    assert.deepStrictEqual((await page.locator("#content .module-table-wrap thead th").allTextContents()).slice(8,13),["住宿情况","区位","宿舍楼","房间号","床位号"],"dorm table fields are inconsistent with dorm master data");
    await page.evaluate(() => {const item=window.__DORM_SPATIAL__.buildingRows().find(row=>row.building==="测试公寓");window.dormSpatialEditBuilding(item.id);});
    await page.locator("#dspBuildingZone").fill("西区");
    await page.locator("#modalOk").click();
    const synced=await page.evaluate(() => ({master:window.__DORM_SPATIAL__.buildingRows().find(item=>item.building==="测试公寓"),students:students.filter(student=>["qa-punish-school","qa-punish-college"].includes(student.id)).map(student=>({id:student.id,zone:student.zone})),records:dormDistRecords.filter(record=>["qa-punish-school","qa-punish-college"].includes(String(record.studentId||record.id))).map(record=>({id:String(record.studentId||record.id),zone:record.zone}))}));
    assert.strictEqual(synced.master.zone,"西区");
    assert.ok(synced.students.length===2&&synced.students.every(item=>item.zone==="西区"),"master dorm edit did not synchronize student accommodation zones");
    assert.ok(synced.records.length===2&&synced.records.every(item=>item.zone==="西区"),"master dorm edit did not synchronize dorm distribution zones");
    assert.deepStrictEqual(pageErrors, [], `dorm master sync page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `dorm master sync console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `dorm master sync HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Dorm management and authoritative apartment-resource synchronization QA passed.");
    return;
  }
  if (process.env.QA_CUSTOM_FIELDS_ONLY === "1") {
    await page.evaluate(() => {
      localStorage.setItem("nnuzc_custom_field_schemas_v1",JSON.stringify({student:[{id:"qa_keep_student",name:"学生保留字段",type:"text",active:true}],counselorGrowth:[{id:"qa_keep_growth",name:"成长保留字段",type:"text",active:true}],punishment:[{id:"qa_remove_punishment",name:"应移除字段",type:"text",active:true}],academicWarning:[{id:"qa_remove_warning",name:"应移除预警字段",type:"text",active:true}]}));
      punishments[0].customFieldValues={qa_remove_punishment:"应清理"};persistPunishments();
      localStorage.setItem("nnuzc_counselor_growth_records_v1",JSON.stringify([{id:"qa-growth",type:"other",title:"成长测试",customFieldValues:{qa_keep_growth:"保留值"}}]));
    });
    await page.evaluate(() => window.workbench.legacy.flushStore());
    await page.reload({waitUntil:"networkidle"});
    assert.ok(await page.evaluate(() => !!window.__CUSTOM_FIELDS__),`custom fields module did not initialize: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(await page.evaluate(() => Object.keys(window.__CUSTOM_FIELDS__.registry).sort()),["classOfficer","counselorGrowth","dorm","student"],"field management must only remain in student information management and personal development");
    assert.deepStrictEqual(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}")).sort()),["counselorGrowth","student"],"removed modules still retain custom-field schemas");
    assert.strictEqual(await page.evaluate(() => Object.prototype.hasOwnProperty.call(punishments[0].customFieldValues||{},"qa_remove_punishment")),false,"removed module still retains custom-field values");
    await page.evaluate(() => window.goto("student"));
    assert.deepStrictEqual(await page.locator("#content [data-cf-view]").evaluateAll(nodes=>nodes.map(node=>node.dataset.cfView)),["student"],"student page field-management card is missing or duplicated");
    await page.evaluate(() => window.stuEdit("qa-punish-school"));
    assert.match(await page.locator("#modalBody").innerText(),/学生管理 · 自定义字段[\s\S]*学生保留字段/);
    await page.locator("#cfNative_student_qa_keep_student").fill("学生字段保留正常");
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate(() => students.find(student=>student.id==="qa-punish-school").customFieldValues.qa_keep_student),"学生字段保留正常");
    await page.evaluate(() => window.goto("classOfficer"));
    assert.deepStrictEqual(await page.locator("#content [data-cf-view]").evaluateAll(nodes=>nodes.map(node=>node.dataset.cfView)),["classOfficer"]);
    await page.evaluate(() => window.goto("dorm"));
    assert.deepStrictEqual(await page.locator("#content [data-cf-view]").evaluateAll(nodes=>nodes.map(node=>node.dataset.cfView)),["dorm"]);
    await page.evaluate(() => window.goto("counselorGrowth"));
    assert.deepStrictEqual(await page.locator("#content [data-cf-view]").evaluateAll(nodes=>nodes.map(node=>node.dataset.cfView)),["counselorGrowth"]);
    for(const view of ["eval","academic","fund","studentLoan","punishment","classroom","courseTimetable","dormviolate","otherViolation","achievement","awardStatistics","meeting","talks","keycare","psych","home","events","checkClass","checkDorm","help","tasks","certificate","subjectCompetition","employment"]){await page.evaluate(target=>window.goto(target),view);assert.strictEqual(await page.locator("#content [data-cf-view]").count(),0,`removed field-management card remains on ${view}`);}
    assert.deepStrictEqual(pageErrors, [], `field-management scope page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `field-management scope console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `field-management scope HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Custom fields scope QA passed (student information management and personal development only). ");
    return;
  }
  if (process.env.QA_CUSTOM_FIELDS_LEGACY_ONLY === "1") {
    await page.evaluate(() => window.goto("eval"));
    assert.match(await page.locator("#content").innerText(),/综测数据 · 综测记录 · 字段扩展/);
    assert.doesNotMatch(await page.locator("#content").innerText(),/学业情况（个人版） · 学业预警（个人版）/);
    await page.evaluate(() => window.goto("academic"));
    const academicFieldCards=await page.locator("#content").innerText();
    assert.match(academicFieldCards,/学业情况（个人版） · 学业预警（个人版） · 字段扩展/);
    assert.match(academicFieldCards,/学业情况（个人版） · 成绩与排名（个人版） · 字段扩展/);
    assert.doesNotMatch(academicFieldCards,/综测数据 · 综测记录/);
    const hostCardAudit=await page.evaluate(() => Object.entries(window.__CUSTOM_FIELDS__.pageGroups).map(([host,expected])=>{window.goto(host);const actual=Array.from(document.querySelectorAll("#content [data-cf-view]")).map(node=>node.dataset.cfView);return {host,expected:expected.slice().sort(),actual:actual.sort()};}).filter(item=>JSON.stringify(item.expected)!==JSON.stringify(item.actual)));
    assert.deepStrictEqual(hostCardAudit,[],`custom-field cards are attached to incorrect pages: ${JSON.stringify(hostCardAudit)}`);
    await page.evaluate(() => window.goto("student"));
    assert.match(await page.locator("#content").innerText(), /学生管理 · 字段扩展[\s\S]*字段管理[\s\S]*查看\/填写字段/, "student field-management card is missing");
    assert.strictEqual(await page.evaluate(() => !!window.__CUSTOM_FIELDS__.registry.student),true,"student management is not registered for field management");
    await page.evaluate(() => window.stuExport());
    assert.doesNotMatch(await page.locator("#modalBody").innerText(),/备注1|备注2|自定义字段/,"retired student fields are still exposed in export");
    await page.evaluate(() => window.closeModal());
    await page.evaluate(() => window.customFieldsSettings("student"));
    assert.match(await page.locator("#modalBody").innerText(), /已有系统字段[\s\S]*学号[\s\S]*姓名[\s\S]*政治面貌[\s\S]*学籍状态/, "student system fields are missing from field management");
    await page.evaluate(() => window.customFieldsAdd());
    await page.locator("#cfSettingsRows .cf-name").fill("学生补充信息");
    await page.locator("#modalOk").click();
    const studentFieldId=await page.evaluate(() => (JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}").student||[])[0].id);
    await page.evaluate(() => window.customFieldsEditRecord("student", "qa-punish-school"));
    await page.locator("#modalBody .cf-value").fill("学生字段已恢复");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.openStudent("qa-punish-school"));
    assert.match(await page.locator("#drawerBody").innerText(),/学生管理 · 自定义字段[\s\S]*学生补充信息[\s\S]*学生字段已恢复/,"student detail does not show module-specific custom-field heading");
    await page.evaluate(() => { window.showDrawer(false); window.stuEdit("qa-punish-school"); });
    assert.match(await page.locator("#modalBody").innerText(),/学生管理 · 自定义字段/,"student edit uses a generic custom-field heading");
    const nativeStudentField=page.locator(`#cfNative_student_${studentFieldId}`);
    assert.strictEqual(await nativeStudentField.inputValue(),"学生字段已恢复","student edit form did not load the custom field value");
    await nativeStudentField.fill("学生原生编辑已更新");
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate((fieldId) => students.find(s=>s.id==="qa-punish-school").customFieldValues[fieldId],studentFieldId),"学生原生编辑已更新","student edit form did not save the custom field value");
    await page.evaluate(() => window.openStudent("qa-punish-school"));
    assert.match(await page.locator("#drawerBody").innerText(),/学生补充信息[\s\S]*学生原生编辑已更新/,"student detail did not refresh the edited custom field value");
    await page.evaluate(() => window.showDrawer(false));
    await page.evaluate(() => window.goto("studentLoan"));
    const fieldCardLayout=await page.locator("#content .cf-page-card").first().evaluate(card=>{const title=card.querySelector(".cf-page-title").getBoundingClientRect(),counts=card.querySelector(".cf-page-counts").getBoundingClientRect(),style=getComputedStyle(card.querySelector(".cf-page-counts"));return {title:{left:title.left,right:title.right,top:title.top,bottom:title.bottom},counts:{left:counts.left,right:counts.right,top:counts.top,bottom:counts.bottom},marginBottom:style.marginBottom,lineHeight:style.lineHeight};});
    assert.strictEqual(fieldCardLayout.marginBottom,"0px","field-count text inherited the global subtitle margin");
    assert.ok(fieldCardLayout.counts.left>=fieldCardLayout.title.right||fieldCardLayout.counts.top>=fieldCardLayout.title.bottom,`field title and count text overlap: ${JSON.stringify(fieldCardLayout)}`);
    await page.evaluate(() => window.customFieldsSettings("studentLoan"));
    assert.match(await page.locator("#modalBody").innerText(), /已有系统字段[\s\S]*学年[\s\S]*贷款银行[\s\S]*贷款金额/);
    assert.strictEqual(await page.locator("#modalBody .cf-system-row input").count(),0,"system fields must remain read-only");
    await page.evaluate(() => window.closeModal());
    await page.evaluate(() => window.customFieldsSettings("punishment"));
    await page.evaluate(() => window.customFieldsAdd());
    await page.locator("#cfSettingsRows .cf-name").fill("处理依据");
    await page.locator("#modalOk").click();
    const punishmentFieldId=await page.evaluate(() => (JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}").punishment||[])[0].id);
    await page.evaluate(() => window.customFieldsEditRecord("punishment", "20260812001"));
    await page.locator("#modalBody .cf-value").fill("校纪校规");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.workbench.legacy.flushStore());
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => Object.values(punishments.find(r => String(r.id) === "20260812001").customFieldValues)[0]), "校纪校规", "punishment field value did not persist");
    await page.evaluate(() => { window.goto("punishment"); window.punishEdit(20260812001); });
    assert.match(await page.locator("#modalBody").innerText(),/处分情况 · 自定义字段/,"punishment edit uses a generic custom-field heading");
    const nativePunishmentField=page.locator(`#cfNative_punishment_${punishmentFieldId}`);
    assert.strictEqual(await nativePunishmentField.inputValue(),"校纪校规","native punishment edit did not load its managed field");
    await nativePunishmentField.fill("处分原生编辑已更新");
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate((fieldId) => punishments.find(r=>String(r.id)==="20260812001").customFieldValues[fieldId],punishmentFieldId),"处分原生编辑已更新","native punishment edit did not save its managed field");
    await page.evaluate(() => window.punishView(20260812001));
    assert.match(await page.locator("#modalBody").innerText(),/处分情况 · 自定义字段[\s\S]*处理依据[\s\S]*处分原生编辑已更新/,"native punishment detail did not show its module-specific managed field heading");
    await page.evaluate(() => window.closeModal());
    assert.deepStrictEqual(await page.evaluate((fieldId) => {const student=students.find(s => s.id === "qa-punish-school");return {legacy:student.customFieldValues.legacy,value:student.customFieldValues[fieldId],oldArray:Object.prototype.hasOwnProperty.call(student,"customFields")};},studentFieldId),{legacy:"应清理",value:"学生原生编辑已更新",oldArray:false},"student field values did not persist or the retired array field returned");
    await page.evaluate(() => {const student=students.find(s=>s.id==="qa-punish-school");student.dorm=[{term:"2025-2026-2学期",date:"2026-08-12",reason:"宿舍测试",dorm:"7栋427",score:1}];student.classroom=[{term:"2025-2026-2学期",date:"2026-08-12",course:"课堂测试",reason:"迟到",score:1}];student.psych={level:"关注",issues:[],note:"",updated:""};persistStudents();});
    await page.evaluate(() => window.customFieldsSettings("dormviolate"));
    await page.evaluate(() => window.customFieldsAdd());
    await page.locator("#cfSettingsRows .cf-name").fill("处理备注");
    await page.locator("#modalOk").click();
    const dormFieldId=await page.evaluate(() => window.__CUSTOM_FIELDS__.registry.dormviolate.rows()[0].id);
    await page.evaluate(id => window.customFieldsEditRecord("dormviolate",id),dormFieldId);
    await page.locator("#modalBody .cf-value").fill("已通知宿管");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.openDormViolate("qa-punish-school",0));
    assert.strictEqual(await page.locator("#dvNo").inputValue(),"qa-punish-school","editing a dorm violation did not prefill the student ID");
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate(() => Object.values(students.find(s => s.id === "qa-punish-school").dorm[0].customFieldValues)[0]), "已通知宿管", "editing a nested dorm violation discarded custom values");
    await page.evaluate(() => window.customFieldsSettings("psych"));
    await page.evaluate(() => window.customFieldsAdd());
    await page.locator("#cfSettingsRows .cf-name").fill("访谈方式");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.customFieldsEditRecord("psych","qa-punish-school"));
    await page.locator("#modalBody .cf-value").fill("面谈");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.psychEdit("qa-punish-school"));
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate(() => Object.values(students.find(s => s.id === "qa-punish-school").psych.customFieldValues)[0]), "面谈", "editing psychological care discarded custom values");
    await page.evaluate(() => {certificateRecords.push({id:"qa_certificate_nested",sid:"qa-punish-school",name:"处分测试甲",status:"pending",data:{role:"学生获奖人",category:"学科竞赛",level:"校级",awardName:"证书字段测试",organization:"测试单位",issuingOrganization:"测试单位",date:"2026-08-12",term:"2026-2027-1学期"},customFieldValues:{}});certPersist();});
    await page.evaluate(() => window.customFieldsSettings("certificate"));
    await page.evaluate(() => window.customFieldsAdd());
    await page.locator("#cfSettingsRows .cf-name").fill("证书复核备注");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.customFieldsEditRecord("certificate","qa_certificate_nested"));
    await page.locator("#modalBody .cf-system-values summary").click();
    assert.match(await page.locator("#modalBody").innerText(),/归属角色[\s\S]*学生获奖人[\s\S]*获奖名称 \/ 赛事名称[\s\S]*证书字段测试/);
    await page.locator("#modalBody .cf-value").fill("人工复核通过");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.__certificateEnhancedLoad());
    assert.strictEqual(await page.evaluate(() => certificateRecords.find(row=>row.id==="qa_certificate_nested").customFieldValues&&Object.values(certificateRecords.find(row=>row.id==="qa_certificate_nested").customFieldValues)[0]),"人工复核通过","certificate normalization discarded custom values");
    await page.evaluate(() => {const s=students.find(item=>item.id==="qa-punish-school");window.academicTerms.push({id:990001,term:"2026-2027-1学期",rows:[{_rid:"qa_academic",学号:s.id,姓名:s.name,学院:s.dept,年级:s.grade,班级:s.cls}]});window.academicWarningTerms.push({id:990002,term:"2026-2027-1学期",rows:[{_rid:"qa_warning",学号:s.id,姓名:s.name,学院:s.dept,年级:s.grade,班级:s.cls,专业:s.major,预警等级:"黄色预警",courses:[]}]});window.gradeTerms.push({id:990003,term:"2026-2027-1学期",rows:[{_rid:"qa_grade",学号:s.id,姓名:s.name,学院:s.dept,年级:s.grade,专业:s.major,班级:s.cls,courses:[]}]});saveAcademicTerms();saveAcademicWarningTerms();saveGradeTerms();});
    const academicManagedFieldIds={};
    for (const [view,id,value] of [["academicRecord","ac:990001:qa_academic","综测备注"],["academicWarning","aw:990002:qa_warning","已联系家长"],["academicGrade","ag:990003:qa_grade","成绩复核完成"]]) {
      await page.evaluate(module => window.customFieldsSettings(module),view);
      await page.evaluate(() => window.customFieldsAdd());
      await page.locator("#cfSettingsRows .cf-name").fill("跟进说明");
      await page.locator("#modalOk").click();
      academicManagedFieldIds[view]=await page.evaluate(module => (JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}")[module]||[])[0].id,view);
      await page.evaluate(([module,record]) => window.customFieldsEditRecord(module,record),[view,id]);
      await page.locator("#modalBody .cf-value").fill(value);
      await page.locator("#modalOk").click();
    }
    await page.evaluate(() => window.goto("eval"));
    await page.evaluate(() => window.openAcademicRowForm(990001,"qa_academic"));
    assert.match(await page.locator("#modalBody").innerText(),/综测数据 · 综测记录 · 自定义字段/,"academic record edit does not show its module-specific custom fields");
    const nativeAcademicField=page.locator(`#cfNative_academicRecord_${academicManagedFieldIds.academicRecord}`);
    assert.strictEqual(await nativeAcademicField.inputValue(),"综测备注","academic record edit did not load its managed field value");
    await nativeAcademicField.fill("综测原生编辑已更新");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.goto("academic"));
    await page.evaluate(() => window.openAcademicWarningRowForm(990002,"qa_warning"));
    assert.match(await page.locator("#modalBody").innerText(),/学业情况（个人版） · 学业预警（个人版） · 自定义字段/,"academic warning edit does not show its module-specific custom fields");
    const nativeWarningField=page.locator(`#cfNative_academicWarning_${academicManagedFieldIds.academicWarning}`);
    assert.strictEqual(await nativeWarningField.inputValue(),"已联系家长","academic warning edit did not load its managed field value");
    await nativeWarningField.fill("预警原生编辑已更新");
    await page.locator("#modalOk").click();
    await page.evaluate(() => window.openGradeRowForm(990003,"qa_grade"));
    assert.match(await page.locator("#modalBody").innerText(),/学业情况（个人版） · 成绩与排名（个人版） · 自定义字段/,"academic grade edit does not show its module-specific custom fields");
    const nativeGradeField=page.locator(`#cfNative_academicGrade_${academicManagedFieldIds.academicGrade}`);
    assert.strictEqual(await nativeGradeField.inputValue(),"成绩复核完成","academic grade edit did not load its managed field value");
    await nativeGradeField.fill("成绩原生编辑已更新");
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate(() => Object.values(window.academicTerms.find(t=>t.id===990001).rows[0].customFieldValues)[0]),"综测原生编辑已更新","editing an academic record did not save its custom value");
    assert.strictEqual(await page.evaluate(() => Object.values(window.academicWarningTerms.find(t=>t.id===990002).rows[0].customFieldValues)[0]),"预警原生编辑已更新","editing an academic warning did not save its custom value");
    assert.strictEqual(await page.evaluate(() => Object.values(window.gradeTerms.find(t=>t.id===990003).rows[0].customFieldValues)[0]),"成绩原生编辑已更新","editing a grade record did not save its custom value");
    await page.evaluate(() => window.workbench.legacy.flushStore());
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => Object.values(students.find(s => s.id === "qa-punish-school").dorm[0].customFieldValues)[0]), "已通知宿管", "nested dorm values did not persist");
    assert.strictEqual(await page.evaluate(() => Object.values(students.find(s => s.id === "qa-punish-school").psych.customFieldValues)[0]), "面谈", "nested psychology values did not persist");
    assert.strictEqual(await page.evaluate(() => Object.values(window.academicTerms.find(t=>t.id===990001).rows[0].customFieldValues)[0]),"综测原生编辑已更新","academic custom values did not persist");
    assert.strictEqual(await page.evaluate(() => Object.values(window.academicWarningTerms.find(t=>t.id===990002).rows[0].customFieldValues)[0]),"预警原生编辑已更新","academic warning custom values did not persist");
    assert.strictEqual(await page.evaluate(() => Object.values(window.gradeTerms.find(t=>t.id===990003).rows[0].customFieldValues)[0]),"成绩原生编辑已更新","grade custom values did not persist");
    await page.evaluate(() => {
      const schemas=JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}");
      schemas.courseTimetable=[{id:"qa_cf_course",name:"班级课表补充",type:"text",active:true}];
      schemas.meeting=[{id:"qa_cf_meeting",name:"班会公共字段",type:"text",active:true}];
      schemas.checkClass=[{id:"qa_cf_check_class",name:"查课班级字段",type:"text",active:true}];
      schemas.checkDorm=[{id:"qa_cf_check_dorm",name:"查寝宿舍字段",type:"text",active:false}];
      localStorage.setItem("nnuzc_custom_field_schemas_v1",JSON.stringify(schemas));
      courseSchedules[0].customFieldValues={qa_cf_course:"本班共享课程值"};
      meetings.push({id:"qa_cf_meeting_record",term:"2025-2026-2学期",topic:"字段联动班会",date:"2026-08-18",classes:["测试班"],customFieldValues:{qa_cf_meeting:"本班共享班会值"}});
      checkClassRecords.push({id:"qa_cf_check_class_record",term:"2025-2026-2学期",date:"2026-08-18",cls:"测试班",customFieldValues:{qa_cf_check_class:"本班共享查课值"}});
      checkDormRecords.push({id:"qa_cf_check_dorm_record",term:"2025-2026-2学期",date:"2026-08-18",building:"7栋",room:"427",customFieldValues:{qa_cf_check_dorm:"本宿舍历史查寝值"}});
      persistCourseSchedules();persistMeetings();persistCheckClass();persistCheckDorm();
    });
    await page.evaluate(() => window.portraitShow("qa-punish-school"));
    const portraitCustomFields=await page.locator("#modalBody").innerText();
    const portraitCustomAudit=await page.evaluate(() => Object.keys(window.__CUSTOM_FIELDS__.registry).map(view=>({view,fields:window.__CUSTOM_FIELDS__.fields(view).map(field=>field.name),rows:window.__CUSTOM_FIELDS__.portraitFieldRows(view,students.find(s=>s.id==="qa-punish-school")).map(row=>row.entries.map(item=>[item.field.name,item.value]))})).filter(item=>item.fields.length));
    for(const marker of ["十五、自定义字段","学生补充信息","学生原生编辑已更新","处理依据","处分原生编辑已更新","处理备注","已通知宿管","访谈方式","面谈","证书复核备注","人工复核通过","跟进说明","综测原生编辑已更新","预警原生编辑已更新","成绩原生编辑已更新","班级课表补充","本班共享课程值","班会公共字段","本班共享班会值","查课班级字段","本班共享查课值","查寝宿舍字段（已停用）","本宿舍历史查寝值"]){
      assert.match(portraitCustomFields,new RegExp(marker),`student portrait is missing linked custom field: ${marker}; audit=${JSON.stringify(portraitCustomAudit)}`);
    }
    const portraitExportCustomFields=await page.evaluate(() => {const student=students.find(s=>s.id==="qa-punish-school"),rendered=portraitArchiveExportElement(student),text=rendered.content.innerText;rendered.host.remove();return text;});
    assert.match(portraitExportCustomFields,/十五、自定义字段[\s\S]*学生原生编辑已更新[\s\S]*处分原生编辑已更新/,"student archive export does not include linked custom fields");
    await page.evaluate(() => window.closeModal());
    const adapterTargets=await page.evaluate(() => Object.entries(window.__CUSTOM_FIELDS__.registry).flatMap(([view,entry])=>{const rows=entry.rows(),record=rows[0];if(!record||record.id==null)return [];record.customFieldValues=Object.assign({},record.customFieldValues,{__qa_adapter:"adapter:"+view});entry.save(rows);return [{view,id:String(record.id),value:"adapter:"+view}];}));
    await page.evaluate(() => window.workbench.legacy.flushStore());
    await page.reload({waitUntil:"networkidle"});
    const adapterFailures=await page.evaluate(targets=>targets.flatMap(target=>{try{const row=window.__CUSTOM_FIELDS__.registry[target.view].rows().find(item=>String(item.id)===target.id),actual=row&&row.customFieldValues&&row.customFieldValues.__qa_adapter;return actual===target.value?[]:[{view:target.view,id:target.id,actual:actual||""}];}catch(error){return [{view:target.view,id:target.id,error:String(error)}];}}),adapterTargets);
    assert.deepStrictEqual(adapterFailures,[],`custom-field storage adapters lost values after reload: ${JSON.stringify(adapterFailures)}`);
    await page.evaluate(() => window.customFieldsSettings("punishment"));
    const punishmentDeleteRow=page.locator(`#cfSettingsRows .cf-field-row[data-id="${punishmentFieldId}"]`);
    assert.strictEqual(await punishmentDeleteRow.locator(".cf-delete").innerText(),"删除","saved custom fields do not expose a delete action");
    page.once("dialog",dialog=>dialog.accept());
    await punishmentDeleteRow.locator(".cf-delete").click();
    assert.strictEqual(await punishmentDeleteRow.count(),0,"confirmed custom-field deletion did not remove the settings row");
    await page.locator("#modalOk").click();
    assert.deepStrictEqual(await page.evaluate((fieldId) => ({schema:(JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}").punishment||[]).some(field=>field.id===fieldId),values:window.__CUSTOM_FIELDS__.registry.punishment.rows().filter(record=>Object.prototype.hasOwnProperty.call(record.customFieldValues||{},fieldId)).length}),punishmentFieldId),{schema:false,values:0},"custom-field deletion did not purge its schema and stored values");
    await page.evaluate(() => window.workbench.legacy.flushStore());
    await page.reload({waitUntil:"networkidle"});
    assert.deepStrictEqual(await page.evaluate((fieldId) => ({schema:(JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}").punishment||[]).some(field=>field.id===fieldId),values:window.__CUSTOM_FIELDS__.registry.punishment.rows().filter(record=>Object.prototype.hasOwnProperty.call(record.customFieldValues||{},fieldId)).length}),punishmentFieldId),{schema:false,values:0},"deleted custom-field schema or values returned after reload");
    const nativeBridgeAudit=await page.evaluate(() => {const store=JSON.parse(localStorage.getItem("nnuzc_custom_field_schemas_v1")||"{}");Object.keys(window.__CUSTOM_FIELDS__.registry).forEach(view=>{if(!(store[view]||[]).some(field=>field.active!==false))(store[view]||(store[view]=[])).push({id:"qa_native_"+view,name:"原生接入审计",type:"text",active:true});});localStorage.setItem("nnuzc_custom_field_schemas_v1",JSON.stringify(store));return Object.entries(window.__CUSTOM_FIELDS__.registry).flatMap(([view,entry])=>{try{const rows=entry.rows(),record=rows[0];if(!record)return [];window.goto(entry.hostView||view);const body=window.__CUSTOM_FIELDS__.systemDefinitions(view).map(field=>window.__CUSTOM_FIELDS__.systemValue(view,record,field.key)).join(" | "),context=window.__CUSTOM_FIELDS__.nativeContext("编辑"+entry.name,body);return context&&context.view===view&&String(context.record&&context.record.id)===String(record.id)?[]:[{view,recordId:String(record.id),matchedView:context&&context.view||"",matchedId:context&&context.record&&String(context.record.id)||""}];}catch(error){return [{view,error:String(error)}];}});});
    assert.deepStrictEqual(nativeBridgeAudit,[],`native custom-field bridge could not resolve registered module records: ${JSON.stringify(nativeBridgeAudit)}`);
    const registryAudit=await page.evaluate(() => Object.entries(window.__CUSTOM_FIELDS__.registry).map(([view,entry]) => {try{const rows=entry.rows();return {view,count:rows.length,missing:rows.filter(row=>row?.id==null||row.id==="").length};}catch(error){return {view,error:String(error)};}}));
    assert.deepStrictEqual(registryAudit.filter(item=>item.error||item.missing),[],`registered modules contain inaccessible or unidentified records: ${JSON.stringify(registryAudit)}`);
    const systemFieldAudit=await page.evaluate(() => Object.keys(window.__CUSTOM_FIELDS__.registry).map(view => {try{const fields=window.__CUSTOM_FIELDS__.systemDefinitions(view);return {view,count:fields.length,invalid:fields.filter(field=>!field.key||!field.label).length,duplicate:fields.length-new Set(fields.map(field=>field.key)).size};}catch(error){return {view,error:String(error)};}}));
    assert.deepStrictEqual(systemFieldAudit.filter(item=>item.error||item.invalid||item.duplicate||item.count<2),[],`registered modules have incomplete system field definitions: ${JSON.stringify(systemFieldAudit)}`);
    assert.deepStrictEqual(pageErrors, [], `custom-fields page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `custom-fields console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `custom-fields HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Custom fields browser QA passed (multi-module setup, edit, rename, deactivate, history, persistence). ");
    return;
  }
  if (process.env.QA_PUNISH_LEVEL_ONLY === "1") {
    await page.evaluate(() => window.punishAdd("school"));
    assert.deepStrictEqual(await page.locator("#pLevel option").allTextContents(), ["通报批评", "警告", "严重警告", "记过", "留校察看", "开除学籍"], "school punishment levels are incomplete");
    await page.fill("#pNo", "qa-punish-school");
    await page.fill("#pContent", "校级通报批评回归测试");
    await page.locator("#modalOk").click();
    await page.waitForFunction(() => punishments.some((record) => record.type === "school" && record.content === "校级通报批评回归测试" && record.level === "通报批评"));
    await page.evaluate(() => window.punishEdit(20260812001));
    assert.strictEqual(await page.locator("#pLevel").inputValue(), "警告", "existing school punishment level was changed");
    await page.locator("#pLevel").selectOption("通报批评");
    await page.locator("#modalOk").click();
    await page.waitForTimeout(100);
    const editedLevel = await page.evaluate(() => ({ record: punishments.find((record) => String(record.id) === "20260812001"), modalOpen: document.querySelector("#mask").classList.contains("show"), studentId: document.querySelector("#pNo")?.value }));
    assert.strictEqual(editedLevel.record?.level, "通报批评", `edited school punishment level was not saved: ${JSON.stringify(editedLevel)}`);
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => punishments.find((record) => String(record.id) === "20260812001")?.level), "通报批评", "edited school punishment level did not persist");
    assert.strictEqual(await page.evaluate(() => punishments.some((record) => record.type === "school" && record.content === "校级通报批评回归测试" && record.level === "通报批评")), true, "new school punishment level did not persist");
    assert.deepStrictEqual(pageErrors, [], `punishment browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `punishment browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `punishment browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("School punishment level browser QA passed (add, edit, existing data, persistence). ");
    return;
  }
  assert.strictEqual(await page.locator("body").evaluate((node) => node.classList.contains("nav-drawer-closed")), false, "desktop navigation drawer should remain visible by default");
  assert.strictEqual(await page.locator("#navToggle").getAttribute("aria-expanded"), "true", "navigation drawer accessibility state is incorrect");
  const navigationTypography=await page.evaluate(() => {
    const read=(selector) => {const style=getComputedStyle(document.querySelector(selector));return {fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight};};
    return {group:read("#nav .nav-group"),item:read("#nav .nav-item:not(.active)")};
  });
  assert.deepStrictEqual(navigationTypography,{group:{fontSize:"14px",fontWeight:"650",lineHeight:"20.3px"},item:{fontSize:"14px",fontWeight:"650",lineHeight:"20.3px"}},"first-level and second-level navigation typography should use the same readable sizing");
  assert.strictEqual(await page.locator("#nav .nav-group").evaluateAll((nodes) => nodes.every((node) => node.getAttribute("aria-expanded") === "false")), true, "first-level navigation groups are not collapsed by default");
  const foldGroup = page.locator("#nav .nav-group").nth(1);
  const foldGroupName = (await foldGroup.innerText()).trim();
  assert.strictEqual(foldGroupName, "学生信息管理", "navigation group fixture changed unexpectedly");
  const studentInformationViews = await page.evaluate(() => {
    const group=Array.from(document.querySelectorAll("#nav .nav-group")).find((node) => node.textContent.trim() === "学生信息管理"),views=[];
    for(let node=group&&group.nextElementSibling;node&&!node.classList.contains("nav-group");node=node.nextElementSibling){if(node.dataset&&node.dataset.view)views.push(node.dataset.view);}
    return views;
  });
  assert.deepStrictEqual(studentInformationViews,["student","classOfficer","dorm","dormRoster","maint"],"basic data maintenance must be the last module under student information management");
  await foldGroup.click();
  assert.strictEqual(await foldGroup.getAttribute("aria-expanded"), "true", "navigation group did not expand");
  assert.strictEqual(await page.locator('#nav .nav-item[data-view="student"]').evaluate((node) => node.classList.contains("nav-group-fold-hidden")), false, "expanded navigation item remains hidden");
  await page.reload({ waitUntil: "networkidle" });
  assert.strictEqual(await page.locator("#nav .nav-group").nth(1).getAttribute("aria-expanded"), "false", "navigation group did not return to the collapsed default after refresh");
  assert.strictEqual(await page.locator('#nav .nav-item[data-view="student"]').evaluate((node) => node.classList.contains("nav-group-fold-hidden")), true, "navigation item remains visible after refresh");
  await page.evaluate(() => window.goto("student"));
  assert.strictEqual(await page.locator("#nav .nav-group").nth(1).getAttribute("aria-expanded"), "true", "opening a module did not expand its navigation group");
  assert.strictEqual(await page.locator('#nav .nav-item[data-view="student"]').evaluate((node) => node.classList.contains("nav-group-fold-hidden")), false, "active navigation item remains hidden after opening its module");
  await verifySearchableFilters(page);
  await verifyRequestedMultiSelectCoverage(page);
  await verifyCounselorGrowth(page);
  if (process.env.QA_COUNSELOR_GROWTH_ONLY === "1") {
    assert.deepStrictEqual(pageErrors, [], `counselor-growth browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `counselor-growth browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `counselor-growth browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Counselor-growth browser QA passed (retired fields, representative/archive, import, annual comparison, dictionaries, history restore, attachment, persistence and exports). ");
    return;
  }
  if (process.env.QA_SEARCHABLE_FILTER_SCREENSHOT) {
    await page.evaluate(() => window.goto("student"));
    await page.waitForTimeout(80);
    await page.locator('.zf-query .qf-multi[data-qf="cls"] .qf-multi-trigger').click();
    await page.screenshot({ path: path.resolve(process.env.QA_SEARCHABLE_FILTER_SCREENSHOT), fullPage: false });
  }
  if (process.env.QA_SEARCHABLE_FILTER_ONLY === "1") {
    assert.deepStrictEqual(pageErrors, [], `browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Searchable filter browser QA passed.");
    return;
  }
  const sidebarViews = await page.$$eval("#nav .nav-item[data-view],#nav .nav-sub-item[data-view]", (nodes) => [...new Set(nodes.map((node) => node.dataset.view))].sort());
  await page.evaluate(() => window.goto("navCustomize"));
  const customizedViews = await page.$$eval("#navCustomizePage [data-nav-custom-view]", (nodes) => nodes.map((node) => node.dataset.navCustomView).sort());
  assert.deepStrictEqual(customizedViews, sidebarViews, "custom navigation does not cover every second-level sidebar menu");
  assert.strictEqual(await page.locator('#navCustomizePage [data-nav-custom-view="navCustomize"]').isDisabled(), true, "custom navigation recovery entry must remain visible");
  assert.strictEqual(await page.locator('#navCustomizePage [draggable="true"]').count(), 0, "custom navigation must not provide drag-to-sort controls");
  assert.doesNotMatch((await page.locator("#navCustomizePage button").allTextContents()).join(" "), /上移|下移|排序|移动/, "custom navigation must not provide position controls");
  await page.locator('#navCustomizePage [data-nav-custom-view="portrait"]').uncheck();
  await page.waitForFunction(() => document.querySelector('#nav .nav-item[data-view="portrait"]').classList.contains("hidden"));
  assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_nav_visibility_v1")).hiddenViews.includes("portrait")), true, "unchecked menu was not saved locally");
  await page.evaluate(() => window.workbench.legacy.flushStore());
  const storedNavigation = await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_nav_visibility_v1);
  assert.ok(storedNavigation.hiddenViews.includes("portrait"), "unchecked menu was not persisted to SQLite");
  await page.reload({ waitUntil: "networkidle" });
  await page.evaluate(() => window.goto("navCustomize"));
  assert.strictEqual(await page.locator('#navCustomizePage [data-nav-custom-view="portrait"]').isChecked(), false, "hidden menu preference was not restored after reload");
  assert.strictEqual(await page.locator('#nav .nav-item[data-view="portrait"]').evaluate((node) => node.classList.contains("hidden")), true, "hidden menu reappeared after reload");
  await page.evaluate(() => window.navVisibilityReset());
  await page.waitForFunction(() => !document.querySelector('#nav .nav-item[data-view="portrait"]').classList.contains("hidden"));
  assert.strictEqual(await page.locator('#navCustomizePage [data-nav-custom-view]:not(:checked)').count(), 0, "restore-all did not check every menu");
  const views = await page.$$eval("[data-view]", (nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-view")).filter(Boolean))]);
  assert.ok(views.length > 0, "browser navigation is empty");
  const failed = [];
  const searchableFilterFailures = [];
  for (const view of views) {
    let outcome;
    try {
      await page.evaluate(async (target) => { await window.goto(target); await new Promise((resolve) => setTimeout(resolve, 40)); }, view);
      const iframe = page.locator("#content .student-org-frame iframe");
      if (await iframe.count()) {
        const frame = await iframe.contentFrame();
        await frame.locator("#main").waitFor({ state: "visible" });
        const iframeAudit = await searchableFilterAudit(frame, `${view}:iframe`);
        if (iframeAudit) searchableFilterFailures.push(iframeAudit);
        outcome = { text: (await frame.locator("#main").innerText()).trim() };
      } else {
        outcome = { text: (await page.locator("#content").innerText()).trim() };
      }
      const pageAudit = await searchableFilterAudit(page, view);
      if (pageAudit) searchableFilterFailures.push(pageAudit);
    } catch (error) {
      outcome = { error: String(error && (error.stack || error.message) || error) };
    }
    if (outcome.error || !outcome.text) failed.push({ view, outcome });
  }

  assert.deepStrictEqual(failed, [], `navigation rendering failures: ${JSON.stringify(failed)}`);
  assert.deepStrictEqual(searchableFilterFailures, [], `searchable filter coverage failures: ${JSON.stringify(searchableFilterFailures)}`);
  if (process.env.QA_SEARCHABLE_FILTER_AUDIT === "1") {
    assert.deepStrictEqual(pageErrors, [], `browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log(`Searchable filter coverage QA passed across ${views.length} views.`);
    return;
  }
  /* 学期设置：仅学期名称必填，开始时间与总教学周数均可留空。 */
  await page.evaluate(() => window.goto("semester"));
  await page.getByRole("button", { name: "＋ 新增学期", exact: true }).click();
  assert.strictEqual(await page.locator("#semesterSettingStart").inputValue(), "", "new semester start date should default to blank");
  assert.strictEqual(await page.locator("#semesterSettingWeeks").inputValue(), "", "new semester total weeks should default to blank");
  assert.match(await page.locator("#modalBody").innerText(), /开始时间、总教学周数均为非必填/);
  await page.fill("#semesterSettingYearStart", "2026");
  await page.fill("#semesterSettingYearEnd", "2027");
  await page.fill("#semesterSettingNumber", "1");
  await Promise.all([page.waitForEvent("load"), page.locator("#modalOk").click()]);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.goto("semester"));
  assert.match(await page.locator("#content tbody").innerText(), /2026-2027-1学期\s+未设置\s+未设置\s+未设置/);
  assert.deepStrictEqual(await page.evaluate(() => getTermSettings()["2026-2027-1学期"]), {startDate:"",totalWeeks:""}, "blank semester calendar settings were not preserved");
  await page.evaluate(() => window.workbench.legacy.flushStore());
  assert.deepStrictEqual(await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_term_settings["2026-2027-1学期"]), {startDate:"",totalWeeks:""}, "blank semester calendar settings were not persisted to SQLite");
  if (process.env.QA_SEMESTER_OPTIONAL_ONLY === "1") {
    assert.deepStrictEqual(pageErrors, [], `optional-semester browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `optional-semester browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `optional-semester browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Optional semester calendar browser QA passed (blank start date and total weeks persisted). ");
    return;
  }
  /* 班级干部管理：任职管理与按学期班委考核平行，名单只同步在任干部。 */
  await page.evaluate(() => window.goto("classOfficer"));
  assert.match(await page.locator("#content").innerText(), /班级干部管理[\s\S]*任职管理[\s\S]*班委考核/);
  await page.getByRole("button", { name: /新增任职/ }).click();
  await page.locator("#coName").fill("处分测试");
  assert.strictEqual(await page.locator("#coNameResults .co-name-option").count(), 2, "class officer name keyword search did not show matching students");
  await page.locator("#coNameResults .co-name-option").filter({ hasText: "qa-punish-school" }).click();
  assert.strictEqual(await page.locator("#coSid").inputValue(), "qa-punish-school", "class officer name search did not fill the selected student ID");
  assert.strictEqual(await page.locator("#coName").inputValue(), "处分测试甲", "class officer student ID did not match the student archive");
  assert.strictEqual(await page.locator("#coCls").inputValue(), "测试班", "class officer form did not fill the student's class");
  await page.locator("#coPosition").fill("班长");
  assert.strictEqual(await page.locator("#coPosition").getAttribute("list"), null, "class officer position should be a manual text field");
  assert.strictEqual(await page.locator("#coTerm").count(), 0, "class officer form still contains a term field");
  assert.strictEqual(await page.locator("#coAssessmentLevel").count(), 0, "assessment level must not remain in the appointment form");
  await page.locator("#coDuties").fill("统筹班级日常事务");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => classOfficerRecords.length), 1, "class officer appointment was not added");
  assert.match(await page.evaluate(() => students.find((student) => student.id === "qa-punish-school").cadre), /班长（测试班，在任）/, "class officer appointment was not synchronized to the student cadre field");
  await page.evaluate(() => stuEdit("qa-punish-school"));
  assert.strictEqual(await page.locator("#fCadre").isEditable(), false, "managed student cadre field should be read-only in student management");
  assert.match(await page.locator("#fCadre").inputValue(), /班长/);
  assert.strictEqual(await page.locator("#fCadreHistory").inputValue(), "", "active appointment was incorrectly shown as history");
  await page.evaluate(() => closeModal());
  await page.evaluate(() => {
    const nextTerm = "2026-2027-1学期";
    const terms = getTermList();
    if (!terms.includes(nextTerm)) { terms.push(nextTerm); saveTermList(terms); }
    syncTermToModules(nextTerm);
  });
  await page.locator("#content .tabs .tab").filter({ hasText: "班委考核" }).click();
  assert.match(await page.locator("#content").innerText(), /学期来自“系统管理 > 学期设置”[\s\S]*优秀、良好、中等、及格、不及格/);
  assert.strictEqual(await page.locator('#content .qf-multi[data-qf="classOfficerAssessmentViewTerms"]').count(), 1, "class officer assessment term query is not a multi-select checkbox field");
  assert.strictEqual(await page.locator("#content tbody tr").count(), 2, "class officer assessment terms were not synchronized from system term settings");
  assert.deepStrictEqual(await page.evaluate(() => classOfficerAssessmentTerms.filter((item) => getTermList().includes(item.term)).map((item) => ({ term: item.term, rows: item.rows.length })).sort((a, b) => a.term.localeCompare(b.term))), [
    { term: "2025-2026-2学期", rows: 1 },
    { term: "2026-2027-1学期", rows: 1 }
  ], "active class officer was not synchronized into every system term");
  await page.locator('.qf-multi[data-qf="classOfficerAssessmentViewTerms"] .qf-multi-trigger').click();
  await page.locator('.qf-multi[data-qf="classOfficerAssessmentViewTerms"] input[type="checkbox"][value="2026-2027-1学期"]').check();
  await page.keyboard.press("Escape");
  await page.locator('.qf-bar[data-page="classOfficerAssessmentTerms"]').getByRole("button", { name: "查询", exact: true }).click();
  assert.strictEqual(await page.locator("#content tbody tr").count(), 1, "class officer assessment multi-term query did not narrow the term list");
  assert.match(await page.locator("#content tbody tr").innerText(), /2026-2027-1学期/);
  await page.locator('.qf-bar[data-page="classOfficerAssessmentTerms"]').getByRole("button", { name: "重置", exact: true }).click();
  const currentAssessmentTerm = await page.evaluate(() => CURRENT_TERM);
  await page.locator("#content tbody tr").filter({ hasText: currentAssessmentTerm }).getByRole("link", { name: "进入考核" }).click();
  await page.waitForFunction(() => document.querySelectorAll('#modal .qf-multi[data-qf]').length === 7);
  const assessmentModalLayout = await page.evaluate(() => {
    const modal=document.getElementById("modal"),body=document.getElementById("modalBody"),layout=modal.querySelector(".coa-assessment-layout"),filters=[...modal.querySelectorAll(".coa-assessment-filters .filter-item")],table=modal.querySelector(".coa-assessment-table"),foot=document.getElementById("modalFoot");
    const filterRows=new Set(filters.map(item=>Math.round(item.getBoundingClientRect().top)));
    const tableRect=table.getBoundingClientRect(),footRect=foot.getBoundingClientRect();
    return {hasClass:modal.classList.contains("class-officer-assessment-modal"),layoutDisplay:getComputedStyle(layout).display,filterDisplay:getComputedStyle(modal.querySelector(".coa-assessment-filters")).display,filterCount:filters.length,filterRows:filterRows.size,tableHeight:tableRect.height,tableBottom:tableRect.bottom,footerTop:footRect.top,modalBottom:modal.getBoundingClientRect().bottom,viewportHeight:innerHeight,bodyOverflow:getComputedStyle(body).overflow};
  });
  assert.strictEqual(assessmentModalLayout.hasClass, true, "class officer assessment modal is missing its dedicated layout class");
  assert.strictEqual(assessmentModalLayout.layoutDisplay, "flex", "class officer assessment modal content is not using the fixed flex layout");
  assert.strictEqual(assessmentModalLayout.filterDisplay, "grid", "class officer assessment filters are not arranged as a responsive grid");
  assert.ok(assessmentModalLayout.filterRows < assessmentModalLayout.filterCount, "class officer assessment filters are stacked in a single vertical column");
  assert.ok(assessmentModalLayout.tableHeight >= 120, "class officer assessment table has been collapsed or clipped");
  assert.ok(assessmentModalLayout.tableBottom <= assessmentModalLayout.footerTop + 1 && assessmentModalLayout.modalBottom <= assessmentModalLayout.viewportHeight + 1, "class officer assessment table or footer extends outside the modal viewport: " + JSON.stringify(assessmentModalLayout));
  assert.strictEqual(await page.locator('#modal .qf-multi[data-qf]').count(), 7, "all categorical class officer assessment query fields must be multi-select checkboxes");
  assert.strictEqual(await page.locator('#modal .qf-multi[data-qf]').evaluateAll((nodes) => nodes.every((node) => node.querySelectorAll('.qf-multi-opt input[type="checkbox"]').length > 0)), true, "class officer assessment query fields are missing checkbox options");
  const assessmentSelect = page.locator('#coaTermTbody .coa-level-select[data-row-id]').first();
  assert.deepStrictEqual(await assessmentSelect.locator("option").allTextContents(), ["请选择", "优秀", "良好", "中等", "及格", "不及格"], "class officer assessment grade options are incorrect");
  await assessmentSelect.selectOption("优秀");
  assert.strictEqual(await page.evaluate(() => classOfficerAssessmentTerms.find((item) => item.term === CURRENT_TERM).rows[0].level), "优秀", "class officer term assessment level was not saved");
  await page.locator('.qf-multi[data-qf="coaLevel"] .qf-multi-trigger').click();
  await page.locator('.qf-multi[data-qf="coaLevel"] input[type="checkbox"][value="优秀"]').check();
  await page.keyboard.press("Escape");
  await page.locator('#modal .qf-bar').getByRole("button", { name: "查询", exact: true }).click();
  assert.strictEqual(await page.locator("#coaTermTbody tr").count(), 1, "multi-select assessment grade query did not retain the matching row");
  await page.evaluate(() => closeModal());
  await page.evaluate(() => {
    window.__coaOriginalDownload = window.downloadXlsxFile;
    window.__coaExportCapture = null;
    window.downloadXlsxFile = function(sheet, rows, fileName) { window.__coaExportCapture = { sheet, rows, fileName }; };
  });
  await page.getByRole("button", { name: /导出多学期考核/ }).click();
  assert.strictEqual(await page.locator("#coaExportTermList .coa-export-term-cb").count(), 2, "multi-term assessment export did not list every system term");
  await page.locator("#modalOk").click();
  const multiAssessmentExport = await page.evaluate(() => {
    const capture = window.__coaExportCapture;
    window.downloadXlsxFile = window.__coaOriginalDownload;
    delete window.__coaOriginalDownload;
    return capture;
  });
  assert.deepStrictEqual(multiAssessmentExport.rows[0].slice(0, 6), ["学院", "专业", "年级", "班级", "学号", "姓名"], "multi-term assessment export identity columns are incorrect");
  assert.deepStrictEqual(multiAssessmentExport.rows[0].slice(6), ["2026-2027-1学期 职务", "2026-2027-1学期 考核等级", "2025-2026-2学期 职务", "2025-2026-2学期 考核等级"], "multi-term assessment export term columns are incorrect");
  assert.deepStrictEqual(multiAssessmentExport.rows[1].slice(8, 10), ["班长", "优秀"], "multi-term assessment export did not include the saved grade");
  await page.locator("#content .tabs .tab").filter({ hasText: "任职管理" }).click();
  assert.strictEqual(await page.locator('#content .co-toolbar .qf-multi[data-qf]').count(), 6, "all categorical appointment query fields must be multi-select checkboxes");
  assert.strictEqual(await page.locator('#content .co-toolbar .qf-multi[data-qf]').evaluateAll((nodes) => nodes.every((node) => node.querySelectorAll('.qf-multi-opt input[type="checkbox"]').length > 0)), true, "appointment query fields are missing checkbox options");
  await page.locator('.qf-multi[data-qf="coStatus"] .qf-multi-trigger').click();
  await page.locator('.qf-multi[data-qf="coStatus"] input[type="checkbox"][value="在任"]').check();
  await page.keyboard.press("Escape");
  await page.locator("#content .co-toolbar").getByRole("button", { name: "查询", exact: true }).click();
  assert.strictEqual(await page.locator("#content .co-table tbody tr").count(), 1, "multi-select appointment status query did not retain the matching row");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "离任" }).click();
  await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => classOfficerRecords[0].status), "已离任", "class officer appointment did not transition to ended");
  assert.strictEqual(await page.evaluate(() => students.find((student) => student.id === "qa-punish-school").cadre), "", "ended appointment remained in current class officer field");
  assert.match(await page.evaluate(() => students.find((student) => student.id === "qa-punish-school").cadreHistory), /班长（测试班，已离任）/, "ended class officer status was not synchronized to history");
  assert.deepStrictEqual(await page.evaluate(() => ({ current: classOfficerAssessmentTerms.find((item) => item.term === CURRENT_TERM).rows.map((row) => row.level), next: classOfficerAssessmentTerms.find((item) => item.term === "2026-2027-1学期").rows.length })), { current: ["优秀"], next: 0 }, "ended officer roster synchronization did not preserve completed history and remove unassessed rows");
  await page.locator("#content .tabs .tab").filter({ hasText: "班委考核" }).click();
  await page.locator("#content tbody tr").filter({ hasText: currentAssessmentTerm }).getByRole("link", { name: "进入考核" }).click();
  assert.strictEqual(await page.locator("#coaTermTbody .coa-level-select").isDisabled(), true, "ended officer historical assessment must be read-only");
  assert.match(await page.locator("#coaTermTbody").innerText(), /已离任（历史考核）/);
  await page.evaluate(() => closeModal());
  await page.locator("#content .tabs .tab").filter({ hasText: "任职管理" }).click();
  await page.locator("#content .co-toolbar").getByRole("button", { name: "重置", exact: true }).click();
  const classOfficerTemplateHeaders = await page.evaluate(() => {
    const original = window.downloadXlsxFile;
    let headers = null;
    window.downloadXlsxFile = function(_sheet, rows) { headers = rows[0]; };
    classOfficerImportTemplate();
    window.downloadXlsxFile = original;
    return headers;
  });
  assert.deepStrictEqual(classOfficerTemplateHeaders, ["学号", "职务", "任职日期", "离任日期", "任职状态", "职责说明", "备注"], "class officer appointment template fields are incorrect");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "删除" }).click();
  await page.waitForFunction(() => classOfficerRecords.length === 0, null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => classOfficerRecords.length), 0, "class officer appointment was not deleted");
  assert.strictEqual(await page.evaluate(() => students.find((student) => student.id === "qa-punish-school").cadre), "", "deleting the last class officer appointment did not clear the synchronized student field");
  assert.strictEqual(await page.evaluate(() => students.find((student) => student.id === "qa-punish-school").cadreHistory), "", "deleting the last class officer appointment did not clear appointment history");
  if (process.env.QA_CLASS_OFFICER_ONLY === "1") {
    assert.deepStrictEqual(pageErrors, [], `class officer page errors: ${pageErrors.join(" | ")}`);
    assert.deepStrictEqual(badResponses, [], `class officer bad responses: ${badResponses.join(" | ")}`);
    console.log("qa-browser: class officer management passed (multi-term export, multi-select queries, term sync, active-only roster, five grades, archive semantics)");
    return;
  }
  /* 学生组织架构：干部花名册必须与树节点共用数据，手机号、四种状态和 Excel 导入同步可用。 */
  await page.evaluate(async () => { await window.goto("studentOrgManage"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  const orgFrame = await page.locator("#content .student-org-frame iframe").contentFrame();
  await orgFrame.locator("html").evaluate(() => {
    DB = {
      orgs: [{ id: "qa-org", cat: "union-u", name: "回归学生会", year: "2026-2027", termNo: 1, advisor: "王老师", structure: [
        { id: "qa-org-chair", name: "主席团", role: "统筹", members: [{ sid: "qa-org-001", name: "在职甲", college: "信息工程学院", grade: "2023级", major: "计算机应用", cls: "2301", position: "主席", phone: "13800000000", status: "在职", joined: "2026-09-01" }], children: [] },
        { id: "qa-org-office", name: "办公室", role: "文书", members: [{ sid: "qa-org-002", name: "退出乙", position: "干事", phone: "13900000000", status: "退出", joined: "2026-09-02" }], children: [] }
      ] }], activities: [], meetings: [], trainings: [], classrooms: [], tasks: [], templates: [], years: [], meta: {}
    };
    orgOpen("qa-org");
  });
  await orgFrame.locator("#orgRosterCard").waitFor({ state: "visible" });
  assert.match(await orgFrame.locator("#orgRosterCard").innerText(), /在职甲/);
  assert.ok(!(await orgFrame.locator("#orgRosterCard").innerText()).includes("退出乙"), "干部花名册默认不应显示非在职成员");
  assert.deepStrictEqual(await orgFrame.locator("#orgRosterCard th").allTextContents(), ["学号", "姓名", "学院", "年级", "专业", "班级", "所属部门/层级", "职务", "手机号", "状态", "入会日期", "操作"], "干部花名册字段不完整或顺序错误");
  await orgFrame.locator("#orgRosterCard select").nth(1).selectOption("");
  assert.match(await orgFrame.locator("#orgRosterCard").innerText(), /退出乙/);
  await orgFrame.locator("html").evaluate(() => nodeEditTree("qa-org", "qa-org-chair"));
  assert.strictEqual(await orgFrame.locator("#memberRows .m-phone").count(), 1, "编辑部门/岗位缺少手机号字段");
  assert.deepStrictEqual(await orgFrame.locator("#memberRows .m-status option").allTextContents(), ["在职", "已卸任", "退出", "开除"], "干部状态字典不完整");
  await orgFrame.locator("html").evaluate(() => importStructRows("qa-org", [STRUCT_IMPORT_HEAD, ["宣传部", "宣传", "开除丙", "qa-org-003", "", "", "", "", "干事", "13700000000", "开除", "2026-09-03"]]));
  await orgFrame.locator("#orgRosterCard select").nth(1).selectOption("");
  assert.match(await orgFrame.locator("#orgRosterCard").innerText(), /开除丙/);
  assert.strictEqual(await orgFrame.locator("html").evaluate(() => DB.orgs[0].structure.find((node) => node.name === "宣传部").members[0].phone), "13700000000", "干部名册导入未同步手机号至架构节点");
  page.once("dialog", (dialog) => dialog.accept());
  await orgFrame.locator('#orgRosterCard tbody tr:has-text("开除丙") button').click();
  await orgFrame.locator('#orgRosterCard tbody tr:has-text("开除丙")').waitFor({ state: "detached" });
  assert.ok(!(await orgFrame.locator("#orgRosterCard").innerText()).includes("开除丙"), "干部花名册删除后仍显示该记录");
  assert.strictEqual(await orgFrame.locator("html").evaluate(() => DB.orgs[0].structure.find((node) => node.name === "宣传部").members.length), 0, "干部花名册删除未同步至架构节点");
  await page.evaluate(async () => { setQueryReady("home", true); await window.goto("home"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  const homeTableText = await page.locator("#homeBody table").innerText();
  assert.ok(!homeTableText.includes("沟通内容"), "home contact list still displays the communication-content column");
  assert.ok(!homeTableText.includes("结果/反馈"), "home contact list still displays the feedback-result column");
  assert.ok(!homeTableText.includes("这是仅在详情中显示的完整沟通内容。"), "home contact list exposes full communication content");
  await page.locator('#homeBody a[onclick*="homeView"]').click();
  assert.match(await page.locator("#modalTitle").textContent(), /家校联系详情/);
  assert.match(await page.locator("#modalBody").innerText(), /这是仅在详情中显示的完整沟通内容。/);
  assert.match(await page.locator("#modalBody").innerText(), /这是仅在详情中显示的完整结果反馈。/);
  await page.locator('#modalFoot button[onclick="closeModal()"]').click();
  /* 助学贷款：按学年独立建档，学号和姓名均可匹配学生，银行与金额允许留空。 */
  await page.evaluate(async () => { await window.goto("studentLoan"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.match(await page.locator("#content").innerText(), /助学贷款[\s\S]*按学年记录/);
  await page.getByRole("button", { name: "＋ 新增", exact: true }).click();
  await page.fill("#slFormYear", "2026-2027学年");
  await page.fill("#slFormSid", "qa-punish-school");
  await page.waitForTimeout(80);
  assert.deepStrictEqual(await page.locator("#modalBody").evaluate(() => ({
    name: document.getElementById("slFormName").value,
    dept: document.getElementById("slFormDept").value,
    major: document.getElementById("slFormMajor").value,
    grade: document.getElementById("slFormGrade").value,
    cls: document.getElementById("slFormCls").value
  })), { name: "处分测试甲", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班" }, "student-loan ID matching did not fill the student profile");
  assert.strictEqual(await page.locator("#slFormBank").getAttribute("required"), null, "student-loan bank must remain optional");
  assert.strictEqual(await page.locator("#slFormAmount").getAttribute("required"), null, "student-loan amount must remain optional");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(120);
  assert.match(await page.locator("#content tbody").innerText(), /2026-2027学年[\s\S]*qa-punish-school[\s\S]*处分测试甲/);
  assert.strictEqual(await page.evaluate(() => studentLoanRecords.length), 1, "student-loan record was not created");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.fill("#slFormSid", "");
  await page.fill("#slFormName", "处分测试乙");
  await page.locator("#slFormName").blur();
  await page.waitForTimeout(80);
  assert.strictEqual(await page.locator("#slFormSid").inputValue(), "qa-punish-college", "student-loan name matching did not fill the student ID");
  await page.fill("#slFormBank", "国家开发银行");
  await page.fill("#slFormAmount", "12000.50");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(120);
  assert.deepStrictEqual(await page.evaluate(() => {
    const record=studentLoanRecords[0]; return {studentId:record.studentId,name:record.name,bank:record.bank,amount:record.amount,year:record.year};
  }), {studentId:"qa-punish-college",name:"处分测试乙",bank:"国家开发银行",amount:"12000.50",year:"2026-2027学年"}, "student-loan edit or optional fields were not persisted");
  const studentLoanImportCsv=path.join(temp,"student-loan-mapped-import.csv");
  fs.writeFileSync(studentLoanImportCsv,"\uFEFF贷款年度,学生编号,学生姓名,开户行,贷款数额\n2027-2028学年,qa-punish-school,,中国银行,8000.5\n2028-2029学年,,处分测试乙,,\n","utf8");
  await page.getByRole("button", { name: "⬆ 导入", exact: true }).click();
  assert.match(await page.locator("#modalTitle").innerText(), /助学贷款导入/);
  assert.match(await page.locator("#modalBody").innerText(), /点击下载导入模板/);
  await page.setInputFiles("#mappedImportFile",studentLoanImportCsv);
  await page.getByRole("button", { name: "下一步 →", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("modalBody").innerText.includes("数据预览"));
  assert.match(await page.locator("#modalBody").innerText(), /贷款年度[\s\S]*qa-punish-school/);
  await page.getByRole("button", { name: "下一步 →", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".import-field-table tbody select").length>0);
  assert.match(await page.locator("#modalBody").innerText(), /字段映射[\s\S]*Excel 列（表头）/);
  const studentLoanMapping=await page.locator(".import-field-table tbody tr").evaluateAll((rows) => Object.fromEntries(rows.map((row) => [row.querySelector("input").value,row.querySelector("select").value])));
  assert.strictEqual(studentLoanMapping["学年"],"贷款年度","student-loan academic-year alias was not mapped");
  assert.strictEqual(studentLoanMapping["学号"],"学生编号","student-loan ID alias was not mapped");
  assert.strictEqual(studentLoanMapping["姓名"],"学生姓名","student-loan name alias was not mapped");
  assert.strictEqual(studentLoanMapping["金额（元）"],"贷款数额","student-loan amount alias was not mapped");
  await page.getByRole("button", { name: "校验数据 →", exact: true }).click();
  const loanIdentity=page.locator('#studentLinkImportLayer');
  await loanIdentity.waitFor({state:'visible'});
  assert.strictEqual(await loanIdentity.locator('select[id^="studentLinkIdentityChoice-"]').count(),2,'both missing identity halves require explicit confirmation');
  await page.locator('#studentLinkIdentityChoice-0').selectOption('sid');
  await page.locator('#studentLinkIdentityChoice-1').selectOption('name');
  await loanIdentity.getByRole('button',{name:'确认并继续导入'}).click();
  await loanIdentity.waitFor({state:'detached'});
  assert.strictEqual(await page.locator(".import-summary .kpi.ok .n").innerText(),"2","student-loan mapped import should validate ID and name matched rows");
  await page.getByRole("button", { name: "确认导入 2 条", exact: true }).click();
  await page.getByText("导入完成", { exact: true }).waitFor();
  assert.deepStrictEqual(await page.evaluate(() => {
    const record=studentLoanRecords.find((item) => item.studentId==="qa-punish-school"&&item.year==="2027-2028学年");
    return record&&{name:record.name,dept:record.dept,major:record.major,grade:record.grade,cls:record.cls,bank:record.bank,amount:record.amount};
  }), {name:"处分测试甲",dept:"测试学院",major:"测试专业",grade:"2025",cls:"测试班",bank:"中国银行",amount:"8000.50"}, "student-loan mapped import did not use the matched student profile");
  assert.deepStrictEqual(await page.evaluate(() => {
    const record=studentLoanRecords.find((item) => item.studentId==="qa-punish-college"&&item.year==="2028-2029学年");
    return record&&{name:record.name,bank:record.bank,amount:record.amount};
  }), {name:"处分测试乙",bank:"",amount:""}, "student-loan name-only mapped import or optional fields failed");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(() => window.workbench.legacy.flushStore());
  assert.strictEqual(await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_student_loan_records[0].studentId), "qa-punish-college", "student-loan record was not persisted to SQLite");
  await page.evaluate(() => window.portraitShow("qa-punish-college"));
  assert.match(await page.locator("#modalTitle").innerText(), /学生全档案 · 处分测试乙/);
  const studentLoanPortraitText=await page.locator("#modalBody").innerText();
  assert.match(studentLoanPortraitText, /助学贷款[\s\S]*2026-2027学年[\s\S]*国家开发银行[\s\S]*12,000\.50/, "student-loan data was not synchronized to the student portrait");
  assert.match(studentLoanPortraitText, /贷款学年[\s\S]*学院[\s\S]*年级[\s\S]*班级[\s\S]*专业[\s\S]*学号[\s\S]*姓名[\s\S]*贷款银行[\s\S]*金额/, "student-loan portrait fields are incomplete");
  await page.evaluate(() => window.closeModal());
  if (process.env.QA_STUDENT_LOAN_ONLY === "1") {
    assert.deepStrictEqual(pageErrors, [], `student-loan browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `student-loan browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `student-loan browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Student-loan browser QA passed (mapped CSV import, aliases, ID/name matching, optional fields, edit, SQLite persistence and portrait synchronization).");
    return;
  }
  /* 花名册已从“宿舍管理”页内标签迁移为学生信息管理下的独立入口。 */
  await page.evaluate(async () => { await window.goto("dormRoster"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.match(await page.locator("#content").innerText(), /按班级/);
  assert.strictEqual(await page.locator('#content .qf-single[data-qf="dormRoster_mode"]').getAttribute("data-cur"), "class", "dorm roster default generation mode is not class");
  assert.ok(await page.locator("#content .dr-roster-filters .qf-multi").count() >= 6, "dorm roster filters do not reuse the standard multi-select control");
  assert.strictEqual(await page.locator("#dormRosterFilterConfirm").innerText(), "确定", "dorm roster filter confirmation button is missing");
  await page.evaluate(() => window.dormRosterFilter("cls", "__不存在班级__", true));
  assert.doesNotMatch(await page.locator("#content").innerText(), /匹配 0 人/, "dorm roster filters must wait for confirmation before refreshing results");
  await page.locator("#dormRosterFilterConfirm").click();
  assert.match(await page.locator("#content").innerText(), /匹配 0 人/, "dorm roster confirmation did not apply the pending filters");
  await page.evaluate(() => window.dormRosterClearFilter("cls")); await page.locator("#dormRosterFilterConfirm").click();
  assert.deepStrictEqual(await page.locator('#content input[type="checkbox"]:checked').evaluateAll((nodes) => nodes.map((node) => node.parentElement.textContent.trim()).filter((text) => ["证件照", "姓名", "学号", "性别", "学院", "专业", "年级", "班级", "区位", "楼栋", "房间号", "床位号", "手机号", "辅导员", "民族", "政治面貌"].includes(text)).sort()), ["证件照", "姓名", "学号", "性别", "学院", "专业", "年级", "班级", "区位", "楼栋", "房间号", "床位号", "手机号", "辅导员", "民族", "政治面貌"].sort(), "dorm roster default fields differ from the approved selection");
  assert.strictEqual(await page.evaluate(() => typeof window.dormRosterXlsx === "function" && typeof window.dormRosterPdf === "function" && typeof window.dormRosterPreview === "function"), true, "dorm roster actions are unavailable");
  await page.locator('#content button[onclick="dormRosterGenerate()"]').click();
  assert.match(await page.locator("#content .dr-preview").innerText(), /处分测试甲/);
  assert.match(await page.locator("#content .dr-preview").innerText(), /测试班/);
  await page.locator('#content button[onclick="dormRosterPreview()"]').click();
  assert.match(await page.locator("#modalTitle").innerText(), /花名册全屏预览/);
  assert.ok(await page.locator("#modalBody .dr-modal-preview .dr-card").count(), "full roster preview has no student cards");
  await page.locator("#modalOk").click();
  const rosterPdfDownload = page.waitForEvent("download", { timeout: 20000 });
  await page.locator('#content button[onclick="dormRosterPdf()"]').click();
  const rosterPdf = await rosterPdfDownload;
  const rosterPdfPath = await rosterPdf.path();
  assert.ok(rosterPdfPath && fs.statSync(rosterPdfPath).size > 1000, "dorm roster PDF is empty");
  assert.ok(fs.readFileSync(rosterPdfPath).subarray(0, 4).equals(Buffer.from("%PDF")), "dorm roster export is not a PDF");
  await page.evaluate(() => {
    const rosterStudents = window.__NNUZC__.students;
    rosterStudents.find((student) => student.id === "qa-punish-school").cls = "000002测试班";
    rosterStudents.find((student) => student.id === "qa-punish-college").cls = "000001测试班";
    window.dormRosterGenerate();
  });
  assert.match((await page.locator("#content .dr-card").first().innerText()), /处分测试乙/, "class roster is not ordered by the first six class-number digits");
  await page.evaluate(() => {
    window.__NNUZC__.students.find((student) => student.id === "qa-punish-school").cls = "测试班";
    window.__NNUZC__.students.find((student) => student.id === "qa-punish-college").cls = "测试班";
  });
  await page.evaluate(async () => { await window.goto("customRoster"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.strictEqual(await page.locator("#customRosterFilterConfirm").innerText(), "确定", "custom roster filter confirmation button is missing");
  assert.strictEqual(await page.evaluate(() => typeof window.customRosterApplyFilters), "function", "custom roster filter confirmation action is unavailable");
  if (process.env.QA_ROSTER_FILTER_ONLY === "1") {
    assert.deepStrictEqual(pageErrors, [], `roster-filter browser page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepStrictEqual(consoleErrors, [], `roster-filter browser console errors: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(badResponses, [], `roster-filter browser HTTP errors: ${JSON.stringify(badResponses)}`);
    console.log("Roster-filter browser QA passed (standard/custom confirmation buttons and apply-on-confirm behavior).");
    return;
  }
  await page.evaluate(async () => { await window.goto("dorm"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  await page.evaluate(() => window.dormSpatialSetTab("distribution"));
  await page.locator('#content button[onclick="dormAdd()"]').click();
  await page.fill("#daId", "qa-punish-school");
  await page.locator("#daId").blur();
  await page.waitForTimeout(100);
  assert.strictEqual(await page.locator("#daMajor").inputValue(), "测试专业", "new dorm allocation did not auto-fill the matched student's major");
  await page.evaluate(() => window.closeModal());
  const dormSync = await page.evaluate(() => {
    const activeId="qa-dorm-sync-active", inactiveId="qa-dorm-sync-inactive";
    const makeStudent=(id,name,status)=>ensureStudentNested({id,name,status,gender:"男",dept:"测试学院",major:"测试专业",grade:"2026级",cls:"测试班",accom:"",building:"",room:"",bed:""});
    students.push(makeStudent(activeId,"宿舍同步在校生","在校"),makeStudent(inactiveId,"宿舍同步非在校生","休学"));
    viewFilter.dorm_dist={};
    let result;
    try{
      const visibleBefore=dormDistRows().some(row=>String(row.id)===activeId);
      const inactiveHidden=!dormDistRows().some(row=>String(row.id)===inactiveId);
      const active=students.find(student=>student.id===activeId);
      active.status="休学";
      const removedAfterStatusChange=!dormDistRows().some(row=>String(row.id)===activeId);
      active.status="在校";
      const restoredAfterStatusChange=dormDistRows().some(row=>String(row.id)===activeId);
      const unknown=window.dormAddCommit({id:"qa-dorm-missing",accom:"校内",building:"QA栋",room:"999",bed:"98"});
      const nonCampus=window.dormAddCommit({id:inactiveId,accom:"校内",building:"QA栋",room:"999",bed:"97"});
      const identityBefore={name:active.name,dept:active.dept,major:active.major,grade:active.grade,cls:active.cls};
      const saved=window.dormAddCommit({id:activeId,name:"错误姓名",dept:"错误学院",major:"错误专业",grade:"错误年级",cls:"错误班级",accom:"校内",zone:"测试区",building:"QA栋",room:"999",bed:"3"});
      const identityUnchanged=JSON.stringify(identityBefore)===JSON.stringify({name:active.name,dept:active.dept,major:active.major,grade:active.grade,cls:active.cls});
      const merged=dormDistRows().find(row=>String(row.id)===activeId);
      const importCheck=dormImportValidate([{"学号":activeId,"住宿情况":"校内"},{"学号":inactiveId,"住宿情况":"走读"},{"学号":"qa-dorm-missing","住宿情况":"走读"}]);
      result={visibleBefore,inactiveHidden,removedAfterStatusChange,restoredAfterStatusChange,unknownOk:unknown.ok,unknownError:unknown.error,nonCampusOk:nonCampus.ok,nonCampusError:nonCampus.error,savedOk:saved.ok,identityUnchanged,merged,importOk:importCheck.ok.length,importErrors:importCheck.errors.map(item=>item.msg)};
    }finally{
      for(let i=students.length-1;i>=0;i--)if([activeId,inactiveId].includes(String(students[i].id)))students.splice(i,1);
      for(let i=dormDistRecords.length-1;i>=0;i--)if([activeId,inactiveId].includes(String(dormDistRecords[i].studentId||dormDistRecords[i].id)))dormDistRecords.splice(i,1);
      persistStudents();persistDormDist();
    }
    return result;
  });
  assert.strictEqual(dormSync.visibleBefore, true, "an in-school student without accommodation data is missing from dorm management");
  assert.strictEqual(dormSync.inactiveHidden, true, "a non-campus student appeared in dorm management");
  assert.strictEqual(dormSync.removedAfterStatusChange, true, "dorm roster did not remove a student after leaving in-school status");
  assert.strictEqual(dormSync.restoredAfterStatusChange, true, "dorm roster did not restore a student after returning to in-school status");
  assert.strictEqual(dormSync.unknownOk, false, "dorm allocation created a student outside student management");
  assert.match(dormSync.unknownError, /学生管理新增/);
  assert.strictEqual(dormSync.nonCampusOk, false, "dorm allocation accepted a non-campus student");
  assert.match(dormSync.nonCampusError, /不是在校生/);
  assert.strictEqual(dormSync.savedOk, true, "valid accommodation data was not saved for an in-school student");
  assert.strictEqual(dormSync.identityUnchanged, true, "dorm allocation changed student identity fields");
  assert.deepStrictEqual({accom:dormSync.merged.accom,zone:dormSync.merged.zone,building:dormSync.merged.building,room:dormSync.merged.room,bed:dormSync.merged.bed},{accom:"校内",zone:"测试区",building:"QA栋",room:"999",bed:"3"},"dorm allocation was not merged onto the synchronized in-school roster");
  assert.strictEqual(dormSync.importOk, 2, "dorm import must accept known students across statuses, matching the dedicated import contract");
  assert.ok(dormSync.importErrors.some(message=>/学号不存在/.test(message)), "dorm import must continue rejecting students missing from the master roster");
  await page.evaluate(async () => { await window.goto("subjectCompetition"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.match(await page.locator("#content").innerText(), /科创竞赛/);
  assert.match(await page.locator("#content").innerText(), /并非教育部直接发布的行政认定目录/);
  assert.strictEqual(await page.locator("#subjectCompetitionContent article").count(), 85, "subject competition catalog and supplements are incomplete");
  assert.strictEqual(await page.evaluate(() => new Set(subjectCompetitionRecords.map((record) => record.catalogNo).filter(Boolean)).size), 84, "subject competition catalog numbers are incomplete");
  assert.strictEqual(await page.evaluate(() => subjectCompetitionRecords.filter((record) => record.catalogNo).every((record) => record.sourceVersion === SUBJECT_COMPETITION_CATALOG_VERSION)), true, "subject competition catalog source version is incomplete");
  assert.strictEqual(await page.evaluate(() => SUBJECT_COMPETITION_CATALOG_URLS.length), 84, "subject competition website catalog is incomplete");
  assert.strictEqual(await page.evaluate(() => subjectCompetitionRecords.every((record) => subjectCompetitionValidUrl(record.url))), true, "subject competition websites are incomplete or invalid");
  assert.match(await page.locator("#content").innerText(), /官网已收录\s*85/);
  assert.strictEqual(await page.evaluate(() => {
    const record = subjectCompetitionRecords.find((item) => item.id === "moe-national-career-planning-competition");
    return !!record && record.title === "全国大学生职业规划大赛" && record.organizer === "教育部、天津市人民政府" && record.url === "https://zgs.chsi.com.cn/" && record.sourceVersion.indexOf("目录外补充") >= 0;
  }), true, "national career planning competition supplement is incomplete");
  for (const label of ["下载模板", "导入资源", "导出资源", "＋ 新增竞赛"]) assert.ok(await page.getByRole("button", { name: label }).count(), `subject competition action is missing: ${label}`);
  await page.getByRole("button", { name: "＋ 新增竞赛" }).click();
  await page.fill("#scf_title", "QA学科竞赛");
  await page.fill("#scf_level", "省级");
  await page.fill("#scf_direction", "信息技术");
  await page.fill("#scf_organizer", "QA竞赛组委会");
  await page.fill("#scf_url", "https://example.edu/qa-competition");
  await page.fill("#scf_note", "浏览器回归测试资源");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(() => subjectCompetitionRecords.some((record) => record.title === "QA学科竞赛")), true, "subject competition create did not persist");
  await page.locator("#content .toolbar select").first().selectOption("省级");
  assert.strictEqual(await page.locator("#subjectCompetitionContent article").count(), 1, "subject competition level filter is ineffective");
  await page.getByRole("button", { name: "编辑" }).click();
  await page.fill("#scf_title", "QA学科竞赛（已编辑）");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(80);
  assert.match(await page.locator("#subjectCompetitionContent").innerText(), /QA学科竞赛（已编辑）/);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "标记已核验" }).click();
  await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => {
    const record = subjectCompetitionRecords.find((item) => item.title === "QA学科竞赛（已编辑）");
    return !!record && record.status === "有效" && /^\d{4}-\d{2}-\d{2}$/.test(record.verifiedAt);
  }), true, "subject competition verification state did not persist");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#subjectCompetitionContent").getByRole("button", { name: "删除", exact: true }).click();
  await page.waitForFunction(() => !subjectCompetitionRecords.some((record) => record.title === "QA学科竞赛（已编辑）"), null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => subjectCompetitionRecords.some((record) => record.title === "QA学科竞赛（已编辑）")), false, "subject competition delete did not persist");
  await page.evaluate(async () => { await window.goto("dashboard"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.ok(await page.locator("#siDashboard").count(), "shared situation overview is missing");
  assert.strictEqual(await page.locator("#siDashboard .si-metrics > .si-metric").count(), 8, "situation overview KPI set is incomplete");
  assert.strictEqual(await page.locator("#siDashboard .si-metrics > .si-metric").evaluateAll((nodes) => nodes.every((node) => node.parentElement.classList.contains("si-metrics"))), true, "situation overview KPI cards escaped their grid");
  const initialSituation = await page.evaluate(() => {
    const snapshot = window.studentIntelligenceSnapshot();
    return { total: snapshot.total, red: snapshot.risk.red, priority: snapshot.priority.length, incomplete: snapshot.quality.incompleteStudents };
  });
  assert.strictEqual(initialSituation.total, 2, "shared situation snapshot lost scoped students");
  assert.strictEqual(await page.locator("#siDashboard .si-priority").count(), initialSituation.priority, "situation priority roster is inconsistent with the shared snapshot");
  await page.evaluate(() => window.siOpenStudent("qa-punish-school"));
  await page.waitForTimeout(100);
  assert.ok(await page.locator("#modalBody .si-profile-summary").count(), "student archive is missing the shared situation summary");
  assert.match(await page.locator("#modalBody .si-profile-summary").innerText(), /处分尚未解除/);
  await page.evaluate(() => window.closeModal());
  await page.evaluate(async () => { await window.goto("ai"); await new Promise((resolve) => setTimeout(resolve, 100)); });
  assert.ok(await page.locator("#siAiOverview").count(), "AI assistant is missing the shared situation overview");
  assert.ok(await page.locator("#siAiSituation").count(), "AI assistant is missing today's evidence-based situation brief");
  assert.strictEqual(Number(await page.locator("#siAiOverview > div").nth(1).locator("b").innerText()), initialSituation.priority, "AI priority count is inconsistent with the shared snapshot");
  assert.strictEqual(await page.locator('.nav [data-view="cockpit"]').count(), 0, "screen cockpit entry still exists in the sidebar");
  assert.strictEqual(await page.locator("#cockpitEntryBtn").count(), 1, "top-bar screen cockpit entry is missing");
  assert.strictEqual(await page.evaluate(() => document.getElementById("cockpitEntryBtn").nextElementSibling === document.getElementById("uiThemeToggle")), true, "screen cockpit entry is not immediately before the theme selector");
  await page.locator("#cockpitEntryBtn").click();
  await page.waitForTimeout(80);
  assert.match(await page.locator("#szCockpit .sc-status").innerText(), /共享态势快照已连接/);
  assert.strictEqual(await page.locator("#szCockpit .sc-kpi").count(), 8, "screen cockpit is missing KPI cards");
  assert.strictEqual(await page.locator("#szCockpit .sc-panel").count(), 6, "screen cockpit is missing analysis panels");
  assert.strictEqual(await page.locator("#szCockpit .sc-panel:visible").count(), 4, "embedded cockpit should show four core analysis panels");
  assert.strictEqual(Number(await page.locator("#szCockpit .sc-kpi").nth(1).locator(".sc-kpi-num").innerText()), initialSituation.red, "cockpit red-risk count is inconsistent with the shared snapshot");
  assert.deepStrictEqual(await page.evaluate(() => ({
    kpiColumns: getComputedStyle(document.querySelector("#szCockpit .sc-kpis")).gridTemplateColumns.split(" ").length,
    panelColumns: getComputedStyle(document.querySelector("#szCockpit .sc-grid")).gridTemplateColumns.split(" ").length,
    fundHidden: getComputedStyle(document.querySelector("#szCockpit .sc-fund-panel")).display === "none",
    taskHidden: getComputedStyle(document.querySelector("#szCockpit .sc-task-panel")).display === "none"
  })), { kpiColumns: 4, panelColumns: 2, fundHidden: true, taskHidden: true }, "embedded cockpit layout does not match the focused 4x2 design");
  await page.locator("#scPrivacyBtn").click();
  assert.strictEqual(await page.locator("#szCockpit").evaluate((element) => element.classList.contains("sc-privacy")), true, "screen cockpit privacy mode did not activate");
  assert.strictEqual(await page.locator("#szCockpit .sc-feed-name-real").first().isHidden(), true, "privacy mode still exposes the real student name");
  assert.strictEqual(await page.locator("#szCockpit .sc-feed-name-mask").first().isVisible(), true, "privacy mode did not show the masked student name");
  assert.deepStrictEqual(await page.evaluate(() => {
    document.body.classList.add("cockpit-immersive");
    const result={
      kpiColumns:getComputedStyle(document.querySelector("#szCockpit .sc-kpis")).gridTemplateColumns.split(" ").length,
      visiblePanels:[...document.querySelectorAll("#szCockpit .sc-panel")].filter((item)=>getComputedStyle(item).display!=="none").length
    };
    document.body.classList.remove("cockpit-immersive");
    return result;
  }), { kpiColumns: 8, visiblePanels: 6 }, "immersive cockpit did not restore the 8-column full panorama");
  await page.locator("#szCockpit .sc-kpi").first().click();
  assert.strictEqual(await page.locator("#drawer").evaluate((element) => element.classList.contains("show")), true, "screen cockpit KPI drill-down did not open");
  await page.evaluate(() => window.showDrawer(false));
  await page.evaluate(async () => { await window.goto("checkClass"); window.openCheckClassForm(); await new Promise((resolve) => setTimeout(resolve, 50)); });
  assert.ok(await page.locator("#ccDept").count(), "check-class form is missing 学院");
  assert.ok(await page.locator("#ccGrade").count(), "check-class form is missing 年级");
  await page.locator("#ccCls").selectOption("测试班", { force: true });
  assert.strictEqual(await page.locator("#ccDept").inputValue(), "测试学院", "check-class college did not follow the selected class");
  assert.strictEqual(await page.locator("#ccGrade").inputValue(), "2025", "check-class grade did not follow the selected class");
  await page.fill("#ccDate", "2026-08-12");
  await page.locator("#ccDate").press("Tab");
  assert.strictEqual(await page.locator("#ccCourse").inputValue(), "课表自动匹配课程", "check-class course did not match the schedule");
  assert.strictEqual(await page.locator("#ccTeacher").inputValue(), "课表教师", "check-class teacher did not match the schedule");
  assert.strictEqual(await page.locator("#ccPeriod").inputValue(), "第3-4节", "check-class period did not match the schedule");
  assert.strictEqual(await page.locator("#ccWeek").inputValue(), "1", "check-class week did not match the schedule date");
  assert.strictEqual(await page.locator("#ccCategory").inputValue(), "实验", "check-class category did not match the schedule");
  await page.fill("#ccCourse", "查课字段回归测试");
  await page.fill("#ccHeadcount", "30");
  assert.ok(await page.locator("#ccAbsentSearch").count(), "check-class form is missing the absence multi-select search");
  await page.fill("#ccAbsentSearch", "qa-punish-school");
  await page.locator("#ccAbsentOptions .cc-absent-option").click();
  await page.fill("#ccAbsentSearch", "qa-punish-college");
  await page.locator("#ccAbsentOptions .cc-absent-option").click();
  assert.strictEqual(await page.locator("#ccAbsentSelected .cc-absent-chip").count(), 2, "check-class absence list did not support multiple students");
  assert.strictEqual(await page.locator("#ccAttended").inputValue(), "28", "actual attendance did not follow headcount minus the absence list");
  await page.locator('[data-cc-behavior="late"]').click();
  await page.fill("#ccAbsentSearch", "qa-punish-school");
  await page.locator("#ccAbsentOptions .cc-absent-option").click();
  assert.strictEqual(await page.locator("#ccLate").inputValue(), "1", "late-student selection did not update the late count");
  await page.locator('[data-cc-behavior="early"]').click();
  await page.fill("#ccAbsentSearch", "qa-punish-school");
  await page.locator("#ccAbsentOptions .cc-absent-option").click();
  const behaviorCounts={};for(const behavior of ['absent','personalLeave','sickLeave','publicLeave','late','early']){const count=page.locator('[data-cc-behavior="'+behavior+'"] span');if(await count.count())behaviorCounts[behavior]=await count.textContent();}
  assert.deepStrictEqual(behaviorCounts, {absent:'2',personalLeave:'0',sickLeave:'0',publicLeave:'0',late:'1',early:'1'}, "check-class attendance tabs did not retain separate selections");
  assert.strictEqual(await page.locator("#ccAttended").inputValue(), "28", "late/early selections must not reduce actual attendance");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(120);
  assert.deepStrictEqual(await page.evaluate(() => {
    const record = checkClassRecords.find((item) => item.course === "查课字段回归测试");
    const count = (id, type) => (students.find((student) => student.id === id).classroom || []).filter((item) => item.sourceCheckClassId === record.id && item.type === type).length;
    return record && { dept: record.dept, grade: record.grade, cls: record.cls, rate: record.rate, absentStudentIds: record.absentStudentIds.slice().sort(), lateStudentIds: record.lateStudentIds.slice(), earlyStudentIds: record.earlyStudentIds.slice(), school: { absent: count("qa-punish-school", "旷课"), late: count("qa-punish-school", "迟到"), early: count("qa-punish-school", "早退") }, collegeAbsent: count("qa-punish-college", "旷课") };
  }), { dept: "测试学院", grade: "2025", cls: "测试班", rate: "93.3%", absentStudentIds: ["qa-punish-college", "qa-punish-school"], lateStudentIds: ["qa-punish-school"], earlyStudentIds: ["qa-punish-school"], school: { absent: 1, late: 1, early: 1 }, collegeAbsent: 1 }, "check-class record and synced absence/late/early records did not persist");
  assert.match(await page.locator("#checkClassBody").innerText(), /测试学院/);
  assert.match(await page.locator("#checkClassBody").innerText(), /2025/);
  assert.match(await page.locator("#checkClassBody").innerText(), /qa-punish-school/);
  await page.evaluate(() => {
    const record = checkClassRecords.find((item) => item.course === "查课字段回归测试");
    window.openCheckClassForm(record.id);
  });
  await page.evaluate(() => window.ccAbsentRemove("qa-punish-college"));
  await page.evaluate(() => { window.ccBehaviorRemove("late", "qa-punish-school"); window.ccBehaviorRemove("early", "qa-punish-school"); });
  assert.strictEqual(await page.locator("#ccAttended").inputValue(), "29", "editing the absence list did not refresh actual attendance");
  assert.strictEqual(await page.locator("#ccLate").inputValue(), "0", "editing the late list did not refresh the late count");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(120);
  assert.deepStrictEqual(await page.evaluate(() => {
    const record = checkClassRecords.find((item) => item.course === "查课字段回归测试");
    return students.map((student) => ({ id: student.id, linked: (student.classroom || []).filter((item) => item.sourceCheckClassId === record.id).length })).sort((a, b) => a.id.localeCompare(b.id));
  }), [{ id: "qa-punish-college", linked: 0 }, { id: "qa-punish-school", linked: 1 }], "editing the check-class absence list left stale classroom records");
  await page.evaluate(() => { viewTerm.classroom = CURRENT_TERM; viewFilter.classroom = {}; setQueryReady("classroom", true); window.goto("classroom"); });
  const syncedClassroomText = await page.locator(".classroom-table-wrap").innerText();
  assert.match(syncedClassroomText, /qa-punish-school[\s\S]*来源：查课记录/, `synced absence is not visible or traceable in classroom management: ${syncedClassroomText}`);
  assert.doesNotMatch(syncedClassroomText, /来源：查课记录[\s\S]*删除/, "synced absence still exposes an independent delete action");

  await page.evaluate(async () => {
    ORG_CLASSES.push({ name: "测试二班", dept: "测试学院", major: "测试专业", grade: "2025" });
    await window.goto("meeting");
    window.openMeeting();
  });
  assert.ok(await page.locator("#meetClsSearch").count(), "meeting form is missing searchable class selection");
  await page.fill("#meetClsSearch", "测试");
  await page.locator('#meetClsOptions [data-class="测试班"] input').check();
  await page.locator('#meetClsOptions [data-class="测试二班"] input').check();
  assert.strictEqual(await page.locator("#meetClsSelected .meeting-class-chip").count(), 2, "meeting form did not support multiple classes");
  await page.fill("#meetTopic", "多班级班会回归测试");
  await page.fill("#meetDate", "2026-08-13");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(120);
  assert.deepStrictEqual(await page.evaluate(() => {
    const record = meetings.find((item) => item.topic === "多班级班会回归测试");
    return record && { classes: record.classes.slice(), secondClassMatches: meetingMatchesFilter(record, { cls: ["测试二班"] }), otherClassMatches: meetingMatchesFilter(record, { cls: ["不存在班级"] }) };
  }), { classes: ["测试班", "测试二班"], secondClassMatches: true, otherClassMatches: false }, "meeting multi-class persistence or filtering is incorrect");
  await page.evaluate(() => {
    const record = meetings.find((item) => item.topic === "多班级班会回归测试");
    window.meetingEdit(record.id);
  });
  assert.strictEqual(await page.locator("#meetClsSelected .meeting-class-chip").count(), 2, "meeting edit did not restore all selected classes");
  await page.evaluate(() => window.meetingClassToggle("测试班", false));
  await page.locator("#modalOk").click();
  await page.waitForTimeout(120);
  assert.deepStrictEqual(await page.evaluate(() => meetings.find((item) => item.topic === "多班级班会回归测试").classes), ["测试二班"], "meeting edit did not persist the revised class selection");
  await page.evaluate(async () => {
    const checkRecord = checkClassRecords.find((item) => item.course === "查课字段回归测试");
    const meetingRecord = meetings.find((item) => item.topic === "多班级班会回归测试");
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try { await window.meetingDelete(meetingRecord.id); await window.checkClassDel(checkRecord.id); }
    finally { window.confirm = originalConfirm; }
    const index = ORG_CLASSES.findIndex((item) => item.name === "测试二班");
    if (index >= 0) ORG_CLASSES.splice(index, 1);
  });
  assert.deepStrictEqual(await page.evaluate(() => ({
    checkExists: checkClassRecords.some((item) => item.course === "查课字段回归测试"),
    linkedAbsences: students.reduce((count, student) => count + (student.classroom || []).filter((item) => item.sourceCheckClassId).length, 0),
    meetingExists: meetings.some((item) => item.topic === "多班级班会回归测试")
  })), { checkExists: false, linkedAbsences: 0, meetingExists: false }, "deleting source records left synced absence or meeting data behind");
  await page.evaluate(async () => { await window.goto("classroom"); window.openClassroom(); await new Promise((resolve) => setTimeout(resolve, 50)); });
  await page.locator("#absDate").click();
  await page.fill("#absDate", "2026-08-12");
  await page.locator("#absDate").press("Tab");
  await page.fill("#absNo", "qa-punish-school");
  await page.locator("#absNo").press("Tab");
  assert.strictEqual(await page.locator("#absCourse").inputValue(), "课表自动匹配课程", "absence course did not match the schedule");
  assert.strictEqual(await page.locator("#absWeek").inputValue(), "1", "absence week did not match the schedule date");
  assert.strictEqual(await page.locator("#absSection").inputValue(), "第3-4节", "absence period did not match the schedule");
  assert.strictEqual(await page.locator("#absTeacher").inputValue(), "课表教师", "absence teacher did not match the schedule");
  assert.strictEqual(await page.locator("#absCategory").inputValue(), "实验", "absence category did not match the schedule");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(async () => {
    achievementRecords = [
      achievementNormalize({ id: "qa-award-1", sid: "qa-punish-school", category: "学科竞赛", level: "国家级", awardName: "统计回归奖项甲", date: "2026-05-01" }, "manual"),
      achievementNormalize({ id: "qa-award-2", sid: "qa-punish-college", category: "奖学金", level: "校级", awardName: "统计回归奖项乙", date: "2026-06-01" }, "manual")
    ];
    achievementPersist();
    await window.goto("achievement");
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  assert.strictEqual(await page.locator("#achievementOrgStats [data-achievement-stat]").count(), 4, "achievement organization statistics dimensions are incomplete");
  assert.match(await page.locator("#achievementOrgStats").innerText(), /测试学院/);
  assert.match(await page.locator("#achievementOrgStats").innerText(), /测试学院\s+2\s+2\s+1/);
  for (const [dimension, expected] of [["major", "测试专业"], ["grade", "2025"], ["cls", "测试班"]]) {
    await page.locator(`#achievementOrgStats [data-achievement-stat="${dimension}"]`).click();
    await page.waitForTimeout(50);
    assert.match(await page.locator("#achievementOrgStats").innerText(), new RegExp(expected), `achievement ${dimension} statistics are missing`);
  }
  const achievementHeaders = await page.locator("#achievementTable thead th").allTextContents();
  assert.deepStrictEqual(achievementHeaders.slice(0, 5), ["学期", "学院", "专业", "学号", "姓名"], "achievement personal detail columns are incomplete");
  assert.ok(achievementHeaders.includes("类型"), "achievement detail is missing 类型");
  assert.ok(achievementHeaders.includes("姓名"), "achievement 学生 column was not renamed to 姓名");
  assert.ok(!achievementHeaders.includes("学生"), "achievement detail still contains the old 学生 header");
  assert.strictEqual(await page.locator(".ae-stat-grid > div").count(), 5, "achievement overview does not expose all personal statistics");
  assert.match(await page.locator("#content").innerText(), /一条记录对应一名学生/);
  await page.evaluate(() => window.achievementOpenForm());
  for (const id of ["#achievement_term", "#achievement_edition", "#achievement_track", "#achievement_certificateNo", "#achievement_verificationUrl"]) {
    assert.ok(await page.locator(id).count(), `achievement form is missing ${id}`);
  }
  await page.fill("#achievement_name", "处分测试甲");
  await page.locator("#achievement_name").press("Tab");
  assert.strictEqual(await page.locator("#achievement_sid").inputValue(), "qa-punish-school", "achievement name did not resolve the student ID");
  assert.match(await page.locator("#achievementStudentInfo").innerText(), /测试学院/);
  assert.match(await page.locator("#achievementStudentInfo").innerText(), /测试专业/);
  assert.match(await page.locator("#achievementStudentInfo").innerText(), /2025/);
  await page.fill("#achievement_sid", "qa-punish-college");
  assert.strictEqual(await page.locator("#achievement_name").inputValue(), "处分测试乙", "achievement student ID did not resolve the name");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(() => {
    ORG_DEPTS.push({name:"甲学院",code:"QAA"},{name:"乙学院",code:"QAB"});
    ORG_MAJORS.push({name:"甲专业",dept:"甲学院",code:"QAA01"},{name:"乙专业",dept:"乙学院",code:"QAB01"});
    ORG_CLASSES.push({name:"甲班",dept:"甲学院",major:"甲专业",grade:"2024"},{name:"乙班",dept:"乙学院",major:"乙专业",grade:"2025"});
    saveOrgs();
    window.__NNUZC__.students.push(
      { id: "qa-same-name-1", name: "同名回归学生", dept: "甲学院", major: "甲专业", grade: "2024", cls: "甲班", status: "在校" },
      { id: "qa-same-name-2", name: "同名回归学生", dept: "乙学院", major: "乙专业", grade: "2025", cls: "乙班", status: "在校" },
      { id: "qa-same-name-inactive", name: "同名回归学生", dept: "乙学院", major: "乙专业", grade: "2025", cls: "乙班", status: "休学" }
    );
    window.achievementOpenForm();
  });
  await page.fill("#achievement_name", "同名回归学生");
  await page.locator("#achievement_name").press("Tab");
  await page.locator("#studentChoiceLayer").waitFor();
  assert.strictEqual(await page.locator("#studentChoiceLayer [data-student-choice-id]").count(), 3, "duplicate student name must include all statuses from student management");
  assert.match(await page.locator('#studentChoiceLayer [data-student-choice-id="qa-same-name-inactive"]').innerText(),/休学/,'inactive candidate must show its status for manual identification');
  assert.match(await page.locator("#studentChoiceLayer").innerText(), /学号：qa-same-name-1/);
  assert.match(await page.locator("#studentChoiceLayer").innerText(), /甲学院/);
  assert.match(await page.locator("#studentChoiceLayer").innerText(), /乙班/);
  await page.locator('#studentChoiceLayer [data-student-choice-id="qa-same-name-2"]').click();
  assert.strictEqual(await page.locator("#achievement_sid").inputValue(), "qa-same-name-2", "manual duplicate choice did not fill student ID");
  assert.strictEqual(await page.locator("#achievement_name").inputValue(), "同名回归学生", "manual duplicate choice did not keep student name");
  assert.match(await page.locator("#achievementStudentInfo").innerText(), /乙学院/);
  await page.evaluate(() => window.closeModal());
  await page.evaluate(() => {
    for (let index = window.__NNUZC__.students.length - 1; index >= 0; index--) {
      if (["qa-same-name-1", "qa-same-name-2", "qa-same-name-inactive"].includes(window.__NNUZC__.students[index].id)) window.__NNUZC__.students.splice(index, 1);
    }
  });
  await page.evaluate(async () => { await window.goto("certificate"); await new Promise((resolve) => setTimeout(resolve, 100)); });
  assert.ok(await page.locator(".cert-batch").count(), "certificate batch recognition controls are missing");
  const certificateDeleteAttachments = await page.evaluate(async () => {
    const pngBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
    const upload = async (name) => window.workbench.legacy.attachmentUploadFile(name, new File([pngBytes], name, { type: "image/png" }));
    const firstAttachment = await upload("qa-cert-delete-one.png");
    const secondAttachment = await upload("qa-cert-delete-two.png");
    const completeData = Object.assign({}, certificateRecords[0].data);
    const makeRecord = (id, attachment, overrides) => Object.assign({
      id, folder: "qa-punish-school 处分测试甲", sid: "qa-punish-school", name: "处分测试甲",
      attachment: attachment ? Object.assign({}, attachment, { mime: "image/png" }) : null, data: { term: CURRENT_TERM },
      status: "pending", recognitionStatus: "none", fieldConfidence: {}, fieldEvidence: {}, fieldReviewed: {},
      createdAt: fmtNow(), createdBy: "本机管理员", createdRole: "sa"
    }, overrides || {});
    certificateRecords = [
      makeRecord("qa-cert-delete-one", firstAttachment),
      makeRecord("qa-cert-delete-two", secondAttachment, { recognitionStatus: "done", data: completeData }),
      makeRecord("qa-cert-status-error", null, { recognitionStatus: "error" }),
      makeRecord("qa-cert-status-confirmed", null, { status: "confirmed", recognitionStatus: "done", data: completeData }),
      makeRecord("qa-cert-status-excluded", null, { status: "excluded", recognitionStatus: "done", data: completeData })
    ].concat(certificateRecords);
    certificateActiveId = "qa-cert-delete-one";
    certPersist();
    await window.goto("certificate");
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { firstId: firstAttachment.id, secondId: secondAttachment.id };
  });
  for (const state of ["待识别", "待核对", "字段待确认", "识别失败", "已确认", "已排除"]) {
    await page.locator(".cert-queue-filter select").selectOption(state);
    assert.ok(await page.locator(".cert-q-delete").count(), `certificate state ${state} is missing per-image delete`);
    assert.strictEqual(await page.locator(".cert-q-delete").first().isEnabled(), true, `certificate state ${state} delete is unexpectedly disabled`);
  }
  await page.evaluate(() => {
    certificateRecords = certificateRecords.filter((record) => !record.id.startsWith("qa-cert-status-"));
    certificateActiveId = "qa-cert-delete-one";
    certPersist();
    window.certQueueFilter("全部");
  });
  assert.strictEqual(await page.locator(".cert-q-delete").count(), 3, "certificate queue is missing a per-image delete button");
  assert.match(await page.locator(".cert-q.active .cert-q-main").innerText(), /qa-cert-delete-one\.png/);
  let certificateDeleteDialog = "";
  page.once("dialog", async (dialog) => { certificateDeleteDialog = dialog.message(); await dialog.accept(); });
  await page.locator(".cert-q.active .cert-q-delete").click();
  await page.waitForFunction(() => !certificateRecords.some((record) => record.id === "qa-cert-delete-one"));
  await page.waitForFunction(() => document.querySelectorAll(".cert-q-delete").length === 2);
  assert.match(certificateDeleteDialog, /qa-cert-delete-one\.png/, "certificate delete confirmation does not identify the image");
  assert.match(certificateDeleteDialog, /恢复前会继续保留/, "certificate delete confirmation does not explain recycle-bin attachment retention");
  assert.strictEqual(await page.locator(".cert-q-delete").count(), 2, "certificate queue did not remove exactly one image");
  assert.match(await page.locator(".cert-q.active .cert-q-main").innerText(), /qa-cert-delete-two\.png/, "certificate queue did not select the next image after deletion");
  assert.strictEqual(await page.locator(".cert-stats > .cert-stat").first().locator("b").innerText(), "2", "certificate total did not refresh after a single deletion");
  assert.strictEqual(fs.existsSync(path.join(temp, "data", "attachments", certificateDeleteAttachments.firstId)), true, "certificate recycle must retain the image for restoration");
  assert.strictEqual(fs.existsSync(path.join(temp, "data", "attachments", certificateDeleteAttachments.secondId)), true, "certificate delete removed the wrong image attachment");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".cert-q.active .cert-q-delete").click();
  await page.waitForFunction(() => !certificateRecords.some((record) => record.id === "qa-cert-delete-two"));
  await page.waitForFunction(() => document.querySelectorAll(".cert-q-delete").length === 1);
  assert.strictEqual(await page.locator(".cert-q-delete").count(), 1, "certificate queue did not preserve the unrelated image");
  assert.strictEqual(await page.locator(".cert-stats > .cert-stat").first().locator("b").innerText(), "1", "certificate total did not refresh after deleting the second test image");
  assert.strictEqual(fs.existsSync(path.join(temp, "data", "attachments", certificateDeleteAttachments.secondId)), true, "second recycled certificate image must remain restorable");
  assert.match(await page.locator(".cert-confidence").innerText(), /AI 70%/);
  assert.match(await page.locator(".cert-progress").innerText(), /待人工确认 1 项/);
  await page.locator(".cert-confidence button").click();
  assert.match(await page.locator(".cert-progress").innerText(), /待人工确认 0 项/);
  await page.getByRole("button", { name: "确认并同步至获奖情况" }).click();
  await page.waitForTimeout(100);
  assert.match(await page.locator(".cert-state").innerText(), /已确认/);
  assert.strictEqual(await page.getByRole("button", { name: "已同步至获奖情况" }).isDisabled(), true, "confirmed certificate can be submitted repeatedly");
  await page.evaluate(async () => { await window.goto("achievement"); await new Promise((resolve) => setTimeout(resolve, 100)); });
  assert.match(await page.locator("#achievementTable").innerText(), /证书增强回归奖项/);
  assert.doesNotMatch(await page.locator("#achievementTable").innerText(), /审核状态|核验状态/, "achievement table still exposes status columns");
  assert.strictEqual(await page.locator(".ae-stat-grid > div").nth(1).locator("b").innerText(), "2", "certificate record was not counted as a personal award");
  const syncedAward = await page.evaluate(() => achievementRecords.find((record) => record.awardName === "证书增强回归奖项"));
  assert.ok(syncedAward, "certificate did not create a personal achievement record");
  assert.strictEqual(syncedAward.sid, "qa-punish-school", "certificate achievement is not attached to exactly one student");
  assert.strictEqual(await page.evaluate(() => achievementRecords.filter((record) => record.awardName === "证书增强回归奖项").length), 1, "certificate created duplicate personal records");
  assert.strictEqual(await page.evaluate(() => typeof window.achievementReview), "undefined", "legacy achievement review action is still available");
  assert.strictEqual(await page.locator(".ae-stat-grid > div").nth(1).locator("b").innerText(), "2", "personal award count changed unexpectedly");
  await page.evaluate((id) => window.achievementView(id), syncedAward.id);
  assert.match(await page.locator("#drawerBody").innerText(), /证书编号[\s\S]*打开官方查询网址/);
  await page.evaluate(() => window.showDrawer(false));
  await page.evaluate(async () => {
    await window.goto("certificate");
    window.certQueueFilter("已确认");
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  assert.strictEqual(await page.locator(".cert-q-delete").count(), 1, "confirmed certificate state is missing per-image delete");
  let confirmedDeleteDialog = "";
  page.once("dialog", async (dialog) => { confirmedDeleteDialog = dialog.message(); await dialog.accept(); });
  await page.locator(".cert-q-delete").click();
  await page.waitForFunction(() => !certificateRecords.some((record) => record.id === "qa-cert-personal"));
  assert.match(confirmedDeleteDialog, /移入回收站[\s\S]*90 天内/, "confirmed certificate deletion does not explain recoverability");
  const retainedAward = await page.evaluate((id) => {
    const record = achievementRecords.find((item) => item.id === id);
    return record && {
      certificateId: record.certificateId,
      attachment: record.attachment
    };
  }, syncedAward.id);
  assert.strictEqual(retainedAward.certificateId, "qa-cert-personal", "recycling a certificate must not sever the retained award relationship");
  await page.evaluate(async () => { await window.goto("dashboard"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.strictEqual(await page.locator("#siDashboard .si-metric").filter({ hasText: "个人获奖" }).locator("b").innerText(), "3", "situation overview did not refresh personal awards");
  await page.evaluate(async () => { await window.goto("ai"); await new Promise((resolve) => setTimeout(resolve, 80)); });
  assert.strictEqual(await page.locator("#siAiOverview > div").nth(4).locator("b").innerText(), "3", "AI situation overview did not refresh personal awards");
  await page.evaluate(async () => { await window.goto("academicAnalysis"); await new Promise((resolve) => setTimeout(resolve, 120)); });
  assert.ok(await page.locator("#academicAnalysisFrame").count(), "academic analysis toolbox iframe is missing");
  assert.ok(await page.locator("#academicAnalysisInterpretBtn").count(), "academic analysis AI actions are missing");
  const academicAnalysisFrame = await page.locator("#academicAnalysisFrame").contentFrame();
  assert.ok(await academicAnalysisFrame.locator('a[href="/assets/academic-analysis-rules.docx"]').count(), "updated academic analysis rules download is missing");
  assert.ok(await academicAnalysisFrame.locator('a[href="/assets/academic-analysis-field-template.xlsx"][download="单学期成绩导入模板.xlsx"]').count(), "academic analysis blank field template download is missing");
  assert.ok(await academicAnalysisFrame.locator('#teacherFile[accept=".xlsx"]').count(), "academic analysis teacher list input is missing");
  assert.ok(await academicAnalysisFrame.locator('#downloadTeacherTemplate').count(), "academic analysis teacher list template download is missing");
  assert.match(await academicAnalysisFrame.locator(".teacher-field-reference").innerText(), /班级[\s\S]*班主任/, "academic analysis teacher list fields are incomplete");
  assert.match(await academicAnalysisFrame.locator(".field-reference").innerText(), /必填字段（13项）[\s\S]*身份证号/, "academic analysis field reference is incomplete");
  assert.match(await academicAnalysisFrame.locator("body").innerText(), /Excel 原表、学生身份和课程明细不发送给 AI/, "academic analysis privacy boundary is missing");
  assert.ok(await academicAnalysisFrame.locator("#historyList").count(), "academic analysis history list is missing");
  await page.waitForTimeout(600);
  const academicHistoryText=await academicAnalysisFrame.locator("#historyStatus").innerText();
  assert.match(academicHistoryText, /暂无历史记录|数据库记录/, "academic analysis history status is missing: "+academicHistoryText);
  assert.strictEqual(await academicAnalysisFrame.locator("body").evaluate((node) => getComputedStyle(node).fontSize), "12px", "academic analysis base typography must include the global 1px increase");
  await academicAnalysisFrame.locator("body").evaluate(async () => { await window.ToolHistory.save("academicAnalysis", { id: "qa_history_delete", at: new Date().toISOString(), sourceFile: "删除按钮测试.xlsx", classes: 1, students: 30, validRecords: 120, issueCount: 0 }, []); });
  await academicAnalysisFrame.locator("#refreshHistory").click();
  await page.waitForTimeout(120);
  assert.strictEqual(await academicAnalysisFrame.locator('[data-history-delete="qa_history_delete"]').innerText(), "删除记录", "academic analysis history delete button is missing");
  page.once("dialog", (dialog) => dialog.accept());
  await academicAnalysisFrame.locator('[data-history-delete="qa_history_delete"]').click();
  await page.waitForTimeout(160);
  assert.strictEqual(await academicAnalysisFrame.locator('[data-history-delete="qa_history_delete"]').count(), 0, "deleted academic analysis history row is still visible");
  assert.strictEqual(await academicAnalysisFrame.locator("body").evaluate(async () => (await window.ToolHistory.list("academicAnalysis")).some((item) => item.id === "qa_history_delete")), false, "deleted academic analysis history still exists in the database");
  await page.evaluate(async () => { await window.goto("apiconfig"); await new Promise((resolve) => setTimeout(resolve, 120)); });
  assert.ok(await page.locator("#content .ai-status-strip").count(), "API configuration status overview is missing");
  assert.match(await page.locator("#content .ai-status-strip").innerText(), /网络方式\s+(系统直连|Clash\/TUN 兼容)/, "API configuration network mode is missing");
  const renderedAiFeatures = await page.locator("#content [data-ai-feature]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ai-feature")).sort());
  assert.deepStrictEqual(renderedAiFeatures, ["academicAnalysis", "academicSummary", "certificate", "courseSchedule", "dataMatch", "document", "excelCheck", "excelMerge", "import", "insight", "ledgerInsight", "notice", "talk", "taskAssist", "workRecord"].sort(), "API configuration feature switches are incomplete or out of sync");
  assert.strictEqual(await page.locator('#content [data-ai-feature="excelMerge"]').count(), 1, "excel merge AI feature switch is missing");
  assert.strictEqual(await page.locator('#content [data-ai-feature="academicSummary"]').count(), 1, "academic summary AI feature switch is missing");
  assert.strictEqual(await page.locator('#content [data-ai-feature="academicAnalysis"]').count(), 1, "academic analysis AI feature switch is missing");
  assert.strictEqual(await page.locator('#content [data-ai-feature="excelCheck"]').count(), 1, "excel check AI feature switch is missing");
  assert.ok(await page.locator("#content #aiRedactionInput").count(), "API configuration redaction preview is missing");
  assert.ok(await page.locator("#content .ai-config-columns").count(), "API configuration responsive columns are missing");
  assert.strictEqual(await page.locator("#content .ai-provider-card").count(), 0, "removed provider cards are still visible");
  assert.ok(!(await page.locator("#content").innerText()).includes("推荐服务商"), "removed recommended-provider heading is still visible");
  await page.locator("#aiProvider").selectOption("anthropic");
  assert.strictEqual(await page.locator("#aiProvider").inputValue(), "anthropic", "Claude quick configuration did not select the Anthropic provider");
  assert.strictEqual(await page.locator("#aiBase").inputValue(), "https://api.anthropic.com/v1", "Claude quick configuration did not fill the Base URL");
  assert.strictEqual(await page.locator("#aiModel").inputValue(), "claude-sonnet-5", "Claude quick configuration did not fill the recommended model");
  const consoleErrorCountBeforeUpstream401 = consoleErrors.length;
  await page.route("**/api/ai/test?mock-upstream-unauthorized=1", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "上游 API Key 无效" }) }));
  assert.strictEqual(await page.evaluate(async () => (await fetch("/api/ai/test?mock-upstream-unauthorized=1", { method: "POST" })).status), 401, "mock upstream authorization failure was not returned");
  await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => location.pathname), "/", "upstream AI 401 must not redirect away from API configuration");
  await page.unroute("**/api/ai/test?mock-upstream-unauthorized=1");
  const expectedUpstream401Errors = consoleErrors.splice(consoleErrorCountBeforeUpstream401);
  assert.ok(expectedUpstream401Errors.every((message) => /Failed to load resource: the server responded with a status of 401/.test(message)), "mock upstream 401 produced an unexpected console error");
  assert.strictEqual(await page.evaluate(() => {
    const pageHost = document.querySelector(".ai-config-page");
    const audit = document.querySelector("#aiAuditBox");
    return (!pageHost || pageHost.scrollWidth <= pageHost.clientWidth + 1) && (!audit || audit.scrollWidth <= audit.clientWidth + 1);
  }), true, "API configuration introduced an internal horizontal scrollbar");
  await page.evaluate(async () => { await window.goto("backup"); await new Promise((resolve) => setTimeout(resolve, 120)); });
  assert.ok(await page.locator("#content #backupImportFile").count(), "JSON backup restore input is missing");
  await page.evaluate(async () => {
    const row = {
      _rid: "qa-warning-editor", "学号": "qa-punish-school", "姓名": "处分测试甲", "学院": "测试学院", "专业": "测试专业", "年级": "2025", "班级": "测试班", "不及格门数": "1", "预警等级": "红色预警", "备注": "",
      courses: Array.from({ length: 8 }, (_, index) => ({ _cid: `qa-warning-course-${index + 1}`, "课程名称": `测试课程${index + 1}`, "学期": `第${index + 1}学期`, "补考成绩": String(50 + index) })), warningForms: {}
    };
    window.academicWarningTerms = [{ id: 99001, term: "2025-2026-2学期", status: "已录入", rows: [row] }];
    academicWarningEnsureForms(row);
    saveAcademicWarningTerms();
    openAcademicWarningForms(99001, "qa-warning-editor", "notice");
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  assert.strictEqual(await page.locator("#modalTitle").textContent(), "附件1 学业预警通知书 · 处分测试甲");
  assert.strictEqual(await page.locator("#modalBody .tabs .tab").count(), 6, "academic-warning editor is missing five attachment tabs and preview");
  let warningFrame = page.frameLocator("#academicWarningEditorFrame");
  try { await warningFrame.locator(".aw-word-page").waitFor({ state: "visible", timeout: 30000 }); }
  catch (error) { throw new Error(`academic-warning Word editor did not load: ${await page.locator("#academicWarningPageEditor").innerText()} (${error.message})`); }
  assert.strictEqual(await warningFrame.locator(".aw-word-page").count(), 1, "attachment 1 did not preserve one-page paper layout");
  assert.ok(await warningFrame.locator("table").count(), "attachment 1 lost the original Word table");
  assert.ok(await warningFrame.locator('[data-aw-field="collegeOpinion"]').count(), "attachment 1 is not editable in its original page");
  const warningEditorText = await warningFrame.locator("body").innerText();
  assert.match(warningEditorText, /测试课程1[\s\S]*测试课程8/, `attachment 1 did not add an editor row for each overflow course: ${warningEditorText.slice(0, 2000)}`);
  assert.doesNotMatch(warningEditorText, /测试课程6；测试课程7/, "attachment 1 still merged overflow courses into one editor row");
  assert.strictEqual(await warningFrame.locator('td[rowspan]').filter({ hasText: '学生预警' }).first().getAttribute('rowspan'), '11', "academic-warning detail column did not extend through overflow course rows");
  if (process.env.XIANGCAI_QA_SCREENSHOT) {
    const screenshotPath = path.resolve(process.env.XIANGCAI_QA_SCREENSHOT);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await warningFrame.locator(".aw-word-page").screenshot({ path: screenshotPath });
  }
  await warningFrame.locator('[data-aw-field="collegeOpinion"]').fill("在线编辑回归内容");
  await page.evaluate(() => academicWarningSaveAttachment(99001, "qa-warning-editor", "notice", true));
  assert.strictEqual(await page.evaluate(() => academicWarningTermById(99001).rows[0].warningForms.notice.collegeOpinion), "在线编辑回归内容", "academic-warning page edit was not persisted");
  await page.locator("#modalBody .tabs .tab").filter({ hasText: "附件2" }).click();
  await page.waitForTimeout(160);
  warningFrame = page.frameLocator("#academicWarningEditorFrame");
  await warningFrame.locator(".aw-word-page").first().waitFor();
  assert.strictEqual(await warningFrame.locator(".aw-word-page").count(), 2, "attachment 2 did not preserve its two-page layout");
  for (const label of ["附件3", "附件4", "附件5"]) {
    await page.locator("#modalBody .tabs .tab").filter({ hasText: label }).click();
    await page.waitForTimeout(140);
    warningFrame = page.frameLocator("#academicWarningEditorFrame");
    await warningFrame.locator(".aw-word-page").first().waitFor();
    assert.strictEqual(await warningFrame.locator(".aw-word-page").count(), 1, `${label} did not preserve its one-page layout`);
    assert.ok(await warningFrame.locator(".aw-edit-field").count(), `${label} has no in-page editable fields`);
  }
  await page.evaluate(() => window.closeModal());
  await page.evaluate(() => openEditAcademicWarningTerm(99001));
  const warningTemplateButton=page.locator('#modalBody button').filter({hasText:'附件1—5 Word模板'});
  assert.strictEqual(await warningTemplateButton.count(),1,"academic-warning list is missing the Word template manager");
  await warningTemplateButton.click();
  await page.locator('#awTemplateStatus').waitFor();
  await page.waitForFunction(() => document.getElementById('awTemplateStatus') && /系统默认模板/.test(document.getElementById('awTemplateStatus').innerText));
  assert.strictEqual(await page.locator('#awTemplateFile').getAttribute('accept'),'.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',"academic-warning template manager does not restrict imports to Word files");
  assert.match(await page.locator('#modalBody').innerText(),/下载当前 Word 模板[\s\S]*重新导入并启用[\s\S]*恢复系统默认模板/,"academic-warning template manager actions are incomplete");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(async () => { await window.goto("fund"); window.openFund(); await new Promise((resolve) => setTimeout(resolve, 50)); });
  assert.ok(await page.locator('#fLevel option').filter({ hasText: "未评定等级" }).count(), "funding level selector is missing 未评定等级");
  await page.selectOption("#fLevel", { label: "未评定等级" });
  assert.strictEqual(await page.locator("#fLevel").inputValue(), "未评定等级", "funding level selector cannot select 未评定等级");
  await page.evaluate(() => {
    window.applyFundRecord("qa-punish-school", "处分测试甲", "测试学院", "2025", "测试班", "2025-2026-2学期", { isPoor: true, poorLevel: "未评定等级", national: false, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "—" });
  });
  await page.evaluate(() => workbench.legacy.flushStore());
  assert.strictEqual(await page.evaluate(() => fundRecords.find((record) => record.studentId === "qa-punish-school" && record.term === "2025-2026-2学期").poorLevel), "未评定等级", "funding record did not persist 未评定等级");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(() => {
    const terms = getTermList();
    if (!terms.includes("2024-2025-1学期")) { terms.push("2024-2025-1学期"); saveTermList(terms); syncTermToModules("2024-2025-1学期"); }
    window.applyFundRecord("qa-punish-school", "处分测试甲", "测试学院", "2025", "测试班", "2024-2025-1学期", { isPoor: true, poorLevel: "一般困难", national: false, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "历史学期" });
    window.applyFundRecord("qa-punish-school", "处分测试甲", "测试学院", "2025", "测试班", "2025-2026-2学期", { isPoor: true, poorLevel: "特别困难", national: true, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "当前学期" });
    window.openEditFundTerm(window.fundTermByTerm("2024-2025-1学期").id);
  });
  await page.evaluate(() => workbench.legacy.flushStore());
  await page.waitForTimeout(50);
  const historicalFundingText = await page.locator("#fundTableWrap").innerText();
  assert.match(historicalFundingText, /一般困难/, `historical funding term does not show its own records: ${historicalFundingText}`);
  assert.doesNotMatch(historicalFundingText, /特别困难/, `historical funding term is leaking another term's records: ${historicalFundingText}`);
  await page.evaluate(() => window.openEditFund("qa-punish-school", "2024-2025-1学期"));
  assert.strictEqual(await page.locator("#fLevel").inputValue(), "一般困难", "funding edit does not load the selected term's level");
  assert.strictEqual(await page.locator("#fNat").inputValue(), "否", "funding edit does not load the selected term's aid status");
  assert.strictEqual(await page.evaluate(() => students.find((student) => student.id === "qa-punish-school").fund.term), "2025-2026-2学期", "historical funding view overwrote the latest student funding snapshot");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(() => {
    window.applyFundRecord("qa-punish-college", "处分测试乙", "测试学院", "2025", "测试班", "2025-2026-2学期", { isPoor: false, poorLevel: "—", national: false, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "批量操作测试" });
    window.openEditFundTerm(window.fundTermByTerm("2025-2026-2学期").id);
  });
  await page.evaluate(() => workbench.legacy.flushStore());
  await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => fundRecords.find((record) => record.studentId === "qa-punish-college" && record.term === "2025-2026-2学期").poorLevel), "未评定等级", "non-poor funding record discarded 未评定等级");
  assert.match(await page.locator("#fundTableWrap").innerText(), /未评定等级/, "funding table hides the assessment level when 是否贫困生 is 否");
  await page.evaluate(() => window.openEditFund("qa-punish-college", "2025-2026-2学期"));
  assert.strictEqual(await page.locator("#fPoor").inputValue(), "否", "funding edit did not preserve 是否贫困生=否");
  await page.selectOption("#fLevel", { label: "一般困难" });
  await page.locator("#modalOk").click();
  await page.waitForFunction(() => !document.querySelector("#fLevel") && !window.__workbenchStoreSync.busy());
  assert.deepStrictEqual(await page.evaluate(() => {
    const record = fundRecords.find((item) => item.studentId === "qa-punish-college" && item.term === "2025-2026-2学期");
    return { isPoor: record.isPoor, poorLevel: record.poorLevel };
  }), { isPoor: false, poorLevel: "一般困难" }, "funding edit overwrote the selected assessment level when 是否贫困生 is 否");
  assert.match(await page.locator("#fundTableWrap").innerText(), /一般困难/, "funding table did not refresh the saved assessment level");
  assert.strictEqual(await page.locator("#fundTableWrap .fund-batch-cb").count(), 2, "funding rows are missing batch selection checkboxes");
  await page.evaluate(() => {
    const master = document.getElementById("fundBatchMaster");
    master.checked = true;
    master.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.match(await page.locator("#fundBatchCount").textContent(), /2/, "funding batch selection count is incorrect");
  await page.evaluate(() => window.fundBatchEdit());
  assert.match(await page.locator("#modalTitle").textContent(), /批量修改资助情况/, "funding batch edit modal did not open");
  await page.locator('.fund-batch-field[data-field="college"]').check();
  await page.selectOption("#fb_college", "true");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(180);
  await page.waitForFunction(() => document.getElementById('modal').classList.contains('fund-detail-modal') && document.getElementById('fundTableWrap')?.querySelector('.fund-batch-cb'));
  assert.strictEqual(await page.evaluate(() => fundRecords.filter((record) => record.term === "2025-2026-2学期").every((record) => record.college === true)), true, "funding batch edit did not update every selected record");
  assert.strictEqual(await page.evaluate(() => students.find((student) => student.id === "qa-punish-college").fund.college), true, "funding batch edit did not refresh the student profile snapshot");
  const deleteTarget = page.locator('#fundTableWrap .fund-batch-cb[value*="qa-punish-college"]');
  await deleteTarget.check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#fundBatchDeleteBtn").click();
  await page.waitForFunction(() => !fundRecords.some((record) => record.studentId === "qa-punish-college" && record.term === "2025-2026-2学期"), null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => fundRecords.some((record) => record.studentId === "qa-punish-college" && record.term === "2025-2026-2学期")), false, "funding batch delete did not remove the selected record");
  assert.deepStrictEqual(await page.evaluate(() => students.find((student) => student.id === "qa-punish-college").fund), {}, "funding batch delete left a stale student profile snapshot");
  await page.evaluate(() => window.closeModal());
  await page.evaluate(async () => { await window.goto("student"); await new Promise((resolve) => setTimeout(resolve, 80)); window.stuExport(); });
  const studentExportFields = await page.locator("#modalBody").innerText();
  assert.match(studentExportFields, /毕业年份/, "student export is missing graduation year");
  assert.match(studentExportFields, /学籍异动备注/, "student export is missing student-status note");
  assert.match(studentExportFields, /学籍异动单（图片）/, "student export is missing student-status attachment");
  assert.doesNotMatch(studentExportFields, /备注1|备注2|自定义字段/, "retired student custom fields remain in export options");
  const selectedStudentExportHeaders = await page.evaluate(() => {
    const originalDownload = window.downloadXlsxFile;
    let captured = null;
    window.downloadXlsxFile = function(_sheet, rows) { captured = rows; };
    document.querySelectorAll(".stu-export-field").forEach((input) => { input.checked = false; });
    ["graduateYear", "statusNote"].forEach((key) => { document.querySelector('.stu-export-field[data-field="' + key + '"]').checked = true; });
    window.stuExportDo();
    window.downloadXlsxFile = originalDownload;
    return captured && captured[0];
  });
  assert.deepStrictEqual(selectedStudentExportHeaders, ["毕业年份", "学籍异动备注"], "student export ignored selected fields or field order");
  await page.evaluate(async () => {
    const second = students.find((student) => student.id === "qa-punish-college");
    ORG_DEPTS.push({name:"测试二学院",code:"QA2"});
    ORG_MAJORS.push({name:"测试二专业",dept:"测试二学院",code:"QA201"});
    ORG_CLASSES.push({name:"测试二班",dept:"测试二学院",major:"测试二专业",grade:"2025"});
    saveOrgs();
    second.dept = "测试二学院"; second.major = "测试二专业"; second.cls = "测试二班";
    students.push(
      { id: "qa-employment-graduate-only", name: "毕业年份同步测试", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", graduateYear: "2026届", status: "在校" },
      { id: "qa-employment-no-year", name: "未填毕业年份测试", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", graduateYear: "", status: "在校" }
    );
    persistStudents();
    await window.workbench.legacy.flushStore();
    await window.goto("employment"); window.employmentSwitchTab("intention"); await new Promise((resolve) => setTimeout(resolve, 80));
  });
  assert.strictEqual(await page.locator("#employmentIntentionTable tbody tr").count(), 3, "employment intention roster must include every student with a graduation year");
  assert.match(await page.locator("#employmentIntentionTable").innerText(), /毕业年份同步测试[\s\S]*未填写/, "graduate student without an intention record is missing or not marked unfilled");
  assert.doesNotMatch(await page.locator("#employmentIntentionTable").innerText(), /未填毕业年份测试/, "student without a graduation year must not enter the employment intention roster");
  await page.evaluate(async () => { students.find((student) => student.id === "qa-employment-no-year").graduateYear = "2027届"; persistStudents(); await window.workbench.legacy.flushStore(); await renderPage("employment"); });
  assert.doesNotMatch(await page.locator("#employmentIntentionTable").innerText(), /未填毕业年份测试/, "a student from another cohort must not bypass the active graduation-year filter");
  await page.evaluate(() => employmentIntentionSetGraduateYear(""));
  assert.match(await page.locator("#employmentIntentionTable").innerText(), /未填毕业年份测试/, "employment intention roster did not synchronize after graduation year was added");
  await page.evaluate(async () => { students.find((student) => student.id === "qa-employment-no-year").graduateYear = ""; persistStudents(); await window.workbench.legacy.flushStore(); window.employmentSwitchTab("destination"); });
  assert.ok(await page.locator("#content #employmentSyncOverview").count(), "employment tracking synchronization overview is missing");
  assert.strictEqual(await page.locator("#employmentTrackingBody tbody tr").count(), 3, "employment tracking roster must include every student with a graduation year");
  assert.match(await page.locator("#employmentTrackingBody").innerText(), /毕业年份同步测试/, "student with a graduation year but no employment intention is missing from the roster");
  const trackingHeaders = await page.locator("#employmentTrackingBody th").allTextContents();
  assert.strictEqual(trackingHeaders[trackingHeaders.indexOf("毕业年份") + 1], "就业意向", "employment intention must follow graduation year");
  assert.doesNotMatch(await page.locator("#employmentTrackingBody").innerText(), /未填毕业年份测试/, "student without a graduation year must not enter the roster");
  assert.ok(await page.locator("#employmentTrackingDept").count(), "employment tracking college filter is missing");
  assert.ok(await page.locator("#employmentTrackingClass").count(), "employment tracking class filter is missing");
  await page.selectOption("#employmentTrackingDept", "测试二学院");
  assert.strictEqual(await page.locator("#employmentTrackingBody tbody tr").count(), 1, "employment tracking college filter returned the wrong row count");
  assert.match(await page.locator("#employmentTrackingBody").innerText(), /处分测试乙/, "employment tracking college filter returned the wrong student");
  assert.strictEqual(await page.locator('#employmentTrackingClass option[value="测试二班"]').count(), 1, "employment tracking class options are not linked to the selected college");
  await page.selectOption("#employmentTrackingClass", "测试二班");
  assert.strictEqual(await page.locator("#employmentTrackingBody tbody tr").count(), 1, "employment tracking class filter returned the wrong row count");
  await page.selectOption("#employmentTrackingDept", "");
  await page.locator('.employment-tracking-select[value="qa-punish-school"]').check();
  assert.strictEqual(await page.locator("#employmentTrackingInitializeBtn").isEnabled(), true, "employment tracking initialization is not enabled after selecting a student");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /数据初始化/ }).click();
  await page.waitForFunction(() => employmentTrackingRecord("qa-punish-school") === null && employmentTrackingRecord("qa-punish-college") === null);
  assert.strictEqual(await page.evaluate(() => {
    return employmentTrackingRecord("qa-punish-school") === null && employmentTrackingRecord("qa-punish-college") === null;
  }), true, "employment tracking data initialization did not clear only the selected student's archive");
  assert.match(await page.locator("#employmentTrackingBody").innerText(), /待联系/, "cleared employment tracking student did not return to pending-contact status");
  await page.evaluate(() => window.employmentTrackingOpenContact("qa-punish-school"));
  await page.fill("#etDate", "2026-08-12");
  await page.selectOption("#etContactMethod", "线上");
  await page.fill("#etChannel", "微信语音/视频");
  await page.selectOption("#etStatus", "笔试/面试中");
  await page.fill("#etContent", "已完成线上谈话，学生反馈正在准备面试。");
  await page.fill("#etProgress", "已投递 3 家单位，预约下周面试。");
  await page.fill("#etIssue", "需要协助完善面试表达。");
  await page.fill("#etNextDate", "2026-08-20");
  await page.fill("#etNextPlan", "核实面试结果并推送岗位信息。");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(80);
  assert.match(await page.locator("#employmentTrackingBody").innerText(), /微信语音\/视频/, "employment tracking does not record the specific online tool");
  assert.match(await page.locator("#employmentTrackingBody").innerText(), /笔试\/面试中/, "employment tracking does not record the current employment status");
  assert.strictEqual(await page.evaluate(() => employmentTrackingRecord("qa-punish-school").contacts.some((contact) => contact.channel === "微信语音/视频" && contact.nextDate === "2026-08-20")), true, "employment contact record was not persisted");
  await page.evaluate(() => window.employmentTrackingView("qa-punish-school"));
  assert.match(await page.locator("#modalBody").innerText(), /已完成线上谈话/, "employment tracking archive does not show contact details");
  await page.evaluate(() => window.closeModal());
  await verifyPunishmentActions(page, "school", "20260812001");
  await verifyPunishmentActions(page, "college", "punishment_college_特殊字符_&_<tag>_20260812");
  const archiveFileProbe = await page.evaluate(async () => {
    const student = students.find((item) => item.id === "qa-punish-school");
    const pdf = await portraitArchivePdfBlob(student);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    const pdfSource = new TextDecoder("latin1").decode(pdfBytes);
    const mediaBox = pdfSource.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const result = await portraitArchiveZipBlob([student]);
    const opened = await JSZip.loadAsync(result.blob);
    const names = Object.keys(opened.files).filter((name) => !opened.files[name].dir);
    const zippedPdf = await opened.files[names[0]].async("uint8array");
    return {
      pdfHeader: String.fromCharCode.apply(null, Array.from(pdfBytes.slice(0, 5))),
      pdfSize: pdfBytes.length,
      pdfPages: (pdfSource.match(/\/Type\s*\/Page\b/g) || []).length,
      landscape: !!(mediaBox && Number(mediaBox[1]) > Number(mediaBox[2])),
      zipFiles: names,
      zippedPdfHeader: String.fromCharCode.apply(null, Array.from(zippedPdf.slice(0, 5))),
      exportHosts: document.querySelectorAll('[aria-hidden="true"] .portrait-archive-export').length
    };
  });
  assert.strictEqual(archiveFileProbe.pdfHeader, "%PDF-", "single student archive is not a valid PDF");
  assert.ok(archiveFileProbe.pdfSize > 1000, "single student archive PDF is empty");
  assert.ok(archiveFileProbe.pdfPages > 1, "student archive content was clipped into a single page");
  assert.strictEqual(archiveFileProbe.landscape, true, "student archive did not use the wide-table landscape layout");
  assert.match(archiveFileProbe.zipFiles[0], /测试班\/qa-punish-school 处分测试甲\.pdf$/, "batch archive ZIP path is incorrect");
  assert.strictEqual(archiveFileProbe.zippedPdfHeader, "%PDF-", "batch archive contains an invalid PDF");
  assert.strictEqual(archiveFileProbe.exportHosts, 0, "student archive export left a hidden rendering host behind");
  await page.evaluate(async () => {
    const temporaryFilterStudent = students.find((student) => student.id === "qa-punish-college");
    temporaryFilterStudent.dept = "测试学院";
    temporaryFilterStudent.major = "测试专业";
    temporaryFilterStudent.cls = "测试班";
    students.push({ id: 90001, name: "学生删除回归", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", status: "在校" });
    talkRecords.push({ id: "qa-delete-student-talk", sid: 90001, name: "学生删除回归", term: "2025-2026-2学期", date: "2026-09-20" });
    persistStudents();
    persistTalks();
    await window.workbench.legacy.flushStore();
    window.goto("student");
    window.stuQuery();
  });
  await page.locator('#stuTbody .stu-row-chk[data-sid="90001"]').check();
  page.once("dialog", (dialog) => dialog.accept());
  await page.evaluate(() => window.stuDelChecked());
  assert.strictEqual(await page.evaluate(() => students.some((student) => String(student.id) === "90001")), false, "student deletion left the student in memory");
  assert.strictEqual(await page.evaluate(() => talkRecords.some((record) => String(record.sid || record.studentId || "") === "90001")), false, "student deletion left linked talk records in memory");
  const deletedStudentStore = await page.evaluate(async () => window.workbench.legacy.storeExport());
  assert.strictEqual(deletedStudentStore.nnuzc_students.some((student) => String(student.id) === "90001"), false, "student deletion was not persisted to SQLite");
  assert.strictEqual((deletedStudentStore.nnuzc_talks || []).some((record) => String(record.sid || record.studentId || "") === "90001"), false, "linked talk deletion was not persisted to SQLite");
  await page.reload({ waitUntil: "networkidle" });
  assert.strictEqual(await page.evaluate(() => students.some((student) => String(student.id) === "90001")), false, "deleted student returned after page reload");
  const productivityChecks = require("./productivity-browser-checks.cjs");
  await productivityChecks.verifyTasks(page);
  await productivityChecks.verifyStudentPicker(page);
  assert.deepStrictEqual(pageErrors, [], `browser page errors: ${pageErrors.join(" | ")}`);
  assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
  assert.deepStrictEqual(badResponses, [], `browser HTTP errors: ${badResponses.join(" | ")}`);
  console.log(`qa-browser: passed (${views.length} navigation views, API configuration, punishment actions, no page/console/HTTP errors)`);
}

main().catch((error) => {
  if(serverDiagnostics) console.error("Isolated server diagnostics:",serverDiagnostics);
  const diagnosticLog=path.join(temp,"data","server.log");
  if(fs.existsSync(diagnosticLog))console.error("Isolated request diagnostics:",fs.readFileSync(diagnosticLog,"utf8").split(/\r?\n/).filter(line=>line.includes("请求失败")).slice(-10).join("\n"));
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (child) child.kill();
  await delay(200);
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

