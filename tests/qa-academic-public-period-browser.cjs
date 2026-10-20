'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
withIsolatedWorkbench(async(origin,{restart})=>{
 const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars'],executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?goto=academicPublic',{waitUntil:'networkidle'});
  assert.equal((await page.request.get(origin+'/academic-public.css')).status(),200,'statistics stylesheet is served');
  const api=async(route,body,method=body===undefined?'GET':'POST')=>{const response=await page.request.fetch(origin+'/api'+route,{method,headers:{Origin:origin,'Idempotency-Key':crypto.randomUUID()},data:body});const result=await response.json();assert(response.ok(),JSON.stringify(result));return result;};
  const terms=['2024-2025-1','2024-2025-2','2025-2026-1'];
  await api('/store/nnuzc_orgs',{value:JSON.stringify({depts:[{name:'测试学院'}],majors:[{name:'测试专业',dept:'测试学院'}],classes:[{name:'测试班',dept:'测试学院',major:'测试专业',grade:'2024'}]})},'PUT');
  await api('/store/nnuzc_students',{value:JSON.stringify([{id:'a',name:'测试甲',cls:'测试班',dept:'测试学院',major:'测试专业',grade:'2024',status:'在校',enroll:'2024-09-01'}])},'PUT');
  await api('/store/nnuzc_term_list',{value:JSON.stringify(terms.map(t=>t+'学期'))},'PUT');
  const state=await api('/academic-public/state?term='+terms[2]);const rp=await api('/academic-public/rule-preview',{version:state.version,rules:{thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60}});await api('/academic-public/rules',{previewId:rp.previewId},'PUT');
  const preview=await api('/academic-public/previews',{type:'original',rows:terms.map((term,i)=>({'学号':'a','原修读学期':term,'课程代码':'C'+i,'课程名称':'课程'+i,'学分':'3','总评成绩':'40','考试批次':'期末'}))});await api('/academic-public/commits',{previewId:preview.previewId});
  await page.reload({waitUntil:'networkidle'});await page.waitForSelector('[data-ap-period]',{state:'attached'});await page.locator('[data-ap="tab"][data-arg="warnings"]').click();
  assert.equal(await page.locator('.ap-filter-line').evaluate(n=>getComputedStyle(n).display),'grid','query layout stylesheet applied');
  await page.locator('#ap-period .qf-multi-trigger').click();await page.locator('[data-ap-period="'+terms[2]+'"]').check();
  await page.locator('[data-ap-period="'+terms[1]+'"]').uncheck();await page.locator('[data-ap-period="'+terms[0]+'"]').check();
  await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('.ap-result-context').textContent.includes('2024-2025-1'));
  assert.match(await page.locator('#ap-content').innerText(),/橙色预警/);assert.match(await page.locator('#ap-content').innerText(),/未通过门数 2/);
  await page.locator('#ap-select-page').check();assert.match(await page.locator('#ap-selection-summary').innerText(),/已选 1 人/);
  await page.locator('[data-ap="warning-run"]').click();await page.waitForFunction(()=>document.querySelector('#ap-content').textContent.includes('待复核'));
  await page.locator('[data-ap="case"]').click();assert.match(await page.locator('#modalBody').innerText(),/预警|橙色/);await page.locator('.modal-x').click();
  await page.locator('#ap-period .qf-multi-trigger').click();await page.locator('[data-ap-all-periods]').check();await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('.ap-result-context').textContent.includes('2024-2025-2'));
  assert.match(await page.locator('#ap-content').innerText(),/红色预警/);
  for(const width of [1440,1024,768,390]){
   await page.setViewportSize({width,height:1000});
   const bounds=await page.locator('.ap-query').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'query fits viewport '+width+' '+JSON.stringify(bounds));
   assert(await page.locator('#ap-period .qf-multi-trigger').isVisible());
   assert(await page.locator('.ap-scroll').evaluate(n=>n.scrollWidth>n.clientWidth),'wide table scrolls at '+width);
   await page.locator('.ap-scroll').evaluate(n=>n.scrollLeft=n.scrollWidth);assert(await page.locator('[data-ap="case"]').isVisible());
  }
  await page.setViewportSize({width:1440,height:1000});await page.locator('.ap-scroll').evaluate(n=>n.scrollLeft=0);await page.screenshot({path:path.join(os.tmpdir(),'shuzhi-academic-public-periods.png'),fullPage:true});
  await page.locator('[data-ap="tab"][data-arg="history"]').click();await page.waitForSelector('[data-ap="run-detail"]');await page.locator('[data-ap="run-detail"]').first().click();await page.waitForFunction(()=>document.getElementById('modalTitle').textContent==='预警名单生成快照');assert.match(await page.locator('#modalBody').innerText(),/多学期/);await page.locator('.modal-x').click();
  await page.locator('[data-ap="rules"]').click();assert.equal(await page.locator('#ap-warning-metric').count(),1);await page.selectOption('#ap-warning-metric','credits');await page.locator('[data-ap="rule-preview"]').click();await page.waitForSelector('[data-ap="rule-save"]');await page.locator('[data-ap="rule-save"]').click();await page.waitForFunction(()=>document.querySelector('.ap-rule-summary')?.textContent.includes('学分'));
  const backup=await api('/backups',{note:'跨学期预警名单隔离验证'}),preflight=await api('/backups/'+backup.id+'/preflight');
  const backupState=await api('/academic-public/state?term='+terms[2]);await api('/academic-public/warning-runs',{version:backupState.version,term:terms[2],scope:'all'});
  assert.equal((await api('/academic-public/warning-runs')).runs.length,2);
  await api('/backups/'+backup.id+'/restore',{confirmId:backup.id,sha256:preflight.sha256,mode:'replace'});
  assert.equal((await api('/academic-public/warning-runs')).runs.length,1,'backup restores the original generated runs');
  await restart();await page.goto(origin+'/login.html');await page.request.post(origin+'/api/auth/enter',{headers:{Origin:origin}});await page.goto(origin+'/?goto=academicPublic',{waitUntil:'networkidle'});await page.waitForSelector('[data-ap-all-periods]',{state:'attached'});await page.locator('[data-ap="tab"][data-arg="history"]').click();await page.waitForSelector('[data-ap="run-detail"]');
  assert.deepEqual(errors,[]);console.log('academic-public period browser: passed (non-contiguous terms, all, saved cases/history, rules UI, page select, responsive scroll, restart)');
 }finally{await browser.close();}
}).catch(error=>{console.error(error);process.exitCode=1;});

