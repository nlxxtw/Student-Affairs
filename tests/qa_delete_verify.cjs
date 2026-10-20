// 验证：删除 6 项通用能力后，app.js 启动路径与全部页面渲染无运行时错误
// 采用单对象沙箱：window === global，模拟浏览器真实环境（bridge 注入的 window.xxx 即裸 xxx）
const fs = require("fs");
const vm = require("vm");
const moduleSources = ["award-statistics-module.js", "dorm-roster-module.js", "custom-roster-module.js", "counselor-growth-module.js"].map((name) => fs.readFileSync(name, "utf8"));
const code = [fs.readFileSync("app.js", "utf8"), ...moduleSources].join("\n") + "\n;try{globalThis.__VIEWS=VIEWS;globalThis.__PAGES=PAGES;globalThis.__MAINT_EXPORT_TEST={depts:ORG_DEPTS,majors:ORG_MAJORS,classes:ORG_CLASSES,grades:ORG_GRADES,dorms:ORG_DORMS,students:students};}catch(e){}\n";

function mkEl(id) {
  const children = [];
  const el = {
    id: id || "", _html: "", _text: "", value: "", style: {},
    dataset: {}, children,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);},
      toggle(c,f){ if(f===undefined)f=!this._s.has(c); f?this._s.add(c):this._s.delete(c); return f; }, contains(c){return this._s.has(c);} },
    setAttribute(k,v){ this["_a_"+k]=v; }, getAttribute(k){ return this["_a_"+k]||null; },
    removeAttribute(k){ delete this["_a_"+k]; },
    append(...nodes){children.push(...nodes);},
    appendChild(c){ children.push(c); return c; }, removeChild(c){ const i=children.indexOf(c); if(i>=0)children.splice(i,1); },
    insertBefore(c){ children.unshift(c); return c; },
    addEventListener(){}, removeEventListener(){},
    querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
    closest(){ return null; }, parentNode:null, focus(){}, blur(){}, click(){}, scrollIntoView(){},
    getBoundingClientRect(){ return {top:0,left:0,width:0,height:0}; }, cloneNode(){ return mkEl(); },
    set innerHTML(v){ this._html=v; }, get innerHTML(){ return this._html; },
    set textContent(v){ this._text=v; }, get textContent(){ return this._text; },
  };
  return el;
}
const elCache = {};
const documentMock = {
  getElementById(id){ if(!elCache[id]) elCache[id]=mkEl(id); return elCache[id]; },
  createElement(){ return mkEl(); },
  createTextNode(t){ return { nodeType:3, textContent:t }; },
  querySelector(){ return mkEl(); }, querySelectorAll(){ return []; },
  addEventListener(){}, removeEventListener(){},
  documentElement: mkEl(), head: mkEl(), body: mkEl(), get activeElement(){ return null; },
};
let store = {};
const localStorageMock = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null; },
  setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; }, clear(){ store={}; },
};
// 单全局对象：本身既是 window 又是 global（浏览器语义）
const G = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, Blob,
  URL:{ createObjectURL(){return "blob:x";}, revokeObjectURL(){} },
  crypto:{ subtle:{ digest(){ return Promise.resolve(new Uint8Array(32)); } } },
  fetch(){ return Promise.resolve({ ok:true, json(){return Promise.resolve({});}, text(){return Promise.resolve("");} }); },
  requestAnimationFrame(){ return 0; },
  getComputedStyle(){ return {}; },
  MutationObserver: class { observe(){} disconnect(){} },
  FileReader: class { readAsDataURL(){ this.onload&&this.onload({target:{result:""}}); } },
  XMLHttpRequest: class { open(){} send(){} },
  Notification: class {},
  navigator:{ userAgent:"node" },
  location:{ href:"http://127.0.0.1:18766/", search:"", hash:"", pathname:"/", assign(){}, reload(){}, replace(){} },
  matchMedia(){ return { matches:false, media:"", addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} }; },
  addEventListener(){}, removeEventListener(){},
  document: documentMock, localStorage: localStorageMock, sessionStorage: localStorageMock,
  $: ()=>mkEl(), $$: ()=>[],
};
G.window = G; G.self = G; G.globalThis = G;
vm.createContext(G);

const errors = [];
try {
  vm.runInContext(code, G, { filename: "app.js" });
  console.log("[OK] app.js 加载 + 顶层启动执行无异常");
} catch (e) { errors.push("加载/启动抛错: " + e.stack); console.log("[THROW] " + e.stack); }

try {
  const VIEWS = G.__VIEWS, PAGES = G.__PAGES;
  if (!PAGES) console.log("[WARN] PAGES 未取到，跳过页面渲染");
  else {
    const keys = Object.keys(VIEWS || {});
    let ok=0, fail=0;
    for (const k of keys) {
      try {
        if (typeof PAGES[k]==="function") PAGES[k]();
        else if (PAGES[k] && typeof PAGES[k].render==="function") PAGES[k].render();
        else {
          fail++;
          errors.push("页面 "+k+" 缺少渲染器");
          continue;
        }
        ok++;
      } catch(e){ fail++; errors.push("页面 "+k+" 渲染抛错: "+e.message); }
    }
    console.log("[OK] 页面渲染: 成功 "+ok+" / 失败 "+fail+" (共 "+keys.length+" 视图)");
  }
} catch(e){ errors.push("渲染循环抛错: "+e.stack); console.log("[THROW] "+e.stack); }

try {
  const data=G.__MAINT_EXPORT_TEST;
  if(!data || typeof G.maintExport!=="function") throw new Error("基础数据导出函数未暴露");
  data.depts.splice(0,data.depts.length,{code:"02",name:"信息工程学院"},{code:"01",name:"理学院"});
  data.majors.splice(0,data.majors.length,{code:"0201",name:"计算机科学与技术",dept:"信息工程学院",years:"4"});
  data.classes.splice(0,data.classes.length,{name:"2024级计算机1班",grade:"2024级",major:"计算机科学与技术",dept:"信息工程学院",counselor:"张老师",teacher:"李老师",level:"本科",enrollType:"普通招生"});
  data.grades.splice(0,data.grades.length,{name:"2024级"});
  data.dorms.splice(0,data.dorms.length,{zone:"东区",building:"东1栋"});
  data.students.splice(0,data.students.length,{id:"20240001",grade:"2024级"});
  const exports=[];
  G.downloadXlsxFile=(sheet,rows,fileName)=>exports.push({sheet,rows,fileName});
  G.showToast=()=>{};
  ["dept","major","class","grade","dorminfo"].forEach(kind=>G.maintExport(kind));
  if(exports.length!==5) throw new Error("导出调用数应为 5，实际为 "+exports.length);
  const expectedHeaders={dept:["学院代码","学院名称"],major:["专业代码","专业名称","所属学院","学制（年）"],class:["班级名称","年级","专业","所属学院","辅导员","班主任","学历","招生类别"],grade:["年级名称","关联学生数","关联班级数"],dorminfo:["区位","宿舍楼"]};
  const expectedDataRows={dept:2,major:1,class:1,grade:1,dorminfo:1};
  ["dept","major","class","grade","dorminfo"].forEach((kind,index)=>{
    const item=exports[index];
    if(JSON.stringify(item.rows[0])!==JSON.stringify(expectedHeaders[kind])) throw new Error(kind+" 导出表头不正确");
    if(item.rows.length!==expectedDataRows[kind]+1 || !/\.xlsx$/.test(item.fileName)) throw new Error(kind+" 导出数据行或文件名不正确");
  });
  if(exports[0].rows[1][0]!=="01") throw new Error("学院导出未按代码排序");
  if(exports[3].rows[1][1]!==1 || exports[3].rows[1][2]!==1) throw new Error("年级导出关联统计不正确");
  console.log("[OK] 基础信息 5 个模块导出：字段、排序、关联统计和 XLSX 文件名正确");
} catch(e){ errors.push("基础数据导出校验抛错: "+e.stack); console.log("[THROW] "+e.stack); }

const removed = ["getTheme","applyTheme","toggleTheme","renderPinned","setupNavPin","togglePin","exportActiveTableCSV","openLockSettings","lockPrivacy","unlockPrivacy","xcSha256","xcLockCfg","xcResetIdle","xcShowOnboarding","xcNextOnboard","xcFinishOnboard","xcRenderOnboard"];
const stillThere = removed.filter(n => typeof G[n]==="function");
console.log("[CHECK] 应已删除的函数仍存在: " + (stillThere.length? stillThere.join(",") : "无 ✅"));
const kept = ["downloadCSV","xcmExportCSV","xcmLoadAll"];
const missing = kept.filter(n => typeof G[n]!=="function");
console.log("[CHECK] 应保留的函数缺失: " + (missing.length? missing.join(",") : "无 ✅"));

if(errors.length) errors.forEach(function(message){console.error("[FAIL] "+message);});
console.log(errors.length ? ("\n结论: 存在 "+errors.length+" 处错误") : "\n结论: 删除后系统启动与渲染全部正常 ✅");
process.exit(errors.length?1:0);
