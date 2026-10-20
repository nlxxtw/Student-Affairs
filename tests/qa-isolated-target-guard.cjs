"use strict";
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
(async()=>{
 for(const [file,start,end,name]of[["qa-imports.cjs","async function ready()","async function store(","ready"],["qa-integration.cjs","async function waitForServer()","async function stopServer()","waitForServer"]]){
  const source=fs.readFileSync(path.join(__dirname,file),"utf8"),a=source.indexOf(start),b=source.indexOf(end,a+1);assert(a>=0&&b>a);
  const health={ok:true,service:"xiangcai-workbench",pid:2002};
  const ctx={origin:"http://isolated.test",child:{pid:1001,exitCode:1},childDiagnostics:"synthetic isolated server exit",sleep:async()=>{},delay:async()=>{},fetch:async()=>({ok:true,json:async()=>health}),request:async()=>({response:{ok:true},body:health})};
  vm.createContext(ctx);vm.runInContext(source.slice(a,b),ctx);
  await assert.rejects(ctx[name](),/exited|start/i,file+" must reject another service on the same port before any mutation");
  console.log("PASS isolated target PID ownership: "+file);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
