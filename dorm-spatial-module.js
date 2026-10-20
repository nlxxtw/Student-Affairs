/* 数智学工 · 立体化公寓管理（V3 核心实现）
 * 空间资源、入住历史、床位独立登记、宿舍长、毕业自动退宿与现有宿舍管理兼容投影。
 */
(function(){
  "use strict";
  const STORAGE_KEY="nnuzc_dorm_spatial_v1";
  const SCHEMA_VERSION=3;
  const LEGACY_KEYS=["accom","zone","building","room","bed"];
  const nowIso=()=>new Date().toISOString();
  const today=()=>typeof beijingIsoDate==="function"?beijingIsoDate():new Date().toISOString().slice(0,10);
  const clean=value=>String(value==null?"":value).trim();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const makeId=prefix=>prefix+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,9);
  const roomKey=(zone,building,floor,room)=>[zone,building,floor,room].map(clean).join("\u001f");
  let ui={tab:"spatial",zone:"",building:"",keyword:"",studentId:""};
  let state=loadState();
  let legacyDormPage=null;
  let legacyDormInit=null;
  let residentCache=null,residentByRoomCache=null;
  let resourceBatch=null,resourceLookup=null;

  function resourceIndex(){
    if(resourceLookup&&resourceLookup.state===state&&resourceLookup.buildingCount===state.buildings.length&&resourceLookup.roomCount===state.rooms.length)return resourceLookup;
    const index={state:state,buildingCount:state.buildings.length,roomCount:state.rooms.length,buildings:new Map(),rooms:new Map(),roomNumbers:new Map()};
    state.buildings.forEach(item=>index.buildings.set(clean(item.building),item));
    state.rooms.forEach(item=>{index.rooms.set(roomKey(item.zone,item.building,item.floor,item.room),item);index.roomNumbers.set(JSON.stringify([clean(item.zone),clean(item.building),clean(item.room)]),item);});
    resourceLookup=index;return index;
  }
  // Synchronous callers own their transaction snapshot and rollback. Defer only
  // persistence: no partial resource state is flushed between imported rows.
  function runResourceBatch(work){
    if(resourceBatch)return work();
    const batch={dirty:false};resourceBatch=batch;
    try{const result=work();resourceBatch=null;if(batch.dirty)saveState();return result;}
    finally{resourceBatch=null;}
  }

  function emptyState(){
    return {schemaVersion:SCHEMA_VERSION,settings:{defaultBedCount:4,maxBedCount:30},buildings:[],rooms:[],assignments:[],leaders:[],bedNotes:[],audit:[],migrations:{}};
  }
  function loadState(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
      if(parsed&&typeof parsed==="object")return normalizeState(parsed);
    }catch(error){if(typeof reportDataError==="function")reportDataError("公寓空间数据加载",error);}
    return emptyState();
  }
  function normalizeState(value){
    const raw=value&&typeof value==="object"?value:{},next=emptyState();
    next.schemaVersion=SCHEMA_VERSION;
    next.settings.maxBedCount=positiveInt(raw.settings&&raw.settings.maxBedCount,30,1,200);
    next.settings.defaultBedCount=positiveInt(raw.settings&&raw.settings.defaultBedCount,4,1,next.settings.maxBedCount);
    const buildingNames=new Set();
    next.buildings=(Array.isArray(raw.buildings)?raw.buildings:[]).filter(item=>item&&typeof item==="object"&&clean(item.building)).slice(0,5000).map(item=>({id:clean(item.id)||makeId("building"),zone:clean(item.zone)||"未分区",building:clean(item.building),status:item.status==="inactive"?"inactive":"active",createdAt:clean(item.createdAt)||nowIso(),updatedAt:clean(item.updatedAt)||nowIso()})).filter(item=>{const key=clean(item.building);if(buildingNames.has(key))return false;buildingNames.add(key);return true;});
    const roomIds=new Set();
    next.rooms=(Array.isArray(raw.rooms)?raw.rooms:[]).filter(item=>item&&typeof item==="object").slice(0,20000).map(item=>{
      let id=clean(item.id)||makeId("room");while(roomIds.has(id))id=makeId("room");roomIds.add(id);
      const room=clean(item.room)||"未维护房间";
      return {id:id,zone:clean(item.zone)||"未分区",building:clean(item.building)||"未维护楼栋",floor:clean(item.floor)||inferFloor(room),room:room,bedCount:positiveInt(item.bedCount,next.settings.defaultBedCount,1,next.settings.maxBedCount),status:item.status==="inactive"?"inactive":"active",createdAt:clean(item.createdAt)||nowIso(),updatedAt:clean(item.updatedAt)||nowIso()};
    });
    next.assignments=(Array.isArray(raw.assignments)?raw.assignments:[]).filter(item=>item&&typeof item==="object"&&clean(item.studentId)&&clean(item.roomId)).slice(-100000).map(item=>({id:clean(item.id)||makeId("assign"),studentId:clean(item.studentId),roomId:clean(item.roomId),bedNo:clean(item.bedNo),status:["current","ended","planned","cancelled"].includes(item.status)?item.status:"ended",source:clean(item.source),checkInAt:clean(item.checkInAt),checkOutAt:clean(item.checkOutAt),endReason:clean(item.endReason),positionSnapshot:item.positionSnapshot&&typeof item.positionSnapshot==="object"?clone(item.positionSnapshot):null,createdAt:clean(item.createdAt)||nowIso(),updatedAt:clean(item.updatedAt)||nowIso()}));
    next.leaders=(Array.isArray(raw.leaders)?raw.leaders:[]).filter(item=>item&&typeof item==="object"&&clean(item.studentId)&&clean(item.roomId)).slice(-100000).map(item=>({id:clean(item.id)||makeId("leader"),roomId:clean(item.roomId),studentId:clean(item.studentId),role:"dorm_leader",status:item.status==="current"?"current":"ended",effectiveFrom:clean(item.effectiveFrom),effectiveTo:clean(item.effectiveTo),changeReason:clean(item.changeReason),createdAt:clean(item.createdAt)||nowIso(),updatedAt:clean(item.updatedAt)||nowIso()}));
    const validRoomIds=new Set(next.rooms.map(item=>item.id)),noteKeys=new Set();
    next.bedNotes=(Array.isArray(raw.bedNotes)?raw.bedNotes:[]).filter(item=>item&&typeof item==="object"&&validRoomIds.has(clean(item.roomId))&&clean(item.bedNo)&&clean(item.studentName)).slice(-100000).map(item=>({id:clean(item.id)||makeId("bednote"),roomId:clean(item.roomId),bedNo:clean(item.bedNo),studentName:clean(item.studentName).slice(0,50),studentNo:clean(item.studentNo).slice(0,50),dept:clean(item.dept).slice(0,100),className:clean(item.className).slice(0,100),counselor:clean(item.counselor).slice(0,50),remark:clean(item.remark).slice(0,500),createdAt:clean(item.createdAt)||nowIso(),updatedAt:clean(item.updatedAt)||nowIso()})).filter(item=>{const room=next.rooms.find(room=>room.id===item.roomId),bedNumber=Number(item.bedNo);return room&&Number.isInteger(bedNumber)&&bedNumber>=1&&bedNumber<=Number(room.bedCount||0);}).filter(item=>{const key=item.roomId+"\u001f"+item.bedNo;if(noteKeys.has(key))return false;noteKeys.add(key);return true;});
    next.audit=(Array.isArray(raw.audit)?raw.audit:[]).filter(item=>item&&typeof item==="object").slice(-2000).map(item=>clone(item));
    next.migrations=raw.migrations&&typeof raw.migrations==="object"?clone(raw.migrations):{};
    next.rooms.forEach(room=>{if(!buildingNames.has(room.building)){next.buildings.push({id:makeId("building"),zone:room.zone,building:room.building,status:"active",createdAt:room.createdAt||nowIso(),updatedAt:room.updatedAt||nowIso()});buildingNames.add(room.building);}});
    repairStateInvariants(next);
    return next;
  }
  function positiveInt(value,fallback,min,max){
    const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;
  }
  function repairStateInvariants(target){
    target=target||state;let changed=false;
    const assignmentSeen=new Set();
    target.assignments.slice().sort((a,b)=>String(b.updatedAt||b.checkInAt||"").localeCompare(String(a.updatedAt||a.checkInAt||""))).forEach(item=>{if(item.status!=="current")return;const sid=clean(item.studentId);if(assignmentSeen.has(sid)){item.status="ended";item.checkOutAt=item.checkOutAt||nowIso();item.endReason=item.endReason||"重复当前入住自动修复";item.updatedAt=nowIso();changed=true;}else assignmentSeen.add(sid);});
    const leaderRoomSeen=new Set(),leaderStudentSeen=new Set();
    target.leaders.slice().sort((a,b)=>String(b.updatedAt||b.effectiveFrom||"").localeCompare(String(a.updatedAt||a.effectiveFrom||""))).forEach(item=>{if(item.status!=="current")return;const roomId=clean(item.roomId),studentId=clean(item.studentId);if(leaderRoomSeen.has(roomId)||leaderStudentSeen.has(studentId)){item.status="ended";item.effectiveTo=item.effectiveTo||nowIso();item.changeReason=item.changeReason||"重复宿舍长角色自动修复";item.updatedAt=nowIso();changed=true;}else{leaderRoomSeen.add(roomId);leaderStudentSeen.add(studentId);}});
    return changed;
  }
  function saveState(){
    if(resourceBatch){resourceBatch.dirty=true;return;}
    resourceLookup=null;
    state.schemaVersion=SCHEMA_VERSION;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    syncLegacyBuildingShadow();
  }
  function inferFloor(room){
    const value=clean(room);if(!value)return "未分层";
    const basement=value.match(/^(?:B|负)(\d+)/i);if(basement)return "B"+basement[1];
    const number=value.match(/(\d{3,4})/);if(number){const digits=number[1];return String(parseInt(digits.slice(0,digits.length-2),10)||1);}
    const leading=value.match(/^(\d+)/);return leading?leading[1]:"其他";
  }
  function naturalCompare(a,b){
    return String(a||"").localeCompare(String(b||""),"zh-CN",{numeric:true,sensitivity:"base"});
  }
  function buildingRows(includeInactive){
    return state.buildings.filter(item=>includeInactive||item.status!=="inactive").slice().sort((a,b)=>naturalCompare(a.zone,b.zone)||naturalCompare(a.building,b.building)).map(item=>clone(item));
  }
  function findBuilding(building){return resourceIndex().buildings.get(clean(building))||null;}
  function ensureBuilding(zone,building){
    zone=clean(zone)||"未分区";building=clean(building);if(!building)return null;
    const index=resourceIndex();let item=findBuilding(building);
    if(!item){if(state.buildings.length>=5000)throw new Error("楼栋资源已达 5000 栋上限");item={id:makeId("building"),zone:zone,building:building,status:"active",createdAt:nowIso(),updatedAt:nowIso()};state.buildings.push(item);index.buildings.set(building,item);index.buildingCount=state.buildings.length;}
    else if(item.zone==="未分区"&&zone!=="未分区"){item.zone=zone;item.updatedAt=nowIso();}
    return item;
  }
  function syncLegacyBuildingShadow(){
    if(typeof ORG_DORMS==="undefined"||!Array.isArray(ORG_DORMS)||typeof saveOrgs!=="function")return;
    const rows=buildingRows(false).map(item=>({zone:item.zone,building:item.building}));
    if(JSON.stringify(ORG_DORMS)!==JSON.stringify(rows)){ORG_DORMS.splice(0,ORG_DORMS.length,...rows);saveOrgs();}
  }
  function migrateLegacyBuildings(){
    let changed=false;
    if(!state.migrations||typeof state.migrations!=="object")state.migrations={};
    if(!state.migrations.legacyDormBuildingsV2){
      const legacy=typeof ORG_DORMS!=="undefined"&&Array.isArray(ORG_DORMS)?ORG_DORMS:[];
      legacy.forEach(item=>{const before=state.buildings.length;ensureBuilding(item.zone,item.building);if(state.buildings.length!==before)changed=true;});
      state.migrations.legacyDormBuildingsV2=nowIso();changed=true;
    }
    state.rooms.forEach(room=>{const before=state.buildings.length;ensureBuilding(room.zone,room.building);if(state.buildings.length!==before)changed=true;});
    if(changed)saveState();else syncLegacyBuildingShadow();
    return changed;
  }
  function findRoom(zone,building,floor,room){
    const key=roomKey(zone,building,floor,room);
    return resourceIndex().rooms.get(key)||null;
  }
  function ensureRoom(zone,building,floor,room,bedHint){
    zone=clean(zone)||"未分区";building=clean(building)||"未维护楼栋";room=clean(room)||"未维护房间";floor=clean(floor)||inferFloor(room);
    const buildingResource=ensureBuilding(zone,building);if(buildingResource)zone=buildingResource.zone;
    let item=findRoom(zone,building,floor,room);
    const hinted=positiveInt(bedHint,0,1,state.settings.maxBedCount);
    if(!item){
      if(state.rooms.length>=20000)throw new Error("房间资源已达 20000 间上限");
      item={id:makeId("room"),zone:zone,building:building,floor:floor,room:room,bedCount:Math.max(state.settings.defaultBedCount,hinted||0),status:"active",createdAt:nowIso(),updatedAt:nowIso()};
      const index=resourceIndex();state.rooms.push(item);index.rooms.set(roomKey(zone,building,floor,room),item);index.roomNumbers.set(JSON.stringify([zone,building,room]),item);index.roomCount=state.rooms.length;
    }else if(hinted>Number(item.bedCount||0)){item.bedCount=hinted;item.updatedAt=nowIso();}
    return item;
  }
  function accommodationOf(student){
    if(typeof dormDistributionRow==="function")return dormDistributionRow(student);
    return {id:student.id,name:student.name,accom:student.accom||"",zone:student.zone||"",building:student.building||"",room:student.room||"",bed:student.bed||""};
  }
  function isCurrentResident(student){
    const row=accommodationOf(student);return typeof isOnCampusStudent==="function"&&isOnCampusStudent(student)&&row.accom==="校内"&&clean(row.building)&&clean(row.room)&&clean(row.bed);
  }
  function currentAssignment(studentId){
    const sid=clean(studentId);return state.assignments.find(item=>clean(item.studentId)===sid&&item.status==="current")||null;
  }
  function endAssignment(assignment,reason,effectiveAt){
    if(!assignment||assignment.status!=="current")return;
    assignment.status="ended";assignment.checkOutAt=effectiveAt||nowIso();assignment.endReason=reason||"清除入住";assignment.updatedAt=nowIso();
  }
  function currentLeader(roomId){return state.leaders.find(item=>item.roomId===roomId&&item.status==="current")||null;}
  function endLeaderForStudent(studentId,reason,effectiveAt){
    const sid=clean(studentId);let count=0;
    state.leaders.forEach(item=>{if(item.status==="current"&&clean(item.studentId)===sid){item.status="ended";item.effectiveTo=effectiveAt||nowIso();item.changeReason=reason||"成员退宿";item.updatedAt=nowIso();count++;}});
    return count;
  }
  function audit(action,targetId,before,after,reason,source,groupId){
    state.audit.push({id:makeId("audit"),operationGroupId:groupId||makeId("op"),actionType:action,targetId:clean(targetId),beforeSnapshot:before||null,afterSnapshot:after||null,reason:reason||"",source:source||"manual",occurredAt:nowIso()});
    if(state.audit.length>2000)state.audit.splice(0,state.audit.length-2000);
  }
  function syncFromLegacy(options){
    options=options||{};residentCache=null;residentByRoomCache=null;let changed=repairStateInvariants(state);
    const emptiedRoomIds=new Set(),residentIds=new Set(),currentByStudent=new Map(),roomsByKey=new Map();state.assignments.forEach(item=>{if(item.status==="current")currentByStudent.set(clean(item.studentId),item);});state.rooms.forEach(room=>roomsByKey.set(roomKey(room.zone,room.building,room.floor,room.room),room));
    (students||[]).forEach(student=>{
      const sid=clean(student.id),row=accommodationOf(student);
      if(!isCurrentResident(student))return;
      residentIds.add(sid);
      const bedNumber=parseInt(clean(row.bed),10),floor=inferFloor(row.room),key=roomKey(row.zone,row.building,floor,row.room);
      let room=roomsByKey.get(key);if(!room||Number.isInteger(bedNumber)&&bedNumber>Number(room.bedCount||0)){room=ensureRoom(row.zone,row.building,floor,row.room,Number.isInteger(bedNumber)?bedNumber:0);roomsByKey.set(key,room);}
      let assignment=currentByStudent.get(sid)||null;
      if(assignment&&(assignment.roomId!==room.id||clean(assignment.bedNo)!==clean(row.bed))){emptiedRoomIds.add(assignment.roomId);endAssignment(assignment,"住宿信息调整",nowIso());currentByStudent.delete(sid);assignment=null;changed=true;}
      if(!assignment){
        assignment={id:makeId("assign"),studentId:sid,roomId:room.id,bedNo:clean(row.bed),status:"current",source:options.source||"legacy-sync",checkInAt:nowIso(),checkOutAt:"",positionSnapshot:{zone:room.zone,building:room.building,floor:room.floor,room:room.room,bed:clean(row.bed)},createdAt:nowIso(),updatedAt:nowIso()};state.assignments.push(assignment);currentByStudent.set(sid,assignment);
        changed=true;
      }
    });
    state.assignments.forEach(item=>{if(item.status==="current"&&!residentIds.has(clean(item.studentId))){emptiedRoomIds.add(item.roomId);endAssignment(item,"当前住宿信息已清除",nowIso());currentByStudent.delete(clean(item.studentId));endLeaderForStudent(item.studentId,"当前住宿信息已清除",nowIso());changed=true;}});
    state.leaders.forEach(role=>{if(role.status!=="current")return;const assignment=currentByStudent.get(clean(role.studentId));if(!assignment||assignment.roomId!==role.roomId){role.status="ended";role.effectiveTo=nowIso();role.changeReason="已不在本宿舍";role.updatedAt=nowIso();changed=true;}});
    if(changed||options.force)saveState();
    if(options.promptEmpty)emptiedRoomIds.forEach(roomId=>promptDeleteEmptyRoom(roomId,options.source||"住宿信息调整"));
    return changed;
  }
  function residentRows(){
    if(residentCache)return residentCache;
    const assignments=new Map(),rooms=new Map(state.rooms.map(room=>[room.id,room]));state.assignments.forEach(item=>{if(item.status==="current")assignments.set(clean(item.studentId),item);});residentCache=(students||[]).filter(isCurrentResident).map(student=>{const row=accommodationOf(student),assignment=assignments.get(clean(student.id))||null,room=assignment?rooms.get(assignment.roomId):findRoom(row.zone,row.building,inferFloor(row.room),row.room);return {student:student,row:row,assignment:assignment,room:room};});residentByRoomCache={};residentCache.forEach(item=>{if(!item.room)return;(residentByRoomCache[item.room.id]||(residentByRoomCache[item.room.id]=[])).push(item);});Object.keys(residentByRoomCache).forEach(key=>residentByRoomCache[key].sort((a,b)=>naturalCompare(a.row.bed,b.row.bed)));return residentCache;
  }
  function residentsForRoom(roomId){residentRows();return residentByRoomCache[roomId]||[];}
  function bedNote(roomId,bedNo){return state.bedNotes.find(item=>item.roomId===roomId&&clean(item.bedNo)===clean(bedNo))||null;}
  function roomBeds(room){
    const residents=residentsForRoom(room.id),byBed={};residents.forEach(item=>{(byBed[clean(item.row.bed)]||(byBed[clean(item.row.bed)]=[])).push(item);});
    const labels=[];for(let i=1;i<=Number(room.bedCount||0);i++)labels.push(String(i));Object.keys(byBed).forEach(label=>{if(!labels.includes(label))labels.push(label);});
    return labels.sort(naturalCompare).map(label=>({label:label,residents:byBed[label]||[],note:bedNote(room.id,label)}));
  }
  function summary(rooms){
    const active=(rooms||state.rooms).filter(room=>room.status!=="inactive"),configured=active.reduce((sum,room)=>sum+Number(room.bedCount||0),0);
    const occupied=active.reduce((sum,room)=>sum+residentsForRoom(room.id).length,0),conflicts=active.reduce((sum,room)=>sum+roomBeds(room).filter(bed=>bed.residents.length>1).length,0);
    const missingLeader=active.filter(room=>residentsForRoom(room.id).length>0&&!currentLeader(room.id)).length;
    return {rooms:active.length,configured:configured,occupied:occupied,available:Math.max(0,configured-occupied),missingLeader:missingLeader,conflicts:conflicts};
  }
  function optionsHtml(values,current,emptyLabel){
    return '<option value="">'+(emptyLabel||"全部")+'</option>'+values.map(value=>'<option value="'+attr(value)+'"'+(value===current?' selected':'')+'>'+esc(value)+'</option>').join('');
  }
  function setTab(tab){ui.tab=tab;renderPage("dorm");}
  function setFilter(field,value){if(ui.studentId){ui.studentId="";ui.keyword="";}ui[field]=clean(value);if(field==="zone")ui.building="";renderPage("dorm");}
  function locateStudent(studentId){
    const student=(students||[]).find(item=>clean(item.id)===clean(studentId));
    if(!student){showToast("未找到该学生，请刷新学生列表后重试","warn");return;}
    ui={tab:"spatial",zone:"",building:"",keyword:clean(student.id),studentId:clean(student.id)};
    goto("dorm");
  }
  function renderTabs(){
    return '<div class="dsp-tabs" role="tablist">'+[["spatial","空间总览"],["distribution","住宿分布"],["resources","公寓资源"]].map(item=>'<button type="button" role="tab" aria-selected="'+(ui.tab===item[0])+'" class="dsp-tab '+(ui.tab===item[0]?'active':'')+'" onclick="dormSpatialSetTab(\''+item[0]+'\')">'+item[1]+'</button>').join('')+'</div>';
  }
  function visibleRooms(){
    let rooms=state.rooms.filter(room=>room.status!=="inactive");
    if(ui.zone)rooms=rooms.filter(room=>room.zone===ui.zone);if(ui.building)rooms=rooms.filter(room=>room.building===ui.building);
    if(ui.studentId)rooms=rooms.filter(room=>residentsForRoom(room.id).some(item=>clean(item.student.id)===ui.studentId));
    else if(ui.keyword){const q=ui.keyword.toLowerCase();rooms=rooms.filter(room=>[room.zone,room.building,room.floor,room.room].join(" ").toLowerCase().includes(q)||residentsForRoom(room.id).some(item=>[item.student.id,item.student.name,item.student.cls].join(" ").toLowerCase().includes(q))||state.bedNotes.some(note=>note.roomId===room.id&&[note.studentName,note.studentNo,note.dept,note.className,note.counselor,note.remark].join(" ").toLowerCase().includes(q)));}
    return rooms.sort((a,b)=>naturalCompare(a.zone,b.zone)||naturalCompare(a.building,b.building)||naturalCompare(a.floor,b.floor)||naturalCompare(a.room,b.room));
  }
  function bedCard(room,bed){
    if(!bed.residents.length)return '<button class="dsp-bed '+(bed.note?'noted':'empty')+'" type="button" onclick="dormSpatialOpenBed('+jsArg(room.id)+','+jsArg(bed.label)+')"><span>'+esc(bed.label)+'号床 · 系统未分配</span>'+(bed.note?'<b>'+esc(bed.note.studentName)+' <i>独立登记</i></b><small>辅导员：'+esc(bed.note.counselor||'未登记')+'</small>':'<b>未登记学生</b><small>可安排入住或登记外部学生</small>')+'</button>';
    const conflict=bed.residents.length>1;
    const bedAction=conflict?'dormSpatialOpenRoom('+jsArg(room.id)+')':'dormSpatialOpenStudent('+jsArg(bed.residents[0].student.id)+')';
    return '<div class="dsp-bed '+(conflict?'conflict':'occupied')+'"><button class="dsp-bed-number" type="button" onclick="'+bedAction+'">'+esc(bed.label)+'号床'+(conflict?' · 冲突':'')+(bed.note?' · 有独立登记':'')+'</button>'+bed.residents.map(item=>{const leader=currentLeader(room.id);return '<button class="dsp-student-link" type="button" onclick="dormSpatialOpenStudent('+jsArg(item.student.id)+')"><b>'+esc(item.student.name)+(leader&&clean(leader.studentId)===clean(item.student.id)?' <i>宿舍长</i>':'')+'</b><small>'+esc(item.student.id)+' · '+esc(item.student.cls||'未维护班级')+'</small></button>';}).join('')+'</div>';
  }
  function roomCard(room){
    const residents=residentsForRoom(room.id),leader=currentLeader(room.id),beds=roomBeds(room),conflict=beds.some(item=>item.residents.length>1),noted=beds.filter(item=>item.note).length,capacity=Math.max(0,Number(room.bedCount)||0),rate=capacity?Math.min(100,Math.round(residents.length/capacity*100)):0,status=conflict?'床位冲突':('系统入住 '+residents.length+'/'+capacity+(noted?' · 独立登记 '+noted:''));
    return '<article class="dsp-room '+(conflict?'has-conflict':'')+'"><header><button type="button" onclick="dormSpatialOpenRoom('+jsArg(room.id)+')"><strong>'+esc(room.room)+'室</strong><span>'+status+'</span></button><em class="'+(leader?'ok':'warn')+'">'+(leader?'宿舍长：'+esc((students.find(s=>clean(s.id)===clean(leader.studentId))||{}).name||leader.studentId):(residents.length?'缺宿舍长':'暂无入住'))+'</em></header><div class="dsp-room-progress" aria-label="入住率 '+rate+'%"><span><i style="width:'+rate+'%"></i></span><small>'+rate+'% 入住</small></div><div class="dsp-beds">'+beds.map(bed=>bedCard(room,bed)).join('')+'</div></article>';
  }
  function renderSpatial(){
    const focusedStudent=ui.studentId?(students||[]).find(item=>clean(item.id)===ui.studentId):null;
    const focusedAccommodation=focusedStudent?accommodationOf(focusedStudent):null;
    const focusNotice=ui.studentId?'<div class="tip" role="status">正在查看：'+esc(focusedStudent?focusedStudent.name+'（'+ui.studentId+'）':ui.studentId)+' · '+esc(focusedAccommodation?[focusedAccommodation.accom,focusedAccommodation.zone,focusedAccommodation.building,focusedAccommodation.room?focusedAccommodation.room+'室':'',focusedAccommodation.bed?focusedAccommodation.bed+'号床':''].filter(Boolean).join(' · ')||'未登记住宿信息':'学生信息已不存在')+'</div>':'';
    const rooms=visibleRooms(),stats=summary(rooms),zones=Array.from(new Set(state.rooms.filter(r=>r.status!=="inactive").map(r=>r.zone))).sort(naturalCompare),buildings=Array.from(new Set(state.rooms.filter(r=>r.status!=="inactive"&&(!ui.zone||r.zone===ui.zone)).map(r=>r.building))).sort(naturalCompare);
    const buildingGroups={};rooms.forEach(room=>{const key=room.zone+"\u001f"+room.building,group=buildingGroups[key]||(buildingGroups[key]={zone:room.zone,building:room.building,floors:{},rooms:[]});group.rooms.push(room);(group.floors[room.floor]||(group.floors[room.floor]=[])).push(room);});
    const occupancy=stats.configured?Math.min(100,Math.round(stats.occupied/stats.configured*100)):0,activeFilters=[ui.zone,ui.building,ui.keyword].filter(Boolean).length;
    const kpis=[["beds",stats.configured,"配置床位","▦"],["occupied",stats.occupied,"本系统已住","●"],["available",stats.available,"系统未分配","○"],["rooms",stats.rooms,"宿舍房间","⌂"],["warn",stats.missingLeader,"缺宿舍长","!"],["danger",stats.conflicts,"床位冲突","×"]];
    const buildingHtml=Object.values(buildingGroups).sort((a,b)=>naturalCompare(a.zone,b.zone)||naturalCompare(a.building,b.building)).map(group=>{const groupStats=summary(group.rooms),groupRate=groupStats.configured?Math.min(100,Math.round(groupStats.occupied/groupStats.configured*100)):0,floors=Object.keys(group.floors).sort(naturalCompare);return '<article class="dsp-building-card"><header class="dsp-building-head"><div class="dsp-building-icon">🏢</div><div class="dsp-building-copy"><div class="dsp-building-title-row"><h3>'+esc(group.building)+'</h3><span class="dsp-operation-tip">点击宿舍号编辑宿舍，点击床号查看学生信息</span></div><p>'+esc(group.zone||'未设置区位')+' · '+floors.length+' 个楼层 · '+groupStats.rooms+' 间宿舍</p></div><div class="dsp-building-occupancy"><div><span>入住 '+groupStats.occupied+'/'+groupStats.configured+'</span><b>'+groupRate+'%</b></div><span class="dsp-progress"><i style="width:'+groupRate+'%"></i></span></div></header><div class="dsp-floor-list">'+floors.map(floor=>{const floorRooms=group.floors[floor],floorStats=summary(floorRooms);return '<section class="dsp-floor"><div class="dsp-floor-label"><b>'+esc(floor)+'F</b><span>'+floorRooms.length+' 间宿舍</span><small>'+floorStats.occupied+'/'+floorStats.configured+' 已住</small></div><div class="dsp-room-row">'+floorRooms.sort((a,b)=>naturalCompare(a.room,b.room)).map(roomCard).join('')+'</div></section>';}).join('')+'</div></article>';}).join('');
    return focusNotice+'<section class="dsp-overview-hero"><div class="dsp-overview-copy"><span class="dsp-eyebrow">宿舍空间概览</span><h3>入住率 <strong>'+occupancy+'%</strong></h3><p>当前视图覆盖 '+stats.rooms+' 间宿舍、'+stats.configured+' 个床位，实时反映入住、空床与异常情况。</p></div><div class="dsp-overview-meter"><div><span>已住 '+stats.occupied+'</span><span>空床 '+stats.available+'</span></div><span class="dsp-progress"><i style="width:'+occupancy+'%"></i></span></div></section>'+ 
      '<div class="dsp-kpis">'+kpis.map(item=>'<div class="'+item[0]+'"><i>'+item[3]+'</i><section><b>'+item[1]+'</b><span>'+item[2]+'</span></section></div>').join('')+'</div>'+ 
      '<div class="dsp-toolbar"><div class="dsp-filter-group"><label>区位<select onchange="dormSpatialSetFilter(\'zone\',this.value)">'+optionsHtml(zones,ui.zone,"全部区位")+'</select></label><label>宿舍楼<select onchange="dormSpatialSetFilter(\'building\',this.value)">'+optionsHtml(buildings,ui.building,"全部宿舍楼")+'</select></label><label class="grow">搜索<input id="dspSpatialKeyword" value="'+attr(ui.keyword)+'" placeholder="学生、学号、班级、宿舍" onkeydown="if(event.key===\'Enter\')dormSpatialSetFilter(\'keyword\',this.value)"></label><button class="btn btn-ghost btn-sm dsp-search-btn" onclick="dormSpatialSetFilter(\'keyword\',document.getElementById(\'dspSpatialKeyword\').value)">查询</button>'+(activeFilters?'<button class="dsp-clear-filter" type="button" onclick="dormSpatialResetFilters()">清除筛选</button>':'')+'</div><div class="dsp-action-group"><span>当前显示 '+stats.rooms+' 间</span><button class="btn btn-ghost btn-sm" onclick="dormSpatialSync()">↻ 同步住宿</button><button class="btn btn-primary btn-sm" onclick="dormSpatialAddRoom()">＋ 新增宿舍</button></div></div>'+ 
      (rooms.length?'<div class="dsp-building">'+buildingHtml+'</div>':ui.studentId?'<div class="dsp-empty"><b>'+esc(focusedAccommodation&&focusedAccommodation.accom==='校外'?'该生为校外住宿':'该生暂无可展示的校内宿舍')+'</b><span>可在住宿分布中核对该生的住宿登记，或清除筛选查看全部宿舍。</span></div>':'<div class="dsp-empty"><b>暂无可展示的公寓空间</b><span>可调整筛选条件，或点击“同步住宿”从现有宿舍管理生成空间资源。</span></div>');
  }
  function resetFilters(){ui.zone="";ui.building="";ui.keyword="";ui.studentId="";renderPage("dorm");}
  function renderResources(){
    const stats=summary(state.rooms),rows=state.rooms.slice().sort((a,b)=>naturalCompare(a.zone,b.zone)||naturalCompare(a.building,b.building)||naturalCompare(a.floor,b.floor)||naturalCompare(a.room,b.room)),buildings=buildingRows(true);
    const buildingTable='<div class="card"><div class="dsp-resource-head"><div><b>区位与楼栋资源</b><span>住宿编辑、筛选和导入统一使用此处数据；旧基础信息已转为兼容备份。</span></div><div class="dsp-resource-actions"><button class="btn btn-ghost btn-sm" onclick="dormSpatialBuildingTemplate()">下载导入模板</button><button class="btn btn-ghost btn-sm" onclick="dormSpatialImportBuildings()">导入</button><button class="btn btn-primary btn-sm" onclick="dormSpatialAddBuilding()">＋ 新增宿舍楼</button></div></div><div class="table-scroll"><table class="t-table"><thead><tr><th>区位</th><th>宿舍楼</th><th>宿舍数</th><th>状态</th><th>操作</th></tr></thead><tbody>'+(buildings.length?buildings.map(item=>{const roomCount=state.rooms.filter(room=>room.building===item.building).length;return '<tr><td>'+esc(item.zone)+'</td><td>'+esc(item.building)+'</td><td>'+roomCount+'</td><td>'+esc(item.status==='inactive'?'已停用':'启用')+'</td><td><a class="lk" onclick="dormSpatialEditBuilding('+jsArg(item.id)+')">编辑区位</a> <a class="lk danger" onclick="dormSpatialDisableBuilding('+jsArg(item.id)+')">'+(item.status==='inactive'?'启用':'停用')+'</a> <a class="lk danger" onclick="dormSpatialDeleteBuilding('+jsArg(item.id)+')">删除</a></td></tr>';}).join(''):'<tr><td colspan="5" class="empty">暂无区位与楼栋资源</td></tr>')+'</tbody></table></div></div>';
    const roomTable='<div class="card"><div class="dsp-resource-head"><div><b>宿舍房间与床位</b><span>共 '+stats.rooms+' 间宿舍、'+stats.configured+' 个配置床位</span></div><div class="dsp-resource-actions"><button class="btn btn-ghost btn-sm" onclick="dormSpatialRoomTemplate()">下载导入模板</button><button class="btn btn-ghost btn-sm" onclick="dormSpatialImportRooms()">导入</button><button class="btn btn-primary btn-sm" onclick="dormSpatialAddRoom()">＋ 新增宿舍</button></div></div><div class="table-scroll"><table class="t-table"><thead><tr><th>区位</th><th>宿舍楼</th><th>楼层</th><th>宿舍号</th><th>床位数</th><th>已住</th><th>宿舍长</th><th>状态</th><th>操作</th></tr></thead><tbody>'+(rows.length?rows.map(room=>{const residents=residentsForRoom(room.id),leader=currentLeader(room.id),student=leader&&students.find(s=>clean(s.id)===clean(leader.studentId));return '<tr><td>'+esc(room.zone)+'</td><td>'+esc(room.building)+'</td><td>'+esc(room.floor)+'</td><td>'+esc(room.room)+'</td><td>'+room.bedCount+'</td><td>'+residents.length+'</td><td>'+esc(student?student.name:'—')+'</td><td>'+esc(room.status==='inactive'?'已停用':'启用')+'</td><td><a class="lk" onclick="dormSpatialEditRoom('+jsArg(room.id)+')">编辑</a> <a class="lk" onclick="dormSpatialOpenRoom('+jsArg(room.id)+')">查看</a> <a class="lk danger" onclick="dormSpatialDisableRoom('+jsArg(room.id)+')">'+(room.status==='inactive'?'启用':'停用')+'</a> <a class="lk danger" onclick="dormSpatialDeleteRoom('+jsArg(room.id)+')">删除</a></td></tr>';}).join(''):'<tr><td colspan="9" class="empty">暂无宿舍房间资源</td></tr>')+'</tbody></table></div></div>';
    return '<div class="dsp-resource-settings card"><div><b>床位参数</b><span>宿舍床位数可自由设置，减少床位时会检查当前入住。</span></div><label>默认床位数<input id="dspDefaultBeds" type="number" min="1" max="'+state.settings.maxBedCount+'" value="'+state.settings.defaultBedCount+'"></label><label>单间安全上限<input id="dspMaxBeds" type="number" min="1" max="200" value="'+state.settings.maxBedCount+'"></label><button class="btn btn-primary btn-sm" onclick="dormSpatialSaveSettings()">保存参数</button></div>'+buildingTable+roomTable;
  }
  function renderDistribution(){
    let html=legacyDormPage?legacyDormPage():"";
    html=html.replace(/^\s*<h2[\s\S]*?<\/h2>/i,"");return '<div class="dsp-legacy">'+html+'</div>';
  }
  function renderPageHtml(){
    syncFromLegacy();
    const body=ui.tab==="spatial"?renderSpatial():(ui.tab==="resources"?renderResources():renderDistribution());
    return '<div class="dsp-page"><div class="dsp-title"><div><h2>🏢 立体化公寓管理 <span class="tag">区位 → 楼栋 → 楼层 → 宿舍 → 床位</span></h2><p>与现有“宿舍管理”实时联动，毕业自动退宿并清空现住宿信息。</p></div></div>'+renderTabs()+body+'</div>';
  }
  function openRoom(roomId){
    const room=state.rooms.find(item=>item.id===roomId);if(!room)return;
    const residents=residentsForRoom(room.id),leader=currentLeader(room.id);
    const histories=state.assignments.filter(item=>item.roomId===room.id&&item.status==="ended").sort((a,b)=>String(b.checkOutAt||"").localeCompare(String(a.checkOutAt||""))).slice(0,20);
    const historyHtml='<div class="dsp-history"><div class="dsp-history-head"><b>入住历史</b><span>保留最近 '+histories.length+' 条退宿或调宿记录</span></div>'+(histories.length?'<div class="table-scroll"><table class="t-table"><thead><tr><th>学生</th><th>床位</th><th>入住时间</th><th>退宿时间</th><th>原因</th></tr></thead><tbody>'+histories.map(item=>{const student=(students||[]).find(s=>clean(s.id)===clean(item.studentId))||{};return '<tr><td>'+esc((student.name||"未知学生")+'（'+item.studentId+'）')+'</td><td>'+esc(item.bedNo||((item.positionSnapshot||{}).bed)||"—")+'</td><td>'+esc(clean(item.checkInAt).slice(0,10)||"—")+'</td><td>'+esc(clean(item.checkOutAt).slice(0,10)||"—")+'</td><td>'+esc(item.endReason||"—")+'</td></tr>';}).join('')+'</tbody></table></div>':'<div class="dsp-history-empty">暂无历史退宿或调宿记录</div>')+'</div>';
    const body='<div class="dsp-room-detail"><div class="dsp-room-meta"><b>'+esc(room.zone)+' · '+esc(room.building)+' · '+esc(room.floor)+'层 · '+esc(room.room)+'室</b><span>本系统入住 '+residents.length+'/'+room.bedCount+' 人</span></div><div class="tip" style="margin-top:10px">床位独立登记仅用于备注非本系统管理的学生，不计入入住人数、空床统计或床位冲突，也不修改学生档案和住宿分布。</div><div class="dsp-detail-beds">'+roomBeds(room).map(bed=>'<div class="dsp-detail-bed"><strong>'+esc(bed.label)+'号床'+(bed.note?' <i>独立登记</i>':'')+'</strong>'+(bed.residents.length?bed.residents.map(item=>'<div><button class="dsp-student-link dsp-student-link-inline" type="button" onclick="dormSpatialOpenStudent('+jsArg(item.student.id)+')"><b>'+esc(item.student.name)+(leader&&clean(leader.studentId)===clean(item.student.id)?' <i>宿舍长</i>':'')+'</b><span>'+esc(item.student.id)+' · '+esc(item.student.cls||'未维护班级')+'</span></button><p><button class="btn btn-primary btn-sm" onclick="dormSpatialEditResident('+jsArg(item.student.id)+')">编辑住宿</button> <button class="btn btn-ghost btn-sm" onclick="dormSpatialSetLeader('+jsArg(room.id)+','+jsArg(item.student.id)+')">设为宿舍长</button> <button class="btn btn-ghost btn-sm danger" onclick="dormSpatialCheckout('+jsArg(item.student.id)+')">办理退宿</button></p></div>').join(''):'<div><b>本系统未分配</b><p><button class="btn btn-primary btn-sm" onclick="dormSpatialAssign('+jsArg(room.id)+','+jsArg(bed.label)+')">安排入住</button></p></div>')+(bed.note?'<div class="dsp-bed-note"><b>登记学生：'+esc(bed.note.studentName)+'</b><span>'+esc([bed.note.studentNo,bed.note.dept,bed.note.className].filter(Boolean).join(' · ')||'未登记其他信息')+'</span><span>辅导员：'+esc(bed.note.counselor||'未登记')+'</span>'+(bed.note.remark?'<span>备注：'+esc(bed.note.remark)+'</span>':'')+'<p><button class="btn btn-ghost btn-sm" onclick="dormSpatialEditBedNote('+jsArg(room.id)+','+jsArg(bed.label)+')">编辑登记</button> <button class="btn btn-ghost btn-sm danger" onclick="dormSpatialDeleteBedNote('+jsArg(room.id)+','+jsArg(bed.label)+')">清除登记</button></p></div>':'<div class="dsp-bed-note-empty"><button class="btn btn-ghost btn-sm" onclick="dormSpatialEditBedNote('+jsArg(room.id)+','+jsArg(bed.label)+')">登记其他学生信息</button></div>')+'</div>').join('')+'</div>'+historyHtml+'</div>';
    openModal("宿舍详情",body,function(){closeModal();});const foot=document.getElementById("modalFoot");if(foot)foot.innerHTML='<button class="btn btn-ghost" onclick="closeModal()">关闭</button>';
  }
  function studentManagementPhone(student){
    const aliases=["phone","mobilePhone","mobile","tel","telephone","手机号","手机号码","联系电话"];
    for(const key of aliases){const phone=clean(student&&student[key]);if(phone)return phone;}
    return "";
  }
  function openStudent(studentId){
    const student=(students||[]).find(item=>clean(item.id)===clean(studentId));if(!student){showToast("未找到该学生信息","warn");return;}
    const snapshot=typeof window.getDormRosterStudentSnapshot==="function"?window.getDormRosterStudentSnapshot(student):Object.assign({},student,accommodationOf(student));
    const fields=typeof window.getDormRosterFieldDefinitions==="function"?window.getDormRosterFieldDefinitions().filter(field=>field[0]!=="idPhoto"):[["name","姓名"],["id","学号"],["gender","性别"],["dept","学院"],["major","专业"],["grade","年级"],["cls","班级"],["accom","住宿情况"],["zone","区位"],["building","楼栋"],["room","房间号"],["bed","床位号"],["phone","手机号"],["counsel","辅导员"],["ethnic","民族"],["political","政治面貌"],["source","生源地"],["address","家庭住址"]];
    const fieldValue=(key)=>key==="phone"?studentManagementPhone(student):(typeof window.getDormRosterFieldValue==="function"?window.getDormRosterFieldValue(snapshot,key):(snapshot[key]||""));
    const photo=typeof window.getDormRosterEnrollmentPhoto==="function"?window.getDormRosterEnrollmentPhoto(student):"",initial=clean(student.name).charAt(0)||"?";
    const photoHtml='<div class="dsp-student-photo">'+(photo?'<img src="'+attr(photo)+'" alt="'+attr(student.name||'学生')+'的学籍照片" onclick="portraitZoomPhoto(this.src)" title="点击放大查看">':'<span>'+esc(initial)+'</span>')+'<small>学籍照片'+(photo?'':'（未导入）')+'</small></div>';
    const fieldHtml=fields.map(field=>'<div data-roster-field="'+attr(field[0])+'"><small>'+esc(field[1])+'</small><b>'+esc(fieldValue(field[0])||"未维护")+'</b></div>').join('');
    openModal("学生信息 · "+(student.name||student.id),'<div class="dsp-student-profile">'+photoHtml+'<div class="dsp-student-fields">'+fieldHtml+'</div></div>',function(){return false;});
    const foot=document.getElementById("modalFoot");if(foot)foot.innerHTML='<button class="btn btn-ghost" onclick="closeModal()">关闭</button>';
  }
  function openBed(roomId,bedNo){
    const room=state.rooms.find(item=>item.id===roomId);if(!room)return;const bed=roomBeds(room).find(item=>item.label===clean(bedNo));if(!bed)return;const note=bed.note;
    const body='<div class="dsp-room-meta"><b>'+esc(room.zone)+' · '+esc(room.building)+' · '+esc(room.room)+'室 · '+esc(bedNo)+'号床</b><span>本系统'+(bed.residents.length?'已分配':'未分配')+'</span></div><div class="tip" style="margin-top:10px">独立登记仅作床位情况备注，不占用系统床位，不参与任何学生、住宿、统计或业务联动。</div>'+(note?'<div class="dsp-bed-note dsp-bed-note-panel"><b>登记学生：'+esc(note.studentName)+'</b><span>学号/编号：'+esc(note.studentNo||'未登记')+'</span><span>学院/单位：'+esc(note.dept||'未登记')+'</span><span>班级：'+esc(note.className||'未登记')+'</span><span>辅导员：'+esc(note.counselor||'未登记')+'</span><span>备注：'+esc(note.remark||'无')+'</span></div>':'<div class="dsp-history-empty" style="margin-top:12px">该床位暂无独立登记信息</div>');
    openModal("床位信息",body,function(){return false;});const foot=document.getElementById("modalFoot");if(foot)foot.innerHTML='<button class="btn btn-ghost" onclick="closeModal()">关闭</button>'+(note?'<button class="btn btn-ghost danger" onclick="dormSpatialDeleteBedNote('+jsArg(room.id)+','+jsArg(bedNo)+')">清除登记</button>':'')+'<button class="btn btn-ghost" onclick="dormSpatialEditBedNote('+jsArg(room.id)+','+jsArg(bedNo)+')">'+(note?'编辑登记':'登记其他学生')+'</button>'+(!bed.residents.length?'<button class="btn btn-primary" onclick="dormSpatialAssign('+jsArg(room.id)+','+jsArg(bedNo)+')">安排本系统学生入住</button>':'');
  }
  function editBedNote(roomId,bedNo){
    const room=state.rooms.find(item=>item.id===roomId);if(!room)return;bedNo=clean(bedNo);const note=bedNote(roomId,bedNo);
    openModal((note?"编辑":"新增")+"床位独立登记",'<div class="tip" style="margin-bottom:12px">本信息仅用于登记床位上的其他学生，不会查找或修改学生管理、住宿分布、入住人数、床位冲突和宿舍长信息。</div><div class="row2"><div class="field"><label>学生姓名 *</label><input id="dspNoteStudentName" value="'+attr(note&&note.studentName||'')+'" maxlength="50"></div><div class="field"><label>学号/编号</label><input id="dspNoteStudentNo" value="'+attr(note&&note.studentNo||'')+'" maxlength="50"></div></div><div class="row2"><div class="field"><label>学院/单位</label><input id="dspNoteDept" value="'+attr(note&&note.dept||'')+'" maxlength="100"></div><div class="field"><label>班级</label><input id="dspNoteClass" value="'+attr(note&&note.className||'')+'" maxlength="100"></div></div><div class="field"><label>辅导员姓名 *</label><input id="dspNoteCounselor" value="'+attr(note&&note.counselor||'')+'" maxlength="50"></div><div class="field"><label>床位备注</label><textarea id="dspNoteRemark" rows="3" maxlength="500" placeholder="仅记录需要补充说明的床位情况">'+esc(note&&note.remark||'')+'</textarea></div>',function(){
      const studentName=clean(document.getElementById("dspNoteStudentName").value),counselor=clean(document.getElementById("dspNoteCounselor").value);if(!studentName||!counselor){showToast("请填写学生姓名和辅导员姓名","warn");return false;}
      const before=note?clone(note):null,data={studentName:studentName,studentNo:clean(document.getElementById("dspNoteStudentNo").value),dept:clean(document.getElementById("dspNoteDept").value),className:clean(document.getElementById("dspNoteClass").value),counselor:counselor,remark:clean(document.getElementById("dspNoteRemark").value),updatedAt:nowIso()};
      if(note)Object.assign(note,data);else state.bedNotes.push(Object.assign({id:makeId("bednote"),roomId:roomId,bedNo:bedNo,createdAt:nowIso()},data));
      const saved=bedNote(roomId,bedNo);audit(note?"BED_NOTE_UPDATE":"BED_NOTE_CREATE",roomId+":"+bedNo,before,clone(saved),"床位独立登记","manual");saveState();showToast("床位独立登记已保存，不影响住宿数据","ok");renderPage("dorm");
    });
  }
  async function deleteBedNote(roomId,bedNo){
    const index=state.bedNotes.findIndex(item=>item.roomId===roomId&&clean(item.bedNo)===clean(bedNo));if(index<0)return false;const note=state.bedNotes[index];
    const moved=await window.recycleMoveRecords("dormBedNote","dorm_bed_note",[note.id]);if(!moved)return false;reloadState();showToast("床位独立登记已移入回收站","ok");closeModal();renderPage("dorm");return true;
  }
  function addOrEditBuilding(buildingId){
    const item=buildingId?state.buildings.find(row=>row.id===buildingId):null;
    openModal(item?"编辑宿舍楼区位":"新增宿舍楼",'<div class="field"><label>区位 *</label><input id="dspBuildingZone" value="'+attr(item&&item.zone||"")+'" placeholder="如 东区"></div><div class="field"><label>宿舍楼 *</label><input id="dspBuildingName" value="'+attr(item&&item.building||"")+'" '+(item?'readonly':'')+' placeholder="如 7栋"></div><div class="tip">公寓资源是区位、楼栋、房间和床位的唯一维护入口。编辑区位会同步当前学生住宿信息，楼栋名称建立后不可直接改名。</div>',function(){
      const zone=clean(document.getElementById("dspBuildingZone").value),building=clean(document.getElementById("dspBuildingName").value);if(!zone||!building){showToast("请完整填写区位和宿舍楼","warn");return false;}
      if(!item){if(findBuilding(building)){showToast("该宿舍楼已存在","warn");return false;}const added=ensureBuilding(zone,building);audit("BUILDING_CREATE",added.id,null,clone(added),"新增宿舍楼资源","manual");saveState();renderPage("dorm");return;}
      if(zone===item.zone){showToast("区位未发生变化","ok");return;}
      const before=clone(item),oldZone=item.zone;item.zone=zone;item.updatedAt=nowIso();state.rooms.forEach(room=>{if(room.building===item.building){room.zone=zone;room.updatedAt=nowIso();}});state.assignments.forEach(assignment=>{if(assignment.status!=="current")return;const room=state.rooms.find(room=>room.id===assignment.roomId);if(room&&room.building===item.building){assignment.positionSnapshot=Object.assign({},assignment.positionSnapshot||{},{zone:zone,building:item.building,floor:room.floor,room:room.room,bed:assignment.bedNo});assignment.updatedAt=nowIso();}});if(typeof syncDormBuildingZone==="function")syncDormBuildingZone(item.building,zone);audit("BUILDING_ZONE_UPDATE",item.id,before,clone(item),oldZone+" → "+zone,"manual");saveState();residentCache=null;residentByRoomCache=null;renderPage("dorm");
    });
  }
  function disableBuilding(buildingId){
    const item=state.buildings.find(row=>row.id===buildingId);if(!item)return;
    if(item.status!=="inactive"&&state.rooms.some(room=>room.building===item.building)){showToast("该宿舍楼仍有关联房间，不能停用","warn");return;}
    const before=clone(item);item.status=item.status==="inactive"?"active":"inactive";item.updatedAt=nowIso();audit(item.status==="inactive"?"BUILDING_DISABLE":"BUILDING_ENABLE",item.id,before,clone(item),item.status==="inactive"?"停用宿舍楼":"启用宿舍楼","manual");saveState();renderPage("dorm");
  }
  function ensureBuildingResource(zone,building){
    const existing=findBuilding(building),before=existing?clone(existing):null,item=ensureBuilding(zone,building);if(item&&(!before||before.zone!==item.zone)){audit("BUILDING_CREATE",item.id,before,clone(item),"住宿写入自动补充宿舍楼","compatibility");saveState();}return item?clone(item):null;
  }
  function ensureRoomResource(zone,building,room,bedHint){
    zone=clean(zone)||"未分区";building=clean(building);room=clean(room);if(!building||!room)return null;
    const buildingBefore=findBuilding(building),buildingResource=ensureBuilding(zone,building);if(buildingResource)zone=buildingResource.zone;
    if(!buildingBefore&&buildingResource)audit("BUILDING_CREATE",buildingResource.id,null,clone(buildingResource),"住宿导入自动补充宿舍楼","import");
    const existing=resourceIndex().roomNumbers.get(JSON.stringify([zone,building,room]))||null;
    const before=existing?clone(existing):null,item=ensureRoom(zone,building,existing&&existing.floor||inferFloor(room),room,bedHint);
    if(!item)return null;
    if(!before||JSON.stringify(before)!==JSON.stringify(item)){
      audit(before?"RESOURCE_CAPACITY_UPDATE":"RESOURCE_CREATE",item.id,before,clone(item),before?"住宿导入按床位号扩充容量":"住宿导入自动补充房间资源","import");
      saveState();
    }
    return clone(item);
  }
  const BUILDING_IMPORT_FIELDS=["区位","宿舍楼"];
  const ROOM_IMPORT_FIELDS=["区位","宿舍楼","楼层","宿舍号","床位数"];
  function resourceImportTemplate(kind){
    const isRoom=kind==="room",name=isRoom?"宿舍房间与床位":"区位与楼栋资源";
    downloadXlsxFile(name+"导入模板",[isRoom?ROOM_IMPORT_FIELDS:BUILDING_IMPORT_FIELDS,isRoom?["北区","A栋","1","101","4"]:["北区","A栋"]],name+"导入模板.xlsx");
  }
  function validateResourceImport(kind,rows){
    const isRoom=kind==="room",fields=isRoom?ROOM_IMPORT_FIELDS:BUILDING_IMPORT_FIELDS,errors=[],ok=[],warnings=[],seen=new Map();let duplicates=0;
    const buildings=new Map(state.buildings.map(item=>[item.building,item]));
    const zones=new Map(state.buildings.map(item=>[item.building,item.zone]));
    const rooms=new Map(state.rooms.map(item=>[JSON.stringify([item.building,item.room]),item]));
    if(!Array.isArray(rows)||!rows.length)return {ok:[],errors:[{row:"—",msg:"文件中没有可导入的数据"}]};
    if(rows.length>20000)return {ok:[],errors:[{row:"—",msg:"单次最多导入 20000 行，请拆分文件"}]};
    const assignedBeds=new Map(),notedBeds=new Map();
    if(isRoom){state.assignments.forEach(item=>{if(item.status==="current"||item.status==="planned")assignedBeds.set(item.roomId,Math.max(assignedBeds.get(item.roomId)||0,Number(item.bedNo)||0));});state.bedNotes.forEach(item=>notedBeds.set(item.roomId,Math.max(notedBeds.get(item.roomId)||0,Number(item.bedNo)||0)));}
    rows.forEach((raw,index)=>{
      const row={},messages=[];fields.forEach(field=>{row[field]=clean(raw&&raw[field]);if(!row[field])messages.push(field+"为必填");else if(row[field].length>100)messages.push(field+"不能超过 100 个字符");});
      const zone=row["区位"],building=row["宿舍楼"],existingBuilding=buildings.get(building);
      if(building&&zone){if(zones.has(building)&&zones.get(building)!==zone)messages.push("宿舍楼“"+building+"”的区位不一致，请使用已有区位或先编辑区位");else zones.set(building,zone);}
      if(existingBuilding&&existingBuilding.status==="inactive")messages.push("宿舍楼已停用，请先启用");
      const key=isRoom?JSON.stringify([building,row["宿舍号"]]):building;
      if(isRoom){
        const beds=Number(row["床位数"]),existing=rooms.get(key);
        if(!/^\d+$/.test(row["床位数"])||!Number.isInteger(beds)||beds<1||beds>state.settings.maxBedCount)messages.push("床位数须为 1—"+state.settings.maxBedCount+" 的整数");
        if(existing){
          if(existing.floor!==row["楼层"])messages.push("已有宿舍的楼层不一致，不能通过导入修改空间位置");
          if(existing.status==="inactive")messages.push("宿舍已停用，请先启用");
          const residents=residentsForRoom(existing.id);
          const highest=Math.max(assignedBeds.get(existing.id)||0,residents.reduce((max,item)=>Math.max(max,Number(item.row.bed)||0),0));
          const noted=notedBeds.get(existing.id)||0;
          if(beds<residents.length||beds<highest)messages.push("床位数不能少于入住人数或已占用、已计划的最大床位号（"+Math.max(residents.length,highest)+"）");
          if(beds<noted)messages.push("第 "+noted+" 号床仍有独立登记，请先清除登记再减少床位数");
        }
      }
      const signature=JSON.stringify(fields.map(field=>field==="床位数"?Number(row[field]):row[field])),previous=seen.get(key);
      if(previous){
        if(previous.signature!==signature)messages.push("文件内同一"+(isRoom?"宿舍楼与宿舍号":"宿舍楼")+"的数据冲突，请核对区位、楼层及床位数，不能作为重复数据覆盖");
        else if(!messages.length){duplicates++;warnings.push({row:index+2,msg:"与第 "+previous.row+" 行重复，已自动去重，仅导入一条"});return;}
      }
      if(messages.length)errors.push({row:index+2,msg:messages.join("；")});else{seen.set(key,{signature:signature,row:index+2});ok.push(row);}
    });
    const addedBuildings=Array.from(zones.keys()).filter(name=>!buildings.has(name)).length;
    const addedRooms=isRoom?ok.filter(row=>!rooms.has(JSON.stringify([row["宿舍楼"],row["宿舍号"]]))).length:0;
    if(state.buildings.length+addedBuildings>5000||state.rooms.length+addedRooms>20000)errors.push({row:"—",msg:"导入后资源数量超出上限（楼栋 5000、房间 20000）"});
    return {ok:errors.length?[]:ok,errors:errors,warnings:warnings,duplicates:duplicates};
  }
  function applyResourceImport(kind,rows){
    if(window.__WORKBENCH_READ_ONLY__){showToast("当前账号仅可查看，不能导入资源","warn");return {failed:true,ok:0,skip:0};}
    // Recheck at commit time: resources may have changed since preview.
    residentCache=null;residentByRoomCache=null;
    const checked=validateResourceImport(kind,rows);
    if(checked.errors.length){showToast("导入未执行："+checked.errors[0].msg,"error");return {failed:true,ok:0,skip:0};}
    const before=clone(state),shadow=typeof ORG_DORMS!=="undefined"?clone(ORG_DORMS):null,stored=localStorage.getItem(STORAGE_KEY),group=makeId("op");
    let ok=0,skip=checked.duplicates||0;
    const buildings=new Map(state.buildings.map(item=>[item.building,item])),rooms=new Map(state.rooms.map(item=>[JSON.stringify([item.building,item.room]),item]));
    try{
      runResourceBatch(()=>{checked.ok.forEach(row=>{
        const zone=row["区位"],building=row["宿舍楼"];
        let item=buildings.get(building);
        if(!item){item=ensureBuilding(zone,building);buildings.set(building,item);audit("BUILDING_CREATE",item.id,null,clone(item),"批量导入楼栋资源","import",group);if(kind!=="room")ok++;}
        else if(kind!=="room")skip++;
        if(kind!=="room")return;
        const key=JSON.stringify([building,row["宿舍号"]]),existing=rooms.get(key),beds=Number(row["床位数"]);
        if(existing&&existing.bedCount===beds){skip++;return;}
        const snapshot=existing?clone(existing):null,room=existing||ensureRoom(zone,building,row["楼层"],row["宿舍号"],beds);
        room.bedCount=beds;room.updatedAt=nowIso();rooms.set(key,room);
        audit(existing?"RESOURCE_CAPACITY_UPDATE":"RESOURCE_CREATE",room.id,snapshot,clone(room),"批量导入宿舍房间与床位","import",group);ok++;
      });
      if(ok)saveState();});
      residentCache=null;residentByRoomCache=null;return {ok:ok,skip:skip,duplicates:checked.duplicates||0};
    }catch(error){
      state=before;residentCache=null;residentByRoomCache=null;
      if(shadow&&typeof ORG_DORMS!=="undefined")ORG_DORMS.splice(0,ORG_DORMS.length,...shadow);
      try{if(stored===null)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,stored);if(shadow&&typeof saveOrgs==="function")saveOrgs();}catch(rollbackError){if(typeof reportDataError==="function")reportDataError("资源导入回滚",rollbackError);}
      if(typeof reportDataError==="function")reportDataError("资源导入",error);
      showToast("导入保存失败，本次资源变更已撤销，请检查存储后重试","error");return {failed:true,ok:0,skip:0};
    }
  }
  function openResourceImport(kind){
    const isRoom=kind==="room",fields=isRoom?ROOM_IMPORT_FIELDS:BUILDING_IMPORT_FIELDS;
    openMappedImportWizard({
      name:isRoom?"宿舍房间与床位":"区位与楼栋资源",fields:fields.map(label=>({label:label,required:true,aliases:label==="宿舍楼"?["楼栋","楼宇"]:label==="宿舍号"?["房间号","房号","寝室"]:label==="床位数"?["床位数量","容量"]:[]})),
      template:isRoom?"dormSpatialRoomTemplate()":"dormSpatialBuildingTemplate()",
      infoHtml:isRoom?"一行一个房间，自动补充未登记楼栋；文件内相同记录会提示并自动去重，已有相同资源跳过。楼层、区位或床位数冲突须修正，全部校验通过后写入，入住历史和床位登记保留。":"一行一个楼栋，文件内相同记录会提示并自动去重，已有相同资源跳过；区位冲突须先修正。全部校验通过后写入。",
      validate:rows=>validateResourceImport(kind,rows),apply:async (rows,preview)=>{
        const bridge=window.workbench&&window.workbench.legacy;
        try{
          if(bridge&&bridge.flushStore)await bridge.flushStore();
          const result=applyResourceImport(kind,rows);if(result.failed)return result;
          const previewDuplicates=preview&&preview.duplicates||0;result.duplicates+=previewDuplicates;result.skip+=previewDuplicates;
          if(bridge&&bridge.flushStore)await bridge.flushStore();
          return result;
        }catch(error){showToast("导入保存尚未确认，草稿已保留；请在协作面板重试或核对最新数据后继续","error");return {failed:true,ok:0,skip:0};}
      },
      after:result=>{ui.zone="";ui.building="";ui.keyword="";ui.tab="resources";renderPage("dorm");showToast("资源导入完成："+result.ok+" 条写入，"+result.skip+" 条跳过"+(result.duplicates?"（文件内自动去重 "+result.duplicates+" 条）":""),"ok");}
    });
  }
  window.dormSpatialBuildingTemplate=()=>resourceImportTemplate("building");
  window.dormSpatialRoomTemplate=()=>resourceImportTemplate("room");
  window.dormSpatialImportBuildings=()=>openResourceImport("building");
  window.dormSpatialImportRooms=()=>openResourceImport("room");
  function addOrEditRoom(roomId){
    const room=roomId?state.rooms.find(item=>item.id===roomId):null;
    openModal(room?"编辑宿舍资源":"新增宿舍资源",'<div class="row2"><div class="field"><label>区位 *</label><input id="dspRoomZone" value="'+attr(room&&room.zone||"")+'"></div><div class="field"><label>宿舍楼 *</label><input id="dspRoomBuilding" value="'+attr(room&&room.building||"")+'"></div></div><div class="row2"><div class="field"><label>楼层 *</label><input id="dspRoomFloor" value="'+attr(room&&room.floor||"")+'" placeholder="如 5、B1"></div><div class="field"><label>宿舍号 *</label><input id="dspRoomNo" value="'+attr(room&&room.room||"")+'" placeholder="如 503"></div></div><div class="field"><label>床位数 *</label><input id="dspRoomBeds" type="number" min="1" max="'+state.settings.maxBedCount+'" value="'+(room?room.bedCount:state.settings.defaultBedCount)+'"><small>可在 1—'+state.settings.maxBedCount+' 之间自由设置。</small></div>',function(){
      let zone=clean(document.getElementById("dspRoomZone").value);const building=clean(document.getElementById("dspRoomBuilding").value),roomNo=clean(document.getElementById("dspRoomNo").value),floor=clean(document.getElementById("dspRoomFloor").value)||inferFloor(roomNo),bedCount=positiveInt(document.getElementById("dspRoomBeds").value,0,1,state.settings.maxBedCount),buildingResource=findBuilding(building);if(buildingResource)zone=buildingResource.zone;
      if(!zone||!building||!floor||!roomNo||!bedCount){showToast("请完整填写区位、宿舍楼、楼层、宿舍号和床位数","warn");return false;}
      const duplicate=findRoom(zone,building,floor,roomNo);if(duplicate&&(!room||duplicate.id!==room.id)){showToast("该空间位置已存在","warn");return false;}
      if(room){const occupiedRows=residentsForRoom(room.id),locationChanged=zone!==room.zone||building!==room.building||floor!==room.floor||roomNo!==room.room,hasHistory=state.assignments.some(item=>item.roomId===room.id);if(locationChanged&&hasHistory){showToast("该宿舍已有入住或退宿历史，不能修改空间位置；可调整床位数，或新增一个宿舍资源","warn");return false;}const highestOccupied=occupiedRows.reduce((max,item)=>Math.max(max,parseInt(clean(item.row.bed),10)||0),0),highestNoted=state.bedNotes.filter(item=>item.roomId===room.id).reduce((max,item)=>Math.max(max,parseInt(clean(item.bedNo),10)||0),0);if(bedCount<occupiedRows.length){showToast("该宿舍当前已有 "+occupiedRows.length+" 人入住，床位数不能少于入住人数","warn");return false;}if(bedCount<highestOccupied){showToast("第 "+highestOccupied+" 号床仍有人入住，不能减少到 "+bedCount+" 个床位","warn");return false;}if(bedCount<highestNoted){showToast("第 "+highestNoted+" 号床仍有独立登记，请先清除登记再减少床位数","warn");return false;}const before=clone(room);Object.assign(room,{zone:zone,building:building,floor:floor,room:roomNo,bedCount:bedCount,updatedAt:nowIso()});audit("RESOURCE_UPDATE",room.id,before,clone(room),"编辑宿舍资源","manual");}
      else{const added=ensureRoom(zone,building,floor,roomNo,bedCount);added.bedCount=bedCount;audit("RESOURCE_CREATE",added.id,null,clone(added),"新增宿舍资源","manual");}
      saveState();renderPage("dorm");
    });
  }
  function editResident(studentId){
    const student=(students||[]).find(item=>clean(item.id)===clean(studentId));
    if(!student){showToast("未找到该学生，住宿信息可能已发生变化","warn");return;}
    if(typeof window.dormEdit!=="function"){showToast("住宿编辑功能暂不可用，请刷新页面后重试","error");return;}
    window.dormEdit(student.id);
  }
  function setLeader(roomId,studentId){
    const room=state.rooms.find(item=>item.id===roomId),resident=residentsForRoom(roomId).find(item=>clean(item.student.id)===clean(studentId));if(!room||!resident){showToast("宿舍长必须是本宿舍当前成员","warn");return;}
    const old=currentLeader(roomId);if(old&&clean(old.studentId)===clean(studentId)){showToast("该学生已经是宿舍长","ok");return;}
    const oldName=old&&(students.find(s=>clean(s.id)===clean(old.studentId))||{}).name;if(old&&!confirm("当前宿舍长为“"+(oldName||old.studentId)+"”，确定替换为“"+resident.student.name+"”？"))return;
    const group=makeId("op");if(old){old.status="ended";old.effectiveTo=nowIso();old.changeReason="替换宿舍长";old.updatedAt=nowIso();}
    const role={id:makeId("leader"),roomId:roomId,studentId:clean(studentId),role:"dorm_leader",status:"current",effectiveFrom:nowIso(),effectiveTo:"",changeReason:"设置宿舍长",createdAt:nowIso(),updatedAt:nowIso()};state.leaders.push(role);audit(old?"LEADER_REPLACE":"LEADER_SET",roomId,old?clone(old):null,clone(role),"设置宿舍长","manual",group);saveState();showToast("已设置 "+resident.student.name+" 为宿舍长","ok");closeModal();renderPage("dorm");
  }
  function assign(roomId,bedNo){
    const room=state.rooms.find(item=>item.id===roomId);if(!room)return;
    if(roomBeds(room).find(item=>item.label===clean(bedNo)&&item.residents.length)){showToast("该床位已被占用","warn");return;}
    const candidates=(students||[]).filter(student=>typeof isOnCampusStudent==="function"&&isOnCampusStudent(student)&&!isCurrentResident(student));
    openModal("安排入住 · "+room.building+room.room+"室 "+bedNo+"号床",'<div class="field"><label>选择在校学生</label><select id="dspAssignStudent"><option value="">请选择</option>'+candidates.sort((a,b)=>naturalCompare(a.name,b.name)).map(student=>'<option value="'+attr(student.id)+'">'+esc(student.name)+'（'+esc(student.id)+' · '+esc(student.cls||'未维护班级')+'）</option>').join('')+'</select></div><div class="tip">保存后会同步写入现有“宿舍管理”的住宿情况、区位、宿舍楼、房间号和床位号。</div>',function(){const sid=clean(document.getElementById("dspAssignStudent").value);if(!sid){showToast("请选择学生","warn");return false;}const result=typeof applyDormDistribution==="function"&&applyDormDistribution(sid,{accom:"校内",zone:room.zone,building:room.building,room:room.room,bed:bedNo});if(!result){showToast("安排入住失败，请确认学生仍为在校状态","error");return false;}syncFromLegacy({force:true,source:"spatial-ui"});audit("CHECK_IN",sid,null,{roomId:room.id,bedNo:bedNo},"空间总览安排入住","manual");saveState();renderPage("dorm");});
  }
  function checkoutStudent(studentId,reason,source){
    const student=(students||[]).find(item=>clean(item.id)===clean(studentId));if(!student)return false;const before=accommodationOf(student),assignment=currentAssignment(student.id),hasRole=state.leaders.some(item=>item.status==="current"&&clean(item.studentId)===clean(student.id)),hasRecord=(Array.isArray(dormDistRecords)?dormDistRecords:[]).some(record=>clean(record.studentId||record.id)===clean(student.id)),hasAccommodation=LEGACY_KEYS.some(key=>clean(before[key]));if(!assignment&&!hasRole&&!hasRecord&&!hasAccommodation)return true;
    if(source!=="graduation"&&!confirm("确定为“"+student.name+"”办理退宿？当前床位和宿舍长角色将被释放，历史记录会保留。"))return false;
    const stateSnapshot=clone(state),recordsSnapshot=clone(dormDistRecords||[]),studentSnapshot=clone(student),group=makeId("op"),effective=nowIso();
    try{
      if(assignment)endAssignment(assignment,reason||"办理退宿",effective);endLeaderForStudent(student.id,reason||"办理退宿",effective);
      LEGACY_KEYS.forEach(key=>{student[key]="";});dormDistRecords=(Array.isArray(dormDistRecords)?dormDistRecords:[]).filter(record=>clean(record.studentId||record.id)!==clean(student.id));
      audit(source==="graduation"?"AUTO_CHECKOUT_GRADUATION":"CHECK_OUT",student.id,before,{status:student.status,currentAccommodation:null},reason||"办理退宿",source||"manual",group);residentCache=null;residentByRoomCache=null;persistStudents();persistDormDist();saveState();if(assignment)promptDeleteEmptyRoom(assignment.roomId,reason||"办理退宿");return true;
    }catch(error){
      state=stateSnapshot;dormDistRecords=recordsSnapshot;Object.keys(student).forEach(key=>delete student[key]);Object.assign(student,studentSnapshot);residentCache=null;residentByRoomCache=null;try{persistStudents();persistDormDist();saveState();}catch(_ignore){}if(typeof reportDataError==="function")reportDataError("办理退宿",error);if(typeof showToast==="function")showToast("退宿失败，住宿信息已回滚","error");return false;
    }
  }
  function checkoutStudents(studentIds,reason,source){
    const ids=Array.from(new Set((studentIds||[]).map(clean).filter(Boolean))),byId=new Map((students||[]).map(student=>[clean(student.id),student])),targets=ids.map(id=>byId.get(id)).filter(Boolean);
    const actionable=targets.filter(student=>{const before=accommodationOf(student);return !!currentAssignment(student.id)||state.leaders.some(item=>item.status==="current"&&clean(item.studentId)===clean(student.id))||(Array.isArray(dormDistRecords)?dormDistRecords:[]).some(record=>clean(record.studentId||record.id)===clean(student.id))||LEGACY_KEYS.some(key=>clean(before[key]));});
    if(!actionable.length)return {ok:0,skip:ids.length,failed:false};
    const stateSnapshot=clone(state),recordsSnapshot=clone(dormDistRecords||[]),studentSnapshots=actionable.map(student=>({student:student,data:clone(student)})),group=makeId("op"),effective=nowIso(),clearedIds=new Set();
    try{
      actionable.forEach(student=>{
        const before=accommodationOf(student),assignment=currentAssignment(student.id);
        if(assignment)endAssignment(assignment,reason||"批量清除住宿",effective);
        endLeaderForStudent(student.id,reason||"批量清除住宿",effective);
        LEGACY_KEYS.forEach(key=>{student[key]="";});clearedIds.add(clean(student.id));
        audit("CHECK_OUT",student.id,before,{status:student.status,currentAccommodation:null},reason||"批量清除住宿",source||"batch",group);
      });
      dormDistRecords=(Array.isArray(dormDistRecords)?dormDistRecords:[]).filter(record=>!clearedIds.has(clean(record.studentId||record.id)));
      residentCache=null;residentByRoomCache=null;persistStudents();persistDormDist();saveState();
      return {ok:actionable.length,skip:ids.length-actionable.length,failed:false};
    }catch(error){
      state=stateSnapshot;dormDistRecords=recordsSnapshot;studentSnapshots.forEach(snapshot=>{Object.keys(snapshot.student).forEach(key=>delete snapshot.student[key]);Object.assign(snapshot.student,snapshot.data);});residentCache=null;residentByRoomCache=null;
      try{persistStudents();persistDormDist();saveState();}catch(_ignore){}
      if(typeof reportDataError==="function")reportDataError("批量清除住宿",error);if(typeof showToast==="function")showToast("批量清除住宿失败，全部修改已回滚","error");return {ok:0,skip:ids.length,failed:true,error:error};
    }
  }
  function graduationCandidates(entries){return (entries||[]).filter(item=>item&&item.student&&clean(item.oldStatus)!=="毕业"&&clean(item.student.status)==="毕业");}
  function graduationPreview(entries){
    const list=graduationCandidates(entries),withBed=list.filter(item=>{const row=accommodationOf(item.student);return clean(row.building)&&clean(row.room)&&clean(row.bed);}),leaders=list.filter(item=>state.leaders.some(role=>role.status==="current"&&clean(role.studentId)===clean(item.student.id)));
    const plans=list.reduce((sum,item)=>sum+state.assignments.filter(a=>clean(a.studentId)===clean(item.student.id)&&a.status==="planned").length,0);
    return {count:list.length,withBed:withBed.length,leaders:leaders.length,plans:plans,students:list};
  }
  function confirmGraduation(entries,source){
    const p=graduationPreview(entries);if(!p.count)return true;
    return confirm("本次将有 "+p.count+" 名学生变为“已毕业”。\n\n系统将自动办理退宿：\n• 释放当前床位："+p.withBed+" 人\n• 结束宿舍长角色："+p.leaders+" 人\n• 取消未来入住计划："+p.plans+" 条\n• 清空现住宿信息并保留历史\n\n是否继续？");
  }
  function checkoutGraduates(entries,source){
    const list=graduationCandidates(entries);if(!list.length)return true;
    const stateSnapshot=clone(state),recordsSnapshot=clone(dormDistRecords||[]),studentSnapshots=list.map(item=>({student:item.student,data:clone(item.student),oldStatus:item.oldStatus}));
    try{
      list.forEach(item=>{
        state.assignments.forEach(assignment=>{if(clean(assignment.studentId)===clean(item.student.id)&&assignment.status==="planned"){assignment.status="cancelled";assignment.endReason="毕业自动退宿";assignment.updatedAt=nowIso();}});
        if(!checkoutStudent(item.student.id,"毕业自动退宿","graduation"))throw new Error("学生 "+item.student.id+" 自动退宿失败");
      });
      saveState();return true;
    }catch(error){
      state=stateSnapshot;dormDistRecords.splice(0,dormDistRecords.length,...recordsSnapshot);studentSnapshots.forEach(snapshot=>{Object.keys(snapshot.student).forEach(key=>delete snapshot.student[key]);Object.assign(snapshot.student,snapshot.data,{status:snapshot.oldStatus});});
      try{persistStudents();persistDormDist();saveState();}catch(_ignore){}
      if(typeof reportDataError==="function")reportDataError("毕业自动退宿",error);if(typeof showToast==="function")showToast("毕业自动退宿失败，学籍和住宿信息已回滚","error");return false;
    }
  }
  function saveSettings(){
    const max=positiveInt(document.getElementById("dspMaxBeds").value,0,1,200),def=positiveInt(document.getElementById("dspDefaultBeds").value,0,1,max||200);if(!max||!def||def>max){showToast("默认床位数必须为正整数且不能超过安全上限","warn");return;}
    const largest=state.rooms.reduce((value,room)=>Math.max(value,Number(room.bedCount)||0),0);if(max<largest){showToast("当前已有宿舍配置为 "+largest+" 个床位，安全上限不能低于现有最大床位数","warn");return;}
    state.settings.maxBedCount=max;state.settings.defaultBedCount=def;saveState();showToast("床位参数已保存","ok");renderPage("dorm");
  }
  function renameStudentId(oldId,newId){
    oldId=clean(oldId);newId=clean(newId);if(!oldId||!newId||oldId===newId)return true;
    if(state.assignments.some(item=>clean(item.studentId)===newId)||state.leaders.some(item=>clean(item.studentId)===newId)||(dormDistRecords||[]).some(record=>clean(record.studentId||record.id)===newId)){showToast("新学号已存在住宿关系，不能合并","warn");return false;}
    const stateSnapshot=clone(state),recordsSnapshot=clone(dormDistRecords||[]);
    try{
      state.assignments.forEach(item=>{if(clean(item.studentId)===oldId)item.studentId=newId;});state.leaders.forEach(item=>{if(clean(item.studentId)===oldId)item.studentId=newId;});state.audit.forEach(item=>{if(clean(item.targetId)===oldId)item.targetId=newId;});
      (dormDistRecords||[]).forEach(record=>{if(clean(record.studentId||record.id)===oldId){record.studentId=newId;record.id=newId;}});audit("STUDENT_ID_RENAME",newId,{studentId:oldId},{studentId:newId},"学生学号变更","student-edit");residentCache=null;residentByRoomCache=null;persistDormDist();saveState();return true;
    }catch(error){state=stateSnapshot;dormDistRecords=recordsSnapshot;try{persistDormDist();saveState();}catch(_ignore){}if(typeof reportDataError==="function")reportDataError("住宿关系学号同步",error);showToast("学号变更失败，住宿关系已回滚","error");return false;}
  }
  function disableRoom(roomId){
    const room=state.rooms.find(item=>item.id===roomId);if(!room)return;if(room.status!=="inactive"&&residentsForRoom(roomId).length){showToast("该宿舍仍有学生入住，不能停用","warn");return;}const before=clone(room);room.status=room.status==="inactive"?"active":"inactive";room.updatedAt=nowIso();audit(room.status==="inactive"?"RESOURCE_DISABLE":"RESOURCE_UPDATE",room.id,before,clone(room),room.status==="inactive"?"停用宿舍":"恢复宿舍","manual");saveState();renderPage("dorm");
  }
  async function deleteRoom(roomId,options){
    options=options||{};
    const index=state.rooms.findIndex(item=>item.id===roomId);if(index<0)return false;const room=state.rooms[index],residents=residentsForRoom(roomId);
    if(residents.length){showToast("该宿舍仍有 "+residents.length+" 名学生入住，不能删除；请先办理退宿或调宿","warn");return false;}
    const currentCount=state.assignments.filter(item=>item.roomId===roomId&&item.status==="current").length,plannedCount=state.assignments.filter(item=>item.roomId===roomId&&item.status==="planned").length,currentLeaderCount=state.leaders.filter(item=>item.roomId===roomId&&item.status==="current").length;
    if(currentCount||currentLeaderCount){showToast("该宿舍仍有当前入住或宿舍长关系，不能删除","warn");return false;}if(plannedCount){showToast("该宿舍仍有未来入住计划，不能删除","warn");return false;}
    const hasHistory=state.assignments.some(item=>item.roomId===roomId)||state.leaders.some(item=>item.roomId===roomId),noteCount=state.bedNotes.filter(item=>item.roomId===roomId).length;
    const moved=await window.recycleMoveRecords("dormRoom","dorm_room",[roomId]);if(!moved)return false;reloadState();residentCache=null;residentByRoomCache=null;showToast("宿舍房间与床位登记已移入回收站，入住历史继续保留","ok");if(options.render!==false)renderPage("dorm");return true;
  }
  function promptDeleteEmptyRoom(roomId,reason){
    const room=state.rooms.find(item=>item.id===roomId);if(!room)return false;
    const currentCount=state.assignments.filter(item=>item.roomId===roomId&&item.status==="current").length,plannedCount=state.assignments.filter(item=>item.roomId===roomId&&item.status==="planned").length,noteCount=state.bedNotes.filter(item=>item.roomId===roomId).length;if(currentCount||plannedCount)return false;
    return deleteRoom(roomId,{confirmed:true,render:false,reason:"空房确认删除："+(reason||"住宿变动"),source:"empty-room-prompt"});
  }
  async function deleteBuilding(buildingId){
    const index=state.buildings.findIndex(item=>item.id===buildingId);if(index<0)return false;const item=state.buildings[index];
    const roomCount=state.rooms.filter(room=>room.building===item.building).length;if(roomCount){showToast("该宿舍楼仍有 "+roomCount+" 间宿舍资源，不能删除；请先处理房间或停用楼栋","warn");return false;}
    const studentCount=(students||[]).filter(student=>clean(student.building)===item.building).length,recordCount=(Array.isArray(dormDistRecords)?dormDistRecords:[]).filter(record=>clean(record.building)===item.building).length,historyCount=state.assignments.filter(assignment=>clean((assignment.positionSnapshot||{}).building)===item.building).length;
    if(studentCount||recordCount||historyCount){showToast("该宿舍楼仍被住宿信息或历史记录引用，不能删除","warn");return false;}
    const moved=await window.recycleMoveRecords("dormBuilding","dorm_building",[buildingId]);if(!moved)return false;reloadState();showToast("宿舍楼资源已移入回收站","ok");renderPage("dorm");return true;
  }
  function onAccommodationChanged(studentId,options){syncFromLegacy({force:true,source:"legacy-write",promptEmpty:true});if(currentView==="dorm"&&!(options&&options.render===false))renderPage("dorm");}
  function onStudentDataChanged(options){
    options=options||{};residentCache=null;residentByRoomCache=null;
    return syncFromLegacy({source:options.source||"student-management"});
  }
  function getState(){return clone(state);}
  function reloadState(){state=loadState();residentCache=null;residentByRoomCache=null;return getState();}
  function studentRole(studentId){const sid=clean(studentId),role=state.leaders.find(item=>item.status==="current"&&clean(item.studentId)===sid);return role?"宿舍长":"成员";}
  function restoreState(snapshot){state=normalizeState(clone(snapshot||emptyState()));residentCache=null;residentByRoomCache=null;migrateLegacyBuildings();saveState();}
  function init(){
    if(typeof PAGES!=="object"||!PAGES.dorm)return;
    legacyDormPage=PAGES.dorm;legacyDormInit=PAGES.dorm_init;
    migrateLegacyBuildings();
    syncFromLegacy({force:true,source:"startup-migration"});
    PAGES.dorm=renderPageHtml;PAGES.dorm_init=function(){if(ui.tab==="distribution"&&legacyDormInit)legacyDormInit();};
  }
  window.dormSpatialLocateStudent=locateStudent;
  window.dormSpatialSetTab=setTab;window.dormSpatialSetFilter=setFilter;window.dormSpatialResetFilters=resetFilters;window.dormSpatialOpenRoom=openRoom;window.dormSpatialOpenStudent=openStudent;window.dormSpatialOpenBed=openBed;window.dormSpatialEditBedNote=editBedNote;window.dormSpatialDeleteBedNote=deleteBedNote;window.dormSpatialAddBuilding=()=>addOrEditBuilding();window.dormSpatialEditBuilding=addOrEditBuilding;window.dormSpatialDisableBuilding=disableBuilding;window.dormSpatialDeleteBuilding=deleteBuilding;window.dormSpatialAddRoom=()=>addOrEditRoom();window.dormSpatialEditRoom=addOrEditRoom;window.dormSpatialDisableRoom=disableRoom;window.dormSpatialDeleteRoom=deleteRoom;window.dormSpatialEditResident=editResident;window.dormSpatialSetLeader=setLeader;window.dormSpatialAssign=assign;window.dormSpatialCheckout=function(studentId){if(checkoutStudent(studentId,"办理退宿","manual")){closeModal();renderPage("dorm");}};window.dormSpatialSaveSettings=saveSettings;window.dormSpatialReloadState=reloadState;window.dormSpatialSync=function(){syncFromLegacy({force:true,source:"manual-sync"});showToast("已从现有宿舍管理同步空间资源与入住关系","ok");renderPage("dorm");};
  window.__DORM_SPATIAL__={storageKey:STORAGE_KEY,schemaVersion:SCHEMA_VERSION,syncFromLegacy:syncFromLegacy,migrateLegacyBuildings:migrateLegacyBuildings,buildingRows:buildingRows,buildingInfo:building=>{const item=findBuilding(building);return item?clone(item):null;},runBatch:runResourceBatch,ensureBuilding:ensureBuildingResource,ensureRoom:ensureRoomResource,onAccommodationChanged:onAccommodationChanged,onStudentDataChanged:onStudentDataChanged,graduationPreview:graduationPreview,confirmGraduation:confirmGraduation,checkoutGraduates:checkoutGraduates,checkoutStudent:checkoutStudent,checkoutStudents:checkoutStudents,renameStudentId:renameStudentId,getState:getState,reloadState:reloadState,restoreState:restoreState,studentRole:studentRole,summary:()=>summary(state.rooms)};
  init();
})();
