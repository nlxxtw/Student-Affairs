"use strict";
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname,"..","web-server.js"),"utf8");
const start = source.indexOf("function storeEqual("), end = source.indexOf("function validateHousingChanges(");
assert(start >= 0 && end > start);
const context = { httpError: (status,message) => Object.assign(new Error(message),{status}) };
vm.createContext(context); vm.runInContext(source.slice(start,end),context);
function merge(base,current,proposed,key="nnuzc_students") {
  return JSON.parse(context.mergeConcurrentStoreValue(JSON.stringify(base),JSON.stringify(current),JSON.stringify(proposed),key));
}
for (const field of ["classroom","dorm"]) {
  const base=[{id:"s1",[field]:[]}], current=[{id:"s1",phone:"13800000001"}], proposed=[{id:"s1",[field]:[{id:"r1",type:"测试"}]}];
  const result=merge(base,current,proposed);
  assert.strictEqual(result[0][field][0].id,"r1");
  assert.strictEqual(result[0].phone,"13800000001");
}
assert.strictEqual(merge([{id:"s1",party:{history:[]}}],[{id:"s1",party:{}}],[{id:"s1",party:{history:[{id:"p1",stage:"积极分子"}]}}])[0].party.history[0].id,"p1");
const original=[{id:"s1",classroom:[{id:"r1",reason:"原记录"}]}];
assert.throws(()=>merge(original,[{id:"s1"}],[{id:"s1",classroom:[{id:"r1",reason:"修改记录"}]}]),error=>error.code==="COLLABORATION_CONFLICT");
for (const key of ['nnuzc_talks','nnuzc_home']) {
  const item={id:'first',content:'第一次录入'};
  assert.deepStrictEqual(merge([],undefined,[item],key),[item],key+' missing empty core collection is not a remote record deletion');
  assert.throws(()=>merge([item],undefined,[{...item,content:'修改'}],key),error=>error.code==='COLLABORATION_CONFLICT');
}
assert.throws(()=>merge([{id:"s1",phone:"原值"}],[{id:"s1",phone:"远端"}],[{id:"s1",phone:"本地"}]),error=>error.code==="COLLABORATION_CONFLICT");
assert.throws(()=>merge({items:[]},{},{items:[{id:"r1"}]},"nnuzc_other"),error=>error.code==="COLLABORATION_CONFLICT");
console.log("qa-workbench-store-canonical: passed (empty attendance/dorm/party collections, remote fields, real deletion/edit conflicts)");
