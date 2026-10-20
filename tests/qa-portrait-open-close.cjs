"use strict";
const assert=require('assert'),path=require('path'),os=require('os');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 async function bounded(operation){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('portrait blocked the browser event loop')),8000))]);}finally{clearTimeout(timer);}}
 try{
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const entered=await fetch(origin+'/api/auth/enter',{method:'POST',headers:{Origin:origin}}),cookie=entered.headers.get('set-cookie').split(';')[0];
  const loaded=await fetch(origin+'/api/demo/load',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
  assert.strictEqual(loaded.status,200,await loaded.text());
  await page.goto(origin,{waitUntil:'networkidle'});
  for(const unactivated of [false,true]){
   await bounded(page.evaluate(locked=>{if(locked){WORKBENCH_LICENSE_STATUS={required:true,valid:false};licenseApplyUiState();}goto('portrait');setQueryReady('portrait',true);portraitFilter();},unactivated));
   const studentId=await page.evaluate(()=>students[0].id);
   await bounded(page.locator('#portraitBody a').filter({hasText:'查看画像'}).first().click());
   await bounded(page.locator('#modalBody').waitFor({state:'visible'}));
   await bounded(page.waitForFunction(()=>document.getElementById('modalBody').innerText.includes('基本信息')));
   assert.match(await bounded(page.locator('#modalBody').innerText()),/基本信息/);
   await bounded(page.locator('#modalFoot button').filter({hasText:'关闭'}).click());
   assert.strictEqual(await bounded(page.locator('#modal').evaluate(node=>node.classList.contains('show'))),false);
   await bounded(page.evaluate(id=>portraitShow(id),studentId));
   await bounded(page.locator('.modal-x').click());
   assert.strictEqual(await bounded(page.locator('#mask').evaluate(node=>node.classList.contains('show'))),false);
  }
  await bounded(page.evaluate(()=>{
   const original=portraitArchiveHTML;
   portraitArchiveHTML=()=>{throw Error('injected archive failure');};
   window.__restorePortraitArchive=()=>{portraitArchiveHTML=original;};
   portraitShow(students[0].id);
  }));
  await bounded(page.waitForFunction(()=>document.getElementById('modalBody').innerText.includes('学生档案加载失败')));
  await bounded(page.locator('#modalFoot button').filter({hasText:'关闭'}).click());
  await page.evaluate(()=>{__restorePortraitArchive();const original=portraitSummaryHTML;portraitSummaryHTML=()=>{throw Error('injected summary failure');};window.__restorePortraitSummary=()=>{portraitSummaryHTML=original;};portraitShow(students[0].id);});
  await bounded(page.waitForFunction(()=>document.getElementById('modalBody').innerText.includes('态势研判暂时无法加载')));
  assert.match(await page.locator('#modalBody').innerText(),/基本信息/);
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator('#mask').evaluate(node=>node.classList.contains('show')),false);
  await page.evaluate(()=>__restorePortraitSummary());
  // A pending public-grade request must not keep the modal or the next student locked.
  let releaseRequest;const pendingResponse=new Promise(resolve=>releaseRequest=resolve);
  await page.route('**/api/academic-public/student?*',async route=>{await pendingResponse;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rows:[],exams:[]})});});
  await page.evaluate(()=>portraitShow(students[0].id));
  await bounded(page.waitForFunction(()=>document.querySelector('[data-ap-loaded="loading"]')));
  await bounded(page.locator('.modal-x').click());
  await page.evaluate(()=>portraitShow(students[1].id));
  await bounded(page.waitForFunction(()=>document.getElementById('modalBody').innerText.includes('基本信息')));
  await bounded(page.locator('#modalFoot button').filter({hasText:'关闭'}).click());
  releaseRequest();await page.unrouteAll({behavior:'wait'});
  // Closing before deferred rendering, or replacing it with another modal, cancels stale work.
  await page.evaluate(()=>{portraitShow(students[0].id);closeModal();openModal('另一个弹窗','其他内容',null);});
  await page.waitForTimeout(100);
  assert.strictEqual(await page.locator('#modalBody').innerText(),'其他内容');
  await page.evaluate(()=>closeModal());
  for(let index=0;index<10;index++){
   await page.evaluate(i=>portraitShow(students[i%students.length].id),index);
   await bounded(page.waitForFunction(()=>document.getElementById('modalBody').innerText.includes('基本信息')));
   await bounded(page.locator('.modal-x').click());
  }
  assert.deepStrictEqual(errors,[]);
  console.log('qa-portrait-open-close: passed (demo, unactivated, render failures, pending request, close, Escape, reopen, stale rendering, repeated students)');
 }finally{await browser.close();}
}).catch(error=>{console.error(error);process.exitCode=1;});
