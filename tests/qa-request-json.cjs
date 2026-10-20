'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={window:{},Error,JSON};let response,captured;
sandbox.window.fetch=async(url,options)=>{captured={url,options};if(response instanceof Error)throw response;return response;};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/workbench-ui.js'),'utf8'),sandbox);
async function run(){
 const request=sandbox.window.WorkbenchUI.requestJSON;assert.equal(typeof request,'function');
 response={ok:true,json:async()=>({value:0})};assert.equal((await request('/api/example')).value,0);assert.equal(captured.options.credentials,'same-origin');
 response={ok:false,status:409,json:async()=>({error:{message:'版本冲突',code:'CONFLICT',traceId:'trace-test'}})};
 await assert.rejects(()=>request('/api/example',{method:'POST',body:'{}'}),e=>e.message==='版本冲突'&&e.code==='CONFLICT'&&e.trace==='trace-test'&&e.status===409);
 response={ok:false,status:403,json:async()=>({error:'没有权限',code:'DENIED'})};await assert.rejects(()=>request('/api/example'),e=>e.message==='没有权限'&&e.code==='DENIED');
 response={ok:true,json:async()=>{throw Error('html instead of JSON');}};await assert.rejects(()=>request('/api/example'),e=>e.code==='INVALID_RESPONSE');
 response=Error('offline');await assert.rejects(()=>request('/api/example'),e=>e.message==='offline');
 console.log('request JSON: passed (zero, credentials, structured/string errors, status/code/trace, invalid JSON, no automatic write retry)');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
