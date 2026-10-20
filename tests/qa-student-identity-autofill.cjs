"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {DatabaseSync}=require("node:sqlite");
const {withIsolatedWorkbench}=require("./isolated-workbench-helper.cjs");
withIsolatedWorkbench(async(origin,control)=>{
 let cookie="";
 async function api(url,body,method=body===undefined?"GET":"POST"){
  const response=await fetch(origin+url,{method,headers:{Origin:origin,Connection:"close",Cookie:cookie,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.headers.get("set-cookie"))cookie=response.headers.get("set-cookie").split(";")[0];
  const value=await response.json();assert(response.ok,JSON.stringify(value));return value;
 }
 await api("/api/auth/enter",{});
 await api("/api/store/nnuzc_orgs",{value:JSON.stringify({depts:[{name:"测试学院"}],majors:[{name:"测试专业",dept:"测试学院"}],classes:[],grades:[],dorms:[]})},"PUT");
 const student=(id,extra)=>({id,name:"合成测试学生",dept:"测试学院",major:"测试专业",...extra});
 const input=[student("s1",{idcard:"320101200601011235",birth:"",gender:""}),student("s2",{idcard:"320101200601011235",birth:"20000101",gender:"女"}),student("s3",{idcard:"320101200601011234",birth:"",gender:""}),student("s4",{idcard:"81000020060101123x",birth:" ",gender:""}),student("s5",{idCard:"320101900101123",birth:null,gender:null}),student("s6",{idcard:"320101200601011235",birth:"20000101",gender:" "}),student("s7",{idcard:"A123456(3)",birth:"",gender:""})];
 await api("/api/store/nnuzc_students",{value:JSON.stringify(input)},"PUT");
 let rows=JSON.parse((await api("/api/store")).nnuzc_students),byId=id=>rows.find(row=>row.id===id);
 assert.equal(byId("s1").birth,"20060101","saving an empty existing identity must autofill birth");assert.equal(byId("s1").gender,"男");
 assert.equal(byId("s2").birth,"20000101");assert.equal(byId("s2").gender,"女");
 assert.equal(byId("s3").birth,"");assert.equal(byId("s3").gender,"");
 assert.equal(byId("s4").birth,"20060101");assert.equal(byId("s4").gender,"");
 assert.equal(byId("s5").birth,"19900101");assert.equal(byId("s5").gender,"男");
 assert.equal(byId("s6").birth,"20000101");assert.equal(byId("s6").gender,"男");
 assert.equal(byId("s7").birth,"");assert.equal(byId("s7").gender,"");
 let encryptedSnapshot;
 await control.restart(async temp=>{
  const db=new DatabaseSync(path.join(temp,"data","workbench.db"));
  const missing=student("s1",{idcard:"320101200601011235",birth:" ",gender:"",phone:"13800000000",classroom:[{id:"retained-attendance"}]});
  // Only this temporary fixture is changed while its server is stopped.
  db.prepare("UPDATE students SET data_json=? WHERE rowid=(SELECT MIN(rowid) FROM students)").run(JSON.stringify(missing));db.close();
 });
 cookie="";await api("/api/auth/enter",{});rows=JSON.parse((await api("/api/store")).nnuzc_students);
 assert.equal(byId("s1").birth,"20060101","startup must persist missing fields without opening an edit form");assert.equal(byId("s1").gender,"男");assert.equal(byId("s1").phone,"13800000000");
 await control.restart(async temp=>{
  const db=new DatabaseSync(path.join(temp,"data","workbench.db"));encryptedSnapshot=db.prepare("SELECT data_json FROM students ORDER BY rowid").all().map(row=>row.data_json);assert(encryptedSnapshot.every(value=>value.startsWith("xcenc:v1:")));assert(!encryptedSnapshot.some(value=>value.includes("320101200601011235")));db.close();
 });
 cookie="";await api("/api/auth/enter",{});rows=JSON.parse((await api("/api/store")).nnuzc_students);assert.equal(byId("s1").birth,"20060101");
 await control.restart(async temp=>{
  const db=new DatabaseSync(path.join(temp,"data","workbench.db"));assert.deepEqual(db.prepare("SELECT data_json FROM students ORDER BY rowid").all().map(row=>row.data_json),encryptedSnapshot,"repeat startup must not rewrite complete students");db.close();
 });
 cookie="";await api("/api/auth/enter",{});const backup=await api("/api/backups",{note:"合成身份补全恢复测试"});
 await control.restart(async temp=>{
  const file=path.join(temp,backup.relative_path),oldDb=new DatabaseSync(file);
  oldDb.prepare("UPDATE students SET data_json=? WHERE rowid=(SELECT MIN(rowid) FROM students)").run(JSON.stringify(student("s1",{idcard:"320101200601011235",birth:"",gender:"",phone:"13800000000"})));oldDb.close();
  const db=new DatabaseSync(path.join(temp,"data","workbench.db"));db.prepare("UPDATE web_backup_records SET sha256=? WHERE id=?").run(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),backup.id);db.close();
 });
 cookie="";await api("/api/auth/enter",{});const preflight=await api("/api/backups/"+backup.id+"/preflight");
 await api("/api/backups/"+backup.id+"/restore",{confirmId:backup.id,sha256:preflight.sha256,mode:"replace"});
 rows=JSON.parse((await api("/api/store")).nnuzc_students);assert.equal(byId("s1").birth,"20060101");assert.equal(byId("s1").gender,"男");assert.equal(byId("s1").phone,"13800000000");
 assert.equal((await api("/api/backups")).length,1,"automatic identity filling/restore must not add another backup");
 console.log("qa-student-identity-autofill: passed (startup/write persistence, blank/null/space, preserved values, legacy alias, invalid/residence/local IDs, encryption and idempotency)");
}).catch(error=>{console.error(error);process.exitCode=1;});
