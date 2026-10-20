'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),oldRoot=path.resolve(process.argv[2]||''),output=path.join(root,'docs/交付/V5.5.5');
assert.equal(path.dirname(oldRoot).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase(),'upgrade fixture must be directly inside TEMP');
assert(path.basename(oldRoot).startsWith('shuzhi-upgrade-old-'),'upgrade fixture name required');
const packagePath=path.join(output,'数智学工-V5.5.5-win32-x64.zip');
let oldServer,newPid,cookie='';
const shellEnv={...process.env,PSModulePath:[process.env.PSModulePath,path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/Modules')].filter(Boolean).join(';')};
async function powershell(script,args){
 return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,...args],{cwd:root,env:shellEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);child.once('error',reject);child.once('exit',code=>code===0?resolve(out):reject(Error('PowerShell exit '+code+'\n'+out)));});
}
async function run(){
 const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});shellEnv.XIANGCAI_PORT=String(port);
 const origin='http://127.0.0.1:'+port;
 async function health(version){for(let i=0;i<120;i++){try{const r=await fetch(origin+'/api/health'),j=await r.json();if(r.ok&&j.version===version)return j;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Expected service '+version+' did not start');}
 async function req(url,body,method='POST',type='application/json'){
  const response=await fetch(origin+url,{method:body===undefined?'GET':method,headers:{Origin:origin,Cookie:cookie,'Content-Type':type},body:body===undefined?undefined:type==='application/json'?JSON.stringify(body):body});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];assert(response.ok,url+' HTTP '+response.status+' '+(!response.ok?await response.text():''));return response;
 }
 oldServer=spawn(process.execPath,[path.join(oldRoot,'web-server.js')],{cwd:oldRoot,env:shellEnv,windowsHide:true,stdio:'ignore'});await health('V5.5.4');await req('/api/auth/enter',{});
 const write=(key,value)=>req('/api/store/'+key,{value:JSON.stringify(value)},'PUT');
 await write('nnuzc_orgs',{depts:[{name:'升级学院',code:'UP'}],majors:[{name:'升级专业',code:'UP01',dept:'升级学院'}],classes:[{name:'升级班',dept:'升级学院',major:'升级专业',grade:'2026'}]});
 await write('nnuzc_term_list',['2026-2027-1学期']);await write('nnuzc_current_term','2026-2027-1学期');
 await write('nnuzc_students',[{id:'20260001',name:'升级验证学生',dept:'升级学院',major:'升级专业',cls:'升级班',grade:'2026',status:'在校',phone:'13800000001'}]);
 await write('nnuzc_talks',[{id:'upgrade-talk',sid:'20260001',name:'升级验证学生',term:'2026-2027-1学期',date:'2026-10-11',type:'日常',note:'必须保留的旧记录'}]);
 const proof=Buffer.from('升级附件保留验证');const attachment=await (await req('/api/attachments?name=upgrade-proof.txt',proof,'POST','application/octet-stream')).json();
 const notes='修复首次新增业务数据的并发保存冲突；通用弹窗等待保存确认，失败保留草稿并防止重复新增，完善分层关闭；统一查询区排版、选择提示与表格滚动，适配窄屏和键盘操作；新增数据库事务版本迁移与读取索引；升级包补齐学业样式与公共模块，安装脚本执行前校验完整性';
 console.log(await powershell(path.join(root,'scripts/build-update-package.ps1'),['-Version','V5.5.5','-PreviousVersion','V5.5.4','-OssObjectKey','releases/V5.5.5/shuzhi-workbench-win32-x64.zip','-ReleaseNotes',notes,'-OutputDirectory',output,'-SocialOutputRoot',path.join(root,'docs/交付/宣传材料'),'-SocialOrigin',origin]));
 // The screenshot opens the old UI, which fills legacy optional fields. Capture
 // the actual persisted old-version baseline after that normal initialization.
 const before=await (await req('/api/store')).json();
 assert.deepEqual(Buffer.from(await (await req(attachment.url||'/attachments/'+attachment.id)).arrayBuffer()),proof);
 // Package verification uses the production public key. The fixture credential
 // remains intact but cannot authorize downloads with that unrelated key; verify
 // the encrypted attachment files and portable key directly after installation.
 const retainedPaths=['data/portable-data-key.json','data/license-state.json',...fs.readdirSync(path.join(oldRoot,'data/attachments')).map(name=>'data/attachments/'+name)];
 const retainedFiles=new Map(retainedPaths.map(name=>[name,fs.readFileSync(path.join(oldRoot,name))]));
 const sql=new DatabaseSync(path.join(oldRoot,'data/workbench.db'),{readOnly:true});const encrypted=sql.prepare('SELECT student_id,name,data_json FROM students').all();assert.equal(sql.prepare('PRAGMA user_version').get().user_version,0);sql.close();
 const manifest=JSON.parse(fs.readFileSync(path.join(output,'current.json'),'utf8'));const hash=crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');assert.equal(manifest.releases[0].sha256,hash);
 const Zip=require(path.join(root,'assets/jszip.min.js')),archive=await Zip.loadAsync(fs.readFileSync(packagePath));const names=Object.keys(archive.files);assert(!names.some(n=>/(^|\/)(data|backups|runtime|deployment-secrets)(\/|\.)/i.test(n)));
 for(const name of ['workbench-database.js','academic-public.css','assets/workbench-ui.js','assets/workbench-ui.css','scripts/update-bootstrap.ps1'])assert(names.includes(name),name+' must ship');
 console.log(await powershell(path.join(root,'scripts/update-bootstrap.ps1'),['-Root',oldRoot,'-Package',packagePath,'-ExpectedSha256',hash,'-ExpectedVersion','V5.5.5','-ParentProcessId',String(oldServer.pid)]));
 const installed=await health('V5.5.5');newPid=installed.pid;assert.notEqual(newPid,oldServer.pid);cookie='';await req('/api/auth/enter',{});
 const after=await (await req('/api/store')).json();for(const key of ['nnuzc_students','nnuzc_talks','nnuzc_orgs','nnuzc_term_list'])assert.deepEqual(JSON.parse(after[key]),JSON.parse(before[key]),key+' must survive upgrade');assert.equal(after.nnuzc_current_term,before.nnuzc_current_term,'current term must survive upgrade');
 for(const [name,bytes] of retainedFiles)assert.deepEqual(fs.readFileSync(path.join(oldRoot,name)),bytes,'retained data bytes: '+name);
 for(const name of names){const entry=archive.files[name];if(entry.dir)continue;assert.deepEqual(fs.readFileSync(path.join(oldRoot,name)),await entry.async('nodebuffer'),'installed bytes: '+name);}
 const db=new DatabaseSync(path.join(oldRoot,'data/workbench.db'),{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);assert.deepEqual(db.prepare('SELECT student_id,name,data_json FROM students').all(),encrypted,'migration must preserve exact encryption and stable IDs');assert.equal(db.prepare('SELECT COUNT(*) n FROM workbench_schema_migrations').get().n,2);db.close();
 const progress=JSON.parse(fs.readFileSync(path.join(oldRoot,'data/updates/install-progress.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(progress.phase,'completed');assert.equal(progress.percent,100);
 console.log('local real-package upgrade: passed (V5.5.4 encrypted DB -> V5.5.5, package whitelist/hash/bytes, actual installer restart, data and attachment retention, schema 0 -> 2)');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 if(newPid){try{process.kill(newPid);}catch{}}
 if(oldServer&&oldServer.exitCode===null){try{oldServer.kill();}catch{}}
 await new Promise(r=>setTimeout(r,500));
 // A failed fixture is retained for diagnostics. Never remove any project directory.
 if(process.exitCode)console.error('Retained isolated upgrade fixture: '+oldRoot);
 else fs.rmSync(oldRoot,{recursive:true,force:true,maxRetries:5,retryDelay:200});
});
