"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const source = app.slice(app.indexOf("const TASK_STATUS="), app.indexOf("function keyCareTask("));
const today = "2026-10-08";
const context = vm.createContext({
  Date, console, PAGES: {}, taskRecords: [], students: [], CURRENT_TERM: "2026-2027-1学期",
  isoToday: () => today, fmtNow: () => today + " 12:00:00", genId: (() => { let id=0; return () => "qa-"+(++id); })(),
  persistTasks() {}, showToast() {}, document: { getElementById() { return null; }, querySelectorAll() { return []; } },
  localStorage: { getItem() { return null; }, setItem() {} },
  esc: String, attr: String, jsArg: JSON.stringify, badge: String,
  window: {}, taskNotes: []
});
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
assert.equal(run('taskPriorityValue("高")'), "重要", "old high priority must remain important");
assert.equal(run('taskPriorityValue("中")'), "常规");
assert.equal(run('taskCategoryValue({duty:"career"})'), "就业指导");
assert.equal(run('taskDisplayStatus({status:"待处理",dueDate:"2026-10-08",dueTime:"09:00"},"2026-10-08T10:00")'), "已逾期");
assert.equal(run('taskDisplayStatus({status:"待处理",dueDate:"2026-10-08"},"2026-10-08T10:00")'), "待处理", "date-only deadlines remain valid for the whole day");
assert.equal(run('taskNextDue({dueDate:"2026-10-01",repeat:"每周"})'), "2026-10-01", "unfinished recurring tasks must not silently advance");
assert.equal(run('taskComputeNextDue("2026-10-08","每周")'), "2026-10-15", "finishing on the due day advances the period");
assert.equal(run('taskComputeNextDue("2026-01-31","每月")'), "2026-10-28", "monthly recurrence clamps to the destination month");
context.taskRecords = [{id:"repeat",title:"回访",status:"待处理",dueDate:"2026-10-01",repeat:"每周"}];
run('taskSetStatus("repeat","已完成");taskSetStatus("repeat","已完成")');
assert.equal(context.taskRecords.length, 2, "repeated completion cannot create duplicate successors");
assert.equal(context.taskRecords.find(row=>row.id!=="repeat").dueDate, "2026-10-15");
run('taskSetStatus("repeat","待处理");taskSetStatus("repeat","已完成")');
assert.equal(context.taskRecords.length, 2, "reopening and completing cannot duplicate an existing successor");
context.taskRecords = [
  {id:"a",title:"就业跟进",priority:"高",duty:"career",status:"待处理",dueDate:today},
  {id:"b",title:"就业跟进",priority:"低",duty:"daily",status:"待处理",dueDate:today},
  {id:"c",title:"其他",priority:"高",duty:"career",status:"已完成",dueDate:today}
];
assert.deepEqual(Array.from(run('taskFiltered({keyword:"跟进",priority:"重要",category:"就业指导",status:"open",duty:"career"}).map(t=>t.id)')), ["a"], "combined filters must match actual record IDs");
assert.equal(run('taskSummary().todayDue'), 2);
assert.equal(run('taskSummary().done'), 1);
const mutated = vm.createContext({ ...context, taskRecords: context.taskRecords });
vm.runInContext(source.replace('taskCategoryValue(t)===f.category', 'taskCategoryValue(t)!==f.category'), mutated);
assert.notDeepEqual(Array.from(vm.runInContext('taskFiltered({category:"就业指导"}).map(t=>t.id)', mutated)), Array.from(run('taskFiltered({category:"就业指导"}).map(t=>t.id)')), "category test must detect an inverted condition");
context.taskRecords = [
  {id:"due-open",title:"今日待办",dueDate:today,dueTime:"23:59",status:"待处理"},
  {id:"due-done",title:"今日完成",dueDate:today,status:"已完成"},
  {id:"yesterday",title:"昨天到期",dueDate:"2026-10-07",status:"待处理"},
  {id:"future",title:"明天到期",dueDate:"2026-10-09",status:"待处理"}
];
assert.equal(run('taskSummary().todayTotal'),2,"today tasks include completed work due today");
assert.equal(run('taskSummary().completionRate'),25,"completion rate uses real task count");
assert.equal(run('taskSummary().todayDelta'),1,"day comparison uses due dates");
assert.equal(run('taskSummary().todayDone'),1);
assert.equal(run('taskSummary().todayCompletionRate'),50);
assert.deepEqual(Array.from(run('taskFiltered({status:"today-done"}).map(t=>t.id)')),["due-done"]);
assert.deepEqual(Array.from(run('taskFiltered({status:"today-open"}).map(t=>t.id)')),["due-open"]);
context.beijingDateTime=()=>today+" 12:00:00";
context.taskRecords.find(t=>t.id==="due-open").dueTime="09:00";
assert.equal(run('taskSummary().todayOverdue'),1);
assert.deepEqual(Array.from(run('taskFiltered({status:"today-overdue"}).map(t=>t.id)')),["due-open"],"today overdue excludes yesterday's overdue work");
assert.equal(run('taskDeadlineLabel({dueDate:"2026-10-09",dueTime:"10:00"})'),"明天 10:00");
assert.equal(run('taskCategoryValue({category:"家校沟通"})'),"家校沟通","reference categories must persist");
assert.deepEqual(Array.from(run('taskReminders().map(t=>t.id)')),["yesterday","due-open","future"],"reminders are ordered by deadline");
run('taskCompletePage(true)');
assert.equal(context.taskRecords.filter(t=>t.status==="已完成").length,4,"page checkbox marks all visible work complete");
assert.equal(run('taskSummary().completionRate'),100);
context.window.__WORKBENCH_READ_ONLY__=true;
run('taskToggleDone("due-done",false)');
assert.equal(context.taskRecords.find(t=>t.id==="due-done").status,"已完成","viewer cannot reopen tasks");
context.window.__WORKBENCH_READ_ONLY__=false;
run('taskToggleDone("due-done",false)');
assert.equal(context.taskRecords.find(t=>t.id==="due-done").status,"待处理");
context.taskRecords=Array.from({length:12},(_,i)=>({id:"page-"+i,title:"分页待办",status:"待处理",dueDate:today,repeat:"无"}));
run('taskCompletePage(true)');
assert.equal(context.taskRecords.filter(t=>t.status==="已完成").length,10,"page completion must leave the next page untouched");
context.taskRecords=[{id:"batch-repeat",title:"周期回访",status:"待处理",dueDate:today,repeat:"每周"},{id:"batch-once",title:"普通工作",status:"待处理",dueDate:today,repeat:"无"}];
run('taskCompletePage(true)');
assert.equal(context.taskRecords.filter(t=>t.status==="已完成").length,2);
assert.equal(context.taskRecords.filter(t=>t.status==="待处理"&&t.repeatSourceId==="batch-repeat").length,1,"batch completion creates one pending successor without completing it");
context.taskRecords=[{id:"save-failed",title:"保存失败",status:"待处理",dueDate:today,repeat:"每周"}];
context.persistTasks=()=>{throw new Error("simulated storage failure");};
run('taskCompletePage(true)');
assert.equal(context.taskRecords.length,1,"failed page save must roll back a newly generated successor");
assert.equal(context.taskRecords[0].status,"待处理","failed page save must roll back completion");
console.log("qa-tasks: passed (legacy values, deadlines, recurrence, filters, daily stats, reminders, page completion, read-only guard)");
