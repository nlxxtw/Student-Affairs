"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
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
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error("Microsoft Edge executable was not found; set EDGE_PATH");
  return executable;
}

async function exerciseParser(page, label) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.locator("#calculate").waitFor({ state: "visible" });
  const result = await page.locator("html").evaluate(async () => {
    const rows = [["学号", "姓名", "综测总分"], ["20260001", "测试学生", 88.5]];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "数据");
    const bytes = bookType => new Uint8Array(XLSX.write(workbook, { type: "array", bookType }));
    const utf8 = text => new TextEncoder().encode(text);
    const gbk = text => {
      const output = [];
      for (const char of text) {
        const code = cptable[936].enc[char];
        if (code == null) throw new Error(`GBK test fixture cannot encode ${char}`);
        if (code <= 0xFF) output.push(code); else output.push(code >> 8, code & 0xFF);
      }
      return new Uint8Array(output);
    };
    const xlsx = bytes("xlsx"), xlsm = bytes("xlsm"), xlsb = bytes("xlsb"), biff8 = bytes("biff8"), ods = bytes("ods"), xlml = bytes("xlml");
    const cases = [
      ["modern.xlsx", xlsx], ["macro.xlsm", xlsm], ["binary.xlsb", xlsb],
      ["template.xltx", xlsx], ["macro-template.xltm", xlsm],
      ["legacy.xls", biff8], ["legacy-template.xlt", biff8], ["excel-2003.xml", xlml],
      ["wps-sheet.et", xlsx], ["wps-template.ett", biff8],
      ["open-document.ods", ods], ["flat-open-document.fods", ods],
      ["plain.csv", utf8("学号,姓名,综测总分\r\n20260001,测试学生,88.5")],
      ["wps-gbk.csv", gbk("学号,姓名,综测总分\r\n20260001,测试学生,88.5")],
      ["tab.tsv", utf8("学号\t姓名\t综测总分\r\n20260001\t测试学生\t88.5")]
    ];
    const parsed = [];
    for (const [name, content] of cases) {
      const sheets = await readWorksheets(new File([content], name));
      parsed.push({ name, sheet: sheets[0].name, id: String(sheets[0].rows[1][0]), score: String(sheets[0].rows[1][2]) });
    }
    const makeWorkbookFile = (name, data, bookType) => {
      const current = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(current, XLSX.utils.aoa_to_sheet(data), "数据");
      return new File([new Uint8Array(XLSX.write(current, { type: "array", bookType }))], name);
    };
    files.zongce1 = makeWorkbookFile("综测1-旧版.xls", [["学号", "姓名", "综测总分"], ["20260001", "学生甲", 90], ["20260002", "学生乙", 80], ["20260003", "综测来源名", 92]], "biff8");
    files.zongce2 = makeWorkbookFile("综测2-WPS.et", [["学号", "姓名", "综测总分"], ["20260001", "学生甲", 88], ["20260003", "综测来源名", 94]], "xlsx");
    files.academic = makeWorkbookFile("学业成绩.xlsb", [["学号", "姓名", "学院", "班级", "学分加权平均分", "平均学分绩点"], ["20260001", "学生甲", "测试学院", "B班", 86.5, 3.5], ["20260002", "学生乙", "测试学院", "B班", 80.5, 3.1], ["20260003", "名单外学生", "补充学院", "A班", 88, 3.8], ["20260003", "名单外重复学生", "补充学院", "A班", 99, 4]], "xlsb");
    files.course = new File([utf8("学号,课程名称,成绩,课程性质\r\n20260001,高等数学,59,补考一\r\n20260001,大学英语,70,正常\r\n20260002,大学物理,65,重修补考\r\n20260003,计算机基础,96,正常")], "课程成绩.csv");
    files.template = makeWorkbookFile("汇总名单.ods", [["学号", "姓名", "学院", "班级"], ["20260001", "学生甲", "测试学院", "B班"], ["20260002", "学生乙", "测试学院", "B班"], ["20260004", "来源缺失生", "测试学院", "B班"]], "ods");
    let calculated = [], calculationError = "", calculationProbe = {}, extraStudentNotice = "", exportedNumericValues = {};
    const extraDialogObserver = new MutationObserver(() => {
      const dialog = document.querySelector("#validation-dialog"), confirm = dialog?.querySelector("[data-confirm-extra]");
      if (!dialog?.open || !confirm) return;
      extraStudentNotice = dialog.innerText;
      confirm.click();
      extraDialogObserver.disconnect();
    });
    extraDialogObserver.observe(document.querySelector("#validation-dialog"), { attributes: true, childList: true, subtree: true });
    try {
      calculated = await calculate();
      const outputZip = await JSZip.loadAsync(await makeXlsx(calculated));
      const outputXml = await outputZip.file("xl/worksheets/sheet1.xml").async("text");
      const outputDocument = new DOMParser().parseFromString(outputXml, "application/xml");
      for (const ref of ["E2", "F2", "G2", "I2", "J2", "L2", "M2", "O2"]) {
        const cell = [...outputDocument.querySelectorAll("c")].find(item => item.getAttribute("r") === ref);
        exportedNumericValues[ref] = Number(cell?.querySelector("v")?.textContent);
      }
    }
    catch (error) {
      calculationError = error.message;
      for (const key of requiredKeys) calculationProbe[key] = (await readWorksheets(files[key])).map(sheet => ({ name: sheet.name, rows: sheet.rows.slice(0, 3) }));
    }
    let temporaryFileMessage = "";
    try { await readWorksheets(new File([xlsx], "~$正在编辑.xlsx")); } catch (error) { temporaryFileMessage = error.message; }
    return { parsed, calculated, calculationError, calculationProbe, extraStudentNotice, temporaryFileMessage, exportedNumericValues, roundingProbe: { positive: roundDecimal(1.005, 2), negative: roundDecimal(-1.005, 2), percent: percentageTwo(1, 3) }, accept: document.querySelector('input[data-key="zongce1"]').accept, formats: supportedSpreadsheetFormats };
  });
  assert.strictEqual(result.parsed.length, 15, `${label}: not all format cases were parsed`);
  for (const item of result.parsed) {
    assert.strictEqual(item.id, "20260001", `${label}: ${item.name} lost the student ID`);
    assert.strictEqual(item.score, "88.5", `${label}: ${item.name} lost the score`);
  }
  for (const extension of [".xlsx", ".xlsm", ".xlsb", ".xltx", ".xltm", ".xls", ".xlt", ".xml", ".et", ".ett", ".ods", ".fods", ".csv", ".tsv"]) {
    assert.ok(result.accept.includes(extension), `${label}: picker does not advertise ${extension}`);
  }
  assert.match(result.temporaryFileMessage, /临时锁定文件/, `${label}: temporary lock file was not rejected clearly`);
  assert.strictEqual(result.calculationError, "", `${label}: mixed-format calculation failed: ${result.calculationError}; ${JSON.stringify(result.calculationProbe)}`);
  assert.strictEqual(result.calculated.length, 3, `${label}: output population must exactly match the summary roster`);
  assert.deepStrictEqual(result.calculated.map(row => row["学号"]), ["20260001", "20260002", "20260004"], `${label}: extra source students were not ignored or output is not sorted by class and student ID`);
  const byId = new Map(result.calculated.map(row => [row["学号"], row]));
  assert.deepStrictEqual([byId.get("20260001")["综测（平均）"], byId.get("20260001")["综测排名"], byId.get("20260001")["学分加权平均分排名"], byId.get("20260001")["平均学分绩点排名"], byId.get("20260001")["最低分"]], [89, "1/3", "1/3", "1/3", 59], `${label}: score-based class ranking is incorrect`);
  assert.deepStrictEqual([byId.get("20260001")["综测排名百分比"], byId.get("20260002")["综测排名百分比"], byId.get("20260004")["综测排名百分比"]], [0.3333, 0.6667, 1], `${label}: percentage values were not rounded to two displayed percentage decimals`);
  assert.deepStrictEqual(result.roundingProbe, { positive: 1.01, negative: -1.01, percent: 0.3333 }, `${label}: decimal ROUND-equivalent behavior is incorrect`);
  assert.deepStrictEqual(result.exportedNumericValues, { E2: 90, F2: 88, G2: 89, I2: 0.3333, J2: 86.5, L2: 0.3333, M2: 3.5, O2: 0.3333 }, `${label}: XLSX cells retained hidden precision instead of rounded numeric values`);
  assert.deepStrictEqual([byId.get("20260002")["综测1"], byId.get("20260002")["综测2"], byId.get("20260002")["综测（平均）"], byId.get("20260002")["综测排名"], byId.get("20260002")["学分加权平均分排名"], byId.get("20260002")["平均学分绩点排名"], byId.get("20260002")["最低分"]], [80, 0, 80, "2/3", "2/3", "2/3", 65], `${label}: single available semester must be divided by one`);
  assert.deepStrictEqual([byId.get("20260004")["综测1"], byId.get("20260004")["综测2"], byId.get("20260004")["综测（平均）"], byId.get("20260004")["学分加权平均分"], byId.get("20260004")["平均学分绩点"], byId.get("20260004")["最低分"], byId.get("20260004")["综测排名"], byId.get("20260004")["学分加权平均分排名"], byId.get("20260004")["平均学分绩点排名"]], [0, 0, 0, 0, 0, 0, "3/3", "3/3", "3/3"], `${label}: missing summary-roster student data was not retained and zero-filled`);
  assert.strictEqual(byId.has("20260003"), false, `${label}: student appearing only in source files leaked into the summary output`);
  assert.match(result.extraStudentNotice, /发现《汇总》名单外学生/);
  assert.match(result.extraStudentNotice, /20260003/);
  assert.match(result.extraStudentNotice, /综测来源名|名单外学生/);
  for (const source of ["第 1 学期综测", "第 2 学期综测", "学业成绩", "课程成绩"]) assert.ok(result.extraStudentNotice.includes(source), `${label}: extra-student notice omitted source ${source}`);
  assert.strictEqual(byId.get("20260001")["补考科目"], "高等数学", `${label}: CSV course retake extraction failed`);
  assert.strictEqual(byId.get("20260002")["重修科目"], "大学物理", `${label}: CSV course re-study extraction failed`);
  assert.deepStrictEqual(result.formats, ["xlsx", "xlsm", "xlsb", "xltx", "xltm", "xls", "xlt", "xml", "et", "ett", "ods", "fods", "csv", "tsv"]);
  assert.deepStrictEqual(errors, [], `${label}: browser errors: ${errors.join(" | ")}`);
}

async function main(origin) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: findEdge(), headless: true });
  try {
    const systemContext = await browser.newContext();
    const systemPage = await systemContext.newPage();
    await systemPage.goto(`${origin}/`, { waitUntil: "networkidle" });
    await systemPage.goto(`${origin}/assets/academic-summary-tool.html`, { waitUntil: "networkidle" });
    assert.strictEqual(await systemPage.locator("script[src='/xlsx.full.min.js']").count(), 1, "system tool does not load SheetJS");
    await exerciseParser(systemPage, "system tool");
    await systemContext.close();

    const standalonePath = path.resolve("C:\\Users\\46230\\Desktop\\工具\\综测汇总助手\\双击启动.html");
    if (!process.env.QA_ACADEMIC_SUMMARY_SYSTEM_ONLY && fs.existsSync(standalonePath)) {
      const standaloneContext = await browser.newContext();
      const standalonePage = await standaloneContext.newPage();
      await standalonePage.goto(pathToFileURL(standalonePath).href, { waitUntil: "load" });
      assert.strictEqual(await standalonePage.locator("script[src='vendor/xlsx.full.min.js']").count(), 1, "standalone tool does not load SheetJS");
      await exerciseParser(standalonePage, "standalone tool");
      await standaloneContext.close();
    }
    console.log("qa-academic-summary-formats: passed (rounded score/percentage cell values, summary-roster-only population, extra-student notice, single-semester divisor, zero-filled missing sources, score-based weighted/GPA ranks, optional source rank columns, mixed spreadsheet formats)");
  } finally {
    await browser.close();
  }
}

withIsolatedWorkbench(main).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
