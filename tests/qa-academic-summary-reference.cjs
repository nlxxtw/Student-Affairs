"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const XLSX = require(path.resolve(__dirname, "..", "assets", "xlsx.full.min.js"));

const root = path.resolve(__dirname, "..");
const expected = [
  ["zongce-1.xlsx", ["学号", "姓名", "综测总分"]],
  ["zongce-2.xlsx", ["学号", "姓名", "综测总分"]],
  ["academic.xlsx", ["学号", "姓名", "学分加权平均分", "学分加权平均分排名", "平均学分绩点", "平均学分绩点排名", "学院", "年级", "专业", "班级"]],
  ["course.xlsx", ["学号", "姓名", "课程名称", "成绩", "考试性质", "备注"]],
  ["summary.xlsx", ["学号", "姓名", "学院", "班级", "综测1", "综测2", "综测（平均）", "综测排名", "综测排名百分比", "学分加权平均分", "学分加权平均分排名", "学分加权平均分排名百分比", "平均学分绩点", "平均学分绩点排名", "平均学分绩点排名百分比", "最低分", "最低分科目", "补考科目", "重修科目"]]
];

for (const [fileName, headers] of expected) {
  const file = path.join(root, "assets", "academic-summary-reference", fileName);
  assert(fs.existsSync(file), `字段参考模板不存在：${fileName}`);
  const workbook = XLSX.read(fs.readFileSync(file), { type: "buffer" });
  assert.strictEqual(workbook.SheetNames.length, 1, `${fileName} 只能包含一个数据工作表`);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: false, blankrows: true });
  assert.strictEqual(rows.length, 2, `${fileName} 必须只包含表头和第2行示例`);
  assert.deepStrictEqual(rows[0].map((value) => String(value).trim()), headers, `${fileName} 表头与提供文件不一致`);
  assert(rows[1].some((value) => String(value).trim()), `${fileName} 第2行示例不能为空`);
  assert(!rows.flat().some((value) => /^(?:※|填写说明|格式说明)/.test(String(value).trim())), `${fileName} 不得包含提示文字`);
}

const html = fs.readFileSync(path.join(root, "assets", "academic-summary-tool.html"), "utf8");
assert(html.includes('id="field-reference-title"') && html.includes("模板只保留表头和第2行虚构示例"), "五个上传框下方应显示字段参考模块和示例说明");
for (const [fileName] of expected) assert(html.includes(`/assets/academic-summary-reference/${fileName}`), `${fileName} 下载入口缺失`);

const server = fs.readFileSync(path.join(root, "web-server.js"), "utf8");
for (const [fileName] of expected) assert(server.includes(`/assets/academic-summary-reference/${fileName}`), `${fileName} 服务端下载路由缺失`);

console.log("综测与成绩字段参考回归通过：5 个模板均为表头加第2行示例，页面与下载路由完整。\n");
