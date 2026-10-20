/* 独立验证：.xls (OLE2 复合文档 + BIFF8) 读取解析器
 * 先用 xlwt 生成的真实 .xls 验证往返，确认无误后再粘贴进 app.js。
 * 该文件仅用于测试，不被应用加载。 */

/** 根据 codepage 构造字符串解码器 */
function makeDecoder(codepage){
  let enc = 'windows-1252';
  if(codepage === 936) enc = 'gbk';
  else if(codepage === 950) enc = 'big5';
  else if(codepage === 932) enc = 'shift-jis';
  else if(codepage === 1251) enc = 'windows-1251';
  else if(codepage === 1250) enc = 'windows-1250';
  try { return new TextDecoder(enc); } catch(e){ return new TextDecoder('windows-1252'); }
}

/** 读取 BIFF Unicode/String：cch(2) grbit(1) [rt(2)] [phon(4)] chars */
function readBiffString(dv, offset, decoder){
  if(offset + 3 > dv.byteLength) return { str:'', next:offset };
  const cch = dv.getUint16(offset, true);
  const grbit = dv.getUint8(offset + 2);
  let p = offset + 3;
  const isUni = (grbit & 0x01) !== 0;
  if(grbit & 0x02) p += 2; // rich text runs
  if(grbit & 0x04) p += 4; // phonetic
  let str = '';
  if(isUni){
    if(p + cch * 2 <= dv.byteLength){
      let s = '';
      for(let i = 0; i < cch; i++) s += String.fromCharCode(dv.getUint16(p + i * 2, true));
      str = s;
    }
    p += cch * 2;
  } else {
    if(p + cch <= dv.byteLength){
      const arr = new Uint8Array(dv.buffer, dv.byteOffset + p, cch);
      str = decoder.decode(arr);
    }
    p += cch;
  }
  return { str, next:p };
}

/** RK 数值解码：30 位有符号整数 V = rk>>2；低 2 位为标志
 *  0b00 / 0b11 → V/100（整数除以 100 或浮点除以 100）
 *  0b01 → 精确整数 V
 *  0b10 → 浮点（数值仍等于 V，xlwt 等据此存整数） */
function rkToNum(rk){
  let num = (rk & 0xFFFFFFFC) >> 2;
  if(num & 0x20000000) num -= 0x40000000; // 30-bit 符号扩展
  const f = rk & 0x03;
  if(f === 0 || f === 3) return num / 100;
  return num;
}

function fmtNum(v){ return (v === null || v === undefined || isNaN(v)) ? '' : (Number.isInteger(v) ? String(v) : String(v)); }

/** 读取扇区链（忽略所有特殊标记扇区，避免越界） */
function getChain(start, fat){
  const chain = []; let s = start; let guard = 0;
  while(s !== undefined && s !== null && s >= 0 && s !== 0xFFFFFFFD && s !== 0xFFFFFFFE && s !== 0xFFFFFFFC && s !== 0xFFFFFFFF && guard < 2000000){
    chain.push(s); const n = fat[s]; if(n === undefined) break; s = n; guard++;
  }
  return chain;
}

/** 单扇区是否越界 */
function sectorOk(sec, dv, sectorSize){ return sec >= 0 && (sec + 1) * sectorSize <= dv.byteLength; }

/** 从 OLE2 复合文档读取某个流（start/size），自动选择主 FAT 或 mini-FAT */
function readStream(start, size, fat, miniFat, rootStart, rootSize, dv, sectorSize, miniSize, miniCutoff){
  if(!size) return new Uint8Array(0);
  const useMini = size < miniCutoff && miniFat && miniFat.length && miniFat[start] !== undefined;
  if(useMini){
    // mini 流：数据存于 mini-stream 容器内，按 mini-Fat 链接
    const container = readMainStream(rootStart, rootSize, fat, dv, sectorSize);
    const chain = getChain(start, miniFat);
    const out = new Uint8Array(size);
    let written = 0;
    for(const m of chain){
      const off = m * miniSize;
      const take = Math.min(miniSize, size - written);
      if(take <= 0) break;
      if(off + take > container.length) break;
      for(let i = 0; i < take; i++) out[written + i] = container[off + i];
      written += take;
    }
    return out;
  }
  return readMainStream(start, size, fat, dv, sectorSize);
}

function readMainStream(start, size, fat, dv, sectorSize){
  const chain = getChain(start, fat);
  const out = new Uint8Array(size);
  let written = 0;
  for(const sec of chain){
    if(!sectorOk(sec, dv, sectorSize)) break;
    const off = (sec + 1) * sectorSize;
    const take = Math.min(sectorSize, size - written);
    if(take <= 0) break;
    for(let i = 0; i < take; i++) out[written + i] = dv.getUint8(off + i);
    written += take;
  }
  return out;
}

/** 读取整个扇区链（不加 size 上限），用于目录等长度未知的流 */
function readFullStream(start, fat, dv, sectorSize){
  const chain = getChain(start, fat);
  const tmp = [];
  for(const sec of chain){
    if(!sectorOk(sec, dv, sectorSize)) break;
    const off = (sec + 1) * sectorSize;
    for(let i = 0; i < sectorSize; i++) tmp.push(dv.getUint8(off + i));
  }
  return new Uint8Array(tmp);
}

/** 解析 .xls 工作簿，返回 [{name, rows:[[...]]}]（rows 为二维数组的数组） */
function smartReadXls(buffer){
  const dv = new DataView(buffer);
  try{
  // 校验 OLE2 签名
  const sig = [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1];
  for(let i = 0; i < 8; i++) if(dv.getUint8(i) !== sig[i]) throw new Error('不是有效的 .xls 文件（OLE2 签名不匹配）');
  const sectorShift = dv.getUint16(30, true);
  const miniShift = dv.getUint16(32, true);
  const firstDir = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const firstMini = dv.getUint32(60, true);
  const firstDifat = dv.getUint32(68, true);
  if(process.env.XLSDEBUG) console.log('[dbg] sig=%s major=%d sectorShift=%d miniShift=%d firstDir=%d miniCutoff=%d firstMini=%d firstDifat=%d numFatAt44=%d difat0=%d', dv.getUint32(0,true).toString(16), dv.getUint16(26,true), sectorShift, miniShift, firstDir, miniCutoff, firstMini, firstDifat, dv.getUint32(44,true), dv.getUint32(76,true));
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const sectorsPerFat = sectorSize / 4;
  const SPECIAL = (s) => s === 0xFFFFFFFD || s === 0xFFFFFFFE || s === 0xFFFFFFFC || s === 0xFFFFFFFF;

  // DIFAT（FAT 扇区列表）：跳过所有特殊标记扇区（0xFFFFFFFD/0xFFFFFFFE/0xFFFFFFFC/0xFFFFFFFF）
  const fatSectors = [];
  for(let i = 0; i < 109; i++){ const e = dv.getUint32(76 + 4 * i, true); if(SPECIAL(e)) continue; if(e >= 0xFFFFFF00) continue; fatSectors.push(e); }
  // DIFAT 链（超大文件）；firstDifat 为任一特殊标记扇区时表示无链
  if(!SPECIAL(firstDifat)){
    let ds = firstDifat; let guard = 0;
    while(ds >= 0 && !SPECIAL(ds) && guard < 1000){
      if(!sectorOk(ds, dv, sectorSize)) break;
      const off = (ds + 1) * sectorSize;
      for(let i = 0; i < 127; i++){ const e = dv.getUint32(off + i * 4, true); if(e <= 0xFFFFFFFA) continue; fatSectors.push(e); }
      ds = dv.getUint32(off + 127 * 4, true); guard++;
    }
  }
  // 构建 FAT 映射 fat[sector] = next
  const fat = [];
  let base = 0;
  if(process.env.XLSDEBUG) console.log('[dbg] fatSectors=' + JSON.stringify(fatSectors) + ' sectorsPerFat=' + sectorsPerFat + ' fileLen=' + dv.byteLength);
  for(const sec of fatSectors){
    if(!sectorOk(sec, dv, sectorSize)){ if(process.env.XLSDEBUG) console.log('[dbg] skip bad FAT sector ' + sec); continue; }
    const off = (sec + 1) * sectorSize;
    for(let i = 0; i < sectorsPerFat; i++) fat[base + i] = dv.getUint32(off + i * 4, true);
    base += sectorsPerFat;
  }
  // mini-FAT
  const miniFat = [];
  if(firstMini !== 0xFFFFFFFD){
    const chain = getChain(firstMini, fat);
    let mbase = 0;
    for(const sec of chain){
      const off = (sec + 1) * sectorSize;
      const perMini = sectorSize / 4;
      for(let i = 0; i < perMini; i++) miniFat[mbase + i] = dv.getUint32(off + i * 4, true);
      mbase += perMini;
    }
  }
  // 目录（长度未知，整链读取）
  const dirBytes = readFullStream(firstDir, fat, dv, sectorSize);
  // 目录按扇区大小分页，但 readMainStream 已在链里拼好；需要按 128 字节切分
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries = [];
  const entryCount = Math.floor(dirBytes.byteLength / 128);
  let rootStart = -1, rootSize = 0, workbookStart = -1, workbookSize = 0;
  for(let i = 0; i < entryCount; i++){
    const eo = i * 128;
    const type = dirView.getUint8(eo + 66);
    const startSec = dirView.getUint32(eo + 116, true);
    const streamSize = dirView.getUint32(eo + 120, true); // v3：低 4 字节即为长度
    // 名称（UTF-16LE，nameLen 含结尾空字符，需去掉）
    let name = '';
    const nameLen = dirView.getUint16(eo + 64, true);
    const nameChars = Math.max(0, Math.floor(nameLen / 2) - 1);
    for(let k = 0; k < nameChars && k < 32; k += 1) name += String.fromCharCode(dirView.getUint16(eo + k * 2, true));
    if(type === 5){ rootStart = startSec; rootSize = streamSize; }
    else if(type === 2 && (name === 'Workbook' || name === 'BOOK' || name === 'Book')){ workbookStart = startSec; workbookSize = streamSize; }
    entries.push({ name, type, startSec, streamSize });
  }
  if(process.env.XLSDEBUG) console.log('[dbg] entries=' + entries.length + ' ' + entries.map(e => e.name + ':' + e.type + '@' + e.startSec + '/' + e.streamSize).join(' | '));
  if(workbookStart < 0) throw new Error('.xls 中未找到 Workbook 流');
  const wb = readStream(workbookStart, workbookSize, fat, miniFat, rootStart, rootSize, dv, sectorSize, miniSize, miniCutoff);
  const wdv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);

  // 解析 BIFF
  let codepage = 1252;
  let sst = [];
  const grids = []; // 每个 sheet 一个 Map
  const bounds = []; // sheet 的 lbPlyPos 顺序
  // 读取 BOUNDSHEET 中的工作表名（cch(2) grbit(1) [rt(2)] [phon(4)] chars）
  function readSheetName(dv, off){
    if(off + 3 > dv.byteLength) return '';
    const cch = dv.getUint16(off, true);
    const grbit = dv.getUint8(off + 2);
    if(cch < 1 || cch > 255) return ''; // 非法长度（如 xlwt 的非常规存储）直接放弃
    let p = off + 3;
    if(grbit & 0x02) p += 2; if(grbit & 0x04) p += 4;
    if(p + (grbit & 0x01 ? cch * 2 : cch) > dv.byteLength) return '';
    let s = '';
    if(grbit & 0x01){ for(let i = 0; i < cch; i++) s += String.fromCharCode(dv.getUint16(p + i * 2, true)); }
    else { try { s = new TextDecoder('gbk').decode(new Uint8Array(dv.buffer, dv.byteOffset + p, cch)); } catch(e){ s = ''; } }
    return s;
  }
  let pos = 0;
  let cur = -1;
  let bi = 0;
  if(process.env.XLSDEBUG){
    console.log('[dbg] sectorSize=%d miniSize=%d miniCutoff=%d firstDir=%d firstMini=%d workbookStart=%d workbookSize=%d rootStart=%d rootSize=%d wbLen=%d fatSectors=%d miniFatLen=%d', sectorSize, miniSize, miniCutoff, firstDir, firstMini, workbookStart, workbookSize, rootStart, rootSize, wb.byteLength, fatSectors.length, miniFat.length);
  }
  while(pos + 4 <= wdv.byteLength){
    const op = wdv.getUint16(pos, true);
    const len = wdv.getUint16(pos + 2, true);
    const ds = pos + 4;
    const de = ds + len;
    // 切换到对应 sheet
    if(bi < bounds.length && pos === bounds[bi].lb){ cur = bi; bi++; }
    if(op === 0x0042){ // CODEPAGE
      if(len >= 2) codepage = wdv.getUint16(ds, true);
    } else if(op === 0x0085){ // BOUNDSHEET（含表名）
      if(len >= 6){ const lb = wdv.getUint32(ds, true); bounds.push({ lb, name: readSheetName(wdv, ds + 6) }); }
    } else if(op === 0x00FC){ // SST
      const decoder = makeDecoder(codepage);
      let p = ds + 8; // 跳过 cstTotal/cstUnique
      while(p + 3 <= de){
        const r = readBiffString(wdv, p, decoder);
        sst.push(r.str); p = r.next;
      }
    } else if(cur >= 0){
      if(!grids[cur]) grids[cur] = new Map();
      const g = grids[cur];
      if(op === 0x0203){ // NUMBER
        if(len >= 14){ const row = wdv.getUint16(ds, true), col = wdv.getUint16(ds + 2, true); const v = wdv.getFloat64(ds + 6, true); if(process.env.XLSDEBUG) console.log('[dbg] NUMBER r'+row+'c'+col+' v='+v); g.set(row * 10000 + col, fmtNum(v)); }
      } else if(op === 0x0204){ // LABEL
        if(len >= 6){ const row = wdv.getUint16(ds, true), col = wdv.getUint16(ds + 2, true); const r = readBiffString(wdv, ds + 6, makeDecoder(codepage)); g.set(row * 10000 + col, r.str); }
      } else if(op === 0x00FD){ // LABELSST
        if(len >= 10){ const row = wdv.getUint16(ds, true), col = wdv.getUint16(ds + 2, true); const idx = wdv.getUint32(ds + 6, true); g.set(row * 10000 + col, sst[idx] != null ? sst[idx] : ''); }
      } else if(op === 0x027E){ // RK
        if(len >= 10){ const row = wdv.getUint16(ds, true), col = wdv.getUint16(ds + 2, true); const rk = wdv.getUint32(ds + 6, true); if(process.env.XLSDEBUG) console.log('[dbg] RK r'+row+'c'+col+' rk='+rk+' -> '+rkToNum(rk)); g.set(row * 10000 + col, fmtNum(rkToNum(rk))); }
      } else if(op === 0x00BE){ // MULRK
        if(len >= 6){ const row = wdv.getUint16(ds, true), colFirst = wdv.getUint16(ds + 2, true); let p = ds + 4; let ci = 0; while(p + 6 <= de - 2){ const rk = wdv.getUint32(p + 2, true); g.set(row * 10000 + (colFirst + ci), fmtNum(rkToNum(rk))); p += 6; ci++; } }
      } else if(op === 0x0006){ // FORMULA（尝试取数值结果）
        try{ const row = wdv.getUint16(ds, true), col = wdv.getUint16(ds + 2, true); const ftype = wdv.getUint8(ds + 6); if(ftype === 0x00){ const val = wdv.getFloat64(ds + 6, true); if(isFinite(val)) g.set(row * 10000 + col, fmtNum(val)); } }catch(e){}
      }
    }
    pos = de;
  }
  // 组装 sheets（按 BOUNDSHEET 顺序）
  const sheets = [];
  for(let i = 0; i < bounds.length; i++){
    const g = grids[i]; if(!g || !g.size) continue;
    let maxR = 0, maxC = 0;
    g.forEach((v, k) => { const r = Math.floor(k / 10000), c = k % 10000; if(r > maxR) maxR = r; if(c > maxC) maxC = c; });
    const rows = [];
    for(let r = 0; r <= maxR; r++){ const line = []; for(let c = 0; c <= maxC; c++) line.push(g.get(r * 10000 + c) || ''); rows.push(line); }
    sheets.push({ name: bounds[i].name || ('Sheet' + (i + 1)), rows });
  }
  if(!sheets.length) throw new Error('.xls 中没有任何可读取的数据');
  return sheets;
  }catch(e){
    if(process.env.XLSDEBUG){ console.log('[dbg] ERROR\n' + e.stack); }
    throw e;
  }
}

module.exports = { smartReadXls };

/* ===== 自测 ===== */
function readWhole(path){
  const fs = require('fs');
  return fs.readFileSync(path).buffer.slice(fs.readFileSync(path).byteOffset, fs.readFileSync(path).byteOffset + fs.readFileSync(path).length);
}
const fs = require('fs');
function fileBuf(path){ const b = fs.readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }

const tests = [
  { file: 'tests/sample-dept.xls', expect: [['学院代码','学院名称'],['85','信息工程学院'],['86','外国语学院'],['90','计算机学院']] },
  { file: 'tests/sample-class.xls', expect: [['班级名称','年级','专业','所属学院','辅导员','班主任','学历','招生类别'],['852304通信','2024级','通信工程','信息工程学院','王老师','李老师','本科','普通本科'],['852305软件','2024级','软件工程','信息工程学院','张老师','赵老师','本科','普通本科']] },
];

let failed = 0;
for(const t of tests){
  try{
    const sheets = smartReadXls(fileBuf(t.file));
    const first = sheets[0].rows.map(r => r.map(c => (c == null ? '' : String(c))));
    const ok = JSON.stringify(first) === JSON.stringify(t.expect);
    console.log((ok ? 'PASS ' : 'FAIL ') + t.file + '  sheets=' + sheets.length + (ok ? '' : `\n  期望: ${JSON.stringify(t.expect)}\n  实际: ${JSON.stringify(first)}`));
    if(!ok) failed++;
    // 多表文件：第二工作表内容应独立，且不应污染第一表
    if(t.file.indexOf('sample-class') >= 0 && sheets.length >= 2){
      const sheet1HasSecond = sheets[1].rows.some(r => r.some(c => String(c).indexOf('这是第二个工作表') >= 0));
      const sheet0Polluted = sheets[0].rows.some(r => r.some(c => String(c).indexOf('这是第二个工作表') >= 0));
      const ok = sheet1HasSecond && !sheet0Polluted;
      console.log((ok ? 'PASS ' : 'FAIL ') + t.file + ' 第二工作表独立(未被第一表污染)=' + ok);
      if(!ok) failed++;
    }
  }catch(e){
    console.log('FAIL ' + t.file + ' 异常: ' + (e.message || e));
    failed++;
  }
}
process.exitCode = failed ? 1 : 0;
