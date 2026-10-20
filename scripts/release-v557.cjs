'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),workspace=path.dirname(root),out=path.join(root,'release-output','V5.5.7');
fs.mkdirSync(out,{recursive:true});
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
async function backup(){const origin='http://127.0.0.1:18766';let cookie='';async function call(url,body){const r=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,Connection:'close','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const j=await r.json();assert(r.ok,j.error||'Request failed');return j;}
 const health=await call('/api/health');assert.equal(health.version,'V5.5.6');await call('/api/auth/enter',{});const b=await call('/api/backups',{note:'V5.5.7 发布前手动保护备份'});assert(b.id);const preflight=await call('/api/backups/'+encodeURIComponent(b.id)+'/preflight');fs.writeFileSync(path.join(root,'docs/V5.5.7发布前手动备份.json'),JSON.stringify({created:true,preflightPassed:true,backupId:b.id,sha256:preflight.sha256,attachmentCount:preflight.attachmentCount},null,2));console.log('Pre-release manual backup and preflight passed');}
function replace(file,from,to){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');assert(s.includes(from),'Missing version anchor '+file);fs.writeFileSync(p,s.replaceAll(from,to));}
function prepare(){
 const saved=path.join(out,'program-before');assert(!fs.existsSync(saved),'Already prepared; inspect saved state');fs.mkdirSync(saved);
 for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/\.(js|css|html)$/.test(entry.name))fs.copyFileSync(path.join(root,entry.name),path.join(saved,entry.name));
 for(const name of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md','docs/系统内OSS更新设计与发布说明.md']){const dst=path.join(saved,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(root,name),dst);}
 replace('app.js','SYS_VER="V5.5.6"','SYS_VER="V5.5.7"');replace('web-server.js','APP_VERSION = "V5.5.6"','APP_VERSION = "V5.5.7"');
 for(const name of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md']){const p=path.join(root,name),s=fs.readFileSync(p,'utf8');let lines=s.split('\n');lines=lines.map((line,index)=>index<10?line.replaceAll('V5.5.6','V5.5.7'):line);fs.writeFileSync(p,lines.join('\n'));}
 const stage=path.join(workspace,'网络版同步工作区/V5.5.7'),network=path.resolve(workspace,'../数智学工（网络版）');assert(!fs.existsSync(stage));fs.mkdirSync(stage,{recursive:true});
 for(const entry of fs.readdirSync(network,{withFileTypes:true})){
  if(entry.isFile()&&(entry.name.endsWith('.md')||['gateway.js','admin.cjs','.dockerignore'].includes(entry.name)))fs.copyFileSync(path.join(network,entry.name),path.join(stage,entry.name));
 }
 for(const name of ['pages','deploy','tests'])fs.cpSync(path.join(network,name),path.join(stage,name),{recursive:true,filter:source=>!/(^|[\\/])(_shots|node_modules|\.sync-qa-|\.gateway-e2e-)/.test(source)});
 const wb=path.join(stage,'workbench');fs.mkdirSync(wb);
 for(const e of fs.readdirSync(path.join(network,'workbench'),{withFileTypes:true})){
  if(e.isFile()&&/\.(?:js|css|html|json)$/.test(e.name))fs.copyFileSync(path.join(network,'workbench',e.name),path.join(wb,e.name));
  if(e.isDirectory()&&['assets','scripts'].includes(e.name))fs.cpSync(path.join(network,'workbench',e.name),path.join(wb,e.name),{recursive:true});
 }
 for(const file of ['tests/sync-from-single.cjs','tests/qa-sync-from-single.cjs']){const p=path.join(stage,file),s=fs.readFileSync(p,'utf8');assert(s.includes('"academic-public-engine.js", "academic-public-files.js"'));fs.writeFileSync(p,s.replace('"academic-public-engine.js", "academic-public-files.js"','"academic-public-engine.js", "academic-public-exams.js", "academic-public-files.js"'));}
 for(const file of ['gateway.js','README.md','部署文档.md','部署步骤.md','tests/run-all.cjs']){const p=path.join(stage,file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('V5.5.6','V5.5.7'));}
 const notes='学业情况（公用版）完善教务分项成绩、项目考证与材料记录，强化导入修订、历史回导及异常数据核查；学业预警仅按未通过门数和学分等规则计算，与绩点、考证结论分离；修复基础数据、就业跟踪、综测及学生组织第二课堂的全选与半选联动；优化宿舍批量导入及资源重复行提示，资助与成长档案导入集中保存，完善异步导入防重复提交和失败重试；同步本地网络版共享业务与新增依赖，保留账号数据隔离及停用功能边界';
 fs.writeFileSync(path.join(out,'release-notes.txt'),notes);fs.writeFileSync(path.join(out,'prepare-record.json'),JSON.stringify({version:'V5.5.7',stage,source:root,programBackup:saved,preparedAt:new Date().toISOString()},null,2));console.log('V5.5.7 versions and isolated network stage prepared');
}
if(process.argv[2]==='backup')backup().catch(e=>{console.error(e.message);process.exitCode=1;});else if(process.argv[2]==='prepare')prepare();else throw Error('Expected backup or prepare');
