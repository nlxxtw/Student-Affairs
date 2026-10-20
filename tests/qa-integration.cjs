"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-integration-"));
const port = Number(process.env.XIANGCAI_QA_PORT || 18872);
const origin = `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let childDiagnostics = "";

function runPowerShell(command, environment = {}) {
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const result = require("child_process").spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { cwd: temp, env: Object.assign({}, process.env, environment), encoding: "utf8", timeout: 120000, windowsHide: true });
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, `PowerShell Word QA failed: ${String(result.stderr || result.stdout || "").slice(-3000)}`);
  return String(result.stdout || "").trim();
}

function wordContains(file, text) {
  return runPowerShell('$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;try{$doc=$word.Documents.Open($env:AW_DOC_PATH,$false,$true);if(([string]$doc.Content.Text).Contains($env:AW_EXPECT)){"FOUND"}else{"MISSING"}}finally{if($null-ne $doc){$doc.Close(0)};$word.Quit();[gc]::Collect();[gc]::WaitForPendingFinalizers()}', { AW_DOC_PATH: file, AW_EXPECT: text });
}

function wordFirstTableCourses(file, count) {
  const output = runPowerShell('$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;try{$doc=$word.Documents.Open($env:AW_DOC_PATH,$false,$true);$table=$doc.Tables.Item(1);$rows=@();$widths=@();for($slot=0;$slot-lt[int]$env:AW_COURSE_COUNT;$slot++){$row=4+$slot;$values=@();$rowWidths=@();foreach($column in 2,3,4){$cell=$table.Cell($row,$column);$text=[string]$cell.Range.Text;$values+=$text.Trim([char]13,[char]7);$rowWidths+=[math]::Round($cell.Width,1)};$rows+=,$values;$widths+=,$rowWidths};$doc.Repaginate();$json=@{rowCount=$table.Rows.Count;pageCount=$doc.ComputeStatistics(2);courses=$rows;widths=$widths}|ConvertTo-Json -Depth 4 -Compress;[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))}finally{if($null-ne $doc){$doc.Close(0)};$word.Quit();[gc]::Collect();[gc]::WaitForPendingFinalizers()}', { AW_DOC_PATH: file, AW_COURSE_COUNT: String(count) });
  return JSON.parse(Buffer.from(output, "base64").toString("utf8"));
}

async function request(urlPath, options = {}) {
  let response;
  try { response = await fetch(origin + urlPath, options); }
  catch (error) { throw new Error(`${error.message}: ${urlPath}\n${childDiagnostics.slice(-3000)}`, { cause: error }); }
  const bytes = Buffer.from(await response.arrayBuffer());
  let body;
  try { body = JSON.parse(bytes.toString("utf8")); } catch (_error) { body = bytes; }
  return { response, bytes, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const health=await request("/api/health");if(health.response.ok&&health.body.service==="xiangcai-workbench"&&health.body.pid===child?.pid)return; } catch (_error) {}
    if (child && child.exitCode !== null) throw new Error("isolated server exited before startup: " + childDiagnostics.slice(-2000));
    await delay(100);
  }
  throw new Error("isolated server did not start: " + childDiagnostics.slice(-2000));
}

async function stopServer() {
  if (!child || child.killed) return;
  child.kill("SIGTERM"); await delay(500); child = null;
}

function writeLegacyPasswordWrapper(password) {
  const portablePath = path.join(temp, "data", "portable-data-key.json");
  const dataKey = Buffer.from(JSON.parse(fs.readFileSync(portablePath, "utf8")).key, "base64");
  const params = { version: 1, N: 16384, r: 8, p: 1, salt: crypto.randomBytes(16).toString("base64") };
  const digest = (salt) => crypto.scryptSync(password, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 });
  params.hash = digest(Buffer.from(params.salt, "base64")).toString("base64");
  const keySalt = crypto.randomBytes(16), keyIv = crypto.randomBytes(12), wrappingKey = digest(keySalt);
  const cipher = crypto.createCipheriv("aes-256-gcm", wrappingKey, keyIv); cipher.setAAD(Buffer.from("xiangcai-data-key-v1", "utf8"));
  params.keySalt = keySalt.toString("base64"); params.keyIv = keyIv.toString("base64"); params.keyCiphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]).toString("base64"); params.keyTag = cipher.getAuthTag().toString("base64");
  wrappingKey.fill(0); dataKey.fill(0);
  const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(path.join(temp, "data", "workbench.db"));
  db.prepare("INSERT INTO local_auth(id,password_json,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET password_json=excluded.password_json,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(params)); db.close(); fs.unlinkSync(portablePath);
}

async function main() {
  for (const name of [
    "web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css",
    "license-client.js",
    "update-client.js",
    "update-config.json",
    "license-config.json",
    "demo-data.js",
    "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js",
    "dorm-spatial-module.js", "dorm-spatial-module.css",
    "achievement-enhancements.js",
    "award-statistics-module.js",
    "dorm-roster-module.js", "custom-roster-module.js",
    "intelligence-enhancements.js",
    "searchable-filter-selects.js",
    "searchable-filter-selects.css",
    "index.html",
    "login.html",
    "学生组织管理.html",
    "other-violation-module.js"
  ]) fs.copyFileSync(path.join(root, name), path.join(temp, name));
  fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
  fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
  fs.mkdirSync(path.join(temp, "assets"));
  fs.mkdirSync(path.join(temp, "scripts"));
  fs.copyFileSync(path.join(root, "assets", "academic-warning-template.doc"), path.join(temp, "assets", "academic-warning-template.doc"));
  fs.copyFileSync(path.join(root, "assets", "academic-warning-editor-template.html"), path.join(temp, "assets", "academic-warning-editor-template.html"));
  fs.copyFileSync(path.join(root, "assets", "html2pdf.bundle.min.js"), path.join(temp, "assets", "html2pdf.bundle.min.js"));
  fs.copyFileSync(path.join(root, "assets", "jszip.min.js"), path.join(temp, "assets", "jszip.min.js"));
  fs.copyFileSync(path.join(root, "assets", "xlsx.full.min.js"), path.join(temp, "assets", "xlsx.full.min.js"));
  for (const name of ["workbench-ui.js", "workbench-ui.css", "tool-history-client.js", "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-template.xlsx", "academic-analysis-field-template.xlsx", "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js", "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css"]) {
    fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
  }
  fs.copyFileSync(path.join(root, "assets", "login-logo.png"), path.join(temp, "assets", "login-logo.png"));
  fs.copyFileSync(path.join(root, "assets", "login-logo-icon.png"), path.join(temp, "assets", "login-logo-icon.png"));
  fs.copyFileSync(path.join(root, "scripts", "generate-academic-warning.ps1"), path.join(temp, "scripts", "generate-academic-warning.ps1"));
  fs.copyFileSync(path.join(root, "scripts", "validate-academic-warning-template.ps1"), path.join(temp, "scripts", "validate-academic-warning-template.ps1"));
  fs.copyFileSync(path.join(root, "scripts", "academic-analysis-engine.py"), path.join(temp, "scripts", "academic-analysis-engine.py"));
  installTestLicense(temp);
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { childDiagnostics = (childDiagnostics + chunk.toString("utf8")).slice(-4000); });
  child.stderr.on("data", (chunk) => { childDiagnostics = (childDiagnostics + chunk.toString("utf8")).slice(-4000); });
  await waitForServer();
  assert.ok(!fs.readdirSync(path.join(temp, "backups")).some((name) => /^workbench-auto-.*\.db$/i.test(name)), "server startup must not create an automatic backup");

  const authStatus = await request("/api/auth/status");
  assert.strictEqual(authStatus.body.mode, "ready", "fresh workbench must start in password-free mode");
  assert.ok(fs.existsSync(path.join(temp, "data", "portable-data-key.json")), "portable data key must be stored with the project data");
  const setup = await request("/", { redirect: "manual" });
  assert.strictEqual(setup.response.status, 200, "direct workbench entry must be available without a login page");
  const cookie = String(setup.response.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("xiangcai_session="));
  const headers = { "Content-Type": "application/json", Cookie: cookie, Origin: origin };

  const retiredKnowledgeWrite = await request("/api/store/nnuzc_kb", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([{ id: "retired-kb", title: "不得恢复" }]) }) });
  assert.strictEqual(retiredKnowledgeWrite.response.status, 410, "retired knowledge data must reject direct writes");
  const retiredKnowledgeBatchWrite = await request("/api/store/batch", { method: "POST", headers, body: JSON.stringify({ operations: [{ key: "nnuzc_kb", method: "PUT", value: "[]" }] }) });
  assert.strictEqual(retiredKnowledgeBatchWrite.response.status, 410, "retired knowledge data must reject batch writes");
  const retiredKnowledgeRestore = await request("/api/store/restore-json", { method: "POST", headers, body: JSON.stringify({ data: { nnuzc_kb: [{ id: "legacy-kb", title: "旧备份知识" }] } }) });
  assert.strictEqual(retiredKnowledgeRestore.response.status, 200, JSON.stringify(retiredKnowledgeRestore.body));
  assert.strictEqual(retiredKnowledgeRestore.body.restoredKeys, 0, "retired knowledge key was restored from a JSON backup");
  assert.deepStrictEqual(retiredKnowledgeRestore.body.skippedRetiredKeys, ["nnuzc_kb"], "retired knowledge restore was not reported as skipped");
  const retiredKnowledgeRead = await request("/api/store/nnuzc_kb", { headers });
  assert.strictEqual(retiredKnowledgeRead.body.value, null, "retired knowledge data remains readable from persistent storage");
  assert.strictEqual(retiredKnowledgeRead.body.retired, true, "retired knowledge store endpoint did not report retirement");
  const storeAfterKnowledgeRetirement = await request("/api/store", { headers });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(storeAfterKnowledgeRetirement.body, "nnuzc_kb"), false, "retired knowledge key remains in full-data exports");

  const warningTemplateDefaultStatus = await request("/api/academic-warning/template/status", { headers: { Cookie: cookie, Origin: origin } });
  assert.strictEqual(warningTemplateDefaultStatus.response.status, 200, JSON.stringify(warningTemplateDefaultStatus.body));
  assert.strictEqual(warningTemplateDefaultStatus.body.mode, "default", "fresh workbench must use the default academic-warning Word template");
  const warningTemplateDefault = await request("/api/academic-warning/template", { headers: { Cookie: cookie, Origin: origin } });
  assert.strictEqual(warningTemplateDefault.response.status, 200, "academic-warning Word template download must succeed");
  assert.ok(warningTemplateDefault.bytes.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])), "downloaded academic-warning template is not a Word .doc file");
  const invalidWarningTemplate = await request("/api/academic-warning/template?name=invalid.doc", { method: "POST", headers: { "Content-Type": "application/octet-stream", Cookie: cookie, Origin: origin }, body: Buffer.from("not-a-word-file") });
  assert.strictEqual(invalidWarningTemplate.response.status, 400, "invalid academic-warning template must be rejected before replacing the active template");
  const customMarker = "自定义模板验证标记", customTemplatePath = path.join(temp, "custom-academic-warning-template.doc");
  fs.writeFileSync(customTemplatePath, warningTemplateDefault.bytes);
  runPowerShell('$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;try{$doc=$word.Documents.Open($env:AW_DOC_PATH,$false,$false);$range=$doc.Content;$range.Find.ClearFormatting();$range.Find.Replacement.ClearFormatting();$changed=$range.Find.Execute($env:AW_OLD_TEXT,$false,$false,$false,$false,$false,$true,1,$false,$env:AW_NEW_TEXT,2);if(-not $changed){throw "target text was not found"};$doc.Save()}finally{if($null-ne $doc){$doc.Close(0)};$word.Quit();[gc]::Collect();[gc]::WaitForPendingFinalizers()}', { AW_DOC_PATH: customTemplatePath, AW_OLD_TEXT: "学业预警通知书", AW_NEW_TEXT: `学业预警通知书（${customMarker}）` });
  assert.strictEqual(wordContains(customTemplatePath, customMarker), "FOUND", "Word QA did not modify the custom academic-warning template");
  const customTemplateBytes=fs.readFileSync(customTemplatePath);
  const customWarningTemplate = await request("/api/academic-warning/template?name=" + encodeURIComponent("自定义学业预警附件1-5.doc"), { method: "POST", headers: { "Content-Type": "application/octet-stream", Cookie: cookie, Origin: origin }, body: customTemplateBytes });
  assert.strictEqual(customWarningTemplate.response.status, 200, JSON.stringify(customWarningTemplate.body));
  assert.strictEqual(customWarningTemplate.body.mode, "custom", "validated custom academic-warning template was not activated");
  const customWarningTemplateDownload = await request("/api/academic-warning/template", { headers: { Cookie: cookie, Origin: origin } });
  assert.strictEqual(crypto.createHash("sha256").update(customWarningTemplateDownload.bytes).digest("hex"), crypto.createHash("sha256").update(customTemplateBytes).digest("hex"), "custom academic-warning template download differs from the imported file");

  const academicHistoryInitial = await request("/api/academic-analysis/history", { headers: { Cookie: cookie, Origin: origin } });
  assert.strictEqual(academicHistoryInitial.response.status, 200, JSON.stringify(academicHistoryInitial.body));
  assert.deepStrictEqual(academicHistoryInitial.body.records, [], "fresh workbench must start with no academic analysis history");
  const academicFieldTemplate = await request("/assets/academic-analysis-field-template.xlsx", { headers: { Cookie: cookie, Origin: origin } });
  assert.strictEqual(academicFieldTemplate.response.status, 200, "academic analysis field template download must succeed");
  assert.strictEqual(academicFieldTemplate.response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "academic field template must retain the XLSX MIME type");
  assert.match(String(academicFieldTemplate.response.headers.get("content-disposition") || ""), /filename\*=UTF-8''/i, "academic field template must return a UTF-8 filename");
  assert.ok(academicFieldTemplate.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "academic field template must be a valid XLSX/ZIP file");

  const academicAnalysisFixture = String(process.env.ACADEMIC_ANALYSIS_FIXTURE || "").trim();
  if (academicAnalysisFixture && fs.existsSync(academicAnalysisFixture)) {
    const analyzed = await request("/api/academic-analysis/run?filename=" + encodeURIComponent(path.basename(academicAnalysisFixture)), { method: "POST", headers: { "Content-Type": "application/octet-stream", Cookie: cookie, Origin: origin }, body: fs.readFileSync(academicAnalysisFixture) });
    assert.strictEqual(analyzed.response.status, 200, JSON.stringify(analyzed.body));
    assert.strictEqual(analyzed.body.ok, true, "academic analysis endpoint must complete");
    assert.ok(analyzed.body.overview.classes > 0 && analyzed.body.overview.students > 0, "academic analysis overview is empty");
    assert.ok(analyzed.body.aiSummary && Array.isArray(analyzed.body.aiSummary.class_metrics), "academic analysis anonymous AI summary is missing");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(analyzed.body.aiSummary, "source_file"), false, "academic analysis AI payload must not expose the source filename");
    assert.ok(analyzed.body.aiSummary.class_metrics.every((row) => !Object.prototype.hasOwnProperty.call(row, "class") && !Object.prototype.hasOwnProperty.call(row, "students_detail")), "academic analysis AI payload must not contain class names or student details");
    for (const key of ["summary", "reports", "audit"]) {
      const downloaded = await request(analyzed.body.downloads[key], { headers: { Cookie: cookie, Origin: origin } });
      assert.strictEqual(downloaded.response.status, 200, `academic analysis ${key} download failed`);
      if (key !== "audit") assert.strictEqual(downloaded.bytes.subarray(0, 2).toString("binary"), "PK", `academic analysis ${key} is not a ZIP-based file`);
    }
    const academicHistory = await request("/api/academic-analysis/history", { headers: { Cookie: cookie, Origin: origin } });
    assert.strictEqual(academicHistory.response.status, 200, JSON.stringify(academicHistory.body));
    assert.strictEqual(academicHistory.body.records.length, 1, "completed academic analysis must be persisted in history");
    assert.strictEqual(academicHistory.body.records[0].runId, analyzed.body.runId, "history must identify the completed academic analysis run");
    assert.strictEqual(academicHistory.body.records[0].sourceFile, path.basename(academicAnalysisFixture), "history must preserve the source filename");
    assert.ok(academicHistory.body.records[0].available.summary && academicHistory.body.records[0].available.reports && academicHistory.body.records[0].available.audit, "history downloads are incomplete");
    const deletedAcademicRun = await request("/api/academic-analysis/run/" + encodeURIComponent(analyzed.body.runId), { method: "DELETE", headers: { Cookie: cookie, Origin: origin } });
    assert.strictEqual(deletedAcademicRun.response.status, 200, JSON.stringify(deletedAcademicRun.body));
    assert.strictEqual(deletedAcademicRun.body.deleted, true, "academic analysis generated files were not deleted");
    const academicHistoryAfterDelete = await request("/api/academic-analysis/history", { headers: { Cookie: cookie, Origin: origin } });
    assert.deepStrictEqual(academicHistoryAfterDelete.body.records, [], "deleted academic analysis run is still listed");
    assert.strictEqual((await request(analyzed.body.downloads.summary, { headers: { Cookie: cookie, Origin: origin } })).response.status, 404, "deleted academic analysis file is still downloadable");
  }

  assert.strictEqual((await request("/api/store")).response.status, 401, "store must reject unauthenticated access");
  const webdavInitial = await request("/api/webdav/status", { headers });
  assert.strictEqual(webdavInitial.response.status, 200, JSON.stringify(webdavInitial.body));
  assert.strictEqual(webdavInitial.body.configured, false, "fresh workbench must not have WebDAV credentials");
  const rejectedWebdav = await request("/api/webdav/config", { method: "PUT", headers, body: JSON.stringify({ url: "http://dav.example.test/", username: "teacher", password: "app-password" }) });
  assert.strictEqual(rejectedWebdav.response.status, 400, "WebDAV configuration must require HTTPS");
  const savedWebdav = await request("/api/webdav/config", { method: "PUT", headers, body: JSON.stringify({ url: "https://dav.example.test/remote/", username: "teacher", password: "app-password", remoteFile: "shuzhi-xuegong-backup.szwd" }) });
  assert.strictEqual(savedWebdav.response.status, 200, JSON.stringify(savedWebdav.body));
  assert.strictEqual(savedWebdav.body.hasPassword, true, "WebDAV status must confirm a saved authorization code without returning it");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(savedWebdav.body, "password"), false, "WebDAV status must never expose the authorization code");
  const rejectedWebdavBackup = await request("/api/webdav/backup", { method: "POST", headers, body: JSON.stringify({ syncPassword: "short" }) });
  assert.strictEqual(rejectedWebdavBackup.response.status, 400, "WebDAV backup must require a strong non-persisted sync password");
  const value = JSON.stringify([{ id: "probe", ok: true }]);
  assert.strictEqual((await request("/api/store/nnuzc_qa_probe", { method: "PUT", headers, body: JSON.stringify({ value }) })).response.status, 200);
  const store = await request("/api/store", { headers });
  assert.strictEqual(JSON.parse(store.body.nnuzc_qa_probe)[0].ok, true);
  const batchSaved = await request("/api/store/batch", { method: "POST", headers, body: JSON.stringify({ operations: [{ key: "nnuzc_qa_batch_a", method: "PUT", value: JSON.stringify({ value: "A" }) }, { key: "nnuzc_qa_batch_b", method: "PUT", value: JSON.stringify({ value: "B" }) }] }) });
  assert.strictEqual(batchSaved.response.status, 200, JSON.stringify(batchSaved.body));
  assert.strictEqual(batchSaved.body.count, 2, "store batch did not commit every operation");
  const failedBatch = await request("/api/store/batch", { method: "POST", headers, body: JSON.stringify({ operations: [{ key: "nnuzc_qa_probe", method: "PUT", value: JSON.stringify([{ id: "probe", ok: false }]) }, { key: "nnuzc_students", method: "PUT", value: "not-json" }] }) });
  assert.ok(failedBatch.response.status >= 400, "invalid store batch unexpectedly succeeded");
  const storeAfterFailedBatch = await request("/api/store", { headers });
  assert.strictEqual(JSON.parse(storeAfterFailedBatch.body.nnuzc_qa_probe)[0].ok, true, "failed store batch left an earlier key partially committed");

  /* Recycle-bin pilot: authoritative preview -> atomic move -> restore/purge. */
  const recycleOrg = { depts: [{ name: "测试学院", code: "QA01" }], majors: [{ name: "测试专业", code: "QA0101", dept: "测试学院", years: "4" }], classes: [{ name: "测试班", dept: "测试学院", major: "测试专业", grade: "2026级", counselor: "测试老师", teacher: "测试老师", level: "本科", enrollType: "普通招生" }], grades: [{ name: "2026级" }], dorms: [], enrollTypes: [{ name: "普通招生" }] };
  const recycleStudent = { id: "QA2026001", name: "回收站测试学生", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2026级", status: "在校" };
  const archiveStudent = { id: "QA2026002", name: "整档回收测试学生", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2026级", status: "在校", party: { stage: "共青团员", leagueStatus: "团员", history: [{ id: "qa-party-history", stage: "共青团员", date: "2026-09-01" }] }, classroom: [{ id: "qa-classroom-history", term: "2026-2027-1学期", type: "请假", date: "2026-09-25" }], dorm: [{ id: "qa-dorm-violation-history", term: "2026-2027-1学期", type: "晚归", date: "2026-09-24" }], psych: { level: "关注", note: "整档回收测试" } };
  assert.strictEqual((await request("/api/store/nnuzc_orgs", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(recycleOrg) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_students", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([recycleStudent, archiveStudent]) }) })).response.status, 200);
  const recycleAttachment = await request("/api/attachments?name=recycle-proof.txt", { method: "POST", headers: Object.assign({}, headers, { "Content-Type": "application/octet-stream" }), body: Buffer.from("recycle-attachment") });
  assert.strictEqual(recycleAttachment.response.status, 201, JSON.stringify(recycleAttachment.body));
  const sharedFile = recycleAttachment.body;

  /* Student archive: the student and every currently supported linked ledger move and restore together. */
  const archiveLinkedStores = {
    nnuzc_punishments: [{ id: "qa-archive-punish", type: "school", studentId: archiveStudent.id, term: "2026-2027-1学期", level: "警告" }],
    nnuzc_talks: [{ id: "qa-archive-talk", sid: archiveStudent.id, name: archiveStudent.name, term: "2026-2027-1学期", date: "2026-09-25" }],
    nnuzc_home: [{ id: "qa-archive-home", sid: archiveStudent.id, name: archiveStudent.name, term: "2026-2027-1学期", date: "2026-09-25" }],
    nnuzc_events: [{ id: "qa-archive-event", sid: archiveStudent.id, name: archiveStudent.name, date: "2026-09-25", files: [sharedFile] }],
    nnuzc_help: [{ id: "qa-archive-help", sid: archiveStudent.id, name: archiveStudent.name, date: "2026-09-25" }],
    nnuzc_dorm_dist: [{ id: "qa-archive-dorm", studentId: archiveStudent.id, name: archiveStudent.name, building: "1栋", room: "101", bed: "1号床" }],
    nnuzc_fund_records: [{ id: "qa-archive-fund", studentId: archiveStudent.id, name: archiveStudent.name, term: "2026-2027-1学期" }],
    nnuzc_student_loan_records: [{ id: "qa-archive-loan", studentId: archiveStudent.id, name: archiveStudent.name, year: "2026-2027学年" }],
    nnuzc_class_officer_records: [{ id: "qa-archive-officer", studentId: archiveStudent.id, studentName: archiveStudent.name, role: "班长" }],
    nnuzc_employment: [{ id: "qa-archive-employment", sid: archiveStudent.id, name: archiveStudent.name }],
    nnuzc_employment_intentions: [{ id: "qa-archive-intention", sid: archiveStudent.id, name: archiveStudent.name }],
    nnuzc_tasks: [{ id: "qa-archive-task", studentId: archiveStudent.id, title: "整档测试任务" }],
    nnuzc_keycare: [{ id: "qa-archive-care", studentId: archiveStudent.id, studentName: archiveStudent.name }],
    nnuzc_other_violation_records: [{ id: "qa-archive-violation", studentId: archiveStudent.id, name: archiveStudent.name, term: "2026-2027-1学期", files: [sharedFile] }],
    nnuzc_achievement_records: [{ id: "qa-archive-achievement", sid: archiveStudent.id, name: archiveStudent.name, awardName: "整档测试奖项", attachment: sharedFile }],
    nnuzc_awards: [{ id: "qa-archive-legacy-award", studentId: archiveStudent.id, name: archiveStudent.name, title: "旧版整档测试奖项" }],
    nnuzc_award_statistics_records: [{ id: "qa-archive-award-stat", sid: archiveStudent.id, name: archiveStudent.name, honorTitle: "整档测试荣誉", certificate: sharedFile }],
    nnuzc_certificate_records: [{ id: "qa-archive-certificate", sid: archiveStudent.id, name: archiveStudent.name, attachment: sharedFile, status: "confirmed" }],
    nnuzc_academic_terms: [{ id: "qa-archive-academic-term", term: "2026-2027-1学期", rows: [{ _rid: "qa-archive-academic", "学号": archiveStudent.id, "姓名": archiveStudent.name }] }],
    nnuzc_academic_warnings: [{ id: "qa-archive-warning-term", term: "2026-2027-1学期", rows: [{ _rid: "qa-archive-warning", "学号": archiveStudent.id, "姓名": archiveStudent.name, "预警等级": "黄色" }] }],
    nnuzc_grade_terms: [{ id: "qa-archive-grade-term", term: "2026-2027-1学期", rows: [{ _rid: "qa-archive-grade", "学号": archiveStudent.id, "姓名": archiveStudent.name, "学分加权平均分": "85" }] }],
    nnuzc_class_officer_assessment_terms: [{ id: "qa-archive-officer-term", term: "2026-2027-1学期", rows: [{ id: "qa-archive-officer-assessment", studentId: archiveStudent.id, position: "班长", level: "优秀" }] }]
  };
  const archiveTermStoreKeys = new Set(["nnuzc_academic_terms", "nnuzc_academic_warnings", "nnuzc_grade_terms", "nnuzc_class_officer_assessment_terms"]);
  const archiveSpatialState = {
    schemaVersion: 3,
    settings: { defaultBedCount: 4, maxBedCount: 30 },
    buildings: [{ id: "qa-building-1", zone: "测试区", building: "1栋", status: "active" }],
    rooms: [{ id: "qa-room-101", zone: "测试区", building: "1栋", floor: "1", room: "101", bedCount: 4, status: "active" }],
    assignments: [
      { id: "qa-archive-assignment-current", studentId: archiveStudent.id, roomId: "qa-room-101", bedNo: "1", status: "current" },
      { id: "qa-archive-assignment-history", studentId: archiveStudent.id, roomId: "qa-room-101", bedNo: "2", status: "ended" },
      { id: "qa-other-assignment", studentId: recycleStudent.id, roomId: "qa-room-101", bedNo: "3", status: "current" }
    ],
    leaders: [{ id: "qa-archive-leader", studentId: archiveStudent.id, roomId: "qa-room-101", status: "current" }],
    bedNotes: [{ id: "qa-isolated-bed-note", roomId: "qa-room-101", bedNo: "4", studentName: "独立登记学生", studentNo: archiveStudent.id }],
    audit: [{ id: "qa-archive-spatial-audit", targetId: archiveStudent.id, actionType: "CHECK_IN" }],
    migrations: {}
  };
  const archiveCheckClassRows = [{ id: "qa-checkclass-1", cls: "测试班", term: "2026-2027-1学期", absentStudentIds: [archiveStudent.id], personalLeaveStudentIds: [archiveStudent.id], sickLeaveStudentIds: [recycleStudent.id], leaveStudentIds: [archiveStudent.id, recycleStudent.id], lateStudentIds: [archiveStudent.id], earlyStudentIds: [] }];
  const archiveStudentOrgState = {
    orgs: [{ id: "qa-org-1", name: "整档测试学生会", structure: [{ id: "qa-org-node-1", name: "综合部", members: [{ sid: archiveStudent.id, name: archiveStudent.name, position: "部长" }, { sid: recycleStudent.id, name: recycleStudent.name, position: "干事" }], children: [{ id: "qa-org-node-2", name: "项目组", members: [{ sid: archiveStudent.id, name: archiveStudent.name, position: "负责人" }], children: [] }] }] }],
    activities: [{ id: "qa-org-activity", name: "共享组织活动" }], meetings: [], trainings: [],
    classrooms: [{ id: "qa-org-classroom-archive", sid: archiveStudent.id, sname: archiveStudent.name, item: "志愿服务" }, { id: "qa-org-classroom-other", sid: recycleStudent.id, sname: recycleStudent.name, item: "社会实践" }],
    tasks: [], templates: [], years: [], meta: { createdAt: "2026-09-25T00:00:00.000Z" }
  };
  for (const [storeKey, rows] of Object.entries(archiveLinkedStores)) {
    const saved = await request(`/api/store/${storeKey}`, { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(rows) }) });
    assert.strictEqual(saved.response.status, 200, `${storeKey}: ${JSON.stringify(saved.body)}`);
  }
  assert.strictEqual((await request("/api/store/nnuzc_dorm_spatial_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(archiveSpatialState) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_checkclass", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(archiveCheckClassRows) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_student_org_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(archiveStudentOrgState) }) })).response.status, 200);
  const expectedArchiveRelations = Object.values(archiveLinkedStores).reduce((sum, rows) => sum + (rows[0] && Array.isArray(rows[0].rows) ? rows[0].rows.length : rows.length), 0) + 4 + 4;
  const studentDeletePreview = await request("/api/recycle-bin/student-delete-preview", { method: "POST", headers, body: JSON.stringify({ studentIds: [archiveStudent.id] }) });
  assert.strictEqual(studentDeletePreview.response.status, 200, JSON.stringify(studentDeletePreview.body));
  assert.strictEqual(studentDeletePreview.body.count, 1);
  assert.strictEqual(studentDeletePreview.body.relationCount, expectedArchiveRelations, "student archive preview must count every linked fixture");
  assert.strictEqual(studentDeletePreview.body.attachmentCount, 1, "student archive preview must include linked attachments");
  const studentMoved = await request("/api/recycle-bin/student-move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_student_archive_move_0001", previewToken: studentDeletePreview.body.previewToken, confirmation: "移入回收站" }) });
  assert.strictEqual(studentMoved.response.status, 200, JSON.stringify(studentMoved.body));
  assert.strictEqual(studentMoved.body.studentArchive, true);
  assert.strictEqual(studentMoved.body.items[0].relationCount, expectedArchiveRelations, "student archive move must preserve the preview relation count");
  let studentArchiveStore = await request("/api/store", { headers });
  assert.deepStrictEqual(JSON.parse(studentArchiveStore.body.nnuzc_students).map((row) => row.id), [recycleStudent.id], "student archive move must remove only the selected student");
  for (const storeKey of Object.keys(archiveLinkedStores)) {
    const rows = JSON.parse(studentArchiveStore.body[storeKey] || "[]");
    if (archiveTermStoreKeys.has(storeKey)) assert.ok(rows.every((term) => !(term.rows || []).some((row) => String(row["学号"] || row.studentId) === archiveStudent.id)), `${storeKey} retained the archived student`);
    else assert.strictEqual(rows.length, 0, `${storeKey} retained linked records after student archive move`);
  }
  let archivedSpatial = JSON.parse(studentArchiveStore.body.nnuzc_dorm_spatial_v1 || "{}");
  assert.deepStrictEqual((archivedSpatial.assignments || []).map((row) => row.id), ["qa-other-assignment"], "student archive move retained the selected student's spatial assignments");
  assert.deepStrictEqual(archivedSpatial.leaders || [], [], "student archive move retained the selected student's dorm leader history");
  assert.deepStrictEqual(archivedSpatial.audit || [], [], "student archive move retained the selected student's spatial audit rows");
  assert.strictEqual((archivedSpatial.bedNotes || []).length, 1, "isolated bed notes must not participate in student archive linkage");
  assert.strictEqual((archivedSpatial.rooms || []).length, 1, "dorm room resources must not be removed with one student");
  const archivedCheckClass = JSON.parse(studentArchiveStore.body.nnuzc_checkclass || "[]");
  assert.deepStrictEqual(archivedCheckClass[0].absentStudentIds, [], "student archive move retained the student in a check-class absence list");
  assert.deepStrictEqual(archivedCheckClass[0].personalLeaveStudentIds, [], "student archive move retained the student in a check-class personal-leave list");
  assert.deepStrictEqual(archivedCheckClass[0].sickLeaveStudentIds, [recycleStudent.id], "student archive move changed another student's check-class sick-leave membership");
  assert.deepStrictEqual(archivedCheckClass[0].lateStudentIds, [], "student archive move retained the student in a check-class late list");
  assert.deepStrictEqual(archivedCheckClass[0].leaveStudentIds, [recycleStudent.id], "student archive move changed another student's check-class membership");
  const archivedStudentOrg = JSON.parse(studentArchiveStore.body.nnuzc_student_org_v1 || "{}");
  assert.deepStrictEqual(archivedStudentOrg, archiveStudentOrgState, "student organization data must remain independent when a student master record is deleted");
  assert.strictEqual(archivedStudentOrg.activities.length, 1, "shared student-organization activities must not be removed with one student");
  const studentRecycleList = await request("/api/recycle-bin?moduleKey=student", { headers });
  assert.strictEqual(studentRecycleList.body.total, 1, "student archive must appear in the recycle bin");
  assert.strictEqual(studentRecycleList.body.items[0].relationCount, expectedArchiveRelations);
  assert.strictEqual((await request(`/attachments/${sharedFile.id}`, { headers: { Cookie: headers.Cookie, Origin: origin } })).response.status, 200, "student archive attachment must remain readable");
  const studentRestorePreview = await request(`/api/recycle-bin/${studentMoved.body.items[0].id}/restore-preview`, { method: "POST", headers, body: "{}" });
  assert.strictEqual(studentRestorePreview.response.status, 200, JSON.stringify(studentRestorePreview.body));
  assert.strictEqual(studentRestorePreview.body.canRestore, true, JSON.stringify(studentRestorePreview.body));
  const studentRestored = await request(`/api/recycle-bin/${studentMoved.body.items[0].id}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_student_archive_restore_0001", previewToken: studentRestorePreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(studentRestored.response.status, 200, JSON.stringify(studentRestored.body));
  studentArchiveStore = await request("/api/store", { headers });
  const restoredArchiveStudent = JSON.parse(studentArchiveStore.body.nnuzc_students).find((row) => row.id === archiveStudent.id);
  assert.ok(restoredArchiveStudent, "student archive restore did not restore the student");
  assert.strictEqual(restoredArchiveStudent.party.history[0].id, "qa-party-history", "student archive restore lost party-development history");
  assert.strictEqual(restoredArchiveStudent.classroom[0].id, "qa-classroom-history", "student archive restore lost classroom-attendance history");
  assert.strictEqual(restoredArchiveStudent.dorm[0].id, "qa-dorm-violation-history", "student archive restore lost dorm-violation history");
  assert.strictEqual(restoredArchiveStudent.psych.note, "整档回收测试", "student archive restore lost embedded student profile data");
  for (const [storeKey, expected] of Object.entries(archiveLinkedStores)) {
    const rows = JSON.parse(studentArchiveStore.body[storeKey] || "[]");
    if (archiveTermStoreKeys.has(storeKey)) assert.ok(rows.some((term) => (term.rows || []).some((row) => String(row["学号"] || row.studentId) === archiveStudent.id)), `${storeKey} did not restore the student row`);
    else assert.ok(rows.some((row) => row.id === expected[0].id), `${storeKey} did not restore its linked record`);
  }
  const restoredSpatial = JSON.parse(studentArchiveStore.body.nnuzc_dorm_spatial_v1 || "{}");
  assert.ok((restoredSpatial.assignments || []).some((row) => row.id === "qa-archive-assignment-current") && (restoredSpatial.assignments || []).some((row) => row.id === "qa-archive-assignment-history"), "student archive restore did not restore spatial assignment history");
  assert.ok((restoredSpatial.leaders || []).some((row) => row.id === "qa-archive-leader"), "student archive restore did not restore dorm leader history");
  assert.ok((restoredSpatial.audit || []).some((row) => row.id === "qa-archive-spatial-audit"), "student archive restore did not restore spatial audit history");
  const restoredCheckClass = JSON.parse(studentArchiveStore.body.nnuzc_checkclass || "[]");
  assert.deepStrictEqual(restoredCheckClass[0].absentStudentIds, [archiveStudent.id], "student archive restore did not restore the check-class absence membership");
  assert.deepStrictEqual(restoredCheckClass[0].lateStudentIds, [archiveStudent.id], "student archive restore did not restore the check-class late membership");
  const restoredStudentOrg = JSON.parse(studentArchiveStore.body.nnuzc_student_org_v1 || "{}");
  assert.ok(restoredStudentOrg.orgs[0].structure[0].members.some((member) => member.sid === archiveStudent.id), "student archive restore did not restore the student-organization membership");
  assert.ok(restoredStudentOrg.orgs[0].structure[0].children[0].members.some((member) => member.sid === archiveStudent.id), "student archive restore did not restore the nested student-organization role");
  assert.ok(restoredStudentOrg.classrooms.some((row) => row.id === "qa-org-classroom-archive"), "student archive restore did not restore the organization second-classroom row");

  /* A conflicting student must reject the whole restore without partially restoring linked ledgers. */
  const studentConflictDeletePreview = await request("/api/recycle-bin/student-delete-preview", { method: "POST", headers, body: JSON.stringify({ studentIds: [archiveStudent.id] }) });
  const studentConflictMoved = await request("/api/recycle-bin/student-move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_student_archive_move_0002", previewToken: studentConflictDeletePreview.body.previewToken, confirmation: "移入回收站" }) });
  assert.strictEqual(studentConflictMoved.response.status, 200, JSON.stringify(studentConflictMoved.body));
  let dependencyStore = await request("/api/store", { headers });
  const spatialWithoutStudent = JSON.parse(dependencyStore.body.nnuzc_dorm_spatial_v1 || "{}");
  const spatialWithoutRoom = Object.assign({}, spatialWithoutStudent, { rooms: [] });
  const checkClassWithoutStudent = JSON.parse(dependencyStore.body.nnuzc_checkclass || "[]");
  const studentOrgWithoutStudent = JSON.parse(dependencyStore.body.nnuzc_student_org_v1 || "{}");
  const studentOrgWithoutNode = JSON.parse(JSON.stringify(studentOrgWithoutStudent)); studentOrgWithoutNode.orgs[0].structure = [];
  assert.strictEqual((await request("/api/store/nnuzc_dorm_spatial_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(spatialWithoutRoom) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_checkclass", { method: "PUT", headers, body: JSON.stringify({ value: "[]" }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_student_org_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(studentOrgWithoutNode) }) })).response.status, 200);
  const missingRoomPreview = await request(`/api/recycle-bin/${studentConflictMoved.body.items[0].id}/restore-preview`, { method: "POST", headers, body: "{}" });
  assert.strictEqual(missingRoomPreview.response.status, 200, JSON.stringify(missingRoomPreview.body));
  assert.strictEqual(missingRoomPreview.body.canRestore, false);
  assert.ok(missingRoomPreview.body.missingDependencies.some((item) => item.type === "DORM_ROOM_MISSING"), "student restore preview must report a missing dorm room resource");
  assert.ok(missingRoomPreview.body.missingDependencies.some((item) => item.type === "CHECK_CLASS_RECORD_MISSING"), "student restore preview must report a missing check-class source record");
  assert.ok(!missingRoomPreview.body.missingDependencies.some((item) => /^STUDENT_ORG_/.test(item.type)), "student restore must not depend on the independent student-organization module");
  const missingRoomRestore = await request(`/api/recycle-bin/${studentConflictMoved.body.items[0].id}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_student_archive_restore_missing_room", previewToken: missingRoomPreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(missingRoomRestore.response.status, 409, "missing dorm room must reject the whole student archive restore");
  dependencyStore = await request("/api/store", { headers });
  assert.ok(!JSON.parse(dependencyStore.body.nnuzc_students).some((row) => row.id === archiveStudent.id), "failed dependency restore partially restored the student");
  assert.deepStrictEqual(JSON.parse(dependencyStore.body.nnuzc_achievement_records || "[]"), [], "failed dependency restore partially restored achievement data");
  assert.strictEqual((await request("/api/store/nnuzc_dorm_spatial_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(spatialWithoutStudent) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_checkclass", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(checkClassWithoutStudent) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_student_org_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(studentOrgWithoutStudent) }) })).response.status, 200);
  assert.strictEqual((await request("/api/store/nnuzc_students", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([recycleStudent, archiveStudent]) }) })).response.status, 200);
  const studentConflictPreview = await request(`/api/recycle-bin/${studentConflictMoved.body.items[0].id}/restore-preview`, { method: "POST", headers, body: "{}" });
  assert.strictEqual(studentConflictPreview.response.status, 200, JSON.stringify(studentConflictPreview.body));
  assert.strictEqual(studentConflictPreview.body.canRestore, false);
  assert.ok(studentConflictPreview.body.conflicts.some((item) => item.type === "STUDENT_EXISTS"), "student restore preview must report the existing student");
  const studentConflictRestore = await request(`/api/recycle-bin/${studentConflictMoved.body.items[0].id}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_student_archive_restore_conflict", previewToken: studentConflictPreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(studentConflictRestore.response.status, 409, "conflicted student archive restore must fail atomically");
  studentArchiveStore = await request("/api/store", { headers });
  assert.deepStrictEqual(JSON.parse(studentArchiveStore.body.nnuzc_talks || "[]"), [], "failed student archive restore partially restored linked data");
  assert.strictEqual((await request("/api/store/nnuzc_students", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([recycleStudent]) }) })).response.status, 200);
  const studentConflictResolvedPreview = await request(`/api/recycle-bin/${studentConflictMoved.body.items[0].id}/restore-preview`, { method: "POST", headers, body: "{}" });
  const studentConflictResolved = await request(`/api/recycle-bin/${studentConflictMoved.body.items[0].id}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_student_archive_restore_0002", previewToken: studentConflictResolvedPreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(studentConflictResolved.response.status, 200, JSON.stringify(studentConflictResolved.body));

  const punishRows = [
    { id: "qa-punish-1", type: "school", studentId: recycleStudent.id, term: "2026-2027-1学期", level: "通报批评", files: [sharedFile] },
    { id: "qa-punish-2", type: "school", studentId: recycleStudent.id, term: "2026-2027-1学期", level: "警告", files: [sharedFile] }
  ];
  assert.strictEqual((await request("/api/store/nnuzc_punishments", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(punishRows) }) })).response.status, 200);
  const deletePreview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: "punishment", entityType: "punishment_record", entityIds: ["qa-punish-1"] }) });
  assert.strictEqual(deletePreview.response.status, 200, JSON.stringify(deletePreview.body));
  assert.strictEqual(deletePreview.body.attachmentCount, 1, "recycle preview must detect referenced attachments");
  const rejectedMove = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_recycle_bad_token", previewToken: deletePreview.body.previewToken + "tampered", confirmation: "移入回收站" }) });
  assert.strictEqual(rejectedMove.response.status, 400, "tampered recycle preview token must be rejected");
  const moveRequestId = "qa_recycle_move_0001";
  const moved = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: moveRequestId, previewToken: deletePreview.body.previewToken, confirmation: "移入回收站" }) });
  assert.strictEqual(moved.response.status, 200, JSON.stringify(moved.body));
  assert.strictEqual(moved.body.count, 1);
  const repeatedMove = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: moveRequestId, previewToken: deletePreview.body.previewToken, confirmation: "移入回收站" }) });
  assert.deepStrictEqual(repeatedMove.body, moved.body, "repeated move request must be idempotent");
  let recycleStore = await request("/api/store", { headers });
  assert.deepStrictEqual(JSON.parse(recycleStore.body.nnuzc_punishments).map((row) => row.id), ["qa-punish-2"], "moved record must leave the authoritative module store");
  let recycleList = await request("/api/recycle-bin", { headers });
  assert.strictEqual(recycleList.body.total, 1, "moved record must appear in recycle bin");
  assert.strictEqual((await request(`/attachments/${sharedFile.id}`, { headers: { Cookie: headers.Cookie, Origin: origin } })).response.status, 200, "attachment must remain readable while data is in recycle bin");
  const restorePreview = await request(`/api/recycle-bin/${moved.body.items[0].id}/restore-preview`, { method: "POST", headers, body: "{}" });
  assert.strictEqual(restorePreview.response.status, 200, JSON.stringify(restorePreview.body));
  assert.strictEqual(restorePreview.body.canRestore, true);
  const restored = await request(`/api/recycle-bin/${moved.body.items[0].id}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_recycle_restore_0001", previewToken: restorePreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(restored.response.status, 200, JSON.stringify(restored.body));
  recycleStore = await request("/api/store", { headers });
  assert.deepStrictEqual(new Set(JSON.parse(recycleStore.body.nnuzc_punishments).map((row) => row.id)), new Set(["qa-punish-1", "qa-punish-2"]), "restored record must return to authoritative module store");

  async function recycleMoveCase(moduleKey, entityType, entityIds, requestId) {
    const preview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey, entityType, entityIds }) });
    assert.strictEqual(preview.response.status, 200, `${moduleKey}: ${JSON.stringify(preview.body)}`);
    const move = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId, previewToken: preview.body.previewToken, confirmation: "移入回收站" }) });
    assert.strictEqual(move.response.status, 200, `${moduleKey}: ${JSON.stringify(move.body)}\n${childDiagnostics}`); return move.body;
  }
  async function recycleRestoreOne(recycleId, requestId) {
    const preview = await request(`/api/recycle-bin/${recycleId}/restore-preview`, { method: "POST", headers, body: "{}" });
    assert.strictEqual(preview.response.status, 200, JSON.stringify(preview.body)); assert.strictEqual(preview.body.canRestore, true, JSON.stringify(preview.body));
    const restore = await request(`/api/recycle-bin/${recycleId}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId, previewToken: preview.body.previewToken, confirmation: "恢复数据" }) });
    assert.strictEqual(restore.response.status, 200, JSON.stringify(restore.body)); return restore.body;
  }

  /* Object stores and deep nested records must be removed and restored without overwriting sibling collections. */
  let specialStore = await request("/api/store", { headers });
  const specialOrgs = JSON.parse(specialStore.body.nnuzc_orgs); specialOrgs.depts.push({ name: "回收学院", code: "RC01" }); specialOrgs.majors.push({ name: "回收专业", code: "RC0101", dept: "回收学院", years: "4" });
  assert.strictEqual((await request("/api/store/nnuzc_orgs", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(specialOrgs) }) })).response.status, 200);
  const majorMoved = await recycleMoveCase("baseMajor", "base_major", ["回收专业"], "qa_special_major_move");
  const deptMoved = await recycleMoveCase("baseDept", "base_department", ["回收学院"], "qa_special_dept_move");
  let specialBatchPreview = await request("/api/recycle-bin/restore-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: [deptMoved.items[0].id, majorMoved.items[0].id] }) });
  assert.strictEqual(specialBatchPreview.body.canRestore, true, JSON.stringify(specialBatchPreview.body));
  let specialBatchRestore = await request("/api/recycle-bin/restore-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_special_org_batch_restore", previewToken: specialBatchPreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(specialBatchRestore.response.status, 200, JSON.stringify(specialBatchRestore.body));
  specialStore = await request("/api/store", { headers }); const restoredOrgs = JSON.parse(specialStore.body.nnuzc_orgs);
  assert.ok(restoredOrgs.depts.some((row) => row.name === "回收学院") && restoredOrgs.majors.some((row) => row.name === "回收专业"), "mixed object-store batch restore lost a collection");

  const warningTerms = [{ id: "qa-warning-term", term: "2026-2027-1学期", rows: [{ _rid: "qa-warning-row", "学号": recycleStudent.id, "姓名": recycleStudent.name, courses: [{ _cid: "qa-warning-course", "课程名称": "高等数学" }] }] }];
  assert.strictEqual((await request("/api/store/nnuzc_academic_warnings", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(warningTerms) }) })).response.status, 200);
  const courseMoved = await recycleMoveCase("academicWarningCourse", "academic_warning_course", ["qa-warning-term::qa-warning-row::qa-warning-course"], "qa_nested_course_move");
  specialStore = await request("/api/store", { headers }); assert.strictEqual(JSON.parse(specialStore.body.nnuzc_academic_warnings)[0].rows[0].courses.length, 0, "nested course was not removed");
  await recycleRestoreOne(courseMoved.items[0].id, "qa_nested_course_restore");
  specialStore = await request("/api/store", { headers }); assert.strictEqual(JSON.parse(specialStore.body.nnuzc_academic_warnings)[0].rows[0].courses[0]._cid, "qa-warning-course", "nested course was not restored");

  const rosterState = { version: 2, activeId: "qa-roster", datasets: [{ id: "qa-roster", name: "回收花名册", state: { fields: [{ key: "name", name: "姓名", fixed: true }, { key: "qa_custom", name: "自定义测试", fixed: false }], rows: [{ id: "qa-roster-row", values: { name: "测试同学", qa_custom: "保留值" } }] } }] };
  assert.strictEqual((await request("/api/store/nnuzc_custom_roster_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(rosterState) }) })).response.status, 200);
  const rosterRowMoved = await recycleMoveCase("customRosterRow", "custom_roster_row", ["qa-roster::qa-roster-row"], "qa_roster_row_move"); await recycleRestoreOne(rosterRowMoved.items[0].id, "qa_roster_row_restore");
  const rosterFieldMoved = await recycleMoveCase("customRosterField", "custom_roster_field", ["qa-roster::qa_custom"], "qa_roster_field_move"); await recycleRestoreOne(rosterFieldMoved.items[0].id, "qa_roster_field_restore");
  specialStore = await request("/api/store", { headers }); const restoredRoster = JSON.parse(specialStore.body.nnuzc_custom_roster_v1).datasets[0].state;
  assert.strictEqual(restoredRoster.rows[0].values.qa_custom, "保留值"); assert.ok(restoredRoster.fields.some((field) => field.key === "qa_custom"), "custom roster field or values were not restorable");

  const spatialSpecial = { schemaVersion: 3, settings: {}, buildings: [{ id: "qa-special-building", zone: "回收区", building: "9栋" }], rooms: [{ id: "qa-special-room", zone: "回收区", building: "9栋", room: "901", bedCount: 4 }], assignments: [], leaders: [], bedNotes: [{ id: "qa-special-note", roomId: "qa-special-room", bedNo: "1", studentName: "独立登记" }], audit: [], migrations: {} };
  assert.strictEqual((await request("/api/store/nnuzc_dorm_spatial_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(spatialSpecial) }) })).response.status, 200);
  const roomMoved = await recycleMoveCase("dormRoom", "dorm_room", ["qa-special-room"], "qa_dorm_room_move"); specialStore = await request("/api/store", { headers });
  assert.strictEqual(JSON.parse(specialStore.body.nnuzc_dorm_spatial_v1).bedNotes.length, 0, "room recycle must move embedded bed notes"); await recycleRestoreOne(roomMoved.items[0].id, "qa_dorm_room_restore");
  specialStore = await request("/api/store", { headers }); const restoredRoomState = JSON.parse(specialStore.body.nnuzc_dorm_spatial_v1); assert.strictEqual(restoredRoomState.rooms[0].id, "qa-special-room"); assert.strictEqual(restoredRoomState.bedNotes[0].id, "qa-special-note");

  const orgSpecial = { orgs: [{ id: "qa-special-org", name: "回收组织", structure: [{ id: "qa-special-node", name: "办公室", members: [{ _rid: "qa-special-member", sid: recycleStudent.id, name: recycleStudent.name }], children: [{ id: "qa-special-child", name: "项目组", members: [], children: [] }] }] }], activities: [], meetings: [], trainings: [], classrooms: [], tasks: [], templates: [], years: [], meta: {} };
  assert.strictEqual((await request("/api/store/nnuzc_student_org_v1", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(orgSpecial) }) })).response.status, 200);
  const memberMoved = await recycleMoveCase("studentOrgMember", "student_org_member", ["qa-special-org::qa-special-node::qa-special-member"], "qa_org_member_move"); await recycleRestoreOne(memberMoved.items[0].id, "qa_org_member_restore");
  const nodeMoved = await recycleMoveCase("studentOrgNode", "student_org_node", ["qa-special-org::qa-special-child"], "qa_org_node_move"); await recycleRestoreOne(nodeMoved.items[0].id, "qa_org_node_restore");
  specialStore = await request("/api/store", { headers }); const restoredOrg = JSON.parse(specialStore.body.nnuzc_student_org_v1).orgs[0]; assert.strictEqual(restoredOrg.structure[0].members[0]._rid, "qa-special-member"); assert.strictEqual(restoredOrg.structure[0].children[0].id, "qa-special-child");

  let psychStudents = JSON.parse((await request("/api/store", { headers })).body.nnuzc_students); psychStudents.find((row) => row.id === recycleStudent.id).psych = { level: "重点", issues: ["测试"], note: "可恢复" };
  assert.strictEqual((await request("/api/store/nnuzc_students", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(psychStudents) }) })).response.status, 200);
  const psychMoved = await recycleMoveCase("psychProfile", "psych_profile", [recycleStudent.id], "qa_psych_move"); await recycleRestoreOne(psychMoved.items[0].id, "qa_psych_restore");
  specialStore = await request("/api/store", { headers }); assert.strictEqual(JSON.parse(specialStore.body.nnuzc_students).find((row) => row.id === recycleStudent.id).psych.note, "可恢复");

  const linkedCheckId = "qa-linked-check", linkedAttendanceId = "qa-linked-attendance";
  assert.strictEqual((await request("/api/store/nnuzc_checkclass", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([{ id: linkedCheckId, cls: recycleStudent.cls, course: "关联查课" }]) }) })).response.status, 200);
  psychStudents = JSON.parse((await request("/api/store", { headers })).body.nnuzc_students); const linkedStudent = psychStudents.find((row) => row.id === recycleStudent.id); linkedStudent.classroom = (linkedStudent.classroom || []).concat([{ id: linkedAttendanceId, type: "请假", sourceCheckClassId: linkedCheckId, sourceCheckClassType: "请假" }]);
  assert.strictEqual((await request("/api/store/nnuzc_students", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(psychStudents) }) })).response.status, 200);
  const linkedCheckMoved = await recycleMoveCase("checkClassRecord", "check_class_record", [linkedCheckId], "qa_linked_check_move"); specialStore = await request("/api/store", { headers }); { const row = JSON.parse(specialStore.body.nnuzc_students).find((item) => item.id === recycleStudent.id); assert.ok(!(row.classroom || []).some((item) => item.id === linkedAttendanceId), "check-class recycle left generated attendance behind"); }
  await recycleRestoreOne(linkedCheckMoved.items[0].id, "qa_linked_check_restore"); specialStore = await request("/api/store", { headers }); { const row = JSON.parse(specialStore.body.nnuzc_students).find((item) => item.id === recycleStudent.id); assert.ok((row.classroom || []).some((item) => item.id === linkedAttendanceId), "check-class restore did not restore generated attendance"); }

  /* Retention, filtering and audit are server-authoritative and must not expose payloads. */
  assert.strictEqual((await request("/api/store/nnuzc_ai_drafts", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([{ id: "qa-ai-draft", type: "测试草稿", text: "秘密正文" }]) }) })).response.status, 200);
  const draftMoved = await recycleMoveCase("aiDraft", "ai_draft", ["qa-ai-draft"], "qa_ai_draft_move");
  assert.strictEqual((await request("/api/store/nnuzc_ai_drafts", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([{ id: "qa-ai-draft", type: "冲突草稿" }]) }) })).response.status, 200);
  const failedBatchPreview = await request("/api/recycle-bin/restore-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: [draftMoved.items[0].id] }) }); assert.strictEqual(failedBatchPreview.body.canRestore, false, JSON.stringify(failedBatchPreview.body));
  const failedBatchRestore = await request("/api/recycle-bin/restore-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_ai_draft_failed_batch", previewToken: failedBatchPreview.body.previewToken, confirmation: "恢复数据" }) }); assert.strictEqual(failedBatchRestore.response.status, 409, JSON.stringify(failedBatchRestore.body));
  let failedBatchList = await request("/api/recycle-bin?moduleKey=aiDraft", { headers }); assert.strictEqual(failedBatchList.body.items[0].status, "restore_failed", "failed batch restore must remain visible and retryable");
  assert.strictEqual((await request("/api/store/nnuzc_ai_drafts", { method: "PUT", headers, body: JSON.stringify({ value: "[]" }) })).response.status, 200);
  const retained = await request("/api/recycle-bin/retention", { method: "POST", headers, body: JSON.stringify({ ids: [draftMoved.items[0].id], permanent: true }) }); assert.strictEqual(retained.response.status, 200, JSON.stringify(retained.body));
  const permanentList = await request("/api/recycle-bin?moduleKey=aiDraft&expiry=permanent&deleteKind=single", { headers }); assert.strictEqual(permanentList.body.total, 1); assert.strictEqual(permanentList.body.items[0].expiresAt, null);
  const recycleAudit = await request("/api/recycle-bin/audit", { headers }); assert.strictEqual(recycleAudit.response.status, 200, JSON.stringify(recycleAudit.body)); assert.ok(recycleAudit.body.items.some((row) => row.recycleId === draftMoved.items[0].id && row.result === "failed"), "failed batch restore must create an audit record"); assert.ok(!JSON.stringify(recycleAudit.body).includes("秘密正文"), "recycle audit leaked payload data");
  await recycleRestoreOne(draftMoved.items[0].id, "qa_ai_draft_restore");

  /* Multiple student archives must restore in one transaction. */
  psychStudents = JSON.parse((await request("/api/store", { headers })).body.nnuzc_students); const batchStudents = [{ id: "QA2026010", name: "批量甲", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2026级", status: "在校" }, { id: "QA2026011", name: "批量乙", dept: "测试学院", major: "测试专业", cls: "测试班", grade: "2026级", status: "在校" }];
  assert.strictEqual((await request("/api/store/nnuzc_students", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify(psychStudents.concat(batchStudents)) }) })).response.status, 200);
  const multiPreview = await request("/api/recycle-bin/student-delete-preview", { method: "POST", headers, body: JSON.stringify({ studentIds: batchStudents.map((row) => row.id) }) }); const multiMoved = await request("/api/recycle-bin/student-move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_multi_student_move", previewToken: multiPreview.body.previewToken, confirmation: "移入回收站" }) }); assert.strictEqual(multiMoved.response.status, 200, JSON.stringify(multiMoved.body));
  const multiRestorePreview = await request("/api/recycle-bin/restore-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: multiMoved.body.items.map((row) => row.id) }) }); assert.strictEqual(multiRestorePreview.body.canRestore, true, JSON.stringify(multiRestorePreview.body));
  const multiRestored = await request("/api/recycle-bin/restore-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_multi_student_restore", previewToken: multiRestorePreview.body.previewToken, confirmation: "恢复数据" }) }); assert.strictEqual(multiRestored.response.status, 200, JSON.stringify(multiRestored.body));
  specialStore = await request("/api/store", { headers }); assert.ok(batchStudents.every((student) => JSON.parse(specialStore.body.nnuzc_students).some((row) => row.id === student.id)), "batch student restore lost a student");

  const pilotCases = [
    { moduleKey: "studentLoan", entityType: "student_loan_record", storeKey: "nnuzc_student_loan_records", row: { id: "qa-loan-1", year: "2026-2027学年", studentId: recycleStudent.id, name: recycleStudent.name } },
    { moduleKey: "talks", entityType: "talk_record", storeKey: "nnuzc_talks", row: { id: "qa-talk-1", sid: recycleStudent.id, name: recycleStudent.name, date: "2026-09-25" } },
    { moduleKey: "home", entityType: "home_contact", storeKey: "nnuzc_home", row: { id: "qa-home-1", sid: recycleStudent.id, name: recycleStudent.name, date: "2026-09-25" } },
    { moduleKey: "events", entityType: "event_record", storeKey: "nnuzc_events", row: { id: "qa-event-1", sid: recycleStudent.id, name: recycleStudent.name, date: "2026-09-25", type: "日常" } },
    { moduleKey: "checkDorm", entityType: "dorm_inspection_record", storeKey: "nnuzc_checkdorm", row: { id: "qa-dorm-check-1", building: "1栋", room: "101", date: "2026-09-25" } },
    { moduleKey: "help", entityType: "help_record", storeKey: "nnuzc_help", row: { id: "qa-help-1", sid: recycleStudent.id, name: recycleStudent.name, date: "2026-09-25", type: "学业帮扶" } },
    { moduleKey: "meeting", entityType: "meeting_record", storeKey: "nnuzc_meetings", row: { id: "qa-meeting-1", topic: "回收站测试班会", date: "2026-09-25", term: "2026-2027-1学期", cls: "测试班" } }
  ];
  for (const [index, item] of pilotCases.entries()) {
    assert.strictEqual((await request(`/api/store/${item.storeKey}`, { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([item.row]) }) })).response.status, 200, item.storeKey);
    const preview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: item.moduleKey, entityType: item.entityType, entityIds: [item.row.id] }) });
    assert.strictEqual(preview.response.status, 200, JSON.stringify(preview.body));
    const pilotMove = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: `qa_recycle_pilot_${index}_move`, previewToken: preview.body.previewToken, confirmation: "移入回收站" }) });
    assert.strictEqual(pilotMove.response.status, 200, JSON.stringify(pilotMove.body));
    const pilotRestorePreview = await request(`/api/recycle-bin/${pilotMove.body.items[0].id}/restore-preview`, { method: "POST", headers, body: "{}" });
    assert.strictEqual(pilotRestorePreview.body.canRestore, true, JSON.stringify(pilotRestorePreview.body));
    const pilotRestore = await request(`/api/recycle-bin/${pilotMove.body.items[0].id}/restore`, { method: "POST", headers, body: JSON.stringify({ requestId: `qa_recycle_pilot_${index}_restore`, previewToken: pilotRestorePreview.body.previewToken, confirmation: "恢复数据" }) });
    assert.strictEqual(pilotRestore.response.status, 200, JSON.stringify(pilotRestore.body));
  }

  const batchRestoreMoves = [];
  for (const item of pilotCases.slice(0, 2)) {
    const preview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: item.moduleKey, entityType: item.entityType, entityIds: [item.row.id] }) });
    const move = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: `qa_batch_restore_move_${item.moduleKey}`, previewToken: preview.body.previewToken, confirmation: "移入回收站" }) });
    assert.strictEqual(move.response.status, 200, JSON.stringify(move.body));batchRestoreMoves.push(move.body.items[0].id);
  }
  const batchRestorePreview = await request("/api/recycle-bin/restore-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: batchRestoreMoves }) });
  assert.strictEqual(batchRestorePreview.response.status, 200, JSON.stringify(batchRestorePreview.body));
  assert.strictEqual(batchRestorePreview.body.canRestore, true);
  const batchRestored = await request("/api/recycle-bin/restore-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_batch_restore_commit", previewToken: batchRestorePreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(batchRestored.response.status, 200, JSON.stringify(batchRestored.body));
  assert.strictEqual(batchRestored.body.restored, 2, "batch restore must commit every selected module in one operation");

  const conflictMoves = [];
  for (const item of pilotCases.slice(0, 2)) {
    const preview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: item.moduleKey, entityType: item.entityType, entityIds: [item.row.id] }) });
    const move = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: `qa_batch_conflict_move_${item.moduleKey}`, previewToken: preview.body.previewToken, confirmation: "移入回收站" }) });
    assert.strictEqual(move.response.status, 200, JSON.stringify(move.body));conflictMoves.push(move.body.items[0].id);
  }
  assert.strictEqual((await request("/api/store/nnuzc_student_loan_records", { method: "PUT", headers, body: JSON.stringify({ value: JSON.stringify([pilotCases[0].row]) }) })).response.status, 200);
  const conflictPreview = await request("/api/recycle-bin/restore-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: conflictMoves }) });
  assert.strictEqual(conflictPreview.response.status, 200, JSON.stringify(conflictPreview.body));
  assert.strictEqual(conflictPreview.body.canRestore, false, "batch restore preview must report ID conflicts");
  const rejectedBatchRestore = await request("/api/recycle-bin/restore-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_batch_conflict_rejected", previewToken: conflictPreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(rejectedBatchRestore.response.status, 409, "conflicted batch restore must fail as one transaction");
  let conflictStore = await request("/api/store", { headers });
  assert.deepStrictEqual(JSON.parse(conflictStore.body.nnuzc_talks || "[]"), [], "failed batch restore must not partially restore another module");
  assert.strictEqual((await request("/api/store/nnuzc_student_loan_records", { method: "PUT", headers, body: JSON.stringify({ value: "[]" }) })).response.status, 200);
  const conflictResolvedPreview = await request("/api/recycle-bin/restore-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: conflictMoves }) });
  const conflictResolved = await request("/api/recycle-bin/restore-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_batch_conflict_resolved", previewToken: conflictResolvedPreview.body.previewToken, confirmation: "恢复数据" }) });
  assert.strictEqual(conflictResolved.response.status, 200, JSON.stringify(conflictResolved.body));
  assert.strictEqual(conflictResolved.body.restored, 2);

  const batchPurgeMoves = [];
  for (const item of pilotCases.slice(3, 5)) {
    const preview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: item.moduleKey, entityType: item.entityType, entityIds: [item.row.id] }) });
    const move = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: `qa_batch_purge_move_${item.moduleKey}`, previewToken: preview.body.previewToken, confirmation: "移入回收站" }) });
    assert.strictEqual(move.response.status, 200, JSON.stringify(move.body));batchPurgeMoves.push(move.body.items[0].id);
  }
  const batchPurgePreview = await request("/api/recycle-bin/purge-batch-preview", { method: "POST", headers, body: JSON.stringify({ ids: batchPurgeMoves }) });
  assert.strictEqual(batchPurgePreview.response.status, 200, JSON.stringify(batchPurgePreview.body));
  const batchPurged = await request("/api/recycle-bin/purge-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_batch_purge_commit", previewToken: batchPurgePreview.body.previewToken, confirmation: "彻底删除" }) });
  assert.strictEqual(batchPurged.response.status, 200, JSON.stringify(batchPurged.body));
  assert.strictEqual(batchPurged.body.purged, 2, "batch purge must remove every selected recycle entry");

  const emptyCase = pilotCases[5];
  const emptyPreview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: emptyCase.moduleKey, entityType: emptyCase.entityType, entityIds: [emptyCase.row.id] }) });
  const emptyMove = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_empty_recycle_move", previewToken: emptyPreview.body.previewToken, confirmation: "移入回收站" }) });
  assert.strictEqual(emptyMove.response.status, 200, JSON.stringify(emptyMove.body));
  const emptyAllPreview = await request("/api/recycle-bin/purge-batch-preview", { method: "POST", headers, body: JSON.stringify({ all: true }) });
  assert.strictEqual(emptyAllPreview.body.count, 1, "clear-all preview must use the authoritative recycle-bin set");
  const emptied = await request("/api/recycle-bin/purge-batch", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_empty_recycle_commit", previewToken: emptyAllPreview.body.previewToken, confirmation: "清空回收站" }) });
  assert.strictEqual(emptied.response.status, 200, JSON.stringify(emptied.body));
  assert.strictEqual(emptied.body.purged, 1, "clear recycle bin must remove every previewed entry");

  const purgePreview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: "punishment", entityType: "punishment_record", entityIds: ["qa-punish-1"] }) });
  const purgeMove = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_recycle_purge_move", previewToken: purgePreview.body.previewToken, confirmation: "移入回收站" }) });
  const purgeId = purgeMove.body.items[0].id;
  const purgeDetail = await request(`/api/recycle-bin/${purgeId}`, { headers });
  const purged = await request(`/api/recycle-bin/${purgeId}/purge`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_recycle_purge_0001", checksum: purgeDetail.body.checksum, confirmation: "彻底删除" }) });
  assert.strictEqual(purged.response.status, 200, JSON.stringify(purged.body));
  assert.strictEqual(purged.body.preservedAttachments, 1, "shared attachment must be preserved when another active record references it");
  assert.strictEqual((await request(`/attachments/${sharedFile.id}`, { headers: { Cookie: headers.Cookie, Origin: origin } })).response.status, 200, "purge must not delete an attachment shared by active data");
  const repeatedPurge = await request(`/api/recycle-bin/${purgeId}/purge`, { method: "POST", headers, body: JSON.stringify({ requestId: "qa_recycle_purge_0001", checksum: purgeDetail.body.checksum, confirmation: "彻底删除" }) });
  assert.deepStrictEqual(repeatedPurge.body, purged.body, "repeated purge request must return the same attachment cleanup result");

  const expirePreview = await request("/api/recycle-bin/delete-preview", { method: "POST", headers, body: JSON.stringify({ moduleKey: "home", entityType: "home_contact", entityIds: ["qa-home-1"] }) });
  const expireMove = await request("/api/recycle-bin/move", { method: "POST", headers, body: JSON.stringify({ requestId: "qa_recycle_expire_move", previewToken: expirePreview.body.previewToken, confirmation: "移入回收站" }) });
  assert.strictEqual(expireMove.response.status, 200, JSON.stringify(expireMove.body));
  const { DatabaseSync } = require("node:sqlite");
  const recycleDb = new DatabaseSync(path.join(temp, "data", "workbench.db"));
  recycleDb.prepare("UPDATE recycle_bin SET expires_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z", expireMove.body.items[0].id);
  recycleDb.close();
  recycleList = await request("/api/recycle-bin", { headers });
  assert.strictEqual(recycleList.body.total, 0, "restored, purged, or expired pilot records must leave recycle bin");
  const expiredStore = await request("/api/store", { headers });
  assert.deepStrictEqual(JSON.parse(expiredStore.body.nnuzc_home || "[]"), [], "expired record must not return to the original module");

  const defaultBranding = await request("/api/branding");
  assert.strictEqual(defaultBranding.response.status, 200, JSON.stringify(defaultBranding.body));
  assert.strictEqual(defaultBranding.body.name, "数智学工", "default branding name must remain stable");
  assert.strictEqual((await request("/api/branding", { method: "PUT", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ name: "未授权修改" }) })).response.status, 401, "branding updates must require a local session");
  const logoData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLJRU5ErkJggg==";
  const branded = await request("/api/branding", { method: "PUT", headers, body: JSON.stringify({ name: "测试学院学生工作台", sidebarLogoData: logoData, loginLogoData: logoData }) });
  assert.strictEqual(branded.response.status, 200, JSON.stringify(branded.body));
  assert.strictEqual(branded.body.name, "测试学院学生工作台", "branding name must save");
  assert.strictEqual(branded.body.hasCustomSidebarLogo, true, "sidebar branding logo must save");
  assert.strictEqual(branded.body.hasCustomLoginLogo, true, "login branding logo must save");
  assert.notStrictEqual(branded.body.sidebarLogoUrl, branded.body.loginLogoUrl, "sidebar and login logos must expose independent URLs");
  for (const logoUrl of [branded.body.sidebarLogoUrl, branded.body.loginLogoUrl]) {
    const servedLogo = await request(logoUrl);
    assert.strictEqual(servedLogo.response.status, 200, "custom branding logo must be publicly readable");
    assert.strictEqual(servedLogo.response.headers.get("content-type"), "image/png", "custom branding logo must retain its image MIME type");
  }
  const brandedManifest = await request("/manifest.webmanifest");
  assert.strictEqual(brandedManifest.body.name, "测试学院学生工作台", "PWA manifest must use the saved branding name");
  const invalidBrandingLogo = await request("/api/branding", { method: "PUT", headers, body: JSON.stringify({ name: "测试学院学生工作台", logoData: "data:image/svg+xml;base64,PHN2Zy8+" }) });
  assert.strictEqual(invalidBrandingLogo.response.status, 400, "branding must reject unsafe logo formats");

  await stopServer();
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  await waitForServer();
  const reenter = await request("/api/auth/enter", { method: "POST", headers: { Origin: origin } });
  assert.strictEqual(reenter.response.status, 200, "password-free entry must work after restart");
  const restartCookie = String(reenter.response.headers.get("set-cookie") || "").split(";")[0];
  const restartHeaders = { "Content-Type": "application/json", Cookie: restartCookie, Origin: origin };
  const restartedStore = await request("/api/store", { headers: restartHeaders });
  assert.strictEqual(JSON.parse(restartedStore.body.nnuzc_qa_probe)[0].ok, true, "portable data must remain readable after restart");
  const restartedBranding = await request("/api/branding");
  assert.strictEqual(restartedBranding.body.name, "测试学院学生工作台", "branding must persist after restart");
  assert.strictEqual(restartedBranding.body.hasCustomSidebarLogo, true, "sidebar branding logo must persist after restart");
  assert.strictEqual(restartedBranding.body.hasCustomLoginLogo, true, "login branding logo must persist after restart");
  headers.Cookie = restartCookie;
  if (process.env.XIANGCAI_BRANDING_ONLY === "1") {
    console.log("qa-integration: branding-only passed (public config, authenticated update, safe logo serving, PWA name, validation, restart persistence)");
    return;
  }

  await stopServer();
  writeLegacyPasswordWrapper("Legacy-Portable-Password-123!");
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  await waitForServer();
  const legacyStatus = await request("/api/auth/status");
  assert.strictEqual(legacyStatus.body.mode, "legacy_migration_required", "legacy password data must request one-time migration");
  const rejectedMigration = await request("/api/auth/migrate-legacy-password", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password: "incorrect-password" }) });
  assert.strictEqual(rejectedMigration.response.status, 401, "legacy migration must reject an incorrect old password");
  const migrated = await request("/api/auth/migrate-legacy-password", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ password: "Legacy-Portable-Password-123!" }) });
  assert.strictEqual(migrated.response.status, 200, JSON.stringify(migrated.body));
  assert.ok(fs.existsSync(path.join(temp, "data", "portable-data-key.json")), "legacy migration must create portable data key");
  const migrationCookie = String(migrated.response.headers.get("set-cookie") || "").split(";")[0];
  const migrationStore = await request("/api/store", { headers: { "Content-Type": "application/json", Cookie: migrationCookie, Origin: origin } });
  assert.strictEqual(JSON.parse(migrationStore.body.nnuzc_qa_probe)[0].ok, true, "legacy migration must preserve existing encrypted data");
  headers.Cookie = migrationCookie;

  const aiConfig = await request("/api/ai/config", { method: "PUT", headers, body: JSON.stringify({
    enabled: false, provider: "", baseUrl: "", model: "", temperature: 0.4,
    features: { notice: false, document: true }, dailyRequestLimit: 3, dailyInputLimit: 600
  }) });
  assert.strictEqual(aiConfig.response.status, 200, JSON.stringify(aiConfig.body));
  assert.strictEqual(aiConfig.body.features.notice, false, "AI feature switch must persist");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(aiConfig.body.features, "knowledge"), false, "retired knowledge AI feature switch remains in public configuration");
  assert.strictEqual(aiConfig.body.features.academicSummary, true, "academic summary AI feature must be registered and enabled by default");
  assert.strictEqual(aiConfig.body.features.academicAnalysis, true, "academic analysis AI feature must be registered and enabled by default");
  assert.ok(["direct", "clash-fake-ip"].includes(aiConfig.body.networkMode), "AI network mode must be reported without exposing proxy credentials");
  assert.strictEqual(aiConfig.body.dailyRequestLimit, 3, "AI request quota must persist");
  const retiredKnowledgeAi = await request("/api/ai/chat", { method: "POST", headers, body: JSON.stringify({ feature: "knowledge", system: "旧知识功能", user: "不得继续调用" }) });
  assert.strictEqual(retiredKnowledgeAi.response.status, 410, "retired knowledge AI calls must be rejected instead of falling back to general AI");
  const rejectedAcademicSummaryAi = await request("/api/ai/chat", { method: "POST", headers, body: JSON.stringify({ feature: "academicSummary", system: "匿名汇总核查", user: "仅含聚合数量" }) });
  assert.strictEqual(rejectedAcademicSummaryAi.response.status, 400, "disabled academic summary AI call must be rejected");
  const academicSummaryAudit = await request("/api/ai/audit?limit=20", { headers });
  assert.strictEqual(academicSummaryAudit.response.status, 200, JSON.stringify(academicSummaryAudit.body));
  assert.ok(academicSummaryAudit.body.some((row) => String(row.note || "").includes("功能：academicSummary")), "academic summary AI call must enter the AI audit with its feature key");
  const approvedAiConfig = await request("/api/ai/config", { method: "PUT", headers, body: JSON.stringify({
    enabled: false, provider: "", baseUrl: "", model: "", temperature: 0.4,
    features: aiConfig.body.features, dailyRequestLimit: 3, dailyInputLimit: 600, certificateOutboundApproved: true
  }) });
  assert.strictEqual(approvedAiConfig.response.status, 200, JSON.stringify(approvedAiConfig.body));
  assert.strictEqual(approvedAiConfig.body.certificateOutboundApproved, true, "certificate outbound consent must persist");
  const anthropicConfig = await request("/api/ai/config", { method: "PUT", headers, body: JSON.stringify({
    enabled: false, provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-5", temperature: 0.4,
    features: aiConfig.body.features, dailyRequestLimit: 3, dailyInputLimit: 600
  }) });
  assert.strictEqual(anthropicConfig.response.status, 200, JSON.stringify(anthropicConfig.body));
  assert.strictEqual(anthropicConfig.body.protocol, "anthropic", "Anthropic provider protocol must persist");
  assert.strictEqual(anthropicConfig.body.certificateOutboundApproved, true, "ordinary AI saves must not silently revoke certificate consent");
  const health = await request("/api/system/health", { headers });
  assert.strictEqual(health.response.status, 200, JSON.stringify(health.body));
  assert.strictEqual(health.body.localBackupCount, 0, "fresh workbench must not contain implicit backups");
  assert.ok(Number(health.body.attachment.quotaBytes) >= 256 * 1024 * 1024, "health endpoint must report attachment quota");
  const preview = await request("/api/ai/redaction-preview", { method: "POST", headers, body: JSON.stringify({ text: "联系电话 13800138000，学号 20260001" }) });
  assert.strictEqual(preview.response.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.redactedCount >= 1, "redaction preview must apply server rules");
  assert.ok(!String(preview.body.text).includes("13800138000"), "redaction preview must not return raw phone number");

  const legacyDir = path.join(temp, "data", "backups", "legacy-snapshot");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "workbench.db"), Buffer.concat([Buffer.from("SQLite format 3\0", "ascii"), Buffer.alloc(512)]));
  const legacyReport = await request("/api/backups/legacy-report", { headers });
  assert.strictEqual(legacyReport.response.status, 200, JSON.stringify(legacyReport.body));
  assert.strictEqual(legacyReport.body.fileCount, 1, "legacy backup scanner must find historical files");
  assert.strictEqual(legacyReport.body.sqliteFiles, 1, "legacy backup scanner must identify SQLite files");
  const legacyPurge = await request("/api/backups/legacy-purge", { method: "POST", headers, body: JSON.stringify({ action: "purge", phrase: legacyReport.body.actionPhrase, confirmCount: legacyReport.body.fileCount, confirmBytes: legacyReport.body.totalBytes }) });
  assert.strictEqual(legacyPurge.response.status, 200, JSON.stringify(legacyPurge.body));
  assert.strictEqual(legacyPurge.body.removed, 1, "legacy backup purge must remove confirmed historical files");
  assert.strictEqual(fs.existsSync(path.join(temp, "data", "backups")), false, "legacy backup directory must be removed after purge");

  const attachment = await request("/api/attachments?name=qa.txt", { method: "POST", headers: Object.assign({}, headers, { "Content-Type": "application/octet-stream" }), body: Buffer.from("quality-assurance") });
  assert.strictEqual(attachment.response.status, 201);
  const namedAttachment = await request(`/attachments/${attachment.body.id}?name=${encodeURIComponent("学业考试成绩分析统计表.xlsx")}&type=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`, { headers: { Cookie: headers.Cookie, Origin: origin } });
  assert.strictEqual(namedAttachment.response.status, 200, "named attachment download must succeed");
  assert.strictEqual(namedAttachment.response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "named attachment must retain the Excel MIME type");
  assert.match(String(namedAttachment.response.headers.get("content-disposition") || ""), /filename\*=UTF-8''/i, "named attachment must return a UTF-8 filename");
  assert.strictEqual(namedAttachment.bytes.toString("utf8"), "quality-assurance", "named attachment content changed during download");
  assert.strictEqual((await request(`/api/attachments/${attachment.body.id}`, { method: "DELETE", headers })).response.status, 200);

  const discoveredBackups = await request("/api/backups", { headers });
  assert.strictEqual(discoveredBackups.response.status, 200, JSON.stringify(discoveredBackups.body));
  assert.strictEqual(discoveredBackups.body.length, 0, "non-backup operations must not create local backups");
  await stopServer();
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  await waitForServer();
  const afterRestartReenter = await request("/api/auth/enter", { method: "POST", headers: { Origin: origin } });
  assert.strictEqual(afterRestartReenter.response.status, 200, "password-free entry must work after restart");
  headers.Cookie = String(afterRestartReenter.response.headers.get("set-cookie") || "").split(";")[0];
  const warningTemplateAfterRestart = await request("/api/academic-warning/template/status", { headers: { Cookie: headers.Cookie, Origin: origin } });
  assert.strictEqual(warningTemplateAfterRestart.response.status, 200, JSON.stringify(warningTemplateAfterRestart.body));
  assert.strictEqual(warningTemplateAfterRestart.body.mode, "custom", "custom academic-warning template must remain active after restart");
  const backupsAfterRestart = await request("/api/backups", { headers });
  assert.strictEqual(backupsAfterRestart.body.length, 0, "restarting must not create a local backup");

  const backup = await request("/api/backups", { method: "POST", headers, body: JSON.stringify({ note: "isolated integration test" }) });
  assert.strictEqual(backup.response.status, 201);
  const preflight = await request(`/api/backups/${encodeURIComponent(backup.body.id)}/preflight`, { headers });
  assert.strictEqual(preflight.response.status, 200);
  assert.match(preflight.body.sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(preflight.body.academicWarningTemplate, true, "local backup did not include the custom academic-warning Word template");
  fs.rmSync(path.join(temp, backup.body.relative_path));
  const missingBackupDelete = await request(`/api/backups/${encodeURIComponent(backup.body.id)}`, { method: "DELETE", headers });
  assert.strictEqual(missingBackupDelete.response.status, 200, JSON.stringify(missingBackupDelete.body));
  assert.strictEqual(missingBackupDelete.body.missingFile, true, "missing backup files must permit safe registry cleanup");
  const remainingBackups = await request("/api/backups", { headers });
  assert.strictEqual(remainingBackups.response.status, 200, JSON.stringify(remainingBackups.body));
  assert.ok(!remainingBackups.body.some((item) => item.id === backup.body.id), "missing backup registry record must be removed");

  const forms = { notice: {}, parent: {}, talk: {}, support: {}, cancel: {} };
  const itemCourses = Array.from({ length: 40 }, (_, index) => ({ name: `测试课程${index + 1}`, term: `第${index + 1}学期`, result: `结果${index + 1}` }));
  const item = { fileBase: "20260001 测试学生", term: "2025-2026-1学期", student: { name: "测试学生", sid: "20260001", gender: "男", college: "测试学院", major: "测试专业", className: "测试班" }, courses: itemCourses, forms };
  const editorItem = {
    fileBase: "academic-warning-editor",
    term: "",
    student: { name: "__AW_STUDENT_NAME__", sid: "__AW_STUDENT_SID__", gender: "__AW_STUDENT_GENDER__", college: "__AW_STUDENT_COLLEGE__", major: "__AW_STUDENT_MAJOR__", className: "__AW_STUDENT_CLASSNAME__" },
    courses: Array.from({ length: 6 }, (_, slot) => ({ name: `__AW_COURSE_${slot}_NAME__`, term: `__AW_COURSE_${slot}_TERM__`, result: `__AW_COURSE_${slot}_RESULT__` })),
    forms: { notice: { cetDegree: "__AW_NOTICE_CETDEGREE__" }, parent: {}, talk: {}, support: {}, cancel: {} }
  };
  const customEditor = await request("/api/academic-warning/render", { method: "POST", headers, body: JSON.stringify({ format: "editor-html", item: editorItem }) });
  assert.strictEqual(customEditor.response.status, 200, customEditor.bytes.toString("utf8"));
  assert.match(String(customEditor.response.headers.get("content-type") || ""), /^text\/html;\s*charset=utf-8/i, "academic-warning editor template must be returned as UTF-8 HTML");
  const customEditorPath = path.join(temp, "academic-warning-custom-editor.html");
  fs.writeFileSync(customEditorPath, customEditor.bytes);
  assert.strictEqual(wordContains(customEditorPath, customMarker), "FOUND", "academic-warning attachment editor did not use the active custom template");
  assert.match(customEditor.bytes.toString("utf8"), /__AW_STUDENT_NAME__/, "academic-warning editor HTML lost its student placeholder");
  const customWord = await request("/api/academic-warning/render", { method: "POST", headers, body: JSON.stringify({ format: "word", item }) });
  assert.strictEqual(customWord.response.status, 200, customWord.bytes.toString("utf8"));
  const customOutputPath = path.join(temp, "academic-warning-custom-output.doc");
  fs.writeFileSync(customOutputPath, customWord.bytes);
  assert.strictEqual(wordContains(customOutputPath, customMarker), "FOUND", "generated academic-warning Word file did not use the active custom template");
  const customCourseTable = wordFirstTableCourses(customOutputPath, itemCourses.length);
  assert.strictEqual(customCourseTable.rowCount, 13 + itemCourses.length - 6, "academic-warning attachment 1 did not add one Word row per overflow course");
  assert.deepStrictEqual(customCourseTable.courses, itemCourses.map((course) => [course.name, course.term, course.result]), "academic-warning attachment 1 did not keep one course per Word row");
  assert.ok(customCourseTable.widths.every((widths) => JSON.stringify(widths) === JSON.stringify(customCourseTable.widths[0])), "academic-warning overflow rows are not aligned with the original course columns");
  const pdf = await request("/api/academic-warning/render", { method: "POST", headers, body: JSON.stringify({ format: "pdf", item }) });
  assert.strictEqual(pdf.response.status, 200, pdf.bytes.toString("utf8"));
  assert.ok(pdf.bytes.subarray(0, 5).equals(Buffer.from("%PDF-")), "academic-warning endpoint did not return a PDF");
  const pdfPageCount = (pdf.bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  assert.ok(pdfPageCount >= 7, `academic-warning attachment 1 did not paginate after adding many course rows (PDF pages: ${pdfPageCount})`);

  const resetWarningTemplate = await request("/api/academic-warning/template", { method: "DELETE", headers });
  assert.strictEqual(resetWarningTemplate.response.status, 200, JSON.stringify(resetWarningTemplate.body));
  assert.strictEqual(resetWarningTemplate.body.mode, "default", "reset academic-warning template did not activate the system default");
  const warningTemplateAfterReset = await request("/api/academic-warning/template/status", { headers: { Cookie: headers.Cookie, Origin: origin } });
  assert.strictEqual(warningTemplateAfterReset.response.status, 200, JSON.stringify(warningTemplateAfterReset.body));
  assert.strictEqual(warningTemplateAfterReset.body.mode, "default", "academic-warning template status did not report the restored system default");
  const defaultWord = await request("/api/academic-warning/render", { method: "POST", headers, body: JSON.stringify({ format: "word", item }) });
  assert.strictEqual(defaultWord.response.status, 200, defaultWord.bytes.toString("utf8"));
  const defaultOutputPath = path.join(temp, "academic-warning-default-output.doc");
  fs.writeFileSync(defaultOutputPath, defaultWord.bytes);
  assert.strictEqual(wordContains(defaultOutputPath, customMarker), "MISSING", "restored system default still contains content from the custom academic-warning template");
  assert.strictEqual(wordContains(defaultOutputPath, "学业预警通知书"), "FOUND", "restored system default did not generate the expected academic-warning notice title");
  const defaultEditor = await request("/api/academic-warning/render", { method: "POST", headers, body: JSON.stringify({ format: "editor-html", item: editorItem }) });
  assert.strictEqual(defaultEditor.response.status, 200, defaultEditor.bytes.toString("utf8"));
  assert.doesNotMatch(defaultEditor.bytes.toString("utf8"), new RegExp(customMarker), "restored system default editor still contains content from the custom academic-warning template");

  const clearAttachment = await request("/api/attachments?name=qa-clear.txt", { method: "POST", headers: Object.assign({}, headers, { "Content-Type": "application/octet-stream" }), body: Buffer.from("must-be-cleared") });
  assert.strictEqual(clearAttachment.response.status, 201, JSON.stringify(clearAttachment.body));
  const rejectedLocalClear = await request("/api/store/clear-local-business-data", { method: "POST", headers, body: JSON.stringify({ confirmation: "错误确认文字" }) });
  assert.strictEqual(rejectedLocalClear.response.status, 400, "local data clear must require exact confirmation text");
  const localClear = await request("/api/store/clear-local-business-data", { method: "POST", headers, body: JSON.stringify({ confirmation: "清空本地全部数据" }) });
  assert.strictEqual(localClear.response.status, 200, JSON.stringify(localClear.body));
  assert.strictEqual(localClear.body.backupsPreserved, true, "local data clear must preserve backups");
  assert.strictEqual(localClear.body.academicWarningTemplateReset, true, "local data clear must reset the custom academic-warning Word template");
  assert.strictEqual(localClear.body.webdavCredentialsCleared, true, "local data clear must clear WebDAV credentials");
  assert.strictEqual(localClear.body.webdavEndpointRetained, true, "local data clear must retain the WebDAV endpoint and remote filename");
  const clearedWebdav = await request("/api/webdav/status", { headers });
  assert.strictEqual(clearedWebdav.response.status, 200, JSON.stringify(clearedWebdav.body));
  assert.strictEqual(clearedWebdav.body.configured, false, "local data clear must make WebDAV unusable until credentials are entered again");
  assert.strictEqual(clearedWebdav.body.url, "https://dav.example.test/remote/", "local data clear must retain the WebDAV server address");
  assert.strictEqual(clearedWebdav.body.remoteFile, "shuzhi-xuegong-backup.szwd", "local data clear must retain the WebDAV cloud filename");
  assert.strictEqual(clearedWebdav.body.username, "", "local data clear must never retain the WebDAV account");
  assert.strictEqual(clearedWebdav.body.hasPassword, false, "local data clear must never retain the WebDAV authorization code");
  const clearedStore = await request("/api/store", { headers });
  assert.strictEqual(clearedStore.response.status, 200, JSON.stringify(clearedStore.body));
  assert.ok(!Object.prototype.hasOwnProperty.call(clearedStore.body, "nnuzc_qa_probe"), "local data clear must remove legacy business store data");
  assert.ok(!fs.existsSync(path.join(temp, "data", "attachments", clearAttachment.body.id)), "local data clear must remove attachments");
  const warningTemplateAfterClear = await request("/api/academic-warning/template/status", { headers: { Cookie: headers.Cookie, Origin: origin } });
  assert.strictEqual(warningTemplateAfterClear.body.mode, "default", "local data clear did not restore the default academic-warning Word template");
  const recycleAfterClear = await request("/api/recycle-bin", { headers });
  assert.strictEqual(recycleAfterClear.response.status, 200, JSON.stringify(recycleAfterClear.body));
  assert.strictEqual(recycleAfterClear.body.total, 0, "local data clear must also empty the recycle bin");
  assert.ok(localClear.body.demo, "local data clear must return the refreshed demo-data state");
  assert.strictEqual(localClear.body.demo.active, false, JSON.stringify(localClear.body.demo));
  assert.strictEqual(localClear.body.demo.hasRealData, false, JSON.stringify(localClear.body.demo));
  assert.strictEqual(localClear.body.demo.canLoad, true, JSON.stringify(localClear.body.demo));
  const demoLoadAfterLocalClear = await request("/api/demo/load", { method: "POST", headers, body: "{}" });
  assert.strictEqual(demoLoadAfterLocalClear.response.status, 200, JSON.stringify(demoLoadAfterLocalClear.body));
  assert.strictEqual(demoLoadAfterLocalClear.body.status.active, true, JSON.stringify(demoLoadAfterLocalClear.body));
  console.log(`qa-integration: passed (auth, store, AI config, redaction preview, legacy-backup safety, attachment, backup, Word PDF, local-data clear; ${pdf.bytes.length} bytes)`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => {
  if (child && !child.killed) { child.kill("SIGTERM"); await delay(500); }
  const resolved = path.resolve(temp);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("xiangcai-integration-")) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break; } catch (_error) { await delay(250); }
    }
  }
});

