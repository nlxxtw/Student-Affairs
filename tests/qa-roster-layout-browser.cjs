'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {withIsolatedWorkbench}=require('./isolated-workbench-helper.cjs');
const deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(deps,'playwright')),{createCanvas}=require(path.join(deps,'@napi-rs/canvas'));
const before=process.argv.includes('--before'),output=path.resolve(__dirname,'../docs',before?'花名册排版-修复前-2026-10-13':'花名册排版-修复后-2026-10-13');
fs.mkdirSync(output,{recursive:true});
function photo(width,height){const c=createCanvas(width,height),ctx=c.getContext('2d');ctx.fillStyle='#18a24b';ctx.fillRect(0,0,width,height);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,width,height/5);ctx.fillStyle='#0000ff';ctx.fillRect(0,height*4/5,width,height/5);return c.toDataURL('image/png');}
withIsolatedWorkbench(async origin=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],problems=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(origin,{waitUntil:'networkidle'});
  const photos=[photo(200,700),photo(700,200)],students=Array.from({length:19},(_,i)=>({id:'20250000'+String(i+1).padStart(4,'0'),name:'合成排版'+String(i+1).padStart(2,'0'),dept:'合成学院',major:'合成专业',grade:'2025',cls:'000001合成班',gender:i%2?'女':'男',ethnic:'汉族',status:'在校',idPhoto:i<2?photos[i]:'',phone:'13800000000',counsel:'合成老师',address:'合成省合成市合成区长字段道路服务中心末端核对'}));
  for(const [key,value] of [['nnuzc_orgs',{depts:[{name:'合成学院'}],majors:[{name:'合成专业',dept:'合成学院'}],classes:[{name:'000001合成班',dept:'合成学院',major:'合成专业',grade:'2025'}]}],['nnuzc_students',students],['nnuzc_custom_roster_v1',{version:2,activeId:'qa-layout',datasets:[{id:'qa-layout',name:'合成排版',state:{version:1,fields:[],rows:students.map((s,i)=>({id:'custom-'+i,values:{...s,studentNo:s.id,photo:s.idPhoto,idcard:'合成证件编号仅用于排版检查'}}))}}]}]]){
   const old=await(await page.request.get(origin+'/api/store/'+key)).json(),res=await page.request.put(origin+'/api/store/'+key,{headers:{Origin:origin},data:{value:JSON.stringify(value),baseValue:old.value??null}});assert(res.ok(),await res.text());
  }
  await page.reload({waitUntil:'networkidle'});
  const pdfjs=await import(pathToFileURL(path.join(deps,'pdfjs-dist/legacy/build/pdf.mjs')).href);
  let standardLayout;
  for(const mode of ['dormRoster','customRoster']){
   const custom=mode==='customRoster';await page.evaluate(view=>window.goto(view),mode);
   await page.evaluate(async custom=>{if(custom){customRosterOutputField('address',true);customRosterOutputField('idcard',true);await customRosterGenerate();}else{dormRosterField('address',true);dormRosterGenerate();}},custom);
   await page.locator('#content .dr-preview .dr-card').first().waitFor();
   const layout=await page.locator('#content .dr-preview').evaluate(n=>({pages:[...n.querySelectorAll('.dr-page')].map(p=>({cards:p.querySelectorAll('.dr-card').length,columns:getComputedStyle(p.querySelector('.dr-grid')).gridTemplateColumns.split(/\s+/).length,lastBottom:p.querySelector('.dr-card:last-child').getBoundingClientRect().bottom,footerTop:p.querySelector('footer').getBoundingClientRect().top})),fit:[...n.querySelectorAll('.dr-photo img')].map(i=>getComputedStyle(i).objectFit),identity:[...n.querySelector('.dr-photo-info').children].map(f=>f.querySelector('b').textContent),detail:[...n.querySelector('.dr-detail').children].map(f=>f.querySelector('b')?.textContent),cardWidth:n.querySelector('.dr-card').getBoundingClientRect().width}));
   if(!custom)standardLayout=layout;
   if(layout.pages.length!==2||layout.pages[0].cards!==18||layout.pages[1]?.cards!==1)problems.push(mode+' expected pagination 18+1: '+JSON.stringify(layout.pages));
   if(layout.pages.some(p=>p.columns!==3||p.lastBottom>p.footerTop))problems.push(mode+' cards exceed shared 3-column page/footer');
   if(layout.fit.some(f=>f!=='contain'))problems.push(mode+' photo crops instead of containing: '+layout.fit);
   if(custom&&JSON.stringify(layout.identity)!==JSON.stringify(standardLayout.identity))problems.push('custom identity differs: '+layout.identity+' vs '+standardLayout.identity);
   if(custom&&!layout.detail.includes('身份证号：'))problems.push('custom idcard should remain in detail column');
   if(!layout.detail.includes('区位：'))problems.push(mode+' blank selected fields lost labels');
   await page.screenshot({path:path.join(output,mode+'-桌面.png'),fullPage:true});
   await page.evaluate(()=>{window.rosterPhotoDraws=[];window.rosterTextDraws=[];const original=CanvasRenderingContext2D.prototype.drawImage,fill=CanvasRenderingContext2D.prototype.fillText,toDataURL=HTMLCanvasElement.prototype.toDataURL;CanvasRenderingContext2D.prototype.drawImage=function(...args){const i=args[0];if(i instanceof HTMLImageElement&&i.src.startsWith('data:image/'))window.rosterPhotoDraws.push({width:i.naturalWidth,height:i.naturalHeight,args:args.slice(1)});return original.apply(this,args);};CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){window.rosterTextDraws.push({text,x,y});return fill.call(this,text,x,y,...rest);};HTMLCanvasElement.prototype.toDataURL=function(...args){if(this.width===2480&&this.height===3508)throw new RangeError('Invalid string length');return toDataURL.apply(this,args);};window.rosterDrawRestore=()=>{CanvasRenderingContext2D.prototype.drawImage=original;CanvasRenderingContext2D.prototype.fillText=fill;HTMLCanvasElement.prototype.toDataURL=toDataURL;};});
   const downloading=page.waitForEvent('download',{timeout:60000});await page.evaluate(custom=>{window.qaRosterPdfPromise=custom?customRosterPdf():dormRosterPdf();},custom);const pdfProgress=page.locator('[data-workbench-progress]');await pdfProgress.waitFor();assert.equal(await pdfProgress.getAttribute('data-state'),'pending',mode+' PDF progress must stay pending while generation is running');const download=await downloading;await page.evaluate(()=>qaRosterPdfPromise);const file=await download.path();assert(file);await pdfProgress.waitFor({state:'detached',timeout:4000});
   const bytes=fs.readFileSync(file);if(bytes.includes(Buffer.from('/DCTDecode')))problems.push(mode+' PDF unexpectedly uses lossy JPEG encoding');const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;if(pdf.numPages!==2)problems.push(mode+' PDF expected 2 pages, got '+pdf.numPages);
   const captured=await page.evaluate(()=>{rosterDrawRestore();return {images:rosterPhotoDraws,texts:rosterTextDraws};});
   if(captured.images.length<2)problems.push(mode+' missing exported photos');
   for(const draw of captured.images){const a=draw.args;if(a.length===8&&(a[0]!==0||a[1]!==0||a[2]!==draw.width||a[3]!==draw.height))problems.push(mode+' PDF crops source photo: '+JSON.stringify(draw));const dw=a.length===8?a[6]:a[2],dh=a.length===8?a[7]:a[3];if(Math.abs(dw/dh-draw.width/draw.height)>.001)problems.push(mode+' PDF distorts photo');if(dw>280.01||dh>315.01)problems.push(mode+' PDF photo exceeds its frame');}
   if(captured.texts.some(t=>t.text.includes('…')))problems.push(mode+' PDF truncates fields with ellipsis');
   const tail=captured.texts.filter(t=>t.text.includes('末端核对'));if(tail.length!==19)problems.push(mode+' PDF lost wrapped field tail: '+tail.length);
   const first=await pdf.getPage(1),viewport=first.getViewport({scale:1}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await first.render({canvasContext:canvas.getContext('2d'),viewport}).promise;fs.writeFileSync(path.join(output,mode+'-PDF第1页.png'),canvas.toBuffer('image/png'));
   const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let red=0,blue=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>210&&pixels[i+1]<60&&pixels[i+2]<60)red++;if(pixels[i]<60&&pixels[i+1]<60&&pixels[i+2]>210)blue++;}if(red<50||blue<50)problems.push(mode+' PDF lost top/bottom photo markers: '+red+'/'+blue);
   await pdf.destroy();
   await page.evaluate(custom=>custom?customRosterPreview():dormRosterPreview(),custom);await page.locator('#mask.show').waitFor();await page.locator('#modalOk').click();assert.equal(await page.locator('#mask').evaluate(n=>n.classList.contains('show')),false);
   for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await page.locator('#content .dr-preview').evaluate(n=>getComputedStyle(n).overflowX==='auto'));}
   await page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(problems,[]);console.log('qa-roster-layout-browser: passed (both previews and actual PDFs, tall/wide photos, 18+1 pagination, identity and blank labels, wrapped fields, modal close, 4 widths)');
 }finally{await browser.close();}
}).catch(e=>{console.error(e);process.exitCode=1;});
