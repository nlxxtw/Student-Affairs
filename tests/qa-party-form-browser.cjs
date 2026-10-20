"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules");
const { chromium } = require(path.join(modules, "playwright"));
const edge = [process.env.EDGE_PATH, path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")].find(file => file && fs.existsSync(file));

withIsolatedWorkbench(async origin => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(origin + "/?goto=party", { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0, ORG_DEPTS.length, { name: "测试学院", code: "QA" });
      ORG_MAJORS.splice(0, ORG_MAJORS.length, { name: "测试专业", code: "QA01", dept: "测试学院", years: "4" });
      ORG_CLASSES.splice(0, ORG_CLASSES.length, { name: "测试班", dept: "测试学院", major: "测试专业", grade: "2026", counselor: "测试教师" });
      saveOrgs();
      students.length = 0;
      students.push(
        { id: "000001", name: "一号学生", political: "群众", status: "在校", dept: "测试学院", major: "测试专业", grade: "2026", cls: "测试班", party: { stage: "群众", leagueStatus: "非团员", branch: "第一支部", history: [] } },
        { id: "000002", name: "二号学生", political: "共青团员", status: "在校", dept: "测试学院", major: "测试专业", grade: "2026", cls: "测试班", party: { stage: "入党积极分子", leagueStatus: "已推优", date: "2026-08-01", branch: "第二支部", contact: "李老师", history: [{ stage: "入党积极分子", date: "2026-08-01" }], training: { primary: { status: "已结业", date: "2026-06-01", organizer: "学院党校", result: "优秀" } } } }
      );
      persistStudents();
      await window.workbench.legacy.flushStore();
      viewFilter.party = { status: ["在校"], kw: "二号" };
      setQueryReady("party", true);
      renderPage("party");
      partyOpenForm();
    });

    await page.locator("#partySid").selectOption("000002");
    assert.deepEqual(await page.evaluate(() => ({
      political: document.getElementById("partyPolitical").value,
      league: document.getElementById("partyLeague").value,
      stage: document.getElementById("partyStage").value,
      branch: document.getElementById("partyBranch").value,
      primaryStatus: document.getElementById("partyTraining_primary_status").value,
      primaryDate: document.getElementById("partyTraining_primary_date").value,
      primaryOrganizer: document.getElementById("partyTraining_primary_organizer").value,
      primaryResult: document.getElementById("partyTraining_primary_result").value,
      advancedStatus: document.getElementById("partyTraining_advanced_status").value
    })), {
      political: "共青团员", league: "已推优", stage: "入党积极分子", branch: "第二支部",
      primaryStatus: "已结业", primaryDate: "2026-06-01", primaryOrganizer: "学院党校", primaryResult: "优秀", advancedStatus: "未参加"
    }, "switching students must rehydrate every party and training field");

    await page.locator("#partyTraining_intermediate_status").selectOption("培训中");
    await page.locator("#partyTraining_intermediate_date").fill("2026-10-13");
    await page.locator("#partyTraining_intermediate_organizer").fill("市委党校");
    await page.locator("#partyTraining_intermediate_result").fill("在训");
    await page.locator("#modalOk").click();
    await page.waitForFunction(() => !document.getElementById("modal").classList.contains("show"), null, { timeout: 30000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ modal: document.getElementById("modalBody").innerText, errors: document.querySelector("[data-modal-save-error]")?.textContent || "", student: students.find(item => item.id === "000002") })));
      throw error;
    });
    assert.deepEqual(await page.evaluate(() => ({
      queryReady: queryReady("party"),
      filter: viewFilter.party,
      training: students.find(student => student.id === "000002").party.training.intermediate,
      visibleIds: Array.from(document.querySelectorAll(".module-table-wrap tbody tr")).map(row => row.cells[3] && row.cells[3].textContent).filter(Boolean)
    })), {
      queryReady: true,
      filter: { status: ["在校"], kw: "二号" },
      training: { status: "培训中", date: "2026-10-13", organizer: "市委党校", result: "在训" },
      visibleIds: ["000002"]
    }, "saving must preserve the active ledger filter and return to the current list state");

    await page.evaluate(() => partyView("000002"));
    assert.match(await page.locator("#modalBody").innerText(), /中级党课[\s\S]*培训中[\s\S]*市委党校/);
    await page.evaluate(() => { const original = window.confirm; window.confirm = () => true; try { partyInit("000002"); } finally { window.confirm = original; } });
    assert.deepEqual(await page.evaluate(() => ({ history: students.find(student => student.id === "000002").party.history.length, training: students.find(student => student.id === "000002").party.training.intermediate })), {
      history: 0,
      training: { status: "培训中", date: "2026-10-13", organizer: "市委党校", result: "在训" }
    }, "initializing development history must retain party-course training records");

    await windowPromise(page, () => window.workbench.legacy.flushStore());
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => students.find(student => student.id === "000002").party.training.intermediate.organizer), "市委党校");
    assert.deepEqual(pageErrors, []);
    console.log("qa-party-form-browser: passed (full rehydration, training records, filter state, initialization, persistence)");
  } finally {
    await browser.close();
  }
}, { academicWarning: false }).catch(error => { console.error(error); process.exitCode = 1; });

async function windowPromise(page, callback) {
  await page.evaluate(callback);
}
