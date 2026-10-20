"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const kit = require(path.join(root, "scripts", "generate-update-social-kit.cjs"));

const notes = kit.splitNotes("新增助学贷款独立台账；学生导入改为以班级维护信息为权威来源；就业意向名单自动同步学生管理中已填写毕业年份的学生。");
assert.strictEqual(notes.length, 3, "更新日志应按分号拆分为独立宣传要点");
const v531Notes = kit.splitNotes("基础数据维护调整至学生信息管理；新增、编辑或导入学生时，可确认自动补齐未维护的学院、专业、班级、年级和招生类别，并校验层级冲突；移除旧的定期备份弹窗提醒及遗留配置。");
assert.strictEqual(kit.noteTitle(v531Notes[0], 0), "基础数据维护入口调整至学生信息管理");
assert.strictEqual(kit.noteTitle(v531Notes[1], 1), "学生建档可确认自动补齐基础数据");
assert.strictEqual(kit.noteTitle(v531Notes[2], 2), "取消旧定期备份弹窗提醒");
assert.strictEqual(kit.summarizeTopics(v531Notes), "基础数据入口、建档自动补齐、备份提醒优化");
const v541Notes = kit.splitNotes("课表支持学院、专业、年级和班级复选筛选与级联查询；课表支持多学期同一教学周汇总；课表支持按筛选结果导出。");
assert.strictEqual(kit.noteTitle(v541Notes[0], 0), "课表组织条件支持多选级联筛选");
assert.strictEqual(kit.noteTitle(v541Notes[1], 1), "多学期同一教学周集中汇总");
assert.strictEqual(kit.noteTitle(v541Notes[2], 2), "按当前筛选结果导出课表");
assert.strictEqual(kit.summarizeTopics(v541Notes), "课表级联筛选、跨学期汇总、筛选结果导出");
const v542Notes = kit.splitNotes("新增独立的辅导员成长档案，支持成果台账、支撑材料、年度对比、批量导入与年度材料导出；优化个人档案编辑及修改历史恢复。");
assert.strictEqual(kit.noteTitle(v542Notes[0], 0), "新增独立的辅导员成长档案");
assert.strictEqual(kit.noteTitle(v542Notes[1], 1), "个人档案编辑与修改历史更顺手");
assert.strictEqual(kit.summarizeTopics(v542Notes), "辅导员成长档案、修改历史恢复");
assert.match(kit.noteDescription(v542Notes[0]), /年度材料 Word/);
assert.match(kit.noteDescription(v542Notes[1]), /原附件需要重新上传/);
const v542Supplement = kit.splitNotes("新增独立的辅导员成长档案，支持成果台账、支撑材料、年度对比、批量导入与年度材料导出；优化个人档案编辑及修改历史恢复；班级干部学籍异动时自动离任；资助情况增加民族字段；新增💬反馈与建议入口，支持提交系统问题和功能完善建议。");
assert.strictEqual(v542Supplement.length, 5);
assert.strictEqual(kit.summarizeTopics(v542Supplement), "辅导员成长档案、班干部自动离任、资助民族字段");
assert.match(kit.noteDescription(v542Supplement[2]), /非在校/);
assert.match(kit.noteDescription(v542Supplement[3]), /学生信息自动匹配/);
assert.match(kit.noteDescription(v542Supplement[4]), /外部反馈表单/);
const v543Notes = kit.splitNotes("新增业务台账字段管理，支持自定义字段维护、填写及导入导出；修复学生删除后仍可能显示的问题并移除“删除名单核对”旧功能；宿舍管理名单改为与学生管理的在校生自动同步，住宿信息独立新增或导入；修复班委考核弹窗筛选区纵向堆叠、表格及底部按钮被裁切的问题。");
assert.strictEqual(kit.noteTitle(v543Notes[0], 0), "重点新增：业务台账字段管理");
assert.strictEqual(kit.noteTitle(v543Notes[1], 1), "学生删除同步修复，旧核对功能下线");
assert.strictEqual(kit.noteTitle(v543Notes[2], 2), "宿舍名单与在校生自动同步");
assert.strictEqual(kit.noteTitle(v543Notes[3], 3), "班委考核弹窗布局修复");
assert.strictEqual(kit.summarizeTopics(v543Notes), "字段管理、学生删除同步、宿舍名单同步");
assert.match(kit.noteDescription(v543Notes[0]), /单行文字、多行文字、数字、日期和下拉选项/);
assert.match(kit.noteDescription(v543Notes[0]), /停用字段不会清除历史值/);
const v544Notes = kit.splitNotes("字段管理仅保留在学生管理、班级干部管理、宿舍管理和辅导员成长档案，并清理已下线模块的字段配置与历史值；工作台班级学生分布新增党员、团员人数及名单查看；修复清空本地全部数据后无法重新载入演示数据的问题；修复班委考核大弹窗打开时尺寸动画导致表格越出页脚的问题；优化综测数据新增、编辑弹窗标题。");
assert.strictEqual(v544Notes.length, 5);
assert.strictEqual(kit.noteTitle(v544Notes[0], 0), "字段管理聚焦四类核心档案");
assert.strictEqual(kit.noteTitle(v544Notes[1], 1), "工作台增加党员、团员人数与名单");
assert.strictEqual(kit.noteTitle(v544Notes[2], 2), "清空数据后可重新加载演示数据");
assert.strictEqual(kit.noteTitle(v544Notes[3], 3), "班委考核大弹窗显示完整");
assert.strictEqual(kit.noteTitle(v544Notes[4], 4), "综测新增、编辑标题更清楚");
assert.strictEqual(kit.summarizeTopics(v544Notes), "字段管理聚焦、党团员名单、演示数据修复");
assert.match(kit.noteDescription(v544Notes[0]), /学生管理、班级干部管理、宿舍管理和辅导员成长档案/);
assert.match(kit.noteDescription(v544Notes[0]), /不可恢复/);
assert.match(kit.noteDescription(v544Notes[1]), /党员人数.*团员人数/);
assert.match(kit.noteDescription(v544Notes[2]), /正式业务环境.*备份/);
assert.match(kit.noteDescription(v544Notes[4]), /新增综测数据.*编辑综测数据/);
assert.strictEqual(kit.isPackageSupplement(v544Notes[0]), false, "V5.4.4 字段管理收敛是正式更新日志，不应标记为安装包补充");
assert.match(kit.xhsCopy({ version: "V5.4.4", fromVersion: "V5.4.3", notes: v544Notes }), /字段管理更聚焦，党团员名单一键查看/);
assert.match(kit.xhsCopy({ version: "V5.4.4", fromVersion: "V5.4.3", notes: v544Notes }), /“党员人数”和“团员人数”/);
assert.doesNotMatch(kit.xhsCopy({ version: "V5.4.4", fromVersion: "V5.4.3", notes: v544Notes }), /安装包功能补充/);
const v545Notes = kit.splitNotes("新增立体化公寓管理，统一维护区位、楼栋、楼层、房间和可配置床位，支持宿舍长、入住历史、床位独立登记、床位冲突校验、毕业自动退宿及批量导入原子回滚；基础数据中的学院代码、专业代码和班级名称支持安全修改并同步关联数据；查课记录新增请假名单，并与课堂管理、课表考勤同步。");
assert.strictEqual(v545Notes.length, 3);
assert.strictEqual(kit.noteTitle(v545Notes[0], 0), "重点更新：立体化公寓管理");
assert.strictEqual(kit.noteTitle(v545Notes[1], 1), "基础数据改名安全同步");
assert.strictEqual(kit.noteTitle(v545Notes[2], 2), "查课请假名单多端同步");
assert.strictEqual(kit.summarizeTopics(v545Notes), "立体化宿舍管理、基础数据安全改名、请假名单联动");
assert.match(kit.noteDescription(v545Notes[0]), /空间总览、住宿分布、公寓资源/);
assert.match(kit.noteDescription(v545Notes[0]), /整批原子回滚/);
assert.match(kit.noteDescription(v545Notes[1]), /同步更新学生及关联业务数据/);
assert.match(kit.noteDescription(v545Notes[2]), /课堂管理—课堂考勤记录/);
const customTitle = "中秋特棒来袭：数智学工更新立体化宿舍管理";
assert.match(kit.xhsCopy({ version: "V5.4.5", fromVersion: "V5.4.4", notes: v545Notes, title: customTitle }), new RegExp(`标题：${customTitle}`));
assert.match(kit.xhsCopy({ version: "V5.4.5", fromVersion: "V5.4.4", notes: v545Notes, title: customTitle }), /中秋将至[\s\S]*区位、楼栋、楼层、房间、床位/);
for (const marker of ["空间总览", "住宿分布", "公寓资源", "可配置床位", "宿舍长", "入住历史", "床位独立登记", "床位冲突", "毕业自动退宿", "原子回滚"]) {
  assert.ok(kit.xhsCopy({ version: "V5.4.5", fromVersion: "V5.4.4", notes: v545Notes, title: customTitle }).includes(marker), `V5.4.5 小红书缺少功能名：${marker}`);
}
const v546Notes = kit.splitNotes("优化花名册版式：页面预览、全屏预览与 PDF 导出统一为每行 3 人、每页 18 人；姓名、学号、学院、专业、家庭住址等字段超出卡片宽度时自动换行，避免内容截断或横向溢出。");
assert.strictEqual(v546Notes.length, 2);
assert.strictEqual(kit.noteTitle(v546Notes[0], 0), "重点优化：花名册三列六行版式");
assert.strictEqual(kit.noteTitle(v546Notes[1], 1), "长字段自动换行");
assert.strictEqual(kit.summarizeTopics(v546Notes), "花名册排版升级、长字段自动换行");
assert.match(kit.noteDescription(v546Notes[0]), /页面预览、全屏预览和 PDF 导出/);
assert.match(kit.noteDescription(v546Notes[0]), /每行 3 人、每页 18 人/);
assert.match(kit.noteDescription(v546Notes[1]), /自动换行/);
const v546Title = "中秋第二袭：花名册排版升级，长信息不再截断";
const v546Xhs = kit.xhsCopy({ version: "V5.4.6", fromVersion: "V5.4.5", notes: v546Notes, title: v546Title });
assert.match(v546Xhs, new RegExp(`标题：${v546Title}`));
for (const marker of ["页面预览", "全屏预览", "PDF 导出", "每行 3 人", "每页 18 人", "姓名", "学号", "学院", "专业", "家庭住址", "自动换行", "内容截断", "横向溢出"]) {
  assert.ok(v546Xhs.includes(marker), `V5.4.6 小红书缺少功能名：${marker}`);
}
const v546CombinedTitle = "中秋第二袭：花名册告别“挤、乱、截”，宿舍管理一屏看全";
const v546CombinedXhs = kit.xhsCopy({ version: "V5.4.6", fromVersion: "V5.4.5", notes: v546Notes, title: v546CombinedTitle, includeDormRecap: true });
assert.match(v546CombinedXhs, new RegExp(`标题：${v546CombinedTitle}`));
assert.match(v546CombinedXhs, /V5\.4\.5 首次上线[\s\S]*继续包含在 V5\.4\.6 安装包/);
assert.match(v546CombinedXhs, /两个“看不清”[\s\S]*哪些时候特别好用/);
assert.match(v546CombinedXhs, /新生报到[\s\S]*中秋走访[\s\S]*班级点名[\s\S]*材料归档/);
for (const marker of ["立体化宿舍管理", "空间总览", "住宿分布", "公寓资源", "可配置床位", "宿舍长", "入住历史", "床位独立登记", "床位冲突校验", "毕业自动退宿", "批量导入原子回滚"]) {
  assert.ok(v546CombinedXhs.includes(marker), `V5.4.6 宿舍管理补充缺少功能名：${marker}`);
}
const v547ReleaseNotes = "学业预警附件1—5支持下载、校验并导入自定义 Word 模板、恢复系统默认模板，整套预览、单人 Word/PDF 和批量下载同步使用当前模板，预警课程超过 6 门时自动扩行；全系统学期台账统一按新学期在前排序；彻底下线“知识”功能及其代码、数据、缓存、恢复入口和 AI 配置；宿舍空间信息在学生资料保存或恢复后即时同步，并兼容多种手机号字段；功能区导航在重新进入或刷新时统一默认收起。";
const v547Notes = kit.splitNotes(v547ReleaseNotes);
assert.strictEqual(v547Notes.length, 5, "V5.4.7 正式日志必须拆成 5 项更新");
assert.deepStrictEqual(v547Notes.map(kit.noteTitle), [
  "重点新增：学业预警 Word 模板管理",
  "全系统学期台账统一倒序",
  "“知识”功能彻底下线",
  "宿舍空间信息即时同步",
  "功能区导航默认收起"
]);
assert.strictEqual(kit.summarizeTopics(v547Notes), "学业预警模板、学期台账倒序、知识功能下线");
const v547Title = "中秋第三弹：学业预警模板随心换，五项更新一次看全";
const v547Xhs = kit.xhsCopy({ version: "V5.4.7", fromVersion: "V5.4.6", notes: v547Notes, title: v547Title });
for (const marker of [
  v547Title, "学业预警附件1—5", "自定义 Word 模板", "恢复系统默认模板", "整套预览", "单人 Word/PDF",
  "批量下载", "当前模板", "预警课程超过 6 门", "自动扩行", "全系统学期台账", "新学期在前",
  "“知识”功能", "代码、数据、缓存、恢复入口和 AI 配置", "宿舍空间信息", "学生资料保存或恢复",
  "即时同步", "多种手机号字段", "功能区导航", "重新进入或刷新", "默认收起", "检查更新", "下载并校验",
  "立即更新并重启"
]) {
  assert.ok(v547Xhs.includes(marker), `V5.4.7 小红书文案缺少：${marker}`);
}
const v549ReleaseNotes = "查课与课表考勤将“请假”细分为“事假、病假”，名单、人数、导入导出、学生课堂记录及归档清理同步更新，并兼容历史请假数据；花名册与自定义花名册加宽证件照及身份信息区域，12 位学号保持单行显示，PDF 版式同步优化；授权激活页的购买及售后微信更新为 shuzhixuegong1。";
const v549Notes = kit.splitNotes(v549ReleaseNotes);
assert.strictEqual(v549Notes.length, 3, "V5.4.9 正式日志必须拆成 3 项更新");
assert.deepStrictEqual(v549Notes.map(kit.noteTitle), [
  "查课请假细分为事假、病假",
  "花名册证件照与身份信息更清晰",
  "购买及售后微信更新"
]);
assert.strictEqual(kit.summarizeTopics(v549Notes), "事假病假分类、花名册排版、售后联系更新");
const v549Title = "请假分类更精准，花名册更清晰｜数智学工 V5.4.9 更新";
const v549Xhs = kit.xhsCopy({ version: "V5.4.9", fromVersion: "V5.4.7", notes: v549Notes, title: v549Title });
for (const marker of [
  v549Title, "查课记录", "课表考勤", "事假", "病假", "名单", "人数", "导入导出", "学生课堂记录",
  "归档清理", "历史请假数据", "花名册", "自定义花名册", "证件照", "身份信息", "12 位学号",
  "单行显示", "PDF 导出", "授权激活页", "购买及售后微信", "shuzhixuegong1", "检查更新", "下载并校验",
  "立即更新并重启"
]) {
  assert.ok(v549Xhs.includes(marker), `V5.4.9 小红书文案缺少：${marker}`);
}
const v550ReleaseNotes = "授权未激活、到期、停用或解绑后完全锁定业务页面、数据查询、附件与备份，仅保留授权激活和系统更新入口；全系统学期改由“学期设置”统一管理，自动补录历史业务学期，禁止删除仍被业务数据使用的学期，导入时锁定唯一目标学期；查课支持同时选择多个班级，并同步学院、年级筛选、考勤名单、导入导出及学生课堂记录；“课表”更名为“实时课表”，优化多班级课表查看和 PDF 导入；学生导入严格校验民族、政治面貌和学籍状态，拒绝非系统选项；综测与成绩汇总按真实数值精确舍入，学业分析生源地统一输出省/自治区＋市（州）或直辖市＋区（县）两级行政区。";
const v550Notes = kit.splitNotes(v550ReleaseNotes);
assert.strictEqual(v550Notes.length, 6, "V5.5.0 正式日志必须拆成 6 项更新");
assert.deepStrictEqual(v550Notes.map(kit.noteTitle), [
  "授权不可用时全面锁定业务数据",
  "全系统学期统一管理",
  "查课支持同时选择多个班级",
  "“课表”升级为“实时课表”",
  "学生导入严格校验三类字段",
  "成绩计算与生源地分析更准确"
]);
assert.strictEqual(kit.summarizeTopics(v550Notes), "授权安全锁定、学期统一管理、多班级查课");
const v550Title = "学期统一、多班查课、实时课表｜数智学工 V5.5.0 六项升级";
const v550Xhs = kit.xhsCopy({ version: "V5.5.0", fromVersion: "V5.4.9", notes: v550Notes, title: v550Title });
for (const marker of [
  v550Title, "未激活", "到期", "停用", "解绑", "业务页面", "数据查询", "附件", "备份", "授权激活", "系统更新",
  "学期设置", "历史业务学期", "禁止删除", "唯一目标学期", "多个班级", "学院", "年级", "旷课", "事假", "病假",
  "迟到", "早退", "导入导出", "学生课堂记录", "实时课表", "PDF 导入", "民族", "政治面貌", "学籍状态",
  "非系统选项", "综测", "成绩汇总", "真实数值", "精确舍入", "学业分析", "省/自治区＋市（州）", "直辖市＋区（县）",
  "检查更新", "下载并校验", "立即更新并重启"
]) {
  assert.ok(v550Xhs.includes(marker), `V5.5.0 小红书文案缺少：${marker}`);
}
assert.match(kit.noteTitle(notes[0], 0), /助学贷款/);
assert.match(kit.noteDescription(notes[1]), /学院、专业、年级/);
assert.match(kit.noteDescription(notes[2]), /重复建名单/);
assert.strictEqual(kit.normalizeVersion("V5.3.0", "目标"), "V5.3.0");
assert.doesNotMatch(kit.xhsCopy({version:"V5.5.5",fromVersion:"V5.5.4",notes:["升级安装完整性优化"],packageSize:1024,publishedAt:new Date().toISOString()}),/自动创建.*保护备份/,"release instructions must not claim an implicit business backup");
assert.throws(() => kit.normalizeVersion("5.3", "目标"), /格式无效/);

const buildSource = fs.readFileSync(path.join(root, "scripts", "build-update-package.ps1"), "utf8");
for (const marker of ["generate-update-social-kit.cjs", "PreviousVersion", "SocialOutputRoot", "微信公众号推文", "小红书笔记", "系统更新截图"]) {
  assert.ok(buildSource.includes(marker), `升级包构建脚本缺少宣传材料自动生成标记：${marker}`);
}

console.log("update social kit QA passed");
