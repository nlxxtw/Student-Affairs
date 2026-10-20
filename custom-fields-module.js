"use strict";

/* 业务台账扩展字段：字段定义独立保存，字段值跟随原记录保存与备份。 */
(function(){
  const SCHEMA_KEY="nnuzc_custom_field_schemas_v1";
  const VALUES_KEY="customFieldValues";
  const RESERVED=new Set(["id","学号","姓名","学院","专业","年级","班级","学期","学年","状态","日期"]);
  const TYPES={text:"单行文字",textarea:"多行文字",number:"数字",date:"日期",select:"下拉选项"};
  /* 静态清单保证空台账也能看见原有字段；记录中的其他业务字段会在下方自动补齐。 */
  const SYSTEM_BASE={
    classOfficer:"studentId:学号|position:职务|startDate:任职日期|endDate:离任日期|status:任职状态|duties:职责|note:备注",
    dorm:"id:学号|name:姓名|dept:学院|major:专业|grade:年级|cls:班级|accom:住宿情况|zone:区位|building:宿舍楼|room:房间号|bed:床位号",
    fund:"studentId:学号|name:姓名|dept:学院|major:专业|grade:年级|cls:班级|term:学期|isPoor:困难生认定|poorLevel:困难等级|national:国家助学金|college:校级资助|temporaryAid:临时困难补助|other:其他资助",
    studentLoan:"year:学年|studentId:学号|name:姓名|dept:学院|major:专业|grade:年级|cls:班级|bank:贷款银行|amount:贷款金额",
    punishment:"studentId:学号|name:姓名|term:学期|type:处分类型|level:处分级别|date:处分日期|content:处分事由|files:附件",
    courseTimetable:"term:学期|cls:班级|day:星期|section:节次|weeks:教学周|course:课程名称|teacher:任课教师|room:上课地点",
    classroom:"studentId:学号|name:姓名|term:学期|date:日期|course:课程|reason:情况说明|score:扣分",
    dormviolate:"studentId:学号|name:姓名|term:学期|date:违纪日期|dorm:宿舍|reason:违纪原因|score:扣分|files:附件",
    party:"studentId:学号|name:姓名|political:政治面貌|leagueStatus:团员身份|stage:发展阶段|date:日期|note:备注",
    psych:"studentId:学号|name:姓名|level:关注级别|issues:关注问题|note:备注|updated:更新日期",
    meeting:"term:学期|topic:活动主题|date:日期|place:地点|host:主持人|content:内容纪要|classes:班级|files:附件",
    talks:"term:学期|sid:学号|name:姓名|dept:学院|cls:班级|date:谈话日期|type:谈话类型|way:谈话方式|mood:情绪|content:谈话内容|followUp:后续跟进",
    keycare:"studentId:学号|studentName:姓名|level:关爱级别|source:来源|action:关爱措施|nextDate:下次跟进日期|term:学期|status:状态|closeNote:结案说明|owner:负责人",
    home:"term:学期|sid:学号|name:姓名|dept:学院|cls:班级|date:联系日期|channel:联系渠道|topic:沟通主题|content:沟通内容|result:反馈结果",
    events:"term:学期|sid:学号|name:姓名|dept:学院|cls:班级|date:日期|type:事件类型|way:处理方式|mood:情绪|content:事件内容|followUp:后续跟进|files:附件",
    checkClass:"term:学期|date:日期|cls:班级|course:课程|teacher:教师|content:情况说明",
    checkDorm:"term:学期|date:日期|building:楼栋|room:房间号|hygiene:卫生情况|visited:是否走访|count:在寝人数|content:走访情况",
    help:"term:学期|sid:学号|name:姓名|dept:学院|cls:班级|type:帮扶类型|status2:帮扶状态|date:日期|responsible:负责人|goal:帮扶目标|freq:帮扶频率|content:帮扶内容|progress:帮扶进展",
    tasks:"title:任务名称|studentId:学号|studentName:姓名|source:来源|priority:优先级|dueDate:截止日期|duty:责任人|term:学期|repeat:重复规则|status:状态|note:备注",
    awardStatistics:"sid:学号|name:姓名|dept:学院|major:专业|grade:年级|cls:班级|honorTitle:荣誉称号名称|competitionName:学科竞赛名称|award:奖项|term:评定学期|academicYear:评定学年|awardDate:获奖日期|certificate:获奖证书",
    otherViolation:"term:学期|studentId:学号|name:姓名|dept:学院|major:专业|grade:年级|cls:班级|type:违纪类型|date:日期|location:地点|reason:违纪情况|files:附件",
    counselorGrowth:"type:成果类型|title:成果名称|level:级别|resultDate:取得日期|academicYear:学年|role:角色|rank:排名|organization:单位|collaborators:合作者|studentNames:获奖学生/团队|attachments:附件|representative:代表性成果|archived:归档状态",
    employment:"sid:学号|name:姓名|term:学期|status:就业状态|company:就业单位|position:岗位|contacts:联系记录"
  };
  const SYSTEM_LABELS={id:"记录ID",sid:"学号",studentId:"学号",studentName:"姓名",name:"姓名",dept:"学院",major:"专业",grade:"年级",cls:"班级",term:"学期",year:"学年",date:"日期",status:"状态",note:"备注",content:"内容",type:"类型",title:"名称",level:"级别",amount:"金额",bank:"银行",url:"网址",files:"附件",attachment:"附件",attachments:"附件",source:"来源",createdAt:"创建时间",updatedAt:"更新时间"};
  const SYSTEM_HIDDEN=new Set(["customFieldValues","customFieldRecordId","_source","_student","_meta","_rid","__hit","createdAt","updatedAt","importFile"]);
  const allRegistry={
    student:{name:"学生管理",rows:()=>students,save:()=>persistStudents()},
    classOfficer:{name:"班级干部管理",rows:()=>classOfficerRecords,save:()=>persistClassOfficerRecords()},
    dorm:{name:"宿舍管理",rows:()=>dormDistRecords,save:()=>persistDormDist()},
    fund:{name:"资助情况",rows:()=>fundRecords,save:()=>persistFund()},
    studentLoan:{name:"助学贷款",rows:()=>studentLoanRecords,save:()=>persistStudentLoans()},
    punishment:{name:"处分情况",rows:()=>punishments,save:()=>persistPunishments()},
    academicRecord:{name:"综测数据 · 综测记录",hostView:"eval",rows:()=>academicRows("regular"),save:(rows)=>saveAcademicRows("regular",rows)},
    academicWarning:{name:"学业情况（个人版） · 学业预警（个人版）",hostView:"academic",rows:()=>academicRows("warning"),save:(rows)=>saveAcademicRows("warning",rows)},
    academicGrade:{name:"学业情况（个人版） · 成绩与排名（个人版）",hostView:"academic",rows:()=>academicRows("grade"),save:(rows)=>saveAcademicRows("grade",rows)},
    courseTimetable:{name:"实时课表",rows:()=>courseSchedules,save:()=>persistCourseSchedules()},
    classroom:{name:"课堂记录",rows:()=>nestedRows("classroom"),save:(rows)=>saveNestedRows(rows)},
    dormviolate:{name:"宿舍违纪",rows:()=>nestedRows("dorm"),save:(rows)=>saveNestedRows(rows)},
    party:{name:"党团员发展",rows:()=>studentSubRows("party"),save:(rows)=>saveStudentSubRows("party",rows)},
    psych:{name:"心理预警",rows:()=>studentSubRows("psych"),save:(rows)=>saveStudentSubRows("psych",rows)},
    meeting:{name:"班会/活动",rows:()=>meetings,save:()=>persistMeetings()},
    talks:{name:"谈心谈话",rows:()=>talkRecords,save:()=>persistTalks()},
    keycare:{name:"重点关爱",rows:()=>keyCareRecords,save:()=>persistKeyCare()},
    home:{name:"家校联系",rows:()=>homeRecords,save:()=>persistHome()},
    events:{name:"突发事件",rows:()=>eventRecords,save:()=>persistEvents()},
    checkClass:{name:"查课记录",rows:()=>checkClassRecords,save:()=>persistCheckClass()},
    checkDorm:{name:"查寝记录",rows:()=>checkDormRecords,save:()=>persistCheckDorm()},
    help:{name:"帮扶记录",rows:()=>helpRecords,save:()=>persistHelp()},
    tasks:{name:"工作任务",rows:()=>taskRecords,save:()=>persistTasks()},
    achievement:{name:"获奖情况",rows:()=>achievementRecords,save:()=>achievementPersist()},
    awardStatistics:{name:"获奖统计",rows:()=>storedRows("nnuzc_award_statistics_records"),save:(rows)=>{storeRows("nnuzc_award_statistics_records",rows);window.awardStatisticsReload();}},
    certificate:{name:"证书识别",rows:()=>{if(!certificateRecords.length&&localStorage.getItem("nnuzc_certificate_records")&&typeof window.__certificateEnhancedLoad==="function")window.__certificateEnhancedLoad();return certificateRecords;},save:()=>certPersist()},
    subjectCompetition:{name:"科创竞赛",rows:()=>subjectCompetitionRecords,save:()=>subjectCompetitionPersist()},
    employment:{name:"就业跟踪",rows:()=>xcmGet("employment").records,save:()=>xcmPersist("employment")},
    employmentIntention:{name:"就业意向",hostView:"employment",rows:()=>employmentIntentionRecords,save:()=>employmentIntentionPersist()},
    employmentResource:{name:"就业资源",hostView:"employment",rows:()=>employmentResourceRecords,save:()=>employmentResourcePersist()},
    otherViolation:{name:"其他违纪记录",rows:()=>storedRows("nnuzc_other_violation_records"),save:(rows)=>storeRows("nnuzc_other_violation_records",rows)},
    counselorGrowth:{name:"成长档案",rows:()=>storedRows("nnuzc_counselor_growth_records_v1"),save:(rows)=>{storeRows("nnuzc_counselor_growth_records_v1",rows);window.counselorGrowthReload();}}
  };
  /* 字段管理仅保留在“学生信息管理”和“个人发展”两个导航分组。 */
  const RETAINED_VIEWS=new Set(["student","classOfficer","dorm","counselorGrowth"]),registry={};
  Object.keys(allRegistry).forEach(view=>{if(RETAINED_VIEWS.has(view))registry[view]=allRegistry[view];});
  function storedRows(key){try{const value=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(value)?value:[];}catch(error){reportDataError("自定义字段记录读取",error);return [];}}
  function storeRows(key,rows){localStorage.setItem(key,JSON.stringify(rows));}
  function studentSubRows(key){return students.filter(s=>s[key]&&typeof s[key]==="object").map(s=>{const row={id:s.id,name:s.name,studentId:s.id,customFieldValues:s[key].customFieldValues||{},_student:s};if(key==="party")row.political=s.political||"";return row;});}
  function saveStudentSubRows(key,rows){rows.forEach(row=>{if(row._student&&row._student[key])row._student[key].customFieldValues=row.customFieldValues;});persistStudents();}
  function nestedRows(key){let changed=false;const rows=[];students.forEach(s=>(s[key]||[]).forEach(r=>{if(!r||typeof r!=="object")return;if(!r.customFieldRecordId){r.customFieldRecordId=makeId();changed=true;}rows.push({id:r.customFieldRecordId,name:s.name,studentId:s.id,term:r.term,date:r.date,content:r.reason||r.course||"",customFieldValues:r.customFieldValues||{},_source:r});}));if(changed)persistStudents();return rows;}
  function saveNestedRows(rows){rows.forEach(row=>{if(row._source)row._source.customFieldValues=row.customFieldValues;});persistStudents();}
  function academicRows(kind){const warning=kind==="warning",grade=kind==="grade",terms=grade?window.gradeTerms:(warning?window.academicWarningTerms:window.academicTerms),rows=[];let changed=false;
    (terms||[]).forEach(term=>(term.rows||[]).forEach(row=>{if(!row||typeof row!=="object")return;if(!row._rid&&!row.customFieldRecordId){row.customFieldRecordId=makeId();changed=true;}const uid=row._rid||row.customFieldRecordId;
      rows.push({id:(grade?"ag":(warning?"aw":"ac"))+":"+term.id+":"+uid,name:row["姓名"],studentId:row["学号"],term:term.term,customFieldValues:row.customFieldValues||{},_source:row});}));
    if(changed){if(grade)saveGradeTerms();else if(warning)saveAcademicWarningTerms();else saveAcademicTerms();}return rows;
  }
  function saveAcademicRows(kind,rows){rows.forEach(row=>{if(row._source)row._source.customFieldValues=row.customFieldValues;});if(kind==="grade")saveGradeTerms();else if(kind==="warning")saveAcademicWarningTerms();else saveAcademicTerms();}
  function schemaStore(){try{const value=JSON.parse(localStorage.getItem(SCHEMA_KEY)||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}catch(error){reportDataError("自定义字段配置读取",error);return {};}}
  function fields(view){const value=schemaStore()[view];return Array.isArray(value)?value.filter(f=>f&&f.id&&f.name):[];}
  function activeFields(view){return fields(view).filter(f=>f.active!==false);}
  function values(record){const value=record&&record[VALUES_KEY];return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}
  function renderHost(view){renderPage(registry[view].hostView||view);}
  function originalRecord(view,record){
    if(view==="certificate"&&record&&record.data&&typeof record.data==="object")return Object.assign({},record,record.data);
    return record._source||(record._student&&record._student[view])||record;
  }
  function purgeRemovedFieldManagement(){const store=schemaStore();let schemaChanged=false;Object.keys(store).forEach(view=>{if(!RETAINED_VIEWS.has(view)){delete store[view];schemaChanged=true;}});if(schemaChanged)localStorage.setItem(SCHEMA_KEY,JSON.stringify(store));
    Object.keys(allRegistry).filter(view=>!RETAINED_VIEWS.has(view)).forEach(view=>{try{const entry=allRegistry[view],rows=entry.rows();let changed=false;rows.forEach(record=>{if(!record)return;const target=record._source||(record._student&&record._student[view])||record;if(target&&Object.prototype.hasOwnProperty.call(target,VALUES_KEY)){delete target[VALUES_KEY];changed=true;}});if(changed)entry.save(rows);}catch(error){reportDataError("移除字段管理数据 · "+view,error);}});
  }
  purgeRemovedFieldManagement();
  function systemDefinitions(view){
    const list=[{key:"id",label:view==="student"||view==="dorm"?"学号":"记录ID"}];
    const add=(key,label)=>{key=String(key||"");if(key&&!SYSTEM_HIDDEN.has(key)&&!list.some(item=>item.key===key))list.push({key,label:String(label||SYSTEM_LABELS[key]||key)});};
    const staticList=SYSTEM_BASE[view]||"";staticList.split("|").filter(Boolean).forEach(item=>{const cut=item.indexOf(":");add(item.slice(0,cut),item.slice(cut+1));});
    const definitions={student:()=>STU_IMPORT_FIELDS.map(item=>[item[0],item[1]]).concat([
        ["photo","学籍照片"],["idPhoto","证件照"],["statusAttachment","学籍异动单（图片）"],
        ["cadreHistory","历史班级干部任职"],["accom","住宿情况"],["building","楼栋"],["room","房间号"],["bed","床位"]
      ]),
      academicRecord:()=>ACADEMIC_FIELDS.map(key=>[key,(ACADEMIC_FIELD_LABEL_BY_KEY||{})[key]||key]),
      academicWarning:()=>ACADEMIC_WARNING_FIELDS.map(key=>[key,key]),
      academicGrade:()=>GRADE_FIELDS.map(key=>[key,key]),
      achievement:()=>ACHIEVEMENT_FIELDS.map(field=>[field.key,field.label]),
      certificate:()=>CERT_FIELDS.map(field=>[field.key,field.label]),
      employmentIntention:()=>EMPLOYMENT_INTENTION_FIELDS.map(field=>[field.key,field.label]),
      employmentResource:()=>EMPLOYMENT_RESOURCE_FIELDS.map(field=>[field.key,field.label]),
      subjectCompetition:()=>SUBJECT_COMPETITION_FIELDS.map(field=>[field.key,field.label])};
    if(definitions[view])definitions[view]().forEach(item=>add(item[0],item[1]));
    registry[view].rows().slice(0,100).forEach(record=>{const raw=originalRecord(view,record);[record,raw].forEach(source=>Object.keys(source||{}).forEach(key=>{
      const value=source[key],fileField=["photo","idPhoto","certificate","attachment","attachments","files","disabCert","statusAttachment"].includes(key);
      if(!key.startsWith("_")&&(value==null||typeof value!=="object"||fileField))add(key);
    }));});
    return list;
  }
  function systemValue(view,record,key){const raw=originalRecord(view,record),value=raw[key]===undefined?record[key]:raw[key];
    if(value==null||value==="")return "—";
    if(Array.isArray(value))return value.length?value.map(item=>item&&typeof item==="object"?(item.name||item.title||item.id||"一项"):String(item)).join("、").slice(0,250):"—";
    if(typeof value==="object")return value.name||value.title||value.fileName||(value.id?"已上传":"已记录");
    return String(value).slice(0,250);
  }
  function recordId(record){return record&&record.id!=null?String(record.id):"";}
  function recordLabel(record){return [record.name||record.title||record.awardName||record.course||record.content||record.topic||record.position||record.company||record.studentId||record.sid||record.id,record.studentId||record.sid||record.id||"",record.term||record.year||record.date||""].map(v=>String(v||"").trim()).filter(Boolean).join(" · ").slice(0,120);}
  function identifiedRows(view){const seen=new Set();return registry[view].rows().filter(record=>{const id=recordId(record);if(!id||seen.has(id))return false;seen.add(id);return true;});}
  function makeId(){return "cf_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,10);}
  function choices(field){return String(field.choices||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
  function fieldRow(field){return '<div class="cf-field-row" data-id="'+attr(field.id||"")+'" data-new="'+(!field.id?"1":"0")+'">'
    +'<input class="cf-name in" maxlength="40" aria-label="字段名称" placeholder="字段名称" value="'+attr(field.name||"")+'">'
    +'<select class="cf-type in" aria-label="字段类型" '+(field.id?'disabled':'')+'>'+Object.keys(TYPES).map(k=>'<option value="'+k+'"'+(field.type===k?' selected':'')+'>'+TYPES[k]+'</option>').join("")+'</select>'
    +'<input class="cf-choices in" maxlength="600" aria-label="下拉选项" placeholder="下拉项用顿号分隔" value="'+attr(String(field.choices||"").replace(/\n/g,"、"))+'">'
    +'<label><input type="checkbox" class="cf-active" onchange="customFieldsActiveChanged(this)" '+(field.active!==false?'checked':'')+'> 启用</label>'
    +'<button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsMove(this,-1)" aria-label="上移">↑</button>'
    +'<button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsMove(this,1)" aria-label="下移">↓</button>'
    +'<button type="button" class="btn btn-ghost btn-sm cf-delete" onclick="customFieldsRemove(this)" title="删除字段及该字段的全部历史值">删除</button>'
    +'</div>';
  }
  function systemFieldType(key){if(/date|time|日期|时间/i.test(key))return "日期/时间";if(/amount|score|count|rank|金额|分数|数量/i.test(key))return "数字";if(/files?|attachments?|photo|certificate|附件|照片|证书/i.test(key))return "附件";return "系统字段";}
  function systemFieldRows(view){return systemDefinitions(view).map(field=>'<div class="cf-system-row"><div><b>'+esc(field.label)+'</b><small>'+esc(field.key)+'</small></div><span>'+esc(systemFieldType(field.key))+'</span><span class="cf-lock">🔒 系统字段</span></div>').join("");}
  function systemValuesMarkup(view,record){return '<details class="cf-system-values"><summary>系统字段（只读） · '+systemDefinitions(view).length+' 个</summary><div class="cf-system-value-grid">'+systemDefinitions(view).map(field=>'<div><small>'+esc(field.label)+'</small><b>'+esc(systemValue(view,record,field.key))+'</b></div>').join("")+'</div></details>';}
  function settingsStyles(){return '<style>.cf-section-head{display:flex;align-items:center;gap:8px;margin:16px 0 8px}.cf-section-head:first-of-type{margin-top:12px}.cf-section-head b{font-size:15px}.cf-count{padding:2px 7px;border-radius:10px;background:var(--primary-l);color:var(--primary);font-size:12px}.cf-system-list{border:1px solid var(--border);border-radius:10px;max-height:260px;overflow:auto}.cf-system-row{display:grid;grid-template-columns:minmax(150px,1fr) 110px 100px;gap:10px;align-items:center;padding:9px 11px;border-bottom:1px solid var(--border)}.cf-system-row:last-child{border-bottom:0}.cf-system-row b,.cf-system-row small{display:block}.cf-system-row small{margin-top:2px;color:var(--muted);font-size:11px}.cf-system-row>span{font-size:12px;color:var(--muted)}.cf-system-row .cf-lock{color:var(--text);white-space:nowrap}.cf-custom-head,.cf-field-row{display:grid;grid-template-columns:minmax(130px,1fr) 110px minmax(140px,1fr) 70px 34px 34px 58px;gap:7px;align-items:center}.cf-custom-head{padding:0 2px;color:var(--muted);font-size:11.5px}.cf-custom-head span:nth-last-child(2){grid-column:5/7;text-align:center}.cf-field-row{margin:8px 0}.cf-field-row input.in,.cf-field-row select.in{min-width:0;width:100%;box-sizing:border-box}.cf-field-row label{white-space:nowrap;font-size:13px}.cf-field-row .cf-delete{color:#c83f49;border-color:#efc5c9}.cf-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 12px}.cf-edit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cf-edit-grid .field{min-width:0}.cf-edit-grid textarea{width:100%;min-height:76px}.cf-system-values{margin:12px 0;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.cf-system-values summary{cursor:pointer;padding:10px 12px;font-weight:700}.cf-system-value-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 12px 12px}.cf-system-value-grid>div{min-width:0;padding:8px 10px;border-radius:8px;background:var(--card)}.cf-system-value-grid small,.cf-system-value-grid b{display:block}.cf-system-value-grid small{color:var(--muted);margin-bottom:3px}.cf-system-value-grid b{font-size:13px;overflow-wrap:anywhere}.cf-records{max-height:50vh;overflow:auto}.cf-records table{width:100%}@media(max-width:750px){.cf-system-row{grid-template-columns:1fr 90px}.cf-system-row .cf-lock{grid-column:1/-1}.cf-custom-head{display:none}.cf-field-row{grid-template-columns:1fr 1fr 52px 32px 32px 58px}.cf-field-row .cf-choices{grid-column:1/-1;grid-row:2}.cf-edit-grid,.cf-system-value-grid{grid-template-columns:1fr}}</style>';}
  function validate(definitions,view){
    if(definitions.length>40)return "每个模块最多设置 40 个自定义字段";
    const seen=new Set(),original=new Map(fields(view).map(field=>[field.id,field.name]));
    const fixed=new Set(systemDefinitions(view).flatMap(field=>[field.key,field.label]).concat(Array.from(RESERVED)).map(name=>name.toLocaleLowerCase()));
    for(const f of definitions){
      if(!f.name)return "字段名称不能为空";
      if(fixed.has(f.name.toLocaleLowerCase())&&original.get(f.id)!==f.name)return "「"+f.name+"」是系统字段，不能重复定义";
      const key=f.name.toLocaleLowerCase();if(seen.has(key))return "字段名称不能重复：「"+f.name+"」";seen.add(key);
      if(!TYPES[f.type])return "字段类型无效";
      if(f.type==="select"&&!choices(f).length)return "下拉字段「"+f.name+"」至少需要一个选项";
    }
    return "";
  }
  function valueError(field,value){
    if(!value)return "";
    if(field.type==="number"&&!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(value))return "「"+field.name+"」应为数字";
    if(field.type==="date"&&!/^\d{4}-\d{2}-\d{2}$/.test(value))return "「"+field.name+"」应为 YYYY-MM-DD 日期";
    if(field.type==="select"&&!choices(field).includes(value))return "「"+field.name+"」不在当前选项中";
    if(value.length>2000)return "「"+field.name+"」不能超过 2000 字";
    return "";
  }
  window.customFieldsDetailHtml=function(view,record,title){const all=fields(view),saved=values(record),visible=all.filter(f=>f.active!==false||String(saved[f.id]??"")!=="");if(!visible.length)return "";
    return '<div class="zf-section">'+esc(title||(registry[view].name+" · 自定义字段"))+'</div><div class="zf-form">'+visible.map(f=>'<div class="f"><div class="k">'+esc(f.name)+(f.active===false?'（已停用）':'')+'</div><div class="v">'+esc(saved[f.id]??"—")+'</div></div>').join("")+'</div>';
  };
  function nativeFieldInput(field,value,prefix){const id=prefix+field.id,kind=field.type||"text",common='id="'+attr(id)+'" class="in cf-native-value" data-field="'+attr(field.id)+'"';
    if(kind==="textarea")return '<textarea '+common+' rows="3">'+esc(value)+'</textarea>';
    if(kind==="select"){const opts=choices(field),known=opts.slice();if(value&&!opts.includes(value))opts.unshift(value);return '<select '+common+'><option value="">未填写</option>'+opts.map(v=>'<option value="'+attr(v)+'"'+(v===value?' selected':'')+'>'+esc(v)+(known.includes(v)?'':'（历史值）')+'</option>').join("")+'</select>';}
    return '<input '+common+' type="'+(kind==="number"||kind==="date"?kind:"text")+'" value="'+attr(value)+'">';
  }
  window.customFieldsFormHtml=function(view,record){if(!registry[view])return "";const active=activeFields(view),current=values(record||{});if(!active.length)return "";const prefix="cfNative_"+view+"_";
    return '<div class="zf-section">'+esc(registry[view].name)+' · 自定义字段</div><style>.cf-native-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cf-native-grid .field{min-width:0}.cf-native-grid .in{width:100%;box-sizing:border-box}.cf-native-grid textarea{min-height:76px}@media(max-width:750px){.cf-native-grid{grid-template-columns:1fr}}</style><div class="cf-native-grid">'+active.map(field=>'<div class="field"><label for="'+attr(prefix+field.id)+'">'+esc(field.name)+'</label>'+nativeFieldInput(field,String(current[field.id]??""),prefix)+'</div>').join("")+'</div>';
  };
  window.customFieldsReadForm=function(view,record){if(!registry[view])return {ok:true,values:Object.assign({},values(record||{}))};const current=Object.assign({},values(record||{})),prefix="cfNative_"+view+"_";
    for(const field of activeFields(view)){const element=document.getElementById(prefix+field.id);if(!element)continue;const value=String(element.value||"").trim(),error=valueError(field,value);if(error)return {ok:false,error:error};current[field.id]=value;}
    return {ok:true,values:current};
  };
  const STUDENT_DIRECT_KEYS={
    student:["id"],classOfficer:["studentId"],dorm:["studentId","id"],fund:["studentId","id"],studentLoan:["studentId"],punishment:["studentId"],
    academicRecord:["studentId"],academicWarning:["studentId"],academicGrade:["studentId"],classroom:["studentId"],dormviolate:["studentId"],party:["studentId","id"],psych:["studentId","id"],
    talks:["sid","studentId"],keycare:["studentId"],home:["sid","studentId"],events:["sid","studentId"],help:["sid","studentId"],tasks:["studentId","sid"],
    achievement:["sid","studentId"],awardStatistics:["sid","studentId"],certificate:["sid","studentId"],employment:["sid","studentId"],employmentIntention:["sid","studentId"],otherViolation:["studentId","sid"]
  };
  function recordMatchesStudent(view,record,student){
    const raw=originalRecord(view,record)||{},sid=String(student&&student.id||"");
    if(!sid)return false;
    if((STUDENT_DIRECT_KEYS[view]||[]).some(key=>String(raw[key]===undefined?record[key]:raw[key])===sid))return true;
    const cls=String(student.cls||"");
    if(view==="checkClass")return !!cls&&ccClassesOf(raw).includes(cls);
    if(view==="courseTimetable")return !!cls&&String(raw.cls||record.cls||"")===cls;
    if(view==="meeting"){
      const classes=Array.isArray(raw.classes)?raw.classes:String(raw.classes||raw.cls||"").split(/[、,，;；\s]+/).filter(Boolean);
      return !!cls&&classes.map(String).includes(cls);
    }
    if(view==="checkDorm")return String(raw.building||record.building||"")===String(student.building||student.dormBuild||"")&&String(raw.room||record.room||"")===String(student.room||student.dormRoom||"")&&!!String(raw.room||record.room||"");
    return false;
  }
  function portraitFieldRows(view,student){
    const definitions=fields(view),matched=registry[view].rows().filter(record=>recordMatchesStudent(view,record,student));
    if(!definitions.length||!matched.length)return [];
    const visible=definitions.filter(field=>field.active!==false||matched.some(record=>String(values(record)[field.id]??"")!==""));
    if(!visible.length)return [];
    return matched.map(record=>({record:record,entries:visible.map(field=>({field:field,value:String(values(record)[field.id]??"")})).filter(item=>view==="student"||item.value!=="")})).filter(row=>row.entries.length);
  }
  window.customFieldsStudentPortraitHtml=function(student){
    if(!student||!student.id)return "";
    const groups=Object.keys(registry).map(view=>({view:view,rows:portraitFieldRows(view,student)})).filter(group=>group.rows.length);
    if(!groups.length)return "";
    const body=groups.map(group=>'<div class="card" style="padding:11px 13px;margin:8px 0"><b>'+esc(registry[group.view].name)+'</b><div style="display:grid;gap:8px;margin-top:8px">'+group.rows.map(row=>'<div style="border-top:1px dashed var(--border);padding-top:7px"><small style="display:block;color:var(--muted);margin-bottom:5px">'+esc(recordLabel(row.record)||student.name||student.id)+'</small><div class="zf-form">'+row.entries.map(item=>'<div class="f"><div class="k">'+esc(item.field.name)+(item.field.active===false?'（已停用）':'')+'</div><div class="v">'+esc(item.value||"—")+'</div></div>').join("")+'</div></div>').join("")+'</div></div>').join("");
    return '<div style="font-weight:700;margin:14px 0 8px">十五、自定义字段</div><div class="tip" style="margin-bottom:8px">汇总学生主档及按学号、班级、宿舍关联的业务扩展字段；班级和宿舍公共记录会标注其来源模块。</div>'+body;
  };
  function readSettings(view){const original=new Map(fields(view).map(f=>[f.id,f]));return Array.from(document.querySelectorAll("#cfSettingsRows .cf-field-row")).map(row=>{
    const id=row.dataset.id||makeId(),old=original.get(id);
    return {id,name:row.querySelector(".cf-name").value.trim(),type:old?old.type:row.querySelector(".cf-type").value,choices:row.querySelector(".cf-choices").value.split(/[、,，\n]/).map(s=>s.trim()).filter(Boolean).join("\n"),active:row.querySelector(".cf-active").checked};
  });}
  function saveSettings(view){const previous=fields(view),next=readSettings(view),error=validate(next,view);if(error){alert(error);return false;}const retained=new Set(next.map(field=>field.id)),removed=previous.filter(field=>!retained.has(field.id));
    const store=schemaStore();store[view]=next;localStorage.setItem(SCHEMA_KEY,JSON.stringify(store));
    if(removed.length){const removedIds=new Set(removed.map(field=>field.id)),rows=registry[view].rows();rows.forEach(record=>{const current=Object.assign({},values(record));let changed=false;removedIds.forEach(id=>{if(Object.prototype.hasOwnProperty.call(current,id)){delete current[id];changed=true;}});if(changed)record[VALUES_KEY]=current;});registry[view].save(rows);}
    showToast(removed.length?("已删除 "+removed.length+" 个字段及其全部历史值"):"自定义字段已保存；停用的字段及历史值仍保留","success");renderHost(view);return true;
  }
  window.customFieldsAdd=function(){const host=document.getElementById("cfSettingsRows"),empty=document.getElementById("cfSettingsEmpty");if(host&&host.children.length<40){if(empty)empty.remove();host.insertAdjacentHTML("beforeend",fieldRow({type:"text",active:true}));}};
  window.customFieldsMove=function(button,direction){const row=button.closest(".cf-field-row"),host=row.parentElement,other=direction<0?row.previousElementSibling:row.nextElementSibling;if(other)host.insertBefore(row,direction<0?other:other.nextSibling);};
  window.customFieldsActiveChanged=function(input){const row=input.closest(".cf-field-row");if(row)row.classList.toggle("cf-disabled",!input.checked);};
  window.customFieldsRemove=function(button){const row=button.closest(".cf-field-row");if(!row)return;const name=(row.querySelector(".cf-name")||{}).value||"未命名字段";if(row.dataset.new!=="1"&&!confirm("确认删除自定义字段“"+name+"”？\n\n保存后将同时删除该模块全部记录中的该字段历史值，此操作不可恢复。"))return;row.remove();const host=document.getElementById("cfSettingsRows");if(host&&!host.children.length)host.insertAdjacentHTML("afterend",'<div class="empty" id="cfSettingsEmpty">暂无自定义字段，可点击下方按钮新增。</div>');};
  window.customFieldsSettings=function(view){if(!registry[view])return;
    const system=systemDefinitions(view),custom=fields(view);
    const body=settingsStyles()+'<div class="tip">下方显示本模块的全部已有字段。系统字段由原功能维护，只读且不可删除；自定义字段可新增、改名、排序、停用或删除。停用会保留历史值，删除会在保存后清除该字段及全部历史值。</div>'
      +'<div class="cf-section-head"><b>已有系统字段</b><span class="cf-count">'+system.length+' 个</span><span class="sub">字段名称下方为数据标识</span></div><div class="cf-system-list">'+systemFieldRows(view)+'</div>'
      +'<div class="cf-section-head"><b>自定义字段</b><span class="cf-count">'+custom.length+' 个</span></div><div class="cf-custom-head"><span>字段名称</span><span>字段类型</span><span>下拉选项</span><span>状态</span><span>排序</span><span>操作</span></div><div id="cfSettingsRows">'+custom.map(fieldRow).join("")+'</div>'
      +(!custom.length?'<div class="empty" id="cfSettingsEmpty">暂无自定义字段，可点击下方按钮新增。</div>':'')
      +'<div class="cf-toolbar"><button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsAdd()">＋ 增加字段</button><span class="sub">下拉选项使用顿号分隔；字段类型保存后锁定，避免历史值失真。</span></div>';
    openModal(registry[view].name+" · 字段管理",body,()=>saveSettings(view));
  };
  function editField(field,value){const id="cfValue_"+field.id,kind=field.type||"text",common='id="'+attr(id)+'" class="in cf-value" data-field="'+attr(field.id)+'"';
    if(kind==="textarea")return '<textarea '+common+' rows="3">'+esc(value)+'</textarea>';
    if(kind==="select"){const opts=choices(field);if(value&&!opts.includes(value))opts.unshift(value);return '<select '+common+'><option value="">未填写</option>'+opts.map(v=>'<option value="'+attr(v)+'"'+(v===value?' selected':'')+'>'+esc(v)+(choices(field).includes(v)?'':'（历史值）')+'</option>').join("")+'</select>';}
    return '<input '+common+' type="'+(kind==="number"||kind==="date"?kind:"text")+'" value="'+attr(value)+'">';
  }
  function editRecord(view,id){const source=registry[view].rows(),record=source.find(r=>recordId(r)===String(id));if(!record)return showToast("记录不存在，请刷新页面","warn");
    const all=fields(view),current=values(record),active=all.filter(f=>f.active!==false);
    const retired=all.filter(f=>f.active===false&&current[f.id]!=null&&String(current[f.id])!=="");
    const body=settingsStyles()+'<div class="tip">'+esc(recordLabel(record))+'　·　系统字段只读；自定义字段值跟随原记录保存。</div>'+systemValuesMarkup(view,record)
      +'<div class="cf-section-head"><b>自定义字段</b><span class="cf-count">'+active.length+' 个启用</span></div>'
      +'<div class="cf-edit-grid">'+active.map(f=>'<div class="field"><label for="cfValue_'+attr(f.id)+'">'+esc(f.name)+'</label>'+editField(f,String(current[f.id]??""))+'</div>').join("")+'</div>'
      +(!active.length?'<div class="empty">该模块暂未启用自定义字段，请先进入“字段管理”新增。</div>':'')
      +(retired.length?'<div class="tip" style="margin-top:12px">历史字段：'+retired.map(f=>esc(f.name)+"："+esc(current[f.id])).join("；")+'</div>':"");
    openModal(registry[view].name+" · 编辑自定义字段",body,()=>{
      const next=Object.assign({},current);
      for(const field of active){const element=document.getElementById("cfValue_"+field.id),value=element?element.value.trim():"",error=value===String(current[field.id]??"")?"":valueError(field,value);if(error){showToast(error,"warn");return false;}next[field.id]=value;}
      record[VALUES_KEY]=next;
      registry[view].save(source);
      showToast("自定义字段已保存","success");return true;
    });
  }
  window.customFieldsEditRecord=editRecord;
  function listMarkup(view,keyword){const all=identifiedRows(view),needle=String(keyword||"").trim().toLocaleLowerCase(),rows=needle?all.filter(r=>recordLabel(r).toLocaleLowerCase().includes(needle)||Object.values(values(r)).some(v=>String(v).toLocaleLowerCase().includes(needle))):all;
    const active=activeFields(view);return '<div class="tip">共 '+rows.length+' 条记录，显示前 100 条。筛选后可编辑；删除原记录时其字段值会一并删除。</div>'
      +'<div class="cf-records"><table><thead><tr><th>记录</th>'+active.map(f=>'<th>'+esc(f.name)+'</th>').join("")+'<th>操作</th></tr></thead><tbody>'
      +(rows.slice(0,100).map(r=>'<tr><td>'+esc(recordLabel(r))+'</td>'+active.map(f=>'<td>'+esc(values(r)[f.id]??"")+'</td>').join("")+'<td><button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsEditRecord('+jsArg(view)+','+jsArg(recordId(r))+')">编辑</button></td></tr>').join("")||'<tr><td colspan="'+(active.length+2)+'">暂无记录</td></tr>')+'</tbody></table></div>';
  }
  window.customFieldsFilter=function(view){const host=document.getElementById("cfRecordsList");if(host)host.innerHTML=listMarkup(view,document.getElementById("cfRecordSearch").value);};
  window.customFieldsRecords=function(view){if(!registry[view])return;
    const body=settingsStyles()+'<div class="cf-toolbar"><input id="cfRecordSearch" class="in" style="min-width:220px" placeholder="搜索记录或字段值" oninput="customFieldsFilter('+jsArg(view)+')">'
      +'<button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsExport('+jsArg(view)+')">⬇ 导出字段</button>'
      +'<button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsImport('+jsArg(view)+')">⬆ 导入字段</button></div><div id="cfRecordsList">'+listMarkup(view,"")+'</div>';
    openModal(registry[view].name+" · 自定义字段台账",body,()=>true);
    document.getElementById("modalFoot").innerHTML='<button class="btn btn-ghost" onclick="closeModal()">关闭</button>';
  };
  window.customFieldsExport=function(view){const all=fields(view),rows=identifiedRows(view);if(!all.length)return showToast("请先设置自定义字段","warn");
    downloadCSV(registry[view].name+"_自定义字段",["记录ID","记录名称"].concat(all.map(f=>f.name+(f.active===false?"（已停用）":""))),rows.map(r=>[recordId(r),recordLabel(r)].concat(all.map(f=>values(r)[f.id]??""))));
  };
  window.customFieldsTemplate=function(view){const all=activeFields(view);downloadCSV(registry[view].name+"_字段导入模板",["记录ID"].concat(all.map(f=>f.name)),[],{fixedOptions:Object.fromEntries(all.map(f=>[f.name,f.type==="select"?choices(f):[]]))});};
  window.customFieldsImport=function(view){const all=activeFields(view);if(!all.length)return showToast("请先设置自定义字段","warn");
    openMappedImportWizard({name:registry[view].name+"自定义字段",fields:[{key:"recordId",label:"记录ID",required:true}].concat(all.map(f=>({key:f.id,label:f.name,options:f.type==="select"?choices(f):[]}))),requiredFields:["记录ID"],template:"customFieldsTemplate("+jsArg(view)+")",defaultMode:"merge",
      validate:function(rows){const ids=new Set(identifiedRows(view).map(recordId)),seen=new Set(),ok=[],errors=[];rows.forEach((row,index)=>{const id=String(row.recordId||"").trim(),invalid=all.map(f=>valueError(f,String(row[f.id]||"").trim())).find(Boolean);if(!id||!ids.has(id))errors.push({row:index+2,msg:"记录ID不存在："+id});else if(seen.has(id))errors.push({row:index+2,msg:"文件中记录ID重复："+id});else if(invalid)errors.push({row:index+2,msg:invalid});else{seen.add(id);ok.push(row);}});return {ok,errors};},
      apply:function(rows){const source=registry[view].rows(),byId=new Map(source.map(r=>[recordId(r),r]));rows.forEach(row=>{const record=byId.get(String(row.recordId).trim());if(!record)return;const next=Object.assign({},values(record));all.forEach(f=>{if(row[f.id]!=null&&String(row[f.id]).trim()!=="")next[f.id]=String(row[f.id]).trim();});record[VALUES_KEY]=next;});registry[view].save(source);return {ok:rows.length,skip:0};},
      after:function(result){showToast("自定义字段导入完成："+result.ok+" 条","success");renderHost(view);}});
  };
  const pageGroups={};Object.keys(registry).forEach(view=>{const page=registry[view].hostView||view;(pageGroups[page]||(pageGroups[page]=[])).push(view);});
  const pageCardStyles='<style>.cf-page-card{margin:0 0 12px!important;padding:12px 16px!important}.cf-page-layout{display:flex;align-items:center;justify-content:space-between;gap:16px;min-width:0}.cf-page-summary{display:flex;align-items:baseline;gap:14px;min-width:0;flex-wrap:wrap}.cf-page-title{font-size:14px;line-height:1.5;white-space:nowrap}.cf-page-counts{display:inline-flex;align-items:center;gap:7px;margin:0;color:var(--muted);font-size:13px;line-height:1.5;white-space:nowrap}.cf-page-counts strong{color:var(--text);font-weight:700}.cf-page-dot{width:3px;height:3px;border-radius:50%;background:var(--muted);opacity:.7}.cf-page-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex:none;flex-wrap:wrap}@media(max-width:760px){.cf-page-layout{align-items:flex-start;flex-direction:column}.cf-page-summary{gap:5px}.cf-page-counts{width:100%}.cf-page-actions{width:100%;justify-content:flex-start}}</style>';
  Object.keys(pageGroups).forEach(page=>{const original=PAGES[page];if(typeof original!=="function")return;PAGES[page]=function(){const card=pageGroups[page].map(view=>'<div class="card cf-page-card" data-cf-view="'+attr(view)+'"><div class="cf-page-layout"><div class="cf-page-summary"><b class="cf-page-title">'+esc(registry[view].name)+' · 字段扩展</b><span class="cf-page-counts"><span><strong>'+systemDefinitions(view).length+'</strong> 个系统字段</span><i class="cf-page-dot" aria-hidden="true"></i><span><strong>'+activeFields(view).length+'</strong> 个自定义字段启用</span></span></div><div class="cf-page-actions"><button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsSettings('+jsArg(view)+')">⚙ 字段管理</button><button type="button" class="btn btn-ghost btn-sm" onclick="customFieldsRecords('+jsArg(view)+')">查看/填写字段</button></div></div></div>').join("");return pageCardStyles+card+original();};});

  /* 原生业务弹窗桥接：所有已登记模块共用同一套字段渲染、校验和落库逻辑。
     新增记录以保存前后的记录 ID 差集定位；编辑/详情按弹窗标题和原表单值匹配记录。
     匹配不唯一时不注入，避免把字段写到错误记录。 */
  const NATIVE_VIEW_HINTS={academicWarning:/预警/,academicGrade:/成绩|排名/,academicRecord:/综测/,courseTimetable:/课表|课程/,classroom:/课堂|旷课/,employmentIntention:/就业意向/,employmentResource:/就业资源/,employment:/就业跟踪|就业信息/};
  const NATIVE_SKIP_TITLE=/字段管理|自定义字段|导入|导出|模板|预览|附件|批量|添加学期|编辑学期|学期设置|字典设置|个人档案/;
  function nativeViews(title){const page=typeof currentView==="undefined"?"":currentView,views=(pageGroups[page]||[]).filter(view=>activeFields(view).length);if(views.length<2)return views;const hinted=views.filter(view=>NATIVE_VIEW_HINTS[view]&&NATIVE_VIEW_HINTS[view].test(title));return hinted.length?hinted:views;}
  function nativeScalarSource(view,record){const raw=originalRecord(view,record)||{},source={};[record,raw].forEach(item=>Object.keys(item||{}).forEach(key=>{const value=item[key];if(!key.startsWith("_")&&(value==null||typeof value!=="object"))source[key]=value;}));return source;}
  function nativeRecordScore(view,record,title,body){const haystack=String(title||"")+"\n"+String(body||""),source=nativeScalarSource(view,record);let score=0;Object.keys(source).forEach(key=>{const value=String(source[key]??"").trim();if(value.length<2)return;const present=haystack.includes(value)||haystack.includes(attr(value))||haystack.includes(esc(value));if(!present)return;if(/^(id|studentId|sid|recordId)$/i.test(key))score+=14;else if(/^(name|studentName|title|topic|awardName)$/i.test(key))score+=6;else if(/^(term|year|date)$/i.test(key))score+=3;else score+=1;});const label=recordLabel(record);if(label&&String(title||"").includes(label))score+=18;return score;}
  function nativeMatch(view,title,body){const rows=identifiedRows(view),ranked=rows.map(record=>({record,score:nativeRecordScore(view,record,title,body)})).sort((a,b)=>b.score-a.score);if(!ranked.length)return null;if(ranked.length===1&&ranked[0].score>0)return ranked[0].record;if(ranked[0].score<5||ranked[0].score===ranked[1].score)return null;return ranked[0].record;}
  function nativeContext(title,body){title=String(title||"");body=String(body||"");if(NATIVE_SKIP_TITLE.test(title)||body.includes("cf-native-grid")||body.includes("· 自定义字段")||/字段扩展|查看\/填写字段/.test(title))return null;const isForm=/(新增|新建|添加|编辑|修改|录入|登记|记录|更新|设置)/.test(title),isView=/(详情|档案|明细)/.test(title)&&!isForm;if(!isForm&&!isView)return null;for(const view of nativeViews(title)){const isAdd=isForm&&/(新增|新建|添加|录入|登记|记录)/.test(title)&&!/(编辑|修改|更新)/.test(title),record=isAdd?null:nativeMatch(view,title,body);if(isAdd||record)return {view,record,mode:isView?"view":"form"};}return null;}
  function installNativeModalBridge(){const originalOpenModal=window.openModal;if(typeof originalOpenModal!=="function"||originalOpenModal.__customFieldsNativeBridge)return;const bridged=function(title,body,onOk){const context=nativeContext(title,body);if(!context)return originalOpenModal(title,body,onOk);const entry=registry[context.view],beforeRows=identifiedRows(context.view),beforeIds=new Set(beforeRows.map(recordId));if(context.mode==="view")return originalOpenModal(title,body+window.customFieldsDetailHtml(context.view,context.record),onOk);
      const initial=context.record||{},existingId=context.record?recordId(context.record):"",enhanced=body+window.customFieldsFormHtml(context.view,initial);
      return originalOpenModal(title,enhanced,async function(){const custom=window.customFieldsReadForm(context.view,initial);if(!custom.ok){showToast(custom.error,"warn");return false;}const result=onOk?await onOk():true;if(result===false)return false;const rows=identifiedRows(context.view);let target=existingId?rows.find(row=>recordId(row)===existingId):rows.find(row=>!beforeIds.has(recordId(row)));if(!target&&context.record)target=context.record;if(target){target[VALUES_KEY]=custom.values;entry.save(rows);showToast("业务信息与扩展字段已同步保存","success");}return result;});
    };bridged.__customFieldsNativeBridge=true;bridged.__originalOpenModal=originalOpenModal;window.openModal=bridged;}
  installNativeModalBridge();
  window.__CUSTOM_FIELDS__={fields,values,systemDefinitions,systemValue,registry,pageGroups,recordMatchesStudent,portraitFieldRows,formHtml:window.customFieldsFormHtml,readForm:window.customFieldsReadForm,nativeContext,installNativeModalBridge};
})();
