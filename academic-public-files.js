"use strict";
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const XLSX=require('./assets/xlsx.full.min.js');
if(!isMainThread){(async()=>{
 const bytes=Buffer.from(workerData.bytes);
 if(bytes.length>10*1024*1024)throw Error('文件超过10MB，请分批导入');
 const csv=/\.csv$/i.test(workerData.name),xlsx=/\.xlsx$/i.test(workerData.name);
 if(!csv&&!xlsx)throw Error('仅支持.xlsx和.csv，旧.xls请另存为.xlsx');
 if(xlsx){if(bytes[0]!==80||bytes[1]!==75)throw Error('文件不是有效的.xlsx文件');const zip=await require('./assets/jszip.min.js').loadAsync(bytes);const files=Object.values(zip.files);if(files.length>1000||files.reduce((n,x)=>n+(x._data?.uncompressedSize||0),0)>80*1024*1024)throw Error('文件展开内容过大，请分批导入');}
 let wb;if(csv){const text=new TextDecoder(workerData.encoding==='GB18030'?'gb18030':'utf-8',{fatal:true}).decode(bytes);wb=XLSX.read(text,{type:'string',raw:true});}else wb=XLSX.read(bytes,{type:'buffer',cellDates:true,cellNF:true,sheetStubs:true});
 if(wb.SheetNames.length>30)throw Error('工作表超过30个，请精简文件');
 let total=0;const sheets=wb.SheetNames.map(name=>{
  const sh=wb.Sheets[name];if(!sh['!ref'])return {name,rows:[]};const range=XLSX.utils.decode_range(sh['!ref']);
  if(range.e.r>20050||range.e.c>80)throw Error('工作表超过20,000行或81列限制');total+=(range.e.r+1)*(range.e.c+1);if(total>500000)throw Error('文件单元格过多，请分批导入');
  const rows=[];for(let r=0;r<=range.e.r;r++){const cells=[];for(let c=0;c<=range.e.c;c++){const v=sh[XLSX.utils.encode_cell({r,c})];if(!v){cells.push({value:''});continue;}
   let text=v.v===undefined?'':String(v.v);if(v.v instanceof Date)text=v.v.toISOString().slice(0,10);else if(v.t==='n'&&/^0+$/.test(v.z||''))text=String(v.v).padStart(v.z.length,'0');
   if(text.length>2000)throw Error('单元格文本超过2,000字符');
   cells.push({value:text,numeric:v.t==='n',precisionLost:v.t==='n'&&Math.abs(v.v)>=1e15,formula:!!v.f,missingFormula:!!v.f&&v.v===undefined});
  }rows.push({sourceRow:r+1,cells});}return {name,rows};
 });parentPort.postMessage({sheets});
})().catch(e=>parentPort.postMessage({error:e.message}));}
function parseFile(bytes,name,encoding){return new Promise((resolve,reject)=>{
 const worker=new Worker(__filename,{workerData:{bytes,name,encoding},resourceLimits:{maxOldGenerationSizeMb:192},execArgv:[]});
 const timer=setTimeout(()=>{worker.terminate();reject(Error('文件解析超时，请精简文件并重试'));},20000);
 worker.once('message',result=>{clearTimeout(timer);worker.terminate();result.error?reject(Error(result.error)):resolve(result);});worker.once('error',e=>{clearTimeout(timer);reject(Error('文件无法读取：'+e.message));});worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('文件解析资源不足或内容异常'));});
});}
function workbook(sheets,options={}){const wb=XLSX.utils.book_new();for(const [name,rows] of Object.entries(sheets)){
 const sh=XLSX.utils.aoa_to_sheet(rows);for(const key of Object.keys(sh)){if(key[0]==='!')continue;const c=sh[key];if(c.t==='s'){delete c.f;delete c.l;c.z='@';}}
 const headers=rows[0]||[];sh['!cols']=headers.map(h=>({wch:Math.max([...String(h)].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),3),/触发原因|依据|统计学期|内容/.test(h)?42:/通过情况|课程名称|缺失学期/.test(h)?28:/成绩|学分|人数|门数|序号|绩点/.test(h)?14:20)}));
 if(rows.length>1)sh['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:Math.max(0,headers.length-1)}})};
 for(const column of options.percentColumns?.[name]||[])for(let r=1;r<rows.length;r++){const cell=sh[XLSX.utils.encode_cell({r,c:column})];if(cell?.t==='n')cell.z='0.00%';}
 XLSX.utils.book_append_sheet(wb,sh,name.slice(0,31));}return Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}));}
module.exports={parseFile,workbook};
