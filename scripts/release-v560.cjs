'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),workspace=path.dirname(root),out=path.join(root,'release-output/V5.6.0');
fs.mkdirSync(out,{recursive:true});
async function backup(){const origin='http://127.0.0.1:18766';let cookie='';async function call(url,body){const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,Connection:'close','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert(response.ok,result.error||'Request failed');return result;}
 const health=await call('/api/health');assert.equal(health.version,'V5.5.9');await call('/api/auth/enter',{});const result=await call('/api/backups',{note:'V5.6.0 发布前手动保护备份'});assert(result.id);const preflight=await call('/api/backups/'+encodeURIComponent(result.id)+'/preflight');fs.writeFileSync(path.join(root,'docs/V5.6.0发布前手动备份.json'),JSON.stringify({created:true,preflightPassed:true,backupId:result.id,sha256:preflight.sha256,attachmentCount:preflight.attachmentCount},null,2));console.log('Pre-release backup and preflight passed');}
function replace(file,from,to){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');assert.equal(s.split(from).length-1,1,file+' requires one version anchor');fs.writeFileSync(p,s.replace(from,to));}
function prepare(){
 const saved=path.join(out,'program-before');assert(!fs.existsSync(saved),'Preparation already exists');fs.mkdirSync(saved);
 for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile()&&/\.(js|css|html)$/.test(e.name))fs.copyFileSync(path.join(root,e.name),path.join(saved,e.name));
 for(const name of ['assets','scripts'])fs.cpSync(path.join(root,name),path.join(saved,name),{recursive:true,filter:src=>!/(^|[\\/])(__pycache__|node_modules)([\\/]|$)/.test(src)});
 for(const name of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md','docs/系统内OSS更新设计与发布说明.md']){const dst=path.join(saved,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(root,name),dst);}
 replace('app.js','SYS_VER="V5.5.9"','SYS_VER="V5.6.0"');replace('web-server.js','APP_VERSION = "V5.5.9"','APP_VERSION = "V5.6.0"');
 for(const file of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md']){const p=path.join(root,file),lines=fs.readFileSync(p,'utf8').split('\n');for(let i=0;i<Math.min(6,lines.length);i++)lines[i]=lines[i].replaceAll('V5.5.9','V5.6.0').replace('2026-10-19','2026-10-20');fs.writeFileSync(p,lines.join('\n'));}
 const stage=path.join(workspace,'网络版同步工作区/V5.6.0'),network=path.resolve(workspace,'../数智学工（网络版）');assert(!fs.existsSync(stage));fs.mkdirSync(stage,{recursive:true});
 for(const e of fs.readdirSync(network,{withFileTypes:true}))if(e.isFile()&&(e.name.endsWith('.md')||['gateway.js','admin.cjs','.dockerignore'].includes(e.name)))fs.copyFileSync(path.join(network,e.name),path.join(stage,e.name));
 for(const name of ['pages','deploy','tests'])fs.cpSync(path.join(network,name),path.join(stage,name),{recursive:true,filter:src=>!/(^|[\\/])(_shots|node_modules|\.sync-qa-|\.gateway-e2e-)/.test(src)});
 const wb=path.join(stage,'workbench');fs.mkdirSync(wb);
 for(const e of fs.readdirSync(path.join(network,'workbench'),{withFileTypes:true})){
  if(e.isFile()&&/\.(js|css|html|json)$/.test(e.name))fs.copyFileSync(path.join(network,'workbench',e.name),path.join(wb,e.name));
  if(e.isDirectory()&&['assets','scripts'].includes(e.name))fs.cpSync(path.join(network,'workbench',e.name),path.join(wb,e.name),{recursive:true});
 }
 for(const file of ['gateway.js','README.md','部署文档.md','部署步骤.md','tests/run-all.cjs','tests/qa-network-v555.cjs','tests/qa-network-v557.cjs','tests/qa-network-v558.cjs']){const p=path.join(stage,file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('V5.5.9','V5.6.0').replaceAll('V5\\.5\\.8','V5\\.5\\.8'));}
 const notes='学生信息新增借读学籍状态，驾驶舱统计同步八类口径，状态页签支持横向滚动；辅导员成长档案新增资格证书成果分类；启动及本机会话失效后统一返回主页；学业情况（公用版）新增使用与操作手册下载入口，随升级包提供手册；单条新增及修订成绩支持绩点自动换算，自定义映射优先，手动修改或清空后保留，并可恢复自动；课程成绩、补考及重修统一使用成绩备注，提供正常考试、缓考、旷考、作弊选项，保留历史状态与旧模板兼容；单条新增四类学业数据免填考试批次，内部按考试日期或学期保留稳定身份，重复校验与历史修订继续有效；同步本地网络版适用业务，保留网关登录、账号隔离及既有停用功能';
 fs.writeFileSync(path.join(out,'release-notes.txt'),notes);fs.writeFileSync(path.join(out,'prepare-record.json'),JSON.stringify({version:'V5.6.0',source:root,stage,programBackup:saved,preparedAt:new Date().toISOString()},null,2));console.log('V5.6.0 and isolated network staging prepared');
}
if(process.argv[2]==='backup')backup().catch(e=>{console.error(e.message);process.exitCode=1;});else if(process.argv[2]==='prepare')prepare();else throw Error('Expected backup or prepare');
