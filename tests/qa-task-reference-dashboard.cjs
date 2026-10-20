"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),os=require("node:os"),fs=require("node:fs");
const {withIsolatedWorkbench}=require("./isolated-workbench-helper.cjs");
const modules=process.env.CODEX_NODE_MODULES||path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const {chromium}=require(path.join(modules,"playwright"));
withIsolatedWorkbench(async origin=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.EDGE_PATH||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    await page.goto(origin+"/?goto=tasks",{waitUntil:"networkidle"});
    await page.evaluate(async()=>{
      const day=isoToday(),yesterday=taskDayOffset(day,-1),tomorrow=taskDayOffset(day,1);
      taskRecords=Array.from({length:12},(_,i)=>({id:"reference-"+i,title:["联系家长，反馈近期学习情况","宿舍楼安全卫生检查","整理国家奖学金申请材料","准备新生班会材料","跟进学生心理辅导情况"][i%5],note:"核实办理要求，记录工作进展。",priority:["紧急","重要","常规","低"][i%4],category:["家校沟通","安全管理","奖助勤贷","班会工作","学生关怀"][i%5],status:i>=5?"已完成":"待处理",dueDate:i===0?yesterday:i===1||i===2||i===5?day:tomorrow,dueTime:i===1?"00:00":"23:59",repeat:"无",duty:"daily",remindDays:3}));
      persistTasks();await workbench.legacy.flushStore();goto("tasks");
    });
    assert.equal(await page.locator('[data-task-kpi="今日到期"]').innerText(),"3");
    assert.equal(await page.locator('[data-task-kpi="已完成"]').innerText(),"7");
    assert.equal(await page.locator('[data-task-kpi="未完成"]').innerText(),"5");
    assert.equal(await page.locator('[data-task-kpi="已逾期"]').innerText(),"2");
    assert.match(await page.locator('[data-task-filter="已完成"]').innerText(),/58%/);
    assert.equal(await page.locator('.task-kpi').count(),8);
    assert.deepEqual(await page.locator('.task-kpi>div>span').allTextContents(),['全部任务','全部已完成','全部未完成','全部逾期待处理','今日任务','今日已完成','今日未完成','今日逾期待处理']);
    assert.equal(await page.locator('[data-task-kpi="今日已完成"]').innerText(),'1');
    assert.equal(await page.locator('[data-task-kpi="今日未完成"]').innerText(),'2');
    assert.equal(await page.locator('[data-task-kpi="今日逾期待处理"]').innerText(),'1');
    assert.equal(await page.locator('.task-heading h2').innerText(),'工作任务');
    assert.equal(await page.evaluate(()=>VIEWS.tasks),'工作任务');
    assert.match(await page.locator("#taskReminders").innerText(),/2 项任务已逾期/);
    assert.equal(await page.locator("#taskTimeline .task-timeline-item").count(),5);
    assert.match(await page.locator("#taskTabs").innerText(),/全部\s*\(12\)/);
    assert.equal(await page.locator("#taskFilter").inputValue(),"all");
    assert.equal(await page.locator('#taskQuickTitle, #taskQuickDue, #taskKeyword, .task-quick, .task-filters').count(),0);
    assert.equal(await page.getByRole('button',{name:'详细任务',exact:true}).count(),0);
    await page.getByRole('button',{name:'新增任务'}).click();
    assert.match(await page.locator('#modalTitle').innerText(),/新建工作任务/);await page.evaluate(()=>closeModal());
    await page.getByRole("button",{name:"查看逾期任务 ›",exact:true}).click();
    assert.deepEqual(await page.locator("[data-task-id]").evaluateAll(rows=>rows.map(r=>r.dataset.taskId)),["reference-0","reference-1"]);
    await page.locator('[data-task-filter="已完成"]').click();assert.equal(await page.locator("[data-task-id]").count(),7);
    await page.locator('.task-kpi-today').click();assert.equal(await page.locator("[data-task-id]").count(),3);
    for(const [filter,count] of [['all',12],['已完成',7],['open',5],['已逾期',2],['today',3],['today-done',1],['today-open',2],['today-overdue',1]]){
      await page.locator('[data-task-filter="'+filter+'"]').click();
      assert.equal(await page.evaluate(()=>taskFiltered().length),count,filter+' card filter');
      assert.equal(await page.locator('[data-task-filter="'+filter+'"]').getAttribute('aria-pressed'),'true');
    }
    await page.evaluate(()=>taskSetFilter("all"));
    assert.doesNotMatch(await page.locator('#taskBody').innerText(),/核实办理要求，记录工作进展。|日常事务管理|暂无办理说明/);
    const row=page.locator('[data-task-id="reference-0"]');await row.locator('.task-complete-check').check();
    assert.equal(await page.evaluate(()=>taskRecords.find(t=>t.id==="reference-0").status),"已完成");
    await page.locator('[data-task-id="reference-0"] .task-complete-check').uncheck();
    assert.equal(await page.evaluate(()=>taskRecords.find(t=>t.id==="reference-0").status),"待处理");
    await page.locator('#taskTimeline .task-timeline-item').first().click();assert.match(await page.locator("#modalTitle").innerText(),/工作任务详情/);assert.match(await page.locator('#modalBody').innerText(),/核实办理要求，记录工作进展。/);await page.evaluate(()=>closeModal());
    await page.locator('[data-task-id="reference-0"] .task-actions button').filter({hasText:"编辑"}).click();
    await page.locator('#taskCategory').selectOption("宿舍管理");await page.fill('#taskNote',"编辑后办理说明");await page.locator('#modalOk').click();
    await page.evaluate(()=>workbench.legacy.flushStore());
    await page.reload({waitUntil:"networkidle"});
    assert.equal(await page.evaluate(()=>taskRecords.find(t=>t.id==="reference-0").category),"宿舍管理");
    await page.locator('#taskPageSize').selectOption("20");
    await page.locator('#taskBody thead .task-complete-check').check();
    assert.equal(await page.evaluate(()=>taskSummary().done),12);
    assert.equal(await page.locator('#taskTimeline .task-timeline-item').count(),0);
    await page.locator('#taskBody thead .task-complete-check').uncheck();assert.equal(await page.evaluate(()=>taskSummary().open),12);
    assert.equal(await page.locator('.task-shortcuts').count(),0);
    assert.equal(await page.locator('.task-side').getByText('常用功能',{exact:true}).count(),0);
    await page.evaluate(async()=>{taskRecords.forEach(t=>t.status=Number(t.id.split('-')[1])>=5?'已完成':'待处理');persistTasks();await workbench.legacy.flushStore();goto('tasks');});
    await page.waitForTimeout(4000);
    const previews=path.join(os.tmpdir(),"shuzhi-task-reference-preview");fs.mkdirSync(previews,{recursive:true});
    for(const theme of ["classic","bluework","tech"]){
      await page.evaluate(theme=>{if(theme==="classic")document.documentElement.removeAttribute("data-theme");else document.documentElement.setAttribute("data-theme",theme);},theme);
      for(const width of [1600,1024,768,390,320]){
        await page.setViewportSize({width,height:1100});await page.waitForTimeout(150);
        const box=await page.locator('.task-workbench').evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth}));
        assert.ok(box.scroll<=box.width+2,theme+" "+width+" overflow: "+JSON.stringify(box));
        if(width===1600){const cardRows=await page.locator('.task-kpi').evaluateAll(cards=>cards.map(c=>Math.round(c.getBoundingClientRect().top)));assert.equal(new Set(cardRows).size,2);assert.equal(cardRows.filter(y=>y===cardRows[0]).length,4);}
        const alignment=await page.locator('.task-deadline').first().evaluate(n=>({vertical:getComputedStyle(n).verticalAlign,horizontal:getComputedStyle(n).textAlign}));assert.deepEqual(alignment,{vertical:'middle',horizontal:'center'});
        if(theme==="classic"&&[1600,390].includes(width)){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(previews,"tasks-"+width+".png"),fullPage:true});}
      }
    }
    await page.evaluate(()=>{window.__WORKBENCH_READ_ONLY__=true;taskToggleDone("reference-0",true);});
    assert.equal(await page.evaluate(()=>taskRecords.find(t=>t.id==="reference-0").status),"待处理");
    assert.deepEqual(errors,[]);
    console.log("Task reference dashboard passed: stats, tabs, overdue, timeline, checkbox/batch, edit/reload, shortcuts removed, themes/mobile, viewer. Previews: "+previews);
  }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
