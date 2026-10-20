'use strict';
const assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
withIsolatedWorkbench(async origin=>{
 const auth=await fetch(origin+'/api/auth/enter',{method:'POST',headers:{Origin:origin}}),cookie=auth.headers.get('set-cookie').split(';')[0];await auth.arrayBuffer();
 const cls={name:'合成同步班',dept:'合成学院',major:'合成专业',grade:'2026级',teacher:'合成班主任'};
 const student={id:'sync-filter-1',name:'合成原姓名',dept:cls.dept,major:cls.major,grade:cls.grade,cls:cls.name,status:'在校'};
 async function put(key,rows){const r=await fetch(origin+'/api/store/'+key,{method:'PUT',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({value:JSON.stringify(rows)})});assert(r.ok);await r.arrayBuffer();}
 await put('nnuzc_orgs',{depts:[{name:cls.dept}],majors:[{name:cls.major,dept:cls.dept}],classes:[cls]});await put('nnuzc_students',[student]);
 const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?goto=dashboard',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.getElementById('workbenchSaveStatus')?.textContent.includes('连接正常'));
  const component=page.locator('#siClassFilters [data-si-class-field="teacher"]');
  await component.locator('.qf-multi-trigger').click();await component.locator('.sf-search-input').fill('合成');
  await component.locator('input[value="合成班主任"]').check();
  assert.equal(await component.locator('.qf-multi-panel').isVisible(),true,'dropdown is open before the remote update');
  await page.evaluate(()=>{window.qaOpenFilterNode=document.querySelector('#siClassFilters [data-si-class-field="teacher"]');});
  await put('nnuzc_students',[{...student,name:'合成更新姓名'}]);
  await page.waitForFunction(()=>document.getElementById('workbenchSaveStatus')?.textContent.includes('最新数据')||students.some(s=>s.name==='合成更新姓名'),null,{timeout:12000});
  assert.equal(await component.locator('.qf-multi-panel').isVisible(),true,'background sync must not close an open filter');
  assert.equal(await page.evaluate(()=>window.qaOpenFilterNode===document.querySelector('#siClassFilters [data-si-class-field="teacher"]')),true,'background sync must not replace the active filter DOM');
  assert.equal(await component.locator('.sf-search-input').inputValue(),'合成');assert.equal(await component.locator('input[value="合成班主任"]').isChecked(),true);
  await component.locator('.sf-search-input').press('Escape');
  await page.waitForFunction(()=>students.some(s=>s.name==='合成更新姓名'),null,{timeout:12000});
  assert.deepEqual(errors,[]);
  console.log('open-filter synchronization: pending snapshot preserves open dropdown, typed search, checked choice and DOM; closing resumes background hydration');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
