"use strict";

// Production workbook reader, bounded synthetic input, no server or real data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const start = source.indexOf("const IMPORT_FILE_MAX_BYTES="), end = source.indexOf("function workbookHeaderNames", start);
assert(start >= 0 && end > start);
const ctx = { TextDecoder, TextEncoder, Blob, File, DecompressionStream, console };
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);
let failures = 0;
async function scenario(name, run) {
  try { await run(); console.log("PASS " + name); }
  catch (error) { failures++; console.error("FAIL " + name + ": " + error.message); }
}
(async () => {
  await scenario("CSV quoted newline preserves a single student's text and row number", async () => {
    const [sheet] = await ctx.smartReadWorkbook(new File(['\uFEFF学号,姓名,备注\r\n001,合成学生,"第一行\r\n第二行,含逗号\r\n含""引号"""\r\n002,另一学生,普通备注\r\n'], "multiline.csv"));
    assert.equal(sheet.rows.length, 3);
    assert.equal(sheet.rows[1][0], "001");
    assert.equal(sheet.rows[1][2], '第一行\r\n第二行,含逗号\r\n含"引号"');
    assert.equal(sheet.rows[2][0], "002");
    assert.equal(sheet.rows[2].__importRowNumber, 5);
  });
  await scenario("unclosed CSV quote rejects rather than importing partial data", async () => {
    await assert.rejects(ctx.smartReadWorkbook(new File(['学号,备注\n001,"没有闭合'], "broken.csv")), /引号|CSV/);
  });
  await scenario("OLE sector cycle is rejected before allocating stream data", () => {
    assert.throws(() => ctx.xlsGetChain(0, [1, 0]), /循环|损坏|扇区/);
  });
  await scenario("OLE invalid sector reference rejects instead of silently truncating", () => {
    assert.throws(() => ctx.xlsGetChain(0, [99999999]), /无效|损坏|扇区/);
  });
  await scenario("legacy XLS RK integers, negative values and floating point retain exact values", () => {
    assert.equal(ctx.xlsRkToNum((80 << 2) | 2), 80);
    assert.equal(ctx.xlsRkToNum((-12 << 2) | 2), -12);
    assert.equal(ctx.xlsRkToNum((8825 << 2) | 3), 88.25);
    const bytes = Buffer.alloc(8); bytes.writeDoubleLE(1.125);
    assert.equal(ctx.xlsRkToNum(bytes.readUInt32LE(4) & 0xfffffffc), 1.125);
  });
  await scenario("actual legacy XLS preserves text identifiers and numeric cells", async () => {
    const XLSX = require("../assets/xlsx.full.min.js"), book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["学号", "姓名", "成绩"], ["0001", "合成学生", 1.125], ["0002", "另一学生", -12]]), "成绩");
    const bytes=XLSX.write(book,{type:"buffer",bookType:"biff8"});
    const [sheet]=await ctx.smartReadWorkbook(new File([bytes],"legacy.xls"));
    assert.equal(sheet.rows[1][0],"0001");assert.equal(sheet.rows[1][1],"合成学生");
    assert.equal(sheet.rows[1][2],"1.125");assert.equal(sheet.rows[2][2],"-12");
  });
  await scenario("duplicate OLE allocation sectors reject before building an inflated allocation table", () => {
    const bytes=Buffer.alloc(1536);Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]).copy(bytes);
    bytes.writeUInt16LE(9,30);bytes.writeUInt16LE(6,32);bytes.writeUInt32LE(1,48);bytes.writeUInt32LE(4096,56);bytes.writeUInt32LE(0xffffffff,60);bytes.writeUInt32LE(0xffffffff,68);
    for(let i=0;i<109;i++)bytes.writeUInt32LE(0xffffffff,76+i*4);
    bytes.writeUInt32LE(0,76);bytes.writeUInt32LE(0,80);
    for(let i=0;i<128;i++)bytes.writeUInt32LE(0xfffffffe,512+i*4);
    assert.throws(()=>ctx.smartReadXls(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)),/重复|扇区/);
  });
  await scenario("unsafe headers and input file limit remain enforced", async () => {
    assert.throws(() => ctx.assertSafeImportHeaders(["__proto__", "constructor"]), /不安全/);
    assert.equal(Object.prototype.polluted, undefined);
    await assert.rejects(ctx.smartReadWorkbook(new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.csv")), /超过|过大/);
  });
  await scenario("CSV delimiter, leading zeroes, formula and HTML are read as text", async () => {
    const [sheet] = await ctx.smartReadWorkbook(new File(['学号\t内容\n0001\t=1+1\n0002\t<img src=x onerror=alert(1)>'], "plain.csv"));
    assert.equal(sheet.rows[1][0], "0001");
    assert.equal(sheet.rows[1][1], "=1+1");
    assert.equal(sheet.rows[2][1], "<img src=x onerror=alert(1)>");
  });
  process.exitCode = failures ? 1 : 0;
})();
