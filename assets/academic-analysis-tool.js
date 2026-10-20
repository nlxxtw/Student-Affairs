(function(){
  "use strict";
  const file=document.getElementById("file"),teacherFile=document.getElementById("teacherFile"),go=document.getElementById("go"),clear=document.getElementById("clear"),downloadTeacherTemplate=document.getElementById("downloadTeacherTemplate");
  const status=document.getElementById("status"),result=document.getElementById("result"),metrics=document.getElementById("metrics");
  const progress=document.getElementById("progress"),fileName=document.getElementById("fileName"),teacherFileName=document.getElementById("teacherFileName"),issues=document.getElementById("issues"),drop=document.getElementById("drop"),teacherDrop=document.getElementById("teacherDrop");
  const historyList=document.getElementById("historyList"),historyStatus=document.getElementById("historyStatus"),refreshHistory=document.getElementById("refreshHistory"),clearHistory=document.getElementById("clearHistory");
  const DOWNLOAD_META={summary:{name:"学业考试成绩分析统计表.xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},reports:{name:"学业分析报告.zip",mime:"application/zip"},audit:{name:"校验报告.json",mime:"application/json; charset=utf-8"}};
  let latestSummary=null,historyCache=[];
  function setFiles(){const picked=file.files&&file.files[0],teachers=teacherFile&&teacherFile.files&&teacherFile.files[0];go.disabled=!picked;fileName.textContent=picked?picked.name:"尚未选择文件";teacherFileName.textContent=teachers?teachers.name:"暂不使用班主任名单";status.textContent=picked?(teachers?"已选择成绩表和班主任名单，可以开始统计。":"已选择成绩表；可选上传班主任名单后写入报告。 "):"请选择成绩文件";}
  function reset(){file.value="";if(teacherFile)teacherFile.value="";latestSummary=null;setFiles();result.hidden=true;issues.textContent="";progress.hidden=true;}
  function downloadTeacherListTemplate(){const workbook=XLSX.utils.book_new(),list=XLSX.utils.aoa_to_sheet([["班级","班主任"],["示例班级","示例班主任"]]);list["!cols"]=[{wch:24},{wch:18}];XLSX.utils.book_append_sheet(workbook,list,"班主任名单");XLSX.writeFile(workbook,"班主任名单导入模板.xlsx",{compression:true});}
  function safeName(name){return String(name||"").replace(/[\r\n]/g,"").slice(0,180);}
  function metric(value,label){return '<div class="metric"><b>'+Number(value||0)+'</b><span>'+label+'</span></div>';}
  function downloadUrl(file){const raw=String(file&&file.url||"");if(!raw)return "";const separator=raw.includes("?")?"&":"?";return raw+separator+"name="+encodeURIComponent(String(file.name||"下载文件"))+"&type="+encodeURIComponent(String(file.mime||"application/octet-stream"));}
  function setDownload(id,url,name,mime){const a=document.getElementById(id),meta=DOWNLOAD_META[id]||{};const file={url:url,name:name||meta.name||"下载文件",mime:mime||meta.mime||"application/octet-stream"};a.href=downloadUrl(file);a.setAttribute("download",file.name);}
  function escapeHtml(value){return String(value==null?"":value).replace(/[&<>"']/g,function(char){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char];});}
  function dateText(value){const date=new Date(value);return Number.isNaN(date.getTime())?"时间未知":date.toLocaleString("zh-CN",{hour12:false});}
  function historyDownload(file,label){return file?'<a href="'+escapeHtml(downloadUrl(file))+'" download="'+escapeHtml(file.name)+'">'+label+'</a>':'<span class="history-meta">—</span>';}
  async function fetchOutput(url,name,role){const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error("无法读取"+name);return {name:name,role:role,mime:response.headers.get("content-type")||"application/octet-stream",blob:await response.blob()};}
  async function deleteRunFolder(runId){const response=await fetch("/api/academic-analysis/run/"+encodeURIComponent(runId),{method:"DELETE"});if(!response.ok&&response.status!==404){const body=await response.json().catch(function(){return {};});throw new Error(body.error||"临时结果清理失败");}}
  async function persistRun(row,aiSummary){
    const downloads=row.downloads||{},available=row.available||{summary:true,reports:true,audit:true},files=[];
    if(available.summary&&downloads.summary)files.push(await fetchOutput(downloads.summary,"学业考试成绩分析统计表.xlsx","summary"));
    if(available.reports&&downloads.reports)files.push(await fetchOutput(downloads.reports,"学业分析报告.zip","reports"));
    if(available.audit&&downloads.audit)files.push(await fetchOutput(downloads.audit,"校验报告.json","audit"));
    const record={id:row.runId,at:row.createdAt||new Date().toISOString(),title:"学业分析："+(row.sourceFile||"成绩文件.xlsx"),summary:Number(row.classes||0)+"个班 · "+Number(row.students||0)+"名学生",sourceFile:row.sourceFile||"成绩文件.xlsx",classes:Number(row.classes||0),students:Number(row.students||0),validRecords:Number(row.validRecords||0),issueCount:Number(row.issueCount||0),aiSummary:aiSummary||null};
    const saved=await ToolHistory.save("academicAnalysis",record,files);
    // 加密数据库和附件库已落盘即视为成功；旧临时目录清理失败时，
    // 下次进入历史页会继续清理，不能把已保存的结果误报成生成失败。
    await deleteRunFolder(row.runId).catch(function(){});return saved;
  }
  async function migrateDiskHistory(){
    const existing=await ToolHistory.list("academicAnalysis"),known=new Set(existing.map(function(item){return item.id;}));
    const response=await fetch("/api/academic-analysis/history",{cache:"no-store"}),payload=await response.json().catch(function(){return {};});
    if(!response.ok||!payload.ok)throw new Error(payload.error||("服务返回 "+response.status));
    for(const row of Array.isArray(payload.records)?payload.records:[]){if(known.has(row.runId)){await deleteRunFolder(row.runId).catch(function(){});continue;}try{await persistRun(row,null);known.add(row.runId);}catch(_error){/* 原目录保留，下一次进入继续迁移。 */}}
  }
  async function loadHistory(){
    if(!historyList)return;
    if(refreshHistory)refreshHistory.disabled=true;if(clearHistory)clearHistory.disabled=true;historyStatus.textContent="正在读取系统数据库历史记录……";
    try{
      await migrateDiskHistory();const index=await ToolHistory.list("academicAnalysis");historyCache=(await Promise.all(index.map(function(item){return ToolHistory.get("academicAnalysis",item.id);}))).filter(Boolean);
      historyStatus.textContent=historyCache.length?"共 "+historyCache.length+" 条数据库记录；切换页面或重启后仍可恢复，只有手动删除才会清除。":"暂无历史记录，完成一次统计后会自动保存到数据库。";
      historyList.innerHTML=historyCache.length?historyCache.map(function(row){const files=row.attachments||[],summaryFile=files.find(function(file){return file.role==="summary";}),reportsFile=files.find(function(file){return file.role==="reports";}),auditFile=files.find(function(file){return file.role==="audit";});return '<tr><td>'+escapeHtml(dateText(row.at))+'</td><td><span class="history-file" title="'+escapeHtml(row.sourceFile)+'">'+escapeHtml(row.sourceFile||"成绩文件.xlsx")+'</span></td><td><span class="history-meta">'+Number(row.classes||0)+'个班 · '+Number(row.students||0)+'名学生<br>'+Number(row.validRecords||0)+'条有效成绩</span></td><td>'+Number(row.issueCount||0)+' 条</td><td><div class="history-downloads">'+historyDownload(summaryFile,"统计表")+historyDownload(reportsFile,"班级报告")+historyDownload(auditFile,"校验报告")+'</div></td><td><div class="history-downloads"><button type="button" class="secondary compact" data-history-view="'+escapeHtml(row.id)+'">恢复</button><button type="button" class="danger compact" data-history-delete="'+escapeHtml(row.id)+'">删除记录</button></div></td></tr>';}).join(""):'<tr><td class="history-empty" colspan="6">暂无历史生成记录</td></tr>';
    }catch(error){historyStatus.textContent="历史记录读取失败："+(error&&error.message?error.message:"未知错误");historyList.innerHTML='<tr><td class="history-empty" colspan="6">暂时无法读取历史记录</td></tr>';}
    finally{if(refreshHistory)refreshHistory.disabled=false;if(clearHistory)clearHistory.disabled=false;}
  }
  file.addEventListener("change",setFiles);if(teacherFile)teacherFile.addEventListener("change",setFiles);if(downloadTeacherTemplate)downloadTeacherTemplate.addEventListener("click",downloadTeacherListTemplate);clear.addEventListener("click",reset);
  if(refreshHistory)refreshHistory.addEventListener("click",loadHistory);
  if(clearHistory)clearHistory.addEventListener("click",async function(){if(!historyCache.length)return;if(!confirm("确定清空全部学业分析历史及生成文件？此操作不可恢复。"))return;try{await ToolHistory.clear("academicAnalysis");historyCache=[];await loadHistory();}catch(error){historyStatus.textContent="清空失败："+error.message;}});
  if(historyList)historyList.addEventListener("click",async function(event){const view=event.target.closest("[data-history-view]"),del=event.target.closest("[data-history-delete]");if(view){const row=historyCache.find(function(item){return item.id===view.dataset.historyView;});if(!row)return;const files=row.attachments||[];["summary","reports","audit"].forEach(function(role){const saved=files.find(function(item){return item.role===role;});if(saved)setDownload(role,saved.url,saved.name,saved.mime);});metrics.innerHTML=metric(row.classes,"班级")+metric(row.students,"学生")+metric(row.validRecords,"有效成绩")+metric(row.issueCount,"校验提示");issues.textContent=row.issueCount?"历史记录包含 "+row.issueCount+" 条校验提示，请下载校验报告人工核对。":"未发现需要人工处理的校验提示。";latestSummary=row.aiSummary||null;result.hidden=false;status.textContent="已恢复数据库历史结果。";window.parent.postMessage({type:"academic-analysis-ready",summary:latestSummary},location.origin);return;}if(del){const row=historyCache.find(function(item){return item.id===del.dataset.historyDelete;}),title=row&&row.sourceFile||"该历史记录";if(!confirm("确定删除“"+title+"”的历史记录及生成文件吗？\n\n删除后无法恢复，但不会影响学生数据及其他历史记录。"))return;try{del.disabled=true;await ToolHistory.remove("academicAnalysis",del.dataset.historyDelete);await loadHistory();}catch(error){del.disabled=false;historyStatus.textContent="删除失败："+error.message;}}});
  ["dragenter","dragover"].forEach(function(type){drop.addEventListener(type,function(event){event.preventDefault();drop.classList.add("drag");});});
  ["dragleave","drop"].forEach(function(type){drop.addEventListener(type,function(){drop.classList.remove("drag");});});
  go.addEventListener("click",async function(){
    const picked=file.files&&file.files[0],teachers=teacherFile&&teacherFile.files&&teacherFile.files[0];if(!picked)return;
    if(!/\.xlsx$/i.test(picked.name)||/^~\$/.test(picked.name)||(teachers&&(!/\.xlsx$/i.test(teachers.name)||/^~\$/.test(teachers.name)))){status.textContent="成绩表和班主任名单均仅支持非锁定的 .xlsx 文件。";return;}
    go.disabled=true;result.hidden=true;progress.hidden=false;status.textContent="正在本机解析、统计并生成 Excel 与 Word，请稍候……";
    try{
      const body=new FormData();body.append("file",picked,safeName(picked.name));if(teachers)body.append("teacherFile",teachers,safeName(teachers.name));const response=await fetch("/api/academic-analysis/run",{method:"POST",body:body});
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||!payload.ok)throw new Error(payload.error||("服务返回 "+response.status));
      const o=payload.overview||{};
      metrics.innerHTML=metric(o.classes,"班级")+metric(o.students,"学生")+metric(o.valid_records,"有效成绩")+metric((o.issues||[]).length,"校验提示");
      Object.keys(payload.downloads||{}).forEach(function(key){const meta=DOWNLOAD_META[key]||{};setDownload(key,payload.downloads[key],meta.name,meta.mime);});
      issues.textContent=(o.issues||[]).length?"发现 "+o.issues.length+" 条校验提示，请下载校验报告人工核对。":"未发现需要人工处理的校验提示。";
      latestSummary=payload.aiSummary||null;result.hidden=false;status.textContent="正在将结果写入系统数据库……";
      window.parent.postMessage({type:"academic-analysis-ready",summary:latestSummary},location.origin);
      const saved=await persistRun({runId:payload.runId,createdAt:new Date().toISOString(),sourceFile:picked.name,classes:o.classes,students:o.students,validRecords:o.valid_records,issueCount:(o.issues||[]).length,available:{summary:true,reports:true,audit:true},downloads:payload.downloads},latestSummary);
      ["summary","reports","audit"].forEach(function(role){const stored=(saved.attachments||[]).find(function(item){return item.role===role;});if(stored)setDownload(role,stored.url,stored.name,stored.mime);});
      status.textContent="生成完成，结果已保存到系统数据库和加密附件库。";
      await loadHistory();
    }catch(error){status.textContent="生成失败："+(error&&error.message?error.message:"未知错误");}
    finally{go.disabled=false;progress.hidden=true;}
  });
  window.addEventListener("message",function(event){
    if(event.origin!==location.origin||!event.data||event.data.type!=="academic-analysis-summary-request")return;
    window.parent.postMessage({type:"academic-analysis-summary-response",requestId:event.data.requestId,summary:latestSummary},event.origin);
  });
  setFiles();loadHistory();
})();
