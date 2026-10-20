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
    const page = await browser.newPage({ viewport: { width: 1400, height: 960 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/?goto=student", { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      ORG_DEPTS.splice(0,ORG_DEPTS.length,{name:"测试学院"},{name:"另一学院"});
      ORG_MAJORS.splice(0,ORG_MAJORS.length,{name:"测试专业",dept:"测试学院"},{name:"另一专业",dept:"另一学院"});
      ORG_CLASSES.splice(0,ORG_CLASSES.length,{name:"测试班",dept:"测试学院",major:"测试专业",grade:"2025级"},{name:"另一班",dept:"另一学院",major:"另一专业",grade:"2024级"});
      ORG_GRADES.splice(0,ORG_GRADES.length,{name:"2025级"},{name:"2024级"});saveOrgs();
      if(window.workbench?.legacy?.flushStore)await window.workbench.legacy.flushStore();
      students.splice(0, students.length,
        { id:"QA001",name:"完整学生",dept:"测试学院",major:"测试专业",grade:"2025级",cls:"测试班",status:"休学",dorm:[],classroom:[],punishments:[],fund:{} },
        { id:"QA002",name:"同名学生",dept:"测试学院",major:"测试专业",grade:"2025级",cls:"测试班",status:"退学",dorm:[],classroom:[],punishments:[],fund:{} },
        { id:"QA003",name:"同名学生",dept:"另一学院",major:"另一专业",grade:"2024级",cls:"另一班",status:"在校",dorm:[],classroom:[],punishments:[],fund:{} },
        { id:"QA004",name:"唯一学生乙",dept:"另一学院",major:"另一专业",grade:"2024级",cls:"另一班",status:"延期毕业",dorm:[],classroom:[],punishments:[],fund:{} }
      );
      persistStudents(); if(window.workbench?.legacy?.flushStore)await window.workbench.legacy.flushStore();
      const fields=[{key:"sid",label:"学号"},{key:"name",label:"姓名"},{key:"dept",label:"学院"},{key:"major",label:"专业"},{key:"grade",label:"年级"},{key:"cls",label:"班级"}];
      window.__qaLinked=StudentLinkIntegrity.reconcileImportRows([
        {sid:"QA001",name:"错误姓名",dept:"错误学院",major:"",grade:"",cls:""},
        {sid:"MISSING",name:"缺失学生",dept:"",major:"",grade:"",cls:""},
        {sid:"QA001",name:"唯一学生乙",dept:"",major:"",grade:"",cls:""}
      ],fields,students);
      window.__qaLinkedPromise=studentLinkConfirmImport("专项测试",window.__qaLinked);
    });
    const importLayer=page.locator("#studentLinkImportLayer");await importLayer.waitFor({state:"visible"});
    assert.match(await importLayer.innerText(), /全部学籍状态/);
    assert.match(await importLayer.innerText(), /3 行学号与姓名未能同时一致/);
    assert.match(await importLayer.innerText(), /学号“QA001”与姓名“唯一学生乙”分别对应不同学生/);
    await page.locator("#studentLinkIdentityChoice-1").selectOption("skip");
    await page.locator("#studentLinkIdentityChoice-2").selectOption("name");
    await importLayer.getByRole("button",{name:/确认并继续导入/}).click();
    const linked=await page.evaluate(async()=>({decision:await window.__qaLinkedPromise,accepted:window.__qaLinked.accepted,rejected:window.__qaLinked.rejected,corrections:window.__qaLinked.corrections}));
    assert.equal(linked.decision.confirmed,true);assert.equal(linked.accepted.length,2);assert.equal(linked.rejected.length,1);
    assert.deepEqual(linked.accepted[0],{sid:"QA001",name:"完整学生",dept:"测试学院",major:"测试专业",grade:"2025级",cls:"测试班"});
    assert.deepEqual(linked.accepted[1],{sid:"QA004",name:"唯一学生乙",dept:"另一学院",major:"另一专业",grade:"2024级",cls:"另一班"});
    assert.ok(linked.corrections.some(item=>item.field==="学院"&&item.before==="错误学院"&&item.after==="测试学院"));

    const organizationAfterStudentDelete=await page.evaluate(async()=>{
      const state={orgs:[{id:"org-1",name:"独立学生组织",structure:[{id:"node-1",name:"部门",members:[{sid:"QA002",name:"同名学生",position:"成员"}],children:[]}]}],classrooms:[{id:"classroom-1",sid:"QA002",sname:"同名学生",item:"志愿服务"}]};
      const custom={version:2,activeId:"one",datasets:[{id:"one",name:"测试档案",state:{fields:[],rows:[{id:"custom-qa002",values:{studentNo:"QA002",name:"同名学生"}}]}}]};
      localStorage.setItem("nnuzc_student_org_v1",JSON.stringify(state));localStorage.setItem("nnuzc_custom_roster_v1",JSON.stringify(custom));if(window.workbench?.legacy?.flushStore)await window.workbench.legacy.flushStore();
      const api=recycleApi(),preview=await api.recycleStudentDeletePreview(["QA002"]),moved=await api.recycleStudentMove({requestId:recycleRequestId(),previewToken:preview.previewToken,confirmation:"移入回收站"});recycleApplySnapshots(moved.storeValues);
      const afterMove={state:JSON.parse(localStorage.getItem("nnuzc_student_org_v1")),custom:JSON.parse(localStorage.getItem("nnuzc_custom_roster_v1")),studentExists:students.some(item=>item.id==="QA002")};
      const restorePreview=await api.recycleRestorePreview(moved.items[0].id),restored=await api.recycleRestore(moved.items[0].id,{requestId:recycleRequestId(),previewToken:restorePreview.previewToken,confirmation:"恢复数据"});recycleApplySnapshots(restored.storeValues);
      afterMove.restoredCustom=JSON.parse(localStorage.getItem("nnuzc_custom_roster_v1"));afterMove.restoredStudent=students.some(item=>item.id==="QA002");return afterMove;
    });
    assert.equal(organizationAfterStudentDelete.studentExists,false);assert.equal(organizationAfterStudentDelete.state.orgs[0].structure[0].members[0].sid,"QA002","student organization membership must survive master-student deletion");assert.equal(organizationAfterStudentDelete.state.classrooms[0].sid,"QA002","student organization classroom data must survive master-student deletion");
    assert.deepEqual(organizationAfterStudentDelete.custom.datasets[0].state.rows,[],"custom-roster rows must enter the student archive with the master record");assert.equal(organizationAfterStudentDelete.restoredStudent,true);assert.equal(organizationAfterStudentDelete.restoredCustom.datasets[0].state.rows[0].values.studentNo,"QA002","restoring the student archive must restore custom-roster rows");

    await page.evaluate(async()=>{
      localStorage.setItem("nnuzc_student_loan_records",JSON.stringify([{studentId:"QA001",year:"2025-2026学年"},{studentId:"MISSING",year:"2025-2026学年"}]));
      localStorage.setItem("nnuzc_student_integrity_review_version","旧版本");
      if(window.workbench?.legacy?.flushStore)await window.workbench.legacy.flushStore();
      studentIntegrityCheckAfterUpdate();
    });
    const updateLayer=page.locator("#studentIntegrityUpdateLayer");await updateLayer.waitFor({state:"visible"});
    assert.match(await updateLayer.innerText(), /系统更新后学生关联检查[\s\S]*助学贷款[\s\S]*MISSING/);
    await updateLayer.getByRole("button",{name:"继续保留数据"}).click();await updateLayer.waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("nnuzc_student_loan_records")).length),2,"keep must preserve orphan data");
    assert.equal(await page.evaluate(()=>localStorage.getItem("nnuzc_student_integrity_review_version")),await page.evaluate(()=>SYS_VER));

    await page.evaluate(async()=>{localStorage.setItem("nnuzc_student_integrity_review_version","旧版本");if(window.workbench?.legacy?.flushStore)await window.workbench.legacy.flushStore();studentIntegrityCheckAfterUpdate();});
    await updateLayer.waitFor({state:"visible"});
    const reloaded=page.waitForNavigation({waitUntil:"domcontentloaded"});await updateLayer.getByRole("button",{name:"删除数据",exact:true}).click();await reloaded;await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem("nnuzc_student_loan_records"))),[{studentId:"QA001",year:"2025-2026学年"}],"delete must remove only orphan records");
    assert.deepEqual(errors,[]);
    console.log("qa-student-link-integrity-browser: passed (manual confirmation, all-status match, organization exception, correction, missing-row skip, update keep/delete)");
  } finally { await browser.close(); }
});
