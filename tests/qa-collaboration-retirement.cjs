'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async(origin,fixture)=>{
 const enter=await fetch(origin+'/api/auth/enter',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(enter.status,200);let cookie=enter.headers.get('set-cookie').split(';')[0];await enter.arrayBuffer();
 const oldRoutes=['/api/collaboration/accounts','/api/collaboration/login','/api/collaboration/logout','/api/collaboration/audit','/api/collaboration/state','/collaboration-login','/api/academic-public/access','/api/lan/config','/api/lan/devices','/api/lan/pair-code','/pair'];
 for(const route of oldRoutes)for(const method of ['GET','POST']){const r=await fetch(origin+route,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:method==='POST'?'{}':undefined,redirect:'manual'});assert.equal(r.status,404,'retired route must be absent: '+method+' '+route);await r.arrayBuffer();}
 const state=await fetch(origin+'/api/workbench/state',{headers:{Cookie:cookie}});assert.equal(state.status,200);assert.equal(typeof(await state.json()).revision,'string');
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?goto=dashboard',{waitUntil:'networkidle'});
  assert.equal(await page.locator('#collaborationPanel,#collaborationPanelRestore,#collaborationAccounts,#collaborationAdd').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/3人协作|协作账号|新增账号/);
  assert.equal(await page.locator('[data-view="lanaccess"]').count(),0);assert.equal(await page.evaluate(()=>typeof window.__NNUZC__.PAGES.lanaccess),'undefined');
  assert.equal(await page.locator('#workbenchSavePanel').count(),1,'generic save/retry/draft protection remains available');
  assert.equal(await page.evaluate(()=>typeof window.__workbenchStoreSync.retry),'function');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
 let legacyHash;
 await fixture.restart(temp=>{
  fs.writeFileSync(path.join(temp,'data/lan-access.json'),JSON.stringify({enabled:true,devices:[{id:'synthetic-device',tokenHash:'synthetic-hash'}]}));
  const db=new DatabaseSync(path.join(temp,'data/workbench.db'));
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='collaboration_accounts'").get(),undefined,'fresh installations do not create account tables');
  db.exec('CREATE TABLE collaboration_accounts(id TEXT PRIMARY KEY, login TEXT, password_hash TEXT);');db.prepare('INSERT INTO collaboration_accounts VALUES(?,?,?)').run('synthetic-legacy','synthetic-user','synthetic-inert-hash');legacyHash=JSON.stringify(db.prepare('SELECT * FROM collaboration_accounts').all());db.close();
 });
 const oldSession=await fetch(origin+'/api/workbench/state',{headers:{Cookie:cookie}});assert.equal(oldSession.status,401,'restarting invalidates all old sessions');await oldSession.arrayBuffer();
 const privateAddresses=Object.values(os.networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>x.address);
 for(const address of privateAddresses)await assert.rejects(fetch('http://'+address+':'+new URL(origin).port+'/api/health',{signal:AbortSignal.timeout(1500)}),'service must not listen on a non-loopback interface');
 await fixture.restart(temp=>{const db=new DatabaseSync(path.join(temp,'data/workbench.db'));assert.equal(JSON.stringify(db.prepare('SELECT * FROM collaboration_accounts').all()),legacyHash,'legacy credential records remain inert and unchanged');db.close();assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'data/lan-access.json'),'utf8')).enabled,true,'the old LAN file remains untouched and cannot reactivate access');});
 const r=await fetch(origin+'/api/collaboration/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:'synthetic-user',password:'not-a-real-password'})});assert.equal(r.status,404);await r.arrayBuffer();
 console.log('collaboration retirement: routes/UI removed, generic save protection retained, no new account table, historical table inert, restart sessions invalidated');
}).catch(e=>{console.error(e);process.exitCode=1;});
