# 自动化测试

## 综测与成绩汇总输入文件生命周期（2026-10-17）

运行 `runtime/node.exe tests/qa-academic-summary-input-lifecycle.cjs`。隔离浏览器验证原始文件上传后刷新页面、关闭重开及主工作台刷新均清除输入，并清理旧版 IndexedDB 缓存；生成历史单独持久化，不受输入清理影响。

## Word与综合导入边界复核（2026-10-17）

新增 `qa-import-input-boundaries.cjs`（CSV/XLS输入）、`qa-isolated-target-guard.cjs`（综合测试PID隔离）、`qa-student-import-lifecycle-browser.cjs`（重复提交/旧回调/2000行校验），以及 `qa-word-safety.cjs`、`qa-word-api-boundaries.cjs`、`qa-word-editor-isolation-browser.cjs`、`qa-word-ownership.cjs`、`qa-word-timeout-owned.cjs`。已纳入统一入口。`qa-word-integration-trace.cjs`只为原整库脚本添加阶段诊断，避免在统一入口重复整库两遍。真实Word测试只处理测试自行创建且核验归属的PID，不能全局关闭WINWORD。范围与结果见 `docs/Word与综合导入全面复核-2026-10-17.md`。

## 固定选项历史值巡检（2026-10-17）

执行 `node tests/qa-fixed-value-review-browser.cjs`。隔离浏览器以“大专”等历史值验证扫描不改数据、显示具体学号/姓名、按记录处理、保留后本版本不重复提示且新版本重新扫描；自由维护的招生类别与毕业生就业“去向类型”不参与巡检，并验证后者可填写自定义值。

## 班级学生分布排序（2026-10-17）

`qa-dashboard-class-filter-logic.cjs` 验证学院代码数值顺序、年级升序、班级数字部分比较、人数与专业不影响优先级、缺失信息及源数据不变；`qa-dashboard-class-filters.cjs` 在隔离服务中验证结果表和筛选后排序，并保留原筛选、人数、名单与响应式断言。两项及 `qa-static.cjs` 均通过，本次未运行全系统122组回归。

## 导入与花名册 PDF 进度提示（2026-10-16）

执行 `runtime/node.exe tests/qa-operation-progress-browser.cjs`。专项使用隔离数据库验证：进行中的进度不会按时间自动消失，成功后才自动收起，失败信息保留并可手动关闭；统一弹窗导入、字段映射导入和学生组织独立页面均等待真实异步保存完成。`qa-roster-layout-browser.cjs` 同步检查普通版与自定义版花名册在真实 PDF 下载前显示进度、成功后收起，并继续验证逐页高清 PNG、无 JPEG 压缩和多页完整性。

## 勾选联动与学业边界复查（2026-10-16）

运行 `runtime/node.exe tests/qa-checkbox-linkage.cjs`，用合成数据及隔离浏览器验证基础数据五页签、分组/筛选/全选/半选/非当前页签隔离，以及就业跟踪、综测、学生翻页、宿舍、资助、就业意向、学生组织第二课堂的双向勾选。可用 `--area=maint`、`--area=employment`、`--area=academic`、`--area=other`、`--area=org` 聚焦检查。已纳入统一入口；加上导入进度专项，当前统一入口为117组。学业公用版原有专项补充部分字段修订保留、历史重复考试待核查、异常单元格、材料占位、阶段错配、考试历史回导和绩点保留；见 `docs/学业公用版遗漏与边界复查-2026-10-16.md`。

## 公用版教务成绩与项目考证（2026-10-14）

执行 `runtime/node.exe tests/qa-academic-public-project-exams.cjs`、`runtime/node.exe tests/qa-academic-public-project-service.cjs` 与 `runtime/node.exe tests/qa-academic-public-project-browser.cjs`。三项已纳入完整入口，分别验证考试项目身份/达标与材料分离/预警独立性、真实Excel与分项/修订和撤销/精确导出，以及页面筛选/统计/单条考试与课程修订/320—1440px布局。边界专项补充新统计接口的班级权限和版本保护。用合成学生、临时数据库与模拟授权，不访问正式数据。结果见 `docs/学业公用版教务成绩与考证完善-2026-10-14.md` 及对应回归日志。

## 花名册照片与自定义版排版（2026-10-13）

执行 `runtime/node.exe tests/qa-roster-layout-browser.cjs` 与 `runtime/node.exe tests/qa-dorm-roster-pdf.cjs`。新增专项已纳入统一入口，使用隔离数据库、随机端口及虚构学生检查两版预览和实际PDF：竖长/横宽照片全图及比例、每行3人每页18人、19人拆为两页、页脚边界、身份栏和空字段标签、长字段换行、弹窗关闭及四个窗口宽度。原专项继续核对长学号、字段来源和非空白高清PDF；静态检查改为约束共用排版入口。2026-10-16 增加高清多页导出回归：强制让整页画布的 Base64 转换抛出 `Invalid string length`，要求普通和自定义花名册仍通过二进制 PNG 完成下载，并确认 PDF 不含 JPEG `/DCTDecode` 编码。相关验证与截图见 `docs/花名册照片与自定义版排版修复-2026-10-13.md`。

## 学生身份空值自动补全（2026-10-12）

执行 `runtime/node.exe tests/qa-student-identity-autofill.cjs`、`runtime/node.exe tests/qa-student-identity.cjs` 和 `runtime/node.exe tests/qa-student-import-dates.cjs`。新增专项已纳入完整入口，覆盖已有记录启动补全、写入和旧备份恢复、空白/null/旧字段别名、已有值保留、无效或不可推断的证件、加密保存、重复启动零重写，以及不产生额外备份。仅使用隔离数据库，禁止对正式学生记录执行测试注入。

沙箱系统临时目录无法重命名时，可将 `WORKBENCH_QA_TEMP` 指向工作区内已建立的专用测试目录，测试副本仍与正式 `data/` 分离。

## 公用版多学期预警（2026-10-11）

新增 `qa-academic-public-periods.cjs`、`qa-academic-public-period-service.cjs` 和 `qa-academic-public-period-browser.cjs`，已纳入完整入口。覆盖单学期、不连续多学期、全部学期截止点、入学前排除、缺失数据、门数/学分/绩点规则、课程去重、补考重修、加密名单快照、权限与版本冲突、导出、页面全选、390—1440px布局、原生备份恢复及重启。使用隔离数据库，详细口径见 `docs/学业公用版多学期预警-2026-10-11.md`。

## 主机与协作会话失效入口（2026-10-10）

执行 `runtime/node.exe tests/qa-session-relogin.cjs`，已加入完整回归入口。使用隔离服务真实重启，验证主机失效提示及 `/login.html` 入口、重新进入后的本机管理员身份、协作失效提示及独立登录入口、未保存主机表单草稿导出、取消跳转保留草稿。该专项、静态、授权门禁与协作权限边界检查通过。

## 个人版成绩与学业预警批量删除（2026-10-10）

执行 `runtime/node.exe tests/qa-personal-academic-batch-delete.cjs`。已加入完整回归入口，验证两处名单的当前页全选、部分勾选状态、分页和查询清空选中项、数量确认、取消无写入、失败保留勾选、只读保护、成功后刷新持久化，以及回收站中保留整行和课程明细。本次专项、学业预警滚动布局、授权门禁、静态和61个页面启动/渲染检查通过。

## 学业预警编辑表格横向滚动（2026-10-10）

执行 `runtime/node.exe tests/qa-academic-warning-layout.cjs`。使用隔离数据库和模拟名单，验证1440、1024、768、430px窗口下操作列不截断、超宽表格具备可见横向滚动条、滚动后删除链接可达，以及查询分页保留；已加入完整回归入口。浏览器测试关闭无头模式默认的隐藏滚动条参数，避免遗漏实际滚动条显示验证。该专项与静态检查通过。

## 未激活演示浏览专项（2026-10-10）

执行 `runtime/node.exe tests/qa-license-gate.cjs`、`runtime/node.exe tests/qa-demo-data.cjs`、`runtime/node.exe tests/qa-demo-after-clear-browser.cjs`、`runtime/node.exe tests/qa-license.cjs` 和 `runtime/node.exe tests/qa-static.cjs`。

覆盖未激活状态的演示数据手动载入、刷新、查询、学生 XLSX 导出、公用版学业导出、清除后重新载入，以及前端导入/新增按钮和直接业务写接口拦截；浏览器专项还覆盖“清空本地全部数据”后的权威快照替换、页面刷新、系统内置就业资源/空住宿配置识别及再次载入演示数据。系统初始参考目录不会误报为真实数据，用户修改目录或住宿默认设置后仍会触发真实数据保护。

本次上述专项通过。完整入口通过此前的学业公用版、课表、字号、就业、任务及协作 API 测试后，在 `qa-collaboration-browser.cjs:27` 停止：该测试保留打开的表单，随后点击协作面板，被 `#mask.mask.show` 遮罩拦截。此已激活协作路径未在本次修改范围内；不宣称全量回归通过。

在项目根目录运行完整测试：

```powershell
.\runtime\node.exe .\tests\run-all.cjs
```

也可按需执行单项测试：

```powershell
.\runtime\node.exe .\tests\qa-static.cjs
.\runtime\node.exe .\tests\qa_delete_verify.cjs
.\runtime\node.exe .\tests\qa-integration.cjs
.\runtime\node.exe .\tests\qa-imports.cjs
.\runtime\node.exe .\tests\qa-browser.cjs
```

## 覆盖范围

- `qa-static.cjs`：JavaScript 语法、导航目标、重复 ID、内联事件处理器、安全标记、产品名称和关键页面约束。
- `qa_delete_verify.cjs`：验证已删除的废弃功能不重新出现，并确认仍需保留的函数可用。
- `qa-integration.cjs`：在系统临时目录的独立服务中验证登录鉴权、数据读写、附件、备份和学业预警文档流程。
- `qa-imports.cjs`：在隔离浏览器和临时数据库中，真实选择 CSV/图片文件，验证学生、学生照片、证书图片、资助、住宿、综测、学业预警名单/课程、就业、资源目录、基础数据及十个通用台账的字段映射、校验、附件写入和记录写入结果。
- `qa-browser.cjs`：使用 Microsoft Edge 逐一打开导航页面，检查页面异常、控制台错误和 HTTP 错误。
- `QA_COUNSELOR_GROWTH_ONLY=1`：专项验证独立成长档案的成果、支撑材料附件、代表性/归档、导入入口、年度对比、字典、修改历史、已下线状态及其他字段清理、持久化、脱敏导出及无跨模块关系字段。

集成与浏览器测试创建临时副本与独立数据库，不会读取或写入正式 `data/workbench.db`。

完整入口当前共45组：41个入口加4个浏览器聚焦模式（多班查课、事假/病假、今日待办、在校生选择器）。新增 qa-tasks.cjs 与 qa-counselor-attachment-download.cjs，全量浏览器同步包含待办及学生选择器检查。完整入口清除继承的 QA_* 聚焦开关，首个失败时停止。

`qa-academic-summary-ai.cjs` 和 `qa-academic-summary-formats.cjs` 通过 `isolated-workbench-helper.cjs` 自动复制程序/资源、生成临时测试授权、分配空闲端口并等待健康接口。无需提前启动正式工作台；结束后停止临时服务并清理临时副本。格式专项单独运行时可额外检查桌面独立工具；完整系统回归固定 `QA_ACADEMIC_SUMMARY_SYSTEM_ONLY=1`，不依赖桌面文件。

`qa-tool-csp.cjs` 在真实 Edge 中验证五个工具正常加载，同源外部脚本可执行，注入的内联脚本和 HTML 事件属性被 CSP 阻止。预期的注入阻断日志仅出现在这部分安全验证中。

Python 学业分析格式/模板验收需要参考文件参数，Windows 安装器和真实云升级验收需要发行环境，须按发行范围单独执行。

## 迁移补齐专项

```powershell
.\runtime\node.exe .\tests\qa-tasks.cjs
.\runtime\node.exe .\tests\qa-counselor-attachment-download.cjs
.\runtime\node.exe .\tests\qa-productivity-browser.cjs
```

最后一项使用随机端口及隔离数据库，验证任务保存刷新、筛选/分页、便签回收/撤销、备份/清空/恢复/重启、共享读写权限，以及学生候选/同名/键盘/业务回填和窄屏布局。其内容也通过 qa-browser.cjs 的 QA_TASKS_ONLY 与 QA_STUDENT_PICKER_ONLY 聚焦开关进入统一回归。实际结果见 `docs/迁移缺失功能补齐验证-2026-10-08.md`，历史通过记录不能代替当前验收。

## 公寓资源导入专项（2026-10-08）

2026-10-16 补充 `runtime/node.exe tests/qa-dorm-import-performance.cjs`、`runtime/node.exe tests/qa-dorm-import-large-browser.cjs` 和 `runtime/node.exe tests/qa-import-batch-persistence.cjs`，均纳入统一入口。分别覆盖 2000 条住宿的固定全量工作预算、真实 Excel 自动新增 500 间宿舍及刷新回读、重复资源提示去重/冲突阻断，以及资助与成长档案各 2000 条的集中保存、单条即时保存、最新摘要/300 条历史和失败回滚。原资源专项已按完全重复自动去重、差异内容冲突阻断更新断言。详见 `docs/宿舍批量导入性能与自动去重修复-2026-10-16.md`。

2026-10-17 增加 `runtime/node.exe tests/qa-dorm-batch-clear-browser.cjs` 并纳入统一入口。专项使用三名虚构在校生验证住宿分布的批量清除：无选择提示、影响范围确认、集中清空住宿字段、释放当前床位、结束宿舍长身份、保留入住历史、未选中学生隔离、清除跨页选择状态及刷新后的持久化结果。

2026-10-17 增加 `runtime/node.exe tests/qa-backup-delete.cjs` 并纳入统一入口。本机加密备份删除改为整组清理数据库快照、SQLite 的 WAL/SHM/journal 侧文件、附件目录、便携数据密钥和学业预警模板副本，逐项确认文件已经消失后再删除列表索引；刷新备份列表时会自动修复主文件缺失但残件或索引仍在的历史半删除状态。专项覆盖完整删除、残件自愈、列表刷新、实际页面删除和服务重启后不再出现。

在程序目录运行 `runtime/node.exe tests/qa-dorm-resource-import.cjs`、`runtime/node.exe tests/qa-dorm-resource-browser.cjs` 和 `runtime/node.exe tests/qa-import-async-commit.cjs`。

覆盖楼栋和房间的模板下载与 XLSX 回导、CSV/别名表头、前导零房号、自动新增楼栋、重复导入跳过、容量更新、必填/范围/区位/楼层/重复校验、独立登记及计划入住保护、只读权限、保存回滚、异步保存确认与防重复提交、刷新持久化和窄屏按钮。这三个专项已加入统一测试入口。

本次专项和 `qa-dorm-import.cjs`、`qa-static.cjs` 通过。全量入口在 `qa-integration.cjs:765` 的学业预警自定义模板编辑器标记断言停止；单独 `qa-imports.cjs:313` 因协作面板遮挡课表保存按钮超时；原有 `QA_DORM_SPATIAL_ONLY=1` 专项在 `qa-browser.cjs:815` 的床位登记清除断言失败，同时服务报告测试学生学院/专业关联不一致。因此不宣称全量回归通过；上述路径未在本任务中修改。

## 今日待办截图功能专项（2026-10-08）

执行 `runtime/node.exe tests/qa-tasks.cjs`、`runtime/node.exe tests/qa-task-reference-dashboard.cjs` 和 `runtime/node.exe tests/qa-productivity-browser.cjs`。前两项已纳入统一入口。验证真实统计、逾期跳转、标签数量、勾选及当前页批量完成/重新打开、周期下一期、失败回滚、编辑刷新持久化、提醒详情、常用功能卡片删除和只读保护；浏览器布局覆盖三种主题和五种宽度。便签、删除恢复、备份恢复及共享权限由 productivity 专项覆盖。统计及操作说明见 `docs/今日待办功能完善-2026-10-08.md`。

本次上述专项通过；重跑全量入口仍在 `qa-integration.cjs:765` 的既有学业预警自定义模板预览断言失败处停止，后续组未由本次全量入口执行，不代表全量验收通过。

## 工作任务保存与权限边界专项（2026-10-08）

执行 `runtime/node.exe tests/qa-task-save-boundaries.cjs` 和 `runtime/node.exe tests/qa-task-save-browser.cjs`，均已纳入统一入口。覆盖同步失败回滚、等待数据库确认、防重复提交及固定草稿 ID、表单过期和权限变化、真实协作合并、新任务筛选可见性、弹窗重试及遮挡、异步弹窗身份、任务删除恢复、输入校验、注入文本和真实只读写接口拦截。实际结果及全量回归限制见 `docs/工作任务模块检查与修复-2026-10-08.md`。

## 请销假模块专项（2026-10-18）

在主程序目录执行 `runtime/node.exe tests/qa-student-leave-engine.cjs`、`runtime/node.exe tests/qa-student-leave-service.cjs`、`runtime/node.exe tests/qa-student-leave-browser.cjs`。三项均已加入统一入口。覆盖类型/原因必填、学生与学期、北京时间日期与状态、迟归、重叠、已销假保护、服务二次校验、原子回滚、并发冲突、回收/整档恢复、只读、重启、实际附件和 Excel/CSV 导入导出、改学号及 320/390/768/1440px 布局。浏览器和服务测试使用临时副本、随机端口、合成学生及临时只读账号；不得切换到正式数据库。结果及当前边界见 `docs/请销假模块设计与验证-2026-10-18.md`。

请销假首轮维护的完整入口为 138 组，初跑 134 组通过、4 组未通过，修订测试交互后分别复验通过，不能记为一次全绿。`startup-review-helper.cjs` 通过真实界面明确保留其他功能测试中的历史夹具，不能用于停用或跳过复核功能本身的专项。通用导入测试须走实际页面导航，并在验证跨届就业名单时明确选择全部毕业年份。最终结果和日志位置见上述验证文档。

请销假第二轮新增 `runtime/node.exe tests/qa-student-leave-ui.cjs`，当前入口共139组。覆盖状态快捷筛选与统计范围、键盘查询、分页勾选、办理上下文、分组表单、混合/全部重复Excel回导、带标题的原始行号、日期错误整批阻断、三种主题及五种宽度。本轮139组完整回归通过，最终界面和原业务流程另行复验通过；实际日志与本机资源哈希证据见 `docs/请销假功能与UI排版完善-2026-10-18.md`。

2026-10-19扩展既有请销假规则、服务和界面专项，入口仍139组：七种新类型、已知历史类型保留/恢复且禁止新建、未开始时间边界、六卡片顺序与筛选、旧类型编辑及三主题五宽度。界面截图可通过 `STUDENT_LEAVE_UI_ARTIFACT_PREFIX` 与 `STUDENT_LEAVE_UI_ARTIFACT_DATE` 指定文件名前缀和日期。实际结果见 `docs/请销假类型与未开始卡片-2026-10-19.md`。

## 浏览器测试依赖

浏览器测试需要本机 Microsoft Edge 与 Playwright。若自动发现路径失败，可以显式指定：

```powershell
$env:EDGE_PATH = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$env:CODEX_NODE_MODULES = "D:\path\to\node_modules"
.\runtime\node.exe .\tests\qa-browser.cjs
```

学业预警 PDF 测试还需要本机 Microsoft Word；如果环境不具备该依赖，应在发布验收环境补测该路径，而不是跳过其他测试。

## 就业跟踪专项（2026-10-08）

在程序目录执行 `runtime/node.exe tests/qa-employment-tracking.cjs`。使用隔离服务、模拟学生和临时数据库，验证按学号读取当前意向、毕业年份后列顺序、同名学生及未填写显示、意向关键词搜索、档案详情和关联信息、源意向修改/清空、刷新持久化、真实 XLSX 回读，以及“已落实未签约”的保存、编辑和状态筛选。已纳入统一入口，当前入口为42个测试脚本加4个浏览器聚焦模式，共46组；历史验证规模保留原记录日期。

## 系统界面字号专项（2026-10-08）

在程序目录运行 `runtime/node.exe tests/qa-ui-font-sizes.cjs`。专项使用隔离服务读取11组界面的实际计算字号，与 `fixtures/ui-font-sizes-before.json` 的修改前基线比较，要求每项增加1px；覆盖主界面、任务、成长档案、宿舍、登录、组织及五个工具页，另检查320/768/1024/1440px登录布局。可设置 `UI_QA_SCREENSHOT_DIR` 保存桌面和窄屏截图。已纳入统一入口，当前43个脚本加4个浏览器聚焦模式，共47组。基线采集开关仅用于有意重建基线，统一入口会清除该开关。
## 党团员发展台账导入专项（2026-10-13）

执行 `runtime/node.exe tests/qa-party-import.cjs`、`runtime/node.exe tests/qa-party-import-browser.cjs` 和 `runtime/node.exe tests/qa-party-form-browser.cjs`。三项已纳入完整入口，覆盖固定字段和枚举、日期标准化、学号/姓名关联、空白字段保留、阶段节点去重、三类党课培训记录、切换学生后的完整回填、保存后筛选状态保持、初始化保留培训记录、行数和异常类型限制，以及页面入口、服务端二次校验、持久化和刷新回读。模板浏览器专项还检查“学号 *”必填标记、第 2 行完整示例、冻结前两列和 23 个字段列宽。`QA_IMPORT_TEMPLATE_ONLY=1` 会实际解析生成的全部 XLSX 导入模板，要求每个模板仅含表头和第 2 行非空示例、不包含提示文字，同时检查冻结窗格以及政治面貌、团员身份、当前发展阶段和三类党课状态的停止型下拉验证。

## 导入模板两行规范（2026-10-14）

所有用户下载的 Excel 导入模板只保留第 1 行表头和第 2 行示例，不再生成格式说明、“※”提示行或“填写说明”工作表。在 PowerShell 中运行 `$env:QA_IMPORT_TEMPLATE_ONLY='1'; runtime/node.exe tests/qa-imports.cjs`，实际生成并回读主工作台、自定义花名册、四类保留的自定义字段及学生组织模板；当前覆盖 48 个 XLSX 模板和 6 个基础数据 CSV 模板，并核对扩展名、行数、示例及固定选项。运行 `runtime/node.exe --test tests/qa-academic-public-report.cjs` 检查学业情况（公用版）的课程、补考、重修、等级考试、五表预警报告模板和错误行工作簿；运行 `runtime/node.exe tests/qa-academic-summary-reference.cjs` 检查综测与成绩汇总工具的 5 个静态导入模板；运行 `runtime/node.exe tests/qa-dorm-resource-browser.cjs` 检查区位楼栋、房间床位模板及回导。`qa-static.cjs` 另检查学业分析助手静态字段模板和班主任模板。

## 导入固定选项智能匹配（2026-10-17）

运行 `runtime/node.exe tests/qa-import-smart-match-browser.cjs`。专项覆盖常用别名和近似值推荐、同值多行合并、确认前不改数据、人工改选其他标准值、保留原值后继续被原校验拦截、取消不改数据，以及学生导入、通用映射向导、智能资助导入、基础数据粘贴导入和学生组织独立导入的真实接入；同时检查源文件真实行号、恶意 HTML 文本不执行、特殊选项名不与内部值冲突、超过 200 个不同异常值时停止构建弹窗、不安全表头被拒绝，以及确认修正后真实写入、保留非法值仍不写入。`QA_IMPORT_TEMPLATE_ONLY=1` 的导入模板专项同步验证非法固定选项在用户明确选择保留后仍不能写入。



## 2026-10-19 协作与局域网退役

用户确认仅本机使用。新增 `qa-collaboration-retirement-static.cjs`、`qa-workbench-session-store.cjs` 和 `qa-collaboration-retirement.cjs`；通用数据测试改为 `qa-workbench-store-canonical.cjs`、`qa-workbench-store-live-sync.cjs`。旧独立账号专用测试保存在程序目录外的维护归档，混合业务测试只移除账号分支。当前129个脚本加4个聚焦模式，共133组；实际隔离服务/浏览器验收通过。133组分段回归全部覆盖通过：修复并发合并函数重名后前80组通过，工具历史夹具修正后从该组续跑53组通过（退出码0），不表示一次完整执行全绿。完整模块断言区分并发三方合并与备份二方合并；回环条件的内存变异能触发远程访问断言。正式服务已重启及核对监听、源码/资源哈希。失败与续跑日志保留在恢复方案中。恢复方案见 `docs/协作账号与局域网移除及恢复方案-2026-10-19.md`。


## 2026-10-19 保存异常提示

新增 `qa-save-attention-browser.cjs`：正常及保存中无浮条，连接/保存异常自动展开，收起与恢复、草稿导出、真实重试落库、旧隐藏偏好兼容和手机宽度。已加入统一入口，当前130个脚本加4个模式，共134组。本次10组相关专项通过，未重复完整入口；修改前失败及修改后验证见 `docs/保存状态异常提示调整-2026-10-19.md`。会话与多窗口测试等待面板DOM挂载而非正常状态可见，保留原身份、合并、草稿及重启断言。


## 2026-10-19 全系统检查

新增 `qa-request-origin-security.cjs`、`qa-webdav-resource-boundaries.cjs` 和 `qa-open-filter-sync.cjs`；`qa-launch-port.cjs` 补充精确进程路径、陈旧PID及非本程序的模拟检查，不停止真实进程。当前133个脚本加4个聚焦模式，共137组；完整入口通过（退出码0），进程归属修订后另外复验通过。测试前失败、修复后验证、完整范围、依赖与运行生效记录见 `docs/全系统检查与修复-2026-10-19.md`。
