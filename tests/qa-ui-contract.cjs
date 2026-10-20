'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{ORG_DEPTS.push({name:'测试学院',code:'UI'});ORG_MAJORS.push({name:'测试专业',dept:'测试学院',code:'UI01'});ORG_CLASSES.push({name:'测试班',dept:'测试学院',major:'测试专业',grade:'2026'});saveOrgs();await workbench.legacy.flushStore();students=[ensureStudentNested({id:'ui001',name:'界面测试学生',status:'在校',cls:'测试班',dept:'测试学院',major:'测试专业',grade:'2026'})];persistStudents();await workbench.legacy.flushStore();goto('student');});
  await page.getByRole('textbox',{name:'学号',exact:true}).fill('ui001');await page.getByRole('textbox',{name:'姓名',exact:true}).fill('界面');
  await page.locator('.zf-actions button[onclick="stuQuery()"]').click();
  // Default nested ledger placeholders may trigger the separate history review.
  // Preserve the fixture explicitly; this suite checks labels/scroll/selection.
  await page.waitForTimeout(1200);
  if(await page.locator('#fixedValueReviewKeep').isVisible()){
   await page.locator('#fixedValueReviewKeep').click();
   await page.locator('#fixedValueReviewLayer').waitFor({state:'detached'});
  }
  await page.locator('.stu-row-chk').check();await page.waitForFunction(()=>document.querySelector('[data-selection-summary="student"]')?.textContent.includes('已选 1'));
  await page.locator('#stuChkAll').uncheck();await page.waitForFunction(()=>document.querySelector('[data-selection-summary="student"]')?.textContent.includes('已选 0'));
  for(const view of ['student','dorm','academicPublic']){
   await page.evaluate(view=>goto(view),view);if(view==='dorm')await page.getByRole('tab',{name:'住宿分布',exact:true}).click();if(view==='academicPublic')await page.waitForSelector('.ap-query');await page.waitForLoadState('networkidle');
   for(const width of [1280,768,480,320]){
    await page.setViewportSize({width,height:900});await page.waitForTimeout(300);
    const bounds=await page.locator('#content').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth,overflow:[...node.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>node.getBoundingClientRect().right&&!n.closest('[data-workbench-scroll]')).slice(0,8).map(n=>({tag:n.tagName,class:n.className,text:n.textContent.slice(0,40)}))}));assert(bounds.scroll<=bounds.client+2,view+' page must contain overflow at '+width+': '+JSON.stringify(bounds));
    const regions=page.locator('#content [data-workbench-scroll]');await regions.first().waitFor({state:'attached'});assert(await regions.count()>0,view+' exposes table scroll regions: '+JSON.stringify(await page.locator('#content .module-table-wrap,#content .table-scroll').evaluateAll(nodes=>nodes.map(n=>({class:n.className,x:getComputedStyle(n).overflowX,y:getComputedStyle(n).overflowY})))));
    const region=regions.first();await region.focus();assert.equal(await region.evaluate(n=>document.activeElement===n),true,view+' table focus at '+width);
    const scroll=await region.evaluate(n=>{n.scrollLeft=0;const before=n.scrollLeft;n.scrollLeft=50;return {before,after:n.scrollLeft,overflow:n.scrollWidth>n.clientWidth};});if(scroll.overflow)assert(scroll.after>scroll.before,'table scroll stays available');
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>goto('student'));await page.waitForTimeout(300);
  const folder=path.join(__dirname,'../docs/优化界面截图');fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,'学生查询-1440.png'),fullPage:true});
  await page.setViewportSize({width:480,height:900});await page.waitForTimeout(300);assert.notEqual(await page.locator('#workbenchSavePanel').evaluate(n=>getComputedStyle(n).position),'fixed','mobile status must not cover query controls');await page.screenshot({path:path.join(folder,'学生查询-480.png'),fullPage:true});assert.deepEqual(errors,[]);
  console.log('UI contract: passed (labels, selection, student/dorm/academic scroll, 4 widths, keyboard focus, screenshots)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
