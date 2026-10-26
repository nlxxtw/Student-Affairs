'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'release-output/V5.6.3');
fs.mkdirSync(out,{recursive:true});
async function backup(){
 const origin='http://127.0.0.1:18766';let cookie='';
 async function call(url,body){const response=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,Connection:'close','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();assert(response.ok,result.error||'Request failed');return result;}
 const health=await call('/api/health');assert.equal(health.version,'V5.6.2');
 await call('/api/auth/enter',{});
 const result=await call('/api/backups',{note:'V5.6.3 发布前手动保护备份'});assert(result.id);
 const preflight=await call('/api/backups/'+encodeURIComponent(result.id)+'/preflight');
 fs.writeFileSync(path.join(root,'docs/V5.6.3发布前手动备份.json'),JSON.stringify({created:true,preflightPassed:true,backupId:result.id,sha256:preflight.sha256,attachmentCount:preflight.attachmentCount},null,2));
 console.log('Pre-release backup and preflight passed');
}
function replace(file,from,to){const p=path.join(root,file),s=fs.readFileSync(p,'utf8');assert.equal(s.split(from).length-1,1,file+' requires one version anchor');fs.writeFileSync(p,s.replace(from,to));}
function prepare(){
 const saved=path.join(out,'program-before');assert(!fs.existsSync(saved),'Preparation already exists');fs.mkdirSync(saved);
 for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile()&&/\.(js|css|html)$/.test(e.name))fs.copyFileSync(path.join(root,e.name),path.join(saved,e.name));
 for(const name of ['assets','scripts'])fs.cpSync(path.join(root,name),path.join(saved,name),{recursive:true,filter:src=>!/(^|[\\/])(__pycache__|node_modules)([\\/]|$)/.test(src)});
 for(const name of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md','docs/系统内OSS更新设计与发布说明.md']){const dst=path.join(saved,name);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(root,name),dst);}
 replace('app.js','SYS_VER="V5.6.2"','SYS_VER="V5.6.3"');
 replace('web-server.js','APP_VERSION = "V5.6.2"','APP_VERSION = "V5.6.3"');
 for(const file of ['README.md','docs/开发维护指南.md','docs/项目交接文档.md']){const p=path.join(root,file),lines=fs.readFileSync(p,'utf8').split('\n');for(let i=0;i<lines.length;i++)if(/^# 数智学工 V|^当前版本：|^> 对应版本：|^> 最后核对：/.test(lines[i]))lines[i]=lines[i].replaceAll('V5.6.2','V5.6.3').replace(/2026-10-\d\d/g,'2026-10-25');fs.writeFileSync(p,lines.join('\n'));}
 const notes='全系统统一导航、控件、卡片、表格、分页及弹窗，优化三个主题与窄屏布局，保留原有字号；新增数据中心，支持60类表格模板与原模块导入、52个业务入口加密模块数据包迁移，包含附件、重复处理、依赖确认、保护备份与失败回退；原“学历”统一更名为“培养层次”，保留已有值、自定义值及旧表头兼容；党团员发展新增六个发展日期、发展时间线及党建跟踪表快捷导入，自动映射并核验政治面貌、团籍和有效阶段，原通用导入保留；完善附件引用、跨密钥附件迁移及完整备份恢复的校验和异常回退，修复导入后模型刷新、年月精度与页面布局问题；同步本地网络版适用业务与界面，保留网关登录、账号数据隔离和既有停用功能';
 fs.writeFileSync(path.join(out,'release-notes.txt'),notes);
 fs.writeFileSync(path.join(out,'prepare-record.json'),JSON.stringify({version:'V5.6.3',source:root,programBackup:saved,preparedAt:new Date().toISOString()},null,2));
 const files={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else files[path.relative(root,p).replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}
 for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile()&&/\.(js|css|html|json)$/.test(e.name))files[e.name]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,e.name))).digest('hex');
 walk(path.join(root,'assets'));walk(path.join(root,'scripts'));
 fs.writeFileSync(path.join(out,'source-freeze.json'),JSON.stringify({version:'V5.6.3',frozenAt:new Date().toISOString(),files},null,2));
 console.log('V5.6.3 prepared and runtime source frozen');
}
if(process.argv[2]==='backup')backup().catch(e=>{console.error(e.message);process.exitCode=1;});else if(process.argv[2]==='prepare')prepare();else throw Error('Expected backup or prepare');
