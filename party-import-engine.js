(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PartyImportEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PARTY_STAGES = Object.freeze(["群众", "共青团员", "递交入党申请书", "入党积极分子", "发展对象", "中共预备党员", "中共党员"]);
  const PARTY_LEAGUE_STATUSES = Object.freeze(["团员", "非团员", "已推优", "保留团员的中共党员", "退团"]);
  const POLITICAL_OPTIONS = Object.freeze(["中共党员", "中共预备党员", "共青团员", "群众", "其他民主党派"]);
  const PARTY_TRAINING_LEVELS = Object.freeze(["初级党课", "中级党课", "高级党课"]);
  const PARTY_TRAINING_STATUSES = Object.freeze(["未参加", "培训中", "已结业", "未通过"]);
  const TRAINING_FIELDS = Object.freeze([
    { key: "primary", label: "初级党课", prefix: "primaryTraining" },
    { key: "intermediate", label: "中级党课", prefix: "intermediateTraining" },
    { key: "advanced", label: "高级党课", prefix: "advancedTraining" }
  ]);
  const IMPORT_FIELDS = Object.freeze([
    { key: "sid", label: "学号", required: true, aliases: ["学生学号", "学生编号", "编号"] },
    { key: "name", label: "姓名", aliases: ["学生姓名", "名字"] },
    { key: "political", label: "政治面貌", options: POLITICAL_OPTIONS },
    { key: "leagueStatus", label: "团员身份", options: PARTY_LEAGUE_STATUSES },
    { key: "stage", label: "当前发展阶段", aliases: ["当前阶段", "发展阶段"], options: PARTY_STAGES },
    { key: "date", label: "确定日期", aliases: ["日期"] },
    { key: "branch", label: "所属党支部", aliases: ["所属支部", "党支部"] },
    { key: "contact", label: "培养联系人", aliases: ["联系人"] },
    { key: "introducer", label: "入党介绍人", aliases: ["介绍人"] },
    { key: "materials", label: "材料状态", aliases: ["材料"] },
    { key: "note", label: "本次节点备注", aliases: ["节点备注", "备注"] },
    ...TRAINING_FIELDS.flatMap(item => [
      { key: `${item.prefix}Status`, label: `${item.label}状态`, options: PARTY_TRAINING_STATUSES },
      { key: `${item.prefix}Date`, label: `${item.label}日期`, aliases: [`${item.label}培训日期`, `${item.label}结业日期`] },
      { key: `${item.prefix}Organizer`, label: `${item.label}培训单位`, aliases: [`${item.label}组织单位`] },
      { key: `${item.prefix}Result`, label: `${item.label}培训结果`, aliases: [`${item.label}成绩`, `${item.label}证书编号`] }
    ])
  ]);
  const FIELD_LIMITS = Object.freeze(IMPORT_FIELDS.reduce((limits, field) => {
    limits[field.key] = /Date$/.test(field.key) || field.key === "date" ? 40 : /Status$/.test(field.key) ? 40 : /Organizer$/.test(field.key) ? 200 : /Result$/.test(field.key) ? 500 : ({ sid: 100, name: 100, political: 40, leagueStatus: 40, stage: 40, branch: 200, contact: 200, introducer: 200, materials: 500, note: 2000 }[field.key] || 500);
    return limits;
  }, {}));
  const WRITABLE_KEYS = Object.freeze(IMPORT_FIELDS.slice(2).map(field => field.key));

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function textValue(value, key, rowNumber, errors) {
    if (value == null) return "";
    if (typeof value !== "string" && typeof value !== "number") {
      errors.push({ row: rowNumber, field: key, msg: `「${fieldLabel(key)}」必须是文本。` });
      return "";
    }
    const text = String(value).trim();
    if (text.length > FIELD_LIMITS[key]) errors.push({ row: rowNumber, field: key, msg: `「${fieldLabel(key)}」长度不能超过 ${FIELD_LIMITS[key]} 个字符。` });
    return text;
  }

  function fieldLabel(key) {
    const field = IMPORT_FIELDS.find(item => item.key === key);
    return field ? field.label : key;
  }

  function normalizeDate(value) {
    const input = String(value == null ? "" : value).trim();
    if (!input) return { value: "", error: "" };
    if (/^\d+(?:\.\d+)?$/.test(input)) {
      const serial = Number(input);
      if (serial >= 1 && serial <= 2958465) {
        const millis = Math.round((serial - 25569) * 86400000);
        const date = new Date(millis);
        if (Number.isFinite(date.getTime())) return { value: date.toISOString().slice(0, 10), error: "" };
      }
    }
    const matched = input.match(/^(\d{4})[年/.-]?(\d{1,2})[月/.-]?(\d{1,2})日?$/);
    if (!matched) return { value: "", error: "确定日期格式无效，请使用 YYYY-MM-DD。" };
    const year = Number(matched[1]), month = Number(matched[2]), day = Number(matched[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { value: "", error: "确定日期不是有效的公历日期。" };
    return { value: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, error: "" };
  }

  function normalizeRows(rows, students) {
    if (!Array.isArray(rows)) throw new TypeError("导入数据必须是数组。");
    if (!Array.isArray(students)) throw new TypeError("学生数据必须是数组。");
    if (rows.length > 2000) throw new RangeError("单次最多导入 2000 行数据。");
    const byId = new Map(students.map(student => [String(student && student.id || "").trim(), student]));
    const seen = new Set(), errors = [], normalized = [];
    rows.forEach((raw, index) => {
      const rowNumber = index + 2;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push({ row: rowNumber, msg: "该行数据格式无效。" });
        return;
      }
      const row = {};
      IMPORT_FIELDS.forEach(field => { row[field.key] = textValue(raw[field.key], field.key, rowNumber, errors); });
      if (/^※/.test(row.sid)) return;
      if (!row.sid) errors.push({ row: rowNumber, field: "sid", msg: "学号不能为空。" });
      else if (seen.has(row.sid)) errors.push({ row: rowNumber, field: "sid", msg: `学号“${row.sid}”在文件中重复。` });
      else seen.add(row.sid);
      const student = byId.get(row.sid);
      if (row.sid && !student) errors.push({ row: rowNumber, field: "sid", msg: `学号“${row.sid}”在学生主档案中不存在。` });
      if (student && row.name && row.name !== String(student.name || "").trim()) errors.push({ row: rowNumber, field: "name", msg: `姓名“${row.name}”与学号“${row.sid}”对应的学生不一致。` });
      [["political", POLITICAL_OPTIONS], ["leagueStatus", PARTY_LEAGUE_STATUSES], ["stage", PARTY_STAGES]].concat(TRAINING_FIELDS.map(item => [`${item.prefix}Status`, PARTY_TRAINING_STATUSES])).forEach(([key, options]) => {
        if (row[key] && !options.includes(row[key])) errors.push({ row: rowNumber, field: key, msg: `「${fieldLabel(key)}」的值“${row[key]}”不在系统现有选项中，请从下拉列表选择。` });
      });
      const date = normalizeDate(row.date);
      if (date.error) errors.push({ row: rowNumber, field: "date", msg: date.error });
      else row.date = date.value;
      TRAINING_FIELDS.forEach(item => {
        const dateKey = `${item.prefix}Date`, statusKey = `${item.prefix}Status`;
        const trainingDate = normalizeDate(row[dateKey]);
        if (trainingDate.error) errors.push({ row: rowNumber, field: dateKey, msg: trainingDate.error.replace("确定日期", fieldLabel(dateKey)) });
        else row[dateKey] = trainingDate.value;
        const hasDetails = [`${item.prefix}Date`, `${item.prefix}Organizer`, `${item.prefix}Result`].some(key => row[key]);
        const currentTraining = student && student.party && student.party.training && student.party.training[item.key];
        const currentStatus = currentTraining && currentTraining.status;
        if (row[statusKey] === "未参加" && hasDetails) errors.push({ row: rowNumber, field: statusKey, msg: `「${item.label}」状态为“未参加”时，不能同时填写培训日期、单位或结果。` });
        else if (hasDetails && !row[statusKey] && (!PARTY_TRAINING_STATUSES.includes(currentStatus) || currentStatus === "未参加")) errors.push({ row: rowNumber, field: statusKey, msg: `填写「${item.label}」培训详情时，必须同时填写培训状态。` });
      });
      if (!WRITABLE_KEYS.some(key => row[key])) errors.push({ row: rowNumber, msg: "除学号、姓名外，至少填写一个需要导入的党团字段。" });
      normalized.push(row);
    });
    return { rows: normalized, errors };
  }

  function applyNormalizedRows(rows, students) {
    const next = clone(students), byId = new Map(next.map(student => [String(student && student.id || "").trim(), student]));
    rows.forEach(row => {
      const student = byId.get(row.sid);
      if (row.political) student.political = row.political;
      const current = student.party && typeof student.party === "object" && !Array.isArray(student.party) ? student.party : {};
      const party = Object.assign({}, current);
      party.history = Array.isArray(current.history) ? current.history.map(item => Object.assign({}, item)) : [];
      const currentTraining = current.training && typeof current.training === "object" && !Array.isArray(current.training) ? current.training : {};
      party.training = {};
      TRAINING_FIELDS.forEach(item => {
        const previous = currentTraining[item.key] && typeof currentTraining[item.key] === "object" && !Array.isArray(currentTraining[item.key]) ? currentTraining[item.key] : {};
        const nextTraining = {
          status: PARTY_TRAINING_STATUSES.includes(previous.status) ? previous.status : "未参加",
          date: String(previous.date || ""),
          organizer: String(previous.organizer || ""),
          result: String(previous.result || "")
        };
        [["Status", "status"], ["Date", "date"], ["Organizer", "organizer"], ["Result", "result"]].forEach(([suffix, key]) => {
          const imported = row[`${item.prefix}${suffix}`];
          if (imported) nextTraining[key] = imported;
        });
        if (row[`${item.prefix}Status`] === "未参加") Object.assign(nextTraining, { date: "", organizer: "", result: "" });
        party.training[item.key] = nextTraining;
      });
      if (!party.leagueStatus) party.leagueStatus = student.political === "共青团员" ? "团员" : "非团员";
      if (row.leagueStatus) party.leagueStatus = row.leagueStatus;
      const hasNodeDetail = ["stage", "date", "branch", "contact", "introducer", "materials", "note"].some(key => row[key]);
      if (hasNodeDetail) {
        const politicalStage = PARTY_STAGES.includes(student.political) ? student.political : "";
        const targetStage = row.stage || String(party.stage || "").trim() || politicalStage || (party.leagueStatus === "团员" ? "共青团员" : "群众");
        const sameStage = String(party.stage || "").trim() === targetStage;
        const existingIndex = party.history.findIndex(item => item && String(item.stage || "").trim() === targetStage);
        const existingNode = existingIndex >= 0 ? party.history[existingIndex] : {};
        const node = Object.assign({}, existingNode, { stage: targetStage });
        ["date", "branch", "contact", "introducer", "materials", "note"].forEach(key => {
          if (row[key]) node[key] = row[key];
          else if (!sameStage && existingIndex < 0) node[key] = "";
        });
        if (existingIndex >= 0) party.history[existingIndex] = node;
        else party.history.push(node);
        party.stage = targetStage;
        ["date", "branch", "contact", "introducer", "materials", "note"].forEach(key => {
          if (row[key]) party[key] = row[key];
        });
      }
      student.party = party;
    });
    return next;
  }

  function prepareImport(rows, students) {
    const checked = normalizeRows(rows, students);
    if (checked.errors.length) return { validRows: [], errors: checked.errors, students: clone(students) };
    return { validRows: checked.rows, errors: [], students: applyNormalizedRows(checked.rows, students) };
  }

  return Object.freeze({ PARTY_STAGES, PARTY_LEAGUE_STATUSES, POLITICAL_OPTIONS, PARTY_TRAINING_LEVELS, PARTY_TRAINING_STATUSES, TRAINING_FIELDS, IMPORT_FIELDS, normalizeDate, prepareImport });
});
