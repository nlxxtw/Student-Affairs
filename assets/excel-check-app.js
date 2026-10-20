"use strict";

const $ = (selector) => document.querySelector(selector);
const state = {
  reference: null,
  target: null,
  mappings: [],
  result: null,
  filter: "problems",
  query: "",
  shown: 500,
  mappingDirty: false,
  historyLoaded: false,
  options: { trim: true, ignoreSpaces: false, caseInsensitive: false, numeric: true, dateEquiv: true }
};
const LIMITS = { fileBytes: 30 * 1024 * 1024, dataRows: 200000, previewRows: 500, exportRows: 1048576 };
const FORMAT_RE = /\.(xlsx|xlsm|xlsb|xlt|xltm|xltx|xls|et|ett|ods|fods|ots|csv|txt|dif|prn|xml|htm|html)$/i;
const TEXT_FORMAT_RE = /\.(csv|txt|dif|prn|xml|fods|htm|html)$/i;

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
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2800); }
function setBusy(active, message = "正在读取 Excel，请稍候…") { $("#busy").classList.toggle("hidden", !active); $("#busy b").textContent = message; }
function normalizeHeader(value) { return display(value).trim().replace(/[\s　_\-（）()【】\[\]：:]/g, "").toLowerCase(); }
function nonemptyRow(row) { return Array.isArray(row) && row.some((value) => display(value).trim() !== ""); }

function decodeTextBytes(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) { return new TextDecoder("gbk").decode(bytes); }
}
function dateKey(text) {
  const parts = text.split(/[\sT]+/).filter(Boolean);
  if (parts.length > 2) return "";
  const match = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/.exec(parts[0] || "");
  if (!match) return "";
  const month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  if (parts[1] && !/^0{1,2}[：:]0{1,2}(?:[：:]0{1,2})?(?:\.\d+)?$/.test(parts[1])) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${match[1]}-${pad(month)}-${pad(day)}`;
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
  return bestIndex;
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
async function readSide(kind, file) {
  if (!file) return;
  if (!FORMAT_RE.test(file.name || "")) return toast("仅支持 Excel / WPS 表格文件（.xlsx、.xls、.et 等）及 CSV、TXT 文本");
  if (file.size > LIMITS.fileBytes) return toast("单个文件不能超过 30 MB");
  setBusy(true, `正在读取：${file.name}`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asText = TEXT_FORMAT_RE.test(file.name || "");
    const workbook = XLSX.read(asText ? decodeTextBytes(bytes) : bytes, { type: asText ? "string" : "array", cellDates: true });
    const sheets = visibleSheetNames(workbook);
    if (!sheets.length) throw new Error("文件中没有可读取的工作表");
    const sheetName = sheets[0], rows = workbookRows(workbook, sheetName), headerIndex = autoHeaderIndex(rows);
    if (!rows.some(nonemptyRow)) throw new Error("工作表中没有可读取的数据");
    const dataCount = rows.slice(headerIndex + 1).filter(nonemptyRow).length;
    if (dataCount > LIMITS.dataRows) throw new Error(`“${file.name}”约有 ${dataCount.toLocaleString()} 条数据，超过 ${LIMITS.dataRows.toLocaleString()} 条上限`);
    state[kind] = { file, workbook, sheets, sheetName, rows, headerIndex };
    state.result = null;
    state.historyLoaded = false;
    autoMap();
    renderAll();
    toast(`${kind === "reference" ? "参考数据" : "待核对数据"}已读取`);
  } catch (error) {
    toast(`读取失败：${error.message || "文件可能已损坏、加密或格式不受支持"}`);
    renderAll();
  } finally { setBusy(false); }
}
function sideColumns(kind) {
  const side = state[kind];
  if (!side) return [];
  const row = side.rows[side.headerIndex] || [], seen = new Map();
  return Array.from({ length: row.length }, (_, index) => {
    const raw = display(row[index]).trim(), base = raw || `未命名列${index + 1}`, count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { index, raw, label: count > 1 ? `${base}（${count}）` : base };
  });
}
function sideDataRows(kind) {
  const side = state[kind], start = side.headerIndex + 1;
  const rows = side.rows.slice(start).map((cells, index) => ({ rowNo: start + index + 1, cells: cells || [] })).filter((item) => nonemptyRow(item.cells));
  if (rows.length > LIMITS.dataRows) throw new Error(`“${side.file.name}”超过 ${LIMITS.dataRows.toLocaleString()} 条非空数据限制`);
  return rows;
}
function autoMap() {
  const referenceColumns = sideColumns("reference"), targetColumns = sideColumns("target"), targetByName = new Map();
  targetColumns.forEach((column) => { const key = normalizeHeader(column.raw); if (key && !targetByName.has(key)) targetByName.set(key, column.index); });
  let keyIndex = referenceColumns.findIndex((column) => /^(学号|学生编号|人员编号|编号|id|唯一标识|证件号|身份证号)$/.test(normalizeHeader(column.raw)));
  if (keyIndex < 0) keyIndex = referenceColumns.findIndex((column) => targetByName.has(normalizeHeader(column.raw)));
  state.mappings = referenceColumns.map((column, index) => {
    const targetIndex = targetByName.has(normalizeHeader(column.raw)) ? targetByName.get(normalizeHeader(column.raw)) : -1;
    return { refIndex: column.index, targetIndex, key: index === keyIndex && targetIndex >= 0, compare: index !== keyIndex && targetIndex >= 0 };
  });
  state.mappingDirty = false;
  state.result = null;
}

function renderSide(kind) {
  const side = state[kind], host = $(`#${kind}Meta`);
  if (!side) { host.className = "file-meta empty"; host.textContent = "尚未选择文件"; return; }
  host.className = "file-meta";
  host.innerHTML = `<div class="file-name"><b title="${escapeHtml(side.file.name)}">${escapeHtml(side.file.name)}</b><span>${formatSize(side.file.size)}</span></div><div class="source-settings"><label>工作表<select data-side-sheet="${kind}">${side.sheets.map((name) => `<option${name === side.sheetName ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label><label>表头所在行<input data-side-header="${kind}" type="number" min="1" max="${Math.max(1, side.rows.length)}" value="${side.headerIndex + 1}"></label></div><div class="file-name"><span>已识别 ${sideColumns(kind).length} 列</span><span>${side.rows.slice(side.headerIndex + 1).filter(nonemptyRow).length} 条候选数据</span></div>`;
  host.querySelector(`[data-side-sheet="${kind}"]`).addEventListener("change", (event) => {
    if (state.mappingDirty && !confirm("更换工作表会重新自动映射，手动调整过的字段映射（含 AI 映射建议）会丢失。是否继续？")) { renderAll(); return; }
    side.sheetName = event.target.value; side.rows = workbookRows(side.workbook, side.sheetName); side.headerIndex = autoHeaderIndex(side.rows); autoMap(); renderAll();
  });
  host.querySelector(`[data-side-header="${kind}"]`).addEventListener("change", (event) => {
    const next = Math.max(0, Math.min((Number(event.target.value) || 1) - 1, Math.max(0, side.rows.length - 1)));
    if (next !== side.headerIndex && state.mappingDirty && !confirm("修改表头行会重新自动映射，手动调整过的字段映射（含 AI 映射建议）会丢失。是否继续？")) { renderAll(); return; }
    side.headerIndex = next; autoMap(); renderAll();
  });
}
function renderMapping() {
  const section = $("#mappingSection"), both = state.reference && state.target;
  section.classList.toggle("hidden", !both);
  if (!both) return;
  const referenceColumns = sideColumns("reference"), targetColumns = sideColumns("target");
  $("#mappingBody").innerHTML = state.mappings.map((mapping, mapIndex) => {
    const reference = referenceColumns.find((column) => column.index === mapping.refIndex) || { label: `列${mapping.refIndex + 1}` };
    const options = [`<option value="">— 不映射 —</option>`, ...targetColumns.map((column) => `<option value="${column.index}"${column.index === mapping.targetIndex ? " selected" : ""}>${escapeHtml(column.label)}</option>`)].join("");
    return `<tr data-map-row="${mapIndex}"><td><b>${escapeHtml(reference.label)}</b></td><td><select data-map-target="${mapIndex}" aria-label="${escapeHtml(reference.label)}对应字段">${options}</select></td><td><label class="check"><input data-map-key="${mapIndex}" type="checkbox"${mapping.key ? " checked" : ""}>基准</label></td><td><label class="check"><input data-map-compare="${mapIndex}" type="checkbox"${mapping.compare ? " checked" : ""}${mapping.targetIndex < 0 ? " disabled" : ""}>核对</label></td></tr>`;
  }).join("");
  document.querySelectorAll("[data-map-target]").forEach((select) => select.addEventListener("change", () => {
    const mapIndex = Number(select.dataset.mapTarget), mapping = state.mappings[mapIndex];
    const nextIndex = select.value === "" ? -1 : Number(select.value);
    const conflict = nextIndex >= 0 && state.mappings.find((other, otherIndex) => otherIndex !== mapIndex && other.targetIndex === nextIndex);
    if (conflict) {
      const otherColumn = referenceColumns.find((column) => column.index === conflict.refIndex);
      return toast(`该列已映射给「${otherColumn ? otherColumn.label : "另一字段"}」，请先在那里取消映射`);
    }
    mapping.targetIndex = nextIndex;
    if (mapping.targetIndex < 0) { mapping.key = false; mapping.compare = false; } else if (!mapping.key) mapping.compare = true;
    state.mappingDirty = true;
    state.result = null; renderMapping(); renderResult();
  }));
  document.querySelectorAll("[data-map-key]").forEach((input) => input.addEventListener("change", () => {
    const mapping = state.mappings[Number(input.dataset.mapKey)];
    if (input.checked && mapping.targetIndex < 0) { toast("请先为该字段选择待核对表头"); return renderMapping(); }
    mapping.key = input.checked; if (mapping.key) mapping.compare = false; state.mappingDirty = true; state.result = null; renderMapping(); renderResult();
  }));
  document.querySelectorAll("[data-map-compare]").forEach((input) => input.addEventListener("change", () => {
    const mapping = state.mappings[Number(input.dataset.mapCompare)];
    mapping.compare = input.checked && mapping.targetIndex >= 0; if (mapping.compare) mapping.key = false; state.mappingDirty = true; state.result = null; renderMapping(); renderResult();
  }));
}
function renderAll() { renderSide("reference"); renderSide("target"); renderMapping(); renderResult(); }

function comparable(value, forKey) {
  let text = display(value), options = state.options;
  if (options.trim) text = text.trim();
  if (options.ignoreSpaces) text = text.replace(/[\s　]+/g, "");
  if (options.caseInsensitive) text = text.toLowerCase();
  if (options.dateEquiv) { const date = dateKey(text); if (date) return date; }
  if (!forKey && options.numeric && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) { const number = Number(text); if (Number.isFinite(number)) return `#number:${number}`; }
  return text;
}
function groupRows(rows, keyMappings, kind) {
  const groups = new Map(), blank = [];
  rows.forEach((row) => {
    const raw = keyMappings.map((mapping) => display(row.cells[kind === "reference" ? mapping.refIndex : mapping.targetIndex]).trim());
    const normalized = keyMappings.map((mapping) => comparable(row.cells[kind === "reference" ? mapping.refIndex : mapping.targetIndex], true));
    if (normalized.some((value) => value === "")) { blank.push({ row, key: raw.join(" / ") }); return; }
    const key = normalized.join("\u241f");
    if (!groups.has(key)) groups.set(key, { display: raw.join(" / "), rows: [] });
    groups.get(key).rows.push(row);
  });
  return { groups, blank };
}
function makeDetail(status, key, field, referenceValue, targetValue, referenceRow, targetRow) { return { status, key, field, referenceValue, targetValue, referenceRow, targetRow }; }
function runCompare() {
  if (!state.reference || !state.target) return toast("请先上传两份文件");
  state.options = { trim: $("#trimOption").checked, ignoreSpaces: $("#spacesOption").checked, caseInsensitive: $("#caseOption").checked, numeric: $("#numericOption").checked, dateEquiv: $("#dateOption").checked };
  const keyMappings = state.mappings.filter((mapping) => mapping.key && mapping.targetIndex >= 0);
  const compareMappings = state.mappings.filter((mapping) => mapping.compare && mapping.targetIndex >= 0);
  if (!keyMappings.length) return toast("请至少指定一个已经映射的基准字段");
  const usedTargets = keyMappings.concat(compareMappings).map((mapping) => mapping.targetIndex);
  if (usedTargets.some((value, index) => usedTargets.indexOf(value) !== index)) return toast("同一个待核对表头不能重复映射");
  try {
    const referenceRows = sideDataRows("reference"), targetRows = sideDataRows("target");
    const reference = groupRows(referenceRows, keyMappings, "reference"), target = groupRows(targetRows, keyMappings, "target");
    const details = [];
    reference.blank.forEach((item) => details.push(makeDetail("基准值为空", item.key, "参考数据", "", "", item.row.rowNo, "")));
    target.blank.forEach((item) => details.push(makeDetail("基准值为空", item.key, "待核对数据", "", "", "", item.row.rowNo)));
    let referenceDuplicateKeys = 0, targetDuplicateKeys = 0, sameRecords = 0, changedRecords = 0, missingRecords = 0, extraRecords = 0;
    reference.groups.forEach((entry) => { if (entry.rows.length > 1) { referenceDuplicateKeys += 1; details.push(makeDetail("参考表基准重复", entry.display, `重复 ${entry.rows.length} 条`, "", "", entry.rows.map((row) => row.rowNo).join("、"), "")); } });
    target.groups.forEach((entry) => { if (entry.rows.length > 1) { targetDuplicateKeys += 1; details.push(makeDetail("待核对表基准重复", entry.display, `重复 ${entry.rows.length} 条`, "", "", "", entry.rows.map((row) => row.rowNo).join("、"))); } });
    const referenceColumns = sideColumns("reference");
    reference.groups.forEach((referenceEntry, key) => {
      if (referenceEntry.rows.length !== 1) return;
      const targetEntry = target.groups.get(key);
      if (!targetEntry) { missingRecords += 1; details.push(makeDetail("待核对表缺少", referenceEntry.display, "整条记录", "存在", "不存在", referenceEntry.rows[0].rowNo, "")); return; }
      if (targetEntry.rows.length !== 1) return;
      const referenceRow = referenceEntry.rows[0], targetRow = targetEntry.rows[0], differences = [];
      compareMappings.forEach((mapping) => {
        const referenceValue = referenceRow.cells[mapping.refIndex], targetValue = targetRow.cells[mapping.targetIndex];
        if (comparable(referenceValue, false) !== comparable(targetValue, false)) differences.push({ mapping, referenceValue, targetValue });
      });
      if (differences.length) {
        changedRecords += 1;
        differences.forEach((difference) => { const column = referenceColumns.find((item) => item.index === difference.mapping.refIndex); details.push(makeDetail("字段不一致", referenceEntry.display, column ? column.label : `列${difference.mapping.refIndex + 1}`, difference.referenceValue, difference.targetValue, referenceRow.rowNo, targetRow.rowNo)); });
      } else { sameRecords += 1; details.push(makeDetail("一致", referenceEntry.display, compareMappings.length ? "所选字段" : "记录存在性", "一致", "一致", referenceRow.rowNo, targetRow.rowNo)); }
    });
    target.groups.forEach((entry, key) => { if (entry.rows.length === 1 && !reference.groups.has(key)) { extraRecords += 1; details.push(makeDetail("待核对表多余", entry.display, "整条记录", "不存在", "存在", "", entry.rows[0].rowNo)); } });
    state.result = {
      details,
      summary: { referenceRows: referenceRows.length, targetRows: targetRows.length, sameRecords, changedRecords, missingRecords, extraRecords, referenceDuplicateKeys, targetDuplicateKeys, blankKeyRows: reference.blank.length + target.blank.length },
      referenceName: state.reference.file.name,
      targetName: state.target.file.name,
      keyFields: keyMappings.map((mapping) => referenceColumns.find((column) => column.index === mapping.refIndex)?.label || `列${mapping.refIndex + 1}`),
      compareFields: compareMappings.map((mapping) => referenceColumns.find((column) => column.index === mapping.refIndex)?.label || `列${mapping.refIndex + 1}`),
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
    state.filter = "problems"; state.query = ""; state.shown = LIMITS.previewRows; state.historyLoaded = false;
    $("#statusFilter").value = "problems"; $("#resultSearch").value = "";
    renderResult(); $("#resultSection").scrollIntoView({ behavior: "smooth", block: "start" }); toast("核对完成"); eccSaveHistory();
  } catch (error) { toast(error.message || "核对失败"); }
}
function filteredDetails() {
  if (!state.result) return [];
  let rows = state.result.details.slice();
  if (state.filter === "problems") rows = rows.filter((item) => item.status !== "一致");
  else if (state.filter !== "all") rows = rows.filter((item) => item.status === state.filter);
  const query = state.query.trim().toLowerCase();
  if (query) rows = rows.filter((item) => [item.status, item.key, item.field, item.referenceValue, item.targetValue, item.referenceRow, item.targetRow].some((value) => display(value).toLowerCase().includes(query)));
  return rows;
}
function renderResult() {
  const section = $("#resultSection"); section.classList.toggle("hidden", !state.result); if (!state.result) return;
  const s = state.result.summary, metrics = [[s.referenceRows, "参考数据"], [s.targetRows, "待核对数据"], [s.sameRecords, "完全一致"], [s.changedRecords, "存在差异"], [s.missingRecords, "待核对表缺少"], [s.extraRecords, "待核对表多余"], [s.referenceDuplicateKeys + s.targetDuplicateKeys + s.blankKeyRows, "基准异常"]];
  $("#kpis").innerHTML = metrics.map(([value, label]) => `<div class="kpi"><b>${value}</b><span>${label}</span></div>`).join("");
  $("#resultIntro").textContent = `基准：${state.result.keyFields.join("＋")}；比较 ${state.result.compareFields.length} 个字段。`;
  const all = filteredDetails(), visible = all.slice(0, state.shown);
  $("#resultBody").innerHTML = visible.map((item) => `<tr><td class="${item.status === "一致" ? "status-ok" : "status-bad"}">${escapeHtml(item.status)}</td><td>${escapeHtml(item.key || "—")}</td><td>${escapeHtml(item.field || "—")}</td><td>${escapeHtml(display(item.referenceValue) || "（空）")}</td><td>${escapeHtml(display(item.targetValue) || "（空）")}</td><td>${escapeHtml(item.referenceRow || "—")}</td><td>${escapeHtml(item.targetRow || "—")}</td></tr>`).join("");
  $("#emptyResult").classList.toggle("hidden", visible.length > 0);
  $("#loadMore").classList.toggle("hidden", all.length <= state.shown);
  $("#loadMore").textContent = `显示更多（剩余 ${(all.length - state.shown).toLocaleString()} 条）`;
  $("#resultFoot").textContent = `共 ${state.result.details.length} 条核对明细，当前筛选 ${all.length} 条，页面显示 ${visible.length} 条${all.length > state.shown ? "；可点击“显示更多”继续查看，导出报告始终包含全部明细" : ""}。重复或空白基准不会参与普通字段比较。`;
}
function exportReport() {
  if (!state.result) return toast("请先完成核对");
  const s = state.result.summary, options = state.options;
  const optionText = [`忽略首尾空格 ${options.trim ? "开" : "关"}`, `忽略全部空格 ${options.ignoreSpaces ? "开" : "关"}`, `英文不区分大小写 ${options.caseInsensitive ? "开" : "关"}`, `数值等价 ${options.numeric ? "开" : "关"}`, `日期等价 ${options.dateEquiv ? "开" : "关"}`].join("；");
  const summaryRows = [
    ["Excel 表格核对报告"], ["生成时间", state.result.createdAt], ["参考数据（正确）", state.result.referenceName], ["待核对数据", state.result.targetName], ["基准字段", state.result.keyFields.join("＋")], ["比较字段", state.result.compareFields.join("、")], ["核对选项", optionText], [],
    ["统计项", "数量"], ["参考数据行数", s.referenceRows], ["待核对数据行数", s.targetRows], ["完全一致记录", s.sameRecords], ["存在差异记录", s.changedRecords], ["待核对表缺少", s.missingRecords], ["待核对表多余", s.extraRecords], ["参考表重复基准", s.referenceDuplicateKeys], ["待核对表重复基准", s.targetDuplicateKeys], ["空白基准行", s.blankKeyRows]
  ];
  const detailRows = [["状态", "基准值", "字段", "参考值（正确）", "待核对值", "参考表行号", "待核对表行号"], ...state.result.details.map((item) => [item.status, item.key, item.field, display(item.referenceValue), display(item.targetValue), item.referenceRow, item.targetRow])];
  if (detailRows.length > LIMITS.exportRows) return toast(`差异明细共 ${(detailRows.length - 1).toLocaleString()} 行，超过 Excel 单表 ${LIMITS.exportRows.toLocaleString()} 行上限，无法导出，请缩小比较范围`);
  const workbook = XLSX.utils.book_new(), summarySheet = XLSX.utils.aoa_to_sheet(summaryRows), detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 48 }]; detailSheet["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 22 }, { wch: 28 }, { wch: 28 }, { wch: 15 }, { wch: 15 }];
  detailSheet["!autofilter"] = { ref: `A1:G${Math.max(1, detailRows.length)}` };
  XLSX.utils.book_append_sheet(workbook, summarySheet, "核对摘要"); XLSX.utils.book_append_sheet(workbook, detailSheet, "差异明细");
  const now = new Date(), pad = (part) => String(part).padStart(2, "0"), stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  XLSX.writeFile(workbook, `Excel表格核对报告-${stamp}.xlsx`, { compression: true }); toast("核对报告已导出");
}
function clearFiles() {
  state.reference = null; state.target = null; state.mappings = []; state.result = null; state.query = ""; state.filter = "problems"; state.shown = LIMITS.previewRows; state.mappingDirty = false; state.historyLoaded = false;
  $("#referenceFile").value = ""; $("#targetFile").value = ""; $("#statusFilter").value = "problems"; $("#resultSearch").value = ""; renderAll(); toast("文件和结果已清空");
}

$("#referenceFile").addEventListener("change", (event) => { const file = event.target.files[0]; readSide("reference", file); event.target.value = ""; });
$("#targetFile").addEventListener("change", (event) => { const file = event.target.files[0]; readSide("target", file); event.target.value = ""; });
$("#clearFiles").addEventListener("click", clearFiles);
$("#autoMap").addEventListener("click", () => { autoMap(); renderMapping(); renderResult(); toast("已按同名表头重新映射"); });
$("#compareButton").addEventListener("click", runCompare);
$("#statusFilter").addEventListener("change", (event) => { state.filter = event.target.value; state.shown = LIMITS.previewRows; renderResult(); });
$("#searchButton").addEventListener("click", () => { state.query = $("#resultSearch").value; state.shown = LIMITS.previewRows; renderResult(); });
$("#resultSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { state.query = event.target.value; state.shown = LIMITS.previewRows; renderResult(); } });
$("#loadMore").addEventListener("click", () => { state.shown += LIMITS.previewRows; renderResult(); });
$("#exportButton").addEventListener("click", exportReport);
["trimOption", "spacesOption", "caseOption", "numericOption", "dateOption"].forEach((id) => $("#" + id).addEventListener("change", () => { state.result = null; renderResult(); }));

window.ExcelCompareApp = { state, LIMITS, readSide, autoMap, runCompare, exportReport, clearFiles, renderAll, eccDownloadMarkedCopy, eccSaveHistory, eccViewHistory, eccHistoryList, eccClearHistory };
renderAll();

/* ===================== AI 智能核查辅助：嵌入主系统时经 AI 代理调用，仅传输表头与统计元数据 ===================== */
function parentWorkbench() {
  try { if (window.parent && window.parent !== window && typeof window.parent.aiChat === "function" && typeof window.parent.aiConfigured === "function") return window.parent; } catch (error) {}
  return null;
}
function aiReady() { const parent = parentWorkbench(); return !!(parent && parent.aiConfigured()); }
function openAiConfig() {
  const parent = parentWorkbench();
  if (parent && typeof parent.goto === "function") parent.goto("apiconfig");
  else toast("请在数智学工「AI 智能 → API配置」中完成配置");
}
async function aiCall(system, user, button) {
  const parent = parentWorkbench();
  if (!parent) throw new Error("AI 功能需要在数智学工系统内使用（未检测到主系统 AI 代理）");
  const original = button.textContent;
  button.disabled = true; button.textContent = "AI 处理中…";
  try { return await parent.aiChat(system, user, "excelCheck"); }
  finally { button.disabled = false; button.textContent = original; }
}
function parseAiJson(raw) {
  const body = String(raw || "").replace(/```json/gi, "```").split("```").map((part) => part.trim()).find((part) => part.startsWith("{"));
  const text = body || String(raw || "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 未返回有效的 JSON 结果");
  return JSON.parse(text.slice(start, end + 1));
}
function showAiPanel(title, html) {
  const panel = document.getElementById("aiPanel"); if (!panel) return;
  panel.classList.remove("hidden");
  document.getElementById("aiPanelTitle").textContent = title;
  document.getElementById("aiPanelContent").innerHTML = html;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}
function columnLetterFor(index) { let n = index + 1, s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function aiHeaders(kind) { return sideColumns(kind).map((c) => ({ letter: columnLetterFor(c.index), name: c.raw || "（空白列）" })); }

/* AI 智能映射：语义级表头对应 + 联合基准字段建议 */
function aiMappingPayload() {
  const referenceColumns = sideColumns("reference"), targetColumns = sideColumns("target");
  return {
    referenceHeaders: aiHeaders("reference"),
    targetHeaders: aiHeaders("target"),
    currentMapping: state.mappings.filter((m) => m.targetIndex >= 0).map((m) => {
      const ref = referenceColumns.find((c) => c.index === m.refIndex) || { label: "列" + (m.refIndex + 1) };
      const tgt = targetColumns.find((c) => c.index === m.targetIndex) || { label: "列" + (m.targetIndex + 1) };
      return { ref: ref.label, target: tgt.label, key: !!m.key };
    }),
  };
}
function applyAiMappingResult(result) {
  const referenceColumns = sideColumns("reference"), targetColumns = sideColumns("target");
  const keySet = new Set(Array.isArray(result.keyRefIndices) ? result.keyRefIndices.map(Number) : []);
  const usedTargets = new Set(), mappings = [];
  let invalid = false;
  (Array.isArray(result.mapping) ? result.mapping : []).forEach((entry) => {
    const refIndex = Number(entry && entry.refIndex), targetIndex = Number(entry && entry.targetIndex);
    if (!Number.isInteger(refIndex) || refIndex < 0 || refIndex >= referenceColumns.length) { invalid = true; return; }
    if (!Number.isInteger(targetIndex) || targetIndex < -1 || targetIndex >= targetColumns.length) { invalid = true; return; }
    if (targetIndex >= 0 && usedTargets.has(targetIndex)) { invalid = true; return; }
    if (targetIndex >= 0) usedTargets.add(targetIndex);
    mappings.push({ refIndex: refIndex, targetIndex: targetIndex, key: keySet.has(refIndex) && targetIndex >= 0, compare: targetIndex >= 0 && !keySet.has(refIndex) });
  });
  if (invalid || !mappings.length || !mappings.some((m) => m.key)) return null;
  return mappings;
}
async function runAiMapping(button) {
  if (!state.reference || !state.target) return toast("请先上传两份文件");
  if (!aiReady()) { toast("AI 尚未配置：请在「AI 智能 → API配置」完成配置"); openAiConfig(); return; }
  try {
    const result = parseAiJson(await aiCall("你是 Excel 双表核对的表头映射助手。输入 JSON 包含 referenceHeaders（参考表表头，letter 为列字母）、targetHeaders（待核对表表头）与 currentMapping（当前按同名自动映射的结果）。请给出语义映射建议：两表含义相同的列互相对应（如 学号/考生号、姓名/学生姓名、班级/行政班级、联系电话/手机号）；参考表有而待核对表没有的列 targetIndex 填 -1。同时推荐最适合作为联合基准的唯一键字段下标数组 keyRefIndices（如学号、证件号等唯一标识；若单字段不唯一可推荐 学号+学期 组合的多个下标）。严格只输出一个 JSON 对象：{\"mapping\":[{\"refIndex\":参考列下标,\"targetIndex\":待核对列下标}],\"keyRefIndices\":[基准字段下标数组],\"summary\":\"一句话中文说明\"}。要求：refIndex/targetIndex 为有效列下标，同一 targetIndex 不得重复；keyRefIndices 中的字段必须已映射且语义唯一。", JSON.stringify(aiMappingPayload()), button));
    const mappings = applyAiMappingResult(result);
    if (!mappings) { showAiPanel("✨ AI 智能映射", '<div class="message error" style="margin:0">AI 建议未通过校验（存在无效或重复映射、或缺少基准字段），未应用。可调整后重试。</div>'); return; }
    const suggestion = { mappings: mappings, summary: String(result.summary || "").trim() };
    const referenceColumns = sideColumns("reference"), targetColumns = sideColumns("target");
    const rows = mappings.map((m) => {
      const ref = referenceColumns.find((c) => c.index === m.refIndex) || { label: "列" + (m.refIndex + 1) };
      const tgt = m.targetIndex >= 0 ? (targetColumns.find((c) => c.index === m.targetIndex) || { label: "列" + (m.targetIndex + 1) }).label : "— 不映射 —";
      const cur = state.mappings.find((x) => x.refIndex === m.refIndex);
      const changed = !cur || cur.targetIndex !== m.targetIndex || cur.key !== m.key;
      return '<tr' + (changed ? ' style="background:#eef7f0"' : '') + '><td>' + escapeHtml(ref.label) + '</td><td>' + escapeHtml(tgt) + '</td><td>' + (m.key ? "★ 基准" : "") + '</td></tr>';
    }).join("");
    const summary = suggestion.summary;
    showAiPanel("✨ AI 智能映射建议", (summary ? '<p style="margin:0 0 8px">' + escapeHtml(summary) + "</p>" : "") + '<table class="result-table" style="width:100%"><thead><tr><th>参考表字段</th><th>待核对表字段</th><th>基准建议</th></tr></thead><tbody>' + rows + '</tbody></table><div style="margin-top:10px;display:flex;gap:8px"><button class="primary small" type="button" id="applyAiMapping">应用建议</button><button class="ghost small" type="button" id="discardAiMapping">放弃</button></div><p style="margin:10px 0 0;font-size:13px;color:#5b6b64">仅发送了两份表格的表头名称，未发送任何数据内容。应用后仍可手动调整映射与基准。</p>');
    document.getElementById("applyAiMapping").addEventListener("click", () => { state.mappings = suggestion.mappings.map((m) => Object.assign({}, m)); state.mappingDirty = true; state.result = null; document.getElementById("aiPanel").classList.add("hidden"); renderMapping(); renderResult(); toast("已应用 AI 智能映射建议"); });
    document.getElementById("discardAiMapping").addEventListener("click", () => document.getElementById("aiPanel").classList.add("hidden"));
  } catch (error) {
    showAiPanel("✨ AI 智能映射", '<div class="message error" style="margin:0">AI 智能映射失败：' + escapeHtml(error && error.message ? error.message : String(error)) + "</div>");
  }
}

/* AI 核查研判：核对完成后基于匿名统计生成研判报告 */
function aiReportStats() {
  const r = state.result; if (!r) return null;
  const statusCounts = {}, fieldMismatch = {};
  r.details.forEach((d) => { statusCounts[d.status] = (statusCounts[d.status] || 0) + 1; if (d.status === "字段不一致") fieldMismatch[d.field] = (fieldMismatch[d.field] || 0) + 1; });
  return { summary: r.summary, options: state.options, keyFields: r.keyFields, compareFields: r.compareFields, statusCounts: statusCounts, fieldMismatch: fieldMismatch, referenceName: r.referenceName, targetName: r.targetName };
}
async function runAiReport(button) {
  const stats = aiReportStats();
  if (!stats) return toast("请先完成核对，再进行 AI 研判");
  if (!aiReady()) { toast("AI 尚未配置：请在「AI 智能 → API配置」完成配置"); openAiConfig(); return; }
  try {
    const report = await aiCall("你是高校辅导员的数据核对研判助手。输入 JSON 为两份表格核对后的匿名统计（摘要计数、状态分布、字段差异计数、核对选项、文件名），不含任何单元格数据。请输出中文研判报告，分三节：一、总体判断（数据质量是否可用，一句话）；二、差异模式解读（各类差异的规模与可能成因，如日期格式类差异、某字段集中不一致、缺失/多余记录的含义，逐条引用数字）；三、处理建议（2-4 条，如优先核对某字段、与数据源方确认范围、修正后重跑核对）。严禁臆造统计之外的问题，不得要求发送原始数据。", JSON.stringify(stats), button);
    showAiPanel("🛡 AI 核查研判报告", '<div style="white-space:pre-wrap;line-height:1.85">' + escapeHtml(report) + '</div><div style="margin-top:10px;display:flex;gap:8px"><button class="ghost small" type="button" id="copyAiReport">复制报告</button></div><p style="margin:10px 0 0;font-size:13px;color:#5b6b64">研判仅基于核对统计元数据与两份文件名（文件名可能含班级、姓名等信息）；单元格数据未发送给 AI。结果以导出的核对报告与人工抽查为准。</p>');
    document.getElementById("copyAiReport").addEventListener("click", () => {
      const box = document.getElementById("aiPanelContent");
      const text = box && box.firstElementChild ? box.firstElementChild.textContent : "";
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast("报告已复制"), () => toast("复制失败，请手动选择复制"));
      else toast("当前环境不支持一键复制，请手动选择文本复制");
    });
  } catch (error) {
    showAiPanel("🛡 AI 核查研判", '<div class="message error" style="margin:0">AI 核查研判失败：' + escapeHtml(error && error.message ? error.message : String(error)) + '</div><p style="margin:10px 0 0;font-size:13px;color:#5b6b64">可直接继续手动核对与导出，AI 研判为可选步骤。</p>');
  }
}

document.getElementById("aiMapButton").addEventListener("click", (event) => runAiMapping(event.currentTarget));
document.getElementById("aiReportButton").addEventListener("click", (event) => runAiReport(event.currentTarget));
document.getElementById("aiPanelClose").addEventListener("click", () => document.getElementById("aiPanel").classList.add("hidden"));

/* ===================== 核对标注件与历史记录（2026-08-29 增补） ===================== */
const ECC_HISTORY_KEY = "excel_check_history_v1";
const ECC_HISTORY_LIMIT = 10;
const ECC_DETAIL_CAP = 1000;

/* 生成核对标注件：以待核对表为底，错误数据标红并附核对标注 */
function eccBuildMarkedCopy() {
  if (!state.result) return null;
  const targetColumns = sideColumns("target");
  const colCount = targetColumns.length;
  const keyMappings = state.mappings.filter((m) => m.key && m.targetIndex >= 0);
  const referenceColumns = sideColumns("reference");
  const refRows = sideDataRows("reference");
  const tgtRows = sideDataRows("target");
  const tgtByRow = new Map(tgtRows.map((row) => [row.rowNo, row]));
  const cellKey = (rowNo, col) => rowNo + ":" + col;
  const redCells = new Set();
  const notes = new Map();
  const appendRows = [];
  const note = (rowNo, text) => { if (!notes.has(rowNo)) notes.set(rowNo, []); notes.get(rowNo).push(text); };
  state.result.details.forEach((d) => {
    if (d.status === "字段不一致") {
      const mapping = state.mappings.find((m) => m.targetIndex >= 0 && (referenceColumns.find((c) => c.index === m.refIndex) || { label: "" }).label === d.field);
      if (mapping && d.targetRow) { redCells.add(cellKey(d.targetRow, mapping.targetIndex)); note(d.targetRow, `${d.field}不一致（参考值：${d.referenceValue}）`); }
    } else if (d.status === "待核对表缺少") {
      const refRow = refRows.find((r) => r.rowNo === d.referenceRow);
      const cells = [];
      for (let c = 0; c < colCount; c++) {
        const mapping = state.mappings.find((m) => m.targetIndex === c);
        cells.push(mapping && mapping.refIndex >= 0 && refRow ? (refRow.cells[mapping.refIndex] ?? "") : "");
      }
      appendRows.push({ cells: cells, note: "待核对表缺少该记录（参考表存在，整行标红）" });
    } else if (d.status === "待核对表多余" || d.status === "待核对表基准重复") {
      String(d.targetRow || "").split("、").forEach((no) => {
        const rowNo = Number(no);
        if (!rowNo) return;
        keyMappings.forEach((m) => redCells.add(cellKey(rowNo, m.targetIndex)));
        note(rowNo, d.status);
      });
    } else if (d.status === "基准值为空" && d.targetRow) {
      keyMappings.forEach((m) => redCells.add(cellKey(d.targetRow, m.targetIndex)));
      note(d.targetRow, "基准值为空");
    }
  });
  const maxRow = Math.max(state.target.rows.length, tgtRows.reduce((max, r) => Math.max(max, r.rowNo), 0));
  const bodyRows = [];
  const headerCells = state.target.rows[state.target.headerIndex] || [];
  bodyRows.push("<tr>" + headerCells.map((v) => `<td style="background:#e8f1ec;font-weight:bold">${escapeHtml(display(v))}</td>`).join("") + '<td style="background:#e8f1ec;font-weight:bold">核对标注</td><td style="background:#e8f1ec;font-weight:bold">源行号</td></tr>');
  for (let rowNo = state.target.headerIndex + 2; rowNo <= maxRow; rowNo++) {
    const row = tgtByRow.get(rowNo);
    const rowNotes = notes.get(rowNo);
    if (!row && !rowNotes) { bodyRows.push(`<tr><td colspan="${colCount + 2}"></td></tr>`); continue; }
    const cells = [];
    for (let c = 0; c < colCount; c++) {
      const value = row ? display(row.cells[c] ?? "") : "";
      const red = redCells.has(cellKey(rowNo, c));
      cells.push(`<td${red ? ' style="background:#ffd9d9;color:#c00000;font-weight:bold"' : ""}>${escapeHtml(value)}</td>`);
    }
    const rowNote = (rowNotes || []).join("；");
    cells.push(`<td${rowNote ? ' style="background:#ffd9d9;color:#c00000"' : ""}>${escapeHtml(rowNote)}</td>`);
    cells.push(`<td style="color:#889">${rowNo}</td>`);
    bodyRows.push(`<tr>${cells.join("")}</tr>`);
  }
  appendRows.forEach((r) => {
    const cells = r.cells.map((v) => `<td style="background:#ffd9d9;color:#c00000">${escapeHtml(display(v ?? ""))}</td>`);
    cells.push(`<td style="background:#ffd9d9;color:#c00000">${escapeHtml(r.note)}</td><td style="color:#889">（来自参考表）</td>`);
    bodyRows.push(`<tr>${cells.join("")}</tr>`);
  });
  const table = `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:微软雅黑;font-size:13px">${bodyRows.join("")}</table>`;
  return { html: table, markedCells: redCells.size, appendCount: appendRows.length, total: tgtRows.length };
}
function eccDownloadMarkedCopy() {
  if (state.historyLoaded) { toast("当前显示的是历史核对结果，无法生成标注件；请重新上传两份文件并核对后再下载"); return; }
  if (!state.result || !state.reference || !state.target) return toast("请先完成核对，再下载核对标注件");
  let built;
  try { built = eccBuildMarkedCopy(); }
  catch (error) { toast(`标注件生成失败：${error.message || "未知错误"}`); return; }
  if (!built) return toast("请先完成核对，再下载核对标注件");
  const doc = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>核对标注件</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${built.html}</body></html>`;
  const blob = new Blob(["\ufeff" + doc], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  const base = String(state.target && state.target.file ? state.target.file.name : "待核对表").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "_");
  a.href = url; a.download = `核对标注件_${base}.xls`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 300);
  toast(`核对标注件已生成：标红 ${built.markedCells} 处，补充缺失 ${built.appendCount} 条`);
}

/* 核对历史记录：逐条保存到系统 SQLite，可回看与导出。 */
let eccHistoryCache = [];
async function eccLoadHistoryFromDatabase() {
  try {
    const index = await ToolHistory.list("excelCheck");
    eccHistoryCache = (await Promise.all(index.map((item) => ToolHistory.get("excelCheck", item.id)))).filter(Boolean);
    if (!eccHistoryCache.length) {
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem(ECC_HISTORY_KEY) || "[]"); } catch (_error) { legacy = []; }
      for (const item of Array.isArray(legacy) ? legacy : []) {
        item.id = item.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
        item.at = item.at || new Date().toISOString(); item.title = "Excel 核对：" + (item.targetName || "运行记录");
        item.summaryText = item.summaryText || "一致 " + Number(item.summary && item.summary.sameRecords || 0) + " · 差异 " + Number(item.summary && item.summary.changedRecords || 0);
        await ToolHistory.save("excelCheck", item);
      }
      if (legacy.length) { try { localStorage.removeItem(ECC_HISTORY_KEY); } catch (_error) {} return eccLoadHistoryFromDatabase(); }
    }
  } catch (error) { toast("数据库历史读取失败：" + error.message); }
}
async function eccSaveHistory() {
  if (!state.result) return;
  const truncated = state.result.details.length > ECC_DETAIL_CAP;
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(), at: new Date().toISOString(),
    time: new Date().toLocaleString("zh-CN", { hour12: false }),
    referenceName: state.reference.file.name, targetName: state.target.file.name,
    keyFields: state.result.keyFields, compareFields: state.result.compareFields,
    summary: state.result.summary, options: state.options, truncated: truncated,
    details: state.result.details.slice(0, ECC_DETAIL_CAP),
  };
  item.title = "Excel 核对：" + item.targetName;
  item.summaryText = "一致 " + Number(item.summary.sameRecords || 0) + " · 差异 " + Number(item.summary.changedRecords || 0) + " · 缺少 " + Number(item.summary.missingRecords || 0);
  try { await ToolHistory.save("excelCheck", item); eccHistoryCache.unshift(item); }
  catch (error) { toast("核对完成，但数据库历史保存失败：" + error.message); }
}
function eccHistoryList() { return eccHistoryCache.slice(); }
function eccRenderHistory() {
  const list = eccHistoryList();
  const host = document.getElementById("historyContent");
  if (!host) return;
  if (!list.length) { host.innerHTML = '<div class="empty-result">暂无历史记录。每次核对完成会自动保存到系统数据库。</div>'; return; }
  host.innerHTML = list.map((item, index) => {
    const s = item.summary || {};
    return `<div style="border:1px solid #dbe7e0;border-radius:8px;padding:10px 12px;margin-bottom:8px"><b>#${list.length - index}</b>　${escapeHtml(item.time)}<br><small>参考：${escapeHtml(item.referenceName)} ｜ 待核对：${escapeHtml(item.targetName)}<br>基准：${escapeHtml((item.keyFields || []).join("＋"))} ｜ 一致 ${s.sameRecords ?? "—"} · 不一致 ${s.changedRecords ?? "—"} · 缺少 ${s.missingRecords ?? "—"} · 多余 ${s.extraRecords ?? "—"}${item.truncated ? " · 明细超 1000 条已截断" : ""}</small><div style="margin-top:6px;display:flex;gap:8px"><button class="ghost small" type="button" data-hist-view="${index}">载入查看</button><button class="ghost small" type="button" data-hist-del="${index}">删除</button></div></div>`;
  }).join("");
  host.querySelectorAll("[data-hist-view]").forEach((btn) => btn.addEventListener("click", () => eccViewHistory(Number(btn.dataset.histView))));
  host.querySelectorAll("[data-hist-del]").forEach((btn) => btn.addEventListener("click", () => eccDeleteHistory(Number(btn.dataset.histDel))));
}
function eccViewHistory(index) {
  const list = eccHistoryList();
  const item = list[index];
  if (!item) return;
  state.result = { details: item.details || [], summary: item.summary, referenceName: item.referenceName, targetName: item.targetName, keyFields: item.keyFields, compareFields: item.compareFields, createdAt: item.time };
  state.historyLoaded = true;
  state.filter = "problems"; state.query = ""; state.shown = LIMITS.previewRows;
  const filterEl = document.getElementById("statusFilter"); if (filterEl) filterEl.value = "problems";
  const searchEl = document.getElementById("resultSearch"); if (searchEl) searchEl.value = "";
  const panel = document.getElementById("historyPanel"); if (panel) panel.classList.add("hidden");
  renderResult();
  const section = document.getElementById("resultSection"); if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  toast("已载入历史核对结果（仅供参考；生成标注件请重新核对当前文件）" + (item.truncated ? "；明细仅保留前 1000 条" : ""));
}
async function eccDeleteHistory(index) {
  const list = eccHistoryList();
  if (!list[index]) return;
  if (!confirm("确定删除这条历史记录？")) return;
  try { await ToolHistory.remove("excelCheck", list[index].id); eccHistoryCache.splice(index, 1); }
  catch (error) { toast("删除失败：" + error.message); return; }
  eccRenderHistory();
}
async function eccClearHistory() {
  if (!eccHistoryList().length) { toast("暂无历史记录"); return; }
  if (!confirm("确定清空全部核对历史记录？此操作不可恢复。")) return;
  try { await ToolHistory.clear("excelCheck"); eccHistoryCache = []; } catch (error) { toast("清空失败：" + error.message); return; }
  eccRenderHistory();
  toast("历史记录已清空");
}
function eccToggleHistory() {
  const panel = document.getElementById("historyPanel");
  if (!panel) return;
  const willShow = panel.classList.contains("hidden");
  if (willShow) eccRenderHistory();
  panel.classList.toggle("hidden", !willShow);
  if (willShow) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("markedButton").addEventListener("click", eccDownloadMarkedCopy);
document.getElementById("historyButton").addEventListener("click", eccToggleHistory);
document.getElementById("historyClose").addEventListener("click", () => document.getElementById("historyPanel").classList.add("hidden"));
document.getElementById("historyClear").addEventListener("click", eccClearHistory);
eccLoadHistoryFromDatabase().then(eccRenderHistory);
