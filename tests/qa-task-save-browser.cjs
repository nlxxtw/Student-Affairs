"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),os=require("node:os");
const {withIsolatedWorkbench}=require("./isolated-workbench-helper.cjs");
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules"),"playwright"));
withIsolatedWorkbench(async origin=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/?goto=tasks',{waitUntil:'networkidle'});
    await page.evaluate(async()=>{taskRecords=[{id:'cycle',title:'周期检查',dueDate:isoToday(),repeat:'每周',status:'待处理',priority:'常规',category:'学生事务',duty:'daily'},{id:'once',title:'普通任务',status:'待处理',priority:'常规',category:'学生事务'}];persistTasks();await workbench.legacy.flushStore();goto('tasks');});
    let release,held;const heldRequest=new Promise(resolve=>held=resolve),gate=new Promise(resolve=>release=resolve);
    await page.route('**/api/store/batch',async route=>{held();await gate;await route.continue();});
    const completing=page.evaluate(()=>taskSetStatus('cycle','已完成'));completing.catch(()=>{});await heldRequest;
    assert.equal(await page.evaluate(()=>taskSaveBusy),true);
    assert.doesNotMatch(await page.evaluate(()=>document.getElementById('toastHost')?.textContent||''),/工作任务已完成/);
    assert.equal(await page.evaluate(()=>taskSetStatus('once','已完成')),false,'second edit must wait for the pending save');
    const before=await (await page.request.get(origin+'/api/store')).json();
    const remote=JSON.parse(before.nnuzc_tasks).concat({id:'remote-task',title:'同事新增任务',status:'待处理'});
    const response=await page.request.post(origin+'/api/store/batch',{data:{operations:[{key:'nnuzc_tasks',method:'PUT',baseValue:before.nnuzc_tasks,value:JSON.stringify(remote)}]}});assert.equal(response.status(),200);
    release();assert.equal(await completing,true);await page.unroute('**/api/store/batch');
    assert.equal(await page.evaluate(()=>taskRecords.filter(t=>t.repeatSourceId==='cycle'&&t.status==='待处理').length),1);
    assert.equal(await page.evaluate(()=>taskRecords.some(t=>t.id==='remote-task')),true,'server merge must reach the active task array');
    await page.evaluate(()=>taskSetStatus('once','处理中'));
    assert.equal(JSON.parse((await (await page.request.get(origin+'/api/store')).json()).nnuzc_tasks).some(t=>t.id==='remote-task'),true,'the next save must retain a remote addition');
    // Real rejected write: retain the form and draft, then retry once without duplication.
    await page.route('**/api/store/batch',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'隔离测试：保存失败'})}));
    await page.locator('#taskAddBtn').click();await page.fill('#taskTitle','失败后重试任务');await page.locator('#modalOk').click();
    await page.waitForFunction(()=>window.__workbenchSaveFailure&&!taskSaveBusy);
    assert.equal(await page.locator('#modal').evaluate(n=>n.classList.contains('show')),true);assert.equal(await page.locator('#taskTitle').inputValue(),'失败后重试任务');
    assert.equal(await page.evaluate(()=>taskRecords.filter(t=>t.title==='失败后重试任务').length),1);
    assert.equal(JSON.parse((await (await page.request.get(origin+'/api/store')).json()).nnuzc_tasks).filter(t=>t.title==='失败后重试任务').length,0);
    assert.equal(await page.locator('#workbenchSavePanel').isVisible(),false,'status panel must not cover task modal controls');
    await page.unroute('**/api/store/batch');await page.locator('#taskRetrySave').click();
    await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert.equal(JSON.parse((await (await page.request.get(origin+'/api/store')).json()).nnuzc_tasks).filter(t=>t.title==='失败后重试任务').length,1);
    // Creation while completed/category filters are selected must show the new task.
    await page.evaluate(()=>taskSetFilter('已完成'));await page.locator('#taskCategoryFilter').selectOption('就业指导',{force:true});
    await page.locator('#taskAddBtn').click();await page.fill('#taskTitle','筛选后新增任务');await page.locator('#modalOk').click();
    await page.waitForFunction(()=>!document.getElementById('modal').classList.contains('show'));
    assert.equal(await page.locator('#taskFilter').inputValue(),'all');assert.equal(await page.locator('#taskCategoryFilter').inputValue(),'');
    assert.match(await page.locator('.task-filter-selects .sf-native-trigger').nth(1).innerText(),/全部分类/,'visible filter label must match the reset native select');
    assert.equal(await page.locator('#taskBody').getByRole('button',{name:'筛选后新增任务',exact:true}).count(),1);
    await page.evaluate(()=>taskOpen('once'));await page.fill('#taskTitle','过期表单修改');
    await page.evaluate(()=>{taskRecords=taskRecords.map(t=>t.id==='once'?Object.assign({},t,{title:'其他人最新修改'}):t);persistTasks();});
    await page.locator('#modalOk').click();assert.equal(await page.locator('#modal').evaluate(n=>n.classList.contains('show')),true);
    assert.equal(await page.evaluate(()=>taskRecords.find(t=>t.id==='once').title),'其他人最新修改');await page.evaluate(async()=>{await workbench.legacy.flushStore();closeModal();});
    // A late save completion cannot close a newer details modal.
    let releaseModal,heldModal;const modalRequest=new Promise(resolve=>heldModal=resolve),modalGate=new Promise(resolve=>releaseModal=resolve);
    await page.route('**/api/store/batch',async route=>{heldModal();await modalGate;await route.continue();});
    await page.locator('#taskAddBtn').click();await page.fill('#taskTitle','异步弹窗保护');await page.locator('#modalOk').click();await modalRequest;
    await page.evaluate(()=>taskDetail('cycle'));releaseModal();await page.waitForFunction(()=>!taskSaveBusy);await page.unroute('**/api/store/batch');
    assert.equal(await page.locator('#modal').evaluate(n=>n.classList.contains('show')),true);assert.equal(await page.locator('#modalTitle').innerText(),'工作任务详情');await page.evaluate(()=>closeModal());
    // XSS remains text in the task list and details.
    const title='<img src=x onerror="window.__taskXss=1">';
    await page.locator('#taskAddBtn').click();await page.fill('#taskTitle',title);await page.locator('#modalOk').click();await page.waitForFunction(()=>!taskSaveBusy);
    assert.equal(await page.locator('#taskBody img').count(),0);assert.equal(await page.evaluate(()=>window.__taskXss),undefined);
    await page.locator('#taskBody').getByRole('button',{name:title,exact:true}).click();assert.equal(await page.locator('#modalBody img').count(),0);await page.evaluate(()=>closeModal());
    // Actual task deletion and undo preserve recurring links.
    page.once('dialog',d=>d.accept());await page.evaluate(()=>taskDelete('cycle'));assert.equal(await page.evaluate(()=>taskRecords.some(t=>t.id==='cycle')),false);
    await page.locator('#recycleUndoHost').getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>taskRecords.some(t=>t.id==='cycle'));
    assert.equal(await page.evaluate(()=>taskRecords.filter(t=>t.repeatSourceId==='cycle').length),1);
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.evaluate(()=>taskRecords.some(t=>t.id==='remote-task')),true);
    assert.deepEqual(errors,[]);
    console.log('qa-task-save-browser: passed (delayed/rejected saves, real concurrent merge, duplicate-free retry, filter visibility, stale edits, modal identity, XSS, task delete/undo/reload)');
  }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
