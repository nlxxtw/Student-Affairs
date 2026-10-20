'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../web-server.js'),'utf8');
function span(a,b){const start=source.indexOf(a),end=source.indexOf(b,start);assert(start>=0&&end>start);return source.slice(start,end);}
const sessions=new Map();
const box={crypto,authSessions:sessions,SESSION_COOKIE:'session',parseCookies:r=>({session:r.cookie}),httpError:(status,message)=>Object.assign(new Error(message),{statusCode:status})};
vm.createContext(box);vm.runInContext(span('function isLocalRequest(', 'function parseCookies(')+span('function createSession(', 'function assertRequestSession(')+span('function storeEqual(', 'function validateHousingChanges('),box);
const local=cookie=>({socket:{remoteAddress:'127.0.0.1'},cookie,headers:{}}),remote=cookie=>({socket:{remoteAddress:'192.168.1.50'},cookie,headers:{'x-forwarded-for':'127.0.0.1'}});
assert.equal(box.ensureAccessSession(remote()),null,'LAN devices cannot obtain any session, even with a spoofed forwarding header');
const host=box.createSession();assert.equal(host.uid,'local-super-admin');assert.equal(box.currentSession(local(host.id)).id,host.id);
assert.equal(box.currentSession(remote(host.id)),null,'even an otherwise valid host cookie cannot authenticate a remote connection');
const host2=box.createSession();assert.equal(box.currentSession({...local(host2.id),socket:{remoteAddress:'::1'}}).id,host2.id);
assert.equal(box.currentSession({...local(host2.id),socket:{remoteAddress:'::ffff:127.0.0.1'}}).id,host2.id);
const json=JSON.stringify;
// Load the complete server module as well: sliced VM tests cannot detect a later
// function declaration shadowing the concurrent-save helper.
const runtime=require('../web-server.js');
assert.deepEqual(JSON.parse(runtime.mergeConcurrentStoreValue(json([{id:'1',a:1,b:1}]),json([{id:'1',a:2,b:1}]),json([{id:'1',a:1,b:2}]),'nnuzc_tasks')),[{id:'1',a:2,b:2}]);
const stats={addedKeys:0,addedRecords:0};
assert.equal(runtime.mergeStoreValue(json({a:2}),json({a:1,b:3}),stats),json({a:2,b:3}),'backup merge keeps current values and adds missing fields');
const merged=JSON.parse(box.mergeConcurrentStoreValue(json([{id:'1',a:1,b:1}]),json([{id:'1',a:2,b:1}]),json([{id:'1',a:1,b:2}]),'nnuzc_tasks'));
assert.deepEqual(merged,[{id:'1',a:2,b:2}]);
assert.throws(()=>box.mergeStoreData({x:1},{x:2},{x:3}),e=>e.statusCode===409,'same-field edits are not overwritten');
assert.throws(()=>box.mergeStoreData([{id:'1',x:1}],[],[{id:'1',x:2}]),e=>e.statusCode===409,'deletion versus edit remains a conflict');
assert.deepEqual(JSON.parse(box.mergeConcurrentStoreValue(null,json([{id:'a'}]),json([{id:'b'}]),'nnuzc_tasks')),[{id:'a'},{id:'b'}]);
const bridgeBox={licensePublicStatus:()=>({required:false,valid:true}),readStore:()=>({}),demoStatus:()=>({active:false})};
vm.createContext(bridgeBox);vm.runInContext(span('function workbenchSaveBrowser(', 'const academicPublicService ='),bridgeBox);
new vm.Script(bridgeBox.bridgeScript({uid:'local-super-admin',name:'合成本机管理员',role:'sa',roleName:'本机管理员',context:'synthetic-context',createdAt:0}),{filename:'generated-workbench-bridge.js'});
console.log('workbench session/store: loopback-only identities, forwarded-header and remote host-cookie rejection, field/record merge, deletion conflicts and generated bridge passed');
