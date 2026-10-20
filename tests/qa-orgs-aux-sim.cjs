const { DatabaseSync } = require("node:sqlite");
const crypto = require("crypto");

// 最简桩：加密/解密用可逆 base64（真实环境的 aes-256-gcm 不影响本测试要验证的 SQL/合并逻辑）
const activeDataKey = crypto.randomBytes(32);
function encryptText(v) { return "x:" + Buffer.from(String(v), "utf8").toString("base64"); }
function decryptText(v) { if (typeof v === "string" && v.startsWith("x:")) return Buffer.from(v.slice(2), "base64").toString("utf8"); return v; }

const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE legacy_ui_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE departments (name TEXT PRIMARY KEY, code TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT);
  CREATE TABLE majors (name TEXT PRIMARY KEY, code TEXT NOT NULL DEFAULT '', department_name TEXT NOT NULL, years TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT);
  CREATE TABLE class_groups (name TEXT PRIMARY KEY, department_name TEXT NOT NULL, major_name TEXT NOT NULL, grade TEXT NOT NULL DEFAULT '', counselor TEXT NOT NULL DEFAULT '', teacher TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '', enroll_type TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT);
`);

// ---- 复刻 writeCoreKey 中 nnuzc_orgs 分支（含本次修复） ----
function writeOrgs(value) {
  const orgs = JSON.parse(value);
  const departments = Array.isArray(orgs.depts) ? orgs.depts : [];
  const majors = Array.isArray(orgs.majors) ? orgs.majors : [];
  const classes = Array.isArray(orgs.classes) ? orgs.classes : [];
  db.prepare("DELETE FROM class_groups").run(); db.prepare("DELETE FROM majors").run(); db.prepare("DELETE FROM departments").run();
  const addDept = db.prepare("INSERT INTO departments(name,code,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)");
  departments.forEach((row) => addDept.run(String(row.name).trim(), String(row.code || "")));
  const addMajor = db.prepare("INSERT INTO majors(name,code,department_name,years,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)");
  majors.forEach((row) => addMajor.run(String(row.name).trim(), String(row.code || ""), String(row.dept).trim(), String(row.years || "")));
  const addClass = db.prepare("INSERT INTO class_groups(name,department_name,major_name,grade,counselor,teacher,level,enroll_type,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)");
  classes.forEach((row) => addClass.run(String(row.name).trim(), String(row.dept).trim(), String(row.major).trim(), String(row.grade || ""), encryptText(String(row.counselor || "")), encryptText(String(row.teacher || "")), String(row.level || ""), String(row.enrollType || "")));
  const orgAux = { grades: Array.isArray(orgs.grades) ? orgs.grades : [], dorms: Array.isArray(orgs.dorms) ? orgs.dorms : [], enrollTypes: Array.isArray(orgs.enrollTypes) ? orgs.enrollTypes : [] };
  db.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES('nnuzc_orgs_extra',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(encryptText(JSON.stringify(orgAux)));
  db.prepare("DELETE FROM legacy_ui_store WHERE key=?").run("nnuzc_orgs");
}

// ---- 复刻 readCoreStore 中 nnuzc_orgs 重建（含本次修复） ----
function readOrgs() {
  const store = {};
  const departments = db.prepare("SELECT code,name FROM departments ORDER BY name").all();
  const majors = db.prepare("SELECT code,name,department_name AS dept,years FROM majors ORDER BY name").all();
  const classes = db.prepare("SELECT name,department_name AS dept,major_name AS major,grade,counselor,teacher,level,enroll_type AS enrollType FROM class_groups ORDER BY name").all().map((row)=>Object.assign({},row,{counselor:decryptText(row.counselor),teacher:decryptText(row.teacher)}));
  const orgAux = (() => { try { const r = db.prepare("SELECT value FROM legacy_ui_store WHERE key='nnuzc_orgs_extra'").get(); if (r && r.value) return JSON.parse(decryptText(r.value)); } catch (_e) {} return { grades: [], dorms: [], enrollTypes: [] }; })();
  if (departments.length || majors.length || classes.length || (orgAux.grades && orgAux.grades.length) || (orgAux.dorms && orgAux.dorms.length) || (orgAux.enrollTypes && orgAux.enrollTypes.length)) {
    store.nnuzc_orgs = JSON.stringify({ depts: departments, majors, classes, grades: Array.isArray(orgAux.grades) ? orgAux.grades : [], dorms: Array.isArray(orgAux.dorms) ? orgAux.dorms : [], enrollTypes: Array.isArray(orgAux.enrollTypes) ? orgAux.enrollTypes : [] });
  }
  return store;
}

// ---- 用例：模拟前端保存含招生类别/年级/宿舍楼的基础数据 ----
const incoming = {
  depts: [{ name: "信息工程学院", code: "XX" }],
  majors: [{ name: "计算机科学与技术", code: "CS", dept: "信息工程学院", years: "4" }],
  classes: [{ name: "计科2301", dept: "信息工程学院", major: "计算机科学与技术", grade: "2023级", counselor: "张老师", teacher: "", level: "普通本科", enrollType: "普通本科" }],
  grades: [{ name: "2023级" }, { name: "2024级" }],
  dorms: [{ zone: "东区", building: "1栋" }],
  enrollTypes: [{ name: "普通本科" }, { name: "专转本" }, { name: "3+4分段培养" }]
};

writeOrgs(JSON.stringify(incoming));
const out = JSON.parse(readOrgs().nnuzc_orgs);

function norm(v) { return JSON.stringify(v, Object.keys(v || {}).sort()); }
function assertEq(label, a, b) {
  const ok = norm(a) === norm(b);
  console.log((ok ? "PASS " : "FAIL ") + label + (ok ? "" : `\n  期望: ${JSON.stringify(b)}\n  实际: ${JSON.stringify(a)}`));
  if (!ok) process.exitCode = 1;
}

assertEq("depts 保留", out.depts, incoming.depts);
assertEq("majors 保留", out.majors, incoming.majors);
assertEq("classes 保留", out.classes, incoming.classes);
assertEq("grades(年级) 不再丢失", out.grades, incoming.grades);
assertEq("dorms(宿舍楼) 不再丢失", out.dorms, incoming.dorms);
assertEq("enrollTypes(招生类别) 不再丢失", out.enrollTypes, incoming.enrollTypes);

// 仅新增招生类别、无学院/专业/班级的边界：也要能落地
writeOrgs(JSON.stringify({ depts: [], majors: [], classes: [], grades: [], dorms: [], enrollTypes: [{ name: "新农科" }] }));
const out2 = JSON.parse(readOrgs().nnuzc_orgs || "{}");
assertEq("仅招生类别也能持久化", out2.enrollTypes, [{ name: "新农科" }]);

console.log("\n完成。");
