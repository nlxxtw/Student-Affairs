(function(root,factory){'use strict';const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.StudentLeaveEngine=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 const KEY='nnuzc_student_leaves',types=['事假','病假','法定节假日','寒暑假','公假','实习假','其他'],legacyTypes=['实习实训','求职面试','回家探亲'],approvals=['待审批','已批准','已驳回','已撤销'];
 const statuses=['待审批','未开始','请假中','逾期未归','已销假','逾期销假','已驳回','已撤销'];
 function fail(message){const e=new Error(message);e.statusCode=422;e.expose=true;throw e;}
 function text(value,label,max=2000){if(value===undefined||value===null)return '';if(typeof value!=='string'&&typeof value!=='number')fail(label+'格式无效');const out=String(value).trim();if(out.length>max)fail(label+'过长');return out;}
 const pad=n=>String(n).padStart(2,'0');
 function beijing(value=Date.now()){const d=new Date(value+8*3600000);return d.toISOString().slice(0,16);}
 function datetime(value){
  if(value===''||value===null||value===undefined)return '';
  if(typeof value==='number'){if(!Number.isFinite(value)||value<1||value>100000)fail('日期数值无效');value=new Date(Date.UTC(1899,11,30)+Math.round(value*1440)*60000).toISOString().slice(0,16);}
  const s=text(value,'日期',40).replace(/[年/]/g,'-').replace('月','-').replace('日','').trim();
  const m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::00)?)?$/);if(!m)fail('日期应为年月日及时间');
  const [y,mo,d,h,mi]=[Number(m[1]),Number(m[2]),Number(m[3]),Number(m[4]||0),Number(m[5]||0)],date=new Date(Date.UTC(y,mo-1,d,h,mi));
  if(y<1900||y>2100||date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d||h>23||mi>59)fail('日期或时间不存在');
  return y+'-'+pad(mo)+'-'+pad(d)+'T'+pad(h)+':'+pad(mi);
 }
 function epoch(v){return Date.parse(v+':00+08:00');}
 function duration(row){const hours=(epoch(row.end)-epoch(row.start))/3600000;return {hours:Math.round(hours*100)/100,days:Math.round(hours/24*100)/100};}
 function status(row,now=beijing()){
  if(row.approval!=='已批准')return row.approval;
  if(row.returnedAt)return row.returnedAt>row.end?'逾期销假':'已销假';
  return now<row.start?'未开始':now>row.end?'逾期未归':'请假中';
 }
 function validate(input,options){
  options=options||{};if(!Array.isArray(input)||input.length>50000)fail('请销假记录必须为数组且不超过50000条');
  const students=new Map((options.students||[]).map(s=>[String(s.id),s])),old=new Map((options.before||[]).map(r=>[r.id,r])),ids=new Set(),now=options.now||beijing();
  const rows=input.map(source=>{
   if(!source||typeof source!=='object'||Array.isArray(source))fail('请销假记录格式无效');const r={};
   for(const key of ['id','studentId','term','type','approval'])r[key]=text(source[key],key,100);
   if(!r.id||ids.has(r.id))fail('请销假编号为空或重复');ids.add(r.id);
   const s=students.get(r.studentId),previous=old.get(r.id);if(!s)fail('学号未在学生管理中找到');
   const relinked=previous&&options.studentIdRenames instanceof Map&&options.studentIdRenames.get(previous.studentId)===r.studentId;
   if(!options.historical&&(!previous||(previous.studentId!==r.studentId&&!relinked))&&!['在校','在校生',''].includes(s.status||''))fail('只能为在校学生新增请假');
   if(!(options.terms||[]).includes(r.term))fail('请先在学期设置中维护所属学期');
   // Retain known old types only for their existing record or a historical restore.
   const retainedLegacy=legacyTypes.includes(r.type)&&(options.historical||previous?.type===r.type);
   if(!types.includes(r.type)&&!retainedLegacy)fail('请选择有效的请假类型');if(!approvals.includes(r.approval))fail('审批状态无效');
   r.reason=text(source.reason,'请假原因');if(!r.reason)fail('请假原因必填');
   r.start=datetime(source.start);r.end=datetime(source.end);r.returnedAt=datetime(source.returnedAt);
   if(!r.start||!r.end||r.end<=r.start)fail('结束时间必须晚于开始时间');
   if(r.returnedAt&&(r.approval!=='已批准'||r.returnedAt<r.start||r.returnedAt>now))fail('销假须已批准，实际返校时间不得早于开始或晚于当前时间');
   if(previous&&previous.returnedAt&&['studentId','term','type','start','end','approval','returnedAt'].some(k=>!(k==='studentId'&&relinked)&&String(previous[k]||'')!==r[k]))fail('已销假记录的学生、时段和状态不可修改，可补充备注');
   for(const key of ['destination','contact','approver','notes','returnNotes','createdAt','updatedAt'])r[key]=text(source[key],key,key.includes('Notes')||key==='notes'?2000:300);
   for(const key of ['name','dept','major','grade','cls'])r[key]=text(s[key],key,300);
   if(source.files!==undefined&&!Array.isArray(source.files))fail('附件格式无效');if((source.files||[]).length>20)fail('单条记录最多20个附件');
   r.files=(source.files||[]).map(f=>{if(!f||typeof f!=='object'||!/^[-a-f0-9]{36}$/i.test(f.id||''))fail('附件编号无效');return {id:f.id,name:text(f.name,'附件名称',200),url:'/attachments/'+f.id};});
   return r;
  });
  const active=new Map();for(const r of rows){if(!['待审批','已批准'].includes(r.approval))continue;const key=r.studentId;if(!active.has(key))active.set(key,[]);active.get(key).push(r);}
  for(const list of active.values()){list.sort((a,b)=>a.start.localeCompare(b.start));let latest=null;for(const r of list){if(latest&&r.start<(latest.returnedAt||latest.end))fail('同一学生的有效请假时段重叠，请核对已有记录');if(!latest||(r.returnedAt||r.end)>(latest.returnedAt||latest.end))latest=r;}}
  return rows;
 }
 return {KEY,types,legacyTypes,approvals,statuses,datetime,beijing,epoch,duration,status,validate};
});
