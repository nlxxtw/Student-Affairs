'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.request.post(origin+'/api/auth/enter',{headers:{Origin:origin}});await page.goto(origin,{waitUntil:'networkidle'});
  await page.evaluate(()=>openModal('表单校验','<input id="qaFormDraft" value="保留内容">',()=>{throw Error('校验未通过，请检查输入');}));
  await page.locator('#modalOk').click();await page.waitForSelector('[data-modal-save-error]');
  assert.equal(await page.locator('#qaFormDraft').inputValue(),'保留内容');assert.equal(await page.locator('#modal.show').count(),1);assert.equal(await page.locator('#modalOk').isEnabled(),true);assert.deepEqual(errors,[]);
  await page.evaluate(()=>closeModal());
  let release,started;const held=new Promise(r=>release=r),seen=new Promise(r=>started=r);
  await page.route('**/api/store/batch',async route=>{if(route.request().postData().includes('nnuzc_qa_modal_save')){started();await held;}await route.continue();});
  await page.evaluate(()=>openModal('确认保存','<input id="qaSaveValue" value="待保存">',()=>{localStorage.setItem('nnuzc_qa_modal_save',JSON.stringify({value:document.getElementById('qaSaveValue').value}));closeModal();}));
  await page.locator('#modalOk').click();await seen;
  assert.equal(await page.locator('#modal.show').count(),1,'legacy callbacks must not close before persistence acknowledges');assert.equal(await page.locator('#modalOk').isEnabled(),false);
  release();await page.waitForSelector('#modal.show',{state:'hidden'});await page.unroute('**/api/store/batch');
  const store=await context.request.get(origin+'/api/store');assert.equal(JSON.parse((await store.json()).nnuzc_qa_modal_save).value,'待保存');
  await page.route('**/api/store/batch',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'测试保存失败'})}));
  await page.evaluate(()=>{window.qaSaveCalls=0;openModal('保存失败重试','<input id="qaRetryValue" value="重试保留">',()=>{qaSaveCalls++;localStorage.setItem('nnuzc_qa_modal_retry',JSON.stringify({value:document.getElementById('qaRetryValue').value}));showToast('保存成功','ok');closeModal();});});
  await page.locator('#modalOk').click();await page.waitForSelector('[data-modal-save-error]');
  assert.equal(await page.locator('#qaRetryValue').inputValue(),'重试保留');assert.equal(await page.locator('#modal.show').count(),1);
  assert.equal(await page.locator('#toastHost').textContent().then(s=>s.includes('保存成功')),false,'failed saves must not report success');
  await page.unroute('**/api/store/batch');await page.evaluate(()=>__workbenchStoreSync.retry());
  await page.locator('#modalOk').click();await page.waitForSelector('#modal.show',{state:'hidden'});
  assert.equal(await page.evaluate(()=>qaSaveCalls),1,'retry persistence without repeating business insertion');
  await page.evaluate(()=>{openModal('异步旧表单','<input value="旧">',()=>new Promise(r=>window.qaFinishOld=r));});await page.locator('#modalOk').click();
  await page.evaluate(()=>{openModal('新表单','<input id="qaNewValue" value="新内容">',()=>false);qaFinishOld(true);});
  await page.waitForTimeout(100);assert.equal(await page.locator('#modalTitle').textContent(),'新表单');assert.equal(await page.locator('#modal.show').count(),1);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modal.show').count(),0,'Escape closes generic dialogs');assert.deepEqual(errors,[]);
  await page.evaluate(()=>openModal('分层关闭',qfMulti('qaEscape',[{v:'one',l:'第一项'}],[]),()=>false));
  await page.locator('#modal .qf-multi-trigger').click();await page.locator('#modal .qf-multi-opt input').check();
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modal.show').count(),1,'first Escape closes picker, retains form');assert.equal(await page.locator('#modal .qf-multi.open').count(),0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#modal.show').count(),0);
  console.log('modal save contract: passed (errors, draft, confirmed persistence, failed-save retry without duplicate insertion, stale completion, Escape)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
