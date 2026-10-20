"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-talk-ai-"));
const port = Number(process.env.XIANGCAI_TALK_AI_QA_PORT || 18874);
const origin = `http://127.0.0.1:${port}`;
let child, browser;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadPlaywright() {
  const candidate = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
  if (!fs.existsSync(candidate)) throw new Error("Playwright is unavailable");
  return require(candidate);
}

function findEdge() {
  const candidates = [
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  const edge = candidates.find((item) => fs.existsSync(item));
  if (!edge) throw new Error("Microsoft Edge executable was not found");
  return edge;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch (_error) {}
    await delay(100);
  }
  throw new Error("isolated talk AI server did not start");
}

async function request(pathname, options = {}) {
  const response = await fetch(origin + pathname, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function writeStore(cookie, key, value) {
  const result = await request(`/api/store/${encodeURIComponent(key)}`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin }, body: JSON.stringify({ value: JSON.stringify(value) })
  });
  assert.strictEqual(result.response.status, 200, `could not seed ${key}: ${JSON.stringify(result.body)}`);
}

async function main() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject); probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
  for (const file of ["web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "license-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js", "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js", "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "index.html", "login.html", "other-violation-module.js", "学生组织管理.html"]) fs.copyFileSync(path.join(root, file), path.join(temp, file));
  fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
  fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
  fs.cpSync(path.join(root, "assets"), path.join(temp, "assets"), { recursive: true });
  installTestLicense(temp);
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  await waitForServer();

  const entry = await fetch(`${origin}/`, { redirect: "manual" });
  const cookie = String(entry.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^xiangcai_session=/);
  await writeStore(cookie, "nnuzc_orgs", {
    depts: [{ name: "测试学院", code: "QA" }],
    majors: [{ name: "测试专业", code: "QA01", dept: "测试学院" }],
    classes: [{ name: "测试班", dept: "测试学院", major: "测试专业", grade: "2025" }]
  });
  await writeStore(cookie, "nnuzc_term_list", ["2025-2026-2学期"]);
  await writeStore(cookie, "nnuzc_current_term", "2025-2026-2学期");
  await writeStore(cookie, "nnuzc_students", [{ id: "talk-ai-001", name: "谈话测试生", dept: "测试学院", major: "测试专业", grade: "2025", cls: "测试班", status: "在校" }]);
  await writeStore(cookie, "nnuzc_talks", []);

  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ executablePath: findEdge(), headless: true });
  const context = await browser.newContext();
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value, url: origin }]);
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.goto("talks"));
  await page.locator('#content button[onclick="openTalkForm()"]').click();
  await page.locator("#tfSid").fill("talk-ai-001");
  await page.locator("#tfContent").fill("学生反馈课程学习压力较大，已约定下周回访并提交复习计划。");
  await page.locator('button:has-text("本地智能整理")').click();
  assert.match(await page.locator("#tfAiSummary").inputValue(), /学习压力|主要议题/);
  assert.strictEqual(await page.locator("#tfAiReviewed").isChecked(), false, "new AI draft must require manual review");
  await page.locator("#tfAiReviewed").check();
  await page.locator("#modalOk").click();
  await page.waitForTimeout(180);
  const saved = await page.evaluate(() => talkRecords.find((record) => record.sid === "talk-ai-001"));
  assert.ok(saved && saved.aiSummary && saved.aiReviewed === true && saved.aiSourceHash, "reviewed AI draft was not saved");
  await page.evaluate(() => talkQuery());
  assert.match(await page.locator("#talkBody").innerText(), /已人工确认/);

  await page.evaluate((id) => openTalkForm(id), saved.id);
  await page.locator("#tfContent").fill("学生反馈课程学习压力较大，原定下周回访调整为本周回访。");
  await page.locator("#modalOk").click();
  await page.waitForTimeout(180);
  assert.match(await page.locator("#talkBody").innerText(), /原文已修改待重生成/);
  await page.evaluate(() => window.workbench.legacy.flushStore());
  const persisted = await request("/api/store", { headers: { Cookie: cookie, Origin: origin } });
  const records = JSON.parse(persisted.body.nnuzc_talks || "[]");
  const browserStore = await page.evaluate(() => ({ records: talkRecords, raw: localStorage.getItem("nnuzc_talks"), bridge: window.__workbenchStore && window.__workbenchStore.nnuzc_talks, saveFailure: window.__workbenchSaveFailure }));
  assert.ok(records.some((record) => record.sid === "talk-ai-001" && record.aiSummary && record.aiReviewed === false), "talk AI state was not persisted to SQLite-backed store: " + JSON.stringify({ records, browserStore }));
  await page.evaluate(() => {
    localStorage.setItem("nnuzc_certificate_records", JSON.stringify([
      { id:"cert-wait", status:"pending", recognitionStatus:"none", data:{} },
      { id:"cert-check", status:"pending", recognitionStatus:"done", data:{} },
      { id:"cert-field", status:"pending", recognitionStatus:"done", data:{awardName:"测试奖项"}, fieldConfidence:{awardName:60} },
      { id:"cert-error", status:"pending", recognitionStatus:"error", data:{} },
      { id:"cert-confirmed", status:"confirmed", recognitionStatus:"done", data:{} },
      { id:"cert-excluded", status:"excluded", recognitionStatus:"done", data:{} }
    ]));
    window.goto("certificate");
  });
  await page.waitForTimeout(80);
  const certificateStats = await page.locator("#content .cert-stat").allTextContents();
  assert.strictEqual(certificateStats.length, 8, "certificate page must display all eight status counters");
  for (const label of ["总数", "可确认", "待识别", "待核对", "字段待确认", "识别失败", "已确认", "已排除"]) assert.ok(certificateStats.some((text) => text.includes(label)), `certificate counter is missing ${label}`);
  await page.locator(".cert-stat", { hasText: "已确认" }).click();
  assert.strictEqual(await page.locator(".cert-queue-filter select").inputValue(), "已确认", "clicking a status counter must set the matching queue filter");
  await page.locator(".cert-stat", { hasText: "总数" }).click();
  assert.strictEqual(await page.locator(".cert-queue-filter select").inputValue(), "全部", "clicking the total counter must restore all certificates");
  await page.locator(".cert-stat", { hasText: "可确认" }).click();
  assert.strictEqual(await page.locator(".cert-queue-filter select").inputValue(), "可确认", "clicking the ready counter must filter confirmable certificates");
  await context.close();
  console.log("qa-talk-ai-summary: passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) child.kill("SIGTERM");
});

