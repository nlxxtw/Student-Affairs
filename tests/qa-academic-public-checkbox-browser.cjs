'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?goto=academicPublic',{waitUntil:'networkidle'});
  const api=async(route,body,method=body===undefined?'GET':'POST')=>{const r=await page.request.fetch(origin+'/api'+route,{method,headers:{Origin:origin,'Idempotency-Key':crypto.randomUUID()},data:body});const value=await r.json();assert(r.ok(),JSON.stringify(value));return value;};
  const terms=['2024-2025-1','2024-2025-2','2025-2026-1'],people=[
   {id:'0010',name:'十',dept:'乙学院',grade:'2024',major:'专业乙',cls:'10班',status:'在校'},
   {id:'0004',name:'毕业',dept:'甲学院',grade:'2023',major:'专业甲',cls:'1班',status:'毕业'},
   {id:'0003',name:'三',dept:'乙学院',grade:'2024',major:'专业乙',cls:'2班',status:'在校生'},
   {id:'0002',name:'二',dept:'乙学院',grade:'2024',major:'专业乙',cls:'2班'},
   {id:'0001',name:'一',dept:'乙学院',grade:'2023',major:'专业乙',cls:'10班',status:'在校'}
  ];
  await api('/store/nnuzc_orgs',{value:JSON.stringify({depts:[{name:'甲学院'},{name:'乙学院'}],majors:[{name:'专业甲',dept:'甲学院'},{name:'专业乙',dept:'乙学院'}],classes:[{name:'1班',dept:'甲学院',major:'专业甲',grade:'2023'},{name:'2班',dept:'乙学院',major:'专业乙',grade:'2024'},{name:'10班',dept:'乙学院',major:'专业乙',grade:'2024'}]})},'PUT');
  await api('/store/nnuzc_students',{value:JSON.stringify(people)},'PUT');await api('/store/nnuzc_term_list',{value:JSON.stringify(terms.map(t=>t+'学期'))},'PUT');
  const state=await api('/academic-public/state?term='+terms[2]);const rp=await api('/academic-public/rule-preview',{version:state.version,rules:{thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60}});await api('/academic-public/rules',{previewId:rp.previewId},'PUT');
  const p=await api('/academic-public/previews',{type:'original',rows:people.flatMap(s=>terms.map((term,i)=>({'学号':s.id,'原修读学期':term,'课程代码':'C'+i,'课程名称':'课程'+i,'学分':'2','总评成绩':'40','考试批次':'期末'})))});await api('/academic-public/commits',{previewId:p.previewId});await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.ap-query');
  await require('./startup-review-helper.cjs')(page);
  assert.equal(await page.locator('.ap-query .qf-multi-trigger').count(),9,'conditions use the same dropdown pattern as student management');assert.equal(await page.locator('.ap-query input[type=checkbox]:visible').count(),0,'checkboxes stay inside collapsed dropdowns');
  async function openFor(locator){const id=await locator.evaluate(n=>n.closest('[data-ap-dropdown]').id);if(!(await locator.isVisible()))await page.locator('#'+id+' .qf-multi-trigger').click();}
  async function pick(selector,checked=true){const locator=page.locator(selector);await openFor(locator);await locator.setChecked(checked);}
  assert.match(await page.locator('#ap-status .qf-multi-text').innerText(),/在校生/);assert((await page.locator('.ap-query').boundingBox()).height<=260,'query stays compact on desktop');
  await page.locator('#ap-grade .qf-multi-trigger').click();await page.locator('#ap-grade .sf-search-input').fill('2024');assert.equal(await page.locator('[data-ap-filter="grade"][value="2023"]').isVisible(),false);await page.locator('[data-ap-filter="grade"][value="2024"]').check();await page.locator('#ap-grade .sf-search-input').press('Escape');assert.equal(await page.locator('#ap-grade .qf-multi-panel').isVisible(),false);assert.equal(await page.locator('#ap-grade .qf-multi-trigger').evaluate(n=>document.activeElement===n),true,JSON.stringify(await page.evaluate(()=>({active:document.activeElement?.outerHTML,error:document.querySelector('#ap-error')?.textContent}))));
  const status=page.locator('[data-ap-filter="status"][value="在校"]');assert(await status.isChecked());assert.equal(await page.locator('[data-ap-filter="status"]:checked').count(),1);
  const ids=()=>page.locator('#ap-content tbody tr').evaluateAll(rows=>rows.map(r=>r.children[1]?.textContent));assert.deepEqual(await ids(),['0001','0002','0003','0010']);
  await pick('[data-ap-filter="grade"][value="2024"]');assert.deepEqual(await ids(),['0001','0002','0003','0010'],'draft checkbox does not change applied result');
  await page.locator('[data-ap="export"]').click();await page.locator('[data-ap="export-run"]').click();await page.waitForFunction(()=>document.querySelector('#modalBody')?.textContent.includes('4 名学生'));await page.locator('.modal-x').click();
  await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('#ap-selection-summary')?.dataset.total==='3');assert.deepEqual(await ids(),['0002','0003','0010']);await page.locator('[data-ap="reset"]').click();await page.waitForFunction(()=>document.querySelector('#ap-selection-summary')?.dataset.total==='4');
  for(const checkbox of await page.locator('[data-ap-period]').all()){await openFor(checkbox);await checkbox.uncheck();}await page.locator('[data-ap="filter"]').click();assert.match(await page.locator('#ap-error').innerText(),/至少.*学期/);assert.deepEqual(await ids(),['0001','0002','0003','0010']);
  await pick('[data-ap-period="'+terms[0]+'"]');await pick('[data-ap-period="'+terms[2]+'"]');
  await pick('[data-ap-filter="grade"][value="2023"]');await page.locator('[data-ap-filter="grade"][value="2024"]').check();await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('.ap-result-context').textContent.includes('多学期'));
  assert.deepEqual(await ids(),['0001','0002','0003','0010']);await page.locator('[data-ap="tab"][data-arg="warnings"]').click();assert.match(await page.locator('#ap-content').innerText(),/橙色预警/);
  await pick('[data-ap-all="status"]');await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('#ap-selection-summary')?.dataset.total==='5');assert.deepEqual(await ids(),['0004','0001','0002','0003','0010']);
  await page.locator('[data-ap="reset"]').click();await page.waitForFunction(()=>document.querySelector('#ap-selection-summary')?.dataset.total==='4');assert(await status.isChecked());
  await pick('[data-ap-all-periods]');await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('.ap-result-context').textContent.includes('2024-2025-2'));assert.match(await page.locator('#ap-content').innerText(),/红色预警/);
  await pick('[data-ap-stage="original"]');assert.equal(await page.locator('[data-ap-stage]:checked').count(),1);await page.locator('[data-ap-stage="original"]').click();assert(await page.locator('[data-ap-stage="original"]').isChecked(),'one stage is required');
  await page.locator('[data-ap="filter"]').click();await page.waitForFunction(()=>document.querySelector('.ap-result-context')?.textContent.includes('正考'));
  for(const width of [1440,1024,768,390,320]){await page.setViewportSize({width,height:1000});await page.waitForFunction(()=>!document.getAnimations().some(a=>a.effect?.target===document.querySelector('.main')&&a.playState==='running'));const bounds=await page.locator('.ap-query').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1,'query fits '+width);assert(await page.locator('.ap-scroll').evaluate(n=>n.scrollWidth>n.clientWidth),'table can scroll');await page.locator('#ap-caseStatus .qf-multi-trigger').click();await page.locator('#ap-caseStatus .qf-multi-panel').waitFor({state:'visible'});const panel=await page.locator('#ap-caseStatus .qf-multi-panel').boundingBox();assert(panel.x>=0&&panel.x+panel.width<=width+1,'dropdown fits '+width);await page.locator('.ap-result-context').click();assert.equal(await page.locator('#ap-caseStatus .qf-multi-panel').isVisible(),false,'outside click closes');}
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(os.tmpdir(),'shuzhi-academic-public-checkboxes.png'),fullPage:true});assert.deepEqual(errors,[]);
  const more=Array.from({length:30},(_,i)=>({id:String(1030-i),name:'分页学生'+i,dept:'乙学院',grade:'2024',major:'专业乙',cls:'2班',status:'在校'}));await api('/store/nnuzc_students',{value:JSON.stringify(people.concat(more))},'PUT');await page.evaluate(()=>goto('academicPublic'));await page.waitForSelector('[data-ap="tab"][data-arg="grades"]');await page.locator('[data-ap="tab"][data-arg="grades"]').click();await page.waitForFunction(()=>document.querySelector('#ap-selection-summary')?.dataset.total==='34');
  assert.deepEqual(await ids(),['0001','0002','0003',...Array.from({length:17},(_,i)=>String(1001+i))]);await page.locator('[data-ap="page"][data-arg="1"]').click();assert.deepEqual(await ids(),[...Array.from({length:13},(_,i)=>String(1018+i)),'0010'],'sort applies before pagination');
  assert.deepEqual(errors,[]);
  console.log('academic-public checkbox browser: passed (default current students, ordering, noncontiguous terms, all terms/statuses, reset, stage, responsive)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
