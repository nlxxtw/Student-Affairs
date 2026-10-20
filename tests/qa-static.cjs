"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const XLSX = require("../assets/xlsx.full.min.js");

const root = path.resolve(__dirname, "..");
const launcherRoot = path.resolve(root, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const app = read("app.js");
const partyImportEngine = read("party-import-engine.js");
const achievementEnhancements = read("achievement-enhancements.js");
const awardStatisticsModule = read("award-statistics-module.js");
const otherViolationModule = read("other-violation-module.js");
const dormRosterModule = read("dorm-roster-module.js");
const dormSpatialModule = read("dorm-spatial-module.js");
const dormSpatialCss = read("dorm-spatial-module.css");
const customRosterModule = read("custom-roster-module.js");
const counselorGrowthModule = read("counselor-growth-module.js");
const customFieldsModule = read("custom-fields-module.js");
const academicSummaryTool = read("assets/academic-summary-tool.js");
const academicSummaryToolHtml = read("assets/academic-summary-tool.html");
const academicAnalysisTool = read("assets/academic-analysis-tool.js");
const academicAnalysisToolHtml = read("assets/academic-analysis-tool.html");
const academicAnalysisToolCss = read("assets/academic-analysis-tool.css");
const toolHistoryClient = read("assets/tool-history-client.js");
const academicAnalysisEngine = read("scripts/academic-analysis-engine.py");
const intelligenceEnhancements = read("intelligence-enhancements.js");
const searchableFilterSelects = read("searchable-filter-selects.js");
const searchableFilterCss = read("searchable-filter-selects.css");
const licenseClient = read("license-client.js");
const updateClient = read("update-client.js");
const updateLauncher = read("update-launcher.js");
const server = read("web-server.js");
const databaseSchema = read("workbench-database.js");
const index = read("index.html");
const demoData = read("demo-data.js");
const login = read("login.html");
const studentOrgPage = read("学生组织管理.html");
const windowsLauncher = fs.readFileSync(path.join(launcherRoot, "启动数智学工.vbs"), "utf16le").replace(/^\uFEFF/, "");
const windowsStopLauncher = fs.readFileSync(path.join(launcherRoot, "关闭数智学工.vbs"), "utf16le").replace(/^\uFEFF/, "");
const windowsStart = read("scripts/start-workbench.ps1");
const windowsStop = read("scripts/stop-workbench.ps1");

const feedbackPos = index.indexOf('id="feedbackLink"');
const demoLoadPos = index.indexOf('id="demoLoadBtn"');
assert.ok(feedbackPos >= 0 && feedbackPos < demoLoadPos, "feedback link must precede the demo-data button");
assert.match(index.slice(feedbackPos, demoLoadPos), /href="https:\/\/f\.wps\.cn\/g\/d2LnPnE2\/" target="_blank" rel="noopener noreferrer"/, "feedback link must open the requested URL safely");

new vm.Script(app, { filename: "app.js" });
new vm.Script(partyImportEngine, { filename: "party-import-engine.js" });
new vm.Script(achievementEnhancements, { filename: "achievement-enhancements.js" });
new vm.Script(awardStatisticsModule, { filename: "award-statistics-module.js" });
new vm.Script(otherViolationModule, { filename: "other-violation-module.js" });
new vm.Script(dormRosterModule, { filename: "dorm-roster-module.js" });
new vm.Script(dormSpatialModule, { filename: "dorm-spatial-module.js" });
new vm.Script(customRosterModule, { filename: "custom-roster-module.js" });
new vm.Script(counselorGrowthModule, { filename: "counselor-growth-module.js" });
new vm.Script(customFieldsModule, { filename: "custom-fields-module.js" });
new vm.Script(academicSummaryTool, { filename: "assets/academic-summary-tool.js" });
new vm.Script(academicAnalysisTool, { filename: "assets/academic-analysis-tool.js" });
new vm.Script(intelligenceEnhancements, { filename: "intelligence-enhancements.js" });
new vm.Script(searchableFilterSelects, { filename: "searchable-filter-selects.js" });
new vm.Script(licenseClient, { filename: "license-client.js" });
new vm.Script(updateClient, { filename: "update-client.js" });
new vm.Script(updateLauncher, { filename: "update-launcher.js" });
new vm.Script(server, { filename: "web-server.js" });
for (const [name, source] of [["app.js", app], ["party-import-engine.js", partyImportEngine], ["achievement-enhancements.js", achievementEnhancements], ["award-statistics-module.js", awardStatisticsModule], ["other-violation-module.js", otherViolationModule], ["dorm-roster-module.js", dormRosterModule], ["dorm-spatial-module.js", dormSpatialModule], ["dorm-spatial-module.css", dormSpatialCss], ["custom-roster-module.js", customRosterModule], ["counselor-growth-module.js", counselorGrowthModule], ["custom-fields-module.js", customFieldsModule], ["assets/academic-analysis-tool.html", academicAnalysisToolHtml], ["assets/academic-analysis-tool.js", academicAnalysisTool], ["assets/academic-analysis-tool.css", academicAnalysisToolCss], ["scripts/academic-analysis-engine.py", academicAnalysisEngine], ["intelligence-enhancements.js", intelligenceEnhancements], ["searchable-filter-selects.js", searchableFilterSelects], ["searchable-filter-selects.css", searchableFilterCss], ["license-client.js", licenseClient], ["update-client.js", updateClient], ["web-server.js", server], ["workbench-database.js", databaseSchema], ["index.html", index], ["login.html", login], ["数智学工.vbs", windowsLauncher], ["关闭数智学工.vbs", windowsStopLauncher], ["scripts/start-workbench.ps1", windowsStart], ["scripts/stop-workbench.ps1", windowsStop]]) {
  assert.ok(!source.includes("\uFFFD"), `${name} contains Unicode replacement characters`);
  assert.ok(!source.includes("\0"), `${name} contains NUL characters`);
}
assert.ok(index.includes('src="/achievement-enhancements.js"'), "achievement enhancement script is not loaded");
assert.ok(index.includes('src="/party-import-engine.js"') && server.includes('"/api/party/import"') && server.includes('"/party-import-engine.js"'), "party import engine, API or static asset is not wired");
assert.ok(index.includes('src="/award-statistics-module.js"'), "award statistics module script is not loaded");
assert.ok(index.includes('src="/dorm-roster-module.js"'), "dorm roster module script is not loaded");
assert.ok(index.includes('src="/dorm-spatial-module.js"') && index.includes('href="/dorm-spatial-module.css"'), "spatial dorm assets are not loaded");
for (const marker of ["DORM_SPATIAL_MODULE_SOURCE", '"/dorm-spatial-module.js"', '"/dorm-spatial-module.css"']) assert.ok(server.includes(marker), `spatial dorm server marker is missing: ${marker}`);
for (const marker of ["空间总览","住宿分布","公寓资源","defaultBedCount","studentRole","AUTO_CHECKOUT_GRADUATION","checkoutGraduates","毕业自动退宿","dormSpatialDeleteBuilding","dormSpatialDeleteRoom",'recycleMoveRecords("dormRoom"','recycleMoveRecords("dormBuilding"',"empty-room-prompt"]) assert.ok(dormSpatialModule.includes(marker), `spatial dorm module marker is missing: ${marker}`);
for (const marker of ["dsp-overview-hero","dsp-building-card","dsp-building-occupancy","dsp-room-progress","dormSpatialResetFilters"]) assert.ok(dormSpatialModule.includes(marker), `spatial dorm overview UI marker is missing: ${marker}`);
for (const marker of ["点击宿舍号编辑宿舍，点击床号查看学生信息","dsp-operation-tip","dsp-bed-number"]) assert.ok((dormSpatialModule+"\n"+dormSpatialCss).includes(marker), `spatial dorm operation hint marker is missing: ${marker}`);
for (const marker of ["dormSpatialOpenStudent","getDormRosterFieldDefinitions","getDormRosterStudentSnapshot","getDormRosterEnrollmentPhoto","dsp-student-photo"]) assert.ok((app+"\n"+dormRosterModule+"\n"+dormSpatialModule+dormSpatialCss).includes(marker), `spatial resident profile marker is missing: ${marker}`);
for (const marker of ["grid-template-columns:repeat(auto-fill,minmax(270px,1fr))","@media(max-width:600px)",".dsp-overview-meter",".dsp-filter-group"]) assert.ok(dormSpatialCss.includes(marker), `spatial dorm responsive style marker is missing: ${marker}`);
assert.ok(app.includes('"nnuzc_dorm_spatial_v1"') && app.includes("dormConfirmGraduationTransitions") && app.includes("dormApplyGraduationTransitions"), "spatial dorm persistence or graduation bridge is missing");
for (const marker of ["id='odCode' value='", "id='omCode' value='", "id='ocName' value='", "maintRenameClassReferences(oldName,newName)", "MAINT_CLASS_REFERENCE_KEYS"]) assert.ok(app.includes(marker), `editable organization field or class rename synchronization is missing: ${marker}`);
assert.ok(!app.includes("<label>学院代码</label><input value='\"+escAttr(d.code)+\"' readonly")&&!app.includes("<label>专业代码</label><input value='\"+escAttr(m.code)+\"' readonly")&&!app.includes("<label>班级名称</label><input value='\"+escAttr(c.name)+\"' readonly"), "organization edit fields are still readonly");
assert.ok(dormSpatialModule.includes("legacyDormBuildingsV2") && dormSpatialModule.includes("buildingRows") && dormSpatialModule.includes("syncLegacyBuildingShadow"), "authoritative apartment-resource migration or compatibility shadow is missing");
const maintenanceStart=app.indexOf("PAGES.maint=function(){"),maintenanceEnd=app.indexOf("function scanStorageHealth",maintenanceStart);
const maintenancePageSource=maintenanceStart>=0&&maintenanceEnd>maintenanceStart?app.slice(maintenanceStart,maintenanceEnd):"";
assert.ok(maintenancePageSource&&!maintenancePageSource.includes('data-t="d6"')&&!maintenancePageSource.includes("PAGES.dorminfo()"), "legacy dorm maintenance entry is still exposed");
assert.ok(index.includes('src="/custom-roster-module.js"'), "custom roster module script is not loaded");
for (const marker of ['photoW=280', 'width:24mm', 'white-space:nowrap', 'data-roster-field="id"']) assert.ok(dormRosterModule.includes(marker), `standard roster 12-digit student-number layout marker is missing: ${marker}`);
for (const marker of ['ROSTER_LAYOUT=window.DormRosterLayout', 'ROSTER_LAYOUT.renderPage', 'ROSTER_LAYOUT.pageSize', 'data-roster-field=', 'attr(field.key)']) assert.ok(customRosterModule.includes(marker), `custom roster shared layout marker is missing: ${marker}`);
assert.ok(index.includes('src="/counselor-growth-module.js"'), "counselor growth module script is not loaded");
assert.ok(index.includes('src="/custom-fields-module.js"') && server.includes('CUSTOM_FIELDS_MODULE_SOURCE'), "custom field module must be served and loaded");
assert.ok(customFieldsModule.includes('academicRecord:{name:"综测数据 · 综测记录",hostView:"eval"') && customFieldsModule.includes('academicWarning:{name:"学业情况（个人版） · 学业预警（个人版）",hostView:"academic"') && customFieldsModule.includes('academicGrade:{name:"学业情况（个人版） · 成绩与排名（个人版）",hostView:"academic"'), "academic custom-field cards must be attached to their matching navigation pages");
for (const marker of ["辅导员成长档案", "nnuzc_counselor_growth_records_v1", "nnuzc_counselor_growth_settings_v1", "nnuzc_counselor_growth_history_v1", "指导学生获奖", "个人获奖", "论文", "项目", "不读取或回写系统原有业务数据", "支撑材料附件", "代表性成果", "批量导入", "年度对比", "生成完整年度材料 Word", "字典设置", "修改历史", "counselorGrowthRestoreHistory", "不代表学校或第三方认定"]) assert.ok(counselorGrowthModule.includes(marker), `counselor-growth marker is missing: ${marker}`);
for (const marker of ["cg-profile-modal", "导出个人信息预览", "counselorGrowthProfilePreview", "专业发展方向"]) assert.ok(counselorGrowthModule.includes(marker), `counselor profile UI marker is missing: ${marker}`);
for (const retired of ['id="cgRecordStage"', 'id="cgStage"', 'id="cgSettingStages"', "extraStages", "stageOptions", "FINISHED", "ACTIVE"]) assert.ok(!counselorGrowthModule.includes(retired), `retired counselor-growth status feature remains: ${retired}`);
for (const forbidden of ["nnuzc_achievement_records", "achievementRecords", "counselorGrowthLinkAchievements", "counselorGrowthCreateFromAchievement"]) assert.ok(!counselorGrowthModule.includes(forbidden), `standalone counselor-growth module must not reference: ${forbidden}`);
for (const retired of ["nnuzc_counselor_growth_plans_v1", "计划与复盘", "counselorGrowthOpenPlan", "counselorGrowthDeletePlan", "cgPlanGoal"]) assert.ok(!counselorGrowthModule.includes(retired), `retired counselor-growth plan feature remains: ${retired}`);
assert.ok(server.includes("function purgeRetiredCounselorGrowthPlans()") && server.includes("DELETE FROM legacy_ui_store WHERE key='nnuzc_counselor_growth_plans_v1'"), "retired counselor-growth plan data must be purged from persistent storage");
assert.ok(!server.match(/DEMO_BUSINESS_KEYS[\s\S]{0,2500}nnuzc_counselor_growth_plans_v1/), "retired counselor-growth plan key must not remain in the active business-key allowlist");
assert.ok(!achievementEnhancements.includes("counselorGrowth"), "achievement module must not link to the standalone counselor-growth module");
for (const marker of ["COUNSELOR_GROWTH_MODULE_SOURCE", "/counselor-growth-module.js", "nnuzc_counselor_growth_records_v1", "counselorGrowthModule"]) assert.ok(server.includes(marker), `counselor-growth server marker is missing: ${marker}`);
assert.ok(index.includes('href="/searchable-filter-selects.css"') && index.includes('src="/searchable-filter-selects.js"'), "searchable filter assets are not loaded");
for (const marker of ["qf-single", "qf-multi", "data-searchable-filter", "MutationObserver", "sf-search-input"]) assert.ok(searchableFilterSelects.includes(marker), `searchable filter marker is missing: ${marker}`);
for (const marker of [".sf-search-input", ".sf-native-panel", ".qf-multi-opt input[type=\"checkbox\"]"]) assert.ok(searchableFilterCss.includes(marker), `searchable filter CSS marker is missing: ${marker}`);
for (const marker of ["/searchable-filter-selects.js", "/searchable-filter-selects.css", "SEARCHABLE_FILTER_SELECTS_SOURCE", "SEARCHABLE_FILTER_SELECTS_CSS_SOURCE"]) assert.ok(server.includes(marker), `searchable filter server marker is missing: ${marker}`);
for (const asset of ["academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "xlsx.full.min.js"]) assert.ok(fs.existsSync(path.join(root, "assets", asset)), `academic summary tool asset is missing: ${asset}`);
for (const asset of ["academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-template.xlsx", "academic-analysis-field-template.xlsx"]) assert.ok(fs.existsSync(path.join(root, "assets", asset)), `academic analysis tool asset is missing: ${asset}`);
assert.strictEqual(fs.readFileSync(path.join(root, "assets", "academic-analysis-rules.docx")).subarray(0, 2).toString("binary"), "PK", "academic analysis rules must be a valid DOCX/ZIP file");
assert.strictEqual(fs.readFileSync(path.join(root, "assets", "academic-analysis-template.xlsx")).subarray(0, 2).toString("binary"), "PK", "academic analysis template must be a valid XLSX/ZIP file");
assert.strictEqual(fs.readFileSync(path.join(root, "assets", "academic-analysis-field-template.xlsx")).subarray(0, 2).toString("binary"), "PK", "academic analysis field template must be a valid XLSX/ZIP file");
const academicAnalysisFieldWorkbook=XLSX.read(fs.readFileSync(path.join(root,"assets","academic-analysis-field-template.xlsx")),{type:"buffer"});
const academicAnalysisFieldRows=XLSX.utils.sheet_to_json(academicAnalysisFieldWorkbook.Sheets[academicAnalysisFieldWorkbook.SheetNames[0]],{header:1,defval:""});
assert.strictEqual(academicAnalysisFieldWorkbook.SheetNames.length,1,"academic analysis field template must contain one data sheet");
assert.strictEqual(academicAnalysisFieldRows.length,2,"academic analysis field template must contain only header and row 2 example");
assert.strictEqual(academicAnalysisFieldRows[1][3],"示例学生","academic analysis field template row 2 example is missing");
for (const marker of ["学业分析助手", "academicAnalysis", "academic-analysis-tool.html", "统计规则（更新版）", "AI 数据解读", "academicAnalysisAi", "academicAnalysisRequestSummary"]) assert.ok(`${index}\n${app}\n${server}\n${academicAnalysisTool}`.includes(marker), `academic analysis toolbox marker is missing: ${marker}`);
for (const marker of ["/api/academic-analysis/run", "/api/academic-analysis/download/", "academic-analysis-rules.docx", "academic-analysis-engine.py", '"academicAnalysis"']) assert.ok(server.includes(marker), `academic analysis server marker is missing: ${marker}`);
for (const marker of ["/api/academic-analysis/history", "listAcademicAnalysisHistory", "历史生成记录", "historyList", "loadHistory", "数据库记录"]) assert.ok(`${server}\n${academicAnalysisToolHtml}\n${academicAnalysisTool}`.includes(marker), `academic analysis history marker is missing: ${marker}`);
for (const marker of ["字段参考", "必填字段（13项）", "可选字段", "academic-analysis-field-template.xlsx", "单学期成绩导入模板.xlsx", "身份证号"]) assert.ok(`${server}\n${academicAnalysisToolHtml}`.includes(marker), `academic analysis field reference marker is missing: ${marker}`);
assert.ok(academicAnalysisTool.includes('[['+'"班级","班主任"'+'],['+'"示例班级","示例班主任"'+']]') && !academicAnalysisTool.includes('XLSX.utils.book_append_sheet(workbook,notes,"填写说明")'), "teacher import template must contain only header and row 2 example");
assert.ok(academicAnalysisToolHtml.includes("第二行为虚构示例") && !academicAnalysisToolHtml.includes("下载空白字段模板"), "academic analysis template guidance must match the row 2 example workbook");
assert.ok(!studentOrgPage.includes('["办公室/文书组","公文起草"')&&!studentOrgPage.includes('["外联部","对外联络"')&&studentOrgPage.includes('var sample=head.map(function(h){var field=M.fields.find'),"student organization templates must contain only one complete row 2 example");
for (const marker of ["data-history-delete", "删除记录", "ToolHistory.remove", "不会影响学生数据及其他历史记录", "button.danger"]) assert.ok(`${academicAnalysisTool}\n${academicAnalysisToolCss}`.includes(marker), `academic analysis history deletion marker is missing: ${marker}`);
for (const marker of ["DOWNLOAD_META", "downloadUrl", "学业考试成绩分析统计表.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]) assert.ok(academicAnalysisTool.includes(marker), `academic analysis download metadata marker is missing: ${marker}`);
for (const marker of ["IDCARD_SOURCE", "source_from_idcard", 'failure.get("身份证号")']) assert.ok(academicAnalysisEngine.includes(marker), `academic analysis source mapping marker is missing: ${marker}`);
assert.ok(academicAnalysisToolCss.includes('font:12px/1.65') && academicAnalysisToolCss.includes('.hero h1{font-size:28px}') && academicAnalysisToolCss.includes('.metric b{display:block;font-size:22px}'), "academic analysis typography must include the global 1px increase");
for (const marker of ["班级挂科率", "占本班人数", "补考通过率", "成绩分布特征", "课程类型", "一人一档"]) assert.ok(academicAnalysisEngine.includes(marker), `enhanced academic report marker is missing: ${marker}`);
for (const removed of ["全院平均挂科率", "同年级平均挂科率", "rate_comparison"]) assert.ok(!academicAnalysisEngine.includes(removed), `academic report must not compare the current class with other classes: ${removed}`);
for (const marker of ["综测与成绩汇总（个人定制）", "academicSummary", "academic-summary-tool.html", "AI 智能核查", "academicSummaryAiCheck"]) assert.ok(`${index}\n${app}\n${server}`.includes(marker), `academic summary toolbox marker is missing: ${marker}`);
for (const marker of ["buildRankDiagnostics", "rankIssueLocations", "makeAiDiagnosticXlsx", "downloadAiDiagnosticReport", "下载错误数据表格", "academicSummaryFilterAiContent"]) assert.ok(`${app}\n${academicSummaryTool}`.includes(marker), `academic summary AI diagnostic marker is missing: ${marker}`);
for (const marker of ["supportedSpreadsheetFormats", "XLSX.read", "sheet_to_json", "xlsb", "WPS 专有或加密格式"]) assert.ok(academicSummaryTool.includes(marker), `academic summary multi-format marker is missing: ${marker}`);
for (const marker of ["rosterIds", "selected.has(id)", "rankByScore", "academic.weighted == null ? 0", "academic.gpa == null ? 0", "collectExtraStudents", "showExtraStudentsDialog", "semesters ? (a + b) / semesters : 0"]) assert.ok(academicSummaryTool.includes(marker), `academic summary roster/notice/zero-fill/score-rank rule is missing: ${marker}`);
for (const marker of ["roundDecimal", "percentageTwo", "roundDecimal(rank / total, 4)"]) assert.ok(academicSummaryTool.includes(marker), `academic summary numeric rounding rule is missing: ${marker}`);
for (const marker of ["《汇总》是唯一统计名单", "弹窗列出学号、姓名和来源", "仅一学期有成绩时按（已有成绩 + 0）÷ 1", "来源表中的排名列不再参与计算"]) assert.ok(academicSummaryToolHtml.includes(marker), `academic summary rule description is missing: ${marker}`);
for (const removed of ["confirmMissingData", "addedFromAcademic", "缺失学生由学业成绩补充"]) assert.ok(!`${academicSummaryTool}\n${academicSummaryToolHtml}`.includes(removed), `retired academic-summary population rule remains: ${removed}`);
for (const marker of ["XLSX_SOURCE", '"/xlsx.full.min.js"', "STATIC_ASSETS.xlsx"]) assert.ok(server.includes(marker), `SheetJS server asset marker is missing: ${marker}`);
for (const removed of ["makeUpCourseStudents", "retakeCourseStudents"]) assert.ok(!academicSummaryTool.includes(removed), `excluded academic-summary AI risk remains: ${removed}`);
assert.ok(server.includes('"academicSummary"'), "academic summary AI feature must be registered on the server");
for (const marker of ["花名册（自定义版）", "nnuzc_custom_roster_v1", "数据档案", "customRosterNewDataset", "customRosterSwitchDataset", "保存为新的数据档案", "customRoster_mode", "customRosterFilter", "customRosterFilterConfirm", "customRosterApplyFilters", "筛选条件已应用", "住宿情况", "customRosterOpenField", "customRosterImportPhotos", "customRosterPhotoName", "customRosterGenerate", "customRosterPreview", "customRosterPdf", "导出 PDF 花名册（自定义版）", "身份证号", "attachmentUploadFile", "导入字段/数据"]) assert.ok((app + "\n" + dormRosterModule + "\n" + customRosterModule).includes(marker), `custom roster marker is missing: ${marker}`);
assert.ok(index.indexOf('<div class="nav-group">工具箱</div>') < index.indexOf('data-view="customRoster"'), "custom roster must be located under the toolbox navigation group");
assert.ok(index.indexOf('data-view="dormRoster"') < index.indexOf('<div class="nav-group">学生组织管理</div>') && index.indexOf('data-view="customRoster"') > index.indexOf('<div class="nav-group">工具箱</div>'), "custom roster must no longer be located in student information management");
assert.ok(index.indexOf('data-view="dormRoster"') < index.indexOf('data-view="maint"') && index.indexOf('data-view="maint"') < index.indexOf('<div class="nav-group">学生组织管理</div>'), "basic data maintenance must be the last item under student information management");
assert.ok(index.indexOf('data-view="classroom"') < index.indexOf('data-view="courseTimetable"') && index.indexOf('data-view="courseTimetable"') < index.indexOf('data-view="dormviolate"'), "the new timetable navigation must immediately follow classroom management");
assert.ok(index.indexOf('data-view="maint"') < index.indexOf('<div class="nav-group">系统管理</div>'), "basic data maintenance must no longer be under system management");
assert.ok(!index.includes('data-view="toolbox"') && !app.includes('PAGES.toolbox') && !app.includes('toolboxHistoryLoad'), "retired name-check feature code or navigation is still present");
assert.ok(!toolHistoryClient.includes('toolbox: "name_check"') && server.includes("purgeRetiredNameCheckHistory") && server.includes("nnuzc_tool_history_index_name_check_v1"), "retired name-check history type or its permanent data purge is incorrect");
for (const retired of ['data-view="knowledge"', "PAGES.knowledge", "function aiKnowledgeContent(", "function aiKb", "const NN_KB_KEY"]) assert.ok(!`${index}\n${app}`.includes(retired), `retired knowledge UI or client code remains: ${retired}`);
assert.ok(!server.includes(',aiKnowledge: { label: "校本知识库"'), "retired knowledge recycle-bin adapter remains active");
assert.ok(app.includes('localStorage.removeItem("nnuzc_kb")'), "retired knowledge browser cache must be purged");
assert.ok(server.includes("function purgeRetiredKnowledgeFeature()") && server.includes("RETIRED_STORE_KEYS") && server.includes("skippedRetiredKeys"), "retired knowledge persistence and restore guards are incomplete");
assert.ok(!demoData.includes("nnuzc_kb") && !server.match(/DEMO_BUSINESS_KEYS[\s\S]{0,2500}nnuzc_kb/), "retired knowledge data must not remain in demo data or active business keys");
assert.ok(!server.match(/const AI_FEATURE_KEYS[^\n]+knowledge/) && !app.match(/const AI_FEATURE_META=\{[\s\S]{0,1000}knowledge:/), "retired knowledge AI feature switch remains registered");
assert.ok(index.indexOf('data-view="academicSummary"') > index.indexOf('data-view="customRoster"'), "academic summary must follow custom roster in the toolbox navigation");
assert.ok(index.indexOf('data-view="academicAnalysis"') > index.indexOf('data-view="academicSummary"'), "academic analysis must be the last toolbox navigation item");
assert.ok(app.includes('PAGES.academicSummary'), "academic summary view must be registered");
assert.ok(app.includes("PAGES.academicAnalysis") && app.includes('aiChat(system,academicAnalysisAiPrompt(mode,question)+'), "academic analysis page and AI assistant must be registered");
assert.ok(app.includes("不得写全院、同年级、其他班级情况") && app.includes("禁止排名和横向比较") && !app.includes("班级间差异"), "academic analysis AI must keep every class report isolated");
for (const marker of ["宿舍花名册", "dormRosterPdf", "getDormRosterIdPhoto", "dormRosterFilterConfirm", "dormRosterApplyFilters", "调整筛选条件后请点击“确定”刷新结果", "按寝室", "按班级", "按专业"]) assert.ok((app + "\n" + dormRosterModule).includes(marker), `dorm roster marker is missing: ${marker}`);
for (const marker of ["ROSTER_COLUMNS=3", "ROSTER_ROWS=6", "ROSTER_PAGE_SIZE=ROSTER_COLUMNS*ROSTER_ROWS", "grid-template-columns:repeat(3,minmax(0,1fr))", "overflow-wrap:anywhere", "wrapCanvasText", "data-roster-field"]) assert.ok(dormRosterModule.includes(marker), `three-column roster layout marker is missing: ${marker}`);
assert.ok(index.includes('src="/intelligence-enhancements.js"'), "intelligence enhancement script is not loaded");
for (const marker of ["studentIntelligenceSnapshot", "siDashboard", "siPortrait", "siAiOverview", "共享态势快照已连接"]) {
  assert.ok(intelligenceEnhancements.includes(marker), `intelligence enhancement marker is missing: ${marker}`);
}
for (const marker of ["一条记录对应一名学生", "fieldConfidence", "certBatchStart", "cert-q-delete", "recycleMoveRecords(\"certificate\",\"certificate_record\"", "获奖记录及附件关联继续保留", "批量识别正在运行", "achievementExportPublic", "achievementExportPackage", "确认并同步至获奖情况"]) {
  assert.ok(achievementEnhancements.includes(marker), `achievement enhancement marker is missing: ${marker}`);
}
for (const marker of ["AWARD_STATISTICS_FIELDS", "荣誉称号名称", "学科竞赛名称", "现在年级", "获奖证书", "application/pdf", "awardStatisticsRecordsForStudent", "openMappedImportWizard", "awardStatisticsMatchStudent"]) {
  assert.ok(awardStatisticsModule.includes(marker), `award statistics marker is missing: ${marker}`);
}
for (const marker of ["studentsByExactName", "resolveStudentNameInput", "studentChoiceLayer", "data-student-choice-id", "选择同名学生", "姓名唯一时直接回填", "closeStudentChoice(); resetModalLayout"]) {
  assert.ok(app.includes(marker), `shared student name matching marker is missing: ${marker}`);
}
for (const marker of ["keyCareStudentNameFill", "awfNameAutoFill", "grfNameAutoFill", "aefNameAutoFill", "absNameAutoFill", "dormAddNameAutoFill", "dvNameAutoFill", "fundStuNameChange", "punishStuNameChange", "talkNameAutoFill", "eventNameAutoFill", "helpNameAutoFill", "homeNameAutoFill", "psychNameAutoFill", "xcmStudentNameFill", "employmentIntentionNameFill", "achievementMatchStudent"]) {
  assert.ok(app.includes(marker), `student-name autofill handler is missing: ${marker}`);
}
for (const marker of ["awardStatisticsNameAutoFill", "输入姓名自动匹配", "同名学生将弹出候选信息供人工选择"]) assert.ok(awardStatisticsModule.includes(marker), `award-statistics name matching marker is missing: ${marker}`);
for (const marker of ["fillStudentByName", "resolveStudentNameInput", "输入姓名自动匹配"]) assert.ok(otherViolationModule.includes(marker), `other-violation name matching marker is missing: ${marker}`);
for (const marker of ['["dept","学院",false],["major","专业",false]', '["grade","年级",false],["cls","班级",true]', '["status","学籍状态",true]', "function stuValidStatus(value)", 'id="fStatus" required', "请选择有效的学籍状态", "学号、姓名、班级、学籍状态", "学籍状态必须使用系统现有选项", "normalizeStudentImportRowByClass", "classAuthoritative:true", "confirmAndAddMissingStudentBasicData([o],\"新增学生\")", "confirmAndAddMissingStudentBasicData([o],\"编辑学生\")", "是否将不存在的学院、专业、班级、年级等信息自动添加到“基础数据维护”中", "未维护班级需同时提供学院、专业、年级", 'id="fGradeOptions"', 'id="fClassOptions"']) assert.ok(app.includes(marker), `student class-authoritative import marker is missing: ${marker}`);
for (const removed of ["必填字段：</b>学院、学号、姓名、专业", "必填：学院、学号、姓名、专业", "学号 / 姓名 / 学院 / 专业"]) assert.ok(!app.includes(removed), `retired student import requirement remains: ${removed}`);
for (const marker of ["function employmentIntentionRoster()", "就业意向名单以学生管理的毕业年份为唯一来源", "未填写意向", "填写意向", "名单自动来自学生管理中已填写的“毕业年份”"]) assert.ok(app.includes(marker), `employment-intention graduation roster marker is missing: ${marker}`);
for (const marker of ["studentLoan:\"助学贷款\"", "PAGES.studentLoan", "nnuzc_student_loan_records", "2026-2027学年", "studentLoanIdInput", "studentLoanNameInput", "贷款银行", "金额（元）"]) assert.ok(app.includes(marker), `student-loan marker is missing: ${marker}`);
for (const marker of ["STUDENT_LOAN_IMPORT_FIELDS", "studentLoanImport()", "studentLoanImportTemplate()", "新增并更新", "仅新增", "学号和姓名至少填写一项", "贷款年度", "贷款数额"]) assert.ok(app.includes(marker), `student-loan mapped import marker is missing: ${marker}`);
for (const marker of ["const studentLoanRows=", "直接读取助学贷款权威台账", "暂无助学贷款记录", '["贷款学年","学院","年级","班级","专业","学号","姓名","贷款银行","金额"]']) assert.ok(app.includes(marker), `student-loan portrait marker is missing: ${marker}`);
assert.ok(index.includes('data-view="studentLoan"') && index.indexOf('data-view="studentLoan"') > index.indexOf('data-view="fund"'), "student-loan navigation must follow funding under 奖惩助贷");
assert.ok(server.includes('"nnuzc_student_loan_records"'), "student-loan records must participate in demo-data detection and clearing");
for (const marker of ['data-view="recycle"', 'recycle:"回收站"', "PAGES.recycle", "recycleMoveRecords", "recycleMoveStudentArchives", "recycleRestoreEntry", "recyclePurgeEntry", "recycleRestoreSelected", "recyclePurgeSelected", "recycleEmptyAll", "recycleUndoNotice"]) assert.ok((index+"\n"+app).includes(marker), `recycle-bin client marker is missing: ${marker}`);
for (const marker of ["CREATE TABLE IF NOT EXISTS recycle_bin", "CREATE TABLE IF NOT EXISTS recycle_bin_audit", "CREATE TABLE IF NOT EXISTS recycle_bin_requests", "RECYCLE_RETENTION_DAYS = 90", "STUDENT_ARCHIVE_ARRAYS", "STUDENT_ARCHIVE_TERM_STORES", "STUDENT_ARCHIVE_STATE_STORES", "STUDENT_ARCHIVE_PATCH_STORES", "CHECK_CLASS_STUDENT_FIELDS", "student-archive-v2", "nnuzc_other_violation_records", "nnuzc_achievement_records", "nnuzc_award_statistics_records", "nnuzc_certificate_records", "nnuzc_class_officer_assessment_terms", "nnuzc_dorm_spatial_v1", "nnuzc_checkclass", "nnuzc_student_org_v1", "student_archive", "/api/recycle-bin/delete-preview", "/api/recycle-bin/move", "/api/recycle-bin/student-delete-preview", "/api/recycle-bin/student-move", "/restore-preview", "/restore-batch-preview", "/restore-batch", "/purge-batch-preview", "/purge-batch", "attachmentMaintenanceState"]) assert.ok(`${server}\n${databaseSchema}`.includes(marker), `recycle-bin server marker is missing: ${marker}`);
for (const marker of ['recycleMoveRecords("punishment","punishment_record"', 'recycleMoveRecords("studentLoan","student_loan_record"', 'recycleMoveRecords("talks","talk_record"', 'recycleMoveRecords("home","home_contact"', 'recycleMoveRecords("events","event_record"', 'recycleMoveRecords("checkDorm","dorm_inspection_record"', 'recycleMoveRecords("help","help_record"', 'recycleMoveRecords("meeting","meeting_record"']) assert.ok(app.includes(marker), `pilot delete action does not use the recycle bin: ${marker}`);
assert.ok(app.includes("const moved=await recycleMoveStudentArchives(uniq)"), "student delete action must use whole-archive recycle move");
assert.ok(!app.includes("const removedStudents=students.filter"), "obsolete destructive student deletion remains");
assert.ok(app.includes("dormSpatialReloadState") && dormSpatialModule.includes("window.dormSpatialReloadState=reloadState"), "student archive snapshots must refresh the live dorm-spatial state");
assert.ok(app.includes('qfMulti("terms",[{v:"",l:"全部学期"}]'), "punishment term filter must show the Chinese all-terms label");
for (const marker of ['standardMulti("terms",[{v:"",l:"全部学期"}]', 'terms:readMulti("terms")', 'selected.length+" 个学期"']) {
  assert.ok(otherViolationModule.includes(marker), `other-violation multi-term marker is missing: ${marker}`);
}
for (const marker of ['function beijingLocaleDate(value)', 'function beijingLocaleDateTime(value)']) {
  const line = app.split(/\r?\n/).find((sourceLine) => sourceLine.includes(marker)) || "";
  assert.ok(line.includes('value==null?Date.now():value'), `${marker} must default an omitted value to the current time`);
}
for (const marker of ["certMeta(this,\\'name\\')", "同名学生将弹出候选信息供人工选择", "resolveStudentNameInput(element.value,apply,\"证书识别\")"]) assert.ok(achievementEnhancements.includes(marker), `certificate name matching marker is missing: ${marker}`);

const ids = [...index.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
assert.deepStrictEqual([...new Set(ids.filter((id, indexAt) => ids.indexOf(id) !== indexAt))], [], "index.html contains duplicate IDs");

const viewBlock = (app.match(/const VIEWS\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || "";
const views = new Set([...viewBlock.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((match) => match[1]));
const navViews = new Set([...index.matchAll(/\bdata-view=["']([^"']+)["']/gi)].map((match) => match[1]));
const chaoxingModule = fs.readFileSync(path.join(root, "chaoxing-attendance-module.js"), "utf8");
const clientSources = app + "\n" + awardStatisticsModule + "\n" + dormRosterModule + "\n" + customRosterModule + "\n" + counselorGrowthModule + "\n" + chaoxingModule;
const pageAssignments = new Set([...clientSources.matchAll(/PAGES\.([A-Za-z_$][\w$]*)\s*=/g)].map((match) => match[1]));
const registeredViews = new Set([...clientSources.matchAll(/xcmRegister\(\{view:"([^"]+)"/g)].map((match) => match[1]));
for (const view of navViews) {
  assert.ok(views.has(view), `navigation target ${view} is missing from VIEWS`);
  assert.ok(pageAssignments.has(view) || registeredViews.has(view), `navigation target ${view} is missing a PAGES renderer`);
}
assert.ok(views.size > 0, "VIEWS is empty");
assert.ok(navViews.size > 0, "visible navigation is empty");
for (const marker of ["RETIRED_NAV_GROUP_STATE_KEY", "initNavGroups", "setNavGroupCollapsed", "expandNavGroupForItem", "nav-group-fold-hidden"]) {
  assert.ok((app + "\n" + index).includes(marker), `navigation group folding marker is missing: ${marker}`);
}
assert.ok(index.includes(".nav-group.collapsed::after"), "navigation group folding indicator is missing");
for (const marker of [".nav-group{font-size:14px;font-weight:650;line-height:1.45", "letter-spacing:normal", ".nav-item{display:flex;align-items:center;gap:10px;padding:8px 11px", "font-size:14px;font-weight:650;line-height:1.45", ".nav-sub-item{display:flex;align-items:center;gap:9px", "font-size:13.5px;font-weight:600;line-height:1.45"]) assert.ok(index.includes(marker), `navigation typography marker is missing: ${marker}`);
assert.ok(app.includes('NAV_DRAWER_STATE_KEY="xc_nav_drawer_closed"') && app.includes("let desktopClosed=false"), "desktop navigation drawer should remain visible by default");
assert.ok(app.includes('RETIRED_NAV_GROUP_STATE_KEY="xc_nav_groups_collapsed_v2"') && app.includes("localStorage.removeItem(RETIRED_NAV_GROUP_STATE_KEY)") && app.includes("setNavGroupCollapsed(group,true)"), "first-level navigation groups must default to collapsed after entry or refresh");
assert.ok(fs.readFileSync(path.join(root,"scripts","build-update-package.ps1"),"utf8").includes("validate-academic-warning-template.ps1"), "update package must include the academic-warning Word template validator");

const definitions = new Set();
for (const match of app.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) definitions.add(match[1]);
for (const match of app.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g)) definitions.add(match[1]);
for (const match of (app+"\n"+dormSpatialModule).matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) definitions.add(match[1]);
assert.ok(index.includes('src="/chaoxing-attendance-module.js"'), "learning-platform module must load in the application");
for (const match of chaoxingModule.matchAll(/\broot\.([A-Za-z_$][\w$]*)\s*=/g)) definitions.add(match[1]);
const allowedInline = new Set(["alert", "confirm", "prompt", "setTimeout", "clearTimeout", "getElementById", "querySelectorAll", "preventDefault", "if"]);
const missingHandlers = new Set();
for (const match of app.matchAll(/\bon(?:click|change|input|keyup|keydown|blur|focus|submit)\s*=\s*["']([^"']*)["']/gi)) {
  for (const call of match[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (!definitions.has(call[1]) && !allowedInline.has(call[1])) missingHandlers.add(call[1]);
}
assert.deepStrictEqual([...missingHandlers], [], "inline handlers reference undefined functions");

for (const required of [
  "aiNoticeConvert", "academicWarningExactFetch", "academicWarningLoadExactPreview",
  "employmentIntent", "employmentResource", "subjectCompetitionOpenForm", "subjectCompetitionImport", "科创竞赛导入模板", "SUBJECT_COMPETITION_CATALOG_TITLES", "SUBJECT_COMPETITION_CATALOG_URLS", "SUBJECT_COMPETITION_WEBSITE_VERSION", "SUBJECT_COMPETITION_SUPPLEMENT_VERSION", "全国大学生职业规划大赛", "academicWarningBatchPacketDownload",
  "aiIgnoreMaterial", "setNavDrawerOpen", "punishRowHTML",
  "findPunishmentById", "punishIdKey", "aiPreviewRedaction", "AI_FEATURE_META", "data-ai-feature",
  "desktopLegacyBackupScan", "desktopLegacyBackupPurge", "输入总字数",
  "employmentTrackingLinkedInfoHtml", "employmentTrackingSetGraduateYear", "employmentIntentionSetGraduateYear", "employmentSyncOverview", "毕业生名单",
  "employmentTrackingRoster", "employmentTrackingOpenContact", "employmentTrackingInitialize", "employmentTrackingDept", "employmentTrackingClass", "清空选中", "线上具体工具", "线下谈话地点", "就业跟踪台账",
  "FUND_POOR_LEVELS", "FUND_DATA_HEADERS", "未评定等级", "fundRecordForStudentTerm", "fundLatestRecordForStudent", "syncFundProfileSnapshot", "fundExportCurrent", "fundExportTerm", "fundExportAll", "导出当前筛选", "导出全部学期",
  "portraitArchivePdfBlob", "portraitArchiveZipBlob", "outputPdf", "生成结果不是有效的 PDF 文件"
]) assert.ok(app.includes(required), `required feature marker is missing: ${required}`);
assert.ok(!app.includes("const id=Number(p.id);"), "punishment action IDs must not be coerced to Number");
assert.ok(app.includes('data-punish-action="view"'), "punishment actions must use data attributes instead of inline IDs");
for (const removed of ["academicWarningWordBytes", "academicWarningBuildPdf", "academicWarningPacketBytes"]) assert.ok(!app.includes(removed), `obsolete generator remains: ${removed}`);

for (const route of ["/api/auth/migrate-legacy-password", "/api/store", "/api/store/batch", "/api/store/clear-local-business-data", "/api/backups", "/api/backups/legacy-report", "/api/backups/legacy-purge", "/api/webdav/status", "/api/webdav/config", "/api/webdav/backup", "/api/webdav/restore", "/api/branding", "/assets/branding-logo", "/api/attachments", "/api/academic-warning/render", "/api/academic-warning/batch", "/api/academic-analysis/run", "/api/ai/redaction-preview"]) assert.ok(server.includes(route), `server route is missing: ${route}`);
for (const route of ["/api/license/status", "/api/license/activate", "/api/license/refresh", "/api/license/deactivate"]) assert.ok(server.includes(route), `license route is missing: ${route}`);
assert.ok(server.includes("LICENSE_RETIRED"), "retired license marker is missing");
assert.ok(server.includes("激活码授权已停用"), "license retirement log/message is missing");
assert.ok(!server.includes("forceEnabled: true"), "forced license enablement must be removed");
assert.ok(!server.includes('require("./license-client")'), "license-client must not be required by web-server");
for (const marker of ["MachineGuid", "offlineUntil", "crypto.verify", "license-state.json", "授权服务器必须使用 HTTPS"]) assert.ok(licenseClient.includes(marker), `legacy license-client marker is missing: ${marker}`);
for (const marker of ["clearLocalBusinessData", "清空本地全部数据", "clearAllLocalData"]) assert.ok(`${server}\n${app}`.includes(marker), `local clear marker is missing: ${marker}`);
for (const marker of ["webdavCredentialsCleared", "webdavEndpointRetained", "endpointRetained"]) assert.ok(server.includes(marker), `local clear WebDAV marker is missing: ${marker}`);
for (const marker of ["AI_FEATURE_KEYS", "consumeAiQuota", "dailyRequestLimit", "dailyInputLimit"]) assert.ok(server.includes(marker), `AI configuration marker is missing: ${marker}`);
for (const marker of ["workRecord", "taskAssist", "ledgerInsight", "certificateAiSchema", "validateCertificateAiResult", "CREATE TABLE IF NOT EXISTS ai_usage", "/api/ai/usage", "inputPricePerMillion", "economyModel", "visionModel"]) assert.ok(`${server}\n${databaseSchema}\n${app}`.includes(marker), `AI governance marker is missing: ${marker}`);
for (const marker of ["isClashFakeIp", "hasClashFakeIpInterface", "clash-fake-ip", "Clash/TUN 兼容"]) assert.ok(`${server}\n${app}`.includes(marker), `AI proxy compatibility marker is missing: ${marker}`);
for (const marker of ["anthropic-version", 'provider === "anthropic"', 'value="openai"', 'value="anthropic"', "AI_PROVIDER_DEFAULTS", "claude-sonnet-5", "qwen3.7-plus"]) {
  assert.ok(server.includes(marker) || app.includes(marker), `recommended AI provider marker is missing: ${marker}`);
}
for (const removed of ["推荐服务商", "aiProviderCardsHtml", "aiQuickProvider", "ai-provider-card", "ai-provider-quick"]) assert.ok(!app.includes(removed), `removed provider card code remains: ${removed}`);
for (const marker of ["HttpOnly", "SameSite=Strict", "timingSafeEqual", "isLocalRequest", "requestOriginAllowed"]) assert.ok(server.includes(marker), `security marker is missing: ${marker}`);
for (const marker of ["webdav_secret", "encryptText(JSON.stringify(config))", "WEBDAV_BUNDLE_MAGIC", "syncPassword"]) assert.ok(server.includes(marker), `WebDAV security marker is missing: ${marker}`);
for (const marker of ["MOBILE_SYNC_FILENAME", "MOBILE_SYNC_FORMAT", "MOBILE_SYNC_MAX_BYTES", "mobileSyncProjection", "createMobileSyncEnvelope", "uploadMobileSyncSnapshot"]) assert.ok(server.includes(marker), `Android companion sync marker is missing: ${marker}`);

const templatePath = path.join(root, "assets", "academic-warning-template.doc");
const templateHash = crypto.createHash("sha256").update(fs.readFileSync(templatePath)).digest("hex");
assert.strictEqual(templateHash, "c70d5a3fa6b9b25bfd2fdc04a56bb0797bd53d1a56c7958ea15a4a06d28c63fa", "academic-warning template changed");
assert.ok(index.includes('rel="icon"'), "main page favicon is missing");
assert.ok(login.includes('rel="icon"'), "login page favicon is missing");
for (const marker of ["数智学工", "让学生工作", "serviceState", "entryModes", "cloudPanel", "同步加密密码"]) {
  assert.ok(login.includes(marker), `login redesign marker is missing: ${marker}`);
}
for (const marker of ['data-view="license"', "licenseTrialBanner", "关于本软件"]) assert.ok(index.includes(marker), `in-workbench about UI marker is missing: ${marker}`);
assert.ok(!index.includes("立即激活"), "activation banner CTA must be removed");
for (const marker of ["PAGES.license", "license-locked-action", "licenseIsReadOnly", "人工确认后分发安装包"]) assert.ok(app.includes(marker), `manual-authorization about module marker is missing: ${marker}`);
assert.ok(!app.includes("licenseActivateDevice"), "activation UI handlers must be removed");
assert.ok(!app.includes("showActivationWelcome"), "activation welcome flow must be removed");
for (const marker of ["licenseAllowsOperations", "LICENSE_RETIRED", "const initialStore = readStore()", "required: false, valid: true, state: \"disabled\""]) assert.ok(server.includes(marker), `license retirement marker is missing: ${marker}`);
assert.ok(!server.includes("LICENSE_LOCKED"), "LICENSE_LOCKED gate must be removed from web-server");
for (const marker of ["id=\"backupPage\"", "#licensePage,#backupPage", "licenseBackupExport"]) assert.ok(app.includes(marker), `read-only backup UI exemption marker is missing: ${marker}`);
for (const marker of ["微信 shuzhixuegong1", "https://xhslink.cn/o/9rULwc6NN0T", "关于本软件", "小红书购买地址", "系统下载和更新地址", "https://pan.baidu.com/s/1mt5BcuH0NaR-gSyrP_XMcw?pwd=1118", "提取码：1118"]) assert.ok(app.includes(marker), `about/purchase marker is missing: ${marker}`);
for (const marker of ["https://dav.jianguoyun.com/dav/", "BV1xf4y187Cy", "坚果云官方获取授权码视频教程"]) {
  assert.ok(login.includes(marker), `login WebDAV guidance marker is missing: ${marker}`);
  assert.ok(app.includes(marker), `backup-page WebDAV guidance marker is missing: ${marker}`);
}
assert.ok(login.includes("@media(max-width:760px)"), "login page mobile layout is missing");
assert.ok(login.includes("数智学工"), "login page product name is missing");
for (const marker of ["PAGES.brandSettings", "品牌设置", "brandingSave", "brandingRestoreDefault", "sidebarLogoData", "loginLogoData", "sidebarLogoUrl", "loginLogoUrl", "BRANDING_STORE_KEY", "brandingPublicConfig", "brandedPwaManifest"]) assert.ok(`${app}\n${server}`.includes(marker), `branding settings marker is missing: ${marker}`);
assert.ok(index.includes('data-view="brandSettings"'), "branding settings navigation is missing");
assert.ok(!index.includes('data-view="audit"'), "operation log navigation must be removed");
for (const marker of ["sideBrandName", "sideBrandLogo"]) assert.ok(`${index}\n${app}`.includes(marker), `sidebar branding sync marker is missing: ${marker}`);
for (const marker of ["desktopWebdavRender", "desktopWebdavBackup", "WebDAV 私有云"]) assert.ok(app.includes(marker), `WebDAV backup-page marker is missing: ${marker}`);
for (const marker of ["PAGES.semester", "学期设置", "TERM_SETTINGS_KEY", "开始时间", "预计结束时间", "总教学周数", "termEndDate", "currentSemesterWeek", "当前周次", "setSemesterAsCurrent"]) assert.ok(app.includes(marker), `semester-settings marker is missing: ${marker}`);
for (const marker of ["PAGES.courseTimetable", "独立周视图 · 与课堂管理课表实时同步", "实时在课与课堂状态", "班级全程课程表周视图", "courseTimetableOpenForm", "courseTimetableToggleCell", "courseTimetableTone", "还有 ", "门课程，展开查看", "bounds.start>=start", "courseTimetableImport", "courseTimetableAiImport", "courseTimetablePdfImport", "courseTimetableTemplate", "AI 智能识别课表", "识别 PDF 课表", "课表模板", "courseTimetableOpenSettings", "courseTimetableAddPeriod", "courseTimetableRemovePeriod", "校历数据已与“学期设置”同步", "courseTimetableClearClass", "courseTimetableApplyFilters", "qfMulti(\"ctTerm\"", "qfMulti(\"ctDept\"", "qfMulti(\"ctMajor\"", "qfMulti(\"ctGrade\"", "qfMulti(\"ctClass\"", "导出当前课表"]) assert.ok(app.includes(marker), `visual timetable marker is missing: ${marker}`);
assert.ok(!app.includes('id="ctSettingStart"') && !app.includes('id="ctSettingWeeks"'), "duplicate timetable calendar editors remain");
assert.ok(!app.includes('>📋 课堂考勤打卡</button>'), "the removed timetable toolbar attendance button remains");
for (const marker of [".ct-toolbar", ".ct-toolbar-filters", "grid-template-columns:repeat(5,minmax(0,1fr))", "height:34px", ".ct-week-field{grid-column:1/-1", ".ct-week-wrap", ".ct-toolbar-actions", ".ct-live-grid", ".ct-grid", ".ct-course", ".ct-course-title", ".ct-tone-green", ".ct-tone-purple", ".ct-cell-more", ".ct-period-heading", ".ct-period-remove"]) assert.ok(index.includes(marker), `visual timetable style is missing: ${marker}`);
for (const marker of ["开始时间、总教学周数均为非必填", "placeholder=\"非必填，如 20\"", "总教学周数应为 1 至 52 周之间的整数，或留空"]) assert.ok(app.includes(marker), `optional semester-setting marker is missing: ${marker}`);
assert.ok(!app.includes("开始时间（第 1 教学周）*") && !app.includes("总教学周数 *</label>"), "semester start date or total weeks is still marked as required");
for (const marker of ["<label>学院代码</label><input id='odCode' placeholder='非必填，如 85'", "<label>专业代码</label><input id='omCode' placeholder='非必填，如 8504'", "{key:'code', label:'学院代码', req:false", "{key:'code', label:'专业代码', req:false", "if(r.code&&deptCodes.indexOf(r.code)!==-1)", "if(r.code&&majorCodes.indexOf(r.code)!==-1)", "保留行首 Tab：学院/专业代码非必填"]) assert.ok(app.includes(marker), `optional organization-code marker is missing: ${marker}`);
assert.ok(!app.includes('请填写学院代码')&&!app.includes('请填写专业代码')&&!app.includes('学院代码为空')&&!app.includes('专业代码为空'), "college or major code is still validated as required");
assert.ok(index.includes('data-view="semester"'), "semester settings navigation is missing");
assert.ok(!index.includes('id="addTermBtn"') && !index.includes('id="deleteTermBtn"'), "term management controls must be moved out of the top bar");
for (const marker of ["classadmin", "data-roles=", "院系管理员", "班级管理员"]) {
  assert.ok(![app, index, achievementEnhancements].some((source) => source.includes(marker)), `retired role marker remains: ${marker}`);
}
for (const marker of ["checkin", "openCheckin", "nnuzc_demo_loaded", "seedDemoData", "loadDemoData"]) {
  assert.ok(![app, index].some((source) => source.includes(marker)), `retired module marker remains: ${marker}`);
}
assert.strictEqual((app.match(/\bdemoLoadData\s*\(/g) || []).length, 1, "demo data must only load from the explicitly declared button handler");
assert.ok(index.includes('onclick="demoLoadData()"'), "manual demo-load button is missing");
for (const marker of ["createAutomaticBackupIfDue", "automaticBackupCount", "workbench-auto-"]) {
  assert.ok(!server.includes(marker), `automatic local-backup marker remains: ${marker}`);
}
assert.ok(app.includes("仅在手动备份、私有云备份及云端恢复流程中生成加密快照"), "explicit-backup rule is missing from the backup page");
for (const marker of ["openMappedImportWizard", "系统字段", "Excel 列（表头）", "字段映射"]) {
  assert.ok(app.includes(marker), `unified import wizard marker is missing: ${marker}`);
}
for (const marker of ["PARTY_LEAGUE_STATUSES", "保留团员的中共党员", "退团", "政治面貌（与学生管理双向同步）", "partyLoadFormStudent", 'target.political=document.getElementById("partyPolitical").value', '["政治面貌",s.political]', "PARTY_TRAINING_CONFIG", "初级党课", "中级党课", "高级党课"]) assert.ok(app.includes(marker), `party political-status/training synchronization marker is missing: ${marker}`);
assert.ok(!app.includes('<label>当前发展阶段 *</label>') && !app.includes('<label>确定日期 *</label>') && !app.includes('请填写该发展阶段的确定日期'), "party stage or confirmation date is still required");
assert.ok(customFieldsModule.includes("political:政治面貌|leagueStatus:团员身份"), "party field management is missing political and league status system fields");
for (const marker of ["ccAbsentSearch", "absentStudentIds", "personalLeaveStudentIds", "sickLeaveStudentIds", "leaveStudentIds", "lateStudentIds", "earlyStudentIds", "sourceCheckClassId", "sourceCheckClassType", "ccSyncBehaviorRecords", "旷课名单（学号，多个用顿号分隔）", "事假名单（学号，多个用顿号分隔）", "病假名单（学号，多个用顿号分隔）", "迟到名单（学号，多个用顿号分隔）", "早退名单（学号，多个用顿号分隔）", "请假总人数（非必填）", "应到人数（非必填）", "实到人数（非必填）", "或留空", "meetingClassPickerRender", "meetingClassToggle", "classes:selectedClasses", "meetingMatchesFilter"]) {
  assert.ok(app.includes(marker), `check-class / meeting enhancement marker is missing: ${marker}`);
}
for (const marker of ["personalLeaveStudentIds", "sickLeaveStudentIds", "leaveStudentIds"]) assert.ok(server.includes(marker), `student archive check-class leave marker is missing: ${marker}`);
for (const marker of ["academicWarningOpenMappedImport", "就业意向答卷使用四步映射向导", "综测导入统一使用四步向导"]) {
  assert.ok(app.includes(marker), `newly unified import entry is missing: ${marker}`);
}
const appVersionMatch = app.match(/SYS_VER="(V\d+\.\d+\.\d+)"/);
const serverVersionMatch = server.match(/APP_VERSION = "(V\d+\.\d+\.\d+)"/);
assert.ok(appVersionMatch && serverVersionMatch, "front-end or server version marker is missing");
assert.strictEqual(appVersionMatch[1], serverVersionMatch[1], "front-end and server versions are inconsistent");
for (const marker of ["PAGES.update", "系统更新", "systemUpdateCheck", "如需备份当前数据，请先手动创建本机备份", "人工分发", "SHA-256"]) assert.ok(app.includes(marker) || server.includes(marker), `system update marker is missing: ${marker}`);
for (const route of ["/api/updates/status", "/api/updates/check", "/api/updates/download", "/api/updates/install"]) assert.ok(server.includes(route), `system update route is missing: ${route}`);
for (const marker of ["UpdateClient", "requestAuthorized", "sha256", "downloadExpiresAt", "update-state.json", "在线更新已随激活码授权一并停用"]) assert.ok(`${updateClient}\n${licenseClient}`.includes(marker), `system update client security marker is missing: ${marker}`);
assert.ok(!server.includes('CREATE TABLE IF NOT EXISTS web_upgrade_'), "legacy system upgrade database tables must not return");
assert.ok(server.includes('X-Workbench-Session') && server.includes('"invalid"'), "invalid-session response marker is missing");
for (const retired of ["SESSION_IDLE_MS", "SESSION_ABSOLUTE_MS", "WORKBENCH_SESSION_MINUTES", "WORKBENCH_SESSION_HOURS"]) assert.ok(!server.includes(retired), `session timeout remnant remains: ${retired}`);
assert.ok(!app.includes("session.expiresAt") && server.includes("sessionPersistent: true"), "workbench sessions must not expire by idle or absolute duration");
assert.ok(server.includes("portable-data-key.json"), "portable data key support is missing");
assert.ok(!server.includes("automatic-backup-state.json") && !server.includes("rememberAutomaticBackupCycle"), "automatic-backup scheduling remnants remain");
assert.ok(server.includes("ensureLocalSession") && server.includes('url.pathname === "/login.html"'), "direct workbench entry support is missing");
assert.ok(!index.includes("changeLocalPassword()") && !index.includes("logoutLocal()"), "password and logout controls must not remain visible");
for (const retired of [
  "function maskPhone(", "function maskIdCard(", "function maskPersonName(", "function maskAddress(",
  "function addTerm(", "function openTermInputModal(", "function openAddTerm(", "function deleteTerm(", "function openDeleteTerm(",
  "function confirmTermChange(", "function onViewTerm(", "function qfSel(", "function saveModuleTabsState(",
  "function academicWarningRowAdd(", "function academicWarningRowSave(", "function academicRowAdd(", "function academicRowSave(",
  "function studentDetail(", "function closeModal_xwide_cleanup(", "function changeLocalPassword("
]) assert.ok(!app.includes(retired), `retired dead-code entry must not return: ${retired}`);
for (const active of ["function saveSemesterSetting(", "function openSemesterSettingForm(", "function removeSemesterSetting(", "function syncTermToModules(", "function openAcademicWarningRowForm(", "function openAcademicRowForm("]) {
  assert.ok(app.includes(active), `active replacement flow is missing after dead-code cleanup: ${active}`);
}
assert.ok(!app.includes('label:"就业意向（同步）"'), "employment tracking must not retain an employment-intention column");
for (const retired of ["BACKUP_REMINDER_KEY", "getBackupReminderConfig", "saveBackupReminderConfig", "checkBackupReminder", "setBackupReminderInterval", "renderBackupIntervalSelect", "数据安全备份提醒", "天未导出学工数据备份"]) assert.ok(!app.includes(retired), `retired backup reminder remains: ${retired}`);
assert.ok(app.includes('localStorage.removeItem("nnuzc_backup_reminder_config")'), "retired backup reminder configuration must be purged");
assert.ok(!read("学生组织管理.html").includes("backupHint"), "retired student-organization backup reminder helper remains");
assert.ok(app.includes("window.exportAllData=async function exportAllData"), "manual full-data export must remain available");
assert.ok(app.includes("就业跟踪：名单以学生管理的毕业年份为唯一来源"), "employment tracking roster must be sourced from student graduation years");
assert.ok(app.includes("const STU_EXPORT_FIELDS") && app.includes('["graduateYear","毕业年份",true]') && app.includes('["statusNote","学籍异动备注",true]') && app.includes('["statusAttachment","学籍异动单（图片）",true,function') && !app.includes('["customFields","自定义字段"'), "student export fields must include current fields but exclude retired custom fields");
assert.ok(app.includes(".stu-export-field:checked") && app.includes("STU_EXPORT_FIELDS.filter") && app.includes('downloadXlsxFile("学生信息",[cols.map(c=>c[1]),...rows]'), "student export must use the selected export fields and labels");
assert.ok(app.includes("const MAINT_EXPORTS") && app.includes("function maintExport(kind)"), "basic-data export configuration is missing");
for (const kind of ["dept", "major", "class", "grade", "dorminfo"]) assert.ok(app.includes(`maintExport('${kind}')`), `basic-data export entry is missing for ${kind}`);
const dormAutoFillSource = (app.match(/function dormAddAutoFill\(\)\{([\s\S]*?)\n\}/) || [])[1] || "";
const dormAddSource = (app.match(/window\.dormAdd=function\(\)\{([\s\S]*?)\n\};/) || [])[1] || "";
assert.ok(app.includes('id="daMajor" readonly'), "dorm allocation must show the matched student's major as read-only identity data");
assert.ok(dormAutoFillSource.includes('majorEl.value=s.major||""'), "new dorm allocation must auto-fill a matched student's major");
assert.ok(!dormAddSource.includes('major:document.getElementById("daMajor").value'), "dorm allocation must not write student identity fields");
assert.ok(app.includes('clsStudents().filter(isOnCampusStudent).map(dormDistributionRow)'), "dorm management roster must derive from in-school students");
for (const marker of ["function ensureDormMasterData(zone,building)","reconcileDormMasterData();","syncDormBuildingZone(building,z)",'["学号","姓名","住宿情况","区位","宿舍楼","房间号","床位号"]','"区位","宿舍楼","房间号","床位号"']) assert.ok(app.includes(marker), `dorm/base-data synchronization marker is missing: ${marker}`);
assert.ok(customFieldsModule.includes("zone:区位|building:宿舍楼|room:房间号|bed:床位号"), "dorm field management labels are inconsistent with dorm/base-data fields");
assert.ok(app.includes('请先在学生管理新增该学生') && app.includes('该学生当前不是在校生，不能录入住宿信息'), "dorm allocation must reject missing and non-campus students");
assert.ok(dormAddSource.includes('idEl.addEventListener("blur",dormAddAutoFill)'), "new dorm allocation must bind student matching when the dialog opens");
assert.ok(!dormAddSource.includes('setTimeout(function(){\n    const idEl'), "new dorm allocation must not delay binding the student matching event");
const portraitArchiveSource = (app.match(/function portraitArchiveHTML\(s\)\{([\s\S]*?)\n\}/) || [])[1] || "";
const portraitSectionOrder = ["一、基本信息", "二、学籍信息", "三、联系方式", "四、宿舍信息", "五、心理与党团", "六、课堂考勤与违纪记录", "七、学业情况（个人版）与学业预警（个人版）", "八、谈心谈话 / 家校联系 / 特殊事件", "九、处分记录", "十、评奖评优", "十一、毕业生就业", "十二、重点关爱"];
assert.ok(!portraitArchiveSource.includes("工作记录（查课 / 查寝 / 帮扶）"), "student archive must omit the work records section");
assert.ok(!portraitArchiveSource.includes("班会与活动"), "student archive must omit meetings and activities");
let previousSectionIndex = -1;
for (const section of portraitSectionOrder) {
  const sectionIndex = portraitArchiveSource.indexOf(`portraitArchiveSection("${section}"`);
  assert.ok(sectionIndex > previousSectionIndex, `student portrait section order is missing or incorrect: ${section}`);
  previousSectionIndex = sectionIndex;
}
for (const field of ["当前班级干部任职", "历史班级干部任职", "学制", "学籍异动单", "微信号", "紧急联系人电话", "住宿情况", "楼栋", "房间号", "床位号"]) assert.ok(portraitArchiveSource.includes(`"${field}"`), `student portrait must include ${field}`);
for (const retired of ["stuGetCustomFields", "stuCustomFieldRowHtml", "stuReadCustomFields", "stuValidateCustomFields", "customFieldsDetailHtml('student'"]) assert.ok(!app.includes(retired), `retired student custom-field marker remains: ${retired}`);
assert.ok(!dormRosterModule.includes("studentCustom:") && !dormRosterModule.includes("hasStudentCustomField"), "dorm roster still exposes retired student custom fields");
assert.ok(customFieldsModule.includes('student:{name:"学生管理",rows:()=>students,save:()=>persistStudents()}') && customFieldsModule.includes('const definitions={student:()=>STU_IMPORT_FIELDS'), "student management field-management registry or system-field definitions are missing");
assert.ok(!customFieldsModule.includes("purgeRetiredStudentSchema") && !app.includes("delete s.customFieldValues") && !server.includes("delete student.customFieldValues") && !server.includes("delete row.customFieldValues") && !server.includes("delete definitions.student"), "student field-management schema or values are still being purged");
assert.ok(customFieldsModule.includes("customFieldsStudentPortraitHtml") && customFieldsModule.includes("recordMatchesStudent") && app.includes('window.customFieldsStudentPortraitHtml(s)'), "linked custom fields must be included in student portraits and archive exports");
assert.ok(customFieldsModule.includes("customFieldsFormHtml") && customFieldsModule.includes("customFieldsReadForm") && customFieldsModule.includes('registry[view].name+" · 自定义字段"') && app.includes('window.customFieldsDetailHtml("student",s)') && app.includes('window.customFieldsFormHtml("student",s)') && app.includes('window.customFieldsReadForm("student",s)'), "native add/edit/detail flows must use module-specific managed custom-field headings");
assert.ok(customFieldsModule.includes("installNativeModalBridge") && customFieldsModule.includes("nativeContext") && customFieldsModule.includes("beforeIds") && customFieldsModule.includes("业务信息与扩展字段已同步保存"), "registered modules must share the native add/edit/detail custom-field bridge");
assert.ok(customFieldsModule.includes('const RETAINED_VIEWS=new Set(["student","classOfficer","dorm","counselorGrowth"])') && customFieldsModule.includes("purgeRemovedFieldManagement"), "field management must be limited to student information management and personal development, with retired data cleanup");
assert.ok(!app.includes("customFieldsFormHtml(\"academicWarning\"") && !app.includes("customFieldsFormHtml(\"academicGrade\"") && !app.includes("customFieldsDetailHtml('punishment'") && !achievementEnhancements.includes('customFieldsDetailHtml("achievement"'), "removed modules still contain native custom-field integration");
assert.ok(counselorGrowthModule.includes('customFieldsDetailHtml("counselorGrowth",r)'), "personal-development drawer must retain managed custom fields");
assert.ok(customFieldsModule.includes('class="btn btn-ghost btn-sm cf-delete"') && customFieldsModule.includes("removedIds") && customFieldsModule.includes("全部记录中的该字段历史值") && customFieldsModule.includes("已删除 "), "all custom-field settings must expose confirmed deletion and purge stored values");
assert.ok(windowsLauncher.includes("数智学工数据\\scripts\\start-workbench.ps1") && windowsLauncher.includes("WindowStyle Hidden"), "single Windows entry must start the internal launcher invisibly");
assert.ok(windowsStopLauncher.includes("数智学工数据\\scripts\\stop-workbench.ps1") && windowsStopLauncher.includes("wshShell.Run"), "Windows stop launcher must invoke the internal stop script");
assert.ok(windowsStart.includes("Split-Path -Parent $PSScriptRoot") && windowsStart.includes("api/health"), "internal Windows start script must resolve the project root and check service health");
assert.ok(windowsStop.includes("Split-Path -Parent $PSScriptRoot") && windowsStop.includes("web-server.js"), "internal Windows stop script must resolve the project root and only stop this service");

console.log(`qa-static: passed (${views.size} views, ${navViews.size} navigation entries)`);
