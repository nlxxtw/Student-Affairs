/* Learning-platform matrices are parsed locally; only reviewed records are committed. */
(function(root){
  "use strict";
  const text = value => String(value == null ? "" : value).trim();
  const copy = value => JSON.parse(JSON.stringify(value));
  const dateText=value=>text(value).normalize("NFKC").replace(/\s+(?=[年月日/.-])|(?<=[年月/.-])\s+/g,"");
  const fullDatePattern=()=>/(?<!\d)(20\d{2})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})日?(?!\d)/g;
  const compactDatePattern=()=>/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g;
  const monthDayPattern=()=>/(^|[^\d第])(\d{1,2})[月\/.-](\d{1,2})日?(?![\d节])/g;
  const known = Object.freeze(Object.assign(Object.create(null),{"已签":"出勤","已签到":"出勤","签到成功":"出勤","教师代签":"出勤","未参与":"旷课","未签到":"旷课","缺勤":"旷课","旷课":"旷课","迟到":"迟到","早退":"早退","事假":"事假","病假":"病假","公假":"公假"}));
  const leave = value => ["事假","病假","公假"].includes(value);
  function summarizeDetails(details){
    const summarize=rows=>{
      const result={total:rows.length,attended:0,absent:0,late:0,early:0,personalLeave:0,sickLeave:0,publicLeave:0,leave:0};
      rows.forEach(d=>{const statuses=d.result;result.absent+=statuses.includes("旷课")?1:0;result.late+=statuses.includes("迟到")?1:0;result.early+=statuses.includes("早退")?1:0;result.personalLeave+=statuses.includes("事假")?1:0;result.sickLeave+=statuses.includes("病假")?1:0;result.publicLeave+=statuses.includes("公假")?1:0;result.leave+=statuses.some(leave)?1:0;result.attended+=!statuses.includes("旷课")&&!statuses.some(leave)?1:0;});
      result.rate=result.total?(result.attended/result.total*100).toFixed(1)+"%":"—";return result;
    };
    return Object.assign(summarize(details),{classes:[...new Set(details.map(d=>d.cls))].sort().map(cls=>Object.assign({cls},summarize(details.filter(d=>d.cls===cls))))});
  }
  function checkWorkbookBytes(bytes,extension){
    if(extension!=="xlsx")return;
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=bytes.byteLength;
    if(length<22||view.getUint32(0,true)!==0x04034b50)throw Error("文件不是有效的Excel工作簿");
    let end=-1;
    for(let i=length-22;i>=Math.max(0,length-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===length){end=i;break;}}
    if(end<0)throw Error("Excel压缩目录损坏");
    const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
    if(view.getUint32(end+4,true)!==0||!count||count>2000||offset+directorySize>end)throw Error("Excel压缩目录无效或内容过多，请拆分文件");
    let position=offset,total=0;
    for(let i=0;i<count;i++){
      if(position+46>offset+directorySize||view.getUint32(position,true)!==0x02014b50)throw Error("Excel压缩目录损坏");
      const unpacked=view.getUint32(position+24,true),packed=view.getUint32(position+20,true),local=view.getUint32(position+42,true);
      total+=unpacked;
      if(unpacked>64*1024*1024||total>100*1024*1024)throw Error("Excel解压后内容超过安全读取上限，请拆分文件");
      if((view.getUint16(position+8,true)&1)||![0,8].includes(view.getUint16(position+10,true))||local+30>offset||packed>length)throw Error("Excel压缩内容不受支持，请重新导出文件");
      position+=46+view.getUint16(position+28,true)+view.getUint16(position+30,true)+view.getUint16(position+32,true);
    }
    if(position!==offset+directorySize)throw Error("Excel压缩目录损坏");
  }
  function outcome(start, end){
    const a=known[text(start)], b=known[text(end)];
    if(end === undefined)return a?[a]:null;
    if(!a||!b)return null;
    if(leave(a)||leave(b))return a===b?[a]:null;
    const result=[];
    if(a==="旷课"&&b==="旷课")return ["旷课"];
    if(a==="迟到"||b==="迟到"||a==="旷课")result.push("迟到");
    if(a==="早退"||b==="早退"||b==="旷课")result.push("早退");
    return result.length?result:["出勤"];
  }
  function validDate(y,m,d){
    const date=new Date(Date.UTC(+y,+m-1,+d));
    return date.getUTCFullYear()===+y&&date.getUTCMonth()===+m-1&&date.getUTCDate()===+d?`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`:"";
  }
  function readDate(value, term){
    const title=dateText(value),warnings=[],complete=v=>[...v.matchAll(fullDatePattern()),...v.matchAll(compactDatePattern())];
    const all=complete(title),brackets=[...title.matchAll(/\(([^()]+)\)/g)].flatMap(m=>complete(m[1])),candidates=brackets.length?brackets:all;
    const dates=candidates.map(m=>validDate(m[1],m[2],m[3]));
    const fail=error=>({date:"",warnings:[error],error,inferred:false});
    if(dates.some(d=>!d))return fail("日期无效，请核对原签到标题");
    if(new Set(dates).size>1)return fail("同一签到标题含多个不同完整日期，请人工确认");
    let date=dates[0]||"",inferred=false;
    const remaining=title.replace(fullDatePattern(),"").replace(compactDatePattern(),"");
    const md=[...remaining.matchAll(monthDayPattern())];
    if(date){
      if(all.some(m=>validDate(m[1],m[2],m[3])!==date)||md.some(m=>+m[2]!==+date.slice(5,7)||+m[3]!==+date.slice(8)))warnings.push("标题日期冲突，已采用括号中的完整日期，请核对");
    }else if(md.length){
      if(new Set(md.map(m=>+m[2]+"/"+(+m[3]))).size>1)return fail("同一签到标题含多个不同月日，请人工确认");
      const t=text(term).match(/(20\d{2})-(20\d{2})-([12])/);
      if(t){date=validDate(t[t[3]==="2"||+md[0][2]<7?2:1],md[0][2],md[0][3]);if(!date)return fail("日期无效，请核对原签到标题");inferred=true;warnings.push("年份按所选学期补全，请核对");}
    }
    return {date,warnings,inferred,error:date?"":"未识别完整日期，请补选"};
  }
  function courseFromTitle(title){
    if(/班会|班级会议|主题活动|班级活动/.test(title))return "班会";
    return text(dateText(title).replace(/^新(?=\d)/,"").replace(/[（(][^()（）]*20\d{2}[^()（）]*[）)]/g,"")
      .replace(/【(?:周[一二三四五六日天]|\d+月)[^】]*】/g,"")
      .replace(fullDatePattern(),"").replace(compactDatePattern(),"").replace(monthDayPattern(),"$1")
      .replace(/T?(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?!\d)/g,"")
      .replace(/第?\d+(?:[-~至]\d+)?节|下课签退|下课|上课|签退|签到|下午|上午/g,"")
      .replace(/^(半期考|期中考试|期末考试|考试|补签)$/g,"")
      .replace(/^[\s《》【】()（）]+|[\s《》【】()（）]+$/g,""));
  }
  function parseSheet(rows,file,sheet,readCell){
    const clean=v=>text(v).replace(/\s+/g,"");
    const header=rows.findIndex(r=>r.some(v=>/^(学号(?:\/工号)?|学号／工号|工号)$/.test(clean(v)))&&r.some(v=>clean(v)==="姓名"));
    if(header<0)throw Error(sheet+"：未找到姓名及学号表头");
    const headings=rows[header], idCol=headings.findIndex(v=>/^(学号(?:\/工号)?|学号／工号|工号)$/.test(clean(v))),nameCol=headings.findIndex(v=>clean(v)==="姓名");
    const meta=rows.slice(0,header).flat().map(text).join(" "), take=label=>text((meta.match(new RegExp(label+"[：:]\\s*(.*?)(?=\\s+(?:班级|任课教师|导出时间)[：:]|$)"))||[])[1]);
    const report={file,sheet,course:take("课程"),teacher:take("任课教师"),teachingClass:take("班级"),students:[],activities:[]};
    if(/^[Xx＊*]+$/.test(report.teacher))report.teacher="";
    const info=new Set([idCol,nameCol,...headings.map((v,i)=>/^(院系|学院|专业|行政班级|班级)$/.test(clean(v))?i:-1)]);
    const hasSub=(rows[header+1]||[]).some(v=>clean(v)==="状态");
    headings.forEach((v,col)=>{
      const title=text(v);if(info.has(col)||!title||/^(合计|总计|备注|签到次数|出勤率|次数)$/.test(title))return;
      if(hasSub&&clean((rows[header+1]||[])[col])!=="状态")return;
      const date=readDate(title,"");
      if(!date.date&&!monthDayPattern().test(dateText(title))&&!/签到|上课|下课|签退|班会/.test(title))return;
      const period=(title.match(/(?:第)?(\d+(?:[-~至]\d+)?)节/)||[])[1];
      report.activities.push({col,title,date:date.date,warnings:date.warnings,course:courseFromTitle(title),phase:/下课|签退/.test(title)?"end":/上课/.test(title)?"start":"",period:period?"第"+period+"节":"",teacher:report.teacher});
    });
    if(!report.activities.length)throw Error(sheet+"：未找到有效签到活动列");
    for(let i=header+(hasSub?2:1);i<rows.length;i++){
      const row=rows[i]||[],name=text(row[nameCol]);let raw=row[idCol];
      const cell=readCell&&readCell(i,idCol);
      if(typeof raw==="number"&&Number.isSafeInteger(raw)&&Math.abs(raw)<1e15&&cell&&/^0\d+$/.test(text(cell.w))&&Number(cell.w)===raw)raw=text(cell.w);
      if(!name&&!text(raw)&&!report.activities.some(a=>text(row[a.col])))continue;
      if(/^(合计|总计|说明|备注|姓名)$/.test(name)||/^(学号|学号\/工号)$/.test(text(raw)))continue;
      const badNumber=typeof raw==="number"&&(!Number.isSafeInteger(raw)||Math.abs(raw)>=1e15);
      report.students.push({id:badNumber?"":text(raw),name,row:i+1,excluded:false,problem:badNumber?"学号数值精度不可确认":"",states:report.activities.map(a=>text(row[a.col]))});
    }
    if(!report.students.length)throw Error(sheet+"：没有学生数据");
    const explicit=new Set(report.activities.map(a=>a.course).filter(Boolean));
    report.activities.forEach(a=>{if(!a.course&&explicit.size<=1&&!/^[Xx＊*]+$/.test(report.course))a.course=report.course.replace(/[《》]/g,"");});
    return report;
  }
  const api={parseSheet,readDate,outcome,courseFromTitle,checkWorkbookBytes,summarizeDetails};root.ChaoxingAttendance=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(typeof document==="undefined")return;

  let state=null,busy=false,studentLookup=new Map();
  const historyKey="nnuzc_chaoxing_imports";
  function knownTeachingClass(value){return !!text(value)&&!/^([Xx＊*\s]+|未知|未填写|无|—)$/.test(text(value));}
  function sourceIdentity(key){
    try{const parts=JSON.parse(key);return Array.isArray(parts)&&[6,7].includes(parts.length)?JSON.stringify(parts.slice(0,5).concat([knownTeachingClass(parts[0])?[]:parts[parts.length-1]])):key;}catch(_){return key;}
  }
  function sourceTermScope(titles,term){return titles.every(title=>!readDate(title,"").date)?term:"";}
  function matchesSource(record,key,term,titles){return sourceIdentity(record.sourceActivityKey)===sourceIdentity(key)&&(!sourceTermScope(titles,term)||record.term===term);}
  function linkedRows(roster,id){
    return roster.map(s=>({sid:String(s.id),rows:copy((s.classroom||[]).filter(r=>r.sourceCheckClassId===id)).sort((a,b)=>String(a.id).localeCompare(String(b.id)))})).filter(s=>s.rows.length).sort((a,b)=>a.sid.localeCompare(b.sid));
  }
  function sameLinkedRows(actual,expected){
    const comparable=rows=>rows.map(s=>({sid:s.sid,rows:s.rows.map(r=>{const value=copy(r);delete value.customFieldRecordId;return value;})}));
    return JSON.stringify(comparable(actual))===JSON.stringify(comparable(expected));
  }
  const html=v=>esc(text(v));
  const canWrite=()=>!root.__WORKBENCH_READ_ONLY__&&!root.__workbenchSessionInvalid;
  function history(){
    let list;
    try{list=JSON.parse(localStorage.getItem(historyKey)||"[]");}catch(_){throw Error("学习通导入历史格式异常，请恢复正确备份后重试");}
    if(!Array.isArray(list)||list.some(h=>!h||typeof h.id!=="string"||!Array.isArray(h.files)||!Array.isArray(h.records)||h.records.some(r=>!r||typeof r.id!=="string"||!r.after)))throw Error("学习通导入历史格式异常，请恢复正确备份后重试");
    return list;
  }
  function setMessage(message){const el=document.getElementById("cxMessage");if(el)el.textContent=message;}
  function indexStudents(){studentLookup=new Map();students.forEach(s=>{const id=String(s.id);studentLookup.set(id,studentLookup.has(id)?null:s);});}
  function matchedStudent(row){const s=studentLookup.get(row.id);return s&&isOnCampusStudent(s)?s:null;}
  function open(){
    if(!canWrite()){showToast("当前账号无法导入考勤","warn");return;}
    if(busy)return;
    state={reports:[],activities:[],prepared:null,batchId:genId("cxBatch"),recordIds:{},returnView:currentView};
    openModal("导入学习通考勤",'<div id="cxImport"><p class="tip">按学号匹配；未参与记旷课。同堂上/下课配对可识别迟到、早退。文件仅在本地解析。</p><div class="row2"><div class="field"><label>选择文件（可多选，每文件≤20MB）</label><input id="cxFiles" type="file" accept=".xlsx,.xls" multiple></div><div class="field"><label>批量设置学期</label><select id="cxTerm" class="in">'+termOptionsHTML(CURRENT_TERM)+'</select></div></div><div id="cxMessage" role="status" aria-live="polite"></div><div id="cxBody"></div></div>',async()=>{
      if(!state||busy)return false;
      if(!state.prepared){preview();return false;}
      return commit();
    });
    document.getElementById("modalOk").textContent="预览考勤";
    document.getElementById("cxFiles").onchange=e=>loadFiles(e.target.files);
    document.getElementById("cxTerm").onchange=e=>{state.activities.forEach(a=>{a.term=e.target.value;refreshInferredDate(a);});invalidate();render();};
  }
  function refreshInferredDate(a){const d=readDate(a.title,a.term);if(a.dateInferred||!a.date){a.date=d.date;a.dateInferred=d.inferred;a.warnings=d.warnings;}}
  async function ensureXlsx(){
    if(root.XLSX)return;
    await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="/xlsx.full.min.js";s.onload=resolve;s.onerror=()=>reject(Error("Excel读取组件加载失败"));document.head.appendChild(s);});
  }
  async function loadFiles(files){
    const session=state;if(busy||!session)return;
    session.reports=[];session.activities=[];session.overrides={};invalidate();render();
    busy=true;setMessage("正在识别文件…");
    try{
      await ensureXlsx();const reports=[];
      for(const file of Array.from(files)){
        if(!/\.(xlsx|xls)$/i.test(file.name)||file.size>20*1024*1024)throw Error("请选择20MB以内的Excel文件");
        const bytes=new Uint8Array(await file.arrayBuffer());checkWorkbookBytes(bytes,file.name.toLowerCase().split('.').pop());
        const book=root.XLSX.read(bytes,{type:"array"});let found=0;
        for(const sheet of book.SheetNames){
          const ws=book.Sheets[sheet];if(!ws["!ref"])continue;
          const range=root.XLSX.utils.decode_range(ws["!ref"]);if((range.e.r+1)*(range.e.c+1)>2000000)throw Error("工作表超过200万单元格，请拆分文件后导入");
          const rows=root.XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});
          if(!rows.some(r=>r.some(v=>/学号|工号/.test(text(v)))))continue;
          reports.push(parseSheet(rows,file.name,sheet,(row,col)=>ws[root.XLSX.utils.encode_cell({r:row,c:col})]));found++;
        }
        if(!found)throw Error(file.name+"：没有识别到学习通签到表");
      }
      if(state!==session)return;
      state.reports=reports;state.activities=[];
      reports.forEach((report,ri)=>report.activities.forEach((a,ai)=>{
        const item=Object.assign({},a,{ri,ai,key:ri+":"+ai,enabled:true,term:document.getElementById("cxTerm").value,pair:"",category:"",location:""});
        const d=readDate(item.title,item.term);item.date=d.date;item.dateInferred=d.inferred;item.warnings=d.warnings;
        // A fully specified date may belong to a historical term.
        const candidates=getTermList().filter(t=>{const cfg=getTermSettings()[t]||{},end=termEndDate(cfg.startDate,cfg.totalWeeks);return cfg.startDate&&end&&item.date>=cfg.startDate&&item.date<=end;});
        if(candidates.length===1)item.term=candidates[0];
        if(candidates.length>1)item.warnings.push("日期落入多个学期校历，请确认所选学期");
        state.activities.push(item);
      }));
      autoMatch();render();
      const allAbsent=reports.reduce((n,r)=>n+r.activities.filter((a,i)=>r.students.every(s=>known[s.states[i]]==="旷课")).length,0);
      setMessage("已识别 "+reports.reduce((n,r)=>n+r.students.length,0)+" 个学生行、"+state.activities.length+" 场原始签到。请核对课程、日期和配对。"+(allAbsent?"\n其中 "+allAbsent+" 场全员未签，按已确定规则记旷课；如活动取消，请取消勾选。":""));
    }catch(error){setMessage(error.message);}finally{busy=false;}
  }
  function autoMatch(){
    indexStudents();
    state.activities.forEach(a=>{
      if(a.course==="班会")return;
      const classes=[...new Set(state.reports[a.ri].students.filter(s=>!s.excluded).map(matchedStudent).filter(Boolean).map(s=>s.cls))];
      const perClass=classes.map(c=>courseScheduleMatches(a.term,c,a.date).rows.filter(r=>(!a.course||r.course===a.course)&&(!a.period||r.section===a.period)));
      if(!classes.length||perClass.some(rows=>!rows.length))return;
      const rows=perClass.flat();
      const signatures=[...new Set(rows.map(r=>[r.course,r.section,r.teacher||"",r.location||"",r.category||""].join("|")))];
      if(signatures.length===1){const r=rows[0];["course","teacher","location","category"].forEach(k=>{if(!a[k])a[k]=r[k]||"";});if(!a.period)a.period=r.section;}
    });
    state.activities.filter(a=>a.phase==="end"&&!a.pair).forEach(a=>{
      const session=v=>(v.title.match(/凌晨|上午|中午|下午|晚上|晚间/)||[])[0]||"";
      const starts=state.activities.filter(b=>b.ri===a.ri&&b.phase==="start"&&b.course&&b.course===a.course&&b.term===a.term&&b.date===a.date&&b.period===a.period&&session(b)===session(a));
      const ends=state.activities.filter(b=>b.ri===a.ri&&b.phase==="end"&&b.course===a.course&&b.term===a.term&&b.date===a.date&&b.period===a.period&&session(b)===session(a));
      if(starts.length===1&&ends.length===1)a.pair=starts[0].key;
    });
  }
  function render(){
    if(!state||!document.getElementById("cxBody"))return;
    indexStudents();
    const activityRows=state.activities.map((a,i)=>'<tr><td><input type="checkbox" data-cx="enabled" data-i="'+i+'" '+(a.enabled?'checked':'')+' aria-label="导入此场"></td><td>'+html(a.title)+'<small style="display:block">'+html(state.reports[a.ri].file)+(a.warnings.length?'<br>'+html(a.warnings.join("；")):'')+'</small></td>'+["course","date","period","teacher","location","category"].map(k=>'<td><input class="in" data-cx="'+k+'" data-i="'+i+'" aria-label="'+({course:"课程",date:"日期",period:"节次",teacher:"教师",location:"地点",category:"类别"})[k]+'" type="'+(k==="date"?'date':'text')+'" value="'+html(a[k])+'"></td>').join('')+'<td><select data-cx="term" data-i="'+i+'" class="in">'+termOptionsHTML(a.term)+'</select></td><td>'+(a.phase==="end"?'<select data-cx="pair" data-i="'+i+'" class="in"><option value="">独立签到</option>'+state.activities.filter(b=>b.ri===a.ri&&b.phase!=="end"&&b.key!==a.key).map(b=>'<option value="'+html(b.key)+'" '+(a.pair===b.key?'selected':'')+'>'+html(b.title)+'</option>').join('')+'</select>':'上课或独立签到')+'</td></tr>').join('');
    const issues=state.reports.flatMap((r,ri)=>{
      const counts=new Map();r.students.forEach(s=>counts.set(s.id,(counts.get(s.id)||0)+1));
      return r.students.map((s,si)=>({s,ri,si})).filter(({s})=>!matchedStudent(s)||s.problem||counts.get(s.id)>1);
    });
    const nameWarnings=state.reports.flatMap(r=>r.students.filter(s=>matchedStudent(s)&&s.name&&s.name!==matchedStudent(s).name).map(s=>r.file+"第"+s.row+"行：学号匹配姓名为“"+matchedStudent(s).name+"”，源姓名为“"+s.name+"”"));
    const groups=[...new Set(state.activities.map(a=>a.course))];
    document.getElementById("cxBody").innerHTML='<div class="toolbar"><button type="button" class="btn btn-ghost btn-sm" id="cxMatch">按当前设置匹配课表</button><button type="button" class="btn btn-ghost btn-sm" id="cxHistory">导入历史</button></div><details><summary>批量设置课程名称</summary>'+groups.map((g,i)=>'<label style="display:block">'+html(g||'未识别课程')+' <input class="in" data-cx-group="'+i+'" value="'+html(g)+'"></label>').join('')+'</details><div class="cx-grid">'+table(["导入","原签到标题","课程","日期","节次","教师","地点","类别","学期","下课对应的上课签到"],activityRows)+'</div>'+(issues.length?'<details open><summary>学生匹配异常 '+issues.length+' 行：修正学号或明确排除</summary>'+issues.map(({s,ri,si})=>'<div class="cx-student">'+html(s.name)+'（源第'+s.row+'行）<input class="in" data-ri="'+ri+'" data-si="'+si+'" value="'+html(s.id)+'" aria-label="修正学号"><label><input type="checkbox" data-exclude-ri="'+ri+'" data-exclude-si="'+si+'" '+(s.excluded?'checked':'')+'>排除此学生行</label><small>'+html(s.problem||(matchedStudent(s)?"源表学号重复":"未找到在校生学号"))+'</small></div>').join('')+'</details>':'')+'<div id="cxPreview"></div>';
    document.querySelectorAll("[data-cx]").forEach(el=>el.onchange=()=>{const a=state.activities[Number(el.dataset.i)];a[el.dataset.cx]=el.type==="checkbox"?el.checked:el.value;if(el.dataset.cx==="date")a.dateInferred=false;if(el.dataset.cx==="term"){refreshInferredDate(a);render();}invalidate();});
    document.querySelectorAll("[data-ri]").forEach(el=>el.onchange=()=>{const s=state.reports[Number(el.dataset.ri)].students[Number(el.dataset.si)];s.id=el.value.trim();s.problem="";invalidate();});
    document.querySelectorAll("[data-exclude-ri]").forEach(el=>el.onchange=()=>{state.reports[Number(el.dataset.excludeRi)].students[Number(el.dataset.excludeSi)].excluded=el.checked;invalidate();});
    document.querySelectorAll("[data-cx-group]").forEach(el=>el.onchange=()=>{const group=groups[Number(el.dataset.cxGroup)];state.activities.filter(a=>a.course===group).forEach(a=>a.course=el.value.trim());invalidate();render();});
    document.getElementById("cxMatch").onclick=()=>{autoMatch();invalidate();render();};
    document.getElementById("cxHistory").onclick=()=>showHistory();
    if(nameWarnings.length)document.getElementById("cxBody").insertAdjacentHTML("afterbegin",'<details><summary>姓名核对提示 '+nameWarnings.length+' 项</summary>'+nameWarnings.map(w=>'<p>'+html(w)+'</p>').join('')+'</details>');
  }
  function invalidate(){state.prepared=null;state.batchId=genId("cxBatch");const p=document.getElementById("cxPreview");if(p)p.innerHTML="";document.getElementById("modalOk").textContent="预览考勤";}
  function prepare(){
    indexStudents();
    const errors=[],plans=[],used=new Set(),paired=new Set();
    const enabled=state.activities.filter(a=>a.enabled);
    enabled.filter(a=>a.pair).forEach(a=>{if(paired.has(a.pair))errors.push("一个上课签到被重复配对");paired.add(a.pair);});
    for(const a of enabled){
      if(paired.has(a.key))continue;
      if(!a.term||!getTermList().includes(a.term)||!a.course.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!readDate(a.date,a.term).date){errors.push(a.title+"：请补齐有效学期、课程和日期");continue;}
      const calendar=getTermSettings()[a.term]||{},end=termEndDate(calendar.startDate,calendar.totalWeeks);
      if(calendar.startDate&&end&&(a.date<calendar.startDate||a.date>end)){errors.push(a.title+"：日期不在所选学期校历内，请核对日期或学期");continue;}
      const partner=a.pair?enabled.find(b=>b.key===a.pair):null;
      if(a.pair&&(!partner||partner.phase==="end"||partner.ri!==a.ri||partner.date!==a.date||partner.course!==a.course||partner.term!==a.term||partner.period!==a.period)){errors.push(a.title+"：配对必须来自同表、同课程、日期、学期及节次，且另一列为上课签到");continue;}
      const r=state.reports[a.ri],details=[],ids=new Set(),selection={};Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>selection[k]=[]);
      const overrides=state.overrides||{};
      r.students.filter(s=>!s.excluded).forEach(s=>{
        const stu=matchedStudent(s);if(!stu||s.problem){errors.push(r.file+"第"+s.row+"行：学号未匹配，请修正或排除");return;}
        if(ids.has(s.id)){errors.push(r.file+"：重复学号 "+s.id);return;}ids.add(s.id);
        const raw=s.states[a.ai],rawStart=partner?s.states[partner.ai]:undefined;
        let result=partner?outcome(rawStart,raw):outcome(raw);
        const override=overrides[a.key+":"+s.row];if(override)result=[override];
        if(!result){errors.push({activity:a.key,row:s.row,message:a.title+" / "+s.name+"：状态需处理（"+(partner?text(rawStart)+" / ":"")+text(raw)+"）"});return;}
        details.push({sid:s.id,name:stu.name,cls:stu.cls,sourceRow:s.row,sourceFile:r.file,sourceSheet:r.sheet,rawStart,rawEnd:raw,result,teacherSigned:raw==="教师代签"||rawStart==="教师代签",adjusted:!!override});
        Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>{if(result.includes(CC_BEHAVIOR_TYPES[k].label))selection[k].push(s.id);});
      });
      if(!details.length){errors.push(a.title+"：没有可导入学生");continue;}
      const sourceClasses=[...new Set(r.students.map(matchedStudent).filter(Boolean).map(s=>s.cls))].sort();
      const titles=partner?[partner.title,a.title]:[a.title];
      const sourceKey=sourceIdentity(JSON.stringify([r.teachingClass,r.course,r.sheet,a.title,partner?partner.title:"",sourceClasses]));
      const scopedKey=JSON.stringify([sourceKey,sourceTermScope(titles,a.term)]);
      if(used.has(scopedKey)){errors.push(a.title+"：同批次相同场次重复。不同部分名单请分别导入，系统将保留原名单并合并更正");continue;}used.add(scopedKey);
      const matches=checkClassRecords.filter(c=>c.source==="学习通"&&matchesSource(c,sourceKey,a.term,titles));
      if(matches.length>1){errors.push(a.title+"：已有多个相同来源记录，请先核对重复记录");continue;}
      const old=matches[0];
      const importedCount=details.length;
      const excluded=new Set(r.students.filter(s=>s.excluded&&!ids.has(s.id)).map(s=>s.id));
      const currentLists={};if(old)Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>currentLists[k]=new Set(ccBehaviorRecordIds(old,k)));
      const retained=old?(old.sourceDetails||[]).filter(d=>!ids.has(d.sid)&&!excluded.has(d.sid)).map(d=>{
        const value=copy(d);value.result=Object.keys(CC_BEHAVIOR_TYPES).filter(k=>currentLists[k].has(d.sid)).map(k=>CC_BEHAVIOR_TYPES[k].label);if(!value.result.length)value.result=["出勤"];
        if(JSON.stringify(value.result)!==JSON.stringify(d.result))value.adjusted=true;
        value.sourceFile=value.sourceFile||old.sourceFile||"";value.sourceSheet=value.sourceSheet||r.sheet;return value;
      }):[];
      if(retained.some(d=>!studentLookup.get(d.sid))){errors.push(a.title+"：原名单存在已移除或不唯一的学号，请先核对原查课记录");continue;}
      if(retained.some(d=>(d.result.some(leave)&&d.result.length>1)||(d.result.includes("旷课")&&d.result.length>1))){errors.push(a.title+"：原名单中存在相互冲突的考勤类型，请先核对原查课记录");continue;}
      details.push(...retained);details.sort((x,y)=>x.sid.localeCompare(y.sid));
      Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>selection[k]=details.filter(d=>d.result.includes(CC_BEHAVIOR_TYPES[k].label)).map(d=>d.sid));
      const summary=summarizeDetails(details),classes=summary.classes.map(row=>row.cls);
      if(classes.some(c=>!ORG_CLASSES.some(o=>o.name===c))){errors.push(a.title+"：学生行政班未在基础数据中维护");continue;}
      const overlap=checkClassRecords.some(c=>{
        if(c.source!=="学习通"||c===old)return false;
        if(sourceTermScope(titles,a.term)&&c.term!==a.term)return false;
        try{const key=JSON.parse(c.sourceActivityKey);return key.slice(0,3).every((v,i)=>v===[r.teachingClass,r.course,r.sheet][i])&&(c.classes||[c.cls]).some(cls=>sourceClasses.includes(cls))&&(c.sourceTitles||[]).some(t=>titles.includes(t));}catch(_){return false;}
      });
      if(overlap){errors.push(a.title+"：已有记录使用此签到列，但配对方式不同。请先撤销旧场次，再按正确配对重新导入");continue;}
      const record=Object.assign({},old||{},{id:old?old.id:(state.recordIds[scopedKey]||(state.recordIds[scopedKey]=genId("cc"))),term:a.term,date:a.date,classes,cls:classes.join("、"),course:a.course.trim(),week:courseScheduleDateMeta(a.term,a.date).week||"",period:a.period,teacher:a.teacher,location:a.location,category:a.category,headcount:String(summary.total),attended:String(summary.attended),leave:String(summary.leave),late:String(summary.late),source:"学习通",sourceActivityKey:sourceKey,sourceTitles:titles,sourceDetails:details,sourceClassSummary:summary.classes,sourceImportCount:importedCount,sourceRetainedCount:retained.length,partialRoster:r.students.some(s=>s.excluded)||classes.some(c=>students.filter(s=>s.cls===c&&isOnCampusStudent(s)).length>details.filter(d=>d.cls===c).length),files:old&&old.files||[]});
      const org=ccRecordOrgMeta({classes});record.dept=org.dept||"";record.grade=org.grade||"";record.rate=summary.rate;
      Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>record[CC_BEHAVIOR_TYPES[k].field]=selection[k]);
      record.leaveStudentIds=[...new Set(selection.personalLeave.concat(selection.sickLeave,selection.publicLeave))];
      record.content="学习通签到导入"+(record.partialRoster?"（部分名单）":"")+"；"+record.sourceTitles.join(" / ");
      if(old){const generated="学习通签到导入"+(old.partialRoster?"（部分名单）":"")+"；"+(old.sourceTitles||[]).join(" / ");if(old.content!==generated)record.content=old.content||"";}
      const compare=v=>{const o=copy(v);delete o.sourceBatchId;delete o.sourceFile;delete o.importedAt;delete o.id;delete o.sourceImportCount;delete o.sourceRetainedCount;(o.sourceDetails||[]).forEach(d=>{delete d.sourceFile;delete d.sourceSheet;});return JSON.stringify(o);};
      const action=old?(compare(old)===compare(record)?"跳过":"更新"):"新增";
      plans.push({record,old:old?copy(old):null,selection,action,file:r.file});
    }
    return {errors,plans};
  }
  function preview(){
    if(!state.activities.length){setMessage("请先选择签到文件");return;}
    const prepared=prepare();state.prepared=null;
    const body=document.getElementById("cxPreview");
    body.innerHTML='<h3>考勤预览</h3><p class="tip">部分文件只更正本次出现的学号，未出现的原名单保留；明确排除的学生行除外。实到＋旷课＋请假＝名单人数，迟到和早退属于实到，同一人可同时迟到、早退。</p>'+table(["处理","课程","日期","本次名单","保留原名单","归纳应到","实到","旷课","迟到","早退","事假","病假","公假","名单范围","明细"],prepared.plans.map((p,i)=>'<tr>'+[p.action,p.record.course,p.record.date,p.record.sourceImportCount,p.record.sourceRetainedCount,p.record.headcount,p.record.attended,p.selection.absent.length,p.selection.late.length,p.selection.early.length,p.selection.personalLeave.length,p.selection.sickLeave.length,p.selection.publicLeave.length,p.record.partialRoster?"部分名单":"已归纳名单"].map(v=>'<td>'+html(v)+'</td>').join('')+'<td><button type="button" class="lk" data-cx-person="'+i+'">逐人预览</button> <button type="button" class="lk" data-cx-summary="'+i+'">班级归纳</button></td></tr>').join(''))+'<div id="cxPersonPreview"></div>';
    body.querySelectorAll("[data-cx-summary]").forEach(button=>button.onclick=()=>{const p=prepared.plans[Number(button.dataset.cxSummary)];document.getElementById("cxPersonPreview").innerHTML='<h4>'+html(p.record.course)+" · "+html(p.record.date)+'</h4>'+summaryTable(p.record.sourceClassSummary);});
    body.querySelectorAll("[data-cx-person]").forEach(button=>button.onclick=()=>{const p=prepared.plans[Number(button.dataset.cxPerson)];document.getElementById("cxPersonPreview").innerHTML='<h4>'+html(p.record.course)+" · "+html(p.record.date)+'</h4>'+table(["学号","姓名","班级","上课原状态","下课/独立原状态","结果"],p.record.sourceDetails.map(d=>'<tr>'+[d.sid,d.name,d.cls,d.rawStart||"—",d.rawEnd,d.result.join("、")].map(v=>'<td>'+html(v)+'</td>').join('')+'</tr>').join(''));});
    if(prepared.errors.length){
      body.insertAdjacentHTML("beforeend",'<div class="cx-errors">'+prepared.errors.map(e=>typeof e==="string"?'<p>'+html(e)+'</p>':'<p>'+html(e.message)+' <select data-cx-override="'+html(e.activity)+'" data-row="'+e.row+'"><option value="">选择处理结果</option>'+["出勤","旷课","迟到","早退","事假","病假","公假"].map(v=>'<option>'+v+'</option>').join('')+'</select></p>').join('')+'</div>');
      body.querySelectorAll('[data-cx-override]').forEach(el=>el.onchange=()=>{state.overrides=state.overrides||{};state.overrides[el.dataset.cxOverride+":"+el.dataset.row]=el.value;state.prepared=null;state.batchId=genId("cxBatch");document.getElementById("modalOk").textContent="预览考勤";});
      body.insertAdjacentHTML("beforeend",'<button type="button" class="btn btn-ghost btn-sm" id="cxExportErrors">导出异常清单</button>');
      document.getElementById("cxExportErrors").onclick=()=>downloadXlsxFile("学习通导入异常",[["问题"],...prepared.errors.map(e=>[typeof e==="string"?e:e.message])],"学习通导入异常.xlsx");
      setMessage("有 "+prepared.errors.length+" 项需处理；修正后再次预览。");return;
    }
    if(!prepared.plans.length){setMessage("没有勾选可导入场次");return;}
    state.prepared=prepared;document.getElementById("modalOk").textContent="确认导入";setMessage("预览完成："+prepared.plans.filter(p=>p.action==="新增").length+" 场新增，"+prepared.plans.filter(p=>p.action==="更新").length+" 场更新，"+prepared.plans.filter(p=>p.action==="跳过").length+" 场跳过。更新会调整原来源考勤。");
  }
  async function commit(){
    if(!canWrite()||busy||!state.prepared)return false;
    busy=true;const session=state;setMessage("正在保存，请等待服务器确认…");
    try{
      const fresh=await root.workbench.legacy.readStoreSnapshot();recycleApplySnapshots(fresh);
      if(history().some(h=>h.id===session.batchId)){showToast("本批次已保存，已核验服务器记录","success");return true;}
      for(const p of session.prepared.plans){
        const current=checkClassRecords.find(r=>r.source==="学习通"&&matchesSource(r,p.record.sourceActivityKey,p.record.term,p.record.sourceTitles))||null;
        if(JSON.stringify(current)!==JSON.stringify(p.old))throw Object.assign(new Error("记录被其他操作修改，请重新预览后导入"),{needsPreview:true});
      }
      const latest=prepare();if(latest.errors.length)throw Object.assign(new Error("数据已变化，请重新预览"),{needsPreview:true});
      const review=plans=>JSON.stringify(plans.map(p=>({record:p.record,action:p.action})));
      if(review(latest.plans)!==review(session.prepared.plans))throw Object.assign(new Error("学生名单或考勤数据已变化，请重新预览"),{needsPreview:true});
      const changed=latest.plans.filter(p=>p.action!=="跳过");
      if(!changed.length){showToast("相同签到已导入，本次全部跳过","success");return true;}
      const bases={nnuzc_students:localStorage.getItem("nnuzc_students"),nnuzc_checkclass:localStorage.getItem("nnuzc_checkclass"),[historyKey]:localStorage.getItem(historyKey)};
      const originalStudents=students,originalChecks=checkClassRecords;
      let nextStudents,nextChecks;
      const batch={id:session.batchId,time:nowStr(),files:[...new Set(changed.map(p=>p.file))],records:[],active:true};
      try{
        students=copy(originalStudents);checkClassRecords=copy(originalChecks);
        changed.forEach(p=>{
          const linkedBefore=linkedRows(students,p.record.id);
          const previous=checkClassRecords.find(r=>r.id===p.record.id),oldSelection={};Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>oldSelection[k]=ccBehaviorRecordIds(previous||{},k));
          p.record.sourceBatchId=batch.id;p.record.sourceFile=p.file;p.record.importedAt=batch.time;
          if(previous)Object.assign(previous,p.record);else checkClassRecords.push(copy(p.record));
          ccSyncBehaviorRecords(p.record.id,oldSelection,p.selection,p.record);
          batch.records.push({id:p.record.id,before:p.old,after:copy(p.record),linkedBefore,linkedAfter:linkedRows(students,p.record.id)});
        });nextStudents=copy(students);nextChecks=copy(checkClassRecords);
      }finally{students=originalStudents;checkClassRecords=originalChecks;}
      const histories=history();if(!histories.some(h=>h.id===batch.id))histories.push(batch);
      const values={nnuzc_students:JSON.stringify(nextStudents),nnuzc_checkclass:JSON.stringify(nextChecks),[historyKey]:JSON.stringify(histories)};
      const result=await root.workbench.legacy.commitStoreBatch(Object.keys(values).map(key=>({key,method:"PUT",value:values[key],baseValue:bases[key]})));
      recycleApplySnapshots(result.storeValues);showToast("学习通考勤导入成功："+changed.length+" 场，已同步课堂考勤","success");
      goto(session.returnView);return true;
    }catch(error){
      if(error.needsPreview){session.prepared=null;document.getElementById("modalOk").textContent="预览考勤";setMessage(error.message+"。未提交本批次；请重新预览并核对。");}
      else setMessage("保存未能确认："+error.message+"。预览保留，可重试；重复场次不会再次新增。");
      return false;
    }
    finally{busy=false;}
  }
  function details(id){
    const r=checkClassRecords.find(c=>c.id===id);if(!r)return;
    const lists={};Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>lists[k]=new Set(ccBehaviorRecordIds(r,k)));
    const current=(r.sourceDetails||[]).map(d=>{const results=Object.keys(CC_BEHAVIOR_TYPES).filter(k=>lists[k].has(d.sid)).map(k=>CC_BEHAVIOR_TYPES[k].label);return Object.assign({},d,{result:results.length?results:["出勤"]});});
    openModal("学习通原始签到明细",'<p>'+html(r.course)+" · "+html(r.date)+'</p><p class="tip">按行政班归纳；以下当前结果以查课名单为准，原始状态与导入时结果保留供核对。</p>'+summaryTable(summarizeDetails(current).classes)+table(["学号","姓名","班级","上课原状态","下课/独立原状态","导入时结果","当前结果","教师代签","人工调整","来源文件"],(r.sourceDetails||[]).map((d,i)=>'<tr>'+[d.sid,d.name,d.cls,d.rawStart||"—",d.rawEnd,d.result.join("、"),current[i].result.join("、"),d.teacherSigned?"是":"否",d.adjusted?"是":"否",d.sourceFile||r.sourceFile||"—"].map(v=>'<td>'+html(v)+'</td>').join('')+'</tr>').join('')),null);
  }
  function summaryTable(rows){return table(["班级","名单人数","实到","旷课","迟到","早退","事假","病假","公假","请假合计","到课率"],(rows||[]).map(s=>'<tr>'+[s.cls,s.total,s.attended,s.absent,s.late,s.early,s.personalLeave,s.sickLeave,s.publicLeave,s.leave,s.rate].map(v=>'<td>'+html(v)+'</td>').join('')+'</tr>').join(''));}
  function showHistory(){
    let batches;try{batches=history();}catch(error){showToast(error.message,"error");return;}
    openModal("学习通考勤导入历史",table(["时间","文件","场次数","状态","操作"],batches.slice().reverse().map(h=>'<tr><td>'+html(h.time)+'</td><td>'+html(h.files.join("、"))+'</td><td>'+h.records.length+'</td><td>'+(h.active?"已导入":"已撤销")+'</td><td>'+(h.active?'<button class="btn btn-ghost btn-sm" onclick="chaoxingUndo('+jsArg(h.id)+')">撤销本次导入</button>':'—')+'</td></tr>').join('')),null);
  }
  async function undo(id){
    if(!canWrite()||busy)return; if(!confirm("撤销本批次：新增记录移入回收站，更新记录恢复为导入前版本。后续已修改的记录将阻止撤销。是否继续？"))return;
    busy=true;
    try{
      const fresh=await root.workbench.legacy.readStoreSnapshot();recycleApplySnapshots(fresh);const batches=history(),batch=batches.find(h=>h.id===id);if(!batch)throw Error("批次不存在");
      if(!batch.active){showHistory();showToast("本批次已撤销，已核验服务器记录","success");return;}
      for(const item of batch.records){const current=checkClassRecords.find(r=>r.id===item.id);if(!current||JSON.stringify(current)!==JSON.stringify(item.after)||(item.linkedAfter&&!sameLinkedRows(linkedRows(students,item.id),item.linkedAfter)))throw Error("查课或关联考勤已有后续修改，请逐条核对，未撤销任何记录");}
      // Existing recycle adapters preserve linked classroom rows and referenced attachments.
      const created=batch.records.filter(i=>!i.before).map(i=>i.id);
      const bases={nnuzc_students:localStorage.getItem("nnuzc_students"),nnuzc_checkclass:localStorage.getItem("nnuzc_checkclass"),[historyKey]:localStorage.getItem(historyKey)};
      const originalStudents=students,originalChecks=checkClassRecords;let nextStudents,nextChecks;
      try{
        students=copy(students);checkClassRecords=copy(checkClassRecords);
        batch.records.filter(i=>!i.before).forEach(item=>{const current=checkClassRecords.find(r=>r.id===item.id),oldSelection={},empty={};Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>{oldSelection[k]=ccBehaviorRecordIds(current,k);empty[k]=[];});ccSyncBehaviorRecords(item.id,oldSelection,empty,current);});
        checkClassRecords=checkClassRecords.filter(r=>!created.includes(r.id));
        batch.records.filter(i=>i.before).forEach(item=>{const current=checkClassRecords.find(r=>r.id===item.id),oldSelection={},selection={};Object.keys(CC_BEHAVIOR_TYPES).forEach(k=>{oldSelection[k]=ccBehaviorRecordIds(current,k);selection[k]=ccBehaviorRecordIds(item.before,k);});checkClassRecords[checkClassRecords.indexOf(current)]=copy(item.before);ccSyncBehaviorRecords(item.id,oldSelection,selection,item.before);});
        batch.records.filter(i=>i.before&&i.linkedBefore).forEach(item=>{students.forEach(s=>{s.classroom=(s.classroom||[]).filter(r=>r.sourceCheckClassId!==item.id);const previous=item.linkedBefore.find(row=>row.sid===String(s.id));if(previous)s.classroom.push(...copy(previous.rows));});});
        nextStudents=copy(students);nextChecks=copy(checkClassRecords);
      }finally{students=originalStudents;checkClassRecords=originalChecks;}
      batch.active=false;const values={nnuzc_students:JSON.stringify(nextStudents),nnuzc_checkclass:JSON.stringify(nextChecks),[historyKey]:JSON.stringify(batches)};
      const result=await root.workbench.legacy.commitStoreBatch(Object.keys(values).map(key=>({key,method:"PUT",value:values[key],baseValue:bases[key]})),created.length?created:undefined);recycleApplySnapshots(result.storeValues);showHistory();showToast("已撤销本批次导入","success");
    }catch(error){alert("撤销未完成："+error.message);}finally{busy=false;}
  }
  root.chaoxingImportOpen=open;root.chaoxingImportDetails=details;root.chaoxingImportHistory=showHistory;root.chaoxingUndo=undo;
  api.preview=preview;api.commit=commit;api.getState=()=>state;api.prepare=prepare;
})(globalThis);
