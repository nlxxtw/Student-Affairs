/* Excel 表格合并助手 · 共享提取模块
 * 被 excel-merge-worker.js（importScripts）与主线程回退路径（<script>）共同使用。
 * 职责：CSV/TXT 编码识别、工作表选择、合并单元格填充、行数据提取与公式扫描。
 */
(function (global) {
  'use strict';

  function decodeTextBytes(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (error) { return new TextDecoder('gbk').decode(bytes); }
  }

  function chooseSheet(workbook, requestedName) {
    const details = workbook.Workbook?.Sheets || [];
    const visibleNames = workbook.SheetNames.filter((name, index) => !details[index] || !details[index].Hidden);
    if (!visibleNames.length) throw new Error('工作簿没有可见工作表');
    const activeIndex = Number(workbook.Workbook?.WBView?.[0]?.activeTab ?? workbook.Workbook?.WBView?.[0]?.activetab ?? 0);
    const activeName = workbook.SheetNames[activeIndex];
    const preferred = requestedName && visibleNames.includes(requestedName) ? requestedName : activeName;
    return { name: visibleNames.includes(preferred) ? preferred : visibleNames[0], visibleNames, visibleCount: visibleNames.length };
  }

  function fillMergedCells(rows, sheet) {
    const merges = sheet && sheet['!merges'];
    if (!merges || !merges.length) return;
    merges.forEach(range => {
      const value = rows[range.s.r] ? rows[range.s.r][range.s.c] : null;
      if (value == null || String(value).trim() === '') return;
      for (let r = range.s.r; r <= range.e.r; r += 1) {
        if (!rows[r]) continue;
        for (let c = range.s.c; c <= range.e.c; c += 1) rows[r][c] = value;
      }
    });
  }

  function extractSheetData(data, options) {
    if (typeof XLSX === 'undefined') throw new Error('缺少 xlsx.full.min.js，无法读取 Excel');
    const opts = options || {};
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const asText = !!opts.textFormat;
    /* cellStyles 仅在需要识别隐藏行时开启（行 hidden 标记随样式解析，开销较大） */
    const workbook = XLSX.read(asText ? decodeTextBytes(bytes) : bytes, { type: asText ? 'string' : 'array', cellDates: true, cellFormula: true, sheetStubs: true, cellStyles: !!opts.excludeHidden });
    const choice = chooseSheet(workbook, opts.requestedSheet);
    const sheet = workbook.Sheets[choice.name];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
    const displayRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false, blankrows: true });
    fillMergedCells(rawRows, sheet);
    fillMergedCells(displayRows, sheet);
    const width = Math.max(rawRows.length, displayRows.length);
    const hiddenRows = sheet['!rows'] || [];
    let hiddenFlags = '';
    const rows = [];
    for (let index = 0; index < width; index += 1) {
      hiddenFlags += hiddenRows[index] && hiddenRows[index].hidden ? '1' : '0';
      const rawRow = rawRows[index] || [], displayRow = displayRows[index] || [];
      if (opts.preserveDisplay) {
        const merged = new Array(Math.max(rawRow.length, displayRow.length));
        for (let c = 0; c < merged.length; c += 1) merged[c] = displayRow[c] ?? rawRow[c] ?? null;
        rows.push(merged);
      } else rows.push(rawRow);
    }
    const formulaCells = Object.keys(sheet).filter(address => !address.startsWith('!') && sheet[address] && sheet[address].f);
    const uncached = formulaCells.filter(address => sheet[address].t === 'z' || sheet[address].v == null || sheet[address].v === '');
    return {
      sheetName: choice.name, visibleNames: choice.visibleNames, visibleCount: choice.visibleCount,
      rows, hiddenFlags, formulaCount: formulaCells.length, uncachedFormulaCount: uncached.length,
      uncachedSamples: uncached.slice(0, 5),
    };
  }

  global.ExcelMergeExtract = { decodeTextBytes, chooseSheet, fillMergedCells, extractSheetData };
})(typeof self !== 'undefined' ? self : this);
