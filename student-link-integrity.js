"use strict";
(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.StudentLinkIntegrity=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  const STORAGE_LABELS={
    nnuzc_student_leaves:"请销假管理",nnuzc_fund_records:"资助情况",nnuzc_student_loan_records:"助学贷款",nnuzc_talks:"谈心谈话",
    nnuzc_home:"家校联系",nnuzc_events:"突发事件",nnuzc_checkclass:"查课记录",nnuzc_checkdorm:"查寝记录",
    nnuzc_help:"帮扶记录",nnuzc_keycare:"重点关爱",nnuzc_psych:"心理预警",nnuzc_class_officer_records:"班级干部任职",
    nnuzc_tasks:"工作任务",nnuzc_class_officer_assessment_terms:"班委考核",
    nnuzc_punishments:"处分情况",nnuzc_dorm_dist:"住宿分布",nnuzc_academic_terms:"综测数据（个人版）",
    nnuzc_academic_warnings:"学业预警（个人版）",nnuzc_grade_terms:"成绩与排名（个人版）",
    nnuzc_employment:"毕业生就业",nnuzc_employment_intentions:"就业意向",nnuzc_achievement_records:"获奖情况",
    nnuzc_awards:"历史获奖情况",nnuzc_award_statistics_records:"获奖统计",nnuzc_certificate_records:"证书识别",
    nnuzc_other_violation_records:"其他违纪记录",nnuzc_dorm_spatial_v1:"公寓空间入住关系",nnuzc_custom_roster_v1:"花名册（自定义版）"
  };
  const DIRECT_ID_KEYS=["sid","studentId","student_id","studentNo","学号"];
  const LIST_KEYS=new Set(["studentIds","absent","late","early","personalLeave","sickLeave","publicLeave"]);
  const BASIC_ROLES={
    "学号":"sid","学生学号":"sid","学生编号":"sid",
    "姓名":"name","学生姓名":"name",
    "学院":"dept","所属学院":"dept","所在学院":"dept","院系":"dept",
    "专业":"major","专业名称":"major",
    "年级":"grade","所在年级":"grade","现在年级":"grade",
    "班级":"cls","班级名称":"cls","行政班":"cls"
  };
  const MASTER_KEYS={sid:"id",name:"name",dept:"dept",major:"major",grade:"grade",cls:"cls"};
  function text(value){return String(value==null?"":value).trim();}
  function labelOf(field){return text(typeof field==="string"?field:(field&&field.label)||(field&&field.key));}
  function keyOf(field){return text(typeof field==="string"?field:(field&&field.key)||(field&&field.label));}
  function roleOf(field){
    const label=labelOf(field).replace(/\s+/g,"");
    return BASIC_ROLES[label]||"";
  }
  function listField(field){const label=labelOf(field);return /学号/.test(label)&&/名单/.test(label);}
  function splitIds(value){return text(value).split(/[、,，;；\s]+/).map(text).filter(Boolean);}
  function studentIndexes(students){
    const byId=new Map(),byName=new Map();
    (students||[]).forEach(function(student){
      const sid=text(student&&student.id),name=text(student&&student.name);if(sid)byId.set(sid,student);
      if(name){const values=byName.get(name)||[];values.push(student);byName.set(name,values);}
    });
    return {byId:byId,byName:byName};
  }
  function preserveSourceMeta(target,source,rowNumber){
    Object.defineProperty(target,"__importRowNumber",{value:rowNumber,enumerable:false});
    if(source&&Number.isInteger(source.__sourceIndex))Object.defineProperty(target,"__sourceIndex",{value:source.__sourceIndex,enumerable:false});
    return target;
  }
  function applyMasterStudent(source,roleFields,student,rowNumber){
    const row=preserveSourceMeta(Object.assign({},source||{}),source,rowNumber),corrections=[],fills=[];
    Object.keys(MASTER_KEYS).forEach(function(role){
      const descriptor=roleFields[role];if(!descriptor)return;
      let master=text(student&&student[MASTER_KEYS[role]]);if(role==="grade"&&!master&&student&&student.cls){const matched=text(student.cls).match(/(?:19|20)\d{2}/);master=matched?matched[0]+"级":"";}
      if(!master)return;
      const before=text(row[descriptor.key]);row[descriptor.key]=master;
      if(!before)fills.push({row:rowNumber,field:descriptor.label,after:master});
      else if(before!==master)corrections.push({row:rowNumber,field:descriptor.label,before:before,after:master,sid:text(student.id)});
    });
    return {row:row,corrections:corrections,fills:fills};
  }
  function identityOption(value,prefix,student,prepared){
    const changes=(prepared.corrections||[]).map(function(item){return item.field+"："+(item.before||"（空）")+"→"+(item.after||"（空）");}).concat((prepared.fills||[]).map(function(item){return item.field+"：（空）→"+(item.after||"（空）");}));
    return {value:value,label:prefix+text(student.id)+" "+text(student.name)+(changes.length?"（"+changes.slice(0,6).join("；")+(changes.length>6?"；……":"")+"）":""),row:prepared.row,corrections:prepared.corrections,fills:prepared.fills};
  }
  function resolveIdentityIssues(result,choices){
    const resolved={
      accepted:(result&&result.accepted||[]).slice(),rejected:(result&&result.rejected||[]).slice(),
      rejectedReferences:(result&&result.rejectedReferences||[]).slice(),corrections:(result&&result.corrections||[]).slice(),
      fills:(result&&result.fills||[]).slice(),identityIssues:(result&&result.identityIssues||[]).slice(),enabled:!!(result&&result.enabled)
    };
    resolved.identityIssues.forEach(function(issue,index){
      const options=issue.options||[],choice=text(choices&&choices[index])||(options.length?options[0].value:"original");
      if(choice==="skip"){resolved.rejected.push({row:issue.row,sid:issue.sid,name:issue.name,reason:issue.reason+"；已选择跳过"});return;}
      if(choice==="original"&&!options.length){resolved.accepted.push(preserveSourceMeta(Object.assign({},issue.source||{}),issue.source,issue.row));return;}
      const option=options.find(function(item){return item.value===choice;});
      if(!option){resolved.rejected.push({row:issue.row,sid:issue.sid,name:issue.name,reason:issue.reason+"；未选择有效学生"});return;}
      resolved.accepted.push(preserveSourceMeta(Object.assign({},option.row||{}),option.row,issue.row));
      resolved.corrections=resolved.corrections.concat(option.corrections||[]);resolved.fills=resolved.fills.concat(option.fills||[]);
    });
    return resolved;
  }
  function reconcileImportRows(rows,fields,students){
    const indexes=studentIndexes(students),descriptors=(fields||[]).map(function(field){return {field:field,key:keyOf(field),label:labelOf(field),role:roleOf(field),list:listField(field)};});
    const roleFields={};descriptors.forEach(function(item){if(item.role&&!roleFields[item.role])roleFields[item.role]=item;});
    const hasIdentity=!!(roleFields.sid||roleFields.name),listFields=descriptors.filter(function(item){return item.list;});
    const accepted=[],rejected=[],rejectedReferences=[],corrections=[],fills=[],identityIssues=[];
    (rows||[]).forEach(function(source,index){
      const rowNumber=Number(source&&source.__importRowNumber)||index+2,row=preserveSourceMeta(Object.assign({},source||{}),source,rowNumber);
      listFields.forEach(function(descriptor){
        const ids=splitIds(row[descriptor.key]),valid=[];
        ids.forEach(function(sid){if(indexes.byId.has(sid))valid.push(sid);else rejectedReferences.push({row:rowNumber,field:descriptor.label,sid:sid,reason:"学号“"+sid+"”未在学生管理中找到"});});
        row[descriptor.key]=valid.join("、");
      });
      if(hasIdentity){
        const sid=roleFields.sid?text(row[roleFields.sid.key]):"",name=roleFields.name?text(row[roleFields.name.key]):"";
        const sidStudent=sid?indexes.byId.get(sid):null,nameMatches=name?indexes.byName.get(name)||[]:[],nameStudent=nameMatches.length===1?nameMatches[0]:null;
        if(sid&&name&&sidStudent&&text(sidStudent.name)===name){const prepared=applyMasterStudent(row,roleFields,sidStudent,rowNumber);accepted.push(prepared.row);corrections.push.apply(corrections,prepared.corrections);fills.push.apply(fills,prepared.fills);return;}
        let reason="";
        if(sidStudent&&nameStudent&&text(sidStudent.id)!==text(nameStudent.id))reason="学号“"+sid+"”与姓名“"+name+"”分别对应不同学生";
        else if(!sid&&!name)reason="学号和姓名均为空";
        else if(!sid&&nameMatches.length>1)reason="未填写学号，且姓名“"+name+"”存在 "+nameMatches.length+" 名同名学生";
        else if(!sid)reason="未填写学号，不能完成学号与姓名组合核验";
        else if(!name)reason="未填写姓名，不能完成学号与姓名组合核验";
        else if(!sidStudent&&nameMatches.length>1)reason="学号“"+sid+"”未找到，且姓名“"+name+"”存在 "+nameMatches.length+" 名同名学生";
        else if(!sidStudent)reason="学号“"+sid+"”未在学生管理中找到";
        else if(nameMatches.length>1)reason="姓名“"+name+"”存在 "+nameMatches.length+" 名同名学生，且与学号对应姓名不一致";
        else reason="学号“"+sid+"”对应姓名为“"+text(sidStudent.name)+"”，与导入姓名“"+name+"”不一致";
        const options=[];
        if(sidStudent){const prepared=applyMasterStudent(row,roleFields,sidStudent,rowNumber);options.push(identityOption("sid","采用学号对应学生：",sidStudent,prepared));}
        if(nameStudent&&(!sidStudent||text(nameStudent.id)!==text(sidStudent.id))){const prepared=applyMasterStudent(row,roleFields,nameStudent,rowNumber);options.push(identityOption("name","采用姓名对应学生：",nameStudent,prepared));}
        identityIssues.push({row:rowNumber,sid:sid,name:name,reason:reason,source:row,options:options,defaultChoice:options.length?options[0].value:"original"});return;
      }
      accepted.push(row);
    });
    return {accepted:accepted,rejected:rejected,rejectedReferences:rejectedReferences,corrections:corrections,fills:fills,identityIssues:identityIssues,enabled:hasIdentity||listFields.length>0};
  }
  function directStudentId(record){
    if(!record||typeof record!=="object"||Array.isArray(record))return "";
    for(const key of DIRECT_ID_KEYS){if(Object.prototype.hasOwnProperty.call(record,key)&&text(record[key]))return text(record[key]);}
    return "";
  }
  function listKey(key){return LIST_KEYS.has(key)||/(?:名单|学生学号|学号列表|studentIds)/i.test(key);}
  function attachmentIds(record){
    const found=[];function add(value){if(!value)return;if(Array.isArray(value)){value.forEach(add);return;}if(typeof value!=="object")return;const id=text(value.id);if(id&&(/^[0-9a-f-]{16,}$/i.test(id)||value.url||value.mime||value.name))found.push(id);}
    if(record&&typeof record==="object"){add(record.attachment);add(record.certificate);add(record.files);add(record.photo);}
    return found;
  }
  function transform(value,ids,parentKey,remove){
    let count=0,samples=[],attachments=[];
    if(Array.isArray(value)){
      if(listKey(parentKey)&&value.every(function(item){return typeof item==="string"||typeof item==="number";})){
        const output=[];value.forEach(function(item){const sid=text(item);if(sid&&!ids.has(sid)){count++;if(samples.length<5)samples.push(sid);}else output.push(item);});
        return {value:remove?output:value,count:count,samples:samples,attachments:attachments};
      }
      const output=[];
      value.forEach(function(item){
        const sid=directStudentId(item);
        if(sid&&!ids.has(sid)){count++;if(samples.length<5)samples.push(sid);attachments=attachments.concat(attachmentIds(item));if(!remove)output.push(item);return;}
        const nested=transform(item,ids,parentKey,remove);count+=nested.count;samples=samples.concat(nested.samples).slice(0,5);attachments=attachments.concat(nested.attachments||[]);output.push(nested.value);
      });
      return {value:remove?output:value,count:count,samples:samples,attachments:attachments};
    }
    if(value&&typeof value==="object"){
      const output={};Object.keys(value).forEach(function(key){const nested=transform(value[key],ids,key,remove);count+=nested.count;samples=samples.concat(nested.samples).slice(0,5);attachments=attachments.concat(nested.attachments||[]);output[key]=nested.value;});
      return {value:remove?output:value,count:count,samples:samples,attachments:attachments};
    }
    return {value:value,count:0,samples:[],attachments:[]};
  }
  function transformCustomRoster(value,ids,remove){
    const output=remove?JSON.parse(JSON.stringify(value)):value,states=Array.isArray(output&&output.datasets)?output.datasets.map(function(dataset){return dataset&&dataset.state;}).filter(Boolean):[output];let count=0,samples=[],attachments=[];
    states.forEach(function(state){if(!state||!Array.isArray(state.rows))return;const kept=[];state.rows.forEach(function(row){const sid=text(row&&row.values&&row.values.studentNo);if(sid&&!ids.has(sid)){count++;if(samples.length<5)samples.push(sid);attachments=attachments.concat(attachmentIds(row&&row.values));if(!remove)kept.push(row);}else kept.push(row);});if(remove)state.rows=kept;});
    return {value:output,count:count,samples:samples,attachments:attachments};
  }
  function transformDormSpatial(value,ids,remove){
    const output=remove?JSON.parse(JSON.stringify(value)):value,counted={count:0,samples:[],attachments:[]};
    function orphan(sid){sid=text(sid);return !!sid&&!ids.has(sid);}
    function note(sid,record){counted.count++;if(counted.samples.length<5)counted.samples.push(text(sid));counted.attachments=counted.attachments.concat(attachmentIds(record));}
    ["assignments","leaders"].forEach(function(key){
      const rows=Array.isArray(output&&output[key])?output[key]:[];
      const kept=[];rows.forEach(function(row){const sid=text(row&&row.studentId);if(orphan(sid)){note(sid,row);if(!remove)kept.push(row);}else kept.push(row);});if(remove&&output)output[key]=kept;
    });
    const studentTargetActions=new Set(["CHECK_IN","CHECK_OUT","AUTO_CHECKOUT_GRADUATION","STUDENT_ID_RENAME"]),auditRows=Array.isArray(output&&output.audit)?output.audit:[],keptAudit=[];
    auditRows.forEach(function(row){
      const candidates=[];if(studentTargetActions.has(text(row&&row.actionType)))candidates.push(text(row&&row.targetId));
      [row&&row.beforeSnapshot,row&&row.afterSnapshot].forEach(function(snapshot){if(snapshot&&typeof snapshot==="object"&&!Array.isArray(snapshot))candidates.push(text(snapshot.studentId));});
      const missing=candidates.find(orphan);if(missing){note(missing,row);if(!remove)keptAudit.push(row);}else keptAudit.push(row);
    });
    if(remove&&output)output.audit=keptAudit;
    return {value:output,count:counted.count,samples:counted.samples,attachments:counted.attachments};
  }
  function processStorage(storage,students,remove){
    const ids=new Set((students||[]).map(function(student){return text(student&&student.id);}).filter(Boolean)),datasets=[],values={};let total=0,attachments=[];
    Object.keys(STORAGE_LABELS).forEach(function(key){
      if(!Object.prototype.hasOwnProperty.call(storage||{},key)||storage[key]==null)return;
      let parsed;try{parsed=typeof storage[key]==="string"?JSON.parse(storage[key]):storage[key];}catch(_error){return;}
      const result=key==="nnuzc_custom_roster_v1"?transformCustomRoster(parsed,ids,remove):(key==="nnuzc_dorm_spatial_v1"?transformDormSpatial(parsed,ids,remove):transform(parsed,ids,"",remove));if(!result.count)return;
      total+=result.count;attachments=attachments.concat(result.attachments||[]);datasets.push({key:key,label:STORAGE_LABELS[key],count:result.count,samples:result.samples});
      if(remove)values[key]=JSON.stringify(result.value);
    });
    return {total:total,datasets:datasets,values:values,attachments:Array.from(new Set(attachments.filter(Boolean)))};
  }
  function scanOrphanStorage(storage,students){return processStorage(storage,students,false);}
  function pruneOrphanStorage(storage,students){return processStorage(storage,students,true);}
  return {STORAGE_LABELS:STORAGE_LABELS,reconcileImportRows:reconcileImportRows,resolveIdentityIssues:resolveIdentityIssues,scanOrphanStorage:scanOrphanStorage,pruneOrphanStorage:pruneOrphanStorage};
});
