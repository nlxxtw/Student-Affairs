"use strict";

const assert = require("node:assert/strict");
const partyImport = require("../party-import-engine.js");

const sourceStudents = [
  {
    id: "001234",
    name: "张同学",
    political: "群众",
    phone: "13800000000",
    customFieldValues: { retained: "保留" },
    party: {
      stage: "群众",
      leagueStatus: "非团员",
      date: "2024-09-01",
      branch: "",
      introducer: "赵老师",
      history: [{ stage: "群众", date: "2024-09-01", note: "原始节点" }]
    }
  },
  { id: "009999", name: "李同学", political: "共青团员", party: { stage: "共青团员", leagueStatus: "团员", history: [] } },
  { id: "no-party", name: "王同学", political: "群众" }
];

assert.deepEqual(partyImport.PARTY_STAGES, ["群众", "共青团员", "递交入党申请书", "入党积极分子", "发展对象", "中共预备党员", "中共党员"]);
assert.deepEqual(partyImport.PARTY_LEAGUE_STATUSES, ["团员", "非团员", "已推优", "保留团员的中共党员", "退团"]);
assert.deepEqual(partyImport.POLITICAL_OPTIONS, ["中共党员", "中共预备党员", "共青团员", "群众", "其他民主党派"]);
assert.deepEqual(partyImport.PARTY_TRAINING_LEVELS, ["初级党课", "中级党课", "高级党课"]);
assert.deepEqual(partyImport.PARTY_TRAINING_STATUSES, ["未参加", "培训中", "已结业", "未通过"]);
assert.equal(partyImport.IMPORT_FIELDS[0].key, "sid");
assert.equal(partyImport.IMPORT_FIELDS[0].required, true);
assert.ok(partyImport.IMPORT_FIELDS.some(field => field.key === "primaryTrainingStatus" && field.label === "初级党课状态"));

const prepared = partyImport.prepareImport([
  {
    sid: "001234",
    name: "张同学",
    political: "共青团员",
    leagueStatus: "已推优",
    stage: "入党积极分子",
    date: "2026/10/13",
    branch: "学生第一党支部",
    contact: "王老师",
    introducer: "",
    materials: "材料齐全",
    note: "本次导入",
    primaryTrainingStatus: "已结业",
    primaryTrainingDate: "2026/09/15",
    primaryTrainingOrganizer: "学院党校",
    primaryTrainingResult: "优秀",
    intermediateTrainingStatus: "培训中",
    intermediateTrainingDate: "2026-10-01"
  }
], sourceStudents);

assert.deepEqual(prepared.errors, []);
assert.equal(prepared.validRows.length, 1);
assert.equal(prepared.validRows[0].date, "2026-10-13");
assert.equal(prepared.students[0].political, "共青团员");
assert.equal(prepared.students[0].phone, "13800000000", "unrelated student fields must be preserved");
assert.deepEqual(prepared.students[0].customFieldValues, { retained: "保留" });
assert.equal(prepared.students[0].party.stage, "入党积极分子");
assert.equal(prepared.students[0].party.leagueStatus, "已推优");
assert.equal(prepared.students[0].party.branch, "学生第一党支部");
assert.equal(prepared.students[0].party.introducer, "赵老师", "blank optional cells must not erase existing values");
assert.equal(prepared.students[0].party.history.length, 2);
assert.equal(prepared.students[0].party.history[1].stage, "入党积极分子");
assert.deepEqual(prepared.students[0].party.training.primary, { status: "已结业", date: "2026-09-15", organizer: "学院党校", result: "优秀" });
assert.deepEqual(prepared.students[0].party.training.intermediate, { status: "培训中", date: "2026-10-01", organizer: "", result: "" });
assert.equal(prepared.students[0].party.training.advanced.status, "未参加");

const repeated = partyImport.prepareImport([prepared.validRows[0]], prepared.students);
assert.deepEqual(repeated.errors, []);
assert.equal(repeated.students[0].party.history.length, 2, "re-importing the same stage must update instead of duplicate");

const resetTraining = partyImport.prepareImport([{ sid: "001234", primaryTrainingStatus: "未参加" }], prepared.students);
assert.deepEqual(resetTraining.errors, []);
assert.deepEqual(resetTraining.students[0].party.training.primary, { status: "未参加", date: "", organizer: "", result: "" }, "not-attended status must clear stale training details");

const derivedStage = partyImport.prepareImport([{ sid: "no-party", branch: "学生第二党支部" }], sourceStudents);
assert.deepEqual(derivedStage.errors, []);
assert.equal(derivedStage.students[2].party.stage, "群众", "node details must use the current stage shown by the ledger");
assert.equal(derivedStage.students[2].party.branch, "学生第二党支部");
assert.equal(derivedStage.students[2].party.history.length, 1);

const invalid = partyImport.prepareImport([
  { sid: "001234", name: "其他人", political: "党员", leagueStatus: "正式团员", stage: "预备党员", date: "2026-02-30" },
  { sid: "001234", stage: "群众" },
  { sid: "not-found", stage: "群众" },
  { sid: "009999", branch: { unsafe: true } },
  { sid: "009999", primaryTrainingStatus: "通过" },
  { sid: "009999", primaryTrainingStatus: "未参加", primaryTrainingDate: "2026-10-01" },
  { sid: "009999", advancedTrainingDate: "2026-02-30" },
  { sid: "009999" }
], sourceStudents);
assert.equal(invalid.validRows.length, 0, "any invalid row blocks the whole batch");
assert.ok(invalid.errors.some(error => /姓名/.test(error.msg)));
assert.ok(invalid.errors.some(error => /政治面貌/.test(error.msg)));
assert.ok(invalid.errors.some(error => /团员身份/.test(error.msg)));
assert.ok(invalid.errors.some(error => /当前发展阶段/.test(error.msg)));
assert.ok(invalid.errors.some(error => /日期/.test(error.msg)));
assert.ok(invalid.errors.some(error => /重复/.test(error.msg)));
assert.ok(invalid.errors.some(error => /不存在/.test(error.msg)));
assert.ok(invalid.errors.some(error => /文本/.test(error.msg)));
assert.ok(invalid.errors.some(error => /初级党课状态/.test(error.msg)));
assert.ok(invalid.errors.some(error => /高级党课日期/.test(error.msg)));
assert.ok(invalid.errors.some(error => /至少填写一个/.test(error.msg)));
assert.deepEqual(sourceStudents[0].party.history, [{ stage: "群众", date: "2024-09-01", note: "原始节点" }], "validation must not mutate source data");

assert.throws(() => partyImport.prepareImport(new Array(2001).fill({ sid: "001234", stage: "群众" }), sourceStudents), /2000/);
assert.throws(() => partyImport.prepareImport([], { not: "students" }), /学生数据/);

console.log("qa-party-import: passed (schema, enums, dates, identities, preservation, deduplication, limits)");
