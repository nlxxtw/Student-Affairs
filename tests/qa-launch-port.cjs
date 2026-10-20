'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'shuzhi-launch-port-'));
try{
 for(const [name,marker] of [['start-workbench.ps1','$url ='],['stop-workbench.ps1','$pidFile =']]){
  const source=fs.readFileSync(path.join(root,'scripts',name),'utf8'),end=source.indexOf(marker);assert(end>0);
  // Execute only port selection; never start or stop a real service in this test.
  const fixture=path.join(temp,name);fs.writeFileSync(fixture,source.slice(0,end)+'\nWrite-Output $port','utf8');
  const run=value=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fixture],{env:{...process.env,XIANGCAI_PORT:value},windowsHide:true,encoding:'utf8'});
  const custom=run('43110');assert.equal(custom.status,0);assert.equal(custom.stdout.trim(),'43110',name+' must target the same configured port as the server');
  assert.equal(run('').stdout.trim(),'18766');assert.notEqual(run('invalid').status,0);assert.notEqual(run('65536').status,0);assert.notEqual(run('0').status,0);
 }
 const stop=fs.readFileSync(path.join(root,'scripts/stop-workbench.ps1'),'utf8'),begin=stop.indexOf('function Test-WorkbenchProcess('),end=stop.indexOf('\nforeach ($processId',begin);assert(begin>=0&&end>begin);
 const probe=`$service='C:\\owned workspace\\[main]\\web-server.js'
 $port=18766
 function Get-CimInstance { param($Filter,$ErrorAction) return $script:fakeProcess }
 function Invoke-RestMethod { return @{ service='xiangcai-workbench' } }
 function Invoke-WebRequest { return @{ Content='api/auth/login' } }
 ${stop.slice(begin,end)}
 $cases=@(
 @{Name='node.exe';CommandLine='"C:\\runtime\\node.exe" "C:\\owned workspace\\[main]\\web-server.js"'},
 @{Name='node.exe';CommandLine='"C:\\runtime\\node.exe" "C:\\another workspace\\web-server.js"'},
 @{Name='node.exe';CommandLine='"C:\\runtime\\node.exe" "C:\\owned workspace\\[main]\\web-server.js.backup"'},
 @{Name='node.exe';CommandLine='"C:\\runtime\\node.exe" -e "console.log(1)"'},
 @{Name='notepad.exe';CommandLine='"C:\\runtime\\notepad.exe" "C:\\owned workspace\\[main]\\web-server.js"'},
 @{Name='node.exe';CommandLine=$null})
 $results=@();foreach($case in $cases){$script:fakeProcess=$case;$results+=Test-WorkbenchProcess 99999};ConvertTo-Json -Compress -InputObject $results`;
 const ownership=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(probe,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
 assert.equal(ownership.status,0,ownership.stderr);assert.deepEqual(JSON.parse(ownership.stdout),[true,false,false,false,false,false],'stale PID/another copy/unrelated Node must not be stopped even if a workbench responds on the target port');
 console.log('launch port and process ownership: passed (ports, invalid input, exact quoted service path, wildcard characters, unrelated apps and stale PID; no real process stopped)');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
