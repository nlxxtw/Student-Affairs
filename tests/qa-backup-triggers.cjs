"use strict";
const assert = require("assert");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
withIsolatedWorkbench(async (origin, control) => {
  let cookie;
  async function call(url, method = "GET", body) {
    // This fixture restarts the server on the same port; do not reuse its old socket.
    const response = await fetch(origin + url, { method, headers: { Origin: origin, Connection: "close", Cookie: cookie || "", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).catch(cause=>{throw new Error(method+' '+url+' failed',{cause});});
    const data = await response.json();
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    assert(response.ok, JSON.stringify(data));
    return data;
  }
  await call("/api/auth/enter", "POST");
  assert.strictEqual((await call("/api/backups")).length, 0);
  await call("/api/store/batch", "POST", { operations: [{ key: "nnuzc_backup_trigger_qa", method: "PUT", baseValue: null, value: '{"version":1}' }] });
  await call("/api/workbench/state");
  await new Promise(resolve => setTimeout(resolve, 6200));
  assert.strictEqual((await call("/api/backups")).length, 0, "local writes must not create implicit backups");
  const backup = await call("/api/backups", "POST", { note: "手动备份测试" });
  assert(backup.id);
  assert.strictEqual((await call("/api/backups")).length, 1);
  await control.restart();
  cookie = ""; await call("/api/auth/enter", "POST");
  assert.strictEqual((await call("/api/backups")).length, 1, "restart preserves existing backup without creating another");
  console.log("qa-backup-triggers: passed (startup, local write, manual backup, restart)");
}).catch(error => { console.error(error); process.exitCode = 1; });
