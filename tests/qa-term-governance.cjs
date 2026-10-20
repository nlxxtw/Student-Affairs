"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};
const context = vm.createContext({ localStorage, console });
vm.runInContext(`
const DEFAULT_TERM_LIST=[];
const DEPRECATED_TERMS=["2002-2003-1学期"];
const TERM_SETTINGS_KEY="nnuzc_term_settings";
const TERM_VALUE_PATTERN=/^\\d{4}-\\d{4}-[1-9]学期$/;
const TERM_INDEX_STORAGE_KEYS=["nnuzc_academic_terms","nnuzc_academic_warnings","nnuzc_grade_terms","nnuzc_fund_terms","nnuzc_class_officer_assessment_terms"];
const TERM_BUSINESS_STORAGE_KEYS=["nnuzc_students","nnuzc_fund_records","nnuzc_fund_terms","nnuzc_academic_terms","nnuzc_academic_warnings","nnuzc_grade_terms"];
function sortTermsDesc(list){return (list||[]).slice().sort().reverse();}
${functionSource("getTermList")}
${functionSource("saveTermList")}
${functionSource("getTermSettings")}
${functionSource("saveTermSettings")}
${functionSource("collectTermValuesDeep")}
${functionSource("reconcileGlobalTermsFromBusinessData")}
${functionSource("termObjectHasBusinessData")}
${functionSource("termHasBusinessData")}
${functionSource("removeEmptyTermIndexes")}
${functionSource("lockedImportTerm")}
`, context);

localStorage.setItem("nnuzc_term_list", JSON.stringify(["2026-2027-1学期"]));
localStorage.setItem("nnuzc_academic_terms", JSON.stringify([{ id: 1, term: "2024-2025-2学期", rows: [] }]));
localStorage.setItem("nnuzc_fund_records", JSON.stringify([{ id: "f1", studentId: "1", term: "2025-2026-1学期" }]));
vm.runInContext("reconcileGlobalTermsFromBusinessData()", context);
assert.deepStrictEqual(JSON.parse(localStorage.getItem("nnuzc_term_list")), ["2026-2027-1学期", "2025-2026-1学期", "2024-2025-2学期"]);
const settings = JSON.parse(localStorage.getItem("nnuzc_term_settings"));
assert(settings["2024-2025-2学期"] && settings["2025-2026-1学期"], "historical module terms were not added to semester settings");
assert.strictEqual(vm.runInContext("termHasBusinessData('2024-2025-2学期')", context), false, "empty synchronized index must not block global deletion");
assert.strictEqual(vm.runInContext("termHasBusinessData('2025-2026-1学期')", context), true, "real business records must block global deletion");
vm.runInContext("removeEmptyTermIndexes('2024-2025-2学期')", context);
assert.strictEqual(JSON.parse(localStorage.getItem("nnuzc_academic_terms")).length, 0, "empty module index was not removed with global term");
assert.throws(() => vm.runInContext("lockedImportTerm('2023-2024-1学期')", context), /学期设置/, "imports must reject a term outside semester settings");

const termInitialization = source.search(/\b(?:const|let)\s+CURRENT_TERM\s*=\s*getCurrentTerm\(\);/);
const reconciliation = source.indexOf("reconcileGlobalTermsFromBusinessData();");
assert(reconciliation >= 0 && termInitialization >= 0 && reconciliation < termInitialization, "historical reconciliation must run before current-term initialization");
assert(source.includes('const term=targetTerm;row["学期"]=targetTerm;'), "course schedule import is not locked to the selected term");
assert(source.includes('row["学期"]=targetTerm;if(!sid)'), "fund import is not locked to the selected term");
assert(source.includes("incoming['学期']=target.term"), "academic-warning course import is not locked to the selected term");
assert(source.includes('if(hasTerm)rows.forEach(function(row){row["学期"]=targetTerm;});'), "direct module imports are not locked to the selected term");
assert(!source.includes('onclick="openAddAcademicTerm()">＋ 添加学期'), "assessment module still exposes a local add-term button");
assert(!source.includes('onclick="openAddAcademicWarningTerm()">＋ 添加学业预警学期'), "academic-warning module still exposes a local add-term button");
assert(!source.includes('onclick="openAddGradeTerm()">＋ 添加成绩与排名学期'), "grade module still exposes a local add-term button");
assert(!source.includes('onclick="openAddFundTerm()">＋ 添加学期'), "fund module still exposes a local add-term button");

console.log("term-governance: passed (global source, historical reconciliation, deletion guard, target-term locked imports)");
