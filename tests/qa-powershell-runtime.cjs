'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const folder=path.join(__dirname,'../scripts'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'shuzhi-ps-parser-'));
try{
 const scripts=['build-update-package.ps1','install-workbench-update.ps1','update-bootstrap.ps1','start-update-bootstrap.ps1','recover-interrupted-update.ps1','start-workbench.ps1','stop-workbench.ps1','generate-academic-warning.ps1','validate-academic-warning-template.ps1'];
 const runner=path.join(temp,'parse.ps1');fs.writeFileSync(runner,'$ErrorActionPreference="Stop"\nforeach($file in $args){$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors);if($errors.Count){throw ($file+": "+($errors|Out-String))}}\nWrite-Output "Windows PowerShell parser: passed"');
 const files=[...scripts.map(n=>path.join(folder,n)),...fs.readdirSync(__dirname).filter(n=>n.endsWith('.ps1')).map(n=>path.join(__dirname,n))];
 const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',runner,...files],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);console.log(result.stdout.trim());
}finally{fs.rmSync(temp,{recursive:true,force:true});}
