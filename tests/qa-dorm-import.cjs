"use strict";

// Execute the production import functions against an in-memory store. Never open
// the production database, use real students, or change a device activation.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
function chunk(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing production function: ${start}`);
  return source.slice(a, b);
}
const copy = value => JSON.parse(JSON.stringify(value));
const students = Array.from({ length: 103 }, (_, i) => ({ id: `DORM-QA-${i}`, name: `测试学生${i}`, status: "在校生", cls: "测试班" }));
let resources = { settings: { maxBedCount: 30 }, rooms: [] }, confirmations = 0, writes = 0, options;
const context = {
  students, dormDistRecords: [], ORG_DORMS: [],
  isOnCampusStudent: student => student.status === "在校生",
  classGrade: () => "", dormMasterData: () => null,
  ensureDormMasterData: (zone, building) => ({ zone, building }),
  showToast: () => {}, reportDataError: () => {}, saveOrgs: () => {},
  persistStudents: () => { writes++; }, persistDormDist: () => { writes++; },
  confirm: () => { confirmations++; return true; },
  openMappedImportWizard: config => { options = config; },
  window: { __DORM_SPATIAL__: {
    getState: () => copy(resources), restoreState: value => { resources = copy(value); },
    ensureRoom: (zone, building, room, bedHint) => {
      resources.rooms.push({ zone, building, room, bedCount: Math.max(4, bedHint), status: "active" }); return true;
    }, onAccommodationChanged: () => {}
  } }
};
context.dormDistributionRecord = id => context.dormDistRecords.find(row => row.studentId === id);
vm.createContext(context);
for (const code of [
  chunk("function dormDistributionRow(student){", "function dormDistRows(){"),
  chunk("function applyDormDistribution(id, fields){", "window.applyDormDistribution="),
  chunk("function dormMutationSnapshot(){", "window.dormImportApplyRows="),
  chunk("function dormImport(){", "function dormImportTemplate(){"),
  chunk("function dormImportValidate(rows){", "async function dormImportApply(){")
]) vm.runInContext(code, context);
context.dormImport();
assert.deepStrictEqual(Array.from(options.requiredFields), ["学号", "住宿情况"]);
assert.match(source, /if\(result\.cancelled\)\{if\(progress\)progress\.cancel\(\);return;\}/);
assert.match(source, /if\(result\.failed\)\{if\(progress\)progress\.fail/);


const screenshotRows = students.slice(0, 100).map(student => ({ "学号": student.id, "姓名": "", "住宿情况": "", "区位": "", "宿舍楼": "凤凰苑1#A", "房间号": "A319", "床位号": "" }));
const invalid = context.dormImportValidate(screenshotRows);
assert.strictEqual(invalid.ok.length, 0);
assert.strictEqual(invalid.errors.length, 100);
assert.strictEqual(invalid.errors[0].row, 2);
assert.match(invalid.errors[0].msg, /住宿情况为必填/);
const blocked = context.dormImportApplyRows(screenshotRows);
assert.strictEqual(blocked.failed, true);
assert.strictEqual(blocked.ok, 0);
assert.strictEqual(writes, 0);
assert.strictEqual(confirmations, 0);
assert.strictEqual(context.dormDistRecords.length, 0);
assert.strictEqual(resources.rooms.length, 0);

for (const [row, expected] of [
  [{ "学号": students[0].id }, /住宿情况为必填/],
  [{ "学号": students[0].id, "住宿情况": "   " }, /住宿情况为必填/],
  [{ "学号": students[0].id, "住宿情况": "校外" }, /只能为校内、租房或走读/],
  [{ "学号": students[0].id, "住宿情况": "校内", "楼栋": "A栋", "房间号": "101" }, /缺少床位号/],
  [{ "学号": students[0].id, "住宿情况": "校内", "床位号": "0" }, /大于 0 的整数/],
  [{ "学号": students[0].id, "住宿情况": "校内", "床位号": "1.5" }, /大于 0 的整数/],
  [{ "学号": students[0].id, "住宿情况": "走读", "房间号": "101" }, /不能同时填写校内宿舍位置/],
  [{ "学号": "missing", "住宿情况": "走读" }, /学号不存在/]
]) {
  const check = context.dormImportValidate([row]);
  assert.strictEqual(check.ok.length, 0);
  assert.match(check.errors[0].msg, expected);
}
students[102].status = "已毕业";
assert.strictEqual(context.dormImportValidate([{ "学号": students[102].id, "住宿情况": "走读" }]).errors.length,0,"all student statuses in student management must be eligible for accommodation imports");
const duplicate = { "学号": students[0].id, "住宿情况": "走读" };
assert.match(context.dormImportValidate([duplicate, duplicate]).errors[0].msg, /学号重复/);

const validRows = screenshotRows.map((row, i) => ({ ...row, "住宿情况": "校内", "房间号": `A${319 + Math.floor(i / 4)}`, "床位号": String(i % 4 + 1) }));
assert.strictEqual(context.dormImportValidate(validRows).errors.length, 0);
const imported = context.dormImportApplyRows(validRows);
assert.strictEqual(imported.ok, 100);
assert.strictEqual(imported.failed, false);
assert.strictEqual(imported.addedRooms, 25);
assert.strictEqual(confirmations, 1);
assert.strictEqual(context.dormDistRecords.filter(row => row.building && row.room && row.bed && row.accom === "校内").length, 100);
assert.strictEqual(students[0].building, "凤凰苑1#A");
assert.strictEqual(students[0].room, "A319");
assert.strictEqual(students[0].zone, "未分区");
assert.strictEqual(students[0].name, "测试学生0");

// Required means explicit input even when an existing student has housing.
const before = JSON.stringify({ students, records: context.dormDistRecords, resources });
assert.strictEqual(context.dormImportApplyRows([{ "学号": students[0].id, "房间号": "A999" }]).failed, true);
assert.strictEqual(JSON.stringify({ students, records: context.dormDistRecords, resources }), before);
assert.strictEqual(context.dormImportApplyRows([{ "学号": students[0].id, "住宿情况": "校内" }]).ok, 1);
assert.strictEqual(students[0].room, "A319", "existing optional fields should be retained");

const snapshot = JSON.stringify({ students, records: context.dormDistRecords, resources });
const conflicts = students.slice(100, 102).map(student => ({ "学号": student.id, "住宿情况": "校内", "楼栋": "冲突楼", "房间号": "101", "床位号": "1" }));
assert.strictEqual(context.dormImportApplyRows(conflicts).failed, true);
assert.strictEqual(JSON.stringify({ students, records: context.dormDistRecords, resources }), snapshot, "conflict must roll back records and auto-added resources");
for (const [student, accom] of [[students[0], "走读"], [students[1], "租房"]]) {
  assert.strictEqual(context.dormImportApplyRows([{ "学号": student.id, "住宿情况": accom }]).ok, 1);
  assert.strictEqual(student.accom, accom);
  assert.strictEqual(student.building, "");
}
console.log("qa-dorm-import: passed (100-row screenshot regression, required mapping/status, conditional housing fields, valid writes, existing data protection, conflict rollback)");
