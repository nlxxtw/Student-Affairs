'use strict';
const E=require('./academic-public-engine');
const aliases={学号:['学生学号'],姓名:['学生姓名'],原修读学期:['修读学期','学年学期'],课程代码:['课程编号','课程号'],课程名称:['课程名'],总评成绩:['成绩','总成绩','总评'],成绩制:['成绩类型','记分制'],考试状态:['成绩状态'],考试批次:['考试名称','考试场次'],绩点:['学分绩点'],学年:['学年度'],学期:['学期代码'],课程类别:['课程归属'],平时成绩:['平时'],期中成绩:['期中'],期末成绩:['期末'],实验成绩:['实验','实训成绩'],教学班号:['教学班编号'],授课教师:['任课教师'],开课单位:['开课学院'],准考证号:['考号','准考证号码'],考试省份:['省份'],听力成绩:['听力'],阅读成绩:['阅读'],写作翻译成绩:['写作和翻译','写作与翻译'],证书编号:['证书号','成绩报告单编号']};
const headerText=value=>E.clean(value).replace(/\s+/g,'');
function suggest(sheet,fields,headerRow){
 const samples=sheet.sample||sheet.rows||[],candidates=headerRow?samples.filter((r,i)=>(r.sourceRow||i+1)===headerRow):samples.slice(0,50);
 const guesses=candidates.map((row,i)=>{
  const headers=row.cells.map(c=>headerText(c.value)),mapping={},ambiguous=[];
  for(const field of fields){let names=[field,...(aliases[field]||[])];const legacyStatus=['考试状态','成绩状态','状态'].filter(h=>headers.includes(h));if(field==='成绩备注'&&fields.includes('官方结果'))names=['成绩备注'];if(fields.includes('补充说明')&&legacyStatus.length){if(field==='成绩备注')names=legacyStatus;if(field==='补充说明')names=['补充说明','成绩备注'];}if(field==='原修读学期'&&!fields.includes('学期')&&!headers.includes('学年')&&!headers.includes('学年度'))names.push('学期');const columns=headers.flatMap((h,index)=>names.includes(h)?[index]:[]);if(columns.length===1)mapping[field]=columns[0];else if(columns.length>1)ambiguous.push(field);}
  // Never silently map the same column twice (e.g. a combined term column).
  const used=new Map();for(const [field,column] of Object.entries(mapping)){if(!used.has(column))used.set(column,[]);used.get(column).push(field);}for(const names of used.values())if(names.length>1){for(const field of names){delete mapping[field];ambiguous.push(field);}}
  return {headerRow:row.sourceRow||samples.indexOf(row)+1,mapping,ambiguous,score:Object.keys(mapping).length};
 });
 return guesses.sort((a,b)=>b.score-a.score||a.headerRow-b.headerRow)[0]||{headerRow:1,mapping:{},ambiguous:[],score:0};
}
function term(raw){
 const direct=E.clean(raw['原修读学期']).replace(/学期$/,''),year=E.clean(raw['学年']),semester=E.clean(raw['学期']).replace(/学期$/,'');
 if(direct){if(year&&year!==direct.slice(0,9))E.fail('原修读学期与学年不一致');if(semester&&(E.validTerm(semester)?semester!==direct:!['1','2'].includes(semester)||!direct.endsWith('-'+semester)))E.fail('原修读学期与学期不一致');return direct;}
 if(E.validTerm(semester))return semester;
 if(year||semester){if(!/^\d{4}-\d{4}$/.test(year)||!['1','2'].includes(semester))E.fail('请填写完整原修读学期，或同时映射学年（2025-2026）与学期（1/2）');return year+'-'+semester;}
 return '';
}
function scoreFields(score,status,scale){
 const text=E.clean(score),explicit=E.clean(status);
 const inferredStatus=({旷考:'缺考',作弊:'违纪'})[text]||(['待出分','缓考','缺考','违纪','成绩撤回'].includes(text)?text:'已出分');
 const inferredScale=['优','良','中','优秀','良好','中等','及格','不及格'].includes(text)?'五级制':['合格','不合格','通过','未通过','不通过'].includes(text)?'两级制':'百分制';
 return {status:({旷考:'缺考',作弊:'违纪',正常考试:inferredStatus})[explicit]||explicit||inferredStatus,scale:E.clean(scale)||inferredScale};
}
const noteStatuses={'正常考试':'已出分','缓考':'缓考','旷考':'缺考','作弊':'违纪','已出分':'已出分','待出分':'待出分','缺考':'缺考','违纪':'违纪','成绩撤回':'成绩撤回'};
function courseScoreFields(score,raw){
 const note=E.clean(raw['成绩备注']),recognized=Object.hasOwn(noteStatuses,note),legacy=E.clean(raw['考试状态']),scale=raw['成绩制'];
 const desired=recognized?scoreFields(score,note,scale):null;
 if(desired&&legacy&&scoreFields(score,legacy,scale).status!==desired.status)E.fail('成绩备注与原考试状态不一致，请核对','GRADE_REMARK_CONFLICT');
 return {...(desired||scoreFields(score,legacy,scale)),remark:Object.hasOwn(raw,'补充说明')?E.clean(raw['补充说明']):recognized?'':note};
}
aliases.成绩备注=['考试状态','成绩状态','状态'];
const componentFields=[['平时成绩','regularScore'],['期中成绩','midtermScore'],['期末成绩','finalScore'],['实验成绩','experimentScore']];
aliases.成绩阶段=['考试类型'];aliases.考试状态.push('状态');aliases.总评成绩.push('正考成绩');
function attemptType(value){const text=E.clean(value).toLowerCase();if(!text)return '';const types={正考:'original',初修:'original',正常考试:'original',original:'original',补考:'makeup',makeup:'makeup',重修:'retake',retake:'retake'};if(!Object.hasOwn(types,text))E.fail('成绩阶段应为正考、补考或重修，请核对字段映射','ATTEMPT_TYPE_INVALID');return types[text];}
function components(raw){const value={};for(const [field,key] of componentFields){const text=E.clean(raw[field]);if(!text)continue;if(!/^\d+(\.\d{1,4})?$/.test(text)||Number(text)>100)E.fail(field+'应为0—100分，未知请留空','SCORE_INVALID');value[key]=Number(text);}return value;}
module.exports={suggest,term,scoreFields,courseScoreFields,components,componentFields,attemptType};
