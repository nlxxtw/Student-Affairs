"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{DatabaseSync}=require("node:sqlite"),{createService}=require("../academic-public-service");

test("公用版学业数据随系统更新检查孤立学生并按用户选择删除",async t=>{
  const db=new DatabaseSync(":memory:");t.after(()=>db.close());
  const store={nnuzc_students:JSON.stringify([{id:"001",name:"现有学生",dept:"学院",major:"专业",grade:"2026级",cls:"1班",status:"休学"},{id:"002",name:"另一学生",dept:"学院",major:"专业",grade:"2026级",cls:"1班",status:"在校"}]),nnuzc_term_list:JSON.stringify(["2026-2027-1"])};
  const deps={encrypt:value=>Buffer.from(value).toString("base64"),decrypt:value=>Buffer.from(value,"base64").toString(),store:()=>store,accounts:()=>[],assert:()=>{},read:async request=>request.body,task:()=>{},json:(_response,status,body)=>({status,body}),download:()=>{}};
  const service=createService(()=>db,deps),admin={uid:"host",role:"sa"},viewer={uid:"reader",role:"viewer"};
  const req=(route,body,actor=admin,method=body===undefined?"GET":"POST")=>service.handle({method,body,headers:{"idempotency-key":crypto.randomUUID()}},{},new URL("http://local/api/academic-public"+route),actor);
  let preview=await req("/previews",{type:"original",rows:[{学号:"001",姓名:"现有学生",原修读学期:"2026-2027-1",课程代码:"C1",课程名称:"课程",学分:"2",总评成绩:"40",考试批次:"期末"}]});
  assert.equal(preview.body.counts.errors,0);assert.equal((await req("/commits",{previewId:preview.body.previewId})).status,200);
  preview=await req("/previews",{type:"original",rows:[{学号:"误填学号",姓名:"现有学生",原修读学期:"2026-2027-1",课程代码:"C2",课程名称:"课程二",学分:"2",总评成绩:"80",考试批次:"期末"}]});
  assert.equal(preview.body.counts.errors,0);assert.deepEqual(preview.body.studentCorrections.map(item=>[item.field,item.before,item.after]),[["学号","误填学号","001"]]);assert.equal((await req("/commits",{previewId:preview.body.previewId})).body.error.code,"STUDENT_CORRECTION_CONFIRMATION_REQUIRED");assert.equal((await req("/commits",{previewId:preview.body.previewId,acceptStudentCorrections:true})).status,200);
  const conflict=await req("/previews",{type:"original",rows:[{学号:"001",姓名:"另一学生",原修读学期:"2026-2027-1",课程代码:"C3",课程名称:"课程三",学分:"2",总评成绩:"70",考试批次:"期末"}]});
  assert.equal(conflict.body.counts.errors,0);assert.equal(conflict.body.counts.valid,1);assert.ok(conflict.body.studentCorrections.some(item=>item.field==="姓名"&&item.before==="另一学生"&&item.after==="现有学生"));assert.equal((await req("/commits",{previewId:conflict.body.previewId})).body.error.code,"STUDENT_CORRECTION_CONFIRMATION_REQUIRED");assert.equal((await req("/commits",{previewId:conflict.body.previewId,acceptStudentCorrections:true})).status,200);
  store.nnuzc_students="[]";
  const scan=await req("/integrity");assert.equal(scan.status,200);assert.ok(scan.body.total>=2,JSON.stringify(scan.body));assert.ok(scan.body.datasets.some(row=>row.samples.includes("001")));
  assert.equal((await req("/integrity",undefined,viewer)).status,403);
  const stale=await req("/integrity",{action:"delete",version:scan.body.version+1});assert.equal(stale.status,409);
  const removed=await req("/integrity",{action:"delete",version:scan.body.version});assert.equal(removed.status,200);assert.equal(removed.body.removed,scan.body.total);
  const after=await req("/integrity");assert.equal(after.body.total,0);assert.equal((await req("/state?term=2026-2027-1")).body.rows.length,0);
});
