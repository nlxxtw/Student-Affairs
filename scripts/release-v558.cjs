'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),workspace=path.dirname(root),out=path.join(root,'release-output/V5.5.8');
fs.mkdirSync(out,{recursive:true});
async function backup(){const origin='http://127.0.0.1:18766';let cookie='';async function call(url,body){const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,Connection:'close','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert(response.ok,result.error||'Request failed');return result;}
 const health=await call('/api/health');assert.equal(health.version,'V5.5.7');await call('/api/auth/enter',{});const result=await call('/api/backups',{note:'V5.5.8 发布前手动保护备份'});assert(result.id);const preflight=await call('/api/backups/'+encodeURIComponent(result.id)+'/preflight');fs.writeFileSync(path.join(root,'docs/V5.5.8发布前手动备份.json'),JSON.stringify({created:true,preflightPassed:true,backupId:result.id,sha256:preflight.sha256,attachmentCount:preflight.attachmentCount},null,2));console.log('Pre-release backup and preflight passed');}
function replace(file,from,to){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');assert.equal(s.split(from).length-1,1,file+' requires one version anchor');fs.writeFileSync(p,s.replace(from,to));}
function prepare(){
 const saved=path.join(out,'program-before');assert(!fs.existsSync(saved),'Preparation already exists');fs.mkdirSync(saved);
 for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile()&&/\.(js|css|html)$/.test(e.name))fs.copyFileSync(path.join(root,e.name),path.join(saved,e.name));
 for(const name of ['assets','scripts'])fs.cpSync(path.join(root,name),path.join(saved,name),{recursive:true,filter:src=>!/(^|[\\/])(__pycache__|node_modules)([\\/]|$)/.test(src)});
 for(const name of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md','docs/系统内OSS更新设计与发布说明.md']){const dst=path.join(saved,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(root,name),dst);}
 replace('app.js','SYS_VER="V5.5.7"','SYS_VER="V5.5.8"');replace('web-server.js','APP_VERSION = "V5.5.7"','APP_VERSION = "V5.5.8"');
 for(const file of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md']){const p=path.join(root,file),lines=fs.readFileSync(p,'utf8').split('\n');for(let i=0;i<Math.min(7,lines.length);i++)lines[i]=lines[i].replaceAll('V5.5.7','V5.5.8').replace('2026-10-17','2026-10-18');fs.writeFileSync(p,lines.join('\n'));}
 const stage=path.join(workspace,'网络版同步工作区/V5.5.8'),network=path.resolve(workspace,'../数智学工（网络版）');assert(!fs.existsSync(stage));fs.mkdirSync(stage,{recursive:true});
 for(const e of fs.readdirSync(network,{withFileTypes:true}))if(e.isFile()&&(e.name.endsWith('.md')||['gateway.js','.dockerignore'].includes(e.name)))fs.copyFileSync(path.join(network,e.name),path.join(stage,e.name));
 for(const name of ['pages','deploy','tests'])fs.cpSync(path.join(network,name),path.join(stage,name),{recursive:true,filter:src=>!/(^|[\\/])(_shots|node_modules|\.sync-qa-|\.gateway-e2e-)/.test(src)});
 const wb=path.join(stage,'workbench');fs.mkdirSync(wb);
 for(const e of fs.readdirSync(path.join(network,'workbench'),{withFileTypes:true})){
  if(e.isFile()&&/\.(js|css|html|json)$/.test(e.name))fs.copyFileSync(path.join(network,'workbench',e.name),path.join(wb,e.name));
  if(e.isDirectory()&&['assets','scripts'].includes(e.name))fs.cpSync(path.join(network,'workbench',e.name),path.join(wb,e.name),{recursive:true});
 }
 for(const file of ['gateway.js','README.md','部署文档.md','部署步骤.md','tests/run-all.cjs','tests/qa-network-v555.cjs','tests/qa-network-v557.cjs']){const p=path.join(stage,file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('V5.5.7','V5.5.8').replaceAll('V5\\.5\\.7','V5\\.5\\.8'));}
 const notes='完善数据导入进度与保存确认：修复学生导入重复提交和迟到回调覆盖新表单，取消大批量校验逐行固定等待；修复CSV引号内换行和异常引号识别、XLS数值解码及损坏文件边界检查；优化Word模板校验与Word/PDF/HTML导出，模板操作和生成共用有上限的串行队列，完善异常清理与模板提交失败回退，关闭模板宏和自动外链更新，加强在线Word编辑隔离；同步本地网络版共享业务及适用的平台兼容分支，保留账号数据隔离与既有停用功能';
 fs.writeFileSync(path.join(out,'release-notes.txt'),notes);fs.writeFileSync(path.join(out,'prepare-record.json'),JSON.stringify({version:'V5.5.8',source:root,stage,programBackup:saved,preparedAt:new Date().toISOString()},null,2));console.log('V5.5.8 and isolated network staging prepared');
}
if(process.argv[2]==='backup')backup().catch(e=>{console.error(e.message);process.exitCode=1;});else if(process.argv[2]==='prepare')prepare();else throw Error('Expected backup or prepare');
