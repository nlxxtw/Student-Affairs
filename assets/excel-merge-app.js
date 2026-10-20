const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { files: [], analyses: [], outputHeaders: [], outputCustomized: false, mappings: {}, standardIndex: 0, hasDifferences: false, busy: false, cancelled: false, worker: null, workerReject: null, analysisSignature: '', aiHeaderSuggestion: null, dedupKeys: new Set() };
const LIMITS = { files: 100, fileBytes: 50 * 1024 * 1024, totalInputBytes: 150 * 1024 * 1024, historyBytes: 100 * 1024 * 1024, columns: 500, rowsPerFile: 250000, totalRows: 500000 };
const SUPPORTED_INPUT_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xlsb', '.xls', '.xltx', '.xltm', '.xlt', '.et', '.ett', '.ods', '.fods', '.ots', '.xml', '.csv', '.txt']);
const SUPPORTED_INPUT_SUMMARY = 'Excel 新旧格式、WPS .et/.ett、ODS、模板、Excel XML、CSV/TXT';
const TEXT_INPUT_EXTENSIONS = /\.(csv|txt)$/i;
const DB_NAME = 'excel-merge-assistant-v1';
const STORE_NAME = 'history';

/* 与同表内常见同义词保持一致的归一化规则：去空格、下划线、中英文括号、书名号、方括号、冒号 */
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function text(value) {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = number => String(number).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}${value.getHours() || value.getMinutes() || value.getSeconds() ? ` ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}` : ''}`;
  }
  return String(value).replace(/\s+/g, ' ').trim();
}
function normalize(value) { return text(value).replace(/[\s　_\-（）()【】\[\]：:]/g, '').toLowerCase(); }
function rowNonempty(row) { return Array.isArray(row) && row.some(value => text(value)); }
function trimHeader(row) { const values = (row || []).slice(0, LIMITS.columns).map(text); while (values.length && !values.at(-1)) values.pop(); return values; }
function columnLetter(index) { let value = index + 1, result = ''; while (value) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); } return result; }
function formatSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function fileExtension(name) { const match = String(name || '').trim().toLowerCase().match(/\.[^.]+$/); return match ? match[0] : ''; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800); }
function setBusy(busy, message = '') {
  state.busy = busy; state.cancelled = false;
  ['analyzeButton', 'reanalyzeButton', 'mergeButton'].forEach(id => { const el = $('#' + id); if (el) el.disabled = busy; });
  $('#progressBox').classList.toggle('hidden', !busy); $('#cancelButton').classList.toggle('hidden', !busy);
  if (!busy) updateProgress(0, ''); else if (message) toast(message);
}
function updateProgress(percent, message) { $('#progressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`; $('#progressText').textContent = message || '准备处理'; }
function checkCancelled() { if (state.cancelled) throw new Error('操作已取消'); }
function currentRule() { const input = $('input[name="rule"]:checked'); return input ? input.value : 'auto'; }
function currentInputMode() { const input = $('input[name="inputMode"]:checked'); return input ? input.value : 'folder'; }
function nonnegative(id) { return Math.max(0, Number.parseInt($(id).value, 10) || 0); }
function config() {
  return {
    rule: currentRule(), scanRows: Math.max(5, nonnegative('#scanRows')),
    topSkip: nonnegative('#topSkip'), headerRow: Math.max(1, nonnegative('#headerRow')),
    tailSkip: nonnegative('#tailSkip'), preserveDisplay: $('#preserveDisplay').checked, excludeHidden: $('#excludeHidden').checked,
    headerRows: Object.fromEntries(state.analyses.map((item, index) => [String(index), Math.max(1, Number.parseInt(item.headerRow, 10) || 1)])),
    sheetSelections: Object.fromEntries(state.analyses.map((item, index) => [String(index), item.sheet])),
  };
}
function signature(configuration = config()) { return JSON.stringify(configuration); }
function yieldUi() { return new Promise(resolve => setTimeout(resolve, 0)); }

/* ===================== AI 智能辅助：经主系统代理调用，只传输表头与统计元数据（独立版隐藏入口） ===================== */
function parentWorkbench() {
  try { if (window.parent && window.parent !== window && typeof window.parent.aiChat === 'function' && typeof window.parent.aiConfigured === 'function') return window.parent; } catch (error) {}
  return null;
}
function aiReady() { const parent = parentWorkbench(); return !!(parent && parent.aiConfigured()); }
function openAiConfig() {
  const parent = parentWorkbench();
  if (parent && typeof parent.goto === 'function') parent.goto('apiconfig');
  else toast('请在数智学工主系统「AI 智能 → API配置」中完成配置');
}
async function aiCall(system, user, button) {
  const parent = parentWorkbench();
  if (!parent) throw new Error('AI 功能需要在数智学工系统内使用（未检测到主系统 AI 代理）');
  const original = button.textContent;
  button.disabled = true; button.textContent = 'AI 处理中…';
  try { return await parent.aiChat(system, user, 'excelMerge'); }
  finally { button.disabled = false; button.textContent = original; }
}
function parseAiJson(raw) {
  const body = String(raw || '').replace(/```json/gi, '```').split('```').map(part => part.trim()).find(part => part.startsWith('{'));
  const text2 = body || String(raw || '');
  const start = text2.indexOf('{'), end = text2.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回有效的 JSON 结果');
  return JSON.parse(text2.slice(start, end + 1));
}
function showAiPanel(html) { const panel = $('#aiPanel'); if (!panel) return; panel.classList.remove('hidden'); $('#aiPanelContent').innerHTML = html; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function issueText(issue) { return `${issue.column} 列：${issue.type}；标准“${issue.expected || '（无）'}”，实际“${issue.actual || '（无）'}”`; }
function aiHeadersPayload(item) { return item.headers.map((header, columnIndex) => ({ letter: item.columnLetters[columnIndex], name: header || '（空白列）' })); }
function aiMappingSummaryData() {
  if (!state.analyses.length) return null;
  return {
    outputHeaders: state.outputHeaders.map((header, index) => ({ letter: columnLetter(index), name: header || '（空）' })),
    files: state.analyses.map((item, fileIndex) => ({
      index: fileIndex, name: item.name, sheet: item.sheet, rowCount: item.rowCount,
      headers: aiHeadersPayload(item),
      currentMapping: (state.mappings[fileIndex] || []).map((source, outputIndex) => ({
        output: columnLetter(outputIndex), outputName: state.outputHeaders[outputIndex] || '（空）',
        source: source === -2 ? '（留空）' : (source >= 0 ? `${item.columnLetters[source]} ${item.headers[source] || '（空白列）'}` : '（未选择）'),
      })),
      issues: (item.issues || []).map(issueText),
      warnings: item.warnings || [],
    })),
  };
}
async function runAiMapping(button) {
  if (state.busy) return toast('正在处理其他任务，请稍候');
  if (!state.analyses.length) { toast('请先完成“分析并确认表头”'); return; }
  if (!aiReady()) { toast('AI 尚未配置：请在「AI 智能 → API配置」完成配置'); openAiConfig(); return; }
  try {
    const payload = aiMappingSummaryData();
    if (!payload) return;
    const system = '你是 Excel 多表合并的列映射助手。输入 JSON 包含 outputHeaders（输出表头，letter 为输出列字母）和每个文件的表头列表（letter 为来源列字母），不含任何单元格数据。请为每个文件给出来源列到输出列的映射建议：列名相同或语义相同（如“学号/考生号”“姓名/学生姓名”“班级/行政班级”“联系电话/手机号/电话”）的列互相对应；输出表中该文件确实没有的列填 -2（留空）。严格只输出一个 JSON 对象：{"files":[{"index":文件序号,"mapping":[与输出表头数量相等的数组，元素为来源列下标（从 0 开始）或 -2]}],"summary":"一句话中文说明"}。硬性要求：mapping 数组长度必须等于输出表头数量；同一文件内除 -2 外来源列下标不得重复；不得使用不存在的列下标；不确定时沿用 currentMapping 中已正确选择的映射，不要无故改动。';
    const result = parseAiJson(await aiCall(system, JSON.stringify(payload), button));
    const applied = [], skipped = [];
    (Array.isArray(result.files) ? result.files : []).forEach(suggestion => {
      const fileIndex = Number(suggestion && suggestion.index);
      if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= state.analyses.length) return;
      const item = state.analyses[fileIndex], mapping = suggestion.mapping;
      if (!Array.isArray(mapping) || mapping.length !== state.outputHeaders.length) { skipped.push(`${item.name}：建议的映射数量与输出列不符`); return; }
      const used = new Set(); let valid = true;
      for (const source of mapping) {
        if (source === -2) continue;
        if (!Number.isInteger(source) || source < 0 || source >= item.headers.length || used.has(source)) { valid = false; break; }
        used.add(source);
      }
      if (!valid) { skipped.push(`${item.name}：存在无效或重复使用的来源列`); return; }
      state.mappings[fileIndex] = mapping.map(value => (value === -2 ? -2 : Number(value)));
      applied.push(item.name);
    });
    renderFileReviews();
    const notes = String(result.summary || '').trim();
    showAiPanel(`<h3 style="margin:0 0 10px">✨ AI 智能映射结果</h3>${notes ? `<div class="ai-summary">${escapeHtml(notes)}</div>` : ''}<div class="message" style="margin-top:0">已应用 <b>${applied.length}</b> 个文件的映射建议${skipped.length ? `；<b>${skipped.length}</b> 个文件未采纳（见下方）` : ''}。请逐文件复核来源列后继续。${skipped.length ? `<small>${escapeHtml(skipped.join('；'))}</small>` : ''}</div><ul class="ai-file-list">${state.analyses.map(item => `<li class="${applied.includes(item.name) ? '' : 'skipped'}">${escapeHtml(item.name)}：${applied.includes(item.name) ? '已应用 AI 映射' : '保持人工映射'}</li>`).join('')}</ul><div class="ai-note">AI 仅接收了各文件的表头名称与行数统计，未发送任何单元格数据。若存在表头差异，合并前仍需勾选人工确认。</div>`);
    toast(`AI 映射已应用 ${applied.length} 个文件${skipped.length ? `，${skipped.length} 个未采纳` : ''}`);
  } catch (error) {
    showAiPanel(`<div class="message error" style="margin-top:0">AI 智能映射失败：${escapeHtml(error && error.message ? error.message : String(error))}</div><div class="ai-note">可稍后重试，或继续手动选择来源列；AI 不可用不影响本机合并功能。</div>`);
  }
}
async function runAiHeaderSuggestion(button) {
  if (state.busy) return toast('正在处理其他任务，请稍候');
  if (!state.analyses.length) { toast('请先完成“分析并确认表头”'); return; }
  if (!aiReady()) { toast('AI 尚未配置：请在「AI 智能 → API配置」完成配置'); openAiConfig(); return; }
  try {
    const payload = { outputHeaders: state.outputHeaders.map((header, index) => ({ letter: columnLetter(index), name: header || '（空）' })), files: state.analyses.map(item => ({ name: item.name, headers: aiHeadersPayload(item) })) };
    const system = '你是 Excel 输出表头规范化助手。输入是当前输出表头和各文件的来源表头。请给出规范化建议：保持输出列的数量与顺序完全不变；去掉多余空格和重复字（如“姓 名”→“姓名”）；同义列名统一为简洁规范的写法（如“学生姓名”与“姓名”并存时统一为“姓名”）；单位或日期格式仅在明显冗余时精简；不得增删列，名称不得为空或重复。严格只输出一个 JSON 对象：{"headers":[与输出表头数量相等的规范化列名数组],"summary":"一句话中文说明修改要点"}。';
    const result = parseAiJson(await aiCall(system, JSON.stringify(payload), button));
    if (!Array.isArray(result.headers) || result.headers.length !== state.outputHeaders.length || result.headers.some(header => !text(header))) throw new Error('AI 建议的列名数量与当前输出列不符');
    const keys = result.headers.map(header => normalize(header));
    if (new Set(keys).size !== keys.length) throw new Error('AI 建议中存在重复列名，未应用');
    state.aiHeaderSuggestion = result.headers.map(header => text(header));
    const changed = state.outputHeaders.some((header, index) => header !== state.aiHeaderSuggestion[index]);
    if (!changed) { showAiPanel('<div class="message" style="margin-top:0">AI 检查后认为当前输出表头已经规范，无需修改。</div>'); return; }
    const rows = state.outputHeaders.map((header, index) => `<tr class="${header !== state.aiHeaderSuggestion[index] ? 'changed' : ''}"><td>${columnLetter(index)}</td><td>${escapeHtml(header || '（空）')}</td><td>${escapeHtml(state.aiHeaderSuggestion[index])}</td></tr>`).join('');
    const summary = String(result.summary || '').trim();
    showAiPanel(`<h3 style="margin:0 0 10px">✨ AI 表头规范建议</h3>${summary ? `<div class="ai-summary">${escapeHtml(summary)}</div>` : ''}<table class="ai-suggest-table"><thead><tr><th>列</th><th>当前名称</th><th>建议名称</th></tr></thead><tbody>${rows}</tbody></table><div class="review-actions"><button class="ai-btn" type="button" id="applyAiHeaders">应用建议</button><button class="ghost" type="button" id="discardAiHeaders">放弃</button></div><div class="ai-note">建议基于各文件表头名称生成，未发送任何单元格数据。应用后仍可继续手动改名或调整顺序。</div>`);
    $('#applyAiHeaders').addEventListener('click', () => {
      state.outputHeaders = [...state.aiHeaderSuggestion];
      state.outputCustomized = true; state.aiHeaderSuggestion = null;
      renderReview(); toast('已应用 AI 表头规范建议');
    });
    $('#discardAiHeaders').addEventListener('click', () => { state.aiHeaderSuggestion = null; $('#aiPanel').classList.add('hidden'); });
  } catch (error) {
    showAiPanel(`<div class="message error" style="margin-top:0">AI 表头规范失败：${escapeHtml(error && error.message ? error.message : String(error))}</div>`);
  }
}
async function runAiCheck(button) {
  if (state.busy) return toast('正在处理其他任务，请稍候');
  if (!state.analyses.length) { toast('请先完成“分析并确认表头”'); return; }
  if (!aiReady()) { toast('AI 尚未配置：请在「AI 智能 → API配置」完成配置'); openAiConfig(); return; }
  try {
    const mappingProblems = state.analyses.map((item, fileIndex) => {
      const mapping = state.mappings[fileIndex] || [];
      const selected = mapping.filter(value => value >= 0);
      return { file: item.name, unmapped: mapping.filter(value => value === -1).length, reusedSource: selected.length !== new Set(selected).size ? 1 : 0 };
    });
    const payload = {
      outputHeaders: state.outputHeaders, totalFiles: state.analyses.length,
      totalRows: state.analyses.reduce((sum, item) => sum + item.rowCount, 0),
      hasDifferences: state.hasDifferences, differencesConfirmed: $('#confirmDifferences').checked,
      files: state.analyses.map(item => ({ name: item.name, sheet: item.sheet, headerRow: item.headerRow, rowCount: item.rowCount, headers: item.headers, issues: (item.issues || []).map(issueText), warnings: item.warnings, duplicates: item.duplicates, uncachedFormulaCount: item.uncachedFormulaCount, formulaCount: item.formulaCount })),
      mappingProblems,
    };
    const system = '你是 Excel 批量合并的数据质量核查助手。输入 JSON 只有表头名称、行数统计、告警与映射状态等元数据，没有单元格数据。请只依据输入内容输出中文核查报告，分三节：一、总体结论（“可以合并”或“建议先修正”，并给出一句话理由）；二、必须处理（映射缺失、来源列重复使用、表头差异未确认、没有可合并数据等会阻断合并的问题，逐条说明涉及文件）；三、建议关注（行数为 0 或明显异常、未缓存公式、隐藏行、重名列、空白列、来源文件名疑似历史输出等风险）。严禁臆造输入之外的数据问题，不得要求发送原始数据，不要输出与本合并无关的泛泛建议。';
    const report = await aiCall(system, JSON.stringify(payload), button);
    showAiPanel(`<h3 style="margin:0 0 10px">🛡 AI 合并前核查报告</h3><div class="ai-report">${escapeHtml(report)}</div><div class="ai-note">核查仅基于表头与统计元数据；单元格数据未发送给 AI。报告为辅助参考，合并结果请以“合并说明”工作表和人工抽查为准。</div>`);
    toast('AI 合并前核查已完成');
  } catch (error) {
    showAiPanel(`<div class="message error" style="margin-top:0">AI 合并前核查失败：${escapeHtml(error && error.message ? error.message : String(error))}</div><div class="ai-note">可直接继续手动合并，AI 核查为可选步骤。</div>`);
  }
}
function refreshAiBadge() {
  const dot = $('#aiBadgeDot'), label = $('#aiBadgeText');
  if (!dot || !label) return;
  if (aiReady()) { dot.className = 'ok'; label.textContent = 'AI 已就绪'; }
  else { dot.className = 'warn'; label.textContent = 'AI 未配置'; }
}

/* ===================== 表头识别 ===================== */
function autoHeaderRow(rows, scanRows) {
  let best = null;
  rows.slice(0, Math.max(1, Math.min(scanRows, rows.length))).forEach((row, index) => {
    const values = trimHeader(row), nonempty = values.filter(Boolean);
    if (!nonempty.length) return;
    const keys = nonempty.map(normalize);
    const stringLike = nonempty.filter(value => Number.isNaN(Number(value)) || /[A-Za-z\u4e00-\u9fff]/.test(value)).length;
    const density = nonempty.length / Math.max(values.length, 1);
    let score = nonempty.length * 3 + stringLike * 2 + density * 4;
    if (nonempty.length === 1) score -= 8;
    if (keys.length !== new Set(keys).size) score -= 4;
    const candidate = [score, nonempty.length, -index, index];
    if (!best || candidate.some((value, part) => value > best[part] && candidate.slice(0, part).every((prior, p) => prior === best[p]))) best = candidate;
  });
  if (!best) throw new Error('前部区域没有可识别的表头');
  return best[3];
}

function compareHeaders(expected, actual) {
  const issues = [], expectedKeys = expected.map(normalize), actualKeys = actual.map(normalize);
  for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
    const left = expected[index] || '', right = actual[index] || '';
    let type = '';
    if (index >= actual.length) type = '缺少列';
    else if (index >= expected.length) type = '多出列';
    else if (expectedKeys[index] !== actualKeys[index]) type = actualKeys[index] && expectedKeys.includes(actualKeys[index]) ? '列位置不同' : '列名不一致';
    if (type) issues.push({ column: columnLetter(index), expected: left, actual: right, type });
  }
  return issues;
}
function duplicateColumns(headers) {
  const positions = new Map();
  headers.forEach((header, index) => { const key = normalize(header); if (key) positions.set(key, [...(positions.get(key) || []), index]); });
  return [...positions.values()].filter(indexes => indexes.length > 1).map(indexes => ({ name: headers[indexes[0]], columns: indexes.map(columnLetter) }));
}

/* ===================== 文件解析：Worker 优先，回退主线程；只传输行数据 ===================== */
async function extractWorkbook(file, requestedSheet, preserveDisplay, excludeHidden) {
  checkCancelled();
  const data = await file.arrayBuffer();
  checkCancelled();
  const textFormat = TEXT_INPUT_EXTENSIONS.test(file.name || '');
  const request = { buffer: data, textFormat, requestedSheet: requestedSheet || '', preserveDisplay: !!preserveDisplay, excludeHidden: !!excludeHidden };
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        let worker;
        try { worker = new Worker(new URL('excel-merge-worker.js', location.href)); }
        catch (startError) { reject(startError); return; }
        state.worker = worker; state.workerReject = reject;
        const cleanup = () => { worker.terminate(); if (state.worker === worker) { state.worker = null; state.workerReject = null; } };
        worker.onmessage = event => { const payload = event.data; cleanup(); payload?.ok ? resolve(payload.result) : reject(new Error(payload?.error || '后台解析失败')); };
        worker.onerror = event => { cleanup(); reject(new Error(event.message || '后台解析组件加载失败')); };
        worker.postMessage(request, [data]);
      });
    } catch (error) {
      if (state.cancelled || error.message === '操作已取消') throw error;
      const fallbackData = await file.arrayBuffer();
      try { return ExcelMergeExtract.extractSheetData(fallbackData, request); }
      catch (fallbackError) { throw new Error(`无法读取工作簿（${fallbackError.message || error.message || '文件可能已损坏或加密'}）`); }
    }
  }
  try { return ExcelMergeExtract.extractSheetData(data, request); }
  catch (error) { throw new Error(`无法读取工作簿（${error.message || '文件可能已损坏或加密'}）`); }
}

async function analyzeOne(file, fileIndex, configuration, expected) {
  const extraction = await extractWorkbook(file, configuration.sheetSelections?.[String(fileIndex)] || '', configuration.preserveDisplay, configuration.excludeHidden);
  const rows = extraction.rows;
  const manual = configuration.headerRows || {};
  let headerIndex;
  if (Object.hasOwn(manual, String(fileIndex))) headerIndex = Number(manual[String(fileIndex)]) - 1;
  else if (configuration.rule === 'fixed') {
    if (configuration.headerRow <= configuration.topSkip) throw new Error('标题所在行必须位于“顶部不合并行数”之后');
    headerIndex = configuration.headerRow - 1;
  } else headerIndex = autoHeaderRow(rows, configuration.scanRows);
  if (!Number.isInteger(headerIndex) || headerIndex < 0 || headerIndex >= rows.length) throw new Error(`第 ${headerIndex + 1} 行超出工作表已有内容`);
  const headers = trimHeader(rows[headerIndex]);
  if (!headers.length) throw new Error(`第 ${headerIndex + 1} 行为空，不能作为表头`);
  if (headers.length > LIMITS.columns) throw new Error(`表头列数超过 ${LIMITS.columns} 列限制`);
  let dataRows = [];
  let hiddenExcluded = 0;
  const hiddenFlags = extraction.hiddenFlags || '';
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!rowNonempty(row)) continue;
    if (configuration.excludeHidden && hiddenFlags[rowIndex] === '1') { hiddenExcluded += 1; continue; }
    dataRows.push({ rowNo: rowIndex + 1, cells: row });
  }
  const headerKey = headers.map(normalize).join('\u0001');
  const headerLikeRows = [];
  dataRows = dataRows.filter(row => {
    const key = headers.map((_, columnIndex) => normalize(row.cells[columnIndex])).join('\u0001');
    if (key === headerKey) { headerLikeRows.push(row.rowNo); return false; }
    return true;
  });
  if (configuration.tailSkip) dataRows = dataRows.slice(0, Math.max(0, dataRows.length - configuration.tailSkip));
  if (dataRows.length > LIMITS.rowsPerFile) throw new Error(`数据超过 ${LIMITS.rowsPerFile.toLocaleString()} 行限制`);
  const blanks = headers.map((header, index) => normalize(header) ? '' : columnLetter(index)).filter(Boolean);
  const duplicates = duplicateColumns(headers), warnings = [];
  if (blanks.length) warnings.push(`表头存在空白列：${blanks.join('、')}`);
  if (duplicates.length) warnings.push(`表头存在重名列：${duplicates.map(item => `${item.name}(${item.columns.join('、')})`).join('；')}`);
  if (extraction.visibleCount > 1) warnings.push(`工作簿有 ${extraction.visibleCount} 个可见工作表，本次读取“${extraction.sheetName}”，可在文件卡片中切换`);
  if (hiddenExcluded) warnings.push(`已按设置排除 ${hiddenExcluded} 个隐藏数据行`);
  if (headerLikeRows.length) warnings.push(`已自动剔除 ${headerLikeRows.length} 行与表头完全相同的疑似表头行（工作表第 ${headerLikeRows.slice(0, 5).join('、')}${headerLikeRows.length > 5 ? '等' : ''} 行），常见于把以前的合并结果混入`);
  if (extraction.uncachedFormulaCount) warnings.push(`发现 ${extraction.uncachedFormulaCount} 个没有缓存结果的公式单元格（${extraction.uncachedSamples.join('、')}${extraction.uncachedFormulaCount > 5 ? '等' : ''}），这些值将留空；请先用 Excel/WPS 计算并保存`);
  else if (extraction.formulaCount) warnings.push(`发现 ${extraction.formulaCount} 个公式单元格，本次使用文件中已保存的计算结果`);
  if (!dataRows.length) warnings.push('未识别到数据行，请检查表头行与顶部/末尾跳过行数');
  return {
    index: fileIndex, name: file.webkitRelativePath || file.name, sheet: extraction.sheetName,
    sheets: extraction.visibleNames,
    headerRow: headerIndex + 1, headers, columnLetters: headers.map((_, index) => columnLetter(index)),
    rowCount: dataRows.length, preview: dataRows.slice(0, 3).map(row => row.cells.slice(0, headers.length).map(text)),
    warnings, issues: expected ? compareHeaders(expected, headers) : [], duplicates, formulaCount: extraction.formulaCount, uncachedFormulaCount: extraction.uncachedFormulaCount, _dataRows: dataRows,
  };
}
async function analyzeFiles(configuration) {
  if (state.files.length < 2) throw new Error('至少需要选择 2 个 Excel 文件');
  const analyses = []; let expected = null;
  for (let index = 0; index < state.files.length; index += 1) {
    checkCancelled(); updateProgress((index / state.files.length) * 100, `正在分析 ${index + 1}/${state.files.length}：${state.files[index].name}`); await yieldUi();
    try { analyses.push(await analyzeOne(state.files[index], index, configuration, expected)); }
    catch (error) { throw new Error(`${state.files[index].webkitRelativePath || state.files[index].name}：${error.message}`); }
    if (!expected) expected = analyses[0].headers;
    await yieldUi();
  }
  updateProgress(100, `已分析 ${state.files.length} 个文件`);
  return { files: analyses, standardHeaders: expected };
}

/* ===================== 文件选择：文件夹替换、多选追加、支持拖拽 ===================== */
function activateChoices(name) { $$(`input[name="${name}"]`).forEach(input => input.closest('.choice') && input.closest('.choice').classList.toggle('active', input.checked)); }
$$('input[name="inputMode"]').forEach(input => input.addEventListener('change', () => {
  activateChoices('inputMode'); const folder = currentInputMode() === 'folder';
  $('#folderButton').classList.toggle('hidden', !folder); $('#filesButton').classList.toggle('hidden', folder);
  state.files = []; $('#folderInput').value = ''; $('#filesInput').value = ''; renderFiles(); resetReview();
}));
$$('input[name="rule"]').forEach(input => input.addEventListener('change', () => {
  activateChoices('rule'); const fixed = currentRule() === 'fixed';
  $$('.fixed-only').forEach(el => el.classList.toggle('hidden', !fixed)); $('#scanField').classList.toggle('hidden', fixed); resetReview();
}));
function acceptFiles(fileList, append = false) {
  const seen = new Set(), rejected = [], accepted = []; let totalBytes = 0;
  const base = append ? state.files : [];
  base.forEach(file => { const key = `${file.webkitRelativePath || file.name}|${file.size}`; if (seen.has(key)) return; seen.add(key); accepted.push(file); totalBytes += file.size; });
  for (const file of [...(fileList || [])]) {
    const relative = file.webkitRelativePath || file.name;
    if (file.name.startsWith('~$')) continue;
    if (!SUPPORTED_INPUT_EXTENSIONS.has(fileExtension(file.name))) { rejected.push(`${relative}：格式不支持`); continue; }
    if (file.size > LIMITS.fileBytes) { rejected.push(`${relative}：超过单文件 50MB 限制`); continue; }
    if (totalBytes + file.size > LIMITS.totalInputBytes) { rejected.push(`${relative}：加入后超过总计 150MB 限制`); continue; }
    const key = `${relative}|${file.size}`; if (seen.has(key)) continue;
    seen.add(key); accepted.push(file); totalBytes += file.size;
  }
  state.files = accepted;
  if (state.files.length > LIMITS.files) { state.files = state.files.slice(0, LIMITS.files); toast(`单次最多处理 ${LIMITS.files} 个文件，已保留前 ${LIMITS.files} 个`); }
  resetReview(); renderFiles();
  const added = accepted.length - base.length;
  if (rejected.length) toast(`已跳过 ${rejected.length} 个文件：${rejected[0]}`);
  else if (append && added > 0) toast(`已追加 ${added} 个文件，共 ${state.files.length} 个`);
}
$('#folderInput').addEventListener('change', event => { acceptFiles(event.target.files); event.target.value = ''; });
$('#filesInput').addEventListener('change', event => { acceptFiles(event.target.files, true); event.target.value = ''; });
function walkEntry(entry, out) {
  return new Promise(resolve => {
    if (entry.isFile) entry.file(file => { out.push(file); resolve(); }, () => resolve());
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => reader.readEntries(async batch => {
        if (!batch.length) return resolve();
        await Promise.all(batch.map(child => walkEntry(child, out)));
        readBatch();
      }, () => resolve());
      readBatch();
    } else resolve();
  });
}
function wireDropZone() {
  const zone = $('#fileCard');
  if (!zone) return;
  let depth = 0;
  zone.addEventListener('dragenter', event => { event.preventDefault(); depth += 1; zone.classList.add('drag-over'); });
  zone.addEventListener('dragover', event => { event.preventDefault(); });
  zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', async event => {
    event.preventDefault(); depth = 0; zone.classList.remove('drag-over');
    const items = [...(event.dataTransfer?.items || [])];
    const entries = items.map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
    if (entries.length && entries.some(entry => entry.isDirectory)) {
      const dropped = [];
      await Promise.all(entries.filter(entry => entry.isDirectory).map(entry => walkEntry(entry, dropped)));
      if (dropped.length) { acceptFiles(dropped); toast(`已从文件夹导入 ${dropped.length} 个文件`); }
      return;
    }
    if (event.dataTransfer?.files?.length) acceptFiles(event.dataTransfer.files, true);
  });
}
$('#cancelButton').addEventListener('click', () => {
  state.cancelled = true; updateProgress(0, '正在取消，请稍候…');
  if (state.worker) state.worker.terminate();
  if (state.workerReject) state.workerReject(new Error('操作已取消'));
  state.worker = null; state.workerReject = null;
});
$('#clearPicked').addEventListener('click', () => { if (!state.files.length) return; state.files = []; resetReview(); renderFiles(); toast('已清空文件清单'); });
function renderFiles() {
  const list = $('#fileList'), clearButton = $('#clearPicked');
  if (clearButton) clearButton.hidden = !state.files.length;
  if (!state.files.length) { list.className = 'file-list empty'; list.textContent = '选择后将在这里显示文件清单，也可直接拖拽文件或文件夹到此处'; $('#pickedCount').textContent = '尚未选择文件'; $('#pickedSize').textContent = `支持 ${SUPPORTED_INPUT_SUMMARY}；单文件不超过 50MB，总计不超过 150MB`; return; }
  const total = state.files.reduce((sum, file) => sum + file.size, 0);
  $('#pickedCount').textContent = `已选择 ${state.files.length} 个文件`; $('#pickedSize').textContent = `总大小 ${formatSize(total)} · 自动忽略 Excel 临时文件（~$ 开头）`;
  list.className = 'file-list'; list.innerHTML = state.files.map((file, index) => `<div class="file-row"><i>📄</i><b>${index + 1}. ${escapeHtml(file.webkitRelativePath || file.name)}</b><small>${formatSize(file.size)}</small><button class="remove-file" data-remove-file="${index}" title="移除此文件">移除</button></div>`).join('');
  $$('[data-remove-file]').forEach(button => button.addEventListener('click', () => { state.files.splice(Number(button.dataset.removeFile), 1); resetReview(); renderFiles(); }));
}
function resetReview() { state.analyses = []; state.outputHeaders = []; state.outputCustomized = false; state.mappings = {}; state.standardIndex = 0; state.hasDifferences = false; state.analysisSignature = ''; state.aiHeaderSuggestion = null; $('#reviewSection').classList.add('hidden'); $('#mergeSection').classList.add('hidden'); const panel = $('#aiPanel'); if (panel) panel.classList.add('hidden'); }

$('#analyzeButton').addEventListener('click', async () => {
  if (state.files.length < 2) return toast('请至少选择 2 个 Excel 文件');
  if (currentRule() === 'fixed' && nonnegative('#headerRow') <= nonnegative('#topSkip')) return toast('标题所在行必须位于顶部不合并行数之后');
  try { setBusy(true, '正在浏览器内读取并识别表头…'); applyAnalysis(await analyzeFiles(config())); $('#reviewSection').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  catch (error) { toast(error.message); } finally { setBusy(false); }
});

/* ===================== 列映射：同名精确匹配 + 本地同义词兜底 ===================== */
const SYNONYM_GROUPS = [
  ['姓名', '学生姓名', '考生姓名', '学员姓名'],
  ['学号', '学生编号', '考生号', '考生编号', '学籍号'],
  ['班级', '行政班级', '班级名称', '所在班级'],
  ['学院', '院系', '所在学院', '院系名称', '二级学院'],
  ['专业', '专业名称', '所学专业'],
  ['联系电话', '手机号', '手机号码', '电话号码', '联系方式', '手机'],
  ['身份证号', '身份证号码', '证件号码'],
  ['邮箱', '电子邮件', '电子邮箱', 'email'],
  ['政治面貌', '政治面目'],
  ['入学日期', '入学时间', '报到日期', '注册日期'],
  ['宿舍', '寝室', '宿舍号', '寝室号', '宿舍编号'],
  ['辅导员', '班主任'],
  ['籍贯', '出生地'],
];
function synonymGroupOf(key) {
  const group = SYNONYM_GROUPS.find(group => group.includes(key));
  return group ? group.slice() : null;
}
function buildMappings() {
  state.mappings = {};
  state.analyses.forEach((item, fileIndex) => {
    const keys = item.headers.map(normalize);
    const mapping = state.outputHeaders.map(header => {
      const matches = keys.map((key, index) => key === normalize(header) ? index : -1).filter(index => index >= 0);
      return matches.length === 1 ? matches[0] : -1;
    });
    const used = new Set(mapping.filter(value => value >= 0));
    state.outputHeaders.forEach((header, outputIndex) => {
      if (mapping[outputIndex] >= 0) return;
      const group = synonymGroupOf(normalize(header));
      if (!group) return;
      const candidates = keys.map((key, index) => (!used.has(index) && group.includes(key)) ? index : -1).filter(index => index >= 0);
      if (candidates.length === 1) { mapping[outputIndex] = candidates[0]; used.add(candidates[0]); }
    });
    state.mappings[fileIndex] = mapping;
  });
}
function applyAnalysis(data) {
  state.analyses = data.files; state.standardIndex = 0; state.outputHeaders = [...data.standardHeaders]; state.outputCustomized = false; refreshIssues(); buildMappings(); renderReview();
  state.analysisSignature = signature(); $('#reviewSection').classList.remove('hidden'); $('#mergeSection').classList.remove('hidden'); $('#confirmDifferences').checked = false;
}
function actualDifferences() {
  if (!state.analyses.length) return false; const standard = state.analyses[state.standardIndex]?.headers.map(normalize) || [];
  return state.analyses.some((item, i) => i !== state.standardIndex && (item.headers.length !== standard.length || item.headers.some((header, index) => normalize(header) !== standard[index]))) || state.analyses.some(item => item.warnings.length);
}
function refreshIssues() { const standard = state.analyses[state.standardIndex]?.headers || []; state.analyses.forEach(item => { item.issues = compareHeaders(standard, item.headers); }); }
function setStandard(fileIndex) { state.standardIndex = fileIndex; state.outputHeaders = [...state.analyses[fileIndex].headers]; state.outputCustomized = false; refreshIssues(); buildMappings(); $('#confirmDifferences').checked = false; renderReview(); }
function renderReview() {
  state.hasDifferences = actualDifferences(); const totalRows = state.analyses.reduce((sum, item) => sum + item.rowCount, 0); const summary = $('#reviewSummary');
  summary.className = `summary-banner${state.hasDifferences ? ' warn' : ''}`;
  summary.innerHTML = state.hasDifferences ? `发现需要核对的表头差异。共 <b>${state.analyses.length}</b> 个文件、预计 <b>${totalRows}</b> 行数据；请查看黄色提示并确认列映射。` : `所有文件表头一致。共 <b>${state.analyses.length}</b> 个文件、预计 <b>${totalRows}</b> 行数据。`;
  $('#differenceConfirm').classList.toggle('hidden', !state.hasDifferences); renderOutputHeaders(); renderFileReviews();
}
function renderOutputHeaders() {
  $('#outputHeaders').innerHTML = state.outputHeaders.map((header, index) => `<div class="header-item"><input data-header-index="${index}" value="${escapeHtml(header)}" aria-label="输出列 ${index + 1}"><span class="header-actions"><button data-move-header="${index}" data-direction="-1" title="向前移动"${index === 0 ? ' disabled' : ''}>←</button><button data-move-header="${index}" data-direction="1" title="向后移动"${index === state.outputHeaders.length - 1 ? ' disabled' : ''}>→</button><button data-remove-header="${index}" title="删除此输出列">×</button></span></div>`).join('');
  $$('[data-header-index]').forEach(input => input.addEventListener('input', event => { state.outputHeaders[Number(event.target.dataset.headerIndex)] = event.target.value; state.outputCustomized = true; renderFileReviews(); renderDedupKeys(); }));
  $$('[data-remove-header]').forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.removeHeader);
    if (state.outputHeaders.length <= 1) return toast('至少保留一个输出列');
    state.outputHeaders.splice(index, 1); state.outputCustomized = true;
    Object.values(state.mappings).forEach(mapping => mapping.splice(index, 1));
    state.dedupKeys = new Set([...state.dedupKeys].filter(value => value !== index).map(value => value > index ? value - 1 : value));
    renderReview();
  }));
  $$('[data-move-header]').forEach(button => button.addEventListener('click', () => {
    const from = Number(button.dataset.moveHeader), to = from + Number(button.dataset.direction);
    if (to < 0 || to >= state.outputHeaders.length) return;
    [state.outputHeaders[from], state.outputHeaders[to]] = [state.outputHeaders[to], state.outputHeaders[from]]; state.outputCustomized = true;
    Object.values(state.mappings).forEach(mapping => { [mapping[from], mapping[to]] = [mapping[to], mapping[from]]; });
    if (state.dedupKeys.has(from) !== state.dedupKeys.has(to)) {
      const next = new Set(state.dedupKeys);
      next.delete(from); next.delete(to);
      if (state.dedupKeys.has(from)) next.add(to);
      if (state.dedupKeys.has(to)) next.add(from);
      state.dedupKeys = next;
    }
    renderReview();
  }));
  renderDedupKeys();
}
$('#addHeaderButton').addEventListener('click', () => { state.outputHeaders.push(`新列${state.outputHeaders.length + 1}`); state.outputCustomized = true; Object.values(state.mappings).forEach(mapping => mapping.push(-1)); renderReview(); });
function renderFileReviews() {
  $('#fileReviews').innerHTML = state.analyses.map((item, fileIndex) => {
    const issues = item.issues || [], badMapping = (state.mappings[fileIndex] || []).some(value => value === -1), warnings = [...item.warnings];
    const issueBlock = issues.length ? `<ul class="issue-list">${issues.map(issue => `<li>${escapeHtml(issueText(issue))}</li>`).join('')}</ul>` : '';
    const warningBlock = warnings.length ? `<div class="file-warnings">⚠ ${warnings.map(escapeHtml).join('；')}</div>` : '';
    const rows = state.outputHeaders.map((header, outputIndex) => {
      const selected = state.mappings[fileIndex]?.[outputIndex] ?? -1;
      const options = `<option value="-1">— 请选择来源列 —</option><option value="-2"${selected === -2 ? ' selected' : ''}>（该文件此列留空）</option>` + item.headers.map((actual, actualIndex) => `<option value="${actualIndex}"${selected === actualIndex ? ' selected' : ''}>${escapeHtml(item.columnLetters[actualIndex])} · ${escapeHtml(actual || '（空白列）')}</option>`).join('');
      return `<tr><td>${outputIndex + 1}</td><td>${escapeHtml(header || '（输出列名为空）')}</td><td><select class="${selected === -1 ? 'invalid' : ''}" data-map-file="${fileIndex}" data-map-output="${outputIndex}">${options}</select></td></tr>`;
    }).join('');
    const hasIssue = issues.length || warnings.length || badMapping;
    const preview = item.preview?.length ? `<details class="data-preview"><summary>查看识别后的前 ${item.preview.length} 行数据预览</summary><div><table><thead><tr>${item.headers.map(header => `<th>${escapeHtml(header || '（空）')}</th>`).join('')}</tr></thead><tbody>${item.preview.map(row => `<tr>${item.headers.map((_, index) => `<td>${escapeHtml(row[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '';
    const sheetControl = item.sheets?.length > 1 ? `<div class="sheet-control"><label>选择工作表<select data-sheet-file="${fileIndex}">${item.sheets.map(name => `<option value="${escapeHtml(name)}"${name === item.sheet ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label></div>` : '';
    const standardButton = fileIndex === state.standardIndex ? '<button class="standard-button current" disabled>当前标准表头</button>' : `<button class="standard-button" data-standard-file="${fileIndex}">设为标准表头</button>`;
    return `<article class="review-file${hasIssue ? ' has-issue' : ''}"><div class="review-file-head"><span class="file-order">${fileIndex + 1}</span><div class="file-title"><b>${escapeHtml(item.name)}</b><small>工作表：${escapeHtml(item.sheet)} · 预计数据 ${item.rowCount} 行 · ${item.headers.length} 列</small>${standardButton}</div>${sheetControl}<div class="head-row-control"><label>当前表头行<input class="header-row-input" data-header-row="${fileIndex}" type="number" min="1" value="${item.headerRow}"></label></div><span class="issue-pill ${hasIssue ? '' : 'ok-pill'}">${hasIssue ? `需核对 ${issues.length + warnings.length + (badMapping ? 1 : 0)} 项` : '表头一致'}</span></div>${warningBlock}${issueBlock}<table class="mapping-table"><thead><tr><th>#</th><th>输出列</th><th>此文件对应的来源列</th></tr></thead><tbody>${rows}</tbody></table>${preview}</article>`;
  }).join('');
  $$('[data-map-file]').forEach(select => select.addEventListener('change', event => { const file = Number(event.target.dataset.mapFile), output = Number(event.target.dataset.mapOutput); state.mappings[file][output] = Number(event.target.value); event.target.classList.toggle('invalid', Number(event.target.value) === -1); }));
  $$('[data-header-row]').forEach(input => input.addEventListener('input', event => { state.analyses[Number(event.target.dataset.headerRow)].headerRow = Math.max(1, Number(event.target.value) || 1); }));
  $$('[data-sheet-file]').forEach(select => select.addEventListener('change', event => { state.analyses[Number(event.target.dataset.sheetFile)].sheet = event.target.value; toast('工作表已修改，请点击“重新识别”'); }));
  $$('[data-standard-file]').forEach(button => button.addEventListener('click', () => setStandard(Number(button.dataset.standardFile))));
}
$('#reanalyzeButton').addEventListener('click', async () => {
  try {
    setBusy(true, '正在按修改后的表头行重新分析…'); const oldHeaders = [...state.outputHeaders]; const data = await analyzeFiles(config());
    state.analyses = data.files; state.standardIndex = Math.min(state.standardIndex, state.analyses.length - 1); state.outputHeaders = state.outputCustomized && oldHeaders.length ? oldHeaders : [...state.analyses[state.standardIndex].headers]; refreshIssues(); buildMappings(); renderReview(); state.analysisSignature = signature(); $('#confirmDifferences').checked = false; toast('已完成重新识别');
  } catch (error) { toast(error.message); } finally { setBusy(false); }
});

/* ===================== 合并后去重设置 ===================== */
function dedupConfig() {
  const toggle = $('#dedupEnabled');
  if (!toggle || !toggle.checked) return null;
  const modeInput = $$('input[name="dedupMode"]').find(input => input.checked);
  const keys = [...state.dedupKeys].sort((a, b) => a - b).filter(index => index < state.outputHeaders.length);
  return { mode: modeInput ? modeInput.value : 'all', keys, action: $('#dedupAction') && $('#dedupAction').value === 'mark' ? 'mark' : 'drop' };
}
function renderDedupKeys() {
  const host = $('#dedupKeyCols');
  if (!host) return;
  host.innerHTML = state.outputHeaders.map((header, index) => `<label class="key-chip"><input type="checkbox" data-dedup-key="${index}"${state.dedupKeys.has(index) ? ' checked' : ''}><span>${escapeHtml(header || `列${index + 1}`)}</span></label>`).join('');
  $$('[data-dedup-key]').forEach(input => input.addEventListener('change', () => { const index = Number(input.dataset.dedupKey); if (input.checked) state.dedupKeys.add(index); else state.dedupKeys.delete(index); }));
}
function wireDedupControls() {
  const toggle = $('#dedupEnabled');
  if (!toggle) return;
  toggle.addEventListener('change', () => { $('#dedupDetail').classList.toggle('hidden', !toggle.checked); });
  $$('input[name="dedupMode"]').forEach(input => input.addEventListener('change', () => { $('#dedupKeyCols').classList.toggle('hidden', ($$('input[name="dedupMode"]').find(input => input.checked) || {}).value !== 'keys'); }));
}
function dedupKeyOf(values, keyIndices) {
  return keyIndices.map(index => {
    const value = text(values[index]);
    return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) ? `#${Number(value)}` : value;
  }).join('\u0001');
}
function applyDedup(dataRows, keyIndices, action) {
  const seen = new Map(), kept = [], flags = [];
  const trackFlags = action === 'mark';
  let removed = 0, marked = 0;
  dataRows.forEach((values, index) => {
    const key = dedupKeyOf(values, keyIndices);
    const first = seen.get(key);
    if (first == null) { seen.set(key, index + 1); kept.push(values); if (trackFlags) flags.push('首次'); }
    else if (trackFlags) { kept.push(values); flags.push(`与第${first}行重复`); marked += 1; }
    else removed += 1;
  });
  return { rows: kept, flags: trackFlags ? flags : null, removed, marked };
}

function validateBeforeMerge() {
  if (state.analysisSignature !== signature()) return '规则或表头行已修改，请先点击“重新识别”';
  const headers = state.outputHeaders.map(value => value.trim()); if (!headers.length || headers.some(value => !value)) return '输出表头不能有空白列名';
  const keys = headers.map(normalize); if (new Set(keys).size !== keys.length) return '输出表头不能包含重复列名';
  for (let fileIndex = 0; fileIndex < state.analyses.length; fileIndex += 1) {
    const mapping = state.mappings[fileIndex] || [];
    if (mapping.length !== headers.length || mapping.some(value => value === -1)) return `${state.analyses[fileIndex].name} 还有输出列未选择来源列或“留空”`;
    const selected = mapping.filter(value => value >= 0); if (new Set(selected).size !== selected.length) return `${state.analyses[fileIndex].name} 的同一来源列被重复使用`;
  }
  const dedup = dedupConfig();
  if (dedup && dedup.mode === 'keys' && !dedup.keys.length) return '合并后去重选择了“按关键列判断”，请至少勾选一个关键列';
  if (state.hasDifferences && !$('#confirmDifferences').checked) return '请先核对差异并勾选确认'; return '';
}
function safeOutputName(value, extension = 'xlsx') {
  let name = String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || `Excel合并结果.${extension}`;
  name = name.replace(/\.(xlsx|xlsm|xlsb|xls|xltx|xltm|xlt|et|ett|ods|fods|ots|xml|csv|txt)$/i, `.${extension}`);
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
}
function saveBlob(blob, fileName) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
function sheetNameFor(index, fileName, used) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[\\/?*[\]:]/g, '_').slice(0, 26) || '文件';
  let name = `${index + 1}.${base}`;
  let counter = 2;
  while (used.has(name)) { name = `${index + 1}.${base.slice(0, 24)}(${counter})`; counter += 1; }
  used.add(name);
  return name.slice(0, 31);
}
async function buildMergedWorkbook() {
  const headers = state.outputHeaders.map(value => value.trim());
  const includeSource = $('#includeSource').checked;
  const formatSelect = $('#outputFormat');
  const format = formatSelect && formatSelect.value === 'csv' ? 'csv' : 'xlsx';
  const perFile = format === 'xlsx' && $('#perFileSheets') && $('#perFileSheets').checked;
  const dedup = dedupConfig();
  const collected = [], fileCounts = [], perFileData = [];
  const expectedRows = Math.max(1, state.analyses.reduce((sum, item) => sum + item.rowCount, 0)); let processedRows = 0;
  for (let fileIndex = 0; fileIndex < state.analyses.length; fileIndex += 1) {
    checkCancelled(); updateProgress(5 + (processedRows / expectedRows) * 70, `正在合并 ${fileIndex + 1}/${state.analyses.length}：${state.analyses[fileIndex].name}`); await yieldUi();
    const item = state.analyses[fileIndex], mapping = state.mappings[fileIndex]; let count = 0;
    const fileRows = [];
    for (const row of item._dataRows) {
      checkCancelled();
      const values = mapping.map(source => source >= 0 && source < row.cells.length ? row.cells[source] : null);
      if (!values.some(value => text(value))) continue;
      collected.push({ file: item.name, values }); fileRows.push(values); count += 1;
      if (collected.length > LIMITS.totalRows) throw new Error(`合并结果超过 ${LIMITS.totalRows.toLocaleString()} 行限制，请分批处理`);
      processedRows += 1; if (processedRows % 3000 === 0) { updateProgress(5 + (processedRows / expectedRows) * 70, `已整理 ${processedRows.toLocaleString()} 行`); await yieldUi(); }
    }
    fileCounts.push({ name: item.name, sheet: item.sheet, headerRow: item.headerRow, rows: count });
    perFileData.push({ name: item.name, rows: fileRows });
  }
  if (!collected.length) throw new Error('没有可合并的数据行，请检查表头行和末尾跳过行数');
  let dataValues = collected.map(item => item.values), flags = null, dedupText = '', dedupRemoved = 0, dedupMarked = 0;
  if (dedup) {
    const keyIndices = dedup.mode === 'keys' ? dedup.keys : headers.map((_, index) => index);
    const result = applyDedup(dataValues, keyIndices, dedup.action);
    dataValues = result.rows; flags = result.flags;
    dedupRemoved = result.removed; dedupMarked = result.marked;
    dedupText = dedup.action === 'mark' ? `标记重复 ${result.marked} 行` : `剔除重复 ${result.removed} 行`;
  }
  const outputHeaders = [...headers];
  if (flags) outputHeaders.push('重复标记');
  if (includeSource) outputHeaders.unshift('来源文件');
  const outputRows = [outputHeaders];
  dataValues.forEach((values, index) => {
    let row = flags ? [...values, flags[index]] : values.slice();
    if (includeSource) row = [collected[index].file, ...row];
    outputRows.push(row);
  });
  checkCancelled(); updateProgress(78, `正在生成 ${format === 'csv' ? 'CSV 文件' : 'Excel 文件'}…`); await yieldUi();
  if (format === 'csv') {
    const csvSheet = XLSX.utils.aoa_to_sheet(outputRows, { cellDates: true });
    const csv = XLSX.utils.sheet_to_csv(csvSheet);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    updateProgress(100, '合并完成');
    return { blob, rows: outputRows.length - 1, columns: outputHeaders.length, fileCounts, format, dedupText, dedupRemoved, dedupMarked };
  }
  const resultSheet = XLSX.utils.aoa_to_sheet(outputRows, { cellDates: true });
  resultSheet['!autofilter'] = { ref: `A1:${columnLetter(outputHeaders.length - 1)}${outputRows.length}` };
  resultSheet['!cols'] = outputHeaders.map(value => ({ wch: Math.max(12, Math.min(40, text(value).length * 2 + 4)) }));
  const metadata = [['Excel 表格合并说明', ''], ['生成时间', new Date()], ['合并规则', currentRule() === 'auto' ? '自动识别表头' : '指定表头行'], ['数据读取方式', $('#preserveDisplay').checked ? '保留 Excel 显示内容（文本）' : '保留底层原始值'], ['隐藏行处理', $('#excludeHidden').checked ? '不合并隐藏行' : '合并隐藏行'], ['顶部不合并行数', nonnegative('#topSkip')], ['末尾不合并行数', nonnegative('#tailSkip')], ['输出数据行', outputRows.length - 1]];
  if (dedup) metadata.push(['去重设置', dedup.mode === 'keys' ? `按关键列（${dedup.keys.map(index => headers[index] || `列${index + 1}`).join('、')}）判断，${dedup.action === 'mark' ? '仅标记不删除' : '保留首次出现'}` : `整行内容相同，${dedup.action === 'mark' ? '仅标记不删除' : '保留首次出现'}`], [dedup.action === 'mark' ? '标记重复行' : '剔除重复行', dedup.action === 'mark' ? dedupMarked : dedupRemoved]);
  if (perFile) metadata.push(['分文件工作表', `已按来源文件生成 ${perFileData.length} 个工作表（不参与去重）`]);
  metadata.push([], ['来源文件', '工作表', '表头行', '合并行数'], ...fileCounts.map(item => [item.name, item.sheet, item.headerRow, item.rows]));
  const metadataSheet = XLSX.utils.aoa_to_sheet(metadata, { cellDates: true }); metadataSheet['!cols'] = [{ wch: 46 }, { wch: 28 }, { wch: 14 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, resultSheet, '合并结果'); XLSX.utils.book_append_sheet(workbook, metadataSheet, '合并说明');
  if (perFile) {
    const used = new Set(['合并结果', '合并说明']);
    perFileData.forEach((file, index) => {
      const rows = [[headers, ...file.rows]];
      const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
      sheet['!cols'] = headers.map(value => ({ wch: Math.max(12, Math.min(40, text(value).length * 2 + 4)) }));
      XLSX.utils.book_append_sheet(workbook, sheet, sheetNameFor(index, file.name, used));
    });
  }
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, cellDates: true });
  checkCancelled(); updateProgress(92, '正在回读校验表头和行数…'); await yieldUi();
  const verify = XLSX.read(bytes, { type: 'array', cellDates: true });
  const verifiedRows = XLSX.utils.sheet_to_json(verify.Sheets['合并结果'], { header: 1, defval: null, raw: true, blankrows: true });
  if (verifiedRows.length !== outputRows.length || verifiedRows[0].map(text).join('\u0001') !== outputHeaders.map(text).join('\u0001')) throw new Error('导出后回读校验失败：表头或数据行数不一致');
  updateProgress(100, '合并完成并通过回读校验');
  return { blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), rows: outputRows.length - 1, columns: outputHeaders.length, fileCounts, format, dedupText, dedupRemoved, dedupMarked };
}

/* ===================== 历史记录 ===================== */
function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('浏览器已禁用本地数据库'));
    const request = indexedDB.open(DB_NAME, 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('无法打开浏览器本地数据库'));
  });
}
async function dbAction(mode, callback) {
  const db = await openDb();
  try { return await new Promise((resolve, reject) => { const tx = db.transaction(STORE_NAME, mode), store = tx.objectStore(STORE_NAME); let result; try { result = callback(store); } catch (error) { reject(error); return; } tx.oncomplete = () => resolve(result?.result); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
async function saveHistory(record) {
  try {
    if (record.blob.size > LIMITS.historyBytes) return { saved: false, warning: '结果文件超过 100MB，未保存到历史记录' };
    const payload = Object.assign({}, record); delete payload.blob;
    payload.title = record.output; payload.summary = `${record.fileCount} 个文件 · ${record.rows} 行 · ${record.columns} 列`;
    await ToolHistory.save('excelMerge', payload, [{ role: 'merged-output', name: record.output, mime: record.blob.type, blob: record.blob }]);
    return { saved: true, warning: '' };
  } catch (error) { return { saved: false, warning: `历史记录未保存：${error.message}` }; }
}
async function getHistory() { const index = await ToolHistory.list('excelMerge'); return (await Promise.all(index.map(item => ToolHistory.get('excelMerge', item.id)))).filter(Boolean); }
async function deleteHistory(id) { await ToolHistory.remove('excelMerge', id); }
async function clearHistory() { await ToolHistory.clear('excelMerge'); }
async function migrateLegacyHistory() {
  let items = [];
  try { items = await dbAction('readonly', store => store.getAll()) || []; } catch (_error) { return; }
  for (const item of items) {
    if (!item || !item.id || !item.blob) continue;
    const saved = await saveHistory(item);
    if (saved.saved) await dbAction('readwrite', store => store.delete(item.id));
  }
}

$('#mergeButton').addEventListener('click', async () => {
  const invalid = validateBeforeMerge(); if (invalid) return toast(invalid); const message = $('#mergeMessage');
  try {
    setBusy(true, '正在浏览器内合并并回读校验…'); message.classList.add('hidden'); await yieldUi();
    const result = await buildMergedWorkbook(), output = safeOutputName($('#outputName').value, result.format === 'csv' ? 'csv' : 'xlsx'), id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    saveBlob(result.blob, output);
    const record = { id, at: new Date().toISOString(), output, format: result.format, fileCount: state.files.length, rows: result.rows, columns: result.columns, rule: currentRule() === 'fixed' ? '指定表头行' : '自动识别表头', files: state.analyses.map(item => item.name), verified: result.format === 'xlsx', size: result.blob.size, blob: result.blob };
    const historyResult = await saveHistory(record);
    message.className = `message${historyResult.saved ? '' : ' warning'}`; message.innerHTML = `✅ 合并完成${result.format === 'xlsx' ? '并通过回读校验' : ''}：${result.rows} 行、${result.columns} 列${result.dedupText ? `；${result.dedupText}` : ''}；文件已下载（${escapeHtml(output)}）。${historyResult.warning ? `<small>${escapeHtml(historyResult.warning)}</small>` : ''}<button class="inline-download" id="downloadAgain">再次下载</button>`;
    $('#downloadAgain').addEventListener('click', () => saveBlob(result.blob, output)); await loadHistory(); message.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { message.className = 'message error'; message.textContent = `合并失败：${error.message}`; } finally { setBusy(false); }
});
async function loadHistory() { try { renderHistory(await getHistory()); } catch (error) { $('#historyList').className = 'history-list empty'; $('#historyList').textContent = `当前浏览器不支持本地历史记录：${error.message}`; } }
function renderHistory(items) {
  const list = $('#historyList'); if (!items.length) { list.className = 'history-list empty'; list.textContent = '暂无合并记录'; return; }
  list.className = 'history-list'; list.innerHTML = items.map(item => `<div class="history-item"><span class="history-icon">📗</span><div class="history-main"><b>${escapeHtml(item.output)}</b><p>${new Date(item.at).toLocaleString('zh-CN')} · ${item.fileCount} 个文件 · ${item.rows} 行${item.format === 'csv' ? ' · CSV' : ''} · ${escapeHtml(item.rule)}${item.verified ? ' · 已回读校验' : ''}</p></div><div class="history-actions"><button class="download-history" data-download-history="${escapeHtml(item.id)}">下载</button><button data-delete-history="${escapeHtml(item.id)}">删除</button></div></div>`).join('');
  $$('[data-download-history]').forEach(button => button.addEventListener('click', async () => { const record = await ToolHistory.get('excelMerge', button.dataset.downloadHistory), file = record?.attachments?.find(item => item.role === 'merged-output') || record?.attachments?.[0]; if (file) ToolHistory.download(file); else toast('历史文件不存在'); }));
  $$('[data-delete-history]').forEach(button => button.addEventListener('click', async () => { if (!confirm('删除该历史记录及生成文件？')) return; await deleteHistory(button.dataset.deleteHistory); await loadHistory(); }));
}
$('#clearHistory').addEventListener('click', async () => { if (!confirm('清空全部历史记录及已生成文件？此操作不可恢复。')) return; try { await clearHistory(); await loadHistory(); } catch (error) { toast(error.message); } });

/* ===================== AI 入口绑定（独立版无这些按钮时自动跳过） ===================== */
if ($('#aiMappingButton')) $('#aiMappingButton').addEventListener('click', event => runAiMapping(event.currentTarget));
if ($('#aiHeaderButton')) $('#aiHeaderButton').addEventListener('click', event => runAiHeaderSuggestion(event.currentTarget));
if ($('#aiCheckButton')) $('#aiCheckButton').addEventListener('click', event => runAiCheck(event.currentTarget));
if ($('#aiBadge')) $('#aiBadge').addEventListener('click', () => { if (aiReady()) toast('AI 已就绪：智能映射、表头规范与合并前核查可用'); else openAiConfig(); });
if ($('#aiPanelClose')) $('#aiPanelClose').addEventListener('click', () => $('#aiPanel').classList.add('hidden'));

async function init() {
  renderFiles();
  wireDedupControls();
  wireDropZone();
  refreshAiBadge();
  try { if (parentWorkbench() && typeof parentWorkbench().addEventListener === 'function') parentWorkbench().addEventListener('ai-config-changed', refreshAiBadge); } catch (error) {}
  if (typeof XLSX === 'undefined') { $('#healthText').textContent = 'Excel 离线组件加载失败'; toast('缺少 xlsx.full.min.js，无法读取 Excel'); return; }
  $('#healthDot').classList.add('ok'); $('#healthText').textContent = `系统数据库持久化 · 离线组件 ${XLSX.version}`; await migrateLegacyHistory(); await loadHistory();
}
init();

/* 首次进入独立页面时的使用须知（仅独立版页面存在该弹窗时启用） */
const NOTICE_SEEN_KEY = 'excel-merge-assistant-notice-v1';
function showFirstVisitNotice() {
  const overlay = $('#noticeOverlay');
  if (!overlay) return;
  let seen = false;
  try { seen = Boolean(localStorage.getItem(NOTICE_SEEN_KEY)); } catch { seen = false; }
  if (seen) return;
  const dismiss = () => {
    try { localStorage.setItem(NOTICE_SEEN_KEY, String(Date.now())); } catch { /* 记录失败时下次进入会再次提示 */ }
    overlay.classList.add('hidden');
    document.removeEventListener('keydown', onKeydown);
  };
  const onKeydown = event => { if (event.key === 'Escape') dismiss(); };
  $('#noticeConfirm').addEventListener('click', dismiss);
  document.addEventListener('keydown', onKeydown);
  overlay.classList.remove('hidden');
}
showFirstVisitNotice();

window.ExcelMergeApp = { state, LIMITS, acceptFiles, config, dedupConfig, applyDedup, buildMappings, applyAnalysis, validateBeforeMerge, analyzeFiles: () => analyzeFiles(config()), buildMergedWorkbook };
