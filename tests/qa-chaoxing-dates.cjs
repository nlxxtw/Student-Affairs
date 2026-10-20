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
   saveTermList(['2025-2026-1学期','2026-2027-1学期','2026-2027-2学期']);localStorage.setItem('nnuzc_current_term','2026-2027-1学期');
   const cfg=getTermSettings();cfg['2025-2026-1学期']={startDate:'2025-09-01',totalWeeks:21};cfg['2026-2027-1学期']={startDate:'2026-09-07',totalWeeks:20};cfg['2026-2027-2学期']={startDate:'2027-02-22',totalWeeks:20};saveTermSettings(cfg);
   ORG_DEPTS.push({name:'日期学院',code:'QAD'});ORG_MAJORS.push({name:'日期专业',dept:'日期学院',code:'QAD1'});ORG_CLASSES.push({name:'日期班',dept:'日期学院',major:'日期专业',grade:'2026'});saveOrgs();
   students=[{id:'001',name:'日期学生',cls:'日期班',dept:'日期学院',major:'日期专业',grade:'2026',status:'在校',classroom:[]}];persistStudents();await workbench.legacy.flushStore();
  });await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>goto('checkClass'));
  async function upload(titles,states){
   await page.getByRole('button',{name:'导入学习通考勤',exact:true}).click();const rows=[['课程：日期识别课    班级：日期教学班'],['姓名','学号',...titles],['日期学生','001',...states]];
   const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),'签到详情统计');await page.locator('#cxFiles').setInputFiles({name:'日期测试.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(b,{type:'buffer',bookType:'xlsx'}))});await page.waitForFunction(n=>ChaoxingAttendance.getState()?.activities.length===n,titles.length);
  }
  await upload(['10.07上课','10/7下课','1月7日上课','1/7下课','2月25日上课','2.25下课'],['已签','未参与','未参与','已签','公假','公假']);
  let activities=await page.evaluate(()=>ChaoxingAttendance.getState().activities);assert.deepEqual(activities.map(a=>a.date),['2026-10-07','2026-10-07','2027-01-07','2027-01-07','2027-02-25','2027-02-25']);assert.equal(activities[4].term,'2026-2027-2学期');assert.ok(activities[1].pair&&activities[3].pair&&activities[5].pair);assert.ok(activities.every(a=>a.course==='日期识别课'));
  await page.locator('#modalOk').click();await page.waitForFunction(()=>ChaoxingAttendance.getState()?.prepared);let records=await page.evaluate(()=>ChaoxingAttendance.getState().prepared.plans.map(p=>p.record));assert.equal(records.length,3);assert.deepEqual(records.map(r=>[r.date,r.earlyStudentIds.length,r.lateStudentIds.length,r.publicLeaveStudentIds.length]),[['2026-10-07',1,0,0],['2027-01-07',0,1,0],['2027-02-25',0,0,1]]);
  await page.locator('#modalOk').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));assert.deepEqual(await page.evaluate(()=>students[0].classroom.map(r=>[r.date,r.term,r.type]).sort()),[['2026-10-07','2026-2027-1学期','早退'],['2027-01-07','2026-2027-1学期','迟到'],['2027-02-25','2026-2027-2学期','公假']].sort());
  await upload(['10/7上课','10/7下课'],['已签','已签']);await page.locator('#cxTerm').selectOption('2025-2026-1学期');assert.deepEqual(await page.evaluate(()=>ChaoxingAttendance.getState().activities.map(a=>a.date)),['2025-10-07','2025-10-07']);
  await page.locator('[data-cx="term"][data-i="1"]').selectOption('2026-2027-1学期');assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().activities[1].date),'2026-10-07');await page.locator('[data-cx="term"][data-i="1"]').selectOption('2025-2026-1学期');
  await page.locator('[data-cx="date"][data-i="0"]').fill('2025-10-08');await page.locator('[data-cx="date"][data-i="0"]').dispatchEvent('change');await page.locator('#cxTerm').selectOption('2026-2027-1学期');assert.deepEqual(await page.evaluate(()=>ChaoxingAttendance.getState().activities.map(a=>a.date)),['2025-10-08','2026-10-07'],'manual date remains explicit while inferred date changes with term');await page.locator('#modalOk').click();assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().prepared),null);await page.evaluate(()=>closeModal());
  await upload(['签到2026/10/07至2026/10/08','签到(2026/02/30)'],['已签','已签']);await page.locator('#modalOk').click();assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().prepared),null);assert.equal(await page.evaluate(()=>checkClassRecords.length),3);await page.evaluate(()=>closeModal());
  await upload(['4月25日上课(2027/04/24)','4月25日下课(2027/04/24)'],['已签','未参与']);activities=await page.evaluate(()=>ChaoxingAttendance.getState().activities);assert.equal(activities[0].date,'2027-04-24');assert.equal(activities[0].term,'2026-2027-2学期');assert.ok(activities[0].warnings.some(w=>w.includes('冲突')));await page.locator('#modalOk').click();await page.waitForFunction(()=>ChaoxingAttendance.getState()?.prepared);assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().prepared.plans[0].record.date),'2027-04-24');await page.evaluate(()=>closeModal());
  await upload(['10.07上课','10/7下课'],['已签','未参与']);await page.locator('#cxTerm').selectOption('2025-2026-1学期');await page.locator('#modalOk').click();await page.waitForFunction(()=>ChaoxingAttendance.getState()?.prepared);assert.equal(await page.evaluate(()=>ChaoxingAttendance.getState().prepared.plans[0].action),'新增','same month/day titles in another academic year must not overwrite existing annual attendance');await page.locator('#modalOk').click();await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));assert.equal(await page.evaluate(()=>checkClassRecords.length),4);assert.deepEqual(await page.evaluate(()=>students[0].classroom.filter(r=>r.type==='早退').map(r=>r.date).sort()),['2025-10-07','2026-10-07']);
  assert.deepEqual(errors,[]);console.log('qa-chaoxing-dates: passed (header formats, year inference, cross-year, calendar routing, pairing, linked dates, manual dates, conflicts, invalid dates)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
