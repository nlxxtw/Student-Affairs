"use strict";
const assert=require("node:assert/strict");

async function verifyTasks(page){
  await page.evaluate(async()=>{
    const today=isoToday();
    taskRecords=Array.from({length:23},(_,i)=>({id:"productivity-"+i,title:"待办验证 "+i,priority:i===0?"高":"中",duty:i===0?"career":"daily",category:i===0?"就业指导":"学生事务",dueDate:today,status:"待处理",repeat:"无",remindDays:3}));
    taskRecords.push({id:"productivity-history",title:"历史关联",studentId:123456,studentName:"历史毕业生",status:"待处理",priority:"高"});
    localStorage.setItem("nnuzc_tasks",JSON.stringify(taskRecords));localStorage.setItem("nnuzc_task_notes","[]");await workbench.legacy.flushStore();goto("tasks");
  });
  await page.waitForSelector("#taskAddBtn");
  assert.equal(await page.locator('[data-task-kpi="今日到期"]').innerText(),"23");
  assert.equal(await page.locator('[data-task-kpi="未完成"]').innerText(),"24");
  assert.equal(await page.locator('[data-task-id]').count(),10);
  await page.locator("#taskPageSize").selectOption("20");assert.equal(await page.locator('[data-task-id]').count(),20);
  await page.locator("#taskPageSize").selectOption("50");assert.equal(await page.locator('[data-task-id]').count(),24);
  await page.locator("#taskPageSize").selectOption("10");
  await page.getByRole("button",{name:"下一页",exact:true}).click();
  assert.match(await page.locator(".task-pager").innerText(),/第 2 \/ 3 页/);
  await page.locator("#taskPriorityFilter").selectOption({label:"重要"},{force:true});
  await page.locator("#taskCategoryFilter").selectOption({label:"就业指导"},{force:true});
  assert.deepEqual(await page.locator("[data-task-id]").evaluateAll(nodes=>nodes.map(n=>n.dataset.taskId)),["productivity-0"]);
  await page.locator('[data-task-id="productivity-0"]').getByRole("button",{name:"开始办理",exact:true}).click();
  assert.equal(await page.evaluate(()=>taskRecords.find(t=>t.id==="productivity-0").status),"处理中");
  await page.locator("#taskPriorityFilter").selectOption("",{force:true});
  await page.locator("#taskCategoryFilter").selectOption("",{force:true});
  await page.getByRole("button",{name:"新增任务"}).click();
  await page.fill("#taskTitle","新增任务保存刷新测试");
  await page.locator("#modalOk").click();
  await page.evaluate(()=>workbench.legacy.flushStore());
  await page.reload({waitUntil:"networkidle"});await page.evaluate(()=>goto("tasks"));
  assert.equal(await page.evaluate(()=>taskRecords.filter(t=>t.title==="新增任务保存刷新测试").length),1);
  await page.evaluate(()=>taskOpen("productivity-0"));
  await page.fill("#taskDueTime","23:59");await page.locator("#taskCategory").selectOption("材料报送");
  await page.locator("#modalOk").click();await page.evaluate(()=>workbench.legacy.flushStore());
  assert.deepEqual(await page.evaluate(()=>{const t=taskRecords.find(t=>t.id==="productivity-0");return [t.dueTime,t.category,t.priority];}),["23:59","材料报送","重要"]);
  await page.evaluate(()=>taskSetStatus("productivity-0","已完成"));
  assert.equal(await page.locator('[data-task-kpi="已完成"]').innerText(),"1");
  assert.equal(await page.locator('#nav [data-view="tasks"] [data-task-badge]').textContent(),"24");
  await page.getByRole("button",{name:"查看全部提醒"}).click();
  assert.match(await page.locator("#modalTitle").innerText(),/全部到期提醒/);
  await page.evaluate(()=>closeModal());
  const firstTip=await page.locator("#taskTipText").innerText();await page.getByRole("button",{name:"换一条"}).click();assert.notEqual(await page.locator("#taskTipText").innerText(),firstTip);
  await page.getByRole("button",{name:"新增便签"}).click();
  await page.fill("#taskNoteText",'<img src=x onerror="window.__noteExecuted=1">共享便签');
  await page.locator("#modalOk").click();await page.evaluate(()=>workbench.legacy.flushStore());
  await page.reload({waitUntil:"networkidle"});await page.evaluate(()=>goto("tasks"));
  assert.match(await page.locator("#taskNotes").innerText(),/<img src=x/);
  assert.equal(await page.locator("#taskNotes img").count(),0);
  assert.equal(await page.evaluate(()=>window.__noteExecuted),undefined);
  page.once("dialog",dialog=>dialog.accept());
  await page.locator("#taskNotes").getByRole("button",{name:"删除",exact:true}).click();
  await page.waitForFunction(()=>taskNotes.length===0);
  await page.locator("#recycleUndoHost").getByRole("button",{name:"撤销",exact:true}).click();
  await page.waitForFunction(()=>taskNotes.length===1);
  await page.evaluate(()=>taskOpen("productivity-history"));await page.locator("#modalOk").click();
  assert.deepEqual(await page.evaluate(()=>{const t=taskRecords.find(t=>t.id==="productivity-history");return [String(t.studentId),t.studentName];}),["123456","历史毕业生"]);
  await page.evaluate(()=>workbench.legacy.flushStore());
  const backup=await page.evaluate(async()=>{const r=await fetch("/api/backups",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({note:"便签隔离验证"})});return r.status;});
  assert.equal(backup,201);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    if(width<=900)await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector(".main")).marginLeft)===0);
    const box=await page.locator(".task-workbench").evaluate(n=>({width:n.getBoundingClientRect().width,scroll:n.scrollWidth,ancestors:[n.parentElement,n.parentElement.parentElement].map(e=>({class:e.className,width:e.getBoundingClientRect().width,margin:getComputedStyle(e).marginLeft,padding:getComputedStyle(e).padding})),viewport:innerWidth}));
    assert.ok(box.scroll<=box.width+2,"task workspace overflows at "+width+": "+JSON.stringify(box));
  }
  assert.equal(await page.locator(".task-shortcuts").count(),0,"removed common-function card must stay absent");
  await page.evaluate(()=>goto("student"));
  assert.equal(await page.evaluate(()=>currentView),"student");
  console.log("productivity browser: tasks, refresh, filters, notes/recycle, legacy links, responsive passed");
}

async function verifyStudentPicker(page){
  await page.evaluate(()=>{
    const statuses=["在校","在校生","休学","退学","转出","毕业","延期毕业","其他"];
    window.__pickerOriginalStudents=students.slice();
    students=students.concat(statuses.map((status,i)=>({id:"picker-"+i,name:i<3?"同名验证":"状态验证"+i,status,dept:"测试学院",cls:"测试班"})));
    taskOpen();
  });
  await page.getByRole("button",{name:"学号/姓名搜索",exact:true}).click();
  await page.fill("#studentSearchInput","picker-");
  assert.equal(await page.locator("#studentChoiceLayer [data-student-choice-id]").count(),8,"business student search must include every status in student management");
  await page.fill("#studentSearchInput","同名验证");
  assert.equal(await page.locator("#studentChoiceLayer [data-student-choice-id]").count(),3);
  await page.keyboard.press("Shift+Tab");await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.studentChoiceId),"picker-2","dialog must trap backward Tab");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(()=>document.activeElement.hasAttribute("data-student-choice-cancel")),true);
  await page.locator('#studentChoiceLayer [data-student-choice-id="picker-1"]').click();
  assert.equal(await page.locator("#taskSid").inputValue(),"picker-1");
  await page.getByRole("button",{name:"学号/姓名搜索",exact:true}).click();
  await page.fill("#studentSearchInput","picker-2");
  assert.equal(await page.locator("#studentChoiceLayer [data-student-choice-id]").count(),1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#studentChoiceLayer").count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),"学号/姓名搜索");
  await page.evaluate(()=>closeModal());
  await page.evaluate(()=>{window.__pickerMatches=[];resolveStudentNameInput("同名验证",s=>{if(s)window.__pickerMatches.push(s.id);},"回归");});
  assert.equal(await page.locator("#studentChoiceLayer [data-student-choice-id]").count(),3);
  await page.keyboard.press("Escape");
  // Exercise real business inputs; dispatching their existing handlers must fill related identity fields.
  for(const [open,id,name] of [["openTalkForm","tfSid","tfName"],["openHomeForm","hfSid","hfName"],["openHelpForm","hpSid","hpName"],["openEventForm","efSid","efName"],["keyCareOpen","kcSid","kcName"],["studentLoanOpen","slFormSid","slFormName"]]){
    const available=await page.evaluate(({open,id})=>{if(typeof window[open]!=="function")return false;window[open]();return !!document.getElementById(id);},{open,id});
    if(!available)throw new Error("student picker fixture needs correct business input: "+open+" / "+id);
    await page.waitForSelector('[data-student-search-for="'+id+'"]');
    await page.locator('[data-student-search-for="'+id+'"]').click();await page.fill("#studentSearchInput","picker-0");
    await page.locator('#studentChoiceLayer [data-student-choice-id="picker-0"]').click();
    assert.equal(await page.locator("#"+id).inputValue(),"picker-0");
    assert.equal(await page.locator("#"+name).inputValue(),"同名验证");await page.evaluate(()=>closeModal());
  }
  await page.evaluate(()=>classOfficerOpen(""));
  await page.fill("#coName","同名验证");
  assert.equal(await page.locator(".co-name-option").count(),2,"class officer name candidates must also exclude inactive students");
  await page.evaluate(()=>closeModal());
  await page.evaluate(()=>{students=window.__pickerOriginalStudents;delete window.__pickerOriginalStudents;});
  console.log("productivity browser: all-status picker, duplicate names, keyboard, business form fill passed");
}
module.exports={verifyTasks,verifyStudentPicker};
