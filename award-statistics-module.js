"use strict";

/* 独立的“获奖统计”台账。
 * 不复用或改写“获奖情况”数据：两者分别存储、分别维护，只在学生画像中并列展示。
 */
(function(){
  const AWARD_STATISTICS_KEY="nnuzc_award_statistics_records";
  const AWARD_STATISTICS_FIELDS=[
    {key:"name",label:"姓名"},{key:"sid",label:"学号",required:true},{key:"dept",label:"学院"},
    {key:"major",label:"专业"},{key:"grade",label:"现在年级"},{key:"cls",label:"班级"},
    {key:"honorTitle",label:"荣誉称号名称"},{key:"competitionName",label:"学科竞赛名称"},{key:"award",label:"奖项"},
    {key:"term",label:"评定学期"},{key:"academicYear",label:"评定学年"},{key:"awardDate",label:"获奖日期"},
    {key:"certificate",label:"获奖证书"}
  ];
  let awardStatisticsRecords=[];
  let awardStatisticsFilter={kw:"",dept:"",major:"",grade:"",cls:"",status:""};
  let awardStatisticsExistingCertificate=null;
  let awardStatisticsRemovedCertificate=null;

  function astText(value){return String(value==null?"":value).trim();}
  function astStudent(sid){return (students||[]).find(function(student){return String(student.id||"")===astText(sid);})||null;}
  function astStatus(student){return student?(typeof stuStatusLabel==="function"?stuStatusLabel(student.status):astText(student.status)||"未维护"):"未匹配";}
  function astMeta(record){
    const student=astStudent(record&&record.sid);
    return {
      name:(student&&student.name)||astText(record&&record.name), dept:(student&&student.dept)||astText(record&&record.dept),
      major:(student&&student.major)||astText(record&&record.major), grade:(student&&(student.grade||classGrade(student.cls)))||astText(record&&record.grade),
      cls:(student&&student.cls)||astText(record&&record.cls), status:astStatus(student)
    };
  }
  function astNormalize(row){
    const raw=row||{}, student=astStudent(raw.sid), meta=astMeta(raw);
    return {
      id:raw.id||genId("award-statistics"), sid:astText(raw.sid), name:(student&&student.name)||astText(raw.name),
      dept:(student&&student.dept)||astText(raw.dept), major:(student&&student.major)||astText(raw.major),
      grade:(student&&(student.grade||classGrade(student.cls)))||astText(raw.grade), cls:(student&&student.cls)||astText(raw.cls),
      honorTitle:astText(raw.honorTitle), competitionName:astText(raw.competitionName), award:astText(raw.award),
      term:astText(raw.term), academicYear:astText(raw.academicYear), awardDate:astText(raw.awardDate),
      certificate:raw.certificate&&typeof raw.certificate==="object"?raw.certificate:null,
      certificateImportName:astText(raw.certificateImportName), createdAt:raw.createdAt||fmtNow(), updatedAt:raw.updatedAt||"",
      customFieldValues:raw.customFieldValues&&typeof raw.customFieldValues==="object"&&!Array.isArray(raw.customFieldValues)?raw.customFieldValues:{},
      _meta:meta
    };
  }
  function astStrip(record){const copy=Object.assign({},record);delete copy._meta;return copy;}
  function awardStatisticsLoad(){
    try{const saved=JSON.parse(localStorage.getItem(AWARD_STATISTICS_KEY)||"[]");awardStatisticsRecords=Array.isArray(saved)?saved.map(astNormalize):[];}
    catch(error){awardStatisticsRecords=[];if(typeof reportDataError==="function")reportDataError("获奖统计加载",error);}
  }
  window.awardStatisticsReload=awardStatisticsLoad;
  function awardStatisticsPersist(){
    try{localStorage.setItem(AWARD_STATISTICS_KEY,JSON.stringify(awardStatisticsRecords.map(astStrip)));}
    catch(error){if(typeof reportDataError==="function")reportDataError("获奖统计保存",error);throw error;}
  }
  function astUnique(values){return Array.from(new Set(values.map(astText).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,"zh-CN");});}
  function astOptions(values,current,label){return '<option value="">全部'+esc(label)+'</option>'+astUnique(values).map(function(value){return '<option value="'+attr(value)+'"'+(current===value?' selected':'')+'>'+esc(value)+'</option>';}).join("");}
  function awardStatisticsFiltered(){
    const keyword=astText(awardStatisticsFilter.kw).toLowerCase();
    return awardStatisticsRecords.filter(function(record){
      const meta=astMeta(record), hay=[record.sid,meta.name,meta.dept,meta.major,meta.grade,meta.cls,meta.status,record.honorTitle,record.competitionName,record.award,record.term,record.academicYear,record.awardDate].join(" ").toLowerCase();
      return (!keyword||hay.indexOf(keyword)>=0)&&(!awardStatisticsFilter.dept||meta.dept===awardStatisticsFilter.dept)&&(!awardStatisticsFilter.major||meta.major===awardStatisticsFilter.major)&&(!awardStatisticsFilter.grade||meta.grade===awardStatisticsFilter.grade)&&(!awardStatisticsFilter.cls||meta.cls===awardStatisticsFilter.cls)&&(!awardStatisticsFilter.status||meta.status===awardStatisticsFilter.status);
    }).sort(function(a,b){return String(b.awardDate||"").localeCompare(String(a.awardDate||""))||String(b.updatedAt||b.createdAt||"").localeCompare(String(a.updatedAt||a.createdAt||""));});
  }
  function astCertificateLink(certificate){
    if(!certificate)return '<span class="muted">未上传</span>';
    const url=typeof attachmentDisplayUrl==="function"?attachmentDisplayUrl(certificate):(certificate.url||(certificate.id?"/attachments/"+certificate.id:""));
    if(!url)return esc(certificate.name||"已上传");
    const image=/^image\//i.test(certificate.mime||"")||/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(certificate.name||"");
    return image?'<a class="lk" href="'+attr(url)+'" onclick="event.preventDefault();portraitZoomPhoto('+jsArg(url)+')">'+esc(certificate.name||"查看图片")+'</a>':'<a class="lk" href="'+attr(url)+'" target="_blank" rel="noopener">'+esc(certificate.name||"查看 PDF")+'</a>';
  }
  function astRows(records){
    if(!records.length)return '<tr><td colspan="14" class="empty">暂无符合条件的获奖统计记录</td></tr>';
    return records.map(function(record){const meta=astMeta(record);return '<tr><td>'+esc(meta.dept||"—")+'</td><td>'+esc(meta.major||"—")+'</td><td>'+esc(meta.grade||"—")+'</td><td>'+esc(meta.cls||"—")+'</td><td>'+esc(meta.status||"—")+'</td><td>'+esc(record.sid||"—")+'</td><td>'+esc(meta.name||"—")+'</td><td style="white-space:normal">'+esc(record.honorTitle||"—")+'</td><td style="white-space:normal">'+esc(record.competitionName||"—")+'</td><td>'+esc(record.award||"—")+'</td><td>'+esc(record.term||"—")+'</td><td>'+esc(record.academicYear||"—")+'</td><td>'+esc(record.awardDate||"—")+'</td><td style="white-space:nowrap">'+astCertificateLink(record.certificate)+'　<a class="lk" onclick="awardStatisticsView('+jsArg(record.id)+')">查看</a>　<a class="lk" onclick="awardStatisticsOpenForm('+jsArg(record.id)+')">编辑</a>　<a class="lk danger" onclick="awardStatisticsDelete('+jsArg(record.id)+')">删除</a></td></tr>';}).join("");
  }
  function awardStatisticsPage(){
    const records=awardStatisticsFiltered(), all=(students||[]).map(function(student){return {dept:student.dept||"",major:student.major||"",grade:student.grade||classGrade(student.cls)||"",cls:student.cls||"",status:astStatus(student)};}), studentCount=new Set(records.map(function(r){return r.sid;}).filter(Boolean)).size;
    return '<style>.ast-filter{display:grid;grid-template-columns:minmax(190px,1.5fr) repeat(5,minmax(120px,1fr));gap:9px;align-items:end}.ast-filter label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}.ast-filter .in{width:100%}.ast-kpi{display:flex;gap:10px;margin:13px 0}.ast-kpi>div{min-width:130px;padding:11px 13px;border:1px solid var(--border);border-radius:9px;background:#fff}.ast-kpi small{display:block;color:var(--muted)}.ast-kpi b{display:block;font-size:24px;margin-top:3px}@media(max-width:1100px){.ast-filter{grid-template-columns:repeat(3,1fr)}}@media(max-width:680px){.ast-filter{grid-template-columns:1fr}.ast-kpi{flex-wrap:wrap}}</style><div class="ast-wrap"><h2 class="ptitle">📊 获奖统计 <span class="tag">独立台账 · 学生画像联动</span></h2><div class="sub">按 Excel 字段建立获奖统计台账；原“获奖情况”保持不变。保存、导入、编辑或删除后，学生画像会同步显示本模块记录。</div><div class="card" style="padding:13px;margin-top:14px"><div class="ast-filter"><div><label>关键词</label><input id="astKw" class="in" value="'+attr(awardStatisticsFilter.kw)+'" placeholder="学号、姓名、荣誉称号、竞赛或奖项" onkeydown="if(event.key===\'Enter\')awardStatisticsQuery()"></div><div><label>学院</label><select id="astDept" class="in">'+astOptions(all.map(function(x){return x.dept;}),awardStatisticsFilter.dept,"学院")+'</select></div><div><label>专业</label><select id="astMajor" class="in">'+astOptions(all.map(function(x){return x.major;}),awardStatisticsFilter.major,"专业")+'</select></div><div><label>年级</label><select id="astGrade" class="in">'+astOptions(all.map(function(x){return x.grade;}),awardStatisticsFilter.grade,"年级")+'</select></div><div><label>班级</label><select id="astCls" class="in">'+astOptions(all.map(function(x){return x.cls;}),awardStatisticsFilter.cls,"班级")+'</select></div><div><label>学籍状态</label><select id="astStatus" class="in">'+astOptions(all.map(function(x){return x.status;}),awardStatisticsFilter.status,"学籍状态")+'</select></div></div><div class="toolbar" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="awardStatisticsQuery()">查询</button><button class="btn btn-ghost btn-sm" onclick="awardStatisticsReset()">重置</button><span style="flex:1"></span><button class="btn btn-ghost btn-sm" onclick="awardStatisticsDownloadTemplate()">下载模板</button><button class="btn btn-ghost btn-sm" onclick="awardStatisticsImport()">导入</button><button class="btn btn-ghost btn-sm" onclick="awardStatisticsExport()">导出</button><button class="btn btn-primary btn-sm" onclick="awardStatisticsOpenForm()">＋ 新增</button></div></div><div class="ast-kpi"><div><small>当前查询记录</small><b>'+records.length+'</b></div><div><small>获奖学生</small><b>'+studentCount+'</b></div><div><small>已上传获奖证书</small><b>'+records.filter(function(r){return !!r.certificate;}).length+'</b></div></div><div class="card" style="padding:0"><div class="list-scroll">'+table(["学院","专业","现在年级","班级","学籍状态","学号","姓名","荣誉称号名称","学科竞赛名称","奖项","评定学期","评定学年","获奖日期","获奖证书 / 操作"],astRows(records))+'</div></div></div>';
  }
  function astReadonlyField(id,label,value){return '<div class="field"><label>'+label+'</label><input id="'+id+'" class="in" readonly value="'+attr(value||"")+'" style="background:#f7f9f8"></div>';}
  function astStudentInfo(student){
    if(!student)return '<div class="tip" id="awardStatisticsStudentInfo" style="margin:0 0 12px">输入学号或姓名后，自动匹配学院、专业、现在年级、班级和学籍状态；同名学生将弹出候选信息供人工选择。</div>';
    return '<div class="tip" id="awardStatisticsStudentInfo" style="margin:0 0 12px;border-color:#b9d8ca"><b>已匹配学生：</b>'+esc(student.name||"—")+'　学院：'+esc(student.dept||"—")+'　专业：'+esc(student.major||"—")+'　年级：'+esc(student.grade||classGrade(student.cls)||"—")+'　班级：'+esc(student.cls||"—")+'　学籍状态：'+esc(astStatus(student))+'</div>';
  }
  function astCertificateEditor(){
    const old=awardStatisticsExistingCertificate;
    const existing=old?'<div id="awardStatisticsCertificateExisting" class="tip" style="margin:0 0 8px">当前证书：'+astCertificateLink(old)+'　<a class="lk danger" onclick="awardStatisticsRemoveCertificate()">移除</a></div>':'<div id="awardStatisticsCertificateExisting"></div>';
    return '<div class="field" style="grid-column:1/-1"><label>获奖证书</label>'+existing+'<input id="awardStatisticsCertificate" class="in" type="file" accept="application/pdf,image/*"><small style="display:block;color:var(--muted);margin-top:4px">支持 PDF 和图片（JPG、PNG、GIF、WebP、BMP），单个文件不超过 20MB。</small></div>';
  }
  function astFormBody(record){
    const meta=record?astMeta(record):{}, student=record?astStudent(record.sid):null;
    return astStudentInfo(student)+'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px"><div class="field"><label>学号 <span class="req">*</span></label><input id="awardStatisticsSid" class="in" value="'+attr(record?record.sid:"")+'" oninput="awardStatisticsMatchStudent(this.value)"><small style="display:block;color:var(--muted)">输入学号自动匹配其他信息</small></div><div class="field"><label>姓名</label><input id="awardStatisticsName" class="in" value="'+attr(record?meta.name:"")+'" placeholder="输入姓名自动匹配" onchange="awardStatisticsNameAutoFill(this.value)"></div>'+astReadonlyField("awardStatisticsDept","学院",record?meta.dept:"")+astReadonlyField("awardStatisticsMajor","专业",record?meta.major:"")+astReadonlyField("awardStatisticsGrade","现在年级",record?meta.grade:"")+astReadonlyField("awardStatisticsCls","班级",record?meta.cls:"")+'<div class="field"><label>荣誉称号名称</label><input id="awardStatisticsHonorTitle" class="in" value="'+attr(record?record.honorTitle:"")+'"></div><div class="field"><label>学科竞赛名称</label><input id="awardStatisticsCompetitionName" class="in" value="'+attr(record?record.competitionName:"")+'"></div><div class="field"><label>奖项</label><input id="awardStatisticsAward" class="in" value="'+attr(record?record.award:"")+'"></div><div class="field"><label>评定学期</label><input id="awardStatisticsTerm" class="in" value="'+attr(record?record.term:CURRENT_TERM||"")+'" placeholder="如：2025-2026-2学期"></div><div class="field"><label>评定学年</label><input id="awardStatisticsAcademicYear" class="in" value="'+attr(record?record.academicYear:"")+'" placeholder="如：2025-2026学年"></div><div class="field"><label>获奖日期</label><input id="awardStatisticsAwardDate" class="in" type="date" value="'+attr(record?record.awardDate:"")+'"></div>'+astCertificateEditor()+'</div>';
  }
  function astFormValue(id){return astText((document.getElementById(id)||{}).value);}
  async function astUploadCertificate(){
    const file=((document.getElementById("awardStatisticsCertificate")||{}).files||[])[0];
    if(!file)return null;
    const isSupported=/^image\//i.test(file.type||"")||file.type==="application/pdf"||/\.(?:pdf|jpg|jpeg|png|gif|webp|bmp)$/i.test(file.name||"");
    if(!isSupported)throw new Error("获奖证书仅支持 PDF 或图片格式。");
    if(file.size>20*1024*1024)throw new Error("获奖证书超过 20MB，请压缩后重试。");
    const saved=await window.workbench.legacy.attachmentUploadFile(file.name,file);
    return Object.assign({},saved,{name:saved.name||file.name,mime:file.type||"application/octet-stream",size:saved.size||file.size});
  }
  function astFingerprint(record){return [astText(record.sid),astText(record.honorTitle),astText(record.competitionName),astText(record.award),astText(record.awardDate)].join("|");}

  window.awardStatisticsMatchStudent=function(sid){
    const student=astStudent(sid), fields={Name:"name",Dept:"dept",Major:"major",Grade:"grade",Cls:"cls"};
    Object.keys(fields).forEach(function(key){const el=document.getElementById("awardStatistics"+key);if(el)el.value=student?(key==="Grade"?(student.grade||classGrade(student.cls)||""):(student[fields[key]]||"")):"";});
    const info=document.getElementById("awardStatisticsStudentInfo");if(info)info.outerHTML=astStudentInfo(student);
  };
  window.awardStatisticsNameAutoFill=function(name){
    if(typeof resolveStudentNameInput!=="function")return;
    resolveStudentNameInput(name,function(student,typed){
      const fields={Sid:"id",Name:"name",Dept:"dept",Major:"major",Grade:"grade",Cls:"cls"};
      Object.keys(fields).forEach(function(key){const el=document.getElementById("awardStatistics"+key);if(el)el.value=student?(key==="Grade"?(student.grade||classGrade(student.cls)||""):(student[fields[key]]||"")):(key==="Name"?(typed||""):"");});
      const info=document.getElementById("awardStatisticsStudentInfo");if(info)info.outerHTML=astStudentInfo(student);
    },"获奖统计");
  };
  window.awardStatisticsQuery=function(){awardStatisticsFilter={kw:astFormValue("astKw"),dept:astFormValue("astDept"),major:astFormValue("astMajor"),grade:astFormValue("astGrade"),cls:astFormValue("astCls"),status:astFormValue("astStatus")};renderPage("awardStatistics");};
  window.awardStatisticsReset=function(){awardStatisticsFilter={kw:"",dept:"",major:"",grade:"",cls:"",status:""};renderPage("awardStatistics");};
  window.awardStatisticsOpenForm=function(id){
    const record=id?awardStatisticsRecords.find(function(row){return row.id===id;}):null;if(id&&!record)return;
    awardStatisticsExistingCertificate=record&&record.certificate?record.certificate:null;awardStatisticsRemovedCertificate=null;
    openModal(record?"编辑获奖统计":"新增获奖统计",astFormBody(record),async function(){
      const sid=astFormValue("awardStatisticsSid"), student=astStudent(sid);if(!sid){showToast("请填写学号","error");return false;}if(!student){showToast("未在学生管理中匹配到该学号，请核对后重试","error");return false;}
      let uploaded=null;try{uploaded=await astUploadCertificate();}catch(error){showToast("证书上传失败："+(error.message||error),"error");return false;}
      const payload={sid:sid,name:student.name||"",dept:student.dept||"",major:student.major||"",grade:student.grade||classGrade(student.cls)||"",cls:student.cls||"",honorTitle:astFormValue("awardStatisticsHonorTitle"),competitionName:astFormValue("awardStatisticsCompetitionName"),award:astFormValue("awardStatisticsAward"),term:astFormValue("awardStatisticsTerm"),academicYear:astFormValue("awardStatisticsAcademicYear"),awardDate:astFormValue("awardStatisticsAwardDate"),certificate:uploaded||awardStatisticsExistingCertificate};
      const duplicate=awardStatisticsRecords.find(function(row){return row.id!==id&&astFingerprint(row)===astFingerprint(payload);});if(duplicate){if(uploaded)await window.workbench.legacy.attachmentDelete(uploaded.id).catch(function(){});showToast("已存在相同学生、荣誉/竞赛、奖项和日期的记录","warn");return false;}
      try{if(record)Object.assign(record,astNormalize(Object.assign({},record,payload,{updatedAt:fmtNow()})));else awardStatisticsRecords.unshift(astNormalize(payload));awardStatisticsPersist();}
      catch(error){if(uploaded)await window.workbench.legacy.attachmentDelete(uploaded.id).catch(function(){});throw error;}
      if(awardStatisticsRemovedCertificate&&awardStatisticsRemovedCertificate.id)await window.workbench.legacy.attachmentDelete(awardStatisticsRemovedCertificate.id).catch(function(){showToast("记录已保存，但原证书附件删除失败","warn");});
      renderPage("awardStatistics");showToast(record?"获奖统计已更新，学生画像已联动刷新":"获奖统计已保存，学生画像已联动更新","success");return true;
    });
  };
  window.awardStatisticsRemoveCertificate=function(){
    if(!awardStatisticsExistingCertificate)return;awardStatisticsRemovedCertificate=awardStatisticsExistingCertificate;awardStatisticsExistingCertificate=null;
    const box=document.getElementById("awardStatisticsCertificateExisting");if(box)box.innerHTML='<span class="muted">已标记移除；保存后将删除原附件。</span>';
  };
  window.awardStatisticsView=function(id){
    const record=awardStatisticsRecords.find(function(row){return row.id===id;});if(!record)return;const meta=astMeta(record);
    const fields=[["姓名",meta.name],["学号",record.sid],["学院",meta.dept],["专业",meta.major],["现在年级",meta.grade],["班级",meta.cls],["学籍状态",meta.status],["荣誉称号名称",record.honorTitle],["学科竞赛名称",record.competitionName],["奖项",record.award],["评定学期",record.term],["评定学年",record.academicYear],["获奖日期",record.awardDate]];
    openModal("获奖统计详情",'<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">'+fields.map(function(pair){return '<div class="field"><label>'+pair[0]+'</label><div class="in" style="background:#f7f9f8;min-height:38px">'+esc(pair[1]||"未填写")+'</div></div>';}).join("")+'</div><div class="field" style="margin-top:10px"><label>获奖证书</label><div class="tip" style="margin:0">'+astCertificateLink(record.certificate)+'</div></div>',function(){return true;});
  };
  window.awardStatisticsDelete=async function(id){
    const record=awardStatisticsRecords.find(function(row){return row.id===id;});if(!record)return;
    const moved=await window.recycleMoveRecords("awardStatistics","award_statistics_record",[id]);if(!moved)return;renderPage("awardStatistics");showToast("获奖统计已移入回收站，学生画像已联动更新","success");
  };
  window.awardStatisticsDownloadTemplate=function(){downloadXlsxFile("获奖统计",[AWARD_STATISTICS_FIELDS.map(function(field){return field.label;}),new Array(AWARD_STATISTICS_FIELDS.length).fill("")],"获奖统计导入模板.xlsx");};
  window.awardStatisticsExport=function(){
    const rows=awardStatisticsFiltered();if(!rows.length){showToast("暂无可导出的获奖统计记录","warn");return;}
    downloadXlsxFile("获奖统计",[AWARD_STATISTICS_FIELDS.map(function(field){return field.label;})].concat(rows.map(function(record){const meta=astMeta(record);return [meta.name,record.sid,meta.dept,meta.major,meta.grade,meta.cls,record.honorTitle,record.competitionName,record.award,record.term,record.academicYear,record.awardDate,(record.certificate&&record.certificate.name)||record.certificateImportName||""];})),"获奖统计_"+xcmStamp()+".xlsx");showToast("已导出 "+rows.length+" 条获奖统计记录","success");
  };
  window.awardStatisticsImport=function(){
    openMappedImportWizard({name:"获奖统计",fields:AWARD_STATISTICS_FIELDS,requiredFields:["学号"],template:"awardStatisticsDownloadTemplate()",infoHtml:"已识别 Excel 数据。导入将按学号自动匹配学生的姓名、学院、专业、现在年级、班级和学籍状态；“获奖证书”列仅保留文件名，实际证书请在编辑中上传 PDF 或图片。",validate:function(rows){
      const ok=[],errors=[];rows.forEach(function(row,index){const sid=astText(row.sid),student=astStudent(sid);if(!sid){errors.push({row:index+2,msg:"学号不能为空"});return;}if(!student){errors.push({row:index+2,msg:"学号“"+sid+"”未在学生管理中找到"});return;}ok.push(astNormalize({sid:sid,name:student.name,dept:student.dept,major:student.major,grade:student.grade||classGrade(student.cls)||"",cls:student.cls,honorTitle:row.honorTitle,competitionName:row.competitionName,award:row.award,term:row.term,academicYear:row.academicYear,awardDate:row.awardDate,certificateImportName:row.certificate}));});return {ok:ok,errors:errors};},apply:function(rows){
      let added=0,updated=0;rows.forEach(function(row){const old=awardStatisticsRecords.find(function(item){return astFingerprint(item)===astFingerprint(row);});if(old){Object.assign(old,astNormalize(Object.assign({},old,row,{certificate:old.certificate,customFieldValues:old.customFieldValues,updatedAt:fmtNow()})));updated++;}else{awardStatisticsRecords.push(row);added++;}});awardStatisticsPersist();return {ok:added+updated,skip:0};},after:function(result){renderPage("awardStatistics");showToast("获奖统计导入完成：新增/更新 "+result.ok+" 条；学生画像已联动更新","success");}});
  };
  window.awardStatisticsRecordsForStudent=function(sid){return awardStatisticsRecords.filter(function(record){return String(record.sid||"")===String(sid||"");}).map(astStrip);};

  awardStatisticsLoad();
  if(typeof BACKUP_KEYS!=="undefined"&&BACKUP_KEYS.indexOf(AWARD_STATISTICS_KEY)<0)BACKUP_KEYS.push(AWARD_STATISTICS_KEY);
  VIEWS.awardStatistics="获奖统计";
  PAGES.awardStatistics=awardStatisticsPage;
})();
