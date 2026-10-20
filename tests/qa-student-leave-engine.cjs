'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../student-leave-engine.js');
const people=[{id:'001',name:'合成甲',dept:'合成学院',major:'合成专业',grade:'2026级',cls:'合成班',status:'在校'},{id:'002',name:'合成乙',status:'毕业'}];
const context={students:people,terms:['2026-2027-1学期'],now:'2026-10-18T12:00'};
const row=(extra={})=>({id:'leave-a',studentId:'001',term:context.terms[0],type:'病假',reason:'合成就医事由',start:'2026-10-17T08:00',end:'2026-10-18T10:00',approval:'已批准',returnedAt:'',files:[],...extra});
test('required type and reason, strict calendar, known in-school student and term',()=>{
 for(const patch of [{type:''},{type:'未知'},{reason:' '},{reason:{text:'bad'}},{studentId:'404'},{studentId:'002'},{term:'未维护学期'},{start:'2026-02-30T08:00'},{end:'2026-10-17T07:00'}])assert.throws(()=>L.validate([row(patch)],context));
 assert.equal(L.validate([row()],context)[0].name,'合成甲');
 assert.equal(L.datetime('2026/10/18 8:05'),'2026-10-18T08:05');
 assert.equal(L.datetime('2026年10月18日 8:05'),'2026-10-18T08:05');
 assert.equal(L.datetime(46313.5),'2026-10-18T12:00');
});
test('status derives overdue, future start, approval and actual return in Beijing time',()=>{
 assert.equal(L.status(row(),context.now),'逾期未归');
 assert.equal(L.status(row({approval:'待审批'}),context.now),'待审批');
 assert.equal(L.status(row({start:'2026-10-19T08:00',end:'2026-10-20T08:00'}),context.now),'未开始');
 assert.equal(L.status(row({start:context.now,end:'2026-10-20T08:00'}),context.now),'请假中');
 assert.equal(L.status(row({approval:'待审批',start:'2026-10-19T08:00',end:'2026-10-20T08:00'}),context.now),'待审批');
 assert.equal(L.status(row({returnedAt:'2026-10-18T09:00'}),context.now),'已销假');
 assert.equal(L.status(row({returnedAt:'2026-10-18T11:00'}),context.now),'逾期销假');
 for(const patch of [{returnedAt:'2026-10-18T13:00'},{returnedAt:'2026-10-16T09:00'},{approval:'待审批',returnedAt:'2026-10-18T09:00'}])assert.throws(()=>L.validate([row(patch)],context));
});
test('new leave types follow the seven choices; historical types remain editable without allowing new obsolete types',()=>{
 const types=['事假','病假','法定节假日','寒暑假','公假','实习假','其他'];
 assert.deepEqual(L.types,types);
 for(const type of types)assert.equal(L.validate([row({type})],context)[0].type,type);
 for(const type of ['实习实训','求职面试','回家探亲']){
  const original=row({type});
  assert.throws(()=>L.validate([original],context),/类型/);
  assert.equal(L.validate([{...original,notes:'历史补充'}],{...context,before:[original]})[0].type,type);
  assert.equal(L.validate([original],{...context,historical:true})[0].type,type);
  assert.throws(()=>L.validate([{...original,id:'new-id'}],{...context,before:[original]}),/类型/);
  const closed={...original,returnedAt:'2026-10-18T09:00'};
  assert.equal(L.validate([{...closed,notes:'闭合记录补充'}],{...context,before:[closed]})[0].type,type);
 }
 assert.throws(()=>L.validate([row({type:'未知历史类型'})],{...context,historical:true}),/类型/);
});
test('overlap is rejected atomically, adjacent periods and rejected leave are allowed',()=>{
 assert.throws(()=>L.validate([row(),row({id:'leave-b',start:'2026-10-18T09:00',end:'2026-10-19T09:00'})],context),/重叠/);
 assert.equal(L.validate([row(),row({id:'leave-b',start:'2026-10-18T10:00',end:'2026-10-19T09:00'})],context).length,2);
 assert.equal(L.validate([row(),row({id:'leave-b',approval:'已驳回'})],context).length,2);
 assert.throws(()=>L.validate([row(),row()],context),/重复/);
});
test('historical graduate records remain readable/editable in notes; closed periods are protected',()=>{
 const original=row({returnedAt:'2026-10-18T09:00'}),graduated={...context,students:[{...people[0],status:'毕业'}],before:[original]};
 assert.equal(L.validate([{...original,notes:'补充备注'}],graduated)[0].notes,'补充备注');
 assert.throws(()=>L.validate([{...original,end:'2026-10-18T11:00'}],graduated),/销假/);
 assert.equal(L.duration(row()).hours,26);
});
