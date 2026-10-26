'use strict';
const E=require('./academic-public-engine');
const order=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
const outcome=c=>c.issues?.length||c.pass===null?'待核查':c.pass?'通过':'未通过';
const round=value=>Math.round(value*1e6)/1e6;
const issueTypes=['未导入成绩','缺失学期','仅不及格记录','缺少学分','成绩待核查','排名不可计算'];
function auditRows(rows,selection){
 const items=[];
 for(const r of rows){
  const details=(r.details||[]).filter(c=>c.counted!==false),terms=selection?.terms||[...new Set(details.map(c=>c.term).concat(r.missingTerms||[]))];
  const add=(type,term,code,name,detail,advice)=>items.push({sid:r.sid,name:r.name,dept:r.dept,grade:r.grade,cls:r.cls,type,term,code,courseName:name,detail,advice});
  if(!r.count&&(r.missingTerms||[]).length)add('未导入成绩',r.missingTerms.join('、'),'','','所选在校学期没有计入汇总的成绩','导入对应学期完整成绩，并核对课程范围');
  else for(const term of r.missingTerms||[])add('缺失学期',term,'','','该学期未导入课程记录','补齐该学期完整成绩；不能据此认定没有挂科');
  for(const term of new Set(details.filter(c=>c.coverageKind==='failure-list').map(c=>c.term)))add('仅不及格记录',term,'','','数据来自不及格名单，不能证明完整成绩','补充该学期完整课程成绩后核对覆盖标记');
  for(const c of details){
   if(c.credit===null||c.credit===undefined)add('缺少学分',c.term,c.code,c.name,'学分为空；不作为0学分处理','从教务成绩表补充课程学分');
   if(c.pass===null||c.issues?.length)add('成绩待核查',c.term,c.code,c.name,c.issues?.join('；')||c.stageStatus||'所选成绩阶段无有效结论','核对缓考、待出分、撤回或原始成绩，再重新导入');
  }
  if(r.count&&!r.complete)add('排名不可计算',terms.join('、'),'','','课程、学分、折算分或绩点尚不满足当前排名口径','先处理覆盖和成绩问题，再按本校规则补充折算及绩点');
 }
 return items;
}
function termStats(state,students,selection,ids){
 return selection.terms.map(term=>{
  const eligible=students.filter(s=>ids.has(String(s.id))&&(!E.enrollmentTerm(s)||term>=E.enrollmentTerm(s)));
  const rows=E.summarize(state,eligible,term,{scope:'term',stage:selection.stage}).rows;
  return {term,students:rows.length,imported:rows.filter(r=>r.count).length,failed:rows.filter(r=>r.fail>0).length,warnings:rows.filter(r=>r.level).length,knownWarnings:rows.filter(r=>r.level&&r.warningKnown).length,pending:rows.filter(r=>!r.warningKnown).length,partial:rows.filter(r=>r.partialRecords).length,earnedCredit:round(rows.reduce((n,r)=>n+r.earnedCredit,0))};
 });
}
function build(rows,query={},selection){
 const groups={};for(const key of ['courseCode','category','result','issueType']){const v=query[key];if(v===undefined||v==='')groups[key]=[];else if(typeof v==='string'&&v.length<=200)groups[key]=[v];else if(Array.isArray(v)&&v.length<=20000&&v.every(x=>typeof x==='string'&&x.length<=200))groups[key]=v;else E.fail('课程筛选条件格式无效：'+key);}
 if(groups.result.some(v=>!['通过','未通过','待核查'].includes(v)))E.fail('通过状态筛选无效');
 if(groups.issueType.some(v=>!issueTypes.includes(v)))E.fail('核查问题类型无效');
 const match=(key,v)=>!groups[key].length||groups[key].includes(String(v??''));
 const courses=rows.flatMap(r=>(r.details||[]).map(c=>({...c,sid:r.sid,studentName:r.name,dept:r.dept,major:r.major,grade:r.grade,cls:r.cls,result:outcome(c)}))).filter(c=>match('courseCode',c.code||c.name)&&match('category',c.category)&&match('result',c.result));
 const buckets=new Map();for(const c of courses.filter(c=>c.counted!==false)){const key=JSON.stringify([c.term,c.code,c.name,c.category]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(c);}
 const courseStats=[...buckets.values()].map(cs=>{
  const passed=cs.filter(c=>c.result==='通过').length,failed=cs.filter(c=>c.result==='未通过').length,pending=cs.length-passed-failed,partial=cs.filter(c=>c.coverageKind==='failure-list').length;
  const scores=cs.filter(c=>c.result!=='待核查'&&c.stageScore!==null&&c.stageScore!==undefined).map(c=>c.stageScore),bands=[0,0,0,0,0];scores.forEach(n=>bands[n<60?0:n<70?1:n<80?2:n<90?3:4]++);
  const valid=passed+failed,unconverted=cs.filter(c=>c.result!=='待核查'&&c.stageStatus==='已出分'&&c.stageScore===null).length,average=!partial&&scores.length?round(scores.reduce((n,v)=>n+v,0)/scores.length):null;
  return {term:cs[0].term,code:cs[0].code,name:cs[0].name,category:cs[0].category,count:cs.length,students:new Set(cs.map(c=>c.sid)).size,passed,failed,pending,partial,numeric:scores.length,unconverted,unscored:valid-scores.length-unconverted,passRate:!partial&&valid?passed/valid:null,average,bands};
 }).sort((a,b)=>order.compare(a.term,b.term)||order.compare(a.code||a.name,b.code||b.name));
 const organizations=new Map();for(const r of rows){const key=JSON.stringify([r.dept,r.grade,r.cls]);if(!organizations.has(key))organizations.set(key,[]);organizations.get(key).push(r);}
 const studentStats=[...organizations.values()].map(rs=>({dept:rs[0].dept,grade:rs[0].grade,cls:rs[0].cls,students:rs.length,imported:rs.filter(r=>r.count).length,failed:rs.filter(r=>r.fail>0).length,warnings:rs.filter(r=>r.level).length,pending:rs.filter(r=>!r.warningKnown).length,earnedCredit:round(rs.reduce((n,r)=>n+(r.earnedCredit||0),0))}));
 const creditBuckets=new Map();for(const r of rows)for(const c of r.details||[]){if(c.counted===false)continue;const key=JSON.stringify([r.dept,r.grade,r.cls,c.category]);if(!creditBuckets.has(key))creditBuckets.set(key,{dept:r.dept,grade:r.grade,cls:r.cls,category:c.category,people:new Set(),partialPeople:new Set(),importedCredit:0,earnedCredit:0,failedCredit:0,pendingCredit:0,missingCredits:0});const g=creditBuckets.get(key);g.people.add(r.sid);if(c.coverageKind==='failure-list')g.partialPeople.add(r.sid);if(c.credit===null||c.credit===undefined){g.missingCredits++;continue;}g.importedCredit+=c.credit;g[outcome(c)==='通过'?'earnedCredit':outcome(c)==='未通过'?'failedCredit':'pendingCredit']+=c.credit;}
 const creditStats=[...creditBuckets.values()].map(({people,partialPeople,...g})=>({...g,students:people.size,partialStudents:partialPeople.size,...Object.fromEntries(['importedCredit','earnedCredit','failedCredit','pendingCredit'].map(k=>[k,round(g[k])]))}));
 return {courses,courseStats,studentStats,creditStats,audit:auditRows(rows,selection).filter(r=>match('issueType',r.type))};
}
function auditSheet(analysis){return [['学号','姓名','学院','年级','班级','问题类型','涉及学期','课程代码','课程名称','问题说明','处理建议'],...(analysis.audit||[]).map(r=>[r.sid,r.name,r.dept,r.grade,r.cls,r.type,r.term,r.code,r.courseName,r.detail,r.advice])];}
function termSheet(analysis){return [['学期','学生数','已导入学生','未通过学生','预警候选学生','预警口径可判定预警候选','待核查学生','仅不及格记录学生','已获学分合计'],...(analysis.termStats||[]).map(r=>[r.term,r.students,r.imported,r.failed,r.warnings,r.knownWarnings,r.pending,r.partial,r.earnedCredit])];}
function sheets(analysis){return {
 '课程成绩查询':[['学号','姓名','学院','年级','专业','班级','原修读学期','课程代码','课程名称','学分','课程类别','课程性质','正考成绩','补考成绩','重修成绩','阶段成绩','通过状态','成绩备注','计入汇总','数据覆盖','教学班号','授课教师','开课单位','正考平时成绩','正考期中成绩','正考期末成绩','正考实验成绩','补充说明'],...analysis.courses.map(c=>[c.sid,c.studentName,c.dept,c.grade,c.major,c.cls,c.term,c.code,c.name,c.credit,c.category,c.nature||'',...['original','makeup','retake'].map(t=>c.attempts.filter(a=>a.type===t).at(-1)?.score??''),c.stageRaw??'',c.result,E.gradeRemark(c.stageStatus),c.counted===false?'否':'是',c.coverageKind==='failure-list'?'仅不及格记录':'已导入课程',c.teachingClass,c.teacher,c.offeringDept,...['regularScore','midtermScore','finalScore','experimentScore'].map(key=>c.attempts.filter(a=>a.type==='original').at(-1)?.[key]??null),c.remark||''])],
 '课程成绩统计':[['原修读学期','课程代码','课程名称','课程类别','修读人数','通过人数','未通过人数','待核查人数','仅不及格记录人数','通过率','数值成绩人数','未折算等第人数','无分数结论人数','数值成绩平均分','60分以下','60—69分','70—79分','80—89分','90—100分'],...analysis.courseStats.map(c=>[c.term,c.code,c.name,c.category,c.students,c.passed,c.failed,c.pending,c.partial,c.passRate,c.numeric,c.unconverted,c.unscored,c.average,...c.bands])],
 '学院年级班级统计':[['学院','年级','班级','筛选学生数','已导入学生数','未通过学生数','预警候选学生数','待核查学生数','已获学分合计'],...analysis.studentStats.map(r=>[r.dept,r.grade,r.cls,r.students,r.imported,r.failed,r.warnings,r.pending,r.earnedCredit])],
 '课程类别学分统计':[['学院','年级','班级','课程类别','修读学生数','已导入学分','已获学分','未通过学分','待核查学分','缺学分课程数','仅不及格记录学生数'],...analysis.creditStats.map(r=>[r.dept,r.grade,r.cls,r.category,r.students,r.importedCredit,r.earnedCredit,r.failedCredit,r.pendingCredit,r.missingCredits,r.partialStudents])]
 };}
module.exports={build,sheets,auditSheet,termSheet,termStats,issueTypes};
