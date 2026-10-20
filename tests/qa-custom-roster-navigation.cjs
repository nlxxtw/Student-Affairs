'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  for(const fails of [false,true]){
   const page=await browser.newPage();await page.goto(origin+'/?goto=dashboard',{waitUntil:'networkidle'});
   await page.evaluate(()=>{window.__historyStarted=false;window.ToolHistory={...window.ToolHistory,list:()=>new Promise((resolve,reject)=>{window.__historyStarted=true;window.__finishHistory=()=>resolve([]);window.__failHistory=()=>reject(new Error('Synthetic delayed history failure'));})};goto('customRoster');});
   await page.waitForFunction(()=>window.__historyStarted);await page.evaluate(()=>goto('academicPublic'));await page.waitForSelector('#ap-body');
   await page.evaluate(async fails=>{if(fails)window.__failHistory();else window.__finishHistory();await new Promise(resolve=>setTimeout(resolve,0));},fails);
   assert.equal(await page.evaluate(()=>currentView),'academicPublic');
   assert.equal(await page.locator('#ap-body').count(),1,'late history '+(fails?'failure':'success')+' must preserve the newly selected page');
   await page.evaluate(()=>goto('customRoster'));assert.match(await page.locator('#content .ptitle').innerText(),/花名册/);
   await page.close();
  }
  const page=await browser.newPage();await page.goto(origin+'/?goto=student',{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
   students.splice(0,students.length,{id:'CR001',name:'花名册休学学生',dept:'信息工程学院',major:'通信工程',grade:'2025级',cls:'通信2501',status:'休学',dorm:[],classroom:[],punishments:[],fund:{}});
   goto('customRoster');customRosterOpenRow();
   document.getElementById('customRosterField_name').value='花名册休学学生';
   document.getElementById('customRosterField_dept').value='错误学院';
  });
  await page.locator('#modalOk').click();
  const linkLayer=page.locator('#studentLinkImportLayer');await linkLayer.waitFor({state:'visible'});
  assert.match(await linkLayer.innerText(),/全部学籍状态/);assert.match(await linkLayer.innerText(),/错误学院[\s\S]*信息工程学院/);
  await linkLayer.getByRole('button',{name:/确认并继续导入/}).click();
  await page.waitForFunction(()=>!document.getElementById('mask').classList.contains('show'));
  const saved=await page.evaluate(()=>{const store=JSON.parse(localStorage.getItem('nnuzc_custom_roster_v1'));return store.datasets[0].state.rows[0].values;});
  assert.equal(saved.studentNo,'CR001');assert.equal(saved.name,'花名册休学学生');assert.equal(saved.dept,'信息工程学院');assert.equal(saved.major,'通信工程');assert.equal(saved.grade,'2025级');assert.equal(saved.cls,'通信2501');
  await page.evaluate(()=>customRosterImport());
  await page.locator('#customRosterImportFile').setInputFiles({name:'custom-roster-alias.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeff学生编号,学生姓名,所属学院\r\nCR001,花名册休学学生,错误学院\r\n','utf8')});
  await page.locator('#modalOk').click();await linkLayer.waitFor({state:'visible'});assert.match(await linkLayer.innerText(),/错误学院[\s\S]*信息工程学院/);await linkLayer.getByRole('button',{name:/确认并继续导入/}).click();
  await page.waitForFunction(()=>!document.getElementById('mask').classList.contains('show'));
  const aliasImport=await page.evaluate(()=>{const state=JSON.parse(localStorage.getItem('nnuzc_custom_roster_v1')).datasets[0].state;return {rows:state.rows,fields:state.fields.map(field=>field.name)};});
  assert.equal(aliasImport.rows.length,1,'student-number aliases must update the canonical student row');assert.equal(aliasImport.rows[0].values.studentNo,'CR001');assert(!aliasImport.fields.includes('学生编号'));assert(!aliasImport.fields.includes('学生姓名'));assert(!aliasImport.fields.includes('所属学院'));
  await page.close();
  console.log('Custom roster navigation passed: delayed history is isolated and all-status student matching corrects/fills master information');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
