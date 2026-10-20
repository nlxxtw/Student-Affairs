"use strict";

// Executes production accommodation and spatial code in a VM with synthetic
// students and an in-memory localStorage. No server, account or database is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const baseline=process.argv.includes('--baseline');
const sourceFile=name=>baseline?path.join(__dirname,'../docs/宿舍批量导入-修改前-2026-10-16',name+'.before'):path.join(__dirname,'..',name);
const app = fs.readFileSync(sourceFile("app.js"), "utf8");
const spatial = fs.readFileSync(sourceFile("dorm-spatial-module.js"), "utf8");

function chunk(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing production code: ${start}`);
  return app.slice(a, b);
}

const count = {
  stringify: 0, serializedBytes: 0, studentSerializations: 0,
  recordSerializations: 0, spatialSerializations: 0,
  studentWrites: 0, recordWrites: 0, spatialWrites: 0,
  spatialSnapshots: 0, studentSync: 0, accommodationSync: 0,
  collectionSorts: 0, renders: 0, confirmations: 0
};
const store = new Map(), errors = [];
const students = Array.from({ length: 2000 }, (_, i) => ({
  id: `PERF-DORM-${String(i + 1).padStart(5, "0")}`,
  name: `合成学生${i + 1}`, status: "在校生", cls: "性能测试班",
  dept: "合成学院", major: "合成专业", grade: "2026"
}));
const rows = students.map((student, i) => ({
  "学号": student.id, "住宿情况": "校内", "区位": `测试区${Math.floor(i / 1000) + 1}`,
  "宿舍楼": `合成楼${Math.floor(i / 200) + 1}`,
  "房间号": String(101 + Math.floor((i % 200) / 4)), "床位号": String(i % 4 + 1)
}));
const context = {
  students, dormDistRecords: [], ORG_DORMS: [], currentView: "student", window: {},
  isOnCampusStudent: s => s.status === "在校生", classGrade: () => "2026",
  showToast() {}, reportDataError(label, error) { errors.push(`${label}: ${error.message || error}`); },
  saveOrgs() {}, classOfficerAutoEndNonCampus() {},
  sortWorkbenchCollections() { count.collectionSorts++; students.sort((a, b) => a.id.localeCompare(b.id)); },
  renderPage() { count.renders++; },
  confirm() { count.confirmations++; return true; },
  localStorage: {
    getItem(key) { return store.get(key) || null; },
    setItem(key, value) {
      if (key === "nnuzc_students") count.studentWrites++;
      if (key === "nnuzc_dorm_dist") count.recordWrites++;
      if (key === "nnuzc_dorm_spatial_v1") count.spatialWrites++;
      store.set(key, String(value));
    },
    removeItem(key) { store.delete(key); }
  },
  JSON: {
    parse: JSON.parse,
    stringify(value, ...args) {
      count.stringify++;
      if (value === students) count.studentSerializations++;
      if (value === context.dormDistRecords) count.recordSerializations++;
      if (value && !Array.isArray(value) && Array.isArray(value.rooms) && Array.isArray(value.assignments)) count.spatialSerializations++;
      const encoded = JSON.stringify(value, ...args);
      count.serializedBytes += encoded ? Buffer.byteLength(encoded, "utf8") : 0;
      return encoded;
    }
  }
};
vm.createContext(context);
for (const code of [
  chunk("function dormDistributionRecord(studentId){", "function syncDormBuildingZone(building,zone){"),
  chunk("function dormDistributionRow(student){", "function dormDistRows(){"),
  chunk("function persistDormDist(){", "function persistFund(){"),
  chunk("function persistStudents(){", "window.persistStudents="),
  chunk("function applyDormDistribution(id, fields){", "window.applyDormDistribution="),
  chunk("function dormMutationSnapshot(){", "window.dormImportApplyRows="),
  chunk("function dormImportValidate(rows){", "async function dormImportApply(){")
]) vm.runInContext(code, context);
vm.runInContext(spatial, context);
const api = context.window.__DORM_SPATIAL__;
for (const [method, metric] of [["getState", "spatialSnapshots"], ["onStudentDataChanged", "studentSync"], ["onAccommodationChanged", "accommodationSync"]]) {
  const original = api[method];
  api[method] = function (...args) { count[metric]++; return original.apply(this, args); };
}
context.__importRows = rows;
let executionError;
const started = performance.now();
try {
  // A safety bound prevents the regressed quadratic path from wedging the test
  // runner. Correctness gates below use deterministic bulk-work counts, not a
  // fragile millisecond benchmark dependent on the developer's computer.
  vm.runInContext("__importResult=dormImportApplyRows(__importRows)", context, { timeout: 15000 });
} catch (error) { executionError = error; }
const elapsedMs = Math.round(performance.now() - started);
console.log("qa-dorm-import-performance metrics:", JSON.stringify({ rows: rows.length, elapsedMs, ...count }));
assert.ifError(executionError);
assert.deepEqual(errors, [], "the import must not hide persistence or synchronization failures");
assert.equal(context.__importResult.failed, false);
assert.equal(context.__importResult.ok, 2000);
assert.equal(context.__importResult.addedRooms, 500);
assert.equal(count.confirmations, 1, "one confirmation covers all automatically created resources");
const result = api.getState();
assert.equal(result.buildings.length, 10);
assert.equal(result.rooms.length, 500);
assert.equal(result.assignments.filter(item => item.status === "current").length, 2000);
assert.equal(new Set(result.assignments.filter(item => item.status === "current").map(item => `${item.roomId}/${item.bedNo}`)).size, 2000, "each imported student occupies one distinct bed");
assert.equal(context.dormDistRecords.length, 2000);
for (const row of rows) {
  const student = students.find(item => item.id === row["学号"]);
  const record = context.dormDistRecords.find(item => item.studentId === student.id);
  for (const [column, property] of [["区位", "zone"], ["宿舍楼", "building"], ["房间号", "room"], ["床位号", "bed"]]) {
    assert.equal(student[property], row[column]);
    assert.equal(record[property], row[column]);
  }
}
for (const [key, limit] of Object.entries({
  studentWrites: 3, recordWrites: 3, spatialWrites: 4, spatialSnapshots: 8,
  studentSync: 2, accommodationSync: 2, collectionSorts: 3,
  studentSerializations: 6, recordSerializations: 6, spatialSerializations: 12
})) assert.ok(count[key] <= limit, `${key}=${count[key]} exceeds the batch budget ${limit}; full collections must not be copied/saved/synchronized once per imported student or room`);
assert.equal(JSON.parse(store.get("nnuzc_students")).length, 2000);
assert.equal(JSON.parse(store.get("nnuzc_dorm_dist")).length, 2000);
assert.equal(JSON.parse(store.get("nnuzc_dorm_spatial_v1")).assignments.filter(item => item.status === "current").length, 2000);
console.log("qa-dorm-import-performance: passed (2000 synthetic residents, 500 auto-created rooms, bounded whole-store work, matching persisted projections)");
