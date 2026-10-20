/* Excel 表格合并助手 · 后台解析线程
 * 只做文件解析与行提取，主线程与线程之间只传输行数组，不传整个工作簿对象。
 */
/* xlsx 库：优先与 worker 同目录（独立版），失败时回退站点根路径（数智学工主系统由 web-server 映射） */
try { importScripts('xlsx.full.min.js'); }
catch (relativeError) { importScripts('/xlsx.full.min.js'); }
importScripts('excel-merge-extract.js');

self.onmessage = event => {
  try {
    const payload = event.data || {};
    const result = ExcelMergeExtract.extractSheetData(payload.buffer, {
      textFormat: payload.textFormat,
      requestedSheet: payload.requestedSheet,
      preserveDisplay: payload.preserveDisplay,
      excludeHidden: payload.excludeHidden,
    });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || '工作簿解析失败' });
  }
};
