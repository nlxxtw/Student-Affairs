'use strict';
const E=require('./academic-public-engine');
const Exams=require('./academic-public-exams'),Import=require('./academic-public-import');
const schema=[
 {name:'各二级学院各年级不及格人数情况统计表',fields:['二级学院','年级','不及格人数','在校生数','不及格率']},
 {name:'各门课程不及格人数统计表（10人以上)',fields:['序号','课程代码','课程名称','不及格人数']},
 {name:'学生不及格课程明细',fields:['年级','学院','专业','班级','学号','姓名','课程代码','课程名称','学分','成绩','成绩备注','补考成绩','重修成绩','课程性质','课程类别','学期','考核方式']},
 {name:'各二级学院各年级学业预警人数情况统计表',fields:['二级学院','年级','黄色预警','橙色预警','红色预警','退学预警']},
 {name:'学生预警明细',fields:['学院','年级','专业','班级','学号','姓名','不及格课程数','英语通过情况（通过/不通过）','计算机通过情况（通过/不通过）','预警级别']}
];
const normalizeName=v=>E.clean(v).replace(/[（(]/g,'(').replace(/[）)]/g,')');
function template(){return Object.fromEntries(schema.map(s=>[s.name,[s.fields.slice()]]));}
function readTable(file,definition){
 const matches=file.sheets.filter(s=>normalizeName(s.name)===normalizeName(definition.name));
 if(matches.length!==1)E.fail('必须包含且仅包含一个工作表：'+definition.name,'REPORT_SCHEMA_INVALID');
 const sheet=matches[0],header=sheet.rows.slice(0,10).find(r=>definition.fields.every(f=>r.cells.some(c=>E.clean(c.value)===f)));
 if(!header)E.fail(sheet.name+'缺少必需字段：'+definition.fields.join('、'),'REPORT_SCHEMA_INVALID');
 const extraColumns=header.cells.flatMap((c,i)=>E.clean(c.value)==='补充说明'?[i]:[]);if(extraColumns.length>1)E.fail(sheet.name+'字段重复：补充说明','HEADER_AMBIGUOUS');const extraColumn=extraColumns[0]??-1;
 const columns=definition.fields.map(f=>{const indices=header.cells.flatMap((c,i)=>E.clean(c.value)===f?[i]:[]);if(indices.length!==1)E.fail(sheet.name+'字段重复：'+f,'HEADER_AMBIGUOUS');return indices[0];});
 return sheet.rows.filter(r=>r.sourceRow>header.sourceRow).map(row=>{const raw={_sheet:sheet.name,_row:row.sourceRow,_issues:[]};if(extraColumn>=0){const c=row.cells[extraColumn]||{};raw['补充说明']=c.value??'';if(c.missingFormula)raw._issues.push('补充说明公式没有缓存结果');}definition.fields.forEach((f,i)=>{const c=row.cells[columns[i]]||{};raw[f]=c.value??'';if(c.missingFormula)raw._issues.push(f+'公式没有缓存结果');if((f==='学号'||f==='课程代码')&&c.precisionLost)raw._issues.push(f+'精度可能丢失，请改为文本');});return raw;}).filter(r=>definition.fields.some(f=>E.clean(r[f])));
}
function scoreFields(value){const score=E.clean(value),status=({旷考:'缺考',作弊:'违纪'})[score]||(['待出分','缓考','缺考','违纪','成绩撤回'].includes(score)?score:score?'已出分':'待出分'),scale=status!=='已出分'||/^\d+(\.\d+)?$/.test(score)?'百分制':['优秀','良好','中等','及格','不及格','优','良','中'].includes(score)?'五级制':'两级制';return {score,scale,status};}
function read(file,reportTerm){
 const tables=schema.map(d=>readTable(file,d)),rows=[];
 // Summary sheets are reference evidence only. Preserve their schema without treating totals as grades.
 for(const raw of tables[2]){
  const base={...raw,'原修读学期':E.clean(raw['学期']),'总评成绩':raw['成绩']};
  for(const [type,field] of [['original','成绩'],['makeup','补考成绩'],['retake','重修成绩']]){
   if(type!=='original'&&!E.clean(raw[field]))continue;
   const score=scoreFields(raw[field]),note=type==='original'?raw['成绩备注']:E.gradeRemark(score.status),remark=Import.courseScoreFields(score.score,{'成绩备注':note,'成绩制':score.scale});rows.push({...base,'成绩备注':note,'补充说明':Import.courseScoreFields(raw['成绩'],raw).remark,_importType:type,'成绩制':score.scale,'考试状态':remark.status,'考试批次':'预警报告-'+E.clean(raw['学期'])+'-'+type,'总评成绩':type==='original'?score.score:base['总评成绩'],[type==='makeup'?'补考成绩':type==='retake'?'重修成绩':'成绩']:score.score});
  }
 }
 for(const raw of tables[4])rows.push({...raw,_importType:'reference','报告学期':reportTerm});
 return {rows,info:{sheets:schema.map((d,i)=>({name:d.name,rows:tables[i].length})),students:tables[4].length,courses:tables[2].length,notes:['汇总表和原预警级别仅供核对，系统按当前规则重新计算。','不及格明细不能替代全量成绩；平均分、排名和正式复核需补齐成绩。','未提供的重修学期、考试日期和证书资料保留为空，等级考试通过情况仅保存为导入报告依据。']}};
}
const order=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
function grouped(rows,build){
 const groups=new Map();for(const r of rows){const key=JSON.stringify([r.dept||'未设置学院',r.grade||'未设置年级']);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const out=[];let current='',department=[];
 const addTotal=()=>{if(department.length)out.push(build(current,'小计',department));};
 for(const members of [...groups.values()].sort((a,b)=>order.compare(a[0].dept||'',b[0].dept||'')||order.compare(a[0].grade||'',b[0].grade||''))){const d=members[0].dept||'未设置学院';if(d!==current){addTotal();current=d;department=[];}out.push(build(d,members[0].grade||'未设置年级',members));department.push(...members);}
 addTotal();out.push(build('合计','',rows));return out;
}
function build({rows,population,details,selection,cases,examResults,references}){
 const sheets=template(),positions=new Map(population.map((r,i)=>[r.sid,i])),students=new Map(population.map(r=>[r.sid,r]));
 const failed=details.filter(c=>students.has(c.sid)&&c.counted!==false&&c.pass===false).sort((a,b)=>positions.get(a.sid)-positions.get(b.sid)||order.compare(a.term,b.term)||order.compare(a.code,b.code));
 const current=r=>['','在校','在校生'].includes(r.status||'');
 sheets[schema[0].name][0].push('筛选学生数','筛选不及格人数','待核查人数');
 sheets[schema[0].name].push(...grouped(population,(dept,grade,members)=>{const enrolled=members.filter(current),fail=enrolled.filter(r=>r.fail>0).length;return [dept,grade,fail,enrolled.length,enrolled.length?fail/enrolled.length:null,members.length,members.filter(r=>r.fail>0).length,members.filter(r=>!r.warningKnown).length];}));
 const courseGroups=new Map();for(const c of failed){const key=JSON.stringify([c.code,c.name]);if(!courseGroups.has(key))courseGroups.set(key,{code:c.code,name:c.name,students:new Set()});courseGroups.get(key).students.add(c.sid);}
 sheets[schema[1].name].push(...[...courseGroups.values()].filter(c=>c.students.size>=10).sort((a,b)=>b.students.size-a.students.size||order.compare(a.code,b.code)).map((c,i)=>[i+1,c.code,c.name,c.students.size]));
 sheets[schema[2].name][0].push('通过状态','计入汇总','统计学期','成绩阶段','补充说明');
 sheets[schema[2].name].push(...failed.map(c=>{const s=students.get(c.sid),last=type=>c.attempts.filter(a=>a.type===type).at(-1)?.score??'';return [s.grade,s.dept,s.major,s.cls,s.sid,s.name,c.code,c.name,c.credit,last('original'),E.gradeRemark(c.attempts.filter(a=>a.type==='original').at(-1)?.status),last('makeup'),last('retake'),c.nature||'',c.category,c.term,c.assessment||'','未通过','是',selection.terms.join('、'),selection.stage,c.remark||''];}));
 sheets[schema[3].name][0].push('预警人数','待核查预警人数');
 const warningIds=new Set(rows.map(r=>r.sid));
 sheets[schema[3].name].push(...grouped(population,(dept,grade,members)=>{const warnings=members.filter(r=>warningIds.has(r.sid));return [dept,grade,...E.LEVELS.map(level=>warnings.filter(r=>r.level===level).length),warnings.length,warnings.filter(r=>!r.warningKnown).length];}));
 const referenceMap=new Map(references.filter(r=>r.period===selection.end).map(r=>[r.sid,r])),exams=new Map();for(const e of examResults){if(!exams.has(e.sid))exams.set(e.sid,[]);exams.get(e.sid).push(e);}
 function examStatus(sid,type){const records=(exams.get(sid)||[]).filter(e=>type==='english'?['英语四级','英语六级','学位英语'].includes(e.type):['计算机等级','全国计算机等级','省级计算机等级'].includes(e.type));if(records.length)return {value:records.some(e=>e.pass===true)?'通过':records.every(e=>e.pass===false)?'不通过':'待核查',source:'等级考试记录（'+[...new Set(records.map(e=>e.type))].join('、')+'；非获证结论）'};const value=referenceMap.get(sid)?.[type];return {value:value||'待核查',source:value?'导入报告（未核验证书）':'未提供'};}
 const casesByStudent=new Map();for(const c of cases){if(!casesByStudent.has(c.sid))casesByStudent.set(c.sid,[]);casesByStudent.get(c.sid).push(c);}
 sheets[schema[4].name][0].push('未通过学分','正考挂科门数','待核查门数','加权平均分','触发原因','完整性','缺失学期','办理状态','已确认级别','统计学期','成绩阶段','原报告预警级别','原报告不及格课程数','等级考试依据');
 sheets[schema[4].name].push(...rows.map(r=>{const english=examStatus(r.sid,'english'),computer=examStatus(r.sid,'computer'),reference=referenceMap.get(r.sid),studentCases=casesByStudent.get(r.sid)||[];return [r.dept,r.grade,r.major,r.cls,r.sid,r.name,r.fail,english.value,computer.value,r.level,r.failCredit,r.originalFail,r.pending,r.average,r.reasons.map(x=>x.text).join('；'),r.warningKnown?'完整':'待核查',r.missingTerms.join('、'),studentCases.map(c=>c.status).join(' / ')||'未生成',studentCases.map(c=>c.confirmedLevel).filter(Boolean).join(' / '),selection.terms.join('、'),selection.stage,reference?.reportedLevel||'',reference?.reportedFail??null,'英语：'+english.source+'；计算机：'+computer.source];}));
 const projects=['英语四级','英语六级','全国计算机等级','省级计算机等级','学位英语','计算机等级'];
 sheets[schema[4].name][0].push(...projects.map(type=>(type==='计算机等级'?'计算机等级（历史未分类）':type)+'达标情况'),'考证材料已提供记录数（未核验）');
 rows.forEach((row,index)=>{const records=exams.get(row.sid)||[];sheets[schema[4].name][index+1].push(...projects.map(type=>{const items=records.filter(x=>x.type===type);return !items.length?'未导入':items.some(x=>x.pass===true)?'已达标':items.every(x=>x.pass===false)?'未达标':'待核查';}),records.filter(Exams.hasDocument).length);});
 return sheets;
}
module.exports={schema,template,read,build};
