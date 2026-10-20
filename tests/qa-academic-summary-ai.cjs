"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");

function loadPlaywright() {
  const candidates = [
    process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, "playwright"),
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright")
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return require(candidate);
  throw new Error("Playwright is unavailable; set CODEX_NODE_MODULES to its node_modules directory");
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("Microsoft Edge executable was not found; set EDGE_PATH");
  return executable;
}

async function main(origin) {
  const health = await fetch(`${origin}/api/health`);
  assert.strictEqual(health.status, 200, "workbench service is unavailable");

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: findEdge(), headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    let aiRequest = null;
    await page.route("**/api/ai/chat", async (route) => {
      aiRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ status: 200, content: "总体结论：建议复核。\n补考/重修学生占比较高，不应显示。\nGPA 排名格式问题请按本机定位修正。", redactedCount: 0 })
      });
    });

    await page.goto(`${origin}/?goto=academicSummary`, { waitUntil: "networkidle" });
    const button = page.locator("#academicSummaryAiCheckButton");
    await button.waitFor({ state: "visible" });
    await page.reload({ waitUntil: "networkidle" });
    await button.waitFor({ state: "visible" });
    assert.strictEqual(await page.locator("#crumb").innerText(), "综测与成绩汇总（个人定制）");
    const frame = await page.locator("#academicSummaryFrame").contentFrame();
    await frame.locator("#calculate").waitFor({ state: "visible" });

    await frame.locator("html").evaluate(() => {
      const records=[{
        "班级": "测试班",
        "学号": "20260001",
        "姓名": "测试学生",
        "综测1": 88.25,
        "综测2": null,
        "综测（平均）": 88.25,
        "综测排名": "1/1",
        "学分加权平均分": 86.5,
        "学分加权平均分排名": "1/1",
        "平均学分绩点": 3.5,
        "平均学分绩点排名": "2/1",
        "最低分": 70,
        "补考科目": "",
        "重修科目": ""
      }];
      latestAiCheckDiagnostics=buildRankDiagnostics(records,new Map([["20260001",{rankRaw:"1",gpaRankRaw:"2",sourceRow:18}]]),{academicFile:"学业成绩.xlsx",academicSheet:"成绩明细",academicHeaderRow:0,academicRows:[["学号","姓名","学分加权平均分排名","占位1","占位2","占位3","占位4","平均学分绩点排名"]],weightedRankColumn:2,gpaRankColumn:7});
      latestAiCheckSummary = aiCheckSummary(records,latestAiCheckDiagnostics);
    });
    await page.evaluate(() => {
      AI_CFG_CACHE = { enabled: true, configured: true, temperature: 0.2, features: { academicSummary: true } };
    });

    await button.click();
    await page.locator("#academicSummaryAiResult").filter({ hasText: "总体结论：建议复核" }).waitFor({ state: "visible" });
    assert.ok(aiRequest, "AI check did not call the AI proxy");
    assert.strictEqual(aiRequest.feature, "academicSummary", "AI check used the wrong feature key");
    assert.match(aiRequest.user, /onlyOneCompositeSemester/);
    assert.match(aiRequest.user, /"generatedStudents": 1/);
    for (const forbidden of ["20260001", "测试学生", "测试班", "88.25", "86.5", "3.5", "70", '"班级":', '"姓名":', '"课程名称":', "makeUpCourseStudents", "retakeCourseStudents"]) {
      assert.ok(!aiRequest.user.includes(forbidden), `AI request leaked forbidden detail: ${forbidden}`);
    }
    assert.match(aiRequest.user, /仅匿名聚合数量和不含身份信息的单元格位置/);
    assert.match(aiRequest.user, /"sourceTable": "学业成绩"/);
    assert.ok(!aiRequest.user.includes("学业成绩.xlsx")&&!aiRequest.user.includes("成绩明细"),"exact local file and worksheet names must not be sent to AI");
    assert.match(aiRequest.user, /"row": 18/);
    assert.match(aiRequest.user, /"column": "H"/);
    const resultText=await page.locator("#academicSummaryAiResult").innerText();
    assert.ok(!/补考|重修/.test(resultText), "make-up/retake risk text must be removed from the displayed AI result");
    assert.match(resultText, /学业成绩\.xlsx/);
    assert.match(resultText, /成绩明细/);
    assert.match(resultText, /18/);
    assert.match(resultText, /H（平均学分绩点排名）/);
    const downloadPromise=page.waitForEvent("download");
    await page.getByRole("button",{name:"下载错误数据表格"}).click();
    const download=await downloadPromise;
    assert.match(download.suggestedFilename(),/^AI核查错误数据-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const reportBytes=[...fs.readFileSync(await download.path())];
    const reportRows=await frame.locator("html").evaluate(async (_,bytes)=>{const file=new File([new Uint8Array(bytes)],"errors.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});return (await readWorksheets(file))[0].rows;},reportBytes);
    assert.deepStrictEqual(reportRows[0].slice(0,15),["问题类型","来源文件","工作表","来源行号","来源列","来源列名","来源原始值","汇总行号","汇总列","汇总列名","汇总值","问题说明","学号","姓名","班级"]);
    assert.deepStrictEqual(reportRows[1].slice(0,15),["GPA排名格式异常","学业成绩.xlsx","成绩明细","18","H","平均学分绩点排名","2","2","N","平均学分绩点排名","2/1","名次 2 大于班级人数 1","20260001","测试学生","测试班"]);
    await page.evaluate(() => window.goto("apiconfig"));
    await page.locator("#aiProvider").waitFor({ state: "visible" });
    assert.strictEqual(await page.locator("#content .ai-provider-card").count(), 0, "removed provider cards are still visible");
    assert.ok(!(await page.locator("#content").innerText()).includes("推荐服务商"), "removed recommended-provider heading is still visible");
    await page.locator("#aiModel").fill("");
    await page.locator("#aiProvider").selectOption("anthropic");
    assert.strictEqual(await page.locator("#aiBase").inputValue(), "https://api.anthropic.com/v1", "provider dropdown no longer fills the default Base URL");
    assert.strictEqual(await page.locator("#aiModel").inputValue(), "claude-sonnet-5", "provider dropdown no longer fills the default model");
    await page.locator("#aiModel").fill("claude-custom-model");
    await page.locator("#aiProvider").selectOption("openai");
    assert.strictEqual(await page.locator("#aiModel").inputValue(), "claude-custom-model", "provider dropdown must not overwrite a manually selected default model");
    assert.deepStrictEqual(pageErrors, [], `browser errors: ${pageErrors.join(" | ")}`);
    await context.close();
    console.log("qa-academic-summary-ai: passed (privacy, local cell location, excluded risks, filtered result, error workbook)");
  } finally {
    await browser.close();
  }
}

withIsolatedWorkbench(main).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
