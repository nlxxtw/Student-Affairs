"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { installTestLicense } = require("./license-test-helper.cjs");
const { buildDemoStore } = require("../demo-data.js");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "shuzhi-demo-data-"));
let child = null;

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  for (const name of ["web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "license-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js", "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js", "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "other-violation-module.js", "index.html", "login.html", "学生组织管理.html"]) fs.copyFileSync(path.join(root, name), path.join(temp, name));
  fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
  fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
  fs.mkdirSync(path.join(temp, "assets"));
  for (const name of ["html2pdf.bundle.min.js", "jszip.min.js", "xlsx.full.min.js", "academic-warning-editor-template.html", "login-logo.png", "login-logo-icon.png", "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-field-template.xlsx", "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js", "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css"]) fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
  fs.copyFileSync(path.join(root, "assets", "tool-history-client.js"), path.join(temp, "assets", "tool-history-client.js"));
  for (const asset of ["workbench-ui.js", "workbench-ui.css"]) fs.copyFileSync(path.join(root, "assets", asset), path.join(temp, "assets", asset));
  installTestLicense(temp);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + "/api/health")).ok) break; } catch (_error) {}
    if (attempt === 99) throw new Error("isolated demo-data server did not start");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const enter = await fetch(origin + "/api/auth/enter", { method: "POST", headers: { Origin: origin } });
  assert.strictEqual(enter.status, 200);
  const cookie = String(enter.headers.get("set-cookie") || "").split(";")[0];
  const headers = { Cookie: cookie, Origin: origin };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };
  const request = async (pathname, options = {}) => {
    const response = await fetch(origin + pathname, options);
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };
  const put = (key, value) => request("/api/store/" + encodeURIComponent(key), { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ value: JSON.stringify(value) }) });

  /* 浏览器首次打开会写入内置目录；它们不是用户真实数据，演示清除后必须原样恢复。 */
  const builtInCompetition = [{ id: "cahe-2024-001", title: "内置竞赛目录" }, { id: "moe-national-career-planning-competition", title: "内置专项赛事" }];
  assert.strictEqual((await put("nnuzc_subject_competition_resources", builtInCompetition)).response.status, 200);
  const before = await request("/api/demo/status", { headers });
  assert.strictEqual(before.body.active, false, "empty workbench must not auto-load demo data");
  assert.strictEqual(before.body.canLoad, true, JSON.stringify(before.body));
  assert.strictEqual(before.body.hasRealData, false, JSON.stringify(before.body));
  const emptyStore = await request("/api/store", { headers });
  assert.strictEqual(emptyStore.body.nnuzc_students, undefined, "empty workbench must stay empty until the user clicks load");
  assert.strictEqual((await request("/api/demo/load", { method: "POST", headers: jsonHeaders, body: "{}" })).response.status, 200);
  assert.strictEqual((await request("/api/demo/clear", { method: "POST", headers: jsonHeaders, body: "{}" })).response.status, 200);
  const backupsAfterDemoCycle = await request("/api/backups", { headers });
  assert.strictEqual(backupsAfterDemoCycle.body.length, 0, "loading or clearing demo data must not create local backups");
  const afterFirstClear = await request("/api/demo/status", { headers });
  assert.strictEqual(afterFirstClear.body.active, false, JSON.stringify(afterFirstClear.body));
  assert.strictEqual(afterFirstClear.body.canLoad, true, JSON.stringify(afterFirstClear.body));
  assert.strictEqual(afterFirstClear.body.hasRealData, false, JSON.stringify(afterFirstClear.body));
  const afterBaseline = await request("/api/store", { headers });
  assert.deepStrictEqual(JSON.parse(afterBaseline.body.nnuzc_subject_competition_resources), builtInCompetition, "demo clear must preserve the built-in competition baseline");
  assert.strictEqual(afterBaseline.body.nnuzc_orgs, undefined, "demo organization auxiliary data must not remain after clear");

  /* 只要没有新增真实数据，载入和清除必须可以反复执行。 */
  assert.strictEqual((await request("/api/demo/load", { method: "POST", headers: jsonHeaders, body: "{}" })).response.status, 200);
  assert.strictEqual((await request("/api/demo/clear", { method: "POST", headers: jsonHeaders, body: "{}" })).response.status, 200);
  const afterSecondClear = await request("/api/demo/status", { headers });
  assert.strictEqual(afterSecondClear.body.canLoad, true, JSON.stringify(afterSecondClear.body));
  assert.strictEqual(afterSecondClear.body.hasRealData, false, JSON.stringify(afterSecondClear.body));

  /* 兼容修复早期版本遗留的纯演示年级、宿舍楼、招生类别辅助键。 */
  const demoOrgs = JSON.parse(buildDemoStore().nnuzc_orgs);
  assert.strictEqual((await put("nnuzc_orgs", demoOrgs)).response.status, 200);
  const residueDb = new DatabaseSync(path.join(temp, "data", "workbench.db"));
  residueDb.exec("PRAGMA busy_timeout = 5000;");
  residueDb.exec("DELETE FROM class_groups; DELETE FROM majors; DELETE FROM departments;");
  residueDb.close();
  const repairedStatus = await request("/api/demo/status", { headers });
  assert.strictEqual(repairedStatus.body.canLoad, true, JSON.stringify(repairedStatus.body));
  assert.strictEqual(repairedStatus.body.hasRealData, false, JSON.stringify(repairedStatus.body));
  const repairedStore = await request("/api/store", { headers });
  assert.strictEqual(repairedStore.body.nnuzc_orgs, undefined, "legacy demo organization residue must be repaired safely");

  /* 一旦出现任何真实业务数据，载入和清除两个入口都必须 409，且原数据保持不变。 */
  const orgs = { depts: [{ name: "真实学院", code: "R01" }], majors: [{ name: "真实专业", code: "R0101", dept: "真实学院" }], classes: [{ name: "真实班级", dept: "真实学院", major: "真实专业", grade: "2026级" }], grades: [{ name: "2026级" }], dorms: [], enrollTypes: [] };
  const realStudents = [{ id: "REAL001", name: "真实数据保护验收", dept: "真实学院", major: "真实专业", cls: "真实班级", grade: "2026级", status: "在校" }];
  assert.strictEqual((await put("nnuzc_orgs", orgs)).response.status, 200);
  assert.strictEqual((await put("nnuzc_students", realStudents)).response.status, 200);
  const realBaseline = await request("/api/store", { headers });
  const blockedLoad = await request("/api/demo/load", { method: "POST", headers: jsonHeaders, body: "{}" });
  assert.strictEqual(blockedLoad.response.status, 409, JSON.stringify(blockedLoad.body));
  assert.strictEqual(blockedLoad.body.code, "REAL_DATA_PRESENT");
  const blockedClear = await request("/api/demo/clear", { method: "POST", headers: jsonHeaders, body: "{}" });
  assert.strictEqual(blockedClear.response.status, 409, JSON.stringify(blockedClear.body));
  assert.strictEqual(blockedClear.body.code, "REAL_DATA_PRESENT");
  const protectedStore = await request("/api/store", { headers });
  assert.strictEqual(protectedStore.body.nnuzc_students, realBaseline.body.nnuzc_students, "blocked demo actions must not change real students");
  assert.strictEqual(protectedStore.body.nnuzc_orgs, realBaseline.body.nnuzc_orgs, "blocked demo actions must not change real organization data");

  /* 清空真实数据后必须立即重新具备载入演示数据的条件，不能沿用清空前的真实数据判断。 */
  const localClear = await request("/api/store/clear-local-business-data", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ confirmation: "清空本地全部数据" }) });
  assert.strictEqual(localClear.response.status, 200, JSON.stringify(localClear.body));
  assert.strictEqual(localClear.body.demo.active, false, JSON.stringify(localClear.body));
  assert.strictEqual(localClear.body.demo.hasRealData, false, JSON.stringify(localClear.body));
  assert.strictEqual(localClear.body.demo.canLoad, true, JSON.stringify(localClear.body));
  const loadAfterLocalClear = await request("/api/demo/load", { method: "POST", headers: jsonHeaders, body: "{}" });
  assert.strictEqual(loadAfterLocalClear.response.status, 200, JSON.stringify(loadAfterLocalClear.body));
  assert.strictEqual(loadAfterLocalClear.body.status.active, true, JSON.stringify(loadAfterLocalClear.body));

  console.log("qa-demo-data: passed (manual load only, repeatable load/clear, legacy residue repair, real-data zero-write protection, load after full clear)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (child) { child.kill("SIGTERM"); await new Promise((resolve) => setTimeout(resolve, 350)); }
  fs.rmSync(temp, { recursive: true, force: true });
});

