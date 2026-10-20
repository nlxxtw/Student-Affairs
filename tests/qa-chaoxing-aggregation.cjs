"use strict";
const assert=require('assert'),path=require('path'),os=require('os');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const XLSX=require('../assets/xlsx.full.min.js');
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(10000);
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
   saveTermList(['2026-2027-1学期']);localStorage.setItem('nnuzc_current_term','2026-2027-1学期');const cfg=getTermSettings();cfg['2026-2027-1学期']={startDate:'2026-09-07',totalWeeks:20};saveTermSettings(cfg);
   ORG_DEPTS.push({name:'归纳学院',code:'QA'});ORG_MAJORS.push({name:'归纳专业',dept:'归纳学院',code:'QA01'});['甲班','乙班'].forEach(name=>ORG_CLASSES.push({name,dept:'归纳学院',major:'归纳专业',grade:'2026'}));saveOrgs();
   students=['001','002','003','004','005','006'].map((id,i)=>({id,name:'学生'+id,cls:i<4?'甲班':'乙班',dept:'归纳学院',major:'归纳专业',grade:'2026',status:'在校',classroom:[]}));persistStudents();await workbench.legacy.flushStore();
  });await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>goto('checkClass'));
  function file(entries){const rows=[['课程：归纳课程    班级：合班教学班    任课教师：测试教师'],['姓名','学号','10月7日第1-2节上课(2026/10/07)','10月7日第1-2节下课(2026/10/07)'],['','','状态','状态'],...entries.map(([id,start,end])=>['学生'+id,id,start,end])];const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),'签到详情统计');return {name:'合班签到.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(b,{type:'buffer',bookType:'xlsx'}))};}
  async function preview(entries){await page.getByRole('button',{name:'导入学习通考勤',exact:true}).click();await page.locator('#cxFiles').setInputFiles(file(entries));await page.waitForFunction(()=>ChaoxingAttendance.getState()?.activities.length===2);await page.locator('#modalOk').click();await page.waitForFunction(()=>ChaoxingAttendance.getState()?.prepared);return page.evaluate(()=>ChaoxingAttendance.getState().prepared.plans[0].record);}
  async function save(){await page.locator('#modalOk').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));}
  const original=[['001','已签','未参与'],['002','未参与','已签'],['003','未参与','未参与'],['004','公假','公假'],['005','病假','病假'],['006','已签','已签']];
  let r=await preview(original);assert.equal(r.headcount,'6');assert.equal(r.attended,'3');assert.equal(r.leave,'2');assert.equal(r.rate,'50.0%');
  await page.locator('[data-cx-summary="0"]').click();assert.match(await page.locator('#cxPersonPreview').innerText(),/甲班/);assert.match(await page.locator('#cxPersonPreview').innerText(),/乙班/);assert.deepEqual(r.sourceClassSummary.map(c=>[c.cls,c.total,c.attended,c.leave,c.absent]).sort(),[['乙班',2,1,1,0],['甲班',4,2,1,1]].sort());await save();const id=r.id;
  r=await preview([['001','已签','已签'],['006','已签','已签']]);
  assert.equal(r.headcount,'6','partial correction must retain absent students not mentioned in the new file');assert.equal(r.sourceRetainedCount,4);assert.deepEqual(r.absentStudentIds,['003']);assert.deepEqual(r.lateStudentIds,['002']);assert.deepEqual(r.earlyStudentIds,[]);assert.equal(r.leave,'2');await save();
  assert.equal(await page.evaluate(()=>checkClassRecords.length),1);assert.equal(await page.evaluate(()=>students.find(s=>s.id==='003').classroom.filter(r=>r.type==='旷课').length),1);
  r=await preview([['005','公假','公假']]);assert.equal(r.id,id,'class-specific export must correct the same joint lesson');assert.equal(r.headcount,'6');assert.equal(r.sourceRetainedCount,5);assert.deepEqual(r.classes,['乙班','甲班'].sort());assert.deepEqual(r.publicLeaveStudentIds,['004','005']);assert.deepEqual(r.sickLeaveStudentIds,[]);await save();
  assert.equal(await page.evaluate(()=>checkClassRecords.length),1);assert.equal(await page.evaluate(()=>students.find(s=>s.id==='005').classroom.filter(r=>r.type==='病假').length),0);assert.equal(await page.evaluate(()=>students.find(s=>s.id==='005').classroom.filter(r=>r.type==='公假').length),1);
  await preview([['005','公假','公假']]);assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().prepared.plans[0].action),'跳过');await save();
  assert.equal(await page.evaluate(()=>ccLeaveRecordIds(checkClassRecords[0]).length),2,'all leave totals must include public leave');
  await page.getByRole('button',{name:'导入学习通考勤',exact:true}).click();await page.locator('#cxFiles').setInputFiles(file(original));await page.waitForFunction(()=>ChaoxingAttendance.getState()?.activities.length===2);
  await page.evaluate(()=>{
   window.qaOriginalScheduleMatches=courseScheduleMatches;
   courseScheduleMatches=(term,cls,date)=>({rows:cls==='甲班'?[{course:'归纳课程',section:'第3-4节',teacher:'课表教师',location:'教室',category:'理论'}]:[]});
   ChaoxingAttendance.getState().activities.forEach(a=>{a.period='';a.pair='';});
  });await page.locator('#cxMatch').click();assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().activities[0].period),'','one administrative class timetable must not be assigned to the whole joint class');
  await page.evaluate(()=>{
   courseScheduleMatches=()=>({rows:[{course:'归纳课程',section:'第3-4节',teacher:'课表教师',location:'教室',category:'理论'}]});
  });await page.locator('#cxMatch').click();assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().activities[0].teacher),'测试教师','explicit source teacher must survive timetable completion');
  await page.evaluate(()=>{
   courseScheduleMatches=qaOriginalScheduleMatches;
   const a=ChaoxingAttendance.getState().activities;a.forEach(v=>{v.period='';v.pair='';});a[0].title='归纳课程上午上课';a[1].title='归纳课程下午下课';
  });await page.locator('#cxMatch').click();assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().activities[1].pair),'','different sessions must not automatically pair');
  await page.evaluate(()=>closeModal());
  await page.evaluate(async()=>{const batches=JSON.parse(localStorage.getItem('nnuzc_chaoxing_imports'));await chaoxingUndo(batches.at(-1).id);});
  assert.equal(await page.evaluate(()=>checkClassRecords[0].headcount),'6');assert.deepEqual(await page.evaluate(()=>checkClassRecords[0].sickLeaveStudentIds),['005']);assert.equal(await page.evaluate(()=>students.find(s=>s.id==='005').classroom.filter(r=>r.type==='病假').length),1);await page.evaluate(()=>closeModal());
  await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>goto('checkClass'));
  await page.evaluate(async()=>{
   const r=checkClassRecords[0],before={},after={};Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>{before[k]=ccBehaviorRecordIds(r,k);after[k]=before[k].slice();});after.absent=[];after.late.push('003');r.absentStudentIds=[];r.lateStudentIds=after.late;r.attended='4';r.late='2';r.rate='66.7%';ccSyncBehaviorRecords(r.id,before,after,r);persistCheckClass();persistStudents();await workbench.legacy.flushStore();
  });
  await page.evaluate(id=>chaoxingImportDetails(id),id);
  const currentRow=page.locator('#modal tbody tr').filter({hasText:'003'});assert.match(await currentRow.innerText(),/旷课/);assert.match(await currentRow.innerText(),/迟到/);await page.evaluate(()=>closeModal());
  r=await preview([['005','公假','公假']]);assert.equal(r.headcount,'6');assert.equal(r.attended,'4');assert.equal(r.rate,'66.7%');assert.deepEqual(r.absentStudentIds,[]);assert.deepEqual(r.lateStudentIds,['002','003']);await save();
  assert.equal(await page.evaluate(()=>students.find(s=>s.id==='003').classroom.filter(r=>r.type==='迟到').length),1);assert.equal(await page.evaluate(()=>checkClassRecords.length),1);
  assert.deepEqual(errors,[]);console.log('qa-chaoxing-aggregation: passed (joint class, partial correction, roster preservation, counts, public leave, repeated fragments)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
