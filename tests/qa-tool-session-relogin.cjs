'use strict';
const assert=require('assert/strict'),path=require('path'),os=require('os');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

withIsolatedWorkbench(async(origin,control)=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const hostContext=await browser.newContext(),editorContext=await browser.newContext();
  const host=await hostContext.newPage();await host.goto(origin,{waitUntil:'networkidle'});
  assert.equal(await host.evaluate(()=>SESSION.uid),'local-super-admin');
  const editor=await editorContext.newPage();await editor.goto(origin,{waitUntil:"networkidle"});await editor.waitForSelector("#workbenchSavePanel",{state:"attached"});
  const tools=['data-match-tool.html','excel-check-tool.html','excel-merge-tool.html','academic-summary-tool.html','academic-analysis-tool.html'];
  const hostTools=[];
  for(const name of tools){const page=await hostContext.newPage();await page.goto(origin+'/assets/'+name,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.ToolHistory);assert.equal(await page.evaluate(()=>__WORKBENCH_TOOL_SESSION__.uid),'local-super-admin');hostTools.push(page);}
  const editorTool=await editorContext.newPage();await editorTool.goto(origin+'/assets/data-match-tool.html',{waitUntil:'networkidle'});
  assert.notEqual(await editorTool.evaluate(()=>__WORKBENCH_TOOL_SESSION__.context),await host.evaluate(()=>SESSION.context));
  const embedded=await host.evaluateHandle(()=>{
   const frame=document.createElement('iframe');frame.id='sessionEmbeddedTool';frame.src='/assets/data-match-tool.html';document.body.appendChild(frame);return frame;
  });
  const frame=await embedded.asElement().contentFrame();await frame.waitForFunction(()=>!!window.ToolHistory);
  const switched=await hostContext.newPage();await switched.goto(origin+'/assets/data-match-tool.html',{waitUntil:'networkidle'});
  await switched.evaluate(()=>{window.__WORKBENCH_TOOL_SESSION__.uid='other-account';window.dispatchEvent(new StorageEvent('storage',{key:'nnuzc_session',newValue:JSON.stringify({uid:'other-account',context:'other-context'})}));});
  await switched.waitForSelector('#toolSessionLock');assert.equal(await switched.locator('#toolSessionLock h2').innerText(),'主机会话已失效','identity must stay bound to the opening host, not the switched cache');await switched.close();
  await control.restart();
  for(const page of [...hostTools,editorTool])await page.evaluate(async()=>{const r=await fetch('/api/auth/status');if(r.status!==401)throw Error('Old tool session must be rejected');});
  for(const page of hostTools){
   await page.waitForSelector('#toolSessionLock');
   assert.equal(await page.locator('#toolSessionLock h2').innerText(),'主机会话已失效','host standalone tool must use host expiry UI');
   assert.doesNotMatch(await page.locator('#toolSessionLock').innerText(),/协作会话|账号可能已切换|权限已改变/);
   assert.equal(await page.locator('#toolSessionLock a').getAttribute('href'),'/login.html');
   assert.equal(await page.locator('#toolSessionLock').getAttribute('aria-modal'),'true');
  }
  await editorTool.waitForSelector('#toolSessionLock');
  assert.equal(await editorTool.locator('#toolSessionLock h2').innerText(),'主机会话已失效');
  assert.equal(await editorTool.locator('#toolSessionLock a').getAttribute('href'),'/login.html');
  await frame.evaluate(async()=>{await fetch('/api/auth/status');});
  await host.waitForSelector('#workbenchSessionLock');assert.equal(await host.locator('#workbenchSessionLockTitle').innerText(),'主机会话已失效');
  assert.equal(await frame.locator('#toolSessionLock').count(),0,'embedded tools delegate to the host session lock');
  const first=hostTools[0];await first.locator('#toolSessionLock a').click();await first.waitForURL(origin+'/login.html');
  await first.locator('#enterBtn').click();await first.waitForURL(origin+'/');await first.waitForSelector("#workbenchSavePanel",{state:"attached"});assert.equal(await first.evaluate(()=>SESSION.uid),'local-super-admin');
  await editorTool.locator('#toolSessionLock a').click();await editorTool.waitForURL(origin+'/login.html');assert.equal(await editorTool.locator('#enterBtn').count(),1);
  console.log('tool session relogin: passed (real restart, five host tools, separate local opening contexts, embedded host delegation, opening identity, correct entry and reentry)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
