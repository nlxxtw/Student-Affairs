"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "web-server.js"), "utf8");
const start = app.indexOf("function academicPeriodText");
const end = app.indexOf("function renderTermSelector", start);
assert.ok(start >= 0 && end > start, "canonical academic-period sorter is missing");

const context = { console };
vm.createContext(context);
vm.runInContext(app.slice(start, end), context, { filename: "academic-period-sorter.js" });

const terms = ["2024-2025-2学期", "2026-2027-1学期", "2025-2026-2学期", "2026-2027-2学期"];
assert.deepStrictEqual(
  Array.from(context.sortTermsDesc(terms)),
  ["2026-2027-2学期", "2026-2027-1学期", "2025-2026-2学期", "2024-2025-2学期"],
  "term strings must always be newest first"
);

const warningTerms = [
  { id: 1, term: "2023-2024-2学期" },
  { id: 2, term: "2026-2027-1学期" },
  { id: 3, term: "2025-2026-2学期" }
];
assert.deepStrictEqual(
  Array.from(context.sortTermsDesc(warningTerms), (row) => row.term),
  ["2026-2027-1学期", "2025-2026-2学期", "2023-2024-2学期"],
  "term objects must always be newest first"
);

const years = [{ year: "2024-2025学年" }, { year: "2026-2027学年" }, { year: "2025-2026学年" }];
assert.deepStrictEqual(
  Array.from(context.sortAcademicYearsDesc(years), (row) => row.year),
  ["2026-2027学年", "2025-2026学年", "2024-2025学年"],
  "academic-year objects must always be newest first"
);

for (const marker of [
  'function saveTermList(list){ localStorage.setItem("nnuzc_term_list", JSON.stringify(sortTermsDesc(list))); }',
  "window.academicTerms = sortTermsDesc(window.academicTerms);",
  "window.academicWarningTerms = sortTermsDesc(window.academicWarningTerms);",
  "window.gradeTerms=sortTermsDesc(window.gradeTerms);",
  "window.fundTerms=sortTermsDesc(window.fundTerms);",
  "studentLoanRecords=(studentLoanRecords||[]).slice().sort(function(a,b){return compareAcademicPeriodsDesc(a,b)",
  "nnuzc_academic_warnings:function(rows){window.academicWarningTerms=sortTermsDesc(rows);}",
  "nnuzc_student_loan_records:function(rows){studentLoanRecords=sortAcademicYearsDesc(rows);}"
]) assert.ok(app.includes(marker), `persistent descending-order guard is missing: ${marker}`);

assert.ok(server.includes('terms.sort((a,b)=>b.localeCompare(a,"zh-CN",{numeric:true}));'), "server term-list persistence must normalize descending order");
assert.ok(server.includes('rows.sort((a,b)=>String(b?.term||"").localeCompare(String(a?.term||""),"zh-CN",{numeric:true}));'), "server academic-term persistence must normalize descending order");

console.log("qa-term-order: passed (term/year strings, objects, save paths, restore paths)");
