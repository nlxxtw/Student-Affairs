"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const Integrity = require(path.join(root, "student-link-integrity.js"));

const students = [
  { id: "20260001", name: "测试甲", dept: "信息学院", major: "计算机", grade: "2026级", cls: "计算机2601", status: "在校生" },
  { id: "20260002", name: "测试乙", dept: "外语学院", major: "英语", grade: "2025级", cls: "英语2501", status: "休学" },
  { id: "20260003", name: "同名学生", dept: "信息学院", major: "软件工程", grade: "2026级", cls: "软件2601", status: "退学" },
  { id: "20260004", name: "同名学生", dept: "信息学院", major: "网络工程", grade: "2026级", cls: "网络2601", status: "在校生" }
];

const fields = [
  { key: "sid", label: "学号" }, { key: "name", label: "姓名" },
  { key: "dept", label: "学院" }, { key: "major", label: "专业" },
  { key: "grade", label: "年级" }, { key: "cls", label: "班级" }
];

const result = Integrity.reconcileImportRows([
  { sid: "20260002", name: "", dept: "", major: "", grade: "", cls: "" },
  { sid: "", name: "测试甲", dept: "错误学院", major: "", grade: "", cls: "" },
  { sid: "20260001", name: "测试乙", dept: "", major: "", grade: "", cls: "" },
  { sid: "", name: "同名学生", dept: "", major: "", grade: "", cls: "" },
  { sid: "99999999", name: "不存在", dept: "", major: "", grade: "", cls: "" }
], fields, students);

assert.strictEqual(result.accepted.length, 0, "only an exact student-number/name pair may pass without manual confirmation");
assert.strictEqual(result.rejected.length, 0, "identity mismatches must be handed to the confirmation dialog instead of blocking import");
assert.strictEqual(result.identityIssues.length, 5, "missing, conflicting, ambiguous and unknown identity pairs all require manual handling");
const resolved = Integrity.resolveIdentityIssues(result, {
  0: "sid", 1: "name", 2: "name", 3: "original", 4: "original"
});
assert.strictEqual(resolved.accepted.length, 5, "every identity issue may continue importing after an explicit manual choice");
assert.deepStrictEqual(resolved.accepted[0], {
  sid: "20260002", name: "测试乙", dept: "外语学院", major: "英语", grade: "2025级", cls: "英语2501"
}, "a non-active student must be matched and empty basic fields must be filled from the master record");
assert.strictEqual(resolved.accepted[1].sid, "20260001", "a unique exact name may fill the missing student number only after confirmation");
assert.strictEqual(resolved.accepted[1].dept, "信息学院", "confirmed master-data correction must update the basic fields");
assert.strictEqual(resolved.accepted[2].sid, "20260002", "a true identity conflict must allow the operator to choose the name-matched student");
assert.ok(resolved.corrections.some(item => item.field === "学院" && item.before === "错误学院" && item.after === "信息学院"));
assert.ok(result.identityIssues.some(item => /同名/.test(item.reason)), "ambiguous names must be shown for manual handling");
assert.ok(result.identityIssues.some(item => /学生管理/.test(item.reason)), "missing students must be reported clearly");
assert.ok(result.identityIssues.some(item => /学号.*姓名.*不同学生/.test(item.reason)), "a pair that identifies different students must require manual handling");
const conflictIssueIndex = result.identityIssues.findIndex(item => /不同学生/.test(item.reason));
const bypass = Integrity.resolveIdentityIssues(result, {[conflictIssueIndex]: "original"});
assert.ok(bypass.rejected.some(item => /未选择有效学生/.test(item.reason)), "a conflicting identity must not accept a forged keep-original choice");
assert.ok(!fs.readFileSync(path.join(root, "app.js"), "utf8").includes("identityIssues.slice(0,100)"), "every identity issue must be rendered for manual review");

const correctedIdentity = Integrity.reconcileImportRows([
  { sid: "误填学号", name: "测试乙", dept: "", major: "", grade: "", cls: "" }
], fields, students);
assert.strictEqual(correctedIdentity.accepted.length, 0, "a unique name alone must not be accepted automatically");
const confirmedIdentity = Integrity.resolveIdentityIssues(correctedIdentity, {0:"name"});
assert.strictEqual(confirmedIdentity.accepted[0].sid, "20260002", "an unknown imported ID may be corrected after explicit confirmation");
assert.ok(confirmedIdentity.corrections.some(item => item.field === "学号" && item.before === "误填学号" && item.after === "20260002"));

const listResult = Integrity.reconcileImportRows([
  { "班级": "计算机2601", "旷课名单（学号，多个用顿号分隔）": "20260001、99999999" }
], ["班级", "旷课名单（学号，多个用顿号分隔）"], students);
assert.strictEqual(listResult.accepted.length, 1);
assert.strictEqual(listResult.accepted[0]["旷课名单（学号，多个用顿号分隔）"], "20260001", "unknown IDs in student lists must be removed while the valid row remains importable");
assert.strictEqual(listResult.rejectedReferences.length, 1);

const storage = {
  nnuzc_fund_records: JSON.stringify([{ sid: "20260001", value: 1 }, { sid: "gone", value: 2 }]),
  nnuzc_academic_terms: JSON.stringify([{ term: "2026-2027-1", data: [{ "学号": "gone", score: 50 }, { "学号": "20260002", score: 80 }] }]),
  nnuzc_checkclass: JSON.stringify([{ id: "record-1", absent: ["20260001", "gone"], late: ["gone"] }]),
  nnuzc_dorm_spatial_v1: JSON.stringify({ rooms: [{ id: "room-1" }], assignments: [{ id: "a1", studentId: "20260001" }, { id: "a2", studentId: "gone" }], leaders: [{ id: "l1", studentId: "gone" }], audit: [{ id: "audit-1", actionType: "CHECK_OUT", targetId: "gone" }, { id: "audit-room", actionType: "RESOURCE_UPDATE", targetId: "room-1" }] }),
  nnuzc_student_org_v1: JSON.stringify({ members: [{ studentId: "gone", name: "组织成员" }] }),
  nnuzc_custom_roster_v1: JSON.stringify({ version: 2, activeId: "one", datasets: [{ id: "one", state: { rows: [{ id: "custom-1", values: { studentNo: "gone", name: "自定义学生" } }] } }] })
};
const scan = Integrity.scanOrphanStorage(storage, students);
assert.strictEqual(scan.total, 8, "orphan records, spatial relations, custom-roster rows and scalar student references must be counted");
assert.ok(!scan.datasets.some(item => item.key === "nnuzc_student_org_v1"), "student organization data must be excluded");
assert.ok(scan.datasets.some(item => item.key === "nnuzc_custom_roster_v1"), "custom roster student rows must be checked like other student business data");
const pruned = Integrity.pruneOrphanStorage(storage, students);
assert.strictEqual(pruned.total, 8);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_fund_records), [{ sid: "20260001", value: 1 }]);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_academic_terms)[0].data, [{ "学号": "20260002", score: 80 }]);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_checkclass)[0].absent, ["20260001"]);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_checkclass)[0].late, []);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_dorm_spatial_v1).assignments.map(item => item.id), ["a1"]);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_dorm_spatial_v1).leaders, []);
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_dorm_spatial_v1).audit.map(item => item.id), ["audit-room"], "room/building/bed audit targets must never be mistaken for student IDs");
assert.deepStrictEqual(JSON.parse(pruned.values.nnuzc_custom_roster_v1).datasets[0].state.rows, []);
assert.strictEqual(pruned.values.nnuzc_student_org_v1, undefined, "excluded storage must never be rewritten");

const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const customRoster = fs.readFileSync(path.join(root, "custom-roster-module.js"), "utf8");
assert.ok(index.includes('/student-link-integrity.js'), "the integrity module must load before app.js");
assert.ok(index.indexOf('/student-link-integrity.js') < index.indexOf('/app.js'));
for (const marker of [
  "studentLinkConfirmImport", "reconcileImportRows", "本次未导入", "studentIntegrityCheckAfterUpdate",
  "继续保留数据", "删除数据", "nnuzc_student_integrity_review_version"
]) assert.ok(app.includes(marker), `missing app integration marker: ${marker}`);
assert.ok(!/onCampusIds\.has\(sid\)/.test(app), "dorm imports must accept every status present in student management");
for (const marker of ["reconcileStudentRows", "StudentLinkIntegrity.reconcileImportRows", "studentLinkConfirmImport", "全部学籍状态"])
  assert.ok(customRoster.includes(marker), `custom roster is missing student-master enforcement: ${marker}`);
assert.ok(!customRoster.includes("本页数据不与学生管理、宿舍管理或学生画像同步"), "custom roster copy must not claim that student-master validation is disabled");

console.log("qa-student-link-integrity: passed (all statuses, autofill, mismatch correction, ambiguity, missing-row skip, update orphan choices)");
