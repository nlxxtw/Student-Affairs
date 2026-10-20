"use strict";
const assert = require("assert"), path = require("path"), os = require("os");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
withIsolatedWorkbench(async origin => {
 const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
 try {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
   const rows = Array.from({ length: 25 }, (_, i) => ({ _rid: "batch-" + i, "学号": "9000" + i, "姓名": "批量测试" + i, "学院": "测试学院", "专业": "测试专业", "年级": "2026", "班级": "测试班", "预警等级": "红色预警", courses: [{ _cid: "course-" + i, "课程名称": "测试课程" }] }));
   ORG_DEPTS.splice(0,ORG_DEPTS.length,{name:'测试学院'});ORG_MAJORS.splice(0,ORG_MAJORS.length,{name:'测试专业',dept:'测试学院'});ORG_CLASSES.splice(0,ORG_CLASSES.length,{name:'测试班',dept:'测试学院',major:'测试专业',grade:'2026'});saveOrgs();
   students = rows.map(row => ({id:row["学号"],name:row["姓名"],dept:'测试学院',major:'测试专业',grade:'2026',cls:'测试班',status:'在校'}));
   localStorage.setItem("nnuzc_students",JSON.stringify(students));
   window.gradeTerms = [{ id: 901, term: CURRENT_TERM, rows: JSON.parse(JSON.stringify(rows)) }]; saveGradeTerms();
   window.academicWarningTerms = [{ id: 902, term: CURRENT_TERM, rows }]; saveAcademicWarningTerms();
   await workbench.legacy.flushStore();
  });
  for (const config of [{ wrap: "grTableWrap", open: "openEditGradeTerm", id: 901, getter: "gradeTermById", key: "gr_", remove: "gradeBatchDelete" }, { wrap: "awTableWrap", open: "openEditAcademicWarningTerm", id: 902, getter: "academicWarningTermById", key: "aw_", remove: "academicWarningBatchDelete" }]) {
   const open = () => page.evaluate(c => window[c.open](c.id), config);
   await open();
   const master = page.locator(`#${config.wrap} .academic-personal-select-all`);
   assert.strictEqual(await master.count(), 1, "each personal academic list needs current-page selection");
   await master.check();
   assert.strictEqual(await page.locator(`#${config.wrap} .academic-personal-row:checked`).count(), 20);
   await page.evaluate(c => pagerGoPage(c.key + c.id, 2), config);
   assert.strictEqual(await page.locator(`#${config.wrap} .academic-personal-row:checked`).count(), 0, "page changes must clear selection");
   await page.evaluate(c => pagerGoPage(c.key + c.id, 1), config);
   await master.check();
   await page.locator(config.wrap==='grTableWrap'?'#grKw':'#awKw').fill('批量测试24');
   await page.evaluate(c => c.wrap==='grTableWrap'?gradeEditQuery(c.id):academicWarningEditQuery(c.id), config);
   assert.strictEqual(await page.locator(`#${config.wrap} .academic-personal-row`).count(), 1);
   assert.strictEqual(await page.locator(`#${config.wrap} .academic-personal-row:checked`).count(), 0, "query changes must clear hidden selection");
   await page.locator(config.wrap==='grTableWrap'?'#grKw':'#awKw').fill('');
   await page.evaluate(c => c.wrap==='grTableWrap'?gradeEditQuery(c.id):academicWarningEditQuery(c.id), config);
   await page.locator(`#${config.wrap} .academic-personal-row`).nth(0).check();
   await page.locator(`#${config.wrap} .academic-personal-row`).nth(1).check();
   assert.strictEqual(await master.evaluate(node => node.indeterminate), true);
   const button = page.locator(`[data-personal-batch="${config.wrap}"]`);
   assert.match(await button.innerText(), /2/);
   await page.evaluate(async c => {
    const savedDemo=WORKBENCH_DEMO_STATUS;
    WORKBENCH_DEMO_STATUS={active:true};licenseApplyUiState();
    await window[c.remove](c.id);
    if(window[c.getter](c.id).rows.length!==25)throw Error('demo delete changed data');
    WORKBENCH_DEMO_STATUS=savedDemo;licenseApplyUiState();personalAcademicSelectionUpdate(c.wrap);
   }, config);
   page.once("dialog", dialog => dialog.dismiss());
   await button.click();
   await page.waitForFunction(wrap => !document.querySelector('[data-personal-batch="'+wrap+'"]').disabled, config.wrap);
   assert.strictEqual(await page.evaluate(c => window[c.getter](c.id).rows.length, config), 25);
   await page.route("**/api/recycle-bin/delete-preview", route => route.abort());
   await button.click();
   await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-personal-batch]')).some(button => !button.disabled));
   assert.strictEqual(await page.locator(`#${config.wrap} .academic-personal-row:checked`).count(), 2, "failed delete must retain selection");
   await page.unroute("**/api/recycle-bin/delete-preview");
   page.once("dialog", dialog => { assert.match(dialog.message(), /2 条数据/); return dialog.accept(); });
   await button.click();
   await page.waitForFunction(c => window[c.getter](c.id).rows.length === 23, config);
   assert.strictEqual(await page.evaluate(c => window[c.getter](c.id).rows.some(row => row._rid === "batch-0" || row._rid === "batch-1"), config), false);
   assert.strictEqual(await page.locator(`#${config.wrap} .academic-personal-row:checked`).count(), 0);
   assert.strictEqual(await button.isDisabled(), true);
   await page.reload({ waitUntil: "networkidle" });
   assert.strictEqual(await page.evaluate(c => window[c.getter](c.id).rows.length, config), 23, "batch deletion must persist after reload");
  }
  const recycled = await page.evaluate(async () => {
   const list=await workbench.legacy.recycleList({});
   return Promise.all(list.items.filter(item=>['gradeRow','academicWarningRow'].includes(item.moduleKey)).map(item=>workbench.legacy.recycleGet(item.id)));
  });
  assert.strictEqual(recycled.length, 4, "both batches must be retained in the recycle bin");
  assert.ok(recycled.every(item => item.payload.row.courses.length === 1), "deletion must preserve each row's course details for recovery");
  console.log("qa-personal-academic-batch-delete: passed (both lists, current-page selection, mixed state, cancellation, failure retention, persistence/recycle)");
 } finally { await browser.close(); }
}).catch(error => { console.error(error); process.exitCode = 1; });
