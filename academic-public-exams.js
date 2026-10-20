'use strict';
const E=require('./academic-public-engine');
const types=['英语四级','英语六级','全国计算机等级','省级计算机等级','学位英语','计算机等级'];
const computer=type=>['计算机等级','全国计算机等级','省级计算机等级'].includes(type);
const officialResults=['合格','不合格','通过','未通过','优秀','良好','及格','不及格','待出分','缺考'];
const aliases={'全国计算机等级考试':'全国计算机等级',NCRE:'全国计算机等级','省级计算机等级考试':'省级计算机等级','地方省级计算机':'省级计算机等级',CET4:'英语四级','CET-4':'英语四级',CET6:'英语六级','CET-6':'英语六级'};
const extraFields=[['考试省份','province'],['准考证号','admission'],['听力成绩','listening'],['阅读成绩','reading'],['写作翻译成绩','writing'],['成绩备注','remark']];
function hasDocument(record){const value=record.certificate;if(typeof value!=='string'&&typeof value!=='number')return false;const text=E.clean(value);return !!text&&!['无','暂无','无证书','未获证','未取得','未提供','暂未取得','尚未取得','—','–','--','-','/'].includes(text);}
function normalize(text){
 const type=aliases[text('考试类型')]||text('考试类型');if(!types.includes(type))E.fail('考试类型无法识别');
 const scoreText=text('成绩'),official=text('官方结果');if(official&&!officialResults.includes(official))E.fail('官方结果无法识别');
 if(!scoreText&&!official)E.fail('分数和官方结果至少填写一项');
 const cet=['英语四级','英语六级'].includes(type),score=scoreText===''?null:Number(scoreText);
 if(score!==null&&(!/^\d+(\.\d{1,4})?$/.test(scoreText)||score>(cet?710:100)))E.fail('考试分数超出范围','SCORE_INVALID');
 if(computer(type)&&(!text('等级')||!text('科目')))E.fail('计算机等级需填写等级与科目');
 if(type==='省级计算机等级'&&!text('考试省份'))E.fail('省级计算机等级需填写考试省份');
 if(type==='学位英语'&&!text('举办单位'))E.fail('学位英语需填写举办单位');
 const value={type,score,official,grade:text('等级'),subject:text('科目'),certificate:text('证书编号'),organizer:text('举办单位')};
 for(const [field,key] of extraFields){const raw=text(field);if(!raw)continue;if(['listening','reading','writing'].includes(key)){if(!cet||!/^\d+(\.\d{1,4})?$/.test(raw)||Number(raw)>(key==='writing'?212:249))E.fail(field+'超出四六级单项分数范围');value[key]=Number(raw);}else value[key]=raw;}
 validateParts(value);
 return value;
}
function validateParts(value){if(['英语四级','英语六级'].includes(value.type)&&['listening','reading','writing'].every(k=>Number.isFinite(value[k]))&&Number.isFinite(value.score)&&Math.abs(value.listening+value.reading+value.writing-value.score)>0.01)E.fail('四六级单项成绩之和与总分不一致');}
function identity(x){return JSON.stringify([x.sid,x.type,x.batch,...(computer(x.type)?[x.grade||'',x.subject||'']:[]),...(x.type==='省级计算机等级'?[x.province||'']:x.type==='学位英语'?[x.organizer||'']:[])]);}
function view(x,r){
 const cet=['英语四级','英语六级'].includes(x.type),issues=[];
 if(!types.includes(x.type))issues.push('考试项目无法识别');
 if(x.official&&!officialResults.includes(x.official))issues.push('保存的官方结果无法识别');
 if(x.score!==null&&x.score!==undefined&&(!Number.isFinite(x.score)||x.score<0||x.score>(cet?710:100)))issues.push('保存的成绩超出范围或格式异常');
 for(const [key,max] of [['listening',249],['reading',249],['writing',212]])if(x[key]!==null&&x[key]!==undefined&&(!cet||!Number.isFinite(x[key])||x[key]<0||x[key]>max))issues.push('保存的单项成绩异常');
 try{validateParts(x);}catch(e){issues.push(e.message);}
 if(issues.length)return {...x,pass:null,result:'成绩数据异常，待核查',issues,documentStatus:hasDocument(x)?'已提供，未核验':'未提供'};
 let pass=null;const yes=['合格','通过','优秀','良好','及格'].includes(x.official),no=['不合格','未通过','不及格'].includes(x.official);
 const pending=['待出分','缺考'].includes(x.official);
 if(!pending){if(computer(x.type))pass=yes?true:no?false:null;else if(Number.isFinite(x.score)&&r)pass=x.score>=(x.type==='学位英语'?r.degreeScore:r.cetScore);else if(x.type==='学位英语')pass=yes?true:no?false:null;}
 const conflict=x.type==='学位英语'&&pass!==null&&((yes&&!pass)||(no&&pass));if(conflict)pass=null;
 return {...x,pass,result:pending?x.official==='缺考'?'缺考，待核查':'待出分':conflict?'分数与官方结果冲突，待复核':pass===null?'待核查':pass?'已达标':'未达标',documentStatus:hasDocument(x)?'已提供，未核验':'未提供'};
}
function views(records,r){const counts=new Map();for(const x of records){const key=identity(x);counts.set(key,(counts.get(key)||0)+1);}return records.map(x=>{const row=view(x,r);return counts.get(identity(x))>1?{...row,pass:null,result:'考试身份重复，待核查',identityConflict:true}:row;});}
function statistics(records){
 const groups=new Map();for(const x of records){const key=JSON.stringify([x.type,x.province||'',x.organizer||'',x.batch||'',computer(x.type)?x.grade||'':'',computer(x.type)?x.subject||'':'']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);}
 return [...groups.values()].map(xs=>{const passed=xs.filter(x=>x.pass===true).length,failed=xs.filter(x=>x.pass===false).length,absent=xs.filter(x=>x.official==='缺考'&&x.pass===null).length,pending=xs.length-passed-failed-absent;const {type,province='',organizer='',batch=''}=xs[0],grade=computer(type)?xs[0].grade||'':'',subject=computer(type)?xs[0].subject||'':'';return {type,province,organizer,batch,grade,subject,records:xs.length,students:new Set(xs.map(x=>x.sid)).size,passed,failed,pending,absent,documents:xs.filter(hasDocument).length,passRate:passed+failed?passed/(passed+failed):null};});
}
function sheet(records){return [['考试类型','考试省份','举办单位','考试批次','等级','科目','记录数','学生数','达标记录','未达标记录','待出分或待核查','缺考记录','达标率（已有结论记录）','已提供材料记录（未核验）'],...statistics(records).map(s=>[s.type,s.province,s.organizer,s.batch,s.grade,s.subject,s.records,s.students,s.passed,s.failed,s.pending,s.absent,s.passRate,s.documents])];}
module.exports={types,computer,normalize,identity,view,views,statistics,sheet,extraFields,validateParts,hasDocument};
