"use strict";

/* Excel 表格核对工具核心逻辑回归：
   1) web-server 静态断言：excelCheck 功能键已注册、核对资产 ETag 使用各自哈希；
   2) 在 Node vm + DOM 桩中驱动 assets/excel-check-app.js，核对分类计数、等价选项、
      映射重置确认与“历史结果不能生成标注件”守卫。 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(root, "assets", "excel-check-app.js"), "utf8");
const toolHtml = fs.readFileSync(path.join(root, "assets", "excel-check-tool.html"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "web-server.js"), "utf8");
const XLSX = require(path.join(root, "assets", "xlsx.full.min.js"));

/* ---------- 静态断言：AI 功能键与 ETag ---------- */
const featureKeysMatch = serverSource.match(/const AI_FEATURE_KEYS = Object\.freeze\(\[([^\]]*)\]\)/);
assert.ok(featureKeysMatch, "AI_FEATURE_KEYS must be defined on the server");
const featureKeys = featureKeysMatch[1].split(",").map((key) => key.trim().replace(/^"|"$/g, ""));
assert.ok(featureKeys.includes("excelCheck"), "excelCheck AI feature key must be registered on the server");
assert.ok(featureKeys.includes("dataMatch"), "dataMatch AI feature key must be registered on the server");
assert.ok(!/excelCheckToolHtml:[^\n]*EXCEL_MERGE_WORKER_HASH/.test(serverSource), "excel check assets must not borrow the merge worker ETag");
assert.ok(/excelCheckToolHtml:[^\n]*EXCEL_CHECK_TOOL_HTML_HASH/.test(serverSource), "excel check html ETag must use its own hash");
assert.ok(/excelCheckApp:[^\n]*EXCEL_CHECK_APP_HASH/.test(serverSource), "excel check app ETag must use its own hash");
assert.ok(/excelCheckStyle:[^\n]*EXCEL_CHECK_STYLE_HASH/.test(serverSource), "excel check style ETag must use its own hash");
assert.ok(toolHtml.includes("系统加密数据库") && toolHtml.includes("只有在“历史记录”中手动删除或清空才会移除"), "privacy note must describe durable database history honestly");
assert.ok(!toolHtml.includes("不保存历史记录"), "privacy note must not claim no history is kept");

/* ---------- DOM / 浏览器桩 ---------- */
function buildElement(key, registry) {
  const listeners = {};
  return {
    _key: key,
    _listeners: listeners,
    textContent: "",
    innerHTML: "",
    value: "",
    checked: false,
    disabled: false,
    tagName: "DIV",
    style: {},
    dataset: {},
    files: [],
    classList: {
      _set: new Set(),
      toggle(name, force) { const on = force === undefined ? !this._set.has(name) : Boolean(force); if (on) this._set.add(name); else this._set.delete(name); return on; },
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); }
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, event) { (listeners[type] || []).forEach((fn) => fn(event)); },
    querySelector(sel) { return registry(`${key}>${sel}`); },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    focus() {},
    click() {},
    appendChild() {},
    remove() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; }
  };
}
function createElementRegistry() {
  const cache = new Map();
  const registry = (key) => {
    if (!cache.has(key)) cache.set(key, buildElement(key, registry));
    return cache.get(key);
  };
  return registry;
}

let confirmAnswer = true;
const registry = createElementRegistry();
const documentStub = {
  querySelector: (sel) => registry(`doc ${sel}`),
  querySelectorAll: () => [],
  getElementById: (id) => registry(`doc #${id}`),
  createElement: (tag) => registry(`created ${tag} ${Math.random()}`),
  addEventListener() {},
  removeEventListener() {},
  body: registry("doc body")
};
const localStorageBacking = new Map();
const localStorageStub = {
  getItem: (key) => (localStorageBacking.has(key) ? localStorageBacking.get(key) : null),
  setItem: (key, value) => { localStorageBacking.set(key, String(value)); },
  removeItem: (key) => { localStorageBacking.delete(key); }
};
const durableHistory = [];
const toolHistoryStub = {
  async list() { return durableHistory.map((item) => ({ id: item.id, at: item.at })); },
  async get(_tool, id) { return durableHistory.find((item) => item.id === id) || null; },
  async save(_tool, item) { const index = durableHistory.findIndex((row) => row.id === item.id); if (index >= 0) durableHistory[index] = item; else durableHistory.unshift(item); return item; },
  async remove(_tool, id) { const index = durableHistory.findIndex((item) => item.id === id); if (index >= 0) durableHistory.splice(index, 1); return index >= 0; },
  async clear() { durableHistory.length = 0; }
};
let downloads = 0;
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextDecoder,
  XLSX,
  document: documentStub,
  localStorage: localStorageStub,
  ToolHistory: toolHistoryStub,
  crypto: require("crypto").webcrypto,
  confirm: () => confirmAnswer,
  alert() {},
  navigator: {},
  URL: { createObjectURL: () => { downloads += 1; return "blob:stub"; }, revokeObjectURL() {} },
  Blob: class { constructor() { this.size = 1; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox, { filename: "assets/excel-check-app.js" });
const app = sandbox.window.ExcelCompareApp;
assert.ok(app && app.state, "excel check app failed to boot in sandbox");

/* ---------- 构造两份样例数据 ---------- */
function sideFromAoa(aoa, name) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["占位"]]), "Sheet2");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1, { header: 1, defval: "", raw: false, blankrows: true });
  return { file: { name, size: 1024 }, workbook, sheets: ["Sheet1", "Sheet2"], sheetName: "Sheet1", rows, headerIndex: 0 };
}
const referenceAoa = [
  ["学号", "姓名", "班级", "联系电话", "入学日期"],
  ["2026001", "张三", "2401", "13800000001", "2024-09-01"],
  ["2026002", "李四", "2402", "13800000002", "2024-09-02"],
  ["2026003", "王五", "2401", "13800000003", "2024-09-03"],
  ["2026006", "重名甲", "2403", "13800000006", "2024-09-06"],
  ["2026006", "重名乙", "2403", "13800000066", "2024-09-06"],
  ["", "空键甲", "2404", "13800000004", "2024-09-04"]
];
const targetAoa = [
  ["学生姓名", "学号", "行政班级", "手机号", "报到日期"],
  ["张三", "2026001", "2401", "13800000001", "2024/9/1"],
  ["李四", "2026002", "2409", "13800000002.0", "2024-09-02"],
  ["赵六", "2026010", "2402", "13800000010", "2024-09-10"],
  ["重名甲", "2026006", "2403", "13800000006", "2024/9/6"],
  ["重名乙", "2026006", "2403", "13800000066", "2024/9/6"],
  ["空键乙", "", "2405", "13800000005", "2024-09-05"]
];

function seedSides() {
  app.state.reference = sideFromAoa(referenceAoa, "参考表.xlsx");
  app.state.target = sideFromAoa(targetAoa, "待核对表.xlsx");
  app.state.historyLoaded = false;
  app.autoMap();
  /* 模拟人工/语义映射：姓名→学生姓名、班级→行政班级、联系电话→手机号、入学日期→报到日期 */
  const byRef = (label) => app.state.mappings.find((m) => app.state.reference.rows[0][m.refIndex] === label);
  const pairs = [["姓名", 0], ["班级", 2], ["联系电话", 3], ["入学日期", 4]];
  pairs.forEach(([label, targetIndex]) => { const m = byRef(label); m.targetIndex = targetIndex; m.compare = true; });
  app.state.mappingDirty = true;
  app.renderAll();
}
function setOption(id, checked) { registry(`doc #${id}`).checked = checked; }
["trimOption", "numericOption", "dateOption"].forEach((id) => setOption(id, true));
["spacesOption", "caseOption"].forEach((id) => setOption(id, false));

/* ---------- 场景 0：未核对时点标注件不抛错 ---------- */
app.state.result = null; app.state.reference = null; app.state.target = null; app.state.historyLoaded = false;
app.eccDownloadMarkedCopy();
assert.strictEqual(downloads, 0, "marked copy must not download without a result");

/* ---------- 场景 1：默认选项下的核对分类 ---------- */
seedSides();
app.runCompare();
let s = app.state.result.summary;
assert.strictEqual(s.referenceRows, 6, "reference data rows");
assert.strictEqual(s.targetRows, 6, "target data rows");
assert.strictEqual(s.sameRecords, 1, "张三 should match (numeric 13800000002.0 equivalence and date equivalence)");
assert.strictEqual(s.changedRecords, 1, "李四 differs only in 班级");
assert.strictEqual(s.missingRecords, 1, "王五 missing in target");
assert.strictEqual(s.extraRecords, 1, "赵六 extra in target");
assert.strictEqual(s.referenceDuplicateKeys, 1, "2026006 duplicated in reference");
assert.strictEqual(s.targetDuplicateKeys, 1, "2026006 duplicated in target");
assert.strictEqual(s.blankKeyRows, 2, "blank key rows on both sides");
const changed = app.state.result.details.filter((d) => d.status === "字段不一致");
assert.strictEqual(changed.length, 1, "one mismatch detail");
assert.strictEqual(changed[0].field, "班级", "mismatch field is 班级");
assert.strictEqual(app.state.result.details.filter((d) => d.status === "一致").length, 1, "one identical detail");

/* ---------- 场景 2：关闭日期等价后张三也判差异 ---------- */
setOption("dateOption", false);
app.runCompare();
s = app.state.result.summary;
assert.strictEqual(s.sameRecords, 0, "without date equivalence 张三 differs too");
assert.strictEqual(s.changedRecords, 2, "李四和张三 both differ");
const changedFields = app.state.result.details.filter((d) => d.status === "字段不一致").map((d) => d.field).sort().join("|");
assert.strictEqual(changedFields, "入学日期|班级", "mismatch fields include 入学日期 and 班级");
setOption("dateOption", true);
app.runCompare();
assert.strictEqual(app.state.result.summary.sameRecords, 1, "date equivalence restored");

/* ---------- 场景 3：基准值按文本比较，编号 01 与 1 不合并 ---------- */
app.state.reference.rows[1][0] = "01";
app.state.target.rows[1][1] = "1";
app.runCompare();
const summaryForKeys = app.state.result.summary;
assert.strictEqual(summaryForKeys.sameRecords, 0, "key comparison stays textual: 01 != 1");
assert.strictEqual(summaryForKeys.missingRecords + summaryForKeys.extraRecords, 4, "01/1 rows fall apart into missing+extra");
app.state.reference.rows[1][0] = "2026001";
app.state.target.rows[1][1] = "2026001";

/* ---------- 场景 4：工作表切换在映射已手动调整时需要确认 ---------- */
assert.strictEqual(app.state.mappingDirty, true, "manual mapping marks state dirty");
confirmAnswer = false;
app.state.mappingDirty = true;
const beforeSheet = app.state.reference.sheetName;
fireSideChange("reference", "sheet", "Sheet2");
assert.strictEqual(app.state.reference.sheetName, beforeSheet, "cancelling the confirm keeps the current sheet");
confirmAnswer = true;
fireSideChange("reference", "sheet", "Sheet2");
assert.strictEqual(app.state.reference.sheetName, "Sheet2", "accepting the confirm switches sheet");
assert.strictEqual(app.state.mappingDirty, false, "autoMap after confirmed switch clears dirty flag");

function fireSideChange(kind, control, value) {
  const host = registry(`doc #${kind}Meta`);
  const el = host.querySelector(`[data-side-${control}="${kind}"]`);
  assert.ok(el && el._listeners.change && el._listeners.change.length, `side ${control} listener is bound`);
  el.dispatch("change", { target: { value } });
}

/* ---------- 场景 5：数据库历史记录与标注件守卫 ---------- */
(async function verifyDurableHistory() {
  await new Promise((resolve) => setImmediate(resolve));
  confirmAnswer = true;
  await app.eccClearHistory();
  seedSides();
  app.runCompare();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(app.eccHistoryList().length >= 1, "history saved to durable store after compare");
  const historyBefore = app.eccHistoryList().length;
  const beforeDownloads = downloads;
  app.eccViewHistory(0);
  assert.strictEqual(app.state.historyLoaded, true, "loading history sets the guard flag");
  app.eccDownloadMarkedCopy();
  assert.strictEqual(downloads, beforeDownloads, "marked copy is blocked for history-only results");
  app.state.mappingDirty = true;
  confirmAnswer = false;
  await app.eccClearHistory();
  assert.strictEqual(app.eccHistoryList().length, historyBefore, "clear history respects cancel");
  confirmAnswer = true;
  await app.eccClearHistory();
  assert.strictEqual(app.eccHistoryList().length, 0, "clear history empties the database store");
  assert.strictEqual(durableHistory.length, 0, "clear history removes persisted records");
  console.log("qa-excel-check: passed (feature key + ETag wiring, compare classification, equivalence options, mapping confirm guard, durable history/marked-copy guard)");
})().catch((error) => { console.error(error); process.exit(1); });
