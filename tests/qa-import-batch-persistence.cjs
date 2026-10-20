"use strict";

// Production import functions, synthetic records, memory-only storage: no HTTP,
// database, account or real student data is touched by this regression test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const growth = fs.readFileSync(path.join(__dirname, "..", "counselor-growth-module.js"), "utf8");
function chunk(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing production code: ${start}`);
  return app.slice(a, b);
}
function memory() {
  const store = new Map(), writes = new Map();
  let bytes = 0,failKey='';
  return {
    store, writes,
    localStorage: {
      getItem: key => store.get(key) || null,
      setItem(key, value) { if(key===failKey){failKey='';throw Error('simulated save failure');}writes.set(key, (writes.get(key) || 0) + 1); bytes += Buffer.byteLength(String(value)); store.set(key, String(value)); },
      removeItem: key => store.delete(key)
    },
    reset() { writes.clear(); bytes = 0; },
    metrics() { return { writes: Object.fromEntries(writes), serializedBytes: bytes }; },
    count: key => writes.get(key) || 0
    ,failNext(key){failKey=key;}
  };
}
const failures = [];
function scenario(name, work) {
  try { work(); console.log(`${name}: passed`); }
  catch (error) { failures.push(`${name}: ${error.message}`); console.error(`${name}: ${error.message}`); }
}

scenario("fund imports coalesce 2000 rows while single entry still persists immediately", () => {
  const mem = memory(), term = "2026-2027-1";
  const students = Array.from({ length: 2000 }, (_, i) => ({ id: `SYNTH-FUND-${i + 1}`, name: `合成学生${i + 1}`, cls: "合成班级", fund: {} }));
  let wizard, spatialSyncs = 0;
  const c = {
    students, fundRecords: [], CURRENT_TERM: term, viewTerm: { fund: term },
    FUND_DATA_HEADERS: ["学号", "是否贫困生", "困难评定等级", "国家助学金"],
    window: { fundTerms: [{ id: 1, term }], fundTermSeq: 1, __DORM_SPATIAL__: { onStudentDataChanged() { spatialSyncs++; } } },
    localStorage: mem.localStorage, lockedImportTerm: value => value,
    getTermList: () => [term], sortTermsDesc: list => list.slice().sort((a, b) => String(b.term || b).localeCompare(String(a.term || a))),
    classOfficerAutoEndNonCampus() {}, sortWorkbenchCollections() {}, saveFundTerms() {},
    reportDataError(label, error) { throw new Error(`${label}: ${error.message}`); },
    showToast() {}, openMappedImportWizard(value) { wizard = value; }
  };
  vm.createContext(c);
  for (const code of [
    chunk("function normalizeFundLevel(v){", "window.applyFundRecord="),
    chunk("function persistFund(){", "/* ===== 资助情况：模块内学期列表"),
    chunk("function ensureFundTerm(term){", "const DORM_DIST_KEY="),
    chunk("function persistStudents(){", "window.persistStudents="),
    chunk("function fundImport(targetTerm){", "function fundImportTemplate(){")
  ]) vm.runInContext(code, c);
  const values = { isPoor: true, poorLevel: "一般困难", national: true, college: false, nationalMotivational: false, collegeMotivational: false, temporaryAid: false, other: "—" };
  c.applyFundRecord(students[0].id, students[0].name, "", "", students[0].cls, term, { ...values });
  assert.equal(mem.count("nnuzc_fund_records"), 1);
  assert.equal(mem.count("nnuzc_students"), 1);
  assert.equal(spatialSyncs, 1);
  c.fundImport(term);
  const rows = students.map(s => ({ "学号": s.id, "是否贫困生": "是", "困难评定等级": "一般困难", "国家助学金": "是" }));
  const validated = wizard.validate(rows);
  assert.equal(validated.errors.length, 0);
  mem.reset(); spatialSyncs = 0;
  const start = performance.now(), result = wizard.apply(validated.ok);
  console.log("fund batch metrics:", JSON.stringify({ rows: rows.length, elapsedMs: Math.round(performance.now() - start), spatialSyncs, ...mem.metrics() }));
  assert.equal(result.ok, 2000);
  assert.equal(c.fundRecords.length, 2000);
  assert.equal(students.filter(s => s.fund.term === term && s.fund.national === true).length, 2000);
  assert.equal(JSON.parse(mem.store.get("nnuzc_fund_records")).length, 2000);
  assert.ok(mem.count("nnuzc_fund_records") <= 1, "fund batch must persist the full ledger at most once");
  assert.ok(mem.count("nnuzc_students") <= 1, "fund batch must persist student profiles at most once");
  assert.ok(spatialSyncs <= 1, "fund batch must not rescan accommodation for each student");
  mem.reset(); spatialSyncs = 0;
  wizard.apply(validated.ok);
  assert.equal(c.fundRecords.length, 2000, "reimport updates matching identities without adding duplicate fund records");
  assert.ok(mem.count("nnuzc_fund_records") <= 1);
  assert.equal(mem.count("nnuzc_students"), 0, "unchanged fund profiles do not rewrite students");
  assert.equal(spatialSyncs, 0);
  const older='2025-2026-2';c.getTermList=()=>[term,older];
  c.runFundRecordBatch(()=>{
    c.applyFundRecord(students[0].id,students[0].name,'','',students[0].cls,older,{...values,national:false});
    c.applyFundRecord(students[0].id,students[0].name,'','',students[0].cls,term,{...values});
    c.applyFundRecord(students[0].id,students[0].name,'','',students[0].cls,older,{...values,national:false});
  });
  assert.equal(students[0].fund.term,term,'out-of-order historical imports do not replace the newest term profile');
  assert.equal(students[0].fund.national,true);
  const beforeStudents=mem.store.get('nnuzc_students'),beforeRecords=mem.store.get('nnuzc_fund_records');
  mem.failNext('nnuzc_fund_records');
  assert.throws(()=>wizard.apply([{...validated.ok[0],'国家助学金':'否'}]),/simulated save failure/);
  assert.equal(mem.store.get('nnuzc_students'),beforeStudents,'failed fund batch restores student profiles');
  assert.equal(mem.store.get('nnuzc_fund_records'),beforeRecords,'failed fund batch restores ledger');
  assert.equal(c.applyFundRecord.context,null,'failed batch does not leak its indexes');
});

scenario("growth imports coalesce records and retain the latest 300 audit entries", () => {
  const mem = memory(), RECORD = "nnuzc_counselor_growth_records_v1", HISTORY = "nnuzc_counselor_growth_history_v1";
  let wizard;
  const c = {
    window: { addEventListener() {} }, PAGES: {}, localStorage: mem.localStorage,
    openMappedImportWizard(value) { wizard = value; }, renderPage() {}, showToast() {},
    fmtNow: () => "2026-10-16 12:00:00", beijingIsoDate: () => "2026-10-16"
  };
  vm.createContext(c); vm.runInContext(growth, c);
  c.window.counselorGrowthOpenImport();
  const rows = Array.from({ length: 2000 }, (_, i) => ({ typeLabel: "个人获奖", title: `合成成果${String(i + 1).padStart(4, "0")}`, level: "校级", resultDate: "2026-10-16", organization: "合成单位" }));
  const checked = wizard.validate(rows);
  assert.equal(checked.errors.length, 0);
  mem.reset();
  const start = performance.now(), result = wizard.apply(checked.ok, { mode: "skip" });
  console.log("growth batch metrics:", JSON.stringify({ rows: rows.length, elapsedMs: Math.round(performance.now() - start), ...mem.metrics() }));
  assert.equal(result.ok, 2000);
  const saved = JSON.parse(mem.store.get(RECORD)), history = JSON.parse(mem.store.get(HISTORY));
  assert.equal(saved.length, 2000);
  assert.equal(new Set(saved.map(r => r.title)).size, 2000);
  assert.equal(history.length, 300);
  assert.equal(history[0].title, "合成成果2000");
  assert.equal(history.at(-1).title, "合成成果1701");
  assert.equal(mem.count(RECORD), 1, "growth records persist once after import");
  assert.equal(mem.count(HISTORY), 1, "growth audit history persists once after import, retaining individual audit entries");
  mem.reset();
  const skipped = wizard.apply(checked.ok, { mode: "skip" });
  assert.equal(skipped.ok, 0);
  assert.equal(skipped.skip, 2000);
  assert.equal(JSON.parse(mem.store.get(RECORD)).length, 2000);
  assert.equal(mem.count(HISTORY), 0, "skipped duplicates do not generate or rewrite audit history");
  assert.ok(mem.count(RECORD) <= 1, "a duplicate-only import never rewrites per row");
  // Single-row interactive actions must keep their immediate audit persistence.
  mem.reset();
  c.window.counselorGrowthToggleRepresentative(saved[0].id);
  assert.equal(mem.count(RECORD), 1);
  assert.equal(mem.count(HISTORY), 1);
  assert.equal(JSON.parse(mem.store.get(RECORD)).find(r => r.id === saved[0].id).representative, true);
  assert.equal(JSON.parse(mem.store.get(HISTORY)).length, 300);
  const beforeRecords=mem.store.get(RECORD),beforeHistory=mem.store.get(HISTORY);
  mem.failNext(HISTORY);
  assert.throws(()=>wizard.apply([{...checked.ok[0],title:'合成保存失败样本'}],{mode:'skip'}),/simulated save failure/);
  assert.equal(mem.store.get(RECORD),beforeRecords,'failed growth batch restores records');
  assert.equal(mem.store.get(HISTORY),beforeHistory,'failed growth batch restores audit history');
});

assert.deepEqual(failures, [], failures.join("\n"));
console.log("qa-import-batch-persistence: passed (2000 fund/growth rows, bounded saves, no duplicate records, latest 300 audits, immediate single writes)");
