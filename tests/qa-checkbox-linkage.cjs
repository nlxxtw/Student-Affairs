'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const area=process.argv.find(x=>x.startsWith('--area='))?.slice(7);
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
   ORG_DEPTS.splice(0,ORG_DEPTS.length,{name:'测试甲学院',code:'01'},{name:'测试乙学院',code:'02'});
   ORG_MAJORS.splice(0,ORG_MAJORS.length,{name:'测试甲专业',dept:'测试甲学院',code:'01'},{name:'测试乙专业',dept:'测试乙学院',code:'02'});
   ORG_GRADES.splice(0,ORG_GRADES.length,{name:'2025'},{name:'2026'});
   ORG_ENROLL_TYPES.splice(0,ORG_ENROLL_TYPES.length,{name:'测试甲类型'},{name:'测试乙类型'});
   ORG_CLASSES.splice(0,ORG_CLASSES.length,{name:'测试甲班',dept:'测试甲学院',major:'测试甲专业',grade:'2025'},{name:'测试乙班',dept:'测试乙学院',major:'测试乙专业',grade:'2026'});
   students=[{id:'QA001',name:'测试甲',cls:'测试甲班',dept:'测试甲学院',major:'测试甲专业',graduateYear:'2026届',status:'在校'},{id:'QA002',name:'测试乙',cls:'测试乙班',dept:'测试乙学院',major:'测试乙专业',graduateYear:'2026届',status:'在校'}];
   saveTermList(['2026-2027-1学期']);saveOrgs();persistStudents();await workbench.legacy.flushStore();
  });
  if(!area||area==='maint') {
   await page.evaluate(()=>goto('maint'));
   for(const tab of ['d5','d1','d2','d3','d4']) {
    await page.locator('.tab[data-t="'+tab+'"]').click();
    const wrap=page.locator('.pane.active #maintTableWrap'),master=wrap.locator('thead input[type=checkbox]'),rows=wrap.locator('tbody input[type=checkbox][data-key]');
    assert.equal(await rows.count(),2);await master.check();
    assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),2,'maintenance '+tab+' select-all must check rows');
    assert.equal(await page.locator('.pane:not(.active) #maintTableWrap tbody input:checked').count(),0,'must not select inactive tabs');
    await rows.first().uncheck();assert.equal(await master.isChecked(),false);assert.equal(await master.evaluate(x=>x.indeterminate),true);
    await rows.last().uncheck();assert.equal(await master.evaluate(x=>x.indeterminate),false);
    await rows.first().check();await rows.last().check();assert.equal(await master.isChecked(),true);
    await page.locator('.pane.active .maint-search').fill(tab==='d3'?'2025':'测试甲');
    assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),1,'filter must clear hidden selection before batch actions');
    await master.uncheck();await master.check();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),1);
    await page.locator('.pane.active .maint-search').fill('没有匹配项');assert.equal(await master.isDisabled(),true);assert.equal(await master.isChecked(),false);
    await page.locator('.pane.active .maint-search').fill('');assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),0);await master.check();await master.uncheck();
   }
   console.log('maintenance: five tabs / grouped rows / search / half-select / inactive-tab isolation passed');
  }
  if(!area||area==='employment') {
   await page.evaluate(async()=>{await goto('employment');employmentSwitchTab('destination');});
   const master=page.locator('#employmentTrackingSelectAll'),rows=page.locator('.employment-tracking-select');
   await master.check();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),2,'tracking select-all must update visible row checkboxes');
   assert.match(await page.locator('#employmentTrackingSelectedCount').innerText(),/2/);assert.equal(await page.locator('#employmentTrackingInitializeBtn').isEnabled(),true);
   await rows.first().uncheck();assert.equal(await master.evaluate(x=>x.indeterminate),true);
   await master.check();await master.uncheck();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),0);
   assert.equal(await page.locator('#employmentTrackingInitializeBtn').isDisabled(),true);
   await page.evaluate(()=>employmentTrackingSetFilter('kw','测试甲'));await master.check();assert.equal(await rows.count(),1);assert.equal(await rows.first().isChecked(),true);
   await page.evaluate(()=>employmentTrackingSetFilter('kw',''));assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),0);
   console.log('employment tracking: selection / counts / button / search reset passed');
  }
  if(!area||area==='academic') {
   await page.evaluate(()=>{academicTerms=[{id:99001,term:CURRENT_TERM,rows:[{_rid:'row-a','学号':'QA001','姓名':'测试甲',courses:[]},{_rid:'row-b','学号':'QA002','姓名':'测试乙',courses:[]}]}];openEditAcademicTerm(99001);});
   const master=page.locator('#aeTableWrap thead input[type=checkbox]'),rows=page.locator('#aeTableWrap .ae-row-cb');
   assert.equal(await rows.count(),2);await master.check();await rows.first().uncheck();
   assert.equal(await master.isChecked(),false,'legacy academic row selection must update header');assert.equal(await master.evaluate(x=>x.indeterminate),true);
   await rows.first().check();assert.equal(await master.isChecked(),true);await master.uncheck();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),0);
   await page.evaluate(()=>closeModal());console.log('academic term editor: row/header bidirectional linkage passed');
  }
  if(!area||area==='other') {
   async function linkage(masterSelector,rowSelector,label){
    const master=page.locator(masterSelector),rows=page.locator(rowSelector);
    assert.equal(await rows.count(),2,label+' fixture');await master.check();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),2,label+' all rows');
    await rows.first().uncheck();assert.equal(await master.isChecked(),false,label+' header unchecked');assert.equal(await master.evaluate(x=>x.indeterminate),true,label+' half selected');
    await master.check();await master.uncheck();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),0,label+' clear');
   }
   await page.evaluate(async()=>{await goto('student');stuQuery();});
   await linkage('#stuChkAll','#stuTbody .stu-row-chk','student');
   await page.evaluate(()=>stuSetPageSize(1));await page.locator('#stuChkAll').check();
   await page.evaluate(()=>stuGoPage(2));assert.equal(await page.locator('#stuTbody .stu-row-chk:checked').count(),0,'student next page must not inherit selection');assert.equal(await page.locator('#stuChkAll').isChecked(),false);
   await page.evaluate(()=>stuGoPage(1));assert.equal(await page.locator('#stuTbody .stu-row-chk:checked').count(),0,'student selection remains page-scoped');await page.evaluate(()=>stuSetPageSize(20));
   await page.evaluate(async()=>{setQueryReady('dorm',true);await goto('dorm');});
   await page.getByRole('tab',{name:'住宿分布',exact:true}).click();
   await linkage('#dormBatchMaster','.dorm-batch-cb','dorm');
   await page.evaluate(()=>{
    for(const s of students)applyFundRecord(s.id,s.name,s.dept,'2026',s.cls,'2026-2027-1学期',{isPoor:false,poorLevel:'未评定等级'});
    openEditFundTerm(fundTermByTerm('2026-2027-1学期').id);
   });
   await linkage('#fundBatchMaster','#fundTableWrap .fund-batch-cb','fund');await page.evaluate(()=>closeModal());
   await page.evaluate(async()=>{employmentIntentionRecords=students.map((s,i)=>({id:'qa-intent-'+i,sid:s.id,intention:'市场就业'}));employmentIntentionPersist();await workbench.legacy.flushStore();await goto('employment');employmentSwitchTab('intention');setQueryReady('employment',true);renderPage('employment');});
   await linkage('#employmentIntentionSelectAll','.employment-intention-select','employment intentions');
   console.log('other lists: student / dorm / funding / employment intentions bidirectional selection passed');
  }
  if(!area||area==='org') {
   await page.evaluate(()=>goto('studentOrgLedger'));
   const org=await (await page.waitForSelector('.student-org-frame iframe')).contentFrame();await org.waitForFunction(()=>typeof DB!=='undefined');
   await org.evaluate(()=>{DB.classrooms=[{id:'cc-1',sid:'QA001',sname:'测试甲',item:'测试甲项目',status:'待审核'},{id:'cc-2',sid:'QA002',sname:'测试乙',item:'测试乙项目',status:'待审核'}];go('classroom');});
   const master=org.locator('thead input[type=checkbox]'),rows=org.locator('.cc-sel');
   await master.check();assert.equal(await rows.evaluateAll(xs=>xs.filter(x=>x.checked).length),2);
   assert.match(await org.locator('#main').innerText(),/已选 2 条/,'second classroom count must refresh immediately');
   await rows.first().uncheck();assert.equal(await master.isChecked(),false);assert.equal(await master.evaluate(x=>x.indeterminate),true);
   await org.evaluate(()=>renderMain());assert.equal(await master.evaluate(x=>x.indeterminate),true,'second classroom rerender must retain correct half selection');
   await master.check();await master.uncheck();assert.match(await org.locator('#main').innerText(),/已选 0 条/);
   console.log('student organizations second classroom: all/row/header/count/rerender passed');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});

