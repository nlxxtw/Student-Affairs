"use strict";

/*
 * 数智学工统一筛选选择器
 * - qf-single：单选语义不变，仅增加输入搜索。
 * - qf-multi：复选框与勾选语义不变，仅增加输入搜索。
 * - 筛选工具栏中的原生 select：保留原 select 作为值与 change 事件源，外层提供同款可搜索 UI。
 * 新增筛选 select 优先使用 qfSingle/qfMulti；必须使用原生 select 时加 data-searchable-filter。
 */
(function searchableFilterSelects(global){
  const doc=global.document;
  if(!doc)return;

  const NATIVE_SELECTOR=[
    "select[data-searchable-filter]",
    ".qf-bar select",
    ".filter-bar select",
    "[class*='filter'] select",
    "[class*='Filter'] select",
    "[id*='filter'] select",
    "[id*='Filter'] select",
    ".zf-query select",
    ".dr-roster-filters select",
    ".si-filter select",
    ".filter-item select",
    ".toolbar select.in",
    "select[data-qf]",
    "select[aria-label*='筛选']"
  ].join(",");
  let serial=0;

  function norm(value){
    const text=String(value==null?"":value);
    try{return text.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");}
    catch(_error){return text.trim().toLowerCase();}
  }
  function visible(element){return !!element&&!element.classList.contains("sf-search-hidden")&&element.style.display!=="none";}
  function closeQf(component){
    if(!component)return;
    component.classList.remove("open","sf-drop-up");
    const trigger=component.querySelector(".qf-single-trigger,.qf-multi-trigger");
    if(trigger)trigger.setAttribute("aria-expanded","false");
  }
  function closeNative(wrapper,focus){
    if(!wrapper)return;
    wrapper.classList.remove("open","sf-drop-up");
    const trigger=wrapper.querySelector(".sf-native-trigger");
    if(trigger){trigger.setAttribute("aria-expanded","false");if(focus)trigger.focus();}
  }
  function fitDirection(component,panel){
    component.classList.remove("sf-drop-up");
    global.requestAnimationFrame(function(){
      if(!component.classList.contains("open"))return;
      const rect=component.getBoundingClientRect();
      const wanted=Math.min(panel.scrollHeight||300,300);
      if(global.innerHeight-rect.bottom<wanted+12&&rect.top>wanted+12)component.classList.add("sf-drop-up");
    });
  }
  function searchBox(label){
    const box=doc.createElement("div");
    box.className="sf-search-box";
    const input=doc.createElement("input");
    input.className="sf-search-input";
    input.type="search";
    input.autocomplete="off";
    input.spellcheck=false;
    input.placeholder="输入关键词筛选";
    input.setAttribute("aria-label","搜索"+(label||"下拉选项"));
    const icon=doc.createElement("span");
    icon.className="sf-search-icon";
    icon.setAttribute("aria-hidden","true");
    box.append(input,icon);
    return {box:box,input:input};
  }

  function filterQf(component,input){
    const term=norm(input.value);
    const rows=Array.from(component.querySelectorAll(".qf-single-opt,.qf-multi-opt"));
    let count=0;
    rows.forEach(function(row){
      const match=!term||norm(row.textContent).includes(term)||norm(row.dataset.val).includes(term);
      row.classList.toggle("sf-search-hidden",!match);
      if(match&&row.style.display!=="none")count++;
    });
    const empty=component.querySelector(".sf-search-empty");
    if(empty)empty.hidden=count!==0;
  }
  function ensureQf(component){
    if(!component||component.dataset.sfSearchReady==="1")return;
    const panel=component.querySelector(".qf-single-panel,.qf-multi-panel");
    if(!panel)return;
    component.dataset.sfSearchReady="1";
    const label=component.dataset.label||component.dataset.qf||"";
    const search=searchBox(label);
    const empty=doc.createElement("div");
    empty.className="sf-search-empty";
    empty.hidden=true;
    empty.textContent="没有匹配项";
    panel.insertBefore(search.box,panel.firstChild);
    panel.appendChild(empty);
    search.input.addEventListener("input",function(){filterQf(component,search.input);});
    search.input.addEventListener("keydown",function(event){
      if(event.key==="Escape"){event.preventDefault();closeQf(component);const trigger=component.querySelector(".qf-single-trigger,.qf-multi-trigger");if(trigger)trigger.focus();return;}
      if(event.key!=="ArrowDown")return;
      const target=Array.from(component.querySelectorAll(".qf-single-opt,.qf-multi-opt input[type=checkbox]")).find(function(item){
        const row=item.matches("input")?item.closest(".qf-multi-opt"):item;
        return visible(row);
      });
      if(target){event.preventDefault();target.focus();}
    });
  }
  function prepareQfOpen(component){
    ensureQf(component);
    const input=component.querySelector(".sf-search-input");
    const panel=component.querySelector(".qf-single-panel,.qf-multi-panel");
    if(!input||!panel)return;
    input.value="";
    filterQf(component,input);
    fitDirection(component,panel);
    global.setTimeout(function(){
      if(component.classList.contains("open")){input.focus();input.select();const selected=component.querySelector(".qf-single-opt.sel");if(selected)selected.scrollIntoView({block:"nearest"});}
    },0);
  }

  function nativeEligible(select){
    if(!select||select.dataset.sfEnhanced==="1"||select.multiple||Number(select.size||0)>1)return false;
    if(select.matches("[data-native-select],.ui-theme-select,.stu-pager-size"))return false;
    if(select.closest(".qf-single,.qf-multi,.sf-native-select,.import-field-table"))return false;
    return select.matches(NATIVE_SELECTOR);
  }
  function nativeLabel(select){
    const holder=select.closest(".filter-item,.field,.qitem");
    const label=holder&&holder.querySelector("label");
    return select.getAttribute("aria-label")||(label&&label.textContent)||"筛选条件";
  }
  function refreshNative(wrapper){
    const select=wrapper&&wrapper._sfSource;
    if(!select||!select.isConnected)return;
    const list=wrapper.querySelector(".sf-native-options");
    const trigger=wrapper.querySelector(".sf-native-trigger");
    if(!list||!trigger)return;
    const current=String(select.value==null?"":select.value);
    const fragment=doc.createDocumentFragment();
    Array.from(select.options).forEach(function(option,index){
      const item=doc.createElement("button");
      item.type="button";
      item.className="sf-native-option"+(String(option.value)===current?" selected":"");
      item.dataset.index=String(index);
      item.dataset.value=String(option.value);
      item.setAttribute("role","option");
      item.setAttribute("aria-selected",String(String(option.value)===current));
      item.disabled=!!option.disabled;
      item.textContent=option.textContent||option.label||option.value;
      fragment.appendChild(item);
    });
    list.replaceChildren(fragment);
    const selected=select.options[select.selectedIndex]||select.options[0];
    const text=wrapper.querySelector(".sf-native-text");
    if(text)text.textContent=selected?(selected.textContent||selected.label||selected.value):"请选择";
    trigger.disabled=!!select.disabled;
    wrapper.classList.toggle("sf-disabled",!!select.disabled);
    const input=wrapper.querySelector(".sf-search-input");
    if(input)filterNative(wrapper,input.value);
  }
  function filterNative(wrapper,value){
    const term=norm(value);
    const rows=Array.from(wrapper.querySelectorAll(".sf-native-option"));
    let count=0;
    rows.forEach(function(row){
      const match=!term||norm(row.textContent).includes(term)||norm(row.dataset.value).includes(term);
      row.classList.toggle("sf-search-hidden",!match);
      if(match)count++;
    });
    const empty=wrapper.querySelector(".sf-search-empty");
    if(empty)empty.hidden=count!==0;
  }
  function enhanceNative(select){
    if(!nativeEligible(select))return;
    const measured=select.getBoundingClientRect();
    select.dataset.sfEnhanced="1";
    const id="sfn_"+(++serial);
    const wrapper=doc.createElement("div");
    wrapper.className="sf-native-select";
    wrapper._sfSource=select;
    if(measured.width>0)wrapper.style.minWidth=Math.max(120,Math.round(measured.width))+"px";
    const trigger=doc.createElement("button");
    trigger.type="button";
    trigger.className="sf-native-trigger";
    trigger.setAttribute("aria-haspopup","listbox");
    trigger.setAttribute("aria-expanded","false");
    trigger.setAttribute("aria-controls",id);
    trigger.innerHTML='<span class="sf-native-text"></span><span class="sf-native-caret" aria-hidden="true">&#9662;</span>';
    const panel=doc.createElement("div");
    panel.className="sf-native-panel";
    panel.id=id;
    panel.setAttribute("role","listbox");
    const search=searchBox(nativeLabel(select));
    const list=doc.createElement("div");
    list.className="sf-native-options";
    const empty=doc.createElement("div");
    empty.className="sf-search-empty";
    empty.hidden=true;
    empty.textContent="没有匹配项";
    panel.append(search.box,list,empty);
    wrapper.append(trigger,panel);
    select.insertAdjacentElement("afterend",wrapper);
    select.classList.add("sf-native-source");
    select.tabIndex=-1;
    select.setAttribute("aria-hidden","true");
    refreshNative(wrapper);

    trigger.addEventListener("click",function(event){
      event.preventDefault();event.stopPropagation();
      const opening=!wrapper.classList.contains("open");
      doc.querySelectorAll(".sf-native-select.open").forEach(function(other){if(other!==wrapper)closeNative(other);});
      doc.querySelectorAll(".qf-single.open,.qf-multi.open").forEach(closeQf);
      if(!opening){closeNative(wrapper);return;}
      refreshNative(wrapper);
      wrapper.classList.add("open");trigger.setAttribute("aria-expanded","true");
      search.input.value="";filterNative(wrapper,"");fitDirection(wrapper,panel);
      global.setTimeout(function(){search.input.focus();search.input.select();const selected=wrapper.querySelector(".sf-native-option.selected");if(selected)selected.scrollIntoView({block:"nearest"});},0);
    });
    search.input.addEventListener("input",function(){filterNative(wrapper,search.input.value);});
    search.input.addEventListener("click",function(event){event.stopPropagation();});
    panel.addEventListener("click",function(event){
      const item=event.target.closest(".sf-native-option");
      if(!item||item.disabled)return;
      event.stopPropagation();
      const index=Number(item.dataset.index);
      if(!Number.isInteger(index)||!select.options[index])return;
      select.selectedIndex=index;
      select.dispatchEvent(new Event("input",{bubbles:true}));
      select.dispatchEvent(new Event("change",{bubbles:true}));
      refreshNative(wrapper);closeNative(wrapper,true);
    });
    wrapper.addEventListener("keydown",function(event){
      if(event.key==="Escape"){event.preventDefault();closeNative(wrapper,true);return;}
      const rows=Array.from(wrapper.querySelectorAll(".sf-native-option")).filter(visible);
      if(event.target===trigger&&(event.key==="ArrowDown"||event.key==="Enter"||event.key===" ")){event.preventDefault();trigger.click();return;}
      if(event.target===search.input&&event.key==="ArrowDown"){event.preventDefault();if(rows[0])rows[0].focus();return;}
      if(!event.target.classList.contains("sf-native-option"))return;
      const index=rows.indexOf(event.target);
      if(event.key==="ArrowDown"){event.preventDefault();(rows[index+1]||rows[0]||event.target).focus();}
      else if(event.key==="ArrowUp"){event.preventDefault();(rows[index-1]||search.input).focus();}
      else if(event.key==="Enter"||event.key===" "){event.preventDefault();event.target.click();}
    });
    select.addEventListener("change",function(){refreshNative(wrapper);});
    select.addEventListener("input",function(){refreshNative(wrapper);});
  }

  function scan(root){
    const scope=root&&root.querySelectorAll?root:doc;
    if(scope.matches&&scope.matches(".qf-single,.qf-multi"))ensureQf(scope);
    scope.querySelectorAll(".qf-single,.qf-multi").forEach(ensureQf);
    if(scope.matches&&scope.matches("select"))enhanceNative(scope);
    scope.querySelectorAll(NATIVE_SELECTOR).forEach(enhanceNative);
    scope.querySelectorAll(".sf-native-select").forEach(refreshNative);
  }

  doc.addEventListener("click",function(event){
    const qf=event.target.closest&&event.target.closest(".qf-single,.qf-multi");
    if(qf&&event.target.closest(".qf-single-trigger,.qf-multi-trigger")&&qf.classList.contains("open"))prepareQfOpen(qf);
    if(!event.target.closest||!event.target.closest(".sf-native-select"))doc.querySelectorAll(".sf-native-select.open").forEach(function(wrapper){closeNative(wrapper);});
  });
  doc.addEventListener("qfSingle:change",function(event){const component=event.target.closest&&event.target.closest(".qf-single");if(component){const input=component.querySelector(".sf-search-input");if(input){input.value="";filterQf(component,input);}}});

  const observer=new MutationObserver(function(records){
    records.forEach(function(record){
      if(record.target&&record.target.matches&&record.target.matches("select[data-sf-enhanced='1']")){
        const wrapper=record.target.nextElementSibling;
        if(wrapper&&wrapper.classList.contains("sf-native-select"))refreshNative(wrapper);
      }
      record.addedNodes.forEach(function(node){if(node.nodeType===1)scan(node);});
    });
  });
  function start(){scan(doc);observer.observe(doc.documentElement,{childList:true,subtree:true});}
  if(doc.readyState==="loading")doc.addEventListener("DOMContentLoaded",start,{once:true});else start();
  global.SearchableFilterSelects={scan:scan,refresh:function(){scan(doc);}};
})(window);
