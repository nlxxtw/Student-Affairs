"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),os=require("node:os"),fs=require("node:fs");
const {withIsolatedWorkbench}=require("./isolated-workbench-helper.cjs");
const {verifyTasks,verifyStudentPicker}=require("./productivity-browser-checks.cjs");
const modules=process.env.CODEX_NODE_MODULES||path.join(os.homedir(),".cache","codex-runtimes","codex-primary-runtime","dependencies","node","node_modules");
const {chromium}=require(path.join(modules,"playwright"));
withIsolatedWorkbench(async (origin,lifecycle)=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
    await page.goto(origin+"/",{waitUntil:"networkidle"});
    await verifyTasks(page);await verifyStudentPicker(page);
    await page.evaluate(()=>goto("tasks"));
    const shots=path.join(os.tmpdir(),"shuzhi-productivity-preview");fs.mkdirSync(shots,{recursive:true});
    for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(300);await page.screenshot({path:path.join(shots,"tasks-"+width+".png"),fullPage:true});}
    assert.deepEqual(errors,[],"new productivity flows must have no page/console errors");
    console.log("qa-productivity-browser: passed; previews: "+shots);
  }finally{await browser.close();}
  let cookie="";
  async function enter(){const r=await fetch(origin+"/api/auth/enter",{method:"POST",headers:{Origin:origin}});cookie=r.headers.get("set-cookie").split(";")[0];assert.equal(r.status,200);}
  async function call(url,method="GET",body){const r=await fetch(origin+url,{method,headers:{Cookie:cookie,Origin:origin,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,url+" returned "+r.status);return r.json();}
  await enter();
  let store=await call("/api/store");const notes=JSON.parse(store.nnuzc_task_notes);assert.equal(notes.length,1);
  const backup=await call("/api/backups","POST",{note:"隔离便签恢复验证"}),preflight=await call("/api/backups/"+backup.id+"/preflight");
  await call("/api/store/clear-local-business-data","POST",{confirmation:"清空本地全部数据"});
  store=await call("/api/store");assert.equal(store.nnuzc_task_notes,undefined,"business clear must clear notes");
  await call("/api/backups/"+backup.id+"/restore","POST",{confirmId:backup.id,sha256:preflight.sha256,mode:"replace"});
  assert.deepEqual(JSON.parse((await call("/api/store")).nnuzc_task_notes),notes,"backup restore must recover notes");
  await lifecycle.restart();await enter();
  assert.deepEqual(JSON.parse((await call("/api/store")).nnuzc_task_notes),notes,"notes must survive service restart");
  console.log("productivity lifecycle: shared note roles, backup/clear/restore/restart passed");
}).catch(e=>{console.error(e);process.exitCode=1;});
