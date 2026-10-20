'use strict';
const assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(deps,'playwright'));

withIsolatedWorkbench(async origin=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin,{waitUntil:'networkidle'});
    assert.equal(await page.evaluate(()=>typeof WorkbenchProgress?.begin),'function','global operation progress API is missing');

    await page.evaluate(()=>{window.qaProgress=WorkbenchProgress.begin({title:'测试导入',message:'正在导入并保存…'});qaProgress.update(45,'正在写入第 45 条');});
    const panel=page.locator('[data-workbench-progress]');
    await panel.waitFor();
    assert.match(await panel.innerText(),/测试导入[\s\S]*正在写入第 45 条/);
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'),'45');
    await page.waitForTimeout(2500);
    assert.equal(await panel.count(),1,'unfinished progress disappeared automatically');
    await page.evaluate(()=>qaProgress.succeed('导入完成'));
    await panel.waitFor({state:'detached',timeout:3000});

    await page.evaluate(()=>{window.qaProgress=WorkbenchProgress.begin({title:'失败导入',message:'正在导入…'});qaProgress.fail('文件格式错误');});
    await panel.waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await panel.count(),1,'failed progress must remain available for review');
    assert.match(await panel.innerText(),/文件格式错误/);
    await panel.getByRole('button',{name:'关闭'}).click();
    await panel.waitFor({state:'detached'});

    await page.evaluate(()=>{openModal('测试数据导入','<div>模拟导入</div>',()=>new Promise(resolve=>{window.qaImportResolve=resolve;}));});
    await page.locator('#modalOk').click();
    await panel.waitFor();
    await page.waitForTimeout(2500);
    assert.equal(await panel.count(),1,'modal import progress disappeared before the import promise completed');
    await page.evaluate(()=>qaImportResolve(true));
    await panel.waitFor({state:'detached',timeout:4000});

    await page.evaluate(()=>openMappedImportWizard({name:'映射测试',file:new File(['资源\n示例资源'],'测试.csv',{type:'text/csv'}),fields:[{key:'resource',label:'资源',required:true}],validate:rows=>({ok:rows,errors:[]}),apply:()=>new Promise(resolve=>{window.qaMappedResolve=()=>resolve({ok:1,skip:0});})}));
    await page.evaluate(()=>mappedImportNext());
    await page.evaluate(()=>mappedImportNext());
    await page.evaluate(()=>mappedImportNext());
    await page.evaluate(()=>{mappedImportCommit();});
    await panel.waitFor();
    await page.waitForTimeout(2500);
    assert.equal(await panel.count(),1,'mapped import progress disappeared before the apply promise completed');
    assert.match(await panel.innerText(),/映射测试导入/);
    await page.evaluate(()=>qaMappedResolve());
    await panel.waitFor({state:'detached',timeout:4000});

    await page.evaluate(()=>{closeModal();goto('studentOrgManage');});
    await page.locator('iframe[src*="student-org.html"]').waitFor();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('iframe')).some(frame=>frame.contentWindow&&typeof frame.contentWindow.importFile==='function'));
    await page.evaluate(()=>{const original=workbench.legacy.flushStore.bind(workbench.legacy);window.qaOrgOriginalFlush=original;workbench.legacy.flushStore=()=>new Promise(resolve=>{window.qaOrgResolve=async()=>{await original();resolve();};});});
    const orgFrame=page.frames().find(frame=>frame.url().includes('/student-org.html'));
    assert.ok(orgFrame,'student organization frame did not load');
    await orgFrame.evaluate(()=>{window.qaOrgPromise=importFile('orgs',new File(['类别,名称,学年\n其他组织,进度条验收组织,2026-2027'],'组织.csv',{type:'text/csv'}));});
    await panel.waitFor();
    await page.waitForTimeout(1200);
    assert.equal(await panel.count(),1,'student organization import progress disappeared before storage confirmation');
    await page.evaluate(()=>qaOrgResolve());
    await orgFrame.evaluate(()=>qaOrgPromise);
    await page.evaluate(()=>{workbench.legacy.flushStore=qaOrgOriginalFlush;delete window.qaOrgOriginalFlush;});
    await panel.waitFor({state:'detached',timeout:4000});
    assert.deepEqual(errors,[]);
    console.log('qa-operation-progress-browser: passed (persistent pending state, success dismissal, retained failure, modal, mapped and student-organization import integration)');
  }finally{await browser.close();}
}).catch(error=>{console.error(error);process.exitCode=1;});
