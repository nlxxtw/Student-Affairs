'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
withIsolatedWorkbench(async origin=>{
 const entered=await fetch(origin+'/api/auth/enter',{method:'POST',headers:{Origin:origin}}),cookie=entered.headers.get('set-cookie').split(';')[0];await entered.arrayBuffer();
 const marker='synthetic-private-origin-marker';
 const saved=await fetch(origin+'/api/store/nnuzc_qa_origin_marker',{method:'PUT',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({value:JSON.stringify({note:marker})})});assert.equal(saved.status,200);await saved.arrayBuffer();
 async function raw(route,headers){return new Promise((resolve,reject)=>{const req=http.get(origin+route,{headers},r=>{const chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks).toString('utf8')}));});req.on('error',reject);});}
 const bridge=await raw('/workbench-bridge.js',{Cookie:cookie});assert.equal(bridge.status,200);assert(bridge.body.includes(marker),'same-origin bridge still preloads data');
 const failures=[];
 for(const [label,headers] of [['untrusted Host',{Host:'audit.invalid:'+new URL(origin).port}],['foreign Origin',{Origin:'https://audit.invalid'}]]){
  const landing=await raw('/',headers),issued=landing.headers['set-cookie']?.[0].split(';')[0]||cookie;
  if(landing.status!==403||landing.headers['set-cookie'])failures.push(label+' landing accepted or issued a session');
  for(const route of ['/workbench-bridge.js','/assets/tool-history-client.js','/','/api/health','/api/auth/status']){
   const r=await raw(route,{...headers,Cookie:issued});
   if(r.status!==403||r.body.includes(marker)||r.headers['set-cookie'])failures.push(label+' '+route+' status='+r.status+' leakedMarker='+r.body.includes(marker)+' createdSession='+!!r.headers['set-cookie']);
  }
 }
 for(const route of ['/workbench-bridge.js','/app.js','/assets/tool-history-client.js']){
  const r=await raw(route,{Cookie:cookie});assert.equal(r.status,200);
  if(r.headers['cross-origin-resource-policy']!=='same-origin')failures.push('missing resource isolation header: '+route);
 }
 const alias=await raw('/workbench-bridge.js',{Host:'localhost:'+new URL(origin).port,Origin:'http://localhost:'+new URL(origin).port,Cookie:cookie});assert.equal(alias.status,200,'localhost remains supported');
 const wrongPort=await raw('/workbench-bridge.js',{Host:'127.0.0.1:1'});if(wrongPort.status!==403)failures.push('wrong-port Host allowed');
 assert.deepEqual(failures,[],'all sensitive/static routes must share origin checks and resource isolation');
 console.log('request origin security: Host/Origin spoofing and wrong port blocked, denied requests cannot preload data or create sessions, resource isolation present, localhost alias retained');
}).catch(e=>{console.error(e);process.exitCode=1;});
