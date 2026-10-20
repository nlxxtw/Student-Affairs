"use strict";
// Read-only probe using the same bundled Node runtime as the workbench.
// Never reads license-state.json or submits an activation code/device fingerprint.
const fs=require("node:fs"),path=require("node:path"),https=require("node:https");
function main(){
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,"..","license-config.json"),"utf8"));
  const url=new URL(config.apiUrl);if(url.protocol!=="https:")throw Error("诊断仅访问配置的HTTPS授权服务器");
  url.pathname=url.pathname.replace(/\/$/,"")+"/health";url.search="";url.hash="";url.username="";url.password="";
  const started=Date.now(),result={checkedAt:new Date().toISOString(),host:url.hostname,timeoutMs:Math.min(30000,Math.max(1000,Number(config.requestTimeoutMs)||10000)),stages:{},ok:false};
  let finished=false;const finish=(error)=>{if(finished)return;finished=true;clearTimeout(deadline);result.totalMs=Date.now()-started;if(error)result.error=error.code||"NETWORK_ERROR";console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;};
  const request=https.get(url,{headers:{Accept:"application/json"}},response=>{
    result.httpStatus=response.statusCode;result.stages.responseMs=Date.now()-started;let raw="";
    response.on("data",chunk=>{raw+=chunk;if(raw.length>65536)request.destroy(Object.assign(Error(),{code:"RESPONSE_TOO_LARGE"}));});
    response.on("error",finish);response.on("end",()=>{try{const body=JSON.parse(raw);result.ok=response.statusCode===200&&body.ok===true&&body.service==="shuzhi-license";result.service=body.service==="shuzhi-license"?body.service:undefined;}catch(_){result.error="INVALID_RESPONSE";}finish();});
  });
  request.on("socket",socket=>{
    socket.on("lookup",error=>{result.stages.dnsMs=Date.now()-started;if(error)result.dnsError=error.code;});
    socket.on("connect",()=>result.stages.tcpMs=Date.now()-started);
    socket.on("secureConnect",()=>{result.stages.tlsMs=Date.now()-started;result.tlsVerified=socket.authorized;});
  });
  request.on("error",finish);
  const deadline=setTimeout(()=>request.destroy(Object.assign(Error(),{code:"PROBE_TIMEOUT"})),result.timeoutMs);
}
try{main();}catch(_){console.error("无法读取授权服务配置，请在完整程序目录中运行诊断脚本。");process.exitCode=1;}
