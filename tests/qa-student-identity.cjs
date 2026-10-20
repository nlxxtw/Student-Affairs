"use strict";

const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
function chunk(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `missing production function: ${start}`);
  return source.slice(a, b);
}
const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const nodes = { "#fIdcard": { value: "", dataset: {}, title: "" }, "#fBirth": { value: "" }, "#fGender": { value: "" } };
const alerts = [], context = {
  beijingIsoDate: () => "2026-10-05", $: selector => nodes[selector],
  window: {}, students: [], esc: escape, escAttr: escape, attr: escape,
  stuPhotoSrc: () => "", stuIdPhotoSrc: () => "", stuStatusLabel: value => value || "在校生",
  alert: message => alerts.push(message), STU_GENDERS: ["男", "女"],
  STU_IMPORT_FIELDS: [["id", "学号", true], ["name", "姓名", true], ["cls", "班级", true], ["status", "学籍状态", true], ["idcard", "身份证号", false]],
  studentClassRecord: () => ({ name: "测试班" }), stuImportEnumIssues: () => [],
  importEnumRows: () => [], SMART_IMPORT_LABELS: { student: "学生管理" },
  smartCell: (row, keys) => String(keys.map(key => row[key]).find(value => value != null && value !== "") || ""),
  stuNormalizeStatus: value => value
};
vm.createContext(context);
for (const code of [
  chunk("function studentImportDate(value){", "function normalizeStudentImportRowByClass(row){"),
  chunk("function studentIdentityNumber(value){", "/* 选择班级 →"),
  chunk("function stuImportValidate(rows,mapping,mode){", "function stuImport(){"),
  chunk("function smartStudentFromRow(r){", "function smartImportApplyPlan(plan){"),
  chunk("function writeImportedRows(rows,mode){", "\nfunction "),
  chunk("function stuPhotoImportKey(value){", "function stuPhotoImportFileBase("),
  chunk("function stuDetailHTML(s,editable){", "function studentForm(s)"),
  chunk("function portraitArchiveValue(v){", "function portraitArchiveSection(")
]) vm.runInContext(code, context);
const serverSource=fs.readFileSync(path.join(__dirname,"..","web-server.js"),"utf8");
const autofillStart=serverSource.indexOf("function fillStudentIdentityBlanks("),autofillEnd=serverSource.indexOf("function backfillStudentIdentityBlanks(");
assert(autofillStart>=0&&autofillEnd>autofillStart);
vm.runInContext(serverSource.slice(autofillStart,autofillEnd),context);

function mainland(base) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return base + "10X98765432"[weights.reduce((sum, weight, i) => sum + Number(base[i]) * weight, 0) % 11];
}
const valid = [
  ["320101200601011235", "mainland", "大陆", "20060101", "男"],
  ["320101900101123", "mainlandLegacy", "大陆", "19900101", "男"],
  ["81000020060101123x", "residence", "香港", "20060101", ""],
  ["820000200601011223", "residence", "澳门", "20060101", ""],
  [mainland("83000020060101123"), "residence", "台湾", "20060101", ""],
  ["A123456(3)", "hongKong", "香港", "", ""],
  ["a1234563", "hongKong", "香港", "", ""],
  ["AB123456(9)", "hongKong", "香港", "", ""],
  ["A123456", "hongKong", "香港", "", ""],
  ["Ａ１２３４５６（３）", "hongKong", "香港", "", ""],
  ["1/234567/8", "macau", "澳门", "", ""],
  ["１２３４５６７（８）", "macau", "澳门", "", ""],
  ["52345678", "macau", "澳门", "", ""],
  ["7234567(8)", "macau", "澳门", "", ""],
  ["A123456789", "taiwan", "台湾", "", ""],
  [" a 123456789 ", "taiwan", "台湾", "", ""]
];
for (const [number, type, region, birth, gender] of valid) {
  const info = context.studentIdentityInfo(number);
  assert.ok(info, `valid number rejected: ${number}`);
  assert.deepStrictEqual([info.type, info.region, info.birth, info.gender], [type, region, birth, gender]);
  assert.match(context.studentIdentityTooltip(number), new RegExp(region));
  const student={idcard:number,birth:"",gender:""};context.fillStudentIdentityBlanks(student);
  assert.deepStrictEqual([student.birth,student.gender],[birth,gender],"server and frontend identity policy must agree");
}
const invalid = ["", "123", "320101200601011234", "810000200601011235", "A123456(7)", "AB123456(8)", "A123456(3", "A1234563)", "A123456(B)", "A12345678", "A123456788", "A323456789", "2/234567/8", "22345678", "1234567", "1//234567/8", "1/234567/88", "A123456(3)<img>",
  mainland("32010120060230123"), mainland("32010120270201123"), mainland("99010120060101123"), mainland("81000120060101123"), mainland("32010120060101000"), "320101900230123"];
for (const number of invalid) {
  assert.strictEqual(context.studentIdentityInfo(number), null, `invalid number accepted: ${number}`);
  const student={idcard:number,birth:"",gender:""};assert.strictEqual(context.fillStudentIdentityBlanks(student),false);assert.deepStrictEqual([student.birth,student.gender],["",""]);
}
const female={idcard:mainland("32010120060101122"),birth:"",gender:""};context.fillStudentIdentityBlanks(female);assert.deepStrictEqual([female.birth,female.gender],["20060101","女"]);
assert.match(context.studentIdentityTooltip("123"), /格式、出生日期或校验码不正确/);
assert.match(context.studentIdentityTooltip("12345678"), /澳门号码仅完成格式识别，未核验校验码/);
assert.match(context.studentIdentityTooltip("A123456"), /未提供香港校验位/);
assert.match(context.studentIdentityTooltip(""), /未填写/);

for (const [number, , region, expectedBirth, expectedGender] of valid) {
  nodes["#fBirth"].value = nodes["#fGender"].value = "";
  nodes["#fIdcard"].value = number;
  context.idcardAutoBirth();
  assert.strictEqual(nodes["#fBirth"].value, expectedBirth);
  assert.strictEqual(nodes["#fGender"].value, expectedGender);
  assert.match(nodes["#fIdcard"].title, new RegExp(region), "live input tooltip is stale");
}
nodes["#fIdcard"].value = "320101200601011235";
context.idcardAutoBirth();
nodes["#fIdcard"].value = "A123456(3)";
context.idcardAutoBirth();
assert.strictEqual(nodes["#fBirth"].value, "");
assert.strictEqual(nodes["#fGender"].value, "");
nodes["#fBirth"].value = "20000101"; nodes["#fGender"].value = "女";
nodes["#fIdcard"].value = "1/234567/8"; context.idcardAutoBirth();
assert.strictEqual(nodes["#fBirth"].value, "20000101", "manual birth must be retained for Macau");
assert.strictEqual(nodes["#fGender"].value, "女", "manual gender must be retained for Macau");
nodes["#fIdcard"].value = ""; context.idcardAutoBirth();
assert.match(nodes["#fIdcard"].title, /未填写/);
nodes["#fIdcard"].value="320101200601011235";nodes["#fBirth"].value="20000101";nodes["#fGender"].value="女";context.idcardAutoBirth();
assert.strictEqual(nodes["#fBirth"].value,"20000101","existing birth must not be overwritten");
assert.strictEqual(nodes["#fGender"].value,"女","existing gender must not be overwritten");

const rows = valid.map(([number], i) => ({ "学号": `QA-${i}`, "姓名": "测试学生", "班级": "测试班", "学籍状态": "在校生", "身份证号": number }));
const mapping = context.STU_IMPORT_FIELDS.map(([sysKey, sysLabel]) => ({ sysKey, sysLabel }));
assert.strictEqual(context.stuImportValidate(rows, mapping, "add").errors.length, 0);
const badRow = { ...rows[0], "身份证号": "A123456(7)" };
assert.match(context.stuImportValidate([badRow], mapping, "add").errors[0].field, /身份证号/);
assert.strictEqual(context.writeImportedRows([badRow], "add"), false, "low-level import must not bypass identity validation");
assert.strictEqual(context.students.length, 0);
assert.match(alerts[0], /身份证号码.*校验码不正确/);
const smartHead = chunk("function smartImportApplyPlan(plan){", "  const smartStatusBefore=") + "return {report,byType};}";
vm.runInContext(smartHead.replace("function smartImportApplyPlan", "function testSmartIdentityGuard"), context);
const smart = context.testSmartIdentityGuard([{ type: "student", records: [badRow, rows[0]] }]);
assert.strictEqual(smart.report.skip, 1);
assert.strictEqual(smart.byType.student.length, 1);
assert.match(smart.report.errors[0], /身份证号码.*校验码不正确/);

for (const [number, , region] of valid) {
  const student = { id: "QA", name: "测试学生", idcard: number };
  assert.match(context.stuDetailHTML(student, false), new RegExp('title="' + region));
  assert.match(context.portraitArchiveGrid([["身份证号", number]]), new RegExp('title="' + region));
}
assert.ok(!context.portraitArchiveGrid([["身份证号", '<img src=x onerror="alert(1)">']]).includes("<img"), "identity tooltip rendering must escape record contents");
assert.strictEqual(context.stuPhotoImportKey("1/234567/8"), context.stuPhotoImportKey("1234567（8）"));
assert.strictEqual(context.stuPhotoImportKey("Ａ１２３４５６（３）"), context.stuPhotoImportKey("a1234563"));
assert.match(source, /id="fIdcard"[^>]+title="\$\{escAttr\(studentIdentityTooltip\(s.idcard\)\)\}"/);
assert.match(source, /oninput="this.title=studentIdentityTooltip\(this.value\)"/);
console.log(`qa-student-identity: passed (${valid.length} valid and ${invalid.length} invalid formats, mainland/HK/Taiwan checksums, 3 residence regions, live/readonly tooltips, manual gender protection, import guards, photo matching)`);
