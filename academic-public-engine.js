"use strict";
const LEVELS=['黄色预警','橙色预警','红色预警','退学预警'];
const clean=v=>String(v??'').trim();
function fail(message,code='VALIDATION_ERROR'){const e=new Error(message);e.code=code;e.status=422;throw e;}
function warningRules(r){if(!r)return r;const rules={...r};delete rules.useGpa;delete rules.gpaThresholds;return rules;}
function validateRules(r){
 if(!r||!Array.isArray(r.thresholds)||r.thresholds.length!==4||!Array.isArray(r.enabled)||r.enabled.length!==4)fail('请设置四级预警阈值及启用状态');
 let last=0;r.thresholds.forEach((n,i)=>{if(!Number.isSafeInteger(n)||n<1||typeof r.enabled[i]!=='boolean')fail('挂科门数必须为正整数');if(r.enabled[i]){if(n<=last)fail('启用的黄色、橙色、红色、退学阈值须严格递增');last=n;}});
 if(!['current','original','makeup'].includes(r.stage)||!['term','year','all'].includes(r.scope)||!['original','current','highest'].includes(r.rank))fail('统计口径无效');
 if(!Array.isArray(r.categories)||r.categories.some(v=>!['必修','限选','选修','其他'].includes(v)))fail('课程范围无效');
 for(const [key,max] of [['passScore',100],['cetScore',710],['degreeScore',100]])if(!Number.isFinite(r[key])||r[key]<=0||r[key]>max)fail('成绩标准无效');
 if(r.gpaMap!==undefined&&(!Array.isArray(r.gpaMap)||r.gpaMap.some(x=>!x||!Number.isFinite(x.min)||!Number.isFinite(x.point)||x.min<0||x.min>100||x.point<0||x.point>10)))fail('绩点映射无效');
 if(r.gpaMap&&new Set(r.gpaMap.map(x=>x.min)).size!==r.gpaMap.length)fail('绩点映射的分数下限不能重复');
 if(r.absenceFail!==undefined&&typeof r.absenceFail!=='boolean')fail('缺考统计选项无效');
 if(r.metric!==undefined&&!['average','gpa'].includes(r.metric))fail('排名主指标无效');
 if(r.passResolution!==undefined&&!['everPassed','latest'].includes(r.passResolution))fail('成绩通过判定口径无效');
 if(r.gradeMap!==undefined&&(!r.gradeMap||typeof r.gradeMap!=='object'||Array.isArray(r.gradeMap)||Object.entries(r.gradeMap).some(([k,v])=>!['优秀','良好','中等','及格','不及格','合格','不合格','通过','未通过'].includes(k)||!Number.isFinite(v)||v<0||v>100)))fail('等第折算分数无效');
 if(r.warningMetric!==undefined&&!['courses','credits','either'].includes(r.warningMetric))fail('预警指标无效');
 if(r.deduplicateCourses!==undefined&&typeof r.deduplicateCourses!=='boolean')fail('预警统计选项无效');
 function thresholds(values,label,max){
  if(!Array.isArray(values)||values.length!==4||values.some(n=>!Number.isFinite(n)||n<=0||n>max))fail(label+'阈值无效');
  let previous=null;values.forEach((n,i)=>{if(r.enabled[i]){if(previous!==null&&n<=previous)fail(label+'启用阈值须严格递增');previous=n;}});
 }
 if(r.creditThresholds!==undefined||['credits','either'].includes(r.warningMetric))thresholds(r.creditThresholds,'未通过学分',10000);
 return warningRules(r);
}
function level(n,r){if(!r)return '';let out='';r.thresholds.forEach((t,i)=>{if(r.enabled[i]&&n>=t)out=LEVELS[i];});return out;}
function result(raw,scale,status,r){
 if(!['已出分','待出分','缓考','缺考','违纪','成绩撤回'].includes(status))fail('考试状态无效');
 if(!['百分制','五级制','两级制'].includes(scale))fail('请选择百分制、五级制或两级制','SCORE_INVALID');
 if(status!=='已出分')return {score:null,pass:status==='缺考'&&r?.absenceFail===true?false:null};
 const text=clean(raw);if(!text)fail('已出分记录必须填写成绩或等第','SCORE_INVALID');
 if(scale==='百分制'){if(!/^\d+(\.\d{1,4})?$/.test(text)||Number(text)>100)fail('百分制成绩应为0—100，最多4位小数','SCORE_INVALID');return {score:Number(text),pass:Number(text)>=(r?.passScore??60)};}
 if(scale==='五级制'){const map={优:'优秀',良:'良好',中:'中等',及格:'及格',不及格:'不及格',优秀:'优秀',良好:'良好',中等:'中等'};const grade=Object.hasOwn(map,text)?map[text]:null;if(!grade)fail('五级制成绩无法识别','SCORE_INVALID');return {score:r?.gradeMap?.[grade]??null,pass:grade!=='不及格',grade};}
 if(scale==='两级制'){if(!['合格','不合格','通过','未通过','不通过','及格','不及格'].includes(text))fail('两级制成绩无法识别','SCORE_INVALID');return {score:r?.gradeMap?.[text]??null,pass:['合格','通过','及格'].includes(text)};}
 fail('请选择百分制、五级制或两级制','SCORE_INVALID');
}
function storedResult(attempt,r){try{if(!['original','makeup','retake'].includes(attempt.type))fail('历史考试类型无效，请核查原始记录');return result(attempt.score,attempt.scale,attempt.status,r);}catch(e){if(e.status!==422)throw e;return {score:null,pass:null,issue:e.message};}}
function inTerm(c,term,scope){return !term||(scope==='all'?c.term<=term:(scope==='year'?c.term.slice(0,9)===term.slice(0,9):c.term===term));}
function validTerm(value){return typeof value==='string'&&/^\d{4}-\d{4}-[12]$/.test(value)&&Number(value.slice(5,9))===Number(value.slice(0,4))+1;}
function selectionFor(state,term,query){
 const scope=query?.scope||state.rules?.scope||'term',stage=query?.stage||state.rules?.stage||'current';
 if(!['term','multi','year','all'].includes(scope)||!['original','makeup','current'].includes(stage))fail('统计范围或成绩阶段无效');
 if(term&&!validTerm(term))fail('统计学期格式无效');
 let terms;
 if(scope==='multi'){
  if(!Array.isArray(query?.terms)||query.terms.length<2||query.terms.length>80||query.terms.some(t=>!validTerm(t))||new Set(query.terms).size!==query.terms.length)fail('多学期须选择2—80个不同的有效学期');
  terms=query.terms.slice().sort();
 }else if(scope==='term'&&term)terms=[term];
 else {
  const first=[state.courses.map(c=>c.term).sort()[0],query?.startTerm].filter(Boolean).sort()[0]||'';
  const available=scope==='all'&&Array.isArray(query?.availableTerms)?state.courses.map(c=>c.term).concat(query.availableTerms):state.courses.map(c=>c.term);
  terms=[...new Set(available.filter(t=>validTerm(t)&&(!first||t>=first)&&inTerm({term:t},term,scope)))].sort();
 }
 const end=scope==='multi'?terms.at(-1):term||terms.at(-1)||'';
 return {scope,stage,terms,end,key:JSON.stringify([scope,scope==='all'||scope==='year'?end:terms,stage]),label:({term:'单学期',multi:'多学期',year:'学年',all:'在校期间（全部学期）'})[scope]};
}
function enrollmentTerm(student){const match=clean(student.enroll).match(/^(\d{4})-(\d{2})/);if(!match)return '';const year=Number(match[1])-(Number(match[2])<8?1:0);return year+'-'+(year+1)+'-1';}
function warning(row,r){
 if(!r)return {level:'',reasons:[]};
 const reasons=[],metric=r.warningMetric||'courses';
 const metrics=[];
 if(metric!=='credits')metrics.push(['fail',row.fail,r.thresholds,'未通过门数']);
 if(metric!=='courses')metrics.push(['failCredit',row.failCredit,r.creditThresholds,'未通过学分']);
 for(const [key,value,thresholds,label] of metrics){let index=-1;thresholds.forEach((threshold,i)=>{if(r.enabled[i]&&value>=threshold)index=i;});if(index>=0)reasons.push({metric:key,value,threshold:thresholds[index],level:LEVELS[index],text:label+' '+value+' ≥ '+thresholds[index]});}
 return {level:reasons.reduce((best,x)=>LEVELS.indexOf(x.level)>LEVELS.indexOf(best)?x.level:best,''),reasons};
}
function summarize(state,students,term,query){
 const selection=selectionFor(state,term,{...query,startTerm:students.map(enrollmentTerm).filter(Boolean).sort()[0]}),selectedTerms=new Set(selection.terms),studentMap=new Map(students.map(s=>[clean(s.id),s]));
 const r=state.rules,groups=new Map();
 for(const a of state.attempts){if(!groups.has(a.courseId))groups.set(a.courseId,[]);groups.get(a.courseId).push(a);}
 const details=state.courses.filter(c=>selectedTerms.has(c.term)&&(!enrollmentTerm(studentMap.get(c.sid)||{})||c.term>=enrollmentTerm(studentMap.get(c.sid)||{}))).map(c=>{
  const a=(groups.get(c.id)||[]).slice().sort((x,y)=>clean(x.date).localeCompare(clean(y.date))||x.order-y.order);
  const valid=a.filter(x=>x.status==='已出分'||x.status==='缺考'),original=a.filter(x=>x.type==='original').at(-1);
  const selected=selection.stage==='original'?(original?[original]:[]):selection.stage==='makeup'?a.filter(x=>x.type!=='retake'):a;
  const resolved=selected.map(x=>({attempt:x,...storedResult(x,r)}));
  const passed=resolved.find(x=>x.pass===true),last=resolved.at(-1),current=r?.passResolution==='latest'?last:passed||last;
  let ranked=r?.rank==='current'?(valid.filter(x=>x.status==='已出分').at(-1)):original;
  if(r?.rank==='highest')ranked=valid.filter(x=>x.status==='已出分'&&storedResult(x,r).score!==null).sort((x,y)=>storedResult(y,r).score-storedResult(x,r).score)[0];
  const rankedResult=ranked?storedResult(ranked,r):null;
  const originalResult=original?storedResult(original,r):null;
  const included=!r?.categories?.length||r.categories.includes(c.category);
  const point=ranked?.gpa!==null&&ranked?.gpa!==undefined?Number(ranked.gpa):(rankedResult?.score!==null&&rankedResult?.score!==undefined?(r?.gpaMap||[]).slice().sort((x,y)=>y.min-x.min).find(x=>rankedResult.score>=x.min)?.point:null);
  const issues=[...new Set(a.map(x=>storedResult(x,r).issue).filter(Boolean))];
  return {...c,issues,attempts:a,pass:current?.pass??null,stageScore:current?.score??null,stageRaw:current?.attempt.score??'',stageStatus:current?.attempt.status||'',score:rankedResult?.score??null,point:point??null,originalPass:originalResult?.pass??null,included,counted:included,tags:[...new Set(a.filter(x=>x.type!=='original').map(x=>x.type==='makeup'?'补考':'重修'))]};
 });
 const byStudent=new Map();details.forEach(c=>{if(!byStudent.has(c.sid))byStudent.set(c.sid,[]);byStudent.get(c.sid).push(c);});
 const rows=students.map(s=>{
  const all=byStudent.get(clean(s.id))||[];
  if(r?.deduplicateCourses){const codes=new Map();all.filter(c=>c.included&&c.code).forEach(c=>{const previous=codes.get(c.code);if(!previous||c.term>previous.term)codes.set(c.code,c);});all.forEach(c=>{if(c.code&&codes.has(c.code)&&codes.get(c.code)!==c)c.counted=false;});}
  const cs=all.filter(c=>c.counted),pending=cs.filter(c=>c.pass===null||c.issues.length).length,failCount=cs.filter(c=>c.pass===false).length;
  const covered=new Set(all.map(c=>c.term)),missingTerms=selection.terms.filter(t=>(!enrollmentTerm(s)||t>=enrollmentTerm(s))&&!covered.has(t));
  const originalFail=cs.filter(c=>c.originalPass===false).length;
  const ranked=cs.filter(c=>c.credit>0),credits=ranked.reduce((n,c)=>n+c.credit,0);
  const partialRecords=cs.some(c=>c.coverageKind==='failure-list');
  const baseComplete=!!cs.length&&!partialRecords&&!pending&&!missingTerms.length&&cs.every(c=>c.credit!==null);
  const average=baseComplete&&credits>0&&ranked.every(c=>c.score!==null)?Math.round(ranked.reduce((n,c)=>n+c.score*c.credit,0)/credits*1e6)/1e6:null;
  const gpa=baseComplete&&credits>0&&ranked.every(c=>c.point!==null)?Math.round(ranked.reduce((n,c)=>n+c.point*c.credit,0)/credits*1e6)/1e6:null;
  const complete=baseComplete&&(r?.metric==='gpa'?gpa!==null:average!==null);
  const failCredit=Math.round(cs.filter(c=>c.pass===false).reduce((n,c)=>n+(c.credit||0),0)*1e6)/1e6;
  const row={sid:clean(s.id),name:s.name,dept:s.dept,major:s.major,grade:s.grade||'',cls:s.cls,status:s.status||'',count:cs.length,credit:credits,earnedCredit:cs.filter(c=>c.pass===true).reduce((n,c)=>n+(c.credit||0),0),fail:failCount,failCredit,originalFail,pending,missingTerms,coveredTerms:[...covered].sort(),complete,average,gpa,partialRecords,warningKnown:!!cs.length&&!partialRecords&&!pending&&!missingTerms.length&&(!(r?.warningMetric&&r.warningMetric!=='courses')||cs.every(c=>c.credit!==null)),details:all};
  return {...row,...warning(row,r)};
 });
 for(const type of ['class','major']){
  const bucket=new Map();for(const row of rows){const key=type==='class'?row.cls:[row.dept,row.grade,row.major].join('|');if(!bucket.has(key))bucket.set(key,[]);bucket.get(key).push(row);}
  for(const members of bucket.values()){const metric=r?.metric==='gpa'?'gpa':'average',ranked=members.filter(x=>x[metric]!==null).sort((a,b)=>b[metric]-a[metric]);let rank=0;ranked.forEach((x,i)=>{if(i===0||x[metric]!==ranked[i-1][metric])rank=i+1;x[type+'Rank']=rank;});members.forEach(x=>{x[type+'Size']=ranked.length;x[type+'Missing']=members.length-ranked.length;});}
 }
 return {rows,details,term,rules:r,selection,version:state.version};
}
module.exports={LEVELS,clean,fail,validateRules,warningRules,result,level,summarize,selectionFor,validTerm,enrollmentTerm};
