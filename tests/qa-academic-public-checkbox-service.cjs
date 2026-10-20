'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{createService}=require('../academic-public-service');
const XLSX=require('../assets/xlsx.full.min.js');
test('checkbox filters use OR within groups, AND across groups, and natural student ordering in exports and runs',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const people=[
  {id:'0010',name:'十',dept:'乙学院',grade:'2024',major:'专业',cls:'10班',status:'在校'},
  {id:'0004',name:'毕业',dept:'甲学院',grade:'2023',major:'专业',cls:'2班',status:'毕业'},
  {id:'0003',name:'三',dept:'乙学院',grade:'2024',major:'专业',cls:'2班',status:'在校生'},
  {id:'0002',name:'二',dept:'乙学院',grade:'2024',major:'专业',cls:'2班'},
  {id:'0001',name:'一',dept:'乙学院',grade:'2023',major:'专业',cls:'10班',status:'在校'}
 ];
 const terms=['2024-2025-1','2024-2025-2'],store={nnuzc_students:JSON.stringify(people),nnuzc_term_list:JSON.stringify(terms)};
 const service=createService(()=>db,{encrypt:v=>Buffer.from(v).toString('base64'),decrypt:v=>Buffer.from(v,'base64').toString(),store:()=>store,accounts:()=>[{id:'viewer'}],assert:()=>{},read:async r=>r.body,json:(r,status,body)=>({status,body}),download:(r,bytes,name)=>({status:200,bytes,name})});
 const host={uid:'host',role:'sa'},viewer={uid:'viewer',role:'viewer'};
 const req=(route,body,actor=host,method=body===undefined?'GET':'POST')=>service.handle({method,headers:{'idempotency-key':crypto.randomUUID()},body},{},new URL('http://local/api/academic-public'+route),actor);
 const state=async()=> (await req('/state?term='+terms[0])).body;
 assert.deepEqual((await state()).rows.map(r=>r.sid),['0004','0001','0002','0003','0010']);
 const p=await req('/rule-preview',{version:0,rules:{thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60}});assert.equal((await req('/rules',{previewId:p.body.previewId},host,'PUT')).status,200);
 const preview=await req('/previews',{type:'original',rows:people.flatMap(s=>terms.map((term,i)=>({'学号':s.id,'原修读学期':term,'课程代码':'C'+i,'课程名称':'课程'+i,'学分':'2','总评成绩':'40','考试批次':'期末'})))});assert.equal(preview.body.counts.errors,0);assert.equal((await req('/commits',{previewId:preview.body.previewId})).status,200);
 const filter={term:terms[1],scope:'multi',terms,status:['在校'],dept:['乙学院'],grade:['2023','2024'],cls:['2班','10班']};
 const exported=await req('/exports',{version:(await state()).version,...filter,kind:'grades'});assert.equal(exported.status,201,JSON.stringify(exported.body));assert.equal(exported.body.count,4);
 const file=await req('/download?fileId='+exported.body.fileId),wb=XLSX.read(file.bytes,{type:'buffer'});
 assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets['学生汇总']).map(r=>r['学号']),['0001','0002','0003','0010']);
 const run=await req('/warning-runs',{version:(await state()).version,...filter});assert.equal(run.status,201);assert.equal(run.body.counts.warnings,4);
 const saved=(await req('/warning-runs?id='+run.body.id)).body.run;assert.deepEqual(saved.rows.map(r=>r.sid),['0001','0002','0003','0010']);assert.deepEqual(saved.filters.status,['在校']);
 const single=await req('/exports',{version:(await state()).version,term:terms[0],status:'毕业',kind:'grades'});assert.equal(single.body.count,1,'legacy scalar filters remain supported');
 const all=await req('/exports',{version:(await state()).version,term:terms[0],status:[],kind:'grades'});assert.equal(all.body.count,5,'empty group means all');
 const invalid=await req('/exports',{version:(await state()).version,term:terms[0],grade:{bad:true},kind:'grades'});assert.equal(invalid.status,422);
 const narrow=await req('/exports',{version:(await state()).version,...filter,grade:['2024'],cls:['2班'],kind:'grades'});assert.equal(narrow.body.count,2,'different groups intersect');
 const examPreview=await req('/previews',{type:'exam',rows:people.map(s=>({'学号':s.id,'考试类型':'英语四级','考试批次':'2025-12','成绩':'450'}))});assert.equal(examPreview.body.counts.errors,0);assert.equal((await req('/commits',{previewId:examPreview.body.previewId})).status,200);
 const exams=await req('/exports',{version:(await state()).version,...filter,kind:'exam'}),examFile=await req('/download?fileId='+exams.body.fileId);assert.deepEqual(XLSX.utils.sheet_to_json(XLSX.read(examFile.bytes,{type:'buffer'}).Sheets['等级考试']).map(r=>r['学号']),['0001','0002','0003','0010']);
 assert.equal((await req('/access',{version:(await state()).version,uid:'viewer',classes:['2班'],view:true,export:true},host,'PUT')).status,200);
 const limited=await req('/exports',{version:(await state()).version,...filter,kind:'grades'},viewer);assert.equal(limited.body.count,2,'multi-select cannot expand account authorization');
 console.log('academic-public checkbox service: passed');
});
