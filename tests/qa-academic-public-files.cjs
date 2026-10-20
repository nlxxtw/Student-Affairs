'use strict';
const assert=require('node:assert/strict'),Files=require('../academic-public-files'),XLSX=require('../assets/xlsx.full.min.js');
(async()=>{
 const wb=XLSX.utils.book_new(),sh={'!ref':'A1:C3',A1:{t:'s',v:'学号'},B1:{t:'s',v:'成绩'},C1:{t:'s',v:'公式'},A2:{t:'n',v:1,z:'00000'},B2:{t:'n',v:0},C2:{t:'n',f:'1+1'},A3:{t:'s',v:'=SUM(A1)'},B3:{t:'n',v:100},C3:{t:'n',v:1234567890123456}};XLSX.utils.book_append_sheet(wb,sh,'数据');
 const parsed=await Files.parseFile(Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'})),'测试.xlsx');
 assert.equal(parsed.sheets[0].rows[1].cells[0].value,'00001');assert.equal(parsed.sheets[0].rows[1].cells[1].value,'0');assert.equal(parsed.sheets[0].rows[1].cells[2].missingFormula,true);assert.equal(parsed.sheets[0].rows[2].cells[2].precisionLost,true);
 const csv=await Files.parseFile(Buffer.from('学号,成绩\n001,0\n'),'测试.csv');assert.equal(csv.sheets[0].rows[1].cells[0].value,'001');
 await assert.rejects(Files.parseFile(Buffer.from('not a workbook'),'假的.xlsx'));
 await assert.rejects(Files.parseFile(Buffer.from('abc'),'旧.xls'));
 const exported=XLSX.read(Files.workbook({'数据':[['学号'],['=HYPERLINK("http://example.com")']]}),{type:'buffer'});assert.equal(exported.Sheets['数据'].A2.t,'s');assert.equal(exported.Sheets['数据'].A2.f,undefined);
 const rows=[['学号','成绩'],...Array.from({length:20000},(_,i)=>[String(i).padStart(6,'0'),i%101])],start=Date.now();const large=await Files.parseFile(Files.workbook({'数据':rows}),'大文件.xlsx');assert.equal(large.sheets[0].rows.length,20001);
 console.log('academic-public files: passed (text identifiers, zero, formulas, precision, CSV, invalid files, safe exports, 20,000 rows in '+(Date.now()-start)+' ms)');
})().catch(e=>{console.error(e);process.exitCode=1;});
