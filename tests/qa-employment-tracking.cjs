"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");

const moduleRoot = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = require(path.join(moduleRoot, "playwright"));
const edge = [process.env.EDGE_PATH, path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"), path.join(process.env.ProgramFiles || "C:/Program Files", "Microsoft/Edge/Application/msedge.exe")].find(file => file && fs.existsSync(file));

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(origin + "/?goto=employment", { waitUntil: "networkidle" });
    await page.waitForSelector("#content");
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0, ORG_DEPTS.length, { name: "测试学院", code: "QA" });
      ORG_MAJORS.splice(0, ORG_MAJORS.length, { name: "测试专业", dept: "测试学院", code: "QA01" });
      ORG_CLASSES.splice(0, ORG_CLASSES.length, { name: "测试班", dept: "测试学院", major: "测试专业", grade: "2023" });
      saveOrgs(); await workbench.legacy.flushStore();
      students = [
        { id: "0001", name: "同名测试", cls: "测试班", dept: "测试学院", major: "测试专业", graduateYear: "2026届", status: "在校" },
        { id: "0002", name: "同名测试", cls: "测试班", dept: "测试学院", major: "测试专业", graduateYear: "2026届", status: "在校" },
        { id: "0003", name: "未填意向", cls: "测试班", dept: "测试学院", major: "测试专业", graduateYear: "2026届", status: "在校" },
        { id: "0004", name: "未填毕业年份", cls: "测试班", dept: "测试学院", major: "测试专业", graduateYear: "", status: "在校" }
      ];
      employmentIntentionRecords = [
        { id: "intent-1", sid: "0001", intention: "市场就业" },
        { id: "intent-2", sid: "0002", intention: "拟升学-研究生" },
        { id: "intent-4", sid: "0004", intention: "拟创业" }
      ];
      xcmGet("employment").records = [];
      persistStudents(); employmentIntentionPersist(); xcmPersist("employment");
      await workbench.legacy.flushStore();
      await goto("employment"); employmentSwitchTab("destination");
    });
    const headers = await page.locator("#employmentTrackingBody th").allTextContents();
    assert.strictEqual(headers[headers.indexOf("毕业年份") + 1], "就业意向", "intention must follow graduation year");
    const row = sid => page.locator("#employmentTrackingBody tr").filter({ has: page.locator('.employment-tracking-select[value="' + sid + '"]') });
    assert.strictEqual(await page.locator("#employmentTrackingBody tbody tr").count(), 3, "tracking roster must still derive from graduation years");
    assert.strictEqual(await row("0001").locator("td").nth(5).innerText(), "市场就业");
    assert.strictEqual(await row("0002").locator("td").nth(5).innerText(), "拟升学-研究生", "same names must match by student number");
    assert.strictEqual(await row("0003").locator("td").nth(5).innerText(), "未填写");
    assert.match(await page.evaluate(() => employmentTrackingLinkedInfoHtml("0001")), /就业意向[\s\S]*市场就业/);
    await page.screenshot({ path: path.join(os.tmpdir(), "shuzhi-employment-tracking-desktop.png"), fullPage: true });

    await page.evaluate(() => employmentTrackingSetFilter("kw", "拟升学-研究生"));
    assert.strictEqual(await page.locator("#employmentTrackingBody tbody tr").count(), 1);
    assert.strictEqual(await row("0002").count(), 1, "intention must be searchable");
    await page.evaluate(() => employmentTrackingSetFilter("kw", ""));
    await page.evaluate(() => employmentTrackingView("0001"));
    assert.match(await page.locator("#modalBody").innerText(), /就业意向[\s\S]*市场就业/);
    await page.evaluate(() => closeModal());

    await page.evaluate(() => employmentTrackingOpenContact("0001"));
    assert.strictEqual(await page.locator('#etStatus option').filter({ hasText: "已落实未签约" }).count(), 1);
    await page.fill("#etDate", "2026-10-08");
    await page.selectOption("#etContactMethod", "线上");
    await page.fill("#etChannel", "电话");
    await page.selectOption("#etStatus", "已落实未签约");
    await page.fill("#etContent", "单位已确定，等待签约。");
    await page.locator("#modalOk").click();
    await page.evaluate(() => workbench.legacy.flushStore());
    assert.match(await row("0001").innerText(), /已落实未签约/);
    await page.evaluate(() => employmentTrackingSetFilter("status", "已落实未签约"));
    assert.strictEqual(await page.locator("#employmentTrackingBody tbody tr").count(), 1);
    await page.evaluate(() => employmentTrackingSetFilter("status", ""));

    await page.evaluate(async () => {
      employmentIntentionRecords.find(r => r.sid === "0001").intention = "拟创业";
      employmentIntentionPersist(); await workbench.legacy.flushStore(); renderPage("employment");
    });
    assert.strictEqual(await row("0001").locator("td").nth(5).innerText(), "拟创业", "tracking must read the current intention");
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(async () => { await goto("employment"); employmentSwitchTab("destination"); });
    assert.strictEqual(await row("0001").locator("td").nth(5).innerText(), "拟创业");
    assert.match(await row("0001").innerText(), /已落实未签约/);
    await page.evaluate(() => employmentTrackingOpenContact("0001", employmentTrackingRecord("0001").contacts[0].id));
    assert.strictEqual(await page.inputValue("#etStatus"), "已落实未签约", "editing must retain the new status");
    await page.evaluate(() => closeModal());

    const exported = await page.evaluate(() => {
      let captured;
      const original = downloadCSV;
      try { downloadCSV = (_name, headers, rows) => { captured = { headers, rows }; }; employmentTrackingExport(); }
      finally { downloadCSV = original; }
      return captured;
    });
    assert.deepStrictEqual(exported.headers.slice(0, 2), ["毕业年份", "就业意向"]);
    const exportedRow = exported.rows.find(r => r[exported.headers.indexOf("学号")] === "0001");
    assert.strictEqual(exportedRow[1], "拟创业");
    assert.strictEqual(exportedRow[exported.headers.indexOf("当前状态")], "已落实未签约");
    assert.strictEqual(exported.rows.find(r => r[exported.headers.indexOf("学号")] === "0003")[1], "", "unfilled intention exports as empty data");
    const downloadReady = page.waitForEvent("download");
    await page.evaluate(() => employmentTrackingExport());
    const download = await downloadReady;
    const XLSX = require("../assets/xlsx.full.min.js");
    const workbook = XLSX.read(fs.readFileSync(await download.path()), { type: "buffer" });
    const worksheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
    assert.deepStrictEqual(worksheetRows[0].slice(0, 2), ["毕业年份", "就业意向"]);
    const fileRow = worksheetRows.find(r => r[worksheetRows[0].indexOf("学号")] === "0001");
    assert.strictEqual(fileRow[1], "拟创业");
    assert.strictEqual(fileRow[worksheetRows[0].indexOf("当前状态")], "已落实未签约");

    await page.evaluate(async () => {
      employmentIntentionRecords = employmentIntentionRecords.filter(r => r.sid !== "0001");
      employmentIntentionPersist(); await workbench.legacy.flushStore(); renderPage("employment");
    });
    assert.strictEqual(await row("0001").locator("td").nth(5).innerText(), "未填写", "removing intention must clear its linked display");
    assert.strictEqual(await page.evaluate(() => employmentTrackingRecord("0001").contacts.length), 1, "intention changes must preserve contact history");
    await page.evaluate(() => employmentTrackingSetFilter("kw", "不存在的内容"));
    assert.strictEqual(await page.locator("#employmentTrackingBody td.empty").getAttribute("colspan"), "12");
    assert.deepStrictEqual(errors, []);
    console.log("qa-employment-tracking: passed (intention linking/order/search/export, updates/removal/reload, contact status/save/edit/filter)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
