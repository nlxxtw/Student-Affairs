"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")].find(p => p && fs.existsSync(p));
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin + "/?goto=party", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      students = [
        { id: "mass", political: "群众" },
        { id: "league", political: "共青团员" },
        { id: "activist", political: "共青团员", party: { stage: "入党积极分子" } },
        { id: "recommended", political: "共青团员", party: { stage: "共青团员", leagueStatus: "已推优" } },
        { id: "probationer", political: "中共预备党员" },
        { id: "member", political: "中共党员", party: { stage: "中共党员", leagueStatus: "保留团员的中共党员" } },
        { id: "candidate", political: "共青团员", party: { stage: "发展对象", leagueStatus: "已推优" } },
        { id: "graduate", political: "群众", status: "已毕业" }
      ].map(s => Object.assign({ name: s.id, cls: "测试班", dept: "测试学院", major: "测试专业", grade: "2023", status: "在校" }, s));
      viewFilter.party = {}; setQueryReady("party", false); goto("party");
    });
    const cards = page.locator(".party-kpi");
    assert.deepStrictEqual(await cards.locator("span").allTextContents(), ["群众", "共青团员", "团推优（入党积极分子）", "预备党员", "中共党员"]);
    assert.deepStrictEqual(await cards.locator("b").allTextContents(), ["1", "1", "2", "1", "1"]);
    for (const [index, ids] of [[0, ["mass"]], [1, ["league"]], [2, ["activist", "recommended"]], [3, ["probationer"]], [4, ["member"]]]) {
      await cards.nth(index).click();
      assert.deepStrictEqual(await page.locator(".module-table-wrap tbody tr").evaluateAll(rows => rows.map(row => row.cells[3].textContent)), ids, "card immediately queries matching students");
      assert.strictEqual(await cards.nth(index).getAttribute("aria-pressed"), "true");
      await page.locator('.qf-bar button[onclick="queryFilter(\'party\')"]').click();
      assert.strictEqual(await cards.nth(index).getAttribute("aria-pressed"), "true", "query retains selected card");
      const exported = await page.evaluate(() => {
        const original = downloadXlsxFile; let rows;
        try { downloadXlsxFile = (_sheet, data) => { rows = data; }; exportParty(); }
        finally { downloadXlsxFile = original; }
        return rows.slice(1).map(row => row[3]);
      });
      assert.deepStrictEqual(exported, ids, "export matches card scope");
    }
    await cards.nth(4).focus(); await page.keyboard.press("Enter");
    assert.strictEqual(await cards.nth(4).getAttribute("aria-pressed"), "false", "same card clears category");
    assert.strictEqual(await page.locator(".module-table-wrap tbody tr").count(), 7, "all stages remain available");
    await cards.nth(0).click();
    await page.evaluate(() => {
      document.querySelectorAll('.qf-bar[data-page="party"] .qf-multi[data-qf="stage"] input[type="checkbox"]').forEach(input => { input.checked = input.value === "发展对象"; });
    });
    await page.locator('.qf-bar button[onclick="queryFilter(\'party\')"]').click();
    assert.deepStrictEqual(await page.locator(".module-table-wrap tbody tr").evaluateAll(rows => rows.filter(row => row.cells.length > 3).map(row => row.cells[3].textContent)), ["candidate"], "explicit stage query replaces card category");
    assert.strictEqual(await page.locator('.party-kpi[aria-pressed="true"]').count(), 0);
    await page.locator('.qf-bar button[onclick="resetFilter(\'party\')"]').click();
    assert.strictEqual(await page.locator('.party-kpi[aria-pressed="true"]').count(), 0);
    await page.locator('.qf-bar [data-qf="kw"]').fill("league");
    await cards.nth(1).click();
    assert.deepStrictEqual(await cards.locator("b").allTextContents(), ["0", "1", "0", "0", "0"], "card preserves other pending filters");
    await page.locator(".party-kpis").screenshot({ path: path.join(os.tmpdir(), "shuzhi-party-cards.png") });
    assert.deepStrictEqual(errors, []);
    console.log("qa-party-cards: passed (5 categories, immediate query, baselines, promotion, status, query/reset, export, keyboard)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
