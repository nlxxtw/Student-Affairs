"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { LicenseService, hashCode } = require("../cloud/aliyun-license/license-core");

const root = path.resolve(__dirname, "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function playwright() {
  const paths = [
    process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, "playwright"),
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright")
  ].filter(Boolean);
  const found = paths.find(fs.existsSync);
  if (!found) throw new Error("Playwright is unavailable");
  return require(found);
}

function edgePath() {
  const paths = [
    process.env.EDGE_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  const found = paths.find(fs.existsSync);
  if (!found) throw new Error("Microsoft Edge is unavailable");
  return found;
}

function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }

class MemoryRepository {
  constructor() { this.rows = new Map(); }
  async get(hash) { return clone(this.rows.get(hash)); }
  async create(row) {
    if (this.rows.has(row.licenseHash)) return false;
    this.rows.set(row.licenseHash, clone(row));
    return true;
  }
  async compareAndSwap(current, updated) {
    const row = this.rows.get(current.licenseHash);
    if (!row || row.revision !== current.revision) return false;
    this.rows.set(current.licenseHash, clone(updated));
    return true;
  }
}

async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function readResponse(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  let body;
  try { body = JSON.parse(bytes.toString("utf8")); } catch (_error) { body = bytes.toString("utf8"); }
  return { response, body };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "shuzhi-license-gate-"));
  let workbench = null;
  let licenseServer = null;
  let browser = null;
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    const repository = new MemoryRepository();
    const pepper = "gate-qa-pepper-value-at-least-32-bytes";
    const service = new LicenseService({
      repository,
      pepper,
      privateKey,
      publicKey,
      verifyIntervalHours: 24,
      offlineGraceDays: 180
    });
    const code = "ABCDE-FGHJK-MNPQR-STUVW";
    const seededLicenseHash = hashCode(code, pepper);
    const createdAt = Date.now();
    await repository.create({ id: `lic_${seededLicenseHash.slice(0, 16)}`, licenseHash: seededLicenseHash, encryptedCode: { version: 1 }, issuanceChannel: "license-admin-v1", product: "shuzhi-xuegong", status: "active", maxDevices: 5, customer: "授权门禁隔离测试", note: "", expiresAt: null, devices: [], revision: 1, createdAt, updatedAt: createdAt });
    const issued = { code };
    licenseServer = http.createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      try {
        let result;
        const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (request.url === "/v1/licenses/activate") result = await service.activate(body);
        else if (request.url === "/v1/licenses/verify") result = await service.verify(body, bearer);
        else if (request.url === "/v1/licenses/deactivate") result = await service.deactivate(body, bearer);
        else throw Object.assign(new Error("not found"), { statusCode: 404 });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: error.message, code: error.code }));
      }
    });
    await new Promise((resolve) => licenseServer.listen(0, "127.0.0.1", resolve));

    for (const name of [
      "web-server.js", "workbench-database.js", "academic-public-engine.js","academic-public-exams.js", "academic-public-files.js", "academic-public-report.js","academic-public-import.js","academic-public-analysis.js", "academic-public-service.js", "party-import-engine.js", "academic-public-module.js", "academic-public.css", "license-client.js", "update-client.js", "update-config.json", "demo-data.js", "app.js", "student-leave-engine.js", "student-leave-module.js", "student-leave.css", "student-link-integrity.js", "chaoxing-attendance-module.js", "achievement-enhancements.js",
      "award-statistics-module.js", "dorm-spatial-module.js", "dorm-spatial-module.css", "dorm-roster-module.js", "custom-roster-module.js",
      "intelligence-enhancements.js", "searchable-filter-selects.js", "searchable-filter-selects.css", "index.html", "login.html", "学生组织管理.html",
      "other-violation-module.js"
    ]) fs.copyFileSync(path.join(root, name), path.join(temp, name));
    fs.copyFileSync(path.join(root, "counselor-growth-module.js"), path.join(temp, "counselor-growth-module.js"));
    fs.copyFileSync(path.join(root, "custom-fields-module.js"), path.join(temp, "custom-fields-module.js"));
    fs.mkdirSync(path.join(temp, "assets"));
    fs.mkdirSync(path.join(temp, "scripts"));
    for (const name of [
      "workbench-ui.js", "workbench-ui.css", "tool-history-client.js", "academic-warning-template.doc", "academic-warning-editor-template.html",
      "html2pdf.bundle.min.js", "jszip.min.js", "xlsx.full.min.js", "login-logo.png", "login-logo-icon.png",
      "academic-summary-tool.html", "academic-summary-tool.js", "academic-summary-tool.css", "academic-summary-tool-fixes.css", "academic-analysis-tool.html", "academic-analysis-tool.js", "academic-analysis-tool.css", "academic-analysis-rules.docx", "academic-analysis-field-template.xlsx",
      "excel-merge-tool.html", "excel-merge-app.js", "excel-merge-worker.js",
      "excel-check-tool.html", "excel-check-app.js", "excel-check-style.css", "excel-merge-extract.js", "data-match-tool.html", "data-match-app.js", "data-match-style.css"
    ]) fs.copyFileSync(path.join(root, "assets", name), path.join(temp, "assets", name));
    fs.copyFileSync(path.join(root, "scripts", "generate-academic-warning.ps1"), path.join(temp, "scripts", "generate-academic-warning.ps1"));

    /* 外部配置故意关闭授权；正式服务仍必须强制锁定。 */
    fs.writeFileSync(path.join(temp, "license-config.json"), JSON.stringify({
      enabled: false,
      apiUrl: `http://127.0.0.1:${licenseServer.address().port}`,
      product: "shuzhi-xuegong",
      publicKey,
      requestTimeoutMs: 3000
    }));

    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const request = async (urlPath, options = {}) => readResponse(await fetch(origin + urlPath, options));
    workbench = spawn(process.execPath, [path.join(temp, "web-server.js")], {
      cwd: temp,
      env: Object.assign({}, process.env, { XIANGCAI_PORT: String(port) }),
      stdio: "ignore"
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await request("/api/health")).response.ok) break; } catch (_error) {}
      if (attempt === 99) throw new Error("isolated workbench did not start");
      await delay(100);
    }

    const before = await request("/api/license/status");
    assert.strictEqual(before.body.required, true, "formal build must ignore enabled:false");
    assert.strictEqual(before.body.valid, false, "new device must be inactive before entering a code");
    const enteredLocked = await request("/api/auth/enter", { method: "POST", headers: { Origin: origin } });
    assert.strictEqual(enteredLocked.response.status, 200, "unactivated device must be allowed to open the browsing workbench");
    let cookie = String(enteredLocked.response.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(cookie.startsWith("xiangcai_session="));
    let readHeaders = { Cookie: cookie, Origin: origin };
    const lockedPage = await request("/", { redirect: "manual", headers: readHeaders });
    assert.strictEqual(lockedPage.response.status, 200, "unactivated device must see the browsing workbench");
    assert.match(String(lockedPage.body), /data-view="license"/, "workbench must contain a separate license page entry");
    assert.match(String(lockedPage.body), /未激活.*演示/, "workbench must explain demo browsing mode");
    const bridge = await request("/workbench-bridge.js", { headers: readHeaders });
    assert.strictEqual(bridge.response.status, 200);
    assert.match(String(bridge.body), /window\.__WORKBENCH_READ_ONLY__/);
    assert.match(String(bridge.body), /"valid":false/);
    assert.match(String(bridge.body), /let STORE=\{\}/, "locked bridge must not inject business data");
    const blockedRead = await request("/api/store", { headers: readHeaders });
    assert.strictEqual(blockedRead.response.status, 200, "business reads must be available before activation");
    const blockedWrite = await request("/api/store/nnuzc_qa_trial_probe", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
      body: JSON.stringify({ value: JSON.stringify([{ blocked: false }]) })
    });
    assert.strictEqual(blockedWrite.response.status, 403, "business writes must be blocked before activation");
    assert.strictEqual(blockedWrite.body.code, "LICENSE_LOCKED");
    const blockedExport = await request("/api/academic-warning/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
      body: "{}"
    });
    assert.notStrictEqual(blockedExport.response.status, 403, "read-only rendering must reach validation before activation");

    let backupJsonHeaders = { "Content-Type": "application/json", Cookie: cookie, Origin: origin };
    assert.strictEqual((await request("/api/demo/status", { headers: readHeaders })).response.status, 200, "demo status must be available before activation");
    const demoLoaded = await request("/api/demo/load", { method: "POST", headers: backupJsonHeaders, body: "{}" });
    assert.strictEqual(demoLoaded.response.status, 200, "unactivated users must be able to load demo data");
    const demoStore = await request("/api/store", { headers: readHeaders });
    assert.ok(JSON.parse(demoStore.body.nnuzc_students).length > 0, "unactivated users must be able to read demo students");
    const demoBridge = await request("/workbench-bridge.js", { headers: readHeaders });
    assert.match(String(demoBridge.body), /nnuzc_students/, "demo data must be injected into the browser before activation");
    const demoWrite = await request("/api/store/nnuzc_qa_demo_probe", { method: "PUT", headers: backupJsonHeaders, body: JSON.stringify({ value: "[]" }) });
    assert.strictEqual(demoWrite.response.status, 423, "direct API writes must be rejected in unactivated demo mode");
    const inactiveBackup = await request("/api/backups", {
      method: "POST",
      headers: backupJsonHeaders,
      body: JSON.stringify({ note: "未激活状态应拒绝备份" })
    });
    assert.strictEqual(inactiveBackup.response.status, 403, "backup creation must be locked before activation");
    const inactiveRestore = await request("/api/store/restore-json", {
      method: "POST",
      headers: backupJsonHeaders,
      body: JSON.stringify({ data: { nnuzc_qa_backup_probe: [{ phase: "blocked" }] } })
    });
    assert.strictEqual(inactiveRestore.response.status, 423, "restore must be locked in demo mode");
    const inactiveWebdavConfig = await request("/api/webdav/config", {
      method: "PUT",
      headers: backupJsonHeaders,
      body: JSON.stringify({ url: "https://dav.example.test/backup/", username: "backup-user", password: "backup-app-password", remoteFile: "license-gate.szwd" })
    });
    assert.strictEqual(inactiveWebdavConfig.response.status, 403, "WebDAV settings must be locked before activation");

    const { chromium } = playwright();
    browser = await chromium.launch({ executablePath: edgePath(), headless: true });
    const page = await browser.newPage();
    await page.goto(origin + "/", { waitUntil: "networkidle" });
    assert.strictEqual(await page.locator("body").evaluate((node) => node.classList.contains("license-readonly")), true, "browser must enter read-only browsing mode");
    assert.strictEqual(await page.locator("#licenseTrialBanner").isVisible(), true, "unactivated browsing banner must be visible");
    await page.evaluate(() => goto("license"));
    await page.locator("#licensePage").waitFor();
    assert.match(await page.locator("#licensePage").innerText(), /未激活 · 可浏览演示/);
    assert.match(await page.locator("#licensePage").innerText(), /微信：shuzhixuegong1/);
    assert.strictEqual(await page.locator('a[href="https://xhslink.cn/o/9rULwc6NN0T"]').count(), 2, "purchase link must appear in contact and about sections");
    assert.match(await page.locator(".license-about-card").innerText(), /关于本软件[\s\S]*设备绑定数量以所购授权及后台设置为准[\s\S]*小红书购买地址[\s\S]*系统下载和更新地址[\s\S]*提取码：1118/);
    assert.strictEqual(await page.locator('a[href="https://pan.baidu.com/s/1mt5BcuH0NaR-gSyrP_XMcw?pwd=1118"]').count(), 1, "download/update link must appear in the about card");
    const cardLayout = await page.locator(".license-card-grid").evaluate((node) => {
      const first = node.querySelector(".license-page").getBoundingClientRect();
      const second = node.querySelector(".license-about-card").getBoundingClientRect();
      return { sameRow: Math.abs(first.top - second.top) < 2, sameHeight: Math.abs(first.height - second.height) < 2 };
    });
    assert.strictEqual(cardLayout.sameRow, true, "desktop license cards must be horizontally aligned");
    assert.strictEqual(cardLayout.sameHeight, true, "desktop license cards must use equal-height alignment");
    await page.screenshot({ path: path.join(__dirname, "license-layout-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 430, height: 900 });
    const mobileLayout = await page.locator(".license-card-grid").evaluate((node) => {
      const grid = node.getBoundingClientRect();
      const first = node.querySelector(".license-page").getBoundingClientRect();
      const second = node.querySelector(".license-about-card").getBoundingClientRect();
      return {
        stacked: second.top >= first.bottom - 1,
        cardsContained: first.left >= grid.left - 1 && second.left >= grid.left - 1 && first.right <= grid.right + 1 && second.right <= grid.right + 1
      };
    });
    assert.strictEqual(mobileLayout.stacked, true, "mobile license cards must stack vertically");
    assert.strictEqual(mobileLayout.cardsContained, true, "mobile license cards must stay inside their layout container");
    await page.screenshot({ path: path.join(__dirname, "license-layout-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => goto("backup"));
    assert.strictEqual(await page.locator("#backupPage").count(), 1, "unactivated users must be able to view backup functions");
    await page.evaluate(() => goto("student"));
    assert.strictEqual(await page.locator("#licensePage").count(), 0, "unactivated users must be able to view student management");
    assert.match(await page.locator("#content").innerText(), /学生/);
    assert.strictEqual(await page.locator("#demoModeBanner").isVisible(), true);
    const loadControl = await page.locator("#demoLoadBtn").getAttribute("aria-disabled");
    assert.notStrictEqual(loadControl, "true", "demo lifecycle controls must stay available before activation");
    const studentAdd = page.locator("#content button").filter({ hasText: /新增|添加/ }).first();
    assert.strictEqual(await studentAdd.getAttribute("aria-disabled"), "true", "student creation must be locked");
    const clearedDemo = await request("/api/demo/clear", { method: "POST", headers: backupJsonHeaders, body: "{}" });
    assert.strictEqual(clearedDemo.response.status, 200, "unactivated users must be able to clear demo data");
    await page.reload({ waitUntil: "networkidle" });
    const demoReloaded = page.waitForNavigation({ waitUntil: "networkidle" });
    // Confirm and success alert are separate dialogs in the manual load flow.
    page.on("dialog", dialog => dialog.accept().catch(() => {}));
    await page.click("#demoLoadBtn");
    await demoReloaded;
    assert.strictEqual(await page.locator("#demoModeBanner").isVisible(), true, "manual demo load must survive refresh");
    await page.evaluate(() => goto("student"));
    const importControl = page.locator("#content button").filter({ hasText: /导入/ }).first();
    assert.strictEqual(await importControl.getAttribute("aria-disabled"), "true", "import must remain unavailable in demo mode");
    await page.locator('button[onclick="stuQuery()"]').click();
    assert.ok(await page.locator("#stuTbody .stu-row-chk").count() > 0, "unactivated demo users must be able to query students");
    await page.locator('button[onclick="stuExport()"]').click();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#fixedValueReviewLayer,#studentIntegrityUpdateLayer').count(),0,'read-only demo must not open a data-maintenance dialog');
    const [exportResult] = await Promise.all([page.waitForEvent('download'),page.locator('button[onclick="stuExportDo()"]').click()]);
    assert.match(exportResult.suggestedFilename(), /\.xlsx$/i, "demo browsing must allow student export");
    const demoAcademicState = await request("/api/academic-public/state", { headers: readHeaders });
    const demoAcademicAnalysis = await request("/api/academic-public/analysis", { method: "POST", headers: backupJsonHeaders, body: JSON.stringify({ version: demoAcademicState.body.version }) });
    assert.equal(demoAcademicAnalysis.response.status, 200, "unactivated demo can query academic statistics");
    const demoExport = await request("/api/academic-public/exports", { method: "POST", headers: backupJsonHeaders, body: JSON.stringify({ kind: "grades", version: demoAcademicState.body.version }) });
    assert.strictEqual(demoExport.response.status, 201, "demo browsing must allow read-only server exports");
    assert.strictEqual((await request(demoExport.body.url, { headers: readHeaders })).response.status, 200, "demo export must be downloadable");
    await page.evaluate(() => { closeModal(); goto('academicPublic'); });
    await page.waitForFunction(() => document.querySelector('.ap-result-actions [data-ap="manual"]')?.getAttribute('aria-disabled') === 'true');
    const manualBlocked = await request('/api/academic-public/previews', { method: 'POST', headers: backupJsonHeaders, body: JSON.stringify({ type: 'original', mode: 'add', rows: [{ 学号: 'synthetic-blocked', 原修读学期: '2026-2027-1', 课程名称: '门禁测试', 总评成绩: '80', 考试批次: '期末' }] }) });
    assert.strictEqual(manualBlocked.response.status, 423, 'single academic record cannot bypass the unactivated demo write gate');
    await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}), page.click('#demoClearBtn')]);
    assert.strictEqual(await page.locator("#demoModeBanner").isVisible(), false, "manual clear must leave demo mode");

    const activated = await request("/api/license/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ code: issued.code })
    });
    assert.strictEqual(activated.response.status, 200, JSON.stringify(activated.body));
    assert.strictEqual(activated.body.valid, true);
    const unlockedWrite = await request("/api/store/nnuzc_qa_trial_probe", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
      body: JSON.stringify({ value: JSON.stringify([{ unlocked: true }]) })
    });
    assert.strictEqual(unlockedWrite.response.status, 200, JSON.stringify(unlockedWrite.body));
    const stored = await request("/api/store", { headers: readHeaders });
    assert.strictEqual(JSON.parse(stored.body.nnuzc_qa_trial_probe)[0].unlocked, true, "activated writes must persist");
    const unlockedPage = await request("/", { redirect: "manual", headers: { Cookie: cookie } });
    assert.strictEqual(unlockedPage.response.status, 200, "activated device must be allowed into the workbench");
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.locator("body").evaluate((node) => node.classList.contains("license-readonly")), false, "activation must remove browser read-only mode");

    let releaseBrowserWrite, browserWriteSeen;
    const heldBrowserWrite = new Promise(resolve => releaseBrowserWrite = resolve), startedBrowserWrite = new Promise(resolve => browserWriteSeen = resolve);
    await page.route('**/api/store/batch', async route => { if (route.request().postData().includes('nnuzc_license_draft')) { browserWriteSeen(); await heldBrowserWrite; } await route.continue(); });
    await page.evaluate(() => { openModal('授权失效前输入', '<input id="licenseDraftForm" value="授权锁定时仍需保留的输入">', () => false); localStorage.setItem('nnuzc_license_draft', '{"unsaved":true}'); });
    await startedBrowserWrite;

    const [licenseHash] = repository.rows.keys();
    const slowPayload = JSON.stringify({ value: JSON.stringify({ mustNotCommit: true }) });
    const slowRequest = http.request(origin + '/api/store/nnuzc_license_slow_write', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin, 'Content-Length': Buffer.byteLength(slowPayload) } });
    const slowResult = new Promise((resolve, reject) => { slowRequest.on('response', response => { const chunks = []; response.on('data', data => chunks.push(data)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })); }); slowRequest.on('error', reject); });
    slowRequest.write(slowPayload.slice(0, 8)); await delay(200);
    const activeCloudRecord = repository.rows.get(licenseHash);
    repository.rows.set(licenseHash, Object.assign({}, activeCloudRecord, { expiresAt: Date.now() - 1000, revision: activeCloudRecord.revision + 1 }));
    /* 契约（2026-08-29 起）：/api/license/status 不再强制联网，验证间隔内返回本地有效状态；
       服务端到期/吊销通过强制刷新（/api/license/refresh，即「联网验证授权」按钮）立即应用。 */
    const statusBeforeDue = await request("/api/license/status");
    assert.strictEqual(statusBeforeDue.response.status, 200);
    assert.strictEqual(statusBeforeDue.body.valid, true, "status must stay valid from local credential within the verify interval");
    const expired = await request("/api/license/refresh", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "{}" });
    assert.strictEqual(expired.response.status, 200);
    assert.strictEqual(expired.body.valid, false, "forced refresh must apply server-side expiry immediately");
    assert.strictEqual(expired.body.code, "LICENSE_EXPIRED");
    slowRequest.end(slowPayload.slice(8));
    const slowBlocked = await slowResult;
    assert.strictEqual(slowBlocked.status, 403, 'license invalidated during upload must cancel the previously authorized write');
    assert.strictEqual(slowBlocked.body.code, 'LICENSE_LOCKED');
    releaseBrowserWrite();
    await page.evaluate(async () => { try { await workbench.legacy.flushStore(); } catch (_) {} });
    await page.waitForSelector('#workbenchSessionLock');
    assert.match(await page.locator('#workbenchSessionLockTitle').innerText(), /授权不可用/);
    assert.strictEqual(await page.locator('.main').isVisible(), false, 'license loss must freeze the existing page without reloading away drafts');
    const draftDownload = page.waitForEvent('download'); await page.click('#workbenchLockedDraft');
    const downloaded = await draftDownload, chunks = []; for await (const chunk of await downloaded.createReadStream()) chunks.push(chunk);
    const draft = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert(draft.operations.some(row => row.key === 'nnuzc_license_draft'));
    assert(draft.formSnapshots.some(row => row.id === 'licenseDraftForm' && row.value === '授权锁定时仍需保留的输入'));
    await page.unroute('**/api/store/batch');
    const expiredBackup = await request("/api/backups", {
      method: "POST",
      headers: backupJsonHeaders,
      body: JSON.stringify({ note: "到期状态应锁定备份" })
    });
    assert.strictEqual(expiredBackup.response.status, 403, "backup creation must be locked after expiry");
    const expiredBusinessRead = await request("/api/store", { headers: readHeaders });
    assert.strictEqual(expiredBusinessRead.response.status, 200, "business browsing remains available after expiry");
    const expiredBusinessWrite = await request("/api/store/nnuzc_qa_trial_probe", {
      method: "PUT",
      headers: backupJsonHeaders,
      body: JSON.stringify({ value: JSON.stringify([{ expiredShouldStayBlocked: true }]) })
    });
    assert.strictEqual(expiredBusinessWrite.response.status, 403, "business writes must remain blocked after expiry");
    const expiredCloudRecord = repository.rows.get(licenseHash);
    repository.rows.set(licenseHash, Object.assign({}, expiredCloudRecord, { expiresAt: null, revision: expiredCloudRecord.revision + 1 }));
    const reactivated = await request("/api/license/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ code: issued.code })
    });
    assert.strictEqual(reactivated.response.status, 200, JSON.stringify(reactivated.body));
    const afterSlowUpload = await request('/api/store', { headers: readHeaders });
    assert.strictEqual(afterSlowUpload.body.nnuzc_license_slow_write, undefined, 'revoked in-flight upload must leave no business data behind');
    assert.strictEqual(afterSlowUpload.body.nnuzc_license_draft, undefined, 'license-locked browser request must not be persisted');

    const cloudRecord = repository.rows.get(licenseHash);
    repository.rows.set(licenseHash, Object.assign({}, cloudRecord, { status: "revoked", revision: cloudRecord.revision + 1 }));
    const revoked = await request("/api/license/refresh", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "{}" });
    assert.strictEqual(revoked.response.status, 200);
    assert.strictEqual(revoked.body.valid, false, "forced refresh must apply server-side revocation immediately");
    assert.strictEqual(revoked.body.code, "LICENSE_REVOKED");
    assert.strictEqual(fs.existsSync(path.join(temp, "data", "license-state.json")), false, "revoked local credential must be cleared");
    const revokedWrite = await request("/api/store/nnuzc_qa_trial_probe", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
      body: JSON.stringify({ value: JSON.stringify([{ shouldStayBlocked: true }]) })
    });
    assert.strictEqual(revokedWrite.response.status, 403, "server-side revocation must restore the write gate");
    assert.strictEqual(revokedWrite.body.code, "LICENSE_LOCKED");
    const revokedRead = await request("/api/store", { headers: readHeaders });
    assert.strictEqual(revokedRead.response.status, 200, "server-side revocation must retain browsing access");
    const revokedBackup = await request("/api/backups", {
      method: "POST",
      headers: backupJsonHeaders,
      body: JSON.stringify({ note: "停用状态应锁定备份" })
    });
    assert.strictEqual(revokedBackup.response.status, 403, "backup creation must be locked after revocation");
    await page.reload({ waitUntil: "networkidle" });
    assert.strictEqual(await page.locator("body").evaluate((node) => node.classList.contains("license-readonly")), true, "reloading after revocation must return the browser to read-only browsing mode");
    await page.evaluate(() => goto("license"));
    await page.locator("#licensePage").waitFor();
    assert.match(await page.locator("#licensePage").innerText(), /未激活 · 可浏览演示/);
    const revokedBridge = await request("/workbench-bridge.js", { headers: readHeaders });
    assert.match(String(revokedBridge.body), /nnuzc_qa_trial_probe/, "revoked bridge must retain read-only business browsing");

    console.log("qa-license-gate: passed (unactivated demo load/browse/clear, write protection, activation unlock, expiry/revocation write protection)");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (workbench && !workbench.killed) {
      workbench.kill("SIGTERM");
      await delay(300);
    }
    if (licenseServer) await new Promise((resolve) => licenseServer.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

