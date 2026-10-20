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
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?goto=student", { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0,ORG_DEPTS.length,{name:"测试学院"}); ORG_MAJORS.splice(0,ORG_MAJORS.length,{name:"测试专业",dept:"测试学院"}); ORG_GRADES.splice(0,ORG_GRADES.length,{name:"2025级"});
      ORG_CLASSES.splice(0, ORG_CLASSES.length, {name:"测试班",dept:"测试学院",major:"测试专业",grade:"2025级",level:"大专",enrollType:"特殊招生"}); saveOrgs(); if (window.workbench?.legacy?.flushStore) await window.workbench.legacy.flushStore();
      students.splice(0, students.length,
        {id:"QA001",name:"学生甲",dept:"测试学院",major:"测试专业",grade:"2025级",cls:"测试班",level:"大专",status:"在校",enrollType:"自定义招生",dorm:[],classroom:[],punishments:[],fund:{}},
        {id:"QA002",name:"学生乙",dept:"测试学院",major:"测试专业",grade:"2025级",cls:"测试班",level:"本科",status:"在校",enrollType:"其他自定义",dorm:[],classroom:[],punishments:[],fund:{}}
      ); persistStudents(); if (window.workbench?.legacy?.flushStore) await window.workbench.legacy.flushStore();
      talkRecords.splice(0, talkRecords.length, {id:"T1",sid:"QA001",name:"学生甲",type:"随意填写",way:"电话",mood:"好"}); persistTalks(); if (window.workbench?.legacy?.flushStore) await window.workbench.legacy.flushStore();
      const employment=xcmGet("employment");employment.records.splice(0,employment.records.length,
        {id:"E1",sid:"QA001",name:"学生甲",company:"甲公司",type:"其他",date:"2026-06-01"},
        {id:"E2",sid:"QA002",name:"学生乙",company:"乙公司",type:"其他",date:"2026-06-02"}
      );xcmPersist("employment");if (window.workbench?.legacy?.flushStore) await window.workbench.legacy.flushStore();
      localStorage.setItem("nnuzc_fixed_value_review_version", "旧版本");
      if (window.workbench?.legacy?.flushStore) await window.workbench.legacy.flushStore();
      await fixedValueReviewCheckAfterUpdate();
    });
    const layer = page.locator("#fixedValueReviewLayer");
    await layer.waitFor({state:"visible"});
    assert.match(await layer.innerText(), /学生信息[\s\S]*学历[\s\S]*大专/);
    assert.match(await layer.innerText(), /班级基础数据/);
    assert.match(await layer.innerText(), /谈心谈话/);
    assert.match(await layer.innerText(), /建议：专科/);
    assert.match(await layer.innerText(), /QA001[\s\S]*学生甲/);
    assert.doesNotMatch(await layer.innerText(), /甲公司|乙公司|去向类型/, "graduate destination values are free text");
    assert.equal(await layer.locator("select[data-review-index]").count(), 3, "only fixed-option records need decisions");
    assert.equal(await layer.locator("select[data-review-index]").first().inputValue(), "", "suggestion must not be selected automatically");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_students")).map(row => row.level).sort()), ["大专","本科"].sort(), "scan must not mutate historical data");
    await layer.getByRole("button", {name:"保留原值，稍后处理"}).click();
    await layer.waitFor({state:"detached"});
    assert.equal(await page.evaluate(() => localStorage.getItem("nnuzc_fixed_value_review_version") === FIXED_VALUE_REVIEW_SIGNATURE), true);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_students")).find(row => row.id === "QA001").level), "大专");
    await page.evaluate(async () => {
      localStorage.setItem("nnuzc_fixed_value_review_version", "旧版本");
      if (window.workbench?.legacy?.flushStore) await window.workbench.legacy.flushStore();
      await fixedValueReviewCheckAfterUpdate();
    });
    await layer.waitFor({state:"visible"});
    const choices = layer.locator("select[data-review-index]");
    await choices.nth(0).selectOption("专科");
    await choices.nth(1).selectOption("专科");
    const navigation = page.waitForNavigation({waitUntil:"domcontentloaded"});
    await layer.getByRole("button", {name:"应用所选修改"}).click();
    await navigation;
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_students")).map(row => row.level).sort()), ["专科","本科"].sort());
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_orgs")).classes[0].level), "专科");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_talks"))[0].type), "随意填写", "unchosen mismatch must remain intact");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_employment")).map(row => row.type)), ["其他","其他"], "graduate destination values must remain untouched");
    assert.equal(await page.evaluate(() => Object.hasOwn(importFixedOptions("毕业生就业"), "去向类型")), false, "graduate destination import must not enforce a fixed list");
    await page.evaluate(() => { xcmGet("employment").year=""; xcmOpen("employment", "E1"); });
    const destinationInput=page.locator("#xcm_type");
    assert.equal(await destinationInput.evaluate(input => input.tagName), "INPUT", "destination type must allow free entry");
    assert.equal(await destinationInput.getAttribute("list"), "xcm_type_suggestions");
    await destinationInput.fill("求职中");
    await page.locator("#modalOk").click();
    await page.waitForFunction(() => !document.getElementById("modal").classList.contains("show"));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("nnuzc_employment"))[0].type), "求职中", "custom destination must persist");
    await page.evaluate(async () => {
      talkRecords.splice(0,talkRecords.length,...Array.from({length:52},(_,index)=>({id:"PAGE"+index,sid:"QA001",name:"学生甲",date:"2026-01-"+String(index+1).padStart(2,"0"),type:"随意填写",way:"电话",mood:"好"})));
      persistTalks();localStorage.setItem("nnuzc_fixed_value_review_version","旧版本");
      if(window.workbench?.legacy?.flushStore)await window.workbench.legacy.flushStore();
      await fixedValueReviewCheckAfterUpdate();
    });
    await layer.waitFor({state:"visible"});
    assert.match(await layer.locator("#fixedValueReviewPageInfo").innerText(), /第 1 \/ 2 页/);
    await layer.locator("tr",{hasText:"日期 2026-01-01"}).locator("select[data-review-index]").selectOption("日常");
    await layer.locator("#fixedValueReviewNext").click();
    assert.match(await layer.locator("#fixedValueReviewPageInfo").innerText(), /第 2 \/ 2 页/);
    await layer.locator("tr",{hasText:"日期 2026-01-52"}).locator("select[data-review-index]").selectOption("预警");
    await layer.locator("#fixedValueReviewPrev").click();
    assert.equal(await layer.locator("tr",{hasText:"日期 2026-01-01"}).locator("select[data-review-index]").inputValue(),"日常","page change must preserve earlier choice");
    const pageNavigation=page.waitForNavigation({waitUntil:"domcontentloaded"});
    await layer.getByRole("button", {name:"应用所选修改"}).click();await pageNavigation;
    assert.deepEqual(await page.evaluate(() => {const rows=JSON.parse(localStorage.getItem("nnuzc_talks"));return [rows[0].type,rows[1].type,rows[51].type];}),["日常","随意填写","预警"],"cross-page choices must update only selected records");
    assert.deepEqual(errors, []);
    console.log("qa-fixed-value-review-browser: passed (record identities, read-only scan, keep, version rescan, per-record corrections)");
  } finally { await browser.close(); }
});
