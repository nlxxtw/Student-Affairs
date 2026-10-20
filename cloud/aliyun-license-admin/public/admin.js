"use strict";

const state = { csrf: "", user: "", licenses: [], stats: {}, currentDeviceLicense: null, createdItems: [], revealedCodes: Object.create(null) };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) { return String(value === null || value === undefined ? "" : value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function formatDate(value, dateOnly = false) { if (!value) return "长期有效"; const date = new Date(Number(value)); return Number.isNaN(date.getTime()) ? "-" : dateOnly ? date.toLocaleDateString("zh-CN") : date.toLocaleString("zh-CN", { hour12: false }); }
function toast(message) { const item = $("#toast"); item.textContent = message; item.classList.add("show"); window.setTimeout(() => item.classList.remove("show"), 2600); }
function customerHtml(item) {
  const name = item.customerName || item.customer || "未填写";
  const contacts = [];
  if (item.customerXhsId) contacts.push(`<span><i>小红书</i>${escapeHtml(item.customerXhsId)}</span>`);
  if (item.customerWechat) contacts.push(`<span><i>微信</i>${escapeHtml(item.customerWechat)}</span>`);
  return `<div class="customer-info"><b>${escapeHtml(name)}</b>${contacts.join("")}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</div>`;
}
async function copyText(value) {
  const text = String(value || "");
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const input = document.createElement("textarea"); input.value = text; input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0"; document.body.appendChild(input); input.select();
  try { if (!document.execCommand("copy")) throw new Error("复制失败"); }
  finally { input.remove(); }
}

async function api(path, options = {}) {
  const config = Object.assign({ method: "GET", credentials: "same-origin", headers: {} }, options);
  if (config.body && typeof config.body !== "string") { config.headers["Content-Type"] = "application/json"; config.body = JSON.stringify(config.body); }
  if (config.method !== "GET" && state.csrf) config.headers["X-CSRF-Token"] = state.csrf;
  const response = await fetch(path, config);
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401 && path !== "/v1/admin/login") showLogin();
    const error = new Error(result && result.error || `请求失败（${response.status}）`); error.code = result && result.code; throw error;
  }
  return result;
}

function showLogin() { $("#adminView").classList.add("hidden"); $("#loginView").classList.remove("hidden"); state.csrf = ""; state.licenses = []; state.stats = {}; state.revealedCodes = Object.create(null); }
function showAdmin() { $("#loginView").classList.add("hidden"); $("#adminView").classList.remove("hidden"); $("#currentUser").textContent = state.user; }

async function boot() {
  try { const me = await api("/v1/admin/me"); state.csrf = me.csrf; state.user = me.user; showAdmin(); await loadLicenses(); }
  catch (_error) { showLogin(); }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#loginError").textContent = "";
  const button = event.submitter; button.disabled = true;
  try {
    const result = await api("/v1/admin/login", { method: "POST", body: { username: $("#loginUsername").value.trim(), password: $("#loginPassword").value } });
    state.csrf = result.csrf; state.user = result.user; $("#loginPassword").value = ""; showAdmin(); await loadLicenses();
  } catch (error) { $("#loginError").textContent = error.message; }
  finally { button.disabled = false; }
});

async function loadLicenses() {
  const params = new URLSearchParams(); const query = $("#searchInput").value.trim(); const status = $("#statusFilter").value;
  if (query) params.set("query", query); if (status) params.set("status", status);
  const result = await api(`/v1/admin/licenses?${params}`); state.licenses = result.licenses; state.stats = result.stats; const visibleIds = new Set(result.licenses.map((item) => item.id)); for (const id of Object.keys(state.revealedCodes)) if (!visibleIds.has(id)) delete state.revealedCodes[id]; renderLicenses(result);
}

async function revealLicenseCode(item) {
  if (state.revealedCodes[item.id]) return state.revealedCodes[item.id];
  const result = await api(`/v1/admin/licenses/${item.id}/code/reveal`, { method: "POST", body: {} });
  state.revealedCodes[item.id] = result.code;
  renderLicenses({ licenses: state.licenses, stats: state.stats });
  return result.code;
}

function activationCodeHtml(item) {
  if (!item.codeAvailable) return `<span class="code-unavailable" title="旧版接口仅保存不可逆哈希；该授权已被强制停用且不能恢复">旧接口生成 · 明文不可恢复</span>`;
  const code = state.revealedCodes[item.id];
  return `<div class="license-code-wrap"><code class="license-code ${code ? "revealed" : "masked"}">${code ? escapeHtml(code) : "•••••-•••••-•••••-•••••"}</code><div class="code-actions"><button type="button" data-action="${code ? "hide-code" : "show-code"}" data-id="${escapeHtml(item.id)}">${code ? "隐藏" : "显示"}</button><button type="button" data-action="copy-code" data-id="${escapeHtml(item.id)}">复制</button></div></div>`;
}

function renderLicenses(result) {
  $("#statTotal").textContent = result.stats.total; $("#statActive").textContent = result.stats.active; $("#statRevoked").textContent = result.stats.revoked; $("#statDevices").textContent = result.stats.boundDevices;
  $("#emptyLicenses").classList.toggle("hidden", result.licenses.length > 0);
  $("#licenseRows").innerHTML = result.licenses.map((item) => `<tr>
    <td class="license-id-cell" data-label="授权编号"><div class="license-id-wrap"><code class="license-id">${escapeHtml(item.id)}</code><button type="button" class="copy-button" data-action="copy-id" data-id="${escapeHtml(item.id)}">复制</button></div></td>
    <td class="license-code-cell" data-label="激活码">${activationCodeHtml(item)}</td>
    <td data-label="客户信息">${customerHtml(item)}</td>
    <td data-label="状态"><span class="badge ${item.status}">${item.status === "active" ? "正常" : "已停用"}</span></td>
    <td data-label="设备"><button type="button" data-action="devices" data-id="${escapeHtml(item.id)}">${item.activeDevices}/${item.maxDevices} 台</button></td>
    <td data-label="有效期">${escapeHtml(formatDate(item.expiresAt, true))}</td><td data-label="更新时间">${escapeHtml(formatDate(item.updatedAt))}</td>
    <td data-label="操作"><div class="row-actions"><button type="button" data-action="edit" data-id="${escapeHtml(item.id)}">编辑</button>${item.codeAvailable ? `<button type="button" class="${item.status === "active" ? "danger" : ""}" data-action="${item.status === "active" ? "revoke" : "restore"}" data-id="${escapeHtml(item.id)}">${item.status === "active" ? "停用" : "恢复"}</button>` : `<button type="button" disabled title="历史授权已强制停用且不能恢复">强制停用</button>`}<button type="button" class="danger" data-action="delete" data-id="${escapeHtml(item.id)}">删除</button></div></td>
  </tr>`).join("");
}

$("#licenseRows").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]"); if (!button) return;
  const item = state.licenses.find((license) => license.id === button.dataset.id); if (!item) return;
  if (button.dataset.action === "copy-id") { try { await copyText(item.id); toast("授权编号已复制"); } catch (_error) { window.alert("复制失败，请长按编号手动复制"); } return; }
  if (button.dataset.action === "show-code") { try { await revealLicenseCode(item); toast("激活码已显示，查看操作已记录"); } catch (error) { window.alert(error.message); } return; }
  if (button.dataset.action === "hide-code") { delete state.revealedCodes[item.id]; renderLicenses({ licenses: state.licenses, stats: state.stats }); return; }
  if (button.dataset.action === "copy-code") { try { await copyText(await revealLicenseCode(item)); toast("激活码已复制，查看操作已记录"); } catch (error) { window.alert(error.message); } return; }
  if (button.dataset.action === "devices") return openDevices(item);
  if (button.dataset.action === "edit") return openEdit(item);
  if (button.dataset.action === "delete") {
    const confirmation = window.prompt(`将永久删除授权 ${item.id}。\n客户：${item.customerName || item.customer || "未填写"}\n已绑定设备：${item.activeDevices}台。删除后不可恢复，对应设备下次联网验证将失效。\n\n请输入“删除”确认：`, "");
    if (confirmation !== "删除") return;
    button.disabled = true;
    try { await api(`/v1/admin/licenses/${item.id}`, { method: "DELETE", body: {} }); delete state.revealedCodes[item.id]; toast("授权记录已删除"); await loadLicenses(); }
    catch (error) { window.alert(error.message); }
    finally { button.disabled = false; }
    return;
  }
  if (button.dataset.action === "revoke" || button.dataset.action === "restore") {
    const next = button.dataset.action; const label = next === "revoke" ? "停用" : "恢复";
    if (!window.confirm(`确认${label}授权 ${item.id}？`)) return;
    button.disabled = true;
    try { await api(`/v1/admin/licenses/${item.id}/${next}`, { method: "POST", body: {} }); toast(`${label}成功`); await loadLicenses(); }
    catch (error) { window.alert(error.message); }
    finally { button.disabled = false; }
  }
});

function openDevices(item) {
  state.currentDeviceLicense = item.id; $("#deviceLicenseId").textContent = `${item.id} · ${item.customer || "未填写客户"}`;
  $("#deviceList").innerHTML = item.devices.length ? item.devices.map((device) => `<article class="device-card"><div><b>槽位${device.slot} · ${escapeHtml(device.name)}</b><small>激活：${escapeHtml(formatDate(device.activatedAt))}<br>最后验证：${escapeHtml(formatDate(device.lastSeenAt))}</small></div><button class="danger" data-slot="${device.slot}">解除绑定</button></article>`).join("") : `<div class="empty">暂无绑定设备</div>`;
  $("#deviceDialog").showModal();
}

$("#deviceList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-slot]"); if (!button || !state.currentDeviceLicense) return;
  if (!window.confirm(`确认解除槽位${button.dataset.slot}的设备？该设备下次联网验证后将失效。`)) return;
  button.disabled = true;
  try { await api(`/v1/admin/licenses/${state.currentDeviceLicense}/devices/${button.dataset.slot}/deactivate`, { method: "POST", body: {} }); toast("设备已解除绑定"); await loadLicenses(); const fresh = state.licenses.find((item) => item.id === state.currentDeviceLicense); if (fresh) openDevices(fresh); }
  catch (error) { window.alert(error.message); }
  finally { button.disabled = false; }
});

function openEdit(item) {
  const form = $("#editForm"); form.elements.id.value = item.id; form.elements.customerName.value = item.customerName || item.customer || ""; form.elements.customerXhsId.value = item.customerXhsId || ""; form.elements.customerWechat.value = item.customerWechat || ""; form.elements.maxDevices.value = item.maxDevices; form.elements.expiresAt.value = item.expiresAt ? new Date(item.expiresAt).toISOString().slice(0, 10) : ""; form.elements.note.value = item.note || ""; $("#editError").textContent = ""; $("#editDialog").showModal();
}

$("#editForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const button = event.submitter; button.disabled = true; $("#editError").textContent = "";
  try { const date = form.elements.expiresAt.value; await api(`/v1/admin/licenses/${form.elements.id.value}`, { method: "PATCH", body: { customerName: form.elements.customerName.value, customerXhsId: form.elements.customerXhsId.value, customerWechat: form.elements.customerWechat.value, maxDevices: Number(form.elements.maxDevices.value), expiresAt: date ? new Date(`${date}T23:59:59+08:00`).getTime() : null, note: form.elements.note.value } }); $("#editDialog").close(); toast("授权信息已更新"); await loadLicenses(); }
  catch (error) { $("#editError").textContent = error.message; }
  finally { button.disabled = false; }
});

$("#createButton").addEventListener("click", () => { $("#createError").textContent = ""; $("#createDialog").showModal(); });
$("#createForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const button = event.submitter; button.disabled = true; $("#createError").textContent = "";
  try {
    const date = form.elements.expiresAt.value;
    const result = await api("/v1/admin/licenses/batch", { method: "POST", body: { count: Number(form.elements.count.value), maxDevices: Number(form.elements.maxDevices.value), customerName: form.elements.customerName.value, customerXhsId: form.elements.customerXhsId.value, customerWechat: form.elements.customerWechat.value, expiresAt: date ? new Date(`${date}T23:59:59+08:00`).getTime() : null, note: form.elements.note.value } });
    state.createdItems = result.items; downloadCodes(result.items); $("#createDialog").close(); showCreatedCodes(result.items); toast(`已生成${result.count}个激活码`); await loadLicenses();
  } catch (error) { $("#createError").textContent = error.message; }
  finally { button.disabled = false; }
});

function csvValue(value) { const text = String(value || ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function downloadCodes(items) {
  const rows = [["激活码", "授权编号", "客户姓名", "小红书ID", "微信名或微信号", "设备上限", "到期时间", "备注"]];
  for (const item of items) rows.push([item.code, item.license.id, item.license.customerName || item.license.customer, item.license.customerXhsId, item.license.customerWechat, item.license.maxDevices, item.license.expiresAt ? new Date(item.license.expiresAt).toISOString() : "", item.license.note]);
  const blob = new Blob(["\uFEFF" + rows.map((row) => row.map(csvValue).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `数智学工激活码-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function showCreatedCodes(items) {
  $("#createdCodesList").innerHTML = items.map((item, index) => `<article class="created-code-card">
    <header><small>${escapeHtml(item.license.customerName || item.license.customer || `第${index + 1}个授权`)} · ${escapeHtml(item.license.id)}</small><button type="button" class="copy-button" data-copy-code="${index}">复制</button></header>
    <code class="created-code">${escapeHtml(item.code)}</code>
  </article>`).join("");
  $("#createdCodesDialog").showModal();
}

$("#createdCodesList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-copy-code]"); if (!button) return;
  const item = state.createdItems[Number(button.dataset.copyCode)]; if (!item) return;
  try { await copyText(item.code); toast("激活码已复制"); } catch (_error) { window.alert("复制失败，请长按激活码手动复制"); }
});
$("#copyAllCodesButton").addEventListener("click", async () => {
  try { await copyText(state.createdItems.map((item) => item.code).join("\n")); toast(`已复制${state.createdItems.length}个激活码`); }
  catch (_error) { window.alert("复制失败，请逐个长按激活码复制"); }
});
$("#downloadCreatedCodesButton").addEventListener("click", () => { if (state.createdItems.length) { downloadCodes(state.createdItems); toast("CSV已下载"); } });
$("#createdCodesDialog").addEventListener("close", () => { state.createdItems = []; $("#createdCodesList").replaceChildren(); });

$("#searchButton").addEventListener("click", () => loadLicenses().catch((error) => window.alert(error.message)));
$("#searchInput").addEventListener("keydown", (event) => { if (event.key === "Enter") loadLicenses().catch((error) => window.alert(error.message)); });
$("#exportButton").addEventListener("click", () => { const params = new URLSearchParams(); if ($("#searchInput").value.trim()) params.set("query", $("#searchInput").value.trim()); if ($("#statusFilter").value) params.set("status", $("#statusFilter").value); window.location.href = `/v1/admin/licenses/export.csv?${params}`; });
$("#logoutButton").addEventListener("click", async () => { try { await api("/v1/admin/logout", { method: "POST", body: {} }); } finally { showLogin(); } });

async function loadAudit() {
  const result = await api("/v1/admin/audit?limit=300");
  $("#auditRows").innerHTML = result.events.map((item) => `<tr><td data-label="时间">${escapeHtml(formatDate(item.createdAt))}</td><td data-label="操作"><b>${escapeHtml(actionLabel(item.action))}</b></td><td data-label="管理员">${escapeHtml(item.actor)}</td><td data-label="授权编号"><code>${escapeHtml(item.licenseId)}</code></td><td data-label="来源IP">${escapeHtml(item.sourceIp)}</td><td data-label="详情">${escapeHtml(JSON.stringify(item.detail || {}))}</td></tr>`).join("");
}
function actionLabel(action) { return ({ ADMIN_LOGIN_SUCCESS:"登录成功", ADMIN_LOGIN_FAILED:"登录失败", ADMIN_LOGOUT:"退出登录", LICENSE_BATCH_CREATED:"批量生成", LICENSE_CODE_VIEWED:"查看激活码", LICENSE_UPDATED:"修改授权", LICENSE_REVOKED:"停用授权", LICENSE_RESTORED:"恢复授权", LICENSE_DELETED:"删除授权", DEVICE_DEACTIVATED:"设备解绑", LICENSE_LEGACY_FORCED_REVOKED:"历史授权强制停用", LICENSE_LEGACY_REVOCATION_COMPLETED:"历史授权停用汇总" })[action] || action; }
$$('.nav-item').forEach((button) => button.addEventListener("click", async () => { $$('.nav-item').forEach((item) => item.classList.toggle("active", item === button)); const audit = button.dataset.tab === "audit"; $("#licensesPanel").classList.toggle("hidden", audit); $("#auditPanel").classList.toggle("hidden", !audit); $("#pageTitle").textContent = audit ? "操作日志" : "授权管理"; if (audit) await loadAudit().catch((error) => window.alert(error.message)); }));
$("#refreshAuditButton").addEventListener("click", () => loadAudit().catch((error) => window.alert(error.message)));
$$('[data-close]').forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));

boot();
