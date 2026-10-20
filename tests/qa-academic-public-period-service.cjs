'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{createService}=require('../academic-public-service');
const XLSX=require('../assets/xlsx.full.min.js');
test('range queries, encrypted persistent runs, case isolation, ACL and exports',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const terms=['2024-2025-1','2024-2025-2','2025-2026-1'];
 const store={nnuzc_students:JSON.stringify([{id:'a',name:'甲',cls:'甲班'},{id:'b',name:'乙',cls:'乙班'}]),nnuzc_term_list:JSON.stringify(terms)};
 const admin={uid:'host',role:'sa'},editor={uid:'editor',role:'editor'},viewer={uid:'viewer',role:'viewer'};
 const deps={encrypt:v=>Buffer.from(v).toString('base64'),decrypt:v=>Buffer.from(v,'base64').toString(),store:()=>store,accounts:()=>[{id:'editor',role:'editor'},{id:'viewer',role:'viewer'}],assert:()=>{},read:async r=>r.body,task:()=>{},json:(r,status,body)=>({status,body}),download:(r,bytes,name)=>({status:200,bytes,name})};
 let service=createService(()=>db,deps);
 const req=(route,body,actor=admin,method=body===undefined?'GET':'POST',headers={})=>service.handle({method,headers,body},{},new URL('http://local/api/academic-public'+route),actor);
 const state=async()=> (await req('/state?term='+terms[2])).body;
 const rules={thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60};
 const preview=await req('/rule-preview',{version:(await state()).version,rules});assert.equal((await req('/rules',{previewId:preview.body.previewId},admin,'PUT')).status,200);
 const rows=terms.flatMap((term,i)=>['a','b'].map(sid=>({'学号':sid,'原修读学期':term,'课程代码':'C'+i,'课程名称':'课'+i,'学分':'3','总评成绩':'40','考试批次':'期末'})));
 const p=await req('/previews',{type:'original',rows});assert.equal(p.body.counts.errors,0);assert.equal((await req('/commits',{previewId:p.body.previewId},admin,'POST',{'idempotency-key':crypto.randomUUID()})).status,200);
 const query='?term='+terms[2]+'&scope=multi&terms='+encodeURIComponent(JSON.stringify([terms[2],terms[0]]));
 const before=(await state()).version,multi=(await req('/state'+query)).body;assert.equal(multi.rows[0].fail,2);assert.equal((await state()).version,before,'view does not write');
 const context={term:terms[2],scope:'multi',terms:[terms[2],terms[0]],stage:'current'};
 const created=await req('/warning-runs',{version:before,...context});assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.counts.warnings,2);
 service=createService(()=>db,deps);const history=(await req('/warning-runs?id='+created.body.id)).body.run;
 assert.deepEqual(history.selection.terms,[terms[0],terms[2]]);assert.equal(history.rows[0].fail,2);
 assert(!db.prepare('SELECT payload FROM academic_public_warning_runs').get().payload.includes('甲'),'payload encrypted');
 const custom=(await state()).cases.filter(c=>c.selection?.scope==='multi');assert.equal(custom.length,2);const first=custom.find(c=>c.sid==='a');
 assert.equal((await req('/case-actions',{version:(await state()).version,id:first.id,action:'confirm',reason:'跨学期核对'})).status,200);
 assert.equal((await req('/warning-runs',{version:(await state()).version,...context})).status,201);assert.equal((await state()).cases.filter(c=>c.selection?.scope==='multi').length,2,'regeneration reuses active cases');
 const ex=await req('/exports',{version:(await state()).version,...context,kind:'warning'});assert.equal(ex.status,201);const file=await req('/download?fileId='+ex.body.fileId);const workbook=XLSX.read(file.bytes,{type:'buffer'});
 assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['学生汇总'])[0]['规则口径未通过门数'],2,'export respects selected terms');
 for(const actor of [editor,viewer]){
  const grant={version:(await state()).version,uid:actor.uid,classes:['甲班'],view:true,review:actor===editor,import:false,export:true};assert.equal((await req('/access',grant,admin,'PUT')).status,200);
 }
 assert.equal((await req('/warning-runs?id='+created.body.id,undefined,editor)).status,403);
 assert.equal((await req('/state'+query,undefined,editor)).body.rows.length,1);
 assert.equal((await req('/warning-runs',{version:(await state()).version,...context},viewer)).status,403);
 assert.equal((await req('/warning-runs',{version:0,...context})).status,409);
 assert.equal((await req('/state?scope=multi&terms=%5B%22bad%22%5D')).status,422);
 console.log('academic-public period service: passed');
});
