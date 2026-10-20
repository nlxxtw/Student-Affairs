(function(){
 'use strict';
 const E=window.StudentLeaveEngine,K=E.KEY;
 let filters={term:null,dept:[],major:[],grade:[],cls:[],type:[],status:[],kw:'',from:'',to:''},page=1,size=20,selected=new Set(),timer;
 const people=()=>students,read=()=>{const value=JSON.parse(localStorage.getItem(K)||'[]');if(!Array.isArray(value))throw Error('请销假数据格式异常，请检查备份');return value;};
 const h=esc,a=escAttr,val=id=>(document.getElementById(id)?.value||'').trim(),id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString();
 const student=r=>people().find(s=>String(s.id)===String(r.studentId))||r;
 const opts=(values,current)=>values.map(v=>'<option value="'+a(v)+'"'+(current===v?' selected':'')+'>'+h(v)+'</option>').join('');
 const writes=new Set(['new','edit','review','finish','cancel','import','remove']);
 const readonly=()=>window.SESSION?.role==='viewer'||workbenchIsReadOnly();
 const button=(text,action,arg='',kind='ghost')=>'<button type="button" class="btn btn-'+kind+' btn-sm" data-sl="'+a(action)+'" data-id="'+a(arg)+'" '+(writes.has(action)&&readonly()?'disabled':'')+'>'+h(text)+'</button>';
 const input=(key,label,value='',type='text',extra='')=>'<div class="field"><label for="sl-'+key+'">'+label+'</label><input id="sl-'+key+'" type="'+type+'" value="'+a(value)+'" '+extra+'></div>';
 function context(before){return {students:people(),terms:getTermList(),before:before||[]};}
 function multi(key,label,values){return '<div class="filter-item"><label>'+label+'</label>'+qfMulti('sl_'+key,[{v:'',l:'全部'+label}].concat(values.map(v=>({v,l:v}))),filters[key]||[])+'</div>';}
 function choices(key){return [...new Set(people().map(s=>s[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));}
 function list(ignoreStatus=false){
  const now=E.beijing(),byId=new Map(people().map(s=>[String(s.id),s]));
  // The table, filters and export all use current authoritative student metadata.
  const rows=read().map(row=>{const s=byId.get(String(row.studentId));if(!s)return row;const linked={...row};for(const k of ['name','dept','major','grade','cls'])linked[k]=s[k]||'';return linked;});
  return rows.filter(r=>(!filters.term||r.term===filters.term)
   &&['dept','major','grade','cls'].every(k=>!filters[k].length||filters[k].includes(r[k]))
   &&(!filters.type.length||filters.type.includes(r.type))
   &&(ignoreStatus||!filters.status.length||filters.status.includes(E.status(r,now)))
   &&(!filters.from||r.start.slice(0,10)>=filters.from)&&(!filters.to||r.start.slice(0,10)<=filters.to)
   &&(!filters.kw||[r.studentId,r.name,r.cls,r.type,r.reason,r.destination,r.notes].some(v=>String(v||'').toLowerCase().includes(filters.kw.toLowerCase())))
  ).sort((a,b)=>b.start.localeCompare(a.start)||a.studentId.localeCompare(b.studentId,'zh-CN',{numeric:true}));
 }
 function badge(r){const status=E.status(r),color=/逾期/.test(status)?'red':status==='已销假'?'green':status==='请假中'?'blue':'gray';return '<span class="badge b-'+color+'">'+h(status)+'</span>';}
 const statusGroups={'记录总数':[],'待审批':['待审批'],'未开始':['未开始'],'请假中':['请假中'],'逾期未归':['逾期未归'],'已销假':['已销假','逾期销假']};
 const typeOptions=values=>E.types.concat([...new Set(values)].filter(v=>E.legacyTypes.includes(v)));
 const statAppearance={
  '记录总数':['total','<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/>'],
  '待审批':['pending','<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
  '未开始':['upcoming','<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M9 15h6M9 18h3"/>'],
  '请假中':['away','<path d="M9 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 3h7v7M21 3 10 14"/>'],
  '逾期未归':['overdue','<path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/>'],
  '已销假':['returned','<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>']
 };
 function sameStatuses(values){return values.length===filters.status.length&&values.every(v=>filters.status.includes(v));}
 function rowActions(r){
  const editable=!r.returnedAt&&['待审批','已批准'].includes(r.approval);
  return button('详情','detail',r.id)+button(r.returnedAt?'补充备注':'编辑','edit',r.id)
   +(r.approval==='待审批'?button('审批','review',r.id,'primary'):'')
   +(r.approval==='已批准'&&!r.returnedAt?button('销假','finish',r.id,'primary'):'')
   +(editable?button('撤销','cancel',r.id):'');
 }
 function recordRow(r){
  return '<tr class="sl-record"><td class="sl-check"><input type="checkbox" data-sl-row="'+a(r.id)+'" aria-label="选择'+a(r.name)+'的请假记录" '+(selected.has(r.id)?'checked':'')+'></td>'
   +'<td class="sl-person-cell" data-label="学生"><strong>'+h(r.name)+'</strong><span>'+h(r.studentId)+' · '+h(r.cls||'未维护班级')+'</span><small>'+h([r.dept,r.major,r.grade].filter(Boolean).join(' · '))+'</small></td>'
   +'<td data-label="请假类型"><span class="sl-type">'+h(r.type)+'</span><small>'+h(r.term)+'</small></td>'
   +'<td class="sl-period" data-label="请假时段"><span>'+h(r.start.replace('T',' '))+'</span><span class="sl-until">至 '+h(r.end.replace('T',' '))+'</span><small>共 '+E.duration(r).hours+' 小时</small></td>'
   +'<td class="sl-reason" data-label="请假原因"><div>'+h(r.reason)+'</div>'+(r.files?.length?'<small>证明附件 '+r.files.length+' 份</small>':'')+'</td>'
   +'<td data-label="当前状态">'+badge(r)+'</td><td data-label="实际返校">'+(r.returnedAt?h(r.returnedAt.replace('T',' ')):'<span class="sl-muted">'+(r.approval==='已批准'?'未销假':'—')+'</span>')+'</td>'
   +'<td class="sl-actions" data-label="办理">'+rowActions(r)+'</td></tr>';
 }
 function render(){
  if(filters.term===null)filters.term=CURRENT_TERM||'';
  const scope=list(true),now=E.beijing(),counts=new Map();for(const r of scope){const status=E.status(r,now);counts.set(status,(counts.get(status)||0)+1);}
  const rows=filters.status.length?scope.filter(r=>filters.status.includes(E.status(r,now))):scope,pages=Math.max(1,Math.ceil(rows.length/size));page=Math.min(page,pages);
  const slice=rows.slice((page-1)*size,page*size),currentIds=new Set(slice.map(r=>r.id));selected=new Set([...selected].filter(v=>currentIds.has(v)));
  const stats=Object.entries(statusGroups).map(([title,values])=>{
   const count=values.length?values.reduce((sum,status)=>sum+(counts.get(status)||0),0):scope.length;
   const [tone,icon]=statAppearance[title];
   return '<button type="button" class="sl-stat sl-stat-'+tone+'" data-sl="status" data-id="'+a(title)+'" aria-pressed="'+sameStatuses(values)+'"><span class="sl-stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+icon+'</svg></span><span class="sl-stat-label">'+title+'</span><b>'+count+'</b><small>'+(title==='已销假'?'含逾期销假':title==='记录总数'?'当前条件范围':title==='未开始'?'已批准 · 尚未开始':'点击查看记录')+'</small><span class="sl-stat-indicator" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></span></button>';
  }).join('');
  const empty=(scope.length||read().length)?'<b>没有符合条件的记录</b><span>可调整学期、学生或状态条件后重新查询。</span>'+button('重置筛选','reset'):'<b>还没有请销假记录</b><span>登记学生请假，或导入已有台账。</span>'+button('新增请假登记','new','','primary');
  const body=slice.map(recordRow).join('')||'<tr class="sl-empty-row"><td colspan="8"><div class="sl-empty">'+empty+'</div></td></tr>';
  const activeStatus=filters.status.length?'当前状态：'+filters.status.join('、'):'全部状态';
  return '<div class="student-leave-page"><div class="sl-header"><div><h2 class="ptitle">🌿 请销假管理</h2><p>登记请假、核对审批与实际返校情况</p></div><div class="sl-header-actions">'+button('＋ 请假登记','new','','primary')+button('导出当前筛选','export')+'</div></div>'
   +'<div class="sl-stats" role="group" aria-label="请销假状态快捷筛选">'+stats+'</div>'
   +'<div class="card sl-filter-card"><div class="sl-section-head"><h3>查询条件</h3><span>状态概览按已查询条件统计</span></div><div class="sl-filters">'
   +'<div class="filter-item"><label for="sl-keyword">关键字</label><input id="sl-keyword" placeholder="学号 / 姓名 / 请假原因" value="'+a(filters.kw)+'"></div>'
   +'<div class="filter-item"><label>学期</label>'+qfSingle('sl_term',[{v:'',l:'全部学期'}].concat(getTermList().map(v=>({v,l:v}))),filters.term)+'</div>'
   +['dept','major','grade','cls'].map((k,i)=>multi(k,['学院','专业','年级','班级'][i],choices(k))).join('')
   +multi('type','请假类型',typeOptions(read().map(r=>r.type)))+multi('status','状态',E.statuses)+input('from','开始日期自',filters.from,'date')+input('to','开始日期至',filters.to,'date')
   +'<div class="sl-query-actions">'+button('查询','query','','primary')+button('重置','reset')+'</div></div></div>'
   +'<div class="card sl-ledger"><div class="sl-ledger-head"><div><h3>请销假台账 <span>'+rows.length+' 条</span></h3><p>'+h(activeStatus)+' · 按请假开始时间由近到远排列</p></div><div class="sl-import-actions">'+button('导入台账','import')+button('下载模板','template')+'</div></div>'
   +'<div class="sl-batch-bar"><span id="sl-selected" role="status" aria-live="polite">已选 '+selected.size+' 条（本页）</span>'+button('删除选中','remove')+'<span class="sl-scroll-hint">窄屏可左右滚动，手机端按记录显示</span></div>'
   +'<div class="sl-table table-scroll"><table><thead><tr><th class="sl-check"><label><input id="sl-all" type="checkbox" aria-label="全选当前页" '+(!slice.length?'disabled':'')+'><span class="sl-mobile-only">全选本页</span></label></th>'
   +['学生信息','类型 / 学期','请假时段','请假原因','当前状态','实际返校','操作'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>'
   +'<div class="sl-pager"><span>共 '+rows.length+' 条 · 第 '+page+' / '+pages+' 页</span><div class="sl-pager-controls">'
   +'<button type="button" class="btn btn-ghost btn-sm" data-sl="previous" '+(page===1?'disabled':'')+'>上一页</button>'
   +'<button type="button" class="btn btn-ghost btn-sm" data-sl="next" '+(page===pages?'disabled':'')+'>下一页</button>'
   +'<select id="sl-size" aria-label="每页条数">'+opts(['20','50','100'],String(size))+'</select><span>条/页</span></div></div></div>'
   +'<p class="tip sl-footnote">状态按北京时间更新；已销假包含逾期销假。请销假台账不会自动改写课堂考勤。</p></div>';
 }
 function refresh(){renderPage('studentLeave');}
 function selection(){const boxes=[...document.querySelectorAll('[data-sl-row]')],master=document.getElementById('sl-all'),count=boxes.filter(b=>selected.has(b.dataset.slRow)).length;if(master){master.checked=!!boxes.length&&count===boxes.length;master.indeterminate=count>0&&count<boxes.length;}const text=document.getElementById('sl-selected');if(text)text.textContent='已选 '+count+' 条（本页）';const remove=document.querySelector('.student-leave-page [data-sl="remove"]');if(remove)remove.disabled=readonly()||count===0;}
 function readMulti(k){return [...document.querySelectorAll('.sl-filters [data-qf="sl_'+k+'"] input:checked')].map(n=>n.value).filter(Boolean);}
 function query(){if(val('sl-from')&&val('sl-to')&&val('sl-from')>val('sl-to'))throw Error('开始日期范围颠倒');filters={term:qfSingleValue('sl_term'),kw:val('sl-keyword'),from:val('sl-from'),to:val('sl-to')};for(const k of ['dept','major','grade','cls','type','status'])filters[k]=readMulti(k);page=1;selected.clear();refresh();}
 async function persist(rows,base){if(readonly())throw Error('当前为只读状态，不能修改请销假记录');const normalized=E.validate(rows,context(JSON.parse(base||'[]')));return workbench.legacy.commitStoreBatch([{key:K,method:'PUT',value:JSON.stringify(normalized),baseValue:base}]);}
 function form(recordId){
  const base=localStorage.getItem(K),all=JSON.parse(base||'[]'),old=all.find(r=>r.id===recordId),r=old||{id:id(),term:CURRENT_TERM,type:'事假',approval:'待审批',files:[],start:'',end:'',reason:''},closed=!!r.returnedAt;
  const files=(r.files||[]).slice(),completedUploads=new WeakSet();const token={};window.__slForm=token;
  const candidates=people().filter(s=>isOnCampusStudent(s)||String(s.id)===String(r.studentId));
  const body='<div class="sl-form">'+(closed?'<p class="sl-readonly-note">此记录已销假，学生、学期、类型和时段已锁定，可补充原因、备注及证明材料。</p>':'')+'<section class="sl-form-section"><h3>学生与请假信息</h3><div class="sl-grid">'
   +input('sid','学生学号 <span class="req">*</span>',r.studentId||'','text','list="sl-students" '+(old?'readonly':''))
   +'<datalist id="sl-students">'+candidates.map(s=>'<option value="'+a(s.id)+'">'+h([s.name,s.cls].join(' · '))+'</option>').join('')+'</datalist>'
   +(old?'<div class="field"><label>关联学生</label><input readonly value="'+a(student(r).name||'')+'"></div>':'<div class="field"><label for="sl-person-search">查找学生</label><input id="sl-person-search" placeholder="输入学号或姓名搜索" autocomplete="off"><div id="sl-person-results" class="sl-person-results"></div></div>')
   +'</div><p id="sl-student-hint" class="sl-student-hint"></p><div class="sl-grid"><div class="field"><label>学期 <span class="req">*</span></label>'
   +(closed?'<input readonly value="'+a(r.term)+'">':qfSingle('sl_form_term',getTermList().map(v=>({v,l:v})),r.term))+'</div><div class="field"><label>请假类型 <span class="req">*</span></label>'
   +(closed?'<input readonly value="'+a(r.type)+'">':qfSingle('sl_form_type',typeOptions([r.type]).map(v=>({v,l:v})),r.type))+'</div>'
   +input('start','开始时间 <span class="req">*</span>',r.start,'datetime-local',closed?'readonly':'')
   +input('end','预计返校时间 <span class="req">*</span>',r.end,'datetime-local',closed?'readonly':'')+'</div><p id="sl-duration" class="sl-duration">选择起止时间后自动计算时长。</p>'
   +'<div class="field"><label for="sl-reason">请假原因 <span class="req">*</span></label><textarea id="sl-reason" maxlength="2000" rows="3" placeholder="填写具体事由">'+h(r.reason)+'</textarea></div></section>'
   +'<section class="sl-form-section"><h3>去向与审批</h3><div class="sl-grid">'+input('destination','去向 / 目的地',r.destination)+input('contact','紧急联系信息',r.contact)+input('approver','审批人',r.approver)
   +'<div class="field"><label>审批状态</label>'+(old?'<input readonly value="'+a(r.approval)+'">':qfSingle('sl_form_approval',[{v:'待审批',l:'待审批'},{v:'已批准',l:'已批准（补录假条）'}],r.approval))+'</div></div>'
   +'<div class="field"><label for="sl-notes">辅导员备注 / 家长知情说明</label><textarea id="sl-notes" maxlength="2000" rows="2">'+h(r.notes||'')+'</textarea></div></section>'
   +'<section class="sl-form-section"><h3>证明材料</h3><div class="field"><label for="sl-files">图片或 PDF · 每份不超过 8MB，最多 20 份</label><input id="sl-files" type="file" accept="image/*,.pdf" multiple>'
   +'<div id="sl-file-list">'+files.map(f=>'<label class="sl-file"><input type="checkbox" data-sl-file="'+a(f.id)+'" checked> 保留 '+h(f.name)+'</label>').join('')+'</div></div></section></div>';
  openModal(closed?'补充已销假记录':old?'编辑请假记录':'新增请假登记',body,async()=>{
   if(window.__slForm!==token)return false;
   const rec={...r,studentId:val('sl-sid'),term:closed?r.term:qfSingleValue('sl_form_term'),type:closed?r.type:qfSingleValue('sl_form_type'),start:val('sl-start'),end:val('sl-end'),reason:val('sl-reason'),destination:val('sl-destination'),contact:val('sl-contact'),approver:val('sl-approver'),approval:old?r.approval:qfSingleValue('sl_form_approval'),notes:val('sl-notes'),createdAt:r.createdAt||stamp(),updatedAt:stamp(),returnedAt:r.returnedAt||''};
   const chosenFiles=()=>{const retained=new Set([...document.querySelectorAll('[data-sl-file]:checked')].map(n=>n.dataset.slFile));return files.filter(f=>retained.has(f.id));};rec.files=chosenFiles();
   const proposed=all.filter(x=>x.id!==rec.id).concat(rec);E.validate(proposed,context(all));
   const input=document.getElementById('sl-files');
   const pending=[...(input?.files||[])].filter(file=>!completedUploads.has(file));
   if(rec.files.length+pending.length>20)throw Error('单条记录最多20个附件，请减少选择后重试');
   for(const file of pending){if(file.size>8*1024*1024||!(/^image\//.test(file.type)||/\.pdf$/i.test(file.name)))throw Error('附件仅支持不超过8MB的图片或PDF');}
   for(const file of pending){
    const saved=await workbench.legacy.attachmentUploadFile(file.name,file);completedUploads.add(file);files.push({id:saved.id,name:file.name});
    if(window.__slForm!==token||document.getElementById('sl-reason')!==reasonNode||!document.getElementById('mask').classList.contains('show'))return false;
    const label=document.createElement('label'),check=document.createElement('input');label.className='sl-file';check.type='checkbox';check.dataset.slFile=saved.id;check.checked=true;label.append(check,document.createTextNode(' 保留 '+file.name));document.getElementById('sl-file-list').appendChild(label);
   }if(input)input.value='';
   if(window.__slForm!==token||document.getElementById('sl-reason')!==reasonNode||!document.getElementById('mask').classList.contains('show'))return false;
   rec.files=chosenFiles();await persist(all.filter(x=>x.id!==rec.id).concat(rec),base);
   if(window.__slForm===token){refresh();showToast(old?'请假记录已保存':'请假登记已保存','success');}return true;
  });
  document.getElementById('modalOk').textContent=closed?'保存补充':old?'保存修改':'保存登记';
  const reasonNode=document.getElementById('sl-reason');
  const hint=()=>{const s=people().find(s=>String(s.id)===val('sl-sid'));document.getElementById('sl-student-hint').textContent=s?[s.name,s.dept,s.grade,s.cls].filter(Boolean).join(' · '):'请选择学生管理中的在校学生，姓名及班级自动关联。';};
  document.getElementById('sl-sid').addEventListener('input',hint);hint();
  if(!old)document.getElementById('sl-person-search').oninput=function(){const kw=this.value.trim().toLowerCase(),root=document.getElementById('sl-person-results');root.replaceChildren();if(!kw||old)return;for(const s of candidates.filter(s=>[s.id,s.name,s.cls].some(v=>String(v||'').toLowerCase().includes(kw))).slice(0,30)){const b=document.createElement('button');b.type='button';b.className='sl-person';b.textContent=s.id+' · '+s.name+' · '+(s.cls||'');b.onclick=()=>{document.getElementById('sl-sid').value=s.id;root.replaceChildren();hint();};root.appendChild(b);}};
  const duration=()=>{if(!val('sl-start')||!val('sl-end')){document.getElementById('sl-duration').textContent='选择起止时间后自动计算时长，天数按24小时折算。';return;}try{const d=E.duration({start:E.datetime(val('sl-start')),end:E.datetime(val('sl-end'))});document.getElementById('sl-duration').textContent=d.hours>0?d.hours+'小时（'+d.days+'天，按24小时折算）':'结束时间应晚于开始时间';}catch(_){}};
  for(const key of ['start','end'])document.getElementById('sl-'+key).addEventListener('change',duration);duration();
 }
 function recordContext(r,showReason=true){const s=student(r);return '<div class="sl-record-context"><div><strong>'+h(s.name)+' <span>'+h(r.studentId)+'</span></strong>'+badge(r)+'</div><p>'+h([s.dept,s.cls,r.type].filter(Boolean).join(' · '))+'</p><p>'+h(r.start.replace('T',' '))+' 至 '+h(r.end.replace('T',' '))+'</p>'+(showReason?'<p class="sl-context-reason">'+h(r.reason)+'</p>':'')+'</div>';}
 function detail(recordId){
  const r=read().find(r=>r.id===recordId);if(!r)return;
  const data=[['所属学期',r.term],['请假类型',r.type],['开始时间',r.start.replace('T',' ')],['预计返校',r.end.replace('T',' ')],['请假时长',E.duration(r).hours+' 小时（按24小时折算 '+E.duration(r).days+' 天）'],['实际返校',r.returnedAt?.replace('T',' ')||'—'],['去向 / 目的地',r.destination],['紧急联系',r.contact],['审批人',r.approver],['审批状态',r.approval]];
  const block=(title,text)=>'<section class="sl-detail-block"><h3>'+title+'</h3><p>'+h(text||'—')+'</p></section>';
  const files=(r.files||[]).map(f=>'<a class="sl-attachment lk" href="/attachments/'+a(f.id)+'" download="'+a(f.name)+'">'+h(f.name)+'</a>').join('');
  openModal('请销假详情','<div class="sl-detail">'+recordContext(r,false)+'<dl>'+data.map(([label,text])=>'<div><dt>'+label+'</dt><dd>'+h(text||'—')+'</dd></div>').join('')+'</dl>'+block('请假原因',r.reason)+block('辅导员备注 / 审批说明',r.notes)+block('销假备注',r.returnNotes)+'<section class="sl-detail-block"><h3>证明材料</h3>'+(files||'<p class="sl-muted">未上传证明材料</p>')+'</section></div>',null);
  document.getElementById('modalFoot').innerHTML=button('关闭','close');
 }
 function transition(recordId,action){
  const base=localStorage.getItem(K),rows=JSON.parse(base||'[]'),r=rows.find(r=>r.id===recordId);if(!r)return;
  if(action==='finish'&&(r.approval!=='已批准'||r.returnedAt))throw Error('该记录当前不能销假');
  const body=action==='finish'?input('returned','实际返校时间 <span class="req">*</span>',E.beijing(),'datetime-local')+'<p class="tip">填写真实返校时间；晚于预计返校时间将记为逾期销假。</p>':action==='review'?'<div class="field"><label>审批结果</label>'+qfSingle('sl_decision',[{v:'已批准',l:'批准'},{v:'已驳回',l:'驳回'}],'已批准')+'</div>'+input('reviewer','审批人',r.approver):'<p>撤销后保留原假条，状态变为已撤销。</p>';
  openModal(action==='finish'?'办理销假':action==='review'?'请假审批':'撤销请假','<div class="sl-action-form">'+recordContext(r)+body+'<div class="field"><label for="sl-action-notes">办理说明'+(action==='finish'?'':' <span class="req">*</span>')+'</label><textarea id="sl-action-notes" maxlength="2000" rows="3"></textarea></div></div>',async()=>{
   if(action!=='finish'&&!val('sl-action-notes'))throw Error('请填写办理说明');
   const next={...r,updatedAt:stamp()};if(action==='finish'){next.returnedAt=val('sl-returned');if(!next.returnedAt)throw Error('实际返校时间必填');next.returnNotes=val('sl-action-notes');}else{next.approval=action==='cancel'?'已撤销':qfSingleValue('sl_decision');next.approver=action==='review'?val('sl-reviewer'):r.approver;next.notes=[r.notes,val('sl-action-notes')].filter(Boolean).join('\n');}
   await persist(rows.map(x=>x.id===r.id?next:x),base);refresh();showToast('办理已保存','success');return true;
  });
  document.getElementById('modalOk').textContent=action==='finish'?'确认销假':action==='review'?'保存审批结果':'确认撤销';
 }
 const columns=['记录编号','学期','学号','姓名','学院','专业','年级','班级','请假类型','请假原因','开始时间','预计返校时间','实际返校时间','审批状态','审批人','去向','紧急联系信息','辅导员备注','销假备注','当前状态','小时数','天数（24小时折算）'];
 const fields=['id','term','studentId','name','dept','major','grade','cls','type','reason','start','end','returnedAt','approval','approver','destination','contact','notes','returnNotes'];
 function exportRows(){const rows=list();downloadXlsxFile('请销假台账',[columns,...rows.map(r=>fields.map(k=>r[k]||'').concat(E.status(r),E.duration(r).hours,E.duration(r).days))],'请销假台账_'+E.beijing().slice(0,10)+'.xlsx');}
 function template(){const today=E.beijing().slice(0,10),tomorrow=E.beijing(Date.now()+86400000).slice(0,10);downloadXlsxFile('请销假模板',[columns.slice(0,19),['',CURRENT_TERM||getTermList()[0]||'2026-2027-1学期','2026010101','示例学生','','','','','事假','家庭事务',today+' 08:00',tomorrow+' 18:00','','待审批','','','','','']],'请销假导入模板.xlsx');}
 function importRows(){
  const base=localStorage.getItem(K),before=JSON.parse(base||'[]');
  openMappedImportWizard({name:'请销假台账',preserveTime:true,fields:columns.slice(0,19).map((label,i)=>({key:fields[i],label,required:['term','studentId','type','reason','start','end'].includes(fields[i]),aliases:({type:['请假类别'],reason:['请假事由','请假具体事由'],start:['离校时间','离校开始时间'],end:['结束时间','返校时间'],returnedAt:['实际返校'],notes:['辅导员审批备注','辅导员审核备注']})[fields[i]]||[]})),template:'StudentLeaveModule.template()',
   infoHtml:'请假类型与请假原因分别必填。新增时学号须在学生管理中存在且为在校生；姓名与学籍信息按学号关联。整批先校验，存在错误不提交；与已有时段重叠的假条需先核对。',
   validate(raw){
    const additions=[],duplicates=[],seen=new Set(),existing=new Map(before.map(r=>[r.id,r]));
    let errorRow='整批';
    try{
     for(const [index,source] of raw.entries()){
      errorRow=index+2;
      const record={};for(const k of fields)record[k]=String(source[k]??'').trim();record.id=record.id||id();record.approval=record.approval||'待审批';
      for(const k of ['start','end','returnedAt'])record[k]=E.datetime(source[k]);
      for(const key of ['term','studentId','type','reason','start','end'])if(!record[key])throw Error(columns[fields.indexOf(key)]+'必填');
      if(seen.has(record.id))throw Error('文件内记录编号重复，请去重后导入');seen.add(record.id);
      const known=existing.get(record.id);
      if(known){if(fields.filter(k=>!['id','name','dept','major','grade','cls'].includes(k)).some(k=>String(known[k]||'')!==record[k]))throw Error('已有编号的内容不同，请在台账编辑，不能导入覆盖');duplicates.push({row:Number(source.__importRowNumber)||index+2,msg:'编号 '+record.id+' 与已有记录一致，已跳过'});continue;}
      record.files=[];record.createdAt=stamp();record.updatedAt=stamp();additions.push(record);
     }
     errorRow='整批';E.validate(before.concat(additions),context(before));return {ok:additions,errors:[],duplicates:duplicates.length,warnings:duplicates};
    }catch(e){return {ok:[],errors:[{row:errorRow,msg:e.message}],duplicates:duplicates.length};}
   },
   async apply(rows,state){if(readonly())throw Error('当前为只读状态，不能导入请销假记录');const normalized=E.validate(before.concat(rows),context(before));await workbench.legacy.commitStoreBatch([{key:K,method:'PUT',value:JSON.stringify(normalized),baseValue:base}]);return {ok:rows.length,skip:state.duplicates||0};},after(){refresh();}
  });
 }
 async function action(name,recordId){if(writes.has(name)&&readonly())throw Error('当前为只读状态，不能修改请销假记录');switch(name){case 'status':if(!Object.hasOwn(statusGroups,recordId))return;filters.status=statusGroups[recordId].slice();page=1;selected.clear();refresh();break;case 'query':query();break;case 'reset':filters={term:null,dept:[],major:[],grade:[],cls:[],type:[],status:[],kw:'',from:'',to:''};page=1;selected.clear();refresh();break;case 'new':form();break;case 'edit':form(recordId);break;case 'detail':detail(recordId);break;case 'review':case 'finish':case 'cancel':transition(recordId,name);break;case 'close':closeModal();break;case 'export':exportRows();break;case 'template':template();break;case 'import':importRows();break;case 'remove':if(!selected.size)throw Error('请先勾选要删除的记录');if(await recycleMoveRecords('studentLeave','student_leave_record',[...selected])){selected.clear();refresh();}break;case 'previous':page=Math.max(1,page-1);selected.clear();refresh();break;case 'next':page=Math.min(Math.ceil(list().length/size)||1,page+1);selected.clear();refresh();break;}}
 document.addEventListener('click',e=>{const b=e.target.closest('[data-sl]');if(b)action(b.dataset.sl,b.dataset.id).catch(e=>showToast(e.message,'error'));});
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='sl-keyword'&&!e.isComposing){e.preventDefault();action('query').catch(error=>showToast(error.message,'error'));}});
 document.addEventListener('change',e=>{const node=e.target;if(node.matches('[data-sl-row]')){node.checked?selected.add(node.dataset.slRow):selected.delete(node.dataset.slRow);selection();}if(node.id==='sl-all'){document.querySelectorAll('[data-sl-row]').forEach(b=>{b.checked=node.checked;node.checked?selected.add(b.dataset.slRow):selected.delete(b.dataset.slRow);});selection();}if(node.id==='sl-size'){size=Number(node.value);page=1;selected.clear();refresh();}});
 function cascade(){
  const fields=['dept','major','grade','cls'];for(let i=0;i<fields.length;i++){const key=fields[i],upstream=fields.slice(0,i),allowed=new Set(people().filter(s=>upstream.every(k=>{const selected=readMulti(k);return !selected.length||selected.includes(s[k]);})).map(s=>s[key]));const root=document.querySelector('.sl-filters [data-qf="sl_'+key+'"]');if(!root)continue;root.querySelectorAll('input[type=checkbox]').forEach(box=>{if(!box.value)return;const valid=allowed.has(box.value);box.disabled=!valid;if(!valid)box.checked=false;const option=box.closest('.qf-multi-opt');if(option)option.style.display=valid?'':'none';});qfMultiRefresh(root);}
 }
 document.addEventListener('change',event=>{if(event.target.closest('.sl-filters .qf-multi'))cascade();});
 function afterRender(){selection();cascade();clearInterval(timer);timer=setInterval(()=>{if(currentView!=='studentLeave'){clearInterval(timer);return;}if(!document.getElementById('mask')?.classList.contains('show')&&!document.querySelector('.student-leave-page .qf-multi.open')&&!document.querySelector('.student-leave-page')?.contains(document.activeElement))refresh();},60000);}
 function archive(s){const rows=read().filter(r=>r.studentId===String(s.id));return '<div style="font-weight:700;margin:14px 0 8px">请销假记录</div>'+portraitArchiveTable(['学期','请假类型','开始时间','预计返校','请假原因','状态','实际返校'],rows.map(r=>'<tr>'+[r.term,r.type,r.start.replace('T',' '),r.end.replace('T',' '),r.reason,E.status(r),r.returnedAt?.replace('T',' ')||'—'].map(v=>'<td>'+h(v)+'</td>').join('')+'</tr>'),'暂无请销假记录');}
 // Both writes join the existing synchronous student-edit save queue as one transaction.
 function relinkStudentId(oldId,newId){if(String(oldId)===String(newId))return;const rows=read();if(rows.some(r=>r.studentId===String(oldId)))localStorage.setItem(K,JSON.stringify(rows.map(r=>r.studentId===String(oldId)?{...r,studentId:String(newId)}:r)));}
 window.StudentLeaveModule={render,afterRender,template,archive,relinkStudentId};
})();
