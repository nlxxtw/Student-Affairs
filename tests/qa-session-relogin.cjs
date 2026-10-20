"use strict";
const assert = require("assert"), path = require("path"), os = require("os");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const modules = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(modules, "playwright"));
withIsolatedWorkbench(async (origin, control) => {
 const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
 try {
  const host = await browser.newPage();
  await host.goto(origin, { waitUntil: "networkidle" });
  assert.strictEqual(await host.evaluate(() => SESSION.uid), "local-super-admin");
  await host.evaluate(async () => {
   openModal('主机未保存输入','<input id="hostSessionDraft" value="主机草稿应保留">',()=>false);
  });
  const editor = await browser.newPage();
  await editor.goto(origin,{waitUntil:'networkidle'});await editor.waitForSelector("#workbenchSavePanel",{state:"attached"});
  await editor.evaluate(() => openModal('协作未保存输入','<input id="editorSessionDraft" value="协作草稿应保留">',()=>false));
  await control.restart();
  await Promise.all([host,editor].map(page=>page.evaluate(async()=>{await fetch('/api/workbench/state');})));
  await host.waitForSelector('#workbenchSessionLock');await editor.waitForSelector('#workbenchSessionLock');
  assert.match(await host.locator('#workbenchSessionLockTitle').innerText(), /主机会话已失效/);
  assert.match(await host.locator('#workbenchRelogin').innerText(), /主机入口/);
  assert.doesNotMatch(await host.locator('#workbenchSessionLock').innerText(), /设备已解除配对|账号可能已停用/);
  assert.match(await editor.locator('#workbenchSessionLockTitle').innerText(), /主机会话已失效/);
  const downloadEvent=host.waitForEvent('download');await host.click('#workbenchLockedDraft');
  const download=await downloadEvent,chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
  const draft=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert(draft.formSnapshots.some(item=>item.id==='hostSessionDraft'&&item.value==='主机草稿应保留'));
  host.once('dialog',dialog=>dialog.dismiss());await host.click('#workbenchRelogin');
  assert.strictEqual(new URL(host.url()).pathname,'/', 'cancelling navigation must preserve the locked host draft');
  host.once('dialog',dialog=>dialog.accept());await host.click('#workbenchRelogin');await host.waitForURL(origin+'/login.html');
  await host.locator('#enterBtn').waitFor({state:'visible'});await host.click('#enterBtn');await host.waitForURL(origin+'/');
  await host.waitForSelector("#workbenchSavePanel",{state:"attached"});
  assert.strictEqual(await host.evaluate(()=>SESSION.uid),'local-super-admin','host reentry must recreate the host identity');
  editor.once('dialog',dialog=>dialog.accept());await editor.click('#workbenchRelogin');await editor.waitForURL(origin+'/login.html');
  assert.strictEqual(await editor.locator('#enterBtn').count(),1);
  console.log('qa-session-relogin: passed (real restart, multiple local sessions, host draft export, cancelled navigation)');
 } finally {await browser.close();}
}).catch(error=>{console.error(error);process.exitCode=1;});
