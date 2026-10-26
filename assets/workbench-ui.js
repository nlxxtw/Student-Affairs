(function(root){
 'use strict';
 let dialog=null;
 let progressSequence=0;
 function progressHost(){let host=root.document.getElementById('workbenchProgressHost');if(!host){host=root.document.createElement('div');host.id='workbenchProgressHost';host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:10020;display:flex;flex-direction:column;gap:8px;width:min(340px,calc(100vw - 36px));pointer-events:none';root.document.body.appendChild(host);}return host;}
 function progressStyles(){if(root.document.getElementById('workbenchProgressStyles'))return;const style=root.document.createElement('style');style.id='workbenchProgressStyles';style.textContent='@keyframes workbench-progress-slide{0%{transform:translateX(-110%)}100%{transform:translateX(300%)}}[data-workbench-progress]{pointer-events:auto;background:#fff;color:#17334d;border:1px solid #bad4ec;border-radius:10px;box-shadow:0 8px 24px rgba(24,69,108,.2);padding:12px 14px}[data-workbench-progress][data-state="error"]{border-color:#e9aaa5}[data-workbench-progress] .wbp-head{display:flex;align-items:center;gap:10px;font-size:13px}[data-workbench-progress] .wbp-head strong{flex:1}[data-workbench-progress] .wbp-close{border:0;background:transparent;color:#557089;font-size:18px;line-height:1;cursor:pointer;padding:0 2px}[data-workbench-progress] .wbp-track{height:8px;margin-top:9px;overflow:hidden;border-radius:999px;background:#dfeaf3}[data-workbench-progress] .wbp-fill{height:100%;width:28%;border-radius:inherit;background:#2278d4;transition:width .25s ease}[data-workbench-progress][data-state="pending"] .wbp-fill[data-indeterminate="true"]{animation:workbench-progress-slide 1.15s ease-in-out infinite}[data-workbench-progress][data-state="success"] .wbp-fill{background:#15945f}[data-workbench-progress][data-state="error"] .wbp-fill{background:#cf5148}[data-workbench-progress] .wbp-message{margin-top:8px;color:#557089;font-size:12.5px;line-height:1.45}';root.document.head.appendChild(style);}
 function syncToastOffset(){const toast=root.document.getElementById('toastHost'),host=root.document.getElementById('workbenchProgressHost');if(!toast)return;const height=host&&host.children.length?host.getBoundingClientRect().height:0;toast.style.bottom=(height?height+28:18)+'px';}
 function beginProgress(options={}){progressStyles();const host=progressHost(),panel=root.document.createElement('section'),id='workbench-progress-'+(++progressSequence),title=root.document.createElement('strong'),close=root.document.createElement('button'),track=root.document.createElement('div'),fill=root.document.createElement('div'),message=root.document.createElement('div');panel.dataset.workbenchProgress=id;panel.dataset.state='pending';panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');const head=root.document.createElement('div');head.className='wbp-head';title.textContent=options.title||'正在处理';close.type='button';close.className='wbp-close';close.setAttribute('aria-label','关闭');close.textContent='×';close.hidden=true;head.append(title,close);track.className='wbp-track';fill.className='wbp-fill';fill.dataset.indeterminate='true';fill.setAttribute('role','progressbar');fill.setAttribute('aria-label',options.title||'处理进度');fill.setAttribute('aria-valuemin','0');fill.setAttribute('aria-valuemax','100');track.appendChild(fill);message.className='wbp-message';message.textContent=options.message||'正在处理，请勿关闭页面…';panel.append(head,track,message);host.appendChild(panel);syncToastOffset();let settled=false,timer=null;
  function remove(){if(timer)root.clearTimeout(timer);if(panel.parentNode)panel.parentNode.removeChild(panel);if(!host.children.length&&host.parentNode)host.parentNode.removeChild(host);syncToastOffset();}
  function update(percent,text){if(settled)return;if(Number.isFinite(Number(percent))){const value=Math.max(0,Math.min(100,Number(percent)));fill.dataset.indeterminate='false';fill.style.width=value+'%';fill.setAttribute('aria-valuenow',String(Math.round(value)));}else{fill.dataset.indeterminate='true';fill.style.width='28%';fill.removeAttribute('aria-valuenow');}if(text)message.textContent=text;syncToastOffset();}
  close.onclick=remove;
  return {id,panel,update,succeed(text){if(settled)return;settled=true;panel.dataset.state='success';fill.dataset.indeterminate='false';fill.style.width='100%';fill.setAttribute('aria-valuenow','100');message.textContent=text||'处理完成';timer=root.setTimeout(remove,900);},fail(text){if(settled)return;settled=true;panel.dataset.state='error';fill.dataset.indeterminate='false';fill.style.width='100%';fill.setAttribute('aria-valuenow','100');message.textContent=text||'处理失败';close.hidden=false;syncToastOffset();},cancel(){settled=true;remove();},remove,isActive(){return !!panel.parentNode&&!settled;}};
 }
 root.WorkbenchProgress={begin:beginProgress,syncToastOffset};
 function begin(){dialog={busy:false,closeRequested:false,toasts:[],callbackDone:false,result:undefined};return dialog;}
 function requestClose(force){if(dialog?.busy&&!force){dialog.closeRequested=true;return false;}dialog=null;return true;}
 function deferToast(message,type){if(dialog?.busy&&['success','ok'].includes(type)){dialog.toasts.push([message,type]);return true;}return false;}
 function error(message){const body=root.document.getElementById('modalBody');if(!body)return;let node=body.querySelector('[data-modal-save-error]');if(!node){node=root.document.createElement('div');node.dataset.modalSaveError='';node.className='workbench-form-error';node.setAttribute('role','alert');body.prepend(node);}node.textContent=message||'保存未完成，表单内容已保留。';node.hidden=false;}
 async function save(button,onOk){
  const session=dialog;if(!session||session.busy)return;
  const modalTitle=String(root.document.getElementById('modalTitle')?.textContent||'').trim(),importProgress=/导入/.test(modalTitle)?beginProgress({title:modalTitle||'数据导入',message:'正在读取、校验并保存，请勿关闭页面…'}):null;
  session.busy=true;if(!session.callbackDone)session.closeRequested=false;button.disabled=true;button.setAttribute('aria-busy','true');
  const notice=root.document.querySelector('[data-modal-save-error]');if(notice)notice.hidden=true;
  try{
   if(!session.callbackDone){
    if(root.workbench?.legacy?.flushStore)await root.workbench.legacy.flushStore();
    if(dialog!==session)return;
    session.result=onOk?await onOk():true;session.callbackDone=true;
   }
   if(importProgress)importProgress.update(85,'正在确认数据已经完整保存…');
   if(root.workbench?.legacy?.flushStore)await root.workbench.legacy.flushStore();
   if(session.result===false){if(importProgress)importProgress.cancel();}else if(importProgress)importProgress.succeed('导入完成');
   session.busy=false;
   if(dialog===session){session.toasts.forEach(([message,type])=>root.showToast(message,type));session.toasts=[];if(session.closeRequested||session.result!==false)root.closeModal(true);else{session.callbackDone=false;session.locked?.forEach(node=>node.disabled=false);session.locked=[];}}
  }catch(reason){
   if(importProgress)importProgress.fail('导入失败：'+(reason?.message||String(reason)));
   if(!session.callbackDone)session.toasts=[];
   if(dialog===session){
    if(session.callbackDone){session.locked=session.locked||Array.from(root.document.querySelectorAll('#modalBody input:not(:disabled),#modalBody select:not(:disabled),#modalBody textarea:not(:disabled)'));session.locked.forEach(node=>node.disabled=true);}
    error((reason?.message||String(reason))+'\n尚未确认保存，当前内容已保留；请处理保存状态提示后重试。');
   }
  }finally{session.busy=false;if(dialog===session){button.disabled=false;button.removeAttribute('aria-busy');}}
 }
 function resume(){if(!dialog||dialog.busy)return;dialog.callbackDone=false;dialog.closeRequested=false;dialog.toasts=[];dialog.locked?.forEach(node=>node.disabled=false);dialog.locked=[];}
 let fieldSequence=0,scheduled=false;
 function enhance(scope){
  scope.querySelectorAll('.qitem,.filter-item,.field').forEach(field=>{
   const label=field.querySelector('label'),control=field.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea');
   if(label&&control&&!label.control){if(!control.id)control.id='workbench-field-'+(++fieldSequence);label.htmlFor=control.id;}
  });
  scope.querySelectorAll('.table-scroll,.table-wrap,.module-table-wrap,.list-scroll,.ap-scroll,.ap-preview,.si-class-table-wrap').forEach(node=>{
   if(!node.querySelector('table')||!/(auto|scroll)/.test(root.getComputedStyle(node).overflowX))return;
   node.classList.add('workbench-table-scroll');node.dataset.workbenchScroll='';
   if(!node.hasAttribute('tabindex'))node.tabIndex=0;
   if(!node.hasAttribute('role'))node.setAttribute('role','region');
   if(!node.hasAttribute('aria-label')&&!node.hasAttribute('aria-labelledby'))node.setAttribute('aria-label','数据表格，可左右滚动');
  });
 }
 function selectionSummary(owner,key,message){
  if(!owner)return;let node=Array.from(owner.children).find(item=>item.dataset.selectionSummary===key);
  if(!node){node=root.document.createElement('span');node.dataset.selectionSummary=key;node.className='workbench-selection';node.setAttribute('role','status');node.setAttribute('aria-live','polite');owner.prepend(node);}
  if(node.textContent!==message)node.textContent=message;
 }
 function scheduleEnhance(){if(scheduled)return;scheduled=true;root.requestAnimationFrame(()=>{scheduled=false;for(const id of ['content','modalBody']){const scope=root.document.getElementById(id);if(scope)enhance(scope);}});}
 function initialize(){
  const observer=new root.MutationObserver(scheduleEnhance);
  for(const id of ['content','modalBody']){const scope=root.document.getElementById(id);if(scope)observer.observe(scope,{childList:true,subtree:true});}
  scheduleEnhance();
 }
 async function requestJSON(url,options={}){
  const response=await root.fetch(url,{credentials:'same-origin',...options});
  let result;
  try{result=await response.json();}
  catch(cause){const failure=Error('无法读取服务响应，请核实保存状态后重试');failure.code='INVALID_RESPONSE';failure.status=response.status;failure.cause=cause;throw failure;}
  if(!response.ok){
   const detail=result?.error;
   const failure=Error(typeof detail==='string'?detail:detail?.message||'请求失败');
   failure.code=detail?.code||result?.code||'HTTP_ERROR';failure.trace=detail?.traceId||result?.traceId;failure.status=response.status;
   throw failure;
  }
  return result;
 }
 root.WorkbenchUI={beginDialog:begin,requestClose,saveDialog:save,deferToast,resumeDialog:resume,enhance,selectionSummary,requestJSON};
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();}
})(window);
