"use strict";
const crypto=require('node:crypto'),E=require('./academic-public-engine'),Files=require('./academic-public-files'),Report=require('./academic-public-report'),Import=require('./academic-public-import'),Analysis=require('./academic-public-analysis'),Exams=require('./academic-public-exams');
const id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString(),hash=v=>crypto.createHash('sha256').update(JSON.stringify(v??null)).digest('hex');
const fields={original:['学号','姓名','原修读学期','课程代码','课程名称','学分','课程类别','成绩制','总评成绩','考试状态','考试批次','考试日期','绩点'],makeup:['学号','姓名','原修读学期','课程代码','课程名称','考试批次','考试日期','补考成绩','考试状态','成绩制','绩点'],retake:['学号','姓名','原修读学期','课程代码','课程名称','重修学期','考试批次','考试日期','重修成绩','考试状态','成绩制','绩点'],exam:['学号','姓名','考试类型','考试批次','考试日期','等级','科目','成绩','官方结果','证书编号','举办单位']};
const studentOrder=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
fields.original.push('课程性质','成绩备注','考核方式');
fields.original.push('教学班号','授课教师','开课单位');
fields.exam.push(...Exams.extraFields.map(([field])=>field));
for(const type of ['original','makeup','retake'])fields[type].push(...Import.componentFields.map(([field])=>field));
for(const type of ['original','makeup','retake'])fields[type].push('学年','学期');
for(const type of ['original','makeup','retake'])fields[type].push('成绩阶段');
fields.report=[...new Set(Report.schema.flatMap(s=>s.fields))];
const templateExampleValues={
 学号:'20240001',姓名:'示例学生',学院:'示例学院',二级学院:'示例学院',专业:'示例专业',班级:'示例班级',年级:'2024级',原修读学期:'2026-2027-1',学年:'2026-2027',学期:'1',课程代码:'COURSE001',课程名称:'高等数学',学分:4,课程类别:'必修',课程性质:'专业基础课',成绩制:'百分制',总评成绩:85,补考成绩:75,重修成绩:80,考试状态:'已出分',考试批次:'2026-2027-1期末考试',考试日期:'2027-01-15',绩点:3.5,成绩备注:'',考核方式:'考试',教学班号:'JXB001',授课教师:'张老师',开课单位:'示例学院',重修学期:'2026-2027-2',考试类型:'英语四级',等级:'四级',科目:'英语',成绩:450,官方结果:'合格',证书编号:'CERT20260001',举办单位:'教育考试机构',序号:1,不及格人数:12,在校生数:50,不及格率:0.24,黄色预警:1,橙色预警:0,红色预警:0,退学预警:0,不及格课程数:1,'英语通过情况（通过/不通过）':'通过','计算机通过情况（通过/不通过）':'通过',预警级别:'黄色预警'
};
Object.assign(templateExampleValues,{平时成绩:80,期中成绩:85,期末成绩:90,实验成绩:85,考试省份:'浙江',准考证号:'000123456789',听力成绩:150,阅读成绩:150,写作翻译成绩:150});
function templateExampleRow(headers,type){return headers.map(field=>field==='成绩阶段'?({original:'正考',makeup:'补考',retake:'重修'})[type]||'':Object.hasOwn(templateExampleValues,field)?templateExampleValues[field]:'示例'+field);}
function reportImportTemplate(){const sheets=Report.template();for(const definition of Report.schema)sheets[definition.name].push(templateExampleRow(definition.fields));return sheets;}
const studentOrderFields=['dept','grade','cls','sid'];
const compareStudents=(a,b)=>{for(const key of studentOrderFields){const order=studentOrder.compare(String(a[key]??''),String(b[key]??''));if(order)return order;}return String(a.sid).localeCompare(String(b.sid));};
const normalizedStatus=value=>({'在校生':'在校','已毕业':'毕业','转专业（转出）':'转出','其他状态':'其他','延毕':'延期毕业'}[value]||value||'在校');
function createService(dbGetter,deps){
 const db=()=>dbGetter(),admin=a=>['sa','admin'].includes(a.role);
 const indexes=new WeakMap();
 function lookup(s,src){
  let m=indexes.get(s);if(m)return m;
  m={students:new Map(src.students.map(x=>[String(x.id),x])),courseById:new Map(),codes:new Map(),names:new Map(),attemptNatural:new Map(),examNatural:new Map(),attemptByKey:new Map(),examByKey:new Map(),referenceByKey:new Map()};indexes.set(s,m);
  for(const c of s.courses)indexCourse(s,c);for(const a of s.attempts)indexRecord(s,a,'attempt');for(const e of s.exams)indexRecord(s,e,'exam');for(const r of s.reportReferences)indexRecord(s,r,'reference');return m;
 }
 function indexCourse(s,c,before){
  const m=indexes.get(s);if(!m)return;const key=(x,f)=>JSON.stringify([x.sid,x.term,x[f]]);
  for(const [map,field] of [[m.codes,'code'],[m.names,'name']]){if(before){const oldKey=key(before,field),left=(map.get(oldKey)||[]).filter(x=>x.id!==c.id);if(left.length)map.set(oldKey,left);else map.delete(oldKey);}const k=key(c,field),items=map.get(k)||[];if(!items.some(x=>x.id===c.id))items.push(c);map.set(k,items);}m.courseById.set(c.id,c);
 }
 function indexRecord(s,r,kind){const m=indexes.get(s);if(!m)return;if(kind==='reference'){m.referenceByKey.set(r.key,r);}else if(kind==='exam'){m.examByKey.set(r.key,r);const key=Exams.identity(r),old=m.examNatural.get(key),items=(old?Array.isArray(old)?old:[old]:[]).filter(x=>x.id!==r.id).concat(r);m.examNatural.set(key,items.length===1?items[0]:items);}else{m.attemptByKey.set(r.key,r);m.attemptNatural.set(JSON.stringify([r.courseId,r.type,r.batch]),r);}}
 const encode=v=>deps.encrypt(JSON.stringify(v)),decode=v=>JSON.parse(deps.decrypt(v));
 function init(){db().exec(`CREATE TABLE IF NOT EXISTS academic_public_state(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS academic_public_artifacts(id TEXT PRIMARY KEY,kind TEXT NOT NULL,actor TEXT NOT NULL,expires INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS academic_public_batches(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS academic_public_warning_runs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created TEXT NOT NULL,selection_key TEXT NOT NULL,data_version INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS academic_public_warning_runs_created ON academic_public_warning_runs(created DESC);
 CREATE INDEX IF NOT EXISTS academic_public_warning_runs_actor ON academic_public_warning_runs(actor,created DESC);`);db().prepare('DELETE FROM academic_public_artifacts WHERE expires<?').run(Date.now());migrateWarningRules();}
 function load(){const row=db().prepare('SELECT payload FROM academic_public_state WHERE id=1').get(),s=row?decode(row.payload):{version:0,rules:null,courses:[],attempts:[],exams:[],cases:[],acl:{},publications:[],ruleHistory:[]};s.reportReferences=s.reportReferences||[];return s;}
 function save(s){const before=s.version;s.version++;const changed=db().prepare('INSERT INTO academic_public_state(id,version,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload WHERE academic_public_state.version=?').run(s.version,encode(s),before);if(changed.changes!==1)throw Object.assign(Error('数据已被其他操作更新，请重新预览'),{status:409,code:'PREVIEW_STALE'});}
 let warningPolicyStamp='',warningPolicyDatabase=null;
 function policyStamp(){return JSON.stringify([db().prepare('SELECT version FROM academic_public_state WHERE id=1').get()?.version??null,db().prepare('SELECT total_changes() AS changes').get().changes,db().prepare('PRAGMA data_version').get().data_version]);}
 function migrateWarningRules(){
  if(warningPolicyDatabase!==db()){warningPolicyDatabase=db();warningPolicyStamp='';}
  const signature=policyStamp();if(signature===warningPolicyStamp)return;
  const s=load();
  if(s.rules&&(Object.hasOwn(s.rules,'useGpa')||Object.hasOwn(s.rules,'gpaThresholds'))){
   (s.ruleHistory||=[]).push(s.rules);s.rules={...E.warningRules(s.rules),version:s.version+1,created:stamp(),actor:'system:warning-independent-of-gpa'};
   recomputeAll(s,source());txn(()=>save(s));
  }
  warningPolicyStamp=policyStamp();
 }
 function source(){const store=deps.store();return {students:JSON.parse(store.nnuzc_students||'[]'),terms:JSON.parse(store.nnuzc_term_list||'[]').map(x=>E.clean(typeof x==='object'?x.term:x).replace(/学期$/,'')),fingerprint:hash([store.nnuzc_students,store.nnuzc_term_list])};}
 function permission(s,a,action){if(admin(a))return;const acl=s.acl[a.uid];if(!acl||!acl[action]||!Array.isArray(acl.classes))throw Object.assign(Error('当前账号未获公用版'+({view:'查看',import:'导入',export:'导出',review:'复核'}[action]||action)+'权限，请联系管理员'),{status:403,code:'FORBIDDEN_SCOPE'});}
 function visible(s,a,student){return admin(a)||!!s.acl[a.uid]?.classes?.includes(student.cls);}
 function accessible(s,a,action='view'){permission(s,a,action);return source().students.filter(x=>visible(s,a,x));}
 function guard(s,version){if(!Number.isSafeInteger(version)||s.version!==version)throw Object.assign(Error('数据已变化，请刷新后重新预览'),{status:409,code:'PREVIEW_STALE'});}
 function effectiveChanges(changes){const merged=new Map();for(const c of changes){const key=JSON.stringify([c.collection,c.after.id]),prior=merged.get(key);if(prior)prior.after=c.after;else merged.set(key,{...c});}return [...merged.values()];}
 function txn(run){db().exec('BEGIN IMMEDIATE');try{const v=run();db().exec('COMMIT');return v;}catch(e){db().exec('ROLLBACK');throw e;}}
 function artifact(kind,a,payload,ttl=86400000){const key=id();db().prepare('INSERT INTO academic_public_artifacts VALUES(?,?,?,?,?)').run(key,kind,a.uid,Date.now()+ttl,encode(payload));return key;}
 function getArtifact(key,kind,a){const r=db().prepare('SELECT * FROM academic_public_artifacts WHERE id=? AND kind=?').get(key,kind);if(!r||r.expires<Date.now())throw Object.assign(Error('记录已过期，请重新生成'),{status:410,code:'ARTIFACT_EXPIRED'});if(r.actor!==a.uid)throw Object.assign(Error('此记录不属于当前账号'),{status:403,code:'FORBIDDEN_SCOPE'});return decode(r.payload);}
 function termCheck(value,src){const t=E.clean(value);if(!t)E.fail('请填写学期');if(!/^\d{4}-\d{4}-[12](?:学期)?$/.test(t))E.fail('学期格式应为2026-2027-1');const years=t.match(/\d+/g);if(Number(years[1])!==Number(years[0])+1)E.fail('学年起止年份无效');const normalized=t.replace(/学期$/,'');if(!(src||source()).terms.some(x=>E.clean(x).replace(/学期$/,'')===normalized))E.fail('学期未在系统学期管理中建立');return normalized;}
 function dateCheck(v){const d=E.clean(v);if(!d)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)E.fail('日期应为有效的YYYY-MM-DD');return d;}
  function normalize(raw,type,s,src,actor,fromReport=false){
   const text=k=>E.clean(raw[k]);let sid=text('学号'),student=sid?lookup(s,src).students.get(sid):null;const studentCorrections=[];
   if(sid.length>64)E.fail('学号过长');
   if(!student&&text('姓名')){const matches=src.students.filter(row=>E.clean(row.name)===text('姓名'));if(matches.length===1){student=matches[0];studentCorrections.push({field:'学号',before:sid,after:String(student.id)});sid=String(student.id);}else if(matches.length>1)E.fail('姓名存在多名同名学生，请填写正确学号','STUDENT_NAME_AMBIGUOUS');}
   if(!student)E.fail(sid?'学号不在学生管理中':'学号为空且姓名不能唯一匹配','STUDENT_NOT_FOUND');if(!visible(s,actor,student))throw Object.assign(Error('当前账号无权导入此学生'),{status:403,code:'FORBIDDEN_SCOPE'});
   if(Object.prototype.hasOwnProperty.call(raw,'姓名')&&text('姓名')!==E.clean(student.name))studentCorrections.push({field:'姓名',before:text('姓名'),after:E.clean(student.name)});
   if(fromReport){for(const [field,key] of [['学院','dept'],['专业','major'],['班级','cls'],['年级','grade']]){const value=text(field),actual=E.clean(student[key]);if(value&&actual&&(key==='grade'?value.replace(/级$/,'')!==actual.replace(/级$/,''):value!==actual))studentCorrections.push({field,before:value,after:actual});}}
   if(type==='reference'&&fromReport){const period=termCheck(text('报告学期'),src),reportedFail=Number(text('不及格课程数'));if(!/^\d+$/.test(text('不及格课程数'))||!Number.isSafeInteger(reportedFail))E.fail('不及格课程数应为非负整数');const reportedLevel=text('预警级别');if(reportedLevel&&!E.LEVELS.includes(reportedLevel))E.fail('报告预警级别无法识别');const indicator=field=>{const value=text(field);if(!['','通过','不通过','未通过','待核查'].includes(value))E.fail(field+'应为通过、不通过或空');return value==='未通过'?'不通过':value;};return {kind:'reference',key:JSON.stringify([sid,period]),value:{sid,period,reportedFail,reportedLevel,english:indicator('英语通过情况（通过/不通过）'),computer:indicator('计算机通过情况（通过/不通过）')},studentCorrections};}
  const date=dateCheck(text('考试日期')),batch=text('考试批次');if(!batch)E.fail('请填写考试批次，不能用导入时间替代考试身份');
  if(type==='exam'){
   const value={sid,batch,date,...Exams.normalize(text)},natural=Exams.identity(value),old=lookup(s,src).examNatural.get(natural);
   if(Array.isArray(old))E.fail('同一学生、项目及批次存在多条历史考试记录，请先核查重复批次，不能自动覆盖','EXAM_IDENTITY_AMBIGUOUS');
   for(const [field,key] of [['证书编号','certificate'],['举办单位','organizer'],['等级','grade'],['科目','subject'],['考试日期','date']])if(!Object.hasOwn(raw,field)&&old?.[key]!==undefined)value[key]=old[key];
   for(const [field,key] of Exams.extraFields){if(!Object.hasOwn(raw,field)&&old?.[key]!==undefined)value[key]=old[key];else if(value[key]===undefined&&Object.hasOwn(raw,field))value[key]=['listening','reading','writing'].includes(key)?null:'';}
   Exams.validateParts(value);
    return {kind:'exam',key:old?.key||natural,value,studentCorrections};
  }
  const declaredType=Import.attemptType(raw['成绩阶段']??raw['考试类型']);if(declaredType&&declaredType!==type)E.fail('成绩阶段与当前导入类型不一致，请分别导入正考、补考和重修','ATTEMPT_TYPE_MISMATCH');
  const term=termCheck(Import.term(raw),src),code=text('课程代码'),name=text('课程名称');if(!code&&!name)E.fail('课程代码和课程名称至少填写一项');
  if(type==='retake'&&(!fromReport||text('重修学期')))termCheck(text('重修学期'),src);
  const maps=lookup(s,src);let candidates=(code?maps.codes:maps.names).get(JSON.stringify([sid,term,code||name]))||[];if(!candidates.length&&code&&name)candidates=(maps.names.get(JSON.stringify([sid,term,name]))||[]).filter(c=>!c.code);if(candidates.length>1)E.fail('原课程关联不唯一','SOURCE_COURSE_AMBIGUOUS');
  if(type!=='original'&&!candidates.length)E.fail('找不到原课程，请先导入原修读记录','SOURCE_COURSE_AMBIGUOUS');
  const course=candidates[0];if(type!=='original'&&course&&name&&name!==course.name)E.fail('课程名称与原课程代码对应名称不一致','COURSE_NAME_MISMATCH');const category=text('课程类别')||course?.category||'其他';if(!['必修','限选','选修','其他'].includes(category))E.fail('课程类别应为必修、限选、选修或其他');
  const creditText=text('学分'),credit=creditText===''?(course?.credit??null):Number(creditText);if(credit!==null&&(!Number.isFinite(credit)||credit<0||credit>100))E.fail('学分应为0—100');
  if(!course&&!name)E.fail('新课程必须填写课程名称');
  const score=text(type==='original'?'总评成绩':type==='makeup'?'补考成绩':'重修成绩'),{status,scale}=Import.scoreFields(score,text('考试状态'),text('成绩制'));const assessed=E.result(score,scale,status,s.rules);
  let gpa=text('绩点')===''?null:Number(text('绩点'));if(gpa!==null&&(!Number.isFinite(gpa)||gpa<0||gpa>10))E.fail('绩点应为0—10');
  const metadata={};for(const [field,key] of [['课程性质','nature'],['成绩备注','remark'],['考核方式','assessment'],['教学班号','teachingClass'],['授课教师','teacher'],['开课单位','offeringDept']]){if(text(field)||Object.hasOwn(course||{},key))metadata[key]=text(field)||course?.[key]||'';}if(fromReport&&!course)metadata.coverageKind='failure-list';else if(course?.coverageKind)metadata.coverageKind=fromReport?course.coverageKind:'complete';
  const chosen=course||{id:id(),sid,term,code,name,credit,category,...metadata},parts=Import.components(raw),oldAttempt=lookup(s,src).attemptNatural.get(JSON.stringify([chosen.id,type,batch]));
  if(!Object.hasOwn(raw,'绩点')&&oldAttempt?.status===status&&oldAttempt.scale===scale&&status==='已出分'&&Number.isFinite(oldAttempt.gpa)&&oldAttempt.gpa>=0&&oldAttempt.gpa<=10){let before;try{before=E.result(oldAttempt.score,oldAttempt.scale,oldAttempt.status,s.rules);}catch(error){if(error.status!==422)throw error;before=null;}const sameScore=!!before&&(assessed.score!==null?assessed.score===before.score:assessed.grade?assessed.grade===before.grade:score===oldAttempt.score);if(sameScore)gpa=oldAttempt.gpa;}
  for(const [field,key] of Import.componentFields){if(!Object.hasOwn(raw,field)&&oldAttempt?.[key]!==undefined)parts[key]=oldAttempt[key];else if(Object.hasOwn(raw,field)&&parts[key]===undefined)parts[key]=null;}
   return {kind:'attempt',key:lookup(s,src).attemptNatural.get(JSON.stringify([chosen.id,type,batch]))?.key||JSON.stringify([sid,chosen.id,type,batch]),course:chosen,courseChange:type==='original'?{credit,category,name:name||course?.name,code:code||course?.code,...metadata}:null,value:{courseId:chosen.id,type,batch,date,score,scale,status,gpa,...parts,retakeTerm:type==='retake'&&text('重修学期')?termCheck(text('重修学期'),src):''},studentCorrections};
 }
 function recomputeCases(s,src,term,selection,allowedIds){const summary=E.summarize(s,src.students,term,{...selection,availableTerms:src.terms});if(!s.rules)return summary;
  const current=new Map(s.cases.filter(x=>(x.selection?x.selection.key===summary.selection.key:x.period===term&&x.scope===summary.selection.scope&&x.stage===summary.selection.stage)&&!['已归档','已解除'].includes(x.status)).map(c=>[c.sid,c]));
  for(const row of summary.rows){if(allowedIds&&!allowedIds.has(row.sid))continue;let c=current.get(row.sid);
   if(!c&&row.level){c={id:id(),sid:row.sid,period:summary.selection.end,scope:summary.selection.scope,stage:summary.selection.stage,selection:selection?summary.selection:undefined,status:'待复核',confirmedLevel:'',events:[]};s.cases.push(c);}
   if(!c)continue;if(selection)c.selection=summary.selection;const next={level:row.level,known:row.warningKnown,fail:row.fail,failCredit:row.failCredit,pending:row.pending,missingTerms:row.missingTerms,reasons:row.reasons};
   if(hash(c.computed)!==hash(next)){c.events.push({time:stamp(),action:'计算更新',before:c.computed||null,after:next,ruleVersion:s.rules.version});c.computed=next;
    if(c.confirmedLevel&&row.warningKnown){if(!row.level)c.status='待解除复核';else if(c.confirmedLevel!==row.level)c.status='等级变更待复核';}
   }
  }return summary;
 }
 function recomputeAll(s,src){for(const term of new Set(s.courses.map(c=>c.term).concat(s.cases.filter(c=>!c.selection).map(c=>c.period))))recomputeCases(s,src,term);const contexts=new Map(s.cases.filter(c=>c.selection).map(c=>[c.selection.key,c.selection]));for(const selection of contexts.values())recomputeCases(s,src,selection.end,selection);}
 function validateCaseContext(s,c){if(!s.rules||(!c.selection&&(c.scope!==s.rules.scope||c.stage!==s.rules.stage)))E.fail('预警统计口径已变更，请使用当前规则生成的个案','CASE_RULE_CHANGED');}
 function refreshCase(s,c){validateCaseContext(s,c);recomputeCases(s,source(),c.period,c.selection);}
 function statisticSelection(s,query){
  if(query.scope===undefined&&query.terms===undefined&&query.stage===undefined)return undefined;
  let terms=query.terms;if(typeof terms==='string'){try{terms=JSON.parse(terms);}catch{E.fail('所选学期格式无效');}}
  if(query.scope!==undefined&&!['term','multi','year','all'].includes(query.scope))E.fail('统计范围无效');
  const selected=E.selectionFor(s,query.term||'',{scope:query.scope,terms,stage:query.stage});
  const available=new Set(source().terms.concat(s.courses.map(c=>c.term)));
  if(selected.terms.some(t=>!available.has(t))||(query.term&&!available.has(query.term)))E.fail('统计学期未在系统学期管理中建立');
  return selected;
 }
 function summaries(s,query){const src=source();return E.summarize(s,src.students,query.term||'',{...statisticSelection(s,query),availableTerms:src.terms});}
 function caseMatches(c,selection){return c.selection?c.selection.key===selection.key:c.scope===selection.scope&&c.stage===selection.stage&&c.period===selection.end;}
 const caseActions={confirm:'已确认',follow:'跟进中',release:'已解除',archive:'已归档'};
 function validateCaseAction(c,action){
  if(!Object.hasOwn(caseActions,action))E.fail('操作无效');
  if(action==='confirm'&&(!c.computed?.level||!c.computed.known))E.fail('成绩不完整或未触发预警，不能正式确认');
  if(action==='release'&&(!c.computed?.known||c.computed.level))E.fail('尚未具备解除条件');
  if(action==='archive'&&c.status!=='已解除')E.fail('请先完成复核办理再归档');
  if(c.status==='已归档'||(c.status==='已解除'&&action!=='archive'))E.fail('该个案已结束，不能再次办理');
  if(action==='follow'&&(!c.confirmedLevel||!c.computed?.level))E.fail('请先复核并确认预警等级');
 }
 function applyCaseAction(c,action,reason,actor,batchId){const before=c.status;c.status=caseActions[action];if(action==='confirm')c.confirmedLevel=c.computed.level;c.events.push({action,time:stamp(),actor:actor.uid,reason,before,after:c.status,...(batchId?{batchId}:{})});}
 function analyze(s,sum,rows,query){return {...Analysis.build(rows,query,sum.selection),termStats:Analysis.termStats(s,source().students,sum.selection,new Set(rows.map(r=>r.sid)))};}
 // Each request loads a fresh records array; classify all identities before filtering/exporting a subset.
 const examReadCaches=new WeakMap();
 function examView(x,r,records){let cache=examReadCaches.get(records);if(!cache||cache.rules!==r){cache={rules:r,byId:new Map(Exams.views(records,r).map(row=>[row.id,row]))};examReadCaches.set(records,cache);}return cache.byId.get(x.id)||Exams.view(x,r);}
 function filterExams(records,query){
  const fields={examType:'type',examProvince:'province',examBatch:'batch',examResult:'result',examDocument:'documentStatus'},groups={};
  for(const key of Object.keys(fields)){const value=query[key];if(value===undefined||value==='')groups[key]=[];else if(typeof value==='string'&&value.length<=2000)groups[key]=[value];else if(Array.isArray(value)&&value.length<=20000&&value.every(x=>typeof x==='string'&&x.length<=2000))groups[key]=value;else E.fail('考证筛选条件格式无效：'+key);}
  if(groups.examType.some(x=>!Exams.types.includes(x)))E.fail('考证类型筛选无效');
  if(groups.examResult.some(x=>!['已达标','未达标','待核查','待出分','缺考，待核查','分数与官方结果冲突，待复核','考试身份重复，待核查','成绩数据异常，待核查'].includes(x))||groups.examDocument.some(x=>!['未提供','已提供，未核验'].includes(x)))E.fail('考证结果或材料状态筛选无效');
  return records.filter(row=>Object.entries(fields).every(([key,field])=>!groups[key].length||groups[key].includes(String(row[field]??''))));
 }

 function filterRows(rows,query,cases=[]){
  const groups={};for(const key of ['cls','major','dept','grade','level','status','caseStatus']){
   const value=query[key];if(value===undefined||value==='')groups[key]=[];
   else if(typeof value==='string')groups[key]=[value];
   else if(Array.isArray(value)&&value.length<=20000&&value.every(v=>typeof v==='string'&&v.length<=200))groups[key]=value;
   else E.fail('筛选条件格式无效：'+key);
  }
  const matches=(key,value)=>!groups[key].length||groups[key].includes(String(value??''));
  groups.status=groups.status.map(normalizedStatus);
  return rows.filter(r=>['cls','major','dept','grade','level'].every(key=>matches(key,r[key]))&&matches('status',normalizedStatus(r.status))&&(!groups.caseStatus.length||cases.some(c=>c.sid===r.sid&&matches('caseStatus',c.status)))&&(!query.keyword||[r.sid,r.name].some(v=>String(v).includes(query.keyword)))).sort(compareStudents);
 }
 function integritySnapshot(s){
  const studentIds=new Set(source().students.map(row=>String(row.id))),courseStudent=new Map(s.courses.map(row=>[String(row.id),String(row.sid)])),datasets=[];
  const add=(label,rows,sidOf)=>{const missing=rows.map(row=>String(sidOf(row)||'')).filter(sid=>sid&&!studentIds.has(sid));if(missing.length)datasets.push({label,count:missing.length,samples:[...new Set(missing)].slice(0,5)});};
  add('学业情况（公用版）课程成绩',s.courses,row=>row.sid);
  add('学业情况（公用版）考试记录',s.exams,row=>row.sid);
  add('学业情况（公用版）预警个案',s.cases,row=>row.sid);
  add('学业情况（公用版）报告参考',s.reportReferences||[],row=>row.sid);
  add('学业情况（公用版）成绩明细',s.attempts,row=>courseStudent.get(String(row.courseId))||'');
  for(const publication of s.publications||[])add('学业情况（公用版）正式排名',Array.isArray(publication.rows)?publication.rows:[],row=>row.sid);
  const warningRuns=db().prepare('SELECT id,payload FROM academic_public_warning_runs').all().map(row=>({id:row.id,run:decode(row.payload)}));
  for(const item of warningRuns)add('学业情况（公用版）预警统计记录',Array.isArray(item.run.rows)?item.run.rows:[],row=>row.sid);
  const merged=new Map();for(const item of datasets){const current=merged.get(item.label)||{label:item.label,count:0,samples:[]};current.count+=item.count;current.samples=[...new Set(current.samples.concat(item.samples))].slice(0,5);merged.set(item.label,current);}
  const list=[...merged.values()];return {version:s.version,total:list.reduce((sum,item)=>sum+item.count,0),datasets:list,studentIds,warningRuns};
 }
 function integrityPrune(s){
  const scan=integritySnapshot(s),valid=scan.studentIds,orphanCourseIds=new Set(s.courses.filter(row=>!valid.has(String(row.sid))).map(row=>String(row.id))),keptCourses=s.courses.filter(row=>valid.has(String(row.sid))),caseIds=new Set(s.cases.filter(row=>valid.has(String(row.sid))).map(row=>String(row.id)));
  s.courses=keptCourses;s.attempts=s.attempts.filter(row=>!orphanCourseIds.has(String(row.courseId)));s.exams=s.exams.filter(row=>valid.has(String(row.sid)));s.cases=s.cases.filter(row=>valid.has(String(row.sid)));s.reportReferences=(s.reportReferences||[]).filter(row=>valid.has(String(row.sid)));
  s.publications=(s.publications||[]).map(publication=>({...publication,rows:(Array.isArray(publication.rows)?publication.rows:[]).filter(row=>valid.has(String(row.sid)))}));
  for(const item of scan.warningRuns){const run=item.run,originalRows=Array.isArray(run.rows)?run.rows:[],rows=originalRows.filter(row=>valid.has(String(row.sid)));if(rows.length===originalRows.length)continue;if(!rows.length){db().prepare('DELETE FROM academic_public_warning_runs WHERE id=?').run(item.id);continue;}run.rows=rows;run.caseIds=(Array.isArray(run.caseIds)?run.caseIds:[]).filter(value=>caseIds.has(String(value)));run.counts={...(run.counts||{}),students:rows.length,warnings:rows.filter(row=>row.level).length,pending:rows.filter(row=>!row.warningKnown).length};db().prepare('UPDATE academic_public_warning_runs SET payload=? WHERE id=?').run(encode(run),item.id);}
  if(scan.total)save(s);return {removed:scan.total,version:s.version,datasets:scan.datasets};
 }
 async function handle(request,response,url,actor){init();const route=url.pathname.slice('/api/academic-public'.length),method=request.method;let s=load(),body;
  const json=(status,v)=>deps.json(response,status,v);
  try{
   if(method==='POST'&&route==='/files'){
    permission(s,actor,'import');const name=E.clean(url.searchParams.get('name'));if(name.length>200)E.fail('文件名过长');const bytes=await deps.buffer(request,10*1024*1024);
    let parsed;try{parsed=await Files.parseFile(bytes,name,url.searchParams.get('encoding'));}catch(e){E.fail(e.message,'FILE_PARSE_FAILED');}
    deps.assert(request);s=load();permission(s,actor,'import');const fileId=artifact('file',actor,{...parsed,name});return json(201,{fileId,name,sheets:parsed.sheets.map(x=>({name:x.name,count:x.rows.length,sample:x.rows.slice(0,50),recommendations:Object.fromEntries(['original','makeup','retake','exam'].map(type=>[type,Import.suggest(x,fields[type])]))})),fields});
   }
   if(method==='GET'&&route==='/state'){
    const people=accessible(s,actor),all=summaries(s,Object.fromEntries(url.searchParams)),ids=new Set(people.map(x=>String(x.id))),rows=all.rows.filter(x=>ids.has(x.sid)).sort(compareStudents);
    return json(200,{version:s.version,selection:all.selection,defaultTerm:[...new Set(s.courses.map(c=>c.term))].sort().reverse()[0]||source().terms.slice().sort().reverse()[0]||'',rules:s.rules,rows,exams:s.exams.filter(x=>ids.has(x.sid)).map(x=>examView(x,s.rules,s.exams)),cases:s.cases.filter(x=>ids.has(x.sid)),publications:s.publications.filter(x=>admin(actor)||x.classes.every(c=>s.acl[actor.uid]?.classes.includes(c))).map(({rows,...p})=>p),permissions:admin(actor)?{import:true,export:true,review:true,admin:true}:s.acl[actor.uid],terms:[...new Set(source().terms.concat(s.courses.map(c=>c.term)))].sort().reverse(),dataTerms:[...new Set(s.courses.filter(c=>ids.has(c.sid)).map(c=>c.term))].sort().reverse(),fields});
   }
    if(method==='GET'&&route==='/integrity'){if(!admin(actor))throw Object.assign(Error('仅管理员可检查学生关联数据'),{status:403});const scan=integritySnapshot(s);return json(200,{version:scan.version,total:scan.total,datasets:scan.datasets});}
   if(method==='GET'&&route==='/batches'){permission(s,actor,'view');return json(200,{batches:db().prepare('SELECT payload FROM academic_public_batches ORDER BY created DESC LIMIT 100').all().map(r=>decode(r.payload)).filter(b=>admin(actor)||b.actor===actor.uid).map(({changes,errors,...b})=>({...b,errorCount:errors?.length||0}))});}
   if(method==='GET'&&route==='/access'){if(!admin(actor))throw Object.assign(Error('仅管理员可设置授权'),{status:403});return json(200,{version:s.version,accounts:deps.accounts(),acl:s.acl,classes:[...new Set(source().students.map(x=>x.cls).filter(Boolean))]});}
   if(method==='GET'&&route==='/templates'){
    permission(s,actor,'view');const type=url.searchParams.get('type');
    if(type==='report')return deps.download(response,Files.workbook(reportImportTemplate()),'学业情况（公用版）_学业预警报告导入模板.xlsx');
    if(!Object.hasOwn(fields,type))E.fail('模板类型无效');
    return deps.download(response,Files.workbook({'数据':[fields[type],templateExampleRow(fields[type],type)]}),`学业情况（公用版）_${{original:'课程成绩',makeup:'补考成绩',retake:'重修成绩',exam:'等级考试'}[type]}导入模板.xlsx`);
   }
   body=method==='GET'?Object.fromEntries(url.searchParams):await deps.read(request);deps.assert(request);s=load();if(!body||typeof body!=='object'||Array.isArray(body))E.fail('请求必须为对象');
    if(method==='POST'&&route==='/integrity'){if(!admin(actor))throw Object.assign(Error('仅管理员可清理学生关联数据'),{status:403});if(body.action!=='delete')E.fail('处理方式无效');guard(s,body.version);const result=txn(()=>integrityPrune(s));return json(200,result);}
   if(method==='POST'&&route==='/exam-analysis'){
    const people=accessible(s,actor),ids=new Set(people.map(x=>String(x.id)));guard(s,body.version);const summary=summaries(s,body),students=filterRows(summary.rows.filter(r=>ids.has(r.sid)),body,s.cases.filter(c=>caseMatches(c,summary.selection))),chosen=new Set(students.map(r=>r.sid));
    const positions=new Map(students.map((r,i)=>[r.sid,i])),records=filterExams(s.exams.filter(x=>chosen.has(x.sid)).map(x=>examView(x,s.rules,s.exams)),body).sort((a,b)=>positions.get(a.sid)-positions.get(b.sid));return json(200,{version:s.version,records,statistics:Exams.statistics(records),students:students.length,recordedStudents:new Set(records.map(x=>x.sid)).size});
   }
   if(method==='POST'&&route==='/warning-runs'){
    const people=accessible(s,actor,'review'),authorized=new Set(people.map(x=>String(x.id)));guard(s,body.version);if(!s.rules)E.fail('请先配置并启用学校预警规则');
    const selection=statisticSelection(s,body)||E.selectionFor(s,body.term||''),preview=summaries(s,body),chosen=filterRows(preview.rows.filter(r=>authorized.has(r.sid)),body,s.cases.filter(c=>caseMatches(c,preview.selection))),allowed=new Set(chosen.map(r=>r.sid));
    const summary=recomputeCases(s,source(),selection.end,selection,allowed);
    const rows=summary.rows.filter(r=>allowed.has(r.sid)).sort(compareStudents).map(({details,...row})=>row);
    const run={id:id(),actor:actor.uid,created:stamp(),selection:summary.selection,filters:Object.fromEntries(['cls','dept','major','grade','status','level','caseStatus','keyword'].filter(k=>body[k]).map(k=>[k,body[k]])),rules:structuredClone(s.rules),ruleVersion:s.rules.version,dataVersion:s.version+1,rows,counts:{students:rows.length,warnings:rows.filter(r=>r.level).length,pending:rows.filter(r=>!r.warningKnown).length},caseIds:s.cases.filter(c=>allowed.has(c.sid)&&caseMatches(c,summary.selection)&&c.status!=='已归档').map(c=>c.id)};
    txn(()=>{save(s);db().prepare('INSERT INTO academic_public_warning_runs VALUES(?,?,?,?,?,?)').run(run.id,actor.uid,run.created,summary.selection.key,run.dataVersion,encode(run));});
    return json(201,{id:run.id,version:s.version,selection:run.selection,counts:run.counts,caseCount:run.caseIds.length});
   }
   if(method==='GET'&&route==='/warning-runs'){
    const allowed=new Set(accessible(s,actor).map(x=>String(x.id)));
    if(body.id){const record=db().prepare('SELECT payload FROM academic_public_warning_runs WHERE id=?').get(body.id);if(!record)throw Object.assign(Error('统计记录不存在'),{status:404});const run=decode(record.payload);if(run.rows.some(r=>!allowed.has(r.sid)))throw Object.assign(Error('统计记录包含当前未授权的学生'),{status:403,code:'FORBIDDEN_SCOPE'});return json(200,{run});}
    const runs=db().prepare('SELECT payload FROM academic_public_warning_runs ORDER BY created DESC LIMIT 100').all().map(r=>decode(r.payload)).filter(r=>r.rows.every(row=>allowed.has(row.sid))).map(({rows,caseIds,...run})=>({...run,caseCount:caseIds.length}));return json(200,{runs});
   }
   if(method==='GET'&&route==='/student'){
    const people=accessible(s,actor),student=people.find(x=>String(x.id)===body.sid);if(!student)throw Object.assign(Error('学生不存在或没有公用版查看权限'),{status:403,code:'FORBIDDEN_SCOPE'});const all=source().students,terms=[...new Set(s.courses.filter(c=>c.sid===body.sid).map(c=>c.term))].sort().reverse();return json(200,{rows:terms.map(term=>({...E.summarize(s,all,term).rows.find(r=>r.sid===body.sid),period:term})),exams:s.exams.filter(x=>x.sid===body.sid).map(x=>examView(x,s.rules,s.exams)),cases:s.cases.filter(x=>x.sid===body.sid),version:s.version,rules:s.rules});
   }
   if(method==='PUT'&&route==='/access'){
    if(!admin(actor))throw Object.assign(Error('仅管理员可设置授权'),{status:403});guard(s,body.version);const account=deps.accounts().find(x=>x.id===body.uid);if(!account)E.fail('账号不存在');
    if(!Array.isArray(body.classes)||body.classes.some(c=>!source().students.some(x=>x.cls===c)))E.fail('班级范围无效');const acl={classes:body.classes,view:body.view===true,import:body.import===true,export:body.export===true,review:body.review===true};if(account.role==='viewer'&&(acl.import||acl.review))E.fail('只读账号不可授予写入权限');s.acl[body.uid]=acl;txn(()=>save(s));return json(200,{version:s.version});
   }
   if(method==='POST'&&route==='/rule-preview'){
    if(!admin(actor))throw Object.assign(Error('仅管理员可设置规则'),{status:403});guard(s,body.version);const rules=E.validateRules(body.rules);const people=source().students,terms=[...new Set(s.courses.map(x=>x.term))];let changes=[];for(const term of terms){const before=E.summarize(s,people,term),after=E.summarize({...s,rules},people,term);after.rows.forEach((r,i)=>{if(r.level!==before.rows[i].level)changes.push({sid:r.sid,name:r.name,term,before:before.rows[i].level||'未触发',after:r.level||'未触发'});});}const contexts=new Map(s.cases.filter(c=>c.selection).map(c=>[c.selection.key,c.selection]));const selected=statisticSelection(s,body);if(selected)contexts.set(selected.key,selected);for(const context of contexts.values()){const before=summaries(s,{term:context.end,...context}),after=summaries({...s,rules},{term:context.end,...context});after.rows.forEach((row,i)=>{if(row.level!==before.rows[i].level)changes.push({sid:row.sid,name:row.name,term:context.label+'：'+context.terms.join('、'),before:before.rows[i].level||'未触发',after:row.level||'未触发'});});}const previewId=artifact('rule',actor,{version:s.version,rules,source:source().fingerprint});return json(200,{previewId,changes});
   }
   if(method==='PUT'&&route==='/rules'){
    if(!admin(actor))throw Object.assign(Error('仅管理员可启用规则'),{status:403});const p=getArtifact(body.previewId,'rule',actor);guard(s,p.version);if(p.source!==source().fingerprint)throw Object.assign(Error('学生信息已变化，请重新预览'),{status:409,code:'PREVIEW_STALE'});if(s.rules)s.ruleHistory.push(s.rules);s.rules={...E.warningRules(p.rules),version:s.version+1,created:stamp(),actor:actor.uid};const src=source();recomputeAll(s,src);txn(()=>save(s));return json(200,{version:s.version});
   }
   if(method==='POST'&&route==='/previews'){
    permission(s,actor,'import');if(body.mode!==undefined&&!['add','merge'].includes(body.mode))E.fail('导入模式无效');const type=body.type;if(!Object.hasOwn(fields,type))E.fail('导入类型无效');const src=source();let rawRows=body.rows,reportInfo=null;
    if(body.editId!==undefined){if(typeof body.editId!=='string'||body.mode!=='merge'||!Array.isArray(rawRows)||rawRows.length!==1||typeof body.editReason!=='string'||!E.clean(body.editReason)||body.editReason.length>500)E.fail('单条修订须提供记录、修订原因和一行数据');if(!['original','makeup','retake','exam'].includes(type))E.fail('此类型不支持单条修订');const record=(type==='exam'?s.exams:s.attempts).find(x=>x.id===body.editId);const sid=type==='exam'?record?.sid:s.courses.find(c=>c.id===record?.courseId)?.sid;if(!record||(type!=='exam'&&record.type!==type)||!src.students.some(x=>String(x.id)===sid&&visible(s,actor,x)))throw Object.assign(Error('记录不存在或没有修订权限'),{status:403});body.name='手工修订：'+E.clean(body.editReason);}
    if(type==='report'){if(!body.fileId)E.fail('预警报告必须上传包含5个工作表的Excel文件');const result=Report.read(getArtifact(body.fileId,'file',actor),termCheck(body.reportTerm,src));rawRows=result.rows;reportInfo=result.info;}
    else if(body.fileId){const file=getArtifact(body.fileId,'file',actor),sheet=file.sheets.find(x=>x.name===body.sheet),header=Number(body.headerRow||1);if(!sheet||!Number.isSafeInteger(header)||header<1||header>50)E.fail('工作表或表头行无效');const mapping=body.mapping;if(!mapping||typeof mapping!=='object')E.fail('请映射字段');const missingIdentity=['学号','姓名'].filter(field=>mapping[field]===null||mapping[field]===''||mapping[field]===undefined);if(missingIdentity.length)E.fail('导入时必须同时映射学号和姓名，并核验两项指向同一名学生','STUDENT_IDENTITY_MAPPING_REQUIRED');const indices=Object.values(mapping).filter(x=>x!==null&&x!==''&&x!==undefined);if(new Set(indices).size!==indices.length)E.fail('同一列不能重复映射','HEADER_AMBIGUOUS');
     rawRows=sheet.rows.slice(header).map(row=>{const out={_row:row.sourceRow,_sheet:sheet.name,_issues:[]};for(const field of fields[type]){const i=mapping[field];if(i===null||i===''||i===undefined)continue;if(!Number.isSafeInteger(i)||i<0||i>80)E.fail('映射列无效');const c=row.cells[i]||{};out[field]=c.value||'';if(c.missingFormula)out._issues.push(field+'公式没有缓存结果，请粘贴为值');if(['学号','准考证号','证书编号','教学班号','课程代码'].includes(field)&&c.precisionLost)out._issues.push(field+'精度可能丢失，请重新提供文本编号');}return out;}).filter(row=>fields[type].some(f=>E.clean(row[f])));
    }
    if(!Array.isArray(rawRows)||!rawRows.length||rawRows.length>20000)E.fail('请选择1—20,000行有效数据','IMPORT_LIMIT_EXCEEDED');
    if(body.batch!==undefined&&(typeof body.batch!=='string'||body.batch.length>200))E.fail('默认考试批次无效');
    if(type!=='report'&&E.clean(body.batch))rawRows=rawRows.map(raw=>raw&&typeof raw==='object'?{...raw,'考试批次':E.clean(raw['考试批次'])||E.clean(body.batch)}:raw);
    const errors=[],ok=[],seen=new Map(),courseSeen=new Map(),courseConflicts=new Set(),virtual=structuredClone(s),mode=body.mode==='add'?'add':'merge';
    rawRows.forEach((raw,i)=>{try{if(!raw||typeof raw!=='object'||Object.values(raw).some(v=>typeof v==='string'&&v.length>2000))E.fail('行内容无效');if(Array.isArray(raw)||fields[type].some(field=>raw[field]!==null&&raw[field]!==undefined&&(typeof raw[field]!=='string'&&(typeof raw[field]!=='number'||!Number.isFinite(raw[field])))))E.fail('字段内容应为文本或有限数值，不能使用对象或数组','CELL_INVALID');if(raw._issues?.length)E.fail(raw._issues.join('；'),'CELL_INVALID');const n=normalize(raw,type==='report'?raw._importType:type,virtual,src,actor,type==='report'),target=virtual[n.kind==='reference'?'reportReferences':n.kind==='exam'?'exams':'attempts'];let existing=lookup(virtual,src)[n.kind+'ByKey'].get(n.key);if(body.editId!==undefined&&existing?.id!==body.editId)E.fail('修订不能改变学号、课程、考试类型、批次、省份或举办单位等考试身份');if(body.editId!==undefined&&n.courseChange&&(n.courseChange.code!==n.course.code||n.courseChange.name!==n.course.name))E.fail('单条修订不能改变课程代码或名称；请核对原课程');
      if(n.courseChange){const signature=hash(n.courseChange),previous=courseSeen.get(n.course.id);if(previous&&previous!==signature)courseConflicts.add(n.course.id);else courseSeen.set(n.course.id,signature);}
      if(seen.has(n.key)){if(hash(n.value)!==seen.get(n.key))throw Object.assign(Error('文件内同一考试记录存在不同结果'),{status:422,code:'ATTEMPT_CONFLICT',recordKey:n.key});ok.push({raw,n,action:'duplicate'});return;}
      seen.set(n.key,hash(n.value));if(n.kind==='attempt'){n.value.courseId=n.course.id;if(!lookup(virtual,src).courseById.has(n.course.id)){virtual.courses.push(n.course);indexCourse(virtual,n.course);}}
      const same=existing&&Object.keys(n.value).every(k=>existing[k]===n.value[k]||(existing[k]==null&&n.value[k]==null));const courseSame=!n.courseChange||Object.keys(n.courseChange).every(k=>n.course[k]===n.courseChange[k]);const action=existing?(same&&courseSame?'duplicate':mode==='add'?'skipped':'revise'):'create';ok.push({raw,n,action});if(!existing){const record={...n.value,key:n.key,id:id()};target.push(record);indexRecord(virtual,record,n.kind);}
     }catch(e){errors.push({row:raw?._row||i+2,sheet:raw?._sheet||body.sheet||'数据',code:e.code||'VALIDATION_ERROR',key:e.recordKey,message:e.message,raw});}});
    // A conflicting pair must block both rows, not silently commit the first value.
    const conflicting=new Set(errors.filter(e=>e.code==='ATTEMPT_CONFLICT').map(e=>e.key));for(const x of ok)if(courseConflicts.has(x.n.course?.id))conflicting.add(x.n.key);const valid=ok.filter(x=>!conflicting.has(x.n.key));for(const row of ok.filter(x=>conflicting.has(x.n.key)))errors.push({row:row.raw._row||rawRows.indexOf(row.raw)+2,sheet:row.raw._sheet||'数据',code:'ATTEMPT_CONFLICT',message:'同一考试记录存在冲突，必须修正后导入',raw:row.raw});
    const counts={read:rawRows.length,valid:valid.length,errors:errors.length,created:valid.filter(x=>x.action==='create').length,revised:valid.filter(x=>x.action==='revise').length,duplicates:valid.filter(x=>x.action==='duplicate').length,skipped:valid.filter(x=>x.action==='skipped').length};
    const studentCorrections=valid.flatMap(item=>(item.n.studentCorrections||[]).map(change=>({...change,row:item.raw._row||rawRows.indexOf(item.raw)+2,sid:item.n.kind==='exam'?item.n.value.sid:item.n.course?.sid||item.n.value.sid||''})));
    const previewId=artifact('preview',actor,{version:s.version,source:src.fingerprint,type,mode,ok:valid,errors,counts,studentCorrections,name:E.clean(body.name||'成绩导入'),created:stamp(),report:reportInfo});return json(200,{previewId,version:s.version,counts,report:reportInfo,studentCorrections,errors:errors.slice(0,100),sample:valid.slice(0,30).map(x=>({row:x.raw._row,action:x.action,raw:{...x.raw,...(x.n.kind==='attempt'?{'识别学期':x.n.course.term,'识别成绩制':x.n.value.scale,'识别考试状态':x.n.value.status}:{})}})),fields:fields[type]});
   }
   if(method==='POST'&&route==='/commits'){
    permission(s,actor,'import');const key=E.clean(request.headers['idempotency-key']);if(!/^[a-f0-9-]{36}$/i.test(key))E.fail('提交标识无效');const previous=db().prepare('SELECT payload FROM academic_public_batches WHERE id=?').get(key),digest=hash(body);if(previous){const b=decode(previous.payload);if(b.actor!==actor.uid||b.digest!==digest)throw Object.assign(Error('提交标识已用于不同请求'),{status:409,code:'IDEMPOTENCY_CONFLICT'});return json(200,{batchId:b.id,counts:b.counts,state:b.state,version:s.version});}
    const p=getArtifact(body.previewId,'preview',actor);guard(s,p.version);const src=source();if(src.fingerprint!==p.source)throw Object.assign(Error('学生或学期信息已变化，请重新预览'),{status:409,code:'PREVIEW_STALE'});if((p.studentCorrections||[]).length&&body.acceptStudentCorrections!==true)E.fail('请先确认按学生管理修正学生基本信息','STUDENT_CORRECTION_CONFIRMATION_REQUIRED');if(p.errors.length&&body.acceptValid!==true)E.fail('存在错误行，请明确选择仅提交有效行');if(!p.ok.length)E.fail('没有可以提交的行');
    const changes=[],terms=new Set();for(const item of p.ok){normalize(item.raw,p.type==='report'?item.raw._importType:p.type,s,src,actor,p.type==='report');if(!['create','revise'].includes(item.action))continue;const n=item.n;
     if(n.kind==='attempt'){const c=lookup(s,src).courseById.get(n.course.id),next=c?{...c,...n.courseChange}:{...n.course};if(!c||hash(c)!==hash(next)){changes.push({collection:'courses',before:c?structuredClone(c):null,after:structuredClone(next)});if(c){const before={...c};Object.assign(c,next);indexCourse(s,c,before);}else{s.courses.push(next);indexCourse(s,next);}}terms.add(n.course.term);}
     const collection=n.kind==='reference'?'reportReferences':n.kind==='exam'?'exams':'attempts',old=lookup(s,src)[n.kind+'ByKey'].get(n.key),next={...n.value,key:n.key,id:old?.id||id(),order:old?.order||Date.now()+changes.length,updated:stamp(),batchId:key,revisions:old?[...(old.revisions||[]),Object.fromEntries(Object.entries(old).filter(([key])=>key!=='revisions'))]:[]};
     changes.push({collection,before:old?structuredClone(old):null,after:structuredClone(next)});if(old){Object.assign(old,next);indexRecord(s,old,n.kind);}else{s[collection].push(next);indexRecord(s,next,n.kind);}
    }
    const batch={id:key,actor:actor.uid,name:p.name,type:p.type,report:p.report,created:stamp(),state:'已完成',counts:p.counts,changes,errors:p.errors,digest};
    recomputeAll(s,src);
    txn(()=>{save(s);db().prepare('INSERT INTO academic_public_batches VALUES(?,?,?,?)').run(key,actor.uid,stamp(),encode(batch));});return json(200,{batchId:key,counts:p.counts,state:'已完成',version:s.version});
   }
   if(method==='POST'&&route==='/reversals'){
    permission(s,actor,'import');guard(s,body.version);const row=db().prepare('SELECT payload FROM academic_public_batches WHERE id=?').get(body.batchId);if(!row)E.fail('批次不存在');const batch=decode(row.payload),changes=effectiveChanges(batch.changes);if(!admin(actor)&&batch.actor!==actor.uid)throw Object.assign(Error('只能撤销自己的批次'),{status:403});if(batch.state==='已撤销')E.fail('批次已经撤销');if(!E.clean(body.reason))E.fail('请填写撤销原因');
    const allowed=new Set(accessible(s,actor,'import').map(x=>String(x.id)));if(changes.some(c=>{const sid=c.after.sid||s.courses.find(x=>x.id===c.after.courseId)?.sid;return !allowed.has(sid);}))throw Object.assign(Error('本批次包含当前无权操作的学生，不能撤销'),{status:403,code:'FORBIDDEN_SCOPE'});
    for(const change of changes){const current=s[change.collection].find(x=>x.id===change.after.id);if(hash(current)!==hash(change.after))throw Object.assign(Error('本批次记录存在后续修订，不能直接撤销'),{status:409,code:'ROLLBACK_DEPENDENCY_CONFLICT'});if(change.collection==='courses'&&!change.before&&s.attempts.some(a=>a.courseId===current.id&&a.batchId!==batch.id))throw Object.assign(Error('课程已有后续补考或重修，不能直接撤销'),{status:409,code:'ROLLBACK_DEPENDENCY_CONFLICT'});}
    for(const change of changes.slice().reverse()){const list=s[change.collection],index=list.findIndex(x=>x.id===change.after.id);if(change.before)list[index]=change.before;else list.splice(index,1);}
    const src=source();recomputeAll(s,src);batch.state='已撤销';batch.reversal={actor:actor.uid,time:stamp(),reason:body.reason};txn(()=>{save(s);db().prepare('UPDATE academic_public_batches SET payload=? WHERE id=?').run(encode(batch),batch.id);});return json(200,{version:s.version});
   }
   if(method==='POST'&&route==='/case-support'){
    const people=accessible(s,actor,'review');guard(s,body.version);const c=s.cases.find(x=>x.id===body.id);if(!c||!people.some(x=>String(x.id)===c.sid))throw Object.assign(Error('个案不存在或无权操作'),{status:403});if(['已归档','已解除'].includes(c.status))E.fail('该个案已结束，帮扶档案只供查阅');refreshCase(s,c);
    const input=body.support;if(!input||typeof input!=='object'||Array.isArray(input))E.fail('请填写帮扶档案');const limits={owner:100,plan:2000,note:2000};for(const [key,max] of Object.entries(limits))if(typeof input[key]!=='string'||E.clean(input[key]).length>max)E.fail('帮扶字段无效或超长：'+key);if(!E.clean(input.owner)||!E.clean(input.plan))E.fail('请填写帮扶责任人和方案');for(const key of ['studentNotified','parentNotified'])if(typeof input[key]!=='boolean')E.fail('告知记录必须为勾选状态');if(input.nextDate!==undefined&&typeof input.nextDate!=='string')E.fail('跟进日期无效');
    const before=c.support?structuredClone(c.support):null;c.support={owner:E.clean(input.owner),plan:E.clean(input.plan),note:E.clean(input.note),nextDate:dateCheck(input.nextDate),studentNotified:input.studentNotified,parentNotified:input.parentNotified,updated:stamp(),actor:actor.uid};c.events.push({action:'support',actor:actor.uid,time:stamp(),before,after:structuredClone(c.support),reason:c.support.note||'保存帮扶档案'});txn(()=>save(s));return json(200,{version:s.version});
   }
   if(method==='POST'&&route==='/case-actions'){
    const people=accessible(s,actor,'review'),c=s.cases.find(x=>x.id===body.id);guard(s,body.version);if(!c||!people.some(x=>String(x.id)===c.sid))throw Object.assign(Error('个案不存在或无权操作'),{status:403});refreshCase(s,c);if(typeof body.reason!=='string'||!E.clean(body.reason)||E.clean(body.reason).length>2000)E.fail('请填写不超过2000字的办理说明');validateCaseAction(c,body.action);applyCaseAction(c,body.action,body.reason,actor);txn(()=>save(s));return json(200,{version:s.version});
   }
   if(method==='POST'&&route==='/case-action-previews'){
    const people=accessible(s,actor,'review'),allowed=new Map(people.map(x=>[String(x.id),x]));guard(s,body.version);
    if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>1000||body.ids.some(x=>typeof x!=='string')||new Set(body.ids).size!==body.ids.length)E.fail('请选择1—1000名不同的学生');
    if(body.ids.some(x=>!allowed.has(x)))throw Object.assign(Error('所选学生不存在或无权办理'),{status:403,code:'FORBIDDEN_SCOPE'});
    if(!Object.hasOwn(caseActions,body.action))E.fail('操作无效');if(typeof body.reason!=='string'||!E.clean(body.reason)||body.reason.length>2000)E.fail('请填写不超过2000字的办理说明');
    const src=source(),selection=summaries(s,body).selection,legacyContexts=new Map(s.cases.filter(c=>!c.selection).map(c=>[c.id,{scope:c.scope,stage:c.stage}]));recomputeCases(s,src,selection.end,selection,new Set(body.ids));
    const eligible=[],blocked=[];
    for(const sid of body.ids){const student=allowed.get(sid),cases=s.cases.filter(c=>c.sid===sid&&caseMatches(c,selection)&&c.status!=='已归档'),row={sid,name:student.name,cls:student.cls};
     try{if(cases.length!==1)E.fail(cases.length?'同一统计范围存在多个个案，请逐人核查':'当前统计范围没有可办理个案，请先生成预警名单');const c=cases[0];validateCaseContext(s,legacyContexts.get(c.id)||c);validateCaseAction(c,body.action);eligible.push({...row,id:c.id,before:c.status,after:caseActions[body.action],level:c.computed?.level||''});}
     catch(e){if(e.status!==422)throw e;blocked.push({...row,message:e.message});}
    }
    const previewId=artifact('case-action',actor,{version:s.version,source:src.fingerprint,selection,ids:body.ids,action:body.action,reason:E.clean(body.reason),eligible,blocked});return json(201,{previewId,selection,eligible,blocked,version:s.version});
   }
   if(method==='POST'&&route==='/case-action-commits'){
    const people=accessible(s,actor,'review'),allowed=new Set(people.map(x=>String(x.id))),p=getArtifact(body.previewId,'case-action',actor);
    if(p.ids.some(sid=>!allowed.has(sid)))throw Object.assign(Error('办理权限已变化，请重新预览'),{status:403});if(p.result)return json(200,p.result);
    guard(s,p.version);const src=source();if(p.source!==src.fingerprint)throw Object.assign(Error('学生或学期资料已变化，请重新预览'),{status:409,code:'PREVIEW_STALE'});
    if(!p.eligible.length)E.fail('没有符合条件的个案');if(p.blocked.length&&body.acceptSkipped!==true)E.fail('请明确确认跳过不能办理的学生');
    recomputeCases(s,src,p.selection.end,p.selection,new Set(p.ids));for(const row of p.eligible){const c=s.cases.find(c=>c.id===row.id);if(!c)E.fail('个案已变化，请重新预览');validateCaseAction(c,p.action);applyCaseAction(c,p.action,p.reason,actor,body.previewId);}
    txn(()=>{save(s);p.result={version:s.version,changed:p.eligible.length,skipped:p.blocked.length,batchId:body.previewId};db().prepare('UPDATE academic_public_artifacts SET payload=? WHERE id=?').run(encode(p),body.previewId);});return json(200,p.result);
   }
   if(method==='POST'&&route==='/case-task'){
    const people=accessible(s,actor,'review');guard(s,body.version);const c=s.cases.find(x=>x.id===body.id);if(!c||!people.some(x=>String(x.id)===c.sid))throw Object.assign(Error('没有此个案的办理权限'),{status:403});if(['已归档','已解除'].includes(c.status))E.fail('该个案已结束');refreshCase(s,c);if(!c.computed?.level)E.fail('当前个案未触发预警，请先复核');
    if(!c.taskId){c.taskId=id();const task={id:c.taskId,title:'学业预警跟进（'+c.period+'）',note:'请在学业情况（公用版）中按授权范围核对预警个案并完成帮扶。',source:'公用版学业预警',academicPublicCaseId:c.id,priority:'重要',category:'学业管理',duty:'study',status:'待处理',term:c.period,repeat:'无',remindDays:3,linkView:'academicPublic',createdAt:stamp(),updatedAt:stamp()};txn(()=>{deps.task(task);save(s);});}
    return json(200,{taskId:c.taskId,version:s.version});
   }
   if(method==='POST'&&route==='/publications'){
    if(!admin(actor))throw Object.assign(Error('只有管理员可以发布正式排名'),{status:403});guard(s,body.version);termCheck(body.term);if(!s.rules||body.confirmed!==true)E.fail('请先设置规则并确认完整清单');const sum=E.summarize(s,source().students,body.term),rows=filterRows(sum.rows,{cls:body.cls});if(!rows.length||rows.some(r=>!r.complete||(s.rules.metric==='gpa'?r.gpa:r.average)===null))E.fail('参排学生或课程成绩不全，不能发布正式排名','RANK_DATA_INCOMPLETE');s.publications.push({id:id(),term:body.term,classes:[...new Set(rows.map(r=>r.cls))],created:stamp(),version:s.version,ruleVersion:s.rules.version,selection:sum.selection,rows});txn(()=>save(s));return json(200,{version:s.version});
   }
   if(method==='POST'&&route==='/analysis'){
    const people=accessible(s,actor),ids=new Set(people.map(x=>String(x.id)));guard(s,body.version);const sum=summaries(s,body),rows=filterRows(sum.rows.filter(r=>ids.has(r.sid)),body,s.cases.filter(c=>caseMatches(c,sum.selection)));
    return json(200,{version:s.version,selection:sum.selection,...analyze(s,sum,rows,body)});
   }
   if(method==='POST'&&route==='/exports'){
    if(body.publicationId!==undefined&&(body.kind!=='grades'||typeof body.publicationId!=='string'||!E.clean(body.publicationId)))E.fail('正式排名快照只支持成绩与排名导出');
    if(body.examIds!==undefined&&body.kind!=='exam')E.fail('考试记录范围只能用于考证导出');
    if(body.courseIds!==undefined&&(body.kind!=='courses'||!Array.isArray(body.courseIds)||body.courseIds.length>20000||body.courseIds.some(x=>typeof x!=='string'||x.length>200)))E.fail('所选课程范围无效');
    if(!['grades','fail','warning','exam','courses','statistics','audit'].includes(body.kind))E.fail('导出类型无效');if(body.ids!==undefined&&(!Array.isArray(body.ids)||body.ids.some(x=>typeof x!=='string')||body.ids.length>20000))E.fail('所选学生范围无效');
    const people=accessible(s,actor,'export'),ids=new Set(people.map(x=>String(x.id)));guard(s,body.version);let sum=summaries(s,body);if(body.publicationId){const publication=s.publications.find(p=>p.id===body.publicationId);if(!publication||publication.rows.some(r=>!ids.has(r.sid)))throw Object.assign(Error('正式快照不存在或已无访问权限'),{status:403});sum={rows:publication.rows,details:publication.rows.flatMap(r=>r.details),selection:publication.selection||E.selectionFor(s,publication.term),version:publication.version,rules:s.ruleHistory.find(r=>r.version===publication.ruleVersion)||s.rules};}let rows=filterRows(sum.rows.filter(x=>ids.has(x.sid)),body,s.cases.filter(c=>caseMatches(c,sum.selection)));if(body.ids){if(!Array.isArray(body.ids)||body.ids.some(x=>!ids.has(x)))throw Object.assign(Error('所选学生不存在或无权导出'),{status:403});rows=rows.filter(x=>body.ids.includes(x.sid));}
    const populationQuery={...body,level:undefined,caseStatus:undefined},population=filterRows(sum.rows.filter(x=>ids.has(x.sid)),populationQuery).filter(x=>!body.ids||body.ids.includes(x.sid));
    if(body.kind==='fail')rows=rows.filter(x=>x.fail>0);if(body.kind==='warning')rows=rows.filter(x=>x.level);const chosen=new Set(rows.map(x=>x.sid)),sheets={};let analysisCourses=null,analysisStudentIds=[];
    if(body.kind==='exam'){if(body.examIds!==undefined&&(!Array.isArray(body.examIds)||body.examIds.length>20000||body.examIds.some(x=>typeof x!=='string'||!s.exams.some(e=>e.id===x&&ids.has(e.sid)))))throw Object.assign(Error('考试记录范围无效或无权导出'),{status:403});const studentPositions=new Map(rows.map((r,i)=>[r.sid,i])),events=filterExams(s.exams.filter(x=>chosen.has(x.sid)&&(!body.examIds||body.examIds.includes(x.id))).map(x=>examView(x,s.rules,s.exams)),body).sort((a,b)=>studentPositions.get(a.sid)-studentPositions.get(b.sid));const eventStudents=new Set(events.map(x=>x.sid));rows=rows.filter(x=>eventStudents.has(x.sid));for(const sid of chosen)if(!eventStudents.has(sid))chosen.delete(sid);sheets['等级考试']=[['学号','姓名','考试类型','考试批次','考试日期','等级','科目','成绩','官方结果','达标情况','证书编号','举办单位',...Exams.extraFields.map(([field])=>field),'材料状态'],...events.map(x=>[x.sid,people.find(p=>String(p.id)===x.sid)?.name,x.type,x.batch,x.date,x.grade,x.subject,x.score,x.official,examView(x,s.rules,s.exams).result,x.certificate,x.organizer,...Exams.extraFields.map(([,key])=>x[key]??''),examView(x,s.rules,s.exams).documentStatus])];sheets['考证项目统计']=Exams.sheet(events.map(x=>examView(x,s.rules,s.exams)));const history=events.flatMap(x=>(x.revisions||[]).map((old,index)=>[x.sid,x.type,x.batch,index+1,old.updated,old.score,old.official,old.province,old.organizer,old.admission,old.certificate,old.listening,old.reading,old.writing,old.remark,old.batchId]));if(history.length)sheets['考证修订记录']=[['学号','考试类型','考试批次','历史版本','原更新时间','原成绩','原官方结果','原考试省份','原举办单位','原准考证号','原证书编号','原听力','原阅读','原写作翻译','原备注','原导入批次'],...history];}
    else{sheets['学生汇总']=[['学号','姓名','学院','年级','专业','班级','正考挂科门数','规则口径未通过门数','未通过学分','待核查门数','加权平均分','平均学分绩点','班级排名','专业排名','预警等级','完整性','获得学分','缺失学期','触发原因'],...rows.map(r=>[r.sid,r.name,r.dept,r.grade,r.major,r.cls,r.originalFail,r.fail,r.failCredit,r.pending,r.average,r.gpa,r.classRank??null,r.majorRank??null,r.level,r.complete?'完整':'待核查',r.earnedCredit??null,(r.missingTerms||[]).join('、'),(r.reasons||[]).map(x=>x.text).join('；')])];
     const cs=sum.details.filter(c=>chosen.has(c.sid)&&(body.kind!=='fail'||c.pass===false));sheets['课程明细']=[['学号','原修读学期','课程代码','课程名称','学分','类别','通过状态','经历标签','计入汇总'],...cs.map(c=>[c.sid,c.term,c.code,c.name,c.credit,c.category,c.pass===null?'待核查':c.pass?'通过':'未通过',c.tags.join('、'),c.counted===false?'否（去重或课程范围）':'是'])];sheets['考试历史']=[['学号','姓名','原修读学期','课程代码','考试类型','考试批次','考试日期','成绩','成绩制','状态',...Import.componentFields.map(([field])=>field),'教学班号','授课教师','开课单位','绩点','重修学期'],...cs.flatMap(c=>c.attempts.map(a=>[c.sid,sum.rows.find(r=>r.sid===c.sid)?.name||'',c.term,c.code,{original:'正考',makeup:'补考',retake:'重修'}[a.type],a.batch,a.date,a.score,a.scale,a.status,...Import.componentFields.map(([,key])=>a[key]??null),c.teachingClass,c.teacher,c.offeringDept,a.gpa??null,a.retakeTerm||'']))];}
    if(body.kind==='warning'){
     const gpaColumn=sheets['学生汇总'][0].indexOf('平均学分绩点');if(gpaColumn>=0)sheets['学生汇总'].forEach(row=>row.splice(gpaColumn,1));
     const cases=s.cases.filter(c=>caseMatches(c,sum.selection)&&c.status!=='已归档');Object.assign(sheets,Report.build({rows,population,details:sum.details,selection:sum.selection,cases,examResults:s.exams.filter(e=>ids.has(e.sid)).map(e=>examView(e,sum.rules,s.exams)),references:s.reportReferences}));
     const names=new Map(rows.map(r=>[r.sid,r.name]));sheets['预警帮扶档案']=[['学号','姓名','统计学期','办理状态','帮扶责任人','帮扶方案','下次跟进日期','学生告知','家长沟通','跟进备注','更新时间'],...cases.filter(c=>chosen.has(c.sid)).map(c=>[c.sid,names.get(c.sid)||'',c.period,c.status,c.support?.owner||'',c.support?.plan||'',c.support?.nextDate||'',c.support?.studentNotified?'已记录':'未记录',c.support?.parentNotified?'已记录':'未记录',c.support?.note||'',c.support?.updated||''])];
    }
    if(['courses','statistics'].includes(body.kind)){
     let analysis=analyze(s,sum,rows,body);
     if(body.courseIds!==undefined){const available=new Set(analysis.courses.map(c=>c.id));if(body.courseIds.some(id=>!available.has(id)))throw Object.assign(Error('所选课程不存在、筛选已变化或无权导出'),{status:403});const selectedCourses=new Set(body.courseIds);analysis=analyze(s,sum,rows.map(r=>({...r,details:r.details.filter(c=>selectedCourses.has(c.id))})),body);}
     analysisCourses=new Set(analysis.courses.map(c=>c.id));analysisStudentIds=rows.map(r=>r.sid);Object.keys(sheets).forEach(k=>delete sheets[k]);Object.assign(sheets,Analysis.sheets(analysis));if(body.kind==='statistics')sheets['逐学期对比']=Analysis.termSheet(analysis);
     if(body.kind==='courses'){delete sheets['学院年级班级统计'];delete sheets['课程类别学分统计'];const matched=new Set(analysis.courses.map(c=>c.sid));rows=rows.filter(r=>matched.has(r.sid));chosen.clear();rows.forEach(r=>chosen.add(r.sid));}
    }
    if(body.kind==='audit'){const analysis=analyze(s,sum,rows,body);Object.keys(sheets).forEach(k=>delete sheets[k]);sheets['数据核查']=Analysis.auditSheet(analysis);const found=new Set(analysis.audit.map(r=>r.sid));rows=rows.filter(r=>found.has(r.sid));chosen.clear();rows.forEach(r=>chosen.add(r.sid));analysisCourses=new Set();}
    const revisions=sum.details.filter(c=>chosen.has(c.sid)&&(!analysisCourses||analysisCourses.has(c.id))&&(body.kind!=='fail'||c.pass===false)).flatMap(c=>c.attempts.flatMap(a=>(a.revisions||[]).map(v=>[c.sid,c.term,c.code,a.type,a.batch,v.score,v.status,v.date,v.updated,v.batchId])));if(body.kind!=='exam'&&revisions.length)sheets['修订记录']=[['学号','原修读学期','课程代码','考试类型','考试批次','修订前成绩','修订前状态','考试日期','原更新时间','原导入批次'],...revisions];
    sheets['导出口径']=[['项目','内容'],['模块','学业情况（公用版）'],['统计学期',body.term||'全部'],['统计范围',sum.selection?.label||sum.rules?.scope||'未设置'],['所选学期',(sum.selection?.terms||[]).join('、')],['统计截止学期',sum.selection?.end||''],['预警指标',({courses:'未通过门数',credits:'未通过学分',either:'门数或学分'})[sum.rules?.warningMetric||'courses']],['预警与绩点','绩点不参与预警等级、复核或解除判定'],['课程去重',sum.rules?.deduplicateCourses?'同课程代码保留最近修读学期':'按原修读课程分别统计'],['成绩阶段',sum.selection?.stage||sum.rules?.stage||'current'],['成绩通过判定',sum.rules?.passResolution==='latest'?'所选阶段最后一次成绩':'所选阶段历史有一次通过即通过'],['排名口径',sum.rules?.rank||'未设置'],['数据版本',sum.version],['规则版本',sum.rules?.version||'未设置'],['学生数',rows.length],['生成时间',stamp()],['排名状态',body.publicationId?'已发布快照':'暂算，正式发布请查发布记录']];if(body.kind==='warning'){sheets['导出口径'].push(['不及格率','同学院、专业、年级、班级、学籍和学号条件的在校未通过人数 / 在校生数；不含预警级别、办理状态筛选，按页/勾选时仅限该学生集合。'],['课程人数','不及格统计及课程明细按同组织、学籍及学生集合统计，不受预警级别和办理状态筛选限制；按课程代码和名称去重统计学生，达到10人及以上才列入课程统计表。'],['等级考试依据','报告通过情况为未核验证书的参考资料；有等级考试记录时按考试规则判定。等级考试取所有已保存记录，不受课程学期选择限制。'],['部分成绩','仅导入不及格记录的学生标为待核查，不生成完整平均分或排名。']);const primary=Report.schema.map(x=>x.name);const ordered=Object.fromEntries([...primary,...Object.keys(sheets).filter(n=>!primary.includes(n))].map(n=>[n,sheets[n]]));Object.keys(sheets).forEach(n=>delete sheets[n]);Object.assign(sheets,ordered);}
    if(['courses','statistics'].includes(body.kind))sheets['导出口径'].push(['课程筛选',JSON.stringify({courseCode:body.courseCode||[],category:body.category||[],result:body.result||[]})],['统计说明','课程统计按计入汇总记录及所选成绩阶段计算；通过率分母为已有结论人数，待核查单列。仅不及格记录不计算通过率和平均分。数值平均分只使用可折算的成绩，等第未折算人数单列。班级统计使用同学生筛选范围的全部课程，不受课程筛选影响。']);
    if(body.kind==='statistics')sheets['导出口径'].push(['逐学期对比','对当前学生筛选集合逐学期独立计算；排除入学前学期；课程筛选不影响对比。预警候选可能含部分成绩，预警口径可判定不等于人工确认。各学期人数不能直接相加当作学生总数。']);
    if(body.kind==='audit')sheets['导出口径'].push(['核查问题类型',JSON.stringify(body.issueType||[])],['核查范围','按当前学生筛选及勾选学期，检查计入汇总课程；课程筛选不缩小此范围，不自动更改成绩或标记完整。']);
    const bytes=Files.workbook(sheets,{percentColumns:body.kind==='warning'?{[Report.schema[0].name]:[4]}:{'课程成绩统计':[9],'考证项目统计':[12]}}),fileId=artifact('export',actor,{version:s.version,students:body.kind==='warning'?population.map(r=>r.sid):body.kind==='statistics'?analysisStudentIds:[...chosen],bytes:bytes.toString('base64'),name:`学业情况（公用版）_${{warning:'学业预警报告',fail:'不及格学生',grades:'成绩与排名',exam:'等级考试',courses:'课程成绩查询',statistics:'成绩统计',audit:'数据核查'}[body.kind]||'成绩'}_${body.term||'全部'}_${Date.now()}.xlsx`},30*60000);return json(201,{fileId,count:rows.length,version:sum.version,url:'/api/academic-public/download?fileId='+fileId});
   }
   if(method==='GET'&&route==='/download'){const people=accessible(s,actor,'export'),file=getArtifact(body.fileId,'export',actor),ids=new Set(people.map(x=>String(x.id)));if(file.students.some(x=>!ids.has(x)))throw Object.assign(Error('权限范围已变化，不能下载此文件'),{status:403});return deps.download(response,Buffer.from(file.bytes,'base64'),file.name);}
   if(method==='POST'&&route==='/error-export'){permission(s,actor,'import');const p=getArtifact(body.previewId,'preview',actor);const ids=new Set(accessible(s,actor,'import').map(x=>String(x.id)));if(p.errors.some(e=>E.clean(e.raw?.['学号'])&&!ids.has(E.clean(e.raw['学号']))&&source().students.some(x=>String(x.id)===E.clean(e.raw['学号']))))throw Object.assign(Error('错误文件包含当前无权访问的学生，请重新上传或联系管理员'),{status:403});const names=fields[p.type],rows=[names.concat(['工作表','原行号','错误代码','原因']),...p.errors.map(e=>names.map(n=>E.clean(e.raw?.[n])).concat([e.sheet,e.row,e.code,e.message]))];return deps.download(response,Files.workbook({'错误数据':rows}),'学业情况（公用版）_导入错误行.xlsx');}
   return json(404,{error:{code:'NOT_FOUND',message:'接口不存在'}});
  }catch(e){return json(e.status||500,{error:{code:e.code||'OPERATION_FAILED',message:e.status?e.message:'操作未完成，请重试或联系管理员',traceId:id(),saveState:'未执行本次写入'}});}
 }
 return {init,handle};
}
module.exports={createService,fields};
