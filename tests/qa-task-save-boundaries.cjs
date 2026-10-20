"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"..","app.js"),"utf8"),source=app.slice(app.indexOf("const TASK_STATUS="),app.indexOf("function keyCareTask("));
function fixture(code=source){
  let modalSave;const toasts=[],fields={};let n=0;
  const ctx=vm.createContext({Date,console,PAGES:{},taskRecords:[],students:[],CURRENT_TERM:"2026-2027-1学期",window:{},
    isoToday:()=>"2026-10-08",fmtNow:()=>"2026-10-08 12:00:00",genId:()=>"audit-"+(++n),clsStudents:()=>[],isOnCampusStudent:()=>true,
    esc:String,attr:String,jsArg:JSON.stringify,badge:String,persistTasks(){},showToast:(m,t)=>toasts.push([m,t]),
    document:{getElementById:id=>fields[id]||null,querySelectorAll:()=>[]},localStorage:{getItem:()=>"[]",setItem(){}},
    openModal(_title,_body,save){modalSave=save;}});
  vm.runInContext(code,ctx);ctx.taskRender=()=>{};
  for(const [id,value] of Object.entries({taskTitle:"编辑标题",taskSid:"",taskSource:"手工创建",taskPriority:"常规",taskCategory:"学生事务",taskDue:"2026-10-08",taskDueTime:"",taskDuty:"daily",taskRepeat:"无",taskRemind:"3",taskNote:"说明",taskNoteText:"便签修改"}))fields[id]={value,focus(){}};
  return {ctx,toasts,fields,save:()=>modalSave()};
}
(async()=>{
  let f=fixture();f.ctx.taskRecords=[{id:"rollback",title:"回访",status:"待处理",dueDate:"2026-10-08",repeat:"每周"}];
  f.ctx.persistTasks=()=>{throw Error("disk rejected");};
  assert.equal(await f.ctx.taskSetStatus("rollback","已完成"),false);
  assert.equal(f.ctx.taskRecords.length,1);assert.equal(f.ctx.taskRecords[0].status,"待处理","single completion must roll back synchronous failure and successor");
  f=fixture();f.ctx.taskRecords=[{id:"edit",title:"原标题",status:"待处理"}];f.ctx.taskOpen("edit");
  f.ctx.taskRecords=JSON.parse(JSON.stringify(f.ctx.taskRecords));
  assert.equal(await f.save(),true);assert.equal(f.ctx.taskRecords[0].title,"编辑标题","save must locate a record by ID after array replacement");
  f=fixture();f.ctx.taskRecords=[{id:"changed",title:"原标题",status:"待处理"}];f.ctx.taskOpen("changed");
  f.ctx.taskRecords=[{id:"changed",title:"另一人修改",status:"处理中"}];
  assert.equal(await f.save(),false);assert.equal(f.ctx.taskRecords[0].title,"另一人修改","open form must not overwrite another change");
  const mutation=fixture(source.replace('(expected&&!current)||(current&&JSON.stringify(current)!==expected)','false'));
  mutation.ctx.taskRecords=[{id:"mutation",title:"原文",status:"待处理"}];mutation.ctx.taskOpen("mutation");mutation.ctx.taskRecords=[{id:"mutation",title:"最新修改",status:"处理中"}];
  assert.notEqual(await mutation.save(),false,"the stale-form assertion must detect removal of the conflict check");
  f=fixture();f.ctx.taskOpen();f.ctx.window.__WORKBENCH_READ_ONLY__=true;
  assert.equal(await f.save(),false);assert.equal(f.ctx.taskRecords.length,0,"read-only state must be rechecked when submitting an open form");
  for(const values of [{taskTitle:" "},{taskDue:"",taskDueTime:"10:00"},{taskRemind:"1.5"},{taskRemind:"61"},{taskSid:"missing-student"}]){
    const invalid=fixture();invalid.ctx.taskOpen();for(const [key,value] of Object.entries(values))invalid.fields[key].value=value;
    assert.equal(await invalid.save(),false,'invalid form must not write: '+JSON.stringify(values));assert.equal(invalid.ctx.taskRecords.length,0);
  }
  f=fixture();f.ctx.taskNoteOpen();f.ctx.window.__workbenchSessionInvalid=true;assert.equal(await f.save(),false);
  assert.equal(vm.runInContext('taskNotes.length',f.ctx),0,'invalidated session must not modify an open note form');
  f=fixture();let release;f.ctx.window.workbench={legacy:{flushStore:()=>new Promise(resolve=>release=resolve)}};
  f.ctx.taskOpen();const saving=f.save();assert.equal(f.toasts.filter(t=>t[1]==="success").length,0,"do not report success before server acknowledgement");
  assert.equal(await f.save(),false,"duplicate save while awaiting acknowledgement must be ignored");
  assert.equal(f.ctx.taskRecords.length,1);release();assert.equal(await saving,true);
  f=fixture();f.ctx.taskRecords=[{id:"merged",title:"自己的任务",status:"待处理"}];
  f.ctx.window.workbench={legacy:{flushStore:async()=>{f.ctx.window.__workbenchStore={nnuzc_tasks:JSON.stringify(f.ctx.taskRecords.concat({id:"remote",title:"同事新增",status:"待处理"}))};}}};
  assert.equal(await f.ctx.taskSetStatus("merged","已完成"),true);
  assert.equal(f.ctx.taskRecords.length,2,"acknowledged merge must refresh in-memory tasks and preserve a collaborator's addition");
  f=fixture();f.ctx.window.workbench={legacy:{flushStore:async()=>{throw Error("network rejected");}}};f.ctx.taskOpen();
  assert.equal(await f.save(),false);assert.equal(f.ctx.taskRecords.length,1,"uncertain asynchronous save must preserve the draft");
  assert.equal(f.toasts.filter(t=>t[1]==="success").length,0);
  f.ctx.window.workbench.legacy.flushStore=async()=>{};assert.equal(await f.save(),true);assert.equal(f.ctx.taskRecords.length,1,"retry must use the same draft ID");
  f=fixture();f.ctx.taskNoteOpen();f.ctx.localStorage.setItem=()=>{throw Error("notes quota exceeded");};
  assert.equal(await f.save(),false);assert.equal(vm.runInContext("taskNotes.length",f.ctx),0,"note save must roll back synchronous failure");
  console.log("qa-task-save-boundaries: passed (rollback, array replacement, stale form, permission recheck, async acknowledgement, duplicate/retry, notes)");
})().catch(e=>{console.error(e);process.exitCode=1;});
