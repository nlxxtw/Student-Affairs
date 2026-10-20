"use strict";
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
const XLSX=require('../assets/xlsx.full.min.js');
withIsolatedWorkbench(async(origin,{restart})=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?goto=academicPublic',{waitUntil:'networkidle'});
  async function req(route,body,method='POST',headers={}){const r=await page.request.fetch(origin+'/api/academic-public'+route,{method:body===undefined?'GET':method,headers:{Origin:origin,...headers},data:body});return {status:r.status(),body:await r.json()};}
  const people=[{id:'001',name:'甲',dept:'测试学院',major:'测试专业',grade:'2026级',cls:'测试班'},{id:'002',name:'乙',dept:'测试学院',major:'测试专业',grade:'2026级',cls:'测试班'}];
  const orgs={depts:[{name:'测试学院'}],majors:[{name:'测试专业',dept:'测试学院'}],classes:[{name:'测试班',dept:'测试学院',major:'测试专业',grade:'2026级'}]};assert.equal((await page.request.put(origin+'/api/store/nnuzc_orgs',{headers:{Origin:origin},data:{value:JSON.stringify(orgs)}})).status(),200);
  const seed=await page.request.put(origin+'/api/store/nnuzc_students',{headers:{Origin:origin},data:{value:JSON.stringify(people)}});assert.equal(seed.status(),200,await seed.text());
  assert.equal((await page.request.put(origin+'/api/store/nnuzc_term_list',{headers:{Origin:origin},data:{value:JSON.stringify(['2026-2027-1学期','2027-2028-1学期'])}})).status(),200);
  const rules={thresholds:[2,3,4,6],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60};
  let state=(await req('/state?term=2026-2027-1')).body;
  let p=await req('/rule-preview',{version:state.version,rules});assert.equal(p.status,200,JSON.stringify(p.body));assert.equal((await req('/rules',{previewId:p.body.previewId},'PUT')).status,200);
  const rows=people.flatMap((s,i)=>['A','B'].map((code,j)=>({'学号':s.id,'姓名':s.name,'原修读学期':'2026-2027-1','课程代码':code,'课程名称':code==='A'?'高数':'英语','学分':j?'2':'3','课程类别':'必修','总评成绩':i?'75':j?'40':'50','成绩制':'百分制','考试状态':'已出分','考试批次':'期末','考试日期':'2027-01-01'})));
  async function commit(type,rows){const p=await req('/previews',{type,rows});assert.equal(p.status,200,JSON.stringify(p.body));assert.equal(p.body.counts.errors,0,JSON.stringify(p.body.errors));const key=crypto.randomUUID(),body={previewId:p.body.previewId,acceptValid:true};const result=await req('/commits',body,'POST',{'Idempotency-Key':key});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal((await req('/commits',body,'POST',{'Idempotency-Key':key})).body.batchId,result.body.batchId);return result.body;}
  const initial=await commit('original',rows);state=(await req('/state?term=2026-2027-1')).body;assert.equal(state.rows.find(r=>r.sid==='001').fail,2,JSON.stringify(state.rows.map(r=>({sid:r.sid,fail:r.fail,count:r.count,details:r.details}))));assert.equal(state.rows.find(r=>r.sid==='001').level,'黄色预警');assert.equal(state.rows.find(r=>r.sid==='001').average,46);
  const same=await req('/previews',{type:'original',rows:[rows[0],rows[0]]});assert.equal(same.body.counts.errors,0);assert.equal(same.body.counts.duplicates,2);
  const conflict=await req('/previews',{type:'original',rows:[rows[0],{...rows[0],'总评成绩':'77'}]});assert.equal(conflict.body.counts.valid,0);assert.equal(conflict.body.counts.errors,2);
  const c=state.cases[0];assert.equal((await req('/case-actions',{version:state.version,id:c.id,action:'confirm',reason:'已核验'})).status,200);
  state=(await req('/state?term=2026-2027-1')).body;
  const task=await req('/case-task',{version:state.version,id:c.id});assert.equal(task.status,200);
  state=(await req('/state?term=2026-2027-1')).body;
  assert.equal((await req('/case-task',{version:state.version,id:c.id})).body.taskId,task.body.taskId);
  const tasks=JSON.parse((await (await page.request.get(origin+'/api/store')).json()).nnuzc_tasks);assert.equal(tasks.filter(x=>x.academicPublicCaseId===c.id).length,1);
  const mk=await commit('makeup',[{...rows[0],'补考成绩':'80','考试批次':'补考1','考试日期':'2027-02-01'}]);state=(await req('/state?term=2026-2027-1')).body;assert.equal(state.rows.find(r=>r.sid==='001').fail,1);assert.equal(state.rows.find(r=>r.sid==='001').originalFail,2);assert.equal(state.rows.find(r=>r.sid==='001').average,46);assert.equal(state.cases[0].status,'待解除复核');
  assert.equal((await req('/reversals',{batchId:initial.batchId,version:state.version,reason:'测试依赖'})).status,409);
  let exp=await req('/exports',{version:state.version,term:'2026-2027-1',kind:'fail'});assert.equal(exp.status,201);let download=await page.request.get(origin+exp.body.url);assert.equal(download.status(),200);const workbook=XLSX.read(await download.body(),{type:'buffer'});assert.deepEqual(workbook.SheetNames,['学生汇总','课程明细','考试历史','导出口径']);assert.equal(workbook.Sheets['学生汇总'].A2.v,'001');assert.equal(workbook.Sheets['学生汇总'].A2.t,'s');
  assert.equal((await req('/reversals',{batchId:mk.batchId,version:state.version,reason:'测试撤销'})).status,200);
  await commit('exam',[{'学号':'001','考试类型':'英语四级','考试批次':'2026-12','考试日期':'2026-12-12','成绩':'450'},{'学号':'001','考试类型':'计算机等级','考试批次':'2026-09','等级':'二级','科目':'Python','官方结果':'合格'}]);
  state=(await req('/state?term=2026-2027-1')).body;assert.equal(state.exams[0].pass,true);assert.equal(state.exams[1].pass,true);
  await page.evaluate(()=>goto('academicPublic'));await page.waitForSelector('#ap-content table');assert.match(await page.locator('#ap-body').innerText(),/规则口径未通过学生/);
  await page.locator('[data-ap="import"][data-arg="retake"]').click();const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{'学号':'001','姓名':'甲','原修读学期':'2026-2027-1','课程代码':'B','课程名称':'英语','重修学期':'2027-2028-1','考试批次':'重修1','考试日期':'2027-12-01','重修成绩':'65','考试状态':'已出分','成绩制':'百分制'}]),'数据');
  await page.locator('#ap-file').setInputFiles({name:'重修.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))});await page.locator('[data-ap="read-file"]').click();await page.waitForSelector('#ap-sheet');await page.locator('[data-ap="preview"]').click();await page.waitForSelector('[data-ap="commit"]');await page.locator('[data-ap="commit"]').click();await page.waitForFunction(()=>document.querySelector('#modalTitle')?.textContent==='导入结果');
  state=(await req('/state?term=2026-2027-1')).body;assert.equal(state.rows.find(r=>r.sid==='001').details[1].tags.includes('重修'),true);assert.equal(state.rows.find(r=>r.sid==='001').fail,1);
  await page.evaluate(()=>closeModal());await page.waitForTimeout(350);await page.screenshot({path:path.join(os.tmpdir(),'shuzhi-academic-public-preview.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>goto('academicPublic'));await page.waitForSelector('#ap-content');assert.ok(await page.locator('.ap-grid').isVisible());
  // Preview source changes, partial commit and encrypted persistence boundaries.
  const stale=await req('/previews',{type:'original',rows:[rows[0]]});
  await page.request.put(origin+'/api/store/nnuzc_term_list',{headers:{Origin:origin},data:{value:JSON.stringify(['2026-2027-1学期','2027-2028-1学期','2028-2029-1学期'])}});
  assert.equal((await req('/commits',{previewId:stale.body.previewId,acceptValid:true},'POST',{'Idempotency-Key':crypto.randomUUID()})).status,409);
  const partial=await req('/previews',{type:'original',rows:[rows[0],{...rows[0],'学号':'不存在','姓名':'不存在的学生'}]});assert.equal(partial.body.counts.errors,1);
  assert.equal((await req('/commits',{previewId:partial.body.previewId},'POST',{'Idempotency-Key':crypto.randomUUID()})).status,422);
  assert.equal((await req('/commits',{previewId:partial.body.previewId,acceptValid:true},'POST',{'Idempotency-Key':crypto.randomUUID()})).status,200);
  state=(await req('/state?term=2026-2027-1')).body;
  assert.equal((await req('/case-actions',{version:state.version,id:c.id,action:'release',reason:'补考重修后已低于阈值'})).status,200);
  state=(await req('/state?term=2026-2027-1')).body;
  assert.equal((await req('/case-actions',{version:state.version,id:c.id,action:'follow',reason:'禁止复活已结束个案'})).status,422);
  assert.equal((await req('/publications',{version:state.version,term:'2026-2027-1',cls:'测试班',confirmed:true})).status,200);
  state=(await req('/state?term=2026-2027-1')).body;const publication=state.publications[0];
  const revised=await commit('original',[{...rows[0],'总评成绩':'55'}]);state=(await req('/state?term=2026-2027-1')).body;
  assert.equal(state.rows.find(r=>r.sid==='001').details[0].attempts[0].revisions[0].score,'50');
  exp=await req('/exports',{version:state.version,term:'2026-2027-1',publicationId:publication.id,kind:'grades'});
  assert.equal(exp.body.version,publication.version);download=await page.request.get(origin+exp.body.url);assert.equal(XLSX.utils.sheet_to_json(XLSX.read(await download.body(),{type:'buffer'}).Sheets['学生汇总']).find(r=>r['学号']==='001')['加权平均分'],46);
  assert.equal((await req('/reversals',{batchId:revised.batchId,version:state.version,reason:'验证恢复修订'})).status,200);
  const archive=await page.evaluate(async()=>{const node=document.createElement('div');node.innerHTML=academicPublicArchiveHTML({id:'001'});await academicPublicLoadArchive(node);return node.textContent;});assert.match(archive,/未通过 1 门/);
  const backupResponse=await page.request.post(origin+'/api/backups',{headers:{Origin:origin},data:{note:'公用版隔离备份恢复验证'}});assert.equal(backupResponse.status(),201);const backup=await backupResponse.json();
  const preflight=await (await page.request.get(origin+'/api/backups/'+backup.id+'/preflight')).json();
  await commit('exam',[{'学号':'002','考试类型':'英语六级','考试批次':'2026-12','成绩':'500'}]);assert.equal((await req('/state?term=2026-2027-1')).body.exams.length,3);
  const restored=await page.request.post(origin+'/api/backups/'+backup.id+'/restore',{headers:{Origin:origin},data:{confirmId:backup.id,sha256:preflight.sha256,mode:'replace'}});assert.equal(restored.status(),200,await restored.text());
  await page.goto(origin+'/?goto=academicPublic',{waitUntil:'networkidle'});assert.equal((await req('/state?term=2026-2027-1')).body.exams.length,2);
  await restart();await page.goto(origin+'/?goto=academicPublic',{waitUntil:'networkidle'});state=(await req('/state?term=2026-2027-1')).body;assert.equal(state.exams.length,2);assert.equal(state.rows.find(r=>r.sid==='001').fail,1);assert.deepEqual(errors,[]);
  console.log('academic-public browser/API: passed (four imports, stale preview, partial commit, duplicate/conflict, warning lifecycle, task dedupe, archive, ranking snapshot, revisions/reversal, Excel export, native backup/restore, restart, mobile)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
