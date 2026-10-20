"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const XLSX = require("../assets/xlsx.full.min.js");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?goto=dorm", { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__DORM_SPATIAL__ && typeof window.dormSpatialImportRooms === "function");
    await page.evaluate(() => dormSpatialSetTab("resources"));
    const card = title => page.locator(".card").filter({ has: page.locator(".dsp-resource-head b", { hasText: title }) });
    async function download(title) {
      const waiting = page.waitForEvent("download");
      await card(title).getByRole("button", { name: "下载导入模板", exact: true }).click();
      const file = await waiting; assert.match(file.suggestedFilename(), /导入模板.xlsx$/);
      const buffer=fs.readFileSync(await file.path()),workbook=XLSX.read(buffer,{type:"buffer"}),rows=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:""});
      assert.strictEqual(rows.length,2,title+" template must contain only header and row 2 example");
      assert.ok(rows[1].some(value=>String(value).trim()),title+" template row 2 example must not be blank");
      assert.ok(!rows.flat().some(value=>String(value).trim().startsWith("※")),title+" template must not contain instruction rows");
      return { name: file.suggestedFilename(), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer };
    }
    async function preview(title, file) {
      await card(title).getByRole("button", { name: "导入", exact: true }).click();
      await page.locator("#mappedImportFile").setInputFiles(file);
      await page.getByRole("button", { name: /下一步/ }).click();
      await page.locator(".import-preview").waitFor();
      await page.getByRole("button", { name: /下一步/ }).click();
      await page.locator(".import-field-table").waitFor();
      await page.getByRole("button", { name: /校验数据/ }).click();
    }
    async function commit() {
      await page.getByRole("button", { name: /确认导入/ }).click();
      await page.getByText("导入完成", { exact: true }).waitFor();
      assert.match(await page.locator("#modalBody").innerText(), /导入完成/);
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await page.evaluate(async () => { await workbench.legacy.flushStore(); });
    }
    const buildingTemplate = await download("区位与楼栋资源");
    await preview("区位与楼栋资源", buildingTemplate); await commit();
    const roomTemplate = await download("宿舍房间与床位");
    await preview("宿舍房间与床位", roomTemplate); await commit();
    assert.strictEqual(await page.evaluate(() => __DORM_SPATIAL__.getState().rooms.find(r => r.building === "A栋" && r.room === "101").bedCount), 4);
    await preview("宿舍房间与床位", roomTemplate); await commit();
    assert.strictEqual(await page.evaluate(() => __DORM_SPATIAL__.getState().rooms.filter(r => r.building === "A栋" && r.room === "101").length), 1);
    const csv = { name: "resources.csv", mimeType: "text/csv", buffer: Buffer.from("\ufeff区位,楼栋,楼层,房间号,容量\n南区,新楼,1,0102,2\n", "utf8") };
    await preview("宿舍房间与床位", csv);
    let releaseSave, saveStarted;
    const held = new Promise(resolve => { releaseSave = resolve; });
    const started = new Promise(resolve => { saveStarted = resolve; });
    await page.route("**/api/store/batch", async route => { saveStarted(); await held; await route.continue(); });
    await page.getByRole("button", { name: /确认导入/ }).click(); await started;
    assert.strictEqual(await page.getByText("导入完成", { exact: true }).count(), 0, "pending server write must not report completion");
    assert.strictEqual(await page.getByRole("button", { name: /确认导入/ }).isDisabled(), true);
    releaseSave(); await page.getByText("导入完成", { exact: true }).waitFor();
    await page.unroute("**/api/store/batch");
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" }); await page.evaluate(() => dormSpatialSetTab("resources"));
    assert.match(await card("宿舍房间与床位").innerText(), /0102/);
    assert.strictEqual(await page.evaluate(() => __DORM_SPATIAL__.getState().rooms.find(r => r.room === "0102").bedCount), 2);
    const bad = { name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("\ufeff区位,宿舍楼,楼层,宿舍号,床位数\n北区,新楼,1,0102,0\n", "utf8") };
    await preview("宿舍房间与床位", bad);
    assert.match(await page.locator("#modalBody").innerText(), /区位不一致/);
    assert.strictEqual(await page.getByRole("button", { name: /确认导入/ }).isDisabled(), true);
    await page.evaluate(() => closeModal());
    await page.setViewportSize({ width: 390, height: 844 });
    for (const title of ["区位与楼栋资源", "宿舍房间与床位"]) {
      const box = await card(title).getByRole("button", { name: "导入", exact: true }).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, "import action must fit narrow screen");
    }
    assert.deepStrictEqual(errors, []);
    console.log("Dorm resource browser: templates/XLSX/CSV/aliases/duplicates/validation/reload/mobile passed.");
  } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
