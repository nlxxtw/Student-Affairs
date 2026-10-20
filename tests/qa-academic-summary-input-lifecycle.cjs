"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(file => file && fs.existsSync(file));

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const toolUrl = origin + "/assets/academic-summary-tool.html";
    const sample = { name: "本次上传.csv", mimeType: "text/csv", buffer: Buffer.from("学号,姓名,综测总分\n20260001,测试同学,90\n") };
    await page.goto(toolUrl, { waitUntil: "networkidle" });
    const firstFile = page.locator('input[data-key="zongce1"]');
    await firstFile.setInputFiles(sample);
    assert.match(await firstFile.locator("xpath=..").innerText(), /本次上传\.csv/);
    await page.evaluate(async () => {
      const db = await openCacheDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("inputs", "readwrite");
        transaction.objectStore("inputs").put({ key:"academic", name:"旧版遗留.xlsx", blob:new Blob(["old"]) });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    });
    await page.reload({ waitUntil: "networkidle" });
    assert.doesNotMatch(await page.locator('input[data-key="zongce1"]').locator("xpath=..").innerText(), /本次上传\.csv/, "refresh must clear source file");
    assert.equal(await page.locator("#calculate").isDisabled(), true);
    await page.waitForFunction(async () => {
      const db = await openCacheDb();
      return new Promise((resolve, reject) => {
        const request = db.transaction("inputs", "readonly").objectStore("inputs").count();
        request.onsuccess = () => resolve(request.result === 0);
        request.onerror = () => reject(request.error);
      });
    });
    assert.doesNotMatch(await page.locator('input[data-key="academic"]').locator("xpath=..").innerText(), /旧版遗留\.xlsx/, "old persistent source files must not be restored");
    await page.locator('input[data-key="zongce1"]').setInputFiles(sample);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(toolUrl, { waitUntil: "networkidle" });
    assert.doesNotMatch(await reopened.locator('input[data-key="zongce1"]').locator("xpath=..").innerText(), /本次上传\.csv/, "closing and reopening must clear source file");
    assert.match(await reopened.locator("#cache-note").innerText(), /刷新|退出/);
    await reopened.evaluate(async () => {
      await ToolHistory.save("academicSummary", { id:"input-lifecycle-result", at:new Date().toISOString(), count:1, classes:1, output:"测试汇总.xlsx", inputs:{} }, [
        { role:"summary-output", name:"测试汇总.xlsx", mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", blob:new Blob(["isolated-test-result"]) }
      ]);
    });
    await reopened.reload({ waitUntil:"networkidle" });
    assert.equal(await reopened.evaluate(async () => (await ToolHistory.list("academicSummary")).some(item => item.id === "input-lifecycle-result")), true, "generated history must remain persistent");
    await reopened.locator('input[data-key="zongce1"]').setInputFiles(sample);
    await reopened.goto(origin + "/", { waitUntil:"networkidle" });
    await reopened.goBack({ waitUntil:"networkidle" });
    assert.doesNotMatch(await reopened.locator('input[data-key="zongce1"]').locator("xpath=..").innerText(), /本次上传\.csv/, "leaving and returning must clear source file");
    const host = await context.newPage();
    await host.goto(origin + "/?goto=academicSummary", { waitUntil:"networkidle" });
    const frame = await host.locator("#academicSummaryFrame").contentFrame();
    await frame.locator('input[data-key="zongce1"]').setInputFiles(sample);
    assert.match(await frame.locator('input[data-key="zongce1"]').locator("xpath=..").innerText(), /本次上传\.csv/);
    await host.reload({ waitUntil:"networkidle" });
    const reloadedFrame = await host.locator("#academicSummaryFrame").contentFrame();
    assert.doesNotMatch(await reloadedFrame.locator('input[data-key="zongce1"]').locator("xpath=..").innerText(), /本次上传\.csv/, "workbench refresh must clear embedded input");
    assert.deepEqual(errors, []);
    console.log("qa-academic-summary-input-lifecycle: passed (refresh, close, persistent cache cleanup)");
  } finally { await browser.close(); }
});
