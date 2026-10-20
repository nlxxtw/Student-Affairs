/*
 * 其他违纪记录（待嵌入模块）
 *
 * 设计说明：本文件尚未由 index.html 或 app.js 引用，不会出现在导航、首页、学生画像、
 * 导入流程或正式数据统计中。确认嵌入前，仅作为独立模块代码保留。
 *
 * 嵌入时由 app.js 调用：
 *   PAGES.otherViolation = () => OtherViolationModule.render();
 *   PAGES.otherViolation_init = () => OtherViolationModule.afterRender();
 */
(function(global){
  "use strict";

  const STORE_KEY="nnuzc_other_violation_records";
  const PAGER_KEY="other_violation";
  const PAGER_JUMP_ID="otherViolationJump";
  /* terms=null 表示页面首次进入，默认当前学期；[] 表示用户明确选择“全部学期”。 */
  let filters={terms:null,kw:"",dept:[],major:[],grade:[],cls:[],type:[]};

  const h=function(v){ return global.esc ? global.esc(v) : String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); };
  const a=function(v){ return global.escAttr ? global.escAttr(v) : h(v); };
  const toast=function(msg,type){ if(typeof global.showToast==="function") global.showToast(msg,type||"ok"); else global.alert(msg); };
  const nowDate=function(){ return new Date().toISOString().slice(0,10); };
  /* 与全系统保持一致：学期一律倒序（新学期在前），筛选与录入弹窗共用同一数据源。 */
  const terms=function(){
    const list=typeof global.getTermList==="function" ? global.getTermList() : [];
    if(typeof global.sortTermsDesc==="function") return global.sortTermsDesc(list);
    return (list||[]).slice().sort(function(a,b){return String(b||"").localeCompare(String(a||""));});
  };
  const currentTerm=function(){ return global.CURRENT_TERM || terms()[0] || ""; };
  const students=function(){ const list=typeof global.getOtherViolationStudents==="function" ? global.getOtherViolationStudents() : global.students; return Array.isArray(list) ? list : []; };

  function read(){ try{ const rows=JSON.parse(global.localStorage.getItem(STORE_KEY)||"[]"); return Array.isArray(rows)?rows:[]; }catch(_e){ return []; } }
  function save(rows){ global.localStorage.setItem(STORE_KEY,JSON.stringify(rows||[])); }
  function makeId(){ return "ov_"+Date.now()+"_"+Math.random().toString(36).slice(2,8); }
  function findStudent(id){ return students().find(function(s){return String(s.id)===String(id);}); }
  function recordStudent(r){ return findStudent(r.studentId)||{}; }
  function dateSort(b,a){ return String(a.date||"").localeCompare(String(b.date||"")) || String(b.updatedAt||"").localeCompare(String(a.updatedAt||"")); }

  function optionList(values,selected,blank){
    return '<option value="">'+h(blank||"全部")+'</option>'+values.filter(Boolean).filter(function(v,i,arr){return arr.indexOf(v)===i;}).map(function(v){return '<option value="'+a(v)+'"'+(String(v)===String(selected)?" selected":"")+'>'+h(v)+'</option>';}).join("");
  }
  function uniqueValues(values){ return Array.from(new Set((values||[]).map(function(value){return String(value==null?"":value).trim();}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,"zh-CN",{numeric:true});}); }
  function matches(selected,value){ const values=Array.isArray(selected)?selected:(selected?[selected]:[]); return !values.length||values.indexOf(value)>=0; }
  function filterUI(){ return typeof global.getOtherViolationFilterUI==="function" ? global.getOtherViolationFilterUI() : null; }
  function standardInput(name,placeholder,current){ const ui=filterUI(); return ui&&ui.input?ui.input(name,placeholder,current):'<input class="in" data-qf="'+a(name)+'" placeholder="'+a(placeholder)+'" value="'+a(current)+'">'; }
  function standardMulti(name,options,current){ const ui=filterUI(); return ui&&ui.multi?ui.multi(name,options,current):'<select class="in" data-qf="'+a(name)+'">'+optionList(options.map(function(x){return x.v;}),"","全部")+'</select>'; }
  function selectedTerms(){
    if(filters.terms===null||filters.terms===undefined) return currentTerm()?[currentTerm()]:[];
    if(Array.isArray(filters.terms)) return filters.terms.slice();
    return filters.terms?[String(filters.terms)]:[];
  }
  function selectedTermsText(){ const selected=selectedTerms(); return selected.length===0?"全部学期":(selected.length===1?selected[0]:(selected.length+" 个学期")); }
  function termFilterHtml(){ return standardMulti("terms",[{v:"",l:"全部学期"}].concat(terms().map(function(t){return {v:t,l:t};})),selectedTerms()); }
  function readMulti(name){ const root=global.document.querySelector('.qf-bar[data-page="other_violation"] .qf-multi[data-qf="'+name+'"]'); return root?Array.from(root.querySelectorAll('input:checked')).map(function(el){return el.value;}):[]; }
  function queryFilterValue(name){ const el=global.document.querySelector('.qf-bar[data-page="other_violation"] [data-qf="'+name+'"]'); return el?(el.value||"").trim():""; }
  function filterRows(){
    const f=filters;
    return read().filter(function(r){
      const s=recordStudent(r); const text=[r.studentId,r.name,s.name,s.dept,s.major,s.grade,s.cls,r.type,r.location,r.reason].join(" ").toLowerCase();
      return matches(selectedTerms(),r.term||"") && (!f.kw||text.indexOf(f.kw.toLowerCase())>=0) && matches(f.dept,r.dept||s.dept||"") && matches(f.major,r.major||s.major||"") && matches(f.grade,r.grade||s.grade||"") && matches(f.cls,r.cls||s.cls||"") && matches(f.type,r.type||"");
    }).sort(dateSort);
  }
  function filesHtml(files){
    if(!files||!files.length) return '<span style="color:var(--muted)">未上传</span>';
    return files.map(function(file){
      const src=typeof global.attachmentDisplayUrl==="function"?global.attachmentDisplayUrl(file):(file.url||"");
      if(!src) return '';
      const isImg=/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name||"") || /^image\//.test(file.mime||"");
      return isImg?'<a href="'+a(src)+'" target="_blank" rel="noopener"><img src="'+a(src)+'" alt="'+a(file.name||"附件")+'" style="width:56px;height:56px;object-fit:cover;border:1px solid var(--line);border-radius:6px;margin:2px"></a>':'<a class="lk" href="'+a(src)+'" target="_blank" rel="noopener">📎 '+h(file.name||"附件")+'</a>';
    }).join("");
  }
  function tableRows(rows){
    if(!rows.length) return '<tr><td colspan="11" class="empty">暂无符合条件的其他违纪记录</td></tr>';
    return rows.map(function(r){
      const s=recordStudent(r), dept=r.dept||s.dept||"", major=r.major||s.major||"", grade=r.grade||s.grade||"", cls=r.cls||s.cls||"";
      return '<tr><td>'+h(r.term)+'</td><td>'+h(dept)+'</td><td>'+h(major)+'</td><td>'+h(grade)+'</td><td>'+h(cls)+'</td><td>'+h(r.studentId)+'</td><td>'+h(r.name||s.name)+'</td><td><b>'+h(r.type)+'</b></td><td>'+h(r.location)+'</td><td>'+h(r.date)+'</td><td><a class="lk" href="javascript:void(0)" onclick="OtherViolationModule.view('+a(JSON.stringify(r.id))+')">查看</a>　<a class="lk" href="javascript:void(0)" onclick="OtherViolationModule.edit('+a(JSON.stringify(r.id))+')">编辑</a>　<a class="lk danger" href="javascript:void(0)" onclick="OtherViolationModule.remove('+a(JSON.stringify(r.id))+')">删除</a></td></tr>';
    }).join("");
  }
  function filterKey(){ return JSON.stringify(filters); }
  function pageRows(rows){
    if(typeof global.pagerSlice==="function") return global.pagerSlice(PAGER_KEY,rows,filterKey());
    return {total:rows.length,totalPages:1,slice:rows};
  }
  function pagerHtml(info){
    if(typeof global.renderGenericPager==="function") return global.renderGenericPager(PAGER_KEY,info,PAGER_JUMP_ID);
    return '<div class="stu-pager"><span class="stu-pager-info">共 <strong>'+info.total+'</strong> 条数据</span></div>';
  }

  function render(){
    const rows=filterRows(), types=uniqueValues(read().map(function(r){return r.type;})), allStudents=students();
    const depts=uniqueValues(allStudents.map(function(s){return s.dept;})), majors=uniqueValues(allStudents.map(function(s){return s.major;})), grades=uniqueValues(allStudents.map(function(s){return s.grade;})), classes=uniqueValues(allStudents.map(function(s){return s.cls;}));
    const stats={total:rows.length,types:new Set(rows.map(function(r){return r.type;}).filter(Boolean)).size,withFiles:rows.filter(function(r){return (r.files||[]).length;}).length};
    const pageInfo=pageRows(rows);
    return '<h2 class="ptitle">⚠️ 其他违纪记录 <span class="tag">按学期记录 · '+h(selectedTermsText())+'</span></h2>'
      +'<div class="tip" style="margin-bottom:12px">用于登记非宿舍场景的学生违纪事项。违纪类型由工作人员手动输入；记录可附图片或 PDF 佐证，须经人工核实后录入。</div>'
      +'<div class="grid stat-grid" style="margin-bottom:12px"><div class="stat"><div class="lab">记录总数</div><div class="num">'+stats.total+'</div></div><div class="stat"><div class="lab">违纪类型</div><div class="num">'+stats.types+'</div></div><div class="stat"><div class="lab">已附佐证</div><div class="num">'+stats.withFiles+'</div></div></div>'
      +'<div class="card"><div class="toolbar qf-bar" data-page="other_violation">'
      +'<div class="filter-item"><label>关键字</label>'+standardInput("kw","搜索学号/姓名",filters.kw)+'</div>'
      +'<div class="filter-item"><label>学期</label>'+termFilterHtml()+'</div>'
      +'<div class="filter-item"><label>学院</label>'+standardMulti("dept",[{v:"",l:"全部学院"}].concat(depts.map(function(x){return {v:x,l:x};})),filters.dept)+'</div>'
      +'<div class="filter-item"><label>专业</label>'+standardMulti("major",[{v:"",l:"全部专业"}].concat(majors.map(function(x){return {v:x,l:x};})),filters.major)+'</div>'
      +'<div class="filter-item"><label>年级</label>'+standardMulti("grade",[{v:"",l:"全部年级"}].concat(grades.map(function(x){return {v:x,l:x};})),filters.grade)+'</div>'
      +'<div class="filter-item"><label>班级</label>'+standardMulti("cls",[{v:"",l:"全部班级"}].concat(classes.map(function(x){return {v:x,l:x};})),filters.cls)+'</div>'
      +'<div class="filter-item"><label>违纪类型</label>'+standardMulti("type",[{v:"",l:"全部类型"}].concat(types.filter(Boolean).map(function(x){return {v:x,l:x};})),filters.type)+'</div>'
      +'<button class="btn btn-primary btn-sm" onclick="OtherViolationModule.query()">查询</button><button class="btn btn-ghost btn-sm" onclick="OtherViolationModule.reset()">重置</button><span style="flex:1"></span><button class="btn btn-primary btn-sm" onclick="OtherViolationModule.open()">＋ 记录违纪</button><button class="btn btn-ghost btn-sm" onclick="OtherViolationModule.export()">⬇ 导出</button></div>'
      +'<div class="module-table-wrap"><div class="table-scroll"><table class="t-table" style="min-width:1320px"><thead><tr><th>学期</th><th>学院</th><th>专业</th><th>年级</th><th>班级</th><th>学号</th><th>姓名</th><th>违纪类型</th><th>发生地点</th><th>违纪时间</th><th>操作</th></tr></thead><tbody>'+tableRows(pageInfo.slice)+'</tbody></table></div></div>'+pagerHtml(pageInfo)+'</div>';
  }
  function rerender(){ if(typeof global.renderPage==="function") global.renderPage("otherViolation"); }
  function query(){ filters={terms:readMulti("terms"),kw:queryFilterValue("kw"),dept:readMulti("dept"),major:readMulti("major"),grade:readMulti("grade"),cls:readMulti("cls"),type:readMulti("type")}; rerender(); }
  function reset(){ filters={terms:currentTerm()?[currentTerm()]:[],kw:"",dept:[],major:[],grade:[],cls:[],type:[]}; rerender(); }
  function value(id){ const el=global.document.getElementById(id); return el?(el.value||"").trim():""; }

  function formHtml(record){
    record=record||{term:currentTerm(),date:nowDate(),files:[]}; const s=recordStudent(record);
    const existing=(record.files||[]).map(function(f,i){return '<span style="display:inline-flex;align-items:center;gap:4px;margin:3px;padding:4px 6px;background:#f5f7fa;border-radius:5px">'+h(f.name||"附件")+' <button type="button" class="btn btn-ghost btn-sm" onclick="OtherViolationModule.dropFile('+a(JSON.stringify(record.id))+','+i+')">移除</button></span>';}).join("");
    return '<div class="row2"><div class="field"><label>学期 *</label><select id="ovFormTerm">'+optionList(terms(),record.term,"请选择学期")+'</select></div><div class="field"><label>违纪时间 *</label><input id="ovFormDate" type="date" value="'+a(record.date)+'"></div></div>'
      +'<div class="row2"><div class="field"><label>学号 *</label><input id="ovFormSid" value="'+a(record.studentId)+'" placeholder="输入学号自动匹配" oninput="OtherViolationModule.fillStudent()"></div><div class="field"><label>姓名</label><input id="ovFormName" value="'+a(record.name||s.name)+'" placeholder="输入姓名自动匹配" onchange="OtherViolationModule.fillStudentByName(this.value)"></div></div>'
      +'<div class="row2"><div class="field"><label>学院</label><input id="ovFormDept" value="'+a(record.dept||s.dept)+'" readonly></div><div class="field"><label>专业</label><input id="ovFormMajor" value="'+a(record.major||s.major)+'" readonly></div></div>'
      +'<div class="row2"><div class="field"><label>年级</label><input id="ovFormGrade" value="'+a(record.grade||s.grade)+'" readonly></div><div class="field"><label>班级</label><input id="ovFormCls" value="'+a(record.cls||s.cls)+'" readonly></div></div>'
      +'<div class="row2"><div class="field"><label>违纪类型 *</label><input id="ovFormType" value="'+a(record.type)+'" maxlength="50" placeholder="请手动输入，如：扰乱教学秩序"></div><div class="field"><label>发生地点 *</label><input id="ovFormLocation" value="'+a(record.location)+'" maxlength="100" placeholder="如：教学楼 A201"></div></div>'
      +'<div class="field"><label>原因 *</label><textarea id="ovFormReason" rows="4" maxlength="2000" placeholder="请如实填写违纪原因">'+h(record.reason)+'</textarea></div>'
      +'<div class="field"><label>佐证附件（图片或 PDF，可多选，单个不超过 8MB）</label><input id="ovFormFiles" type="file" accept="image/*,.pdf,application/pdf" multiple><div style="font-size:12.5px;color:var(--muted);margin-top:4px">'+(existing||"暂未上传附件")+'</div></div>';
  }
  function open(id){ const record=id?read().find(function(r){return r.id===id;}):null; if(typeof global.openModal!=="function"){ toast("模块尚未嵌入：需在工作台内调用。","warn"); return; } global.openModal(record?"编辑其他违纪记录":"记录其他违纪",formHtml(record),function(){ return submit(record&&record.id); }); }
  function fillStudent(){ const s=findStudent(value("ovFormSid")); ["Name","Dept","Major","Grade","Cls"].forEach(function(k){const el=global.document.getElementById("ovForm"+k); if(el)el.value=s?({Name:s.name,Dept:s.dept,Major:s.major,Grade:s.grade,Cls:s.cls}[k]||""):"";}); }
  function fillStudentByName(name){
    if(typeof global.resolveStudentNameInput!=="function")return;
    global.resolveStudentNameInput(name,function(s,typed){
      const values={Sid:s?s.id:"",Name:s?s.name:(typed||""),Dept:s?s.dept||"":"",Major:s?s.major||"":"",Grade:s?(s.grade||""):"",Cls:s?s.cls||"":""};
      Object.keys(values).forEach(function(key){const el=global.document.getElementById("ovForm"+key);if(el)el.value=values[key];});
    },"其他违纪记录");
  }
  async function upload(files){
    const out=[]; for(const file of Array.from(files||[])){
      const ok=/^image\//.test(file.type||"") || (file.type||"")==="application/pdf" || /\.pdf$/i.test(file.name||"");
      if(!ok) throw new Error('“'+file.name+'”仅支持图片或 PDF'); if(file.size>8*1024*1024) throw new Error('“'+file.name+'”超过 8MB');
      if(!global.workbench||!global.workbench.legacy||!global.workbench.legacy.attachmentUploadFile) throw new Error("附件服务不可用");
      const saved=await global.workbench.legacy.attachmentUploadFile(file.name,file); out.push({id:saved.id,name:saved.name,url:saved.url,size:saved.size,mime:file.type||"application/octet-stream"});
    } return out;
  }
  async function submit(id){
    const studentId=value("ovFormSid"), s=findStudent(studentId), term=value("ovFormTerm"), type=value("ovFormType"), location=value("ovFormLocation"), date=value("ovFormDate"), reason=value("ovFormReason");
    if(!term||!studentId||!s||!type||!location||!date||!reason){ toast("请填写学期、有效学号、违纪类型、发生地点、违纪时间和原因。","warn"); return false; }
    const rows=read(), old=id?rows.find(function(r){return r.id===id;}):null, input=global.document.getElementById("ovFormFiles"), uploaded=[];
    try{ uploaded.push.apply(uploaded,await upload(input&&input.files)); }catch(e){ toast("附件保存失败："+(e.message||e),"warn"); return false; }
    const record={id:id||makeId(),term:term,studentId:s.id,name:s.name,dept:s.dept||"",major:s.major||"",grade:s.grade||"",cls:s.cls||"",type:type,location:location,date:date,reason:reason,files:(old&&old.files||[]).concat(uploaded),customFieldValues:old&&old.customFieldValues||{},updatedAt:new Date().toISOString()};
    if(old){ const idx=rows.indexOf(old); rows[idx]=record; } else rows.push(record); save(rows); if(typeof global.closeModal==="function")global.closeModal(); toast(old?"其他违纪记录已更新":"其他违纪记录已保存","ok"); rerender(); return true;
  }
  function view(id){ const r=read().find(function(x){return x.id===id;}); if(!r||typeof global.openModal!=="function")return; const s=recordStudent(r); const body='<div class="row2"><div class="field"><label>学期</label><input readonly value="'+a(r.term)+'"></div><div class="field"><label>违纪时间</label><input readonly value="'+a(r.date)+'"></div></div><div class="row2"><div class="field"><label>学号 / 姓名</label><input readonly value="'+a(r.studentId+' / '+(r.name||s.name||""))+'"></div><div class="field"><label>违纪类型</label><input readonly value="'+a(r.type)+'"></div></div><div class="field"><label>发生地点</label><input readonly value="'+a(r.location)+'"></div><div class="field"><label>原因</label><div class="in" style="min-height:70px;white-space:pre-wrap;background:#f8faf9">'+h(r.reason||"未填写")+'</div></div><div class="field"><label>佐证附件</label><div>'+filesHtml(r.files)+'</div></div>'; global.openModal("其他违纪记录详情",body,function(){return true;}); }
  async function remove(id){ const r=read().find(function(x){return x.id===id;}); if(!r||typeof global.recycleMoveRecords!=="function")return; const moved=await global.recycleMoveRecords("otherViolation","other_violation_record",[id]);if(!moved)return;toast("其他违纪记录已移入回收站","ok");rerender(); }
  async function dropFile(id,index){ const rows=read(),r=rows.find(function(x){return x.id===id;}); if(!r)return; const f=(r.files||[])[index]; if(!f||!global.confirm("确认移除此附件？"))return; r.files.splice(index,1); save(rows); if(f.id&&global.workbench&&global.workbench.legacy) await global.workbench.legacy.attachmentDelete(f.id).catch(function(){}); open(id); }
  function exportRows(){ const rows=filterRows(); const sheet=[["学期","学院","专业","年级","班级","学号","姓名","违纪类型","发生地点","违纪时间","原因","附件数"]].concat(rows.map(function(r){const s=recordStudent(r);return [r.term,r.dept||s.dept,r.major||s.major,r.grade||s.grade,r.cls||s.cls,r.studentId,r.name||s.name,r.type,r.location,r.date,r.reason,(r.files||[]).length];})); if(typeof global.downloadXlsxFile==="function")global.downloadXlsxFile("其他违纪记录",sheet,"其他违纪记录_"+nowDate()+".xlsx"); else toast("导出工具将在嵌入系统后可用。","warn"); }

  global.OtherViolationModule={render:render,afterRender:function(){},query:query,reset:reset,open:open,edit:open,view:view,remove:remove,dropFile:dropFile,fillStudent:fillStudent,fillStudentByName:fillStudentByName,export:exportRows,_test:{read:read,save:save,filterRows:filterRows}};
})(window);
