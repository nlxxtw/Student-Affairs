'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const {Readable,Transform}=require('node:stream'),{finished,pipeline}=require('node:stream/promises');
const source=fs.readFileSync(path.resolve(__dirname,'../web-server.js'),'utf8');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'shuzhi-webdav-resource-'));
function section(start,end){const a=source.indexOf('async function '+start+'(')>=0?source.indexOf('async function '+start+'('):source.indexOf('function '+start+'(');const b=source.indexOf('\n'+end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const box={fs,path,crypto,Buffer,Readable,Transform,finished,pipeline,WEBDAV_TEMP_DIR:temp,WEBDAV_MAX_BUNDLE_BYTES:1024,WEBDAV_BUNDLE_MAGIC:Buffer.from('SZWD'),WEBDAV_BUNDLE_VERSION:1,httpError:(statusCode,message)=>Object.assign(Error(message),{statusCode}),webdavRemoteUrl:()=>new URL('https://synthetic.invalid/backup.szwd'),writeToStream:async(w,b)=>{if(!w.write(b))await require('node:events').once(w,'drain');}};
vm.createContext(box);vm.runInContext(section('downloadWebdavBundle','function readWebdavBundleHeader(')+section('readWebdavBundleHeader','async function extractWebdavBundle(')+section('extractWebdavBundle','async function restoreWebdavBackup('),box);
const failures=[];
(async()=>{try{
 for(const length of [undefined,'1']){
  let produced=0,cancelled=false;
  box.webdavFetch=async()=>({status:200,ok:true,headers:{get:()=>length},body:new ReadableStream({pull(c){if(produced===10)c.close();else{produced++;c.enqueue(new Uint8Array(512*1024));}},cancel(){cancelled=true;}})});
  await assert.rejects(box.downloadWebdavBundle({}),e=>e.statusCode===413);
  if(produced>=10||!cancelled)failures.push('unbounded stream consumed entire oversized body, Content-Length='+length);
  assert.equal(fs.readdirSync(temp).length,0,'oversized partial files must be removed');
 }
 const base={version:1,kdf:{name:'scrypt',N:32768,r:8,p:1,salt:Buffer.alloc(16,1).toString('base64')},iv:Buffer.alloc(12,2).toString('base64'),files:[{name:'workbench.db',size:12,sha256:crypto.createHash('sha256').update('synthetic-db').digest('hex')}]};
 const file=path.join(temp,'header.szwd');
 const write=header=>{const bytes=Buffer.from(JSON.stringify(header)),n=Buffer.alloc(4);n.writeUInt32LE(bytes.length);fs.writeFileSync(file,Buffer.concat([Buffer.from('SZWD'),n,bytes,Buffer.alloc(40)]));};
 write(base);assert.equal(box.readWebdavBundleHeader(file).header.kdf.N,32768);
 for(const patch of [{N:2},{N:32768,p:65536},{r:1},{p:0},{N:'32768'},{salt:'bad'}, {salt:Buffer.alloc(64).toString('base64')}]){
  write({...base,kdf:{...base.kdf,...patch}});try{box.readWebdavBundleHeader(file);failures.push('untrusted KDF accepted: '+JSON.stringify(patch));}catch(e){assert.equal(e.statusCode,400);}
 }
 for(const iv of ['',Buffer.alloc(8).toString('base64'),'not-base64']){write({...base,iv});try{box.readWebdavBundleHeader(file);failures.push('invalid IV accepted');}catch(e){assert.equal(e.statusCode,400);}}
 assert.deepEqual(failures,[],'resource bounds must apply before writing the complete body or deriving a key');
 // Verify the existing v1 encryption format still extracts correctly.
 const password='synthetic-password-only',key=crypto.scryptSync(password,Buffer.from(base.kdf.salt,'base64'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 const cipher=crypto.createCipheriv('aes-256-gcm',key,Buffer.from(base.iv,'base64')),bytes=Buffer.from(JSON.stringify(base)),n=Buffer.alloc(4);n.writeUInt32LE(bytes.length);
 fs.writeFileSync(file,Buffer.concat([Buffer.from('SZWD'),n,bytes,cipher.update('synthetic-db'),cipher.final(),cipher.getAuthTag()]));
 const result=await box.extractWebdavBundle(file,password);assert.equal(fs.readFileSync(path.join(result.destination,'workbench.db'),'utf8'),'synthetic-db');
 console.log('WebDAV bounds: missing/false lengths abort oversized streams early, partial files removed, hostile KDF/salt/IV rejected, valid v1 encrypted extraction retained');
 }finally{const resolved=path.resolve(temp);assert(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('shuzhi-webdav-resource-'));fs.rmSync(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
