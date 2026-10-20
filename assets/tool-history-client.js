(function (global) {
  "use strict";

  // Bind both embedded and standalone tools to their opening identity.
  // The public fingerprint is not an authentication token.
  let toolSession = global.__WORKBENCH_TOOL_SESSION__ || global.SESSION || {};
  let embedded = false;
  try {
    if (global.parent !== global && global.parent.SESSION) { toolSession = global.parent.SESSION; embedded = true; }
  } catch (_error) {}
  const toolContext = toolSession.context || "";
  // Keep the opening identity even if another tab logs in or clears its cache.
  const toolUid = toolSession.uid || "";
  const sessionKind = toolSession.role === 'sa' || toolUid === 'local-super-admin' ? 'host' : 'unknown';
  const loginUrl = '/login.html';
  if (toolContext && !global.__workbenchStoreSync) {
    function lockTool(reason) {
      if (embedded) { try { if (global.parent.__workbenchLockSession) global.parent.__workbenchLockSession(reason); } catch (_error) {} return; }
      if (global.__WORKBENCH_TOOL_SESSION_INVALID__) return;
      global.__WORKBENCH_TOOL_SESSION_INVALID__ = true;
      function mount() {
        [...document.body.children].forEach(function (el) { if (!['SCRIPT', 'STYLE'].includes(el.tagName)) { el.inert = true; el.hidden = true; el.style.setProperty('display', 'none', 'important'); } });
        const root = document.createElement('section'); root.id = 'toolSessionLock'; root.setAttribute('role', 'alertdialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'toolSessionLockTitle');
        root.style.cssText = 'position:fixed;inset:0;z-index:100100;background:#f2f5f7;color:#23453b;display:grid;place-content:center;gap:16px;padding:28px;font:17px system-ui';
        const title = document.createElement('h2'); title.id = 'toolSessionLockTitle';
        const note = document.createElement('p');
        if (sessionKind === 'host') {
          title.textContent = '主机会话已失效';
          note.textContent = '主机会话已过期、已退出或主机服务已重启。工具页面已锁定，请返回主机入口重新进入；已保存的历史和文件仍保留。';
        } else {
          title.textContent = '会话已失效';
          note.textContent = '工具页面已锁定，请返回工作台入口重新进入；已保存的历史和文件仍保留。';
        }
        const login = document.createElement('a'); login.href = loginUrl; login.textContent = sessionKind === 'host' ? '返回主机入口' : '重新登录工作台';
        root.append(title, note, login); document.body.appendChild(root);
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
    }
    const originalFetch = global.fetch.bind(global);
    global.fetch = async function (input, options) {
      const target = new URL(typeof input === "string" ? input : input && input.url || String(input), global.location.href);
      let init = options;
      if (target.origin === global.location.origin && target.pathname.startsWith("/api/")) {
        init = Object.assign({}, options || {});
        const headers = new Headers(init.headers || input && input.headers || {});
        headers.set("X-Workbench-Context", toolContext);
        init.headers = headers;
      }
      const response = await originalFetch(input, init);
      if (response.status === 401 && response.headers.get("X-Workbench-Session") === "invalid") {
        lockTool();
      }
      return response;
    };
    global.addEventListener('storage', function (event) {
      if (event.key !== 'nnuzc_session') return;
      let next; try { next = JSON.parse(event.newValue || 'null'); } catch (_error) {}
      if (!next || next.context !== toolContext || next.uid !== toolUid) lockTool();
    });
    // Standalone tools have no main-page session poll to detect revocations.
    if (!embedded) {
      let checking = false;
      async function checkSession() {
        if (checking || document.hidden || global.__WORKBENCH_TOOL_SESSION_INVALID__) return;
        checking = true;
        try {
          const response = await global.fetch('/api/auth/status', { cache: 'no-store' });
          if (response.ok) { const status = await response.json(); if (!status.authenticated) lockTool(); }
        } catch (_error) { /* Network loss alone does not prove revoked access. */ }
        finally { checking = false; }
      }
      global.setInterval(checkSession, 4000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) checkSession(); });
    }
  }

  const TOOL_SLUGS = Object.freeze({
    excelMerge: "excel_merge",
    excelCheck: "excel_check",
    dataMatch: "data_match",
    customRoster: "custom_roster",
    academicSummary: "academic_summary",
    academicAnalysis: "academic_analysis"
  });

  function slug(tool) {
    const value = TOOL_SLUGS[tool];
    if (!value) throw new Error("不支持的工具历史类型。");
    return value;
  }

  function safeId(value) {
    const normalized = String(value || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 96);
    if (!normalized) throw new Error("历史记录标识无效。");
    return normalized;
  }

  function indexKey(tool) { return "nnuzc_tool_history_index_" + slug(tool) + "_v1"; }
  function recordKey(tool, id) { return "nnuzc_tool_history_record_" + slug(tool) + "_" + safeId(id) + "_v1"; }

  async function responseJson(response, fallback) {
    const value = await response.json().catch(function () { return fallback || {}; });
    if (!response.ok) { const error = new Error(value && value.error || ("历史记录服务返回 " + response.status)); error.status = response.status; error.code = value && value.code; throw error; }
    return value;
  }

  async function readValue(key) {
    const response = await fetch("/api/store/" + encodeURIComponent(key), { cache: "no-store" });
    const result = await responseJson(response);
    const base = result.value == null ? null : result.value;
    if (base == null || base === "") return { base: base, value: null };
    try { return { base: base, value: JSON.parse(base) }; }
    catch (_error) { throw new Error("历史记录数据格式损坏。"); }
  }

  async function getValue(key) { return (await readValue(key)).value; }

  function equal(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
  }

  // Confirm only the requested changes; independently added index entries may remain.
  function changesPresent(base, current, proposed) {
    if (equal(base, proposed) || equal(current, proposed)) return true;
    if (base === undefined && Array.isArray(current) && Array.isArray(proposed)) base = [];
    else if (base === undefined && current && proposed && typeof current === "object" && typeof proposed === "object" && !Array.isArray(current) && !Array.isArray(proposed)) base = {};
    if ([base, current, proposed].every(value => value && typeof value === "object" && !Array.isArray(value))) {
      return [...new Set([...Object.keys(base), ...Object.keys(proposed)])].every(key => changesPresent(base[key], current[key], proposed[key]));
    }
    if ([base, current, proposed].every(Array.isArray) && [base, current, proposed].every(rows => rows.every(row => row && typeof row.id === "string") && new Set(rows.map(row => row.id)).size === rows.length)) {
      const maps = [base, current, proposed].map(rows => new Map(rows.map(row => [row.id, row])));
      return [...new Set([...maps[0].keys(), ...maps[2].keys()])].every(id => changesPresent(maps[0].get(id), maps[1].get(id), maps[2].get(id)));
    }
    return false;
  }

  async function writeValues(operations) {
    let saved;
    try {
      const response = await fetch("/api/store/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations: operations })
      });
      if (!response.ok) await responseJson(response);
      saved = await response.json();
      if (!saved || !saved.storeValues) throw new Error("主机保存响应格式无效。");
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
      // A missing acknowledgement does not prove rollback. Do not retry with a
      // freshly read baseline, which could overwrite a competing edit.
      error.commitUncertain = true;
      try {
        const states = await Promise.all(operations.map(operation => readValue(operation.key)));
        if (!operations.every((operation, i) => changesPresent(operation.baseValue == null ? undefined : JSON.parse(operation.baseValue), states[i].base == null ? undefined : states[i].value, operation.method === "DELETE" ? undefined : JSON.parse(operation.value)))) throw error;
        saved = { ok: true, confirmedByRead: true, storeValues: Object.fromEntries(operations.map((operation, i) => [operation.key, states[i].base])) };
      } catch (_verificationError) {
        error.message = "保存结果暂时无法确认；请恢复连接后查看历史，勿重复覆盖。已上传文件保留待核对。";
        throw error;
      }
    }
    if (global.workbench && global.workbench.legacy && global.workbench.legacy.applyServerStoreSnapshot) global.workbench.legacy.applyServerStoreSnapshot(saved.storeValues);
    return saved;
  }

  function validIndexItem(item) {
    return !!(item && typeof item === "object" && typeof item.id === "string" && typeof item.storageKey === "string");
  }

  async function readIndex(tool) {
    const state = await readValue(indexKey(tool));
    state.rows = Array.isArray(state.value) ? state.value.filter(validIndexItem).sort(function (left, right) {
      return String(right.at || "").localeCompare(String(left.at || ""));
    }) : [];
    return state;
  }

  async function list(tool) { return (await readIndex(tool)).rows; }

  async function get(tool, id) {
    const records = await list(tool);
    const meta = records.find(function (item) { return item.id === String(id); });
    if (!meta) return null;
    const value = await getValue(meta.storageKey);
    return value && typeof value === "object" ? value : null;
  }

  async function uploadFile(file) {
    const blob = file && file.blob;
    if (!(blob instanceof Blob) || !blob.size) throw new Error("历史文件为空，无法保存。");
    const name = String(file.name || "工具运行结果").slice(0, 120);
    const response = await fetch("/api/attachments?name=" + encodeURIComponent(name), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob
    });
    const saved = await responseJson(response);
    return {
      id: saved.id,
      name: saved.name || name,
      size: Number(saved.size || blob.size),
      url: saved.url,
      mime: String(file.mime || blob.type || "application/octet-stream"),
      role: String(file.role || "output")
    };
  }

  async function deleteFile(file) {
    if (!file || !file.id) return;
    const response = await fetch("/api/attachments/" + encodeURIComponent(file.id), { method: "DELETE" });
    if (!response.ok && response.status !== 404) await responseJson(response);
  }

  async function save(tool, record, fileSpecs) {
    if (!record || typeof record !== "object") throw new Error("历史记录内容无效。");
    const id = String(record.id || (global.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()));
    const key = recordKey(tool, id), oldState = await readValue(key), oldRecord = oldState.value;
    const recordBase = oldState.base;
    const uploaded = [];
    try {
      for (const file of Array.isArray(fileSpecs) ? fileSpecs : []) uploaded.push(await uploadFile(file));
      const value = Object.assign({}, record, { id: id, at: record.at || new Date().toISOString(), attachments: uploaded.length ? uploaded : (Array.isArray(record.attachments) ? record.attachments : []) });
      const indexState = await readIndex(tool), index = indexState.rows, meta = {
        id: id,
        at: value.at,
        title: String(value.title || "运行记录").slice(0, 180),
        summary: String(typeof value.summary === "string" ? value.summary : (value.summaryText || "")).slice(0, 1000),
        storageKey: key,
        attachments: value.attachments
      };
      await writeValues([
        { key: key, method: "PUT", baseValue: recordBase, value: JSON.stringify(value) },
        { key: indexKey(tool), method: "PUT", baseValue: indexState.base, value: JSON.stringify([meta].concat(index.filter(function (item) { return item.id !== id; }))) }
      ]);
      const oldFiles = oldRecord && Array.isArray(oldRecord.attachments) ? oldRecord.attachments : [];
      for (const file of oldFiles) if (!value.attachments.some(function (current) { return current.id === file.id; })) await deleteFile(file).catch(function () {});
      return value;
    } catch (error) {
      if (!error.commitUncertain) for (const file of uploaded) await deleteFile(file).catch(function () {});
      // Only a definitive rejection permits cleanup; uncertain commits keep files.
      throw error;
    }
  }

  async function remove(tool, id) {
    const indexState = await readIndex(tool), index = indexState.rows, meta = index.find(function (item) { return item.id === String(id); });
    if (!meta) return false;
    const indexBase = indexState.base;
    const recordState = await readValue(meta.storageKey), record = recordState.value;
    await writeValues([
      { key: indexKey(tool), method: "PUT", baseValue: indexBase, value: JSON.stringify(index.filter(function (item) { return item.id !== String(id); })) },
      { key: meta.storageKey, method: "DELETE", baseValue: recordState.base }
    ]);
    for (const file of record && Array.isArray(record.attachments) ? record.attachments : (meta.attachments || [])) await deleteFile(file).catch(function () {});
    return true;
  }

  async function clear(tool) {
    const index = await list(tool);
    // 逐条原子删除，避开批次大小限制；同时新增的其他记录不会被整表清掉。
    for (const meta of index) await remove(tool, meta.id);
    const state = await readIndex(tool);
    if (state.base && Array.isArray(state.value) && state.value.length === 0) {
      try { await writeValues([{ key: indexKey(tool), method: "DELETE", baseValue: state.base }]); }
      catch (error) { if (error.code !== "COLLABORATION_CONFLICT") throw error; }
    }
    return index.length;
  }

  function download(file) {
    if (!file || !file.url) throw new Error("历史文件不存在。");
    const anchor = document.createElement("a");
    anchor.href = file.url;
    anchor.download = file.name || "工具运行结果";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  global.ToolHistory = Object.freeze({ list: list, get: get, save: save, remove: remove, clear: clear, download: download });
})(window);
