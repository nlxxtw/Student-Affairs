"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

function loadPlaywright() {
  const candidates = [process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, "playwright"), path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright")].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return require(candidate);
  throw new Error("Playwright unavailable");
}
function edgePath() {
  const candidates = [process.env.EDGE_PATH, process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"), process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")].filter(Boolean);
  const value = candidates.find((item) => fs.existsSync(item)); if (!value) throw new Error("Microsoft Edge unavailable"); return value;
}

const root = path.resolve(__dirname, "..");
const sample = {
  licenses: [
    { id: "lic_ec6830091f6368f7", codeAvailable: true, customer: "张老师", customerName: "张老师", customerXhsId: "小红书张老师", customerWechat: "wx_zhang", note: "正式授权", status: "active", maxDevices: 5, activeDevices: 1, expiresAt: null, createdAt: Date.now() - 86400000, updatedAt: Date.now(), devices: [{ slot: 1, name: "DESKTOP-5GSMIVP", activatedAt: Date.now() - 3600000, lastSeenAt: Date.now() }] },
    { id: "lic_f6bf17a9224c70c4", codeAvailable: false, customer: "自动验收", note: "第6台设备拒绝测试", status: "revoked", maxDevices: 5, activeDevices: 0, expiresAt: Date.now() + 86400000 * 365, createdAt: Date.now() - 7200000, updatedAt: Date.now() - 3600000, devices: [] }
  ],
  stats: { total: 2, active: 1, revoked: 1, boundDevices: 1 }
};
const createdSample = {
  count: 2,
  items: [
    { code: "SZ3-7Q9K-4N2M-8X5R-1P6T-9W3Y", license: { id: "lic_mobile_full_code_0001", customer: "手机端测试", customerName: "手机端测试", customerXhsId: "xhs_mobile", customerWechat: "wx_mobile", maxDevices: 5, expiresAt: null, note: "" } },
    { code: "SZ3-2A8D-6F4H-9J3L-5Q7W-1E0R", license: { id: "lic_mobile_full_code_0002", customer: "手机端测试", customerName: "手机端测试", customerXhsId: "xhs_mobile", customerWechat: "wx_mobile", maxDevices: 5, expiresAt: null, note: "" } }
  ]
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, body, type = "application/json; charset=utf-8", headers = {}) => { response.writeHead(status, Object.assign({ "Content-Type": type }, headers)); response.end(typeof body === "string" ? body : JSON.stringify(body)); };
  if (url.pathname === "/admin" || url.pathname === "/admin/") return send(200, fs.readFileSync(path.join(root, "public", "admin.html"), "utf8"), "text/html; charset=utf-8");
  if (url.pathname === "/admin/admin.css") return send(200, fs.readFileSync(path.join(root, "public", "admin.css"), "utf8"), "text/css; charset=utf-8");
  if (url.pathname === "/admin/admin.js") return send(200, fs.readFileSync(path.join(root, "public", "admin.js"), "utf8"), "application/javascript; charset=utf-8");
  if (url.pathname === "/v1/admin/me") return send(401, { error: "请登录" });
  if (url.pathname === "/v1/admin/login") return send(200, { ok: true, user: "admin", csrf: "test-csrf", expiresAt: Date.now() + 1800000 }, undefined, { "Set-Cookie": "sz_license_admin=test; Path=/" });
  if (url.pathname === "/v1/admin/licenses/batch" && request.method === "POST") return send(200, createdSample);
  if (/^\/v1\/admin\/licenses\/lic_[a-f0-9]{16}\/code\/reveal$/i.test(url.pathname) && request.method === "POST") return send(200, { id: sample.licenses[0].id, code: "SZ3-7Q9K-4N2M-8X5R-1P6T-9W3Y" });
  if (url.pathname === "/v1/admin/licenses") return send(200, sample);
  if (url.pathname === "/v1/admin/audit") return send(200, { events: [] });
  return send(404, { error: "not found" });
});

(async () => {
  await new Promise((resolve) => server.listen(18931, "127.0.0.1", resolve));
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, executablePath: edgePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:18931/admin", { waitUntil: "networkidle" });
    const loginScreenshot = path.join(__dirname, "admin-login.png");
    await page.screenshot({ path: loginScreenshot, fullPage: true });
    await page.fill("#loginPassword", "test-password-123"); await page.click("#loginForm button[type=submit]");
    await page.waitForSelector("#adminView:not(.hidden)");
    assert.equal(await page.textContent("#statTotal"), "2");
    assert.match(await page.textContent("#licenseRows"), /张老师/);
    assert.match(await page.textContent("#licenseRows"), /小红书张老师/);
    assert.match(await page.textContent("#licenseRows"), /wx_zhang/);
    assert.match(await page.textContent("#licenseRows"), /旧接口生成 · 明文不可恢复/);
    assert.equal(await page.locator('button[disabled][title*="不能恢复"]').count(), 1);
    await page.locator('[data-action="show-code"]').first().click();
    assert.equal(await page.locator(".license-code.revealed").first().textContent(), "SZ3-7Q9K-4N2M-8X5R-1P6T-9W3Y");
    assert.equal(await page.locator('[data-action="delete"]').count(), 2);
    await page.locator('[data-action="edit"]').first().click();
    assert.equal(await page.inputValue('#editForm input[name="customerName"]'), "张老师");
    assert.equal(await page.inputValue('#editForm input[name="customerXhsId"]'), "小红书张老师");
    assert.equal(await page.inputValue('#editForm input[name="customerWechat"]'), "wx_zhang");
    await page.locator("[data-close=editDialog]").first().click();
    await page.click("#createButton"); assert.equal(await page.locator("#createDialog").getAttribute("open"), "");
    await page.locator("[data-close=createDialog]").first().click();
    const screenshot = path.join(__dirname, "admin-dashboard.png");
    await page.screenshot({ path: screenshot, fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "mobile page must not overflow horizontally");
    assert.equal(await page.locator(".stats-grid article").count(), 4);
    assert.equal(await page.locator(".license-table tr").first().evaluate((element) => getComputedStyle(element).display), "block");
    assert.equal(await page.locator(".license-id").first().textContent(), sample.licenses[0].id);
    assert.equal(await page.locator('[data-action="copy-id"]').first().isVisible(), true);
    const mobileScreenshot = path.join(__dirname, "admin-dashboard-mobile.png");
    await page.screenshot({ path: mobileScreenshot, fullPage: true });

    await page.click("#createButton");
    await page.fill('#createForm input[name="customerName"]', "手机端测试");
    await page.fill('#createForm input[name="customerXhsId"]', "xhs_mobile");
    await page.fill('#createForm input[name="customerWechat"]', "wx_mobile");
    const downloadPromise = page.waitForEvent("download");
    await page.click('#createForm button[type="submit"]');
    await downloadPromise;
    await page.waitForSelector("#createdCodesDialog[open]");
    assert.equal(await page.locator(".created-code").first().textContent(), createdSample.items[0].code);
    assert.equal(await page.locator(".created-code-card").count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "generated-code dialog must not overflow horizontally");
    const codesScreenshot = path.join(__dirname, "admin-created-codes-mobile.png");
    await page.screenshot({ path: codesScreenshot, fullPage: true });
    console.log(`license-admin-ui: passed (${loginScreenshot}; ${screenshot}; ${mobileScreenshot}; ${codesScreenshot})`);
  } finally { await browser.close(); server.close(); }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
