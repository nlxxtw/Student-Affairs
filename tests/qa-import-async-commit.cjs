"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const code = source.slice(source.indexOf("function openMappedImportWizard(options){"), source.indexOf("function directImportApplySpecial(type, rows){"));
const body = { innerHTML: "" }, foot = { innerHTML: "" };
let resolveSave, commits = 0, done = 0;
const ctx = { window: {}, document: { getElementById: id => id === "modalBody" ? body : id === "modalFoot" ? foot : null }, MAPPED_IMPORT_FIELD_ALIASES: {},
  esc: String, attr: String, smartHeader: String, importWizardSteps: () => "", openModal() {}, showToast() {},
  importConfirmApproximateMatches: async () => ({confirmed:true}),
  parseWorkbookToRows: async () => [{ "资源": "A" }], importWizardToRows: rows => rows, importEnumRows: () => [] };
vm.createContext(ctx); vm.runInContext(code, ctx);
(async () => {
  let finishRead,reads=0;
  ctx.parseWorkbookToRows=()=>{reads++;return new Promise(resolve=>{finishRead=resolve;});};
  ctx.openMappedImportWizard({name:'读取保护',fields:['资源'],file:{name:'a.csv',size:1}});
  const reading=ctx.window.mappedImportNext(),repeated=ctx.window.mappedImportNext();
  assert.strictEqual(reads,1,'reading the same file must not start twice');
  finishRead([{'资源':'A'}]);await Promise.all([reading,repeated]);
  assert.match(body.innerHTML,/数据预览/,'repeated next during read must not skip preview');
  ctx.openMappedImportWizard({name:'读取失败重试',fields:['资源'],file:{name:'a.csv',size:1}});
  ctx.parseWorkbookToRows=async()=>{throw Error('read rejected');};await ctx.window.mappedImportNext();
  ctx.parseWorkbookToRows=async()=>[{'资源':'A'}];
  await ctx.window.mappedImportNext();assert.match(body.innerHTML,/数据预览/,'read failure must release the next-step lock');
  ctx.parseWorkbookToRows=()=>new Promise(resolve=>{finishRead=resolve;});
  ctx.openMappedImportWizard({name:'旧向导',fields:['资源'],file:{name:'old.csv',size:1}});const staleRead=ctx.window.mappedImportNext();
  ctx.openMappedImportWizard({name:'新向导',fields:['新字段'],file:{name:'new.csv',size:1}});const newBody=body.innerHTML;
  finishRead([{'资源':'A'}]);await staleRead;assert.strictEqual(body.innerHTML,newBody,'old async wizard must not replace a newly opened wizard');
  ctx.parseWorkbookToRows=async()=>[{'资源':'A'}];
  let finishStaleSave,staleAfter=0;
  ctx.openMappedImportWizard({name:'旧保存',fields:['资源'],file:{name:'old.csv',size:1},apply:()=>new Promise(resolve=>{finishStaleSave=resolve;}),after:()=>{staleAfter++;}});
  await ctx.window.mappedImportNext();await ctx.window.mappedImportNext();await ctx.window.mappedImportNext();const staleSave=ctx.window.mappedImportCommit();
  ctx.openMappedImportWizard({name:'后续新导入',fields:['新字段'],file:{name:'new.csv',size:1}});const newSaveBody=body.innerHTML;
  finishStaleSave({ok:1});await staleSave;assert.strictEqual(body.innerHTML,newSaveBody,'old commit completion must not replace the new wizard');assert.strictEqual(staleAfter,0,'old commit must not navigate the newer wizard away');
  ctx.openMappedImportWizard({ name: "测试", fields: ["资源"], file: { name: "a.csv", size: 1 },
    apply: () => { commits++; return new Promise(resolve => { resolveSave = resolve; }); }, after: () => { done++; } });
  await ctx.window.mappedImportNext(); await ctx.window.mappedImportNext(); await ctx.window.mappedImportNext();
  const pending = ctx.window.mappedImportCommit();
  assert.strictEqual(done, 0, "do not show success before persistence resolves");
  await ctx.window.mappedImportCommit();
  assert.strictEqual(commits, 1, "double click must not duplicate the import");
  resolveSave({ ok: 1, skip: 0 }); await pending;
  assert.strictEqual(done, 1); assert.match(body.innerHTML, /导入完成/);
  await ctx.window.mappedImportCommit(); assert.strictEqual(commits, 1, "completed import must not run again");
  let fail = true;
  ctx.openMappedImportWizard({ name: "保存失败", fields: ["资源"], file: { name: "a.csv", size: 1 },
    apply: async () => { if (fail) throw Error("save rejected"); return { ok: 1 }; }, after: () => { done++; } });
  await ctx.window.mappedImportNext(); await ctx.window.mappedImportNext(); await ctx.window.mappedImportNext();
  await ctx.window.mappedImportCommit();
  assert.strictEqual(done, 1); assert.doesNotMatch(body.innerHTML, /导入完成/);
  fail = false; await ctx.window.mappedImportCommit(); assert.strictEqual(done, 2);
  console.log("Mapped import guards repeated reads, retries failed reads, waits for async persistence and blocks duplicate commits.");
})().catch(error => { console.error(error); process.exitCode = 1; });
