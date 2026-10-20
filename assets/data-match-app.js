"use strict";

const $ = (selector) => document.querySelector(selector);

const LIMITS = { fileBytes: 30 * 1024 * 1024, dataRows: 200000, previewRows: 500, exportRows: 1048576, historyMax: 20, recordRows: 2000 };
const HISTORY_KEY = "dataMatchHistory_v1";
const FORMAT_RE = /\.(xlsx|xlsm|xlsb|xlt|xltm|xltx|xls|et|ett|ods|fods|ots|csv|txt|dif|prn|xml|htm|html)$/i;
const TEXT_FORMAT_RE = /\.(csv|txt|dif|prn|xml|fods|htm|html)$/i;
const SIDE_LABEL = { lookup: "查找表", entry: "录入表" };

const state = {
  lookup: null,           // 查找表：对照数据 {origin, fileName, size, workbook, sheets, sheetName, rows, headerIndex}
  entry: null,            // 录入表：待填充数据（保持原始，不被修改）
  refPairs: [],           // 参考字段条件 [{lookupCol, entryCol}]
  fieldMaps: [],          // 字段映射 [{lookupCol, entryCol}]
  matchLogic: "and",      // 多参考字段的逻辑："and" 同时满足 ／ "or" 任一满足
  options: { trim: true, allSpaces: false, caseInsensitive: false, fullWidth: false, numeric: false, invisible: false, fillMode: "confirm" },
  result: null,
  filter: "all",
  shown: LIMITS.previewRows,
  history: [],            // 匹配记录（本机持久化，最多 historyMax 条）
  viewingRecordId: null,  // 正在回看的记录 id（null = 实时结果）
  confirmConflicts: [],   // 覆盖确认弹窗的待决冲突
  confirmChoices: new Map(),
  confirmPage: 0          // 确认弹窗当前页（每页 20 条）
};
const lastPasteToast = { lookup: "", entry: "" };

/* ---------- 匹配记录的存储 ---------- */
let storageOk = false;
try { localStorage.setItem("__dm_probe", "1"); localStorage.removeItem("__dm_probe"); storageOk = true; } catch (error) { storageOk = false; }
function isValidRecord(rec) {
  return !!(rec && typeof rec === "object"
    && typeof rec.id === "string" && typeof rec.time === "number"
    && rec.stats && typeof rec.stats.entryRows === "number" && typeof rec.stats.hit === "number"
    && Array.isArray(rec.entryHeader)
    && (rec.rows === null || Array.isArray(rec.rows)));
}
async function loadHistory() {
  try {
    const index = await ToolHistory.list("dataMatch");
    state.history = (await Promise.all(index.map((item) => ToolHistory.get("dataMatch", item.id)))).filter(isValidRecord);
    if (!state.history.length && storageOk) {
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (_error) { legacy = []; }
      for (const item of Array.isArray(legacy) ? legacy.filter(isValidRecord) : []) {
        item.at = item.at || new Date(item.time).toISOString(); item.title = "数据匹配：" + (item.entryName || "运行记录");
        item.summaryText = "命中 " + Number(item.stats.hit || 0) + "/" + Number(item.stats.entryRows || 0) + " · 填充 " + Number(item.stats.cellsFilled || 0) + " 格";
        await ToolHistory.save("dataMatch", item);
      }
      if (legacy.length) { localStorage.removeItem(HISTORY_KEY); return loadHistory(); }
    }
  } catch (error) { state.history = []; toast("数据库历史读取失败：" + error.message); }
}
async function saveHistory() {
  const record = state.history[0]; if (!record) return;
  record.at = record.at || new Date(record.time).toISOString(); record.title = "数据匹配：" + (record.entryName || "运行记录");
  record.summaryText = "命中 " + Number(record.stats.hit || 0) + "/" + Number(record.stats.entryRows || 0) + " · 填充 " + Number(record.stats.cellsFilled || 0) + " 格";
  try { await ToolHistory.save("dataMatch", record); }
  catch (error) { toast("匹配完成，但数据库历史保存失败：" + error.message); }
}
function fmtTime(time) { return new Date(time).toLocaleString("zh-CN", { hour12: false }); }

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function display(value) {
  if (value == null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part) => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value);
}
function formatSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3200); }
function setBusy(active, message = "正在读取，请稍候…") { $("#busy").classList.toggle("hidden", !active); $("#busy b").textContent = message; }
function normalizeHeader(value) { return display(value).trim().replace(/[\s　_\-（）()【】\[\]：:]/g, "").toLowerCase(); }
function nonemptyRow(row) { return Array.isArray(row) && row.some((value) => display(value).trim() !== ""); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

/* ---------- 匹配规则（值的等价化） ---------- */
function fullToHalf(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0x3000) out += " ";
    else if (code >= 0xFF01 && code <= 0xFF5E) out += String.fromCharCode(code - 0xFEE0);
    else out += ch;
  }
  return out;
}
function numericCanon(text) {
  const match = /^[+-]?(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return text;
  const sign = text.startsWith("-") ? "-" : "";
  const intPart = match[1].replace(/^0+(?=\d)/, "");
  const decPart = (match[2] || "").replace(/0+$/, "");
  return sign + intPart + (decPart ? "." + decPart : "");
}
function normalizeKeyWith(value, options) {
  let text = display(value);
  if (options.trim) text = text.trim();
  if (options.invisible) text = text.replace(/[\u200b\u200c\u200d\u2060\ufeff\u0000-\u001f\u007f]/g, "");
  if (options.allSpaces) text = text.replace(/[\s\u3000]+/g, "");
  if (options.fullWidth) text = fullToHalf(text);
  if (options.caseInsensitive) text = text.toLowerCase();
  if (options.numeric) text = numericCanon(text);
  return text;
}
function normalizeKey(value) { return normalizeKeyWith(value, state.options); }

/* ---------- 文本 / 文件解析 ---------- */
function decodeTextBytes(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) { return new TextDecoder("gbk").decode(bytes); }
}
function parseCsvLine(line) {
  const out = []; let current = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false; }
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(current); current = ""; }
      else current += ch;
    }
  }
  out.push(current);
  return out;
}
function parseTableText(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length) return [];
  const tabbed = lines.some((line) => line.includes("\t"));
  return tabbed ? lines.map((line) => line.split("\t")) : lines.map(parseCsvLine);
}
function autoHeaderIndex(rows) {
  let bestIndex = 0, bestScore = -Infinity;
  (rows || []).slice(0, 30).forEach((row, index) => {
    const values = (row || []).map((value) => display(value).trim()).filter(Boolean);
    if (!values.length) return;
    const distinct = new Set(values).size;
    const textCount = values.filter((value) => !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)).length;
    let score = values.length * 3 + textCount + distinct;
    if (values.length === 1) score -= 6;
    if (values.length > 2 && distinct / values.length < 0.5) score -= values.length * 2;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestScore === -Infinity ? 0 : bestIndex;
}
function fillMergedCells(rows, sheet) {
  (sheet && sheet["!merges"] || []).forEach((range) => {
    const value = rows[range.s.r] ? rows[range.s.r][range.s.c] : undefined;
    if (value == null || display(value).trim() === "") return;
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (!rows[r]) continue;
      for (let c = range.s.c; c <= range.e.c; c++) rows[r][c] = value;
    }
  });
}
function workbookRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: true });
  fillMergedCells(rows, sheet);
  return rows;
}
function visibleSheetNames(workbook) {
  const details = workbook.Workbook && workbook.Workbook.Sheets || [];
  const names = workbook.SheetNames.filter((name, index) => !details[index] || !details[index].Hidden);
  return names.length ? names : workbook.SheetNames.slice();
}

/* ---------- 两侧表格的读取与维护 ---------- */
async function readSide(kind, file) {
  if (!file) return;
  if (!FORMAT_RE.test(file.name || "")) return toast("仅支持 Excel / WPS 表格文件（.xlsx、.xls、.et 等）及 CSV、TXT 文本");
  if (file.size > LIMITS.fileBytes) return toast("单个文件不能超过 30 MB");
  setBusy(true, `正在读取${SIDE_LABEL[kind]}：${file.name}`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asText = TEXT_FORMAT_RE.test(file.name || "");
    const workbook = XLSX.read(asText ? decodeTextBytes(bytes) : bytes, { type: asText ? "string" : "array", cellDates: true });
    const sheets = visibleSheetNames(workbook);
    if (!sheets.length) throw new Error("文件中没有可读取的工作表");
    const sheetName = sheets[0];
    applySide(kind, { origin: "file", fileName: file.name, size: file.size, workbook, sheets, sheetName, rows: workbookRows(workbook, sheetName) });
    toast(`${SIDE_LABEL[kind]}「${file.name}」已读取`);
  } catch (error) {
    toast(`读取失败：${error.message || "文件可能已损坏、加密或格式不受支持"}`);
  } finally { setBusy(false); }
}
function applySide(kind, built) {
  if (!built.rows.some(nonemptyRow)) throw new Error("没有可读取的数据行");
  const headerIndex = built.headerIndex ?? autoHeaderIndex(built.rows);
  const dataCount = built.rows.slice(headerIndex + 1).filter(nonemptyRow).length;
  if (dataCount > LIMITS.dataRows) throw new Error(`约有 ${dataCount.toLocaleString()} 条数据，超过 ${LIMITS.dataRows.toLocaleString()} 条上限`);
  built.headerIndex = headerIndex;
  state[kind] = built;
  autoRules();
  state.result = null; state.shown = LIMITS.previewRows; state.filter = "all";
  document.querySelectorAll("#filterTabs .tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.filter === "all"));
  runMatch(); renderAll();
}
function loadSideFromText(kind, text) {
  const rows = parseTableText(text);
  if (!rows.some(nonemptyRow)) {
    if (state[kind]) { state[kind] = null; autoRules(); state.result = null; runMatch(); renderAll(); }
    return false;
  }
  applySide(kind, { origin: "paste", fileName: `粘贴的${SIDE_LABEL[kind]}`, size: 0, workbook: null, sheets: null, sheetName: null, rows });
  return true;
}
function makeReparse(kind) {
  return debounce(() => {
    try {
      const text = $(`#${kind}Paste`).value;
      if (loadSideFromText(kind, text)) {
        const key = `${state[kind].rows.length}x${sideColumns(kind).length}`;
        if (lastPasteToast[kind] !== key) { toast(`已识别${SIDE_LABEL[kind]} ${state[kind].rows.length} 行 × ${sideColumns(kind).length} 列`); lastPasteToast[kind] = key; }
      } else lastPasteToast[kind] = "";
    } catch (error) { toast(error.message || "粘贴内容无法解析"); }
  }, 400);
}
const reparseLookup = makeReparse("lookup");
const reparseEntry = makeReparse("entry");

function sideColumns(kind) {
  const side = state[kind];
  if (!side) return [];
  const width = side.rows.reduce((max, row) => Math.max(max, row ? row.length : 0), 1);
  const headerRow = side.headerIndex >= 0 ? (side.rows[side.headerIndex] || []) : null;
  const seen = new Map();
  return Array.from({ length: width }, (_, index) => {
    const raw = headerRow ? display(headerRow[index]).trim() : "";
    const base = raw || (side.headerIndex < 0 ? `列${index + 1}` : `未命名列${index + 1}`);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { index, raw, label: count > 1 ? `${base}（${count}）` : base };
  });
}
function sideDataRows(kind) {
  const side = state[kind], start = side.headerIndex + 1;
  return side.rows.slice(start).map((cells, index) => ({ rowNo: start + index + 1, cells: cells || [] })).filter((item) => nonemptyRow(item.cells));
}

/* ---------- 参考字段与字段映射 ---------- */
const KEYISH_RE = /^(学号|考生号|身份证号|证件号|工号|员工编号|学生编号|人员编号|编号|关键字|关键值|key|id|code)$/i;
function autoRules() {
  if (!state.lookup || !state.entry) { state.refPairs = []; state.fieldMaps = []; return; }
  const lookupColumns = sideColumns("lookup"), entryColumns = sideColumns("entry");
  const entryByName = new Map();
  entryColumns.forEach((column) => { const name = normalizeHeader(column.raw); if (name && !entryByName.has(name)) entryByName.set(name, column.index); });
  // 参考字段：优先取两表同名且像关键字的列（学号 / 编号 / ID 等），否则取第一对同名列
  let refs = [];
  lookupColumns.forEach((column) => {
    const name = normalizeHeader(column.raw);
    if (name && KEYISH_RE.test(name) && entryByName.has(name)) refs.push({ lookupCol: column.index, entryCol: entryByName.get(name) });
  });
  if (!refs.length) {
    for (const column of lookupColumns) {
      const name = normalizeHeader(column.raw);
      if (name && entryByName.has(name)) { refs.push({ lookupCol: column.index, entryCol: entryByName.get(name) }); break; }
    }
  }
  // 字段映射：其余同名列自动映射，目标列不与参考字段冲突
  const usedEntry = new Set(refs.map((pair) => pair.entryCol));
  const usedLookup = new Set(refs.map((pair) => pair.lookupCol));
  const maps = [];
  lookupColumns.forEach((column) => {
    if (usedLookup.has(column.index)) return;
    const name = normalizeHeader(column.raw);
    if (!name) return;
    const entryIndex = entryByName.get(name);
    if (entryIndex == null || usedEntry.has(entryIndex)) return;
    maps.push({ lookupCol: column.index, entryCol: entryIndex });
    usedLookup.add(column.index); usedEntry.add(entryIndex);
  });
  state.refPairs = refs; state.fieldMaps = maps;
}
function pairUsable(pair) { return pair && pair.lookupCol >= 0 && pair.entryCol >= 0; }
function usedColumns(exceptRows, exceptIndex, key) {
  const used = new Set();
  exceptRows.forEach((row, index) => { if (index !== exceptIndex && pairUsable(row)) used.add(row[key]); });
  return used;
}

/* ---------- 匹配引擎 ---------- */
function runMatch() {
  state.viewingRecordId = null;  // 新的匹配会退出记录回看模式
  const validRefs = state.refPairs.filter(pairUsable);
  if (!state.lookup || !state.entry || !validRefs.length) { state.result = null; return; }
  const lookupRows = sideDataRows("lookup");
  const entryRowsAll = sideDataRows("entry");
  const lookupColsAll = sideColumns("lookup"), entryColsAll = sideColumns("entry");
  const orMode = state.matchLogic === "or";
  let lookupBlankKeys = 0, lookupDupKeys = 0;
  let conditionIndexes = null, compositeIndex = null;
  if (orMode) {
    // 或模式：每个条件各建一份索引，逐条独立比对
    conditionIndexes = validRefs.map((pair) => {
      const map = new Map();
      lookupRows.forEach((row) => {
        const norm = normalizeKey(row.cells[pair.lookupCol]);
        if (norm === "") { lookupBlankKeys++; return; }
        let entry = map.get(norm);
        if (!entry) { entry = { rows: [] }; map.set(norm, entry); }
        entry.rows.push(row);
      });
      map.forEach((entry) => { if (entry.rows.length > 1) lookupDupKeys++; });
      return map;
    });
  } else {
    // 与模式：所有条件的值拼成联合关键字
    compositeIndex = new Map();
    lookupRows.forEach((row) => {
      const parts = validRefs.map((pair) => normalizeKey(row.cells[pair.lookupCol]));
      if (parts.some((part) => part === "")) { lookupBlankKeys++; return; }
      const key = parts.join("\u241f");
      let entry = compositeIndex.get(key);
      if (!entry) { entry = { rows: [] }; compositeIndex.set(key, entry); }
      entry.rows.push(row);
    });
    compositeIndex.forEach((entry) => { if (entry.rows.length > 1) lookupDupKeys++; });
  }

  // ---------- 数据预检：匹配前的格式风险提示 ----------
  const preflight = [];
  {
    const CHECKS = [
      ["mid", "allSpaces", "含中间空格", "建议开启「忽略全部空格」"],
      ["width", "fullWidth", "含全角字符", "建议开启「全角半角等价」"],
      ["case", "caseInsensitive", "大小写混用", "建议开启「英文不区分大小写」"],
      ["invisible", "invisible", "含不可见字符（零宽字符等）", "建议开启「忽略不可见字符」"]
    ];
    const scanColumn = (kind, colIndex, colLabel, rows) => {
      const counts = { mid: 0, width: 0, case: 0, invisible: 0 };
      let leadzero = 0;
      rows.forEach((row) => {
        const v = display(row.cells[colIndex]);
        if (!v) return;
        if (/\S\s+\S/.test(v)) counts.mid++;
        if (/[\uFF01-\uFF5E\u3000]/.test(v)) counts.width++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) counts.case++;
        if (/[\u200b\u200c\u200d\u2060\ufeff]/.test(v)) counts.invisible++;
        if (/^0\d+$/.test(v.trim())) leadzero++;
      });
      CHECKS.forEach(([key, optKey, foundText, advice]) => {
        if (counts[key] && !state.options[optKey]) preflight.push({ level: "info", text: `${SIDE_LABEL[kind]}「${colLabel}」${foundText} ${counts[key]} 处，${advice}` });
      });
      if (leadzero) preflight.push(state.options.numeric
        ? { level: "warn", text: `${SIDE_LABEL[kind]}「${colLabel}」存在 ${leadzero} 个前导零编号，「数值等价」已开启，001 与 1 会被视为相同，请确认` }
        : { level: "info", text: `${SIDE_LABEL[kind]}「${colLabel}」存在 ${leadzero} 个前导零编号，保持文本匹配即可，请勿开启「数值等价」` });
    };
    validRefs.forEach((pair) => {
      const lookupCol = lookupColsAll.find((c) => c.index === pair.lookupCol);
      const entryCol = entryColsAll.find((c) => c.index === pair.entryCol);
      if (lookupCol) scanColumn("lookup", pair.lookupCol, lookupCol.label, lookupRows);
      if (entryCol) scanColumn("entry", pair.entryCol, entryCol.label, entryRowsAll);
    });
    if (lookupDupKeys) preflight.push({ level: "info", text: `查找表有 ${lookupDupKeys} 组重复参考值，匹配时每组取第 1 条` });
    if (lookupBlankKeys) preflight.push({ level: "warn", text: `查找表有 ${lookupBlankKeys} 行参考值为空，这些行不参与匹配` });
  }

  const maps = state.fieldMaps.filter(pairUsable);
  const rowResults = [];
  let hit = 0, miss = 0, blank = 0, cellsFilled = 0, cellsOverwritten = 0, cellsKept = 0, conflicts = 0, diffCount = 0;
  const usedRowNos = new Set();
  const applyHit = (base, cells, found) => {
    usedRowNos.add(found.rows[0].rowNo);
    base.dupCount = found.rows.length;
    base.lookupRowNo = found.rows[0].rowNo;
    const lookupRow = found.rows[0];
    maps.forEach((map) => {
      const orig = display(cells[map.entryCol]);
      const origBlank = orig.trim() === "";
      const value = display(lookupRow.cells[map.lookupCol]);
      let type;
      if (origBlank) { cells[map.entryCol] = value; type = "filled"; cellsFilled++; }
      else if (value === orig) { type = "kept"; cellsKept++; }
      else {
        diffCount++;
        if (state.options.fillMode === "overwrite") { cells[map.entryCol] = value; type = "overwritten"; cellsOverwritten++; }
        else if (state.options.fillMode === "confirm") { type = "confirm"; conflicts++; }
        else { type = "kept"; cellsKept++; }
      }
      base.fills[map.entryCol] = { type, value, orig };
    });
  };
  entryRowsAll.forEach((sourceRow) => {
    const cells = sourceRow.cells.slice();  // 工作副本，原始录入表保持不变
    const parts = validRefs.map((pair) => normalizeKey(cells[pair.entryCol]));
    const keyText = validRefs.map((pair) => display(cells[pair.entryCol]).trim()).join(" ＋ ");
    const base = { rowNo: sourceRow.rowNo, keyText, cells, fills: {}, dupCount: 0, lookupRowNo: null, condLabel: null };
    if (orMode) {
      // 任一条件命中即匹配（按条件顺序取第一个）；全为空才算参考为空
      if (parts.every((part) => part === "")) { blank++; base.status = "blank"; rowResults.push(base); return; }
      let matched = null;
      for (let i = 0; i < validRefs.length; i++) {
        if (parts[i] === "") continue;
        const found = conditionIndexes[i].get(parts[i]);
        if (found) { matched = { found, i }; break; }
      }
      if (!matched) { miss++; base.status = "miss"; rowResults.push(base); return; }
      hit++; base.status = "hit";
      base.condLabel = columnLabel("entry", validRefs[matched.i].entryCol);
      applyHit(base, cells, matched.found);
    } else {
      if (parts.some((part) => part === "")) { blank++; base.status = "blank"; rowResults.push(base); return; }
      const found = compositeIndex.get(parts.join("\u241f"));
      if (!found) { miss++; base.status = "miss"; rowResults.push(base); return; }
      hit++; base.status = "hit";
      applyHit(base, cells, found);
    }
    rowResults.push(base);
  });

  // ---------- 未命中诊断：用未开启的容错选项逐个试探 ----------
  let diagCount = 0;
  const missRows = rowResults.filter((row) => row.status === "miss");
  if (missRows.length) {
    const buildDiagIndex = (opts) => {
      if (orMode) {
        const condMaps = validRefs.map(() => new Map());
        lookupRows.forEach((row) => validRefs.forEach((pair, i) => {
          const norm = normalizeKeyWith(row.cells[pair.lookupCol], opts);
          if (norm !== "" && !condMaps[i].has(norm)) condMaps[i].set(norm, row.rowNo);
        }));
        return { or: condMaps };
      }
      const composite = new Map();
      lookupRows.forEach((row) => {
        const parts = validRefs.map((pair) => normalizeKeyWith(row.cells[pair.lookupCol], opts));
        if (parts.some((x) => x === "")) return;
        const key = parts.join("\u241f");
        if (!composite.has(key)) composite.set(key, row.rowNo);
      });
      return { composite };
    };
    const diagLookup = (entryRow, diag) => {
      if (diag.or) {
        for (let i = 0; i < validRefs.length; i++) {
          const norm = normalizeKeyWith(entryRow.cells[validRefs[i].entryCol], diag.opts);
          if (norm === "") continue;
          const rowNo = diag.or[i].get(norm);
          if (rowNo) return rowNo;
        }
        return 0;
      }
      const parts = validRefs.map((pair) => normalizeKeyWith(entryRow.cells[pair.entryCol], diag.opts));
      if (parts.some((x) => x === "")) return 0;
      return diag.composite.get(parts.join("\u241f")) || 0;
    };
    const DIAG = [
      ["trim", "忽略首尾空格"], ["allSpaces", "忽略全部空格"], ["caseInsensitive", "英文不区分大小写"],
      ["fullWidth", "全角半角等价"], ["numeric", "数值等价"], ["invisible", "忽略不可见字符"]
    ];
    const diagList = [];
    DIAG.forEach(([key, label]) => {
      if (state.options[key]) return;
      if (lookupRows.length > 50000) return;  // 大表只做组合诊断，避免卡顿
      const opts = { ...state.options, [key]: true };
      diagList.push({ label, opts, ...buildDiagIndex(opts) });
    });
    const allOpts = { trim: true, allSpaces: true, caseInsensitive: true, fullWidth: true, numeric: true, invisible: true };
    diagList.push({ label: "全部容错选项", opts: allOpts, ...buildDiagIndex(allOpts) });
    for (const row of missRows) {
      for (const diag of diagList) {
        const rowNo = diagLookup(row, diag);
        if (rowNo) { row.diag = { label: diag.label, rowNo }; diagCount++; break; }
      }
    }
  }

  // ---------- 录入表已有内容提示 ----------
  let entryHasData = 0;
  maps.forEach((map) => entryRowsAll.forEach((row) => { if (display(row.cells[map.entryCol]).trim() !== "") entryHasData++; }));
  if (entryHasData) {
    const modeLine = {
      confirm: `填充策略为「确认后覆盖」，其中与查找表不同的 ${conflicts} 处已弹窗等待逐条确认`,
      blank: `当前策略「仅填充空白」将全部保留原值${diffCount ? `，其中 ${diffCount} 处与查找表不同；如需逐条决定是否覆盖，请把填充策略切换为「确认后覆盖」` : "（与查找表一致，无需处理）"}`,
      overwrite: `当前策略「覆盖已有内容」将把这 ${entryHasData} 处全部覆盖为查找表值（其中 ${diffCount} 处与查找表不同；如需逐条决定，请切换为「确认后覆盖」）`
    }[state.options.fillMode];
    preflight.push({ level: diffCount && state.options.fillMode !== "confirm" ? "warn" : "info", text: `录入表映射列已有 ${entryHasData} 处内容，${modeLine}` });
  }

  // ---------- 查找表未用行：未被任何录入行命中引用的行 ----------
  const refLookupCols = new Set(validRefs.map((pair) => pair.lookupCol));
  const auxCol = lookupColsAll.find((column) => !refLookupCols.has(column.index));
  const unused = lookupRows
    .filter((row) => !usedRowNos.has(row.rowNo))
    .map((row) => ({
      rowNo: row.rowNo,
      keyText: validRefs.map((pair) => display(row.cells[pair.lookupCol]).trim()).join(" ＋ "),
      aux: auxCol ? display(row.cells[auxCol.index]) : ""
    }));
  const auxLabel = auxCol ? auxCol.label : "";

  state.result = {
    rows: rowResults, maps, orMode, unused, auxLabel, preflight,
    stats: {
      lookupRows: lookupRows.length, entryRows: rowResults.length, hit, miss, blank,
      lookupDupKeys, lookupBlankKeys, cellsFilled, cellsOverwritten, cellsKept,
      diagCount, unused: unused.length, conflicts, diffCount
    }
  };
  addRecord();
  if (conflicts > 0 && state.options.fillMode === "confirm") openConfirmModal();
}

/* ---------- 覆盖确认弹窗 ---------- */
function openConfirmModal() {
  const result = state.result;
  if (!result) return;
  state.confirmConflicts = [];
  state.confirmChoices = new Map();
  state.confirmPage = 0;
  result.rows.forEach((row) => {
    result.maps.forEach((map) => {
      const fill = row.fills[map.entryCol];
      if (fill && fill.type === "confirm") state.confirmConflicts.push({ row, entryCol: map.entryCol, orig: fill.orig, value: fill.value });
    });
  });
  if (!state.confirmConflicts.length) return;
  $("#cbDesc").textContent = `录入表中有 ${state.confirmConflicts.length} 处单元格已有内容，且与匹配到的新值不同。请逐条选择，或使用批量操作后确认应用。`;
  confirmLastPage = -1;
  renderConfirmModal();
  $("#confirmMask").classList.remove("hidden");
  $("#confirmBox").focus();
}
let confirmLastPage = -1;
function renderConfirmModal() {
  const conflicts = state.confirmConflicts, PAGE = 20;
  const totalPages = Math.max(1, Math.ceil(conflicts.length / PAGE));
  state.confirmPage = Math.min(Math.max(state.confirmPage, 0), totalPages - 1);
  let over = 0;
  conflicts.forEach(({ row, entryCol }) => { if ((state.confirmChoices.get(`${row.rowNo}#${entryCol}`) || "keep") === "overwrite") over++; });
  $("#cbCounter").textContent = `共 ${conflicts.length} 处 · 覆盖 ${over} · 保留 ${conflicts.length - over}`;
  const maps = state.result ? state.result.maps : [];
  const labelOf = (entryCol) => {
    const map = maps.find((item) => item.entryCol === entryCol);
    return map ? (map.label || columnLabel("entry", entryCol)) : `列${entryCol + 1}`;
  };
  const shown = conflicts.slice(state.confirmPage * PAGE, state.confirmPage * PAGE + PAGE);
  // 滚动容器是 #cbList 的父级 .cb-list；同一页内重渲染（逐条选择）时保持滚动位置，翻页则回到顶部
  const scroller = $("#cbList").parentElement;
  const prevTop = state.confirmPage === confirmLastPage ? scroller.scrollTop : 0;
  $("#cbList").innerHTML = shown.map(({ row, entryCol, orig, value }) => {
    const key = `${row.rowNo}#${entryCol}`;
    const choice = state.confirmChoices.get(key) || "keep";
    return `<div class="cb-row">
      <span class="cb-cell">${row.rowNo}</span>
      <span class="cb-cell" title="${escapeHtml(row.keyText)}">${escapeHtml(row.keyText)}</span>
      <span class="cb-cell">${escapeHtml(labelOf(entryCol))}</span>
      <span class="cb-cell old" title="${escapeHtml(orig)}">${escapeHtml(orig)}</span>
      <span class="cb-cell new" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
      <span class="cb-choice">
        <button class="choice over${choice === "overwrite" ? " on" : ""}" data-key="${key}" data-pick="overwrite" type="button">覆盖</button>
        <button class="choice keep${choice === "keep" ? " on" : ""}" data-key="${key}" data-pick="keep" type="button">保留</button>
      </span>
    </div>`;
  }).join("");
  $("#cbPageInfo").textContent = `第 ${state.confirmPage + 1} / ${totalPages} 页`;
  $("#cbPrev").disabled = state.confirmPage <= 0;
  $("#cbNext").disabled = state.confirmPage >= totalPages - 1;
  // 仅翻页时回到列表顶部，逐条选择不跳动
  if (state.confirmPage !== confirmLastPage) { scroller.scrollTop = 0; confirmLastPage = state.confirmPage; }
  else scroller.scrollTop = prevTop;
}
function applyConfirmDecisions(cancelAll) {
  const result = state.result;
  if (!result) return;
  let overwritten = 0, kept = 0;
  state.confirmConflicts.forEach(({ row, entryCol, orig, value }) => {
    const choice = state.confirmChoices.get(`${row.rowNo}#${entryCol}`) || "keep";
    if (choice === "overwrite") { row.cells[entryCol] = value; row.fills[entryCol] = { type: "overwritten", value, orig }; overwritten++; }
    else { row.fills[entryCol] = { type: "kept", value, orig }; kept++; }
  });
  result.stats.cellsOverwritten += overwritten;
  result.stats.cellsKept += kept;
  result.stats.conflicts = 0;
  state.confirmConflicts = [];
  state.confirmChoices = new Map();
  $("#confirmMask").classList.add("hidden");
  addRecord();
  renderAll();
  toast(cancelAll ? "已关闭：全部保留原值" : `已应用：覆盖 ${overwritten} 处，保留 ${kept} 处`);
}

/* ---------- 匹配记录 ---------- */
function sourceIdentity() {
  const tag = (side) => `${side.origin === "file" ? side.fileName : "粘贴"}:${side.rows.length}`;
  return `${tag(state.lookup)}|${tag(state.entry)}`;
}
function buildEntryHeader() {
  const entry = state.entry, width = sideColumns("entry").length;
  return entry.headerIndex >= 0
    ? Array.from({ length: width }, (_, index) => display((entry.rows[entry.headerIndex] || [])[index]) || `列${index + 1}`)
    : Array.from({ length: width }, (_, index) => `列${index + 1}`);
}
function refPairText(orMode) {
  return state.refPairs.filter(pairUsable).map((pair) => `${columnLabel("lookup", pair.lookupCol)}＝${columnLabel("entry", pair.entryCol)}`).join(orMode ? " ／ " : " ＋ ");
}
function addRecord() {
  const result = state.result;
  if (!result || !result.rows.length) return;
  // 深拷贝行数据，存档与实时结果互不影响
  const snapshotRows = () => result.rows.map((row) => ({ ...row, cells: row.cells.slice(), fills: { ...row.fills } }));
  const maps = result.maps.map((map) => ({ entryCol: map.entryCol, label: columnLabel("entry", map.entryCol) }));
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: Date.now(),
    identity: sourceIdentity(),
    orMode: !!result.orMode,
    refText: refPairText(!!result.orMode),
    maps,
    lookupName: state.lookup.origin === "file" ? state.lookup.fileName : "粘贴的查找表",
    lookupRowsCount: result.stats.lookupRows,
    entryName: state.entry.origin === "file" ? state.entry.fileName : "粘贴的录入表",
    entryHeader: buildEntryHeader(),
    optionText: matchOptionText(),
    stats: { ...result.stats },
    rows: result.stats.entryRows <= LIMITS.recordRows ? snapshotRows() : null,
    truncated: result.stats.entryRows > LIMITS.recordRows,
    unused: result.stats.entryRows <= LIMITS.recordRows ? (result.unused || []).map((row) => ({ ...row })) : null,
    auxLabel: result.auxLabel,
    preflight: (result.preflight || []).slice()
  };
  if (state.history.length && state.history[0].identity === record.identity) {
    record.id = state.history[0].id;   // 同一份数据重复匹配：替换最新一条
    state.history[0] = record;
  } else {
    state.history.unshift(record);
  }
  if (state.viewingRecordId === record.id) state.viewingRecordId = null;
  saveHistory();
}
function matchOptionText() {
  const o = state.options;
  const fillText = { blank: "仅填充空白", overwrite: "覆盖已有内容", confirm: "覆盖前逐条确认" }[o.fillMode] || "仅填充空白";
  return [`忽略首尾空格 ${o.trim ? "开" : "关"}`, `忽略全部空格 ${o.allSpaces ? "开" : "关"}`, `英文不区分大小写 ${o.caseInsensitive ? "开" : "关"}`, `全角半角等价 ${o.fullWidth ? "开" : "关"}`, `数值等价 ${o.numeric ? "开" : "关"}`, `忽略不可见字符 ${o.invisible ? "开" : "关"}`, `填充策略：${fillText}`].join("；");
}
function renderHistory() {
  const card = $("#historyCard");
  card.classList.toggle("hidden", !state.history.length);
  $("#historyList").innerHTML = state.history.map((record) => {
    const stats = record.stats, total = Math.max(1, stats.entryRows);
    const rate = Math.round((stats.hit / total) * 100);
    return `<div class="history-item">
      <div class="hi-info">
        <b>${escapeHtml(fmtTime(record.time))}</b>
        <span class="hi-badge${record.orMode ? " or" : ""}">${record.orMode ? "或" : "与"}</span>
        <span class="hi-refs" title="${escapeHtml(record.refText)}">${escapeHtml(record.refText)}</span>
        <span class="hi-sub">${escapeHtml(record.lookupName)}（${record.lookupRowsCount} 行） × ${escapeHtml(record.entryName)}（${stats.entryRows} 行） · 命中 ${stats.hit}/${stats.entryRows}（${rate}%） · 填充 ${stats.cellsFilled} 格 · 未找到 ${stats.miss} · 参考为空 ${stats.blank}${record.truncated ? " · 数据较大，未保存明细" : ""}</span>
      </div>
      <div class="hi-actions">
        <button class="ghost small" data-rec-view="${record.id}" type="button"${record.rows ? "" : " disabled"}>查看</button>
        <button class="ghost small" data-rec-export="${record.id}" type="button"${record.rows ? "" : " disabled"}>导出</button>
        <button class="rule-del" data-rec-del="${record.id}" type="button" title="删除该记录">✕</button>
      </div>
    </div>`;
  }).join("");
}
function viewRecord(id) {
  const record = state.history.find((item) => item.id === id);
  if (!record) return;
  if (!record.rows) return toast("该记录数据量较大，仅保留了统计，无法回看明细");
  state.viewingRecordId = id;
  $("#confirmMask").classList.add("hidden");
  state.result = { rows: record.rows.map((row) => ({ ...row, cells: row.cells.slice(), fills: { ...row.fills } })),
    maps: record.maps.map((map) => ({ ...map })), orMode: record.orMode, stats: { ...record.stats },
    unused: (record.unused || []).map((row) => ({ ...row })), auxLabel: record.auxLabel || "", preflight: (record.preflight || []).slice() };
  state.filter = "all"; state.shown = LIMITS.previewRows;
  document.querySelectorAll("#filterTabs .tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.filter === "all"));
  renderResult();
  $("#resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}
function exportRecord(record) {
  const statusText = { hit: "已匹配", miss: "未找到", blank: "参考为空" };
  const aoa = [record.entryHeader.concat(record.orMode ? ["匹配状态", "匹配条件"] : ["匹配状态"])];
  record.rows.forEach((row) => aoa.push(record.entryHeader.map((_, index) => display(row.cells[index]))
    .concat(record.orMode ? [statusText[row.status], row.condLabel || ""] : [statusText[row.status]])));
  if (aoa.length > LIMITS.exportRows) return toast("该记录超出 Excel 单表上限，无法导出");
  const summaryRows = [
    ["数据自动匹配记录"], ["匹配时间", fmtTime(record.time)],
    ["查找表", `${record.lookupName}（${record.lookupRowsCount} 行）`], ["录入表", `${record.entryName}（${record.stats.entryRows} 行）`],
    ["参考字段", record.refText], ["字段映射", record.maps.map((map) => map.label).join("、") || "（无）"],
    ["匹配选项", record.optionText], [],
    ["统计项", "数量"], ["已匹配", record.stats.hit], ["未找到", record.stats.miss], ["参考为空", record.stats.blank],
    ["填充单元格", record.stats.cellsFilled], ["覆盖单元格", record.stats.cellsOverwritten], ["保留原值单元格", record.stats.cellsKept],
    ["疑似可修复(格式差异)", record.stats.diagCount || 0], ["查找表未用行", record.stats.unused || 0], ["等待确认单元格", record.stats.conflicts || 0]
  ];
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows), entrySheet = XLSX.utils.aoa_to_sheet(aoa);
  summarySheet["!cols"] = [{ wch: 20 }, { wch: 46 }];
  entrySheet["!cols"] = record.entryHeader.map((name) => ({ wch: Math.max(10, Math.min(32, String(name).length * 2 + 4)) })).concat([{ wch: 12 }, { wch: 12 }]);
  entrySheet["!autofilter"] = { ref: `A1:${colName(aoa[0].length - 1)}${aoa.length}` };
  XLSX.utils.book_append_sheet(workbook, summarySheet, "匹配摘要");
  XLSX.utils.book_append_sheet(workbook, entrySheet, "录入表(已填充)");
  const now = new Date(), pad = (part) => String(part).padStart(2, "0");
  XLSX.writeFile(workbook, `匹配记录-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`, { compression: true });
  toast("已按该条记录导出录入表");
}

/* ---------- 渲染 ---------- */
function renderAll() { renderSide("lookup"); renderSide("entry"); renderRules(); renderResult(); renderHistory(); }

function renderSide(kind) {
  const side = state[kind], meta = $(`#${kind}Meta`), preview = $(`#${kind}Preview`);
  if (!side) {
    meta.className = "file-meta empty"; meta.textContent = `尚未上传${SIDE_LABEL[kind]}`;
    preview.classList.add("hidden"); preview.innerHTML = "";
    return;
  }
  const columns = sideColumns(kind), dataCount = side.rows.slice(side.headerIndex + 1).filter(nonemptyRow).length;
  const originText = side.origin === "file" ? escapeHtml(side.fileName) : `粘贴的${SIDE_LABEL[kind]}`;
  const sizeText = side.origin === "file" ? `<span>${formatSize(side.size)}</span>` : "<span>粘贴文本</span>";
  const sheetControl = side.sheets
    ? `<label>工作表<select id="${kind}Sheet">${side.sheets.map((name) => `<option${name === side.sheetName ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>`
    : "";
  meta.className = "file-meta";
  meta.innerHTML = `<div class="file-name"><b title="${originText}">${originText}</b>${sizeText}</div>
    <div class="inline-controls">${sheetControl}<label>表头所在行<input id="${kind}Header" type="number" min="0" max="${Math.max(1, side.rows.length)}" step="1" value="${side.headerIndex + 1}"><small>填 0 表示无表头</small></label><label>数据规模<span>识别 ${columns.length} 列 · ${dataCount} 行数据</span></label></div>`;
  const sheetSelect = $(`#${kind}Sheet`);
  if (sheetSelect) sheetSelect.addEventListener("change", (event) => {
    const prev = { sheetName: side.sheetName, rows: side.rows, headerIndex: side.headerIndex };
    side.sheetName = event.target.value;
    try {
      side.rows = workbookRows(side.workbook, side.sheetName);
      side.headerIndex = autoHeaderIndex(side.rows);
      applySide(kind, side);
      toast(`已切换到工作表「${side.sheetName}」`);
    } catch (error) {
      side.sheetName = prev.sheetName; side.rows = prev.rows; side.headerIndex = prev.headerIndex;
      toast(error.message);
      renderSide(kind);
    }
  });
  $(`#${kind}Header`).addEventListener("change", (event) => {
    const value = Number(event.target.value);
    const prev = side.headerIndex;
    side.headerIndex = value <= 0 ? -1 : Math.min(value - 1, side.rows.length - 1);
    try { applySide(kind, side); }
    catch (error) { side.headerIndex = prev; toast(error.message); renderSide(kind); }
  });
  renderPreview(kind, columns);
}

function renderPreview(kind, columns) {
  const side = state[kind], host = $(`#${kind}Preview`);
  const start = Math.max(0, side.headerIndex);
  const previewRows = side.rows.slice(start, start + 4);
  if (!previewRows.length) { host.classList.add("hidden"); return; }
  const both = state.lookup && state.entry;
  const refCols = new Set((state.refPairs || []).filter(pairUsable).map((pair) => kind === "lookup" ? pair.lookupCol : pair.entryCol));
  const mapCols = new Set((state.fieldMaps || []).filter(pairUsable).map((pair) => kind === "lookup" ? pair.lookupCol : pair.entryCol));
  const width = Math.min(columns.length, 12);
  const headClass = (index) => both && refCols.has(index) ? "ref-col" : both && mapCols.has(index) ? "map-col" : "";
  const headCells = Array.from({ length: width }, (_, index) => `<th class="${headClass(index)}">${escapeHtml(columns[index] ? columns[index].label : `列${index + 1}`)}</th>`).join("");
  const bodyRows = previewRows.map((row) => `<tr>${Array.from({ length: width }, (_, index) => `<td>${escapeHtml(display(row ? row[index] : "")) || "&nbsp;"}</td>`).join("")}</tr>`).join("");
  host.className = "preview-wrap";
  host.innerHTML = `<table class="preview-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>
    <div class="preview-note">${side.headerIndex >= 0 ? "首行为表头" : "无表头模式"}${both ? " · 蓝色＝参考字段，绿色＝映射填充列" : ""}${columns.length > 12 ? ` · 预览仅显示前 12 列（共 ${columns.length} 列）` : ""}</div>`;
}

function columnOptions(columns, selected, usedSet) {
  const placeholder = `<option value="-1"${selected < 0 ? " selected" : ""} class="placeholder">请选择…</option>`;
  return placeholder + columns.map((column) => {
    const used = usedSet.has(column.index) && column.index !== selected;
    return `<option value="${column.index}"${column.index === selected ? " selected" : ""}${used ? " disabled" : ""}>${escapeHtml(column.label)}${used ? "（已使用）" : ""}</option>`;
  }).join("");
}
function renderRules() {
  const card = $("#rulesCard"), both = state.lookup && state.entry;
  card.classList.toggle("hidden", !both);
  if (!both) return;
  const lookupColumns = sideColumns("lookup"), entryColumns = sideColumns("entry");
  const refRows = state.refPairs.map((pair, index) => {
    const usedLookup = usedColumns(state.refPairs, index, "lookupCol");
    const usedEntry = usedColumns(state.refPairs, index, "entryCol");
    return `<div class="rule-row" data-kind="ref" data-index="${index}">
      <select data-ref-lookup="${index}" aria-label="查找表参考字段${index + 1}" class="${pair.lookupCol < 0 ? "empty-sel" : ""}">${columnOptions(lookupColumns, pair.lookupCol, usedLookup)}</select>
      <span class="rule-op">＝</span>
      <select data-ref-entry="${index}" aria-label="录入表参考字段${index + 1}" class="${pair.entryCol < 0 ? "empty-sel" : ""}">${columnOptions(entryColumns, pair.entryCol, usedEntry)}</select>
      <button class="rule-del" data-ref-del="${index}" type="button" title="删除该条件">✕</button>
    </div>`;
  }).join("") || "";
  $("#refRows").innerHTML = refRows;
  const mapRows = state.fieldMaps.map((pair, index) => {
    const usedLookup = usedColumns(state.refPairs.concat(state.fieldMaps), state.refPairs.length + index, "lookupCol");
    const usedEntry = usedColumns(state.refPairs.concat(state.fieldMaps), state.refPairs.length + index, "entryCol");
    return `<div class="rule-row map-row" data-kind="map" data-index="${index}">
      <select data-map-lookup="${index}" aria-label="查找表映射字段${index + 1}" class="${pair.lookupCol < 0 ? "empty-sel" : ""}">${columnOptions(lookupColumns, pair.lookupCol, usedLookup)}</select>
      <span class="rule-op">→</span>
      <select data-map-entry="${index}" aria-label="录入表映射字段${index + 1}" class="${pair.entryCol < 0 ? "empty-sel" : ""}">${columnOptions(entryColumns, pair.entryCol, usedEntry)}</select>
      <button class="rule-del" data-map-del="${index}" type="button" title="删除该映射">✕</button>
    </div>`;
  }).join("");
  $("#mapRows").innerHTML = mapRows || '<div class="rule-desc">尚未设置映射：匹配后将只标记每行的匹配状态，不填充数据。</div>';
  document.querySelectorAll(".logic-switch [data-logic]").forEach((button) => button.classList.toggle("active", button.dataset.logic === state.matchLogic));
  $("#refLogicDesc").textContent = state.matchLogic === "and"
    ? "所有条件都须同时匹配（联合关键字）"
    : "按条件顺序依次尝试，任一条件命中即匹配；参考值空白的条件自动跳过";
  $("#readyHint").textContent = both
    ? (state.refPairs.filter(pairUsable).length
      ? "就绪：修改规则或选项后自动重新匹配。"
      : "请至少设置一条完整的参考字段（两侧各选一列）。")
    : "请先上传两份表格。";
  const preflight = state.result && state.result.preflight;
  const box = $("#preflightBox");
  if (!preflight) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `<div class="pf-head">数据预检</div>` + (preflight.length
    ? preflight.map((item) => `<div class="pf-item${item.level === "warn" ? " warn" : ""}">${escapeHtml(item.text)}</div>`).join("")
    : '<div class="pf-item">预检通过：未发现影响匹配的格式问题</div>');
}

function renderResult() {
  const card = $("#resultCard"), result = state.result;
  card.classList.toggle("hidden", !result);
  if (!result) return;
  const stats = result.stats;
  const viewing = state.viewingRecordId ? state.history.find((rec) => rec.id === state.viewingRecordId) : null;
  $("#recordBanner").classList.toggle("hidden", !viewing);
  if (viewing) $("#recordBannerText").textContent = `正在查看 ${fmtTime(viewing.time)} 的匹配记录（规则与结果已定格）`;
  const metrics = [
    [stats.entryRows, "录入表数据行", ""],
    [stats.hit, "已匹配", "hit"],
    [stats.miss, "未找到", "miss"],
    [stats.blank, "参考为空", "warn"],
    [stats.cellsFilled, "填充单元格", ""],
    [stats.cellsOverwritten, "覆盖单元格", ""],
    [stats.lookupDupKeys, "查找表重复参考", ""],
    [stats.unused || 0, "查找表未用行", ""]
  ];
  if (stats.diagCount) metrics.push([stats.diagCount, "疑似可修复", "warn"]);
  if (stats.conflicts) metrics.push([stats.conflicts, "等待确认", "warn"]);
  $("#statsBar").innerHTML = metrics.map(([value, label, cls]) => `<div class="stat${cls ? ` ${cls}` : ""}"><b>${value.toLocaleString()}</b><span>${label}</span></div>`).join("");
  const total = Math.max(1, stats.entryRows);
  $("#hitSeg").style.width = `${(stats.hit / total) * 100}%`;
  $("#missSeg").style.width = `${((stats.miss + stats.blank) / total) * 100}%`;
  $("#hitText").textContent = `命中率 ${Math.round((stats.hit / total) * 100)}%（${stats.hit} / ${stats.entryRows}）`;
  $("#cntAll").textContent = stats.entryRows; $("#cntHit").textContent = stats.hit;
  $("#cntMiss").textContent = stats.miss; $("#cntBlank").textContent = stats.blank;
  $("#cntUnused").textContent = stats.unused || 0;
  const orMode = !!result.orMode;
  const refText = viewing ? viewing.refText : refPairText(orMode);
  $("#resultIntro").textContent = `${viewing ? "历史记录" : "参考字段"}（${orMode ? "或：任一条件命中" : "与：同时满足"}）：${refText}；映射填充 ${result.maps.length} 个字段。`;
  $("#resultHead").innerHTML = `<tr><th>录入表行号</th><th>参考值</th><th>状态</th>${result.maps.map((map) => `<th>${escapeHtml(map.label || columnLabel("entry", map.entryCol))}</th>`).join("")}</tr>`;
  if (state.filter === "unused") {
    const unusedRows = result.unused || [];
    $("#resultHead").innerHTML = `<tr><th>查找表行号</th><th>参考值</th>${result.auxLabel ? `<th>${escapeHtml(result.auxLabel)}</th>` : ""}</tr>`;
    const visibleUnused = unusedRows.slice(0, state.shown);
    $("#resultBody").innerHTML = visibleUnused.map((row) => `<tr><td class="rowcell">${row.rowNo}</td><td class="keycell">${escapeHtml(row.keyText || "（空）")}</td>${result.auxLabel ? `<td class="fieldcell">${escapeHtml(row.aux) || "&nbsp;"}</td>` : ""}</tr>`).join("");
    $("#emptyResult").classList.toggle("hidden", visibleUnused.length > 0);
    $("#loadMore").classList.toggle("hidden", unusedRows.length <= state.shown);
    $("#loadMore").textContent = `显示更多（剩余 ${(unusedRows.length - state.shown).toLocaleString()} 条）`;
    $("#resultFoot").textContent = `查找表共 ${stats.lookupRows.toLocaleString()} 行，其中 ${(stats.unused || 0).toLocaleString()} 行未被任何录入行命中（重复参考值中未取用的行也计入）。「导出录入表」不受本筛选影响；「复制结果」复制的是本视图。`;
    return;
  }
  const all = filteredRows(), visible = all.slice(0, state.shown);
  $("#resultBody").innerHTML = visible.map((row) => {
    const status = row.status === "hit"
      ? `<td class="status-hit">已匹配${row.dupCount > 1 ? `<span class="dup-badge" title="查找表中有 ${row.dupCount} 条相同参考值，已取第 1 条">重复 ${row.dupCount} 条</span>` : ""}${orMode && row.condLabel ? `<span class="cond-badge" title="该行命中的参考字段">按「${escapeHtml(row.condLabel)}」</span>` : ""}</td>`
      : row.status === "miss"
        ? `<td class="status-miss">未找到${row.diag ? `<span class="diag-badge" title="开启「${escapeHtml(row.diag.label)}」后可匹配到查找表第 ${row.diag.rowNo} 行">疑似可匹配</span>` : ""}</td>`
        : '<td class="status-blank">参考为空</td>';
    const fieldCells = result.maps.map((map) => {
      if (row.status !== "hit") return '<td class="fieldcell na">—</td>';
      const fill = row.fills[map.entryCol];
      if (!fill) return `<td class="fieldcell">${escapeHtml(display(row.cells[map.entryCol])) || "&nbsp;"}</td>`;
      if (fill.type === "filled") return `<td class="fieldcell">${escapeHtml(fill.value) || "&nbsp;"}</td>`;
      if (fill.type === "confirm") return `<td class="fieldcell">${escapeHtml(fill.orig)}<span class="conf-badge" title="等待确认：匹配新值「${escapeHtml(fill.value)}」，可在填充策略为「确认后覆盖」时处理">待确认</span></td>`;
      if (fill.type === "overwritten") return `<td class="fieldcell">${escapeHtml(fill.value)}<span class="cover-badge" title="原值「${escapeHtml(fill.orig)}」已被覆盖">已覆盖</span></td>`;
      return `<td class="fieldcell">${escapeHtml(fill.orig)}${fill.value === fill.orig ? "" : '<span class="keep-badge" title="该单元格已有内容，未开启覆盖">保留原值</span>'}</td>`;
    }).join("");
    return `<tr${row.status === "hit" ? "" : row.status === "miss" ? ' class="miss-row"' : ' class="blank-row"'}><td class="rowcell">${row.rowNo}</td><td class="keycell">${escapeHtml(row.keyText || "（空）")}</td>${status}${fieldCells}</tr>`;
  }).join("");
  $("#emptyResult").classList.toggle("hidden", visible.length > 0);
  $("#loadMore").classList.toggle("hidden", all.length <= state.shown);
  $("#loadMore").textContent = `显示更多（剩余 ${(all.length - state.shown).toLocaleString()} 条）`;
  const filterText = { all: "全部结果", hit: "已匹配", miss: "未找到", blank: "参考为空", unused: "查找表未用行" }[state.filter] || "全部结果";
  $("#resultFoot").textContent = `共 ${result.rows.length.toLocaleString()} 条录入行，当前筛选「${filterText}」${all.length.toLocaleString()} 条，页面显示 ${visible.length.toLocaleString()} 条。「导出录入表」始终导出全部行：原始录入表内容 + 已填充/保留的字段 + 匹配状态列。`;
}
function columnLabel(kind, index) {
  const column = sideColumns(kind).find((item) => item.index === index);
  return column ? column.label : `列${index + 1}`;
}
function filteredRows() {
  if (!state.result) return [];
  if (state.filter === "hit") return state.result.rows.filter((row) => row.status === "hit");
  if (state.filter === "miss") return state.result.rows.filter((row) => row.status === "miss");
  if (state.filter === "blank") return state.result.rows.filter((row) => row.status === "blank");
  return state.result.rows.slice();
}

/* ---------- 复制 / 导出 ---------- */
// 粘贴进 Excel/WPS 时，以 = + - @ 开头的文本会被解释为公式；加前缀 ' 强制按文本处理
function tsvCell(value) {
  const text = display(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (error) {
    const area = document.createElement("textarea");
    area.value = text; area.style.cssText = "position:fixed;top:-999px;opacity:0";
    document.body.appendChild(area); area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (copyError) { ok = false; }
    area.remove();
    return ok;
  }
}
async function copyResult() {
  if (!state.result) return toast("请先完成一次匹配");
  if (state.filter === "unused") {
    const rows = state.result.unused, auxLabel = state.result.auxLabel;
    if (!rows.length) return toast("没有未被使用的查找表行");
    const lines = [["查找表行号", "参考值", ...(auxLabel ? [auxLabel] : [])].join("\t")];
    rows.forEach((row) => lines.push([row.rowNo, tsvCell(row.keyText), ...(auxLabel ? [tsvCell(row.aux)] : [])].join("\t")));
    const ok = await copyText(lines.join("\r\n"));
    return toast(ok ? `已复制 ${rows.length.toLocaleString()} 行未用记录到剪贴板` : "复制失败，请手动选择结果表格复制");
  }
  const rows = filteredRows();
  if (!rows.length) return toast("当前筛选下没有可复制的行");
  const maps = state.result.maps, orMode = !!state.result.orMode;
  const statusText = { hit: "已匹配", miss: "未找到", blank: "参考为空" };
  const lines = [["录入表行号", "参考值", "状态", ...(orMode ? ["匹配条件"] : []), ...maps.map((map) => map.label || columnLabel("entry", map.entryCol))].join("\t")];
  rows.forEach((row) => {
    lines.push([row.rowNo, tsvCell(row.keyText), statusText[row.status], ...(orMode ? [tsvCell(row.condLabel || "")] : []),
      ...maps.map((map) => row.status === "hit" ? tsvCell(row.cells[map.entryCol]) : "")].join("\t"));
  });
  const ok = await copyText(lines.join("\r\n"));
  toast(ok ? `已复制 ${rows.length.toLocaleString()} 行到剪贴板，可直接粘贴进 Excel / WPS` : "复制失败，请手动选择结果表格复制");
}
function colName(index) {
  let name = "", n = index + 1;
  while (n > 0) { const rest = (n - 1) % 26; name = String.fromCharCode(65 + rest) + name; n = Math.floor((n - 1) / 26); }
  return name;
}
function exportEntry() {
  if (state.viewingRecordId) {
    const record = state.history.find((item) => item.id === state.viewingRecordId);
    if (record && record.rows) return exportRecord(record);
    return toast("该记录未保存明细，无法导出");
  }
  if (!state.result) return toast("请先完成一次匹配");
  const result = state.result, entry = state.entry;
  const statusText = { hit: "已匹配", miss: "未找到", blank: "参考为空" };
  const orMode = !!result.orMode;
  const header = buildEntryHeader();
  const aoa = [header.concat(orMode ? ["匹配状态", "匹配条件"] : ["匹配状态"])];
  result.rows.forEach((row) => aoa.push(Array.from({ length: header.length }, (_, index) => display(row.cells[index]))
    .concat(orMode ? [statusText[row.status], row.condLabel || ""] : [statusText[row.status]])));
  if (aoa.length > LIMITS.exportRows) return toast(`录入表共 ${(aoa.length - 1).toLocaleString()} 行，超过 Excel 单表上限，无法导出`);
  const optionText = matchOptionText();
  const refText = refPairText(result.orMode) + (result.orMode ? "（或：任一条件命中）" : "（与：同时满足）");
  const mapText = result.maps.map((map) => `${columnLabel("lookup", map.lookupCol)} → ${columnLabel("entry", map.entryCol)}`).join("、") || "（无）";
  const summaryRows = [
    ["数据自动匹配报告"], ["生成时间", new Date().toLocaleString("zh-CN", { hour12: false })],
    ["查找表", state.lookup.origin === "file" ? `${state.lookup.fileName}（工作表：${state.lookup.sheetName}）` : "粘贴文本"],
    ["录入表", entry.origin === "file" ? `${entry.fileName}（工作表：${entry.sheetName}）` : "粘贴文本"],
    ["参考字段", refText], ["字段映射", mapText], ["匹配选项", optionText], [],
    ["统计项", "数量"], ["查找表数据行", result.stats.lookupRows], ["查找表重复参考", result.stats.lookupDupKeys], ["查找表空白参考", result.stats.lookupBlankKeys],
    ["录入表数据行", result.stats.entryRows], ["已匹配", result.stats.hit], ["未找到", result.stats.miss], ["参考为空", result.stats.blank],
    ["填充单元格", result.stats.cellsFilled], ["覆盖单元格", result.stats.cellsOverwritten], ["保留原值单元格", result.stats.cellsKept],
    ["疑似可修复(格式差异)", result.stats.diagCount], ["查找表未用行", result.stats.unused],
    ["等待确认单元格", result.stats.conflicts]
  ];
  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows), entrySheet = XLSX.utils.aoa_to_sheet(aoa);
  summarySheet["!cols"] = [{ wch: 20 }, { wch: 46 }];
  entrySheet["!cols"] = header.map((name) => ({ wch: Math.max(10, Math.min(32, String(name).length * 2 + 4)) })).concat([{ wch: 12 }]);
  entrySheet["!autofilter"] = { ref: `A1:${colName(aoa[0].length - 1)}${aoa.length}` };
  XLSX.utils.book_append_sheet(workbook, summarySheet, "匹配摘要");
  XLSX.utils.book_append_sheet(workbook, entrySheet, "录入表(已填充)");
  const now = new Date(), pad = (part) => String(part).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  XLSX.writeFile(workbook, `录入表-已填充-${stamp}.xlsx`, { compression: true });
  toast("录入表已导出（含填充结果与匹配状态）");
}

/* ---------- AI 智能辅助：经数智学工主系统代理调用，只传输表头名称与统计元数据，不发送任何单元格数据 ---------- */
function parentWorkbench() {
  try { if (window.parent && window.parent !== window && typeof window.parent.aiChat === "function" && typeof window.parent.aiConfigured === "function") return window.parent; } catch (error) {}
  return null;
}
function aiReady() { const parent = parentWorkbench(); return !!(parent && parent.aiConfigured()); }
function openAiConfig() {
  const parent = parentWorkbench();
  if (parent && typeof parent.goto === "function") parent.goto("apiconfig");
  else toast("AI 功能需要在数智学工系统内使用，并已在「AI 智能 → API配置」完成配置");
}
async function aiCall(system, user, button) {
  const parent = parentWorkbench();
  if (!parent) throw new Error("AI 功能需要在数智学工系统内使用（未检测到主系统 AI 代理）");
  const original = button.textContent;
  button.disabled = true; button.textContent = "AI 处理中…";
  try { return await parent.aiChat(system, user, "dataMatch"); }
  finally { button.disabled = false; button.textContent = original; }
}
function parseAiJson(raw) {
  const body = String(raw || "").replace(/```json/gi, "```").split("```").map((part) => part.trim()).find((part) => part.startsWith("{"));
  const text = body || String(raw || "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未返回有效的 JSON 结果");
  return JSON.parse(text.slice(start, end + 1));
}
function showAiPanel(html) {
  const panel = $("#aiPanel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = html;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
function hideAiPanel() { const panel = $("#aiPanel"); if (panel) { panel.classList.add("hidden"); panel.innerHTML = ""; } }
function aiHeadersPayload(kind) {
  const columns = sideColumns(kind);
  return { rowCount: sideDataRows(kind).length, headers: columns.map((column) => ({ col: column.index, name: column.raw || column.label })) };
}
function aiStatsPayload() {
  const result = state.result;
  if (!result) return null;
  const o = state.options;
  return {
    logic: result.orMode ? "或（任一条件命中）" : "与（同时满足）",
    refText: refPairText(result.orMode),
    fillMode: { blank: "仅填充空白", confirm: "确认后覆盖", overwrite: "覆盖已有内容" }[o.fillMode] || o.fillMode,
    options: { trim: !!o.trim, allSpaces: !!o.allSpaces, caseInsensitive: !!o.caseInsensitive, fullWidth: !!o.fullWidth, numeric: !!o.numeric, invisible: !!o.invisible },
    stats: {
      lookupRows: result.stats.lookupRows, entryRows: result.stats.entryRows, hit: result.stats.hit, miss: result.stats.miss, blank: result.stats.blank,
      lookupDupKeys: result.stats.lookupDupKeys, cellsFilled: result.stats.cellsFilled, cellsKept: result.stats.cellsKept,
      cellsOverwritten: result.stats.cellsOverwritten, diagCount: result.stats.diagCount || 0, unused: result.stats.unused || 0, conflicts: result.stats.conflicts || 0
    },
    preflight: (result.preflight || []).map((item) => item.text)
  };
}
function aiGuard() {
  if (!aiReady()) { toast("AI 尚未配置：请在「AI 智能 → API配置」完成配置"); openAiConfig(); return false; }
  return true;
}
async function runAiRules(button) {
  if (!state.lookup || !state.entry) return toast("请先上传查找表和录入表");
  if (!aiGuard()) return;
  const payload = {
    lookupTable: aiHeadersPayload("lookup"),
    entryTable: aiHeadersPayload("entry"),
    current: {
      refs: state.refPairs.filter(pairUsable).map((pair) => [pair.lookupCol, pair.entryCol]),
      maps: state.fieldMaps.filter(pairUsable).map((pair) => [pair.lookupCol, pair.entryCol]),
      logic: state.matchLogic
    }
  };
  try {
    const system = '你是两份学生数据表格的匹配规则助手。输入 JSON 包含查找表与录入表的表头列表（col 为 0 起始列下标）和数据行数，不含任何单元格数据。请给出匹配规则建议：refPairs 为参考字段对（两表中语义对应且唯一性强的列，如学号/考生号/证件号/工号；多条件时按区分度从高到低排列，通常 1-2 条即可）；maps 为字段映射（查找表中除参考字段外、录入表也存在同义列的字段，如 姓名/学生姓名、班级/行政班级、宿舍/宿舍楼）。严格只输出一个 JSON 对象：{"refPairs":[{"lookupCol":0,"entryCol":0}],"maps":[{"lookupCol":1,"entryCol":1}],"summary":"一句话中文说明"}。硬性要求：列下标必须真实存在；refPairs 内 lookupCol、entryCol 各自不得重复；maps 内 entryCol 不得与 refPairs 或其他 maps 重复，lookupCol 不得与 refPairs 或其他 maps 重复；表头含义不确定的列不要使用；若 current 中已有合理规则，仅做必要修正。';
    const result = parseAiJson(await aiCall(system, JSON.stringify(payload), button));
    const lookupCount = sideColumns("lookup").length, entryCount = sideColumns("entry").length;
    const usedLookup = new Set(), usedEntry = new Set();
    const refs = [], maps = [], skipped = [];
    (Array.isArray(result.refPairs) ? result.refPairs : []).forEach((pair) => {
      const l = Number(pair && pair.lookupCol), e = Number(pair && pair.entryCol);
      if (!Number.isInteger(l) || !Number.isInteger(e) || l < 0 || l >= lookupCount || e < 0 || e >= entryCount) { skipped.push("参考字段（列下标无效）"); return; }
      if (usedLookup.has(l) || usedEntry.has(e)) { skipped.push("参考字段（列重复）"); return; }
      usedLookup.add(l); usedEntry.add(e); refs.push({ lookupCol: l, entryCol: e });
    });
    (Array.isArray(result.maps) ? result.maps : []).forEach((pair) => {
      const l = Number(pair && pair.lookupCol), e = Number(pair && pair.entryCol);
      if (!Number.isInteger(l) || !Number.isInteger(e) || l < 0 || l >= lookupCount || e < 0 || e >= entryCount) { skipped.push("映射（列下标无效）"); return; }
      if (usedLookup.has(l) || usedEntry.has(e)) { skipped.push("映射（列重复或与参考字段冲突）"); return; }
      usedLookup.add(l); usedEntry.add(e); maps.push({ lookupCol: l, entryCol: e });
    });
    if (!refs.length) {
      showAiPanel(`<div class="ai-head">✨ AI 规则建议</div><div class="ai-text">AI 未返回可用的参考字段建议，请保持当前规则或手动设置。</div>${skipped.length ? `<div class="ai-note">已忽略无效建议：${escapeHtml(skipped.join("；"))}</div>` : ""}`);
      return;
    }
    state.refPairs = refs;
    state.fieldMaps = maps;
    state.result = null;
    scheduleMatch();
    const notes = String(result.summary || "").trim();
    showAiPanel(`<div class="ai-head">✨ AI 规则建议已应用</div>${notes ? `<div class="ai-text">${escapeHtml(notes)}</div>` : ""}
      <div class="ai-note">已设置 <b>${refs.length}</b> 条参考字段、<b>${maps.length}</b> 条字段映射${skipped.length ? `；忽略无效建议 ${skipped.length} 条（${escapeHtml(skipped.join("；"))}）` : ""}。AI 仅接收了两表的表头名称与行数，未发送任何单元格数据；请在下方复核规则后查看匹配结果。</div>`);
    toast("AI 规则建议已应用，请复核");
  } catch (error) {
    showAiPanel(`<div class="ai-head">✨ AI 规则建议失败</div><div class="ai-text">${escapeHtml(error && error.message ? error.message : String(error))}</div><div class="ai-note">可稍后重试，或继续手动设置规则；AI 不可用不影响本机匹配。</div>`);
  }
}
async function runAiDiagnose(button) {
  if (!state.result) return toast("请先完成一次匹配");
  if (!aiGuard()) return;
  const payload = aiStatsPayload();
  if (!payload) return;
  try {
    const system = '你是学生数据表格匹配的排查顾问。输入 JSON 只包含匹配统计、已开启的选项与格式预检提示（不含任何姓名、学号等单元格数据）。请用中文给出简明排查建议：先判断最可能的原因（如类型/空格/全角差异、重复参考值、参考值为空、录入表已有内容冲突），再对应到本工具的具体操作（开启哪个匹配选项、切换与/或逻辑、调整填充策略、核对数据源）。输出 3-6 条要点，每条一行、以"·"开头，总长不超过 200 字；只依据统计中存在的现象，不要编造。';
    const text = String(await aiCall(system, JSON.stringify(payload), button) || "").trim();
    showAiPanel(`<div class="ai-head">🩺 AI 诊断建议</div><div class="ai-text">${escapeHtml(text) || "（AI 未返回内容）"}</div><div class="ai-note">AI 仅接收了匿名统计与预检提示，未发送任何单元格数据；建议仅供参考。</div>`);
  } catch (error) {
    showAiPanel(`<div class="ai-head">🩺 AI 诊断失败</div><div class="ai-text">${escapeHtml(error && error.message ? error.message : String(error))}</div>`);
  }
}
async function runAiBriefing(button) {
  if (!state.result) return toast("请先完成一次匹配");
  if (!aiGuard()) return;
  const payload = aiStatsPayload();
  if (!payload) return;
  try {
    const system = "你是高校辅导员的学工数据处理助手。输入 JSON 是一次数据匹配的匿名统计（行数、命中数、未找到数、参考为空数、填充与保留统计等，不含任何姓名学号）。请生成一段可直接用于工作汇报的简报：80-150 字，说明本次核对的对象规模、匹配结果、主要异常与下一步处理建议（如补全名单、核对未找到项、处理待确认覆盖）；用中文陈述句，不出现具体姓名学号，不使用 markdown 标记。";
    const text = String(await aiCall(system, JSON.stringify(payload), button) || "").trim();
    showAiPanel(`<div class="ai-head">📝 AI 匹配简报</div><div class="ai-text">${escapeHtml(text) || "（AI 未返回内容）"}</div><div class="ai-actions-row"><button id="aiCopyBrief" class="ghost small" type="button">复制简报</button></div><div class="ai-note">AI 仅接收了匿名统计，未发送任何单元格数据；简报仅供参考，请核对后使用。</div>`);
    const copyButton = $("#aiCopyBrief");
    if (copyButton) copyButton.addEventListener("click", async () => {
      const ok = await copyText(text);
      toast(ok ? "简报已复制到剪贴板" : "复制失败，请手动选择文本复制");
    });
  } catch (error) {
    showAiPanel(`<div class="ai-head">📝 AI 简报失败</div><div class="ai-text">${escapeHtml(error && error.message ? error.message : String(error))}</div>`);
  }
}

/* ---------- 调度 ---------- */
function scheduleMatch() { runMatch(); renderAll(); }
const debouncedMatch = debounce(scheduleMatch, 260);

const KIND_ID = { lookup: "Lookup", entry: "Entry" };
function switchTab(kind, which) {
  const id = KIND_ID[kind], upload = which === "upload";
  $(`#tab${id}Upload`).classList.toggle("active", upload);
  $(`#tab${id}Paste`).classList.toggle("active", !upload);
  $(`#tab${id}Upload`).setAttribute("aria-selected", String(upload));
  $(`#tab${id}Paste`).setAttribute("aria-selected", String(!upload));
  $(`#pane${id}Upload`).classList.toggle("hidden", !upload);
  $(`#pane${id}Paste`).classList.toggle("hidden", upload);
}

const DEMO_LOOKUP = [
  ["学号", "姓名", "性别", "班级", "专业", "辅导员", "宿舍楼"],
  ["2023010101", "陈嘉言", "男", "计算机2301", "计算机科学与技术", "李文静", "紫荆1号楼"],
  ["2023010102", "苏晚晴", "女", "计算机2301", "计算机科学与技术", "李文静", "紫荆1号楼"],
  ["2023010103", "林逾静", "男", "软工2302", "软件工程", "周明礼", "紫荆2号楼"],
  ["2023010104", "沈书白", "女", "软工2302", "软件工程", "周明礼", "紫荆2号楼"],
  ["2023010105", "顾北辰", "男", "网络2301", "网络工程", "李文静", "丹枫3号楼"],
  ["2023010106", "何笑天", "男", "网络2301", "网络工程", "李文静", "丹枫3号楼"],
  ["2023010107", "闻人语", "女", "大数据2301", "数据科学与大数据技术", "赵青禾", "丹枫3号楼"],
  ["2023010108", "江疏桐", "女", "大数据2301", "数据科学与大数据技术", "赵青禾", "紫荆2号楼"],
  ["2023010109", "秦朗", "男", "物联网2301", "物联网工程", "周明礼", "紫荆1号楼"],
  ["2023010110", "叶知秋", "女", "物联网2301", "物联网工程", "周明礼", "紫荆1号楼"],
  ["2023010111", "陆修远", "男", "信安2301", "信息安全", "赵青禾", "丹枫5号楼"],
  ["2023010112", "白若曦", "女", "信安2301", "信息安全", "赵青禾", "丹枫5号楼"]
].map((row) => row.join("\t")).join("\n");
const DEMO_ENTRY = [
  ["学号", "姓名", "班级", "宿舍楼"],
  ["2023010101", "陈嘉言", "", ""],
  ["2023010103", "林逾静", "", ""],
  ["2023010105", "顾北辰", "", ""],
  ["2023010107", "闻人语", "", ""],
  ["2023010109", "", "", ""],
  [" 2023010110 ", "", "", ""],
  ["2023010112", "白若曦", "", ""],
  ["2023010199", "王测试", "", ""]
].map((row) => row.join("\t")).join("\n");

function loadDemo() {
  switchTab("lookup", "paste"); switchTab("entry", "paste");
  state.matchLogic = "and";
  $("#lookupPaste").value = DEMO_LOOKUP;
  $("#entryPaste").value = DEMO_ENTRY;
  lastPasteToast.lookup = ""; lastPasteToast.entry = "";
  loadSideFromText("lookup", DEMO_LOOKUP);
  loadSideFromText("entry", DEMO_ENTRY);
  toast("示例已载入：已按同名列自动设置规则，可导出录入表查看效果");
}
function clearAll() {
  state.lookup = null; state.entry = null; state.refPairs = []; state.fieldMaps = [];
  state.matchLogic = "and";
  state.result = null; state.filter = "all"; state.shown = LIMITS.previewRows;
  state.viewingRecordId = null;  // 匹配记录本身保留
  state.confirmConflicts = []; state.confirmChoices = new Map();
  $("#confirmMask").classList.add("hidden");
  hideAiPanel();
  ["lookup", "entry"].forEach((kind) => {
    $(`#${kind}Paste`).value = ""; $(`#${kind}File`).value = "";
    lastPasteToast[kind] = "";
    switchTab(kind, "upload");
  });
  renderAll();
  toast("已清空，可以重新开始");
}

/* ---------- 事件绑定 ---------- */
["lookup", "entry"].forEach((kind) => {
  $(`#${kind}File`).addEventListener("change", (event) => { const file = event.target.files[0]; readSide(kind, file); event.target.value = ""; });
  $(`#${kind}Paste`).addEventListener("input", kind === "lookup" ? reparseLookup : reparseEntry);
  $(`#tab${KIND_ID[kind]}Upload`).addEventListener("click", () => switchTab(kind, "upload"));
  $(`#tab${KIND_ID[kind]}Paste`).addEventListener("click", () => switchTab(kind, "paste"));
  const card = $(`#${kind}Card`);
  card.addEventListener("dragover", (event) => { event.preventDefault(); card.classList.add("dragover"); });
  card.addEventListener("dragleave", () => card.classList.remove("dragover"));
  card.addEventListener("drop", (event) => {
    event.preventDefault(); card.classList.remove("dragover");
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) { switchTab(kind, "upload"); readSide(kind, file); }
  });
});

$("#refRows").addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.refLookup !== undefined) state.refPairs[Number(target.dataset.refLookup)].lookupCol = Number(target.value);
  else if (target.dataset.refEntry !== undefined) state.refPairs[Number(target.dataset.refEntry)].entryCol = Number(target.value);
  else return;
  state.result = null; state.shown = LIMITS.previewRows;
  debouncedMatch(); renderRules();
});
$("#mapRows").addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.mapLookup !== undefined) state.fieldMaps[Number(target.dataset.mapLookup)].lookupCol = Number(target.value);
  else if (target.dataset.mapEntry !== undefined) state.fieldMaps[Number(target.dataset.mapEntry)].entryCol = Number(target.value);
  else return;
  state.result = null; state.shown = LIMITS.previewRows;
  debouncedMatch(); renderRules();
});
document.querySelectorAll("[data-logic]").forEach((button) => button.addEventListener("click", () => {
  if (state.matchLogic === button.dataset.logic) return;
  state.matchLogic = button.dataset.logic;
  state.result = null;
  scheduleMatch();
}));
$("#refRows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ref-del]");
  if (!button) return;
  state.refPairs.splice(Number(button.dataset.refDel), 1);
  state.result = null; debouncedMatch(); renderRules();
});
$("#mapRows").addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-del]");
  if (!button) return;
  state.fieldMaps.splice(Number(button.dataset.mapDel), 1);
  state.result = null; debouncedMatch(); renderRules();
});
$("#addRef").addEventListener("click", () => { state.refPairs.push({ lookupCol: -1, entryCol: -1 }); renderRules(); });
$("#addMap").addEventListener("click", () => { state.fieldMaps.push({ lookupCol: -1, entryCol: -1 }); renderRules(); });
$("#autoRules").addEventListener("click", () => { autoRules(); state.result = null; scheduleMatch(); renderRules(); toast("已按两表同名字段重新生成规则"); });

["optTrim", "optSpaces", "optCase", "optWidth", "optNumeric", "optInvisible"].forEach((id, index) => $("#" + id).addEventListener("change", (event) => {
  state.options[["trim", "allSpaces", "caseInsensitive", "fullWidth", "numeric", "invisible"][index]] = event.target.checked;
  scheduleMatch();
}));
$("#fillMode").addEventListener("change", (event) => { state.options.fillMode = event.target.value; scheduleMatch(); });
$("#runMatch").addEventListener("click", () => {
  if (!state.lookup || !state.entry) return toast("请先上传查找表和录入表");
  if (!state.refPairs.filter(pairUsable).length) return toast("请至少设置一条完整的参考字段（两侧各选一列）");
  scheduleMatch();
  $("#resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
  toast(state.result ? `匹配完成：命中 ${state.result.stats.hit} 行，未找到 ${state.result.stats.miss} 行` : "没有可匹配的数据");
});
$("#aiRules").addEventListener("click", (event) => runAiRules(event.currentTarget));
$("#aiDiag").addEventListener("click", (event) => runAiDiagnose(event.currentTarget));
$("#aiBrief").addEventListener("click", (event) => runAiBriefing(event.currentTarget));
$("#clearAll").addEventListener("click", clearAll);
$("#loadDemo").addEventListener("click", loadDemo);
$("#copyButton").addEventListener("click", copyResult);
$("#exportButton").addEventListener("click", exportEntry);
$("#loadMore").addEventListener("click", () => { state.shown += LIMITS.previewRows; renderResult(); });
$("#filterTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter; state.shown = LIMITS.previewRows;
  document.querySelectorAll("#filterTabs .tab").forEach((tab) => tab.classList.toggle("active", tab === button));
  renderResult();
});
$("#historyList").addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-rec-view]");
  if (viewButton) return viewRecord(viewButton.dataset.recView);
  const exportButton = event.target.closest("[data-rec-export]");
  if (exportButton) {
    const record = state.history.find((item) => item.id === exportButton.dataset.recExport);
    if (record && record.rows) exportRecord(record);
    return;
  }
  const delButton = event.target.closest("[data-rec-del]");
  if (!delButton) return;
  try { await ToolHistory.remove("dataMatch", delButton.dataset.recDel); }
  catch (error) { toast("删除失败：" + error.message); return; }
  state.history = state.history.filter((item) => item.id !== delButton.dataset.recDel);
  renderHistory();
  if (state.viewingRecordId === delButton.dataset.recDel) { state.viewingRecordId = null; runMatch(); }
  renderResult();
  toast("已删除该条匹配记录");
});
$("#backToLive").addEventListener("click", () => { runMatch(); renderAll(); });
$("#cbList").addEventListener("click", (event) => {
  const button = event.target.closest(".choice");
  if (!button) return;
  state.confirmChoices.set(button.dataset.key, button.dataset.pick);
  renderConfirmModal();
});
$("#cbOverwriteAll").addEventListener("click", () => {
  state.confirmConflicts.forEach(({ row, entryCol }) => state.confirmChoices.set(`${row.rowNo}#${entryCol}`, "overwrite"));
  renderConfirmModal();
});
$("#cbKeepAll").addEventListener("click", () => {
  state.confirmConflicts.forEach(({ row, entryCol }) => state.confirmChoices.set(`${row.rowNo}#${entryCol}`, "keep"));
  renderConfirmModal();
});
$("#cbPrev").addEventListener("click", () => { state.confirmPage -= 1; renderConfirmModal(); });
$("#cbNext").addEventListener("click", () => { state.confirmPage += 1; renderConfirmModal(); });
$("#cbApply").addEventListener("click", () => applyConfirmDecisions(false));
$("#cbCancel").addEventListener("click", () => {
  state.confirmConflicts.forEach(({ row, entryCol }) => state.confirmChoices.set(`${row.rowNo}#${entryCol}`, "keep"));
  applyConfirmDecisions(true);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || $("#confirmMask").classList.contains("hidden")) return;
  state.confirmConflicts.forEach(({ row, entryCol }) => state.confirmChoices.set(`${row.rowNo}#${entryCol}`, "keep"));
  applyConfirmDecisions(true);
});
$("#clearHistory").addEventListener("click", async () => {
  if (!state.history.length) return;
  if (!confirm(`确定清空全部 ${state.history.length} 条匹配记录？此操作不可恢复。`)) return;
  try { await ToolHistory.clear("dataMatch"); }
  catch (error) { toast("清空失败：" + error.message); return; }
  state.history = []; state.viewingRecordId = null;
  renderHistory();
  runMatch(); renderResult();
  toast("匹配记录已清空");
});

window.DataMatchApp = { state, runMatch, renderAll, autoRules, sideColumns, pairUsable, LIMITS };
loadHistory().finally(renderAll);
