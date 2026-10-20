"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const XLSX = require(path.resolve(__dirname, "..", "assets", "xlsx.full.min.js"));

const sourceDir = process.argv[2] || "C:\\Users\\46230\\Desktop\\综测与成绩";
const targets = [
  path.resolve(__dirname, "..", "assets", "academic-summary-reference"),
  "C:\\Users\\46230\\Desktop\\工具\\综测汇总助手\\5个表格模版"
];
const files = [
  { source: "综测1.xlsx", asset: "zongce-1.xlsx" },
  { source: "综测2.xlsx", asset: "zongce-2.xlsx" },
  { source: "学业成绩.xlsx", asset: "academic.xlsx" },
  { source: "课程成绩.xlsx", asset: "course.xlsx" },
  { source: "汇总.xlsx", asset: "summary.xlsx" }
];

const exampleByHeader = {
  学号: "20240001",
  姓名: "示例学生",
  学院: "示例学院",
  年级: "2024级",
  专业: "示例专业",
  班级: "示例班级",
  综测总分: 85,
  学分加权平均分: 82.5,
  学分加权平均分排名: "3/50",
  平均学分绩点: 3.2,
  平均学分绩点排名: "4/50",
  课程名称: "高等数学",
  成绩: 85,
  考试性质: "正常考试",
  备注: "示例备注",
  综测1: 84,
  综测2: 86,
  "综测（平均）": 85,
  综测排名: "3/50",
  综测排名百分比: 6,
  学分加权平均分排名百分比: 6,
  平均学分绩点排名百分比: 8,
  最低分: 62,
  最低分科目: "高等数学",
  补考科目: "无",
  重修科目: "无"
};

function exampleRow(header) {
  return header.map((name) => Object.hasOwn(exampleByHeader, name) ? exampleByHeader[name] : `示例${name}`);
}

function firstHeader(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false, blankrows: true });
    const header = rows.find((row) => row.some((value) => String(value).trim()));
    if (header) return { sheetName, header: header.map((value) => String(value).trim()) };
  }
  throw new Error("工作簿中没有可识别的表头。");
}

function templateBuffer(sourcePath, displayName) {
  const original = XLSX.read(fs.readFileSync(sourcePath), { type: "buffer" });
  const { sheetName, header } = firstHeader(original);
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([header, exampleRow(header)]);
  worksheet["!cols"] = header.map((value) => ({ wch: Math.max(10, Math.min(28, String(value).length * 2 + 2)) }));
  worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  workbook.Props = { Title: `${displayName}字段参考模板`, Subject: "仅保留表头和第2行虚构示例", Author: "数智学工" };
  return { buffer: Buffer.from(XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true })), sheetName, header };
}

function verify(filePath, expectedSheet, expectedHeader) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer" });
  assert.deepStrictEqual(workbook.SheetNames, [expectedSheet], `${filePath} 工作表名称变化`);
  const worksheet = workbook.Sheets[expectedSheet];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: false, blankrows: true });
  assert.strictEqual(rows.length, 2, `${filePath} 必须只包含表头和第2行示例`);
  assert.deepStrictEqual(rows[0].map((value) => String(value).trim()), expectedHeader, `${filePath} 表头不一致`);
  assert(rows[1].some((value) => String(value).trim()), `${filePath} 第2行示例不能为空`);
}

for (const target of targets) fs.mkdirSync(target, { recursive: true });
for (const item of files) {
  const sourcePath = path.join(sourceDir, item.source);
  if (!fs.existsSync(sourcePath)) throw new Error(`缺少源文件：${sourcePath}`);
  const built = templateBuffer(sourcePath, item.source.replace(/\.xlsx$/i, ""));
  const outputs = [path.join(targets[0], item.asset), path.join(targets[1], item.source)];
  for (const output of outputs) {
    fs.writeFileSync(output, built.buffer);
    verify(output, built.sheetName, built.header);
  }
  console.log(`${item.source}: ${built.header.length} 个字段，仅保留表头和第2行示例`);
}
