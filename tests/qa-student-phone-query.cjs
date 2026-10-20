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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?goto=student", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      students = [
        { id: "p1", name: "张一", phone: "13800138000", status: "在校" },
        { id: "p2", name: "张二", phone: 13900139000, status: "在校" },
        { id: "p3", name: "李三", status: "在校" },
        { id: "p4", name: "王四", phone: null, status: "在校" },
        { id: "p5", name: "毕业生", phone: "13800138000", status: "已毕业" }
      ].map(s => Object.assign({ cls: "测试班", dept: "测试学院", major: "测试专业", grade: "2023" }, s));
      goto("student");
    });
    assert.strictEqual(await page.locator("#qPhone").count(), 1, "query area includes phone field");
    const query = async value => {
      await page.fill("#qPhone", value);
      await page.locator('.zf-actions button[onclick="stuQuery()"]').click();
      return page.locator("#stuTbody tr[data-sid]").evaluateAll(rows => rows.map(row => row.dataset.sid));
    };
    assert.deepStrictEqual(await query(" 13800138000 "), ["p1"], "full phone and trimmed whitespace");
    assert.deepStrictEqual(await query("0013"), ["p1", "p2"], "partial phone, numeric legacy values, status scope");
    await page.fill("#qName", "张二");
    assert.deepStrictEqual(await query("0013"), ["p2"], "phone combines with other criteria");
    assert.deepStrictEqual(await query("99999"), [], "no match");
    await page.locator('.zf-actions button[onclick="stuReset()"]').click();
    assert.strictEqual(await page.inputValue("#qPhone"), "", "reset clears phone");
    assert.deepStrictEqual(await query(""), ["p1", "p2", "p3", "p4"], "empty phone does not exclude missing values");
    await page.locator(".zf-query").screenshot({ path: path.join(os.tmpdir(), "shuzhi-student-phone-query.png") });
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      assert.strictEqual(await page.locator("#qPhone").isVisible(), true);
      const bounds = await page.locator("#qPhone").boundingBox();
      assert(bounds.width >= 100 && bounds.x >= 0 && bounds.x + bounds.width <= width, "phone input fits viewport: " + JSON.stringify({ width, bounds }));
    }
    assert.deepStrictEqual(errors, []);
    console.log("qa-student-phone-query: passed (full/partial, combined, missing/numeric, status, reset, desktop layouts)");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
