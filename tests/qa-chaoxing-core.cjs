"use strict";
const assert = require("assert");
const api = require("../chaoxing-attendance-module.js");
const XLSX=require('../assets/xlsx.full.min.js');
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['姓名','学号','签到(2026/10/07)'],['测试','001','已签']]),'统计');
const archive=Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
assert.doesNotThrow(()=>api.checkWorkbookBytes(archive,'xlsx'));
const bomb=Buffer.from(archive);const central=bomb.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bomb.writeUInt32LE(200*1024*1024,central+24);
assert.throws(()=>api.checkWorkbookBytes(bomb,'xlsx'),/解压/,'oversized ZIP content must be rejected before decompression');
assert.throws(()=>api.checkWorkbookBytes(Buffer.from('fake Excel'),'xlsx'),/Excel/);
const numbered=XLSX.utils.aoa_to_sheet([['姓名','学号','签到(2026/10/07)'],['测试',1,'已签']]);numbered.B2.z='000';XLSX.utils.book_append_sheet(book,numbered,'数值学号');
const numberedBook=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'}),numberedSheet=numberedBook.Sheets['数值学号'];
const numberedReport=api.parseSheet(XLSX.utils.sheet_to_json(numberedSheet,{header:1,raw:true,defval:''}),'模拟.xlsx','数值学号',(row,col)=>numberedSheet[XLSX.utils.encode_cell({r:row,c:col})]);
assert.equal(numberedReport.students[0].id,'001','numeric cells with a leading-zero display format must retain the displayed student identifier');
const rows = [["签到详情统计"], ["课程：测试课程    班级：测试教学班    任课教师：测试教师"],
  ["姓名", "学号/工号", "行政班级", "10月7日下课(2026/10/07)", "10月7日上课(2026/10/07)", "10月8日班会(2026/10/08)", "合计"],
  ["", "", "", "状态", "状态", "状态", "次数"],
  ["测试甲", "001", "", "未参与", "已签", "公假", 3], [],
  ["测试乙", "002", "", "已签", "未参与", "已签", 3],
  ["测试丙", "003", "", "未参与", "未参与", "教师代签", 3]];
const report = api.parseSheet(rows, "模拟.xlsx", "签到详情统计");
assert.equal(report.students.length, 3); assert.equal(report.activities.length, 3);
assert.equal(report.activities[0].phase, "end"); assert.equal(report.activities[1].phase, "start");
assert.equal(report.activities[2].course, "班会");
assert.equal(report.students[0].id, "001");
assert.equal(api.readDate("【周三】测试20261007(2026/10/07)", "2026-2027-1学期").date, "2026-10-07");
assert.equal(api.readDate("5月22日上课", "2025-2026-2学期").date, "2026-05-22");
assert.equal(api.readDate("1月7日上课", "2026-2027-1学期").date, "2027-01-07");
assert.equal(api.readDate("2026年2月30日", "2026-2027-1学期").date, "");
assert.ok(api.readDate("4月25日下课(2026/04/24)", "2025-2026-2学期").warnings.length);
for(const title of ['10.07上课','10/7签到','10-07下课','１０月７日上课','2026 年 10 月 7 日上课'])assert.equal(api.readDate(title,'2026-2027-1学期').date,'2026-10-07',title);
assert.equal(api.readDate('签到2026/10/07至2026/10/08','2026-2027-1学期').date,'','conflicting complete dates must block instead of silently choosing the last');
assert.equal(api.readDate('签到(2026/10/07)(2026/10/08)','2026-2027-1学期').date,'');
assert.equal(api.readDate('第1-2节上课','2026-2027-1学期').date,'','lesson periods are not month/day');
assert.equal(api.readDate('10.32签到','2026-2027-1学期').date,'');
assert.equal(api.readDate('2028年2月29日08:20签到','2027-2028-2学期').date,'2028-02-29');
assert.equal(api.readDate('2027年2月29日签到','2026-2027-2学期').date,'');
assert.equal(api.readDate('签到10/7到10/8','2026-2027-1学期').date,'');
assert.equal(api.courseFromTitle('10/7上课'),'');
assert.equal(api.courseFromTitle('2026-10-07T08:20:00上课'),'');
const plainDateReport=api.parseSheet([['课程：日期课程'],['姓名','学号','10.07','10/08'],['测试','001','已签','未参与']],'日期.xlsx','日期');assert.equal(plainDateReport.activities.length,2);assert.ok(plainDateReport.activities.every(a=>a.course==='日期课程'));
assert.deepEqual(api.outcome("已签", "未参与"), ["早退"]);
assert.deepEqual(api.outcome("未参与", "已签"), ["迟到"]);
assert.deepEqual(api.outcome("未参与", "未参与"), ["旷课"]);
assert.deepEqual(api.outcome("已签", "教师代签"), ["出勤"]);
assert.deepEqual(api.outcome("迟到", "未参与"), ["迟到", "早退"]);
assert.deepEqual(api.outcome("公假", "公假"), ["公假"]);
assert.equal(api.outcome("事假", "已签"), null);
assert.equal(api.outcome(""), null);
for(const value of ['constructor','__proto__','toString','hasOwnProperty'])assert.equal(api.outcome(value),null,'inherited object property must not be treated as attendance');
assert.equal(api.courseFromTitle("【周二周四】新能源电源变换技术20261006(2026/10/06)"), "新能源电源变换技术");
assert.deepEqual(api.outcome("未参与"), ["旷课"]);
const more = api.parseSheet([[], ...rows.slice(0, 2), ["姓名", "行政班级", "学号", "状态(2026/10/09)"], ["测试甲", "", "001", "已签"]], "大表.xlsx", "Sheet1");
assert.equal(more.students[0].id, "001"); assert.equal(more.activities.length, 1);
const grouped=api.summarizeDetails([{sid:'001',cls:'甲班',result:['迟到','早退']},{sid:'002',cls:'甲班',result:['公假']},{sid:'003',cls:'乙班',result:['旷课']},{sid:'004',cls:'乙班',result:['已签'].map(v=>api.outcome(v)[0])}]);
assert.equal(grouped.total,4);assert.equal(grouped.attended,2);assert.equal(grouped.leave,1);assert.equal(grouped.absent,1);assert.equal(grouped.late,1);assert.equal(grouped.early,1);assert.equal(grouped.rate,'50.0%');
assert.equal(grouped.classes.find(c=>c.cls==='甲班').total,2);assert.equal(grouped.classes.find(c=>c.cls==='乙班').absent,1);
const statuses=['已签','未参与','事假','病假','公假','迟到','早退'];
for(const a of statuses)for(const b of statuses)for(const c of statuses){const result=api.summarizeDetails([a,b,c].map((v,i)=>({sid:String(i),cls:i%2?'甲班':'乙班',result:api.outcome(v)})));assert.equal(result.total,result.attended+result.absent+result.leave);assert.equal(result.leave,result.personalLeave+result.sickLeave+result.publicLeave);assert.equal(result.total,result.classes.reduce((n,c)=>n+c.total,0));}
console.log("qa-chaoxing-core: passed (dynamic matrices, identifiers, dates, reversed phases, pairs, public leave and conflicts)");
