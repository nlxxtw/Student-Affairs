"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const { mergeConcurrentStoreValue } = require("../web-server.js");

const root = path.resolve(__dirname, "..");
const clientSource = fs.readFileSync(path.join(root, "assets", "tool-history-client.js"), "utf8");
const store = new Map();
const attachments = new Map();
let attachmentSequence = 0;

function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function attachmentReferenced(id) {
  return [...store.values()].some((value) => String(value).includes(id));
}

async function mockFetch(rawUrl, options = {}) {
  const url = new URL(rawUrl, "http://127.0.0.1");
  const method = String(options.method || "GET").toUpperCase();
  if (url.pathname === "/api/store/batch" && method === "POST") {
    const operations = JSON.parse(options.body).operations, values = {};
    try { operations.forEach(op => { assert(Object.hasOwn(op,"baseValue")); values[op.key] = mergeConcurrentStoreValue(op.baseValue,store.get(op.key) ?? null,op.method === "DELETE" ? null : op.value,op.key); }); }
    catch(error) { return reply(409,{error:error.message,code:error.code}); }
    Object.entries(values).forEach(([key,value])=>{if(value===null)store.delete(key);else store.set(key,value);});
    return reply(200,{ok:true,storeValues:values});
  }
  const storeMatch = /^\/api\/store\/([^/]+)$/.exec(url.pathname);
  if (storeMatch) {
    const key = decodeURIComponent(storeMatch[1]);
    if (method === "GET") return reply(200, { key, value: store.has(key) ? store.get(key) : null });
    if (method === "PUT") {
      const body = JSON.parse(options.body);
      store.set(key, body.value);
      return reply(200, { ok: true });
    }
    if (method === "DELETE") {
      store.delete(key);
      return reply(200, { ok: true });
    }
  }
  if (url.pathname === "/api/attachments" && method === "POST") {
    const id = `00000000-0000-4000-8000-${String(++attachmentSequence).padStart(12, "0")}`;
    const name = url.searchParams.get("name") || "result.bin";
    attachments.set(id, options.body);
    return reply(201, { id, name, size: options.body.size, url: `/attachments/${id}` });
  }
  const attachmentMatch = /^\/api\/attachments\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (attachmentMatch && method === "DELETE") {
    const id = attachmentMatch[1];
    if (attachmentReferenced(id)) return reply(409, { error: "附件仍被数据引用" });
    attachments.delete(id);
    return reply(200, { ok: true });
  }
  throw new Error(`未模拟的请求：${method} ${url.pathname}`);
}

function loadClient() {
  const context = {
    Blob,
    crypto: webcrypto,
    fetch: mockFetch,
    document: { createElement() { throw new Error("本测试不调用下载界面"); }, body: {} }
  };
  context.window = context;
  vm.runInNewContext(clientSource, context, { filename: "tool-history-client.js" });
  return context.ToolHistory;
}

(async function run() {
  const tools = ["excelMerge", "excelCheck", "dataMatch", "customRoster", "academicSummary", "academicAnalysis"];
  let history = loadClient();

  for (const tool of tools) {
    for (let index = 1; index <= 2; index += 1) {
      await history.save(tool, {
        id: `${tool}_${index}`,
        at: `2026-08-30T00:00:0${index}.000Z`,
        title: `${tool} 第 ${index} 次`,
        summary: "回归记录",
        payload: { value: index }
      }, [{ name: `${tool}-${index}.txt`, role: "output", blob: new Blob([`${tool}-${index}`], { type: "text/plain" }) }]);
    }
    assert.strictEqual((await history.list(tool)).length, 2, `${tool} 应逐次保存记录`);
  }

  const storedAttachmentCount = attachments.size;
  assert.strictEqual(storedAttachmentCount, tools.length * 2, "每条测试记录都应保存独立附件");

  // 模拟页面切到其他功能后 iframe 被销毁，再次进入并重新加载脚本。
  history = loadClient();
  for (const tool of tools) {
    const rows = await history.list(tool);
    assert.strictEqual(rows.length, 2, `${tool} 页面重建后历史仍应存在`);
    const restored = await history.get(tool, rows[0].id);
    assert.strictEqual(restored.payload.value, 2, `${tool} 应恢复最近一次完整结果`);

    await history.remove(tool, `${tool}_1`);
    assert.strictEqual((await history.list(tool)).length, 1, `${tool} 单条删除只应删除目标记录`);
  }
  assert.strictEqual(attachments.size, tools.length, "单条删除应连同各自附件删除");

  for (const tool of tools) await history.clear(tool);
  assert.strictEqual(attachments.size, 0, "清空历史应先解除索引引用并删除全部附件");
  assert.strictEqual(store.size, 0, "清空后不应残留历史索引或记录键");
  // 独立页面同时保存独立结果，索引不得发生最后写入者覆盖。
  await Promise.all(Array.from({length:10},(_,i)=>loadClient().save("dataMatch",{id:"parallel_"+i,title:"并发结果",payload:i})));
  assert.strictEqual((await history.list("dataMatch")).length,10);
  await history.clear("dataMatch");

  // 明确验证没有“最近 N 条”自动淘汰。
  for (let index = 0; index < 75; index += 1) {
    await history.save("dataMatch", { id: `retention_${index}`, at: new Date(2026, 7, 30, 0, 0, index).toISOString(), title: "保留测试", payload: index });
  }
  assert.strictEqual((await history.list("dataMatch")).length, 75, "历史记录不得自动按数量淘汰");

  const integrations = new Map([
    ["excelMerge", "assets/excel-merge-app.js"],
    ["excelCheck", "assets/excel-check-app.js"],
    ["dataMatch", "assets/data-match-app.js"],
    ["customRoster", "custom-roster-module.js"],
    ["academicSummary", "assets/academic-summary-tool.js"],
    ["academicAnalysis", "assets/academic-analysis-tool.js"]
  ]);
  for (const [tool, relative] of integrations) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert(source.includes("ToolHistory"), `${relative} 应接入公共数据库历史客户端`);
    assert(source.includes(`\"${tool}\"`) || source.includes(`'${tool}'`), `${relative} 应使用 ${tool} 独立历史空间`);
  }

  for (const relative of ["index.html", "assets/excel-merge-tool.html", "assets/excel-check-tool.html", "assets/data-match-tool.html", "assets/academic-summary-tool.html", "assets/academic-analysis-tool.html"]) {
    assert(fs.readFileSync(path.join(root, relative), "utf8").includes("tool-history-client.js"), `${relative} 应加载公共历史客户端`);
  }

  const server = fs.readFileSync(path.join(root, "web-server.js"), "utf8");
  assert(server.includes('request.method === "GET"') && server.includes('SELECT value FROM legacy_ui_store WHERE key=?'), "服务端应支持读取单个加密 SQLite 键");
  assert(server.includes("deleteAcademicAnalysisRun"), "学业分析迁移完成后应能删除旧临时目录");
  console.log("工具箱 6 工具数据库历史回归通过：页面重载、逐条保留、单条删除、全部清空、附件引用顺序、无自动淘汰。\n");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
