"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "shuzhi-import-qa-"));
const port = Number(process.env.XIANGCAI_IMPORT_QA_PORT || 18874);
const origin = `http://127.0.0.1:${port}`;
let browser, child, activePage;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function playwright() {
  const paths = [process.env.PLAYWRIGHT_MODULE, process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, "playwright"), path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright")].filter(Boolean);
  const found = paths.find(fs.existsSync); if (!found) throw new Error("Playwright is unavailable"); return require(found);
}
function edge() {
  const paths = [process.env.EDGE_PATH, process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"), process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")].filter(Boolean);
  const found = paths.find(fs.existsSync); if (!found) throw new Error("Microsoft Edge is unavailable"); return found;
}
async function ready() { for (let i = 0; i < 100; i++) { try { const response=await fetch(`${origin}/api/health`),health=await response.json();if(response.ok&&health.service==="xiangcai-workbench"&&health.pid===child?.pid)return; } catch (_) {} if(child&&child.exitCode!==null)throw new Error("isolated import server exited before startup");await sleep(100); } throw new Error("import QA server did not start"); }
async function store(cookie, key, value) { const r = await fetch(`${origin}/api/store/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin }, body: JSON.stringify({ value: JSON.stringify(value) }) }); const detail=r.status===200?"":`：${await r.text()}`;assert.strictEqual(r.status, 200, `seed ${key}${detail}`); }
function csv(name, headers, row) { const quote = (value) => `"${String(value == null ? "" : value).replace(/"/g, '""')}"`; const rows = Array.isArray(row[0]) ? row : [row]; const file = path.join(temp, name); fs.writeFileSync(file, `${headers.map(quote).join(",")}\r\n${rows.map((record) => record.map(quote).join(",")).join("\r\n")}\r\n`, "utf8"); return file; }
function png(name) { const file = path.join(temp, name); fs.writeFileSync(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ+QAAAABJRU5ErkJggg==", "base64")); return file; }
async function wizard(page, opener, file, expected, confirmPattern) {
  console.log('[import wizard]',path.basename(file));
  await page.evaluate(()=>{if(!window.__qaImportToastCapture){window.__qaImportToastCapture=true;const original=showToast;window.__qaImportToasts=[];window.showToast=function(message,type){window.__qaImportToasts.push(String(message));return original(message,type);};}window.__qaImportToasts=[];});
  await page.evaluate(opener); await page.waitForTimeout(30);
  assert.match(await page.locator("#modalBody").innerText(), /选择导入文件/);
  await page.locator("#mappedImportFile").setInputFiles(file);
  try{await page.getByRole("button", { name: /下一步/ }).click();}
  catch(error){console.error('Wizard failure',path.basename(file),await page.evaluate(()=>({title:document.getElementById('modalTitle')?.textContent,body:document.getElementById('modalBody')?.textContent.slice(0,350),footer:document.getElementById('modalFoot')?.textContent,open:document.getElementById('mask')?.className})));throw error;}
  await page.getByRole("button", { name: /下一步/ }).click();
  assert.match(await page.locator("#modalBody").innerText(), /系统字段[\s\S]*Excel 列（表头）/);
  await page.getByRole("button", { name: /校验数据/ }).click(); await page.waitForTimeout(40);
  if (await page.locator("#studentLinkImportLayer").count()) {
    assert.match(await page.locator("#studentLinkImportLayer").innerText(), /学生信息关联确认[\s\S]*学生管理/);
    await page.locator("#studentLinkImportConfirm").click();
  }
  assert.match(await page.locator("#modalBody").innerText(), /可导入/);
  let confirmation=null;
  if(confirmPattern)confirmation=new Promise((resolve,reject)=>page.once("dialog",async(dialog)=>{try{const info={type:dialog.type(),message:dialog.message()};await dialog.accept();resolve(info);}catch(error){reject(error);}}));
  await page.getByRole("button", { name: /确认导入/ }).click();
  if(confirmation){const info=await confirmation;assert.strictEqual(info.type,"confirm","dorm resource auto-add must use a confirmation dialog");assert.match(info.message,confirmPattern,"dorm resource auto-add confirmation copy is incorrect");}
  try{await page.waitForFunction(() => /导入完成/.test((document.getElementById("modalBody")||{}).innerText||""), null, { timeout: 5000 });}
  catch(error){console.error('Wizard completion failure',path.basename(file),await page.evaluate(()=>({title:document.getElementById('modalTitle')?.textContent,body:document.getElementById('modalBody')?.textContent.slice(0,500),footer:document.getElementById('modalFoot')?.textContent,committing:window.__mappedImportState?.committing,step:window.__mappedImportState?.step,toasts:window.__qaImportToasts})));throw error;}
  assert.strictEqual(await page.evaluate(expected), true, "mapped import did not persist expected record");await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('mask').classList.contains('show'));
}
async function mappedWizard(page, opener, file, mapping, expected, confirmPattern) {
  await page.evaluate(opener); await page.waitForTimeout(30);
  await page.locator("#mappedImportFile").setInputFiles(file);
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  for (const [systemField, excelHeader] of Object.entries(mapping)) {
    const row = page.locator(".import-field-table tbody tr").filter({ has: page.locator(`input[value="${systemField}"]`) });
    await row.locator("select").selectOption(excelHeader);
  }
  await page.getByRole("button", { name: /校验数据/ }).click(); await page.waitForTimeout(60);
  if (await page.locator("#studentLinkImportLayer").count()) await page.locator("#studentLinkImportConfirm").click();
  let confirmation=null;
  if(confirmPattern)confirmation=new Promise((resolve,reject)=>page.once("dialog",async(dialog)=>{try{const info={type:dialog.type(),message:dialog.message()};await dialog.accept();resolve(info);}catch(error){reject(error);}}));
  await page.getByRole("button", { name: /确认导入/ }).click();
  if(confirmation){const info=await confirmation;assert.strictEqual(info.type,"confirm","dorm resource auto-add must use a confirmation dialog");assert.match(info.message,confirmPattern,"dorm resource auto-add confirmation copy is incorrect");}
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(expected), true, `generic manual mapping import failed: ${(await page.locator("#modalBody").innerText()).slice(0, 1000)}`);
  await page.evaluate(() => closeModal());
}
async function studentMappedWizard(page, file, mapping, expected) {
  await page.evaluate(() => stuImport());
  await page.locator("#stuImportFile").setInputFiles(file);
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  for (const [systemField, excelHeader] of Object.entries(mapping)) {
    const row = page.locator(".import-field-table tbody tr").filter({ has: page.locator(`input[value="${systemField}"]`) });
    await row.locator("select").selectOption(excelHeader);
  }
  await page.getByRole("button", { name: /校验数据/ }).click();
  await page.waitForTimeout(500);
  await page.locator("#stuImpGoBtn").click();
  await page.waitForFunction(()=>window.__studentImportState?.imported===true);
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(expected), true, `student manual mapping import failed: ${(await page.locator("#modalBody").innerText()).slice(0, 1000)}`);
  await page.evaluate(() => closeModal());
}
async function verifyStudentExamNo(page) {
  await studentMappedWizard(page,csv("student-exam-number.csv",["学号","姓名","班级","学籍状态","考生编号"],["QAEXAM","考生号验收","测试班","在校","00260101010001"]),{"考生号":"考生编号"},()=>students.some(s=>s.id==="QAEXAM"&&s.examNo==="00260101010001"));
  await page.evaluate(()=>stuEdit("QAEXAM"));
  assert.strictEqual(await page.locator("#fExamNo").inputValue(),"00260101010001");
  assert.strictEqual(await page.evaluate(()=>{const ids=Array.from(document.querySelectorAll("#modalBody input,#modalBody select")).map(el=>el.id);return ids.indexOf("fIdcard")<ids.indexOf("fExamNo")&&ids.indexOf("fExamNo")<ids.indexOf("fPol");}),true,"candidate number must be between ID card and political status");
  await page.locator("#fExamNo").fill("00260101010002");
  await page.locator("#modalOk").click();
  await page.waitForFunction(()=>students.find(s=>s.id==="QAEXAM").examNo==="00260101010002");
  await page.evaluate(()=>window.workbench.legacy.flushStore());
  await page.reload({waitUntil:"networkidle"});
  const details=await page.evaluate(()=>{const s=students.find(s=>s.id==="QAEXAM");return {examNo:s.examNo,detail:stuDetailHTML(s,false),portrait:portraitArchiveHTML(s),registered:window.__CUSTOM_FIELDS__.systemDefinitions("student").some(f=>f.key==="examNo"&&f.label==="考生号")};});
  assert.strictEqual(details.examNo,"00260101010002","candidate number must survive refresh with leading zeroes");
  assert.match(details.detail,/身份证号[\s\S]*考生号[\s\S]*00260101010002[\s\S]*政治面貌/);
  assert.match(details.portrait,/考生号[\s\S]*00260101010002/);
  assert.strictEqual(details.registered,true,"candidate number must be registered as a system field");
  const downloadPromise=page.waitForEvent("download");
  await page.evaluate(()=>{goto("student");stuReset();stuExport();stuExportDo();});
  const download=await downloadPromise;
  const exportRows=await page.evaluate(async bytes=>parseWorkbookToRows(new File([new Uint8Array(bytes)],"student-export.xlsx"),STU_EXPORT_FIELDS.map(field=>field[1])),Array.from(fs.readFileSync(await download.path())));
  const examExport=exportRows.find(row=>row["学号"]==="QAEXAM");
  assert.ok(examExport,`candidate number export row missing: ${JSON.stringify(exportRows.slice(0,3))}`);
  assert.strictEqual(examExport["考生号"],"00260101010002","export must preserve candidate number as text");
  for(const kind of ["photo","idPhoto"]){
    await page.evaluate(kind=>stuPhotoImport(kind),kind);
    await page.locator('input[name="photoName"][value="examNo"]').check();
    await page.locator("#stuPhotoFile").setInputFiles([png("00260101010002.png"),png("00260101010002-命名错误.png")]);
    await page.waitForFunction(()=>document.querySelector("#stuPhotoResult").textContent.includes("匹配成功 1 张，未匹配 1 张"));
    assert.match(await page.locator("#stuPhotoResult").innerText(),/QAEXAM[\s\S]*考生号验收/);
    assert.strictEqual(await page.evaluate(kind=>students.find(s=>s.id==="QAEXAM")[kind].name,kind),"00260101010002.png");
    await page.evaluate(()=>closeModal());
  }
  const before=await page.evaluate(()=>{const s=students.find(s=>s.id==="QAEXAM");students.find(s=>s.id==="QA001").examNo=s.examNo;return {photo:s.photo.id,idPhoto:s.idPhoto.id};});
  await page.evaluate(()=>stuPhotoImport("photo"));
  await page.locator('input[name="photoName"][value="examNo"]').check();
  await page.locator("#stuPhotoFile").setInputFiles(png("00260101010002.png"));
  await page.waitForFunction(()=>document.querySelector("#stuPhotoResult").textContent.includes("考生号重复"));
  assert.match(await page.locator("#stuPhotoResult").innerText(),/匹配成功 0 张，未匹配 1 张/);
  assert.deepStrictEqual(await page.evaluate(()=>{const s=students.find(s=>s.id==="QAEXAM");delete students.find(s=>s.id==="QA001").examNo;persistStudents();closeModal();return {photo:s.photo.id,idPhoto:s.idPhoto.id};}),before,"duplicate candidate numbers must not replace photos");
  await page.evaluate(()=>window.workbench.legacy.flushStore());
  const preview=await page.evaluate(async()=>{const r=await fetch("/api/ai/redaction-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"考生号 00260101010002"})});return {status:r.status,body:await r.json()};});
  assert.strictEqual(preview.status,200);
  assert.ok(!preview.body.text.includes("00260101010002"),"candidate number must be redacted before AI use");
}
async function legacy(page, opener, input, file, expected) {
  await page.evaluate(opener); await page.locator(input).setInputFiles(file); await page.locator("#modalOk").click(); await page.waitForTimeout(100); assert.strictEqual(await page.evaluate(expected), true, "legacy import did not persist expected record"); await page.evaluate(() => closeModal());
}
async function maintenance(page, kind, text, expected) {
  await page.locator('[data-workbench-progress]').waitFor({state:'detached',timeout:4000}).catch(()=>{}); await page.evaluate((target) => maintImport(target), kind); await page.locator("#maintImportText").fill(text); await page.getByRole("button", { name: "解析预览" }).click(); await page.getByRole("button", { name: /确认导入/ }).click(); await page.waitForTimeout(60); assert.strictEqual(await page.evaluate(expected), true, `maintenance ${kind} import did not persist`); await page.evaluate(() => closeModal());
}
async function maintenanceMappedFile(page, kind, file, mapping, expected) {
  await page.evaluate((target) => maintImport(target), kind);
  await page.locator("#maintImportFile").setInputFiles(file);
  await page.locator("#mappedImportFile").waitFor({ state: "attached" });
  await page.getByRole("button", { name: /下一步/ }).click();
  await page.getByRole("button", { name: /下一步/ }).click();
  for (const [systemField, excelHeader] of Object.entries(mapping)) {
    const row = page.locator(".import-field-table tbody tr").filter({ has: page.locator(`input[value="${systemField}"]`) });
    await row.locator("select").selectOption(excelHeader);
  }
  await page.getByRole("button", { name: /校验数据/ }).click();
  await page.getByRole("button", { name: /确认导入/ }).click();
  await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(expected), true, `maintenance manual mapping import failed: ${(await page.locator("#modalBody").innerText()).slice(0, 1000)}`);
  await page.evaluate(() => closeModal());
}
async function restoreAllData(page) {
  /* 先注册一次性监听，再触发导入，避免慢机器上固定等待时间导致漏掉确认框。 */
  const firstConfirm = page.waitForEvent("dialog", { timeout: 4000 });
  await page.evaluate(() => {
    const backup = {
      nnuzc_students: [{ id: "RESTORE001", name: "恢复验收学生", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2025级", status: "在校" }],
      nnuzc_achievement_records: [{ id: "RESTORE-ACH-001", title: "恢复验收获奖" }]
    };
    const file = new File([JSON.stringify(backup)], "isolated-restore.json", { type: "application/json" });
    importAllDataFromFile({ files: [file] });
  });
  const dialog = await firstConfirm;
  assert.strictEqual(dialog.type(), "confirm", "full backup restore must open a confirmation dialog");
  assert.match(dialog.message(), /恢复会覆盖备份中包含的同名本地数据/, "full backup restore must require the first confirmation");
  const reload = page.waitForNavigation({ waitUntil: "networkidle", timeout: 8000 });
  await dialog.accept();
  await reload;
  let restored = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    restored = await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem("nnuzc_students") || "[]");
      return value.length === 1 && value[0].id === "RESTORE001" && value[0].name === "恢复验收学生";
    });
    if (restored) break;
    await page.waitForTimeout(100);
  }
  assert.strictEqual(restored, true, "full backup restore did not write the selected backup data");
  assert.strictEqual(await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("nnuzc_students") || "[]");
    return value.length === 1 && value[0].id === "RESTORE001" && value[0].name === "恢复验收学生";
  }), true, "full backup restore did not retain the selected backup data");
  assert.strictEqual(await page.evaluate(async () => {
    const store = await (await fetch("/api/store")).json();
    const students = JSON.parse(store.nnuzc_students || "[]");
    const achievements = JSON.parse(store.nnuzc_achievement_records || "[]");
    return students.length === 1 && students[0].id === "RESTORE001" && achievements[0]?.title === "恢复验收获奖";
  }), true, "full backup restore did not atomically persist server data");
}
async function studentOrgEntrances(page, context) {
  const direct = await context.request.get(`${origin}/student-org.html`, { maxRedirects: 0 });
  assert.strictEqual(direct.status(), 302, "student-org direct access must return to the main system");
  const cases = [
    ["studentOrgHome", "总览"], ["studentOrgManage", "组织管理"],
    ["studentOrgLedger", "业务台账"], ["studentOrgLibrary", "资料"]
  ];
  for (const [view, group] of cases) {
    await page.evaluate((target) => goto(target), view);
    const frame = page.frameLocator(".student-org-frame iframe");
    await frame.locator(".szo-third-tabs").waitFor({ state: "visible" });
    assert.match(await frame.locator(".szo-third-tabs").innerText(), new RegExp(group), `student org ${group} third-level tabs are missing`);
  }
}
async function main() {
  for (const name of ["web-server.js", "workbench-database.js", "academic-public-engine.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-exams.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "license-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js", "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js", "counselor-growth-module.js", "custom-fields-module.js", "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "other-violation-module.js", "index.html", "login.html", "学生组织管理.html"]) fs.copyFileSync(path.join(root, name), path.join(temp, name));
  fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
  fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
  installTestLicense(temp);
  fs.mkdirSync(path.join(temp, "assets")); for (const name of ["html2pdf.bundle.min.js", "jszip.min.js", "xlsx.full.min.js", "academic-warning-editor-template.html", "login-logo.png", "login-logo-icon.png", "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-field-template.xlsx", "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js", "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css"]) fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
  fs.copyFileSync(path.join(root, "assets", "tool-history-client.js"), path.join(temp, "assets", "tool-history-client.js"));
  for (const asset of ["workbench-ui.js", "workbench-ui.css"]) fs.copyFileSync(path.join(root, "assets", asset), path.join(temp, "assets", asset));
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: { ...process.env, XIANGCAI_PORT: String(port) }, stdio: ["ignore", "ignore", "inherit"] }); await ready();
  const setup = await fetch(`${origin}/api/auth/enter`, { method: "POST", headers: { Origin: origin } }); assert.strictEqual(setup.status, 200); const cookie = String(setup.headers.get("set-cookie")).split(";")[0];
  const students = [{ id: "QA001", name: "导入验收甲", ethnic: "汉族", idcard: "32010120050101001X", dept: "测试学院", major: "测试专业", grade: "2025级", cls: "测试班", graduateYear: "2026届", status: "在校" }];
  await store(cookie, "nnuzc_orgs", { depts: [{ name: "测试学院", code: "QA" }, { name: "第二学院", code: "QB" }], majors: [{ name: "测试专业", code: "QA01", dept: "测试学院" }, { name: "第二专业", code: "QB01", dept: "第二学院" }], classes: [{ name: "测试班", dept: "测试学院", major: "测试专业", grade: "2025级" }, { name: "测试二班", dept: "测试学院", major: "测试专业", grade: "2025级" }, { name: "测试三班", dept: "第二学院", major: "第二专业", grade: "2024级" }], grades: [{ name: "2025级" }, { name: "2024级" }], dorms: [] });
  await store(cookie, "nnuzc_students", students); await store(cookie, "nnuzc_term_list", ["2025-2026-1学期"]); await store(cookie, "nnuzc_current_term", "2025-2026-1学期"); await store(cookie, "nnuzc_backup_reminder_config", { intervalDays: 7, lastBackupAt: null });
  const { chromium } = playwright(); browser = await chromium.launch({ executablePath: edge(), headless: true }); const context = await browser.newContext(); const [ck, cv] = cookie.split("="); await context.addCookies([{ name: ck, value: cv, url: origin }]); const page = await context.newPage(); activePage=page; const errors = []; page.on("pageerror", (e) => errors.push(e.message)); await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  if(process.env.QA_IMPORT_TEMPLATE_ONLY === "1"){await require("./qa-import-template-validation.cjs")(page,path.join(root,"tests",".qa-import-template-validation"));assert.deepStrictEqual(errors,[]);return;}
  await page.waitForFunction(async () => { const data=await (await fetch("/api/store")).json();return !Object.prototype.hasOwnProperty.call(data,"nnuzc_backup_reminder_config"); }, null, { timeout: 5000 });
  if (process.env.QA_TERM_SYNC_ONLY === "1") {
    await page.evaluate(() => applyFundRecord("QA001", "导入验收甲", "测试学院", "2025级", "测试班", "2024-2025-1学期", { isPoor: true, poorLevel: "一般困难", national: false, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "历史记录" }));
    const navigation = page.waitForNavigation({ waitUntil: "networkidle" });
    await page.evaluate(() => saveSemesterSetting("2026-2027-1学期", "", ""));
    await navigation;
    const check = await page.evaluate(() => {
      const term = "2026-2027-1学期";
      return { global: getTermList().includes(term), academic: academicTerms.some((item) => item.term === term), warning: academicWarningTerms.some((item) => item.term === term), grade: gradeTerms.some((item) => item.term === term), fund: fundTerms.some((item) => item.term === term), assessment: classOfficerAssessmentTerms.some((item) => item.term === term), historicalFund: fundRecords.some((item) => item.term === "2024-2025-1学期" && item.other === "历史记录"), historicalNotGlobal: !getTermList().includes("2024-2025-1学期"), fundIdsUnique: new Set(fundTerms.map((item) => item.id)).size === fundTerms.length, directTermSelector: termOptionsHTML(term).includes(term) };
    });
    assert.ok(Object.values(check).every(Boolean), `new semester did not synchronize to every term-based module: ${JSON.stringify(check)}`);
    await page.evaluate(() => { window.fundTerms = fundTerms.filter((item) => item.term !== "2026-2027-1学期"); saveFundTerms(); });
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => fundTerms.filter((item) => item.term === "2026-2027-1学期").length), 1, "startup did not repair a missing funding semester");
    assert.strictEqual(await page.evaluate(() => fundRecords.some((item) => item.term === "2024-2025-1学期" && item.other === "历史记录")), true, "semester synchronization changed historical funding data");
    assert.deepStrictEqual(errors, [], `semester sync page errors: ${errors.join(" | ")}`);
    console.log("qa-imports: semester sync passed (system settings, five ledgers, startup repair, historical funding)");
    return;
  }
  if (process.env.QA_PARTY_ONLY === "1") {
    await page.evaluate(() => {
      const student=students.find((item) => item.id === "QA001");
      student.political="共青团员";
      partyEnsure(student);
      persistStudents();
      goto("party");
      queryFilter("party");
    });
    assert.deepStrictEqual(await page.locator("#content thead th").allTextContents(), ["学院","专业","班级","学号","姓名","政治面貌","团员身份","当前阶段","确定日期","所属支部","党课培训","发展历程","操作"], "party table must show political status, league status and training records");
    const initialPartyTableText=await page.locator("#content tbody").innerText();
    assert.match(initialPartyTableText, /QA001[\s\S]*共青团员[\s\S]*团员/, `party table did not read political status from student management: ${initialPartyTableText}`);
    await page.evaluate(() => partyOpenForm("QA001"));
    assert.strictEqual(await page.locator("#partyPolitical").inputValue(), "共青团员", "party form did not show synchronized political status");
    assert.strictEqual(await page.locator("#partyPolitical").evaluate((node) => node.tagName), "SELECT", "party political status must be editable");
    assert.deepStrictEqual(await page.locator("#partyPolitical option").allTextContents(), ["未填写","中共党员","中共预备党员","共青团员","群众","其他民主党派"], "party political-status options differ from student management");
    assert.deepStrictEqual(await page.locator("#partyLeague option").allTextContents(), ["团员","非团员","已推优","保留团员的中共党员","退团"], "party league-status options are incomplete");
    assert.deepStrictEqual(await page.locator("#partyTraining_primary_status option").allTextContents(), ["未参加","培训中","已结业","未通过"], "party-course status options are incomplete");
    assert.strictEqual((await page.locator("#modalBody").innerText()).includes("当前发展阶段 *"), false, "party current stage is still marked required");
    assert.strictEqual((await page.locator("#modalBody").innerText()).includes("确定日期 *"), false, "party confirmation date is still marked required");
    assert.strictEqual((await page.locator("#partyStage option").first().innerText()), "未填写", "party current stage cannot be cleared");
    await page.locator("#partyPolitical").selectOption("中共党员");
    await page.locator("#partyLeague").selectOption("保留团员的中共党员");
    await page.locator("#partyStage").selectOption("");
    await page.locator("#partyDate").fill("");
    await page.locator("#partyTraining_primary_status").selectOption("已结业");
    await page.locator("#partyTraining_primary_date").fill("2026-10-13");
    await page.locator("#partyTraining_primary_organizer").fill("学院党校");
    await page.locator("#partyTraining_primary_result").fill("优秀");
    await page.locator("#modalOk").click();
    await page.waitForFunction(() => !document.getElementById("modal").classList.contains("show"));
    assert.deepStrictEqual(await page.evaluate(() => { const student=students.find((item)=>item.id==="QA001");return {political:student.political,stage:student.party.stage,date:student.party.date,history:student.party.history.length,training:student.party.training.primary}; }), {political:"中共党员",stage:"",date:"",history:0,training:{status:"已结业",date:"2026-10-13",organizer:"学院党校",result:"优秀"}}, "party form did not save political sync, optional stage/date or training record");
    await page.evaluate(() => writeImportedRows([{ "学号":"QA001", "姓名":"导入验收甲", "班级":"测试班", "学籍状态":"在校", "政治面貌":"中共预备党员" }], "cover"));
    await page.waitForFunction(async () => { const data=await (await fetch("/api/store")).json();const rows=JSON.parse(data.nnuzc_students||"[]");return rows.find((item)=>item.id==="QA001")?.political==="中共预备党员"; }, null, { timeout: 5000 });
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => { goto("party");queryFilter("party"); });
    assert.match(await page.locator("#content tbody").innerText(), /QA001[\s\S]*中共预备党员[\s\S]*保留团员的中共党员[\s\S]*—/, "student import did not synchronize political status or retain blank stage/date in party information");
    await page.evaluate(() => partyOpenForm("QA001"));
    assert.strictEqual(await page.locator("#partyPolitical").inputValue(), "中共预备党员", "party form did not refresh imported political status");
    await page.locator("#partyPolitical").selectOption("群众");
    await page.locator("#partyLeague").selectOption("退团");
    await page.locator("#modalOk").click();
    assert.strictEqual(await page.evaluate(() => students.find((item)=>item.id==="QA001").political), "群众", "party political-status edit did not synchronize back to student management");
    const exported=await page.evaluate(() => { const original=window.downloadXlsxFile;let rows=null;window.downloadXlsxFile=function(_sheet,data){rows=data;};exportParty();window.downloadXlsxFile=original;return rows; });
    assert.deepStrictEqual(exported[0], ["学院","专业","班级","学号","姓名","政治面貌","团员身份","当前发展阶段","确定日期","所属党支部","培养联系人","入党介绍人","材料状态","本次节点备注","初级党课状态","初级党课日期","初级党课培训单位","初级党课培训结果","中级党课状态","中级党课日期","中级党课培训单位","中级党课培训结果","高级党课状态","高级党课日期","高级党课培训单位","高级党课培训结果","发展历程"], "party export is missing synchronized party-ledger or training fields");
    assert.deepStrictEqual(exported[1].slice(3, 7), ["QA001","导入验收甲","群众","退团"], "party export did not use the synchronized political status or saved league status");
    assert.match(await page.evaluate(() => portraitArchiveHTML(students.find((item) => item.id === "QA001"))), /政治面貌[\s\S]*群众[\s\S]*团员身份[\s\S]*退团[\s\S]*初级党课[\s\S]*已结业[\s\S]*学院党校/, "student portrait did not show party political, league or training status");
    assert.deepStrictEqual(errors, [], `party page errors: ${errors.join(" | ")}`);
    console.log("qa-imports: party sync passed (optional stage/date, two-way political sync, league statuses, export and portrait)");
    return;
  }
  if (process.env.QA_TOPBAR_FONT_ONLY === "1") {
    await page.setViewportSize({ width: 2048, height: 900 });
    const topbar = await page.evaluate(() => {
      const size = (selector) => getComputedStyle(document.querySelector(selector)).fontSize;
      const right = document.querySelector(".session-actions").getBoundingClientRect();
      const term = document.querySelector(".term-box").getBoundingClientRect();
      return { brand: size(".logo .t1"), crumb: size(".crumb"), termLabel: size(".term-label"), termValue: size("#termSelBox strong"), week: size("#termSelBox span"), feedback: size("#feedbackLink"), demo: size("#demoLoadBtn"), clear: size("#demoClearBtn"), cockpit: size("#cockpitEntryBtn"), theme: size("#uiThemeToggle"), sessionRemoved: document.querySelector("#sessionName") === null, termRight: term.right, actionsLeft: right.left, actionsRight: right.right };
    });
    assert.deepStrictEqual(Object.values(topbar).slice(0, 10), ["14px", "14px", "13px", "13px", "12.5px", "12.5px", "12.5px", "12.5px", "12.5px", "12.5px"], "topbar typography did not decrease by 2px");
    assert.strictEqual(topbar.sessionRemoved, true, "topbar workbench session label should be removed");
    assert.ok(topbar.termRight <= topbar.actionsLeft && topbar.actionsRight <= 2048, "wide topbar labels overlap or overflow");
    await page.setViewportSize({ width: 1280, height: 800 });
    const compact = await page.evaluate(() => {
      const bar = document.querySelector(".topbar").getBoundingClientRect();
      const actions = document.querySelector(".session-actions");
      const rect = actions.getBoundingClientRect();
      return { barRight: bar.right, actionsRight: rect.right, scrollable: getComputedStyle(actions).overflowX === "auto", width: actions.clientWidth, contentWidth: actions.scrollWidth };
    });
    assert.ok(compact.barRight <= 1280 && compact.actionsRight <= 1280 && compact.scrollable && compact.contentWidth >= compact.width, "compact topbar actions must remain inside the viewport and horizontally accessible");
    assert.deepStrictEqual(errors, [], `topbar page errors: ${errors.join(" | ")}`);
    console.log("qa-imports: topbar font passed (computed sizes, wide and compact layout)");
    return;
  }
  assert.strictEqual(await page.evaluate(() => localStorage.getItem("nnuzc_backup_reminder_config")), null, "retired backup reminder configuration was not removed");
  await page.evaluate(() => { const settings=getTermSettings();settings[CURRENT_TERM]={startDate:"2026-09-14",totalWeeks:19};saveTermSettings(settings);courseSchedules.push({id:"qa-visual-timetable",term:CURRENT_TERM,cls:"测试班",day:1,weeks:"1-16",course:"可视化课表验收课程",category:"必修",section:"第1-2节",teacher:"课表验收教师",location:"教一101"},{id:"qa-other-org",term:CURRENT_TERM,cls:"测试三班",day:1,weeks:"1-16",course:"另一学院课程",category:"选修",section:"第3-4节",teacher:"第二教师",location:"教二202"});persistCourseSchedules();courseTimetableState.term=CURRENT_TERM;courseTimetableState.cls="";courseTimetableState.week=1;goto("courseTimetable"); });
  assert.match(await page.locator("#content").innerText(),/课表[\s\S]*实时在课与课堂状态[\s\S]*班级全程课程表周视图[\s\S]*可视化课表验收课程/,"visual timetable page did not render the shared course schedule in week view");
  assert.strictEqual(await page.locator('.ct-toolbar-filters .qf-multi').count(),5,"timetable must expose term, department, major, grade and class checkbox filters");
  assert.match(await page.locator('.ct-toolbar-filters').innerText(),/学期[\s\S]*学院[\s\S]*专业[\s\S]*年级[\s\S]*班级[\s\S]*周次/,"timetable filter field names are incomplete");
  const timetableFilterLayout=await page.locator('.ct-toolbar-filters>.field').evaluateAll((nodes)=>nodes.map((node)=>{const rect=node.getBoundingClientRect(),trigger=node.querySelector('.qf-multi-trigger');return {top:Math.round(rect.top),width:Math.round(rect.width),triggerHeight:trigger?Math.round(trigger.getBoundingClientRect().height):0};}));assert.ok(timetableFilterLayout.length===6&&Math.max(...timetableFilterLayout.slice(0,5).map((item)=>item.top))-Math.min(...timetableFilterLayout.slice(0,5).map((item)=>item.top))<=2,"five timetable filters must stay on one compact row");assert.ok(timetableFilterLayout.slice(0,5).every((item)=>item.triggerHeight===34),"timetable filter controls must use the compact height");assert.ok(timetableFilterLayout[5].top>timetableFilterLayout[0].top,"week controls must remain on the following row");
  for(const name of ["ctTerm","ctDept","ctMajor","ctGrade","ctClass"])assert.ok(await page.locator(`.qf-multi[data-qf="${name}"] input[type="checkbox"]`).count()>0,`timetable ${name} filter is not checkbox based`);
  await page.locator('.qf-multi[data-qf="ctDept"] .qf-multi-trigger').click();await page.locator('.qf-multi[data-qf="ctDept"] input[value="测试学院"]').check();await page.waitForTimeout(80);assert.match(await page.locator('.ct-board').innerText(),/可视化课表验收课程/,"department checkbox filter removed a matching course");assert.doesNotMatch(await page.locator('.ct-board').innerText(),/另一学院课程/,"department checkbox filter retained a non-matching course");
  await page.locator('.qf-multi[data-qf="ctDept"] .qf-multi-trigger').click();await page.locator('.qf-multi[data-qf="ctDept"] input[value="测试学院"]').uncheck();await page.waitForTimeout(80);assert.match(await page.locator('.ct-board').innerText(),/另一学院课程/,"clearing department checkbox filter did not restore all courses");
  await page.evaluate(()=>{for(let index=1;index<=4;index++)courseSchedules.push({id:"qa-dense-"+index,term:CURRENT_TERM,cls:index%2?"测试班":"测试二班",day:1,weeks:"1-16",course:"密集显示课程"+index,category:index%2?"实验":"选修",section:"第1-2节",teacher:"密集教师",location:"教学楼"+index});courseSchedules.push({id:"qa-span-course",term:CURRENT_TERM,cls:"测试班",day:1,weeks:"1-16",course:"跨节显示验收课程",category:"实践",section:"第1-4节",teacher:"跨节教师",location:"综合楼"});persistCourseSchedules();courseTimetableSelectClass("");});
  let denseCell=page.locator(".ct-grid tbody tr").first().locator(".ct-cell").first();assert.strictEqual(await denseCell.locator(".ct-course").count(),4,"all-class timetable must compact dense cells by default");assert.match(await denseCell.innerText(),/还有 2 门课程，展开查看/,"dense timetable cell did not show the hidden-course summary");assert.doesNotMatch(await page.locator(".ct-grid tbody tr").nth(1).locator(".ct-cell").first().innerText(),/跨节显示验收课程/,"a cross-period course was duplicated into a later period group");await denseCell.getByRole("button",{name:/展开查看/}).click();denseCell=page.locator(".ct-grid tbody tr").first().locator(".ct-cell").first();assert.strictEqual(await denseCell.locator(".ct-course").count(),6,"dense timetable cell did not expand all courses");await page.locator('.qf-multi[data-qf="ctClass"] .qf-multi-trigger').click();await page.locator('.qf-multi[data-qf="ctClass"] input[value="测试班"]').check();await page.waitForTimeout(80);await page.locator('.qf-multi[data-qf="ctClass"] .qf-multi-trigger').click();await page.locator('.qf-multi[data-qf="ctClass"] input[value="测试二班"]').check();await page.waitForTimeout(80);assert.deepStrictEqual((await page.evaluate(()=>courseTimetableState.classes)).sort(),["测试二班","测试班"].sort(),"class filter did not retain multiple checkbox selections");await page.evaluate(()=>courseTimetableSelectClass("测试班"));
  for(const buttonName of [/AI 智能识别课表/,/识别 PDF 课表/,/导入课表/,/课表模板/])assert.strictEqual(await page.getByRole("button",{name:buttonName}).count(),1,`visual timetable import action is missing: ${buttonName}`);
  await page.getByRole("button",{name:/识别 PDF 课表/}).click();assert.strictEqual(await page.locator("#pdfScheduleTerm").inputValue(),"2025-2026-1学期","visual timetable PDF import did not inherit the selected term");await page.evaluate(()=>closeModal());await page.getByRole("button",{name:/AI 智能识别课表/}).click();assert.deepStrictEqual(await page.evaluate(()=>window.__courseScheduleAiContext),{term:"2025-2026-1学期",returnView:"courseTimetable"},"visual timetable AI import did not preserve its return page and selected term");await page.evaluate(()=>closeModal());
  await page.getByRole("button",{name:/手动添加课程/}).click();await page.locator("#ctFormDay").selectOption("2");await page.locator("#ctFormWeeks").fill("1-16");await page.locator("#ctFormCourse").fill("手动排课验收课程");await page.locator("#ctFormCategory").fill("实验");await page.locator("#ctFormSection").fill("第3-4节");await page.locator("#ctFormTeacher").fill("手动排课教师");await page.locator("#ctFormLocation").fill("实验楼202");await page.locator("#modalOk").click();await page.waitForTimeout(100);
  assert.strictEqual(await page.evaluate(()=>courseSchedules.some((row)=>row.term===CURRENT_TERM&&row.cls==="测试班"&&row.course==="手动排课验收课程"&&row.day===2&&row.section==="第3-4节")),true,"manual visual timetable entry did not persist to the shared schedule data");
  await page.evaluate(()=>goto("classroom"));assert.strictEqual(await page.locator("#courseScheduleTable").count(),0,"classroom must not retain its retired timetable card");assert.strictEqual(await page.evaluate(()=>courseSchedules.some(row=>row.course==="手动排课验收课程")),true,"retiring classroom timetable must preserve shared course data");
  await page.evaluate(()=>goto("courseTimetable"));await page.getByRole("button",{name:/作息时间设置/}).click();assert.match(await page.locator("#modalBody").innerText(),/校历数据已与“学期设置”同步[\s\S]*2026-09-14[\s\S]*19 周/,"timetable calendar summary did not read from semester settings");assert.strictEqual(await page.locator("#ctSettingStart,#ctSettingWeeks").count(),0,"timetable must not expose duplicate calendar editors");await page.getByRole("button",{name:/增加节次/}).click();const periodRows=page.locator("#ctPeriodList .ct-period-row");assert.strictEqual(await periodRows.count(),13,"timetable period list did not freely add a new period");await periodRows.last().locator(".ct-period-start").fill("22:00");await periodRows.last().locator(".ct-period-end").fill("22:40");await page.locator("#modalOk").click();await page.waitForTimeout(80);assert.deepStrictEqual(await page.evaluate(()=>{const item=getTermSettings()[CURRENT_TERM];return {startDate:item.startDate,totalWeeks:item.totalWeeks,periodCount:item.periods.length,last:item.periods[item.periods.length-1]};}),{startDate:"2026-09-14",totalWeeks:19,periodCount:13,last:{no:13,start:"22:00",end:"22:40"}},"dynamic timetable periods did not persist while preserving synchronized semester calendar data");assert.match(await page.locator(".ct-grid").innerText(),/第13节[\s\S]*22:00 - 22:40/,"week timetable did not expand for the newly added period");
  await studentOrgEntrances(page, context);

  await wizard(page, () => classOfficerImport(), csv("class-officer.csv", ["学生编号", "班干部职务", "任职时间", "状态", "职责"], ["QA001", "学习委员", "2026-08-31", "在任", "负责学习交流"]), () => classOfficerRecords.some((record) => record.studentId === "QA001" && record.position === "学习委员" && !("term" in record)) && /学习委员（测试班，在任）/.test(students.find((student) => student.id === "QA001").cadre));
  await page.waitForFunction(async () => { const data = await (await fetch("/api/store")).json(); const records = JSON.parse(data.nnuzc_class_officer_records || "[]"); const storedStudents = JSON.parse(data.nnuzc_students || "[]"); return records.length === 1 && /学习委员/.test(storedStudents.find((student) => student.id === "QA001")?.cadre || ""); }, null, { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => !("term" in classOfficerNormalizeRecord({ studentId: "QA001", position: "旧记录迁移", term: "2025-2026-1学期" }, 0))), true, "legacy class officer term field was not removed by normalization");
  if (process.env.QA_CLASS_OFFICER_ONLY === "1") {
    const autoEnded = await page.evaluate(() => {
      classOfficerRecords.push(classOfficerNormalizeRecord({ id: "qa-class-officer-second", studentId: "QA001", position: "班长", startDate: "2026-08-31", status: "在任" }, 1));
      persistClassOfficerRecords(); syncClassOfficerStudents(["QA001"]); classOfficerAssessmentSyncAllTerms();
      const student = students.find((item) => item.id === "QA001");
      student.status = "休学";
      persistStudents();
      const records = classOfficerRecords.filter((record) => record.studentId === "QA001");
      const assessment = classOfficerAssessmentTermByName("2025-2026-1学期");
      return { records: records.map((record) => ({ status: record.status, endDate: record.endDate })), current: student.cadre, history: student.cadreHistory, assessmentCount: assessment.rows.length, today: isoToday() };
    });
    assert.strictEqual(autoEnded.records.length, 2, "multiple active appointments were not retained for the test");
    assert.ok(autoEnded.records.every((record) => record.status === "已离任" && record.endDate === autoEnded.today), "non-campus status did not automatically end all active appointments");
    assert.strictEqual(autoEnded.current, "", "ended appointments remain in the student's current cadre summary");
    assert.match(autoEnded.history, /学习委员/); assert.match(autoEnded.history, /班长/);
    assert.strictEqual(autoEnded.assessmentCount, 0, "ended appointments remain in the active assessment roster");
    await page.waitForFunction(async () => { const store = await (await fetch("/api/store")).json(); const rows = JSON.parse(store.nnuzc_class_officer_records || "[]"); return rows.length === 2 && rows.every((row) => row.status === "已离任" && row.endDate); }, null, { timeout: 5000 });
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => classOfficerRecords.filter((record) => record.studentId === "QA001" && record.status === "已离任").length), 2, "auto-ended appointments did not survive reload");
    await page.evaluate(() => { const stale = classOfficerRecords.find((record) => record.studentId === "QA001"); stale.status = "在任"; stale.endDate = ""; persistClassOfficerRecords(); });
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.evaluate(() => classOfficerRecords.filter((record) => record.studentId === "QA001" && record.status === "在任").length), 0, "startup did not reconcile legacy active appointments for non-campus students");
    await page.evaluate(() => { students.find((item) => item.id === "QA001").status = "在校生"; persistStudents(); });
    assert.strictEqual(await page.evaluate(() => classOfficerRecords.filter((record) => record.status === "在任").length), 0, "returning to campus must not reactivate ended appointments");
    assert.deepStrictEqual(errors, [], `class officer import page errors: ${errors.join(" | ")}`);
    console.log("qa-imports: class officer passed (mapped import, automatic end on non-campus status, archive and assessment sync, server persistence)");
    return;
  }

  await wizard(page, () => fundImport("2025-2026-1学期"), csv("fund.csv", ["学号", "是否贫困生"], ["QA001", "是"]), () => fundRecords.some((r) => r.studentId === "QA001" && r.isPoor));
  if (process.env.QA_FUND_ONLY === "1") {
    await page.evaluate(() => { window.openEditFundTerm(window.fundTermByTerm("2025-2026-1学期").id); viewFilter.fund = { kw: "QA001" }; fundRebuildTable(window.fundModalTermId); });
    assert.deepStrictEqual(await page.locator("#fundTableWrap thead th").allTextContents(), ["", "学期", "学院", "专业", "班级", "学号", "姓名", "民族", "是否贫困生", "困难评定等级", "国家助学金", "学院助学金", "国家励志助学金", "学院励志助学金", "临时补助", "其他资助", "操作"], "funding table ethnicity must follow the name");
    assert.strictEqual(await page.locator("#fundTableWrap tbody tr td").nth(7).innerText(), "汉族", "funding table did not read student ethnicity");
    await page.evaluate(() => window.openFund());
    await page.locator("#fStuId").fill("QA001");
    assert.strictEqual(await page.locator("#fStuEthnic").inputValue(), "汉族", "funding entry did not match student ethnicity");
    await page.evaluate(() => window.openEditFund("QA001", "2025-2026-1学期"));
    assert.strictEqual(await page.locator("#fStuEthnic").inputValue(), "汉族", "funding edit did not read current student ethnicity");
    await page.evaluate(() => { students.find((student) => student.id === "QA001").ethnic = "回族"; persistStudents(); window.openEditFundTerm(window.fundTermByTerm("2025-2026-1学期").id); });
    assert.strictEqual(await page.locator("#fundTableWrap tbody tr td").nth(7).innerText(), "回族", "funding table did not follow updated student ethnicity");
    const exported = await page.evaluate(() => {
      const original = window.downloadXlsxFile;
      const captured = [];
      window.downloadXlsxFile = function(sheet, rows, fileName) { captured.push({ sheet, rows, fileName }); };
      window.fundExportCurrent();
      window.fundExportTerm(window.fundModalTermId);
      window.fundExportAll();
      window.downloadXlsxFile = original;
      return captured;
    });
    assert.strictEqual(exported.length, 3, "funding export actions did not all create workbooks");
    assert.deepStrictEqual(exported[0].rows[0], ["学号", "姓名", "民族", "学院", "专业", "年级", "班级", "学期", "是否贫困生", "困难评定等级", "国家助学金", "学院助学金", "国家励志助学金", "学院励志助学金", "临时补助", "其他资助"], "funding export headers are incomplete or not re-importable");
    assert.deepStrictEqual(exported[0].rows[1].slice(0, 10), ["QA001", "导入验收甲", "回族", "测试学院", "测试专业", "2025级", "测试班", "2025-2026-1学期", "是", "未评定等级"], "funding export did not use current student ethnicity and funding data");
    assert.match(exported[0].fileName, /2025-2026-1学期_当前筛选/);
    await page.waitForFunction(async () => { const store = await (await fetch("/api/store")).json(); const rows = JSON.parse(store.nnuzc_fund_records || "[]"); return rows.some((r) => r.studentId === "QA001" && r.term === "2025-2026-1学期"); }, null, { timeout: 5000 });
    await page.reload({ waitUntil: "networkidle" });
    const afterRefresh = await page.evaluate(() => {
      const original = window.downloadXlsxFile;
      let captured = null;
      window.downloadXlsxFile = function(sheet, rows, fileName) { captured = { sheet, rows, fileName }; };
      window.fundExportTerm(window.fundTermByTerm("2025-2026-1学期").id);
      window.downloadXlsxFile = original;
      return captured;
    });
    assert.strictEqual(afterRefresh.rows.length, 2, "funding export data did not survive refresh");
    assert.strictEqual(afterRefresh.rows[1][2], "回族", "funding ethnicity sync did not survive refresh");
    assert.deepStrictEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    console.log("qa-imports: funding export passed (filtered term, full term, all terms, matched fields, server persistence, refresh)");
    return;
  }
  await wizard(page, () => awardStatisticsImport(), csv("award-statistics.csv", ["姓名", "学号", "学院", "专业", "现在年级", "班级", "荣誉称号名称", "学科竞赛名称", "奖项", "评定学期", "评定学年", "获奖日期", "获奖证书"], ["错误姓名", "QA001", "错误学院", "错误专业", "错误年级", "错误班级", "导入验收荣誉", "导入验收竞赛", "一等奖", "2025-2026-1学期", "2025-2026学年", "2026-08-13", "导入证书.pdf"]), () => { const r = awardStatisticsRecordsForStudent("QA001")[0]; return !!r && r.name === "导入验收甲" && r.dept === "测试学院" && r.honorTitle === "导入验收荣誉" && r.certificateImportName === "导入证书.pdf"; });
  await page.evaluate(() => goto("awardStatistics")); await page.getByRole("button", { name: /新增/ }).click(); await page.locator("#awardStatisticsSid").fill("QA001"); await page.waitForTimeout(30); assert.strictEqual(await page.locator("#awardStatisticsName").inputValue(), "导入验收甲", "award statistics student matching did not fill name"); await page.locator("#awardStatisticsHonorTitle").fill("证书上传验收荣誉"); await page.locator("#awardStatisticsAward").fill("二等奖"); await page.locator("#awardStatisticsAwardDate").fill("2026-08-14"); await page.locator("#awardStatisticsCertificate").setInputFiles(png("award-statistics-cert.png")); await page.locator("#modalOk").click(); await page.waitForTimeout(150); assert.strictEqual(await page.evaluate(() => { const r = awardStatisticsRecordsForStudent("QA001").find((x) => x.honorTitle === "证书上传验收荣誉"); return !!(r && r.certificate && r.certificate.id); }), true, "award statistics certificate upload did not persist"); assert.match(await page.evaluate(() => portraitArchiveHTML(students.find((s) => s.id === "QA001"))), /证书上传验收荣誉/, "student portrait did not link award statistics record");
  await page.waitForFunction(async () => { const store = await (await fetch("/api/store")).json(); const rows = JSON.parse(store.nnuzc_award_statistics_records || "[]"); return rows.length === 2 && rows.some((r) => r.honorTitle === "证书上传验收荣誉" && r.certificate && r.certificate.id); }, null, { timeout: 5000 });
  await page.reload({ waitUntil: "networkidle" });
  assert.strictEqual(await page.evaluate(() => awardStatisticsRecordsForStudent("QA001").length), 2, "award statistics records did not survive page refresh");
  assert.match(await page.evaluate(() => portraitArchiveHTML(students.find((s) => s.id === "QA001"))), /证书上传验收荣誉/, "student portrait linkage did not survive page refresh");
  if (process.env.QA_AWARD_ONLY === "1") {
    assert.deepStrictEqual(errors, [], `page errors: ${errors.join(" | ")}`);
    console.log("qa-imports: award statistics passed (Excel import, student matching, certificate upload, server persistence, refresh, portrait linkage)");
    return;
  }
  const image = png("QA001.png"), unmatchedImage = png("QA001-导入验收甲-命名不规范.png"); await page.evaluate(() => stuPhotoImport()); await page.locator("#stuPhotoFile").setInputFiles([image,unmatchedImage]); await page.waitForTimeout(200); assert.strictEqual(await page.evaluate(() => !!students.find((s) => s.id === "QA001").photo?.id), true, "student enrollment-photo import did not persist the matched attachment"); assert.match(await page.locator("#stuPhotoResult").innerText(), /匹配成功 1 张，未匹配 1 张[\s\S]*未匹配学生信息[\s\S]*QA001[\s\S]*导入验收甲/, "student enrollment-photo import did not preserve matched files and report unmatched student details"); await page.evaluate(() => closeModal());
  const idPhoto = png("32010120050101001x.png"), unmatchedIdPhoto = png("QA001-导入验收甲-证件照.png"); await page.evaluate(() => stuPhotoImport("idPhoto")); await page.locator('input[name="photoName"][value="idcard"]').check(); await page.locator("#stuPhotoFile").setInputFiles([idPhoto,unmatchedIdPhoto]); await page.waitForTimeout(200); assert.strictEqual(await page.evaluate(() => { const s=students.find((item) => item.id === "QA001"); return !!(s.idPhoto&&s.idPhoto.id)&&/学籍照片[\s\S]*证件照/.test(portraitArchiveHTML(s)); }), true, "student ID-photo import did not match ID card or synchronize to portrait"); assert.match(await page.locator("#stuPhotoResult").innerText(), /匹配成功 1 张，未匹配 1 张[\s\S]*未匹配学生信息[\s\S]*QA001[\s\S]*导入验收甲/, "student ID-photo import did not preserve matched files and report unmatched student details"); await page.evaluate(() => closeModal());
  await page.evaluate(() => stuImport()); await page.locator("#stuImportFile").setInputFiles(csv("student.csv", ["学号", "姓名", "班级", "学籍状态"], ["QA002", "导入验收乙", "测试班", "在校"])); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /校验数据/ }).click(); await page.waitForTimeout(350); await page.locator("#stuImpGoBtn").click();
  await page.waitForFunction(()=>window.__studentImportState?.imported===true); await page.waitForTimeout(80); const studentImported=await page.evaluate(() => students.some((s) => s.id === "QA002" && s.name === "导入验收乙" && s.dept === "测试学院" && s.major === "测试专业" && s.grade === "2025级" && s.cls === "测试班" && s.status === "在校")); assert.strictEqual(studentImported, true, `student import did not derive organization fields from class: ${(await page.locator("#modalBody").innerText()).slice(0,800)}`); await page.evaluate(() => closeModal());
  await page.evaluate(() => stuImport()); await page.locator("#stuImportFile").setInputFiles(csv("student-auto-basic-data.csv", ["学号", "姓名", "学院", "专业", "年级", "班级", "招生类别", "学籍状态"], ["QA009", "自动维护验收", "自动学院", "自动专业", "2028级", "自动班", "自动招生类别", "在校"])); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /校验数据/ }).click(); await page.waitForTimeout(350);
  const autoBasicConfirm=new Promise((resolve,reject)=>page.once("dialog",async(dialog)=>{try{const info={type:dialog.type(),message:dialog.message()};await dialog.accept();resolve(info);}catch(error){reject(error);}})); await page.locator("#stuImpGoBtn").click();
  await page.waitForFunction(()=>window.__studentImportState?.imported===true); const autoBasicDialog=await autoBasicConfirm; assert.strictEqual(autoBasicDialog.type,"confirm","unknown student organization data must open a confirmation dialog"); assert.match(autoBasicDialog.message,/是否将不存在的学院、专业、班级、年级等信息自动添加到“基础数据维护”中/,"student organization auto-add confirmation copy is incorrect"); await page.waitForTimeout(120);
  const autoBasicImported=await page.evaluate(() => ({student:students.some((s)=>s.id==="QA009"&&s.dept==="自动学院"&&s.major==="自动专业"&&s.grade==="2028级"&&s.cls==="自动班"&&s.enrollType==="自动招生类别"),dept:ORG_DEPTS.some((x)=>x.name==="自动学院"),major:ORG_MAJORS.some((x)=>x.name==="自动专业"&&x.dept==="自动学院"),grade:ORG_GRADES.some((x)=>x.name==="2028级"),cls:ORG_CLASSES.some((x)=>x.name==="自动班"&&x.dept==="自动学院"&&x.major==="自动专业"&&x.grade==="2028级"),enrollType:ORG_ENROLL_TYPES.some((x)=>x.name==="自动招生类别")})); assert.deepStrictEqual(autoBasicImported,{student:true,dept:true,major:true,grade:true,cls:true,enrollType:true},"confirming student import did not add the full hierarchy to basic data and continue importing"); await page.evaluate(() => closeModal());
  const autoBasicCancel=await page.evaluate(() => {const original=window.confirm;window.confirm=()=>false;const before={d:ORG_DEPTS.length,m:ORG_MAJORS.length,g:ORG_GRADES.length,c:ORG_CLASSES.length};const result=confirmAndAddMissingStudentBasicData([{id:"QA-CANCEL",dept:"取消学院",major:"取消专业",grade:"2029级",cls:"取消班"}],"新增学生");window.confirm=original;return {result,unchanged:before.d===ORG_DEPTS.length&&before.m===ORG_MAJORS.length&&before.g===ORG_GRADES.length&&before.c===ORG_CLASSES.length};}); assert.deepStrictEqual(autoBasicCancel,{result:false,unchanged:true},"cancelling automatic basic-data maintenance must not write organization data");
  await page.evaluate(() => stuAdd()); assert.strictEqual(await page.locator("#fStatus").getAttribute("required"), "", "student status must be required in the add/edit form"); assert.deepStrictEqual(await page.locator("#fStatus option").allTextContents(), ["在校生","休学","退学","转专业（转出）","已毕业","延期毕业","其他"], "student form must retain exactly the existing status choices"); await page.locator("#fId").fill("QA010"); await page.locator("#fName").fill("新增自动维护验收"); await page.locator("#fDept").fill("新增学院"); await page.locator("#fMajor").fill("新增专业"); await page.locator("#fGrade").fill("2030级"); await page.locator("#fCls").fill("新增班");
  const addStudentConfirm=new Promise((resolve,reject)=>page.once("dialog",async(dialog)=>{try{const message=dialog.message();await dialog.accept();resolve(message);}catch(error){reject(error);}})); await page.locator("#modalOk").click(); assert.match(await addStudentConfirm,/是否将不存在的学院、专业、班级、年级等信息自动添加到“基础数据维护”中/,"new-student form did not use the basic-data auto-add confirmation"); await page.waitForTimeout(120); assert.strictEqual(await page.evaluate(()=>students.some((s)=>s.id==="QA010"&&s.dept==="新增学院"&&s.major==="新增专业"&&s.grade==="2030级"&&s.cls==="新增班")&&ORG_CLASSES.some((x)=>x.name==="新增班"&&x.dept==="新增学院"&&x.major==="新增专业"&&x.grade==="2030级")),true,"new-student confirmation did not add basic data and save the student");
  await studentMappedWizard(page, csv("student-custom-headers.csv", ["学生编号", "学生姓名", "所属院系", "就读专业", "行政班", "所在年级", "学生状态"], ["QA006", "映射验收庚", "错误学院", "错误专业", "测试班", "错误年级", "在校"]), { "学号": "学生编号", "姓名": "学生姓名", "学院": "所属院系", "专业": "就读专业", "班级": "行政班", "年级": "所在年级", "学籍状态": "学生状态" }, () => students.some((s) => s.id === "QA006" && s.name === "映射验收庚" && s.dept === "测试学院" && s.major === "测试专业" && s.grade === "2025级"));
  const titledWorkbook = path.join(temp, "student-custom-title.xlsx");
  const titledBytes = await page.evaluate(() => Array.from(buildXlsx("自定义学生表", [
    ["2025级学生信息汇总表", "制表日期：2026-08-30", "", "", "", "", ""],
    ["学生编号", "学生姓名", "所属院系", "就读专业", "行政班", "所在年级", "学生状态"],
    ["QA007", "标题行映射验收辛", "测试学院", "测试专业", "测试班", "2025级", "在校"]
  ])));
  fs.writeFileSync(titledWorkbook, Buffer.from(titledBytes));
  await studentMappedWizard(page, titledWorkbook, { "学号": "学生编号", "姓名": "学生姓名", "学院": "所属院系", "专业": "就读专业", "班级": "行政班", "年级": "所在年级", "学籍状态": "学生状态" }, () => students.some((s) => s.id === "QA007" && s.name === "标题行映射验收辛"));
  const denseTitleWorkbook = path.join(temp, "student-dense-title.xlsx");
  const denseTitleBytes = await page.evaluate(() => Array.from(buildXlsx("自定义学生表", [
    Array.from({ length: 20 }, (_, i) => `汇总说明${i + 1}`),
    ["学生编号", "学生姓名", "所属院系", "就读专业", "行政班", "所在年级", "学生状态"],
    ["QA008", "密集标题映射验收", "测试学院", "测试专业", "测试班", "2025级", "在校"]
  ])));
  fs.writeFileSync(denseTitleWorkbook, Buffer.from(denseTitleBytes));
  await studentMappedWizard(page, denseTitleWorkbook, { "学号": "学生编号", "姓名": "学生姓名", "学院": "所属院系", "专业": "就读专业", "班级": "行政班", "年级": "所在年级", "学籍状态": "学生状态" }, () => students.some((s) => s.id === "QA008" && s.name === "密集标题映射验收"));
  const titledDormWorkbook = path.join(temp, "dorm-custom-title.xlsx");
  const titledDormBytes = await page.evaluate(() => Array.from(buildXlsx("住宿分配", [
    ["住宿分配汇总", "制表日期：2026-08-30", "", "", ""],
    ["学生编号", "住宿类别", "宿舍楼", "寝室", "床号"],
    ["QA006", "校内", "B栋", "202", "2"]
  ])));
  fs.writeFileSync(titledDormWorkbook, Buffer.from(titledDormBytes));
  await mappedWizard(page, () => dormImport(), titledDormWorkbook, { "学号": "学生编号", "住宿情况": "住宿类别", "宿舍楼": "宿舍楼", "房间号": "寝室", "床位号": "床号" }, () => { const student=students.find((s) => s.id === "QA006"); return !!student && student.building === "B栋" && student.room === "202" && student.bed === "2"; }, /尚未在“公寓资源”中建立[\s\S]*自动新增这些宿舍楼、房间及所需床位/);
  await verifyStudentExamNo(page);
  await page.locator('[data-workbench-progress]').waitFor({state:'detached',timeout:4000}).catch(()=>{});
  const studentImportHeaders = ["学号", "姓名", "学院", "专业", "班级", "年级", "学籍状态"];
  await page.evaluate(() => stuImport()); await page.locator("#stuImportFile").setInputFiles(csv("student-template.csv", studentImportHeaders, [["QA003", "模板验收丙", "测试学院", "测试专业", "测试班", "2025级", "在校"], ["※ 下方为模板说明，请勿作为学生数据导入", "", "", "", "", "", ""]])); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /校验数据/ }).click(); await page.waitForTimeout(350); assert.doesNotMatch(await page.locator("#modalBody").innerText(), /错误清单/, "template note rows must be ignored"); await page.locator("#stuImpGoBtn").click();
  await page.waitForFunction(()=>window.__studentImportState?.imported===true); await page.waitForTimeout(80); assert.strictEqual(await page.evaluate(() => students.filter((s) => s.id === "QA003").length), 1, "template data import did not persist exactly one student"); await page.evaluate(() => closeModal());
  await page.evaluate(() => stuImport()); await page.locator("#stuImportFile").setInputFiles(csv("student-duplicate.csv", studentImportHeaders, [["QA004", "重复验收丁", "测试学院", "测试专业", "测试班", "2025级", "在校"], ["QA004", "重复验收戊", "测试学院", "测试专业", "测试班", "2025级", "在校"]])); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /下一步/ }).click(); await page.getByRole("button", { name: /校验数据/ }).click(); await page.waitForTimeout(600); assert.match(await page.locator("#modalBody").innerText(), /导入文件内学号重复/, "duplicate student IDs inside one import file must be rejected"); await page.locator("#stuImpGoBtn").click();
  await page.waitForFunction(()=>window.__studentImportState?.imported===true); await page.waitForTimeout(80); assert.strictEqual(await page.evaluate(() => students.filter((s) => s.id === "QA004").length), 0, "duplicate student IDs must not create any student"); await page.evaluate(() => closeModal());
  const studentValidation = await page.evaluate(() => { const mapping = STU_IMPORT_FIELDS.map((f) => ({ sysKey: f[0], sysLabel: f[1], required: f[2] })); const error = stuImportValidate([{ "学号": "QA005", "姓名": "格式错误己", "班级": "测试班", "性别": "未知", "身份证号": "123", "出生日期": "2026-2-30", "入学日期": "202601", "学籍状态": "未知状态" }], mapping, "add").errors[0]; return { field: error.field, msg: error.msg }; });
  ["性别","身份证号","出生日期","入学日期","学籍状态"].forEach((field)=>assert.match(studentValidation.field,new RegExp(field),`student field validation must enforce ${field}`));
  const identityForm = await page.evaluate(() => {
    stuAdd();
    const input=document.querySelector("#fIdcard"),birth=document.querySelector("#fBirth"),gender=document.querySelector("#fGender");
    const recognize=(number)=>{birth.value="";gender.value="";input.value=number;input.dispatchEvent(new Event("input",{bubbles:true}));return {birth:birth.value,gender:gender.value};};
    const result={mainland:recognize("320101200601011235")};
    input.value="A123456(3)";input.dispatchEvent(new Event("input",{bubbles:true}));result.changedToHongKong={birth:birth.value,gender:gender.value};
    Object.assign(result,{residence:recognize("820000200601011223"),taiwan:recognize("A123456789"),hongKong:recognize("A123456(3)"),macau:recognize("1234567(8)")});
    closeModal();return result;
  });
  assert.deepStrictEqual(identityForm,{mainland:{birth:"20060101",gender:"男"},changedToHongKong:{birth:"",gender:""},residence:{birth:"20060101",gender:""},taiwan:{birth:"",gender:""},hongKong:{birth:"",gender:""},macau:{birth:"",gender:""}},"student form must auto-fill gender only for mainland identity numbers and clear stale auto-filled values after a number change");
  const identityCsv=csv("student-identity.csv",["学号","姓名","班级","学籍状态","身份证号"],[
    ["QA104","大陆身份证验收","测试班","在校","320101200601011235"],
    ["QA100","港居住证验收","测试班","在校","81000020060101123X"],
    ["QA101","台湾身份证验收","测试班","在校","A123456789"],
    ["QA102","香港身份证验收","测试班","在校","A123456(3)"],
    ["QA103","澳门身份证验收","测试班","在校","1234567(8)"]
  ]);
  await studentMappedWizard(page,identityCsv,{},()=>{
    const rows=["QA104","QA100","QA101","QA102","QA103"].map(id=>students.find(student=>student.id===id));
    return rows.every(Boolean)&&rows[0].birth==="20060101"&&rows[0].gender==="男"&&rows[1].birth==="20060101"&&![rows[1].gender,rows[2].birth,rows[2].gender,rows[3].birth,rows[3].gender,rows[4].birth,rows[4].gender].some(Boolean);
  });
  assert.strictEqual(await page.evaluate(() => stuPhotoImportKey("A123456(7)")===stuPhotoImportKey("a1234567")),true,"Hong Kong identity photos should match with or without parentheses");
  const studentEnumValidation = await page.evaluate(() => { const mapping=STU_IMPORT_FIELDS.map((f)=>({sysKey:f[0],sysLabel:f[1],required:f[2]})); const invalid=stuImportValidate([{ "学号":"QA095", "姓名":"枚举错误验收", "班级":"测试班", "民族":"汉", "政治面貌":"少先队员", "学籍状态":"在读" }],mapping,"add").errors[0]; const valid=stuImportValidate([{ "学号":"QA096", "姓名":"枚举正确验收", "班级":"测试班", "民族":"汉族", "政治面貌":"群众", "学籍状态":"在校生" }],mapping,"add"); return {invalid,validCount:valid.ok.length,validErrorCount:valid.errors.length}; });
  assert.match(studentEnumValidation.invalid.field, /民族[\s\S]*政治面貌[\s\S]*学籍状态/, "student import must validate ethnicity, political status and enrollment status together");
  assert.match(studentEnumValidation.invalid.msg, /“汉”不是系统现有民族[\s\S]*“少先队员”不是系统现有政治面貌[\s\S]*“在读”不是系统现有学籍状态/, "student import enum errors must show the actual invalid values");
  assert.deepStrictEqual({validCount:studentEnumValidation.validCount,validErrorCount:studentEnumValidation.validErrorCount},{validCount:1,validErrorCount:0},"student import must accept current system enum values");
  await require("./qa-import-template-validation.cjs")(page,path.join(root,"tests",".qa-import-template-validation"));
  const studentEnumWriteGuard = await page.evaluate(() => { let message=""; const originalAlert=window.alert; window.alert=(value)=>{message=String(value||"");}; const result=writeImportedRows([{ "学号":"QA097", "姓名":"绕过校验验收", "班级":"测试班", "民族":"汉", "政治面貌":"群众", "学籍状态":"在校" }],"add"); window.alert=originalAlert; return {result,message,exists:students.some((student)=>student.id==="QA097")}; });
  assert.deepStrictEqual({result:studentEnumWriteGuard.result,exists:studentEnumWriteGuard.exists},{result:false,exists:false},"student import write path must reject invalid enum values even when validation is bypassed");
  assert.match(studentEnumWriteGuard.message,/学生导入已停止[\s\S]*QA097[\s\S]*民族[\s\S]*“汉”不是系统现有民族/,"student import rejection dialog must identify the row, student and invalid value");
  const studentImportRules = await page.evaluate(() => { const required=Object.fromEntries(STU_IMPORT_FIELDS.map((f) => [f[1],f[2]])); const mapping=STU_IMPORT_FIELDS.map((f) => ({ sysKey:f[0],sysLabel:f[1],required:f[2] })); const unknown=stuImportValidate([{ "学号":"QA099", "姓名":"未知班级验收", "班级":"不存在班", "学籍状态":"在校" }],mapping,"add").errors[0]; const missingStatus=stuImportValidate([{ "学号":"QA098", "姓名":"缺状态验收", "班级":"测试班", "学籍状态":"" }],mapping,"add").errors[0]; return { required,unknown,missingStatus }; });
  assert.deepStrictEqual({ 学院:studentImportRules.required["学院"],专业:studentImportRules.required["专业"],年级:studentImportRules.required["年级"],班级:studentImportRules.required["班级"],学籍状态:studentImportRules.required["学籍状态"] }, { 学院:false,专业:false,年级:false,班级:true,学籍状态:true }, "student import required flags are incorrect");
  assert.match(studentImportRules.missingStatus.field, /学籍状态/, "student import must reject an empty enrollment status");
  assert.match(studentImportRules.unknown.msg, /自动添加新班级需同时填写：学院、专业、年级/, "student import must require a complete hierarchy before auto-adding an unmaintained class");
  const studentFileLimits = await page.evaluate(() => ({ invalidType: stuImportFileError(new File(["x"], "students.txt")), oversized: stuImportFileError(new File([new Uint8Array(STU_IMPORT_MAX_FILE_BYTES + 1)], "students.csv")) }));
  assert.match(studentFileLimits.invalidType, /仅支持/, "student import must reject unsupported file types"); assert.match(studentFileLimits.oversized, /超过 5 MB/, "student import must enforce the 5 MB file limit");
  await wizard(page, () => dormImport(), csv("dorm.csv", ["学号", "住宿情况", "楼栋", "房间号", "床位号"], ["QA001", "校内", "A栋", "101", "1"]), () => students.find((s) => s.id === "QA001").building === "A栋", /尚未在“公寓资源”中建立[\s\S]*自动新增这些宿舍楼、房间及所需床位/);
  await page.evaluate(() => { window.academicTerms = [{ id: 901, term: "2025-2026-1学期", rows: [] }]; saveAcademicTerms(); });
  await wizard(page, () => academicImportPreview(901), csv("academic.csv", ["学号", "姓名", "学院", "年级", "班级", "综合测评总分", "排名"], ["QA001", "错误姓名", "错误学院", "错误年级", "错误班级", "88.5", "2/30"]), () => academicTermById(901).rows.some((r) => r["学号"] === "QA001" && r["姓名"] === "导入验收甲" && Number(r["综测分数"]) === 88.5));
  assert.deepStrictEqual(await page.evaluate(()=>{const row=academicTermById(901).rows.find(r=>r["学号"]==="QA001"),student=students.find(s=>s.id==="QA001");return {dept:row["学院"]===student.dept,grade:row["年级"]===student.grade,cls:row["班级"]===student.cls};}),{dept:true,grade:true,cls:true},"academic import must overwrite supplied organization fields from the matched student");
  await page.evaluate(()=>academicImportPreview(901));
  await page.locator("#mappedImportFile").setInputFiles(csv("academic-no-org-columns.csv",["学号","姓名","综合测评总分","排名"],["QA002","错误姓名","91.25","1/30"]));
  await page.getByRole("button",{name:/下一步/}).click();await page.getByRole("button",{name:/下一步/}).click();
  for(const field of ["学院","年级","班级"]){const row=page.locator(".import-field-table tbody tr").filter({has:page.locator(`input[value="${field}"]`)});assert.strictEqual(await row.locator("td").last().innerText(),"");assert.strictEqual(await row.locator("select").inputValue(),"");}
  await page.getByRole("button",{name:/校验数据/}).click();const studentLinkLayer=page.locator("#studentLinkImportLayer");if(await studentLinkLayer.count())await studentLinkLayer.getByRole("button",{name:/确认并继续导入/}).click();await page.getByRole("button",{name:/确认导入/}).click();
  await page.waitForFunction(()=>academicTermById(901).rows.some(r=>r["学号"]==="QA002"));
  assert.strictEqual(await page.evaluate(()=>{const row=academicTermById(901).rows.find(r=>r["学号"]==="QA002"),student=students.find(s=>s.id==="QA002");return row["姓名"]===student.name&&row["学院"]===student.dept&&row["年级"]===student.grade&&row["班级"]===student.cls&&Number(row["综测分数"])===91.25;}),true,"academic import without organization columns did not sync by student ID");
  await page.evaluate(()=>closeModal());
  await page.evaluate(()=>{window.academicTerms.push({id:903,term:"2025-2026-1学期",rows:[]});saveAcademicTerms();});
  await wizard(page,()=>academicImportPreview(903),csv("academic-empty-org.csv",["学号","姓名","学院","年级","班级","综合测评总分"],["QA001","导入验收甲","","","","92"]),()=>{const row=academicTermById(903).rows.find(r=>r["学号"]==="QA001"),student=students.find(s=>s.id==="QA001");return !!row&&row["学院"]===student.dept&&row["年级"]===student.grade&&row["班级"]===student.cls;});
  await page.evaluate(async()=>{await window.workbench.legacy.flushStore();});
  await page.reload({waitUntil:"networkidle"});
  assert.strictEqual(await page.evaluate(()=>{const row=academicTermById(901).rows.find(r=>r["学号"]==="QA002"),student=students.find(s=>s.id==="QA002");return row["学院"]===student.dept&&row["年级"]===student.grade&&row["班级"]===student.cls;}),true,"synced academic organization fields were not persisted");
  await page.evaluate(() => { window.academicWarningTerms = [{ id: 902, term: "2025-2026-1学期", rows: [] }]; saveAcademicWarningTerms(); });
  await wizard(page, () => academicWarningOpenMappedImport(902, "list"), csv("warning.csv", ["学号", "姓名", "预警等级", "不及格门数"], ["QA001", "导入验收甲", "黄色", "2"]), () => academicWarningTermById(902).rows.some((r) => r["学号"] === "QA001" && r["预警等级"] === "黄色"));
  await wizard(page, () => academicWarningOpenMappedImport(902, "course"), csv("warning-course.csv", ["学号", "课程名称", "课程代码", "成绩"], ["QA001", "高等数学", "MATH001", "55"]), () => academicWarningTermById(902).rows[0].courses.some((r) => r["课程名称"] === "高等数学"));
  await wizard(page, () => employmentIntentionImport(), csv("intention.csv", ["班级", "学号", "姓名", "就业意向"], ["错误班级", "QA001", "错误姓名", "市场就业"]), () => employmentIntentionRecords.some((r) => r.sid === "QA001" && r.name === "导入验收甲" && r.cls === "测试班"));
  await page.evaluate(async () => { await goto("employment");employmentSwitchTab("intention");employmentIntentionSetGraduateYear(''); });
  assert.match(await page.locator("#employmentIntentionTable").innerText(), /QA001[\s\S]*导入验收甲[\s\S]*2026届[\s\S]*市场就业/, "employment intention roster did not retain the imported answer for a graduate student");
  assert.doesNotMatch(await page.locator("#employmentIntentionTable").innerText(), /QA002/, "student without a graduation year entered the employment intention roster");
  await page.evaluate(async () => { const student=students.find((item) => item.id === "QA002");student.graduateYear="2027届";student.name="毕业名单同步乙";persistStudents();await workbench.legacy.flushStore();renderPage("employment"); });
  assert.match(await page.locator("#employmentIntentionTable").innerText(), /QA002[\s\S]*毕业名单同步乙[\s\S]*2027届[\s\S]*未填写/, "employment intention roster did not add or refresh a student after graduation-year maintenance");
  await page.evaluate(async () => { const student=students.find((item) => item.id === "QA002");student.graduateYear="";student.name="导入验收乙";persistStudents();await workbench.legacy.flushStore();renderPage("employment"); });
  assert.doesNotMatch(await page.locator("#employmentIntentionTable").innerText(), /QA002/, "employment intention roster did not remove a student after graduation year was cleared");
  await page.evaluate(()=>window.workbench.legacy.flushStore());
  await wizard(page, () => openDirectModuleImport("classroom"), csv("classroom.csv", ["学号", "课程", "日期"], ["QA001", "大学英语", "2026-08-13"]), () => students.find((s) => s.id === "QA001").classroom.some((r) => r.course === "大学英语"));
  await wizard(page, () => openDirectModuleImport("meeting"), csv("meeting.csv", ["学期", "班级", "班会主题", "日期"], ["2025-2026-1学期", "测试班、测试二班", "导入验收班会", "2026-08-13"]), () => meetings.some((r) => r.topic === "导入验收班会" && Array.isArray(r.classes) && r.classes.length === 2 && r.classes.includes("测试二班")));
  await wizard(page, () => partyImportOpen(), csv("party.csv", ["学号", "当前发展阶段", "团员身份"], ["QA001", "递交入党申请书", "团员"]), () => students.find((s) => s.id === "QA001").party.stage === "递交入党申请书");
  await wizard(page, () => openDirectModuleImport("talks"), csv("talk.csv", ["学号", "谈话日期", "谈话内容"], ["QA001", "2026-08-13", "导入验收谈话"]), () => talkRecords.some((r) => r.sid === "QA001" && r.content === "导入验收谈话"));
  await wizard(page, () => openDirectModuleImport("psych"), csv("psych.csv", ["学号", "关怀等级", "关注问题"], ["QA001", "关注", "睡眠"]), () => students.find((s) => s.id === "QA001").psych.level === "关注");
  await wizard(page, () => openDirectModuleImport("home"), csv("home.csv", ["学号", "日期", "沟通内容"], ["QA001", "2026-08-13", "导入验收家校联系"]), () => homeRecords.some((r) => r.sid === "QA001" && r.content === "导入验收家校联系"));
  await wizard(page, () => openDirectModuleImport("events"), csv("event.csv", ["学号", "日期", "类型", "谈话内容"], ["QA001", "2026-08-13", "日常", "导入验收事件"]), () => eventRecords.some((r) => r.sid === "QA001" && r.content === "导入验收事件"));
  await wizard(page, () => openDirectModuleImport("checkClass"), csv("checkclass.csv", ["班级", "课程", "日期", "应到人数", "实到人数", "请假总人数", "旷课名单（学号，多个用顿号分隔）", "事假名单（学号，多个用顿号分隔）", "病假名单（学号，多个用顿号分隔）", "迟到名单（学号，多个用顿号分隔）", "早退名单（学号，多个用顿号分隔）"], ["测试班", "高等数学", "2026-08-13", "", "", "2", "QA002", "QA001", "QA002", "QA001", "QA002"]), () => { const record=checkClassRecords.find((r) => r.cls === "测试班" && r.course === "高等数学"), linked=(id,type) => students.find((s) => s.id === id).classroom.some((item) => item.sourceCheckClassId === record.id && item.type === type); return !!record && record.headcount === "" && record.attended === "" && record.leave === "2" && record.personalLeaveStudentIds.length === 1 && record.sickLeaveStudentIds.length === 1 && record.leaveStudentIds.length === 2 && record.lateStudentIds.length === 1 && record.earlyStudentIds.length === 1 && linked("QA002","旷课") && linked("QA001","事假") && linked("QA002","病假") && linked("QA001","迟到") && linked("QA002","早退"); });
  await wizard(page, () => openDirectModuleImport("help"), csv("help.csv", ["学号", "日期", "帮扶内容"], ["QA001", "2026-08-13", "导入验收帮扶"]), () => helpRecords.some((r) => r.sid === "QA001" && r.content === "导入验收帮扶"));
  await wizard(page, () => openDirectModuleImport("checkDorm"), csv("checkdorm.csv", ["楼栋", "宿舍号", "日期"], ["A栋", "101", "2026-08-13"]), () => checkDormRecords.some((r) => r.building === "A栋" && r.room === "101"));
  await legacy(page, () => employmentResourceImport(), "#erImportFile", csv("employment-resource.csv", ["资源名称", "地域", "方向", "主办单位", "官方网址", "状态"], ["验收就业资源", "全国", "综合", "测试单位", "https://example.edu/import-resource", "待核验"]), () => employmentResourceRecords.some((r) => r.title === "验收就业资源"));
  await legacy(page, () => subjectCompetitionImport(), "#scImportFile", csv("competition.csv", ["竞赛名称", "竞赛级别", "方向", "主办单位", "官网", "状态"], ["验收科创竞赛", "省级", "信息技术", "测试单位", "https://example.edu/import-competition", "待核验"]), () => subjectCompetitionRecords.some((r) => r.title === "验收科创竞赛"));
  await page.evaluate(async () => { await goto("certificate"); const raw=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJ+QAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)); await certImportFiles([new File([raw], "QA001-cert.png", { type: "image/png" })]); }); await page.waitForTimeout(220); assert.strictEqual(await page.evaluate(() => certificateRecords.some((r) => r.attachment && r.attachment.name === "QA001-cert.png" && r.attachment.id)), true, "certificate image import did not persist attachment");
  await maintenance(page, "dept", "学院代码\t学院名称\nQZ\t验收学院", () => ORG_DEPTS.some((r) => r.code === "QZ" && r.name === "验收学院"));
  await maintenance(page, "dept", "学院代码\t学院名称\n\t免代码学院", () => ORG_DEPTS.some((r) => r.name === "免代码学院" && r.code === ""));
  await maintenanceMappedFile(page, "dept", csv("dept-custom-headers.csv", ["单位编码", "单位全称"], ["QC", "映射验收学院"]), { "学院代码": "单位编码", "学院名称": "单位全称" }, () => ORG_DEPTS.some((r) => r.code === "QC" && r.name === "映射验收学院"));
  await maintenanceMappedFile(page, "dept", csv("dept-name-only.csv", ["单位全称"], ["免代码映射学院"]), { "学院名称": "单位全称" }, () => ORG_DEPTS.some((r) => r.code === "" && r.name === "免代码映射学院"));
  await maintenance(page, "major", "专业代码\t专业名称\t所属学院\t学制\nQZ01\t验收专业\t验收学院\t4", () => ORG_MAJORS.some((r) => r.code === "QZ01" && r.name === "验收专业" && r.dept === "验收学院"));
  await maintenance(page, "major", "专业代码\t专业名称\t所属学院\t学制\n\t免代码专业\t免代码学院\t4", () => ORG_MAJORS.some((r) => r.name === "免代码专业" && r.code === "" && r.dept === "免代码学院"));
  await maintenanceMappedFile(page, "major", csv("major-name-only.csv", ["专业全称", "归属学院"], ["免代码映射专业", "免代码映射学院"]), { "专业名称": "专业全称", "所属学院": "归属学院" }, () => ORG_MAJORS.some((r) => r.code === "" && r.name === "免代码映射专业" && r.dept === "免代码映射学院"));
  await page.evaluate(() => {window.maintTab="d2";goto("maint");}); await page.waitForTimeout(80);
  let optionalCodeRow=page.locator("#content tbody tr").filter({hasText:"免代码专业"}).last();
  await optionalCodeRow.getByRole("button",{name:"编辑",exact:true}).click();
  assert.strictEqual(await page.locator("#omCode").inputValue(),"","blank major code was not retained during editing");
  await page.locator("#omName").fill("免代码专业已编辑"); await page.locator("#modalOk").click(); await page.waitForTimeout(80);
  optionalCodeRow=page.locator("#content tbody tr").filter({hasText:"免代码专业已编辑"}).last(); await optionalCodeRow.locator('input[type="checkbox"]').check();
  page.once("dialog",(dialog) => dialog.accept()); await page.evaluate(() => maintMajorDel()); await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => ORG_MAJORS.some((r) => r.name === "免代码专业已编辑")),false,"blank-code major could not be deleted by its internal row key");
  await page.evaluate(() => {window.maintTab="d1";goto("maint");}); await page.waitForTimeout(80);
  optionalCodeRow=page.locator("#content tbody tr").filter({hasText:"免代码学院"}).last();
  await optionalCodeRow.getByRole("button",{name:"编辑",exact:true}).click();
  assert.strictEqual(await page.locator("#odCode").inputValue(),"","blank college code was not retained during editing");
  await page.locator("#odName").fill("免代码学院已编辑"); await page.locator("#modalOk").click(); await page.waitForTimeout(80);
  optionalCodeRow=page.locator("#content tbody tr").filter({hasText:"免代码学院已编辑"}).last(); await optionalCodeRow.locator('input[type="checkbox"]').check();
  page.once("dialog",(dialog) => dialog.accept()); await page.evaluate(() => maintDeptDel()); await page.waitForTimeout(80);
  assert.strictEqual(await page.evaluate(() => ORG_DEPTS.some((r) => r.name === "免代码学院已编辑")),false,"blank-code college could not be deleted by its internal row key");
  await maintenance(page, "class", "班级名称\t年级\t专业\t所属学院\t辅导员\t班主任\t学历\t招生类别\n验收班\t2027级\t验收专业\t验收学院\t验收辅导员\t验收班主任\t本科\t普通本科", () => ORG_CLASSES.some((r) => r.name === "验收班" && r.major === "验收专业"));
  await maintenance(page, "grade", "年级名称\n2027级", () => ORG_GRADES.some((r) => r.name === "2027级"));
  assert.strictEqual(await page.evaluate(() => {const added=window.__DORM_SPATIAL__.ensureBuilding("验收区","Q栋");return !!added&&window.__DORM_SPATIAL__.buildingRows().some((r) => r.zone === "验收区" && r.building === "Q栋");}),true,"public apartment resources could not create a dorm building");
  await restoreAllData(page);
  assert.deepStrictEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log("qa-imports: passed (student, photo, certificate image, fund, dorm, academic, warning list/course, employment, employment resources, competition resources, maintenance dept/major/class/grade, apartment resources, classroom, meeting, party, talk, psych, home, events, checkClass, checkDorm, help, full backup restore)");
}
main().catch(async(error) => {
  console.error(error.stack || error);
  if(activePage&&!activePage.isClosed()){
    try{
      const diagnostic=await activePage.evaluate(()=>({modals:[...document.querySelectorAll('[aria-modal=true]')].filter(n=>n.getBoundingClientRect().height).map(n=>({id:n.id,text:n.textContent.slice(0,1000)})),title:document.getElementById('modalTitle')?.textContent,body:document.getElementById('modalBody')?.textContent.slice(0,1400)}));
      console.error('Failure browser diagnostics',diagnostic);
      await activePage.screenshot({path:path.join(root,'docs','综合导入失败诊断-2026-10-17.png'),fullPage:true});
    }catch(_){}
  }
  process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  if(child)child.kill();await sleep(200);
  const relative=path.relative(os.tmpdir(),path.resolve(temp));
  if(!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(temp).startsWith('shuzhi-import-qa-'))fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});
});
