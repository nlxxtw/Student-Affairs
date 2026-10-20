"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function loadDependency(name) {
  const candidates = [
    process.env.CODEX_NODE_MODULES && path.join(process.env.CODEX_NODE_MODULES, name),
    path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", name),
    name
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_error) {}
  }
  throw new Error(`缺少 ${name} 依赖，无法生成版本宣传材料。`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = String(argv[index] || "");
    if (!key.startsWith("--") || index + 1 >= argv.length) throw new Error(`参数格式无效：${key}`);
    args[key.slice(2)] = String(argv[index + 1]);
  }
  return args;
}

function normalizeVersion(value, label) {
  const version = String(value || "").trim();
  if (!/^V\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`${label}版本号格式无效：${version}`);
  return version;
}

function safeOutputRoot(value) {
  return path.resolve(String(value || path.join(os.homedir(), "Desktop", "系统更新")));
}

function splitNotes(value) {
  return String(value || "").split(/[；;\r\n]+/).map((item) => item.trim().replace(/[。．]+$/, "")).filter(Boolean);
}

function isPackageSupplement(note) {
  return /新增业务台账字段管理|业务台账字段管理.*(?:自定义字段|导入导出)|班级干部.*学籍异动.*自动离任|非在校.*班级干部.*离任|资助情况.*民族|反馈与建议|系统问题.*功能.*建议/.test(note);
}

function isFieldScopeRelease(note) {
  return /字段管理仅保留|清理已下线模块的字段配置与历史值/.test(note);
}

function isDormSpatialRelease(note) {
  return /立体化公寓管理|区位、楼栋、楼层、房间和可配置床位/.test(note);
}

function isRosterLayoutRelease(note) {
  return /优化花名册版式|每行\s*3\s*人.*每页\s*18\s*人|字段超出卡片宽度时自动换行/.test(note);
}

function isAcademicWarningTemplateRelease(note) {
  return /学业预警附件\s*1[—-]5|自定义\s*Word\s*模板|预警课程超过\s*6\s*门/.test(note);
}

function isLeaveTypeRelease(note) {
  return /查课与课表考勤.*请假.*事假.*病假|事假、病假.*历史请假数据/.test(note);
}

function isRosterIdentityLayoutRelease(note) {
  return /花名册与自定义花名册.*证件照.*身份信息|12\s*位学号.*单行显示/.test(note);
}

function isLicenseContactRelease(note) {
  return /授权激活页.*购买及售后微信|shuzhixuegong1/.test(note);
}

function isLicenseLockRelease(note) {
  return /授权未激活.*到期.*停用.*解绑|完全锁定业务页面.*仅保留授权激活/.test(note);
}

function isTermGovernanceRelease(note) {
  return /全系统学期.*学期设置.*统一管理|自动补录历史业务学期|锁定唯一目标学期/.test(note);
}

function isMultiClassInspectionRelease(note) {
  return /查课支持.*多个班级|多班级.*考勤名单.*学生课堂记录/.test(note);
}

function isRealtimeTimetableRelease(note) {
  return /课表.*更名.*实时课表|多班级课表查看.*PDF\s*导入/.test(note);
}

function isStudentImportValidationRelease(note) {
  return /学生导入.*民族.*政治面貌.*学籍状态|拒绝非系统选项/.test(note);
}

function isPrecisionAndRegionRelease(note) {
  return /综测与成绩汇总.*精确舍入|学业分析生源地.*两级行政区/.test(note);
}

function noteTitle(note, index) {
  const mappings = [
    [/授权未激活.*到期.*停用.*解绑|完全锁定业务页面.*仅保留授权激活/, "授权不可用时全面锁定业务数据"],
    [/全系统学期.*学期设置.*统一管理|自动补录历史业务学期|锁定唯一目标学期/, "全系统学期统一管理"],
    [/查课支持.*多个班级|多班级.*考勤名单.*学生课堂记录/, "查课支持同时选择多个班级"],
    [/课表.*更名.*实时课表|多班级课表查看.*PDF\s*导入/, "“课表”升级为“实时课表”"],
    [/学生导入.*民族.*政治面貌.*学籍状态|拒绝非系统选项/, "学生导入严格校验三类字段"],
    [/综测与成绩汇总.*精确舍入|学业分析生源地.*两级行政区/, "成绩计算与生源地分析更准确"],
    [/查课与课表考勤.*请假.*事假.*病假|事假、病假.*历史请假数据/, "查课请假细分为事假、病假"],
    [/花名册与自定义花名册.*证件照.*身份信息|12\s*位学号.*单行显示/, "花名册证件照与身份信息更清晰"],
    [/授权激活页.*购买及售后微信|shuzhixuegong1/, "购买及售后微信更新"],
    [/学业预警附件\s*1[—-]5|自定义\s*Word\s*模板|预警课程超过\s*6\s*门/, "重点新增：学业预警 Word 模板管理"],
    [/全系统学期台账.*新学期在前|学期台账.*排序/, "全系统学期台账统一倒序"],
    [/下线“?知识”?功能|知识.*代码.*数据.*缓存/, "“知识”功能彻底下线"],
    [/宿舍空间信息.*即时同步|兼容多种手机号字段/, "宿舍空间信息即时同步"],
    [/功能区导航.*默认收起|重新进入或刷新.*收起/, "功能区导航默认收起"],
    [/优化花名册版式|每行\s*3\s*人.*每页\s*18\s*人/, "重点优化：花名册三列六行版式"],
    [/字段超出卡片宽度时自动换行|内容截断或横向溢出/, "长字段自动换行"],
    [/立体化公寓管理|区位、楼栋、楼层、房间和可配置床位/, "重点更新：立体化公寓管理"],
    [/学院代码.*专业代码.*班级名称.*安全修改|基础数据.*安全修改.*同步关联数据/, "基础数据改名安全同步"],
    [/查课记录.*请假名单|请假名单.*课堂管理.*课表考勤/, "查课请假名单多端同步"],
    [/字段管理仅保留|清理已下线模块的字段配置与历史值/, "字段管理聚焦四类核心档案"],
    [/工作台班级学生分布.*党员.*团员|党员、团员人数.*名单/, "工作台增加党员、团员人数与名单"],
    [/清空本地全部数据.*演示数据|重新载入演示数据/, "清空数据后可重新加载演示数据"],
    [/班委考核.*尺寸动画|表格越出页脚/, "班委考核大弹窗显示完整"],
    [/综测数据.*弹窗标题|新增、编辑弹窗标题/, "综测新增、编辑标题更清楚"],
    [/字段管理|业务台账.*自定义字段/, "重点新增：业务台账字段管理"],
    [/学生删除.*仍.*显示|删除名单核对/, "学生删除同步修复，旧核对功能下线"],
    [/宿舍管理名单.*在校生.*同步|住宿信息.*独立新增/, "宿舍名单与在校生自动同步"],
    [/班委考核.*筛选区.*纵向|班委考核.*按钮.*裁切/, "班委考核弹窗布局修复"],
    [/班级干部.*学籍异动.*自动离任|非在校.*班级干部.*离任/, "学籍状态变更时班干部自动离任"],
    [/资助情况.*民族/, "资助情况增加民族字段"],
    [/反馈与建议|系统问题.*功能.*建议/, "新增“💬反馈与建议”入口"],
    [/独立的辅导员成长档案|成果台账.*年度对比/, "新增独立的辅导员成长档案"],
    [/个人档案编辑.*修改历史|修改历史.*恢复/, "个人档案编辑与修改历史更顺手"],
    [/课表.*(学院|专业|年级|班级).*(复选|多选)|课表.*级联查询/, "课表组织条件支持多选级联筛选"],
    [/多学期.*同.{0,2}教学周|同.{0,2}教学周.*多学期/, "多学期同一教学周集中汇总"],
    [/筛选结果.*导出|按筛选.*导出/, "按当前筛选结果导出课表"],
    [/基础数据维护.*学生信息管理/, "基础数据维护入口调整至学生信息管理"],
    [/新增、编辑或导入学生|自动补齐.*学院/, "学生建档可确认自动补齐基础数据"],
    [/定期备份.*弹窗|遗留配置/, "取消旧定期备份弹窗提醒"],
    [/助学贷款/, "新增助学贷款独立台账"],
    [/照片.*导入|导入.*照片/, "学生照片导入诊断更清楚"],
    [/学期.*周数|周数.*学期/, "学期周数设置更灵活"],
    [/侧栏|导航.*可读/, "侧栏文字更清晰"],
    [/学生导入.*班级|班级.*权威/, "学生导入按班级权威信息自动匹配"],
    [/基础数据.*重名|重名.*校验|无代码/, "基础数据维护校验更可靠"],
    [/就业意向|毕业年份/, "就业意向名单自动同步"]
  ];
  const found = mappings.find(([pattern]) => pattern.test(note));
  if (found) return found[1];
  return note.split(/[，,：:]/)[0].trim() || `更新内容 ${index + 1}`;
}

function noteDescription(note) {
  const mappings = [
    [/授权未激活.*到期.*停用.*解绑|完全锁定业务页面.*仅保留授权激活/, "当授权处于未激活、已到期、被停用或已解绑状态时，系统会完整锁定业务页面、数据查询、附件访问和数据备份，防止通过地址跳转或接口继续读取业务数据。此时只保留“授权激活”和“系统更新”入口，方便重新激活或升级系统。"],
    [/全系统学期.*学期设置.*统一管理|自动补录历史业务学期|锁定唯一目标学期/, "全系统学期改由“系统管理—学期设置”统一维护。系统会自动补录既有业务数据中出现过的历史学期；仍被业务记录使用的学期不能删除，避免台账失去归属。执行数据导入前必须选定唯一目标学期，防止同一批数据被误写到多个学期。"],
    [/查课支持.*多个班级|多班级.*考勤名单.*学生课堂记录/, "查课记录支持一次选择多个班级，学院、年级筛选随班级范围同步，旷课、事假、病假、迟到和早退名单可从所选班级学生中统一维护。保存、导入、导出以及学生个人课堂记录均保留多班级关系，合班课和跨班教学不必再拆成多条记录。"],
    [/课表.*更名.*实时课表|多班级课表查看.*PDF\s*导入/, "原“课表”正式更名为“实时课表”，名称更贴近按学期、教学周和班级即时查看课程安排的使用方式。多班级课表展示进一步优化，PDF 导入也能更稳妥地识别和关联多个班级，合班课程查看与维护更顺畅。"],
    [/学生导入.*民族.*政治面貌.*学籍状态|拒绝非系统选项/, "学生批量导入对“民族”“政治面貌”“学籍状态”执行严格枚举校验。模板中出现系统选项之外的写法时会直接拒绝并提示修正，避免同一含义出现多种名称，保证后续筛选、统计和数据分析口径一致。"],
    [/综测与成绩汇总.*精确舍入|学业分析生源地.*两级行政区/, "综测和成绩汇总先按真实数值完成计算，再在最终展示环节精确舍入，减少中间提前取整造成的累计偏差。学业分析中的生源地统一整理为“省/自治区＋市（州）”或“直辖市＋区（县）”两级行政区，地域分布统计更规范、更容易比较。"],
    [/查课与课表考勤.*请假.*事假.*病假|事假、病假.*历史请假数据/, "查课记录和课表考勤不再把所有请假合并为一类，而是分别维护“事假”“病假”名单与人数。新增、编辑、导入、导出、学生课堂记录和归档清理全部同步适配；请假总人数按两类名单统一核对，既有历史请假数据也可继续使用。"],
    [/花名册与自定义花名册.*证件照.*身份信息|12\s*位学号.*单行显示/, "花名册与自定义花名册同步加宽证件照和身份信息区域，为照片、姓名、学号等关键信息留出更合理的展示空间。常见的 12 位学号保持单行显示，页面预览和 PDF 导出版式同步优化，查看、打印和归档更整齐。"],
    [/授权激活页.*购买及售后微信|shuzhixuegong1/, "授权激活页中的购买及售后微信已统一更新为 shuzhixuegong1。需要购买激活码、咨询授权或反馈售后问题时，可直接通过该微信联系，避免使用旧联系方式。"],
    [/学业预警附件\s*1[—-]5|自定义\s*Word\s*模板|预警课程超过\s*6\s*门/, "学业预警附件1—5新增 Word 模板管理：可下载当前模板，在 Word 中调整固定文字、字体、页眉页脚和版式，重新导入时由系统校验结构，也可一键恢复系统默认模板。整套预览、单人 Word/PDF 和批量下载统一使用当前模板；当预警课程超过 6 门时，课程表格会自动扩行，避免课程信息被挤掉。"],
    [/全系统学期台账.*新学期在前|学期台账.*排序/, "全系统涉及学期的台账统一按照新学期在前、旧学期在后的顺序展示。打开页面即可优先看到当前和最近学期，筛选、核对与录入时不用再反复翻到列表底部。"],
    [/下线“?知识”?功能|知识.*代码.*数据.*缓存/, "正式下线“知识”功能，并同步清理相关界面、代码、数据、浏览器缓存、备份恢复入口和 AI 配置。旧知识数据不会通过备份重新恢复，也不会继续触发 AI 调用，减少无效入口和历史残留。"],
    [/宿舍空间信息.*即时同步|兼容多种手机号字段/, "学生资料保存或从备份恢复后，宿舍空间中的学生姓名、班级、学院、联系方式等信息会即时同步，无需重新进入页面或手动刷新。同时兼容“手机号”“手机号码”“联系电话”等常见字段名称，降低不同来源数据的匹配差异。"],
    [/功能区导航.*默认收起|重新进入或刷新.*收起/, "重新进入系统或刷新页面时，各功能区导航统一默认收起。侧栏更加简洁，需要哪个分组再点击展开，减少长菜单一次铺开造成的视觉干扰。"],
    [/优化花名册版式|每行\s*3\s*人.*每页\s*18\s*人/, "花名册的页面预览、全屏预览和 PDF 导出现在统一采用每行 3 人、每页 18 人的三列六行版式，屏幕查看与最终文件保持一致。每张学生卡片拥有更充足的展示空间，证件照和身份信息仍按原方式呈现。"],
    [/字段超出卡片宽度时自动换行|内容截断或横向溢出/, "姓名、学号、学院、专业、家庭住址等字段超出学生卡片宽度时会自动换行，减少文字截断或横向溢出。勾选字段较多时，卡片还会自动采用更紧凑的字号与行距，尽量完整保留信息。"],
    [/立体化公寓管理|区位、楼栋、楼层、房间和可配置床位/, "宿舍管理新增“空间总览、住宿分布、公寓资源”三个联动入口。公寓资源统一维护区位、楼栋、楼层、房间和可配置床位；空间总览直观看到入住率、空床、缺宿舍长和床位冲突。系统还支持安排入住、设置宿舍长、保存入住历史、床位独立登记及毕业自动退宿。批量导入遇到缺项或床位冲突时整批原子回滚，避免出现一半成功、一半失败的数据。"],
    [/学院代码.*专业代码.*班级名称.*安全修改|基础数据.*安全修改.*同步关联数据/, "基础数据维护中的学院代码、专业代码和班级名称现在可以安全修改。保存后，系统会同步更新学生及关联业务数据，并继续执行重名、层级关系等校验，减少代码调整或班级更名后出现新旧口径并存。"],
    [/查课记录.*请假名单|请假名单.*课堂管理.*课表考勤/, "查课记录新增“请假名单”，可与旷课、迟到、早退名单一起按学生维护。保存后会同步到“课堂管理—课堂考勤记录”，并与课表考勤联动；导入、导出也包含请假名单，人员与人数核对更清楚。"],
    [/字段管理仅保留|清理已下线模块的字段配置与历史值/, "字段管理现仅保留在学生管理、班级干部管理、宿舍管理和辅导员成长档案，减少跨模块残留与误用；升级时会同步清理已下线模块的字段配置和历史值。四个保留模块仍可维护自定义字段。删除已保存字段时，系统会二次确认；确认保存后，该模块全部记录中的对应历史值会一并删除且不可恢复，操作前建议先导出或备份。"],
    [/工作台班级学生分布.*党员.*团员|党员、团员人数.*名单/, "工作台的班级学生分布新增“党员人数”和“团员人数”，并支持打开名单查看学生基本信息。党团员结构从汇总数字到人员明细都能在工作台直接核对，减少另做统计表。"],
    [/清空本地全部数据.*演示数据|重新载入演示数据/, "修复清空本地全部数据后无法再次载入演示数据的问题。用于产品演示、培训或测试时，可在完成清空后重新初始化演示数据；正式业务环境执行清空前仍应先完成备份。"],
    [/班委考核.*尺寸动画|表格越出页脚/, "修复班委考核大弹窗打开时，尺寸动画可能导致表格越出页脚的问题。弹窗展开后，筛选区、考核表格和底部操作区能够保持在正确布局内。"],
    [/综测数据.*弹窗标题|新增、编辑弹窗标题/, "优化综测数据弹窗标题：新建记录时显示“新增综测数据”，修改记录时显示“编辑综测数据”，当前操作一眼可辨，降低录入时的判断成本。"],
    [/字段管理|业务台账.*自定义字段/, "各业务页面顶部新增“字段扩展”区域。点击“字段管理”，可在只读系统字段之外增加单行文字、多行文字、数字、日期和下拉选项五类自定义字段，并调整名称、顺序、选项和启用状态；系统字段不可删除。保存后通过“查看/填写字段”为原有业务记录补充内容，也支持按记录 ID 导入、导出。停用字段不会清除历史值，字段值随原记录和备份一起保存。"],
    [/学生删除.*仍.*显示|删除名单核对/, "修复学生删除后仍可能在相关页面显示的问题，同时移除已经失去必要性的“删除名单核对”旧功能，减少重复入口，让学生主数据的删除结果保持一致。"],
    [/宿舍管理名单.*在校生.*同步|住宿信息.*独立新增/, "宿舍管理名单直接跟随“学生管理”中的在校生自动同步，不再单独维护另一份人员名单；楼栋、房间号、床位等住宿信息仍可独立新增或批量导入。"],
    [/班委考核.*筛选区.*纵向|班委考核.*按钮.*裁切/, "修复班委考核弹窗中筛选区纵向堆叠、表格显示空间不足以及底部按钮被裁切的问题，让筛选、查看和保存操作完整呈现。"],
    [/班级干部.*学籍异动.*自动离任|非在校.*班级干部.*离任/, "在“学生管理”中将学籍状态改为非在校后，该生在“班级干部管理”中的在任记录会自动转为“已离任”，并记录离任日期；学生档案的当前与历史任职信息、班委考核名单随之同步。转专业等仍保持在校状态的变更不会仅因此自动离任。"],
    [/资助情况.*民族/, "“资助情况”的学期明细新增“民族”列，录入和修改时从学生信息自动匹配；导入校验、模板及导出也包含该字段。按学号匹配即可，减少资助台账与学生主档案的信息不一致。"],
    [/反馈与建议|系统问题.*功能.*建议/, "工作台顶部新增“💬反馈与建议”入口，点击后会在新页面打开外部反馈表单，可提交遇到的系统问题，也可提出希望增加或完善的功能。提交前请避免填写学生隐私等敏感信息。"],
    [/独立的辅导员成长档案|成果台账.*年度对比/, "在“个人发展—成长档案”中，指导学生获奖、个人荣誉、论文和项目可以独立建成成果台账，标记代表性成果、上传证书等支撑材料。支持批量导入、按年度对比，并可从当前筛选结果生成包含个人信息、分类目录、成果详情和附件索引的年度材料 Word。档案不读取或回写原有学生业务数据；导出后请人工核对。"],
    [/个人档案编辑.*修改历史|修改历史.*恢复/, "个人档案可维护姓名、单位、岗位和专业发展方向，年度材料会自动带入；成果台账的新增、编辑、删除、归档等操作保留修改历史，可恢复记录版本。恢复删除的成果时，原附件需要重新上传。"],
    [/课表.*(学院|专业|年级|班级).*(复选|多选)|课表.*级联查询/, "课表中的学院、专业、年级和班级均支持复选。选定上级条件后，下级选项会随组织关系自动收敛，查多个学院、多个专业或多个班级的课程时，不必反复切换页面。"],
    [/多学期.*同.{0,2}教学周|同.{0,2}教学周.*多学期/, "可以同时勾选多个学期，按同一教学周集中查看课程安排，便于对比不同学期同周的教学情况，也适合跨学期核对教室、教师和班级课表。"],
    [/筛选结果.*导出|按筛选.*导出/, "完成学期和组织条件筛选后，可直接导出当前课表结果。导出的内容与页面筛选范围保持一致，减少导出整表后再次删行、分表的整理工作。"],
    [/基础数据维护.*学生信息管理/, "“基础数据维护”现已归入“学生信息管理”，学院、专业、班级、年级等基础信息与学生建档入口集中在同一业务分组，日常维护时查找更直观、切换更少。"],
    [/新增、编辑或导入学生|自动补齐.*学院/, "新增、编辑或导入学生时，如果相关学院、专业、班级、年级或招生类别尚未维护，系统会先给出确认，再自动补齐；发现层级冲突时会及时拦截，减少重复建档和上下级归属错乱。"],
    [/定期备份.*弹窗|遗留配置/, "移除已经停用的定期备份弹窗和遗留配置，减少进入系统后的重复打扰。现有“数据备份”功能与系统更新前的本机保护备份不受影响。"],
    [/助学贷款/, "资助工作中不再需要另建零散表格。可按学年登记学生贷款银行与金额，支持模板导入、台账导出，并同步进入学生档案，查询和汇总更集中。"],
    [/照片.*导入|导入.*照片/, "照片批量导入遇到文件名、学号匹配或图片异常时，诊断信息更加明确，便于快速定位未成功导入的原因，减少逐张排查。"],
    [/学期.*周数|周数.*学期/, "学期设置对开学日期和总教学周数的维护更加清楚，可据此展示当前教学周；未维护时也会给出明确引导。"],
    [/侧栏|导航.*可读/, "优化侧栏文字尺寸与层级辨识度，常用功能入口更容易看清和定位，长时间使用更舒适。"],
    [/学生导入.*班级|班级.*权威/, "学生导入时以“基础数据维护”中的班级信息作为权威来源。匹配班级后，学院、专业、年级等关联字段自动带出，降低同班学生信息错填和口径不一致。"],
    [/基础数据.*重名|重名.*校验|无代码/, "学院、专业、班级等基础数据进一步强化重名校验，同时兼容没有代码的既有记录，既减少重复建档，也避免旧数据因缺少代码而无法继续维护。"],
    [/就业意向|毕业年份/, "学生管理中已经填写毕业年份的学生，会自动进入就业意向名单，减少重复建名单；后续可直接补充就业意向、升学信息与待解决问题。"]
  ];
  const found = mappings.find(([pattern]) => pattern.test(note));
  return found ? found[1] : `${note}。本次升级已把这项改进纳入正式版本，升级后可在对应模块中直接使用。`;
}

function summarizeTopics(notes) {
  const highlights = [
    [/授权未激活.*到期.*停用.*解绑|完全锁定业务页面.*仅保留授权激活/, "授权安全锁定"],
    [/全系统学期.*学期设置.*统一管理|自动补录历史业务学期|锁定唯一目标学期/, "学期统一管理"],
    [/查课支持.*多个班级|多班级.*考勤名单.*学生课堂记录/, "多班级查课"],
    [/课表.*更名.*实时课表|多班级课表查看.*PDF\s*导入/, "实时课表"],
    [/学生导入.*民族.*政治面貌.*学籍状态|拒绝非系统选项/, "导入严格校验"],
    [/综测与成绩汇总.*精确舍入|学业分析生源地.*两级行政区/, "统计精度优化"],
    [/查课与课表考勤.*请假.*事假.*病假|事假、病假.*历史请假数据/, "事假病假分类"],
    [/花名册与自定义花名册.*证件照.*身份信息|12\s*位学号.*单行显示/, "花名册排版"],
    [/授权激活页.*购买及售后微信|shuzhixuegong1/, "售后联系更新"],
    [/学业预警附件\s*1[—-]5|自定义\s*Word\s*模板|预警课程超过\s*6\s*门/, "学业预警模板"],
    [/全系统学期台账.*新学期在前|学期台账.*排序/, "学期台账倒序"],
    [/下线“?知识”?功能|知识.*代码.*数据.*缓存/, "知识功能下线"],
    [/宿舍空间信息.*即时同步|兼容多种手机号字段/, "宿舍资料同步"],
    [/功能区导航.*默认收起|重新进入或刷新.*收起/, "导航默认收起"],
    [/优化花名册版式|每行\s*3\s*人.*每页\s*18\s*人/, "花名册排版升级"],
    [/字段超出卡片宽度时自动换行|内容截断或横向溢出/, "长字段自动换行"],
    [/立体化公寓管理|区位、楼栋、楼层、房间和可配置床位/, "立体化宿舍管理"],
    [/学院代码.*专业代码.*班级名称.*安全修改|基础数据.*安全修改.*同步关联数据/, "基础数据安全改名"],
    [/查课记录.*请假名单|请假名单.*课堂管理.*课表考勤/, "请假名单联动"],
    [/字段管理仅保留|清理已下线模块的字段配置与历史值/, "字段管理聚焦"],
    [/工作台班级学生分布.*党员.*团员|党员、团员人数.*名单/, "党团员名单"],
    [/清空本地全部数据.*演示数据|重新载入演示数据/, "演示数据修复"],
    [/字段管理|业务台账.*自定义字段/, "字段管理"],
    [/学生删除.*仍.*显示|删除名单核对/, "学生删除同步"],
    [/宿舍管理名单.*在校生.*同步|住宿信息.*独立新增/, "宿舍名单同步"],
    [/班委考核.*筛选区.*纵向|班委考核.*按钮.*裁切/, "班委考核修复"],
    [/独立的辅导员成长档案|成果台账.*年度对比/, "辅导员成长档案"],
    [/班级干部.*学籍异动.*自动离任|非在校.*班级干部.*离任/, "班干部自动离任"],
    [/资助情况.*民族/, "资助民族字段"],
    [/反馈与建议|系统问题.*功能.*建议/, "反馈建议入口"],
    [/个人档案编辑.*修改历史|修改历史.*恢复/, "修改历史恢复"],
    [/课表.*(学院|专业|年级|班级).*(复选|多选)|课表.*级联查询/, "课表级联筛选"],
    [/多学期.*同.{0,2}教学周|同.{0,2}教学周.*多学期/, "跨学期汇总"],
    [/筛选结果.*导出|按筛选.*导出/, "筛选结果导出"],
    [/基础数据维护.*学生信息管理/, "基础数据入口"],
    [/新增、编辑或导入学生|自动补齐.*学院/, "建档自动补齐"],
    [/定期备份.*弹窗|遗留配置/, "备份提醒优化"],
    [/助学贷款/, "助学贷款"],
    [/学生导入.*班级|班级.*权威/, "学生导入"],
    [/就业意向|毕业年份/, "就业同步"]
  ].flatMap(([pattern, label]) => notes.some((note) => pattern.test(note)) ? [label] : []);
  if (highlights.length >= notes.length) return highlights.slice(0, 3).join("、");
  const fallback = notes.map((note, index) => noteTitle(note, index).replace(/^新增/, "").replace(/独立台账|自动匹配|自动同步|更清楚|更灵活|更清晰|更可靠/g, ""));
  return [...highlights, ...fallback.filter((topic) => topic && !highlights.includes(topic))].slice(0, 3).join("、") || "效率、数据与体验";
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  const target = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }).format(target);
}

function xhsCopy(model) {
  const shortDescription = (note) => {
    if (isLicenseLockRelease(note)) return "授权未激活、到期、停用或解绑后，业务页面、数据查询、附件和备份全部锁定，仅保留“授权激活”和“系统更新”，业务数据保护更完整。";
    if (isTermGovernanceRelease(note)) return "全系统学期统一在“学期设置”维护：自动补录历史业务学期；仍被数据使用的学期禁止删除；导入前必须锁定唯一目标学期，避免跨学期误写。";
    if (isMultiClassInspectionRelease(note)) return "一次查课可同时选择多个班级，学院、年级筛选以及旷课、事假、病假、迟到、早退名单同步联动；导入导出和学生课堂记录也保留多班级关系。";
    if (isRealtimeTimetableRelease(note)) return "“课表”正式更名为“实时课表”，多班级课程查看更清楚，PDF 导入对合班课程和多个班级的识别、关联更加顺畅。";
    if (isStudentImportValidationRelease(note)) return "学生导入严格校验民族、政治面貌和学籍状态；出现非系统选项会直接拒绝并提示修改，从源头统一筛选和统计口径。";
    if (isPrecisionAndRegionRelease(note)) return "综测与成绩汇总按真实数值计算后精确舍入；学业分析生源地统一为“省/自治区＋市（州）”或“直辖市＋区（县）”，数字和地域统计都更准确。";
    if (isLeaveTypeRelease(note)) return "查课记录与课表考勤把“请假”细分为“事假、病假”，两类名单和人数分开维护；导入导出、学生课堂记录、归档清理同步更新，请假总人数仍能统一核对，历史请假数据继续兼容。";
    if (isRosterIdentityLayoutRelease(note)) return "花名册与自定义花名册加宽证件照、姓名和学号等身份信息区域，12 位学号保持单行显示；页面查看与 PDF 导出同步优化，打印归档更清楚。";
    if (isLicenseContactRelease(note)) return "授权激活页的购买及售后微信统一更新为 shuzhixuegong1，购买激活码、授权咨询和售后反馈都认准这一联系方式。";
    if (isAcademicWarningTemplateRelease(note)) return "学业预警附件1—5可下载、校验并导入自定义 Word 模板，也能恢复系统默认模板；整套预览、单人 Word/PDF、批量下载同步使用当前模板，预警课程超过 6 门自动扩行。";
    if (/全系统学期台账.*新学期在前|学期台账.*排序/.test(note)) return "所有学期台账统一按新学期在前排序，最近数据打开就能看到。";
    if (/下线“?知识”?功能|知识.*代码.*数据.*缓存/.test(note)) return "“知识”功能及代码、数据、缓存、恢复入口和 AI 配置全部清理，旧数据不会从备份重新恢复。";
    if (/宿舍空间信息.*即时同步|兼容多种手机号字段/.test(note)) return "学生资料保存或恢复后，宿舍空间信息即时同步，并兼容多种手机号字段，如“手机号”“手机号码”“联系电话”。";
    if (/功能区导航.*默认收起|重新进入或刷新.*收起/.test(note)) return "重新进入或刷新系统时，功能区导航默认收起，侧栏更简洁，需要时再展开。";
    if (/优化花名册版式|每行\s*3\s*人.*每页\s*18\s*人/.test(note)) return "页面预览、全屏预览与 PDF 导出统一为每行 3 人、每页 18 人，屏幕查看和最终文件采用同一版式。";
    if (/字段超出卡片宽度时自动换行|内容截断或横向溢出/.test(note)) return "姓名、学号、学院、专业、家庭住址等长字段自动换行，避免内容截断或横向溢出。";
    if (isDormSpatialRelease(note)) return "宿舍管理新增“空间总览、住宿分布、公寓资源”：可按区位—楼栋—楼层—房间—可配置床位查看入住情况，支持宿舍长、入住历史、床位独立登记、床位冲突校验和毕业自动退宿；批量导入异常时原子回滚。";
    if (/学院代码.*专业代码.*班级名称.*安全修改|基础数据.*安全修改.*同步关联数据/.test(note)) return "学院代码、专业代码和班级名称可安全修改，关联的学生及业务数据同步更新，避免新旧名称并存。";
    if (/查课记录.*请假名单|请假名单.*课堂管理.*课表考勤/.test(note)) return "查课记录新增“请假名单”，与课堂管理、课表考勤同步，导入导出也能保留人员明细。";
    if (isFieldScopeRelease(note)) return "字段管理仅保留在学生管理、班级干部管理、宿舍管理和辅导员成长档案；升级时清理已下线模块的字段配置与历史值。删除保留模块中的已保存字段会同步清除对应历史值，且不可恢复，操作前请先导出或备份。";
    if (/工作台班级学生分布.*党员.*团员|党员、团员人数.*名单/.test(note)) return "班级学生分布新增“党员人数”和“团员人数”，还能打开名单查看学生基本信息。";
    if (/清空本地全部数据.*演示数据|重新载入演示数据/.test(note)) return "修复清空本地全部数据后无法重新载入演示数据的问题，演示和培训环境可再次初始化。";
    if (/班委考核.*尺寸动画|表格越出页脚/.test(note)) return "修复大弹窗打开时表格越出页脚的问题，筛选、表格和底部操作区显示更完整。";
    if (/综测数据.*弹窗标题|新增、编辑弹窗标题/.test(note)) return "新增时显示“新增综测数据”，编辑时显示“编辑综测数据”，操作状态更清楚。";
    if (/字段管理|业务台账.*自定义字段/.test(note)) return "进入业务页面顶部“字段扩展”，可新增单行文字、多行文字、数字、日期、下拉选项等自定义字段；支持排序、停用、按记录填写和导入导出。系统字段只读，停用字段的历史值继续保留。";
    if (/学生删除.*仍.*显示|删除名单核对/.test(note)) return "修复学生删除后仍可能显示的问题，并移除“删除名单核对”旧入口。";
    if (/宿舍管理名单.*在校生.*同步|住宿信息.*独立新增/.test(note)) return "宿舍管理名单自动跟随在校生；住宿信息仍可单独新增或批量导入。";
    if (/班委考核.*筛选区.*纵向|班委考核.*按钮.*裁切/.test(note)) return "修复筛选区堆叠、表格空间不足和底部按钮裁切，弹窗操作更完整。";
    if (/独立的辅导员成长档案|成果台账.*年度对比/.test(note)) return "论文、项目、个人荣誉、指导学生获奖集中建台账；可附证明材料、批量导入、看年度对比并生成年度材料 Word。";
    if (/个人档案编辑.*修改历史|修改历史.*恢复/.test(note)) return "个人信息可维护；成果记录的新增、编辑、删除等操作有历史可查、可恢复。删除记录恢复后，附件需重新上传。";
    if (/班级干部.*学籍异动.*自动离任|非在校.*班级干部.*离任/.test(note)) return "学籍状态变为非在校后，在任班级干部自动离任，并同步学生档案与班委考核名单；仍在校的转专业不触发。";
    if (/资助情况.*民族/.test(note)) return "资助明细新增“民族”，从学生信息自动匹配，导入、导出也带上这一列。";
    if (/反馈与建议|系统问题.*功能.*建议/.test(note)) return "点击工作台顶部入口，跳转外部表单提交系统问题或功能完善建议；请勿填写学生隐私。";
    return noteDescription(note);
  };
  const bullets = model.notes.map((note, index) => `${index + 1}️⃣ ${noteTitle(note, index)}\n${shortDescription(note)}`).join("\n\n");
  const growthRelease = model.notes.some((note) => /独立的辅导员成长档案|成果台账.*年度对比/.test(note));
  const expandedGrowthRelease = growthRelease && model.notes.some((note) => /班级干部.*学籍异动.*自动离任/.test(note));
  const fieldRelease = model.notes.some((note) => /字段管理|业务台账.*自定义字段/.test(note));
  const fieldScopeRelease = model.notes.some(isFieldScopeRelease);
  const dormSpatialRelease = model.notes.some(isDormSpatialRelease);
  const rosterLayoutRelease = model.notes.some(isRosterLayoutRelease);
  const dormRecap = model.includeDormRecap === true;
  const warningTemplateRelease = model.notes.some(isAcademicWarningTemplateRelease);
  const leaveTypeRelease = model.notes.some(isLeaveTypeRelease);
  const governanceRelease = model.notes.some(isTermGovernanceRelease) && model.notes.some(isMultiClassInspectionRelease);
  const opening = governanceRelease
    ? `一次合班课，要不要为每个班重复建查课记录？导入一份台账，又担心学期选错、字段写法不统一？数智学工 ${model.version} 这次从“统一口径”出发，带来学期统一管理、多班级查课、实时课表、导入严校验等 6 项升级，让数据从录入到分析更准确。`
    : leaveTypeRelease
    ? `查课时只记一个“请假”，事假和病假还要回头翻材料区分？花名册里的 12 位学号又总被挤成两行？数智学工 ${model.version} 这次集中解决三个高频细节：请假分类更精准、花名册展示更清晰、购买及售后联系更明确。`
    : warningTemplateRelease
    ? `学校的学业预警通知书有自己的固定文字、页眉页脚和版式，却只能使用系统默认模板？数智学工 ${model.version} 这次把模板选择权交还给老师：附件1—5可自定义 Word 模板，预览、单人下载和批量生成全部同步。再加上学期排序、宿舍同步、导航收起与旧功能清理，五项体验一次焕新。`
    : rosterLayoutRelease
    ? (dormRecap ? `花名册预览时明明正常，导出 PDF 后长专业名、家庭住址却挤成一团？想查空床、宿舍长和床位冲突，还要在多张表里来回翻？中秋第二袭，数智学工 ${model.version} 一次解决两个“看不清”：花名册更舒展，宿舍管理更立体。` : `中秋第二袭，数智学工 ${model.version} 把一次“小改版”做到了日常工作最容易感知的地方：花名册从页面预览、全屏预览到 PDF 导出全部统一排版，长姓名、长专业名和家庭住址终于可以自然换行，不再挤成一团或被截断。`)
    : dormSpatialRelease
    ? `中秋将至，数智学工 ${model.version} 也送上一份宿舍管理“升级礼”：从过去的住宿名单，进一步升级为区位、楼栋、楼层、房间、床位逐级展开的立体化公寓管理。哪里有空床、哪间宿舍缺宿舍长、是否存在床位冲突，都能更直观地查看和处理。`
    : fieldScopeRelease
    ? `数智学工 ${model.version} 让“字段管理”更聚焦：仅保留在学生管理、班级干部管理、宿舍管理和辅导员成长档案，并清理已下线模块的字段配置与历史值。工作台还新增党员、团员人数和名单查看，常用信息更集中。`
    : fieldRelease
    ? `临时多了一项信息要统计，还要等系统改表？数智学工 ${model.version} 的“字段管理”把这件事交还给使用者：在常用业务台账中直接增加所需字段，填写、导入、导出都能继续衔接。`
    : growthRelease
    ? `辅导员的论文、项目、个人荣誉、指导学生获奖，是否还散在不同文件夹里？数智学工 ${model.version} 新增独立的“辅导员成长档案”，把成果记录、证明材料和年度汇总放到一起。${expandedGrowthRelease ? "这次还补充了班干部学籍联动、资助字段和反馈入口三项实用细节。" : ""}本次整理 ${model.fromVersion} 至 ${model.version} 的更新。`
    : `辅导员日常最怕两件事：同一份信息反复录，系统升级还担心数据受影响。数智学工 ${model.version} 正式更新，本次汇总 ${model.fromVersion} 至 ${model.version} 的改进，重点围绕${summarizeTopics(model.notes)}等高频体验展开。`;
  return [
    `标题：${model.title || (fieldScopeRelease ? `数智学工 ${model.version}｜字段管理更聚焦，党团员名单一键查看` : fieldRelease ? `不用等开发也能加字段！数智学工 ${model.version} 字段管理上线` : expandedGrowthRelease ? `数智学工 ${model.version}｜成长档案上线，班级干部异动自动离任` : `数智学工 ${model.version} 更新了｜${model.notes.length}项改进：${summarizeTopics(model.notes)}`)}`, "",
    opening, "",
    ...(dormRecap ? [`说明：V5.4.6 系统更新页展示的是本版花名册优化；下方“立体化宿舍管理”于 V5.4.5 首次上线，并已核对继续包含在 V5.4.6 安装包中。`, ""] : fieldRelease && model.notes.some(isPackageSupplement) ? [`说明：“字段管理”为 ${model.version} 安装包功能补充，系统更新页仍显示原发布摘要。`, ""] : expandedGrowthRelease ? [`说明：系统更新页显示的是发布摘要，以下三项细节已在 ${model.version} 安装包中核对。`, ""] : []),
    bullets,
    ...(dormRecap ? ["", "🏢 中秋第一袭功能延续：立体化宿舍管理", "打开“空间总览”，入住、空床、缺宿舍长和床位冲突校验结果一眼可见；进入“住宿分布”和“公寓资源”，可按区位—楼栋—楼层—房间—可配置床位逐级管理。宿舍长、入住历史、床位独立登记、毕业自动退宿及批量导入原子回滚，也都继续完整保留。", "", "🌕 哪些时候特别好用？", "新生报到：快速核对住宿与空床；中秋走访：按楼栋、房间定位学生；班级点名：花名册长信息不丢失；材料归档：预览效果与 PDF 更一致。"] : []),
    "", "怎么更新？",
    "进入“系统管理—系统更新”→点击“检查更新”→点击“下载并校验”→校验通过后点击“立即更新并重启”。", "",
    "更新只替换程序文件，学生数据、附件、备份、便携密钥和本机配置继续保留；程序替换或启动异常时会尝试恢复旧版本；业务数据备份可在“备份恢复”中手动创建。升级完成后，在登录页或系统侧栏确认新版本号即可。", "",
    governanceRelease ? "多班级查课、学期统一管理、实时课表，你最想先体验哪一项？评论区告诉我👇" : leaveTypeRelease ? "事假、病假分开统计后，你最常用的是名单维护、导入导出，还是学生课堂记录？评论区告诉我👇" : dormRecap ? "花名册和立体化宿舍管理，你最想先用哪一个？评论区告诉我👇" : "你最期待下一版完善哪项功能？评论区告诉我👇", "",
    dormRecap ? "#高校辅导员 #辅导员工作 #宿舍管理 #花名册 #数智学工 #系统更新 #数字化校园" : "#高校辅导员 #辅导员工作 #学生工作 #数智学工 #系统更新 #效率工具 #数字化校园"
  ].join("\n");
}

async function captureUpdateScreenshot(model, screenshotPath) {
  const { chromium } = loadDependency("playwright");
  const edgeCandidates = [process.env.PLAYWRIGHT_EDGE_PATH, "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
  const executablePath = edgeCandidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error("未找到 Microsoft Edge，无法生成系统更新截图。");
  const origin = new URL(model.origin).origin;
  const entry = await fetch(`${origin}/`, { redirect: "manual" });
  if (!entry.ok) throw new Error(`系统页面不可访问：HTTP ${entry.status}`);
  const rawCookie = String(entry.headers.get("set-cookie") || "").split(";")[0];
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1800, height: 1180 }, deviceScaleFactor: 1 });
    if (rawCookie.includes("=")) {
      const split = rawCookie.indexOf("=");
      await context.addCookies([{ name: rawCookie.slice(0, split), value: rawCookie.slice(split + 1), url: origin }]);
    }
    const page = await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    const screenshotStatus = { fromVersion: model.fromVersion, version: model.version, notes: model.notes, size: model.packageSize, publishedAt: model.publishedAt };
    await page.evaluate(() => {
      if (typeof window.goto !== "function" || typeof window.systemUpdateRender !== "function") throw new Error("当前页面缺少系统更新模块。");
      window.goto("update");
    });
    await page.waitForTimeout(500);
    await page.evaluate(({ fromVersion, version, notes, size, publishedAt }) => {
      window.systemUpdateRender({ enabled: true, currentVersion: fromVersion, platform: "win32-x64", channel: "stable", lastCheckedAt: publishedAt, latest: { version, size, publishedAt, releaseNotes: notes.join("；") }, downloaded: null, installProgress: null, lastError: "" });
      const sideVersion = document.getElementById("sideVersion");
      if (sideVersion) sideVersion.textContent = `数智学工工作台 ${fromVersion}`;
    }, screenshotStatus);
    await page.addStyleTag({ content: "#demoLoadBtn,#demoClearBtn,#cockpitEntryBtn{display:none!important}.content{padding-top:22px!important}#systemUpdatePage{box-shadow:0 12px 34px rgba(10,90,65,.09)}" });
    await page.locator("#systemUpdatePage").waitFor({ state: "visible" });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await context.close();
  } finally { await browser.close(); }
}

function imageDimensions(data) {
  if (data.length > 24 && data.toString("ascii", 1, 4) === "PNG") return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  return { width: 1800, height: 1180 };
}

function fitImage(data, maxWidth = 620, maxHeight = 430) {
  const size = imageDimensions(data), scale = Math.min(maxWidth / size.width, maxHeight / size.height, 1);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

function docHelpers() {
  const docx = loadDependency("docx");
  const { AlignmentType, HeadingLevel, ImageRun, Paragraph, TextRun } = docx;
  const green = "0B7D57", dark = "16372B", muted = "64746D";
  const paragraph = (text, options = {}) => new Paragraph({ alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: options.after ?? 150, line: options.line ?? 330 }, heading: options.heading, children: [new TextRun({ text, bold: options.bold, size: options.size || 22, color: options.color || dark, font: "Microsoft YaHei" })] });
  const heading = (text, level = 1) => paragraph(text, { heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, bold: true, size: level === 1 ? 32 : 27, color: green, after: 170 });
  const spacer = () => new Paragraph({ spacing: { after: 60 }, children: [] });
  const picture = (data, caption) => { const dimensions = fitImage(data); return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 80 }, children: [new ImageRun({ data, transformation: dimensions, type: "png" })] }), paragraph(caption, { center: true, size: 18, color: muted, after: 180 })]; };
  return { ...docx, paragraph, heading, spacer, picture, green, dark, muted };
}

async function writeDocxFiles(model, screenshotPath, outputDirectory) {
  const h = docHelpers(), image = fs.readFileSync(screenshotPath);
  const styles = { default: { document: { run: { font: "Microsoft YaHei", size: 22, color: h.dark }, paragraph: { spacing: { line: 330, after: 150 } } } }, paragraphStyles: [
    { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 44, bold: true, color: h.green }, paragraph: { spacing: { after: 260 }, alignment: h.AlignmentType.CENTER } },
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 32, bold: true, color: h.green }, paragraph: { spacing: { before: 260, after: 160 } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Microsoft YaHei", size: 27, bold: true, color: h.green }, paragraph: { spacing: { before: 210, after: 130 } } }
  ] };
  const properties = { page: { margin: { top: 900, right: 1050, bottom: 900, left: 1050 } } };
  const xhsParagraphs = [];
  for (const line of xhsCopy(model).split("\n")) {
    if (!line) xhsParagraphs.push(h.spacer());
    else if (line.startsWith("标题：")) xhsParagraphs.push(new h.Paragraph({ style: "Title", children: [new h.TextRun({ text: line.slice(3), font: "Microsoft YaHei", bold: true, color: h.green, size: 42 })] }));
    else if (line === "怎么更新？") xhsParagraphs.push(h.heading(line));
    else if (/^\d+️⃣/.test(line)) xhsParagraphs.push(h.paragraph(line, { bold: true, size: 25, color: h.green, after: 80 }));
    else if (line.startsWith("#")) xhsParagraphs.push(h.paragraph(line, { color: h.green, size: 20 }));
    else xhsParagraphs.push(h.paragraph(line));
  }
  const hasSupplement = model.notes.some(isPackageSupplement) || model.includeDormRecap === true;
  xhsParagraphs.push(...h.picture(image, hasSupplement ? `系统内更新页面展示 ${model.fromVersion} → ${model.version} 的发布摘要；本文另补充已核对的功能细节。` : `系统内更新演示：${model.fromVersion} 检测到 ${model.version}，可查看日志并按步骤升级。`));
  const xhsDoc = new h.Document({ styles, sections: [{ properties, children: xhsParagraphs }] });

  const hasFieldManagement = model.notes.some((note) => /字段管理|业务台账.*自定义字段/.test(note));
  const fieldScopeRelease = model.notes.some(isFieldScopeRelease);
  const dormSpatialRelease = model.notes.some(isDormSpatialRelease) || model.includeDormRecap === true;
  const rosterLayoutRelease = model.notes.some(isRosterLayoutRelease);
  const warningTemplateRelease = model.notes.some(isAcademicWarningTemplateRelease);
  const leaveTypeRelease = model.notes.some(isLeaveTypeRelease);
  const governanceRelease = model.notes.some(isTermGovernanceRelease) && model.notes.some(isMultiClassInspectionRelease);
  const title = model.title || (fieldScopeRelease ? `数智学工 ${model.version} 升级日志｜字段管理范围收敛，工作台新增党团员名单` : hasFieldManagement ? `数智学工 ${model.version} 升级日志｜字段管理上线：业务台账可以按需扩展了` : `数智学工 ${model.version} 升级日志｜${model.notes.length}项高频优化：${summarizeTopics(model.notes)}`);
  const updateSections = model.notes.flatMap((note, index) => [h.heading(`${index + 1}. ${noteTitle(note, index)}`, 2), h.paragraph(noteDescription(note)), h.paragraph(`${isPackageSupplement(note) ? "安装包功能补充" : "正式更新日志"}：${note}`, { size: 19, color: h.muted })]);
  const fieldGuide = fieldScopeRelease ? [
    h.heading("字段管理为什么要收敛到四个模块", 1),
    h.paragraph("本次更新后，字段管理仅保留在学生管理、班级干部管理、宿舍管理和辅导员成长档案。四类档案都是需要长期维护、且个性化信息较多的核心场景，集中保留可以降低跨模块字段重复、口径不一和误操作风险。", { bold: true }),
    h.paragraph("四个保留模块中，系统字段继续保持只读；自定义字段仍可设置单行文字、多行文字、数字、日期和下拉选项，并调整名称、顺序、选项及启用状态。", { bold: true }),
    h.paragraph("升级时，已下线模块的字段配置及其历史值会被清理。若只是暂时不显示保留模块中的某个字段，可取消启用；若点击删除并确认保存，该模块全部记录中的对应历史值会一并删除，且不可恢复。", { bold: true }),
    h.paragraph("建议在删除字段或执行版本升级前，先导出所需信息或完成数据备份，再核对字段名称、使用模块和历史数据需求。", { color: h.green })
  ] : hasFieldManagement ? [
    h.heading("字段管理怎么用", 1),
    h.paragraph("第一步：进入需要扩展的业务页面，在页面顶部找到“字段扩展”，点击“字段管理”。系统原有字段会完整列出，但保持只读、不可删除。", { bold: true }),
    h.paragraph("第二步：点击“＋增加字段”，填写字段名称，并选择单行文字、多行文字、数字、日期或下拉选项。字段可以调整顺序；类型保存后锁定，避免历史数据失真。", { bold: true }),
    h.paragraph("第三步：保存后点击“查看/填写字段”，按原业务记录维护扩展内容。批量场景可下载模板，再按记录 ID 导入；现有字段和值也可以导出。", { bold: true }),
    h.paragraph("需要暂时下线某个字段时请选择“停用”。停用不会删除历史值，已有记录和备份仍保留原内容，后续可以继续核对。", { bold: true }),
    h.paragraph("适用范围覆盖学生管理、班级干部管理、资助情况、助学贷款、处分情况、综测与学业、课表、谈心谈话、家校联系、重点关爱、成长档案、就业等多类业务台账。", { color: h.green })
  ] : [];
  const dormGuide = dormSpatialRelease ? [
    h.heading(model.includeDormRecap ? "中秋第一袭功能延续：立体化宿舍管理" : "从名单到空间：宿舍管理有了立体视角", 1),
    h.paragraph(model.includeDormRecap ? "立体化宿舍管理于 V5.4.5 首次上线，并继续完整包含在 V5.4.6 安装包中。“空间总览、住宿分布、公寓资源”三个入口将空间、人员和床位关系组织起来，与本版优化后的花名册形成从名单查看到住宿管理的完整链路。" : "过去查看宿舍信息，更多是在名单里逐行查找；V5.4.5 将“宿舍管理”升级为“空间总览、住宿分布、公寓资源”三个一体化入口。住宿信息仍以学生管理中的当前在校生为来源，但空间、人员和床位之间的关系被清楚地组织起来。", { bold: true }),
    h.heading("空间总览：一眼看清入住与异常", 2),
    h.paragraph("页面按照“区位—楼栋—楼层—宿舍—床位”逐级展示，可直接查看可配置床位、已住人数、空床、宿舍房间、缺宿舍长和床位冲突校验结果。点击房间即可继续查看每个床位上的学生、宿舍长及历史入住情况。"),
    h.heading("住宿分布：学生名单与床位实时联动", 2),
    h.paragraph("在校学生的住宿情况统一维护。校内住宿需要完整填写宿舍楼、房间号和床位号；同一床位不能重复分配。学生调整宿舍后，原入住信息会进入历史记录，便于后续追溯。"),
    h.heading("公寓资源：统一维护楼栋、房间和床位", 2),
    h.paragraph("“公寓资源”成为区位、楼栋、房间和床位的唯一维护入口。老师可以配置房间床位数、启用或停用资源、安排学生入住、设置或更换宿舍长，让宿舍基础数据不再分散维护。"),
    h.heading("毕业自动退宿，历史仍然可查", 2),
    h.paragraph("学生学籍状态转为毕业时，系统会在确认后自动办理退宿并释放床位，同时保留入住历史。既避免毕业生继续占用床位，也不会因为清空现住宿信息而失去历史依据。"),
    h.heading("床位独立登记，不干扰学生主数据", 2),
    h.paragraph("对不在本系统学生名单中的其他住宿人员，可使用“床位独立登记”记录姓名、编号、单位、班级、辅导员和备注。这类信息仅作床位备注，不修改学生档案，也不计入系统入住人数、空床或床位冲突统计。"),
    h.heading("批量导入原子回滚，整批更安心", 2),
    h.paragraph("批量导入住宿信息时，如目标房间尚未建立，系统可在确认后补充公寓资源；如果整批数据中出现住宿信息缺项或床位冲突，批量导入原子回滚会撤销整批修改，避免留下只导入一部分的半成品数据。", { color: h.green })
  ] : [];
  const rosterGuide = rosterLayoutRelease ? [
    h.heading("一张花名册，先解决“挤、乱、截”", 1),
    h.paragraph("花名册既要容纳证件照和身份信息，又要保证打印后能够看清。V5.4.6 将页面稳定划分为三列、六行，每页最多展示 18 名学生。每张学生卡片获得更充足的横向空间，姓名、学号、学院、专业和家庭住址等信息不必再被迫压缩。", { bold: true }),
    h.heading("三种查看方式，保持同一版式", 2),
    h.paragraph("页面中的花名册预览、点击“全屏预览”后的放大查看，以及最终导出的 PDF 花名册，都使用相同的三列六行布局。预览时看到的分页和卡片排列，更接近最终导出结果，减少导出后才发现版式变化的情况。"),
    h.heading("长字段自动换行，关键信息完整显示", 2),
    h.paragraph("当姓名、学号、学院、专业、家庭住址或其他已勾选字段超过卡片宽度时，系统会在卡片内部自动换行。包含较多字段时，文字尺寸和行距也会相应收紧，在有限空间中尽量保留完整内容，避免横向溢出。"),
    h.heading("花名册这样生成", 2),
    h.paragraph("进入“学生信息管理—花名册”，选择按寝室、按班级或按专业生成，并设置学生状态、住宿情况、学院、专业、年级、班级等筛选条件。勾选需要的导出字段后，点击“生成花名册”，即可在页面预览中核对。"),
    h.paragraph("确认内容后，可点击“全屏预览”进行放大检查，再选择“导出 PDF 花名册”。建议重点核对证件照、姓名、学号、班级、宿舍和家庭住址等长内容；如字段过多，可按实际用途精简勾选范围。", { color: h.green }),
    h.heading("哪些场景更适合使用", 2),
    h.paragraph("新版花名册适合新生报到、宿舍走访、班级点名、家校联系信息核对和纸质材料归档。版式调整不会修改学生管理或宿舍管理中的原始数据，只改变花名册的预览与 PDF 呈现方式。")
  ] : [];
  const warningTemplateGuide = warningTemplateRelease ? [
    h.heading("学业预警模板，终于可以按学校要求调整", 1),
    h.paragraph("不同学校、学院对学业预警附件1—5的固定文字、字体、页眉页脚和版式往往有自己的要求。V5.4.7 新增 Word 模板管理，让老师可以在保留系统数据填充能力的同时，使用本校规范的文书样式。", { bold: true }),
    h.heading("第一步：下载当前 Word 模板", 2),
    h.paragraph("进入“学业预警”，点击“附件1—5 Word模板”，先下载当前模板。在 Word 中可以修改固定文字、字体、页眉页脚和整体版式；为保证姓名、课程和签字信息准确写入，请保留原有数据表格、单元格结构及附件顺序。"),
    h.heading("第二步：重新导入并自动校验", 2),
    h.paragraph("选择修改后的 .doc 或 .docx 文件重新导入。系统会检查附件1—5的结构，只有通过校验的模板才会启用，减少模板改动后生成失败或字段错位。"),
    h.heading("第三步：预览与下载全部同步", 2),
    h.paragraph("模板启用后，整套预览、单人 Word、单人 PDF 和批量下载会同步使用当前模板，不需要分别设置。发现版式不合适时，也可以点击“恢复系统默认模板”快速回到初始状态。"),
    h.heading("课程超过6门，表格自动扩行", 2),
    h.paragraph("当学生的预警课程超过 6 门时，附件中的课程区域会自动增加行数，避免多出的课程被截断。无论单人生成还是批量下载，都按照实际课程数量完整呈现。", { color: h.green })
  ] : [];
  const leaveTypeGuide = leaveTypeRelease ? [
    h.heading("一次分类，贯通查课与课表考勤", 1),
    h.paragraph("过去统一记为“请假”的记录，现在可以进一步区分为“事假”和“病假”。在查课记录中，可分别选择两类学生名单；系统同步计算和核对请假总人数，并将分类结果带入课表考勤和学生个人课堂记录。", { bold: true }),
    h.heading("名单、人数、导入导出同步更新", 2),
    h.paragraph("事假名单、病假名单各自展示人数，查课记录的新增、编辑、查看和导出采用同一口径。批量导入时也提供对应字段，避免导入后再逐条拆分；需要汇总时，请假总人数仍保留，兼顾分类管理和整体统计。"),
    h.heading("历史请假数据继续兼容", 2),
    h.paragraph("升级不会让原有“请假”记录失效。历史名单、学生课堂记录及关联数据继续兼容；删除或归档查课记录时，相应的学生课堂关联记录也会同步清理，减少新旧数据并存造成的重复统计。"),
    h.heading("花名册把关键信息放得更舒展", 1),
    h.paragraph("本次同步调整花名册与自定义花名册：证件照和身份信息区域进一步加宽，照片、姓名、学号等内容更容易辨认。12 位学号保持单行显示，减少折行对卡片布局的干扰；PDF 导出沿用同一套优化规则，屏幕核对与打印归档更加一致。"),
    h.heading("购买与售后，请认准新微信", 1),
    h.paragraph("授权激活页中的购买及售后微信现已更新为 shuzhixuegong1。购买激活码、授权使用咨询或售后问题反馈，均可通过该微信联系。建议以系统授权激活页显示的信息为准。", { color: h.green })
  ] : [];
  const governanceGuide = governanceRelease ? [
    h.heading("把学期交给一个入口统一管理", 1),
    h.paragraph("V5.5.0 将全系统学期收拢到“系统管理—学期设置”。新建学期后，各业务台账直接使用同一份学期清单；升级时，系统还会从既有业务记录中自动补录历史学期，避免旧数据因为学期清单不完整而无法筛选。", { bold: true }),
    h.heading("正在使用的学期，不允许误删", 2),
    h.paragraph("如果某个学期仍被综测、成绩、资助、查课或其他业务数据使用，系统会阻止删除，并提示先处理相关数据。批量导入时则要求提前选定唯一目标学期，模板内容不会再悄悄写入其他学期。"),
    h.heading("合班课一次记录，多班级同步联动", 1),
    h.paragraph("查课新增多班级选择。面对合班课、跨专业课程或多个班共同上课的场景，只需建立一条查课记录，即可同时关联多个班级。学院、年级筛选会随班级范围变化，考勤名单也统一从所选班级学生中选择。", { bold: true }),
    h.paragraph("保存后，旷课、事假、病假、迟到和早退等结果同步进入相应学生的课堂记录；导入模板和导出明细也保留多班级信息，减少重复录入和后续合并。"),
    h.heading("“实时课表”更适合查看多班课程", 1),
    h.paragraph("原“课表”更名为“实时课表”。除了名称更直观，多班级课程的展示与 PDF 导入也进行了优化，合班课程不再需要依靠重复课表才能看清班级范围。"),
    h.heading("导入先严校验，统计才有统一口径", 1),
    h.paragraph("学生导入会严格核对民族、政治面貌和学籍状态。只要出现系统选项之外的写法，本次导入就会提示修正，避免“共青团员”“团员”等不同表述在筛选时被拆成多个类别。"),
    h.heading("数值精确舍入，生源地统一到两级", 1),
    h.paragraph("综测与成绩汇总以真实数值参与计算，最后再精确舍入，降低多次取整带来的结果偏差。学业分析中的生源地则统一输出省/自治区＋市（州），或直辖市＋区（县），让地域分布结果更规范。", { color: h.green })
  ] : [];
  const wechatParagraphs = [
    new h.Paragraph({ style: "Title", children: [new h.TextRun({ text: title, font: "Microsoft YaHei", bold: true, color: h.green, size: 42 })] }),
    h.paragraph(`数智学工 · 辅导员工作台　｜　${formatDate(model.publishedAt)}`, { center: true, size: 19, color: h.muted, after: 230 }),
    h.paragraph(governanceRelease ? `数智学工 ${model.version} 围绕“统一、准确、安全”完成六项升级：学期统一治理，合班查课只建一次，课表升级为“实时课表”，学生导入从源头拦截非标准值，统计计算与生源地分析也进一步规范；授权不可用时，业务数据访问同步锁定。` : leaveTypeRelease ? `同样是“请假”，事假和病假对应的管理、统计与后续关注并不完全相同。数智学工 ${model.version} 从这个高频细节入手，让查课与课表考勤的分类更准确；同时优化花名册关键信息展示，并统一更新购买及售后联系方式。` : warningTemplateRelease ? `中秋第三弹，数智学工 ${model.version} 围绕“文书更灵活、台账更顺手、数据更同步、界面更清爽”带来五项更新。学业预警附件1—5首次支持自定义 Word 模板，另外四项改进也覆盖日常使用中的高频细节。` : rosterLayoutRelease && model.includeDormRecap ? `中秋第二袭，数智学工 ${model.version} 一次完善两类高频体验：花名册采用统一的三列六行版式，长字段自动换行；V5.4.5 上线的立体化宿舍管理在本版安装包中继续完整保留，让名单查看与宿舍空间管理衔接得更顺畅。` : rosterLayoutRelease ? `中秋第二袭，数智学工 ${model.version} 聚焦花名册的“最后一公里”：页面预览、全屏预览与 PDF 导出采用同一套三列六行版式，长字段自动换行，让屏幕上看得清、导出后也更整齐。` : dormSpatialRelease ? `中秋将至，数智学工 ${model.version} 带来一份面向宿舍管理的特别更新：把传统住宿名单升级为可查看空间层级、入住状态和床位异常的立体化公寓管理。同时，基础数据改名同步和查课请假名单联动也一并上线。` : fieldScopeRelease ? `数智学工 ${model.version} 围绕“数据更清楚、操作更稳”完成五项更新：字段管理收敛到四个核心模块，工作台补充党团员人数与名单，同时修复演示数据重载、班委考核弹窗和综测标题等高频细节。` : hasFieldManagement ? `表格字段不够用，过去往往意味着重新改模板、另建 Excel，甚至等待系统开发。数智学工 ${model.version} 把“字段管理”带进多类业务台账：系统字段保持稳定，自定义字段按实际工作需要扩展，数据仍跟随原记录统一保存。` : model.notes.some((note) => /独立的辅导员成长档案|成果台账.*年度对比/.test(note)) ? `辅导员的成长材料，值得有一份独立、清晰、可持续维护的档案。数智学工 ${model.version} 从 ${model.fromVersion} 升级而来：新增独立的辅导员成长档案，并优化个人档案编辑与成果修改历史恢复。${model.notes.some((note) => /班级干部.*学籍异动.*自动离任/.test(note)) ? "本篇也补充介绍安装包中已实现的班干部学籍联动、资助“民族”字段及反馈建议入口。" : ""}` : `辅导员老师们反馈的高频需求，这次集中安排上了。${model.version} 汇总了 ${model.fromVersion} 之后的 ${model.notes.length} 项功能新增与体验优化，重点减少重复建表、重复填写和导入后的人工核对。`),
    ...(hasSupplement ? [h.paragraph(model.includeDormRecap ? `版本归属说明：V5.4.6 系统更新页的正式摘要为花名册版式优化；立体化宿舍管理于 V5.4.5 首次上线，并已核对继续包含在 V5.4.6 安装包中。` : `说明：系统更新页目前展示的是发布摘要；标注“安装包功能补充”的内容已经在 ${model.version} 安装包中核对。`, { size: 19, color: h.muted })] : []),
    ...(rosterLayoutRelease && model.includeDormRecap ? [
      h.heading("这次更新，解决两个“看不清”"),
      h.paragraph("第一个“看不清”，发生在花名册里：长姓名、长专业名、家庭住址一多，卡片容易显得拥挤，甚至要等导出 PDF 后才发现内容被截断。V5.4.6 用三列六行和自动换行，让预览与导出更接近“所见即所得”。"),
      h.paragraph("第二个“看不清”，发生在宿舍管理里：只有一张住宿名单，很难快速判断哪栋楼还有空床、哪间宿舍缺宿舍长、哪里存在床位冲突。立体化宿舍管理把名单还原为空间关系，让问题更容易被发现。"),
      h.paragraph("一张表更清楚，一栋楼更直观——把翻表、核对和返工的时间，留给真正需要走近的学生。", { bold: true, color: h.green, size: 25 })
    ] : []),
    h.heading("本次更新速览"), ...updateSections, ...governanceGuide, ...leaveTypeGuide, ...warningTemplateGuide, ...rosterGuide, ...dormGuide, ...fieldGuide,
    h.heading("怎么更新数智学工"),
    h.paragraph("第一步：进入“系统管理—系统更新”，点击“检查更新”，查看目标版本、升级包大小和更新说明。", { bold: true }),
    h.paragraph("第二步：点击“下载并校验”。升级包下载完成后，系统会执行 SHA-256 完整性校验，校验通过才允许安装。", { bold: true }),
    h.paragraph("第三步：点击“立即更新并重启”，在确认框中选择“确定”。服务重新启动后，在登录页或侧栏核对版本号。", { bold: true }),
    ...h.picture(image, model.includeDormRecap ? `▲ ${model.fromVersion} → ${model.version} 系统更新操作示意：页面展示 V5.4.6 花名册更新摘要；正文同步回顾本安装包继续包含的立体化宿舍管理。` : hasSupplement ? `▲ ${model.fromVersion} → ${model.version} 系统更新操作示意：页面展示发布摘要，正文另补充已核对的功能细节。` : `▲ ${model.fromVersion} → ${model.version} 系统更新操作示意：检查更新后可查看完整更新日志。`),
    h.heading("更新时，原来的学生数据还在吗？"),
    h.paragraph("在。在线更新只替换程序白名单中的文件，不覆盖学生数据、附件、已有备份、便携密钥和本机配置。如果替换或启动出现异常，会尝试恢复原程序并重启旧版本。业务数据备份可在“备份恢复”中手动创建。"),
    h.paragraph("升级包仅通过已授权的更新服务获取，下载后必须通过完整性校验。已校验文件保存在本机更新目录，关闭网页或重启服务后无需重复下载。"),
    h.heading(governanceRelease ? "少做重复录入，多一份数据确定性" : leaveTypeRelease ? "分类更准确，信息也更清楚" : warningTemplateRelease ? "把格式交给学校，把重复工作交给系统" : rosterLayoutRelease && model.includeDormRecap ? "这个中秋，把走访时间留给学生" : "让升级更简单，让数据更可靠"),
    h.paragraph(governanceRelease ? "学期、班级、导入字段、统计数值和行政区口径看似是不同问题，背后都指向同一件事：让每一份数据有明确归属，让每一次统计建立在一致规则上。V5.5.0 希望把老师从重复核对和返工中再往前解放一步。" : leaveTypeRelease ? "从事假、病假的准确记录，到花名册照片与学号的清晰呈现，V5.4.9 没有追求功能堆叠，而是继续把辅导员每天都会用到的细节做得更顺手。" : warningTemplateRelease ? "一份符合本校规范的学业预警文书、一眼看到的最新学期、随学生资料即时同步的宿舍信息，以及刷新后更清爽的功能导航——V5.4.7 没有堆砌功能，而是把每天都会遇到的细节继续做顺。" : rosterLayoutRelease && model.includeDormRecap ? "从一张不再拥挤的花名册，到一屏看清的宿舍空间，V5.4.6 希望减少那些琐碎却反复发生的整理工作。新生报到、中秋走访、班级点名或材料归档时，老师可以少翻几张表、少做几次返工，把更多精力留给学生本人。" : "版本更新不只是增加功能，更重要的是把辅导员每天反复处理的细节做得更稳、更顺手。数智学工会继续围绕真实学生工作场景持续完善。"),
    h.paragraph(governanceRelease ? "这六项升级中，你最想先体验哪一项？欢迎留言告诉我们。" : leaveTypeRelease ? "这三项更新中，你最想先体验哪一项？欢迎留言告诉我们。" : warningTemplateRelease ? "这五项更新中，你最想先体验哪一项？欢迎留言告诉我们。" : rosterLayoutRelease && model.includeDormRecap ? "花名册与立体化宿舍管理，你最想先用哪一项？欢迎留言告诉我们。" : "你最希望下一版解决哪个问题？欢迎留言告诉我们。", { bold: true, color: h.green }),
    h.paragraph("数智学工——让学生工作更有序，让数据管理更安心。", { center: true, bold: true, size: 24, color: h.green })
  ];
  const wechatDoc = new h.Document({ styles, sections: [{ properties, children: wechatParagraphs }] });
  const xhsPath = path.join(outputDirectory, `${model.version}-小红书笔记.docx`), wechatPath = path.join(outputDirectory, `${model.version}-微信公众号推文.docx`);
  fs.writeFileSync(xhsPath, await h.Packer.toBuffer(xhsDoc));
  fs.writeFileSync(wechatPath, await h.Packer.toBuffer(wechatDoc));
  return { xhsPath, wechatPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = normalizeVersion(args.version, "目标"), fromVersion = normalizeVersion(args["from-version"] || args.version, "起始"), notes = splitNotes(args["release-notes"]);
  if (!notes.length) throw new Error("更新日志不能为空；请通过 --release-notes 提供真实更新内容。");
  const outputDirectory = path.join(safeOutputRoot(args["output-root"]), version);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const model = { version, fromVersion, notes, title: String(args.title || "").trim(), includeDormRecap: args["include-dorm-recap"] === "true", packageSize: Number(args["package-size"] || 0), publishedAt: args["published-at"] || new Date().toISOString(), origin: args.origin || "http://127.0.0.1:18766" };
  const screenshotPath = path.join(outputDirectory, `${version}-系统更新截图.png`);
  if (args["reuse-screenshot"] === "true") {
    if (!fs.existsSync(screenshotPath)) throw new Error(`指定复用的系统更新截图不存在：${screenshotPath}`);
  } else await captureUpdateScreenshot(model, screenshotPath);
  const documents = await writeDocxFiles(model, screenshotPath, outputDirectory);
  console.log(JSON.stringify({ ok: true, outputDirectory, screenshotPath, ...documents }));
}

if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
else module.exports = { splitNotes, noteTitle, noteDescription, summarizeTopics, normalizeVersion, isPackageSupplement, isFieldScopeRelease, isDormSpatialRelease, isRosterLayoutRelease, isAcademicWarningTemplateRelease, isLeaveTypeRelease, isRosterIdentityLayoutRelease, isLicenseContactRelease, isLicenseLockRelease, isTermGovernanceRelease, isMultiClassInspectionRelease, isRealtimeTimetableRelease, isStudentImportValidationRelease, isPrecisionAndRegionRelease, xhsCopy };
