"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const source = fs.readFileSync(path.join(__dirname, "..", "counselor-growth-module.js"), "utf8");
const helper = source.match(/function attachmentDownloadUrl\(file\)\{[\s\S]*?\n  \}/);
assert.ok(helper, "growth attachment links need one shared filename-aware helper");
assert.match(source.match(/function filesHtml\(\)[^\n]*/)[0],/attachmentDownloadUrl\(f\)/,"record editor must use filename-aware downloads too");
const context = vm.createContext({ URL, location: { origin: "http://127.0.0.1:18766" } });
vm.runInContext(helper[0], context);
assert.equal(vm.runInContext('attachmentDownloadUrl({url:"javascript:alert(1)",name:"x.pdf"})',context), "", "external/script attachment URLs must be rejected");
assert.equal(vm.runInContext('attachmentDownloadUrl({url:"https://example.org/a",name:"x.pdf"})',context), "");
withIsolatedWorkbench(async origin => {
  const entry = await fetch(origin+"/");
  const cookie = entry.headers.get("set-cookie").split(";")[0];
  for (const [name, type, bytes] of [
    ["中文成长材料.pdf","application/pdf",Buffer.from("%PDF-1.4\nQA")],
    ["支撑证明.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document",Buffer.from("PK\x03\x04QA")],
    ["证书图片.png","image/png",Buffer.from([137,80,78,71,13,10,26,10])]
  ]) {
    const upload = await fetch(origin+"/api/attachments?name="+encodeURIComponent(name), {method:"POST",headers:{Cookie:cookie,Origin:origin,"Content-Type":"application/octet-stream"},body:bytes});
    assert.equal(upload.status,201);
    const file = await upload.json();
    context.file={id:file.id,url:file.url,fileName:name};
    const url=vm.runInContext("attachmentDownloadUrl(file)",context);
    assert.equal(new URL(url,origin).searchParams.get("name"),name,"legacy fileName must retain the original extension");
    const download=await fetch(origin+url,{headers:{Cookie:cookie}});
    assert.equal(download.status,200);
    assert.equal(download.headers.get("content-type"),type);
    assert.match(download.headers.get("content-disposition"),new RegExp(encodeURIComponent(name).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
    assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  }
  console.log("qa-counselor-attachment-download: passed (PDF, Word, image filename/MIME/bytes)");
}).catch(error=>{console.error(error);process.exitCode=1;});
