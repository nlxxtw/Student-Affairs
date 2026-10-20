'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),root=path.resolve(__dirname,'..');
const browser=process.argv.includes('--browser');
const files=fs.readdirSync(__dirname).filter(name=>/^qa-academic-public.*\.cjs$/.test(name)&&name!=='qa-academic-public-manual-browser.cjs'&&(name.includes('browser')||name.includes('ui-boundaries'))===browser);
if(!browser)files.push('qa-static.cjs','qa-ui-contract.cjs','qa-demo-data.cjs');
for(const file of files){console.log('\n[RUN] '+file);const r=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:root,stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status||1);}
console.log('\nAcademic manual regression passed ('+files.length+' groups).');
