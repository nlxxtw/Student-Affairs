"use strict";

// Only structured student references are rewritten. Record IDs, course names,
// attachment metadata, original evidence and free text are never text-replaced.
const {STORAGE_LABELS}=require("./student-link-integrity");
const KEYS=new Set([...Object.keys(STORAGE_LABELS),"nnuzc_meetings","nnuzc_student_org_v1","nnuzc_dorm","nnuzc_stu_overrides","nnuzc_chaoxing_imports"]);
const ID_FIELDS=new Set(["sid","studentId","student_id","studentNo","studentNumber","idNo","学号","学生学号","parentStudentId"]);
const NAME_FIELDS=new Set(["name","sname","studentName","student_name","姓名","学生姓名"]);
const SKIP_FIELDS=new Set(["files","attachment","attachments","certificate","photo","customFieldValues","raw","rawText","fieldEvidence","fieldConfidence"]);
const STUDENT_ACTIONS=new Set(["CHECK_IN","CHECK_OUT","AUTO_CHECKOUT_GRADUATION","STUDENT_ID_RENAME"]);
const clean=v=>String(v??"").trim();
function conflict(message){return Object.assign(Error(message),{statusCode:409,expose:true,code:"STUDENT_IDENTITY_CONFLICT"});}

function identityChanges(before,after,renames=[],baseline){
 if(!Array.isArray(before)||!Array.isArray(after))return [];
 if(!Array.isArray(renames)||renames.length>500)throw conflict("学号变更说明无效，请刷新后重试。");
 const old=new Map(before.map(s=>[clean(s.id),s])),next=new Map(after.map(s=>[clean(s.id),s]));
 if(next.size!==after.length)throw conflict("学生学号重复，不能合并保存。");
 const base=new Map((Array.isArray(baseline)?baseline:[]).map(s=>[clean(s.id),s])),usedFrom=new Set(),usedTo=new Set(),changes=[];
 for(const item of renames){
  const from=clean(item?.from),to=clean(item?.to);
  if(!from||!to||from===to||usedFrom.has(from)||usedTo.has(to)||!base.has(from)||base.has(to)||next.has(from)||!next.has(to)||old.has(to)&&old.has(from))throw conflict("新学号已存在或学号变更关系冲突，不能合并学生；请读取最新数据。");
  if(!old.has(from)&&!old.has(to))throw conflict("原学生已被删除或更改，请读取最新数据。");
  usedFrom.add(from);usedTo.add(to);
  if(old.has(from))changes.push({oldId:from,id:to,oldName:clean(base.get(from).name),name:clean(next.get(to).name)});
 }
 for(const [sid,student]of next)if(!usedTo.has(sid)&&old.has(sid)&&clean(old.get(sid).name)!==clean(student.name))changes.push({oldId:sid,id:sid,oldName:clean(old.get(sid).name),name:clean(student.name)});
 return changes;
}

function rewriteObject(value,changes,options={}){
 const byId=new Map();for(const change of changes){byId.set(change.oldId,change);byId.set(change.id,change);}
 const names=options.nameFields?new Set(options.nameFields):NAME_FIELDS;
 function walk(node,parentKey="",inherited=null,depth=0){
  if(depth>80)throw conflict("关联数据层级异常，请核查数据后重试。");
  if(Array.isArray(node)){
   if(/studentIds$/i.test(parentKey)||["absent","late","early","personalLeave","sickLeave","publicLeave"].includes(parentKey))return node.map(v=>(typeof v==="string"||typeof v==="number")&&byId.has(clean(v))?byId.get(clean(v)).id:walk(v,parentKey,null,depth+1));
   return node.map(v=>walk(v,parentKey,null,depth+1));
  }
  if(!node||typeof node!=="object")return node;
  const result=Object.assign(Object.create(null),node),matches=new Set(),identities=new Set();
  for(const field of ID_FIELDS)if(clean(node[field]))identities.add(byId.get(clean(node[field]))?.id||clean(node[field]));
  for(const field of ID_FIELDS)if(byId.has(clean(node[field])))matches.add(byId.get(clean(node[field])));
  if(options.idFallback&&byId.has(clean(node.studentId||node.sid||node.idNo||node.id)))matches.add(byId.get(clean(node.studentId||node.sid||node.idNo||node.id)));
  if(matches.size>1||matches.size&&identities.size>1)throw conflict("同一记录中的多个学生字段指向不同学生，请先核查关联信息。");
  const change=[...matches][0]||inherited;
  for(const key of Object.keys(node)){
   if(SKIP_FIELDS.has(key)||options.skipFields?.includes(key))continue;
   if(ID_FIELDS.has(key)&&byId.has(clean(node[key])))result[key]=byId.get(clean(node[key])).id;
   else if(key==="id"&&options.idFallback&&change&&clean(node.id)===change.oldId)result[key]=change.id;
   else if(key==="targetId"&&STUDENT_ACTIONS.has(node.actionType)&&byId.has(clean(node[key])))result[key]=byId.get(clean(node[key])).id;
   else if(change&&names.has(key)&&!(key==="name"&&["tasks","courses","orgs","structure","activities","meetings","trainings","rooms","buildings"].includes(parentKey))&&typeof node[key]!=="object")result[key]=change.name;
   else result[key]=walk(node[key],key,null,depth+1);
  }
  return result;
 }
 return walk(value,"",options.inherited||null);
}

function rewrite(key,value,changes){
 if(!KEYS.has(key)||!changes.length)return value;
 const options={idFallback:["nnuzc_dorm_dist","nnuzc_fund_records"].includes(key)};
 if(key==="nnuzc_tasks")options.nameFields=["studentName","sname","姓名","学生姓名"];
 if(key==="nnuzc_certificate_records")options.skipFields=["data"];
 if(key==="nnuzc_dorm"||key==="nnuzc_stu_overrides"||key==="nnuzc_psych"&&!Array.isArray(value)){
  const output=Object.create(null);for(const [sid,row]of Object.entries(value||{})){
   const change=changes.find(c=>c.oldId===sid||c.id===sid),id=change?.id||sid;
   if(Object.hasOwn(output,id))throw conflict("目标学号已有独立数据，不能合并保存。");
   output[id]=rewriteObject(row,changes,{...options,inherited:change});
  }return output;
 }
 return rewriteObject(value,changes,options);
}
function containsId(key,value,id){
 if(!KEYS.has(key))return false;
 return JSON.stringify(rewrite(key,value,[{oldId:id,id:"__identity_probe__",name:"__identity_probe__"}]))!==JSON.stringify(value);
}
module.exports={KEYS,identityChanges,rewrite,rewriteObject,containsId,conflict};
