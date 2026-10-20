const $ = s => document.querySelector(s), files = {}, outputUrls = new Map();
let latestAiCheckSummary = null, latestAiCheckDiagnostics = [];
const requiredKeys = ["zongce1", "zongce2", "academic", "course", "template"], headers = ["学号","姓名","学院","班级","综测1","综测2","综测（平均）","综测排名","综测排名百分比","学分加权平均分","学分加权平均分排名","学分加权平均分排名百分比","平均学分绩点","平均学分绩点排名","平均学分绩点排名百分比","最低分","最低分科目","补考科目","重修科目"], cacheDatabaseName = "ce-summary-local-cache-v1", cacheDatabaseVersion = 1, maxHistoryRecords = 30;
const supportedSpreadsheetFormats = ["xlsx", "xlsm", "xlsb", "xltx", "xltm", "xls", "xlt", "xml", "et", "ett", "ods", "fods", "csv", "tsv"];
const sourceLabels = { zongce1: "第 1 学期综测", zongce2: "第 2 学期综测", academic: "学业成绩", course: "课程成绩" };
function toast(message, error = false) { const el = $("#toast"); el.textContent = message; el.className = `show${error ? " error" : ""}`; clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.className = "", 4000); }
const tidy = v => String(v ?? "").trim();
const hkey = v => tidy(v).replace(/[\s　_\-（）()]/g, "").toLowerCase();
const sid = v => { const x = tidy(v).replace(/\.0$/, ""); return /^\d{5,20}$/.test(x) ? x : ""; };
const num = v => { const m = tidy(v).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
// Export numeric values after decimal rounding instead of relying on Excel's display format alone.
// Percentages remain real Excel percentage numbers: 33.33% is stored as 0.3333, so rounding a
// displayed percentage to two decimal places requires four decimal places in the underlying ratio.
function roundDecimal(value, digits = 2) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const sign = number < 0 ? -1 : 1, absolute = Math.abs(number), parts = absolute.toString().split("e"), exponent = Number(parts[1] || 0);
  const shifted = Number(`${parts[0]}e${exponent + digits}`), rounded = sign * Number(`${Math.round(shifted)}e-${digits}`);
  return Object.is(rounded, -0) ? 0 : rounded;
}
const two = n => roundDecimal(n, 2);
const percentageTwo = (rank, total) => total ? roundDecimal(rank / total, 4) : 0;
const integer = n => n == null ? null : Math.round(n);
const val = (row, index) => index == null ? "" : row[index] ?? "";
const esc = v => String(v ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"}[x]));
function ready() { return requiredKeys.every(key => files[key]); }
function uniqueJoin(values) { return [...new Set(values.map(tidy).filter(Boolean))].join("、"); }
async function readWorksheets(file) {
  if (!window.XLSX) throw new Error("本地表格解析组件未加载，请确认 xlsx.full.min.js 与网页文件完整。");
  if (!file || !file.size) throw new Error(`${file?.name || "所选文件"} 是空文件，无法读取`);
  if (/^~\$/i.test(file.name)) throw new Error(`${file.name} 是 Excel/WPS 临时锁定文件，请选择正常保存的原文件`);
  let workbook;
  try {
    const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer), head = bytes.slice(0, 1024);
    const binarySignature = (bytes[0] === 0x50 && bytes[1] === 0x4B) || (bytes[0] === 0xD0 && bytes[1] === 0xCF) || head.includes(0);
    let input = buffer, inputType = "array", fallbackCodepage = 936;
    if (!binarySignature) {
      try { input = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); inputType = "string"; fallbackCodepage = null; }
      catch { /* WPS/Excel 导出的 ANSI 或 GBK 文本由 SheetJS 按 936 代码页解析。 */ }
    }
    workbook = XLSX.read(input, {
      type: inputType, cellDates: false, cellFormula: true, cellNF: true,
      cellStyles: true, cellText: true, dense: false, ...(fallbackCodepage ? { codepage: fallbackCodepage } : {}), WTF: false
    });
  } catch (error) {
    const wpsHint = /\.(?:et|ett)$/i.test(file.name) ? "；若该文件使用了 WPS 专有或加密格式，请在 WPS 中另存为 .xlsx 后重试" : "";
    throw new Error(`${file.name} 无法读取，文件可能已损坏、加密或不是有效表格${wpsHint}（${error?.message || "解析失败"}）`);
  }
  if (!workbook?.SheetNames?.length) throw new Error(`${file.name} 中没有可读取的工作表`);
  return workbook.SheetNames.map(name => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false, blankrows: true });
    return { name: name || "未命名工作表", rows: rows.map(row => Array.isArray(row) ? row : []) };
  });
}
function findColumns(rows, required) {
  for (let r = 0; r < Math.min(12, rows.length); r++) { const found = {}; rows[r].forEach((value, c) => { const key = hkey(value); for (const [name, aliases] of Object.entries(required)) if (!(name in found) && aliases.some(alias => key.includes(alias))) found[name] = c; }); if (Object.keys(found).length === Object.keys(required).length) return { row: r, cols: found }; }
  throw new Error(`未识别到必需列：${Object.keys(required).join("、")}`);
}
function selectWorksheet(worksheets, source, required) {
  for (const worksheet of worksheets) {
    try { return { ...worksheet, spec: findColumns(worksheet.rows, required) }; } catch { /* Continue scanning the next worksheet. */ }
  }
  return { source, worksheets, required, missing: true };
}
function locateColumn(rows, aliases) { for (const row of rows.slice(0, 12)) { for (let c = 0; c < row.length; c++) if (aliases.some(alias => hkey(row[c]).includes(alias))) return c; } return null; }
function repeatedIds(rows, spec, allowedIds = null) {
  const counts = new Map();
  rows.slice(spec.row + 1).forEach(row => { const id = sid(val(row, spec.cols["学号"])); if (id && (!allowedIds || allowedIds.has(id))) counts.set(id, (counts.get(id) || 0) + 1); });
  return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
}
function collectExtraStudents(sources, rosterIds) {
  const extras = new Map();
  sources.forEach(({ source, rows, spec }) => rows.slice(spec.row + 1).forEach(row => {
    const id = sid(val(row, spec.cols["学号"]));
    if (!id || rosterIds.has(id)) return;
    const name = spec.cols["姓名"] == null ? "" : tidy(val(row, spec.cols["姓名"]));
    const item = extras.get(id) || { id, name: "", sources: new Set() };
    if (!item.name && name) item.name = name;
    item.sources.add(source);
    extras.set(id, item);
  }));
  return [...extras.values()].map(item => ({ ...item, sources: [...item.sources] })).sort((a, b) => a.id.localeCompare(b.id));
}
function showValidationDialog(issues) {
  const dialog = $("#validation-dialog"), title = $("#validation-title"), intro = $("#validation-intro"), details = $("#validation-details");
  const blank = value => tidy(value) || "（空白）";
  const items = issues.map(issue => {
    if (issue.type === "duplicate") return `<section class="validation-block"><div class="validation-block-head">${esc(issue.source)}存在重复学号：${issue.ids.length} 个</div><div class="validation-list">${issue.ids.map(id => `<div class="validation-row"><strong>${esc(id)}</strong><span>同一学号在此文件中出现多次，请仅保留一条。</span></div>`).join("")}</div></section>`;
    if (issue.type === "missing-column") return `<section class="validation-block"><div class="validation-block-head">${esc(issue.source)}缺少“姓名”列</div><div class="validation-list"><div class="validation-row"><span>姓名核对无法进行，请补充该列后重新生成。</span></div></div></section>`;
    if (issue.type === "worksheet-not-found") return `<section class="validation-block"><div class="validation-block-head">未找到可用数据：${esc(issue.source)}</div><div class="validation-list"><div class="validation-row"><span>已扫描工作表：${esc(issue.worksheets.join("、") || "无")}；未识别到必需字段：${esc(issue.fields.join("、"))}。</span></div></div></section>`;
    return `<section class="validation-block"><div class="validation-block-head">姓名不一致：${esc(issue.source)}</div><div class="validation-list"><div class="validation-row validation-name-row"><strong>${esc(issue.id)}</strong><span>《汇总》：${esc(blank(issue.summaryName))}</span><span>${esc(issue.source)}：${esc(blank(issue.sourceName))}</span></div></div></section>`;
  }).join("");
  title.textContent = "数据核对未通过";
  intro.textContent = `发现 ${issues.length} 项数据问题。请按下方提示修正 Excel 文件后，再重新点击生成。`;
  details.innerHTML = items;
  if (dialog.open) dialog.close();
  dialog.querySelectorAll("[data-close-validation]").forEach(button => { button.onclick = () => dialog.close(); });
  dialog.showModal();
}
function showExtraStudentsDialog(students) {
  if (!students.length) return Promise.resolve(true);
  const dialog = $("#validation-dialog"), title = $("#validation-title"), intro = $("#validation-intro"), details = $("#validation-details");
  title.textContent = "发现《汇总》名单外学生";
  intro.textContent = `其他来源文件中有 ${students.length} 名学生不在《汇总》名单中，他们不会进入汇总结果。确认后继续生成。`;
  details.innerHTML = `<section class="validation-block"><div class="validation-block-head">名单外学生：${students.length} 人</div><div class="validation-list">${students.map(student => `<div class="validation-row validation-name-row"><strong>${esc(student.id)}</strong><span>${esc(student.name || "（姓名未提供）")}</span><span>来源：${esc(student.sources.join("、"))}</span></div>`).join("")}</div></section>`;
  const closeButton = dialog.querySelector(".dialog-close"), confirmButton = dialog.querySelector(".missing-actions .primary");
  confirmButton.textContent = "已知晓，继续生成";
  confirmButton.dataset.confirmExtra = "";
  if (dialog.open) dialog.close();
  return new Promise(resolve => {
    let settled = false;
    const finish = accepted => { if (settled) return; settled = true; dialog.removeEventListener("cancel", cancel); delete confirmButton.dataset.confirmExtra; confirmButton.textContent = "我已知晓"; if (dialog.open) dialog.close(); resolve(accepted); };
    const cancel = event => { event.preventDefault(); finish(false); };
    closeButton.onclick = () => finish(false);
    confirmButton.onclick = () => finish(true);
    dialog.addEventListener("cancel", cancel);
    dialog.showModal();
  });
}
function validateBeforeCalculate({ z1Rows, z2Rows, academicRows, templateRows, z1, z2, ac, tpl, rosterIds }) {
  const issues = [];
  [["第 1 学期综测", z1], ["第 2 学期综测", z2], ["《汇总》名单", tpl]].forEach(([source, spec]) => { if (spec.cols["姓名"] == null) issues.push({ type: "missing-column", source }); });
  [["第 1 学期综测", z1Rows, z1], ["第 2 学期综测", z2Rows, z2], ["学业成绩", academicRows, ac]].forEach(([source, rows, spec]) => { const ids = repeatedIds(rows, spec, rosterIds); if (ids.length) issues.push({ type: "duplicate", source, ids }); });
  const templateDuplicates = repeatedIds(templateRows, tpl); if (templateDuplicates.length) issues.push({ type: "duplicate", source: "《汇总》名单", ids: templateDuplicates });
  if (!issues.some(issue => issue.type === "missing-column" || issue.type === "duplicate")) {
    const summaryNames = new Map();
    templateRows.slice(tpl.row + 1).forEach(row => { const id = sid(val(row, tpl.cols["学号"])); if (id) summaryNames.set(id, tidy(val(row, tpl.cols["姓名"]))); });
    [["第 1 学期综测", z1Rows, z1], ["第 2 学期综测", z2Rows, z2]].forEach(([source, rows, spec]) => rows.slice(spec.row + 1).forEach(row => {
      const id = sid(val(row, spec.cols["学号"]));
      if (!id || !summaryNames.has(id)) return;
      const summaryName = summaryNames.get(id), sourceName = tidy(val(row, spec.cols["姓名"]));
      if (summaryName !== sourceName) issues.push({ type: "name-mismatch", source, id, summaryName, sourceName });
    }));
  }
  if (issues.length) { showValidationDialog(issues); throw new Error("数据核对未通过，请按弹窗提示修正后重新生成"); }
}
async function calculate() {
  latestAiCheckDiagnostics = [];
  const [z1Book, z2Book, academicBook, courseBook, templateBook] = await Promise.all(requiredKeys.map(key => readWorksheets(files[key])));
  const definitions = [
    { source: "第 1 学期综测", book: z1Book, required: { "学号": ["学号"], "姓名": ["姓名"], "综测总分": ["综测总分"] } },
    { source: "第 2 学期综测", book: z2Book, required: { "学号": ["学号"], "姓名": ["姓名"], "综测总分": ["综测总分"] } },
    { source: "学业成绩", book: academicBook, required: { "学号": ["学号"], "姓名": ["姓名"], "班级": ["班级"], "学分加权平均分": ["学分加权平均分"], "平均学分绩点": ["平均学分绩点"] } },
    { source: "课程成绩", book: courseBook, required: { "学号": ["学号"], "课程名称": ["课程名称"], "成绩": ["成绩"], "课程性质": ["课程性质", "考试性质", "考核性质"] } },
    { source: "《汇总》名单", book: templateBook, required: { "学号": ["学号"], "姓名": ["姓名"], "班级": ["班级"] } }
  ];
  const selections = definitions.map(item => selectWorksheet(item.book, item.source, item.required)), unavailable = selections.filter(item => item.missing);
  if (unavailable.length) { showValidationDialog(unavailable.map(item => ({ type: "worksheet-not-found", source: item.source, worksheets: item.worksheets.map(sheet => sheet.name), fields: Object.keys(item.required) }))); throw new Error("未找到可用的数据工作表，请按弹窗提示检查 Excel 文件"); }
  const [z1Sheet, z2Sheet, academicSheet, courseSheet, templateSheet] = selections;
  const z1Rows = z1Sheet.rows, z2Rows = z2Sheet.rows, academicRows = academicSheet.rows, courseRows = courseSheet.rows, templateRows = templateSheet.rows;
  const z1 = z1Sheet.spec, z2 = z2Sheet.spec, ac = academicSheet.spec, co = courseSheet.spec, tpl = templateSheet.spec;
  [z1, z2, ac, tpl].forEach(spec => { spec.cols["姓名"] = locateColumn(spec === z1 ? z1Rows : spec === z2 ? z2Rows : spec === ac ? academicRows : templateRows, ["姓名"]); });
  co.cols["姓名"] = locateColumn(courseRows, ["姓名"]);
  z1.cols["班级"] = locateColumn(z1Rows, ["班级"]); z2.cols["班级"] = locateColumn(z2Rows, ["班级"]); ac.cols["班级"] = locateColumn(academicRows, ["班级"]);
  const z1Score = locateColumn(z1Rows, ["综测总分"]), z2Score = locateColumn(z2Rows, ["综测总分"]), weighted = locateColumn(academicRows, ["学分加权平均分"]), rank = locateColumn(academicRows, ["学分加权平均分排名"]), gpa = locateColumn(academicRows, ["平均学分绩点"]), gpaRank = locateColumn(academicRows, ["平均学分绩点排名"]), college = locateColumn(academicRows, ["学院"]), courseClass = locateColumn(courseRows, ["班级"]), tplCollege = locateColumn(templateRows, ["学院"]);
  if ([z1Score, z2Score, weighted, gpa].some(x => x == null)) throw new Error("Excel 文件缺少规定的综测或学业成绩列");
  const rosterIds = new Set(templateRows.slice(tpl.row + 1).map(row => sid(val(row, tpl.cols["学号"]))).filter(Boolean));
  validateBeforeCalculate({ z1Rows, z2Rows, academicRows, templateRows, z1, z2, ac, tpl, rosterIds });
  const extraStudents = collectExtraStudents([
    { source: "第 1 学期综测", rows: z1Rows, spec: z1 },
    { source: "第 2 学期综测", rows: z2Rows, spec: z2 },
    { source: "学业成绩", rows: academicRows, spec: ac },
    { source: "课程成绩", rows: courseRows, spec: co }
  ], rosterIds);
  if (!(await showExtraStudentsDialog(extraStudents))) throw new Error("已取消生成；请核对《汇总》名单外学生");
  const students = new Map(), add = (id, name = "", academy = "", clazz = "") => { if (!id) return; const p = students.get(id) || { "学号": id, "姓名": "", "学院": "", "班级": "" }; [["姓名", name], ["学院", academy], ["班级", clazz]].forEach(([key, value]) => { if (tidy(value) && !p[key]) p[key] = tidy(value); }); students.set(id, p); };
  const zc = (rows, spec, scoreCol) => { const map = new Map(); rows.slice(spec.row + 1).forEach(row => { const id = sid(val(row, spec.cols["学号"])); if (!id) return; add(id, val(row, spec.cols["姓名"]), "", val(row, spec.cols["班级"])); map.set(id, num(val(row, scoreCol))); }); return map; };
  const zc1 = zc(z1Rows, z1, z1Score), zc2 = zc(z2Rows, z2, z2Score), academics = new Map(), courses = new Map();
  academicRows.slice(ac.row + 1).forEach((row, offset) => { const id = sid(val(row, ac.cols["学号"])); if (!id) return; const academicPerson = { "学号": id, "姓名": tidy(val(row, ac.cols["姓名"])), "学院": tidy(val(row, college)), "班级": tidy(val(row, ac.cols["班级"])) }; add(id, academicPerson["姓名"], academicPerson["学院"], academicPerson["班级"]); academics.set(id, { weighted: num(val(row, weighted)), gpa: num(val(row, gpa)), sourceRow: ac.row + offset + 2 }); });
  courseRows.slice(co.row + 1).forEach(row => { const id = sid(val(row, co.cols["学号"])); if (!id) return; add(id, "", "", val(row, courseClass)); const list = courses.get(id) || []; list.push({ name: tidy(val(row, co.cols["课程名称"])), score: num(val(row, co.cols["成绩"])), nature: tidy(val(row, co.cols["课程性质"])).replace(/\s/g, "") }); courses.set(id, list); });
  const selected = new Set(); templateRows.slice(tpl.row + 1).forEach(row => { const id = sid(val(row, tpl.cols["学号"])); if (!id) return; selected.add(id); add(id, val(row, tpl.cols["姓名"]), val(row, tplCollege)); const person = students.get(id); person["班级"] = tidy(val(row, tpl.cols["班级"])); if (tidy(val(row, tpl.cols["姓名"]))) person["姓名"] = tidy(val(row, tpl.cols["姓名"])); if (tidy(val(row, tplCollege))) person["学院"] = tidy(val(row, tplCollege)); });
  const population = new Map([...students].filter(([id]) => selected.has(id)));
  const missingClass = [...population].filter(([, p]) => !p["班级"]).map(([id]) => id); if (missingClass.length) throw new Error(`《汇总》名单中以下学生缺少班级：${missingClass.slice(0, 8).join("、")}${missingClass.length > 8 ? "等" : ""}`);
  const classSizes = new Map(); population.forEach(p => classSizes.set(p["班级"], (classSizes.get(p["班级"]) || 0) + 1));
  if (!population.size || !classSizes.size) throw new Error("《汇总》名单中未识别到有效的学号和班级");
  const scoreFrom = (map, id) => map.has(id) && map.get(id) != null ? map.get(id) : 0;
  const averages = new Map(); population.forEach((_, id) => { const a = scoreFrom(zc1, id), b = scoreFrom(zc2, id), semesters = Number(zc1.has(id) && zc1.get(id) != null) + Number(zc2.has(id) && zc2.get(id) != null); averages.set(id, semesters ? (a + b) / semesters : 0); });
  // 排名以导出时显示的两位小数为准，避免显示同分却出现不同名次。
  const rankedAverages = new Map(); averages.forEach((value, id) => rankedAverages.set(id, two(value)));
  const zRanks = new Map(); classSizes.forEach((_, clazz) => { const scores = [...population].filter(([, p]) => p["班级"] === clazz).map(([id]) => rankedAverages.get(id)).sort((a, b) => b - a); population.forEach((p, id) => { const score = rankedAverages.get(id); if (p["班级"] === clazz) zRanks.set(id, 1 + scores.filter(x => x > score).length); }); });
  const weightedScores = new Map(), gpaScores = new Map(); population.forEach((_, id) => { const academic = academics.get(id) || {}; weightedScores.set(id, two(academic.weighted == null ? 0 : academic.weighted)); gpaScores.set(id, two(academic.gpa == null ? 0 : academic.gpa)); });
  const rankByScore = scoresById => { const ranks = new Map(); classSizes.forEach((_, clazz) => { const scores = [...population].filter(([, p]) => p["班级"] === clazz).map(([id]) => scoresById.get(id)).sort((a, b) => b - a); population.forEach((p, id) => { if (p["班级"] === clazz) ranks.set(id, 1 + scores.filter(score => score > scoresById.get(id)).length); }); }); return ranks; };
  const weightedRanks = rankByScore(weightedScores), gpaRanks = rankByScore(gpaScores);
  const records = [...population].map(([id, person]) => { const total = classSizes.get(person["班级"]) || 0, zrank = zRanks.get(id), weightedRank = weightedRanks.get(id), gpaRankValue = gpaRanks.get(id), list = courses.get(id) || [], valid = list.map(x => x.score).filter(x => x != null), lowest = valid.length ? Math.min(...valid) : 0;
    return { ...person, "综测1": two(scoreFrom(zc1, id)), "综测2": two(scoreFrom(zc2, id)), "综测（平均）": two(averages.get(id)), "综测排名": `${zrank}/${total}`, "综测排名百分比": percentageTwo(zrank, total), "学分加权平均分": weightedScores.get(id), "学分加权平均分排名": `${weightedRank}/${total}`, "学分加权平均分排名百分比": percentageTwo(weightedRank, total), "平均学分绩点": gpaScores.get(id), "平均学分绩点排名": `${gpaRankValue}/${total}`, "平均学分绩点排名百分比": percentageTwo(gpaRankValue, total), "最低分": integer(lowest), "最低分科目": uniqueJoin(list.filter(x => x.score === lowest).map(x => x.name)), "补考科目": uniqueJoin(list.filter(x => x.nature === "补考一").map(x => x.name)), "重修科目": uniqueJoin(list.filter(x => ["重修", "重修补考"].includes(x.nature)).map(x => x.name)) }; }).sort((a, b) => a["班级"].localeCompare(b["班级"], "zh-CN") || a["学号"].localeCompare(b["学号"]));
  latestAiCheckDiagnostics = buildRankDiagnostics(records, academics, { academicFile: files.academic?.name || "学业成绩.xlsx", academicSheet: academicSheet.name, academicHeaderRow: ac.row, academicRows, weightedRankColumn: rank, gpaRankColumn: gpaRank });
  return records;
}
function rankFormatProblem(value) {
  const raw = tidy(value);
  if (!raw) return null;
  const match = raw.match(/^(\d+)\/(\d+)$/);
  if (!match) return "排名必须使用“名次/班级人数”格式";
  const rank = Number(match[1]), total = Number(match[2]);
  if (rank < 1) return "名次必须大于等于 1";
  if (total < 1) return "班级人数必须大于等于 1";
  if (rank > total) return `名次 ${rank} 大于班级人数 ${total}`;
  return null;
}
function buildRankDiagnostics(records, academics, meta) {
  const fieldSpecs = [
    { field: "综测排名", issueType: "综测排名格式异常", source: null },
    { field: "学分加权平均分排名", issueType: "学分加权平均分排名格式异常", source: { column: meta.weightedRankColumn, rawKey: "rankRaw" } },
    { field: "平均学分绩点排名", issueType: "GPA排名格式异常", source: { column: meta.gpaRankColumn, rawKey: "gpaRankRaw" } }
  ];
  const diagnostics = [];
  records.forEach((record, recordIndex) => fieldSpecs.forEach(spec => {
    const reason = rankFormatProblem(record[spec.field]);
    if (!reason) return;
    const academic = academics.get(record["学号"]), outputColumnIndex = headers.indexOf(spec.field), sourceColumnIndex = spec.source?.column;
    const hasSource = spec.source && academic && academic.sourceRow && sourceColumnIndex != null;
    diagnostics.push({
      issueType: spec.issueType,
      sourceFile: hasSource ? meta.academicFile : "生成的汇总文件",
      worksheet: hasSource ? meta.academicSheet : "汇总",
      sourceRow: hasSource ? academic.sourceRow : recordIndex + 2,
      sourceColumn: hasSource ? colName(sourceColumnIndex) : colName(outputColumnIndex),
      sourceColumnName: hasSource ? tidy(meta.academicRows[meta.academicHeaderRow]?.[sourceColumnIndex]) || spec.field : spec.field,
      rawValue: hasSource ? academic[spec.source.rawKey] : tidy(record[spec.field]),
      outputRow: recordIndex + 2,
      outputColumn: colName(outputColumnIndex),
      outputColumnName: spec.field,
      outputValue: tidy(record[spec.field]),
      reason,
      studentId: tidy(record["学号"]),
      studentName: tidy(record["姓名"]),
      className: tidy(record["班级"])
    });
  }));
  return diagnostics;
}
function colName(index) { let text = ""; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return text; }
async function makeXlsx(records) {
  const widths = [15,12,20,22,11,11,13,13,15,16,18,20,14,17,19,10,42,32,32], all = [headers, ...records.map(record => headers.map(key => record[key]))], zip = new JSZip();
  const twoDecimalColumns = new Set([4, 5, 6, 9, 12]), percentageColumns = new Set([8, 11, 14]);
  const sheetRows = all.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => { const ref = `${colName(c)}${r + 1}`, style = r === 0 ? 1 : percentageColumns.has(c) && value != null ? 2 : twoDecimalColumns.has(c) && value != null ? 3 : c === 15 && value != null ? 4 : 0; if (value == null || value === "") return `<c r="${ref}" s="${style}"/>`; return typeof value === "number" ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`; }).join("")}</row>`).join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="汇总" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6E5B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:S${all.length}"/></worksheet>`);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
async function makeAiDiagnosticXlsx(diagnostics) {
  const diagnosticHeaders = ["问题类型","来源文件","工作表","来源行号","来源列","来源列名","来源原始值","汇总行号","汇总列","汇总列名","汇总值","问题说明","学号","姓名","班级"], widths = [22,28,18,12,10,24,18,12,10,24,18,34,18,14,22];
  const rows = [diagnosticHeaders, ...diagnostics.map(item => [item.issueType,item.sourceFile,item.worksheet,item.sourceRow,item.sourceColumn,item.sourceColumnName,item.rawValue,item.outputRow,item.outputColumn,item.outputColumnName,item.outputValue,item.reason,item.studentId,item.studentName,item.className])], zip = new JSZip();
  const sheetRows = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => { const ref = `${colName(c)}${r + 1}`, style = r === 0 ? 1 : 0; if (value == null || value === "") return `<c r="${ref}" s="${style}"/>`; return typeof value === "number" ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`; }).join("")}</row>`).join("");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="AI核查错误数据" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB0443B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:O${rows.length}"/></worksheet>`);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
async function downloadAiDiagnosticReport() {
  if (!latestAiCheckDiagnostics.length) { toast("当前没有可下载的排名格式错误", true); return; }
  try {
    const blob = await makeAiDiagnosticXlsx(latestAiCheckDiagnostics), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `AI核查错误数据-${new Date().toISOString().slice(0,10)}.xlsx`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("错误数据表格已下载");
  } catch (error) { toast(`错误数据表格生成失败：${error.message || "未知错误"}`, true); }
}
let cacheDbPromise = null;
function openCacheDb() {
  if (!window.indexedDB) return Promise.reject(new Error("当前浏览器不支持本机文件缓存"));
  if (cacheDbPromise) return cacheDbPromise;
  cacheDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(cacheDatabaseName, cacheDatabaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("inputs")) db.createObjectStore("inputs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("runs")) db.createObjectStore("runs", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本机缓存"));
  });
  return cacheDbPromise;
}
async function cacheRequest(storeName, mode, action) {
  const db = await openCacheDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode), store = transaction.objectStore(storeName);
    let result;
    try { result = action(store); } catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(result?.result);
    transaction.onerror = () => reject(transaction.error || result?.error || new Error("本机缓存操作失败"));
    transaction.onabort = () => reject(transaction.error || new Error("本机缓存操作已取消"));
  });
}
const clearCachedInputs = () => cacheRequest("inputs", "readwrite", store => store.clear());
const saveRun = async item => {
  const payload = Object.assign({}, item); delete payload.outputBlob;
  payload.title = item.output; payload.summary = item.count + " 名学生 · " + item.classes + " 个班级";
  return ToolHistory.save("academicSummary", payload, [{ role: "summary-output", name: item.output, mime: item.outputBlob.type, blob: item.outputBlob }]);
};
const listRuns = async () => { const index = await ToolHistory.list("academicSummary"); return (await Promise.all(index.map(item => ToolHistory.get("academicSummary", item.id)))).filter(Boolean); };
const removeRun = id => ToolHistory.remove("academicSummary", id);
const clearRuns = () => ToolHistory.clear("academicSummary");
function updateFileUi(key) {
  const input = document.querySelector(`input[data-key="${key}"]`), file = files[key], card = input?.closest(".upload-card");
  if (card) { card.classList.toggle("selected", !!file); card.querySelector("em").textContent = file ? file.name : "选择表格文件"; }
  $("#calculate").disabled = !ready();
}
function updateCacheNote() {
  const count = requiredKeys.filter(key => files[key]).length, note = $("#cache-note");
  if (count === requiredKeys.length) note.textContent = "已选择全部 5 份文件；本次页面可替换其中一份后重新生成。刷新或退出后需重新上传。";
  else if (count) note.textContent = `本次页面已选择 ${count}/5 份文件；补齐后即可生成。刷新或退出后需重新上传。`;
  else note.textContent = "原始文件仅在本次页面使用；刷新或退出后需重新上传。";
}
function outputUrl(item) {
  const stored = item.attachments && item.attachments.find(file => file.role === "summary-output");
  if (stored && stored.url) return stored.url;
  if (!item.outputBlob) return "";
  if (!outputUrls.has(item.id)) outputUrls.set(item.id, URL.createObjectURL(item.outputBlob));
  return outputUrls.get(item.id);
}
async function trimRuns() { /* 历史记录不再自动淘汰，只能由用户明确删除。 */ }
async function migrateLegacyRuns() {
  let legacy = [];
  try { legacy = await cacheRequest("runs", "readonly", store => store.getAll()) || []; } catch (_error) { return; }
  if (!legacy.length) return;
  for (const item of legacy) {
    if (!item || !item.id || !item.outputBlob) continue;
    try { await saveRun(item); await cacheRequest("runs", "readwrite", store => store.delete(item.id)); }
    catch (_error) { /* 保留旧缓存，避免迁移失败造成历史丢失。 */ }
  }
}
async function renderHistory() {
  const target = $("#history");
  let items;
  try { items = (await listRuns()).sort((a, b) => new Date(b.at) - new Date(a.at)); }
  catch { target.innerHTML = "<p style=\"color:#7c8986;padding:8px\">本机历史记录暂不可用</p>"; return; }
  if (!items.length) { target.innerHTML = "<p style=\"color:#7c8986;padding:8px\">暂无历史记录</p>"; return; }
  target.innerHTML = items.map(item => { const url = outputUrl(item); return `<div class="history-row"><div><time>${new Date(item.at).toLocaleString("zh-CN", { hour12:false })}</time><small>${item.count} 名学生 · ${item.classes} 个班级</small></div>${["zongce1","zongce2","academic","course"].map(key => `<div title="${esc(item.inputs[key] || "")}">${esc(item.inputs[key] || "")}</div>`).join("")}<div>${url ? `<a href="${url}" download="${esc(item.output)}">下载汇总</a>` : "文件不可用"}</div><div><button class="delete-record" data-id="${esc(item.id)}">删除</button></div></div>`; }).join("");
}
function present(item) { const url = outputUrl(item), link = $("#download-current"); link.href = url; link.download = item.output; link.hidden = !url; $("#download-placeholder").hidden = !!url; $("#result-note").textContent = `已生成 ${item.count} 名学生、${item.classes} 个班级的汇总文件。`; }
function aiCheckSummary(records, diagnostics = []) {
  const count = predicate => records.filter(predicate).length;
  const invalidRank = field => count(row => {
    const raw = tidy(row[field]); if (!raw) return false;
    const match = raw.match(/^(\d+)\/(\d+)$/); return !match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[1]) > Number(match[2]);
  });
  return {
    reportVersion: 2,
    generatedStudents: records.length,
    classCount: new Set(records.map(row => tidy(row["班级"])).filter(Boolean)).size,
    rules: { matchBy: "学号", classPopulation: "仅统计《汇总》给定名单，来源表多出的学生弹窗提醒后忽略", missingData: "《汇总》名单内学生缺少的综测、学业或课程成绩按 0 分处理", compositeAssessment: "综测平均分除以实际有成绩的学期数：两学期除以2，单学期除以1，均缺失为0", tieRank: "同分同名次、后续跳位", academicRank: "学分加权平均分和平均学分绩点均按实际分数由高到低排名，不使用来源给定名次" },
    checks: {
      onlyOneCompositeSemester: count(row => (row["综测1"] != null) !== (row["综测2"] != null)),
      missingCompositeAverage: count(row => row["综测（平均）"] == null),
      missingWeightedAverage: count(row => row["学分加权平均分"] == null),
      missingGpa: count(row => row["平均学分绩点"] == null),
      missingLowestCourseScore: count(row => row["最低分"] == null),
      compositeRankFormatIssues: invalidRank("综测排名"),
      weightedRankFormatIssues: invalidRank("学分加权平均分排名"),
      gpaRankFormatIssues: invalidRank("平均学分绩点排名")
    },
    rankIssueLocations: diagnostics.map(item => ({ issueType: item.issueType, sourceTable: item.sourceFile === "生成的汇总文件" ? "汇总结果" : "学业成绩", row: item.sourceRow, column: item.sourceColumn, columnName: item.sourceColumnName, rawValue: item.rawValue, outputRow: item.outputRow, outputColumn: item.outputColumn, outputColumnName: item.outputColumnName, outputValue: item.outputValue, reason: item.reason })),
    privacy: "仅匿名聚合数量和不含身份信息的单元格位置；不含学号、姓名、班级、学院、课程名称、原始成绩或任何单个学生记录。"
  };
}
window.addEventListener("message", event => {
  if (event.origin !== location.origin || !event.data) return;
  if (event.data.type === "academic-summary-request-ai-check") event.source?.postMessage({ type: "academic-summary-ai-check-data", summary: latestAiCheckSummary, diagnostics: latestAiCheckDiagnostics.map(item => ({ issueType: item.issueType, sourceFile: item.sourceFile, worksheet: item.worksheet, sourceRow: item.sourceRow, sourceColumn: item.sourceColumn, sourceColumnName: item.sourceColumnName, rawValue: item.rawValue, outputRow: item.outputRow, outputColumn: item.outputColumn, outputColumnName: item.outputColumnName, outputValue: item.outputValue, reason: item.reason })) }, event.origin);
  if (event.data.type === "academic-summary-download-ai-errors") downloadAiDiagnosticReport();
});
function clearCurrentInputs() {
  requiredKeys.forEach(key => { delete files[key]; const input = document.querySelector(`input[data-key="${key}"]`); if (input) input.value = ""; updateFileUi(key); });
  updateCacheNote();
}
window.addEventListener("pagehide", clearCurrentInputs);
document.querySelectorAll("input[type=file]").forEach(input => {
  input.value = "";
  input.addEventListener("change", () => {
  const key = input.dataset.key, file = input.files[0];
  if (file) { files[key] = file; updateFileUi(key); updateCacheNote(); toast(`已选择${sourceLabels[key] || "《汇总》名单"}，刷新或退出后需重新上传`); }
  else { delete files[key]; updateFileUi(key); updateCacheNote(); }
  });
});
$("#calculate").addEventListener("click", async () => {
  const button = $("#calculate"); button.disabled = true; button.textContent = "正在计算…";
  try {
    const records = await calculate(), item = { id: crypto.randomUUID(), at: new Date().toISOString(), count: records.length, classes: new Set(records.map(x => x["班级"])).size, output: `汇总-${new Date().toISOString().slice(0,10)}.xlsx`, inputs: Object.fromEntries(requiredKeys.map(key => [key, files[key].name])), outputBlob: await makeXlsx(records) };
    latestAiCheckSummary = aiCheckSummary(records, latestAiCheckDiagnostics);
    present(item);
    try { await saveRun(item); await renderHistory(); toast("汇总文件已生成并保存到系统数据库"); }
    catch { toast("汇总文件已生成；本机历史保存失败，请立即下载", true); }
  } catch (error) { toast(error.message || "生成失败", true); }
  finally { button.innerHTML = "生成汇总文件 <span>→</span>"; button.disabled = !ready(); }
});
$("#clear-history").addEventListener("click", async () => {
  if (!confirm("清空系统数据库中保存的汇总文件和历史记录？本次已选择的原始 Excel 文件不会受影响。")) return;
  try { await clearRuns(); outputUrls.forEach(url => URL.revokeObjectURL(url)); outputUrls.clear(); await renderHistory(); toast("历史记录已清空"); }
  catch { toast("清空历史记录失败", true); }
});
$("#clear-input-cache").addEventListener("click", async () => {
  if (!confirm("清除本次页面已选择的原始表格文件？历史汇总文件不会删除。")) return;
  clearCurrentInputs();
  try { await clearCachedInputs(); } catch { /* 旧版缓存不可用时，本次文件仍已清除。 */ }
  toast("已清除本次上传的原始文件");
});
$("#history").addEventListener("click", async event => {
  const button = event.target.closest(".delete-record"); if (!button || !confirm("删除这一条本机历史记录及其汇总文件？")) return;
  button.disabled = true;
  try { await removeRun(button.dataset.id); const url = outputUrls.get(button.dataset.id); if (url) URL.revokeObjectURL(url); outputUrls.delete(button.dataset.id); await renderHistory(); toast("历史记录已删除"); }
  catch { button.disabled = false; toast("删除历史记录失败", true); }
});
$("#health").textContent = "系统数据库持久化"; $("#health").classList.add("ok"); updateCacheNote();
clearCachedInputs().catch(() => { /* 旧版缓存清理失败也不得重新载入上传文件。 */ });
migrateLegacyRuns().finally(renderHistory);
