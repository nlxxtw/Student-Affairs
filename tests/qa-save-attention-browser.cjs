'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('shuzhi_save_panel_hidden','0'));
  await page.goto(origin,{waitUntil:'networkidle'});
  const panel=page.locator('#workbenchSavePanel'),restore=page.locator('#workbenchSavePanelRestore');
  await page.waitForFunction(()=>document.getElementById('workbenchSaveStatus')?.textContent.includes('连接正常'));
  assert.equal(await panel.isVisible(),false,'healthy saves must not show a permanent panel');
  assert.equal(await restore.isVisible(),false,'healthy saves must not leave a floating restore button');
  const folder=path.resolve('docs/保存异常提示-2026-10-19');fs.mkdirSync(folder,{recursive:true});
  await page.screenshot({path:path.join(folder,'正常隐藏.png')});
  let release,started;const gate=new Promise(r=>release=r),held=new Promise(r=>started=r);
  await page.route('**/api/store/batch',async route=>{started();await gate;await route.continue();});
  try{
   await page.evaluate(()=>{localStorage.setItem('nnuzc_qa_save_busy','"合成延迟保存"');window.qaDelayedSave=workbench.legacy.flushStore();window.qaDelayedSave.catch(()=>{});});
   await held;await page.waitForFunction(()=>document.getElementById('workbenchSaveStatus')?.textContent==='正在保存…');
   assert.equal(await panel.isVisible(),false,'a healthy in-flight save must stay hidden');assert.equal(await restore.isVisible(),false);
  }finally{release();await page.evaluate(()=>window.qaDelayedSave);await page.unroute('**/api/store/batch');}
  const statePattern='**/api/workbench/state?*';
  await page.route(statePattern,r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成连接故障'})}));
  await panel.waitFor({state:'visible',timeout:10000});
  assert.match(await panel.innerText(),/数据连接中断/);assert.equal(await panel.evaluate(n=>n.open),true);
  await panel.locator('[data-action="hide"]').click();assert.equal(await panel.isVisible(),false);assert.equal(await restore.isVisible(),true);
  await restore.click();assert.equal(await panel.isVisible(),true);
  await page.unroute(statePattern);await panel.waitFor({state:'hidden',timeout:10000});assert.equal(await restore.isVisible(),false,'recovery hides both controls');
  await page.route('**/api/store/batch',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成保存故障'})}));
  await page.evaluate(async()=>{localStorage.setItem('nnuzc_qa_save_attention',JSON.stringify({note:'合成未保存内容'}));await workbench.legacy.flushStore().catch(()=>{});});
  await panel.waitFor({state:'visible',timeout:10000});assert.match(await panel.innerText(),/未保存草稿/);
  const downloading=page.waitForEvent('download');await panel.locator('[data-action="draft"]').click();const download=await downloading,chunks=[];
  for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const draft=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(draft.operations.some(op=>op.key==='nnuzc_qa_save_attention'&&op.value.includes('合成未保存内容')));
  await page.screenshot({path:path.join(folder,'保存失败.png')});
  await page.setViewportSize({width:390,height:844});const bounds=await panel.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390,'mobile alert must fit the viewport');
  await page.unroute('**/api/store/batch');await panel.locator('[data-action="retry"]').click();
  await panel.waitFor({state:'hidden',timeout:10000});assert.equal(await restore.isVisible(),false);
  const saved=await(await page.request.get(origin+'/api/store/nnuzc_qa_save_attention')).json();assert.equal(JSON.parse(saved.value).note,'合成未保存内容');
  // Old hidden preferences must never suppress a new failure after reloading.
  await page.addInitScript(()=>localStorage.setItem('shuzhi_save_panel_hidden','1'));
  await page.route(statePattern,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"合成重连故障"}'}));
  await page.reload({waitUntil:'networkidle'});await panel.waitFor({state:'visible',timeout:10000});
  assert.equal(await panel.evaluate(n=>n.open),true,'a persisted old hide flag cannot hide new errors');
  await panel.locator('[data-action="hide"]').click();await page.unroute(statePattern);
  await restore.waitFor({state:'hidden',timeout:10000});assert.equal(await panel.isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('save attention UI: healthy/in-flight states hidden, connection/save failures shown, dismiss/reopen, recovery, draft export, real retry persistence, legacy preference and mobile width passed');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
