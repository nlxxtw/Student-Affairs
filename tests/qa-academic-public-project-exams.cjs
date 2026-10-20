'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const X=require('../academic-public-exams'),Import=require('../academic-public-import');
test('optional non-computer labels do not split project statistics',()=>{
 const rows=[{sid:'01',type:'英语四级',batch:'春',pass:true},{sid:'02',type:'英语四级',batch:'春',grade:'四级',subject:'英语',pass:false}];const groups=X.statistics(rows);assert.equal(groups.length,1);assert.equal(groups[0].students,2);assert.equal(groups[0].passRate,0.5);
});
test('legacy duplicate identities and invalid saved scores cannot be declared passed',()=>{
 const rules={cetScore:425,degreeScore:60};assert.equal(X.view({type:'未知考试',score:450},rules).pass,null);assert.equal(X.view({type:'英语四级',score:800},rules).pass,null);assert.equal(X.view({type:'英语四级',score:450,official:'未知官方状态'},rules).pass,null);
 const records=X.views([{id:'a',sid:'01',type:'英语四级',batch:'春',score:450},{id:'b',sid:'01',type:'英语四级',batch:'春',score:400,grade:'四级',subject:'英语'}],rules);assert.ok(records.every(x=>x.pass===null&&x.identityConflict));assert.equal(X.statistics(records)[0].passed,0);assert.equal(X.statistics(records)[0].pending,2);
});
test('missing-certificate placeholders are never counted as supplied material',()=>{
 const rules={cetScore:425,degreeScore:60},rows=['无','暂无','--','—','/'].map((certificate,i)=>X.view({sid:String(i),type:'英语四级',batch:'春',score:450,certificate},rules));assert.ok(rows.every(x=>x.documentStatus==='未提供'));assert.equal(X.statistics(rows)[0].documents,0);
});
test('national/provincial/degree identities and official results remain distinct',()=>{
 const raw={'考试类型':'省级计算机等级','考试批次':'2026春','等级':'二级','科目':'Python','官方结果':'合格','考试省份':'浙江','准考证号':'000123'};
 const value=X.normalize(k=>String(raw[k]??''));assert.equal(value.admission,'000123');
 assert.notEqual(X.identity({sid:'01',...value}),X.identity({sid:'01',...value,province:'江苏'}));
 assert.throws(()=>X.normalize(k=>String({...raw,'考试省份':''}[k]??'')),/省份/);
 assert.equal(X.view({...value,score:99,official:''},{cetScore:425,degreeScore:60}).pass,null);
 assert.equal(X.view({...value,certificate:''}).documentStatus,'未提供');
 assert.equal(X.view({...value,certificate:'NO1'}).documentStatus,'已提供，未核验');
 const degree={type:'学位英语',score:90,official:'不合格'};
 assert.equal(X.view(degree,{degreeScore:60}).pass,null);
 assert.equal(X.view({type:'英语四级',score:425},{cetScore:425}).pass,true);
 assert.equal(X.view({type:'英语四级',score:710,official:'缺考'},{cetScore:425}).pass,null);
 assert.equal(X.identity({sid:'01',type:'英语四级',batch:'2026春'}),X.identity({sid:'01',type:'英语四级',batch:'2026春',grade:'四级',subject:'英语'}));
});
test('exam statistics count people and events separately, absent and pending not failures',()=>{
 const rows=[{sid:'01',type:'英语四级',batch:'1',pass:true,certificate:'A'},{sid:'01',type:'英语四级',batch:'1',pass:true},{sid:'02',type:'英语四级',batch:'1',pass:false},{sid:'03',type:'英语四级',batch:'1',pass:null,official:'待出分'},{sid:'04',type:'英语四级',batch:'1',pass:null,official:'缺考'}];
 const s=X.statistics(rows)[0];assert.equal(s.students,4);assert.equal(s.records,5);assert.equal(s.passRate,2/3);assert.equal(s.absent,1);assert.equal(s.pending,1);assert.equal(s.documents,1);
 assert.equal(X.statistics([{sid:'01',type:'计算机等级',pass:null}])[0].passRate,null);
});
test('warning reports distinguish projects without creating warnings from exams or GPA',()=>{
 const Report=require('../academic-public-report'),E=require('../academic-public-engine');
 const rules={thresholds:[1,2,3,4],enabled:[true,true,true,true],stage:'current',scope:'term',categories:[],rank:'original',passScore:60,cetScore:425,degreeScore:60};
 const state={version:1,rules,courses:[{id:'A',sid:'01',term:'2026-2027-1',code:'A',name:'合成课程',credit:2,category:'必修'}],attempts:[{id:'a',courseId:'A',type:'original',score:'70',scale:'百分制',status:'已出分',gpa:0}],exams:[]};
 const sum=E.summarize(state,[{id:'01',name:'合成学生'}],'2026-2027-1');assert.equal(sum.rows[0].level,'');
 const sheets=Report.build({rows:sum.rows,population:sum.rows,details:sum.details,selection:sum.selection,cases:[],references:[],examResults:[{sid:'01',type:'省级计算机等级',pass:false}]});
 const table=sheets['学生预警明细'],at=field=>table[1][table[0].indexOf(field)];assert.equal(at('全国计算机等级达标情况'),'未导入');assert.equal(at('省级计算机等级达标情况'),'未达标');assert.equal(at('预警级别'),'');
});
test('Zhengfang score components keep zero and reject invalid values without calculating total',()=>{
 assert.deepEqual(Import.components({'平时成绩':'0','期末成绩':'90'}),{regularScore:0,finalScore:90});
 assert.throws(()=>Import.components({'平时成绩':'101'}),/平时成绩/);
 assert.throws(()=>Import.components({'实验成绩':'不及格'}),/实验成绩/);
 const fields=['课程代码','课程类别','总评成绩','平时成绩','期末成绩','准考证号'];
 const guess=Import.suggest({rows:[{cells:['课程编号','课程归属','总成绩','平时','期末','考号'].map(value=>({value}))}]},fields);
 assert.deepEqual(guess.mapping,{'课程代码':0,'课程类别':1,'总评成绩':2,'平时成绩':3,'期末成绩':4,'准考证号':5});
});
