"use strict";
/* 宿舍花名册：独立展示模块；学生字段只读自学生管理，住宿字段只读自宿舍管理。 */
(function(){
  const PAGES=window.__NNUZC__&&window.__NNUZC__.PAGES;
  if(!PAGES) return;
  const FIELDS=[
    ["idPhoto","证件照","身份识别"],["name","姓名","身份识别"],["id","学号","身份识别"],["gender","性别","身份识别"],
    ["dept","学院","学籍信息"],["major","专业","学籍信息"],["grade","年级","学籍信息"],["cls","班级","学籍信息"],
    ["accom","住宿情况","住宿信息"],["zone","区位","住宿信息"],["building","楼栋","住宿信息"],["room","房间号","住宿信息"],["bed","床位号","住宿信息"],
    ["phone","手机号","联系信息"],["counsel","辅导员","联系信息"],["ethnic","民族","个人信息"],["political","政治面貌","个人信息"],["source","生源地","个人信息"],["address","家庭住址","个人信息"]
  ];
  let tab="dist",mode="class";
  let filters={status:["在校"],accom:[],dept:[],major:[],grade:[],cls:[],zone:[],building:[],room:[]};
  let generated=null;
  const DEFAULT_FIELDS=["idPhoto","name","id","gender","dept","major","grade","cls","zone","building","room","bed","phone","counsel","ethnic","political"];
  let chosen=new Set(DEFAULT_FIELDS);
  const ROSTER_COLUMNS=3,ROSTER_ROWS=6,ROSTER_PAGE_SIZE=ROSTER_COLUMNS*ROSTER_ROWS;
  /* 分类勾选用于“一键全选本类”；初始状态按花名册默认字段展示。 */
  let groupToggles=new Set(["身份识别","学籍信息","住宿信息"]);
  const h=(v)=>String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const order=(a,b)=>String(a||"").localeCompare(String(b||""),"zh-CN",{numeric:true});
  const refresh=()=>window.renderPage("dormRoster");
  const invalidate=()=>{generated=null;refresh();};
  const grade=(s)=>s.grade||((String(s.cls||"").match(/(20\d{2})/)||[])[1]?((String(s.cls).match(/(20\d{2})/)||[])[1]+"级"):"");
  function distributionMap(){return new Map((window.getDormRosterDistribution?window.getDormRosterDistribution():[]).map(r=>[String(r.studentId||r.id||""),r]));}
  function studentSnapshot(s,dist){
    s=s||{};dist=dist||distributionMap();const d=dist.get(String(s.id||""))||{};
    return Object.assign({},s,{grade:grade(s),accom:d.accom||s.accom||"",zone:d.zone||s.zone||"",building:d.building||s.building||"",room:d.room||s.room||"",bed:d.bed||s.bed||"",photo:window.getDormRosterIdPhoto?window.getDormRosterIdPhoto(s):""});
  }
  function students(){const dist=distributionMap();return (window.getDormRosterStudents?window.getDormRosterStudents():[]).map(s=>studentSnapshot(s,dist));}
  const allFields=()=>FIELDS;
  const classNumber=(cls)=>{const hit=String(cls||"").match(/\d{6}/);return hit?Number(hit[0]):Number.MAX_SAFE_INTEGER;};
  function rows(){return students().filter(s=>["status","accom","dept","major","grade","cls","zone","building","room"].every(k=>!filters[k]||!filters[k].length||filters[k].includes(String(k==="status"?(s.status||"在校"):(s[k]||""))))).sort((a,b)=>{if(mode==="class"){const n=classNumber(a.cls)-classNumber(b.cls);if(n)return n;for(const k of ["cls","zone","building","room","bed","id"]){const c=order(a[k],b[k]);if(c)return c;}return 0;}const keys=mode==="dorm"?["zone","building","room","bed","id"]:["dept","major","grade","cls","id"];for(const k of keys){const c=order(a[k],b[k]);if(c)return c;}return 0;});}
  function groups(){const map=new Map();rows().forEach(s=>{const key=mode==="dorm"?[s.zone,s.building,s.room].filter(Boolean).join(" · "):(mode==="class"?s.cls:s.major);if(mode==="dorm"&&!s.room)return;const label=key||(mode==="class"?"未分班":"未填专业");if(!map.has(label))map.set(label,[]);map.get(label).push(s);});return [...map].map(([label,students])=>({label,students}));}
  function value(s,key){const aliases={phone:["phone","mobilePhone","mobile","tel","telephone","手机号","手机号码","联系电话"],counsel:["counsel","counselor","teacher"],ethnic:["ethnic","nation","ethnicity"],political:["political","politics","politicalStatus"],source:["source","origin","nativePlace","hometown"],address:["address","homeAddr","homeAddress"]};if(aliases[key]){for(const k of aliases[key])if(s[k])return s[k];return "";}return s[key]||"";}
  /* 向空间总览开放同一份字段和取值口径，避免两处学生详情随版本演进后不一致。 */
  window.getDormRosterFieldDefinitions=()=>FIELDS.map(field=>field.slice());
  window.getDormRosterStudentSnapshot=student=>studentSnapshot(student||{});
  window.getDormRosterFieldValue=(student,key)=>value(student||{},key);
  function multiFilter(key,label){const vals=[...new Set(students().map(s=>String(key==="status"?(s.status||"在校"):(s[key]||"")).trim()).filter(Boolean))].sort(order),ui=window.getDormRosterFilterUI&&window.getDormRosterFilterUI();if(!ui||typeof ui.multi!=="function")return '<div class="filter-item"><label>'+label+'</label><span class="tip">筛选控件加载中</span></div>';return '<div class="filter-item"><label>'+label+'</label>'+ui.multi("dormRoster_"+key,[{v:"",l:"全部"+label}].concat(vals.map(v=>({v:v,l:v}))),filters[key]||[])+'</div>';}
  function modeFilter(){const ui=window.getDormRosterFilterUI&&window.getDormRosterFilterUI(),opts=[{v:"dorm",l:"按寝室"},{v:"class",l:"按班级"},{v:"major",l:"按专业"}];if(!ui||typeof ui.single!=="function")return '<div class="filter-item"><label>生成方式</label><span class="tip">筛选控件加载中</span></div>';return '<div class="filter-item"><label>生成方式</label>'+ui.single("dormRoster_mode",opts,mode)+'</div>';}
  function fieldPanel(){const sections=["身份识别","学籍信息","住宿信息","联系信息","个人信息"],defs=allFields();return '<div class="card" style="margin-top:14px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>导出字段</b><button class="btn btn-ghost btn-sm" onclick="dormRosterPreset(\'basic\')">标准花名册</button><button class="btn btn-ghost btn-sm" onclick="dormRosterPreset(\'all\')">全部字段</button><span class="tip" style="margin:0">Excel 的证件照列显示上传状态；照片仅在 PDF 花名册中展示。</span></div>'+sections.map(group=>{const fs=defs.filter(f=>f[2]===group),all=fs.length&&fs.every(f=>chosen.has(f[0]));return '<div style="margin-top:9px"><label style="font-weight:700;margin-right:8px"><input type="checkbox" '+(all?"checked":"")+' onchange="dormRosterGroup('+h(JSON.stringify(group))+',this.checked)">'+h(group)+'</label>'+fs.map(f=>'<label style="display:inline-block;margin:2px 10px 2px 0"><input type="checkbox" '+(chosen.has(f[0])?"checked":"")+' onchange="dormRosterField('+h(JSON.stringify(f[0]))+',this.checked)">'+h(f[1])+'</label>').join("")+'</div>';}).join("")+'</div>';}
  function card(s){const identityKeys=["id","name","gender","ethnic"],withPhoto=chosen.has("idPhoto"),detailFields=allFields().filter(f=>f[0]!=="idPhoto"&&chosen.has(f[0])&&(!withPhoto||!identityKeys.includes(f[0]))),detail=detailFields.map(f=>'<div data-roster-field="'+h(f[0])+'"><b>'+h(f[1])+'：</b>'+h(value(s,f[0]))+'</div>').join(""),identity=FIELDS.filter(f=>identityKeys.includes(f[0])&&chosen.has(f[0])).sort((a,b)=>identityKeys.indexOf(a[0])-identityKeys.indexOf(b[0])).map(f=>'<div data-roster-field="'+h(f[0])+'"><b>'+h(f[1])+'：</b>'+h(value(s,f[0]))+'</div>').join("");const photo=withPhoto?'<div class="dr-photo-col"><div class="dr-photo">'+(s.photo?'<img src="'+h(s.photo)+'" alt="证件照">':'<span>暂无<br>证件照</span>')+'</div><div class="dr-photo-info">'+identity+'</div></div>':'';return '<article class="dr-card">'+photo+'<div class="dr-detail '+(detailFields.length>14?'dr-detail-dense':'')+'">'+detail+'</div></article>';}
  function printable(){const type=mode==="dorm"?"宿舍":(mode==="class"?"班级":"专业");const sourceGroups=mode==="dorm"?[{label:"按宿舍、床位号排序",students:rows().filter(s=>s.room)}]:groups();return sourceGroups.flatMap(g=>{const chunks=[];for(let i=0;i<g.students.length;i+=ROSTER_PAGE_SIZE)chunks.push(g.students.slice(i,i+ROSTER_PAGE_SIZE));return chunks.map((chunk,i)=>'<section class="dr-page"><header><h1>'+type+'花名册</h1><h2>'+h(g.label)+' · '+g.students.length+' 人'+(chunks.length>1?' · '+(i+1)+'/'+chunks.length:'')+'</h2></header><div class="dr-grid">'+chunk.map(card).join("")+'</div><footer>数智学工 · 生成日期：'+window.beijingLocaleDate()+'</footer></section>');}).join("");}
  function rosterPage(){const rs=rows(),gs=groups(),missing=rs.filter(s=>!s.photo).length,unassigned=rs.filter(s=>!s.room).length,ready=!!generated;const type=mode==="dorm"?"寝室":(mode==="class"?"班级":"专业");return '<h2 class="ptitle">📋 花名册 <span class="tag">学生信息管理</span></h2><div class="card"><div class="toolbar dr-roster-filters" style="align-items:end;gap:8px;flex-wrap:wrap">'+modeFilter()+multiFilter("status","学生状态")+multiFilter("accom","住宿情况")+multiFilter("dept","学院")+multiFilter("major","专业")+multiFilter("grade","年级")+multiFilter("cls","班级")+(mode==="dorm"?multiFilter("zone","区位")+multiFilter("building","楼栋")+multiFilter("room","房间号"):"")+'<button id="dormRosterFilterConfirm" class="btn btn-primary btn-sm" type="button" onclick="dormRosterApplyFilters()">确定</button></div><div class="tip" style="margin-top:9px">筛选条件均可多选；调整筛选条件后请点击“确定”刷新结果。按班级时优先按班级名称中的前 6 位数字排序；调整字段后请重新生成花名册。</div></div>'+fieldPanel()+'<div class="card" style="margin-top:14px"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><b>花名册结果</b><span>匹配 <b>'+rs.length+'</b> 人 / '+gs.length+' 个'+type+'</span><span style="color:'+(missing?'#b45309':'#12805c')+'">缺证件照 '+missing+' 人</span>'+(mode==="dorm"?'<span style="color:'+(unassigned?'#b45309':'#12805c')+'">未分配寝室 '+unassigned+' 人（不生成）</span>':'')+'<span style="flex:1"></span><button class="btn btn-primary btn-sm" '+(!gs.length?'disabled':'')+' onclick="dormRosterGenerate()">🧾 生成花名册</button><button class="btn btn-ghost btn-sm" '+(!ready?'disabled':'')+' onclick="dormRosterPreview()">🔍 全屏预览</button><button class="btn btn-primary btn-sm" '+(!ready?'disabled':'')+' onclick="dormRosterPdf()">🖨 导出 PDF 花名册</button><button class="btn btn-ghost btn-sm" '+(!ready?'disabled':'')+' onclick="dormRosterXlsx()">⬇ 导出 Excel 名单</button></div><div class="dr-preview">'+(ready?generated.html:'<div class="empty" style="padding:30px">请先按当前选择点击“生成花名册”。</div>')+'</div></div>';}
  PAGES.dormRoster=rosterPage;
  /* 兼容旧的内部调用；入口已迁移为学生信息管理分组下的独立菜单。 */
  window.dormRosterTab=(next)=>{if(next==="custom"){window.goto("customRoster");return;}if(next==="roster"){window.goto("dormRoster");return;}window.goto("dorm");};
  window.studentRosterTab=window.dormRosterTab;
  window.dormRosterMode=(next)=>{mode=next;filters.accom=next==="dorm"?["校内"]:[];invalidate();}; window.dormRosterFilter=(key,v,on)=>{const values=new Set(filters[key]||[]);on?values.add(v):values.delete(v);filters[key]=[...values];}; window.dormRosterClearFilter=(key)=>{filters[key]=[];};
  window.dormRosterApplyFilters=()=>{generated=null;refresh();window.showToast("筛选条件已应用","ok");};
  window.dormRosterField=(key,on)=>{on?chosen.add(key):chosen.delete(key);const field=allFields().find(f=>f[0]===key);if(!on&&field)groupToggles.delete(field[2]);invalidate();}; window.dormRosterGroup=(group,on)=>{allFields().filter(f=>f[2]===group).forEach(f=>on?chosen.add(f[0]):chosen.delete(f[0]));on?groupToggles.add(group):groupToggles.delete(group);invalidate();}; window.dormRosterPreset=(kind)=>{chosen=new Set(kind==="all"?allFields().map(f=>f[0]):DEFAULT_FIELDS);groupToggles=new Set(kind==="all"?["身份识别","学籍信息","住宿信息","联系信息","个人信息"]:["身份识别","学籍信息","住宿信息"]);invalidate();}; window.dormRosterGenerate=()=>{const data=rows(),gs=groups();if(!gs.length){window.showToast("当前条件下没有可生成的花名册","warn");return;}generated={data:data,html:printable(),fields:new Set(chosen)};refresh();window.showToast("已按当前条件生成花名册，可预览或导出","ok");}; window.dormRosterPreview=()=>{if(!generated){window.showToast("请先生成花名册","warn");return;}window.openModal("花名册全屏预览",'<div class="dr-modal-preview">'+generated.html+'</div>',()=>true);const modal=document.getElementById("modal");modal.classList.add("xwide","dorm-roster-preview-modal");document.getElementById("modalOk").textContent="关闭";document.getElementById("modalOk").onclick=window.closeModal;};
  window.dormRosterXlsx=function(){const rs=generated&&generated.data,fs=allFields().filter(f=>generated&&generated.fields.has(f[0]));if(!rs||!rs.length||!fs.length){window.showToast("请先生成花名册并至少选择一个字段","warn");return;}const type=mode==="dorm"?"宿舍":(mode==="class"?"班级":"专业");window.dormRosterDownloadXlsx(type+"名单",[[type+"名单","生成日期："+window.beijingLocaleDateTime()],fs.map(f=>f[0]==="idPhoto"?"证件照状态":f[1]),...rs.map(s=>fs.map(f=>f[0]==="idPhoto"?(s.photo?"已上传":"未上传"):value(s,f[0])))],type+"名单_"+Date.now()+".xlsx");window.showToast("已导出 "+rs.length+" 人 Excel 名单","ok");};
  document.addEventListener("change",function(event){const multi=event.target&&event.target.closest&&event.target.closest(".dr-roster-filters .qf-multi");if(!multi||!event.target.matches(".qf-multi-opt input[type=checkbox]"))return;const name=String(multi.dataset.qf||"");if(name.indexOf("dormRoster_")!==0)return;const key=name.slice("dormRoster_".length);filters[key]=[...multi.querySelectorAll(".qf-multi-opt input[type=checkbox]:checked")].map(box=>box.value);});
  document.addEventListener("qfSingle:change",function(event){if(!event.detail||event.detail.name!=="dormRoster_mode")return;window.dormRosterMode(event.detail.value);});
  /* 共用两种花名册的照片完整显示及 PDF 排版；数据由调用方独立传入。 */
  const loadPhoto=src=>new Promise(done=>{if(!src){done(null);return;}const image=new Image();image.onload=()=>done(image);image.onerror=()=>done(null);image.src=src;});
  const wrapCanvasText=(ctx,text,maxWidth)=>{const lines=[];let line="";Array.from(String(text==null?"":text)).forEach(char=>{const next=line+char;if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=char;}else line=next;});if(line||!lines.length)lines.push(line);return lines;};
  const canvasPngBytes=canvas=>new Promise((resolve,reject)=>{try{canvas.toBlob(blob=>{if(!blob){reject(new Error("PDF 页面图片生成失败"));return;}blob.arrayBuffer().then(buffer=>resolve(new Uint8Array(buffer))).catch(reject);},"image/png");}catch(error){reject(error);}});
  async function renderRosterPage(data,options){
    const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d"),width=2480,height=3508;
    canvas.width=width;canvas.height=height;ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
    ctx.fillStyle="#111";ctx.textAlign="center";ctx.font='bold 52px "Microsoft YaHei"';ctx.fillText(options.title,width/2,78);
    ctx.font='30px "Microsoft YaHei"';ctx.fillText(data.label+" · "+data.total+" 人"+(data.count>1?" · "+data.index+"/"+data.count:""),width/2,124);
    ctx.strokeStyle="#555";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(64,152);ctx.lineTo(width-64,152);ctx.stroke();
    const withPhoto=options.withPhoto,marginX=64,startY=175,gapX=14,gapY=14,cardW=(width-marginX*2-gapX*(ROSTER_COLUMNS-1))/ROSTER_COLUMNS,cardH=520,photoW=280,photoH=315;
    const photos=await Promise.all(data.students.map(student=>loadPhoto(withPhoto?options.photo(student):"")));
    data.students.forEach((student,index)=>{
      const col=index%ROSTER_COLUMNS,row=Math.floor(index/ROSTER_COLUMNS),x=marginX+col*(cardW+gapX),y=startY+row*(cardH+gapY),dense=options.fields.length>14,detailFont=dense?24:28,detailLine=dense?27:32;
      ctx.strokeStyle="#555";ctx.lineWidth=2;ctx.strokeRect(x,y,cardW,cardH);
      ctx.save();ctx.beginPath();ctx.rect(x+2,y+2,cardW-4,cardH-4);ctx.clip();let textX=x+18;
      if(withPhoto){
        ctx.strokeStyle="#777";ctx.strokeRect(x+16,y+18,photoW,photoH);const image=photos[index];
        if(image){
          // 完整保留原图，按比例居中；不以源矩形裁掉头部、底部或两侧。
          const ratio=Math.min(photoW/image.naturalWidth,photoH/image.naturalHeight),drawW=image.naturalWidth*ratio,drawH=image.naturalHeight*ratio;
          ctx.drawImage(image,x+16+(photoW-drawW)/2,y+18+(photoH-drawH)/2,drawW,drawH);
        }else{ctx.fillStyle="#777";ctx.textAlign="center";ctx.font='27px "Microsoft YaHei"';ctx.fillText("暂无证件照",x+16+photoW/2,y+170);}
        ctx.fillStyle="#111";ctx.textAlign="left";ctx.font='24px "Microsoft YaHei"';let identityY=y+376;
        options.identityFields.forEach(field=>{wrapCanvasText(ctx,field[1]+"："+options.value(student,field[0]),photoW).forEach(line=>{ctx.fillText(line,x+16,identityY);identityY+=30;});});
        textX=x+16+photoW+12;
      }
      ctx.fillStyle="#111";ctx.textAlign="left";ctx.font=detailFont+'px "Microsoft YaHei"';let textY=y+34,maxWidth=x+cardW-14-textX;
      options.fields.forEach(field=>{wrapCanvasText(ctx,field[1]+"："+options.value(student,field[0]),maxWidth).forEach(line=>{ctx.fillText(line,textX,textY);textY+=detailLine;});});
      ctx.restore();
    });
    ctx.fillStyle="#666";ctx.textAlign="center";ctx.font='22px "Microsoft YaHei"';ctx.fillText("数智学工 · 生成日期："+window.beijingLocaleDate(),width/2,height-24);
    return canvas;
  }
  window.dormRosterPdf=async function(){
    if(!generated){window.showToast("请先生成花名册","warn");return;}
    if(!window.html2pdf){window.showToast("PDF 组件尚未加载，请刷新页面后重试","warn");return;}
    const progress=window.WorkbenchProgress&&WorkbenchProgress.begin({title:"PDF 花名册",message:"正在准备高清 PDF 页面，请勿关闭页面…"});
    const frame=document.createElement("iframe");
    frame.setAttribute("aria-hidden","true");
    frame.tabIndex=-1;
    frame.style.cssText="position:fixed;left:0;top:0;width:210mm;height:296mm;border:0;opacity:0;pointer-events:none;z-index:-2147483648";
    document.body.appendChild(frame);
    const frameDoc=frame.contentDocument;
    frameDoc.open();
    /* 主文档 CSP 为 base-uri 'none'，隐藏 iframe 继承该策略后写入 <base> 会被拦截；改为在写入前把相对 URL 绝对化。 */
    frameDoc.write('<!doctype html><html><head><meta charset="UTF-8"><style>*{box-sizing:border-box;margin:0;padding:0}body{margin:0;background:#fff}'+style.textContent+'.dr-page{height:400mm!important;overflow:visible!important}</style></head><body><div class="dr-print-root">'+generated.html.replace(/(src|href)="\/(?!\/)/g,'$1="'+location.origin+'/')+'</div></body></html>');
    frameDoc.close();
    const host=frameDoc.querySelector(".dr-print-root");
    try{
      if(progress)progress.update(5,"正在加载花名册照片和页面资源…");
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      await Promise.all([...host.querySelectorAll("img")].map(img=>img.complete?Promise.resolve():new Promise(done=>{img.onload=done;img.onerror=done;})));
      const pages=[...host.querySelectorAll(".dr-page")];
      if(!pages.length||!host.querySelector(".dr-card")||!host.textContent.includes("姓名："))throw new Error("花名册未生成学生信息，已取消导出");
      /* 每页单独生成，不能让预览用的 CSS 分页规则再插入一张空白页。 */
      pages.forEach(page=>{page.style.pageBreakAfter="auto";page.style.breakAfter="auto";page.style.display="none";});
      const settings={margin:0,image:{type:"png",quality:1},html2canvas:{scale:3,useCORS:true,backgroundColor:"#ffffff",logging:false},jsPDF:{unit:"mm",format:"a4",orientation:"portrait",compress:true},pagebreak:{mode:[]}};
      /* html2pdf 对超长画布分页会在部分浏览器中输出空白页；改为逐张 A4 页面绘制后合并。 */
      const sourceGroups=mode==="dorm"?[{label:"按宿舍、床位号排序",students:generated.data.filter(s=>s.room)}]:groups(),type=mode==="dorm"?"宿舍":(mode==="class"?"班级":"专业"),pageData=[];
      sourceGroups.forEach(group=>{const total=group.students.length,count=Math.ceil(total/ROSTER_PAGE_SIZE);for(let i=0;i<count;i++)pageData.push({label:group.label,total,index:i+1,count,students:group.students.slice(i*ROSTER_PAGE_SIZE,i*ROSTER_PAGE_SIZE+ROSTER_PAGE_SIZE)});});


      const withPhoto=generated.fields.has("idPhoto"),identityKeys=["id","name","gender","ethnic"],identityFields=FIELDS.filter(field=>withPhoto&&identityKeys.includes(field[0])&&generated.fields.has(field[0])).sort((a,b)=>identityKeys.indexOf(a[0])-identityKeys.indexOf(b[0]));
      const renderPageCanvas=data=>renderRosterPage(data,{title:type+"花名册",withPhoto,identityFields,fields:allFields().filter(field=>field[0]!=="idPhoto"&&generated.fields.has(field[0])&&(!withPhoto||!identityKeys.includes(field[0]))),value,photo:student=>student.photo});
      let pdf;
      for(let i=0;i<pageData.length;i++){
        if(progress)progress.update(10+Math.round(i/Math.max(1,pageData.length)*80),"正在生成第 "+(i+1)+" / "+pageData.length+" 页高清 PDF…");
        const canvas=await renderPageCanvas(pageData[i]);
        const image=await canvasPngBytes(canvas);
        if(i===0){const worker=window.html2pdf().set(settings).from(pages[0]).toPdf();pdf=await worker.get("pdf");for(let p=pdf.getNumberOfPages();p>1;p--)pdf.deletePage(p);pdf.setPage(1);pdf.addImage(image,"PNG",0,0,210,296,undefined,"FAST");}
        else{pdf.addPage("a4","portrait");pdf.addImage(image,"PNG",0,0,210,296,undefined,"FAST");}
        canvas.width=1;canvas.height=1;
      }
      if(!pdf)throw new Error("PDF 页面生成失败");
      if(progress)progress.update(95,"正在保存 PDF 文件…");
      pdf.save(type+"花名册_"+Date.now()+".pdf");
      if(progress)progress.succeed("PDF 花名册已成功导出（逐页高清 PNG）");
    }catch(e){if(progress)progress.fail("PDF 导出失败："+(e.message||e));window.showToast("PDF 导出失败："+(e.message||e),"warn");}
    finally{frame.remove();}
  };
  const style=document.createElement("style");style.textContent='.dr-preview{margin-top:14px;max-height:680px;overflow:auto;background:#edf1f3;padding:16px}.dr-page{width:210mm;height:296mm;min-height:0;overflow:hidden;box-sizing:border-box;background:#fff;padding:4mm 6mm 3mm;position:relative;page-break-after:always;color:#171717;font-family:"Microsoft YaHei",sans-serif}.dr-page:last-child{page-break-after:auto}.dr-page header{text-align:center;border-bottom:1px solid #444;padding-bottom:2mm;margin-bottom:2mm}.dr-page h1{font-size:18px;margin:0}.dr-page h2{font-size:12px;margin:1mm 0 0;font-weight:500}.dr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(6,40mm);gap:1.5mm}.dr-card{min-width:0;border:1px solid #555;height:40mm;overflow:hidden;padding:1.2mm;display:flex;gap:1.2mm;box-sizing:border-box;break-inside:avoid}.dr-photo-col{width:18mm;min-width:0;flex:0 0 18mm}.dr-photo{width:18mm;height:27mm;border:1px solid #777;display:flex;align-items:center;justify-content:center;text-align:center;font-size:8px;color:#666}.dr-photo img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain;object-position:center;background:#fff}.dr-photo-info{min-width:0;font-size:6.5px;line-height:1.28;margin-top:2.55mm;white-space:normal;overflow-wrap:anywhere;word-break:break-all}.dr-photo-info b{font-weight:600}.dr-detail{min-width:0;flex:1 1 0;font-size:9.2px;line-height:1.24;letter-spacing:-.15px;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.dr-detail>div,.dr-photo-info>div{max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:break-all}.dr-detail.dr-detail-dense{font-size:8.2px;line-height:1.12}.dr-detail b{font-weight:600}.dr-page footer{position:absolute;bottom:1.5mm;left:6mm;right:6mm;text-align:center;color:#666;font-size:8px}.dr-print-root{position:relative;width:210mm;margin:0;background:#fff;box-shadow:none}.dr-preview .dr-page{transform:scale(.48);transform-origin:top left;margin-bottom:calc(-297mm * .52);box-shadow:0 1px 8px #aab1b6}.dr-custom-field-row{display:flex;gap:8px;margin:8px 0}.dr-custom-field-row input{flex:1;min-width:0}.dr-custom-values{max-height:56vh;overflow:auto;border:1px solid var(--line);border-radius:8px}.dr-custom-values table{border-collapse:collapse;width:max-content;min-width:100%;font-size:13px}.dr-custom-values th,.dr-custom-values td{padding:7px 9px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);text-align:left;vertical-align:top}.dr-custom-values th{position:sticky;top:0;background:#f7faf8;z-index:1}.dr-custom-values input{width:180px;max-width:32vw;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font:inherit}.modal.xwide.dorm-roster-preview-modal{left:204px!important;right:36px!important;top:72px!important;bottom:24px!important;width:auto!important;height:auto!important;transform:none!important}.modal.xwide.dorm-roster-preview-modal .modal-body{padding:0;display:flex;flex:1 1 0;min-height:0;overflow:hidden}.modal.xwide.dorm-roster-preview-modal .dr-modal-preview{flex:1 1 auto;min-height:0;max-height:none;overflow:auto;background:#edf1f3;padding:16px}.dr-modal-preview .dr-page{transform:scale(.72);transform-origin:top left;margin-bottom:calc(-297mm * .28);box-shadow:0 1px 8px #aab1b6}@media(max-width:900px){.modal.xwide.dorm-roster-preview-modal{left:12px!important;right:12px!important;top:12px!important;bottom:12px!important}}@media print{.dr-preview{display:none}}';document.head.appendChild(style);
  const rosterIdLayoutStyle=document.createElement("style");
  rosterIdLayoutStyle.textContent='.dr-photo-col{width:24mm;flex-basis:24mm}.dr-photo{width:24mm}.dr-photo-info>[data-roster-field="id"],.dr-photo-info>[data-roster-field="studentNo"],.dr-detail>[data-roster-field="id"],.dr-detail>[data-roster-field="studentNo"]{max-width:100%;white-space:nowrap;overflow-wrap:normal;word-break:keep-all;font-variant-numeric:tabular-nums;letter-spacing:-.12px;font-size:6.2px}';
  document.head.appendChild(rosterIdLayoutStyle);
  window.DormRosterLayout=Object.freeze({columns:ROSTER_COLUMNS,rows:ROSTER_ROWS,pageSize:ROSTER_PAGE_SIZE,identityKeys:Object.freeze(["id","name","gender","ethnic"]),renderPage:renderRosterPage,encodePng:canvasPngBytes,css:style.textContent+rosterIdLayoutStyle.textContent});
})();
