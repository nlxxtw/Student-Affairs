/* 验证 maintSheetToTsv 的字段映射逻辑（与 app.js 中函数体一致的最小复刻）。
   覆盖：① Excel 别名表头 → 规范表头；② 无表头 CSV（按列序映射）；③ 缺列不串列。 */
const fs = require('fs');

function smartHeader(v){ return String(v==null?'':v).replace(/\*/g,'').replace(/[\s　]/g,'').trim(); }

const MAINT_IMPORT_FIELDS = {
  class: [
    {key:'name', label:'班级名称', req:true, aliases:['班级名称','班级','名称','name','班级名']},
    {key:'grade', label:'年级', req:false, aliases:['年级','grade']},
    {key:'major', label:'专业', req:false, aliases:['专业','专业名称','major']},
    {key:'dept', label:'所属学院', req:false, aliases:['所属学院','学院','dept']},
    {key:'counselor', label:'辅导员', req:false, aliases:['辅导员','counselor','班导']},
    {key:'teacher', label:'班主任', req:false, aliases:['班主任','teacher']},
    {key:'level', label:'学历', req:false, aliases:['学历','level','教育层次']},
    {key:'enrollType', label:'招生类别', req:false, aliases:['招生类别','enrollType','录取类别']}
  ]
};

function maintSheetToTsv(kind, rawRows){
  const fields = MAINT_IMPORT_FIELDS[kind];
  if(!rawRows || !rawRows.length) return '';
  const aliasMap = {};
  fields.forEach(function(f){
    [f.label].concat(f.aliases || []).forEach(function(a){
      aliasMap[smartHeader(a).toLowerCase()] = f.key;
    });
  });
  const norm = rawRows.map(function(r){ return (r||[]).map(function(c){ return String(c==null?'':c).trim(); }); });
  let hi = -1, colKey = null;
  for(let i=0; i<Math.min(12, norm.length); i++){
    if(norm[i].some(function(h){ return aliasMap[smartHeader(h).toLowerCase()]; })){ hi = i; break; }
  }
  if(hi >= 0){
    colKey = norm[hi].map(function(h){ return aliasMap[smartHeader(h).toLowerCase()] || null; });
  } else {
    colKey = norm[0].map(function(_, idx){ return idx < fields.length ? fields[idx].key : null; });
  }
  const dataStart = hi >= 0 ? hi + 1 : 0;
  const headerLine = fields.map(function(f){ return f.label; }).join('\t');
  const dataLines = [];
  for(let i=dataStart; i<norm.length; i++){
    const cells = norm[i];
    if(!cells.some(function(c){ return c !== ''; })) continue;
    const vals = fields.map(function(f, idx){
      const key = colKey[idx];
      return key ? String(cells[idx]||'').replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ') : '';
    });
    dataLines.push(vals.join('\t'));
  }
  return [headerLine].concat(dataLines).join('\n');
}

let failures = 0;
function assert(cond, msg){ if(!cond){ console.error('  ✗ '+msg); failures++; } else { console.log('  ✓ '+msg); } }

console.log('Test A: Excel 别名表头 → 规范表头');
// smartReadWorkbook 返回的二维数组（用户用别名"班级/年级/专业/学院"作表头）
const rawAlias = [
  ['班级','年级','专业','学院','辅导员','班主任','学历','招生类别'],
  ['852304通信','2024级','通信工程','信息工程学院','王老师','李老师','本科','普通本科'],
  ['852305通信','2024级','通信工程','信息工程学院']
];
const tsvA = maintSheetToTsv('class', rawAlias);
console.log('  TSV:\n' + tsvA.split('\n').map(l=>'    '+l).join('\n'));
{
  const lines = tsvA.split('\n');
  assert(lines[0] === '班级名称\t年级\t专业\t所属学院\t辅导员\t班主任\t学历\t招生类别', '首行为规范表头');
  assert(lines[1].startsWith('852304通信\t2024级\t通信工程\t信息工程学院\t王老师\t李老师\t本科\t普通本科'), '第一行全部映射正确');
  assert(lines[2] === '852305通信\t2024级\t通信工程\t信息工程学院\t\t\t\t', '缺列行以空值补齐不串列');
  assert(lines[2].split('\t').length === 8, '列数恒为 8');
}

console.log('Test B: 无表头 CSV（按列序映射，兼容"表头行可省略"）');
// 无表头：直接是数据行，列序对应 班级名称/年级/专业/所属学院/辅导员/班主任/学历/招生类别
const rawNoHeader = [
  ['852304通信','2024级','通信工程','信息工程学院','王老师','李老师','本科','普通本科'],
  ['852305通信','2024级','通信工程','信息工程学院']
];
const tsvB = maintSheetToTsv('class', rawNoHeader);
console.log('  TSV:\n' + tsvB.split('\n').map(l=>'    '+l).join('\n'));
{
  const lines = tsvB.split('\n');
  assert(lines[0] === '班级名称\t年级\t专业\t所属学院\t辅导员\t班主任\t学历\t招生类别', '仍补出规范表头');
  assert(lines[1].startsWith('852304通信\t2024级\t通信工程\t信息工程学院\t王老师\t李老师\t本科\t普通本科'), '第一行按列序映射正确');
  assert(lines[2] === '852305通信\t2024级\t通信工程\t信息工程学院\t\t\t\t', '缺列补齐不串列');
}

console.log(failures ? `\nFAILED (${failures})` : '\nALL PASS');
process.exit(failures ? 1 : 0);
