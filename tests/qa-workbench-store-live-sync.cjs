"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");
const { withIsolatedWorkbench } = require("./isolated-workbench-helper.cjs");
const { chromium } = require(path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright"));

withIsolatedWorkbench(async origin => {
  const entry = await fetch(origin + "/api/auth/enter", { method: "POST", headers: { Origin: origin } });
  const hostCookie = entry.headers.get("set-cookie").split(";")[0];
  async function api(cookie, url, body, method = "POST") {
    const response = await fetch(origin + url, { method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert(response.ok, JSON.stringify(result));
    return result;
  }
  const editorLogin=await fetch(origin+"/api/auth/enter",{method:"POST",headers:{Origin:origin}});
  assert(editorLogin.ok);
  const editorCookie = editorLogin.headers.get("set-cookie").split(";")[0];
  const baseStudent = { id: "26000000001", name: "同步学生", dept: "同步学院", major: "同步专业", cls: "同步班", grade: "2026级", status: "在校", phone: "13800000000" };
  await api(hostCookie, "/api/store/nnuzc_orgs", { value: JSON.stringify({ depts: [{ name: "同步学院" }], majors: [{ name: "同步专业", dept: "同步学院" }], classes: [{ name: "同步班", dept: "同步学院", major: "同步专业", grade: "2026级" }], grades: [{ name: "2026级" }], dorms: [] }) }, "PUT");
  await api(hostCookie, "/api/store/nnuzc_students", { value: JSON.stringify([baseStudent]) }, "PUT");
  const browser = await chromium.launch({ executablePath: path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"), headless: true });
  const failures = [];
  async function session(cookie) {
    const context = await browser.newContext();
    const split = cookie.indexOf("=");
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForSelector("#workbenchSavePanel",{state:"attached"});
    let navigations = 0;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
    return { context, page, errors, navigations: () => navigations };
  }
  async function check(name, run) {
    try { await run(); console.log("PASS:", name); }
    catch (error) { failures.push({ name, error: error.stack }); console.error("FAIL:", name, error.message); }
  }
  try {
    await check("主机自动接收远端名单变化，保留页面、查询条件与勾选，不全页刷新", async () => {
      const host = await session(hostCookie);
      try {
        await host.page.evaluate(sid => { goto("student"); document.getElementById("qId").value = sid; stuQuery(); document.querySelector(".stu-row-chk").checked = true; window.qaPageLifetime = "unchanged"; }, baseStudent.id);
        const snapshot = await api(editorCookie, "/api/store", undefined, "GET");
        const remote = JSON.parse(snapshot.nnuzc_students); remote[0].name = "同步学生远端已更新";
        await api(editorCookie, "/api/store/nnuzc_students", { value: JSON.stringify(remote), baseValue: snapshot.nnuzc_students }, "PUT");
        await host.page.waitForFunction(() => students.some(row => row.name === "同步学生远端已更新"), null, { timeout: 25000 });
        assert.strictEqual(host.navigations(), 0, "远端更新导致主机整页重新加载");
        assert.strictEqual(await host.page.evaluate(() => currentView), "student");
        assert.strictEqual(await host.page.inputValue("#qId"), baseStudent.id, "自动同步丢失已应用的查询条件");
        assert(await host.page.locator(".stu-row-chk").isChecked(), "自动同步丢失名单勾选");
        assert((await host.page.textContent("#stuTbody")).includes("同步学生远端已更新"), "运行时名单更新但表格仍为旧数据");
        assert.strictEqual(await host.page.evaluate(() => window.qaPageLifetime), "unchanged");
        assert.deepStrictEqual(host.errors, []);
      } finally { await host.context.close(); }
    });
    await check("编辑弹窗保留未保存内容，关闭后无刷新同步远端更新", async () => {
      const host = await session(hostCookie);
      try {
        await host.page.evaluate(() => { goto("student"); stuQuery(); openModal("协作输入保护", '<input id="liveSyncDraft" value="">', () => false); });
        await host.page.fill("#liveSyncDraft", "当前表单未保存的内容");
        const snapshot = await api(editorCookie, "/api/store", undefined, "GET");
        const remote = JSON.parse(snapshot.nnuzc_students); remote[0].name = "弹窗期间远端更新";
        await api(editorCookie, "/api/store/nnuzc_students", { value: JSON.stringify(remote), baseValue: snapshot.nnuzc_students }, "PUT");
        await host.page.waitForFunction(() => document.getElementById("workbenchSaveStatus").textContent.includes("最新数据") || students.some(row => row.name === "弹窗期间远端更新"), null, { timeout: 15000 });
        assert.strictEqual(await host.page.inputValue("#liveSyncDraft"), "当前表单未保存的内容");
        assert.strictEqual(host.navigations(), 0);
        await host.page.evaluate(() => closeModal());
        await host.page.waitForFunction(() => students.some(row => row.name === "弹窗期间远端更新"), null, { timeout: 25000 });
        assert.strictEqual(host.navigations(), 0, "关闭编辑弹窗后同步仍强制刷新整个页面");
        assert((await host.page.textContent("#stuTbody")).includes("弹窗期间远端更新"));
        assert.deepStrictEqual(host.errors, []);
      } finally { await host.context.close(); }
    });
    await check("同一弹窗两次保存不同字段，第二次保存保留此前合并的远端手机号", async () => {
      const editor = await session(editorCookie);
      try {
        await editor.page.evaluate(() => openModal("同一表单连续保存", '<input id="continuousSaveDraft" value="未关闭的表单">', () => false));
        const snapshot = await api(hostCookie, "/api/store", undefined, "GET");
        const remote = JSON.parse(snapshot.nnuzc_students); remote[0].phone = "13900000009";
        await api(hostCookie, "/api/store/nnuzc_students", { value: JSON.stringify(remote), baseValue: snapshot.nnuzc_students }, "PUT");
        await editor.page.evaluate(async () => { students[0].name = "第一次本地保存"; persistStudents(); await workbench.legacy.flushStore(); });
        const first = await api(hostCookie, "/api/store", undefined, "GET");
        assert.strictEqual(JSON.parse(first.nnuzc_students)[0].phone, "13900000009", "第一次保存未合并远端手机号");
        await editor.page.evaluate(async () => { students[0].gender = "女"; persistStudents(); await workbench.legacy.flushStore(); });
        const second = JSON.parse((await api(hostCookie, "/api/store", undefined, "GET")).nnuzc_students)[0];
        assert.strictEqual(second.phone, "13900000009", "旧内存模型第二次提交回滚了已合并的远端手机号");
        assert.strictEqual(second.name, "第一次本地保存");
        assert.strictEqual(second.gender, "女");
        assert.strictEqual(await editor.page.inputValue("#continuousSaveDraft"), "未关闭的表单");
        assert.strictEqual(editor.navigations(), 0);
        assert.deepStrictEqual(editor.errors, []);
      } finally { await editor.context.close(); }
    });
    await check("读取中的旧远端快照晚于本机保存返回，不倒灌本机已保存值", async () => {
      const key = "nnuzc_collaboration_live_old_snapshot";
      await api(hostCookie, "/api/store/" + key, { value: '{"value":1}', baseValue: null }, "PUT");
      const host = await session(hostCookie);
      let release;
      try {
        let started;
        const hold = new Promise(resolve => { release = resolve; });
        const seen = new Promise(resolve => { started = resolve; });
        let first = true;
        await host.page.route("**/api/workbench/state?*", async route => {
          if (!first) return route.continue();
          first = false;
          const response = await route.fetch();
          started();
          await hold;
          await route.fulfill({ response });
        });
        await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error("未观察到轮询快照请求")), 10000))]);
        await host.page.evaluate(async key => { localStorage.setItem(key, '{"value":2}'); await workbench.legacy.flushStore(); }, key);
        release();
        await host.page.waitForTimeout(750);
        assert.deepStrictEqual(await host.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), { value: 2 }, "旧轮询响应覆盖了本机已确认的新数据");
        assert.strictEqual(host.navigations(), 0);
        assert.deepStrictEqual(host.errors, []);
      } finally { if (release) release(); await host.context.close(); }
    });
    await check("保存传输期间继续编辑，后续提交保留并发合并的远端字段", async () => {
      const key = "nnuzc_collaboration_live_inflight", base = '{"a":1,"b":1}';
      await api(hostCookie, "/api/store/" + key, { value: base, baseValue: null }, "PUT");
      const editor = await session(editorCookie);
      let release;
      try {
        let started;
        const hold = new Promise(resolve => { release = resolve; });
        const seen = new Promise(resolve => { started = resolve; });
        let first = true;
        await editor.page.route("**/api/store/batch", async route => {
          if (first && (route.request().postData() || "").includes(key)) { first = false; started(); await hold; }
          await route.continue();
        });
        await editor.page.evaluate(key => localStorage.setItem(key, '{"a":2,"b":1}'), key);
        await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error("未观察到第一批保存请求")), 10000))]);
        await editor.page.evaluate(key => localStorage.setItem(key, '{"a":2,"b":1,"c":4}'), key);
        await api(hostCookie, "/api/store/" + key, { value: '{"a":1,"b":3}', baseValue: base }, "PUT");
        release();
        await editor.page.evaluate(() => workbench.legacy.flushStore());
        const snapshot = await api(hostCookie, "/api/store", undefined, "GET");
        assert.deepStrictEqual(JSON.parse(snapshot[key]), { a: 2, b: 3, c: 4 }, "后续保存覆盖了合并成功的远端修改");
        assert.deepStrictEqual(await editor.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), { a: 2, b: 3, c: 4 });
        assert.strictEqual(editor.navigations(), 0);
        assert.deepStrictEqual(editor.errors, []);
      } finally { if (release) release(); await editor.context.close(); }
    });
    await check("远端任务、谈话、基础数据和宿舍资源批量变化同步到内存集合及当前列表", async () => {
      const host = await session(hostCookie);
      try {
        await host.page.evaluate(() => goto("tasks"));
        const snapshot = await api(editorCookie, "/api/store", undefined, "GET");
        const orgs = JSON.parse(snapshot.nnuzc_orgs); orgs.depts.push({ name: "新增同步学院", code: "SYNC" });
        const spatial = await host.page.evaluate(() => __DORM_SPATIAL__.getState());
        spatial.buildings.push({ id: "live-building", zone: "同步区", building: "同步楼", status: "active" });
        spatial.rooms.push({ id: "live-room", zone: "同步区", building: "同步楼", room: "101", bedCount: 4, status: "active" });
        const changes = {
          nnuzc_tasks: [{ id: "live-task", title: "远端同步任务", status: "待处理", priority: "常规", category: "学生事务", dueDate: "", repeat: "无" }],
          nnuzc_talks: [{ id: "live-talk", sid: baseStudent.id, content: "远端同步谈话", date: "2026-10-11", term: "2026-2027-1学期" }],
          nnuzc_orgs: orgs,
          nnuzc_dorm_spatial_v1: spatial,
          nnuzc_dorm_dist: [{ id: "live-dorm", studentId: baseStudent.id, accom: "走读", building: "", room: "", bed: "" }]
        };
        await api(editorCookie, "/api/store/batch", { operations: Object.entries(changes).map(([key, value]) => ({ key, method: "PUT", baseValue: snapshot[key] ?? null, value: JSON.stringify(value) })) });
        await host.page.waitForFunction(() => taskRecords.some(row => row.id === "live-task") && talkRecords.some(row => row.id === "live-talk") && ORG_DEPTS.some(row => row.name === "新增同步学院") && dormDistRecords.some(row => row.id === "live-dorm") && __DORM_SPATIAL__.getState().rooms.some(row => row.id === "live-room"), null, { timeout: 20000 });
        assert((await host.page.textContent("#content")).includes("远端同步任务"), "工作任务内存已更新，但当前任务列表未呈现");
        assert.strictEqual(await host.page.evaluate(() => currentView), "tasks");
        assert.strictEqual(host.navigations(), 0);
        assert.deepStrictEqual(host.errors, []);
      } finally { await host.context.close(); }
    });
    await check("commitStoreBatch 传输中暂停轮询应用，不覆盖正在提交的内存模型或重绘页面", async () => {
      const host = await session(hostCookie);
      let release;
      try {
        await host.page.evaluate(() => { goto("student"); stuQuery(); window.qaCommitSyncEvents = 0; window.addEventListener("workbench:synced", () => window.qaCommitSyncEvents++); });
        let started;
        const hold = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
        let first = true;
        await host.page.route("**/api/store/batch", async route => { if (first) { first = false; const response = await route.fetch(); started(); await hold; return route.fulfill({ response }); } await route.continue(); });
        await host.page.evaluate(() => {
          const baseValue = localStorage.getItem("nnuzc_students"); window.qaCommitCacheBefore = baseValue; window.qaCommitPhoneBefore = students[0].phone; students[0].gender = "男";
          window.qaDirectCommit = workbench.legacy.commitStoreBatch([{ key: "nnuzc_students", method: "PUT", baseValue, value: JSON.stringify(students) }]);
        });
        await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error("未观察到 commitStoreBatch 请求")), 10000))]);
        const snapshot = await api(editorCookie, "/api/store", undefined, "GET"), remote = JSON.parse(snapshot.nnuzc_students); remote[0].phone = "13900000008";
        await api(editorCookie, "/api/store/nnuzc_students", { value: JSON.stringify(remote), baseValue: snapshot.nnuzc_students }, "PUT");
        await host.page.waitForResponse(response => response.url().includes("/api/workbench/state?"), { timeout: 10000 });
        await host.page.waitForTimeout(200);
        const state = await host.page.evaluate(() => ({ busy: __workbenchStoreSync.busy(), gender: students[0].gender, phone: students[0].phone, beforePhone: window.qaCommitPhoneBefore, cache: localStorage.getItem("nnuzc_students"), beforeCache: window.qaCommitCacheBefore, redraws: window.qaCommitSyncEvents }));
        assert.strictEqual(state.gender, "男", "轮询覆盖了正在提交的学生内存模型");
        assert.strictEqual(state.phone, state.beforePhone, "保存响应仍在传输时轮询提前替换了内存模型");
        assert.strictEqual(state.cache, state.beforeCache, "保存响应仍在传输时轮询提前替换了当前缓存");
        assert.strictEqual(state.redraws, 0, "提交过程中协作轮询重绘了业务页面");
        release(); await host.page.evaluate(() => window.qaDirectCommit);
        const saved = JSON.parse((await api(hostCookie, "/api/store", undefined, "GET")).nnuzc_students)[0];
        assert.strictEqual(saved.gender, "男"); assert.strictEqual(saved.phone, "13900000008");
        await host.page.waitForFunction(() => students[0]?.gender === "男" && students[0]?.phone === "13900000008", null, { timeout: 15000 });
        assert.strictEqual(host.navigations(), 0);
        assert.deepStrictEqual(host.errors, []);
      } finally { if (release) release(); await host.page.evaluate(() => window.qaDirectCommit?.catch(() => {})).catch(() => {}); await host.context.close(); }
    });
    await check("两个显式批量提交连续发起，延迟首个响应不会回滚最新缓存", async () => {
      const key = "nnuzc_collaboration_direct_commits", base = '{"a":1,"b":1}';
      await api(hostCookie, "/api/store/" + key, { value: base, baseValue: null }, "PUT");
      const host = await session(hostCookie);
      let release;
      try {
        let started;
        const hold = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { started = resolve; });
        let first = true;
        await host.page.route("**/api/store/batch", async route => { if (first && (route.request().postData() || "").includes(key)) { first = false; const response = await route.fetch(); started(); await hold; return route.fulfill({ response }); } await route.continue(); });
        await host.page.evaluate(({ key, base }) => { window.qaDirectFirst = workbench.legacy.commitStoreBatch([{ key, method: "PUT", baseValue: base, value: '{"a":2,"b":1}' }]); }, { key, base });
        await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(Error("未观察到首个显式批量提交")), 10000))]);
        await host.page.evaluate(({ key, base }) => { window.qaDirectSecond = workbench.legacy.commitStoreBatch([{ key, method: "PUT", baseValue: base, value: '{"a":1,"b":3}' }]); }, { key, base });
        await host.page.waitForTimeout(250); release();
        await host.page.evaluate(() => Promise.all([window.qaDirectFirst, window.qaDirectSecond]));
        assert.deepStrictEqual(JSON.parse((await api(hostCookie, "/api/store", undefined, "GET"))[key]), { a: 2, b: 3 });
        assert.deepStrictEqual(await host.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), { a: 2, b: 3 }, "较早的保存响应覆盖了较新的合并缓存");
        assert.strictEqual(host.navigations(), 0);
        assert.deepStrictEqual(host.errors, []);
      } finally { if (release) release(); await host.page.evaluate(() => Promise.allSettled([window.qaDirectFirst, window.qaDirectSecond])).catch(() => {}); await host.context.close(); }
    });
    await check("远端修改公用版学业规则，主机当前页自动呈现新规则且不整页刷新", async () => {
      await api(hostCookie, "/api/store/nnuzc_term_list", { value: JSON.stringify(["2026-2027-1学期"]) }, "PUT");
      const host = await session(hostCookie);
      try {
        await host.page.evaluate(() => goto("academicPublic"));
        await host.page.waitForSelector("#ap-content table");
        await host.page.locator('[data-ap="tab"][data-arg="history"]').click();
        const scopeBefore = await host.page.locator("[data-ap-period]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.apPeriod));
        const state = await api(hostCookie, "/api/academic-public/state?term=2026-2027-1", undefined, "GET");
        const rules = { thresholds: [3, 5, 7, 9], enabled: [true, true, true, true], stage: "current", scope: "year", categories: [], rank: "original", passScore: 60, cetScore: 425, degreeScore: 60 };
        const preview = await api(hostCookie, "/api/academic-public/rule-preview", { version: state.version, rules });
        const saved = await api(hostCookie, "/api/academic-public/rules", { previewId: preview.previewId }, "PUT");
        try {
          await host.page.waitForFunction(version => {
            const first = document.querySelector(".ap-rule-summary > div");
            return first?.querySelector("b")?.textContent === "黄色预警" && /≥\s*3\s*门/.test(first.querySelector("p")?.textContent || "") && document.querySelector(".ap-calculation-note")?.textContent.includes("规则版本 " + version);
          }, saved.version, { timeout: 20000 });
        } catch (error) {
          console.error("academic sync diagnostics:", await host.page.evaluate(() => ({ summary: document.querySelector(".ap-rule-summary")?.textContent, context: document.querySelector(".ap-result-context")?.textContent, connection: document.getElementById("workbenchSaveStatus")?.textContent, error: document.getElementById("ap-error")?.textContent })));
          throw error;
        }
        assert.deepStrictEqual(await host.page.locator("[data-ap-period]:checked").evaluateAll(nodes => nodes.map(node => node.dataset.apPeriod)), scopeBefore, "远端规则更新不应改变用户当前选择的统计范围");
        assert.strictEqual(await host.page.evaluate(() => currentView), "academicPublic");
        assert.strictEqual(host.navigations(), 0);
        assert.deepStrictEqual(host.errors, []);
      } finally { await host.context.close(); }
    });
    await check("远端删除所有学生及任务数据键，内存名单与当前列表均清空", async () => {
      const host = await session(hostCookie);
      try {
        await host.page.evaluate(() => { goto("student"); stuQuery(); });
        assert(await host.page.evaluate(() => students.length > 0 && taskRecords.length > 0));
        const snapshot = await api(editorCookie, "/api/store", undefined, "GET");
        await api(editorCookie, "/api/store/batch", { operations: ["nnuzc_students", "nnuzc_tasks", "nnuzc_talks", "nnuzc_dorm_dist"].map(key => ({ key, method: "DELETE", baseValue: snapshot[key] ?? null })) });
        await host.page.waitForFunction(() => students.length === 0 && taskRecords.length === 0 && talkRecords.length === 0 && dormDistRecords.length === 0, null, { timeout: 20000 });
        assert.strictEqual(await host.page.locator("#stuTbody tr[data-sid]").count(), 0);
        assert.strictEqual(await host.page.evaluate(() => localStorage.getItem("nnuzc_tasks")), null);
        assert.strictEqual(host.navigations(), 0);
        assert.deepStrictEqual(host.errors, []);
      } finally { await host.context.close(); }
    });
  } finally { await browser.close(); }
  assert.strictEqual(failures.length, 0, failures.map(failure => failure.name + "\n" + failure.error).join("\n\n"));
  console.log("PASS: local multi-window synchronization regression suite.");
}).catch(error => { console.error(error); process.exitCode = 1; });
