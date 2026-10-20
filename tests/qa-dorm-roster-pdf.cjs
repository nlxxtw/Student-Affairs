"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { installTestLicense } = require("./license-test-helper.cjs");
const { pathToFileURL } = require("url");
const deps = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { createCanvas } = require(path.join(deps, "@napi-rs", "canvas"));

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-roster-pdf-"));
const port = 18876;
const origin = `http://127.0.0.1:${port}`;
let child;
let browser;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch (_e) {}
    await delay(100);
  }
  throw new Error("roster PDF test service did not start");
}
function playwright() {
  return require(path.join(deps, "playwright"));
}
function edge() {
  const p = path.join(process.env["ProgramFiles(x86)"] || process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe");
  if (!fs.existsSync(p)) throw new Error("Microsoft Edge not found");
  return p;
}
async function writeStore(cookie, key, value) {
  const r = await fetch(`${origin}/api/store/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin }, body: JSON.stringify({ value: JSON.stringify(value) }) });
  assert.strictEqual(r.status, 200, `seed ${key} failed`);
}
async function main() {
  for (const name of ["web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "license-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js", "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js", "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "index.html", "login.html", "other-violation-module.js", "学生组织管理.html"]) fs.copyFileSync(path.join(root, name), path.join(temp, name));
  fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
  fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
  installTestLicense(temp);
  fs.mkdirSync(path.join(temp, "assets"));
  for (const name of ["html2pdf.bundle.min.js", "jszip.min.js", "xlsx.full.min.js", "academic-warning-editor-template.html", "login-logo.png", "login-logo-icon.png", "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-field-template.xlsx", "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js", "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css"]) fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
  fs.copyFileSync(path.join(root, "assets", "tool-history-client.js"), path.join(temp, "assets", "tool-history-client.js"));
  for (const asset of ["workbench-ui.js", "workbench-ui.css"]) fs.copyFileSync(path.join(root, "assets", asset), path.join(temp, "assets", asset));
  child = spawn(process.execPath, [path.join(temp, "web-server.js")], { cwd: temp, env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }), stdio: "ignore" });
  await waitForServer();
  const entry = await fetch(`${origin}/`, { redirect: "manual" });
  const cookie = String(entry.headers.get("set-cookie") || "").split(";")[0];
  await writeStore(cookie, "nnuzc_orgs", { depts: [{ name: "测试学院" }], majors: [{ name: "测试专业", dept: "测试学院" }], classes: [{ name: "000001测试班", dept: "测试学院", major: "测试专业", grade: "2025" }] });
  await writeStore(cookie, "nnuzc_term_list", ["2025-2026-2学期"]);
  await writeStore(cookie, "nnuzc_current_term", "2025-2026-2学期");
  await writeStore(cookie, "nnuzc_students", [
    { id: "202500000001", name: "花名册测试甲", dept: "测试学院", major: "测试专业", grade: "2025", cls: "000001测试班", gender: "男", ethnic: "汉族", political: "共青团员", source: "南京", address: "江苏省南京市测试区超长道路名称一百二十八号测试小区三栋二单元六零一室附楼东侧学生公寓服务中心收发室转交本人联系电话一三八零零零零零零零一", counsel: "李老师", status: "在校", accom: "校内", building: "7栋", room: "427", bed: "1", phone: "13800000001", customFields: [{ name: "花名册备注", value: "夜间值班" }], customFieldValues: { retained: "新版字段值" } },
    { id: "202500000002", name: "花名册测试乙", dept: "测试学院", major: "测试专业", grade: "2025", cls: "000001测试班", gender: "女", status: "在校", accom: "校内", building: "7栋", room: "427", bed: "2", phone: "13800000002", remark1: "退役士兵" }
  ]);
  await writeStore(cookie, "nnuzc_custom_roster_v1", {
    version: 2,
    activeId: "qa_custom_roster",
    datasets: [{
      id: "qa_custom_roster",
      name: "十二位学号排版验证",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {
        version: 1,
        fields: [{ key: "studentNo", name: "学号", group: "身份识别", type: "text", fixed: true }],
        rows: [{ id: "custom-001", values: { studentNo: "202500000003", name: "自定义花名册测试", gender: "女", cls: "000001测试班" } }]
      }
    }]
  });
  const { chromium } = playwright();
  browser = await chromium.launch({ executablePath: edge(), headless: true });
  const context = await browser.newContext();
  await context.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: origin }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/`, { waitUntil: "networkidle" });
  // The synthetic custom roster intentionally references a historical student.
  await page.locator('#studentIntegrityKeep').waitFor({state:'visible'});
  await page.locator('#studentIntegrityKeep').click();
  await page.locator('#studentIntegrityUpdateLayer').waitFor({state:'detached'});
  assert.strictEqual(await page.evaluate(()=>localStorage.getItem(STUDENT_INTEGRITY_REVIEW_KEY)),await page.evaluate(()=>SYS_VER),'historical synthetic roster must be explicitly retained before PDF checks');
  await page.evaluate(() => window.goto("dormRoster"));
  await page.locator("#content .dr-roster-filters").waitFor();
  assert.doesNotMatch(await page.locator("#content").innerText(), /花名册备注|备注1|备注2|自定义字段/, "retired student custom fields are still shown in roster");
  const storedStudents = await page.evaluate(async () => (await window.workbench.legacy.storeExport()).nnuzc_students);
  assert.strictEqual(storedStudents.some((student) => Object.prototype.hasOwnProperty.call(student, "remark1") || Object.prototype.hasOwnProperty.call(student, "remark2") || Object.prototype.hasOwnProperty.call(student, "customFields")), false, "retired student fields remain in persisted data");
  assert.strictEqual(storedStudents.find((student) => student.id === "202500000001").customFieldValues.retained, "新版字段值", "current student field-management values were removed from persisted data");
  assert.match(await page.locator("#content").innerText(), /生源地/);
  assert.match(await page.locator("#content").innerText(), /家庭住址/);
  assert.doesNotMatch(await page.locator("#content").innerText(), /紧急联系人/);
  await page.evaluate(() => {
    ["source","address"].forEach((key) => window.dormRosterField(key, true));
  });
  await page.locator('#content button[onclick="dormRosterGenerate()"]').click();
  assert.match(await page.locator("#content .dr-preview").innerText(), /花名册测试甲/);
  const gridLayout = await page.locator("#content .dr-grid").first().evaluate((node) => ({ columns: getComputedStyle(node).gridTemplateColumns.split(/\s+/).filter(Boolean).length, cards: node.children.length }));
  assert.strictEqual(gridLayout.columns, 3, "roster preview must display exactly three students per row");
  assert.strictEqual(gridLayout.cards, 2, "roster preview student count is incorrect");
  const firstCard = page.locator("#content .dr-card").first();
  const photoIdentity = await firstCard.locator(".dr-photo-info").innerText();
  assert.match(photoIdentity, /学号：202500000001/);
  assert.match(photoIdentity, /姓名：花名册测试甲/);
  assert.match(photoIdentity, /性别：男/);
  assert.match(photoIdentity, /民族：汉/);
  const studentNoLayout = await firstCard.locator('[data-roster-field="id"]').evaluate((node) => {
    const style = getComputedStyle(node);
    const photo = node.closest(".dr-photo-col").querySelector(".dr-photo");
    return {
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      whiteSpace: style.whiteSpace,
      photoWidth: photo.getBoundingClientRect().width,
      infoWidth: node.parentElement.getBoundingClientRect().width
    };
  });
  assert.strictEqual(studentNoLayout.whiteSpace, "nowrap", "12-digit student number must stay on one line");
  assert.ok(studentNoLayout.height <= studentNoLayout.lineHeight * 1.25, `student number wrapped (${JSON.stringify(studentNoLayout)})`);
  assert.ok(studentNoLayout.scrollWidth <= studentNoLayout.clientWidth + 1, `student number overflowed (${JSON.stringify(studentNoLayout)})`);
  assert.ok(Math.abs(studentNoLayout.photoWidth - studentNoLayout.infoWidth) <= 1, `photo and student-number column are not aligned (${JSON.stringify(studentNoLayout)})`);
  const rightDetail = await firstCard.locator(".dr-detail").innerText();
  assert.doesNotMatch(rightDetail, /学号：|姓名：|性别：|民族：/, "identity fields are repeated outside the photo column");
  assert.match(rightDetail, /辅导员：李老师/, "student-management counselor mapping is missing");
  assert.match(rightDetail, /政治面貌：共青团员/, "student-management political mapping is missing");
  assert.match(rightDetail, /生源地：南京/, "student-management source mapping is missing");
  assert.match(rightDetail, /家庭住址：江苏省南京市测试区超长道路名称一百二十八号测试小区三栋二单元六零一室附楼东侧学生公寓服务中心收发室转交本人联系电话一三八零零零零零零零一/, "student-management address mapping is missing");
  const addressLayout = await firstCard.locator('[data-roster-field="address"]').evaluate((node) => { const style = getComputedStyle(node); return { height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, whiteSpace: style.whiteSpace }; });
  assert.ok(addressLayout.height > addressLayout.lineHeight * 1.5, `long roster field did not wrap (${JSON.stringify(addressLayout)})`);
  assert.ok(addressLayout.scrollWidth <= addressLayout.clientWidth + 1, `long roster field overflowed horizontally (${JSON.stringify(addressLayout)})`);
  assert.strictEqual(addressLayout.whiteSpace, "normal", "roster fields must allow automatic wrapping");
  const secondDetail = await page.locator("#content .dr-card").nth(1).locator(".dr-detail").innerText();
  assert.doesNotMatch(secondDetail, /花名册备注：|备注1：|备注2：/, "retired student custom fields are still rendered");
  assert.match(secondDetail, /生源地：/, "standard empty field label should remain visible");
  assert.match(secondDetail, /家庭住址：/, "standard empty field label should remain visible");
  assert.match(await page.locator("#content .dr-card").nth(1).locator(".dr-photo-info").innerText(), /民族：/, "standard empty identity field label should remain visible");
  assert.doesNotMatch(await page.locator("#content .dr-preview").innerText(), /未填写/, "roster should omit empty field values");
  await page.evaluate(() => { window.dormRosterGenerate(); });
  const [download] = await Promise.all([page.waitForEvent("download",{timeout:60000}),page.locator('#content button[onclick="dormRosterPdf()"]').click()]);
  const pdfPath = await download.path();
  assert.ok(pdfPath && fs.statSync(pdfPath).size > 1000, "PDF download is empty");
  const rawPdf = fs.readFileSync(pdfPath);
  assert.strictEqual(Buffer.from(rawPdf).includes(Buffer.from("/DCTDecode")), false, "roster PDF still uses lossy JPEG encoding");
  const pdfjs = await import(pathToFileURL(path.join(deps, "pdfjs-dist", "legacy", "build", "pdf.mjs")).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(rawPdf) }).promise;
  assert.ok(document.numPages >= 1, "PDF has no pages");
  const inks = [];
  for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
    const pdfPage = await document.getPage(pageNo);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    let firstInkY = canvas.height;
    for (let i = 0; i < pixels.length; i += 16) if (pixels[i] < 225 || pixels[i + 1] < 225 || pixels[i + 2] < 225) ink++;
    for (let y = 0; y < canvas.height && firstInkY === canvas.height; y++) for (let x = 0; x < canvas.width; x += 4) { const i = (y * canvas.width + x) * 4; if (pixels[i] < 225 || pixels[i + 1] < 225 || pixels[i + 2] < 225) { firstInkY = y; break; } }
    inks.push(ink);
    assert.ok(ink > 300, `rendered PDF page ${pageNo} is visually blank (ink=${ink})`);
    if (pageNo === 1) assert.ok(firstInkY < 250, `first PDF page has excessive blank top area (${firstInkY}px)`);
  }
  await page.evaluate(() => window.goto("customRoster"));
  await page.locator('#content button[onclick="customRosterGenerate()"]', { timeout: 30000 }).click();
  await page.waitForTimeout(500);
  const customStudentNo = page.locator('#content [data-roster-field="studentNo"]').first();
  await customStudentNo.waitFor();
  assert.match(await customStudentNo.innerText(), /202500000003/);
  const customStudentNoLayout = await customStudentNo.evaluate((node) => {
    const style = getComputedStyle(node);
    const photo = node.closest(".dr-photo-col").querySelector(".dr-photo");
    return {
      height: node.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      whiteSpace: style.whiteSpace,
      photoWidth: photo.getBoundingClientRect().width,
      infoWidth: node.parentElement.getBoundingClientRect().width
    };
  });
  assert.strictEqual(customStudentNoLayout.whiteSpace, "nowrap", `custom roster 12-digit student number must stay on one line (${JSON.stringify(customStudentNoLayout)})`);
  assert.ok(customStudentNoLayout.height <= customStudentNoLayout.lineHeight * 1.25, `custom roster student number wrapped (${JSON.stringify(customStudentNoLayout)})`);
  assert.ok(customStudentNoLayout.scrollWidth <= customStudentNoLayout.clientWidth + 1, `custom roster student number overflowed (${JSON.stringify(customStudentNoLayout)})`);
  assert.ok(Math.abs(customStudentNoLayout.photoWidth - customStudentNoLayout.infoWidth) <= 1, `custom roster photo and student-number column are not aligned (${JSON.stringify(customStudentNoLayout)})`);
  assert.deepStrictEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  console.log(`qa-dorm-roster-pdf: passed (${document.numPages} page(s), non-white samples: ${inks.join(", ")})`);
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (child) child.kill(); });

