"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),os=require("node:os");
const {withIsolatedWorkbench}=require("./isolated-workbench-helper.cjs");
const {chromium}=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});let failures=0;
 try{
  for(const kind of ["late completion", "duplicate commit", "2000-row validation", "replacement file"]){
   const page=await browser.newPage();
   page.on("dialog",dialog=>dialog.accept());
   try{
    await page.goto(origin,{waitUntil:"networkidle"});
    await page.evaluate(async()=>{ORG_DEPTS.splice(0,ORG_DEPTS.length,{name:"合成学院"});ORG_MAJORS.splice(0,ORG_MAJORS.length,{name:"合成专业",dept:"合成学院"});ORG_CLASSES.splice(0,ORG_CLASSES.length,{name:"合成班",dept:"合成学院",major:"合成专业",grade:"2026"});saveOrgs();await workbench.legacy.flushStore();});
    await page.evaluate(kind=>{
     const count=kind==="2000-row validation"?2000:1;
     stuImportParse=async file=>Array.from({length:count},(_,i)=>({学号:file.name==='replacement.csv'?"REPLACED":"SYNTH"+i,姓名:"合成学生"+i,班级:"合成班",学籍状态:"在校"}));
     stuImport();
    },kind);
    await page.locator("#stuImportFile").setInputFiles({name:"synthetic.csv",mimeType:"text/csv",buffer:Buffer.from("学号,姓名,班级,学籍状态\nSYNTH0,合成学生0,合成班,在校")});
    await page.evaluate(async()=>{await stuImportNext();await stuImportNext();});
    if(kind==="replacement file"){
     await page.locator('#stuImportFile').setInputFiles({name:'replacement.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic')});
     await page.evaluate(()=>stuImportNext());
     assert.equal(await page.evaluate(()=>window.__studentImportState.rawRows[0]['学号']),'REPLACED','replacement upload continued using the previous file rows');
     console.log('PASS student import replacement file');continue;
    }
    await page.evaluate(()=>stuImportNext());
    await page.waitForFunction(()=>document.getElementById("stuImpGoBtn")&&!document.getElementById("stuImpGoBtn").disabled,null,{timeout:5000});
    if(kind!=="2000-row validation"){
     await page.evaluate(()=>{window.testWrites=0;window.testResolvers=[];writeImportedRows=()=>{testWrites++;return true;};workbench.legacy.flushStore=()=>new Promise(resolve=>testResolvers.push(resolve));window.testFirstCommit=stuImportNext();});
     await page.waitForFunction(()=>testResolvers.length===1,null,{timeout:5000});
     if(kind==="duplicate commit"){
      await page.evaluate(()=>{window.testSecondCommit=stuImportNext();});
      const writes=await page.evaluate(()=>testWrites);
      await page.evaluate(async()=>{testResolvers.forEach(resolve=>resolve());await Promise.all([testFirstCommit,testSecondCommit]);});
      assert.equal(writes,1,"double click submitted the student import twice");
     }else{
      await page.evaluate(async()=>{closeModal(true);openModal("后续表单","<input id='laterForm' value='保留内容'>",null);testResolvers.forEach(resolve=>resolve());await testFirstCommit;});
      assert.equal(await page.locator("#modalTitle").textContent(),"后续表单","late import completion replaced a new form");
      assert.equal(await page.locator("#laterForm").inputValue(),"保留内容");
     }
    }
    console.log("PASS student import "+kind);
   }catch(error){failures++;console.error("FAIL student import "+kind+": "+error.message);}
   finally{await page.close();}
  }
 }finally{await browser.close();}
 assert.equal(failures,0,"student import lifecycle regressions");
}).catch(error=>{console.error(error);process.exitCode=1;});
