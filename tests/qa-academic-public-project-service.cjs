'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createService}=require('../academic-public-service'),XLSX=require('../assets/xlsx.full.min.js');
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store={nnuzc_students:JSON.stringify([{id:'001',name:'合成学生',cls:'甲班',status:'在校'}]),nnuzc_term_list:JSON.stringify(['2026-2027-1学期'])};const svc=createService(()=>db,{encrypt:x=>x,decrypt:x=>x,store:()=>store,assert:()=>{},buffer:async r=>r.body,read:async r=>r.body,json:(r,status,body)=>({status,body}),download:(r,bytes,name)=>({status:200,bytes,name})});svc.init();const req=(route,body)=>svc.handle({method:body?'POST':'GET',headers:{'idempotency-key':crypto.randomUUID()},body},{},new URL('http://localhost/api/academic-public'+route),{uid:'host',role:'sa'});return {req,db,state:async()=>(await req('/state?term=2026-2027-1')).body,commit:async(type,rows)=>{const p=await req('/previews',{type,rows});assert.equal(p.body.counts.errors,0,JSON.stringify(p.body));const c=await req('/commits',{previewId:p.body.previewId});assert.equal(c.status,200,JSON.stringify(c.body));return c.body;}};}
test('project exams import, revision, exact export and undo preserve province and certificate materials',async t=>{
 const f=fixture(t),row={'学号':'001','考试类型':'省级计算机等级','考试批次':'2026春','等级':'二级','科目':'Python','官方结果':'合格','考试省份':'浙江','准考证号':'000123'};
 await f.commit('exam',[row,{...row,'考试省份':'江苏'}]);let s=await f.state();assert.equal(s.exams.length,2);assert.equal(s.exams[0].pass,true);
 const rev=await f.commit('exam',[{...row,'证书编号':'CERT1'}]);s=await f.state();const x=s.exams.find(x=>x.province==='浙江');assert.equal(x.admission,'000123');assert.equal(x.revisions[0].province,'浙江');
 const same=await f.req('/previews',{type:'exam',rows:[{...row,'证书编号':'CERT1'}]});assert.equal(same.body.counts.duplicates,1);
 const ex=await f.req('/exports',{version:s.version,kind:'exam',examType:['省级计算机等级'],examProvince:['浙江']});assert.equal(ex.status,201,JSON.stringify(ex.body));const file=await f.req(ex.body.url.replace('/api/academic-public','')),wb=XLSX.read(file.bytes,{type:'buffer'}),records=XLSX.utils.sheet_to_json(wb.Sheets['等级考试']);assert.equal(records.length,1);assert.equal(records[0]['准考证号'],'000123');assert.equal(records[0]['考试省份'],'浙江');assert.ok(wb.Sheets['考证项目统计']);
 assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['考证修订记录'])[0]['原考试省份'],'浙江');
 assert.equal((await f.req('/reversals',{version:s.version,batchId:rev.batchId,reason:'合成撤销测试'})).status,200);s=await f.state();assert.equal(s.exams.find(x=>x.province==='浙江').certificate,'');
 const invalid=await f.req('/exports',{version:s.version,kind:'exam',examType:{invalid:true}});assert.equal(invalid.status,422);
});
test('grade components and teaching metadata survive revision, export and zero grades',async t=>{
 const f=fixture(t),row={'学号':'001','原修读学期':'2026-2027-1','课程代码':'A','课程名称':'合成课程','学分':'2','总评成绩':'60','考试批次':'期末','平时成绩':'0','期末成绩':'100','教学班号':'0001','授课教师':'合成教师','开课单位':'合成学院'};
 await f.commit('original',[row]);let s=await f.state(),c=s.rows[0].details[0];assert.equal(c.attempts[0].regularScore,0);assert.equal(c.attempts[0].score,'60');assert.equal(c.teachingClass,'0001');
 await f.commit('original',[{...row,'平时成绩':'10'}]);s=await f.state();assert.equal(s.rows[0].details[0].attempts[0].revisions[0].regularScore,0);
 const ex=await f.req('/exports',{version:s.version,kind:'grades',term:'2026-2027-1'}),file=await f.req(ex.body.url.replace('/api/academic-public','')),wb=XLSX.read(file.bytes,{type:'buffer'});assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['考试历史'])[0]['平时成绩'],10);
 const invalid=await f.req('/previews',{type:'original',rows:[{...row,'平时成绩':'101'}]});assert.equal(invalid.body.counts.errors,1);
});
test('single revision requires reason and keeps identity; exam analysis matches filters',async t=>{
 const f=fixture(t),row={'学号':'001','考试类型':'全国计算机等级','考试批次':'2026春','等级':'二级','科目':'Python','官方结果':'不合格'};await f.commit('exam',[row]);let s=await f.state(),id=s.exams[0].id;
 const p=await f.req('/previews',{type:'exam',mode:'merge',editId:id,rows:[{...row,'官方结果':'合格'}]});assert.equal(p.status,422);
 const bad=await f.req('/previews',{type:'exam',mode:'merge',editId:id,editReason:'合成核对',rows:[{...row,'考试批次':'另一批次'}]});assert.equal(bad.body.counts.errors,1);
 const ok=await f.req('/previews',{type:'exam',mode:'merge',editId:id,editReason:'合成核对',rows:[{...row,'官方结果':'合格'}]});assert.equal(ok.body.counts.revised,1);assert.equal((await f.req('/commits',{previewId:ok.body.previewId})).status,200);
 s=await f.state();assert.equal(s.exams[0].id,id);const a=await f.req('/exam-analysis',{version:s.version,examType:['全国计算机等级'],examResult:['已达标']});assert.equal(a.body.records.length,1);assert.equal(a.body.statistics[0].passed,1);
 assert.equal((await f.req('/exam-analysis',{version:s.version,examType:['英语四级']})).body.records.length,0);
});
test('CET partial revisions cannot contradict retained subscores',async t=>{
 const f=fixture(t),row={'学号':'001','考试类型':'英语四级','考试批次':'2026春','成绩':'450','听力成绩':'150','阅读成绩':'150','写作翻译成绩':'150'};await f.commit('exam',[row]);
 const bad=await f.req('/previews',{type:'exam',rows:[{'学号':'001','考试类型':'英语四级','考试批次':'2026春','成绩':'460'}]});assert.equal(bad.body.counts.errors,1);assert.match(bad.body.errors[0].message,/之和/);
 const ok=await f.req('/previews',{type:'exam',rows:[{'学号':'001','考试类型':'英语四级','考试批次':'2026春','成绩':'450'}]});assert.equal(ok.body.counts.duplicates,1);assert.equal((await f.state()).exams[0].listening,150);
});
test('single course revision cannot rename its identity',async t=>{
 const f=fixture(t),row={'学号':'001','原修读学期':'2026-2027-1','课程代码':'A','课程名称':'合成课程','学分':'2','总评成绩':'60','考试批次':'期末'};await f.commit('original',[row]);const s=await f.state(),id=s.rows[0].details[0].attempts[0].id;
 const p=await f.req('/previews',{type:'original',mode:'merge',editId:id,editReason:'合成身份校验',rows:[{...row,'课程名称':'另一课程'}]});assert.equal(p.body.counts.errors,1);
});
test('expanded template examples and Excel mappings contain valid component and identifier values',async t=>{
 const f=fixture(t),Files=require('../academic-public-files');
 for(const type of ['original','exam']){const template=await f.req('/templates?type='+type),wb=XLSX.read(template.bytes,{type:'buffer'}),rows=XLSX.utils.sheet_to_json(wb.Sheets['数据'],{header:1,defval:''});
  assert.equal(rows.length,2);const headers=rows[0],row=rows[1];row[headers.indexOf('学号')]='001';row[headers.indexOf('姓名')]='合成学生';
  const file=await f.req('/files?name=合成模板.xlsx',Files.workbook({'数据':[headers,row]}));assert.equal(file.status,201);const recommendation=file.body.sheets[0].recommendations[type];
  const p=await f.req('/previews',{type,fileId:file.body.fileId,sheet:'数据',headerRow:recommendation.headerRow,mapping:recommendation.mapping});assert.equal(p.body.counts.errors,0,JSON.stringify(p.body.errors));
 }
});
test('CET optional labels never duplicate identities; ambiguous legacy records are not overwritten',async t=>{
 const f=fixture(t),row={'学号':'001','考试类型':'英语四级','考试批次':'2026春','成绩':'450'};await f.commit('exam',[row]);const before=await f.state();
 const p=await f.req('/previews',{type:'exam',rows:[{...row,'等级':'四级','科目':'英语'}]});assert.equal(p.body.counts.created,0);assert.equal(p.body.counts.revised,1);await f.req('/commits',{previewId:p.body.previewId});let s=await f.state();assert.equal(s.exams.length,1);assert.equal(s.exams[0].id,before.exams[0].id);
 const stored=f.db.prepare('SELECT payload FROM academic_public_state WHERE id=1').get(),state=JSON.parse(stored.payload);state.exams.push({...state.exams[0],id:'合成旧重复记录',key:'合成历史旧键',grade:'',subject:''});f.db.prepare('UPDATE academic_public_state SET payload=? WHERE id=1').run(JSON.stringify(state));
 const blocked=await f.req('/previews',{type:'exam',rows:[row]});assert.equal(blocked.body.counts.errors,1);assert.equal(blocked.body.errors[0].code,'EXAM_IDENTITY_AMBIGUOUS');assert.equal((await f.state()).exams.length,2);
});
test('unmapped certificate and exam date survive score correction, explicit blanks clear them',async t=>{
 const f=fixture(t),row={'学号':'001','考试类型':'英语四级','考试批次':'春','成绩':'450','考试日期':'2026-06-13','证书编号':'CERT1','等级':'四级','科目':'英语','举办单位':'合成考试机构'};await f.commit('exam',[row]);
 const revised=await f.commit('exam',[{'学号':'001','考试类型':'英语四级','考试批次':'春','成绩':'460'}]);let s=await f.state(),exam=s.exams[0];assert.equal(exam.certificate,'CERT1');assert.equal(exam.date,'2026-06-13');assert.equal(exam.grade,'四级');assert.equal(exam.organizer,'合成考试机构');
 assert.equal((await f.req('/reversals',{version:s.version,batchId:revised.batchId,reason:'合成撤销'})).status,200);s=await f.state();assert.equal(s.exams[0].score,450);
 await f.commit('exam',[{...row,'证书编号':'','考试日期':''}]);s=await f.state();assert.equal(s.exams[0].certificate,'');assert.equal(s.exams[0].date,'');
});
test('legacy duplicate results remain pending in state, statistics and exact-record export',async t=>{
 const f=fixture(t);await f.commit('exam',[{'学号':'001','考试类型':'全国计算机等级','考试批次':'春','等级':'二级','科目':'Python','官方结果':'合格'}]);let s=await f.state(),payload=JSON.parse(f.db.prepare('SELECT payload FROM academic_public_state WHERE id=1').get().payload);payload.exams.push({...payload.exams[0],id:'合成历史重复',key:'合成旧键',official:'不合格'});f.db.prepare('UPDATE academic_public_state SET payload=? WHERE id=1').run(JSON.stringify(payload));
 s=await f.state();assert.ok(s.exams.every(x=>x.pass===null&&x.identityConflict));const a=await f.req('/exam-analysis',{version:s.version});assert.equal(a.body.statistics[0].passed,0);
 const ex=await f.req('/exports',{version:s.version,kind:'exam',examIds:[s.exams[0].id]});const file=await f.req(ex.body.url.replace('/api/academic-public','')),wb=XLSX.read(file.bytes,{type:'buffer'});assert.match(XLSX.utils.sheet_to_json(wb.Sheets['等级考试'])[0]['达标情况'],/重复/);
 payload.rules={thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60};payload.courses=[{id:'合成课程',sid:'001',term:'2026-2027-1',code:'A',name:'合成课程',credit:2,category:'必修'}];payload.attempts=[{id:'合成成绩',courseId:'合成课程',type:'original',batch:'期末',score:'40',scale:'百分制',status:'已出分'}];f.db.prepare('UPDATE academic_public_state SET payload=? WHERE id=1').run(JSON.stringify(payload));s=await f.state();
 const warning=await f.req('/exports',{version:s.version,kind:'warning',term:'2026-2027-1'}),warningFile=await f.req(warning.body.url.replace('/api/academic-public',''));const warningRow=XLSX.utils.sheet_to_json(XLSX.read(warningFile.bytes,{type:'buffer'}).Sheets['学生预警明细'])[0];assert.equal(warningRow['计算机通过情况（通过/不通过）'],'待核查');assert.equal(warningRow['全国计算机等级达标情况'],'待核查');
});
test('structured field values are rejected instead of saved as text',async t=>{
 const f=fixture(t);const p=await f.req('/previews',{type:'exam',rows:[{'学号':'001','考试类型':'省级计算机等级','考试批次':'春','等级':'二级','科目':'Python','官方结果':'合格','考试省份':{name:'浙江'}}]});assert.equal(p.body.counts.errors,1);assert.equal((await f.state()).exams.length,0);
});
test('mixed history reimport cannot turn makeup into original and keeps pending statuses',async t=>{
 const f=fixture(t),term='2026-2027-1';await f.commit('original',[{'学号':'001','原修读学期':term,'课程代码':'A','课程名称':'合成课程','学分':'2','总评成绩':'0','考试状态':'缺考','考试批次':'期末'}]);await f.commit('makeup',[{'学号':'001','原修读学期':term,'课程代码':'A','补考成绩':'70','考试批次':'补考','绩点':'2'}]);
 let s=await f.state();const ex=await f.req('/exports',{version:s.version,kind:'grades',term}),download=await f.req(ex.body.url.replace('/api/academic-public','')),file=await f.req('/files?name=历史.xlsx',download.bytes);const sheet=file.body.sheets.find(x=>x.name==='考试历史'),guess=sheet.recommendations.original;
 const p=await f.req('/previews',{type:'original',fileId:file.body.fileId,sheet:sheet.name,headerRow:guess.headerRow,mapping:guess.mapping});assert.ok(p.body.counts,JSON.stringify(p));assert.equal(p.body.counts.errors,1);assert.equal(p.body.counts.created,0);assert.equal(p.body.counts.revised,0);assert.equal(p.body.counts.duplicates,1);assert.match(p.body.errors[0].message,/阶段/);
 s=await f.state();assert.equal(s.rows[0].details[0].attempts.length,2);assert.equal(s.rows[0].details[0].attempts.find(a=>a.type==='original').status,'缺考');
});
test('unchanged scores preserve unmapped GPA, changed scores do not reuse stale GPA',async t=>{
 const f=fixture(t),row={'学号':'001','原修读学期':'2026-2027-1','课程代码':'A','课程名称':'合成课程','学分':'2','总评成绩':'80','绩点':'3','考试批次':'期末'};await f.commit('original',[row]);const without={...row};delete without['绩点'];
 const p=await f.req('/previews',{type:'original',rows:[without]});assert.equal(p.body.counts.duplicates,1);await f.commit('original',[{...without,'总评成绩':'90'}]);assert.equal((await f.state()).rows[0].details[0].attempts[0].gpa,null);
});
test('export rejects mixed live-exam and published-ranking arguments',async t=>{
 const f=fixture(t),s=await f.state();assert.equal((await f.req('/exports',{version:s.version,kind:'exam',publicationId:'fake'})).status,422);assert.equal((await f.req('/exports',{version:s.version,kind:'grades',examIds:[]})).status,422);
});
