"use strict";

/*
 * 数智学工：仅本机访问的网页服务。
 * 不依赖网络或第三方服务；正式业务数据保存在 ./data/workbench.db。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const dns = require("dns").promises;
const net = require("net");
const https = require("https");
const os = require("os");
const { spawn } = require("child_process");
const { once } = require("events");
const { Readable, Transform } = require("stream");
const { finished, pipeline } = require("stream/promises");
const { DatabaseSync } = require("node:sqlite");
const { LicenseClient } = require("./license-client");
const { UpdateClient } = require("./update-client");
const { buildDemoStore } = require("./demo-data");
const { createService: createAcademicPublicService } = require("./academic-public-service");
const partyImportEngine = require("./party-import-engine");
const studentIdentitySync = require("./student-identity-sync");
const STUDENT_IDENTITY_LINKS_KEY = "nnuzc_student_identity_links_v1";

const ROOT = __dirname;
const HOST = "127.0.0.1";
const PORT = Number(process.env.XIANGCAI_PORT || 18766);
const APP_VERSION = "V5.6.3";
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_SOURCE_HASH = crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex");
const DEMO_DATA_SOURCE_HASH = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "demo-data.js"))).digest("hex");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "workbench.db");
const BACKUP_DIR = path.join(ROOT, "backups");
const LEGACY_BACKUP_DIR = path.join(DATA_DIR, "backups");
const UPLOAD_DIR = path.join(DATA_DIR, "attachments");
const PID_PATH = path.join(DATA_DIR, "server.pid");
const UPDATE_INSTALL_PROGRESS_PATH = path.join(DATA_DIR, "updates", "install-progress.json");
const WEBDAV_TEMP_DIR = path.join(DATA_DIR, "webdav-tmp");
const ACADEMIC_ANALYSIS_RUN_DIR = path.join(DATA_DIR, "academic-analysis-runs");
/* 便携模式的数据密钥随 data/ 一并复制。它让整文件夹迁移后无需再次输入密码。 */
const PORTABLE_DATA_KEY_PATH = path.join(DATA_DIR, "portable-data-key.json");
const LOG_PATH = path.join(DATA_DIR, "server.log");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "app.js"));
const APP_SOURCE_HASH = crypto.createHash("sha256").update(APP_SOURCE).digest("hex");
const STUDENT_LINK_INTEGRITY_SOURCE = fs.readFileSync(path.join(ROOT, "student-link-integrity.js"));
const STUDENT_LINK_INTEGRITY_HASH = crypto.createHash("sha256").update(STUDENT_LINK_INTEGRITY_SOURCE).digest("hex");
const PARTY_IMPORT_ENGINE_SOURCE = fs.readFileSync(path.join(ROOT, "party-import-engine.js"));
const ACHIEVEMENT_ENHANCEMENTS_SOURCE = fs.readFileSync(path.join(ROOT, "achievement-enhancements.js"));
const ACHIEVEMENT_ENHANCEMENTS_HASH = crypto.createHash("sha256").update(ACHIEVEMENT_ENHANCEMENTS_SOURCE).digest("hex");
const AWARD_STATISTICS_MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "award-statistics-module.js"));
const AWARD_STATISTICS_MODULE_HASH = crypto.createHash("sha256").update(AWARD_STATISTICS_MODULE_SOURCE).digest("hex");
const OTHER_VIOLATION_SOURCE = fs.readFileSync(path.join(ROOT, "other-violation-module.js"));
const OTHER_VIOLATION_SOURCE_HASH = crypto.createHash("sha256").update(OTHER_VIOLATION_SOURCE).digest("hex");
const DORM_ROSTER_MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "dorm-roster-module.js"));
const DORM_ROSTER_MODULE_SOURCE_HASH = crypto.createHash("sha256").update(DORM_ROSTER_MODULE_SOURCE).digest("hex");
const DORM_SPATIAL_MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "dorm-spatial-module.js"));
const DORM_SPATIAL_MODULE_SOURCE_HASH = crypto.createHash("sha256").update(DORM_SPATIAL_MODULE_SOURCE).digest("hex");
const DORM_SPATIAL_MODULE_CSS_SOURCE = fs.readFileSync(path.join(ROOT, "dorm-spatial-module.css"));
const DORM_SPATIAL_MODULE_CSS_HASH = crypto.createHash("sha256").update(DORM_SPATIAL_MODULE_CSS_SOURCE).digest("hex");
const CUSTOM_ROSTER_MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "custom-roster-module.js"));
const CUSTOM_ROSTER_MODULE_SOURCE_HASH = crypto.createHash("sha256").update(CUSTOM_ROSTER_MODULE_SOURCE).digest("hex");
const COUNSELOR_GROWTH_MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "counselor-growth-module.js"));
const COUNSELOR_GROWTH_MODULE_SOURCE_HASH = crypto.createHash("sha256").update(COUNSELOR_GROWTH_MODULE_SOURCE).digest("hex");
const CUSTOM_FIELDS_MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "custom-fields-module.js"));
const CUSTOM_FIELDS_MODULE_SOURCE_HASH = crypto.createHash("sha256").update(CUSTOM_FIELDS_MODULE_SOURCE).digest("hex");
const INTELLIGENCE_ENHANCEMENTS_SOURCE = fs.readFileSync(path.join(ROOT, "intelligence-enhancements.js"));
const INTELLIGENCE_ENHANCEMENTS_HASH = crypto.createHash("sha256").update(INTELLIGENCE_ENHANCEMENTS_SOURCE).digest("hex");
const SEARCHABLE_FILTER_SELECTS_SOURCE = fs.readFileSync(path.join(ROOT, "searchable-filter-selects.js"));
const SEARCHABLE_FILTER_SELECTS_HASH = crypto.createHash("sha256").update(SEARCHABLE_FILTER_SELECTS_SOURCE).digest("hex");
const SEARCHABLE_FILTER_SELECTS_CSS_SOURCE = fs.readFileSync(path.join(ROOT, "searchable-filter-selects.css"));
const SEARCHABLE_FILTER_SELECTS_CSS_HASH = crypto.createHash("sha256").update(SEARCHABLE_FILTER_SELECTS_CSS_SOURCE).digest("hex");
const INDEX_FILE_SOURCE = fs.readFileSync(path.join(ROOT, "index.html"));
const INDEX_FILE_HASH = crypto.createHash("sha256").update(INDEX_FILE_SOURCE).digest("hex");
const INDEX_SOURCE = Buffer.from(INDEX_FILE_SOURCE.toString("utf8").replace('src="/student-link-integrity.js"', `src="/student-link-integrity.js?v=${STUDENT_LINK_INTEGRITY_HASH}"`).replace('src="/app.js"', `src="/app.js?v=${APP_SOURCE_HASH}"`), "utf8");
const INDEX_SOURCE_HASH = crypto.createHash("sha256").update(INDEX_SOURCE).digest("hex");
const LOGIN_FILE_SOURCE = fs.readFileSync(path.join(ROOT, "login.html"));
const LOGIN_FILE_HASH = crypto.createHash("sha256").update(LOGIN_FILE_SOURCE).digest("hex");
const HTML2PDF_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "html2pdf.bundle.min.js"));
const HTML2PDF_HASH = crypto.createHash("sha256").update(HTML2PDF_SOURCE).digest("hex");
const JSZIP_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "jszip.min.js"));
const JSZIP_HASH = crypto.createHash("sha256").update(JSZIP_SOURCE).digest("hex");
const XLSX_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "xlsx.full.min.js"));
const XLSX_HASH = crypto.createHash("sha256").update(XLSX_SOURCE).digest("hex");
const TOOL_HISTORY_CLIENT_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "tool-history-client.js"));
const TOOL_HISTORY_CLIENT_HASH = crypto.createHash("sha256").update(TOOL_HISTORY_CLIENT_SOURCE).digest("hex");
const ACADEMIC_SUMMARY_TOOL_HTML_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-summary-tool.html"));
const ACADEMIC_SUMMARY_TOOL_HTML_HASH = crypto.createHash("sha256").update(ACADEMIC_SUMMARY_TOOL_HTML_SOURCE).digest("hex");
const ACADEMIC_SUMMARY_TOOL_JS_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-summary-tool.js"));
const ACADEMIC_SUMMARY_TOOL_JS_HASH = crypto.createHash("sha256").update(ACADEMIC_SUMMARY_TOOL_JS_SOURCE).digest("hex");
const ACADEMIC_SUMMARY_TOOL_CSS_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-summary-tool.css"));
const ACADEMIC_SUMMARY_TOOL_CSS_HASH = crypto.createHash("sha256").update(ACADEMIC_SUMMARY_TOOL_CSS_SOURCE).digest("hex");
const ACADEMIC_SUMMARY_TOOL_FIXES_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-summary-tool-fixes.css"));
const ACADEMIC_SUMMARY_TOOL_FIXES_HASH = crypto.createHash("sha256").update(ACADEMIC_SUMMARY_TOOL_FIXES_SOURCE).digest("hex");
const ACADEMIC_ANALYSIS_TOOL_HTML_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-analysis-tool.html"));
const ACADEMIC_ANALYSIS_TOOL_HTML_HASH = crypto.createHash("sha256").update(ACADEMIC_ANALYSIS_TOOL_HTML_SOURCE).digest("hex");
const ACADEMIC_ANALYSIS_TOOL_JS_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-analysis-tool.js"));
const ACADEMIC_ANALYSIS_TOOL_JS_HASH = crypto.createHash("sha256").update(ACADEMIC_ANALYSIS_TOOL_JS_SOURCE).digest("hex");
const ACADEMIC_ANALYSIS_TOOL_CSS_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-analysis-tool.css"));
const ACADEMIC_ANALYSIS_TOOL_CSS_HASH = crypto.createHash("sha256").update(ACADEMIC_ANALYSIS_TOOL_CSS_SOURCE).digest("hex");
const ACADEMIC_ANALYSIS_RULES_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-analysis-rules.docx"));
const ACADEMIC_ANALYSIS_RULES_HASH = crypto.createHash("sha256").update(ACADEMIC_ANALYSIS_RULES_SOURCE).digest("hex");
const ACADEMIC_ANALYSIS_FIELD_TEMPLATE_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-analysis-field-template.xlsx"));
const ACADEMIC_ANALYSIS_FIELD_TEMPLATE_HASH = crypto.createHash("sha256").update(ACADEMIC_ANALYSIS_FIELD_TEMPLATE_SOURCE).digest("hex");
/* Excel 表格合并助手：工具箱嵌入页（AI 经主系统代理，资产仅同源分发） */
const EXCEL_MERGE_TOOL_HTML_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-merge-tool.html"));
const EXCEL_MERGE_TOOL_HTML_HASH = crypto.createHash("sha256").update(EXCEL_MERGE_TOOL_HTML_SOURCE).digest("hex");
const EXCEL_MERGE_APP_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-merge-app.js"));
const EXCEL_MERGE_APP_HASH = crypto.createHash("sha256").update(EXCEL_MERGE_APP_SOURCE).digest("hex");
const EXCEL_MERGE_WORKER_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-merge-worker.js"));
const EXCEL_MERGE_EXTRACT_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-merge-extract.js"));
const EXCEL_MERGE_EXTRACT_HASH = crypto.createHash("sha256").update(EXCEL_MERGE_EXTRACT_SOURCE).digest("hex");
const EXCEL_CHECK_TOOL_HTML_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-check-tool.html"));
const EXCEL_CHECK_TOOL_HTML_HASH = crypto.createHash("sha256").update(EXCEL_CHECK_TOOL_HTML_SOURCE).digest("hex");
const EXCEL_CHECK_APP_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-check-app.js"));
const EXCEL_CHECK_APP_HASH = crypto.createHash("sha256").update(EXCEL_CHECK_APP_SOURCE).digest("hex");
const EXCEL_CHECK_STYLE_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "excel-check-style.css"));
const EXCEL_CHECK_STYLE_HASH = crypto.createHash("sha256").update(EXCEL_CHECK_STYLE_SOURCE).digest("hex");
/* 注入内容哈希版本号：核对工具更新后浏览器缓存自动失效（与 index.html 的 app.js?v= 同机制） */
const EXCEL_CHECK_TOOL_HTML_SERVED = Buffer.from(
  EXCEL_CHECK_TOOL_HTML_SOURCE.toString("utf8")
    .replace('src="/assets/excel-check-app.js"', 'src="/assets/excel-check-app.js?v=' + EXCEL_CHECK_APP_HASH.slice(0, 12) + '"')
    .replace('href="/assets/excel-check-style.css"', 'href="/assets/excel-check-style.css?v=' + EXCEL_CHECK_STYLE_HASH.slice(0, 12) + '"'),
  "utf8");
const DATA_MATCH_TOOL_HTML_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "data-match-tool.html"));
const DATA_MATCH_APP_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "data-match-app.js"));
const DATA_MATCH_APP_HASH = crypto.createHash("sha256").update(DATA_MATCH_APP_SOURCE).digest("hex");
const DATA_MATCH_STYLE_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "data-match-style.css"));
const DATA_MATCH_STYLE_HASH = crypto.createHash("sha256").update(DATA_MATCH_STYLE_SOURCE).digest("hex");
const DATA_MATCH_TOOL_HTML_SERVED = Buffer.from(
  DATA_MATCH_TOOL_HTML_SOURCE.toString("utf8")
    .replace('src="/assets/data-match-app.js"', 'src="/assets/data-match-app.js?v=' + DATA_MATCH_APP_HASH.slice(0, 12) + '"')
    .replace('href="/assets/data-match-style.css"', 'href="/assets/data-match-style.css?v=' + DATA_MATCH_STYLE_HASH.slice(0, 12) + '"'),
  "utf8");
const DATA_MATCH_TOOL_HTML_HASH = crypto.createHash("sha256").update(DATA_MATCH_TOOL_HTML_SOURCE).digest("hex");
const EXCEL_MERGE_WORKER_HASH = crypto.createHash("sha256").update(EXCEL_MERGE_WORKER_SOURCE).digest("hex");
const LOGIN_LOGO_ICON_PNG_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "login-logo-icon.png"));
const LOGIN_LOGO_ICON_PNG_HASH = crypto.createHash("sha256").update(LOGIN_LOGO_ICON_PNG_SOURCE).digest("hex");
const ACADEMIC_WARNING_EDITOR_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "academic-warning-editor-template.html"));
const ACADEMIC_WARNING_EDITOR_HASH = crypto.createHash("sha256").update(ACADEMIC_WARNING_EDITOR_SOURCE).digest("hex");
/* 学生组织管理：复用工作台会话、服务端同步存储与加密附件库。 */
const STUDENT_ORG_PAGE_SOURCE = fs.readFileSync(path.join(ROOT, "学生组织管理.html"));
const STUDENT_ORG_PAGE_HASH = crypto.createHash("sha256").update(STUDENT_ORG_PAGE_SOURCE).digest("hex");
const LOGIN_LOGO_PNG_SOURCE = fs.readFileSync(path.join(ROOT, "assets", "login-logo.png"));
const LOGIN_LOGO_PNG_HASH = crypto.createHash("sha256").update(LOGIN_LOGO_PNG_SOURCE).digest("hex");
/* 2026-08-23 PWA：手机/平板“添加到主屏幕”的应用清单（图标复用现有 376x376 PNG） */
const PWA_MANIFEST = Object.freeze({
  name: "数智学工",
  short_name: "数智学工",
  description: "辅导员学生工作管理平台（本机部署）",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#f2f5f7",
  theme_color: "#12805c",
  icons: [
    { src: "/assets/login-logo-icon.png", sizes: "376x376", type: "image/png", purpose: "any" }
  ]
});
const ACADEMIC_PUBLIC_SOURCE = fs.readFileSync(path.join(ROOT,"academic-public-module.js"));
const ACADEMIC_PUBLIC_STYLE = fs.readFileSync(path.join(ROOT,"academic-public.css"));
const STATIC_ASSETS = Object.freeze({
  studentLinkIntegrity: {raw:STUDENT_LINK_INTEGRITY_SOURCE,gzip:zlib.gzipSync(STUDENT_LINK_INTEGRITY_SOURCE),etag:`"${STUDENT_LINK_INTEGRITY_HASH}"`},
  partyImportEngine: {raw:PARTY_IMPORT_ENGINE_SOURCE,gzip:zlib.gzipSync(PARTY_IMPORT_ENGINE_SOURCE),etag:`"${crypto.createHash("sha256").update(PARTY_IMPORT_ENGINE_SOURCE).digest("hex")}"`},
  academicPublic: {raw:ACADEMIC_PUBLIC_SOURCE,gzip:zlib.gzipSync(ACADEMIC_PUBLIC_SOURCE),etag:`"${crypto.createHash("sha256").update(ACADEMIC_PUBLIC_SOURCE).digest("hex")}"`},
  academicPublicStyle: {raw:ACADEMIC_PUBLIC_STYLE,gzip:zlib.gzipSync(ACADEMIC_PUBLIC_STYLE),etag:`"${crypto.createHash("sha256").update(ACADEMIC_PUBLIC_STYLE).digest("hex")}"`},
  app: { raw: APP_SOURCE, gzip: zlib.gzipSync(APP_SOURCE, { level: 6 }), etag: `"${APP_SOURCE_HASH}"` },
  achievementEnhancements: { raw: ACHIEVEMENT_ENHANCEMENTS_SOURCE, gzip: zlib.gzipSync(ACHIEVEMENT_ENHANCEMENTS_SOURCE, { level: 6 }), etag: `"${ACHIEVEMENT_ENHANCEMENTS_HASH}"` },
  awardStatisticsModule: { raw: AWARD_STATISTICS_MODULE_SOURCE, gzip: zlib.gzipSync(AWARD_STATISTICS_MODULE_SOURCE, { level: 6 }), etag: `"${AWARD_STATISTICS_MODULE_HASH}"` },
  otherViolation: { raw: OTHER_VIOLATION_SOURCE, gzip: zlib.gzipSync(OTHER_VIOLATION_SOURCE, { level: 6 }), etag: `"${OTHER_VIOLATION_SOURCE_HASH}"` },
  dormRosterModule: { raw: DORM_ROSTER_MODULE_SOURCE, gzip: zlib.gzipSync(DORM_ROSTER_MODULE_SOURCE, { level: 6 }), etag: `"${DORM_ROSTER_MODULE_SOURCE_HASH}"` },
  dormSpatialModule: { raw: DORM_SPATIAL_MODULE_SOURCE, gzip: zlib.gzipSync(DORM_SPATIAL_MODULE_SOURCE, { level: 6 }), etag: `"${DORM_SPATIAL_MODULE_SOURCE_HASH}"` },
  dormSpatialModuleCss: { raw: DORM_SPATIAL_MODULE_CSS_SOURCE, gzip: zlib.gzipSync(DORM_SPATIAL_MODULE_CSS_SOURCE, { level: 6 }), etag: `"${DORM_SPATIAL_MODULE_CSS_HASH}"` },
  customRosterModule: { raw: CUSTOM_ROSTER_MODULE_SOURCE, gzip: zlib.gzipSync(CUSTOM_ROSTER_MODULE_SOURCE, { level: 6 }), etag: `"${CUSTOM_ROSTER_MODULE_SOURCE_HASH}"` },
  counselorGrowthModule: { raw: COUNSELOR_GROWTH_MODULE_SOURCE, gzip: zlib.gzipSync(COUNSELOR_GROWTH_MODULE_SOURCE, { level: 6 }), etag: `"${COUNSELOR_GROWTH_MODULE_SOURCE_HASH}"` },
  customFieldsModule: { raw: CUSTOM_FIELDS_MODULE_SOURCE, gzip: zlib.gzipSync(CUSTOM_FIELDS_MODULE_SOURCE, { level: 6 }), etag: `"${CUSTOM_FIELDS_MODULE_SOURCE_HASH}"` },
  intelligenceEnhancements: { raw: INTELLIGENCE_ENHANCEMENTS_SOURCE, gzip: zlib.gzipSync(INTELLIGENCE_ENHANCEMENTS_SOURCE, { level: 6 }), etag: `"${INTELLIGENCE_ENHANCEMENTS_HASH}"` },
  searchableFilterSelects: { raw: SEARCHABLE_FILTER_SELECTS_SOURCE, gzip: zlib.gzipSync(SEARCHABLE_FILTER_SELECTS_SOURCE, { level: 6 }), etag: `"${SEARCHABLE_FILTER_SELECTS_HASH}"` },
  searchableFilterSelectsCss: { raw: SEARCHABLE_FILTER_SELECTS_CSS_SOURCE, gzip: zlib.gzipSync(SEARCHABLE_FILTER_SELECTS_CSS_SOURCE, { level: 6 }), etag: `"${SEARCHABLE_FILTER_SELECTS_CSS_HASH}"` },
  index: { raw: INDEX_SOURCE, gzip: zlib.gzipSync(INDEX_SOURCE, { level: 6 }), etag: `"${INDEX_SOURCE_HASH}"` },
  login: { raw: LOGIN_FILE_SOURCE, gzip: zlib.gzipSync(LOGIN_FILE_SOURCE, { level: 6 }), etag: `"${LOGIN_FILE_HASH}"` },
  html2pdf: { raw: HTML2PDF_SOURCE, gzip: zlib.gzipSync(HTML2PDF_SOURCE, { level: 6 }), etag: `"${HTML2PDF_HASH}"` },
  jszip: { raw: JSZIP_SOURCE, gzip: zlib.gzipSync(JSZIP_SOURCE, { level: 6 }), etag: `"${JSZIP_HASH}"` },
  xlsx: { raw: XLSX_SOURCE, gzip: zlib.gzipSync(XLSX_SOURCE, { level: 6 }), etag: `"${XLSX_HASH}"` },
  toolHistoryClient: { raw: TOOL_HISTORY_CLIENT_SOURCE, gzip: zlib.gzipSync(TOOL_HISTORY_CLIENT_SOURCE, { level: 6 }), etag: `"${TOOL_HISTORY_CLIENT_HASH}"` },
  academicSummaryToolHtml: { raw: ACADEMIC_SUMMARY_TOOL_HTML_SOURCE, gzip: zlib.gzipSync(ACADEMIC_SUMMARY_TOOL_HTML_SOURCE, { level: 6 }), etag: `"${ACADEMIC_SUMMARY_TOOL_HTML_HASH}"` },
  academicSummaryToolJs: { raw: ACADEMIC_SUMMARY_TOOL_JS_SOURCE, gzip: zlib.gzipSync(ACADEMIC_SUMMARY_TOOL_JS_SOURCE, { level: 6 }), etag: `"${ACADEMIC_SUMMARY_TOOL_JS_HASH}"` },
  academicSummaryToolCss: { raw: ACADEMIC_SUMMARY_TOOL_CSS_SOURCE, gzip: zlib.gzipSync(ACADEMIC_SUMMARY_TOOL_CSS_SOURCE, { level: 6 }), etag: `"${ACADEMIC_SUMMARY_TOOL_CSS_HASH}"` },
  academicSummaryToolFixes: { raw: ACADEMIC_SUMMARY_TOOL_FIXES_SOURCE, gzip: zlib.gzipSync(ACADEMIC_SUMMARY_TOOL_FIXES_SOURCE, { level: 6 }), etag: `"${ACADEMIC_SUMMARY_TOOL_FIXES_HASH}"` },
  academicAnalysisToolHtml: { raw: ACADEMIC_ANALYSIS_TOOL_HTML_SOURCE, gzip: zlib.gzipSync(ACADEMIC_ANALYSIS_TOOL_HTML_SOURCE, { level: 6 }), etag: `"${ACADEMIC_ANALYSIS_TOOL_HTML_HASH}"` },
  academicAnalysisToolJs: { raw: ACADEMIC_ANALYSIS_TOOL_JS_SOURCE, gzip: zlib.gzipSync(ACADEMIC_ANALYSIS_TOOL_JS_SOURCE, { level: 6 }), etag: `"${ACADEMIC_ANALYSIS_TOOL_JS_HASH}"` },
  academicAnalysisToolCss: { raw: ACADEMIC_ANALYSIS_TOOL_CSS_SOURCE, gzip: zlib.gzipSync(ACADEMIC_ANALYSIS_TOOL_CSS_SOURCE, { level: 6 }), etag: `"${ACADEMIC_ANALYSIS_TOOL_CSS_HASH}"` },
  academicAnalysisRules: { raw: ACADEMIC_ANALYSIS_RULES_SOURCE, gzip: zlib.gzipSync(ACADEMIC_ANALYSIS_RULES_SOURCE, { level: 6 }), etag: `"${ACADEMIC_ANALYSIS_RULES_HASH}"` },
  academicAnalysisFieldTemplate: { raw: ACADEMIC_ANALYSIS_FIELD_TEMPLATE_SOURCE, gzip: zlib.gzipSync(ACADEMIC_ANALYSIS_FIELD_TEMPLATE_SOURCE, { level: 6 }), etag: `"${ACADEMIC_ANALYSIS_FIELD_TEMPLATE_HASH}"` },
  excelMergeToolHtml: { raw: EXCEL_MERGE_TOOL_HTML_SOURCE, gzip: zlib.gzipSync(EXCEL_MERGE_TOOL_HTML_SOURCE, { level: 6 }), etag: `"${EXCEL_MERGE_TOOL_HTML_HASH}"` },
  excelMergeApp: { raw: EXCEL_MERGE_APP_SOURCE, gzip: zlib.gzipSync(EXCEL_MERGE_APP_SOURCE, { level: 6 }), etag: `"${EXCEL_MERGE_APP_HASH}"` },
  excelMergeWorker: { raw: EXCEL_MERGE_WORKER_SOURCE, gzip: zlib.gzipSync(EXCEL_MERGE_WORKER_SOURCE, { level: 6 }), etag: `"${EXCEL_MERGE_WORKER_HASH}"` },
  excelMergeExtract: { raw: EXCEL_MERGE_EXTRACT_SOURCE, gzip: zlib.gzipSync(EXCEL_MERGE_EXTRACT_SOURCE, { level: 6 }), etag: `"${EXCEL_MERGE_EXTRACT_HASH}"` },
  excelCheckToolHtml: { raw: EXCEL_CHECK_TOOL_HTML_SERVED, gzip: zlib.gzipSync(EXCEL_CHECK_TOOL_HTML_SERVED, { level: 6 }), etag: `"${EXCEL_CHECK_TOOL_HTML_HASH}"` },
  excelCheckApp: { raw: EXCEL_CHECK_APP_SOURCE, gzip: zlib.gzipSync(EXCEL_CHECK_APP_SOURCE, { level: 6 }), etag: `"${EXCEL_CHECK_APP_HASH}"` },
  excelCheckStyle: { raw: EXCEL_CHECK_STYLE_SOURCE, gzip: zlib.gzipSync(EXCEL_CHECK_STYLE_SOURCE, { level: 6 }), etag: `"${EXCEL_CHECK_STYLE_HASH}"` },
  dataMatchToolHtml: { raw: DATA_MATCH_TOOL_HTML_SERVED, gzip: zlib.gzipSync(DATA_MATCH_TOOL_HTML_SERVED, { level: 6 }), etag: `"${DATA_MATCH_TOOL_HTML_HASH}"` },
  dataMatchApp: { raw: DATA_MATCH_APP_SOURCE, gzip: zlib.gzipSync(DATA_MATCH_APP_SOURCE, { level: 6 }), etag: `"${DATA_MATCH_APP_HASH}"` },
  dataMatchStyle: { raw: DATA_MATCH_STYLE_SOURCE, gzip: zlib.gzipSync(DATA_MATCH_STYLE_SOURCE, { level: 6 }), etag: `"${DATA_MATCH_STYLE_HASH}"` },
  academicWarningEditor: { raw: ACADEMIC_WARNING_EDITOR_SOURCE, gzip: zlib.gzipSync(ACADEMIC_WARNING_EDITOR_SOURCE, { level: 6 }), etag: `"${ACADEMIC_WARNING_EDITOR_HASH}"` },
  studentOrg: { raw: STUDENT_ORG_PAGE_SOURCE, gzip: zlib.gzipSync(STUDENT_ORG_PAGE_SOURCE, { level: 6 }), etag: `"${STUDENT_ORG_PAGE_HASH}"` },
  loginLogoPng: { raw: LOGIN_LOGO_PNG_SOURCE, gzip: zlib.gzipSync(LOGIN_LOGO_PNG_SOURCE, { level: 6 }), etag: `"${LOGIN_LOGO_PNG_HASH}"` },
  loginLogoIcon: { raw: LOGIN_LOGO_ICON_PNG_SOURCE, gzip: zlib.gzipSync(LOGIN_LOGO_ICON_PNG_SOURCE, { level: 6 }), etag: `"${LOGIN_LOGO_ICON_PNG_HASH}"` }
});
/* SQL 标识符白名单：仅允许此处列出的表名/列名出现在模板字符串中，防止注入。 */
const VALID_TABLES = new Set([
  "students", "class_groups", "majors", "departments", "terms",
  "meetings", "talk_records", "home_contacts", "punishment_records",
  "fund_records", "dorm_distribution_records", "dorm_module_state",
  "academic_public_state", "academic_public_artifacts", "academic_public_batches", "academic_public_warning_runs", "academic_term_records", "legacy_ui_store", "migration_meta", "recycle_bin", "recycle_bin_audit", "recycle_bin_requests",
  "local_auth", "web_backup_records", "data_center_history", "data_center_asset_map",
  "party_profiles", "party_history",
  "classroom_records", "student_dorm_records", "ai_secret"
]);
const VALID_COLUMNS = new Set([
  "id", "record_id", "student_id", "name", "data_json", "state_json", "detail_json",
  "value", "v", "created_at", "updated_at", "is_current", "sort_order",
  "module_name", "term_id", "term_name", "relative_path", "sha256", "note",
  "status", "key", "password_json", "salt", "content", "filename"
]);
function validateTable(name) {
  if (typeof name !== "string" || !VALID_TABLES.has(name)) {
    throw new Error(`非法表名：${String(name)}`);
  }
  return name;
}
function validateColumn(name) {
  if (typeof name !== "string" || !VALID_COLUMNS.has(name)) {
    throw new Error(`非法列名：${String(name)}`);
  }
  return name;
}
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const MAX_ACADEMIC_WARNING_BODY_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL_BYTES = Math.max(256, Number(process.env.WORKBENCH_ATTACHMENT_QUOTA_MB || 2048)) * 1024 * 1024;
const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;
const AI_REQUEST_TIMEOUT_MS = 30 * 1000;
/* 证书视觉识别要上传大图并等待完整 JSON（非流式），30 秒经常不够；审计显示 30s 整点失败即为超时。 */
const AI_VISION_TIMEOUT_MS = 120 * 1000;
const WEBDAV_REQUEST_TIMEOUT_MS = 60 * 1000;
const WEBDAV_MAX_BUNDLE_BYTES = Math.max(256, Number(process.env.WORKBENCH_WEBDAV_MAX_MB || 4096)) * 1024 * 1024;
const WEBDAV_BUNDLE_MAGIC = Buffer.from("SZWD");
const WEBDAV_BUNDLE_VERSION = 1;
const MOBILE_SYNC_FILENAME = "shuzhi-xuegong-mobile-v1.json";
const MOBILE_SYNC_FORMAT = "SZMG";
const MOBILE_SYNC_VERSION = 1;
const MOBILE_SYNC_KDF_ITERATIONS = 210000;
const MOBILE_SYNC_MAX_BYTES = 20 * 1024 * 1024;
const LOG_ROTATE_BYTES = Math.max(256, Number(process.env.WORKBENCH_LOG_ROTATE_KB || 2048)) * 1024;
const SESSION_COOKIE = "xiangcai_session";
const BRANDING_STORE_KEY = "nnuzc_branding";
const BRANDING_DEFAULT_NAME = "数智学工";
const BRANDING_MAX_LOGO_BYTES = 2 * 1024 * 1024;
const authSessions = new Map();
let licenseClient = null;
let updateClient = null;
let updateInstallScheduled = false;
let lastAiModelListAt = 0;

function licensePublicStatus() {
  return licenseClient ? licenseClient.publicStatus() : { required: false, valid: true, state: "disabled" };
}

function updatePublicStatus() {
  const status = updateClient ? updateClient.publicStatus() : { enabled: false, currentVersion: APP_VERSION, lastError: "更新客户端尚未启动。" };
  const installProgress = readUpdateInstallProgress();
  if (["completed", "error"].includes(installProgress.phase)) updateInstallScheduled = false;
  return Object.assign(status, { installProgress });
}

function readUpdateInstallProgress() {
  try {
    const value = JSON.parse(fs.readFileSync(UPDATE_INSTALL_PROGRESS_PATH, "utf8"));
    if (!value || typeof value !== "object") throw new Error("invalid progress");
    return { phase: String(value.phase || "idle"), percent: Math.max(0, Math.min(100, Math.round(Number(value.percent) || 0))), message: String(value.message || "").slice(0, 300), version: String(value.version || ""), updatedAt: String(value.updatedAt || ""), error: String(value.error || "").slice(0, 500) };
  } catch (_error) {
    return { phase: "idle", percent: 0, message: "", version: "", updatedAt: "", error: "" };
  }
}

function writeUpdateInstallProgress(value) {
  fs.mkdirSync(path.dirname(UPDATE_INSTALL_PROGRESS_PATH), { recursive: true });
  const temporary = `${UPDATE_INSTALL_PROGRESS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Object.assign({}, value, { updatedAt: new Date().toISOString() }), null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, UPDATE_INSTALL_PROGRESS_PATH);
}

function pathTreeBytes(target) {
  let total = 0, pending = [target];
  while (pending.length) {
    const item = pending.pop();
    try {
      const stat = fs.lstatSync(item);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) for (const name of fs.readdirSync(item)) pending.push(path.join(item, name));
      else if (stat.isFile()) total += stat.size;
    } catch (_error) {}
  }
  return total;
}

function ensureUpdateInstallSpace(packageBytes) {
  if (typeof fs.statfsSync !== "function") return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const stats = fs.statfsSync(DATA_DIR);
  const available = Number(stats.bavail) * Number(stats.bsize);
  /* 更新程序不会修改附件；这里只为数据库快照及程序解压/回滚预留空间，避免扫描大量附件拖慢启动。 */
  const protectedDataBytes = pathTreeBytes(DB_PATH);
  const required = protectedDataBytes + Number(packageBytes || 0) * 5 + 512 * 1024 * 1024;
  if (Number.isFinite(available) && available < required) throw httpError(507, `磁盘空间不足，安全升级至少还需要 ${Math.ceil((required - available) / 1024 / 1024)} MB。`, true);
}

function licenseAllowsOperations() {
  const status = licensePublicStatus();
  return status.required !== true || status.valid === true;
}

/* 未激活时允许浏览与演示数据生命周期；业务写入仍在请求入口和提交前双重校验。 */
function licenseAllowsLockedOperation(request, url) {
  const method = String(request && request.method || "GET").toUpperCase();
  const pathname = String(url && url.pathname || "");
  if (method === "GET" || method === "HEAD") return true;
  if (workbenchReadOnlyRender(request, url)) return true;
  return method === "POST" && ["/api/demo/load", "/api/demo/clear", "/api/updates/check", "/api/updates/download", "/api/updates/install"].includes(pathname);
}

function workbenchReadOnlyRender(request, url) {
  return request.method === "POST" && ["/api/academic-warning/render", "/api/academic-warning/batch", "/api/academic-public/exports", "/api/academic-public/analysis"].includes(url.pathname);
}

function licenseReadOnlyPayload() {
  return {
    error: "当前未激活，可以载入演示数据并浏览全部功能；导入、新增及数据修改需要有效激活码。",
    code: "LICENSE_LOCKED",
    licenseRequired: true,
    license: licensePublicStatus()
  };
}
const loginAttempts = new Map();
let database;
let activeDataKey = null;
const ACADEMIC_WARNING_TEMPLATE_PATH = path.join(ROOT, "assets", "academic-warning-template.doc");
const ACADEMIC_WARNING_TEMPLATE_SHA256 = "c70d5a3fa6b9b25bfd2fdc04a56bb0797bd53d1a56c7958ea15a4a06d28c63fa";
const ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH = path.join(DATA_DIR, "academic-warning-template.bin");
const ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH = path.join(DATA_DIR, "academic-warning-template.json");
const ACADEMIC_WARNING_TEMPLATE_VALIDATOR_PATH = path.join(ROOT, "scripts", "validate-academic-warning-template.ps1");
const MAX_ACADEMIC_WARNING_TEMPLATE_BYTES = 20 * 1024 * 1024;
const ACADEMIC_WARNING_SCRIPT_PATH = path.join(ROOT, "scripts", "generate-academic-warning.ps1");
const ACADEMIC_ANALYSIS_SCRIPT_PATH = path.join(ROOT, "scripts", "academic-analysis-engine.py");
let academicWarningRenderQueue = Promise.resolve();
let academicWarningRenderPending = 0;
let academicAnalysisQueue = Promise.resolve();

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size >= LOG_ROTATE_BYTES) {
      for (let index = 4; index >= 1; index--) {
        const from = index === 1 ? LOG_PATH : `${LOG_PATH}.${index - 1}`;
        const to = `${LOG_PATH}.${index}`;
        if (fs.existsSync(from)) { try { fs.rmSync(to, { force: true }); fs.renameSync(from, to); } catch (_error) {} }
      }
    }
    fs.appendFileSync(LOG_PATH, line, "utf8");
  } catch (_error) {}
  console.log(line.trim());
}

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(WEBDAV_TEMP_DIR, { recursive: true });
}

function migrateLegacyDatabaseOnce() {
  if (fs.existsSync(DB_PATH)) return;
  const legacyPath = path.join(ROOT, "desktop-app", "data", "workbench.db");
  if (fs.existsSync(legacyPath)) {
    fs.copyFileSync(legacyPath, DB_PATH);
    log("已迁移原软件数据库到 data/workbench.db。");
  }
}

function openDatabase() {
  if (database) database.close();
  database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  require("./workbench-database.js").migrateDatabase(database);
  /* 已下线功能的数据在启动时清理，避免历史记录继续随备份或迁移保留。 */
  database.exec("DROP TABLE IF EXISTS web_upgrade_jobs; DROP TABLE IF EXISTS web_upgrade_history; DROP TABLE IF EXISTS operation_logs;");
  database.prepare("DELETE FROM legacy_ui_store WHERE key='nnuzc_student_ops'").run();
  purgeRetiredCounselorGrowthPlans();
  purgeRetiredKnowledgeFeature();
  workbenchSnapshotCache = null;
}

const RETIRED_STORE_KEYS = new Set(["nnuzc_kb"]);
function isRetiredStoreKey(key) { return RETIRED_STORE_KEYS.has(String(key || "")); }
function safeStoreKey(key) {
  return typeof key === "string" && /^nnuzc_[A-Za-z0-9_]+$/.test(key) && key !== "nnuzc_session" && key !== "nnuzc_accounts";
}

function readStoreFromDatabase(sourceDatabase = database) {
  return Object.assign(
    Object.fromEntries(sourceDatabase.prepare("SELECT key, value FROM legacy_ui_store ORDER BY key").all().filter((row) => !isRetiredStoreKey(row.key)).map((row) => [row.key, decryptText(row.value)])),
    readCoreStore(sourceDatabase)
  );
}

function readStore() { return readStoreFromDatabase(database); }

/* 三方合并：只提交本客户端实际改动；删除与修改、同一字段的不同修改必须人工处理。 */
function storeEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && storeEqual(a[k], b[k]));
}
function mergeStoreData(base, current, proposed, depth = 0) {
  if (storeEqual(base, proposed)) return current;
  if (storeEqual(base, current) || storeEqual(current, proposed)) return proposed;
  if (depth > 64) throw httpError(400, "数据嵌套层次过多。", true);
  // 首次共同向不存在的集合添加独立记录，也应能合并，不能把缺失键当成不可分割标量。
  if (base === undefined && Array.isArray(current) && Array.isArray(proposed)) base = [];
  else if (base === undefined && current && proposed && typeof current === "object" && typeof proposed === "object" && !Array.isArray(current) && !Array.isArray(proposed)) base = {};
  if ([base, current, proposed].every(v => v && typeof v === "object" && !Array.isArray(v))) {
    const result = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(proposed)])) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw httpError(400, "数据字段无效。", true);
      // 更新时间是系统元数据，不应让两个不同业务字段的修改产生假冲突。
      const metadata = key === "updatedAt" && typeof current[key] === "string" && typeof proposed[key] === "string" && Number.isFinite(Date.parse(current[key])) && Number.isFinite(Date.parse(proposed[key]));
      const value = metadata ? Date.parse(current[key]) >= Date.parse(proposed[key]) ? current[key] : proposed[key] : mergeStoreData(base[key], current[key], proposed[key], depth + 1);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  if ([base, current, proposed].every(Array.isArray)) {
    // 只对有稳定且唯一标识的记录数组合并；不猜测无标识课程、排序数组的身份。
    const field = ["id", "_rid", "_cid", "sid", "studentId", "term", "name", "building", "学号"].find(k =>
      [base, current, proposed].every(rows => rows.every(r => r && typeof r === "object" && !Array.isArray(r) && ["string", "number"].includes(typeof r[k]) && String(r[k]) !== "") && new Set(rows.map(r => String(r[k]))).size === rows.length));
    if (field) {
      const maps = [base, current, proposed].map(rows => new Map(rows.map(r => [String(r[field]), r]))), result = [];
      for (const id of new Set([...maps[1].keys(), ...maps[2].keys(), ...maps[0].keys()])) {
        const row = mergeStoreData(maps[0].get(id), maps[1].get(id), maps[2].get(id), depth + 1);
        if (row !== undefined) result.push(row);
      }
      return result;
    }
  }
  const error = httpError(409, "其他用户已修改同一字段或删除该记录。本次整批保存已取消，请导出未保存草稿，再读取最新数据核对。", true);
  error.code = "COLLABORATION_CONFLICT";
  throw error;
}
function normalizeStoredStudentCollections(value) {
  if (!Array.isArray(value)) return value;
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    // Core tables omit empty child collections on read; that is not a remote deletion.
    const student = { ...row, classroom: row.classroom === undefined ? [] : row.classroom, dorm: row.dorm === undefined ? [] : row.dorm };
    if (row.party && typeof row.party === "object" && !Array.isArray(row.party)) student.party = { ...row.party, history: row.party.history === undefined ? [] : row.party.history };
    return student;
  });
}
function mergeConcurrentStoreValue(base, current, proposed, key) {
  let values;
  try { values = [base, current, proposed].map(v => v === null || v === undefined ? undefined : JSON.parse(v)); }
  catch (_) { values = [base, current, proposed].map(v => v === null ? undefined : v); }
  if (key === "nnuzc_students") values = values.map(normalizeStoredStudentCollections);
  // Empty normalized tables are omitted by readCoreStore. A first insert has
  // no deleted record to conflict with; keep non-empty deletion conflicts intact.
  if (["nnuzc_talks","nnuzc_home","nnuzc_meetings","nnuzc_punishments","nnuzc_fund_records","nnuzc_dorm_dist"].includes(key) && Array.isArray(values[0]) && !values[0].length && values[1] === undefined && Array.isArray(values[2])) values[1] = [];
  const result = mergeStoreData(...values);
  return result === undefined ? null : typeof result === "string" && values[2] === proposed ? result : JSON.stringify(result);
}
function validateHousingChanges(before, after) {
  function parse(store, key, fallback) { try { return JSON.parse(store[key] || "null") || fallback; } catch (_) { return fallback; } }
  function conflicts(store) {
    const students = parse(store, "nnuzc_students", []), ids = new Set(students.filter(s => ["在校", "在校生"].includes(s.status || "在校")).map(s => String(s.id)));
    const claims = new Map();
    const add = (key, id) => { if (!claims.has(key)) claims.set(key, new Set()); claims.get(key).add(id); };
    const rows = [...students.filter(s => ids.has(String(s.id))), ...parse(store, "nnuzc_dorm_dist", []).filter(s => ids.has(String(s.studentId || s.id)))];
    for (const row of rows) if (row.accom === "校内" && row.building && row.room && row.bed) add("bed:" + JSON.stringify([String(row.building).trim(), String(row.room).trim(), String(Number(row.bed) || row.bed)]), String(row.studentId || row.id));
    const space = parse(store, "nnuzc_dorm_spatial_v1", {});
    for (const row of space.buildings || []) add("building:" + String(row.building).trim(), String(row.id));
    for (const row of space.rooms || []) add("room:" + JSON.stringify([String(row.building).trim(), String(row.room).trim()]), String(row.id));
    const rooms = new Map((space.rooms || []).map(r => [String(r.id), r]));
    for (const row of space.assignments || []) if (row.status === "current" && ids.has(String(row.studentId)) && row.bedNo) { const room = rooms.get(String(row.roomId)); if (room) add("bed:" + JSON.stringify([String(room.building).trim(), String(room.room).trim(), String(Number(row.bedNo) || row.bedNo)]), String(row.studentId)); }
    for (const row of space.bedNotes || []) if (row.bedNo) { const room = rooms.get(String(row.roomId)); if (room) add("bed:" + JSON.stringify([String(room.building).trim(), String(room.room).trim(), String(Number(row.bedNo) || row.bedNo)]), String(row.studentNo || "manual:" + row.id)); }
    return claims;
  }
  const previous = conflicts(before), next = conflicts(after);
  for (const [key, ids] of next) if (ids.size > 1 && [...ids].some(id => !(previous.get(key) || new Set()).has(id))) {
    const error = httpError(409, "多人合并后发现床位重复占用或楼栋、房间重复创建。本次整批保存已取消，请读取最新宿舍数据后重新分配。", true); error.code = "COLLABORATION_HOUSING_CONFLICT"; throw error;
  }
}
let workbenchSnapshotCache = null;
function workbenchSnapshot() {
  const changes = database.prepare("SELECT total_changes() AS n").get().n;
  if (!workbenchSnapshotCache || workbenchSnapshotCache.changes !== changes) {
    const storeValues = readStore();
    const academicVersion = database.prepare("SELECT version FROM academic_public_state WHERE id=1").get()?.version || 0;
    const revision = crypto.createHash("sha256").update(JSON.stringify([academicVersion,Object.keys(storeValues).sort().map(k => [k, storeValues[k]])])).digest("hex");
    workbenchSnapshotCache = { changes, revision, storeValues, academicVersion };
  }
  return workbenchSnapshotCache;
}
function normalizeStudentLeaves(value, store, before, historical=false, originalStudents) {
  const parse=(text,fallback)=>text==null?fallback:JSON.parse(text);
  try{
    const rows=parse(value,[]),previous=parse(before,[]),people=parse(store.nnuzc_students,[]),studentIdRenames=new Map();
    if(originalStudents!==undefined&&Array.isArray(rows)&&Array.isArray(previous)){
      const oldIds=new Set(parse(originalStudents,[]).map(s=>String(s.id))),newIds=new Set(people.map(s=>String(s.id))),oldRows=new Map(previous.map(r=>[r.id,r]));
      for(const r of rows){const old=oldRows.get(r.id);if(!old||old.studentId===r.studentId)continue;
        if(oldIds.has(old.studentId)&&!newIds.has(old.studentId)&&!oldIds.has(r.studentId)&&newIds.has(r.studentId)){
          if((studentIdRenames.has(old.studentId)&&studentIdRenames.get(old.studentId)!==r.studentId)||[...studentIdRenames].some(([from,to])=>from!==old.studentId&&to===r.studentId))throw Error('请销假学号变更必须一一对应');
          studentIdRenames.set(old.studentId,r.studentId);
        }
      }
    }
    return JSON.stringify(require('./student-leave-engine.js').validate(rows,{students:people,terms:parse(store.nnuzc_term_list,[]),before:previous,historical,studentIdRenames}));
  }
  catch(error){throw httpError(422,error.message||'请销假数据校验失败。',true);}
}
function prepareStudentIdentitySync(current, merged, operations) {
  const submitted=operations.find(op=>op.key==="nnuzc_students"),master=merged.find(op=>op.key==="nnuzc_students"&&op.method==="PUT");
  if(!master)return [];
  const before=JSON.parse(current.nnuzc_students||"[]"),after=JSON.parse(master.value);
  if(Array.isArray(after)){
    after.forEach(row=>{if(row&&typeof row==="object"){if(["string","number"].includes(typeof row.id))row.id=String(row.id).trim();if(typeof row.name==="string")row.name=row.name.trim();}});
    master.value=JSON.stringify(after);
  }
  const renames=submitted&&Object.hasOwn(submitted,"studentIdRenames")?submitted.studentIdRenames:[];
  const changes=studentIdentitySync.identityChanges(before,after,renames,submitted?.baseValue?JSON.parse(submitted.baseValue):undefined);
  if(!changes.length)return changes;
  const oldIds=new Set(before.map(s=>String(s.id)));
  for(const change of changes)if(change.oldId!==change.id&&oldIds.has(change.oldId)){
    for(const key of studentIdentitySync.KEYS)if(current[key]&&studentIdentitySync.containsId(key,JSON.parse(current[key]),change.id))throw studentIdentitySync.conflict("新学号已有历史关联记录，不能自动合并；请先核查目标学号。");
    if(database.prepare("SELECT 1 FROM recycle_bin WHERE status='active' AND student_lookup=? LIMIT 1").get(recycleStudentLookup(change.id)))throw studentIdentitySync.conflict("新学号在回收站已有学生关联记录，请先核查后再修改。");
  }
  for(const key of studentIdentitySync.KEYS){
    const operation=merged.find(op=>op.key===key),value=operation?operation.value:current[key];
    if(value==null)continue;
    const next=JSON.stringify(studentIdentitySync.rewrite(key,JSON.parse(value),changes));
    if(storeEqual(next,value))continue;
    if(operation)operation.value=next;else merged.push({key,method:"PUT",value:next});
  }
  return changes;
}

function protectStudentIdentityReferences(current,merged,changes){
  const proposed={...current};merged.forEach(op=>{if(op.method==="DELETE")delete proposed[op.key];else proposed[op.key]=op.value;});
  const people=JSON.parse(proposed.nnuzc_students||"[]"),ids=new Set(people.map(s=>String(s.id))),links=Object.assign(Object.create(null),JSON.parse(current[STUDENT_IDENTITY_LINKS_KEY]||"{}"));
  for(const change of changes)if(change.oldId!==change.id){
    if(links[change.id]&&links[change.id]!==change.oldId)throw studentIdentitySync.conflict("新学号曾属于其他学生，不能自动复用，请先核查历史关联。");
    for(const id of Object.keys(links))if(links[id]===change.oldId)links[id]=change.id;
    delete links[change.id];links[change.oldId]=change.id;
  }
  for(const sid of ids)if(links[sid])throw studentIdentitySync.conflict("该学号已经更正，不能重新创建另一份学生档案，请读取最新名单。");
  const retired=Object.keys(links).filter(sid=>!ids.has(sid)),names=people.map(s=>({oldId:String(s.id),id:String(s.id),name:s.name}));
  for(const operation of merged){
    if(operation.method!=="PUT"||!studentIdentitySync.KEYS.has(operation.key))continue;
    const value=JSON.parse(operation.value);
    for(const sid of retired)if(studentIdentitySync.containsId(operation.key,value,sid))throw studentIdentitySync.conflict("记录仍引用已更正的旧学号，请读取最新学生信息后重试。");
    operation.value=JSON.stringify(studentIdentitySync.rewrite(operation.key,value,names));
  }
  if(changes.some(c=>c.oldId!==c.id))merged.push({key:STUDENT_IDENTITY_LINKS_KEY,method:"PUT",value:JSON.stringify(links)});
}

function syncRecycledStudentIdentity(changes) {
  if(!changes.length)return;
  for(const row of database.prepare("SELECT id,module_key,entity_type FROM recycle_bin WHERE status='active' AND entity_type!='student_archive'").all()){
    const adapter=RECYCLE_ARRAY_ADAPTERS[row.module_key];
    if(!adapter||(!studentIdentitySync.KEYS.has(adapter.storeKey)&&adapter.storeKey!=="nnuzc_students"))continue;
    const entry=recycleGet(row.id),payload=entry.payload;
    let next=studentIdentitySync.rewrite(adapter.storeKey,payload,changes);
    if(adapter.storeKey==="nnuzc_students"){
      next=studentIdentitySync.rewriteObject(payload,changes,{idFallback:!adapter.nested});
      for(const change of changes)if(String(payload.parentId||"")===change.oldId){next.parentId=change.id;next.parentLabel=change.name;const nestedId=String(next.id||"");if(nestedId.startsWith(change.oldId+"::"))next.id=change.id+nestedId.slice(change.oldId.length);}
    }
    if(storeEqual(next,payload))continue;
    const entityId=adapter.nested?String(next.id):recycleEntityId(next,adapter),studentId=recycleRecordStudentId(adapter,next);
    database.prepare("UPDATE recycle_bin SET payload_json=?,checksum=?,student_lookup=?,entity_id_enc=?,entity_lookup=?,display_title_enc=? WHERE id=?").run(encryptText(JSON.stringify(next)),recycleRecordChecksum(next),recycleStudentLookup(studentId),encryptText(entityId),recycleLookup(row.module_key,entityId),encryptText(adapter.title(next)),row.id);
  }
}

function assertUnmappedStudentRenames(current,merged,changes){
  const master=merged.find(op=>op.key==="nnuzc_students"&&op.method==="PUT");if(!master)return;
  const before=JSON.parse(current.nnuzc_students||"[]"),after=JSON.parse(master.value),oldIds=new Set(before.map(s=>String(s.id))),newIds=new Set(after.map(s=>String(s.id)));
  if(!after.some(s=>!oldIds.has(String(s.id))))return;
  const mapped=new Set(changes.map(c=>c.oldId));
  for(const student of before){const sid=String(student.id);if(newIds.has(sid)||mapped.has(sid))continue;
    for(const key of studentIdentitySync.KEYS){const op=merged.find(item=>item.key===key),value=op?op.value:current[key];if(value&&studentIdentitySync.containsId(key,JSON.parse(value),sid))throw studentIdentitySync.conflict("旧页面缺少学号关联变更信息，请读取最新数据后在学生编辑中修改学号。");}
    if(academicPublicService.hasStudentReference(sid))throw studentIdentitySync.conflict("学号变更尚未关联公用版学业记录，请读取最新数据后重新修改。");
  }
}

function applyStoreBatch(input, requireBaseline = false, options = {}) {
  const operations = input && Array.isArray(input.operations) ? input.operations : null;
  if (!operations || !operations.length || operations.length > 500) throw httpError(400, "批量保存操作数量无效。", true);
  const force = input.force === true, seen = new Set(); let totalBytes = 0;
  operations.forEach((operation) => {
    if (!operation || typeof operation.key !== "string" || typeof operation.method !== "string") throw httpError(400, "批量保存的数据键和方法必须是字符串。", true);
    const key = String(operation && operation.key || ""), method = String(operation && operation.method || "").toUpperCase();
    if (!safeStoreKey(key) || seen.has(key) || !["PUT", "DELETE"].includes(method)) throw httpError(400, "批量保存包含无效或重复的数据键。", true);
    if (method === "PUT" && isRetiredStoreKey(key)) throw httpError(410, "该功能已经下线，相关数据不能再写入。", true);
    if(key===STUDENT_IDENTITY_LINKS_KEY)throw httpError(403,"学生身份关联由系统维护，不能直接修改。",true);
    if(operation.studentIdRenames!==undefined&&(key!=="nnuzc_students"||method!=="PUT"))throw httpError(400,"学号变更说明只能随学生主档保存。",true);
    seen.add(key);
    operation.method = method;
    if (method === "PUT") {
      if (typeof operation.value !== "string") throw httpError(400, "批量保存内容格式无效。", true);
      const bytes = Buffer.byteLength(operation.value, "utf8"); if (bytes > MAX_BODY_BYTES) throw httpError(413, "单项保存内容过大。", true); totalBytes += bytes;
    }
  });
  if (totalBytes > MAX_BODY_BYTES) throw httpError(413, "批量保存总内容过大。", true);
  if(options.transaction!==false)database.exec("BEGIN IMMEDIATE");
  try {
    const current = readStore(), remoteMergedKeys = [];
    const merged = operations.map(operation => {
      const hasBase = Object.hasOwn(operation, "baseValue");
      if (requireBaseline && !hasBase) { const error = httpError(409, "请刷新页面后保存，旧页面缺少数据基线，本次保存已拦截。", true); error.code = "COLLABORATION_BASE_REQUIRED"; throw error; }
      if (hasBase && operation.baseValue !== null && (typeof operation.baseValue !== "string" || Buffer.byteLength(operation.baseValue, "utf8") > MAX_BODY_BYTES)) throw httpError(400, "保存基线无效。", true);
      const value = hasBase ? mergeConcurrentStoreValue(operation.baseValue, current[operation.key] ?? null, operation.method === "DELETE" ? null : operation.value, operation.key) : operation.method === "DELETE" ? null : operation.value;
      const proposed = operation.method === "DELETE" ? null : operation.value;
      let same = value === proposed;
      if (!same && value !== null && proposed !== null) { try { same = storeEqual(JSON.parse(value), JSON.parse(proposed)); } catch (_) {} }
      if (!same) remoteMergedKeys.push(operation.key);
      return { key: operation.key, method: value === null ? "DELETE" : "PUT", value };
    });
    const identityChanges=prepareStudentIdentitySync(current,merged,operations);
    protectStudentIdentityReferences(current,merged,identityChanges);
    if (merged.some(op => ["nnuzc_students", "nnuzc_dorm_dist", "nnuzc_dorm_spatial_v1"].includes(op.key))) {
      const proposedStore = Object.assign({}, current);
      merged.forEach(op => { if (op.method === "DELETE") delete proposedStore[op.key]; else proposedStore[op.key] = op.value; });
      validateHousingChanges(current, proposedStore);
    }
    const leaveOperation=merged.find(op=>op.key==='nnuzc_student_leaves'&&op.method==='PUT');
    if(leaveOperation){const proposedStore={...current};merged.forEach(op=>{if(op.method==='DELETE')delete proposedStore[op.key];else proposedStore[op.key]=op.value;});leaveOperation.value=normalizeStudentLeaves(leaveOperation.value,proposedStore,current.nnuzc_student_leaves,false,merged.some(op=>op.key==='nnuzc_students')?current.nnuzc_students:undefined);}
    if(merged.some(op=>['nnuzc_term_list','nnuzc_students'].includes(op.key))&&!merged.some(op=>op.key==='nnuzc_student_leaves')&&current.nnuzc_student_leaves){const proposedStore={...current};merged.forEach(op=>{if(op.method==='DELETE')delete proposedStore[op.key];else proposedStore[op.key]=op.value;});normalizeStudentLeaves(current.nnuzc_student_leaves,proposedStore,current.nnuzc_student_leaves,true);}
    assertUnmappedStudentRenames(current,merged,identityChanges);
    if (input.recycleCheckClassIds !== undefined) {
      const ids = recycleValidateIds(input.recycleCheckClassIds);
      const required = ["nnuzc_checkclass", "nnuzc_students", "nnuzc_chaoxing_imports"];
      if (required.some(key => !merged.some(op => op.key === key && op.method === "PUT"))) throw httpError(400, "撤销须同时保存查课、学生及导入历史。", true);
      const proposed = JSON.parse(merged.find(op => op.key === "nnuzc_checkclass").value);
      const existing = JSON.parse(current.nnuzc_checkclass || "[]");
      if (ids.some(id => proposed.some(row => String(row.id) === id) || !existing.some(row => String(row.id) === id && row.source === "学习通"))) throw httpError(409, "待撤销来源记录已变化。", true);
      const preview = recycleDeletePreview({moduleKey:"checkClassRecord",entityType:"check_class_record",entityIds:ids});
      recycleMove({confirmation:"移入回收站",previewToken:preview.previewToken,requestId:crypto.randomUUID()}, false);
    }
    // Validate the complete proposed state above, then write masters before records
    // whose student references are checked against the database inside this transaction.
    const writePriority = key => key === "nnuzc_orgs" ? 0 : key === "nnuzc_students" ? 1 : 2;
    const writeOperations = merged.slice().sort((a, b) => writePriority(a.key) - writePriority(b.key));
    writeOperations.forEach((operation) => {
      const key = String(operation.key), method = String(operation.method).toUpperCase();
      if (storeEqual(operation.value === null ? undefined : operation.value, current[key])) return;
      if (method === "DELETE") {
        if (isRetiredStoreKey(key)) { purgeRetiredKnowledgeFeature(); return; }
        if (!deleteCoreKey(key, { transaction: false })) database.prepare("DELETE FROM legacy_ui_store WHERE key=?").run(key);
        return;
      }
      if (!writeCoreKey(key, operation.value, force ? "force" : "sync", { transaction: false })) database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key, encryptText(operation.value));
    });
    const academicIdentityChanged=academicPublicService.syncStudentIdentity(identityChanges);
    syncRecycledStudentIdentity(identityChanges);
    if(options.transaction!==false)database.exec("COMMIT");
    const saved = readStore(), storeValues = {};
    merged.forEach(op => { storeValues[op.key] = saved[op.key] ?? null; });
    return { ok: true, count: operations.length, storage: "sqlite-transaction", storeValues, remoteMergedKeys, academicIdentityChanged };
  } catch (error) { try { if(options.transaction!==false)database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

let dataCenterService=null;
function getDataCenterService(){
  if(dataCenterService)return dataCenterService;
  const academicExport=()=>{
    academicPublicService.init();
    const row=database.prepare("SELECT payload FROM academic_public_state WHERE id=1").get();
    const state={version:0,rules:null,courses:[],attempts:[],exams:[],cases:[],reportReferences:[],publications:[],ruleHistory:[],acl:{},...(row?JSON.parse(decryptText(row.payload)):{})};
    return {state,batches:database.prepare("SELECT id,actor,created,payload FROM academic_public_batches").all().map(r=>({...r,payload:JSON.parse(decryptText(r.payload))})),warningRuns:database.prepare("SELECT id,actor,created,selection_key,data_version,payload FROM academic_public_warning_runs").all().map(r=>({...r,payload:JSON.parse(decryptText(r.payload))}))};
  };
  const academicValidate=(data,students)=>{
    const state=data.state,people=new Set(students.map(s=>String(s.id))),courses=new Set();
    for(const collection of ['courses','attempts','exams','cases','reportReferences','publications','ruleHistory'])if(!Array.isArray(state[collection]))throw httpError(400,'公用版学业集合格式无效',true);
    if(state.rules)require('./academic-public-engine').validateRules(state.rules);
    for(const collection of ['courses','attempts','exams','cases','reportReferences','publications']){const ids=new Set();for(const row of state[collection]){if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||ids.has(row.id))throw httpError(400,'公用版学业记录标识缺失或重复',true);ids.add(row.id);}}
    for(const rows of [data.batches,data.warningRuns])if(new Set(rows.map(r=>r.id)).size!==rows.length)throw httpError(400,'公用版学业历史标识重复',true);
    for(const course of state.courses){if(!course.id||courses.has(course.id)||!people.has(String(course.sid)))throw httpError(400,'公用版学业课程标识或学生关联无效',true);courses.add(course.id);}
    for(const attempt of state.attempts)if(!courses.has(attempt.courseId))throw httpError(400,'公用版学业考试阶段缺少课程关联',true);
    for(const row of [...state.exams,...state.cases,...state.reportReferences])if(row.sid&&!people.has(String(row.sid)))throw httpError(400,'公用版学业记录缺少学生关联',true);
    for(const rows of [data.batches,data.warningRuns])if(rows.some(r=>typeof r.id!=='string'||typeof r.actor!=='string'||typeof r.created!=='string'||!r.payload||typeof r.payload!=='object'))throw httpError(400,'公用版学业历史格式无效',true);
  };
  const academicImport=data=>{
    const current=academicExport(),state={...data.state,version:Number(current.state.version||0)+1,acl:current.state.acl||{}};
    database.prepare('INSERT INTO academic_public_state(id,version,payload) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,payload=excluded.payload').run(state.version,encryptText(JSON.stringify(state)));
    database.exec('DELETE FROM academic_public_batches; DELETE FROM academic_public_warning_runs; DELETE FROM academic_public_artifacts;');
    for(const r of data.batches)database.prepare('INSERT INTO academic_public_batches(id,actor,created,payload) VALUES(?,?,?,?)').run(r.id,r.actor,r.created,encryptText(JSON.stringify(r.payload)));
    for(const r of data.warningRuns)database.prepare('INSERT INTO academic_public_warning_runs(id,actor,created,selection_key,data_version,payload) VALUES(?,?,?,?,?,?)').run(r.id,r.actor,r.created,String(r.selection_key||''),Number(r.data_version)||0,encryptText(JSON.stringify(r.payload)));
  };
  const warningTemplate={meta:academicWarningCustomTemplateMeta,read:()=>{const meta=academicWarningCustomTemplateMeta();if(!meta)return null;const file=academicWarningTemplateBytes(),mime=meta.extension==='.doc'?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document';return {...meta,data:'data:'+mime+';base64,'+file.content.toString('base64')};},install:file=>{const paths=[ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH,ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH],old=paths.map(p=>fs.existsSync(p)?fs.readFileSync(p):null);commitAcademicWarningTemplate(file.content,{name:file.name,extension:file.extension,size:file.size,sha256:file.sha256,updatedAt:new Date().toISOString()});return ()=>{paths.forEach((p,i)=>{if(old[i])fs.writeFileSync(p,old[i],{mode:0o600});else fs.rmSync(p,{force:true});});};}};
  dataCenterService=require('./data-center-service').createService({db:()=>database,dataDir:DATA_DIR,indexHtml:fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),version:APP_VERSION,readStore,academicExport,academicValidate,academicImport,warningTemplate,attachmentPath,analysisDir:ACADEMIC_ANALYSIS_RUN_DIR,encryptBuffer,decryptBuffer,sha256File,attachmentQuota:MAX_ATTACHMENT_TOTAL_BYTES,attachmentBytes:()=>fs.readdirSync(UPLOAD_DIR).reduce((n,f)=>{const p=path.join(UPLOAD_DIR,f);return n+(fs.statSync(p).isFile()?fs.statSync(p).size:0);},0),backup:createBackup,apply:operations=>applyStoreBatch({operations},false,{transaction:false}),validate:(operations,academic)=>{database.exec("SAVEPOINT data_center_validate");try{if(operations.length)applyStoreBatch({operations},false,{transaction:false});if(academic)academicImport(academic);}finally{database.exec("ROLLBACK TO data_center_validate; RELEASE data_center_validate");}},readJson, json:sendJson});
  return dataCenterService;
}

function importPartyLedger(input, actor) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.rows)) throw httpError(400, "党团员导入数据格式无效。", true);
  if (!input.rows.length) throw httpError(400, "文件中没有可导入的党团员数据。", true);
  if (input.rows.length > 2000) throw httpError(400, "党团员发展台账单次最多导入 2000 行数据。", true);
  if (typeof input.baseValue !== "string" || Buffer.byteLength(input.baseValue, "utf8") > MAX_BODY_BYTES) throw httpError(400, "学生数据基线无效，请刷新页面后重试。", true);
  let baseline;
  try { baseline = JSON.parse(input.baseValue); }
  catch (_) { throw httpError(400, "学生数据基线无法解析，请刷新页面后重试。", true); }
  if (!Array.isArray(baseline)) throw httpError(400, "学生数据基线必须是学生列表。", true);
  const prepared = partyImportEngine.prepareImport(input.rows, baseline);
  if (prepared.errors.length) {
    const first = prepared.errors[0];
    throw httpError(400, `第 ${first.row || "—"} 行：${first.msg || "数据不符合要求"}`, true);
  }
  const operation = { key: "nnuzc_students", method: "PUT", baseValue: input.baseValue, value: JSON.stringify(prepared.students) };
  const result = applyStoreBatch({ operations: [operation] }, true);
  return Object.assign({}, result, { imported: prepared.validRows.length, skipped: 0 });
}

/* ============ 回收站：首批独立记录适配器 ============ */
const RECYCLE_RETENTION_DAYS = 90;
const RECYCLE_ARRAY_ADAPTERS = Object.freeze({
  punishment: { label: "处分情况", entityType: "punishment_record", storeKey: "nnuzc_punishments", studentField: "studentId", title: (row) => `${row.studentId || "未知学生"} · ${row.type || row.level || "处分记录"}` },
  studentLeave: { label: "请销假管理", entityType: "student_leave_record", storeKey: "nnuzc_student_leaves", studentField: "studentId", title: row => `${row.name || row.studentId} · ${row.type || "请假"}` },
  studentLoan: { label: "助学贷款", entityType: "student_loan_record", storeKey: "nnuzc_student_loan_records", studentField: "studentId", title: (row) => `${row.name || row.studentId || "未知学生"} · ${row.year || "助学贷款"}` },
  talks: { label: "谈心谈话", entityType: "talk_record", storeKey: "nnuzc_talks", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.date || "谈心谈话"}` },
  home: { label: "家校联系", entityType: "home_contact", storeKey: "nnuzc_home", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.date || "家校联系"}` },
  events: { label: "突发事件", entityType: "event_record", storeKey: "nnuzc_events", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.date || row.type || "突发事件"}` },
  checkDorm: { label: "查寝记录", entityType: "dorm_inspection_record", storeKey: "nnuzc_checkdorm", studentField: "", title: (row) => `${row.building || "未知楼栋"}-${row.room || "未知寝室"} · ${row.date || "查寝记录"}` },
  help: { label: "帮扶记录", entityType: "help_record", storeKey: "nnuzc_help", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.date || row.type || "帮扶记录"}` },
  meeting: { label: "班会/活动", entityType: "meeting_record", storeKey: "nnuzc_meetings", studentField: "", title: (row) => `${row.topic || "班会/活动"} · ${row.date || "未填写日期"}` },
  fund: { label: "资助情况", entityType: "fund_record", storeKey: "nnuzc_fund_records", studentField: "studentId", title: (row) => `${row.name || row.studentId || "未知学生"} · ${row.term || row.project || "资助记录"}` },
  otherViolation: { label: "其他违纪", entityType: "other_violation_record", storeKey: "nnuzc_other_violation_records", studentField: "studentId", title: (row) => `${row.name || row.studentId || "未知学生"} · ${row.date || row.type || "其他违纪"}` },
  achievement: { label: "个人获奖", entityType: "achievement_record", storeKey: "nnuzc_achievement_records", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.awardName || "个人获奖"}` },
  awardStatistics: { label: "获奖统计", entityType: "award_statistics_record", storeKey: "nnuzc_award_statistics_records", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.awardName || row.title || "获奖统计"}` },
  certificate: { label: "证书识别", entityType: "certificate_record", storeKey: "nnuzc_certificate_records", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · ${row.awardName || row.fileName || row.attachment && row.attachment.name || "证书识别"}` },
  classOfficer: { label: "班级干部任职", entityType: "class_officer_record", storeKey: "nnuzc_class_officer_records", studentField: "studentId", title: (row) => `${row.studentName || row.studentId || "未知学生"} · ${row.position || "班级干部"}` },
  courseSchedule: { label: "课表", entityType: "course_schedule_record", storeKey: "nnuzc_course_schedules", studentField: "", title: (row) => `${row.cls || "未知班级"} · ${row.course || "课程"} · ${row.section || "未填写节次"}` },
  taskNote: { label: "工作便签", entityType: "task_note", storeKey: "nnuzc_task_notes", studentField: "", title: (row) => String(row.text || "工作便签").slice(0, 80) },
  task: { label: "工作任务", entityType: "task_record", storeKey: "nnuzc_tasks", studentField: "studentId", title: (row) => `${row.title || "工作任务"}${row.studentName ? ` · ${row.studentName}` : ""}` },
  keyCare: { label: "重点关爱", entityType: "keycare_record", storeKey: "nnuzc_keycare", studentField: "studentId", title: (row) => `${row.studentName || row.studentId || "未知学生"} · ${row.source || "重点关爱"}` },
  employment: { label: "就业跟踪", entityType: "employment_tracking_record", storeKey: "nnuzc_employment", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · 就业跟踪` },
  employmentIntention: { label: "就业意向", entityType: "employment_intention_record", storeKey: "nnuzc_employment_intentions", studentField: "sid", title: (row) => `${row.name || row.sid || "未知学生"} · 就业意向` },
  employmentResource: { label: "就业资源", entityType: "employment_resource", storeKey: "nnuzc_employment_resources", studentField: "", title: (row) => row.title || row.url || "就业资源" },
  subjectCompetition: { label: "科创竞赛资源", entityType: "subject_competition_resource", storeKey: "nnuzc_subject_competition_resources", studentField: "", title: (row) => row.title || "科创竞赛资源" },
  counselorGrowth: { label: "辅导员成长档案", entityType: "counselor_growth_record", storeKey: "nnuzc_counselor_growth_records_v1", studentField: "", title: (row) => row.title || "成长成果" },
  academicTerm: { label: "学业情况（个人版）学期", entityType: "academic_term", storeKey: "nnuzc_academic_terms", studentField: "", title: (row) => row.term || "学业情况（个人版）学期" },
  academicWarningTerm: { label: "学业预警（个人版）学期", entityType: "academic_warning_term", storeKey: "nnuzc_academic_warnings", studentField: "", title: (row) => row.term || "学业预警（个人版）学期" },
  gradeTerm: { label: "成绩与排名（个人版）学期", entityType: "grade_term", storeKey: "nnuzc_grade_terms", studentField: "", title: (row) => row.term || "成绩与排名（个人版）学期" },
  academicRow: { label: "学业情况（个人版）", entityType: "academic_row", storeKey: "nnuzc_academic_terms", nested: { collection: "rows", childId: "_rid" }, studentField: "学号", title: (item) => `${item.row && (item.row["姓名"] || item.row["学号"]) || "未知学生"} · ${item.parentLabel || "学业情况（个人版）"}` },
  academicWarningRow: { label: "学业预警（个人版）", entityType: "academic_warning_row", storeKey: "nnuzc_academic_warnings", nested: { collection: "rows", childId: "_rid" }, studentField: "学号", title: (item) => `${item.row && (item.row["姓名"] || item.row["学号"]) || "未知学生"} · ${item.parentLabel || "学业预警（个人版）"}` },
  gradeRow: { label: "成绩与排名（个人版）", entityType: "grade_row", storeKey: "nnuzc_grade_terms", nested: { collection: "rows", childId: "_rid" }, studentField: "学号", title: (item) => `${item.row && (item.row["姓名"] || item.row["学号"]) || "未知学生"} · ${item.parentLabel || "成绩与排名（个人版）"}` },
  academicWarningCourse: { label: "学业预警（个人版）课程", entityType: "academic_warning_course", storeKey: "nnuzc_academic_warnings", nested: { collection: "rows", childId: "_rid", subcollection: "courses", subChildId: "_cid" }, studentField: "学号", title: (item) => `${item.parentStudentId || "未知学生"} · ${item.row && (item.row["课程名称"] || item.row["课程代码"]) || "预警课程"}` },
  gradeCourse: { label: "成绩课程", entityType: "grade_course", storeKey: "nnuzc_grade_terms", nested: { collection: "rows", childId: "_rid", subcollection: "courses", subChildId: "_cid" }, studentField: "学号", title: (item) => `${item.parentStudentId || "未知学生"} · ${item.row && (item.row["课程名称"] || item.row["课程代码"]) || "成绩课程"}` },
  employmentContact: { label: "就业联系", entityType: "employment_contact", storeKey: "nnuzc_employment", nested: { collection: "contacts", childId: "id" }, studentField: "sid", title: (item) => `${item.parentStudentId || "未知学生"} · ${item.row && item.row.date || "就业联系"}` },
  dormViolation: { label: "宿舍违纪", entityType: "dorm_violation", storeKey: "nnuzc_students", nested: { collection: "dorm", childId: "id" }, studentField: "id", title: (item) => `${item.parentLabel || item.parentStudentId || "未知学生"} · ${item.row && (item.row.date || item.row.type) || "宿舍违纪"}` },
  classAttendance: { label: "课堂考勤", entityType: "class_attendance", storeKey: "nnuzc_students", nested: { collection: "classroom", childId: "id" }, studentField: "id", title: (item) => `${item.parentLabel || item.parentStudentId || "未知学生"} · ${item.row && (item.row.date || item.row.course) || "课堂考勤"}` },
  checkClassRecord: { label: "查课记录", entityType: "check_class_record", storeKey: "nnuzc_checkclass", studentField: "", linkedStudentCollection: "classroom", linkedForeignKey: "sourceCheckClassId", linkedPayloadField: "__linkedStudentRows", title: (row) => `${row.cls || "未知班级"} · ${row.date || row.course || "查课记录"}` }
  ,workFolder: { label: "工作文件夹", entityType: "work_folder_node", storeKey: "nnuzc_workfolder", studentField: "", title: (row) => `${row.type === "folder" ? "文件夹" : "文件"} · ${row.name || "未命名"}` }
  ,baseDept: { label: "基础数据 · 学院", entityType: "base_department", storeKey: "nnuzc_orgs", rootCollection: "depts", idField: "name", studentField: "", title: (row) => row.name || "学院" }
  ,baseMajor: { label: "基础数据 · 专业", entityType: "base_major", storeKey: "nnuzc_orgs", rootCollection: "majors", idField: "name", studentField: "", title: (row) => `${row.name || "专业"} · ${row.dept || "未归属学院"}` }
  ,baseClass: { label: "基础数据 · 班级", entityType: "base_class", storeKey: "nnuzc_orgs", rootCollection: "classes", idField: "name", studentField: "", title: (row) => `${row.name || "班级"} · ${row.major || "未归属专业"}` }
  ,baseGrade: { label: "基础数据 · 年级", entityType: "base_grade", storeKey: "nnuzc_orgs", rootCollection: "grades", idField: "name", studentField: "", title: (row) => row.name || "年级" }
  ,baseEnrollType: { label: "基础数据 · 招生类别", entityType: "base_enroll_type", storeKey: "nnuzc_orgs", rootCollection: "enrollTypes", idField: "name", studentField: "", title: (row) => row.name || "招生类别" }
  ,baseLevel: { label: "基础数据 · 培养层次", entityType: "base_level", storeKey: "nnuzc_orgs", rootCollection: "levels", idField: "name", studentField: "", title: (row) => row.name || "培养层次" }
  ,baseDorm: { label: "基础数据 · 宿舍楼", entityType: "base_dorm", storeKey: "nnuzc_orgs", rootCollection: "dorms", idField: "building", studentField: "", title: (row) => `${row.zone || "未分区"} · ${row.building || "宿舍楼"}` }
  ,dormBuilding: { label: "宿舍空间 · 楼栋", entityType: "dorm_building", storeKey: "nnuzc_dorm_spatial_v1", rootCollection: "buildings", studentField: "", title: (row) => `${row.zone || "未分区"} · ${row.building || "宿舍楼"}` }
  ,dormRoom: { label: "宿舍空间 · 房间", entityType: "dorm_room", storeKey: "nnuzc_dorm_spatial_v1", rootCollection: "rooms", embedCollections: [{ field: "__bedNotes", source: "bedNotes", foreignKey: "roomId" }], studentField: "", title: (row) => `${row.zone || "未分区"} · ${row.building || ""} · ${row.room || "房间"}` }
  ,dormBedNote: { label: "宿舍空间 · 床位登记", entityType: "dorm_bed_note", storeKey: "nnuzc_dorm_spatial_v1", rootCollection: "bedNotes", studentField: "studentNo", title: (row) => `${row.studentName || row.studentNo || "床位登记"} · ${row.bedNo || "未填写床位"}` }
  ,studentOrg: { label: "学生组织", entityType: "student_org", storeKey: "nnuzc_student_org_v1", rootCollection: "orgs", studentField: "", title: (row) => row.name || "学生组织" }
  ,studentOrgActivity: { label: "学生组织活动", entityType: "student_org_activity", storeKey: "nnuzc_student_org_v1", rootCollection: "activities", studentField: "", title: (row) => row.name || row.title || "组织活动" }
  ,studentOrgMeeting: { label: "学生组织会议", entityType: "student_org_meeting", storeKey: "nnuzc_student_org_v1", rootCollection: "meetings", studentField: "", title: (row) => row.name || row.title || "组织会议" }
  ,studentOrgTraining: { label: "学生组织培训", entityType: "student_org_training", storeKey: "nnuzc_student_org_v1", rootCollection: "trainings", studentField: "", title: (row) => row.name || row.title || "组织培训" }
  ,studentOrgClassroom: { label: "学生组织第二课堂", entityType: "student_org_classroom", storeKey: "nnuzc_student_org_v1", rootCollection: "classrooms", studentField: "sid", title: (row) => `${row.sname || row.sid || "未知学生"} · ${row.item || "第二课堂"}` }
  ,studentOrgTask: { label: "学生组织任务", entityType: "student_org_task", storeKey: "nnuzc_student_org_v1", rootCollection: "tasks", studentField: "", title: (row) => row.name || row.title || "组织任务" }
  ,studentOrgTemplate: { label: "学生组织模板", entityType: "student_org_template", storeKey: "nnuzc_student_org_v1", rootCollection: "templates", studentField: "", title: (row) => row.name || row.title || "组织模板" }
  ,studentOrgYear: { label: "学生组织届次", entityType: "student_org_year", storeKey: "nnuzc_student_org_v1", rootCollection: "years", studentField: "", title: (row) => typeof row === "string" ? row : row.name || row.year || "组织届次" }
  ,studentOrgNode: { label: "学生组织架构", entityType: "student_org_node", storeKey: "nnuzc_student_org_v1", rootCollection: "orgs", nested: { collection: "structure", childId: "id", treeMode: "node" }, studentField: "", title: (item) => `${item.parentLabel || "学生组织"} · ${item.row && item.row.name || "架构节点"}` }
  ,studentOrgMember: { label: "学生组织干部任职", entityType: "student_org_member", storeKey: "nnuzc_student_org_v1", rootCollection: "orgs", nested: { collection: "structure", childId: "id", treeMode: "member", memberCollection: "members", memberId: "_rid" }, studentField: "", title: (item) => `${item.row && (item.row.name || item.row.sid) || "干部任职"} · ${item.parentLabel || "学生组织"}` }
  ,customRosterDataset: { label: "自定义花名册档案", entityType: "custom_roster_dataset", storeKey: "nnuzc_custom_roster_v1", rootCollection: "datasets", studentField: "", title: (row) => row.name || "自定义花名册档案" }
  ,customRosterRow: { label: "自定义花名册记录", entityType: "custom_roster_row", storeKey: "nnuzc_custom_roster_v1", rootCollection: "datasets", nested: { collection: "rows", path: ["state", "rows"], childId: "id" }, studentField: "", title: (item) => `${item.parentLabel || "自定义花名册"} · ${item.row && item.row.id || "记录"}` }
  ,customRosterField: { label: "自定义花名册字段", entityType: "custom_roster_field", storeKey: "nnuzc_custom_roster_v1", rootCollection: "datasets", nested: { collection: "fields", path: ["state", "fields"], childId: "key" }, studentField: "", title: (item) => `${item.parentLabel || "自定义花名册"} · ${item.row && item.row.name || "字段"}` }
  ,psychProfile: { label: "心理预警档案", entityType: "psych_profile", storeKey: "nnuzc_students", virtualField: "psych", studentField: "id", title: (row) => `${row.name || row.id || "未知学生"} · 心理预警档案` }
  ,aiNoticeHistory: { label: "AI 通知转换历史", entityType: "ai_notice_history", storeKey: "nnuzc_ai_notice_history", studentField: "", title: (row) => row.original || row.result || "通知转换历史" }
  ,aiComplaint: { label: "接诉即办记录", entityType: "ai_complaint_record", storeKey: "nnuzc_complaints", studentField: "", title: (row) => row.title || row.content || "诉求记录" }
  ,aiCrossDepartment: { label: "跨部门协同记录", entityType: "ai_cross_department_record", storeKey: "nnuzc_crossdept", studentField: "", title: (row) => row.title || row.content || "协同记录" }
  ,aiDraft: { label: "AI 草稿", entityType: "ai_draft", storeKey: "nnuzc_ai_drafts", studentField: "", title: (row) => row.type || "AI 草稿" }
});

const STUDENT_ARCHIVE_ARRAYS = Object.freeze([
  { key: "nnuzc_students", label: "学生主档案", studentId: (row) => row.id },
  { key: "nnuzc_punishments", label: "处分情况", studentId: (row) => row.studentId },
  { key: "nnuzc_talks", label: "谈心谈话", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_home", label: "家校联系", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_events", label: "突发事件", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_help", label: "帮扶记录", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_dorm_dist", label: "住宿分配", studentId: (row) => row.studentId || row.id },
  { key: "nnuzc_fund_records", label: "资助情况", studentId: (row) => row.studentId },
  { key: "nnuzc_student_leaves", label: "请销假管理", studentId: row => row.studentId },
  { key: "nnuzc_student_loan_records", label: "助学贷款", studentId: (row) => row.studentId },
  { key: "nnuzc_class_officer_records", label: "班级干部任职", studentId: (row) => row.studentId },
  { key: "nnuzc_employment", label: "就业跟踪", studentId: (row) => row.sid },
  { key: "nnuzc_employment_intentions", label: "就业意向", studentId: (row) => row.sid },
  { key: "nnuzc_tasks", label: "工作任务", studentId: (row) => row.studentId },
  { key: "nnuzc_keycare", label: "重点关爱", studentId: (row) => row.studentId },
  { key: "nnuzc_other_violation_records", label: "其他违纪", studentId: (row) => row.studentId || row.sid },
  { key: "nnuzc_achievement_records", label: "个人获奖", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_awards", label: "旧版获奖记录", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_award_statistics_records", label: "获奖统计", studentId: (row) => row.sid || row.studentId },
  { key: "nnuzc_certificate_records", label: "证书识别", studentId: (row) => row.sid || row.studentId }
]);
const STUDENT_ARCHIVE_TERM_STORES = Object.freeze([
  { key: "nnuzc_academic_terms", label: "学业情况（个人版）", studentId: (row) => row && row["学号"] },
  { key: "nnuzc_academic_warnings", label: "学业预警（个人版）", studentId: (row) => row && row["学号"] },
  { key: "nnuzc_grade_terms", label: "成绩与排名（个人版）", studentId: (row) => row && row["学号"] },
  { key: "nnuzc_class_officer_assessment_terms", label: "班委考核", studentId: (row) => row && row.studentId }
]);
const DORM_STUDENT_AUDIT_ACTIONS = new Set(["CHECK_IN", "CHECK_OUT", "AUTO_CHECKOUT_GRADUATION", "STUDENT_ID_RENAME"]);
function studentArchiveDormAuditStudentId(row) {
  if (!row || typeof row !== "object") return "";
  if (DORM_STUDENT_AUDIT_ACTIONS.has(String(row.actionType || ""))) return row.targetId;
  return row.afterSnapshot && row.afterSnapshot.studentId || row.beforeSnapshot && row.beforeSnapshot.studentId || "";
}
const STUDENT_ARCHIVE_STATE_STORES = Object.freeze([
  { key: "nnuzc_dorm_spatial_v1", label: "公寓空间入住关系", collections: [
    { name: "assignments", studentId: (row) => row && row.studentId },
    { name: "leaders", studentId: (row) => row && row.studentId },
    { name: "audit", studentId: studentArchiveDormAuditStudentId }
  ] }
]);
const STUDENT_ARCHIVE_PATCH_STORES = Object.freeze([
  { key: "nnuzc_checkclass", label: "查课名单关系", type: "checkclass" },
  { key: "nnuzc_custom_roster_v1", label: "花名册（自定义版）", type: "customRoster" }
]);
const STUDENT_ARCHIVE_OBJECT_KEYS = new Set(STUDENT_ARCHIVE_STATE_STORES.map((item) => item.key).concat(["nnuzc_custom_roster_v1"]));
const STUDENT_ARCHIVE_KEYS = Object.freeze(STUDENT_ARCHIVE_ARRAYS.map((item) => item.key).concat(STUDENT_ARCHIVE_TERM_STORES.map((item) => item.key), STUDENT_ARCHIVE_STATE_STORES.map((item) => item.key), STUDENT_ARCHIVE_PATCH_STORES.map((item) => item.key)));
const CHECK_CLASS_STUDENT_FIELDS = Object.freeze(["absentStudentIds", "personalLeaveStudentIds", "sickLeaveStudentIds", "publicLeaveStudentIds", "leaveStudentIds", "lateStudentIds", "earlyStudentIds"]);

function recycleStoreArray(store, key) {
  let rows;
  try { rows = JSON.parse(store[key] || "[]"); } catch (_error) { throw httpError(409, `${key} 数据损坏，已停止学生删除。`, true); }
  if (!Array.isArray(rows)) throw httpError(409, `${key} 数据格式异常，已停止学生删除。`, true);
  return rows;
}

function recycleStoreObject(store, key) {
  let value;
  try { value = JSON.parse(store[key] || "{}"); } catch (_error) { throw httpError(409, `${key} 数据损坏，已停止学生删除。`, true); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(409, `${key} 数据格式异常，已停止学生删除。`, true);
  return value;
}

function studentArchiveStateRows(state, key, name) {
  const value = state[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw httpError(409, `${key}.${name} 数据格式异常，已停止学生删除。`, true);
  return value;
}

function studentArchiveStoreValue(store, key) {
  return STUDENT_ARCHIVE_OBJECT_KEYS.has(key) ? recycleStoreObject(store, key) : recycleStoreArray(store, key);
}

function studentArchiveStoreChecksum(store, key) {
  return sha256Hex(JSON.stringify(studentArchiveStoreValue(store, key)));
}

function studentArchivePrepare(studentIds) {
  const ids = new Set(studentIds.map(String)), store = readStore(), packages = new Map(studentIds.map((id) => [String(id), { studentId: String(id), student: null, records: {}, termRecords: {}, stateRecords: {}, patchRecords: {}, labels: {}, relationCount: 0 }])), remaining = {}, checksums = {};
  STUDENT_ARCHIVE_ARRAYS.forEach((config) => {
    const rows = recycleStoreArray(store, config.key), kept = [];
    checksums[config.key] = sha256Hex(JSON.stringify(rows));
    rows.forEach((row) => {
      const sid = String(config.studentId(row) || "");
      if (!ids.has(sid)) { kept.push(row); return; }
      const target = packages.get(sid); if (!target.records[config.key]) target.records[config.key] = [];
      target.records[config.key].push(row); target.labels[config.key] = config.label;
      if (config.key === "nnuzc_students") target.student = row; else target.relationCount++;
    });
    remaining[config.key] = kept;
  });
  STUDENT_ARCHIVE_TERM_STORES.forEach((config) => {
    const terms = recycleStoreArray(store, config.key), nextTerms = [];
    checksums[config.key] = sha256Hex(JSON.stringify(terms));
    terms.forEach((term) => {
      const keptRows = [], grouped = new Map();
      (Array.isArray(term && term.rows) ? term.rows : []).forEach((row) => {
        const sid = String(config.studentId(row) || "");
        if (!ids.has(sid)) { keptRows.push(row); return; }
        const list = grouped.get(sid) || []; list.push(row); grouped.set(sid, list);
      });
      grouped.forEach((rows, sid) => {
        const target = packages.get(sid); if (!target.termRecords[config.key]) target.termRecords[config.key] = [];
        const termMeta = Object.assign({}, term); delete termMeta.rows;
        target.termRecords[config.key].push({ termMeta, rows }); target.labels[config.key] = config.label; target.relationCount += rows.length;
      });
      nextTerms.push(Object.assign({}, term, { rows: keptRows }));
    });
    remaining[config.key] = nextTerms;
  });
  STUDENT_ARCHIVE_STATE_STORES.forEach((config) => {
    const state = recycleStoreObject(store, config.key), next = JSON.parse(JSON.stringify(state));
    checksums[config.key] = sha256Hex(JSON.stringify(state));
    config.collections.forEach((collection) => {
      const rows = studentArchiveStateRows(state, config.key, collection.name), kept = [];
      rows.forEach((row) => {
        const sid = String(collection.studentId(row) || "");
        if (!ids.has(sid)) { kept.push(row); return; }
        const target = packages.get(sid);
        if (!target.stateRecords[config.key]) target.stateRecords[config.key] = {};
        if (!target.stateRecords[config.key][collection.name]) target.stateRecords[config.key][collection.name] = [];
        target.stateRecords[config.key][collection.name].push(row); target.labels[config.key] = config.label; target.relationCount++;
      });
      next[collection.name] = kept;
    });
    remaining[config.key] = next;
  });
  {
    const key = "nnuzc_checkclass", rows = recycleStoreArray(store, key), next = JSON.parse(JSON.stringify(rows));
    checksums[key] = sha256Hex(JSON.stringify(rows));
    next.forEach((row) => {
      const recordId = String(row && row.id || "");
      CHECK_CLASS_STUDENT_FIELDS.forEach((field) => {
        const values = row[field] === undefined ? [] : row[field];
        if (!Array.isArray(values)) throw httpError(409, `${key}.${field} 数据格式异常，已停止学生删除。`, true);
        const kept = [];
        values.forEach((value) => {
          const sid = String(value || "");
          if (!ids.has(sid)) { kept.push(value); return; }
          if (!recordId) throw httpError(409, "查课名单存在缺少编号的记录，已停止学生删除。", true);
          const target = packages.get(sid); if (!target.patchRecords[key]) target.patchRecords[key] = [];
          let patch = target.patchRecords[key].find((item) => item.recordId === recordId);
          if (!patch) { patch = { recordId, cls: String(row.cls || ""), memberships: {} }; target.patchRecords[key].push(patch); }
          patch.memberships[field] = true; target.labels[key] = "查课名单关系"; target.relationCount++;
        });
        row[field] = kept;
      });
    });
    remaining[key] = next;
  }
  {
    const key = "nnuzc_custom_roster_v1", state = recycleStoreObject(store, key), next = JSON.parse(JSON.stringify(state));
    checksums[key] = sha256Hex(JSON.stringify(state));
    const scopes = Array.isArray(next.datasets) ? next.datasets.map((dataset) => ({ id: String(dataset && dataset.id || ""), label: String(dataset && dataset.name || ""), holder: dataset && dataset.state })) : [{ id: "__legacy__", label: "默认花名册", holder: next }];
    scopes.forEach((scope) => {
      if (!scope.holder || typeof scope.holder !== "object" || Array.isArray(scope.holder)) throw httpError(409, `${key} 数据档案格式异常，已停止学生删除。`, true);
      const rows = scope.holder.rows === undefined ? [] : scope.holder.rows;
      if (!Array.isArray(rows)) throw httpError(409, `${key}.rows 数据格式异常，已停止学生删除。`, true);
      const kept = [];
      rows.forEach((row) => {
        const sid = String(row && row.values && row.values.studentNo || "");
        if (!ids.has(sid)) { kept.push(row); return; }
        if (!row || !row.id) throw httpError(409, "自定义花名册存在缺少编号的记录，已停止学生删除。", true);
        const target = packages.get(sid); if (!target.patchRecords[key]) target.patchRecords[key] = [];
        target.patchRecords[key].push({ scopeId: scope.id, scopeLabel: scope.label, row }); target.labels[key] = "花名册（自定义版）"; target.relationCount++;
      });
      scope.holder.rows = kept;
    });
    remaining[key] = next;
  }
  const missing = [...packages.values()].filter((item) => !item.student).map((item) => item.studentId);
  if (missing.length) throw httpError(404, `未找到学生：${missing.slice(0, 5).join("、")}。`, true);
  return { packages: studentIds.map((id) => packages.get(String(id))), remaining, checksums };
}

function studentArchiveAttachments(pkg) {
  return recycleAttachmentInfo([pkg.student, pkg.records, pkg.termRecords, pkg.stateRecords, pkg.patchRecords]);
}

function studentArchiveConflict(entry) {
  const pkg = entry.payload, store = readStore(), conflicts = [], missingDependencies = [];
  let orgs = {};
  try { orgs = JSON.parse(store.nnuzc_orgs || "{}"); } catch (_error) {}
  const student = pkg.student || {}, departments = new Set((orgs.depts || []).map((row) => String(row.name || ""))), majors = new Set((orgs.majors || []).map((row) => String(row.name || ""))), classes = new Set((orgs.classes || []).map((row) => String(row.name || "")));
  if (student.dept && !departments.has(String(student.dept))) missingDependencies.push({ type: "DEPARTMENT_MISSING", value: student.dept });
  if (student.major && !majors.has(String(student.major))) missingDependencies.push({ type: "MAJOR_MISSING", value: student.major });
  if (student.cls && !classes.has(String(student.cls))) missingDependencies.push({ type: "CLASS_MISSING", value: student.cls });
  STUDENT_ARCHIVE_ARRAYS.forEach((config) => {
    const current = recycleStoreArray(store, config.key), incoming = (pkg.records && pkg.records[config.key]) || [];
    if (config.key === "nnuzc_students") {
      if (current.some((row) => String(row.id) === String(pkg.studentId))) conflicts.push({ type: "STUDENT_EXISTS", module: config.label, id: pkg.studentId });
      return;
    }
    const currentIds = new Set(current.map((row) => String(row && row.id || "")).filter(Boolean));
    incoming.forEach((row) => { if (row && row.id && currentIds.has(String(row.id))) conflicts.push({ type: "ID_EXISTS", module: config.label, id: String(row.id) }); });
  });
  STUDENT_ARCHIVE_TERM_STORES.forEach((config) => {
    const current = recycleStoreArray(store, config.key), incoming = (pkg.termRecords && pkg.termRecords[config.key]) || [];
    incoming.forEach((part) => {
      const term = current.find((row) => String(row.id) === String(part.termMeta.id) || String(row.term) === String(part.termMeta.term));
      if (term && (term.rows || []).some((row) => String(config.studentId(row) || "") === String(pkg.studentId))) conflicts.push({ type: "TERM_STUDENT_EXISTS", module: config.label, id: pkg.studentId, term: part.termMeta.term || part.termMeta.id });
    });
  });
  STUDENT_ARCHIVE_STATE_STORES.forEach((config) => {
    const current = recycleStoreObject(store, config.key), incoming = (pkg.stateRecords && pkg.stateRecords[config.key]) || {}, roomIds = new Set(studentArchiveStateRows(current, config.key, "rooms").map((row) => String(row && row.id || "")));
    const currentIds = {};
    config.collections.forEach((collection) => { currentIds[collection.name] = new Set(studentArchiveStateRows(current, config.key, collection.name).map((row) => String(row && row.id || "")).filter(Boolean)); });
    config.collections.forEach((collection) => {
      (incoming[collection.name] || []).forEach((row) => {
        if (row && row.id && currentIds[collection.name].has(String(row.id))) conflicts.push({ type: "ID_EXISTS", module: config.label, id: String(row.id) });
      });
    });
    (incoming.assignments || []).forEach((row) => {
      if (row.roomId && !roomIds.has(String(row.roomId))) missingDependencies.push({ type: "DORM_ROOM_MISSING", value: row.roomId });
      if (row.status === "current" && studentArchiveStateRows(current, config.key, "assignments").some((item) => item.status === "current" && (String(item.studentId) === String(pkg.studentId) || (String(item.roomId) === String(row.roomId) && String(item.bedNo) === String(row.bedNo))))) conflicts.push({ type: "DORM_ASSIGNMENT_CONFLICT", module: config.label, id: row.id || pkg.studentId });
    });
    (incoming.leaders || []).forEach((row) => {
      if (row.roomId && !roomIds.has(String(row.roomId))) missingDependencies.push({ type: "DORM_ROOM_MISSING", value: row.roomId });
      if (row.status === "current" && studentArchiveStateRows(current, config.key, "leaders").some((item) => item.status === "current" && (String(item.studentId) === String(pkg.studentId) || String(item.roomId) === String(row.roomId)))) conflicts.push({ type: "DORM_LEADER_CONFLICT", module: config.label, id: row.id || pkg.studentId });
    });
  });
  {
    const key = "nnuzc_checkclass", current = recycleStoreArray(store, key), patches = (pkg.patchRecords && pkg.patchRecords[key]) || [];
    patches.forEach((patch) => {
      const row = current.find((item) => String(item && item.id || "") === String(patch.recordId));
      if (!row) { missingDependencies.push({ type: "CHECK_CLASS_RECORD_MISSING", value: patch.recordId }); return; }
      if (patch.cls && student.cls && String(row.cls || "") !== String(student.cls)) conflicts.push({ type: "CHECK_CLASS_CLASS_MISMATCH", module: "查课名单关系", id: patch.recordId });
      Object.keys(patch.memberships || {}).forEach((field) => {
        const values = row[field] === undefined ? [] : row[field];
        if (!Array.isArray(values)) throw httpError(409, `${key}.${field} 数据格式异常，已停止学生恢复。`, true);
        if (values.some((value) => String(value) === String(pkg.studentId))) conflicts.push({ type: "CHECK_CLASS_MEMBERSHIP_EXISTS", module: "查课名单关系", id: patch.recordId });
      });
    });
  }
  {
    const key = "nnuzc_custom_roster_v1", current = recycleStoreObject(store, key), patches = (pkg.patchRecords && pkg.patchRecords[key]) || [];
    patches.forEach((patch) => {
      const holder = patch.scopeId === "__legacy__" ? current : (Array.isArray(current.datasets) ? current.datasets.find((dataset) => String(dataset && dataset.id || "") === String(patch.scopeId))?.state : null);
      if (!holder || !Array.isArray(holder.rows)) { missingDependencies.push({ type: "CUSTOM_ROSTER_DATASET_MISSING", value: patch.scopeLabel || patch.scopeId }); return; }
      if (holder.rows.some((row) => String(row && row.id || "") === String(patch.row && patch.row.id || ""))) conflicts.push({ type: "CUSTOM_ROSTER_ROW_EXISTS", module: "花名册（自定义版）", id: patch.row && patch.row.id });
    });
  }
  const storeChecksums = Object.fromEntries(STUDENT_ARCHIVE_KEYS.map((key) => [key, studentArchiveStoreChecksum(store, key)]));
  return { conflicts, missingDependencies, storeChecksums };
}

function studentArchiveMerge(entry) {
  const pkg = entry.payload, store = readStore(), values = {};
  STUDENT_ARCHIVE_ARRAYS.forEach((config) => {
    const current = recycleStoreArray(store, config.key), incoming = (pkg.records && pkg.records[config.key]) || [];
    values[config.key] = JSON.stringify(current.concat(incoming));
  });
  STUDENT_ARCHIVE_TERM_STORES.forEach((config) => {
    const current = recycleStoreArray(store, config.key).map((term) => Object.assign({}, term, { rows: Array.isArray(term.rows) ? term.rows.slice() : [] })), incoming = (pkg.termRecords && pkg.termRecords[config.key]) || [];
    incoming.forEach((part) => {
      let term = current.find((row) => String(row.id) === String(part.termMeta.id) || String(row.term) === String(part.termMeta.term));
      if (!term) { term = Object.assign({}, part.termMeta, { rows: [] }); current.push(term); }
      term.rows = (term.rows || []).concat(part.rows || []);
    });
    values[config.key] = JSON.stringify(current);
  });
  STUDENT_ARCHIVE_STATE_STORES.forEach((config) => {
    const current = JSON.parse(JSON.stringify(recycleStoreObject(store, config.key))), incoming = (pkg.stateRecords && pkg.stateRecords[config.key]) || {};
    config.collections.forEach((collection) => { current[collection.name] = studentArchiveStateRows(current, config.key, collection.name).concat(incoming[collection.name] || []); });
    values[config.key] = JSON.stringify(current);
  });
  {
    const key = "nnuzc_checkclass", current = JSON.parse(JSON.stringify(recycleStoreArray(store, key))), patches = (pkg.patchRecords && pkg.patchRecords[key]) || [];
    patches.forEach((patch) => {
      const row = current.find((item) => String(item && item.id || "") === String(patch.recordId)); if (!row) return;
      Object.keys(patch.memberships || {}).forEach((field) => { row[field] = Array.from(new Set((Array.isArray(row[field]) ? row[field] : []).map(String).concat([String(pkg.studentId)]))); });
    });
    values[key] = JSON.stringify(current);
  }
  {
    const key = "nnuzc_custom_roster_v1", current = JSON.parse(JSON.stringify(recycleStoreObject(store, key))), patches = (pkg.patchRecords && pkg.patchRecords[key]) || [];
    patches.forEach((patch) => {
      const holder = patch.scopeId === "__legacy__" ? current : (Array.isArray(current.datasets) ? current.datasets.find((dataset) => String(dataset && dataset.id || "") === String(patch.scopeId))?.state : null);
      if (holder && Array.isArray(holder.rows)) holder.rows.push(patch.row);
    });
    values[key] = JSON.stringify(current);
  }
  return values;
}

function recycleAdapter(moduleKey, entityType) {
  const adapter = RECYCLE_ARRAY_ADAPTERS[String(moduleKey || "")];
  if (!adapter || adapter.entityType !== String(entityType || "")) throw httpError(400, "该模块暂未接入可恢复删除。", true);
  return adapter;
}

function recycleArrayRows(adapter) {
  const raw = readStore()[adapter.storeKey] || "[]";
  let parsed, rows;
  try {
    parsed = JSON.parse(raw); rows = adapter.rootCollection ? parsed && parsed[adapter.rootCollection] : parsed;
    if (adapter.virtualField) rows = (Array.isArray(parsed) ? parsed : []).filter((row) => row && row[adapter.virtualField] && typeof row[adapter.virtualField] === "object").map((row) => ({ id: row.id, name: row.name, [adapter.virtualField]: row[adapter.virtualField] }));
    if (Array.isArray(rows) && Array.isArray(adapter.embedCollections)) rows = rows.map((row) => { const copy = Object.assign({}, row); adapter.embedCollections.forEach((config) => { copy[config.field] = (Array.isArray(parsed[config.source]) ? parsed[config.source] : []).filter((item) => String(item && item[config.foreignKey] || "") === recycleEntityId(row, adapter)); }); return copy; });
    if (Array.isArray(rows) && adapter.linkedStudentCollection) {
      let students; try { students = JSON.parse(readStore().nnuzc_students || "[]"); } catch (_error) { students = null; }
      if (!Array.isArray(students)) throw httpError(409, `${adapter.label}关联学生数据格式异常，已停止操作。`, true);
      rows = rows.map((row) => { const copy = Object.assign({}, row), sourceId = recycleEntityId(row, adapter); copy[adapter.linkedPayloadField] = []; students.forEach((student) => { const linked = Array.isArray(student && student[adapter.linkedStudentCollection]) ? student[adapter.linkedStudentCollection] : []; linked.forEach((item, index) => { if (String(item && item[adapter.linkedForeignKey] || "") === sourceId) copy[adapter.linkedPayloadField].push({ studentId: String(student.id || ""), index, row: item }); }); }); return copy; });
    }
  } catch (_error) { throw httpError(409, `${adapter.label}数据损坏，已停止删除。`, true); }
  if (!Array.isArray(rows)) throw httpError(409, `${adapter.label}数据格式异常，已停止删除。`, true);
  return rows;
}

function recycleEntityId(row, adapter) { if (typeof row === "string" || typeof row === "number") return String(row).trim(); const field = adapter && adapter.idField || "id"; return String(row && row[field] !== undefined && row[field] !== null ? row[field] : "").trim(); }
function recycleNestedId(parentId, childId) { return `${String(parentId)}::${String(childId)}`; }
function recycleNestedCollection(parent, nested) { let value = parent; const path = Array.isArray(nested.path) ? nested.path : [nested.collection]; for (const key of path) value = value && value[key]; return value === undefined ? [] : value; }
function recycleSetNestedCollection(parent, nested, rows) { let value = parent; const path = Array.isArray(nested.path) ? nested.path : [nested.collection]; path.slice(0, -1).forEach((key) => { if (!value[key] || typeof value[key] !== "object") value[key] = {}; value = value[key]; }); value[path[path.length - 1]] = rows; }
function recycleTreeFind(nodes, id, parentNodeId = "") { for (let index = 0; index < (nodes || []).length; index++) { const node = nodes[index]; if (String(node && node.id || "") === String(id)) return { node, list: nodes, index, parentNodeId }; const found = recycleTreeFind(node && node.children, id, String(node && node.id || "")); if (found) return found; } return null; }
function recycleTreeWalk(nodes, visit) { (nodes || []).forEach((node) => { visit(node); recycleTreeWalk(node && node.children, visit); }); }
function recycleRecordStudentId(adapter, record) {
  if (!adapter.nested) return String(record && record[adapter.studentField] || "");
  if (adapter.storeKey === "nnuzc_students") return String(record.parentId || "");
  if (record.parentStudentId) return String(record.parentStudentId);
  return String(record.row && record.row[adapter.studentField] || "");
}
function recycleRecordChecksum(row) { return sha256Hex(JSON.stringify(row)); }
function recycleLookup(moduleKey, entityId) { return protectedRecordId(`recycle-${moduleKey}`, entityId); }
function recycleStudentLookup(studentId) { return studentId ? protectedStudentId(String(studentId)) : ""; }

function recycleAttachmentInfo(records) {
  const ids = new Set();
  records.forEach((record) => collectAttachmentReferences(record, ids));
  let bytes = 0;
  ids.forEach((id) => { try { const stat = fs.statSync(attachmentPath(id)); if (stat.isFile()) bytes += stat.size; } catch (_error) {} });
  return { ids: [...ids].sort(), bytes };
}

function recycleWriteArray(adapter, rows) {
  let output = rows;
  if (adapter.linkedPayloadField) output = rows.map((row) => { const copy = Object.assign({}, row); delete copy[adapter.linkedPayloadField]; return copy; });
  if (adapter.virtualField) {
    let parsed; try { parsed = JSON.parse(readStore()[adapter.storeKey] || "[]"); } catch (_error) { throw httpError(409, `${adapter.label}数据损坏，已停止写入。`, true); }
    if (!Array.isArray(parsed)) throw httpError(409, `${adapter.label}数据格式异常，已停止写入。`, true);
    const values = new Map(rows.map((row) => [String(row.id), row[adapter.virtualField]]));
    output = parsed.map((row) => Object.assign({}, row, { [adapter.virtualField]: values.has(String(row.id)) ? values.get(String(row.id)) : null }));
  }
  if (adapter.rootCollection) {
    let parsed; try { parsed = JSON.parse(readStore()[adapter.storeKey] || "{}"); } catch (_error) { throw httpError(409, `${adapter.label}数据损坏，已停止写入。`, true); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw httpError(409, `${adapter.label}数据格式异常，已停止写入。`, true);
    const cleanRows = rows.map((row) => { const copy = Object.assign({}, row); (adapter.embedCollections || []).forEach((config) => { delete copy[config.field]; }); return copy; });
    output = Object.assign({}, parsed, { [adapter.rootCollection]: cleanRows });
    (adapter.embedCollections || []).forEach((config) => { output[config.source] = rows.flatMap((row) => Array.isArray(row && row[config.field]) ? row[config.field] : []); });
  }
  const value = JSON.stringify(output);
  recycleWriteStoreValue(adapter.storeKey, value);
  return value;
}

function recycleMoveLinkedStudentRows(adapter, records) {
  if (!adapter.linkedStudentCollection) return null;
  let students; try { students = JSON.parse(readStore().nnuzc_students || "[]"); } catch (_error) { throw httpError(409, `${adapter.label}关联学生数据损坏，已停止删除。`, true); }
  if (!Array.isArray(students)) throw httpError(409, `${adapter.label}关联学生数据格式异常，已停止删除。`, true);
  const sourceIds = new Set(records.map((record) => recycleEntityId(record, adapter)));
  students.forEach((student) => { const linked = Array.isArray(student && student[adapter.linkedStudentCollection]) ? student[adapter.linkedStudentCollection] : []; student[adapter.linkedStudentCollection] = linked.filter((item) => !sourceIds.has(String(item && item[adapter.linkedForeignKey] || ""))); });
  return recycleWriteStoreValue("nnuzc_students", JSON.stringify(students));
}

function recycleRestoreLinkedStudentRows(adapter, entries) {
  if (!adapter.linkedStudentCollection) return null;
  let students; try { students = JSON.parse(readStore().nnuzc_students || "[]"); } catch (_error) { throw httpError(409, `${adapter.label}关联学生数据损坏，已停止恢复。`, true); }
  if (!Array.isArray(students)) throw httpError(409, `${adapter.label}关联学生数据格式异常，已停止恢复。`, true);
  const byId = new Map(students.map((student) => [String(student && student.id || ""), student]));
  entries.forEach((entry) => (entry.payload && entry.payload[adapter.linkedPayloadField] || []).forEach((item) => {
    const student = byId.get(String(item.studentId || "")); if (!student) return;
    const rows = Array.isArray(student[adapter.linkedStudentCollection]) ? student[adapter.linkedStudentCollection] : [];
    rows.splice(Math.max(0, Math.min(rows.length, Number(item.index) || 0)), 0, item.row); student[adapter.linkedStudentCollection] = rows;
  }));
  return recycleWriteStoreValue("nnuzc_students", JSON.stringify(students));
}

function recycleWriteStoreValue(key, value) {
  if(key==='nnuzc_student_leaves')value=normalizeStudentLeaves(value,readStore(),null,true);
  if (!writeCoreKey(key, value, "force", { transaction: false })) {
    database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(key, encryptText(value));
  }
  return value;
}

function recyclePreviewSecret(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", requireDataKey()).update(`recycle-preview:${encoded}`, "utf8").digest("base64url");
  return `${encoded}.${signature}`;
}

function recycleVerifyPreview(token, kind) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw httpError(400, "回收站预览凭证无效，请重新预览。", true);
  const expected = crypto.createHmac("sha256", requireDataKey()).update(`recycle-preview:${parts[0]}`, "utf8").digest("base64url");
  const left = Buffer.from(parts[1]), right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw httpError(400, "回收站预览凭证无效，请重新预览。", true);
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch (_error) { throw httpError(400, "回收站预览凭证损坏，请重新预览。", true); }
  if (!payload || payload.kind !== kind || !Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) throw httpError(409, "回收站预览已过期，请重新预览。", true);
  return payload;
}

function recycleValidateIds(values) {
  if (!Array.isArray(values) || !values.length || values.length > 500) throw httpError(400, "请选择 1 至 500 条数据。", true);
  const ids = values.map((value) => String(value == null ? "" : value).trim());
  if (ids.some((id) => !id || id.length > 200) || new Set(ids).size !== ids.length) throw httpError(400, "删除目标编号无效或重复。", true);
  return ids;
}

function recycleSelectRecords(adapter, ids) {
  const rows = recycleArrayRows(adapter), wanted = new Set(ids);
  if (!adapter.nested) {
    const records = rows.filter((row) => wanted.has(recycleEntityId(row, adapter)));
    if (records.length !== ids.length) throw httpError(404, "部分待删除数据已不存在，请刷新后重试。", true);
    const byId = new Map(records.map((row) => [recycleEntityId(row, adapter), row]));
    return { rows, records: ids.map((id) => byId.get(id)), remaining: rows.filter((row) => !wanted.has(recycleEntityId(row, adapter))) };
  }
  const next = JSON.parse(JSON.stringify(rows)), found = new Map(), childId = adapter.nested.childId;
  next.forEach((parent) => {
    const parentId = recycleEntityId(parent, adapter), children = recycleNestedCollection(parent, adapter.nested);
    if (!Array.isArray(children)) throw httpError(409, `${adapter.label}数据格式异常，已停止删除。`, true);
    if (adapter.nested.treeMode === "node") {
      const removeNodes = (list, parentNodeId) => { for (let index = list.length - 1; index >= 0; index--) { const child = list[index], id = `${parentId}::${String(child && child[childId] || "")}`; if (wanted.has(id)) { found.set(id, { id, parentId, parentLabel: String(parent.name || ""), parentNodeId, index, row: child }); list.splice(index, 1); } else removeNodes(Array.isArray(child.children) ? child.children : [], String(child && child[childId] || "")); } }; removeNodes(children, ""); return;
    }
    if (adapter.nested.treeMode === "member") {
      recycleTreeWalk(children, (node) => { const members = Array.isArray(node[adapter.nested.memberCollection]) ? node[adapter.nested.memberCollection] : []; node[adapter.nested.memberCollection] = members.filter((member, index) => { const memberId = String(member && member[adapter.nested.memberId] || ""), id = `${parentId}::${String(node && node[childId] || "")}::${memberId}`; if (!wanted.has(id)) return true; if (!memberId) throw httpError(409, `${adapter.label}存在缺少稳定编号的任职记录，已停止删除。`, true); found.set(id, { id, parentId, parentLabel: String(parent.name || ""), middleId: String(node && node[childId] || ""), parentStudentId: String(member && member[adapter.studentField] || ""), index, row: member }); return false; }); }); return;
    }
    if (adapter.nested.subcollection) {
      children.forEach((middle) => {
        const middleId = String(middle && middle[childId] || ""), subrows = middle && middle[adapter.nested.subcollection] === undefined ? [] : middle[adapter.nested.subcollection];
        if (!Array.isArray(subrows)) throw httpError(409, `${adapter.label}课程明细格式异常，已停止删除。`, true);
        middle[adapter.nested.subcollection] = subrows.filter((child, index) => {
          const id = `${parentId}::${middleId}::${String(child && child[adapter.nested.subChildId] || "")}`;
          if (!wanted.has(id)) return true;
          if (!parentId || !middleId || !String(child && child[adapter.nested.subChildId] || "")) throw httpError(409, `${adapter.label}存在缺少稳定编号的课程，已停止删除。`, true);
          found.set(id, { id, parentId, parentLabel: String(parent.term || ""), middleId, parentStudentId: String(middle["学号"] || middle.studentId || ""), index, row: child }); return false;
        });
      });
      return;
    }
    recycleSetNestedCollection(parent, adapter.nested, children.filter((child, index) => {
      const id = recycleNestedId(parentId, child && child[childId]);
      if (!wanted.has(id)) return true;
      if (!parentId || !String(child && child[childId] || "")) throw httpError(409, `${adapter.label}存在缺少稳定编号的记录，已停止删除。`, true);
      found.set(id, { id, parentId, parentLabel: String(parent.term || parent.name || parent.title || ""), parentStudentId: adapter.storeKey === "nnuzc_students" ? String(parent.id || "") : String(child && child[adapter.studentField] || parent.sid || parent.studentId || ""), index, row: child });
      return false;
    }));
  });
  if (found.size !== ids.length) throw httpError(404, "部分待删除数据已不存在，请刷新后重试。", true);
  return { rows, records: ids.map((id) => found.get(id)), remaining: next };
}

function recycleDeletePreview(body) {
  const adapter = recycleAdapter(body && body.moduleKey, body && body.entityType);
  const ids = recycleValidateIds(body && body.entityIds);
  const selected = recycleSelectRecords(adapter, ids), attachment = recycleAttachmentInfo(selected.records);
  const checksum = sha256Hex(JSON.stringify(selected.records));
  const preview = { kind: "delete", moduleKey: String(body.moduleKey), entityType: adapter.entityType, ids, checksum, expiresAt: Date.now() + 10 * 60 * 1000 };
  return {
    previewToken: recyclePreviewSecret(preview),
    moduleLabel: adapter.label,
    count: selected.records.length,
    attachmentCount: attachment.ids.length,
    attachmentBytes: attachment.bytes,
    items: selected.records.slice(0, 20).map((row) => ({ id: recycleEntityId(row, adapter), title: adapter.title(row) })),
    canDelete: true
  };
}

function recycleRequestId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(id)) throw httpError(400, "操作请求编号无效。", true);
  return id;
}

function recycleStoredResponse(requestId, action) {
  const row = database.prepare("SELECT action,response_json FROM recycle_bin_requests WHERE request_id=?").get(requestId);
  if (!row) return null;
  if (row.action !== action) throw httpError(409, "该操作请求编号已被其他操作使用。", true);
  return JSON.parse(decryptText(row.response_json));
}

function recycleRememberRequest(requestId, action, response) {
  database.prepare("INSERT INTO recycle_bin_requests(request_id,action,response_json,created_at) VALUES(?,?,?,?)").run(requestId, action, encryptText(JSON.stringify(response)), new Date().toISOString());
}

function recycleAudit(recycleId, action, moduleKey, entityType, entityLookup, result = "success", note = "") {
  database.prepare("INSERT INTO recycle_bin_audit(recycle_id,action,module_key,entity_type,entity_lookup,action_at,result,note) VALUES(?,?,?,?,?,?,?,?)").run(recycleId, action, moduleKey, entityType, entityLookup, new Date().toISOString(), result, String(note || "").slice(0, 300));
}

function recycleMove(body, manageTransaction = true) {
  const requestId = recycleRequestId(body && body.requestId), previous = recycleStoredResponse(requestId, "move");
  if (previous) return previous;
  if (!body || body.confirmation !== "移入回收站") throw httpError(400, "请确认将数据移入回收站。", true);
  const preview = recycleVerifyPreview(body.previewToken, "delete");
  const adapter = recycleAdapter(preview.moduleKey, preview.entityType);
  const selected = recycleSelectRecords(adapter, preview.ids);
  if (sha256Hex(JSON.stringify(selected.records)) !== preview.checksum) throw httpError(409, "数据在预览后发生变化，请重新预览。", true);
  const remaining = selected.remaining;
  const now = new Date(), expires = new Date(now.getTime() + RECYCLE_RETENTION_DAYS * 86400000), batchId = crypto.randomUUID();
  const insert = database.prepare("INSERT INTO recycle_bin(id,batch_id,module_key,entity_type,entity_lookup,entity_id_enc,display_title_enc,student_lookup,delete_kind,payload_json,attachment_ids_json,source_keys_json,relation_count,attachment_count,attachment_bytes,schema_version,checksum,status,deleted_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)");
  const created = [];
  if (manageTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    selected.records.forEach((record) => {
      const entityId = adapter.nested ? String(record.id) : recycleEntityId(record, adapter), recycleId = crypto.randomUUID(), attachments = recycleAttachmentInfo([record]), entityLookup = recycleLookup(preview.moduleKey, entityId), studentId = recycleRecordStudentId(adapter, record);
      insert.run(recycleId, batchId, preview.moduleKey, adapter.entityType, entityLookup, encryptText(entityId), encryptText(adapter.title(record)), recycleStudentLookup(studentId), selected.records.length > 1 ? "batch" : "single", encryptText(JSON.stringify(record)), encryptText(JSON.stringify(attachments.ids)), encryptText(JSON.stringify([adapter.storeKey])), 0, attachments.ids.length, attachments.bytes, 1, recycleRecordChecksum(record), now.toISOString(), expires.toISOString());
      recycleAudit(recycleId, "move", preview.moduleKey, adapter.entityType, entityLookup);
      created.push({ id: recycleId, entityId, title: adapter.title(record) });
    });
    const storeValue = recycleWriteArray(adapter, remaining), storeValues = { [adapter.storeKey]: storeValue }, linkedStudentValue = recycleMoveLinkedStudentRows(adapter, selected.records);
    if (linkedStudentValue !== null) storeValues.nnuzc_students = linkedStudentValue;
    const response = { ok: true, batchId, count: created.length, items: created, storeValues, retentionDays: RECYCLE_RETENTION_DAYS };
    recycleRememberRequest(requestId, "move", response);
    if (manageTransaction) database.exec("COMMIT");
    return response;
  } catch (error) { try { if (manageTransaction) database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function recycleStudentDeletePreview(body) {
  const ids = recycleValidateIds(body && body.studentIds), prepared = studentArchivePrepare(ids);
  const items = prepared.packages.map((pkg) => {
    const attachment = studentArchiveAttachments(pkg);
    return { studentId: pkg.studentId, title: `${pkg.student.name || "未知学生"}（${pkg.studentId}）`, relationCount: pkg.relationCount, attachmentCount: attachment.ids.length, attachmentBytes: attachment.bytes };
  });
  const preview = { kind: "student-delete", ids, stores: prepared.checksums, expiresAt: Date.now() + 10 * 60 * 1000 };
  return { previewToken: recyclePreviewSecret(preview), moduleLabel: "学生管理", count: items.length, relationCount: items.reduce((sum, item) => sum + item.relationCount, 0), attachmentCount: items.reduce((sum, item) => sum + item.attachmentCount, 0), attachmentBytes: items.reduce((sum, item) => sum + item.attachmentBytes, 0), items, canDelete: true };
}

function recycleStudentMove(body) {
  const requestId = recycleRequestId(body && body.requestId), previous = recycleStoredResponse(requestId, "student-move");
  if (previous) return previous;
  if (!body || body.confirmation !== "移入回收站") throw httpError(400, "请确认将学生整档移入回收站。", true);
  const preview = recycleVerifyPreview(body.previewToken, "student-delete"), ids = recycleValidateIds(preview.ids), prepared = studentArchivePrepare(ids);
  for (const key of STUDENT_ARCHIVE_KEYS) if (prepared.checksums[key] !== preview.stores[key]) throw httpError(409, "学生或关联数据在预览后发生变化，请重新预览。", true);
  const now = new Date(), expires = new Date(now.getTime() + RECYCLE_RETENTION_DAYS * 86400000), batchId = crypto.randomUUID(), created = [], storeValues = {};
  const insert = database.prepare("INSERT INTO recycle_bin(id,batch_id,module_key,entity_type,entity_lookup,entity_id_enc,display_title_enc,student_lookup,delete_kind,payload_json,attachment_ids_json,source_keys_json,relation_count,attachment_count,attachment_bytes,schema_version,checksum,status,deleted_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)");
  database.exec("BEGIN IMMEDIATE");
  try {
    prepared.packages.forEach((pkg) => {
      const recycleId = crypto.randomUUID(), attachment = studentArchiveAttachments(pkg), title = `${pkg.student.name || "未知学生"}（${pkg.studentId}）`, payload = Object.assign({ schema: "student-archive-v2" }, pkg);
      insert.run(recycleId, batchId, "student", "student_archive", recycleLookup("student", pkg.studentId), encryptText(pkg.studentId), encryptText(title), recycleStudentLookup(pkg.studentId), ids.length > 1 ? "batch" : "single", encryptText(JSON.stringify(payload)), encryptText(JSON.stringify(attachment.ids)), encryptText(JSON.stringify([...new Set(Object.keys(pkg.labels).concat(["nnuzc_students"]))])), pkg.relationCount, attachment.ids.length, attachment.bytes, 1, recycleRecordChecksum(payload), now.toISOString(), expires.toISOString());
      recycleAudit(recycleId, "move", "student", "student_archive", recycleLookup("student", pkg.studentId));
      created.push({ id: recycleId, entityId: pkg.studentId, title, relationCount: pkg.relationCount });
    });
    STUDENT_ARCHIVE_KEYS.forEach((key) => { storeValues[key] = recycleWriteStoreValue(key, JSON.stringify(prepared.remaining[key])); });
    const response = { ok: true, batchId, count: created.length, items: created, storeValues, retentionDays: RECYCLE_RETENTION_DAYS, studentArchive: true };
    recycleRememberRequest(requestId, "student-move", response);
    database.exec("COMMIT");
    return response;
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function recycleDecodeRow(row, includePayload = false) {
  const result = {
    id: row.id, batchId: row.batch_id, moduleKey: row.module_key, moduleLabel: row.module_key === "student" ? "学生整档" : ((RECYCLE_ARRAY_ADAPTERS[row.module_key] || {}).label || row.module_key),
    entityType: row.entity_type, entityId: decryptText(row.entity_id_enc), title: decryptText(row.display_title_enc), deleteKind: row.delete_kind,
    relationCount: Number(row.relation_count || 0), attachmentCount: Number(row.attachment_count || 0), attachmentBytes: Number(row.attachment_bytes || 0),
    checksum: row.checksum, status: row.status, deletedAt: row.deleted_at, expiresAt: row.expires_at
  };
  if (includePayload) {
    result.payload = JSON.parse(decryptText(row.payload_json));
    result.attachmentIds = JSON.parse(decryptText(row.attachment_ids_json));
    result.sourceKeys = JSON.parse(decryptText(row.source_keys_json));
  }
  return result;
}

function recycleList(url) {
  /* 离线系统可能长期不重启；每次进入回收站时补做一次到期清理。 */
  recyclePurgeExpired();
  const moduleKey = String(url.searchParams.get("moduleKey") || "").trim(), keyword = String(url.searchParams.get("keyword") || "").trim().toLowerCase(), deleteKind = String(url.searchParams.get("deleteKind") || "").trim(), expiry = String(url.searchParams.get("expiry") || "").trim();
  const dateFrom = String(url.searchParams.get("dateFrom") || "").trim(), dateTo = String(url.searchParams.get("dateTo") || "").trim();
  const page = Math.max(1, Math.min(100000, Number(url.searchParams.get("page") || 1) || 1)), pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get("pageSize") || 20) || 20));
  const rows = database.prepare("SELECT * FROM recycle_bin WHERE status IN ('active','restore_failed') ORDER BY deleted_at DESC LIMIT 10000").all().map((row) => recycleDecodeRow(row, false));
  const now = Date.now(), fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00+08:00`).getTime() : NaN, toMs = dateTo ? new Date(`${dateTo}T23:59:59.999+08:00`).getTime() : NaN;
  const filtered = rows.filter((row) => {
    const deletedMs = new Date(row.deletedAt).getTime(), expiresMs = row.expiresAt ? new Date(row.expiresAt).getTime() : NaN;
    return (!moduleKey || row.moduleKey === moduleKey) && (!keyword || `${row.title} ${row.entityId} ${row.moduleLabel}`.toLowerCase().includes(keyword)) && (!deleteKind || row.deleteKind === deleteKind) && (!Number.isFinite(fromMs) || deletedMs >= fromMs) && (!Number.isFinite(toMs) || deletedMs <= toMs) && (!expiry || (expiry === "permanent" ? !row.expiresAt : expiry === "soon" ? Number.isFinite(expiresMs) && expiresMs - now <= 7 * 86400000 : expiry === "normal" ? Number.isFinite(expiresMs) && expiresMs - now > 7 * 86400000 : true));
  });
  const offset = (page - 1) * pageSize;
  return {
    items: filtered.slice(offset, offset + pageSize), page, pageSize, total: filtered.length,
    summary: { total: rows.length, expiringSoon: rows.filter((row) => row.expiresAt && new Date(row.expiresAt).getTime() - now <= 7 * 86400000).length, attachmentCount: rows.reduce((sum, row) => sum + row.attachmentCount, 0), attachmentBytes: rows.reduce((sum, row) => sum + row.attachmentBytes, 0) },
    modules: [{ key: "student", label: "学生整档" }].concat(Object.entries(RECYCLE_ARRAY_ADAPTERS).map(([key, value]) => ({ key, label: value.label })))
  };
}

function recycleGet(id) {
  const row = database.prepare("SELECT * FROM recycle_bin WHERE id=?").get(String(id || ""));
  if (!row) throw httpError(404, "回收站数据不存在。", true);
  return recycleDecodeRow(row, true);
}

function recycleRestoreState(adapter, rows, entries) {
  const conflicts = [], missingDependencies = [];
  if (!adapter.nested) {
    const occupied = new Set(rows.map((row) => recycleEntityId(row, adapter)));
    entries.forEach((entry) => { if (occupied.has(entry.entityId)) conflicts.push({ type: "ID_EXISTS", module: entry.moduleKey, id: entry.entityId, recycleId: entry.id }); occupied.add(entry.entityId); });
  } else {
    entries.forEach((entry) => {
      const payload = entry.payload || {}, parent = rows.find((row) => recycleEntityId(row, adapter) === String(payload.parentId));
      if (!parent) { missingDependencies.push({ type: "PARENT_RECORD_MISSING", module: entry.moduleKey, value: payload.parentLabel || payload.parentId, recycleId: entry.id }); return; }
      const children = recycleNestedCollection(parent, adapter.nested);
      if (!Array.isArray(children)) throw httpError(409, `${adapter.label}数据格式异常，已停止恢复。`, true);
      if (adapter.nested.treeMode === "node") {
        const targetList = payload.parentNodeId ? ((recycleTreeFind(children, payload.parentNodeId) || {}).node || {}).children : children;
        if (!Array.isArray(targetList)) { missingDependencies.push({ type: "PARENT_RECORD_MISSING", module: entry.moduleKey, value: payload.parentNodeId || payload.parentId, recycleId: entry.id }); return; }
        if (recycleTreeFind(children, payload.row && payload.row[adapter.nested.childId])) conflicts.push({ type: "ID_EXISTS", module: entry.moduleKey, id: entry.entityId, recycleId: entry.id });
        return;
      }
      if (adapter.nested.treeMode === "member") {
        const node = (recycleTreeFind(children, payload.middleId) || {}).node;
        if (!node) { missingDependencies.push({ type: "PARENT_RECORD_MISSING", module: entry.moduleKey, value: payload.middleId || payload.parentId, recycleId: entry.id }); return; }
        const members = Array.isArray(node[adapter.nested.memberCollection]) ? node[adapter.nested.memberCollection] : [];
        if (members.some((member) => String(member && member[adapter.nested.memberId] || "") === String(payload.row && payload.row[adapter.nested.memberId] || ""))) conflicts.push({ type: "ID_EXISTS", module: entry.moduleKey, id: entry.entityId, recycleId: entry.id });
        return;
      }
      if (adapter.nested.subcollection) {
        const middle = children.find((row) => String(row && row[adapter.nested.childId] || "") === String(payload.middleId || ""));
        if (!middle) { missingDependencies.push({ type: "PARENT_RECORD_MISSING", module: entry.moduleKey, value: payload.middleId || payload.parentLabel || payload.parentId, recycleId: entry.id }); return; }
        const subrows = middle[adapter.nested.subcollection] === undefined ? [] : middle[adapter.nested.subcollection];
        if (!Array.isArray(subrows)) throw httpError(409, `${adapter.label}课程明细格式异常，已停止恢复。`, true);
        const subId = String(payload.row && payload.row[adapter.nested.subChildId] || "");
        if (subrows.some((row) => String(row && row[adapter.nested.subChildId] || "") === subId)) conflicts.push({ type: "ID_EXISTS", module: entry.moduleKey, id: entry.entityId, recycleId: entry.id });
        return;
      }
      const childId = String(payload.row && payload.row[adapter.nested.childId] || "");
      if (children.some((row) => String(row && row[adapter.nested.childId] || "") === childId)) conflicts.push({ type: "ID_EXISTS", module: entry.moduleKey, id: entry.entityId, recycleId: entry.id });
    });
  }
  let students = [];
  try { students = JSON.parse(readStore().nnuzc_students || "[]"); } catch (_error) {}
  entries.forEach((entry) => {
    const studentId = recycleRecordStudentId(adapter, entry.payload || {});
    if (studentId && adapter.storeKey !== "nnuzc_students" && !students.some((student) => String(student.id) === studentId)) missingDependencies.push({ type: "STUDENT_MISSING", studentId, recycleId: entry.id });
    if (adapter.linkedStudentCollection) (entry.payload && entry.payload[adapter.linkedPayloadField] || []).forEach((item) => {
      const student = students.find((row) => String(row && row.id || "") === String(item.studentId || ""));
      if (!student) { missingDependencies.push({ type: "STUDENT_MISSING", studentId: String(item.studentId || ""), recycleId: entry.id }); return; }
      const linked = Array.isArray(student[adapter.linkedStudentCollection]) ? student[adapter.linkedStudentCollection] : [];
      const rowId = String(item.row && item.row.id || "");
      if (linked.some((row) => (rowId && String(row && row.id || "") === rowId) || (String(row && row[adapter.linkedForeignKey] || "") === String(entry.entityId) && String(row && (row.sourceCheckClassType || row.type) || "") === String(item.row && (item.row.sourceCheckClassType || item.row.type) || "")))) conflicts.push({ type: "ID_EXISTS", module: entry.moduleKey, id: rowId || entry.entityId, recycleId: entry.id });
    });
  });
  return { conflicts, missingDependencies };
}

function recycleRestoreRows(adapter, rows, entries) {
  if (!adapter.nested) return rows.concat(entries.map((entry) => entry.payload));
  const next = JSON.parse(JSON.stringify(rows));
  entries.forEach((entry) => {
    const payload = entry.payload || {}, parent = next.find((row) => recycleEntityId(row, adapter) === String(payload.parentId));
    if (!parent) return;
    const children = recycleNestedCollection(parent, adapter.nested);
    if (adapter.nested.treeMode === "node") { const list = payload.parentNodeId ? ((recycleTreeFind(children, payload.parentNodeId) || {}).node || {}).children : children; if (Array.isArray(list)) list.splice(Math.max(0, Math.min(list.length, Number(payload.index) || 0)), 0, payload.row); return; }
    if (adapter.nested.treeMode === "member") { const node = (recycleTreeFind(children, payload.middleId) || {}).node; if (node) { const members = Array.isArray(node[adapter.nested.memberCollection]) ? node[adapter.nested.memberCollection] : []; members.splice(Math.max(0, Math.min(members.length, Number(payload.index) || 0)), 0, payload.row); node[adapter.nested.memberCollection] = members; } return; }
    if (adapter.nested.subcollection) {
      const middle = children.find((row) => String(row && row[adapter.nested.childId] || "") === String(payload.middleId || ""));
      if (!middle) return;
      const subcollection = adapter.nested.subcollection, subrows = Array.isArray(middle[subcollection]) ? middle[subcollection] : [];
      subrows.splice(Math.max(0, Math.min(subrows.length, Number(payload.index) || 0)), 0, payload.row); middle[subcollection] = subrows;
      return;
    }
    children.splice(Math.max(0, Math.min(children.length, Number(payload.index) || 0)), 0, payload.row); recycleSetNestedCollection(parent, adapter.nested, children);
  });
  return next;
}

function recycleRestorePreview(id) {
  const entry = recycleGet(id);
  if (entry.entityType === "student_archive") {
    const state = studentArchiveConflict(entry), missingAttachments = (entry.attachmentIds || []).filter((attachmentId) => !fs.existsSync(attachmentPath(attachmentId)));
    const token = recyclePreviewSecret({ kind: "restore-student", recycleId: entry.id, entryChecksum: entry.checksum, stores: state.storeChecksums, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { previewToken: token, canRestore: !state.conflicts.length && !state.missingDependencies.length, conflicts: state.conflicts, missingDependencies: state.missingDependencies, missingAttachments, entry };
  }
  const adapter = recycleAdapter(entry.moduleKey, entry.entityType), rows = recycleArrayRows(adapter);
  const state = recycleRestoreState(adapter, rows, [entry]), conflicts = state.conflicts, missingDependencies = state.missingDependencies;
  const missingAttachments = (entry.attachmentIds || []).filter((attachmentId) => !fs.existsSync(attachmentPath(attachmentId)));
  const storeChecksum = sha256Hex(JSON.stringify(rows));
  const token = recyclePreviewSecret({ kind: "restore", recycleId: entry.id, entryChecksum: entry.checksum, storeChecksum, expiresAt: Date.now() + 10 * 60 * 1000 });
  return { previewToken: token, canRestore: !conflicts.length && !missingDependencies.length, conflicts, missingDependencies, missingAttachments, entry };
}

function recycleRestore(id, body) {
  const requestId = recycleRequestId(body && body.requestId), previous = recycleStoredResponse(requestId, "restore");
  if (previous) return previous;
  if (!body || body.confirmation !== "恢复数据") throw httpError(400, "请确认恢复数据。", true);
  const currentEntry = recycleGet(id);
  if (currentEntry.entityType === "student_archive") return recycleRestoreStudentArchive(currentEntry, body, requestId);
  const preview = recycleVerifyPreview(body.previewToken, "restore");
  if (preview.recycleId !== String(id)) throw httpError(400, "恢复预览与目标不一致。", true);
  const entry = currentEntry, adapter = recycleAdapter(entry.moduleKey, entry.entityType), rows = recycleArrayRows(adapter);
  if (entry.checksum !== preview.entryChecksum || sha256Hex(JSON.stringify(rows)) !== preview.storeChecksum) throw httpError(409, "数据在预览后发生变化，请重新检查恢复冲突。", true);
  const state = recycleRestoreState(adapter, rows, [entry]);
  if (state.conflicts.length) throw httpError(409, "相同编号的数据已经存在，不能覆盖恢复。", true);
  if (state.missingDependencies.length) throw httpError(409, "关联学生或上级记录已不存在，请先恢复依赖数据。", true);
  database.exec("BEGIN IMMEDIATE");
  try {
    const storeValue = recycleWriteArray(adapter, recycleRestoreRows(adapter, rows, [entry])), storeValues = { [adapter.storeKey]: storeValue }, linkedStudentValue = recycleRestoreLinkedStudentRows(adapter, [entry]);
    if (linkedStudentValue !== null) storeValues.nnuzc_students = linkedStudentValue;
    database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id);
    recycleAudit(entry.id, "restore", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId));
    const response = { ok: true, restored: true, id: entry.id, moduleKey: entry.moduleKey, entityId: entry.entityId, storeValues };
    recycleRememberRequest(requestId, "restore", response);
    database.exec("COMMIT");
    return response;
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function recycleRestoreTracked(id, body) {
  try { return recycleRestore(id, body); }
  catch (error) {
    try {
      const entry = recycleGet(id);
      database.prepare("UPDATE recycle_bin SET status='restore_failed' WHERE id=?").run(entry.id);
      recycleAudit(entry.id, "restore", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId), "failed", error && error.message || "恢复失败");
    } catch (_ignored) {}
    throw error;
  }
}

function recycleRestoreStudentArchive(entry, body, requestId) {
  const preview = recycleVerifyPreview(body.previewToken, "restore-student");
  if (preview.recycleId !== entry.id || preview.entryChecksum !== entry.checksum) throw httpError(409, "学生整档在预览后发生变化，请重新预览。", true);
  const state = studentArchiveConflict(entry);
  for (const key of STUDENT_ARCHIVE_KEYS) if (state.storeChecksums[key] !== preview.stores[key]) throw httpError(409, "学生关联数据在预览后发生变化，请重新检查恢复冲突。", true);
  if (state.conflicts.length) throw httpError(409, "学生或关联记录编号已经存在，不能覆盖恢复。", true);
  if (state.missingDependencies.length) throw httpError(409, "学生关联数据的基础资料或来源记录缺失，请先恢复对应数据。", true);
  const values = studentArchiveMerge(entry);
  database.exec("BEGIN IMMEDIATE");
  try {
    STUDENT_ARCHIVE_KEYS.forEach((key) => recycleWriteStoreValue(key, values[key]));
    database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id);
    recycleAudit(entry.id, "restore", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId));
    const response = { ok: true, restored: true, id: entry.id, moduleKey: entry.moduleKey, entityId: entry.entityId, storeValues: values, relationCount: Number(entry.relationCount || 0) };
    recycleRememberRequest(requestId, "restore", response);
    database.exec("COMMIT");
    return response;
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function recycleValidateBinIds(values, maximum = 500) {
  if (!Array.isArray(values) || !values.length || values.length > maximum) throw httpError(400, `请选择 1 至 ${maximum} 条回收站数据。`, true);
  const ids = values.map((value) => String(value || "").trim());
  if (ids.some((id) => !/^[a-f0-9-]{36}$/i.test(id)) || new Set(ids).size !== ids.length) throw httpError(400, "回收站数据编号无效或重复。", true);
  return ids;
}

function recycleBatchEntries(ids) {
  const rows = ids.map((id) => recycleGet(id));
  if (rows.length !== ids.length) throw httpError(404, "部分回收站数据已经不存在，请刷新后重试。", true);
  return rows;
}

function recycleRestoreBatchPreview(body) {
  const ids = recycleValidateBinIds(body && body.ids), entries = recycleBatchEntries(ids), groups = new Map(), conflicts = [], missingDependencies = [], missingAttachments = [];
  const packageEntries = entries.filter((entry) => entry.entityType === "student_archive");
  if (packageEntries.length) {
    if (packageEntries.length !== entries.length) return { previewToken: "", canRestore: false, count: entries.length, conflicts: [{ type: "BATCH_UNSUPPORTED", module: "学生整档与普通记录不能混合批量恢复", id: "mixed" }], missingDependencies, missingAttachments, items: entries.map((entry) => ({ id: entry.id, moduleKey: entry.moduleKey, moduleLabel: entry.moduleLabel, entityId: entry.entityId, title: entry.title })) };
    let stores = null;
    packageEntries.forEach((entry) => {
      const state = studentArchiveConflict(entry); stores = stores || state.storeChecksums;
      conflicts.push(...state.conflicts.map((item) => Object.assign({ recycleId: entry.id }, item)));
      missingDependencies.push(...state.missingDependencies.map((item) => Object.assign({ recycleId: entry.id }, item)));
      (entry.attachmentIds || []).forEach((attachmentId) => { if (!fs.existsSync(attachmentPath(attachmentId))) missingAttachments.push({ attachmentId, recycleId: entry.id }); });
    });
    const token = recyclePreviewSecret({ kind: "restore-batch", studentArchive: true, entries: entries.map((entry) => ({ id: entry.id, checksum: entry.checksum })), stores, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { previewToken: token, canRestore: !conflicts.length && !missingDependencies.length, count: entries.length, conflicts, missingDependencies, missingAttachments, items: entries.map((entry) => ({ id: entry.id, moduleKey: entry.moduleKey, moduleLabel: entry.moduleLabel, entityId: entry.entityId, title: entry.title })) };
  }
  entries.forEach((entry) => {
    const adapter = recycleAdapter(entry.moduleKey, entry.entityType), groupKey = `${adapter.storeKey}::${entry.moduleKey}`, state = groups.get(groupKey) || { adapter, storeKey: adapter.storeKey, rows: recycleArrayRows(adapter), entries: [] };
    state.entries.push(entry); groups.set(groupKey, state);
  });
  groups.forEach((state) => {
    const result = recycleRestoreState(state.adapter, state.rows, state.entries);
    conflicts.push(...result.conflicts); missingDependencies.push(...result.missingDependencies);
    state.entries.forEach((entry) => {
      (entry.attachmentIds || []).forEach((attachmentId) => { if (!fs.existsSync(attachmentPath(attachmentId))) missingAttachments.push({ attachmentId, recycleId: entry.id }); });
    });
  });
  const tokenPayload = {
    kind: "restore-batch",
    entries: entries.map((entry) => ({ id: entry.id, checksum: entry.checksum })),
    stores: Object.fromEntries([...groups.entries()].map(([key, state]) => [key, sha256Hex(JSON.stringify(state.rows))])),
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  return {
    previewToken: recyclePreviewSecret(tokenPayload), canRestore: !conflicts.length && !missingDependencies.length,
    count: entries.length, conflicts, missingDependencies, missingAttachments,
    items: entries.map((entry) => ({ id: entry.id, moduleKey: entry.moduleKey, moduleLabel: entry.moduleLabel, entityId: entry.entityId, title: entry.title }))
  };
}

function recycleRestoreBatch(body) {
  const requestId = recycleRequestId(body && body.requestId), previous = recycleStoredResponse(requestId, "restore-batch");
  if (previous) return previous;
  if (!body || body.confirmation !== "恢复数据") throw httpError(400, "请确认恢复数据。", true);
  const preview = recycleVerifyPreview(body.previewToken, "restore-batch"), ids = recycleValidateBinIds(preview.entries && preview.entries.map((item) => item.id));
  const entries = recycleBatchEntries(ids), expected = new Map(preview.entries.map((item) => [item.id, item.checksum])), groups = new Map();
  if (preview.studentArchive === true) {
    if (entries.some((entry) => entry.entityType !== "student_archive")) throw httpError(409, "批量恢复数据类型已经变化，请重新预览。", true);
    entries.forEach((entry) => { if (expected.get(entry.id) !== entry.checksum) throw httpError(409, "回收站数据在预览后发生变化，请重新预览。", true); const state = studentArchiveConflict(entry); if (state.conflicts.length || state.missingDependencies.length) throw httpError(409, "学生整档存在恢复冲突或依赖缺失，请重新预览。", true); });
    for (const key of STUDENT_ARCHIVE_KEYS) if (studentArchiveStoreChecksum(readStore(), key) !== preview.stores[key]) throw httpError(409, "学生关联数据在预览后发生变化，请重新检查恢复冲突。", true);
    let storeValues = {};
    database.exec("BEGIN IMMEDIATE");
    try {
      entries.forEach((entry) => { const values = studentArchiveMerge(entry); STUDENT_ARCHIVE_KEYS.forEach((key) => recycleWriteStoreValue(key, values[key])); storeValues = values; database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id); recycleAudit(entry.id, "restore-batch", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId)); });
      const response = { ok: true, restored: entries.length, ids, storeValues, studentArchive: true }; recycleRememberRequest(requestId, "restore-batch", response); database.exec("COMMIT"); return response;
    } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
  }
  entries.forEach((entry) => {
    if (expected.get(entry.id) !== entry.checksum) throw httpError(409, "回收站数据在预览后发生变化，请重新预览。", true);
    const adapter = recycleAdapter(entry.moduleKey, entry.entityType), groupKey = `${adapter.storeKey}::${entry.moduleKey}`, state = groups.get(groupKey) || { adapter, storeKey: adapter.storeKey, rows: recycleArrayRows(adapter), entries: [] };
    state.entries.push(entry); groups.set(groupKey, state);
  });
  groups.forEach((state, groupKey) => {
    if (preview.stores[groupKey] !== sha256Hex(JSON.stringify(state.rows))) throw httpError(409, "业务数据在预览后发生变化，请重新检查恢复冲突。", true);
    const result = recycleRestoreState(state.adapter, state.rows, state.entries);
    if (result.conflicts.length) throw httpError(409, "相同编号的数据已经存在，不能覆盖恢复。", true);
    if (result.missingDependencies.length) throw httpError(409, "部分记录的关联学生或上级记录已不存在，请先恢复依赖数据。", true);
  });
  const storeValues = {};
  database.exec("BEGIN IMMEDIATE");
  try {
    groups.forEach((state) => { const currentRows = recycleArrayRows(state.adapter); storeValues[state.storeKey] = recycleWriteArray(state.adapter, recycleRestoreRows(state.adapter, currentRows, state.entries)); const linkedStudentValue = recycleRestoreLinkedStudentRows(state.adapter, state.entries); if (linkedStudentValue !== null) storeValues.nnuzc_students = linkedStudentValue; });
    entries.forEach((entry) => {
      database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id);
      recycleAudit(entry.id, "restore-batch", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId));
    });
    const response = { ok: true, restored: entries.length, ids, storeValues };
    recycleRememberRequest(requestId, "restore-batch", response);
    database.exec("COMMIT");
    return response;
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function recycleRestoreBatchTracked(body) {
  try { return recycleRestoreBatch(body); }
  catch (error) {
    try {
      const preview = recycleVerifyPreview(body && body.previewToken, "restore-batch");
      const ids = recycleValidateBinIds((preview.entries || []).map((item) => item.id));
      recycleBatchEntries(ids).forEach((entry) => {
        database.prepare("UPDATE recycle_bin SET status='restore_failed' WHERE id=?").run(entry.id);
        recycleAudit(entry.id, "restore-batch", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId), "failed", error && error.message || "批量恢复失败");
      });
    } catch (_ignored) {}
    throw error;
  }
}

function recyclePurgeBatchPreview(body) {
  let ids;
  if (body && body.all === true) ids = database.prepare("SELECT id FROM recycle_bin WHERE status IN ('active','restore_failed') ORDER BY deleted_at DESC LIMIT 10000").all().map((row) => row.id);
  else ids = recycleValidateBinIds(body && body.ids, 10000);
  if (!ids.length) return { canPurge: false, count: 0, items: [] };
  const entries = recycleBatchEntries(ids), token = recyclePreviewSecret({ kind: "purge-batch", entries: entries.map((entry) => ({ id: entry.id, checksum: entry.checksum })), expiresAt: Date.now() + 10 * 60 * 1000 });
  return {
    canPurge: true, count: entries.length, previewToken: token,
    attachmentCount: new Set(entries.flatMap((entry) => entry.attachmentIds || [])).size,
    items: entries.slice(0, 20).map((entry) => ({ id: entry.id, moduleLabel: entry.moduleLabel, title: entry.title }))
  };
}

function recycleSetRetention(body) {
  const ids = recycleValidateBinIds(body && body.ids, 10000), permanent = body && body.permanent === true, days = Math.max(1, Math.min(3650, Number(body && body.days) || RECYCLE_RETENTION_DAYS));
  const entries = recycleBatchEntries(ids), expiresAt = permanent ? null : new Date(Date.now() + days * 86400000).toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const update = database.prepare("UPDATE recycle_bin SET expires_at=? WHERE id=?");
    entries.forEach((entry) => { update.run(expiresAt, entry.id); recycleAudit(entry.id, "retention", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId), "success", permanent ? "永久保留" : `保留 ${days} 天`); });
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
  return { ok: true, count: entries.length, ids, permanent, days: permanent ? null : days, expiresAt };
}

function recycleAuditList(url) {
  const limit = Math.max(20, Math.min(500, Number(url.searchParams.get("limit") || 100) || 100));
  return { items: database.prepare("SELECT recycle_id AS recycleId,action,module_key AS moduleKey,entity_type AS entityType,action_at AS actionAt,result,note FROM recycle_bin_audit ORDER BY id DESC LIMIT ?").all(limit) };
}

function recyclePurgeBatch(body) {
  const requestId = recycleRequestId(body && body.requestId), previous = recycleStoredResponse(requestId, "purge-batch");
  if (previous) return previous;
  if (!body || !["彻底删除", "清空回收站"].includes(body.confirmation)) throw httpError(400, "请输入正确的彻底删除确认文字。", true);
  const preview = recycleVerifyPreview(body.previewToken, "purge-batch"), ids = recycleValidateBinIds(preview.entries && preview.entries.map((item) => item.id), 10000);
  const entries = recycleBatchEntries(ids), expected = new Map(preview.entries.map((item) => [item.id, item.checksum]));
  entries.forEach((entry) => { if (expected.get(entry.id) !== entry.checksum) throw httpError(409, "部分回收站数据已变化，请刷新后重试。", true); });
  const attachmentIds = new Set(entries.flatMap((entry) => entry.attachmentIds || []));
  let response = { ok: true, purged: entries.length, ids, removedAttachments: 0, preservedAttachments: 0 };
  database.exec("BEGIN IMMEDIATE");
  try {
    entries.forEach((entry) => {
      recycleAudit(entry.id, "purge-batch", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId));
      database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id);
    });
    recycleRememberRequest(requestId, "purge-batch", response);
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
  attachmentIds.forEach((attachmentId) => {
    try { deleteAttachment(attachmentId); response.removedAttachments++; }
    catch (_error) { response.preservedAttachments++; }
  });
  database.prepare("UPDATE recycle_bin_requests SET response_json=? WHERE request_id=?").run(encryptText(JSON.stringify(response)), requestId);
  return response;
}

function recyclePurge(id, body) {
  const requestId = recycleRequestId(body && body.requestId), previous = recycleStoredResponse(requestId, "purge");
  if (previous) return previous;
  if (!body || body.confirmation !== "彻底删除") throw httpError(400, "请输入“彻底删除”确认。", true);
  const entry = recycleGet(id);
  if (body.checksum !== entry.checksum) throw httpError(409, "回收站数据已变化，请刷新后重试。", true);
  database.exec("BEGIN IMMEDIATE");
  let response;
  try {
    database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id);
    recycleAudit(entry.id, "purge", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId));
    response = { ok: true, purged: true, id: entry.id, removedAttachments: 0, preservedAttachments: 0 };
    recycleRememberRequest(requestId, "purge", response);
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
  (entry.attachmentIds || []).forEach((attachmentId) => {
    try { deleteAttachment(attachmentId); response.removedAttachments++; }
    catch (_error) { response.preservedAttachments++; }
  });
  database.prepare("UPDATE recycle_bin_requests SET response_json=? WHERE request_id=?").run(encryptText(JSON.stringify(response)), requestId);
  return response;
}

function recyclePurgeExpired(nowValue = Date.now()) {
  const expired = database.prepare("SELECT id FROM recycle_bin WHERE status IN ('active','restore_failed') AND expires_at IS NOT NULL AND expires_at<>'' AND expires_at<=?").all(new Date(nowValue).toISOString());
  let count = 0;
  expired.forEach((row) => {
    let entry;
    try { entry = recycleGet(row.id); } catch (_error) { return; }
    database.exec("BEGIN IMMEDIATE");
    try {
      recycleAudit(entry.id, "expire", entry.moduleKey, entry.entityType, recycleLookup(entry.moduleKey, entry.entityId), "success", "超过90天保留期自动清理");
      database.prepare("DELETE FROM recycle_bin WHERE id=?").run(entry.id);
      database.exec("COMMIT");
    } catch (_error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} return; }
    (entry.attachmentIds || []).forEach((attachmentId) => { try { deleteAttachment(attachmentId); } catch (_error) {} });
    count++;
  });
  return count;
}

function brandingLogoInfo(logoData) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(logoData || ""));
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > BRANDING_MAX_LOGO_BYTES) return null;
  return { data, mime: match[1].toLowerCase() };
}

function readBrandingConfig() {
  const fallback = { name: BRANDING_DEFAULT_NAME, sidebarLogoData: "", loginLogoData: "", updatedAt: "" };
  try {
    const row = database.prepare("SELECT value FROM legacy_ui_store WHERE key=?").get(BRANDING_STORE_KEY);
    if (!row) return fallback;
    const stored = JSON.parse(decryptText(row.value));
    const name = typeof stored.name === "string" ? stored.name.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 40) : "";
    /* 兼容此前仅有一个 Logo 的设置：升级后先同时用于两处，直到用户分别替换。 */
    const legacyLogoData = brandingLogoInfo(stored.logoData) ? stored.logoData : "";
    const sidebarLogoData = brandingLogoInfo(stored.sidebarLogoData) ? stored.sidebarLogoData : legacyLogoData;
    const loginLogoData = brandingLogoInfo(stored.loginLogoData) ? stored.loginLogoData : legacyLogoData;
    return { name: name || BRANDING_DEFAULT_NAME, sidebarLogoData, loginLogoData, updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : "" };
  } catch (_error) { return fallback; }
}

function brandingPublicConfig() {
  const config = readBrandingConfig();
  return {
    name: config.name,
    hasCustomLogo: !!(config.sidebarLogoData || config.loginLogoData),
    hasCustomSidebarLogo: !!config.sidebarLogoData,
    hasCustomLoginLogo: !!config.loginLogoData,
    sidebarLogoUrl: config.sidebarLogoData ? "/assets/branding-logo?target=sidebar&rev=" + encodeURIComponent(config.updatedAt || "current") : "/assets/login-logo-icon.png",
    loginLogoUrl: config.loginLogoData ? "/assets/branding-logo?target=login&rev=" + encodeURIComponent(config.updatedAt || "current") : "/assets/login-logo.png",
    /* 兼容旧页面；新页面应分别读取 sidebarLogoUrl 和 loginLogoUrl。 */
    logoUrl: config.loginLogoData ? "/assets/branding-logo?target=login&rev=" + encodeURIComponent(config.updatedAt || "current") : "/assets/login-logo.png"
  };
}

function saveBrandingConfig(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "品牌设置格式无效。");
  const current = readBrandingConfig();
  const name = String(body.name == null ? current.name : body.name).trim().replace(/[\u0000-\u001f]/g, "");
  if (!name || name.length > 40) throw httpError(400, "工作台名称需为 1 到 40 个字符。");
  let sidebarLogoData = current.sidebarLogoData, loginLogoData = current.loginLogoData;
  if (body.clearSidebarLogo === true) sidebarLogoData = "";
  if (body.clearLoginLogo === true) loginLogoData = "";
  /* 兼容旧请求：原来的单 Logo 请求会同时更新两处。 */
  if (body.clearLogo === true) { sidebarLogoData = ""; loginLogoData = ""; }
  for (const [field, label] of [["sidebarLogoData", "工作台 Logo"], ["loginLogoData", "登录页 Logo"], ["logoData", "Logo"]]) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = String(body[field] || "").trim();
    if (value && !brandingLogoInfo(value)) throw httpError(400, `${label}仅支持 PNG、JPG 或 WebP，且不能超过 2MB。`);
    if (field === "sidebarLogoData") sidebarLogoData = value;
    else if (field === "loginLogoData") loginLogoData = value;
    else { sidebarLogoData = value; loginLogoData = value; }
  }
  const next = { name, sidebarLogoData, loginLogoData, updatedAt: new Date().toISOString() };
  database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(BRANDING_STORE_KEY, encryptText(JSON.stringify(next)));
  return brandingPublicConfig();
}

function brandedPwaManifest() {
  const branding = brandingPublicConfig();
  return Object.assign({}, PWA_MANIFEST, { name: branding.name, short_name: branding.name.slice(0, 12), description: branding.name + " · 辅导员学生工作管理平台（本机部署）" });
}

const CORE_STORE_KEYS = new Set([
  "nnuzc_orgs", "nnuzc_term_list", "nnuzc_current_term", "nnuzc_students", "nnuzc_meetings",
  "nnuzc_talks", "nnuzc_home", "nnuzc_punishments", "nnuzc_fund_records", "nnuzc_dorm_dist",
  "nnuzc_academic_terms", "nnuzc_academic_warnings", "nnuzc_dorm"
]);
const DEMO_STATE_META_KEY = "demo_data_state_v1";
/* 只盘点真实业务台账；主题、页签、接口配置、授权信息等系统设置既不覆盖，也不参与演示数据判定。 */
const DEMO_BUSINESS_KEYS = new Set([
  "nnuzc_orgs", "nnuzc_term_list", "nnuzc_current_term", "nnuzc_term_settings", "nnuzc_students",
  "nnuzc_meetings", "nnuzc_talks", "nnuzc_home", "nnuzc_events", "nnuzc_checkclass", "nnuzc_checkdorm",
  "nnuzc_help", "nnuzc_course_schedules", "nnuzc_workfolder", "nnuzc_tasks", "nnuzc_keycare",
  "nnuzc_punishments", "nnuzc_dorm_dist", "nnuzc_dorm", "nnuzc_dorm_spatial_v1", "nnuzc_fund_records", "nnuzc_fund_terms",
  "nnuzc_student_leaves", "nnuzc_student_loan_records",
  "nnuzc_academic_terms", "nnuzc_academic_warnings", "nnuzc_grade_terms", "nnuzc_employment",
  "nnuzc_employment_intentions", "nnuzc_employment_resources", "nnuzc_achievement_records", "nnuzc_awards",
  "nnuzc_award_statistics_records", "nnuzc_certificate_records", "nnuzc_other_violation_records",
  "nnuzc_complaints", "nnuzc_crossdept", "nnuzc_ai_drafts", "nnuzc_custom_roster_v1",
  "nnuzc_counselor_profile_v1", "nnuzc_counselor_growth_records_v1", "nnuzc_counselor_growth_settings_v1", "nnuzc_counselor_growth_history_v1",
  "nnuzc_student_org_v1", "nnuzc_subject_competition_resources"
]);
/* 首次打开工作台会自动写入以下就业资源目录。它们属于系统参考资料，不是用户业务数据；
 * 只有新增、删除或修改目录内容时，才作为需要保护的真实数据阻止载入演示数据。 */
const BUILTIN_EMPLOYMENT_RESOURCES = [
  {id:"career-ncss",title:"国家大学生就业服务平台",region:"全国",industry:"综合就业服务",organizer:"教育部",url:"https://www.ncss.cn/",verifiedAt:"",status:"待核验",note:"参考就业资源目录预置"},
  {id:"career-24365",title:"24365校园招聘服务",region:"全国",industry:"校园招聘",organizer:"教育部",url:"https://24365.smartedu.cn/",verifiedAt:"",status:"待核验",note:"参考就业资源目录预置"},
  {id:"career-mohrss",title:"高校毕业生就业服务平台",region:"全国",industry:"公共就业服务",organizer:"人力资源和社会保障部",url:"https://job.mohrss.gov.cn/202008gx/index.jhtml",verifiedAt:"",status:"待核验",note:"参考就业资源目录预置"},
  {id:"career-jobonline",title:"就业在线",region:"全国",industry:"公共就业服务",organizer:"公共就业服务平台",url:"https://www.jobonline.cn/",verifiedAt:"",status:"待核验",note:"参考就业资源目录预置"},
  {id:"career-iguopin",title:"国聘招聘平台",region:"全国",industry:"国企与综合招聘",organizer:"国聘",url:"https://www.iguopin.com/",verifiedAt:"",status:"待核验",note:"参考就业资源目录预置"},
  {id:"career-newjobs",title:"中国国家人才网",region:"全国",industry:"人才服务",organizer:"中国国家人才网",url:"https://www.newjobs.com.cn/",verifiedAt:"",status:"待核验",note:"参考就业资源目录预置"}
];
const BUILTIN_EMPLOYMENT_RESOURCE_FIELDS = ["id","title","region","industry","organizer","url","verifiedAt","status","note"];

function parseJson(value, label) {
  try { return JSON.parse(value); } catch (_error) { throw new Error(`${label}不是有效 JSON 数据。`); }
}

function arrayValue(value, label) {
  const data = parseJson(value, label);
  if (!Array.isArray(data)) throw new Error(`${label}必须是数组。`);
  return data;
}

function stringValue(value, label) {
  if (typeof value !== "string") throw new Error(`${label}必须是字符串。`);
  try { const parsed = JSON.parse(value); return typeof parsed === "string" ? parsed : value; } catch (_error) { return value; }
}

function recordId(record, prefix, index) {
  const id = record && record.id !== undefined && record.id !== null && String(record.id).trim();
  return id || `${prefix}-${crypto.randomUUID()}-${index}`;
}

function replaceRows(table, rows, mapper) {
  validateTable(table);
  database.prepare(`DELETE FROM ${table}`).run();
  const insert = database.prepare(mapper.sql);
  rows.forEach((row, index) => insert.run(...mapper.values(row, index)));
}

function writeCoreKey(key, value, action = "sync", options = {}) {
  if (!CORE_STORE_KEYS.has(key)) return false;
  const manageTransaction = options.transaction !== false;
  if (manageTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    if (key === "nnuzc_orgs") {
      const orgs = parseJson(value, "基础数据");
      if (orgs.levels !== undefined) {
        if (!Array.isArray(orgs.levels)) throw httpError(400, "培养层次字典必须是列表。", true);
        const levelNames = new Set();
        orgs.levels = orgs.levels.map(row => {
          if (!row || typeof row.name !== "string" || !row.name.trim()) throw httpError(400, "培养层次名称不能为空。", true);
          const name = row.name.trim();
          if (levelNames.has(name)) throw httpError(400, "培养层次名称不能重复。", true);
          levelNames.add(name);
          return Object.assign({}, row, { name });
        });
      }
      const departments = Array.isArray(orgs.depts) ? orgs.depts : [];
      const majors = Array.isArray(orgs.majors) ? orgs.majors : [];
      const classes = Array.isArray(orgs.classes) ? orgs.classes : [];
      const names = new Set();
      departments.forEach((row) => { if (!row || !String(row.name || "").trim() || names.has(String(row.name).trim())) throw new Error("学院名称不能为空且不可重复。"); names.add(String(row.name).trim()); });
      const majorNames = new Set(), majorDepartments = new Map();
      majors.forEach((row) => { const name = String(row?.name || "").trim(), department = String(row?.dept || "").trim(); if (!name || !department || !names.has(department) || majorNames.has(name)) throw new Error("专业必须关联已存在的学院，且名称不可重复。"); majorNames.add(name); majorDepartments.set(name, department); });
      classes.forEach((row) => { const name = String(row?.name || "").trim(), department = String(row?.dept || "").trim(), major = String(row?.major || "").trim(); if (!name || !names.has(department) || !majorNames.has(major) || majorDepartments.get(major) !== department) throw new Error("班级的学院必须与所属专业一致。"); });
      database.prepare("DELETE FROM class_groups").run(); database.prepare("DELETE FROM majors").run(); database.prepare("DELETE FROM departments").run();
      const addDept = database.prepare("INSERT INTO departments(name,code,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)");
      departments.forEach((row) => addDept.run(String(row.name).trim(), String(row.code || "")));
      const addMajor = database.prepare("INSERT INTO majors(name,code,department_name,years,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)");
      majors.forEach((row) => addMajor.run(String(row.name).trim(), String(row.code || ""), String(row.dept).trim(), String(row.years || "")));
      const addClass = database.prepare("INSERT INTO class_groups(name,department_name,major_name,grade,counselor,teacher,level,enroll_type,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)");
      classes.forEach((row) => addClass.run(String(row.name).trim(), String(row.dept).trim(), String(row.major).trim(), String(row.grade || ""), encryptText(String(row.counselor || "")), encryptText(String(row.teacher || "")), String(row.level || ""), String(row.enrollType || "")));
      /* 年级 / 宿舍楼 / 招生类别 不进规范化表，单独加密落库，避免重新打开浏览器后丢失 */
      const orgAux = {
        grades: Array.isArray(orgs.grades) ? orgs.grades : [],
        dorms: Array.isArray(orgs.dorms) ? orgs.dorms : [],
        enrollTypes: Array.isArray(orgs.enrollTypes) ? orgs.enrollTypes : [],
        ...(Array.isArray(orgs.levels) ? { levels: orgs.levels } : {})
      };
      database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES('nnuzc_orgs_extra',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(encryptText(JSON.stringify(orgAux)));
    } else if (key === "nnuzc_term_list") {
      const terms = arrayValue(value, "学期列表"); const unique = new Set();
      terms.forEach((term) => { if (typeof term !== "string" || !/^\d{4}-\d{4}-[1-9]学期$/.test(term) || unique.has(term)) throw new Error("学期列表包含无效或重复学期。"); unique.add(term); });
      terms.sort((a,b)=>b.localeCompare(a,"zh-CN",{numeric:true}));
      const current = database.prepare("SELECT name FROM terms WHERE is_current=1").get()?.name || "";
      database.prepare("DELETE FROM terms").run(); const add = database.prepare("INSERT INTO terms(name,sort_order,is_current) VALUES (?,?,?)");
      terms.forEach((term, index) => add.run(term, index, term === current ? 1 : 0));
    } else if (key === "nnuzc_current_term") {
      let current = stringValue(value, "当前学期");
      if (current && !database.prepare("SELECT 1 FROM terms WHERE name=?").get(current)) {
        if (action === "legacy_migration") current = "";
        else throw new Error("当前学期必须先在学期列表中维护。");
      }
      database.prepare("UPDATE terms SET is_current=0").run(); if (current) database.prepare("UPDATE terms SET is_current=1 WHERE name=?").run(current);
    } else if (key === "nnuzc_students") {
      /* 安全护栏：防止前端异常（如 localStorage 配额失败导致只持有部分数据）把服务端学生整体清空。
         仅在常规同步（action==="sync"）时检查；legacy_migration 与 force 跳过。 */
      if (action === "sync") {
        const GUARD_RATIO = 0.5;
        const existingCount = Number(database.prepare("SELECT COUNT(*) AS c FROM students").get().c || 0);
        let incomingPreview = -1;
        try { const arr = JSON.parse(value || "[]"); if (Array.isArray(arr)) incomingPreview = arr.length; } catch (_e) { incomingPreview = -1; }
        if (existingCount > 0 && incomingPreview >= 0 && incomingPreview < Math.ceil(existingCount * GUARD_RATIO)) {
          const err = new Error(`安全拦截：本次同步学生数为 ${incomingPreview} 条，明显少于服务端现有的 ${existingCount} 条（低于 ${GUARD_RATIO * 100}%）。已拒绝本次覆盖，避免误清空。如确要大量删除，请先在【数据备份】模块备份，再确认强制覆盖。`);
          err.code = "STUDENTS_DROP_GUARD";
          err.guard = { existing: existingCount, incoming: incomingPreview };
          throw err;
        }
      }
      const rows = arrayValue(value, "学生信息"); const ids = new Set();
      rows.forEach((row) => { if (row && typeof row === "object") { delete row.remark1; delete row.remark2; delete row.customFields; fillStudentIdentityBlanks(row); } });
      const departments = new Set(database.prepare("SELECT name FROM departments").all().map((row) => row.name));
      const majorDepartments = new Map(database.prepare("SELECT name,department_name FROM majors").all().map((row) => [row.name, row.department_name]));
      const classes = new Map(database.prepare("SELECT name,department_name,major_name FROM class_groups").all().map((row) => [row.name, row]));
      rows.forEach((row) => { const id=String(row?.id || "").trim(), department=String(row?.dept || "").trim(), major=String(row?.major || "").trim(), className=String(row?.cls || "").trim(); if (!id || !String(row?.name || "").trim() || ids.has(id)) throw new Error("学生学号不能为空、姓名不能为空且学号不可重复。"); if (!department || !major || !departments.has(department) || majorDepartments.get(major) !== department) throw new Error(`学生 ${id} 的学院或专业基础数据不存在或关联不一致。`); if (className) { const classRow=classes.get(className); if (!classRow || classRow.department_name !== department || classRow.major_name !== major) throw new Error(`学生 ${id} 的班级不存在或与学院、专业不一致。`); } ids.add(id); });
      replaceRows("students", rows, { sql:"INSERT INTO students(student_id,name,department_name,major_name,class_name,grade,status,data_json,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)", values:(row)=>{ const data=Object.assign({},row); delete data.party; delete data.classroom; delete data.dorm; return [protectedStudentId(String(row.id).trim()),encryptText(String(row.name).trim()),String(row.dept||""),String(row.major||""),String(row.cls||""),String(row.grade||""),String(row.status||"在校"),protectedJson(data)]; } });
      const addProfile=database.prepare("INSERT INTO party_profiles(student_id,stage,league_status,data_json,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)");
      const addHistory=database.prepare("INSERT INTO party_history(record_id,student_id,stage,record_date,data_json,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)");
      const addClassroom=database.prepare("INSERT INTO classroom_records(record_id,student_id,term_name,record_date,data_json,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)");
      const addDorm=database.prepare("INSERT INTO student_dorm_records(record_id,student_id,term_name,record_date,data_json,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)");
      rows.forEach((row) => { const actualId=String(row.id).trim(),sid=protectedStudentId(actualId); const party=row.party&&typeof row.party==="object" ? row.party : null; if(party){ addProfile.run(sid,String(party.stage||"群众"),String(party.leagueStatus||"非团员"),protectedJson(Object.assign({},party,{history:undefined}))); const history=Array.isArray(party.history)?party.history:[]; history.forEach((entry,index)=>addHistory.run(protectedRecordId("party",recordId(entry,`party-${actualId}`,index)),sid,String(entry.stage||party.stage||"群众"),String(entry.date||""),protectedJson(entry))); } const classroom=Array.isArray(row.classroom)?row.classroom:[]; classroom.forEach((entry,index)=>addClassroom.run(protectedRecordId("classroom",recordId(entry,`classroom-${actualId}`,index)),sid,String(entry.term||""),String(entry.date||""),protectedJson(entry))); const dorm=Array.isArray(row.dorm)?row.dorm:[]; dorm.forEach((entry,index)=>addDorm.run(protectedRecordId("student-dorm",recordId(entry,`dorm-${actualId}`,index)),sid,String(entry.term||""),String(entry.date||""),protectedJson(entry))); });
    } else if (key === "nnuzc_meetings") {
      const rows = arrayValue(value, "班会/活动"); const ids = new Set();
      rows.forEach((row,index) => { const id=recordId(row,"meeting",index); if(ids.has(id)) throw new Error("班会/活动记录编号重复。"); ids.add(id); row.id=id; });
      replaceRows("meetings", rows, { sql:"INSERT INTO meetings(id,term_name,class_name,department_name,major_name,grade,topic,meeting_date,data_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)", values:(row)=>[protectedRecordId("meeting",String(row.id)),String(row.term||""),String(row.cls||""),String(row.dept||""),String(row.major||""),String(row.grade||""),encryptText(String(row.topic||row.title||"")),String(row.date||""),protectedJson(row)] });
    } else if (key === "nnuzc_dorm") {
      const state = parseJson(value, "宿舍模块状态");
      if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("宿舍模块状态必须是对象。");
      database.prepare("INSERT INTO dorm_module_state(id,state_json,updated_at) VALUES (1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at").run(protectedJson(state));
    } else if (["nnuzc_talks","nnuzc_home","nnuzc_punishments","nnuzc_fund_records","nnuzc_dorm_dist"].includes(key)) {
      const rows = arrayValue(value, key); const config = {
        nnuzc_talks:["talk_records","talk"], nnuzc_home:["home_contacts","home"], nnuzc_punishments:["punishment_records","punishment"], nnuzc_fund_records:["fund_records","fund"], nnuzc_dorm_dist:["dorm_distribution_records","dorm"]
      }[key];
      const studentIds = new Set(database.prepare("SELECT student_id FROM students").all().map((row) => row.student_id));
      const ids = new Set(); rows.forEach((row,index)=>{const id=recordId(row,config[1],index), studentId=String(row?.studentId||row?.sid||row?.idNo||((key==="nnuzc_fund_records"||key==="nnuzc_dorm_dist")?row?.id:"")||"").trim();if(ids.has(id))throw new Error(`${key}记录编号重复。`);if(!studentId || !studentIds.has(protectedStudentId(studentId)))throw new Error(`${key}存在找不到的学生学号：${studentId||"（空）"}。`);ids.add(id);row.id=id;});
      const sql = config[0] === "talk_records" || config[0] === "home_contacts" ? `INSERT INTO ${config[0]}(id,student_id,term_name,record_date,data_json,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)` : config[0] === "punishment_records" ? "INSERT INTO punishment_records(id,student_id,term_name,punishment_type,record_date,data_json,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)" : config[0] === "fund_records" ? "INSERT INTO fund_records(id,student_id,term_name,data_json,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)" : "INSERT INTO dorm_distribution_records(id,student_id,data_json,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)";
      replaceRows(config[0], rows, { sql, values:(row)=> config[0] === "talk_records" || config[0] === "home_contacts" ? [protectedRecordId(config[1],String(row.id)),protectedStudentId(String(row.studentId||row.sid||row.idNo||"")),String(row.term||""),String(row.date||""),protectedJson(row)] : config[0] === "punishment_records" ? [protectedRecordId("punishment",String(row.id)),protectedStudentId(String(row.studentId||"")),String(row.term||""),String(row.type||""),String(row.date||""),protectedJson(row)] : config[0] === "fund_records" ? [protectedRecordId("fund",String(row.id)),protectedStudentId(String(row.studentId||row.idNo||row.id||"")),String(row.term||""),protectedJson(row)] : [protectedRecordId("dorm-distribution",String(row.id)),protectedStudentId(String(row.studentId||row.idNo||row.id||"")),protectedJson(row)] });
    } else {
      const moduleName = key === "nnuzc_academic_terms" ? "academic_terms" : "academic_warnings";
      const rows = arrayValue(value, moduleName); const ids = new Set(); rows.forEach((row,index)=>{const id=String(row?.id ?? `${moduleName}-${index}`);if(ids.has(id))throw new Error("学期台账编号重复。");ids.add(id);row.id=row.id ?? id;});
      rows.sort((a,b)=>String(b?.term||"").localeCompare(String(a?.term||""),"zh-CN",{numeric:true}));
      database.prepare("DELETE FROM academic_term_records WHERE module_name=?").run(moduleName);
      const add=database.prepare("INSERT INTO academic_term_records(module_name,term_id,term_name,data_json,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)"); rows.forEach((row)=>add.run(moduleName,String(row.id),String(row.term||""),protectedJson(row)));
    }
    database.prepare("DELETE FROM legacy_ui_store WHERE key=?").run(key);
    if (manageTransaction) database.exec("COMMIT");
    return true;
  } catch (error) { if (manageTransaction) { try { database.exec("ROLLBACK"); } catch (_ignored) {} } throw error; }
}

function deleteCoreKey(key, options = {}) {
  if (!CORE_STORE_KEYS.has(key)) return false;
  const tables = { nnuzc_orgs:["class_groups","majors","departments"], nnuzc_students:["students"], nnuzc_meetings:["meetings"], nnuzc_talks:["talk_records"], nnuzc_home:["home_contacts"], nnuzc_punishments:["punishment_records"], nnuzc_fund_records:["fund_records"], nnuzc_dorm_dist:["dorm_distribution_records"], nnuzc_dorm:["dorm_module_state"] };
  const manageTransaction = options.transaction !== false;
  if (manageTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    if (key === "nnuzc_orgs") {
      /* 学院、专业、班级在规范化表中，年级、宿舍楼、招生类别在辅助键中。
         两部分必须一起删除；否则清除演示数据后辅助键会被误判成真实数据。 */
      database.prepare("DELETE FROM legacy_ui_store WHERE key='nnuzc_orgs_extra'").run();
    }
    if (key === "nnuzc_term_list") database.prepare("DELETE FROM terms").run();
    else if (key === "nnuzc_current_term") database.prepare("UPDATE terms SET is_current=0").run();
    else if (key === "nnuzc_academic_terms" || key === "nnuzc_academic_warnings") database.prepare("DELETE FROM academic_term_records WHERE module_name=?").run(key === "nnuzc_academic_terms" ? "academic_terms" : "academic_warnings");
    else (tables[key] || []).forEach((t) => { validateTable(t); database.prepare(`DELETE FROM ${t}`).run(); });
    database.prepare("DELETE FROM legacy_ui_store WHERE key=?").run(key); if (manageTransaction) database.exec("COMMIT"); return true;
  } catch (error) { if (manageTransaction) { try { database.exec("ROLLBACK"); } catch (_ignored) {} } throw error; }
}

function demoHash(value) {
  return crypto.createHash("sha256").update(String(value === undefined ? "<missing>" : value)).digest("hex");
}

function demoParseStoreValue(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  try { return JSON.parse(value); } catch (_error) { return String(value); }
}

function demoValueHasBusinessData(key, value) {
  const parsed = demoParseStoreValue(value);
  if (parsed === null || parsed === "") return false;
  if (Array.isArray(parsed)) {
    if (!parsed.length) return false;
    /* 首次打开页面自动写入的内置参考目录不视为用户真实数据；用户新增或修改条目仍会被识别。 */
    if (key === "nnuzc_subject_competition_resources") return parsed.some((row) => !(/^cahe-2024-\d{3}$/.test(String(row && row.id || "")) || String(row && row.id || "") === "moe-national-career-planning-competition"));
    if (key === "nnuzc_employment_resources") {
      if (parsed.length !== BUILTIN_EMPLOYMENT_RESOURCES.length) return true;
      const actual = new Map(parsed.map((row) => [String(row && row.id || ""), row]));
      return BUILTIN_EMPLOYMENT_RESOURCES.some((expected) => {
        const row = actual.get(expected.id);
        return !row || BUILTIN_EMPLOYMENT_RESOURCE_FIELDS.some((field) => String(row[field] ?? "") !== String(expected[field] ?? ""));
      });
    }
    return true;
  }
  if (typeof parsed === "object") {
    if (key === "nnuzc_dorm_spatial_v1") {
      const collections = ["buildings","rooms","assignments","leaders","bedNotes","audit"];
      if (collections.some((name) => Array.isArray(parsed[name]) && parsed[name].length > 0)) return true;
      const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
      if (Number(settings.defaultBedCount ?? 4) !== 4 || Number(settings.maxBedCount ?? 30) !== 30) return true;
      const metadata = new Set(["schemaVersion","settings","buildings","rooms","assignments","leaders","bedNotes","audit","migrations","version","meta","__demo"]);
      return Object.keys(parsed).some((name) => !metadata.has(name) && parsed[name] !== "" && parsed[name] !== null && parsed[name] !== undefined && parsed[name] !== false);
    }
    const keys = Object.keys(parsed).filter((name) => name !== "version" && name !== "meta" && name !== "__demo");
    if (!keys.length) return false;
    return keys.some((name) => {
      const item = parsed[name];
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === "object") return Object.keys(item).length > 0;
      return item !== "" && item !== null && item !== undefined && item !== false && item !== 0;
    });
  }
  return Boolean(parsed);
}

function demoAttachmentCount() {
  try { return fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }).filter((entry) => entry.isFile()).length; }
  catch (_error) { return 0; }
}

function demoBusinessEvidence(store = readStore()) {
  const keys = [...DEMO_BUSINESS_KEYS].filter((key) => demoValueHasBusinessData(key, store[key]));
  const attachmentCount = demoAttachmentCount();
  return { hasRealData: keys.length > 0 || attachmentCount > 0, keyCount: keys.length, attachmentCount };
}

function repairLegacyDemoOrgAuxResidue() {
  /* V3.3.0 早期版本清除演示数据时遗漏了 nnuzc_orgs_extra。仅当：
     1) 没有活动演示状态；2) 学院/专业/班级表为空；3) 其他业务数据和附件为空；
     4) 辅助键与内置演示数据完全一致，才执行一次兼容清理。 */
  if (loadDemoState()) return false;
  const structuralCount = ["departments", "majors", "class_groups"]
    .reduce((total, table) => total + Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0), 0);
  if (structuralCount > 0) return false;
  const row = database.prepare("SELECT value FROM legacy_ui_store WHERE key='nnuzc_orgs_extra'").get();
  if (!row || !row.value) return false;
  let currentAux;
  let expectedAux;
  try {
    currentAux = JSON.parse(decryptText(row.value));
    const demoOrgs = JSON.parse(buildDemoStore().nnuzc_orgs);
    expectedAux = {
      grades: Array.isArray(demoOrgs.grades) ? demoOrgs.grades : [],
      dorms: Array.isArray(demoOrgs.dorms) ? demoOrgs.dorms : [],
      enrollTypes: Array.isArray(demoOrgs.enrollTypes) ? demoOrgs.enrollTypes : []
    };
  } catch (_error) { return false; }
  if (demoHash(JSON.stringify(currentAux)) !== demoHash(JSON.stringify(expectedAux))) return false;
  const remainingStore = readStore();
  delete remainingStore.nnuzc_orgs;
  if (demoBusinessEvidence(remainingStore).hasRealData) return false;
  database.prepare("DELETE FROM legacy_ui_store WHERE key='nnuzc_orgs_extra'").run();
  return true;
}

function loadDemoState() {
  const row = database.prepare("SELECT value FROM migration_meta WHERE key=?").get(DEMO_STATE_META_KEY);
  if (!row || !row.value) return null;
  try {
    const state = JSON.parse(row.value);
    return state && state.active === true && state.version === 1 ? state : null;
  } catch (_error) { return null; }
}

function saveDemoState(state) {
  database.prepare("INSERT INTO migration_meta(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(DEMO_STATE_META_KEY, JSON.stringify(state));
}

function demoStatus() {
  repairLegacyDemoOrgAuxResidue();
  const state = loadDemoState();
  if (state) return { active: true, canLoad: false, loadedAt: state.loadedAt, keyCount: state.keys.length, recordCount: state.recordCount || 0, message: "当前为演示数据模式，不能新增、编辑、删除、导入或恢复真实数据。" };
  const evidence = demoBusinessEvidence();
  return { active: false, canLoad: !evidence.hasRealData, hasRealData: evidence.hasRealData, businessKeyCount: evidence.keyCount, attachmentCount: evidence.attachmentCount, message: evidence.hasRealData ? "系统已存在真实数据，不能载入或清除演示数据。" : "当前业务库为空，可以载入演示数据。" };
}

function demoRecordCount(store) {
  let count = 0;
  Object.values(store).forEach((value) => {
    const parsed = demoParseStoreValue(value);
    if (Array.isArray(parsed)) count += parsed.length;
    else if (parsed && typeof parsed === "object") count += 1;
  });
  return count;
}

function loadDemoData() {
  repairLegacyDemoOrgAuxResidue();
  if (loadDemoState()) {
    const error = httpError(409, "演示数据已经载入，无需重复载入。"); error.code = "DEMO_ALREADY_ACTIVE"; throw error;
  }
  const beforeStore = readStore();
  const evidence = demoBusinessEvidence(beforeStore);
  if (evidence.hasRealData) {
    const error = httpError(409, "系统已存在真实数据，为保护现有数据，不能载入演示数据。"); error.code = "REAL_DATA_PRESENT"; throw error;
  }
  const demoStore = buildDemoStore();
  const baseline = {};
  Object.keys(demoStore).forEach((key) => { baseline[key] = Object.prototype.hasOwnProperty.call(beforeStore, key) ? beforeStore[key] : null; });
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const key of MERGE_CORE_KEY_ORDER) if (Object.prototype.hasOwnProperty.call(demoStore, key)) writeCoreKey(key, demoStore[key], "demo_load", { transaction: false });
    const upsert = database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
    for (const [key, value] of Object.entries(demoStore)) if (!CORE_STORE_KEYS.has(key)) upsert.run(key, encryptText(value));
    const current = readStore();
    const expected = {};
    Object.keys(demoStore).forEach((key) => { expected[key] = demoHash(current[key]); });
    const state = { version: 1, active: true, loadedAt: new Date().toISOString(), keys: Object.keys(demoStore), baseline, expected, recordCount: demoRecordCount(demoStore) };
    saveDemoState(state);
    database.exec("COMMIT");
    return { ok: true, status: demoStatus() };
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function clearDemoData() {
  const state = loadDemoState();
  if (!state) {
    const evidence = demoBusinessEvidence();
    const error = httpError(409, evidence.hasRealData ? "系统存在真实数据，不能使用清除演示数据功能。" : "当前未载入演示数据，无需清除。");
    error.code = evidence.hasRealData ? "REAL_DATA_PRESENT" : "NO_DEMO_DATA";
    throw error;
  }
  const current = readStore();
  const changed = state.keys.filter((key) => demoHash(current[key]) !== state.expected[key]);
  if (changed.length) {
    const error = httpError(409, "检测到演示数据与载入清单不一致，已停止清除，避免误删数据。请先通过数据备份核查。");
    error.code = "DEMO_DATA_CHANGED"; error.changedKeyCount = changed.length; throw error;
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    /* 先移除引用学生和基础数据的演示台账，再按载入前快照恢复空值；全程同一事务。 */
    const reverseCoreOrder = ["nnuzc_academic_warnings", "nnuzc_academic_terms", "nnuzc_dorm_dist", "nnuzc_fund_records", "nnuzc_punishments", "nnuzc_home", "nnuzc_talks", "nnuzc_meetings", "nnuzc_dorm", "nnuzc_students", "nnuzc_current_term", "nnuzc_term_list", "nnuzc_orgs"];
    reverseCoreOrder.forEach((key) => { if (state.keys.includes(key)) deleteCoreKey(key, { transaction: false }); });
    state.keys.forEach((key) => { if (!CORE_STORE_KEYS.has(key)) database.prepare("DELETE FROM legacy_ui_store WHERE key=?").run(key); });
    for (const key of MERGE_CORE_KEY_ORDER) if (state.baseline[key] !== null && state.baseline[key] !== undefined) writeCoreKey(key, state.baseline[key], "demo_restore_baseline", { transaction: false });
    const upsert = database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
    state.keys.forEach((key) => { if (!CORE_STORE_KEYS.has(key) && state.baseline[key] !== null && state.baseline[key] !== undefined) upsert.run(key, encryptText(state.baseline[key])); });
    database.prepare("DELETE FROM migration_meta WHERE key=?").run(DEMO_STATE_META_KEY);
    const remaining = demoBusinessEvidence();
    if (remaining.hasRealData) {
      const error = new Error("演示数据清除后仍检测到业务残留，已回滚本次操作。");
      error.code = "DEMO_CLEAR_RESIDUE";
      throw error;
    }
    database.exec("COMMIT");
    return { ok: true, status: demoStatus() };
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function demoAllowsOperation(request, url) {
  const method = String(request && request.method || "GET").toUpperCase();
  const pathname = String(url && url.pathname || "");
  if (method === "GET" || method === "HEAD") return true;
  if (workbenchReadOnlyRender(request, url)) return true;
  if (method === "POST" && pathname === "/api/demo/clear") return true;
  /* 演示期仍可完整创建、导出和维护备份，但恢复类操作会引入真实数据，必须先清除演示数据。 */
  if (method === "POST" && pathname === "/api/backups") return true;
  if (method === "DELETE" && /^\/api\/backups\/[^/]+$/.test(pathname)) return true;
  if (method === "POST" && pathname === "/api/backups/legacy-purge") return true;
  if (method === "PUT" && pathname === "/api/webdav/config") return true;
  if (method === "POST" && ["/api/webdav/test", "/api/webdav/backup"].includes(pathname)) return true;
  return false;
}

function demoLockedPayload() {
  return { error: "当前为演示数据模式，不能添加、编辑、删除、导入或恢复真实数据。请先点击顶部“清除演示数据”。", code: "DEMO_MODE_READ_ONLY", demo: demoStatus() };
}

/* JSON 文件恢复不能沿用浏览器逐键异步同步：页面刷新会中断队列，且学生主表
   与其关联台账必须在同一事务中按依赖顺序写入。该入口仅接受前端实际使用的
   nnuzc_* JSON 值，并在同一事务中按依赖顺序写入。 */
function restoreJsonBackup(payload) {
  const source = payload && payload.data;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw httpError(400, "备份结构不正确。");
  const entries = new Map();
  const skippedRetiredKeys = [];
  for (const [key, value] of Object.entries(source)) {
    if (isRetiredStoreKey(key)) { skippedRetiredKeys.push(key); continue; }
    if (!safeStoreKey(key)) throw httpError(400, `备份包含不支持的数据项：${String(key).slice(0, 80)}。`);
    const text = JSON.stringify(value);
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw httpError(400, `备份数据项 ${key} 无效或过大。`);
    entries.set(key, text);
  }
  if(entries.has("nnuzc_students")||entries.has(STUDENT_IDENTITY_LINKS_KEY)){
    const current=readStore(),storedLinks=entries.get(STUDENT_IDENTITY_LINKS_KEY)??current[STUDENT_IDENTITY_LINKS_KEY];
    if(storedLinks!=null){
      const links=JSON.parse(storedLinks),people=JSON.parse(entries.get("nnuzc_students")??current.nnuzc_students??"[]");
      if(!links||typeof links!=="object"||Array.isArray(links)||!Array.isArray(people))throw httpError(400,"备份中的学号关联数据格式无效。",true);
      const ids=new Set(people.map(s=>String(s.id))),valid=Object.create(null);
      for(const [from,to]of Object.entries(links))if(typeof to==="string"&&from!==to&&!ids.has(from)&&ids.has(to))valid[from]=to;
      entries.set(STUDENT_IDENTITY_LINKS_KEY,JSON.stringify(valid));
    }
  }
  if(entries.has("nnuzc_student_leaves")){const proposed={...readStore(),...Object.fromEntries(entries)};entries.set("nnuzc_student_leaves",normalizeStudentLeaves(entries.get("nnuzc_student_leaves"),proposed,null,true));}
  else if(entries.has('nnuzc_students')||entries.has('nnuzc_term_list')){const current=readStore();if(current.nnuzc_student_leaves)normalizeStudentLeaves(current.nnuzc_student_leaves,{...current,...Object.fromEntries(entries)},current.nnuzc_student_leaves,true);}
  if (!entries.size && !skippedRetiredKeys.length) throw httpError(400, "备份中没有可恢复的数据。");

  database.exec("BEGIN IMMEDIATE");
  try {
    /* 基础数据、学期和学生必须先于引用它们的业务台账恢复。 */
    for (const key of MERGE_CORE_KEY_ORDER) {
      if (entries.has(key)) writeCoreKey(key, entries.get(key), "restore_json_import", { transaction: false });
    }
    const upsertLegacy = database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
    for (const [key, text] of entries) {
      if (!CORE_STORE_KEYS.has(key)) upsertLegacy.run(key, encryptText(text));
    }
    purgeRetiredNameCheckHistory();
    purgeRetiredCounselorGrowthPlans();
    purgeRetiredKnowledgeFeature();
    purgeRetiredStudentLegacyFields();
    database.exec("COMMIT");
    return { restored: true, restoredKeys: entries.size, skippedRetiredKeys };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (_ignored) {}
    if (error && error.statusCode) throw error;
    throw httpError(400, `导入备份失败：${error && error.message ? error.message : "备份数据校验未通过。"}`);
  }
}

const JSON_ROW_SOURCES = Object.freeze({
  students: { table: "students", orderBy: "student_id" },
  meetings: { table: "meetings", orderBy: "created_at" },
  talks: { table: "talk_records", orderBy: "created_at" },
  home: { table: "home_contacts", orderBy: "created_at" },
  punishments: { table: "punishment_records", orderBy: "created_at" },
  funds: { table: "fund_records", orderBy: "created_at" },
  dormDistribution: { table: "dorm_distribution_records", orderBy: "created_at" }
});

function jsonRows(sourceName, sourceDatabase = database) {
  const source = JSON_ROW_SOURCES[sourceName];
  if (!source) throw new Error("未允许的数据读取来源。");
  validateTable(source.table);
  validateColumn(source.orderBy);
  return sourceDatabase.prepare(`SELECT data_json FROM ${source.table} ORDER BY ${source.orderBy}`).all()
    .map((row) => parseProtectedJson(row.data_json, source.table));
}

function databaseMigrationDone(sourceDatabase, key) {
  try { return sourceDatabase.prepare("SELECT value FROM migration_meta WHERE key=?").get(key)?.value === "done"; }
  catch (_error) { return false; }
}

function fillStudentIdentityBlanks(student) {
  if (!student || typeof student !== "object" || Array.isArray(student)) return false;
  const empty = value => value == null || typeof value === "string" && value.trim() === "";
  if (!empty(student.birth) && !empty(student.gender)) return false;
  const number = String(empty(student.idcard) ? student.idCard || "" : student.idcard).normalize("NFKC").replace(/\s/g, "").toUpperCase();
  const old = /^\d{15}$/.test(number);
  if (!old && !/^\d{17}[\dX]$/.test(number)) return false;
  const residence = !old && ["810000", "820000", "830000"].includes(number.slice(0, 6));
  const prefixes = ["11","12","13","14","15","21","22","23","31","32","33","34","35","36","37","41","42","43","44","45","46","50","51","52","53","54","61","62","63","64","65"];
  if ((!residence && !prefixes.includes(number.slice(0, 2))) || number.slice(old ? 12 : 14, old ? 15 : 17) === "000") return false;
  const birth = old ? "19" + number.slice(6, 12) : number.slice(6, 14);
  const year = Number(birth.slice(0, 4)), month = Number(birth.slice(4, 6)), day = Number(birth.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day)), today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, "");
  if (year < 1800 || birth > today || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return false;
  if (!old) {
    const weights = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
    const sum = weights.reduce((total, weight, index) => total + Number(number[index]) * weight, 0);
    if ("10X98765432"[sum % 11] !== number[17]) return false;
  }
  let changed = false;
  if (empty(student.birth)) { student.birth = empty(student.birthDate) ? birth : student.birthDate; changed = true; }
  // Existing mainland/HK/Macau/Taiwan policy: only mainland IDs derive gender.
  if (empty(student.gender) && !residence) { student.gender = Number(number[old ? 14 : 16]) % 2 ? "男" : "女"; changed = true; }
  return changed;
}

function backfillStudentIdentityBlanks(options = {}) {
  if (!database || !activeDataKey) return 0;
  const ownTransaction = options.transaction !== false;
  if (ownTransaction) database.exec("BEGIN IMMEDIATE");
  try {
    // Read and update under the same lock, preserving any concurrent manual edit.
    const changes = [];
    database.prepare("SELECT rowid AS rid,data_json FROM students").all().forEach(row => {
      const student = parseProtectedJson(row.data_json, "students");
      if (fillStudentIdentityBlanks(student)) changes.push({ rid: row.rid, student });
    });
    const update = database.prepare("UPDATE students SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE rowid=?");
    changes.forEach(row => update.run(protectedJson(row.student), row.rid));
    if (ownTransaction) database.exec("COMMIT");
    return changes.length;
  } catch (error) { if (ownTransaction) database.exec("ROLLBACK"); throw error; }
}

function readCoreStore(sourceDatabase = database) {
  const store = {};
  let protectedIds = databaseMigrationDone(sourceDatabase, "protected_record_ids_v1");
  /* 新安装从一开始就以 HMAC 学号写表，但早期的新库初始化没有写入旧版迁移标记。
     不能只依赖 migration_meta，否则党团、课堂、宿舍违纪会按明文学号关联并在刷新后消失。 */
  if (!protectedIds) {
    const sample = sourceDatabase.prepare("SELECT student_id,data_json FROM students LIMIT 1").get();
    if (sample) {
      try {
        const decoded = parseProtectedJson(sample.data_json, "students");
        protectedIds = !!decoded?.id && sample.student_id === protectedStudentId(String(decoded.id));
      } catch (_error) { protectedIds = false; }
    }
  }
  const departments = sourceDatabase.prepare("SELECT code,name FROM departments ORDER BY name").all();
  const majors = sourceDatabase.prepare("SELECT code,name,department_name AS dept,years FROM majors ORDER BY name").all();
  const classes = sourceDatabase.prepare("SELECT name,department_name AS dept,major_name AS major,grade,counselor,teacher,level,enroll_type AS enrollType FROM class_groups ORDER BY name").all().map((row)=>Object.assign({},row,{counselor:decryptText(row.counselor),teacher:decryptText(row.teacher)}));
  const orgAux = (() => { try { const r = sourceDatabase.prepare("SELECT value FROM legacy_ui_store WHERE key='nnuzc_orgs_extra'").get(); if (r && r.value) return JSON.parse(decryptText(r.value)); } catch (_e) {} return { grades: [], dorms: [], enrollTypes: [] }; })();
  if (departments.length || majors.length || classes.length || (orgAux.grades && orgAux.grades.length) || (orgAux.dorms && orgAux.dorms.length) || (orgAux.enrollTypes && orgAux.enrollTypes.length) || Array.isArray(orgAux.levels)) {
    store.nnuzc_orgs = JSON.stringify({
      depts: departments,
      majors,
      classes,
      grades: Array.isArray(orgAux.grades) ? orgAux.grades : [],
      dorms: Array.isArray(orgAux.dorms) ? orgAux.dorms : [],
      enrollTypes: Array.isArray(orgAux.enrollTypes) ? orgAux.enrollTypes : [],
      ...(Array.isArray(orgAux.levels) ? { levels: orgAux.levels } : {})
    });
  }
  const terms = sourceDatabase.prepare("SELECT name,is_current FROM terms ORDER BY sort_order,name").all();
  if (terms.length) { store.nnuzc_term_list = JSON.stringify(terms.map((row) => row.name)); const current=terms.find((row)=>row.is_current)?.name; if(current) store.nnuzc_current_term=current; }
  const students = jsonRows("students", sourceDatabase);
  students.forEach((student) => { delete student.remark1; delete student.remark2; delete student.customFields; fillStudentIdentityBlanks(student); });
  if (students.length) {
    const profiles = new Map(sourceDatabase.prepare("SELECT student_id,data_json FROM party_profiles").all().map((row)=>[row.student_id,parseProtectedJson(row.data_json,"party_profiles")]));
    const histories = new Map(); sourceDatabase.prepare("SELECT student_id,data_json FROM party_history ORDER BY record_date,record_id").all().forEach((row)=>{const list=histories.get(row.student_id)||[];list.push(parseProtectedJson(row.data_json,"party_history"));histories.set(row.student_id,list);});
    const classrooms = new Map(); sourceDatabase.prepare("SELECT student_id,data_json FROM classroom_records ORDER BY record_date,record_id").all().forEach((row)=>{const list=classrooms.get(row.student_id)||[];list.push(parseProtectedJson(row.data_json,"classroom_records"));classrooms.set(row.student_id,list);});
    const dorms = new Map(); sourceDatabase.prepare("SELECT student_id,data_json FROM student_dorm_records ORDER BY record_date,record_id").all().forEach((row)=>{const list=dorms.get(row.student_id)||[];list.push(parseProtectedJson(row.data_json,"student_dorm_records"));dorms.set(row.student_id,list);});
    students.forEach((student)=>{const sid=protectedIds?protectedStudentId(String(student.id)):String(student.id);const party=profiles.get(sid);if(party){party.history=histories.get(sid)||[];student.party=party;}const classroom=classrooms.get(sid);if(classroom&&classroom.length)student.classroom=classroom;const dorm=dorms.get(sid);if(dorm&&dorm.length)student.dorm=dorm;});
    store.nnuzc_students=JSON.stringify(students);
  }
  const mappings = [["nnuzc_meetings","meetings"],["nnuzc_talks","talks"],["nnuzc_home","home"],["nnuzc_punishments","punishments"],["nnuzc_fund_records","funds"],["nnuzc_dorm_dist","dormDistribution"]];
  mappings.forEach(([key,sourceName])=>{const rows=jsonRows(sourceName,sourceDatabase);if(rows.length)store[key]=JSON.stringify(rows);});
  const dormState=sourceDatabase.prepare("SELECT state_json FROM dorm_module_state WHERE id=1").get(); if(dormState)store.nnuzc_dorm=decryptText(dormState.state_json);
  [["nnuzc_academic_terms","academic_terms"],["nnuzc_academic_warnings","academic_warnings"]].forEach(([key,moduleName])=>{const rows=sourceDatabase.prepare("SELECT data_json FROM academic_term_records WHERE module_name=? ORDER BY term_name").all(moduleName).map((row)=>parseProtectedJson(row.data_json,key));if(rows.length)store[key]=JSON.stringify(rows);});
  return store;
}

function migrateCoreLegacyStore() {
  const rows = database.prepare("SELECT key,value FROM legacy_ui_store WHERE key IN (" + [...CORE_STORE_KEYS].map(()=>"?").join(",") + ")").all(...CORE_STORE_KEYS);
  const order = { nnuzc_orgs: 1, nnuzc_term_list: 2, nnuzc_current_term: 3, nnuzc_students: 4, nnuzc_meetings: 5, nnuzc_talks: 6, nnuzc_home: 7, nnuzc_punishments: 8, nnuzc_fund_records: 9, nnuzc_dorm_dist: 10, nnuzc_dorm: 11, nnuzc_academic_terms: 12, nnuzc_academic_warnings: 13 };
  rows.sort((left, right) => (order[left.key] || 999) - (order[right.key] || 999));
  rows.forEach((row) => { writeCoreKey(row.key, decryptText(row.value), "legacy_migration"); log(`已迁移核心数据：${row.key}`); });
}

function createBackup(note = "手动备份", options = {}) {
  database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const name = `workbench-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const target = path.join(BACKUP_DIR, name);
  fs.copyFileSync(DB_PATH, target);
  if (options.includeAttachments !== false) {
    const attachmentTarget = `${target}.attachments`;
    fs.cpSync(UPLOAD_DIR, attachmentTarget, { recursive: true, force: true });
  }
  if (fs.existsSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH) && fs.existsSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH)) {
    fs.copyFileSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH, `${target}.academic-warning-template.bin`);
    fs.copyFileSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH, `${target}.academic-warning-template.json`);
  }
  /* 跨设备恢复必须与当时的数据密钥配套；此文件随本地备份受同一目录权限保护。 */
  if (fs.existsSync(PORTABLE_DATA_KEY_PATH)) fs.copyFileSync(PORTABLE_DATA_KEY_PATH, `${target}.portable-data-key.json`);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  const id = crypto.randomUUID();
  database.prepare("INSERT INTO web_backup_records(id,relative_path,sha256,note) VALUES (?,?,?,?)")
    .run(id, path.join("backups", name), hash, String(note).slice(0, 200));
  return { id, relative_path: path.join("backups", name), sha256: hash, note };
}

function scheduleDownloadedUpdateInstall() {
  const { launchWindowsUpdater } = require("./update-launcher");
  if (process.platform !== "win32") throw httpError(501, "当前系统尚未提供此平台的自动替换程序。", true);
  if (!updateClient) throw httpError(503, "更新客户端尚未就绪。", true);
  if (updateInstallScheduled) throw httpError(409, "系统升级已经启动，请勿重复操作。", true);
  const downloaded = updateClient.downloadedPackage();
  if (!downloaded) throw httpError(409, "请先完成更新包下载和校验。", true);
  const installer = path.join(ROOT, "scripts", "update-bootstrap.ps1");
  if (!fs.existsSync(installer)) throw httpError(503, "更新安装组件缺失。", true);
  updateInstallScheduled = true;
  try {
    ensureUpdateInstallSpace(downloaded.size);
    writeUpdateInstallProgress({ phase: "preparing", percent: 15, message: "升级包已校验，正在启动更新程序…", version: downloaded.version });
    const installerLogPath = path.join(DATA_DIR, "updates", "installer-launch.log");
    // 先让 202 响应完整返回浏览器，再启动会结束当前服务的更新器，避免浏览器把
    // 已成功开始的安装误报成网络失败。250ms 只用于刷新响应，不用于等待安装。
    const launchTimer = setTimeout(() => {
      try {
        const child = launchWindowsUpdater({ installer, root: ROOT, packageFile: downloaded.file, sha256: downloaded.sha256, version: downloaded.version, parentProcessId: process.pid, logPath: installerLogPath });
        // 此子进程只负责创建独立的更新进程。成功退出后，独立进程会继续校验、
        // 停止旧服务和替换文件；非零退出才代表分派失败。
        child.once("exit", (code, signal) => {
          if (!updateInstallScheduled) return;
          if (code === 0 && !signal) {
            const takeoverTimer = setTimeout(() => {
              if (!updateInstallScheduled) return;
              const progress = readUpdateInstallProgress();
              updateInstallScheduled = false;
              if (progress.phase === "error") return;
              try { writeUpdateInstallProgress({ phase: "error", percent: Math.min(99, progress.percent || 15), message: "更新程序未能接管安装。", version: downloaded.version, error: `更新程序启动后长时间未能结束旧服务。请查看 ${installerLogPath} 及对应的 -error.log。` }); } catch (_ignored) {}
            }, 180000);
            takeoverTimer.unref();
            return;
          }
          updateInstallScheduled = false;
          const progress = readUpdateInstallProgress();
          const detail = `更新启动程序启动失败（退出码：${code == null ? "无" : code}${signal ? `，信号：${signal}` : ""}）。`;
          if (progress.phase !== "error") {
            try { writeUpdateInstallProgress({ phase: "error", percent: Math.min(99, progress.percent || 15), message: "更新程序未能接管安装。", version: downloaded.version, error: `${detail} 请查看 ${installerLogPath}。` }); } catch (_ignored) {}
          }
          log(`${detail} 诊断日志：${installerLogPath}`);
        });
        child.once("error", (error) => {
          updateInstallScheduled = false;
          const current = readUpdateInstallProgress();
          try { writeUpdateInstallProgress({ phase: "error", percent: Math.min(99, current.percent || 15), message: "无法启动更新程序。", version: downloaded.version, error: `${String(error && error.message || "启动失败")} 请查看 ${installerLogPath}。` }); } catch (_ignored) {}
          log(`更新程序启动失败：${error && error.message || error}`);
        });
      } catch (error) {
        updateInstallScheduled = false;
        const current = readUpdateInstallProgress();
        try { writeUpdateInstallProgress({ phase: "error", percent: Math.min(99, current.percent || 15), message: "无法启动更新程序。", version: downloaded.version, error: `${String(error && error.message || "启动失败")} 请查看 ${installerLogPath}。` }); } catch (_ignored) {}
        log(`更新程序启动失败：${error && error.message || error}`);
      }
    }, 250);
    launchTimer.unref();
    return { ok: true, version: downloaded.version, installProgress: readUpdateInstallProgress(), message: "升级包已校验，系统即将退出并完成更新。" };
  } catch (error) {
    updateInstallScheduled = false;
    const current = readUpdateInstallProgress();
    try { writeUpdateInstallProgress({ phase: "error", percent: Math.min(99, current.percent || 0), message: "升级准备失败。", version: downloaded.version, error: String(error && error.message || "准备失败") }); } catch (_ignored) {}
    throw error;
  }
}

/* ---- WebDAV 私有云：服务端直连、加密包、单人非并发恢复 ---- */
function webdavPublicConfig() {
  const secret = loadWebdavSecret();
  if (!secret) return { configured: false };
  const configured = !!(secret.url && secret.username && secret.password && secret.remoteFile);
  return { configured, url: secret.url || "", username: configured ? secret.username : "", hasPassword: configured,
    remoteFile: secret.remoteFile || "shuzhi-xuegong-backup.szwd", updatedAt: secret.updatedAt || "", endpointRetained: !!(secret.url && secret.remoteFile) };
}

function loadWebdavSecret() {
  try {
    const row = database.prepare("SELECT value FROM webdav_secret WHERE id=1").get();
    if (!row) return null;
    const value = JSON.parse(decryptText(row.value));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_error) { return null; }
}

function normalizeWebdavUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw || "").trim()); } catch (_error) { throw httpError(400, "WebDAV 地址格式无效。", true); }
  if (parsed.protocol !== "https:") throw httpError(400, "WebDAV 地址必须使用 HTTPS。", true);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw httpError(400, "WebDAV 地址不能包含账号、密码、查询参数或片段。", true);
  if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  return parsed.toString();
}

function normalizeWebdavConfig(body, existing = null) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "WebDAV 配置格式无效。", true);
  const url = normalizeWebdavUrl(body.url == null ? existing?.url : body.url);
  const username = String(body.username == null ? existing?.username || "" : body.username).trim();
  const password = body.password == null || body.password === "" ? (existing?.password || "") : String(body.password);
  const remoteFile = String(body.remoteFile == null ? existing?.remoteFile || "shuzhi-xuegong-backup.szwd" : body.remoteFile).trim();
  if (!username || username.length > 512 || !password || password.length > 2048) throw httpError(400, "请填写 WebDAV 账号和应用授权码。", true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.szwd$/i.test(remoteFile)) throw httpError(400, "云端文件名仅允许字母、数字、点、下划线和连字符，并以 .szwd 结尾。", true);
  return { url, username, password, remoteFile, updatedAt: new Date().toISOString() };
}

function saveWebdavSecret(config) {
  database.prepare("INSERT INTO webdav_secret(id,value,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(encryptText(JSON.stringify(config)));
}

function webdavAuthorization(config) { return "Basic " + Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64"); }
function webdavRemoteUrl(config) { return new URL(config.remoteFile, config.url).toString(); }
function webdavMobileRemoteUrl(config) { return new URL(MOBILE_SYNC_FILENAME, config.url).toString(); }

/* Android 伴侣只读取经过白名单筛选的最小化快照；附件、本机密钥、联系方式和谈话正文绝不出现在移动同步文件中。 */
function mobileSyncProjection() {
  const store = readStore();
  const parse = (key, fallback) => { try { return store[key] == null ? fallback : JSON.parse(store[key]); } catch (_error) { return fallback; } };
  const students = parse("nnuzc_students", []).filter((row) => row && typeof row === "object").map((row) => ({
    id: String(row.id || ""), name: String(row.name || ""), dept: String(row.dept || ""), major: String(row.major || ""),
    grade: String(row.grade || ""), cls: String(row.cls || ""), status: String(row.status || "")
  }));
  return {
    schema: "shuzhi-xuegong-mobile-view-v1",
    generatedAt: new Date().toISOString(),
    currentTerm: String(store.nnuzc_current_term || ""),
    terms: parse("nnuzc_term_list", []),
    termSettings: parse("nnuzc_term_settings", {}),
    students,
    counts: {
      talks: parse("nnuzc_talks", []).length,
      academicWarnings: parse("nnuzc_academic_warnings", []).length,
      fundRecords: parse("nnuzc_fund_records", []).length,
      meetings: parse("nnuzc_meetings", []).length
    }
  };
}

function createMobileSyncEnvelope(syncPassword) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(String(syncPassword), salt, MOBILE_SYNC_KDF_ITERATIONS, 32, "sha256");
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(mobileSyncProjection()), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = Buffer.from(JSON.stringify({
      format: MOBILE_SYNC_FORMAT,
      version: MOBILE_SYNC_VERSION,
      createdAt: new Date().toISOString(),
      kdf: { name: "PBKDF2-HMAC-SHA256", iterations: MOBILE_SYNC_KDF_ITERATIONS, salt: salt.toString("base64") },
      iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64")
    }), "utf8");
    if (envelope.length > MOBILE_SYNC_MAX_BYTES) throw httpError(413, "Android 伴侣同步数据超过 20 MB，请减少移动端同步范围。", true);
    return envelope;
  } finally { key.fill(0); salt.fill(0); }
}

async function uploadMobileSyncSnapshot(config, syncPassword) {
  const payload = createMobileSyncEnvelope(syncPassword);
  const response = await webdavFetch(config, webdavMobileRemoteUrl(config), { method: "PUT", headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(payload.length) }, body: payload });
  if (response.status === 401 || response.status === 403) throw httpError(401, "WebDAV 账号或应用授权码错误。", true);
  if (!response.ok) throw httpError(502, `Android 伴侣同步文件上传失败（HTTP ${response.status}）。`, true);
  return { remoteFile: MOBILE_SYNC_FILENAME, bytes: payload.length };
}

async function webdavFetch(config, remoteUrl, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(remoteUrl, Object.assign({ redirect: "error", signal: controller.signal, headers: {} }, options, {
      headers: Object.assign({ Authorization: webdavAuthorization(config) }, options.headers || {})
    }));
  } catch (error) {
    if (error && error.name === "AbortError") throw httpError(504, "WebDAV 连接超时，请检查网络或服务器地址。", true);
    throw httpError(502, "无法连接 WebDAV 服务器，请检查地址、网络和授权码。", true);
  } finally { clearTimeout(timer); }
}

async function testWebdav(config) {
  const response = await webdavFetch(config, config.url, { method: "PROPFIND", headers: { Depth: "0" } });
  if (response.status === 401 || response.status === 403) throw httpError(401, "WebDAV 账号或应用授权码错误。", true);
  if (!response.ok && response.status !== 207) throw httpError(502, `WebDAV 连接失败（HTTP ${response.status}）。`, true);
  return { ok: true, status: response.status };
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try { const buffer = Buffer.allocUnsafe(1024 * 1024); let read; while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read)); }
  finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function listWebdavBundleFiles(snapshot) {
  const source = path.resolve(ROOT, snapshot.relative_path);
  const attachments = `${source}.attachments`;
  const key = `${source}.portable-data-key.json`;
  if (!fs.existsSync(source) || !fs.existsSync(key)) throw new Error("本地快照或数据密钥不存在，无法创建私有云备份。");
  const files = [{ name: "workbench.db", source }, { name: "portable-data-key.json", source: key }];
  if (fs.existsSync(attachments)) fs.readdirSync(attachments, { withFileTypes: true }).filter((item) => item.isFile() && /^[a-f0-9-]{36}$/i.test(item.name)).forEach((item) => files.push({ name: `attachments/${item.name}`, source: path.join(attachments, item.name) }));
  return files.map((item) => Object.assign(item, { size: fs.statSync(item.source).size, sha256: sha256File(item.source) }));
}

async function writeToStream(stream, buffer) { if (!stream.write(buffer)) await once(stream, "drain"); }

async function createWebdavBundle(snapshot, syncPassword) {
  const files = listWebdavBundleFiles(snapshot);
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0);
  if (totalBytes > WEBDAV_MAX_BUNDLE_BYTES) throw httpError(413, `数据快照超过 WebDAV 备份上限（${Math.floor(WEBDAV_MAX_BUNDLE_BYTES / 1024 / 1024)} MB）。`, true);
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(syncPassword), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const header = Buffer.from(JSON.stringify({ version: WEBDAV_BUNDLE_VERSION, createdAt: new Date().toISOString(), kdf: { name: "scrypt", N: 32768, r: 8, p: 1, salt: salt.toString("base64") }, iv: iv.toString("base64"), files: files.map(({ name, size, sha256 }) => ({ name, size, sha256 })) }), "utf8");
  const tempFile = path.join(WEBDAV_TEMP_DIR, `upload-${crypto.randomUUID()}.szwd`);
  const writer = fs.createWriteStream(tempFile, { flags: "wx", mode: 0o600 });
  try {
    const headerLength = Buffer.alloc(4); headerLength.writeUInt32LE(header.length, 0);
    await writeToStream(writer, Buffer.concat([WEBDAV_BUNDLE_MAGIC, headerLength, header]));
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    for (const item of files) for await (const chunk of fs.createReadStream(item.source)) await writeToStream(writer, cipher.update(chunk));
    await writeToStream(writer, cipher.final()); await writeToStream(writer, cipher.getAuthTag()); writer.end(); await finished(writer);
    return { file: tempFile, bytes: fs.statSync(tempFile).size, fileCount: files.length };
  } catch (error) { try { writer.destroy(); } catch (_ignored) {} try { fs.rmSync(tempFile, { force: true }); } catch (_ignored) {} throw error; }
  finally { key.fill(0); salt.fill(0); }
}

async function uploadWebdavBackup(syncPassword, request) {
  if (typeof syncPassword !== "string" || syncPassword.length < 10 || syncPassword.length > 256) throw httpError(400, "同步加密密码长度须为 10 到 256 位，且不会被系统保存。", true);
  const config = loadWebdavSecret(); if (!config) throw httpError(400, "请先配置 WebDAV 私有云。", true);
  const snapshot = createBackup("WebDAV 私有云上传快照");
  let bundle;
  try {
    bundle = await createWebdavBundle(snapshot, syncPassword);
    if (request) assertRequestSession(request);
    const response = await webdavFetch(config, webdavRemoteUrl(config), { method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bundle.bytes) }, body: fs.createReadStream(bundle.file), duplex: "half" });
    if (response.status === 401 || response.status === 403) throw httpError(401, "WebDAV 账号或应用授权码错误。", true);
    if (!response.ok) throw httpError(502, `WebDAV 上传失败（HTTP ${response.status}）。`, true);
    if (request) assertRequestSession(request);
    const mobileSync = await uploadMobileSyncSnapshot(config, syncPassword);
    return { uploaded: true, remoteFile: config.remoteFile, bytes: bundle.bytes, fileCount: bundle.fileCount, mobileSync };
  } finally { if (bundle?.file) try { fs.rmSync(bundle.file, { force: true }); } catch (_ignored) {} }
}

async function downloadWebdavBundle(config) {
  const response = await webdavFetch(config, webdavRemoteUrl(config), { method: "GET" });
  if (response.status === 404) throw httpError(404, "云端尚无数智学工备份，请先在已有数据的电脑执行“备份至私有云”。", true);
  if (response.status === 401 || response.status === 403) throw httpError(401, "WebDAV 账号或应用授权码错误。", true);
  if (!response.ok || !response.body) throw httpError(502, `WebDAV 下载失败（HTTP ${response.status}）。`, true);
  const limit = WEBDAV_MAX_BUNDLE_BYTES + 1024 * 1024;
  const bytes = Number(response.headers.get("content-length") || 0);
  if (bytes > limit) { await response.body.cancel().catch(() => {}); throw httpError(413, "云端备份文件超过允许大小。", true); }
  const target = path.join(WEBDAV_TEMP_DIR, `download-${crypto.randomUUID()}.szwd`);
  const writer = fs.createWriteStream(target, { flags: "wx", mode: 0o600 });
  let received = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    callback(received > limit ? httpError(413, "云端备份文件超过允许大小。", true) : null, received > limit ? undefined : chunk);
  } });
  try { await pipeline(Readable.fromWeb(response.body), limiter, writer); return target; }
  catch (error) { try { fs.rmSync(target, { force: true }); } catch (_ignored) {} throw error; }
}

function readWebdavBundleHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const first = Buffer.alloc(8); fs.readSync(fd, first, 0, first.length, 0);
    if (!first.subarray(0, 4).equals(WEBDAV_BUNDLE_MAGIC)) throw httpError(400, "云端备份格式不受支持。", true);
    const length = first.readUInt32LE(4); if (!length || length > 1024 * 1024) throw httpError(400, "云端备份头信息无效。", true);
    const headerBytes = Buffer.alloc(length); fs.readSync(fd, headerBytes, 0, length, 8); const header = JSON.parse(headerBytes.toString("utf8"));
    if (header.version !== WEBDAV_BUNDLE_VERSION || !Array.isArray(header.files) || !header.kdf || header.kdf.name !== "scrypt") throw httpError(400, "云端备份版本不受支持。", true);
    // Version 1 has a fixed work factor; untrusted headers must not choose CPU cost.
    if (header.kdf.N !== 32768 || header.kdf.r !== 8 || header.kdf.p !== 1) throw httpError(400, "云端备份加密参数无效。", true);
    const validBase64 = (value, size) => typeof value === "string" && Buffer.from(value, "base64").length === size && Buffer.from(value, "base64").toString("base64") === value;
    if (!validBase64(header.kdf.salt, 16) || !validBase64(header.iv, 12)) throw httpError(400, "云端备份加密参数无效。", true);
    return { header, offset: 8 + length };
  } catch (error) { if (error.statusCode) throw error; throw httpError(400, "云端备份头信息损坏。", true); }
  finally { fs.closeSync(fd); }
}

async function extractWebdavBundle(bundleFile, syncPassword) {
  if (typeof syncPassword !== "string" || syncPassword.length < 10 || syncPassword.length > 256) throw httpError(400, "请输入正确的同步加密密码。", true);
  const { header, offset } = readWebdavBundleHeader(bundleFile); const total = fs.statSync(bundleFile).size;
  if (total <= offset + 16) throw httpError(400, "云端备份内容不完整。", true);
  const files = header.files;
  const totalPlainBytes = files.reduce((sum, item) => sum + Number(item.size || 0), 0); if (!Number.isSafeInteger(totalPlainBytes) || totalPlainBytes < 1 || totalPlainBytes > WEBDAV_MAX_BUNDLE_BYTES) throw httpError(400, "云端备份文件清单无效。", true);
  if (!files.every((item) => Number.isSafeInteger(item.size) && item.size >= 0 && typeof item.name === "string" && /^(workbench\.db|portable-data-key\.json|attachments\/[a-f0-9-]{36})$/i.test(item.name) && /^[a-f0-9]{64}$/i.test(String(item.sha256 || "")))) throw httpError(400, "云端备份包含不允许的文件。", true);
  const key = crypto.scryptSync(syncPassword, Buffer.from(header.kdf.salt, "base64"), 32, { N: header.kdf.N, r: header.kdf.r, p: header.kdf.p, maxmem: 64 * 1024 * 1024 });
  const fd = fs.openSync(bundleFile, "r"); const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, total - 16); fs.closeSync(fd);
  const destination = fs.mkdtempSync(path.join(WEBDAV_TEMP_DIR, "restore-"));
  const writers = [];
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64")); decipher.setAuthTag(tag);
    let index = 0, written = 0, hash = crypto.createHash("sha256"), writer = null;
    const openWriter = () => { const item = files[index]; const target = path.join(destination, item.name); fs.mkdirSync(path.dirname(target), { recursive: true }); writer = fs.createWriteStream(target, { flags: "wx", mode: 0o600 }); writers.push(writer); written = 0; hash = crypto.createHash("sha256"); };
    openWriter();
    const finishEmptyFiles = async () => { while (index < files.length && files[index].size === 0) { writer.end(); await finished(writer); if (hash.digest("hex") !== files[index].sha256) throw httpError(400, `云端备份校验失败：${files[index].name}。`, true); index += 1; if (index < files.length) openWriter(); } };
    await finishEmptyFiles();
    for await (const chunk of fs.createReadStream(bundleFile, { start: offset, end: total - 17 }).pipe(decipher)) {
      let start = 0; while (start < chunk.length) { const item = files[index]; const take = Math.min(chunk.length - start, item.size - written); const piece = chunk.subarray(start, start + take); hash.update(piece); await writeToStream(writer, piece); start += take; written += take;
        if (written === item.size) { writer.end(); await finished(writer); if (hash.digest("hex") !== item.sha256) throw httpError(400, `云端备份校验失败：${item.name}。`, true); index += 1; if (index < files.length) openWriter(); await finishEmptyFiles(); }
      }
    }
    if (index !== files.length) throw httpError(400, "云端备份内容不完整。", true);
    return { destination, header };
  } catch (error) { writers.forEach((item) => { try { item.destroy(); } catch (_ignored) {} }); try { fs.rmSync(destination, { recursive: true, force: true }); } catch (_ignored) {} if (error.statusCode) throw error; throw httpError(400, "同步加密密码错误或云端备份已损坏。", true); }
  finally { key.fill(0); }
}

async function restoreWebdavBackup(syncPassword, confirmation, request) {
  if (confirmation !== "恢复云端数据") throw httpError(400, "请确认“恢复云端数据”后再继续。", true);
  const config = loadWebdavSecret(); if (!config) throw httpError(400, "请先配置 WebDAV 私有云。", true);
  let downloaded, extracted;
  try {
    downloaded = await downloadWebdavBundle(config); extracted = await extractWebdavBundle(downloaded, syncPassword);
    if (request) assertRequestSession(request);
    const sourceDb = path.join(extracted.destination, "workbench.db"), sourceKey = path.join(extracted.destination, "portable-data-key.json"), sourceAttachments = path.join(extracted.destination, "attachments");
    if (!fs.existsSync(sourceDb) || !loadPortableDataKeyFile(sourceKey)) throw httpError(400, "云端备份缺少有效数据库或数据密钥。", true);
    const name = `workbench-webdav-${new Date().toISOString().replace(/[:.]/g, "-")}.db`, target = path.join(BACKUP_DIR, name), id = crypto.randomUUID();
    fs.copyFileSync(sourceDb, target); if (fs.existsSync(sourceAttachments)) fs.cpSync(sourceAttachments, `${target}.attachments`, { recursive: true, force: true }); else fs.mkdirSync(`${target}.attachments`, { recursive: true }); fs.copyFileSync(sourceKey, `${target}.portable-data-key.json`);
    const sha256 = sha256File(target); database.prepare("INSERT INTO web_backup_records(id,relative_path,sha256,note) VALUES (?,?,?,?)").run(id, path.join("backups", name), sha256, "WebDAV 私有云恢复包");
    const result = restoreBackup(id, { confirmId: id, sha256, mode: "replace" });
    return Object.assign({ restored: true, backupId: id }, result);
  } finally { if (downloaded) try { fs.rmSync(downloaded, { force: true }); } catch (_ignored) {} if (extracted?.destination) try { fs.rmSync(extracted.destination, { recursive: true, force: true }); } catch (_ignored) {} }
}

const BACKUP_ARTIFACT_SUFFIXES = ["", "-wal", "-shm", "-journal", ".attachments", ".portable-data-key.json", ".academic-warning-template.bin", ".academic-warning-template.json"];
function backupPrimaryPath(relativePath) {
  const file = path.resolve(ROOT, String(relativePath || "")), expectedRoot = path.resolve(BACKUP_DIR) + path.sep;
  if (!file.startsWith(expectedRoot) || !/^workbench-[A-Za-z0-9T_.-]+\.db$/i.test(path.basename(file))) throw new Error("备份文件位置无效。");
  return file;
}
function backupArtifactPaths(file) {
  const primary = backupPrimaryPath(path.relative(ROOT, file));
  return BACKUP_ARTIFACT_SUFFIXES.map((suffix) => primary + suffix);
}
function removeBackupArtifacts(file) {
  const artifacts = backupArtifactPaths(file), existing = artifacts.filter((target) => fs.existsSync(target));
  for (const target of existing) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
    catch (firstError) {
      try { if (fs.existsSync(target)) fs.chmodSync(target, fs.statSync(target).isDirectory() ? 0o700 : 0o600); }
      catch (_ignored) {}
      try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); }
      catch (retryError) { throw new Error(`备份文件删除失败：${path.basename(target)}（${retryError.code || retryError.message || firstError.message}）`); }
    }
  }
  const remainingArtifacts = artifacts.filter((target) => fs.existsSync(target)).map((target) => path.basename(target));
  if (remainingArtifacts.length) throw new Error(`备份删除不完整，仍有文件：${remainingArtifacts.join("、")}`);
  return { removedArtifacts: existing.length, remainingArtifacts };
}
function syncBackupRegistry() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const records = database.prepare("SELECT id,relative_path FROM web_backup_records").all();
  records.forEach((record) => {
    let file;
    try { file = backupPrimaryPath(record.relative_path); }
    catch (error) { log(`备份列表包含无效路径，已忽略：${record.relative_path}（${error.message}）`); return; }
    if (fs.existsSync(file)) return;
    try {
      removeBackupArtifacts(file);
      database.prepare("DELETE FROM web_backup_records WHERE relative_path=?").run(record.relative_path);
      log(`已自动清理丢失备份的残留文件和列表记录：${record.relative_path}`);
    } catch (error) { log(`备份残留自动清理失败：${record.relative_path}（${error.message}）`); }
  });
  const known = new Set(database.prepare("SELECT relative_path FROM web_backup_records").all().map((row) => row.relative_path));
  const add = database.prepare("INSERT INTO web_backup_records(id,relative_path,sha256,note) VALUES (?,?,?,?)");
  for (const entry of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !/^workbench-[A-Za-z0-9T_.-]+\.db$/i.test(entry.name)) continue;
    const relativePath = path.join("backups", entry.name);
    if (known.has(relativePath)) continue;
    const file = path.join(BACKUP_DIR, entry.name);
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    add.run(crypto.randomUUID(), relativePath, hash, "发现的本机加密备份");
  }
}

function listBackups() {
  syncBackupRegistry();
  return database.prepare("SELECT id,relative_path,sha256,note,created_at FROM web_backup_records ORDER BY created_at DESC, id DESC").all();
}

function legacyBackupReport() {
  if (!fs.existsSync(LEGACY_BACKUP_DIR)) return { legacyDirectory: path.relative(ROOT, LEGACY_BACKUP_DIR), fileCount: 0, totalBytes: 0, sqliteFiles: 0, samplePaths: [], actionPhrase: "移除明文历史备份" };
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const stat = fs.statSync(file);
        files.push({ file, size: stat.size });
      }
    }
  };
  walk(LEGACY_BACKUP_DIR);
  const sqliteFiles = files.filter(({ file }) => {
    let handle;
    try {
      handle = fs.openSync(file, "r");
      const header = Buffer.alloc(16);
      fs.readSync(handle, header, 0, header.length, 0);
      return header.toString("ascii") === "SQLite format 3\u0000";
    }
    catch (_error) { return false; }
    finally { if (handle != null) try { fs.closeSync(handle); } catch (_ignored) {} }
  });
  return {
    legacyDirectory: path.relative(ROOT, LEGACY_BACKUP_DIR),
    fileCount: files.length,
    totalBytes: files.reduce((sum, item) => sum + item.size, 0),
    sqliteFiles: sqliteFiles.length,
    samplePaths: files.slice(0, 8).map(({ file }) => path.relative(ROOT, file)),
    actionPhrase: "移除明文历史备份"
  };
}

function purgeLegacyBackups(body) {
  const report = legacyBackupReport();
  if (!report.fileCount) return { removed: 0, relativePath: report.legacyDirectory };
  if (!body || body.action !== "purge" || body.phrase !== report.actionPhrase || Number(body.confirmCount) !== report.fileCount || Number(body.confirmBytes) !== report.totalBytes) throw httpError(400, "历史备份清理确认信息不匹配，请重新扫描后再试。");
  const target = path.resolve(LEGACY_BACKUP_DIR);
  const expected = path.resolve(DATA_DIR, "backups");
  if (target !== expected || target === path.resolve(DATA_DIR) || target === path.parse(target).root) throw httpError(400, "历史备份目录校验失败。");
  fs.rmSync(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 120 });
  return { removed: report.fileCount, totalBytes: report.totalBytes, relativePath: report.legacyDirectory };
}

function deleteBackup(id) {
  const record = database.prepare("SELECT * FROM web_backup_records WHERE id = ?").get(id);
  if (!record) throw new Error("备份记录不存在。");
  const file = backupPrimaryPath(record.relative_path), missingFile = !fs.existsSync(file), result = removeBackupArtifacts(file);
  database.prepare("DELETE FROM web_backup_records WHERE relative_path=?").run(record.relative_path);
  log(`${missingFile ? "已清理丢失备份的残留文件和列表记录" : "已完整删除备份文件"}：${record.relative_path}`);
  return { deleted: true, verified: true, missingFile, removedArtifacts: result.removedArtifacts, remainingArtifacts: result.remainingArtifacts };
}

/* 清除本机业务与功能配置；本机/云端备份和本机登录状态不受影响。
 * WebDAV 仅保留服务器地址和云端文件名，账号、授权码及临时文件一律清除。 */
function clearLocalBusinessData(body) {
  if(dataCenterService?.isBusy())throw httpError(409,"数据中心正在处理文件，请完成后再清空数据。",true);
  if (!body || body.confirmation !== "清空本地全部数据") throw httpError(400, "请完整输入确认文字后再清空本地数据。", true);
  const savedWebdav = loadWebdavSecret();
  const retainedWebdav = savedWebdav && savedWebdav.url && savedWebdav.remoteFile
    ? { url: savedWebdav.url, remoteFile: savedWebdav.remoteFile, username: "", password: "", updatedAt: new Date().toISOString() }
    : null;
  const tables = [
    "recycle_bin_requests", "recycle_bin_audit", "recycle_bin",
    "academic_public_artifacts", "academic_public_batches", "academic_public_warning_runs", "academic_public_state", "academic_term_records", "dorm_module_state", "dorm_distribution_records", "fund_records", "punishment_records", "home_contacts", "talk_records", "meetings",
    "classroom_records", "student_dorm_records", "party_history", "party_profiles", "students", "class_groups", "majors", "departments", "terms"
  ];
  database.exec("BEGIN IMMEDIATE");
  try {
    tables.forEach((table) => { validateTable(table); database.prepare(`DELETE FROM ${table}`).run(); });
    for(const table of ["data_center_history","data_center_asset_map"])if(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)){validateTable(table);database.prepare(`DELETE FROM ${table}`).run();}
    database.prepare("DELETE FROM legacy_ui_store WHERE key LIKE 'nnuzc_%'").run();
    /* “清空本地全部数据”必须同时结束可能遗留的演示模式状态。
       其他 migration_meta 项是数据库迁移完成标记，不能一并删除。 */
    database.prepare("DELETE FROM migration_meta WHERE key=?").run(DEMO_STATE_META_KEY);
    database.prepare("DELETE FROM ai_secret").run();
    database.prepare("DELETE FROM ai_audit").run();
    database.prepare("DELETE FROM ai_usage").run();
    database.prepare("DELETE FROM webdav_secret").run();
    if (retainedWebdav) saveWebdavSecret(retainedWebdav);
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
  const clearDirectory = (directory, expectedName, label) => {
    const target = path.resolve(directory), expected = path.resolve(DATA_DIR, expectedName);
    if (target !== expected || target === path.resolve(DATA_DIR) || target === path.parse(target).root) throw new Error(`${label}目录校验失败。`);
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  };
  if(dataCenterService)dataCenterService.reset();
  clearDirectory(path.join(DATA_DIR,"data-center"),"data-center","数据中心临时文件");
  clearDirectory(UPLOAD_DIR, "attachments", "附件");
  clearDirectory(WEBDAV_TEMP_DIR, "webdav-tmp", "WebDAV 临时文件");
  resetAcademicWarningCustomTemplate();
  return { cleared: true, attachmentsCleared: true, academicWarningTemplateReset: true, webdavCredentialsCleared: true, aiConfigurationCleared: true, backupsPreserved: true, webdavEndpointRetained: !!retainedWebdav, storeValues: readStore(), demo: demoStatus() };
}

function backupPreflight(id) {
  const record = database.prepare("SELECT * FROM web_backup_records WHERE id = ?").get(id);
  if (!record) throw new Error("备份记录不存在。");
  const source = path.resolve(ROOT, record.relative_path);
  const expectedRoot = path.resolve(BACKUP_DIR) + path.sep;
  if (!source.startsWith(expectedRoot) || !fs.existsSync(source)) throw new Error("备份文件不可用。");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  if (actual !== record.sha256) throw new Error("备份校验失败，文件可能被修改。");
  let check;
  let backupDatabase;
  try {
    backupDatabase = new DatabaseSync(source, { readOnly: true });
    check = backupDatabase.prepare("PRAGMA quick_check").all().map((row) => Object.values(row)[0]);
    const tables = new Set(backupDatabase.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    if (!tables.has("students") && !tables.has("legacy_ui_store")) throw new Error("备份中未找到学生数据或旧版数据存储表。");
  } finally { if (backupDatabase) backupDatabase.close(); }
  if (!check || check.length !== 1 || check[0] !== "ok") throw new Error("备份数据库完整性检查未通过。");
  const attachmentDir = `${source}.attachments`;
  const attachmentCount = fs.existsSync(attachmentDir) ? fs.readdirSync(attachmentDir).length : 0;
  return { id: record.id, relativePath: record.relative_path, note: record.note || "", createdAt: record.created_at, sha256: actual, size: fs.statSync(source).size, attachmentCount, academicWarningTemplate: fs.existsSync(`${source}.academic-warning-template.bin`) && fs.existsSync(`${source}.academic-warning-template.json`), integrity: "ok" };
}

function restoreBackup(id, confirmation) {
  if(dataCenterService?.isBusy())throw httpError(409,"数据中心正在处理文件，请完成后再恢复备份。",true);
  const preflight = backupPreflight(id);
  if (!confirmation || confirmation.confirmId !== id || confirmation.sha256 !== preflight.sha256) throw httpError(400, "恢复确认信息无效，请重新执行恢复前检查。");
  const mode = confirmation.mode === "merge" ? "merge" : "replace";
  const record = database.prepare("SELECT * FROM web_backup_records WHERE id = ?").get(id);
  const source = path.resolve(ROOT, record.relative_path);
  // 已有手动备份登记会随恢复保留；恢复本身不会再额外创建保护备份。
  const registry = listBackups().filter((item) => {
    const file = path.resolve(ROOT, item.relative_path);
    return file.startsWith(path.resolve(BACKUP_DIR) + path.sep) && fs.existsSync(file);
  });
  if (mode === "merge") return mergeBackup(source, "", registry, id);
  const keySource = `${source}.portable-data-key.json`;
  const previousKey = Buffer.from(requireDataKey()), nextKey = fs.existsSync(keySource) ? loadPortableDataKeyFile(keySource) : Buffer.from(previousKey);
  if (!nextKey) { previousKey.fill(0); throw httpError(409, "备份中的便携数据密钥无效，当前数据未被修改。", true); }
  const staging = fs.mkdtempSync(path.join(DATA_DIR, "backup-restore-"));
  const templatePresent = fs.existsSync(`${source}.academic-warning-template.bin`) && fs.existsSync(`${source}.academic-warning-template.json`);
  const items = [
    { name: "database", source, target: DB_PATH },
    { name: "attachments", source: `${source}.attachments`, target: UPLOAD_DIR, directory: true },
    ...(fs.existsSync(keySource) ? [{ name: "key", source: keySource, target: PORTABLE_DATA_KEY_PATH }] : []),
    { name: "template", source: templatePresent ? `${source}.academic-warning-template.bin` : "", target: ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH },
    { name: "template-meta", source: templatePresent ? `${source}.academic-warning-template.json` : "", target: ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH }
  ];
  let replacementStarted = false, canClean = true;
  function removeSidecars() { for (const suffix of ["-wal", "-shm"]) fs.rmSync(DB_PATH + suffix, { force: true }); }
  try {
    // Finish copies and authenticate all encrypted database values before touching current files.
    for (const item of items) {
      item.incoming = path.join(staging, "incoming-" + item.name);
      item.previous = path.join(staging, "previous-" + item.name);
      if (item.source && fs.existsSync(item.source)) {
        if (item.directory) fs.cpSync(item.source, item.incoming, { recursive: true });
        else fs.copyFileSync(item.source, item.incoming);
      } else if (item.directory) fs.mkdirSync(item.incoming);
    }
    if (crypto.createHash("sha256").update(fs.readFileSync(items[0].incoming)).digest("hex") !== preflight.sha256) throw new Error("备份在准备恢复时发生变化，请重新检查。");
    const stagedKey = items.find(item => item.name === "key");
    if (stagedKey) {
      const copiedKey = loadPortableDataKeyFile(stagedKey.incoming);
      if (!copiedKey) throw new Error("备份中的便携数据密钥无效。");
      nextKey.set(copiedKey); copiedKey.fill(0);
    }
    validateBackupEncryption(items[0].incoming, nextKey);
    for (const file of fs.readdirSync(items[1].incoming, { withFileTypes: true })) {
      if (file.isFile()) decryptBuffer(fs.readFileSync(path.join(items[1].incoming, file.name)), nextKey);
    }
    const stagedTemplate = items.find(item => item.name === "template");
    if (fs.existsSync(stagedTemplate.incoming)) decryptBuffer(fs.readFileSync(stagedTemplate.incoming), nextKey);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    database.close(); database = null; replacementStarted = true;
    for (const item of items) {
      if (fs.existsSync(item.target)) { fs.renameSync(item.target, item.previous); item.moved = true; }
      if (fs.existsSync(item.incoming)) { fs.renameSync(item.incoming, item.target); item.installed = true; }
    }
    removeSidecars();
    activateDataKey(nextKey);
    openDatabase();
    database.prepare("DELETE FROM local_auth WHERE id=1").run();
    migrateSensitiveData();
    purgeRetiredNameCheckHistory();
    purgeRetiredCounselorGrowthPlans();
    purgeRetiredKnowledgeFeature();
    purgeRetiredStudentLegacyFields();
    backfillStudentIdentityBlanks();
    const register = database.prepare("INSERT OR REPLACE INTO web_backup_records(id,relative_path,sha256,note,created_at) VALUES (?,?,?,?,?)");
    registry.forEach((item) => register.run(item.id, item.relative_path, item.sha256, item.note, item.created_at));
    // Revoke historic nonlocal sessions only after restoration succeeds.
    for (const [sessionId, session] of authSessions) if (session.uid !== "local-super-admin") authSessions.delete(sessionId);
    return { restored: true };
  } catch (error) {
    if (replacementStarted) {
      try {
        if (database) { database.close(); database = null; }
        removeSidecars();
        for (const item of [...items].reverse()) {
          if (item.installed) fs.rmSync(item.target, { recursive: !!item.directory, force: true, maxRetries: 3, retryDelay: 120 });
          if (item.moved) fs.renameSync(item.previous, item.target);
        }
        activateDataKey(previousKey); openDatabase();
      } catch (rollbackError) {
        canClean = false;
        log(`备份恢复回滚失败，保留恢复材料 ${path.basename(staging)}：${rollbackError.message}`);
        throw httpError(500, "备份恢复失败且自动回退未完成。请保留数据目录并联系维护人员，勿再次恢复或清理文件。", true);
      }
    }
    throw httpError(409, "备份恢复失败，当前数据已保留：" + error.message, true);
  } finally {
    previousKey.fill(0); nextKey.fill(0);
    if (canClean) try { fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }); } catch (error) { log(`恢复临时材料待清理 ${path.basename(staging)}：${error.message}`); }
  }
}

function validateBackupEncryption(source, key) {
  const check = new DatabaseSync(source, { readOnly: true });
  try {
    for (const row of check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      const quoted = '"' + row.name.replace(/"/g, '""') + '"';
      for (const record of check.prepare("SELECT * FROM " + quoted).iterate()) {
        for (const value of Object.values(record)) if (isEncryptedText(value)) {
          const encrypted = Buffer.from(value.slice("xcenc:v1:".length), "base64");
          if (encrypted.length < 32 || encrypted.subarray(0, 4).toString("ascii") !== "XCA1") throw new Error("备份中的加密数据格式损坏。");
          decryptBuffer(encrypted, key);
        }
      }
    }
  } finally { check.close(); }
}

/* 合并恢复统一在业务数据层执行：旧版明文库与当前加密库先解码成同一结构，
   以当前记录优先、备份仅补缺失字段/记录，最后使用当前数据密钥事务化写回。 */
const MERGE_CORE_KEY_ORDER = [
  "nnuzc_orgs", "nnuzc_term_list", "nnuzc_current_term", "nnuzc_students",
  "nnuzc_meetings", "nnuzc_talks", "nnuzc_home", "nnuzc_punishments",
  "nnuzc_fund_records", "nnuzc_dorm_dist", "nnuzc_dorm",
  "nnuzc_academic_terms", "nnuzc_academic_warnings"
];

function mergeIdentity(value) {
  if (value === null || typeof value !== "object") return `${typeof value}:${String(value)}`;
  for (const key of ["id", "_rid", "recordId", "record_id", "uuid", "term_id"]) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]) !== "") return `${key}:${String(value[key])}`;
  }
  if (value.name && ["code", "dept", "major", "grade", "department_name", "major_name"].some((key) => value[key] !== undefined)) return `name:${String(value.name)}`;
  return `json:${JSON.stringify(value)}`;
}

function mergeCurrentFirst(current, backup, stats) {
  if (Array.isArray(current) && Array.isArray(backup)) {
    const result = current.map((item) => item);
    const indexes = new Map(result.map((item, index) => [mergeIdentity(item), index]));
    for (const item of backup) {
      const identity = mergeIdentity(item);
      if (!indexes.has(identity)) {
        indexes.set(identity, result.length);
        result.push(item);
        stats.addedRecords++;
      } else {
        const index = indexes.get(identity);
        result[index] = mergeCurrentFirst(result[index], item, stats);
      }
    }
    return result;
  }
  if (current && backup && typeof current === "object" && typeof backup === "object" && !Array.isArray(current) && !Array.isArray(backup)) {
    const result = Object.assign({}, current);
    for (const [key, value] of Object.entries(backup)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = value;
        stats.addedFields++;
      } else result[key] = mergeCurrentFirst(result[key], value, stats);
    }
    return result;
  }
  return current;
}

function mergeStoreValue(currentText, backupText, stats) {
  if (currentText === undefined) { stats.addedKeys++; return String(backupText); }
  try {
    const currentValue = JSON.parse(currentText);
    const backupValue = JSON.parse(backupText);
    return JSON.stringify(mergeCurrentFirst(currentValue, backupValue, stats));
  } catch (_error) {
    return String(currentText);
  }
}

function collectAttachmentReferences(value, output) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\/attachments\/([a-f0-9-]{36})/ig)) output.add(match[1].toLowerCase());
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string" && /^[a-f0-9-]{36}$/i.test(value.id) && (value.url || value.name || value.fileName || value.mime || value.size)) output.add(value.id.toLowerCase());
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:attachmentId|fileId|photoId)$/i.test(key) && typeof child === "string" && /^[a-f0-9-]{36}$/i.test(child)) output.add(child.toLowerCase());
    collectAttachmentReferences(child, output);
  }
}

function attachmentReferencesFromStore(store) {
  const references = new Set();
  Object.values(store).forEach((text) => {
    try { collectAttachmentReferences(JSON.parse(text), references); } catch (_error) {}
  });
  return references;
}

function mergeBackup(source, _currentAuth, registry, id) {
  let backupDatabase;
  const createdAttachments = [];
  let transactionOpen = false;
  try {
    backupDatabase = new DatabaseSync(source, { readOnly: true });
    if(backupDatabase.prepare("SELECT 1 FROM sqlite_master WHERE name='academic_public_state'").get() && backupDatabase.prepare("SELECT 1 FROM academic_public_state").get()) throw httpError(409,"备份包含公用版成绩与规则，请选择整库恢复；合并模式不支持考试及规则版本合并。");
    let backupStore;
    try { backupStore = readStoreFromDatabase(backupDatabase); }
    catch (error) { throw httpError(409, `备份数据无法用当前密码解读，已取消合并：${error.message}`); }
    const currentStore = readStore();
    const stats = { addedKeys: 0, addedRecords: 0, addedFields: 0 };
    const changed = new Map();
    const finalStore = Object.assign({}, currentStore);
    for (const [key, backupText] of Object.entries(backupStore)) {
      if (!safeStoreKey(key) || key === "nnuzc_session" || key === "nnuzc_accounts") continue;
      const mergedText = mergeStoreValue(currentStore[key], backupText, stats);
      finalStore[key] = mergedText;
      if (mergedText !== currentStore[key]) changed.set(key, mergedText);
    }

    if(changed.has("nnuzc_student_leaves")){const normalized=normalizeStudentLeaves(finalStore.nnuzc_student_leaves,finalStore,null,true);changed.set("nnuzc_student_leaves",normalized);finalStore.nnuzc_student_leaves=normalized;}
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    for (const key of MERGE_CORE_KEY_ORDER) {
      if (changed.has(key)) writeCoreKey(key, changed.get(key), "restore_merge", { transaction: false });
    }
    const upsertLegacy = database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP");
    for (const [key, value] of changed) {
      if (!CORE_STORE_KEYS.has(key)) upsertLegacy.run(key, encryptText(value));
    }

    const references = attachmentReferencesFromStore(finalStore);
    const attachSrc = `${source}.attachments`;
    let addedAttachments = 0, skippedOrphanAttachments = 0;
    if (fs.existsSync(attachSrc)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      for (const entry of fs.readdirSync(attachSrc, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const normalized = entry.name.toLowerCase();
        if (!references.has(normalized)) { skippedOrphanAttachments++; continue; }
        const dest = path.join(UPLOAD_DIR, normalized);
        if (fs.existsSync(dest)) continue;
        try {
          const plain = decryptBuffer(fs.readFileSync(path.join(attachSrc, entry.name)));
          fs.writeFileSync(dest, encryptBuffer(plain), { flag: "wx" });
          createdAttachments.push(dest);
          addedAttachments++;
        } catch (error) {
          throw httpError(409, `附件 ${entry.name} 无法安全合并：${error.message}`);
        }
      }
    }
    const register = database.prepare("INSERT OR REPLACE INTO web_backup_records(id,relative_path,sha256,note,created_at) VALUES (?,?,?,?,?)");
    registry.forEach((item) => register.run(item.id, item.relative_path, item.sha256, item.note, item.created_at));
    purgeRetiredNameCheckHistory();
    purgeRetiredCounselorGrowthPlans();
    purgeRetiredKnowledgeFeature();
    purgeRetiredStudentLegacyFields();
    const detail = { id, changedKeys: changed.size, addedKeys: stats.addedKeys, addedRecords: stats.addedRecords, addedFields: stats.addedFields, addedAttachments, skippedOrphanAttachments };
    backfillStudentIdentityBlanks({ transaction: false });
    database.exec("COMMIT");
    transactionOpen = false;
    return Object.assign({ restored: true, merged: true }, detail);
  } catch (error) {
    if (transactionOpen) { try { database.exec("ROLLBACK"); } catch (_ignored) {} }
    createdAttachments.forEach((file) => { try { fs.unlinkSync(file); } catch (_ignored) {} });
    throw error;
  } finally {
    if (backupDatabase) backupDatabase.close();
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".ico")) return "image/x-icon";
  if (file.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (file.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (file.endsWith(".doc")) return "application/msword";
  if (file.endsWith(".zip")) return "application/zip";
  if (file.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function attachmentPath(id) {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("附件标识无效。");
  return path.join(UPLOAD_DIR, id.toLowerCase());
}

function saveAttachment(nameValue, content) {
  const name = String(nameValue || "附件").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "附件";
  if (!Buffer.isBuffer(content) || !content.length || content.length > MAX_ATTACHMENT_BYTES) throw httpError(400, "单个附件须大于 0 且不超过 100MB。");
  const existingBytes = fs.readdirSync(UPLOAD_DIR).reduce((sum, file) => {
    try { const stat = fs.statSync(path.join(UPLOAD_DIR, file)); return sum + (stat.isFile() ? stat.size : 0); } catch (_error) { return sum; }
  }, 0);
  /* 加密后的文件会多出 IV、认证标签等少量字节，预留 1KB。 */
  if (existingBytes + content.length + 1024 > MAX_ATTACHMENT_TOTAL_BYTES) throw httpError(413, `附件总容量已达到 ${Math.floor(MAX_ATTACHMENT_TOTAL_BYTES / 1024 / 1024)}MB 上限，请先清理或隔离不再使用的附件。`);
  const id = crypto.randomUUID();
  fs.writeFileSync(attachmentPath(id), encryptBuffer(content), { flag: "wx" });
  return { id, name, size: content.length, url: `/attachments/${id}` };
}

function deleteAttachment(id) {
  const state = attachmentMaintenanceState();
  if (state.referenceIds.has(id.toLowerCase())) throw httpError(409, "附件仍被业务记录引用，不能删除。请先保存记录变更后再重试。");
  const file = attachmentPath(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { deleted: true };
}

function attachmentMaintenanceState() {
  const references = new Set();
  // Maintenance, recycle-bin retention and merge restore must agree on live references.
  Object.values(readStore()).forEach((value) => { try { collectAttachmentReferences(JSON.parse(value), references); } catch (_error) { collectAttachmentReferences(value, references); } });
  /* 回收站中的附件在彻底删除前仍是有效引用，不能被孤立附件维护误隔离。 */
  database.prepare("SELECT attachment_ids_json FROM recycle_bin WHERE status IN ('active','restore_failed')").all().forEach((row) => {
    try { JSON.parse(decryptText(row.attachment_ids_json)).forEach((id) => { if (/^[a-f0-9-]{36}$/i.test(String(id || ""))) references.add(String(id).toLowerCase()); }); } catch (_error) {}
  });
  const files = fs.readdirSync(UPLOAD_DIR).filter((name) => /^[a-f0-9-]{36}$/i.test(name) && fs.statSync(path.join(UPLOAD_DIR, name)).isFile());
  const fileSet = new Set(files.map(id => id.toLowerCase()));
  const orphanIds = files.filter((id) => !references.has(id.toLowerCase()));
  const missingIds = [...references].filter((id) => !fileSet.has(id));
  return { totalFiles: files.length, referencedCount: references.size, orphanCount: orphanIds.length, missingCount: missingIds.length, orphanIds, missingIds, referenceIds: references };
}

function attachmentMaintenanceReport() {
  const state = attachmentMaintenanceState();
  const totalBytes = fs.readdirSync(UPLOAD_DIR).reduce((sum, name) => { try { const stat = fs.statSync(path.join(UPLOAD_DIR, name)); return sum + (stat.isFile() ? stat.size : 0); } catch (_error) { return sum; } }, 0);
  return { totalFiles: state.totalFiles, referencedCount: state.referencedCount, orphanCount: state.orphanCount, missingCount: state.missingCount, totalBytes, quotaBytes: MAX_ATTACHMENT_TOTAL_BYTES, recoverableAction: "quarantine" };
}

function quarantineOrphanAttachments(body) {
  const state = attachmentMaintenanceState();
  if (!body || body.action !== "quarantine" || body.phrase !== "隔离孤立附件" || Number(body.confirmCount) !== state.orphanCount) throw httpError(400, "附件隔离确认信息不匹配，请重新扫描。");
  if (!state.orphanCount) return { quarantined: 0, relativePath: "", recoverable: true };
  const folder = path.join(DATA_DIR, "attachments-quarantine", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(folder, { recursive: true });
  state.orphanIds.forEach((id) => fs.renameSync(attachmentPath(id), path.join(folder, id)));
  const relativePath = path.relative(ROOT, folder);
  return { quarantined: state.orphanCount, relativePath, recoverable: true };
}

function send(response, status, body, type = "application/json; charset=utf-8", extraHeaders = {}) {
  response.writeHead(status, Object.assign({
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self' data:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self' blob:; object-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'none'"
  }, extraHeaders));
  response.end(body);
}

function sendCompressed(request, response, status, asset, type, cacheControl, extraHeaders = {}) {
  const headers = Object.assign({ "Cache-Control": cacheControl, "ETag": asset.etag, "Vary": "Accept-Encoding" }, extraHeaders);
  if (request.headers["if-none-match"] === asset.etag) return send(response, 304, "", type, headers);
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(request.headers["accept-encoding"] || ""));
  if (acceptsGzip) {
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = String(asset.gzip.length);
    return send(response, status, asset.gzip, type, headers);
  }
  headers["Content-Length"] = String(asset.raw.length);
  return send(response, status, asset.raw, type, headers);
}

function compressedAsset(body) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  return { raw, gzip: zlib.gzipSync(raw, { level: 6 }), etag: `"${crypto.createHash("sha256").update(raw).digest("hex")}"` };
}

function sendJson(response, status, value, extraHeaders = {}) {
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8", extraHeaders);
}

function redirect(response, location) {
  send(response, 302, "", "text/plain; charset=utf-8", { Location: location });
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.expose = true;
  return error;
}

function readBuffer(request, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"] || 0);
    if (Number.isFinite(declared) && declared > limit) {
      request.resume();
      reject(httpError(413, `请求数据超过 ${Math.floor(limit / 1024 / 1024)}MB 限制。`));
      return;
    }
    let size = 0;
    let settled = false;
    const chunks = [];
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        chunks.length = 0;
        reject(httpError(413, `请求数据超过 ${Math.floor(limit / 1024 / 1024)}MB 限制。`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try { assertRequestSession(request); resolve(Buffer.concat(chunks)); } catch (error) { chunks.length = 0; reject(error); }
    });
    request.on("error", (error) => { if (!settled) { settled = true; reject(error); } });
    request.on("aborted", () => { if (!settled) { settled = true; chunks.length = 0; reject(httpError(400, "请求已中断，未执行保存。")); } });
  });
}

async function readJson(request) {
  const content = await readBuffer(request, MAX_BODY_BYTES);
  try { return content.length ? JSON.parse(content.toString("utf8")) : {}; }
  catch (_error) { throw httpError(400, "请求格式错误。"); }
}

async function readAcademicWarningJson(request) {
  const content = await readBuffer(request, MAX_ACADEMIC_WARNING_BODY_BYTES);
  try { return content.length ? JSON.parse(content.toString("utf8")) : {}; }
  catch (_error) { throw httpError(400, "学业预警（个人版）生成数据格式错误。"); }
}

function verifyAcademicWarningTemplate() {
  if (!fs.existsSync(ACADEMIC_WARNING_TEMPLATE_PATH) || !fs.existsSync(ACADEMIC_WARNING_SCRIPT_PATH)) throw httpError(500, "原始学业预警（个人版）附件模板或生成程序缺失。");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(ACADEMIC_WARNING_TEMPLATE_PATH)).digest("hex");
  if (actual !== ACADEMIC_WARNING_TEMPLATE_SHA256) throw httpError(500, "原始学业预警（个人版）附件模板已被修改，系统已停止生成以保护版式。");
}

function academicWarningCustomTemplateMeta() {
  try {
    if (!fs.existsSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH) || !fs.existsSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH)) return null;
    const value = JSON.parse(fs.readFileSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH, "utf8"));
    if (!value || typeof value !== "object" || ![".doc", ".docx"].includes(value.extension)) return null;
    return { name: path.basename(String(value.name || `学业预警（个人版）附件1-5自定义模板${value.extension}`)).slice(0, 180), extension: value.extension, size: Number(value.size || 0), sha256: String(value.sha256 || ""), updatedAt: String(value.updatedAt || "") };
  } catch (_error) { return null; }
}

function academicWarningTemplateStatus() {
  const custom = academicWarningCustomTemplateMeta();
  return custom ? { mode: "custom", label: "自定义模板", name: custom.name, size: custom.size, sha256: custom.sha256, updatedAt: custom.updatedAt, canReset: true }
    : { mode: "default", label: "系统默认模板", name: "学业预警（个人版）附件1-5系统模板.doc", size: fs.existsSync(ACADEMIC_WARNING_TEMPLATE_PATH) ? fs.statSync(ACADEMIC_WARNING_TEMPLATE_PATH).size : 0, sha256: ACADEMIC_WARNING_TEMPLATE_SHA256, updatedAt: "", canReset: false };
}

function academicWarningTemplateBytes() {
  const custom = academicWarningCustomTemplateMeta();
  if (custom) {
    try {
      const content = decryptBuffer(fs.readFileSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH));
      const actual = crypto.createHash("sha256").update(content).digest("hex");
      if (actual !== custom.sha256 || content.length !== custom.size) throw new Error("校验值不一致");
      return { content, name: custom.name, extension: custom.extension, custom: true };
    } catch (error) { throw httpError(500, `自定义学业预警（个人版）模板读取失败：${error.message}`); }
  }
  verifyAcademicWarningTemplate();
  return { content: fs.readFileSync(ACADEMIC_WARNING_TEMPLATE_PATH), name: "学业预警（个人版）附件1-5系统模板.doc", extension: ".doc", custom: false };
}

function stopOwnedAcademicWarningProcess(child, ownershipPath) {
  try { child.kill(); } catch (_) {}
  let owner;
  try { owner = JSON.parse(fs.readFileSync(ownershipPath, "utf8").replace(/^\uFEFF/, "")); } catch (_) {}
  if (!owner || owner.version !== 1 || owner.owned !== true || owner.ownerPid !== child.pid || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid === child.pid || owner.pid === process.pid || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(owner.startedAt)) return Promise.resolve();
  // Both interpolated values are validated above. Recheck creation time to avoid PID reuse.
  const script = `$ownedWord=Get-Process -Id ${owner.pid} -ErrorAction SilentlyContinue; if($null -ne $ownedWord -and $ownedWord.ProcessName -ieq 'WINWORD' -and $ownedWord.StartTime.ToUniversalTime().ToString('o') -ceq '${owner.startedAt}'){Stop-Process -Id $ownedWord.Id -Force -ErrorAction Stop; $ownedWord.WaitForExit(3000) | Out-Null}`;
  return new Promise(resolve => {
    const cleanup = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { try { cleanup.kill(); } catch (_) {} resolve(); }, 5000);
    const done = () => { clearTimeout(timer); resolve(); };
    cleanup.once("error", done); cleanup.once("close", done);
  });
}

function validateAcademicWarningTemplateFile(filePath) {
  if (!fs.existsSync(ACADEMIC_WARNING_TEMPLATE_VALIDATOR_PATH)) return Promise.reject(httpError(500, "学业预警（个人版）模板校验程序缺失。"));
  return new Promise((resolve, reject) => {
    const ownershipPath = path.join(path.dirname(filePath), "word-owner.json");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ACADEMIC_WARNING_TEMPLATE_VALIDATOR_PATH, "-TemplatePath", filePath, "-OwnershipPath", ownershipPath], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; stopOwnedAcademicWarningProcess(child, ownershipPath).finally(() => reject(httpError(504, "Word 模板校验超时，请检查模板后重试。"))); }, 90000);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString("utf8")).slice(-32768); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-32768); });
    child.on("error", (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(httpError(500, `无法启动 Microsoft Word 模板校验：${error.message}`)); });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); if (code !== 0) reject(httpError(400, `模板结构校验失败：${stderr.trim() || stdout.trim() || `退出代码 ${code}`}`)); else resolve(stdout.trim()); });
  });
}

function commitAcademicWarningTemplate(content, meta) {
  const suffix = crypto.randomUUID(), moved = [], installed = [];
  const files = [
    { target: ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH, data: encryptBuffer(content) },
    { target: ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH, data: Buffer.from(JSON.stringify(meta, null, 2), "utf8") }
  ].map(file => ({ ...file, temporary: `${file.target}.${suffix}.tmp`, previous: `${file.target}.${suffix}.rollback` }));
  let complete = false, recovered = false;
  try {
    for (const file of files) fs.writeFileSync(file.temporary, file.data, { mode: 0o600, flag: "wx" });
    for (const file of files) if (fs.existsSync(file.target)) { fs.renameSync(file.target, file.previous); moved.push(file); }
    for (const file of files) { fs.renameSync(file.temporary, file.target); installed.push(file); }
    complete = true;
  } catch (error) {
    try {
      for (const file of installed) fs.rmSync(file.target, { force: true });
      for (const file of moved.slice().reverse()) fs.renameSync(file.previous, file.target);
      recovered = true;
    } catch (recoveryError) {
      if (typeof log === "function") log("Word 模板提交失败且回退未完成，已保留加密 rollback 文件供受控恢复。");
    }
    throw error;
  } finally {
    for (const file of files) {
      try { fs.rmSync(file.temporary, { force: true }); } catch (_) {}
      if (complete || recovered) try { fs.rmSync(file.previous, { force: true }); } catch (_) {}
    }
  }
}

async function saveAcademicWarningCustomTemplate(request, url) {
  const name = path.basename(String(url.searchParams.get("name") || "学业预警（个人版）附件1-5自定义模板.doc")).slice(0, 180), extension = path.extname(name).toLowerCase();
  if (![".doc", ".docx"].includes(extension)) throw httpError(400, "仅支持导入 .doc 或 .docx Word 模板。");
  const content = await readBuffer(request, MAX_ACADEMIC_WARNING_TEMPLATE_BYTES);
  if (!content.length) throw httpError(400, "导入的 Word 模板为空。");
  const isDoc = content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isDocx = content.length >= 4 && content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if ((extension === ".doc" && !isDoc) || (extension === ".docx" && !isDocx)) throw httpError(400, "文件内容与 Word 扩展名不一致，请重新选择模板。");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-aw-template-")), tempPath = path.join(tempDir, `template${extension}`);
  try {
    fs.writeFileSync(tempPath, content, { flag: "wx" });
    return await queueAcademicWarningRender(async () => {
      assertRequestSession(request);
      await validateAcademicWarningTemplateFile(tempPath);
      assertRequestSession(request);
      const meta = { name, extension, size: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex"), updatedAt: new Date().toISOString() };
      commitAcademicWarningTemplate(content, meta);
      return Object.assign({ ok: true }, academicWarningTemplateStatus());
    });
  } finally { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) {} }
}

function resetAcademicWarningCustomTemplate() {
  if (fs.existsSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH)) fs.rmSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_PATH, { force: false });
  if (fs.existsSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH)) fs.rmSync(ACADEMIC_WARNING_CUSTOM_TEMPLATE_META_PATH, { force: false });
  return Object.assign({ ok: true }, academicWarningTemplateStatus());
}

function validateAcademicWarningPayload(body, batch) {
  const requestedFormat = String(body && body.format || "word");
  const format = requestedFormat === "pdf" || requestedFormat === "editor-html" ? requestedFormat : "word";
  if (batch && format === "editor-html") throw httpError(400, "学业预警（个人版）网页模板不支持批量生成。");
  const items = batch ? (body && body.items) : [body && body.item];
  if (!Array.isArray(items) || !items.length || items.length > 2000 || items.some((item) => !item || typeof item !== "object")) throw httpError(400, "学业预警（个人版）生成数据无效。");
  return { format, items };
}

function queueAcademicWarningRender(task) {
  if (academicWarningRenderPending >= 8) return Promise.reject(httpError(429, "Word 任务较多，请等待当前任务完成后重试。"));
  academicWarningRenderPending++;
  const next = academicWarningRenderQueue.then(task, task);
  academicWarningRenderQueue = next.catch(() => {});
  return next.finally(() => { academicWarningRenderPending--; });
}

function queueAcademicAnalysis(task) {
  const next = academicAnalysisQueue.then(task, task);
  academicAnalysisQueue = next.catch(() => {});
  return next;
}

function academicAnalysisPythonCandidates() {
  const candidates = [];
  const configured = String(process.env.XIANGCAI_PYTHON || "").trim();
  if (configured) candidates.push({ command: configured, prefix: [] });
  const bundled = path.join(ROOT, "runtime", "python", "python.exe");
  if (fs.existsSync(bundled)) candidates.push({ command: bundled, prefix: [] });
  const localPrograms = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python") : "";
  if (localPrograms && fs.existsSync(localPrograms)) {
    fs.readdirSync(localPrograms, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^Python\d+$/i.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name)).forEach((entry) => {
      const executable = path.join(localPrograms, entry.name, "python.exe");
      if (fs.existsSync(executable)) candidates.push({ command: executable, prefix: [] });
    });
  }
  candidates.push({ command: "py.exe", prefix: ["-3"] }, { command: "python.exe", prefix: [] });
  return candidates.filter((candidate, index, all) => all.findIndex((row) => row.command.toLowerCase() === candidate.command.toLowerCase() && row.prefix.join(" ") === candidate.prefix.join(" ")) === index);
}

function runAcademicAnalysisProcess(candidate, inputPath, originalName, teacherPath, teacherName) {
  return new Promise((resolve, reject) => {
    const args = candidate.prefix.concat([ACADEMIC_ANALYSIS_SCRIPT_PATH, "--analyze", inputPath, originalName]);
    if (teacherPath) args.push("--teachers", teacherPath, teacherName || "班主任名单.xlsx");
    const child = spawn(candidate.command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { ACADEMIC_ANALYSIS_RUNS: ACADEMIC_ANALYSIS_RUN_DIR, PYTHONIOENCODING: "utf-8" }) });
    let stdout = "", stderr = "", settled = false;
    const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-1024 * 1024);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => { if (!settled) { settled = true; child.kill(); reject(new Error("学业分析运行超时。")); } }, 5 * 60 * 1000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timeout); reject(error); } });
    child.on("close", (code) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let payload = null;
      for (let index = lines.length - 1; index >= 0; index--) { try { payload = JSON.parse(lines[index]); break; } catch (_error) {} }
      if (code !== 0 || !payload || payload.ok !== true) return reject(new Error(payload && payload.error || stderr.trim().slice(-800) || "Python 统计引擎运行失败。"));
      resolve(payload);
    });
  });
}

async function runAcademicAnalysis(content, originalName, teacherContent, teacherName) {
  if (!fs.existsSync(ACADEMIC_ANALYSIS_SCRIPT_PATH)) throw httpError(500, "学业分析生成程序缺失。");
  const name = path.basename(String(originalName || "单学期成绩.xlsx")).replace(/[\r\n]/g, "").slice(0, 180);
  if (!/\.xlsx$/i.test(name) || /^~\$/.test(name)) throw httpError(400, "仅支持非锁定的 .xlsx 文件。");
  if (!Buffer.isBuffer(content) || !content.length) throw httpError(400, "请选择成绩文件。");
  fs.mkdirSync(ACADEMIC_ANALYSIS_RUN_DIR, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shuzhi-academic-analysis-"));
  const inputPath = path.join(tempDir, "input.xlsx");
  fs.writeFileSync(inputPath, content);
  let teacherPath = "";
  if (teacherContent) {
    const safeTeacherName = path.basename(String(teacherName || "班主任名单.xlsx")).replace(/[\r\n]/g, "").slice(0, 180);
    if (!/\.xlsx$/i.test(safeTeacherName) || /^~\$/.test(safeTeacherName)) throw httpError(400, "班主任名单仅支持非锁定的 .xlsx 文件。");
    if (!Buffer.isBuffer(teacherContent) || !teacherContent.length) throw httpError(400, "班主任名单文件为空。");
    teacherPath = path.join(tempDir, "teachers.xlsx");
    fs.writeFileSync(teacherPath, teacherContent);
    teacherName = safeTeacherName;
  }
  let lastError = null;
  try {
    for (const candidate of academicAnalysisPythonCandidates()) {
      try {
        const payload = await runAcademicAnalysisProcess(candidate, inputPath, name, teacherPath, teacherName);
        const runId = String(payload.runId || "");
        if (!/^\d{8}-\d{6}-[a-f0-9]{6}$/i.test(runId)) throw new Error("统计引擎返回了无效任务编号。");
        const base = `/api/academic-analysis/download/${runId}`;
        return { ok: true, runId, overview: payload.overview || {}, aiSummary: payload.aiSummary || null, downloads: { summary: `${base}/summary`, reports: `${base}/reports`, audit: `${base}/audit` } };
      } catch (error) {
        lastError = error;
        if (!/ENOENT|not recognized|cannot find/i.test(String(error && error.message || error))) break;
      }
    }
    const detail = String(lastError && lastError.message || "");
    if (/No module named|ModuleNotFoundError/i.test(detail)) throw httpError(503, "本机 Python 缺少 openpyxl、python-docx 或 Pillow，请先安装学业分析运行组件。");
    throw httpError(400, detail || "学业分析生成失败。");
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) {}
  }
}

function parseAcademicAnalysisMultipart(contentType, body) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ""));
  if (!boundaryMatch) throw httpError(400, "上传格式无效，请重新选择文件。");
  const boundary = Buffer.from("--" + (boundaryMatch[1] || boundaryMatch[2]));
  const parts = {};
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf(boundary, cursor);
    if (start < 0) break;
    const headerStart = start + boundary.length;
    if (body.slice(headerStart, headerStart + 2).toString() === "--") break;
    const dataStart = headerStart + 2;
    const next = body.indexOf(boundary, dataStart);
    if (next < 0) break;
    const part = body.slice(dataStart, next - 2);
    const divider = part.indexOf(Buffer.from("\r\n\r\n"));
    if (divider >= 0) {
      const header = part.slice(0, divider).toString("utf8");
      const nameMatch = /(?:^|;)\s*name="([^"]+)"/im.exec(header);
      const fileMatch = /(?:^|;)\s*filename="([^"]*)"/im.exec(header);
      if (nameMatch && fileMatch) parts[nameMatch[1]] = { name: path.basename(fileMatch[1] || "上传文件.xlsx"), content: part.slice(divider + 4) };
    }
    cursor = next;
  }
  if (!parts.file || !parts.file.content.length) throw httpError(400, "请选择成绩文件。");
  return parts;
}

function academicAnalysisDownload(runId, kind) {
  if (!/^\d{8}-\d{6}-[a-f0-9]{6}$/i.test(runId)) return null;
  const files = {
    summary: { name: "学业考试成绩分析统计表.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    reports: { name: "学业分析报告.zip", type: "application/zip" },
    audit: { name: "校验报告.json", type: "application/json; charset=utf-8" }
  };
  const meta = files[kind]; if (!meta) return null;
  const filePath = path.join(ACADEMIC_ANALYSIS_RUN_DIR, runId, meta.name);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return { data: fs.readFileSync(filePath), name: meta.name, type: meta.type };
}

function deleteAcademicAnalysisRun(runId) {
  if (!/^\d{8}-\d{6}-[a-f0-9]{6}$/i.test(String(runId || ""))) throw httpError(400, "学业分析任务编号无效。");
  const root = path.resolve(ACADEMIC_ANALYSIS_RUN_DIR), target = path.resolve(root, runId);
  if (!target.startsWith(root + path.sep)) throw httpError(400, "学业分析任务路径无效。");
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 120 });
  return { ok: true, deleted: true, runId };
}

function listAcademicAnalysisHistory() {
  if (!fs.existsSync(ACADEMIC_ANALYSIS_RUN_DIR)) return [];
  const records = [];
  for (const entry of fs.readdirSync(ACADEMIC_ANALYSIS_RUN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{8}-\d{6}-[a-f0-9]{6}$/i.test(entry.name)) continue;
    const runDir = path.join(ACADEMIC_ANALYSIS_RUN_DIR, entry.name);
    const auditPath = path.join(runDir, "校验报告.json");
    let audit = {};
    try { audit = fs.existsSync(auditPath) ? JSON.parse(fs.readFileSync(auditPath, "utf8")) : {}; } catch (_error) { audit = {}; }
    const available = {
      summary: fs.existsSync(path.join(runDir, "学业考试成绩分析统计表.xlsx")),
      reports: fs.existsSync(path.join(runDir, "学业分析报告.zip")),
      audit: fs.existsSync(auditPath)
    };
    if (!available.summary && !available.reports && !available.audit) continue;
    let createdAt = String(audit.created_at || "");
    if (!createdAt) {
      try { createdAt = fs.statSync(runDir).birthtime.toISOString(); } catch (_error) { createdAt = ""; }
    }
    const base = `/api/academic-analysis/download/${entry.name}`;
    records.push({
      runId: entry.name,
      createdAt,
      sourceFile: path.basename(String(audit.source_file || "成绩文件.xlsx")).slice(0, 180),
      classes: Number(audit.classes || 0),
      students: Number(audit.students || 0),
      validRecords: Number(audit.valid_records || 0),
      issueCount: Array.isArray(audit.issues) ? audit.issues.length : 0,
      available,
      downloads: { summary: `${base}/summary`, reports: `${base}/reports`, audit: `${base}/audit` }
    });
  }
  return records.sort((a, b) => String(b.createdAt || b.runId).localeCompare(String(a.createdAt || a.runId))).slice(0, 100);
}

function runAcademicWarningPowerShell(body, batch) {
  const validated = validateAcademicWarningPayload(body, batch);
  const selectedTemplate = academicWarningTemplateBytes();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiangcai-aw-"));
  const inputPath = path.join(tempDir, "input.json");
  const outputPath = path.join(tempDir, batch ? "academic-warning.zip" : (validated.format === "pdf" ? "academic-warning.pdf" : validated.format === "editor-html" ? "academic-warning.html" : "academic-warning.doc"));
  let templatePath = ACADEMIC_WARNING_TEMPLATE_PATH;
  try {
    if (selectedTemplate.custom) {
      templatePath = path.join(tempDir, `academic-warning-template${selectedTemplate.extension}`);
      fs.writeFileSync(templatePath, selectedTemplate.content, { flag: "wx" });
    }
    fs.writeFileSync(inputPath, JSON.stringify(batch ? { items: validated.items } : { item: validated.items[0] }), "utf8");
  } catch (error) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    throw error;
  }
  const ownershipPath = path.join(tempDir, "word-owner.json");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ACADEMIC_WARNING_SCRIPT_PATH, "-TemplatePath", templatePath, "-InputPath", inputPath, "-OutputPath", outputPath, "-Format", validated.format, "-OwnershipPath", ownershipPath];
  if (batch) args.push("-Batch");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const limit = 64 * 1024;
    const append = (current, chunk) => (current + chunk.toString("utf8")).slice(-limit);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopOwnedAcademicWarningProcess(child, ownershipPath).finally(() => {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) {}
        reject(httpError(504, "Word 生成学业预警（个人版）附件超时。"));
      });
    }, batch ? 10 * 60 * 1000 : 90 * 1000);
    child.on("error", (error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) {}
      reject(httpError(500, `无法启动 Microsoft Word 生成程序：${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      try {
        if (code !== 0 || !fs.existsSync(outputPath)) throw httpError(500, `Microsoft Word 生成附件失败。${stderr.trim() || stdout.trim() || `退出代码 ${code}`}`);
        let output = fs.readFileSync(outputPath);
        if (validated.format === "editor-html") {
          const asciiHead = output.subarray(0, Math.min(output.length, 4096)).toString("latin1");
          const charsetMatch = asciiHead.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i);
          const charset = String(charsetMatch && charsetMatch[1] || "windows-1252").toLowerCase();
          let html;
          try { html = new TextDecoder(charset === "gb2312" ? "gb18030" : charset).decode(output); }
          catch (_error) { html = new TextDecoder("gb18030").decode(output); }
          html = html.replace(/charset\s*=\s*["']?[a-z0-9_-]+/ig, "charset=utf-8");
          const assetRoot = path.dirname(outputPath);
          const inlineAsset = (reference) => {
            const decoded = decodeURIComponent(String(reference || "").replace(/\\/g, "/"));
            if (!decoded || /^(?:data:|https?:|#)/i.test(decoded)) return reference;
            const target = path.resolve(assetRoot, decoded);
            if (!target.startsWith(path.resolve(assetRoot) + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return reference;
            const extension = path.extname(target).toLowerCase();
            const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".wmf": "image/wmf", ".emf": "image/emf" })[extension];
            return mime ? `data:${mime};base64,${fs.readFileSync(target).toString("base64")}` : reference;
          };
          html = html.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (all, attrName, quote, reference) => `${attrName}=${quote}${inlineAsset(reference)}${quote}`);
          html = html.replace(/url\((['"]?)([^)'"\s]+)\1\)/gi, (all, quote, reference) => `url(${quote}${inlineAsset(reference)}${quote})`);
          output = Buffer.from(html, "utf8");
        }
        resolve({ output, format: validated.format });
      } catch (error) {
        reject(error);
      } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) {}
      }
    });
  });
}

function academicWarningDisposition(filename) {
  const safe = String(filename || "academic-warning").replace(/[\r\n"]/g, "_");
  return `attachment; filename="academic-warning"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function isLocalRequest(request) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function parseCookies(request) {
  const out = {};
  String(request.headers.cookie || "").split(";").forEach((part) => {
    const pos = part.indexOf("=");
    if (pos <= 0) return;
    const key = part.slice(0, pos).trim();
    try { out[key] = decodeURIComponent(part.slice(pos + 1).trim()); } catch (_error) {}
  });
  return out;
}

function loadLocalAuth() {
  try {
    const row = database.prepare("SELECT password_json FROM local_auth WHERE id=1").get();
    return row ? JSON.parse(row.password_json) : null;
  } catch (_error) { return null; }
}

function loadPortableDataKeyFile(file = PORTABLE_DATA_KEY_PATH) {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    const key = Buffer.from(String(saved?.key || ""), "base64");
    if (saved?.version !== 1 || key.length !== 32) return null;
    return key;
  } catch (_error) { return null; }
}

function loadPortableDataKey() { return loadPortableDataKeyFile(PORTABLE_DATA_KEY_PATH); }

function activateDataKey(nextKey) {
  const key = Buffer.from(nextKey || []);
  if (key.length !== 32) throw new Error("便携数据密钥格式无效。");
  if (activeDataKey) activeDataKey.fill(0);
  activeDataKey = key;
}

function savePortableDataKey(dataKey) {
  const key = Buffer.from(dataKey || []);
  if (key.length !== 32) throw new Error("便携数据密钥格式无效。");
  const temporary = `${PORTABLE_DATA_KEY_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, key: key.toString("base64"), createdAt: new Date().toISOString() }), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, PORTABLE_DATA_KEY_PATH);
}

function enablePortableDataMode() {
  const portableKey = loadPortableDataKey();
  if (portableKey) {
    activateDataKey(portableKey);
    return { ready: true, migrated: false };
  }
  if (loadLocalAuth()) return { ready: false, migrated: false };
  const key = crypto.randomBytes(32);
  try { savePortableDataKey(key); }
  finally { activateDataKey(key); key.fill(0); }
  return { ready: true, migrated: true };
}

function migrateLegacyPasswordToPortableMode(password) {
  if (!loadLocalAuth()) throw new Error("当前数据不需要密码迁移。");
  if (!verifyLocalPassword(password)) throw new Error("原本机密码不正确。");
  unlockSensitiveData(password);
  try {
    savePortableDataKey(activeDataKey);
    migrateSensitiveData();
    migrateCoreLegacyStore();
    purgeRetiredNameCheckHistory();
    purgeRetiredCounselorGrowthPlans();
    purgeRetiredKnowledgeFeature();
    purgeRetiredStudentLegacyFields();
    backfillStudentIdentityBlanks();
    database.prepare("DELETE FROM local_auth WHERE id=1").run();
    log("已完成免密进入迁移；数据密钥已随 data/ 保存。");
  } catch (error) {
    try { fs.unlinkSync(PORTABLE_DATA_KEY_PATH); } catch (_ignored) {}
    lockSensitiveData();
    throw error;
  }
}

function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 10) throw new Error("本机密码至少需要 10 个字符。");
  if (password.length > 256) throw new Error("本机密码不能超过 256 个字符。");
}

function passwordDigest(password, salt, options) {
  return crypto.scryptSync(password, salt, 32, {
    N: options.N || 16384,
    r: options.r || 8,
    p: options.p || 1,
    maxmem: 64 * 1024 * 1024
  });
}

function wrapDataKey(password, dataKey, params) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const wrappingKey = passwordDigest(password, salt, params);
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", wrappingKey, iv);
    cipher.setAAD(Buffer.from("xiangcai-data-key-v1", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return { keySalt: salt.toString("base64"), keyIv: iv.toString("base64"), keyCiphertext: ciphertext.toString("base64"), keyTag: cipher.getAuthTag().toString("base64") };
  } finally { wrappingKey.fill(0); }
}

function unwrapDataKey(password, saved) {
  const wrappingKey = passwordDigest(password, Buffer.from(saved.keySalt || "", "base64"), saved);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(saved.keyIv || "", "base64"));
    decipher.setAAD(Buffer.from("xiangcai-data-key-v1", "utf8"));
    decipher.setAuthTag(Buffer.from(saved.keyTag || "", "base64"));
    return Buffer.concat([decipher.update(Buffer.from(saved.keyCiphertext || "", "base64")), decipher.final()]);
  } finally { wrappingKey.fill(0); }
}

function setLocalPassword(password, dataKey = activeDataKey) {
  validateNewPassword(password);
  const salt = crypto.randomBytes(16);
  const params = { version: 1, N: 16384, r: 8, p: 1, salt: salt.toString("base64") };
  params.hash = passwordDigest(password, salt, params).toString("base64");
  const key = dataKey ? Buffer.from(dataKey) : crypto.randomBytes(32);
  Object.assign(params, wrapDataKey(password, key, params));
  database.prepare("INSERT INTO local_auth(id,password_json,updated_at) VALUES(1,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET password_json=excluded.password_json,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(params));
  if (activeDataKey) activeDataKey.fill(0);
  activeDataKey = key;
}

function verifyLocalPassword(password) {
  const saved = loadLocalAuth();
  if (!saved || typeof password !== "string") return false;
  try {
    const expected = Buffer.from(saved.hash || "", "base64");
    const actual = passwordDigest(password, Buffer.from(saved.salt || "", "base64"), saved);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_error) { return false; }
}

function unlockSensitiveData(password) {
  const saved = loadLocalAuth();
  if (!saved) throw new Error("尚未设置本机密码。");
  let key;
  if (saved.keyCiphertext && saved.keySalt && saved.keyIv && saved.keyTag) key = unwrapDataKey(password, saved);
  else {
    /* 兼容已经启用本机密码、但尚未生成数据密钥的过渡版本。 */
    key = crypto.randomBytes(32);
    setLocalPassword(password, key);
  }
  if (key.length !== 32) throw new Error("本机数据密钥格式无效。");
  if (activeDataKey) activeDataKey.fill(0);
  activeDataKey = Buffer.from(key);
  key.fill(0);
}

function requireDataKey() {
  if (!activeDataKey || activeDataKey.length !== 32) throw new Error("敏感数据尚未解锁，请重新登录。");
  return activeDataKey;
}

function lockSensitiveData() {
  if (activeDataKey) activeDataKey.fill(0);
  activeDataKey = null;
}

function encryptBuffer(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", requireDataKey(), iv);
  cipher.setAAD(Buffer.from("xiangcai-sensitive-v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
  return Buffer.concat([Buffer.from("XCA1", "ascii"), iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBuffer(value, dataKey) {
  const input = Buffer.from(value);
  if (input.length < 32 || input.subarray(0, 4).toString("ascii") !== "XCA1") return input;
  const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey || requireDataKey(), input.subarray(4, 16));
  decipher.setAAD(Buffer.from("xiangcai-sensitive-v1", "utf8"));
  decipher.setAuthTag(input.subarray(16, 32));
  return Buffer.concat([decipher.update(input.subarray(32)), decipher.final()]);
}

function isEncryptedText(value) { return typeof value === "string" && value.startsWith("xcenc:v1:"); }
function encryptText(value) { return isEncryptedText(value) ? value : `xcenc:v1:${encryptBuffer(Buffer.from(String(value), "utf8")).toString("base64")}`; }
function decryptText(value) {
  if (!isEncryptedText(value)) return value;
  return decryptBuffer(Buffer.from(value.slice("xcenc:v1:".length), "base64")).toString("utf8");
}
function purgeRetiredNameCheckHistory() {
  if (!activeDataKey) return 0;
  return database.prepare("DELETE FROM legacy_ui_store WHERE key='nnuzc_tool_history_index_name_check_v1' OR key GLOB 'nnuzc_tool_history_record_name_check_*_v1'").run().changes;
}
function purgeRetiredCounselorGrowthPlans() {
  return database.prepare("DELETE FROM legacy_ui_store WHERE key='nnuzc_counselor_growth_plans_v1'").run().changes;
}
function purgeRetiredKnowledgeFeature() {
  if (!database) return 0;
  let changed = 0;
  changed += database.prepare("DELETE FROM legacy_ui_store WHERE key='nnuzc_kb'").run().changes;
  changed += database.prepare("DELETE FROM recycle_bin_audit WHERE module_key='aiKnowledge' OR entity_type='ai_knowledge_record'").run().changes;
  changed += database.prepare("DELETE FROM recycle_bin WHERE module_key='aiKnowledge' OR entity_type='ai_knowledge_record'").run().changes;
  changed += database.prepare("DELETE FROM ai_usage WHERE feature='knowledge'").run().changes;

  const demoRow = database.prepare("SELECT value FROM migration_meta WHERE key=?").get(DEMO_STATE_META_KEY);
  if (demoRow && demoRow.value) {
    try {
      const state = JSON.parse(demoRow.value);
      const hadRetiredKey = Array.isArray(state.keys) && state.keys.includes("nnuzc_kb");
      if (hadRetiredKey) {
        state.keys = state.keys.filter((key) => key !== "nnuzc_kb");
        if (state.baseline && typeof state.baseline === "object") delete state.baseline.nnuzc_kb;
        if (state.expected && typeof state.expected === "object") delete state.expected.nnuzc_kb;
        database.prepare("UPDATE migration_meta SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key=?").run(JSON.stringify(state), DEMO_STATE_META_KEY);
        changed++;
      }
    } catch (_error) { /* 旧版异常演示状态由现有状态校验处理。 */ }
  }

  if (!activeDataKey) return changed;
  const requestRows = database.prepare("SELECT request_id,response_json FROM recycle_bin_requests").all();
  const deleteRequest = database.prepare("DELETE FROM recycle_bin_requests WHERE request_id=?");
  requestRows.forEach((row) => {
    try {
      const plain = decryptText(row.response_json);
      if (plain.includes("nnuzc_kb") || plain.includes("aiKnowledge") || plain.includes("ai_knowledge_record")) changed += deleteRequest.run(row.request_id).changes;
    } catch (_error) { /* 无法解密的旧幂等记录不参与当前功能恢复。 */ }
  });
  const auditRows = database.prepare("SELECT id,note FROM ai_audit").all();
  const deleteAudit = database.prepare("DELETE FROM ai_audit WHERE id=?");
  auditRows.forEach((row) => {
    try { if (decryptText(row.note).includes("功能：knowledge")) changed += deleteAudit.run(row.id).changes; }
    catch (_error) { /* 无法解密的旧审计记录由现有保留策略处理。 */ }
  });
  const aiSecret = loadAiSecret();
  if (aiSecret && aiSecret.features && Object.prototype.hasOwnProperty.call(aiSecret.features, "knowledge")) {
    delete aiSecret.features.knowledge;
    saveAiSecret(aiSecret);
    changed++;
  }
  const navRow = database.prepare("SELECT value FROM legacy_ui_store WHERE key='nnuzc_nav_visibility_v1'").get();
  if (navRow) {
    try {
      const nav = JSON.parse(decryptText(navRow.value));
      const hidden = Array.isArray(nav) ? nav : nav && nav.hiddenViews;
      if (Array.isArray(hidden) && hidden.includes("knowledge")) {
        const cleaned = hidden.filter((view) => view !== "knowledge");
        const next = Array.isArray(nav) ? cleaned : Object.assign({}, nav, { hiddenViews: cleaned });
        database.prepare("UPDATE legacy_ui_store SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key='nnuzc_nav_visibility_v1'").run(encryptText(JSON.stringify(next)));
        changed++;
      }
    } catch (_error) { /* 无效旧导航配置由前端默认配置兜底。 */ }
  }
  return changed;
}
function purgeRetiredStudentLegacyFields() {
  if (!activeDataKey || !database) return 0;
  let changed = 0;
  const rows = database.prepare("SELECT rowid AS rid,data_json FROM students").all();
  const update = database.prepare("UPDATE students SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE rowid=?");
  rows.forEach((row) => {
    const student = parseProtectedJson(row.data_json, "students");
    if (!Object.prototype.hasOwnProperty.call(student, "remark1") && !Object.prototype.hasOwnProperty.call(student, "remark2") && !Object.prototype.hasOwnProperty.call(student, "customFields")) return;
    delete student.remark1;
    delete student.remark2;
    delete student.customFields;
    update.run(protectedJson(student), row.rid);
    changed++;
  });
  const legacy = database.prepare("SELECT value FROM legacy_ui_store WHERE key='nnuzc_students'").get();
  if (legacy) {
    try {
      const students = JSON.parse(decryptText(legacy.value));
      let legacyChanged = false;
      if (Array.isArray(students)) students.forEach((student) => {
        if (!student || typeof student !== "object" || (!Object.prototype.hasOwnProperty.call(student, "remark1") && !Object.prototype.hasOwnProperty.call(student, "remark2") && !Object.prototype.hasOwnProperty.call(student, "customFields"))) return;
        delete student.remark1;
        delete student.remark2;
        delete student.customFields;
        legacyChanged = true;
        changed++;
      });
      if (legacyChanged) database.prepare("UPDATE legacy_ui_store SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key='nnuzc_students'").run(encryptText(JSON.stringify(students)));
    } catch (_error) { /* 无效旧缓存由现有迁移校验处理。 */ }
  }
  return changed;
}
function protectedJson(value) { return encryptText(JSON.stringify(value)); }
function parseProtectedJson(value, label) { return parseJson(decryptText(value), label); }
function protectedStudentId(value) { return crypto.createHmac("sha256", requireDataKey()).update(`student:${String(value)}`, "utf8").digest("hex"); }
function protectedRecordId(namespace, value) { return crypto.createHmac("sha256", requireDataKey()).update(`record:${namespace}:${String(value)}`, "utf8").digest("hex"); }

function protectAttachmentFiles() {
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    const file = path.join(UPLOAD_DIR, name);
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    const content = fs.readFileSync(file);
    if (content.subarray(0, 4).toString("ascii") !== "XCA1") fs.writeFileSync(file, encryptBuffer(content));
  }
}

function finalizeEncryptionCleanup() {
  const done = database.prepare("SELECT value FROM migration_meta WHERE key='data_encryption_cleanup_v1'").get();
  if (done && done.value === "done") return;
  database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  database.exec("VACUUM;");
  database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  database.prepare("INSERT INTO migration_meta(key,value,updated_at) VALUES('data_encryption_cleanup_v1','done',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='done',updated_at=CURRENT_TIMESTAMP").run();
}

function migrateProtectedRecordIds() {
  const done = database.prepare("SELECT value FROM migration_meta WHERE key='protected_record_ids_v1'").get();
  if (done && done.value === "done") return;
  const columns = [
    ["party_history", "record_id", "party"], ["classroom_records", "record_id", "classroom"],
    ["student_dorm_records", "record_id", "student-dorm"], ["meetings", "id", "meeting"],
    ["talk_records", "id", "talk"], ["home_contacts", "id", "home"],
    ["punishment_records", "id", "punishment"], ["fund_records", "id", "fund"],
    ["dorm_distribution_records", "id", "dorm-distribution"]
  ];
  database.exec("BEGIN IMMEDIATE");
  try {
    columns.forEach(([table, column, namespace]) => {
      validateTable(table);
      validateColumn(column);
      const rows = database.prepare(`SELECT rowid AS rid,${column} AS value FROM ${table}`).all();
      const update = database.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
      rows.forEach((row) => update.run(protectedRecordId(namespace, row.value), row.rid));
    });
    database.prepare("INSERT INTO migration_meta(key,value,updated_at) VALUES('protected_record_ids_v1','done',CURRENT_TIMESTAMP)").run();
    database.exec("COMMIT");
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function migrateAdditionalSensitiveColumns() {
  const done = database.prepare("SELECT value FROM migration_meta WHERE key='protected_columns_v1'").get();
  if (done && done.value === "done") return;
  database.exec("BEGIN IMMEDIATE");
  try {
    const classRows = database.prepare("SELECT rowid AS rid,counselor,teacher FROM class_groups").all();
    const updateClass = database.prepare("UPDATE class_groups SET counselor=?,teacher=? WHERE rowid=?");
    classRows.forEach((row) => updateClass.run(encryptText(row.counselor), encryptText(row.teacher), row.rid));
    const meetingRows = database.prepare("SELECT rowid AS rid,topic FROM meetings").all();
    const updateMeeting = database.prepare("UPDATE meetings SET topic=? WHERE rowid=?");
    meetingRows.forEach((row) => updateMeeting.run(encryptText(row.topic), row.rid));
    const aiRows = database.prepare("SELECT id,note FROM ai_audit").all();
    const updateAi = database.prepare("UPDATE ai_audit SET note=? WHERE id=?");
    aiRows.forEach((row) => updateAi.run(encryptText(row.note), row.id));
    database.prepare("INSERT INTO migration_meta(key,value,updated_at) VALUES('protected_columns_v1','done',CURRENT_TIMESTAMP)").run();
    database.exec("COMMIT");
    database.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (error) { try { database.exec("ROLLBACK"); } catch (_ignored) {} throw error; }
}

function migrateClassroomAttachments() {
  const done = database.prepare("SELECT value FROM migration_meta WHERE key='classroom_attachments_v1'").get();
  if (done && done.value === "done") return;
  const createdFiles = [];
  let migrated = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    const rows = database.prepare("SELECT rowid AS rid,data_json FROM students").all();
    const update = database.prepare("UPDATE students SET data_json=?,updated_at=CURRENT_TIMESTAMP WHERE rowid=?");
    rows.forEach((row) => {
      const student = parseProtectedJson(row.data_json, "students");
      const maps = student && student.classroomSelfCriticism;
      if (!maps || typeof maps !== "object" || Array.isArray(maps)) return;
      let changed = false;
      Object.keys(maps).forEach((key) => {
        const source = Array.isArray(maps[key]) ? maps[key] : [maps[key]];
        maps[key] = source.map((item) => {
          if (!item || typeof item !== "object" || !/^data:[^,]*;base64,/i.test(String(item.dataUrl || ""))) return item;
          const match = String(item.dataUrl).match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
          if (!match) return item;
          const content = Buffer.from(match[2].replace(/\s/g, ""), "base64");
          if (!content.length || content.length > MAX_ATTACHMENT_BYTES) return item;
          const id = crypto.randomUUID();
          fs.writeFileSync(attachmentPath(id), encryptBuffer(content), { flag: "wx" });
          createdFiles.push(attachmentPath(id));
          migrated += 1;
          changed = true;
          const name = String(item.fileName || item.name || "检讨附件").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120) || "检讨附件";
          return { id, name, fileName: name, mime: item.mime || match[1] || "application/octet-stream", size: content.length, url: `/attachments/${id}` };
        });
      });
      if (changed) update.run(protectedJson(student), row.rid);
    });
    database.prepare("INSERT INTO migration_meta(key,value,updated_at) VALUES('classroom_attachments_v1','done',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='done',updated_at=CURRENT_TIMESTAMP").run();
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (_ignored) {}
    createdFiles.forEach((file) => { try { fs.unlinkSync(file); } catch (_ignored) {} });
    throw error;
  }
}

function migrateSensitiveData() {
  requireDataKey();
  const done = database.prepare("SELECT value FROM migration_meta WHERE key='data_encryption_v1'").get();
  if (done && done.value === "done") { protectAttachmentFiles(); migrateProtectedRecordIds(); migrateAdditionalSensitiveColumns(); migrateClassroomAttachments(); finalizeEncryptionCleanup(); return; }
  database.exec("BEGIN IMMEDIATE");
  try {
    const studentRows = database.prepare("SELECT student_id,name FROM students").all();
    const updateStudentId = database.prepare("UPDATE students SET student_id=?,name=? WHERE student_id=?");
    const looseStudentTables = ["talk_records", "home_contacts", "punishment_records", "fund_records", "dorm_distribution_records"];
    studentRows.forEach((row) => {
      const nextId = protectedStudentId(row.student_id);
      updateStudentId.run(nextId, encryptText(row.name), row.student_id);
      looseStudentTables.forEach((t) => { validateTable(t); database.prepare(`UPDATE ${t} SET student_id=? WHERE student_id=?`).run(nextId, row.student_id); });
    });
    const jsonColumns = [
      ["students", "data_json"], ["party_profiles", "data_json"], ["party_history", "data_json"],
      ["classroom_records", "data_json"], ["student_dorm_records", "data_json"], ["meetings", "data_json"],
      ["talk_records", "data_json"], ["home_contacts", "data_json"], ["punishment_records", "data_json"],
      ["fund_records", "data_json"], ["dorm_distribution_records", "data_json"], ["academic_term_records", "data_json"]
    ];
    jsonColumns.forEach(([table, column]) => {
      validateTable(table);
      validateColumn(column);
      const rows = database.prepare(`SELECT rowid AS rid,${column} AS value FROM ${table}`).all();
      const update = database.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
      rows.forEach((row) => update.run(encryptText(row.value), row.rid));
    });
    const stateRows = database.prepare("SELECT id,state_json FROM dorm_module_state").all();
    const updateState = database.prepare("UPDATE dorm_module_state SET state_json=? WHERE id=?");
    stateRows.forEach((row) => updateState.run(encryptText(row.state_json), row.id));
    const legacyRows = database.prepare("SELECT key,value FROM legacy_ui_store").all();
    const updateLegacy = database.prepare("UPDATE legacy_ui_store SET value=? WHERE key=?");
    legacyRows.forEach((row) => updateLegacy.run(encryptText(row.value), row.key));
    const aiRows = database.prepare("SELECT k,v FROM ai_secret").all();
    const updateAi = database.prepare("UPDATE ai_secret SET v=? WHERE k=?");
    aiRows.forEach((row) => updateAi.run(encryptText(row.v), row.k));
    protectAttachmentFiles();
    database.prepare("INSERT INTO migration_meta(key,value,updated_at) VALUES('data_encryption_v1','done',CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value='done',updated_at=CURRENT_TIMESTAMP").run();
    database.exec("COMMIT");
    migrateProtectedRecordIds();
    migrateAdditionalSensitiveColumns();
    migrateClassroomAttachments();
    finalizeEncryptionCleanup();
    log(`敏感数据加密迁移完成：${studentRows.length} 名学生，附件已加密。`);
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (_ignored) {}
    throw error;
  }
}

function sessionCookie(value) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Priority=High`;
}

function createSession() {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = { id, context: crypto.randomBytes(16).toString("hex"), uid: "local-super-admin", name: "本机管理员", role: "sa", roleName: "本机管理员", createdAt: now, lastSeenAt: now };
  authSessions.set(id, session);
  return session;
}

/* 单机免密模式：首次打开工作台时自动建立本机会话，仍不接受远程请求。 */
function ensureLocalSession(request) {
  const existing = currentSession(request, true);
  if (existing) return { session: existing, created: false };
  return { session: createSession(), created: true };
}

/* 页面入口只为回环请求建立本机会话。 */
function ensureAccessSession(request) { return isLocalRequest(request)?ensureLocalSession(request):null; }

function currentSession(request, touch = true) {
  const id = parseCookies(request)[SESSION_COOKIE];
  const session = id ? authSessions.get(id) : null;
  if (!session) return null;
  if(!isLocalRequest(request)||session.uid!=="local-super-admin"){authSessions.delete(id);return null;}
  if (touch) session.lastSeenAt = Date.now();
  return session;
}

function assertRequestSession(request) {
  const expected = request.workbenchAuthorizedSession;
  if (!expected) return;
  const active = currentSession(request, false);
  if (!active || active.id !== expected.id || active.context !== expected.context) {
    const error = httpError(401, "会话已失效或账号已切换，本次请求未执行。请重新登录。"); error.code = "SESSION_INVALID"; throw error;
  }
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (!licenseAllowsOperations() && !licenseAllowsLockedOperation(request, url)) {
    const payload = licenseReadOnlyPayload(), error = httpError(403, payload.error); error.code = payload.code; error.license = payload.license; throw error;
  }
  if (loadDemoState() && !demoAllowsOperation(request, url)) {
    const payload = demoLockedPayload(), error = httpError(423, payload.error); error.code = payload.code; throw error;
  }
}

function requestOriginAllowed(request) {
  const origin = request.headers.origin;
  const host = request.headers.host || "";
  if (isLocalRequest(request)) {
    const expectedOrigins = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
    if (host && host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) return false;
    return !origin || expectedOrigins.has(origin);
  }
  return false;
}

function authorize(request) { return requestOriginAllowed(request)&&!!activeDataKey&&!!currentSession(request,true); }

function loginAttemptState(request, scope = "") {
  const key = (request.socket.remoteAddress || "local") + (scope ? "|" + scope : "");
  const now = Date.now();
  if (loginAttempts.size >= 4096) {
    for (const [entryKey, entry] of loginAttempts) if (entry.blockedUntil <= now && (!entry.failures.length || now - entry.failures[entry.failures.length - 1] >= 5 * 60 * 1000)) loginAttempts.delete(entryKey);
    if (!loginAttempts.has(key) && loginAttempts.size >= 4096) return { failures: [], blockedUntil: now + 60 * 1000 };
  }
  const state = loginAttempts.get(key) || { failures: [], blockedUntil: 0 };
  state.failures = state.failures.filter((time) => now - time < 5 * 60 * 1000);
  loginAttempts.set(key, state);
  return state;
}

function noteLoginFailure(request, scope = "", threshold = 5) {
  const state = loginAttemptState(request, scope);
  state.failures.push(Date.now());
  if (state.failures.length >= threshold) state.blockedUntil = Date.now() + 60 * 1000;
}

function clearLoginFailures(request, scope = "") {
  loginAttempts.delete((request.socket.remoteAddress || "local") + (scope ? "|" + scope : ""));
}

function sha256Hex(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }

/* ---------- AI 配置与服务端代理：密钥仅存于服务端数据库，前端永不直接接触 ---------- */
function isBlockedIp(address) {
  const value = String(address || "").toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(value);
  if (family === 4) {
    const parts = value.split(".").map(Number);
    const [a, b, c] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      parts.every((part) => part === 255);
  }
  if (family === 6) {
    if (value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff")) return true;
    if (/^fe[89ab]/.test(value) || value.startsWith("2001:db8:")) return true;
    const mapped = value.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    return !!(mapped && isBlockedIp(mapped[1]));
  }
  return true;
}

/* Clash/Mihomo Fake-IP 默认使用 198.18.0.0/15。仅在本机确实存在该虚拟网卡时，
 * 才允许“域名解析结果”走此地址段；用户直接填写该 IP 仍由 parseAiBaseUrl 拒绝。 */
function isClashFakeIp(address) {
  const value = String(address || "").replace(/^::ffff:/, "").split("%")[0];
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}
function hasClashFakeIpInterface() {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces).some((items) => (items || []).some((item) => item.family === "IPv4" && !item.internal && isClashFakeIp(item.address)));
}
function aiNetworkMode() { return hasClashFakeIpInterface() ? "clash-fake-ip" : "direct"; }

function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  return net.isIP(h) ? isBlockedIp(h) : false;
}

function parseAiBaseUrl(rawBaseUrl) {
  let base;
  try { base = new URL(String(rawBaseUrl || "").trim()); }
  catch (_error) { throw new Error("AI 服务地址格式无效。"); }
  if (base.protocol !== "https:") throw new Error("AI 服务地址必须使用 HTTPS。");
  if (base.username || base.password || base.search || base.hash) throw new Error("AI 服务地址不能包含账号、密码、查询参数或片段。");
  if (isPrivateHost(base.hostname)) throw new Error("AI 服务地址不能指向本机、内网或保留地址。");
  return base;
}

async function validateAiEndpoint(rawBaseUrl) {
  const base = parseAiBaseUrl(rawBaseUrl);
  let addresses;
  if (net.isIP(base.hostname)) addresses = [{ address: base.hostname, family: net.isIP(base.hostname) }];
  else {
    try { addresses = await dns.lookup(base.hostname, { all: true, verbatim: true }); }
    catch (_error) { throw new Error("AI 服务域名无法解析。"); }
  }
  const unique = [...new Map(addresses.map((item) => [`${item.family}:${item.address}`, item])).values()];
  const blocked = unique.filter((item) => isBlockedIp(item.address));
  const clashFakeIp = blocked.length > 0 && blocked.length === unique.length && blocked.every((item) => isClashFakeIp(item.address)) && hasClashFakeIpInterface() && !net.isIP(base.hostname);
  if (!unique.length || (blocked.length && !clashFakeIp)) throw new Error("AI 服务域名解析到了内网或保留地址，已拒绝连接。");
  const endpoint = new URL(base.toString());
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/chat/completions";
  return { base, endpoint, addresses: unique, networkMode: clashFakeIp ? "clash-fake-ip" : "direct" };
}

function aiProviderProtocol(provider) {
  if (provider === "gemini") return "gemini";
  if (provider === "anthropic") return "anthropic";
  return "openai";
}

function aiProviderEndpoint(validated, provider, model, operation) {
  const endpoint = new URL(validated.base.toString());
  const path = endpoint.pathname.replace(/\/+$/, "");
  const protocol = aiProviderProtocol(provider);
  if (protocol === "gemini") {
    if (operation === "models") endpoint.pathname = path + "/models";
    else endpoint.pathname = path + "/models/" + encodeURIComponent(String(model || "").replace(/^models\//, "")) + ":generateContent";
  } else if (protocol === "anthropic") {
    endpoint.pathname = path + (operation === "models" ? "/models" : "/messages");
  } else {
    endpoint.pathname = path + (operation === "models" ? "/models" : "/chat/completions");
  }
  return endpoint;
}

function aiStructuredOutputMode(provider, model) {
  const protocol = aiProviderProtocol(provider);
  const id = String(model || "").toLowerCase();
  if (protocol === "gemini") return "json-schema";
  if (protocol === "anthropic") return /^claude-(?:sonnet-5|opus-5|fable-5|mythos|(?:sonnet|opus|haiku)-4-[5-9])/.test(id) ? "json-schema" : "prompt-json";
  if (provider === "openai" && /^(?:gpt-5|gpt-4o)/.test(id)) return "json-schema";
  if (provider === "tongyi" && /^qwen3(?:\.|-)/.test(id)) return "json-schema";
  return "prompt-json";
}

function applyAiStructuredOutput(payload, provider, model, schema, name) {
  if (!schema) return payload;
  const mode = aiStructuredOutputMode(provider, model);
  if (mode !== "json-schema") return payload;
  const protocol = aiProviderProtocol(provider);
  if (protocol === "gemini") {
    payload.generationConfig = Object.assign({}, payload.generationConfig, { responseMimeType: "application/json", responseSchema: schema });
  } else if (protocol === "anthropic") {
    payload.output_config = { format: { type: "json_schema", schema } };
  } else {
    payload.response_format = { type: "json_schema", json_schema: { name: name || "structured_result", strict: true, schema } };
  }
  return payload;
}

function buildAiPayload(provider, model, system, user, temperature, structuredSchema) {
  const protocol = aiProviderProtocol(provider);
  if (protocol === "gemini") {
    const payload = {
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature }
    };
    if (system) payload.system_instruction = { parts: [{ text: system }] };
    return applyAiStructuredOutput(payload, provider, model, structuredSchema, "structured_result");
  }
  if (protocol === "anthropic") {
    const payload = { model, max_tokens: 4096, messages: [{ role: "user", content: user }], temperature: Math.max(0, Math.min(1, temperature)) };
    if (system) payload.system = system;
    return applyAiStructuredOutput(payload, provider, model, structuredSchema, "structured_result");
  }
  const payload = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: false };
  if (!(provider === "openai" && /^gpt-5(?:\.|-|$)/i.test(model))) payload.temperature = temperature;
  return applyAiStructuredOutput(payload, provider, model, structuredSchema, "structured_result");
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function buildAiVisionPayload(provider, model, system, user, imageBuffer, highDetail, temperature, structuredSchema) {
  const mime = detectImageMime(imageBuffer);
  if (!mime) throw httpError(400, "证书附件必须是 JPEG、PNG 或 WebP 图片。");
  const base64 = imageBuffer.toString("base64");
  const protocol = aiProviderProtocol(provider);
  if (protocol === "gemini") {
    const payload = { contents: [{ role: "user", parts: [{ text: user }, { inline_data: { mime_type: mime, data: base64 } }] }], generationConfig: { temperature } };
    if (system) payload.system_instruction = { parts: [{ text: system }] };
    return applyAiStructuredOutput(payload, provider, model, structuredSchema, "certificate_extraction");
  }
  if (protocol === "anthropic") {
    const payload = {
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
        { type: "text", text: user }
      ] }],
      temperature: Math.max(0, Math.min(1, temperature))
    };
    if (system) payload.system = system;
    return applyAiStructuredOutput(payload, provider, model, structuredSchema, "certificate_extraction");
  }
  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: user }, { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: highDetail ? "high" : "auto" } }] }
    ],
    stream: false
  };
  if (!(provider === "openai" && /^gpt-5(?:\.|-|$)/i.test(model))) payload.temperature = temperature;
  return applyAiStructuredOutput(payload, provider, model, structuredSchema, "certificate_extraction");
}

function extractAiContent(provider, payload) {
  const protocol = aiProviderProtocol(provider);
  if (protocol === "gemini") {
    const parts = payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts;
    return Array.isArray(parts) ? parts.map((part) => typeof part.text === "string" ? part.text : "").join("") : "";
  }
  if (protocol === "anthropic") {
    return Array.isArray(payload && payload.content) ? payload.content.map((part) => part && part.type === "text" && typeof part.text === "string" ? part.text : "").join("") : "";
  }
  return (payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content) || "";
}

function aiUpstreamErrorMessage(status, responseText) {
  let detail = "";
  try {
    const parsed = JSON.parse(responseText || "{}");
    detail = String((parsed.error && (parsed.error.message || parsed.error.status)) || parsed.message || "").replace(/\s+/g, " ").slice(0, 180);
  } catch (_error) {}
  const hints = {
    400: "请求参数、模型名称或 Base URL 不正确",
    401: "API Key 无效或认证失败",
    402: "账户余额或调用额度不足",
    403: "API Key 或模型权限不足，或当前代理出口地区不受服务商支持",
    404: "模型不存在或 Base URL 不正确",
    429: "请求过于频繁或调用额度已用尽"
  };
  return `AI 上游返回 ${status}：${hints[status] || "服务暂时不可用"}${detail ? `（${detail}）` : ""}。`;
}

function requestAiJson(validated, options) {
  const body = options.payload == null ? null : Buffer.from(JSON.stringify(options.payload), "utf8");
  const endpoint = options.endpoint || validated.endpoint;
  const selected = validated.addresses.find((item) => item.family === 4) || validated.addresses[0];
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ "Accept": "application/json" }, options.headers || {});
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = body.length;
    }
    const request = https.request(endpoint, {
      method: options.method || "POST",
      headers,
      servername: endpoint.hostname,
      lookup: (_hostname, options, callback) => {
        if (options && options.all) callback(null, [selected]);
        else callback(null, selected.address, selected.family);
      }
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_AI_RESPONSE_BYTES) {
          response.destroy(new Error("AI 上游响应超过 2MB 限制。"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, text: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : AI_REQUEST_TIMEOUT_MS, () => request.destroy(new Error("AI 上游请求超时。")));
    request.on("error", reject);
    request.end(body || undefined);
  });
}

function postAiJson(validated, payload, apiKey, provider, model, timeoutMs) {
  const protocol = aiProviderProtocol(provider);
  const headers = protocol === "gemini"
    ? { "x-goog-api-key": apiKey }
    : (protocol === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { "Authorization": "Bearer " + apiKey });
  return requestAiJson(validated, {
    endpoint: aiProviderEndpoint(validated, provider, model, "chat"),
    payload,
    headers,
    timeoutMs
  });
}

function getAiModels(validated, apiKey, provider) {
  const protocol = aiProviderProtocol(provider);
  const headers = protocol === "gemini"
    ? { "x-goog-api-key": apiKey }
    : (protocol === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : { "Authorization": "Bearer " + apiKey });
  return requestAiJson(validated, {
    method: "GET",
    endpoint: aiProviderEndpoint(validated, provider, "", "models"),
    headers
  });
}
function loadAiSecret() {
  try { const row = database.prepare("SELECT v FROM ai_secret WHERE k='cfg'").get(); return row ? JSON.parse(decryptText(row.v)) : null; } catch (_error) { return null; }
}
function saveAiSecret(cfg) {
  database.prepare("INSERT INTO ai_secret(k,v,updated_at) VALUES('cfg',?,CURRENT_TIMESTAMP) ON CONFLICT(k) DO UPDATE SET v=excluded.v,updated_at=CURRENT_TIMESTAMP").run(protectedJson(cfg));
}
function maskKey(k) { if (!k) return ""; if (k.length <= 8) return "****"; return k.slice(0, 4) + "****" + k.slice(-4); }
const AI_FEATURE_KEYS = Object.freeze(["general", "import", "notice", "insight", "talk", "document", "certificate", "courseSchedule", "academicSummary", "academicAnalysis", "excelMerge", "excelCheck", "dataMatch", "workRecord", "taskAssist", "ledgerInsight"]);
function normalizeAiFeatures(input, fallback) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : (fallback && typeof fallback === "object" ? fallback : {});
  const result = {};
  AI_FEATURE_KEYS.forEach((key) => { result[key] = source[key] !== false; });
  return result;
}
function normalizeAiLimit(value, fallback, max) {
  const raw = value == null ? fallback : value;
  const number = Number(raw == null ? 0 : raw);
  if (!Number.isFinite(number) || number < 0 || number > max || Math.floor(number) !== number) return null;
  return number;
}
function normalizeAiPrice(value, fallback) {
  const raw = value == null ? fallback : value;
  const number = Number(raw == null ? 0 : raw);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
  return Math.round(number * 1000000) / 1000000;
}
function selectAiModel(secret, feature) {
  const key = String(feature || "general");
  if (key === "certificate" || key === "courseSchedule") return String(secret && secret.visionModel || secret && secret.model || "").trim();
  if (["import", "notice", "workRecord", "taskAssist", "ledgerInsight"].includes(key)) {
    return String(secret && secret.economyModel || secret && secret.model || "").trim();
  }
  return String(secret && secret.model || "").trim();
}
function legacyAiUsageSnapshot(secret, now = Date.now()) {
  const startedAt = Date.parse(secret && secret.usageWindowStartedAt || "");
  if (!Number.isFinite(startedAt) || now - startedAt >= 24 * 60 * 60 * 1000 || now < startedAt) {
    return { startedAt: new Date(now).toISOString(), requests: 0, inputChars: 0 };
  }
  return { startedAt: new Date(startedAt).toISOString(), requests: Math.max(0, Number(secret.usageRequests) || 0), inputChars: Math.max(0, Number(secret.usageInputChars) || 0) };
}

function migrateLegacyAiUsage(secret) {
  if (!secret || secret.usageLedgerMigratedAt) return;
  const legacy = legacyAiUsageSnapshot(secret);
  if (legacy.requests || legacy.inputChars) {
    database.prepare("INSERT INTO ai_usage(ts,feature,provider,model,request_kind,request_count,input_chars,status) VALUES(?,?,?,?,?,?,?,?)")
      .run(legacy.startedAt, "legacy", secret.provider || "", secret.model || "", "legacy", legacy.requests, legacy.inputChars, 200);
  }
  secret.usageLedgerMigratedAt = new Date().toISOString();
  secret.usageWindowStartedAt = "";
  secret.usageRequests = 0;
  secret.usageInputChars = 0;
  saveAiSecret(secret);
}

function aiUsageSnapshot(secret, now = Date.now()) {
  const cutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  let row = { requests: 0, input_chars: 0, image_bytes: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0, started_at: "" };
  try {
    row = database.prepare(`SELECT COALESCE(SUM(request_count),0) requests,COALESCE(SUM(input_chars),0) input_chars,
      COALESCE(SUM(image_bytes),0) image_bytes,COALESCE(SUM(input_tokens),0) input_tokens,
      COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(total_tokens),0) total_tokens,
      COALESCE(SUM(estimated_cost),0) estimated_cost,MIN(ts) started_at FROM ai_usage WHERE ts>=?`).get(cutoff) || row;
  } catch (_error) {}
  if (secret && !secret.usageLedgerMigratedAt) {
    const legacy = legacyAiUsageSnapshot(secret, now);
    row.requests += legacy.requests;
    row.input_chars += legacy.inputChars;
    if (!row.started_at && (legacy.requests || legacy.inputChars)) row.started_at = legacy.startedAt;
  }
  return {
    startedAt: row.started_at || new Date(now).toISOString(),
    requests: Math.max(0, Number(row.requests) || 0),
    inputChars: Math.max(0, Number(row.input_chars) || 0),
    imageBytes: Math.max(0, Number(row.image_bytes) || 0),
    inputTokens: Math.max(0, Number(row.input_tokens) || 0),
    outputTokens: Math.max(0, Number(row.output_tokens) || 0),
    totalTokens: Math.max(0, Number(row.total_tokens) || 0),
    estimatedCost: Math.max(0, Number(row.estimated_cost) || 0)
  };
}

function consumeAiQuota(secret, inputLength, meta) {
  migrateLegacyAiUsage(secret);
  const now = Date.now();
  const info = meta && typeof meta === "object" ? meta : {};
  let usage;
  database.exec("BEGIN IMMEDIATE");
  try {
    usage = aiUsageSnapshot(secret, now);
    const requestLimit = normalizeAiLimit(secret.dailyRequestLimit, 0, 10000) || 0;
    const inputLimit = normalizeAiLimit(secret.dailyInputLimit, 0, 1000000) || 0;
    if (requestLimit && usage.requests >= requestLimit) {
      database.exec("ROLLBACK");
      return { error: `近 24 小时调用已达到上限（${requestLimit} 次）。`, usage };
    }
    if (inputLimit && usage.inputChars + inputLength > inputLimit) {
      database.exec("ROLLBACK");
      return { error: `近 24 小时输入额度已达到上限（${inputLimit} 字）。`, usage };
    }
    const insert = database.prepare("INSERT INTO ai_usage(ts,feature,provider,model,request_kind,request_count,input_chars,image_bytes,status) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(new Date(now).toISOString(), info.feature || "general", info.provider || secret.provider || "", info.model || secret.model || "", info.requestKind || "chat", 1, Math.max(0, Number(inputLength) || 0), Math.max(0, Number(info.imageBytes) || 0), 0);
    database.exec("COMMIT");
    try { database.prepare("DELETE FROM ai_usage WHERE ts<?").run(new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()); } catch (_error) {}
    return { usage: aiUsageSnapshot(secret, now), usageId: Number(insert.lastInsertRowid) };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (_ignored) {}
    throw error;
  }
}

function extractAiUsage(provider, payload) {
  const protocol = aiProviderProtocol(provider);
  const raw = protocol === "gemini" ? (payload && payload.usageMetadata) : (payload && payload.usage);
  if (!raw || typeof raw !== "object") return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const inputTokens = Number(raw.prompt_tokens != null ? raw.prompt_tokens : (raw.input_tokens != null ? raw.input_tokens : raw.promptTokenCount)) || 0;
  const outputTokens = Number(raw.completion_tokens != null ? raw.completion_tokens : (raw.output_tokens != null ? raw.output_tokens : raw.candidatesTokenCount)) || 0;
  const totalTokens = Number(raw.total_tokens != null ? raw.total_tokens : raw.totalTokenCount) || (inputTokens + outputTokens);
  return { inputTokens: Math.max(0, inputTokens), outputTokens: Math.max(0, outputTokens), totalTokens: Math.max(0, totalTokens) };
}

function finishAiUsage(usageId, provider, payload, status, secret) {
  if (!usageId) return;
  const tokens = extractAiUsage(provider, payload);
  const inputRate = Math.max(0, Number(secret && secret.inputPricePerMillion) || 0);
  const outputRate = Math.max(0, Number(secret && secret.outputPricePerMillion) || 0);
  const estimatedCost = (tokens.inputTokens * inputRate + tokens.outputTokens * outputRate) / 1000000;
  try {
    database.prepare("UPDATE ai_usage SET input_tokens=?,output_tokens=?,total_tokens=?,estimated_cost=?,status=? WHERE id=?")
      .run(tokens.inputTokens, tokens.outputTokens, tokens.totalTokens, estimatedCost, Number(status) || 0, usageId);
  } catch (_error) {}
}

function readAiUsageSummary(hours) {
  const safeHours = Math.max(1, Math.min(24 * 90, Math.floor(Number(hours) || 24)));
  const cutoff = new Date(Date.now() - safeHours * 60 * 60 * 1000).toISOString();
  try {
    return database.prepare(`SELECT feature,provider,model,COALESCE(SUM(request_count),0) requests,
      COALESCE(SUM(input_chars),0) input_chars,COALESCE(SUM(image_bytes),0) image_bytes,
      COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens,
      COALESCE(SUM(total_tokens),0) total_tokens,COALESCE(SUM(estimated_cost),0) estimated_cost
      FROM ai_usage WHERE ts>=? GROUP BY feature,provider,model ORDER BY estimated_cost DESC,total_tokens DESC,requests DESC`).all(cutoff);
  } catch (_error) { return []; }
}
function aiPublicConfig() {
  const s = loadAiSecret() || {};
  const hasEndpoint = !!(s.baseUrl && s.model), hasApiKey = !!s.apiKey;
  const enabled = s.enabled != null ? !!s.enabled : !!(hasEndpoint || hasApiKey);
  const usage = aiUsageSnapshot(s);
  const updatedAt = database.prepare("SELECT updated_at FROM ai_secret WHERE k='cfg'").get()?.updated_at || "";
  return {
    enabled,
    configured: enabled && hasEndpoint && hasApiKey,
    hasEndpoint,
    hasApiKey,
    provider: s.provider || "",
    protocol: aiProviderProtocol(s.provider),
    baseUrl: s.baseUrl || "",
    model: s.model || "",
    economyModel: s.economyModel || "",
    visionModel: s.visionModel || "",
    temperature: (s.temperature != null ? s.temperature : 0.4),
    maskedKey: maskKey(s.apiKey),
    lastTestAt: s.lastTestAt || "",
    lastTestOk: s.lastTestOk === true ? true : (s.lastTestOk === false ? false : null),
    lastTestMs: Number(s.lastTestMs) || 0,
    features: normalizeAiFeatures(s.features),
    dailyRequestLimit: normalizeAiLimit(s.dailyRequestLimit, 0, 10000) || 0,
    dailyInputLimit: normalizeAiLimit(s.dailyInputLimit, 0, 1000000) || 0,
    inputPricePerMillion: normalizeAiPrice(s.inputPricePerMillion, 0) || 0,
    outputPricePerMillion: normalizeAiPrice(s.outputPricePerMillion, 0) || 0,
    currency: "CNY",
    usage: { windowStartedAt: usage.startedAt, requests: usage.requests, inputChars: usage.inputChars, imageBytes: usage.imageBytes, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, estimatedCost: usage.estimatedCost },
    networkMode: aiNetworkMode(),
    certificateOutboundApproved: s.certificateOutboundApproved === true,
    certificateOutboundApprovedAt: s.certificateOutboundApprovedAt || "",
    courseScheduleOutboundApproved: s.courseScheduleOutboundApproved === true,
    courseScheduleOutboundApprovedAt: s.courseScheduleOutboundApprovedAt || "",
    updatedAt
  };
}
/* 审计日志不保存提示词正文或学生数据；保留最新 1000 条供本机追踪与导出。 */
const AI_AUDIT_RETENTION = 1000;
function pruneAiAudit() {
  try { database.prepare("DELETE FROM ai_audit WHERE id NOT IN (SELECT id FROM ai_audit ORDER BY id DESC LIMIT ?)").run(AI_AUDIT_RETENTION); } catch (_error) {}
}
function appendAiAudit(e) {
  try { database.prepare("INSERT INTO ai_audit(ts,model,host,status,ms,prompt_len,resp_len,note) VALUES(?,?,?,?,?,?,?,?)").run(e.ts || new Date().toISOString(), e.model || "", e.host || "", e.status || 0, e.ms || 0, e.promptLen || 0, e.respLen || 0, encryptText(e.error || e.note || "")); } catch (_error) {}
  pruneAiAudit();
}
function readAiAudit(limit) {
  try { return database.prepare("SELECT ts,model,host,status,ms,prompt_len,resp_len,note FROM ai_audit ORDER BY id DESC LIMIT ?").all(limit || 50).map((row)=>Object.assign({},row,{note:decryptText(row.note)})); } catch (_error) { return []; }
}

function replaceSensitiveLiteral(input, token, replacement) {
  if (!token || token === replacement || !input.includes(token)) return { text: input, count: 0 };
  const parts = input.split(token);
  return { text: parts.join(replacement), count: parts.length - 1 };
}

function aiRosterRedactions() {
  const map = new Map();
  const rows = database.prepare("SELECT data_json FROM students ORDER BY student_id").all();
  rows.forEach((row, index) => {
    let student;
    try { student = parseProtectedJson(row.data_json, "students"); } catch (_error) { return; }
    const alias = `[学生代号${index + 1}]`;
    const add = (value, replacement, minimumLength = 2) => {
      const token = String(value || "").trim();
      if (token.length >= minimumLength && !map.has(token)) map.set(token, replacement);
    };
    add(student.id, `${alias}学号`, 4);
    add(student.name, alias, 2);
    add(student.usedName, alias, 2);
    add(student.phone, `${alias}电话`, 7);
    add(student.idcard, `${alias}证件号`, 8);
    add(student.examNo, `${alias}考生号`, 4);
    add(student.address, `${alias}住址`, 5);
    add(student.fatherName, `${alias}监护人`, 2);
    add(student.fatherPhone, `${alias}监护人电话`, 7);
    add(student.motherName, `${alias}监护人`, 2);
    add(student.motherPhone, `${alias}监护人电话`, 7);
    add(student.emgName, `${alias}紧急联系人`, 2);
    add(student.emgPhone, `${alias}紧急联系人电话`, 7);
  });
  return [...map.entries()].sort((left, right) => right[0].length - left[0].length);
}

function redactGenericPii(input) {
  let text = String(input || "");
  let count = 0;
  const replace = (pattern, label) => {
    text = text.replace(pattern, () => { count += 1; return label; });
  };
  replace(/(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g, "[身份证号已隐藏]");
  replace(/(?<!\d)1[3-9]\d(?:[\s-]?\d){8}(?!\d)/g, "[手机号已隐藏]");
  replace(/(?<!\d)(?:\d[\s-]?){16,19}(?!\d)/g, "[银行卡号已隐藏]");
  replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已隐藏]");
  return { text, count };
}

function redactAiOutbound(systemText, userText) {
  const roster = aiRosterRedactions();
  const redact = (input) => {
    let text = String(input || "");
    let count = 0;
    roster.forEach(([token, replacement]) => {
      const result = replaceSensitiveLiteral(text, token, replacement);
      text = result.text;
      count += result.count;
    });
    const generic = redactGenericPii(text);
    return { text: generic.text, count: count + generic.count };
  };
  const system = redact(systemText);
  const user = redact(userText);
  return { system: system.text, user: user.text, count: system.count + user.count };
}

async function aiProxyChat(body) {
  const s = loadAiSecret();
  const requestedFeature = body && typeof body.feature === "string" ? body.feature : "";
  if (requestedFeature === "knowledge") return { status: 410, error: "知识功能已经下线。" };
  const feature = requestedFeature === "test" ? "test" : (AI_FEATURE_KEYS.includes(requestedFeature) ? requestedFeature : "general");
  const isConnectivityTest = feature === "test";
  const selectedModel = selectAiModel(s, isConnectivityTest ? "general" : feature);
  const auditFeature = isConnectivityTest ? "连通性测试" : `功能：${feature}`;
  if (s && s.enabled === false) {
    appendAiAudit({ status: 400, model: selectedModel, host: "", note: `${auditFeature}；AI 功能已停用，已拒绝代理调用` });
    return { status: 400, error: "AI 功能当前已停用，请先在「AI 智能 → 设置」中开启。" };
  }
  if (!isConnectivityTest && normalizeAiFeatures(s && s.features)[feature] === false) {
    appendAiAudit({ status: 403, model: selectedModel, host: "", note: `${auditFeature}；功能开关已关闭` });
    return { status: 403, error: "该 AI 功能已在 API 配置中关闭。" };
  }
  if (!s || !s.baseUrl || !selectedModel || !s.apiKey) {
    let host = ""; try { host = new URL(s.baseUrl.replace(/\/+$/, "")).host; } catch (_error) {}
    appendAiAudit({ status: 400, model: selectedModel, host: host, note: `${auditFeature}；服务端未配置 AI（缺少 apiKey），已拒绝代理调用` });
    return { status: 400, error: "服务端未配置 AI（请在「AI 智能助手 → 设置」保存配置，密钥仅存本机服务端）。" };
  }
  let validated;
  try { validated = await validateAiEndpoint(s.baseUrl); }
  catch (error) {
    let host = ""; try { host = new URL(s.baseUrl).host; } catch (_ignored) {}
    appendAiAudit({ status: 400, model: selectedModel, host, note: `${auditFeature}；SSRF 拦截：${error.message}` });
    return { status: 400, error: error.message };
  }
  if (!body || typeof body.user !== "string" || (body.system != null && typeof body.system !== "string")) return { status: 400, error: "AI 请求内容格式无效。" };
  const userContent = body.user;
  const systemContent = body.system || "";
  if (userContent.length > 32000 || systemContent.length > 16000) return { status: 400, error: "输入内容过长（用户内容上限 32000 字符，系统指令上限 16000 字符）。" };
  const inputLength = userContent.length + systemContent.length;
  if (isConnectivityTest) {
    const latestTest = database.prepare("SELECT ts FROM ai_usage WHERE feature='test' ORDER BY id DESC LIMIT 1").get();
    if (latestTest && Date.now() - Date.parse(latestTest.ts || "") < 10000) return { status: 429, error: "连接测试操作过于频繁，请 10 秒后重试。" };
  }
  const quota = consumeAiQuota(s, inputLength, { feature, provider: s.provider, model: selectedModel, requestKind: isConnectivityTest ? "test" : "chat" });
  if (quota.error) {
    appendAiAudit({ status: 429, model: selectedModel, host: validated.base.host, promptLen: inputLength, note: `${auditFeature}；${quota.error}` });
    return { status: 429, error: quota.error, usage: quota.usage };
  }
  const redacted = redactAiOutbound(systemContent, userContent);
  const requestedTemperature = body.temperature != null ? Number(body.temperature) : Number(s.temperature != null ? s.temperature : 0.4);
  const temperature = Number.isFinite(requestedTemperature) ? Math.max(0, Math.min(2, requestedTemperature)) : 0.4;
  const payload = buildAiPayload(s.provider, selectedModel, redacted.system, redacted.user, temperature);
  const t0 = Date.now();
  try {
    const res = await postAiJson(validated, payload, s.apiKey, s.provider, selectedModel);
    const ms = Date.now() - t0;
    if (res.status < 200 || res.status >= 300) {
      finishAiUsage(quota.usageId, s.provider, null, res.status, s);
      appendAiAudit({ status: res.status, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, note: `${auditFeature}；上游状态 ${res.status}；出站脱敏 ${redacted.count} 处` });
      return { status: res.status, error: aiUpstreamErrorMessage(res.status, res.text), redactedCount: redacted.count, ms };
    }
    let j;
    try { j = JSON.parse(res.text); } catch (_error) { throw new Error("AI 上游返回的不是有效 JSON。"); }
    const content = extractAiContent(s.provider, j);
    if (!content) {
      const blocked = j && j.promptFeedback && j.promptFeedback.blockReason;
      throw new Error(blocked ? `内容被模型安全策略拦截（${blocked}）。` : "AI 上游未返回可用文本，请检查模型是否支持文本生成。");
    }
    const tokenUsage = extractAiUsage(s.provider, j);
    finishAiUsage(quota.usageId, s.provider, j, 200, s);
    appendAiAudit({ status: 200, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, respLen: content.length, note: `${auditFeature}；Token 输入 ${tokenUsage.inputTokens} / 输出 ${tokenUsage.outputTokens}；出站脱敏 ${redacted.count} 处` });
    return { status: 200, content: content, redactedCount: redacted.count, model: selectedModel, tokenUsage, usage: aiUsageSnapshot(s), ms };
  } catch (e) {
    const ms = Date.now() - t0;
    finishAiUsage(quota.usageId, s.provider, null, 0, s);
    appendAiAudit({ status: 0, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, note: `${auditFeature}；连接失败；出站脱敏 ${redacted.count} 处；${String(e && e.message ? e.message : e).slice(0, 120)}` });
    return { status: 502, error: "调用 AI 上游失败：" + (e && e.message ? e.message : e), redactedCount: redacted.count, ms };
  }
}

const CERTIFICATE_AI_TEXT_FIELDS = Object.freeze([
  "role", "term", "category", "level", "awardName", "edition", "track", "prize", "organization",
  "issuingOrganization", "date", "teachers", "members", "certificateNo", "verificationUrl", "evidence"
]);
const CERTIFICATE_AI_ROLE_VALUES = Object.freeze(["学生获奖人", "团队成员", "指导老师", "无关/非本学生", "未判定"]);
const CERTIFICATE_AI_CATEGORY_VALUES = Object.freeze(["学科竞赛", "综合性获奖", "挑战杯", "大创", "资格证书", "文体活动", "三好优干", "社会实践", "奖学金", "其他荣誉", "未判定"]);
const CERTIFICATE_AI_LEVEL_VALUES = Object.freeze(["国家级", "省级", "地级市", "县级市", "校级", "院级", "未判定"]);

function certificateAiSchema() {
  const textProperties = Object.fromEntries(CERTIFICATE_AI_TEXT_FIELDS.map((key) => [key, { type: "string" }]));
  textProperties.role.enum = [...CERTIFICATE_AI_ROLE_VALUES];
  textProperties.category.enum = [...CERTIFICATE_AI_CATEGORY_VALUES];
  textProperties.level.enum = [...CERTIFICATE_AI_LEVEL_VALUES];
  const scoreProperties = Object.fromEntries(CERTIFICATE_AI_TEXT_FIELDS.map((key) => [key, { type: "integer", description: "0至100的整数" }]));
  const evidenceProperties = Object.fromEntries(CERTIFICATE_AI_TEXT_FIELDS.map((key) => [key, { type: "string" }]));
  return {
    type: "object",
    properties: Object.assign({}, textProperties, {
      confidence: { type: "integer", description: "整体置信度，0至100的整数" },
      fieldConfidence: { type: "object", properties: scoreProperties, required: [...CERTIFICATE_AI_TEXT_FIELDS], additionalProperties: false },
      fieldEvidence: { type: "object", properties: evidenceProperties, required: [...CERTIFICATE_AI_TEXT_FIELDS], additionalProperties: false },
      rawText: { type: "string" },
      qualityWarnings: { type: "array", items: { type: "string" }, maxItems: 8 },
      qrCodes: { type: "array", items: { type: "string" }, maxItems: 8 },
      needsReview: { type: "boolean" }
    }),
    required: [...CERTIFICATE_AI_TEXT_FIELDS, "confidence", "fieldConfidence", "fieldEvidence", "rawText", "qualityWarnings", "qrCodes", "needsReview"],
    additionalProperties: false
  };
}

function parseAiJsonObject(content) {
  const text = String(content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let value;
  try { value = JSON.parse(text); }
  catch (_error) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 返回内容不是有效 JSON。");
    try { value = JSON.parse(text.slice(start, end + 1)); }
    catch (_nestedError) { throw new Error("AI 返回内容不是有效 JSON。"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI 返回内容不是字段对象。");
  return value;
}

function validateCertificateAiResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("证书识别结果不是字段对象。");
  const result = {};
  CERTIFICATE_AI_TEXT_FIELDS.forEach((key) => {
    if (value[key] == null) value[key] = "";
    if (typeof value[key] !== "string") value[key] = String(value[key]);
    result[key] = value[key].trim().slice(0, key === "evidence" ? 4000 : 1000);
  });
  /* 枚举与格式类偏差只降级该字段，不整体作废识别结果；学期按落款月份规则推导。 */
  const normalizeCertificateDate = (raw) => {
    const text = String(raw || "").trim().replace(/^[^\d]*/, "");
    let match = text.match(/^(\d{4})[年\.\/\-](\d{1,2})(?:[月\.\/\-](\d{1,2}))?/);
    if (!match) return "";
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3] || 1);
    if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
    return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  };
  const certificateTermFromDate = (raw) => {
    const match = normalizeCertificateDate(raw).match(/^(\d{4})-(\d{2})/);
    if (!match) return "";
    const year = Number(match[1]), month = Number(match[2]);
    /* 学期规则：落款月份 1-8 月为第二学期，9-12 月为第一学期。 */
    return month >= 9 ? (year + "-" + (year + 1) + "-1学期") : ((year - 1) + "-" + year + "-2学期");
  };
  if (!CERTIFICATE_AI_ROLE_VALUES.includes(result.role)) result.role = "未判定";
  if (!CERTIFICATE_AI_CATEGORY_VALUES.includes(result.category)) result.category = "未判定";
  if (!CERTIFICATE_AI_LEVEL_VALUES.includes(result.level)) result.level = "未判定";
  if (result.term && !/^\d{4}-\d{4}-[12]学期$/.test(result.term)) result.term = "";
  result.date = result.date ? normalizeCertificateDate(result.date) : "";
  if (!result.term && result.date) result.term = certificateTermFromDate(result.date);
  if (result.verificationUrl) {
    let url;
    try { url = new URL(result.verificationUrl); } catch (_error) { throw new Error("证书识别结果的查询网址无效。"); }
    if (url.protocol !== "https:") throw new Error("证书识别结果的查询网址必须使用 HTTPS。");
  }
  const score = (input, label) => {
    const number = Number(input);
    if (!Number.isInteger(number) || number < 0 || number > 100) throw new Error(`证书识别结果的${label}必须是0至100整数。`);
    return number;
  };
  result.confidence = score(value.confidence, "整体置信度");
  if (!value.fieldConfidence || typeof value.fieldConfidence !== "object" || Array.isArray(value.fieldConfidence)) throw new Error("证书识别结果缺少字段置信度。");
  if (!value.fieldEvidence || typeof value.fieldEvidence !== "object" || Array.isArray(value.fieldEvidence)) throw new Error("证书识别结果缺少字段依据。");
  result.fieldConfidence = {};
  result.fieldEvidence = {};
  CERTIFICATE_AI_TEXT_FIELDS.forEach((key) => {
    result.fieldConfidence[key] = score(value.fieldConfidence[key], `${key}置信度`);
    if (value.fieldEvidence[key] == null) value.fieldEvidence[key] = "";
    if (typeof value.fieldEvidence[key] !== "string") value.fieldEvidence[key] = String(value.fieldEvidence[key]);
    result.fieldEvidence[key] = value.fieldEvidence[key].trim().slice(0, 1000);
    result.fieldEvidence[key] = value.fieldEvidence[key].trim().slice(0, 1000);
  });
  result.rawText = String(value.rawText == null ? "" : value.rawText).trim().slice(0, 16000);
  const stringList = (input) => {
    if (!Array.isArray(input)) input = [];
    return input.map((item) => String(item == null ? "" : item).trim().slice(0, 1000)).filter(Boolean).slice(0, 8);
  };
  result.qualityWarnings = stringList(value.qualityWarnings, "图像质量提示");
  result.qrCodes = stringList(value.qrCodes, "二维码内容");
  if (typeof value.needsReview !== "boolean") throw new Error("证书识别结果的复核标识类型无效。");
  result.needsReview = true;
  return result;
}

async function aiProxyCertificateRecognition(body) {
  const s = loadAiSecret();
  const feature = "certificate";
  const selectedModel = selectAiModel(s, feature);
  if (s && s.enabled === false) return { status: 400, error: "AI 功能当前已停用，请先在「AI 智能 → 设置」中开启。" };
  if (!normalizeAiFeatures(s && s.features)[feature]) return { status: 403, error: "“证书视觉识别”已在 API 配置中关闭。" };
  if (!s || !s.baseUrl || !selectedModel || !s.apiKey) return { status: 400, error: "请先在「API配置」中保存支持图片输入的 AI 服务、模型和 API Key。" };
  if (s.certificateOutboundApproved !== true) return { status: 403, error: "尚未在 API 配置中确认“允许向外部 AI 服务发送证书图片”。" };
  if (!body || typeof body.attachmentId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.attachmentId)) return { status: 400, error: "证书附件标识无效。" };
  let belongsToCertificate = false;
  try {
    const records = JSON.parse(readStore()["nnuzc_certificate_records"] || "[]");
    belongsToCertificate = Array.isArray(records) && records.some((record) => record && record.attachment && record.attachment.id === body.attachmentId);
  } catch (_error) {}
  if (!belongsToCertificate) return { status: 403, error: "该附件未关联到证书识别记录，已拒绝发送至 AI。" };
  let validated;
  try { validated = await validateAiEndpoint(s.baseUrl); }
  catch (error) { return { status: 400, error: error.message } }
  let image;
  try {
    const file = attachmentPath(body.attachmentId);
    if (!fs.existsSync(file)) return { status: 404, error: "未找到证书附件，请重新上传。" };
    image = decryptBuffer(fs.readFileSync(file));
  } catch (error) { return { status: 400, error: "读取证书附件失败：" + (error.message || error) }; }
  if (!detectImageMime(image)) return { status: 400, error: "仅支持 JPEG、PNG、WebP 格式的证书图片。" };
  if (image.length > 20 * 1024 * 1024) return { status: 400, error: "证书图片超过 20MB，请压缩后重试。" };
  const system = "你是高校学生获奖证书字段抽取助手。仅依据图片中可见文字和版面抽取，不得补造，不得把识别结果表述为证书真实。姓名可能是获奖人、团队成员或指导老师，必须区分角色。每个字段都要给出独立置信度和简短原文依据。返回严格 JSON，不要 Markdown。";
  const user = "请读取证书并返回以下结构：{\"role\":\"学生获奖人|团队成员|指导老师|无关/非本学生|未判定\",\"term\":\"YYYY-YYYY-1学期或YYYY-YYYY-2学期；按落款日期判定：落款月份1-8月为第二学期（如2025年2月→2024-2025-2学期），9-12月为第一学期（如2024年12月→2024-2025-1学期）；无明确落款日期则留空\",\"category\":\"学科竞赛|综合性获奖|挑战杯|大创|资格证书|文体活动|三好优干|社会实践|奖学金|其他荣誉|未判定\",\"level\":\"国家级|省级|地级市|县级市|校级|院级|未判定\",\"awardName\":\"\",\"edition\":\"落款年份+年度，如落款2023年则填2023年度；图片同时出现届次（如第五届）时也按落款年度填写\",\"track\":\"赛道或组别\",\"prize\":\"\",\"organization\":\"\",\"issuingOrganization\":\"\",\"date\":\"YYYY-MM-DD或空\",\"teachers\":\"\",\"members\":\"\",\"certificateNo\":\"\",\"verificationUrl\":\"仅图片中明确出现的https地址，否则空\",\"evidence\":\"证书关键原文摘要\",\"confidence\":0,\"fieldConfidence\":{\"role\":0,\"term\":0,\"category\":0,\"level\":0,\"awardName\":0,\"edition\":0,\"track\":0,\"prize\":0,\"organization\":0,\"issuingOrganization\":0,\"date\":0,\"teachers\":0,\"members\":0,\"certificateNo\":0,\"verificationUrl\":0,\"evidence\":0},\"fieldEvidence\":{\"role\":\"\",\"term\":\"\",\"category\":\"\",\"level\":\"\",\"awardName\":\"\",\"edition\":\"\",\"track\":\"\",\"prize\":\"\",\"organization\":\"\",\"issuingOrganization\":\"\",\"date\":\"\",\"teachers\":\"\",\"members\":\"\",\"certificateNo\":\"\",\"verificationUrl\":\"\",\"evidence\":\"\"},\"rawText\":\"按阅读顺序整理的证书全文\",\"qualityWarnings\":[\"模糊/反光/遮挡/倾斜等，仅在明显时填写\"],\"qrCodes\":[\"图片中可读出的二维码文本或网址\"],\"needsReview\":true}。所有置信度为0至100整数。主办单位和颁发单位必须分别填写，多个单位使用“、”分隔。级别只能依据证书明确文字判断，不能仅凭常识推断；无法确定时填“未判定”。二维码、网址、印章和AI判断都不能作为真实性结论。";
  const inputLength = system.length + user.length;
  const quota = consumeAiQuota(s, inputLength, { feature, provider: s.provider, model: selectedModel, requestKind: "vision", imageBytes: image.length });
  if (quota.error) return { status: 429, error: quota.error, usage: quota.usage };
  const temperature = Math.max(0, Math.min(2, Number(s.temperature != null ? s.temperature : 0.2) || 0.2));
  const t0 = Date.now();
  try {
    const schema = certificateAiSchema();
    const structuredMode = aiStructuredOutputMode(s.provider, selectedModel);
    const payload = buildAiVisionPayload(s.provider, selectedModel, system, user, image, body.highDetail === true, temperature, schema);
    /* 视觉识别耗时较长：单独放宽超时；上游连接中断（非 HTTP 错误）自动重试一次。 */
    let res = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { res = await postAiJson(validated, payload, s.apiKey, s.provider, selectedModel, AI_VISION_TIMEOUT_MS); break; }
      catch (networkError) {
        if (attempt >= 2) throw networkError;
        appendAiAudit({ status: 0, model: selectedModel, host: validated.base.host, ms: Date.now() - t0, promptLen: inputLength, note: "功能：certificate；连接中断，自动重试（" + String(networkError && networkError.message ? networkError.message : networkError).slice(0, 100) + "）" });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    const ms = Date.now() - t0;
    if (res.status < 200 || res.status >= 300) {
      finishAiUsage(quota.usageId, s.provider, null, res.status, s);
      appendAiAudit({ status: res.status, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, note: "功能：certificate；上游状态 " + res.status + "；证书图片 " + image.length + " bytes" });
      return { status: res.status, error: aiUpstreamErrorMessage(res.status, res.text), ms };
    }
    let payloadJson;
    try { payloadJson = JSON.parse(res.text); } catch (_error) { throw new Error("AI 上游返回的不是有效 JSON。"); }
    const content = extractAiContent(s.provider, payloadJson);
    if (!content) throw new Error("AI 上游未返回可用文本，请确认所选模型支持图片输入。");
    const verified = validateCertificateAiResult(parseAiJsonObject(content));
    const verifiedContent = JSON.stringify(verified);
    const tokenUsage = extractAiUsage(s.provider, payloadJson);
    finishAiUsage(quota.usageId, s.provider, payloadJson, 200, s);
    appendAiAudit({ status: 200, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, respLen: verifiedContent.length, note: "功能：certificate；结构化模式 " + structuredMode + "；Token 输入 " + tokenUsage.inputTokens + " / 输出 " + tokenUsage.outputTokens + "；证书图片 " + image.length + " bytes；服务端字段校验通过" });
    return { status: 200, content: verifiedContent, structuredMode, validated: true, model: selectedModel, tokenUsage, usage: aiUsageSnapshot(s), ms };
  } catch (error) {
    const ms = Date.now() - t0;
    finishAiUsage(quota.usageId, s.provider, null, 0, s);
    appendAiAudit({ status: 0, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, note: "功能：certificate；连接失败；" + String(error && error.message ? error.message : error).slice(0, 120) });
    return { status: 502, error: "证书视觉识别失败：" + (error && error.message ? error.message : error), ms };
  }
}

/* 课表截图仅在用户明确授权后临时送入视觉模型：不落盘、不写入业务库，返回结果仍须前端人工确认。 */
async function aiProxyCourseScheduleVision(body) {
  const s = loadAiSecret(), feature = "courseSchedule", selectedModel = selectAiModel(s, feature);
  if (s && s.enabled === false) return { status: 400, error: "AI 功能当前已停用，请先在「AI 智能 → 设置」中开启。" };
  if (normalizeAiFeatures(s && s.features)[feature] === false) return { status: 403, error: "“课表智能识别”已在 API 配置中关闭。" };
  if (!s || !s.baseUrl || !selectedModel || !s.apiKey) return { status: 400, error: "请先在「AI 智能助手 → 设置」保存支持图片输入的 AI 服务、模型和 API Key。" };
  if (s.courseScheduleOutboundApproved !== true) return { status: 403, error: "尚未在 API 配置中确认“允许向外部 AI 服务发送课表截图”。" };
  if (!body || typeof body.imageBase64 !== "string") return { status: 400, error: "课表图片数据无效。" };
  const encoded = body.imageBase64.replace(/^data:image\/(?:jpeg|png|webp);base64,/i, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(encoded) || encoded.length > 16 * 1024 * 1024) return { status: 400, error: "课表图片编码无效或过大。" };
  const image = Buffer.from(encoded, "base64");
  if (!detectImageMime(image)) return { status: 400, error: "仅支持 JPEG、PNG、WebP 格式的课表图片。" };
  if (image.length > 12 * 1024 * 1024) return { status: 400, error: "课表图片超过 12MB，请压缩或裁剪后重试。" };
  let validated;
  try { validated = await validateAiEndpoint(s.baseUrl); } catch (error) { return { status: 400, error: error.message }; }
  const system = "你是高校课表信息抽取助手。仅依据图片中清晰可见的内容提取，不得猜测或补造。所有结果都必须等待人工确认。";
  const user = "识别这张课表图片，严格只返回 JSON：{\"term\":\"\",\"cls\":\"\",\"rows\":[{\"cls\":\"\",\"day\":1,\"weeks\":\"\",\"course\":\"\",\"category\":\"\",\"section\":\"\",\"teacher\":\"\",\"location\":\"\",\"confidence\":0,\"uncertainFields\":[\"\"]}],\"warnings\":[\"\"]}。day 只能为 1 到 7（周一到周日）；week/section/teacher 无法辨认时留空；confidence 为 0 到 100 整数；uncertainFields 仅列出不确定或看不清的字段名。不要输出 Markdown 或任何解释。";
  const inputLength = system.length + user.length;
  const quota = consumeAiQuota(s, inputLength, { feature, provider: s.provider, model: selectedModel, requestKind: "vision", imageBytes: image.length });
  if (quota.error) return { status: 429, error: quota.error, usage: quota.usage };
  const temperature = Math.max(0, Math.min(2, Number(s.temperature != null ? s.temperature : 0.2) || 0.2));
  const t0 = Date.now();
  try {
    const payload = buildAiVisionPayload(s.provider, selectedModel, system, user, image, body.highDetail === true, temperature);
    const res = await postAiJson(validated, payload, s.apiKey, s.provider, selectedModel, AI_VISION_TIMEOUT_MS);
    const ms = Date.now() - t0;
    if (res.status < 200 || res.status >= 300) {
      finishAiUsage(quota.usageId, s.provider, null, res.status, s);
      appendAiAudit({ status: res.status, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, note: "功能：courseSchedule；上游状态 " + res.status + "；课表图片 " + image.length + " bytes" });
      return { status: res.status, error: aiUpstreamErrorMessage(res.status, res.text), ms };
    }
    const upstream = JSON.parse(res.text), content = extractAiContent(s.provider, upstream);
    if (!content) throw new Error("AI 上游未返回可用文本，请确认所选模型支持图片输入。");
    const tokenUsage = extractAiUsage(s.provider, upstream);
    finishAiUsage(quota.usageId, s.provider, upstream, 200, s);
    appendAiAudit({ status: 200, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, respLen: content.length, note: "功能：courseSchedule；课表图片 " + image.length + " bytes；结果待人工确认" });
    return { status: 200, content, model: selectedModel, tokenUsage, usage: aiUsageSnapshot(s), ms };
  } catch (error) {
    const ms = Date.now() - t0;
    finishAiUsage(quota.usageId, s.provider, null, 0, s);
    appendAiAudit({ status: 0, model: selectedModel, host: validated.base.host, ms, promptLen: inputLength, note: "功能：courseSchedule；识别失败；" + String(error && error.message ? error.message : error).slice(0, 120) });
    return { status: 502, error: "课表图片识别失败：" + (error && error.message ? error.message : error), ms };
  }
}

async function aiListModels() {
  if (Date.now() - lastAiModelListAt < 5000) return { status: 429, error: "模型列表读取过于频繁，请 5 秒后重试。" };
  lastAiModelListAt = Date.now();
  const s = loadAiSecret();
  if (!s || s.enabled === false) return { status: 400, error: "请先开启 AI 功能并保存配置。" };
  if (!s.baseUrl || !s.apiKey) return { status: 400, error: "请先保存 Base URL 和 API Key。" };
  let validated;
  try { validated = await validateAiEndpoint(s.baseUrl); }
  catch (error) { return { status: 400, error: error.message }; }
  const t0 = Date.now();
  try {
    const res = await getAiModels(validated, s.apiKey, s.provider);
    const ms = Date.now() - t0;
    if (res.status < 200 || res.status >= 300) return { status: res.status, error: aiUpstreamErrorMessage(res.status, res.text), ms };
    let payload;
    try { payload = JSON.parse(res.text); } catch (_error) { return { status: 502, error: "模型列表响应不是有效 JSON。", ms }; }
    let models;
    if (aiProviderProtocol(s.provider) === "gemini") {
      models = (Array.isArray(payload.models) ? payload.models : [])
        .filter((item) => !Array.isArray(item.supportedGenerationMethods) || item.supportedGenerationMethods.includes("generateContent"))
        .map((item) => String(item.name || "").replace(/^models\//, ""));
    } else {
      models = (Array.isArray(payload.data) ? payload.data : []).map((item) => String(item.id || ""));
    }
    models = [...new Set(models.filter(Boolean))].sort().slice(0, 200);
    return { status: 200, models, ms };
  } catch (error) {
    return { status: 502, error: "读取模型列表失败：" + (error && error.message ? error.message : error), ms: Date.now() - t0 };
  }
}

// 与桥接脚本一起发送，无新前端依赖；只在空闲且没有打开编辑表单时更新页面。
function workbenchSaveBrowser() {
  document.addEventListener("DOMContentLoaded", function () {
    const session = window.__WORKBENCH_SESSION__ || JSON.parse(localStorage.getItem("nnuzc_session") || "{}");
    const api = window.__workbenchStoreSync;
    if (!api) return;
    const panel = document.createElement("details");
    panel.id = "workbenchSavePanel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "数据保存异常提示");
    panel.style.cssText = "position:fixed;right:16px;bottom:12px;z-index:39;background:#fff;border:1px solid #bad5cd;border-radius:10px;padding:8px 12px;max-width:420px;box-shadow:0 4px 18px #173e3220;font-size:14px";
    panel.innerHTML = '<summary style="cursor:pointer"><span id="workbenchSaveStatus">数据连接中…</span><button type="button" data-action="hide" aria-label="隐藏保存状态面板" title="隐藏后可通过右下角小按钮恢复" style="margin-left:12px;border:0;background:transparent;color:#627b72;cursor:pointer;font-size:13px">隐藏</button></summary><p id="workbenchSaveDetail"></p><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" data-action="draft">导出未保存草稿</button><button type="button" data-action="retry">重试保存</button><button type="button" data-action="refresh">读取最新数据</button></div>';
    document.body.appendChild(panel);
    const text = panel.querySelector("#workbenchSaveStatus"), detail = panel.querySelector("#workbenchSaveDetail");
    const restore = document.createElement("button");
    restore.id = "workbenchSavePanelRestore"; restore.type = "button"; restore.textContent = "⚠ 保存异常";
    restore.hidden = true;
    restore.setAttribute("aria-controls", panel.id); restore.setAttribute("aria-label", "显示保存状态面板");
    restore.style.cssText = "position:fixed;right:16px;bottom:12px;z-index:39;background:#fff;color:#45665a;border:1px solid #bad5cd;border-radius:18px;padding:6px 10px;box-shadow:0 2px 8px #173e3218;font-size:13px;cursor:pointer";
    document.body.appendChild(restore);
    let needsAttention = false, dismissed = false;
    function updatePanelVisibility(attention) {
      if (attention && !needsAttention) { dismissed = false; panel.open = true; }
      if (!attention) dismissed = false;
      needsAttention = attention;
      panel.hidden = !attention || dismissed;
      restore.hidden = !attention || !dismissed;
      restore.setAttribute("aria-expanded", String(!panel.hidden));
    }
    updatePanelVisibility(false);
    restore.onclick = function () { dismissed = false; updatePanelVisibility(needsAttention); panel.open = true; panel.querySelector("summary").focus(); };
    let revision = "", pending = false, loading = false, editing = false, modalEditing = false, inputView = "";
    document.addEventListener("input", function (e) { if (!panel.contains(e.target) && !e.target.matches('.stu-row-chk,#stuChkAll,[data-ap-select],.employment-tracking-select,#employmentTrackingSelectAll') && !e.target.closest(".qf-bar,.filter-bar,.zf-query,.toolbar,.ae-bar")) { editing = true; modalEditing = !!e.target.closest(".modal,.drawer"); inputView = typeof currentView !== "undefined" ? currentView : ""; } }, true);
    function formOpen() { return !!document.querySelector(".modal.show,.drawer.show,iframe,[contenteditable=true],.qf-multi.open,.qf-single.open,.sf-native-select.open"); }
    async function refresh(manual) {
      if (api.busy() || formOpen()) {
        if (manual) alert("仍有打开的表单或未保存内容。请先保存、关闭表单；如保存失败，请先导出草稿，再手动刷新。");
        return;
      }
      if (editing && (!manual || !confirm("当前页面有输入内容。确认放弃这些输入并读取最新数据？"))) return;
      editing = false; modalEditing = false;
      await poll(true);
    }
    panel.addEventListener("click", async function (event) {
      const action = event.target.dataset.action;
      if (!action) return;
      if (action === "hide") {
        event.preventDefault(); dismissed = true; updatePanelVisibility(needsAttention); restore.focus();
      } else if (action === "draft") {
        const draft = api.draft(), forms = api.forms();
        if (!draft.length && !forms.length) return alert("没有未保存草稿。");
        const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "数智学工未保存草稿", time: new Date().toISOString(), operations: draft, formSnapshots: forms }, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "数智学工-未保存草稿.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        detail.textContent = "草稿包含业务数据及表单快照，请妥善保管；不包含密码或文件内容。冲突草稿需与最新数据人工核对，不会强制覆盖服务器。";
      } else if (action === "retry") {
        try { await api.retry(); detail.textContent = "保存成功。"; } catch (error) { detail.textContent = error.message; }
      } else if (action === "refresh") refresh(true);

    });
    function equal(a, b) {
      if (a === b) return true;
      if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
      const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
    }
    function storesEqual(a, b) { return equal(Object.fromEntries(Object.entries(a).map(([k,v]) => {try {return [k,JSON.parse(v)];}catch (_) {return [k,v];}})), Object.fromEntries(Object.entries(b).map(([k,v]) => {try {return [k,JSON.parse(v)];}catch (_) {return [k,v];}}))); }
    async function poll(manual) {
      if (loading || document.hidden || window.__workbenchSessionInvalid) return;
      loading = true;
      let dataConnectionError = false;
      const startedVersion = api.version();
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const r = await fetch("/api/workbench/state?known=" + encodeURIComponent(revision), { cache: "no-store", signal: controller.signal });
        const data = await r.json(); if (!r.ok) throw Error(data.error || "连接失败");
        // A response read before a local save must never replace that save.
        const stale = startedVersion !== api.version() || api.busy();
        if (stale) revision = "";
        pending = stale || !!window.__workbenchRemoteRefresh || api.pendingModels() || !!data.changed && !storesEqual(data.storeValues || {}, api.values());
        if (!formOpen() && (modalEditing || inputView && typeof currentView !== "undefined" && currentView !== inputView)) { editing = false; modalEditing = false; }
        if (!stale && !formOpen() && !editing) {
          if ((!data.changed || api.acceptSnapshot(data.storeValues || {},data.academicVersion)) && api.hydrate()) {
            revision = data.revision; pending = false;
          }
        }
        text.textContent = api.failed() ? "⚠ 未保存草稿" : api.busy() ? "正在保存…" : pending ? "有最新数据待更新" : "数据已保存 · 连接正常";
        detail.textContent = window.__workbenchSaveError || ("数据保存在本机服务。打开表单时暂缓应用其他页面的更新。");
      } catch (error) { dataConnectionError = true; text.textContent = "⚠ " + (window.__workbenchSessionInvalid ? "账号已失效，请重新登录" : "数据连接中断"); detail.textContent = window.__workbenchSaveError || error.message; }
      finally {
        clearTimeout(timeout);
        const attention = api.failed() || !!dataConnectionError || !!window.__workbenchSaveError;
        restore.title = "显示保存状态面板：" + text.textContent;
        updatePanelVisibility(attention);
        loading = false;
      }
    }
    poll(); setInterval(poll, 4000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    window.addEventListener("pageshow", () => poll());
  });
}

function bridgeScript(activeSession) {
  const session = {
    uid: activeSession.uid,
    name: activeSession.name,
    role: activeSession.role,
    roleName: activeSession.roleName,
    context: activeSession.context,
    issuedAt: activeSession.createdAt
  };
  const initialLicense = licensePublicStatus();
  /* 浏览状态也预载数据；桥接写队列与服务端提交校验继续禁止未授权写入。 */
  const initialStore = readStore();
  const initialDemo = demoStatus();
  const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `(() => {
    "use strict";
    /* 兼容旧前端调用，但不再向网页暴露任何认证令牌；认证由 HttpOnly Cookie 完成。 */
    window.TOKEN="";
    window.SESSION=${scriptJson(session)};
    const HOST_SESSION=SESSION.uid==='local-super-admin';
    window.__WORKBENCH_LICENSE__=${scriptJson(initialLicense)};
    window.__WORKBENCH_DEMO__=${scriptJson(initialDemo)};
    window.__WORKBENCH_READ_ONLY__=window.__WORKBENCH_LICENSE__.required===true&&window.__WORKBENCH_LICENSE__.valid!==true;
    const nativeFetch=window.fetch.bind(window);
    function contextFetch(input,options){
      const target=new URL(typeof input==='string'?input:input&&input.url||String(input),location.href);
      if(target.origin===location.origin&&target.pathname.indexOf('/api/')===0){
        const init=Object.assign({},options||{}),headers=new Headers(init.headers||(input&&input.headers)||{});headers.set('X-Workbench-Context',SESSION.context);init.headers=headers;return nativeFetch(input,init);
      }
      return nativeFetch(input,options);
    }
    window.fetch=async function(input,options){
      const response=await contextFetch(input,options);
      if(response.status===401 && response.headers.get("X-Workbench-Session")==="invalid" && location.pathname!=="/login.html") lockWorkbenchSession();
      if(response.status===403){
        response.clone().json().then(function(payload){
          if(payload&&payload.code==="LICENSE_LOCKED"&&window.__WORKBENCH_LICENSE__&&window.__WORKBENCH_LICENSE__.valid===true&&location.pathname!=="/login.html"){
            window.__WORKBENCH_LICENSE__=payload.license||{required:true,valid:false,state:"revoked"};
            lockWorkbenchSession('license');
          }
        }).catch(function(){});
      }
      return response;
    };
    const nativeGet=Storage.prototype.getItem, nativeSet=Storage.prototype.setItem, nativeRemove=Storage.prototype.removeItem;
    /* 会话必须先落本地：入口保护依赖 localStorage.nnuzc_session，先写入保证能进工作台 */
    nativeSet.call(localStorage,"nnuzc_session",JSON.stringify(SESSION));
    /* 服务端在生成桥接脚本时已读取 store，避免浏览器主线程同步 XHR。 */
    let STORE=${scriptJson(initialStore)};
    window.__workbenchStore=STORE;
    /* 清掉旧数据键（保留会话与账号），再用服务端数据预热 localStorage 作为回退缓存 */
    Object.keys(localStorage).filter(function(key){ return key.indexOf("nnuzc_")===0 && key!=="nnuzc_session" && key!=="nnuzc_accounts"; }).forEach(function(key){ try{ nativeRemove.call(localStorage,key); }catch(_e){} });
    Object.keys(STORE).forEach(function(key){ try{ nativeSet.call(localStorage,key,STORE[key]); }catch(_e){} });
    const SAVE_QUEUE=new Map();
    // Runtime objects may still be held by an open form after a merged save.
    // Keep their last visible baseline until the model has consumed the merge.
    const RUNTIME_BASE=new Map(),MODEL_UPDATES=new Set();
    let storeVersion=0,academicVersion=null;
    let explicitTail=Promise.resolve(),explicitPending=0,explicitActive=false,explicitBatch=[];
    let saveTimer=null,saveInFlight=false,savePromise=Promise.resolve(),saveSequence=0,failedBatch=null,inFlightBatch=[],sessionLocked=false,lockedOperations=[],lockedFormDrafts=[];
    function workbenchDraft(){
      const map=new Map();
      [lockedOperations,explicitBatch,inFlightBatch,failedBatch||[],[...SAVE_QUEUE.values()]].forEach(function(rows){rows.forEach(function(item){const previous=map.get(item.key);map.set(item.key,Object.assign({},item,{baseValue:previous?previous.baseValue:item.baseValue}));});});
      return [...map.values()];
    }
    function captureFormSnapshots(){
      return [...document.querySelectorAll('.modal.show input,.modal.show select,.modal.show textarea,.modal.show [contenteditable=true],.drawer.show input,.drawer.show select,.drawer.show textarea,.drawer.show [contenteditable=true]')].filter(function(el){return !['password','file','hidden'].includes(el.type)&&!/(password|passwd|api.?key|token|secret)/i.test([el.name,el.id,el.autocomplete].join(' '))&&(!['radio','checkbox'].includes(el.type)||el.checked);}).map(function(el){return {id:el.id,name:el.name||'',value:el.isContentEditable?el.textContent:el.value};});
    }
    function lockWorkbenchSession(reason){
      window.__workbenchSessionInvalid=true;window.__WORKBENCH_READ_ONLY__=true;
      if(sessionLocked)return;
      sessionLocked=true;lockedOperations=workbenchDraft();
      if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
      lockedFormDrafts=captureFormSnapshots();
      function mount(){
        if(document.getElementById('workbenchSessionLock'))return;
        document.body.classList.add('workbench-session-locked');
        document.querySelectorAll('.modal.show,.drawer.show,.mask.show').forEach(function(el){el.classList.remove('show');});
        const style=document.createElement('style');style.textContent='body.workbench-session-locked> :not(#workbenchSessionLock):not(style):not(script){display:none!important}#workbenchSessionLock{position:fixed;inset:0;z-index:100100;display:grid;place-items:center;padding:20px;box-sizing:border-box;background:var(--bg,#f2f5f7);color:var(--text,#1f2d29);overflow:auto}#workbenchSessionLock .session-lock-card{width:100%;max-width:480px;padding:28px;box-sizing:border-box;border:1px solid var(--line,#c9d3cf);border-radius:16px;background:var(--card,#fff);box-shadow:0 16px 50px #173e3220}#workbenchSessionLock h2{font-size:22px;margin:0 0 14px}#workbenchSessionLock p{font-size:15px;line-height:1.8;color:var(--muted,#5f6e69)}#workbenchSessionLock .session-lock-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}';document.head.appendChild(style);
        [...document.body.children].forEach(function(el){if(!['SCRIPT','STYLE'].includes(el.tagName)){el.inert=true;el.setAttribute('aria-hidden','true');}});
        ['goto','openModal','showDrawer'].forEach(function(name){const original=window[name];if(typeof original==='function')window[name]=function(){if(window.__workbenchSessionInvalid)return false;return original.apply(this,arguments);};});
        const root=document.createElement('div');root.id='workbenchSessionLock';root.setAttribute('role','alertdialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','workbenchSessionLockTitle');
        root.innerHTML='<div class="session-lock-card"><h2 id="workbenchSessionLockTitle">工作台会话已失效</h2><p>会话已退出、设备已解除配对或主机服务已重启。业务页面已锁定，请重新进入。</p><p>服务器中已保存的数据不会删除。未保存的操作及当前弹窗表单快照可先导出；附件文件需要重新选择。</p><div class="session-lock-actions"><button class="btn btn-ghost" id="workbenchLockedDraft" type="button">导出未保存草稿</button><button class="btn btn-primary" id="workbenchRelogin" type="button">重新登录</button></div></div>';
        if(HOST_SESSION){root.querySelector('h2').textContent='主机会话已失效';root.querySelector('p').textContent='主机会话已过期或主机服务已重启。业务页面已锁定，请返回主页重新进入。';root.querySelector('#workbenchRelogin').textContent='返回主页';}
        if(reason==='license'){root.querySelector('h2').textContent='主机授权不可用';root.querySelector('p').textContent='主机授权已失效，业务页面已锁定。请先导出草稿，并由主机管理员重新激活后继续使用。';root.querySelector('#workbenchRelogin').textContent='返回主页';}
        document.body.appendChild(root);
        root.querySelector('#workbenchLockedDraft').onclick=function(){
          const operations=workbenchDraft();if(!operations.length&&!lockedFormDrafts.length)return alert('没有未保存草稿。');
          const url=URL.createObjectURL(new Blob([JSON.stringify({format:'数智学工未保存草稿',time:new Date().toISOString(),operations:operations,formSnapshots:lockedFormDrafts},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='数智学工-会话失效未保存草稿.json';link.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
        };
        root.querySelector('#workbenchRelogin').onclick=function(){if((workbenchDraft().length||lockedFormDrafts.length)&&!confirm('即将离开当前页面，未保存内容不会自动保存。请先导出草稿。是否继续返回主页？'))return;location.replace('/');};
        root.querySelector('#workbenchRelogin').focus();
      }
      if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
    }
    window.__workbenchLockSession=lockWorkbenchSession;
    window.addEventListener('storage',function(event){
      if(event.key!=='nnuzc_session')return;
      let next;try{next=JSON.parse(event.newValue||'null');}catch(_error){}
      if(!next||next.uid!==SESSION.uid||next.context!==SESSION.context)lockWorkbenchSession();
    });
    async function saveRequest(operation,force){
      const options={method:operation.method,headers:{"X-Workbench-Token":TOKEN}};
      if(operation.operations){options.headers["Content-Type"]="application/json";options.body=JSON.stringify({operations:operation.operations.map(function(item){return {key:item.key,method:item.method,value:item.value,baseValue:item.baseValue,studentIdRenames:item.studentIdRenames};}),force:force===true,recycleCheckClassIds:operation.recycleCheckClassIds});}
      else if(operation.value!==undefined){options.headers["Content-Type"]="application/json";options.body=JSON.stringify({value:String(operation.value),force:force===true});}
      const response=await contextFetch(operation.url,options);
      let payload={};try{payload=await response.json();}catch(_error){}
      if(response.status===401){lockWorkbenchSession();throw new Error("会话无效，请先导出未保存草稿，再重新登录");}
      if(response.status===403&&payload.code==='LICENSE_LOCKED'){window.__WORKBENCH_LICENSE__=payload.license||{required:true,valid:false};lockWorkbenchSession('license');}
      if(!response.ok){
        if(response.status===409&&payload&&payload.code==="STUDENTS_DROP_GUARD"){
          const g=payload.guard||{};
          const ok=window.confirm("⚠️ 安全拦截：本次操作会把学生从 "+g.existing+" 条减少到 "+g.incoming+" 条，将永久删除大量学生数据。\\n\\n如确要执行，请先到【数据备份】模块备份，然后点“确定”强制覆盖；否则点“取消”（服务端数据保持不变，页面将恢复）。");
          if(ok)return saveRequest(operation,true);
        }
        const error=new Error(payload.error||"本地数据库保存失败");error.workbenchSync=true;error.code=payload.code||"";throw error;
      }
      return payload;
    }
    function startSaveDrain(retryBatch){
      if(sessionLocked)return Promise.reject(new Error("会话已失效，业务页面已锁定。请先导出草稿，再重新登录。"));
      if(explicitActive)return explicitTail.then(function(){return startSaveDrain(retryBatch);});
      if(saveInFlight)return savePromise;
      if(failedBatch)return Promise.reject(new Error("仍有未保存草稿，请先处理保存失败提示"));
      // Retry the uncertain original batch before later local edits. Coalescing
      // both would conflict with our own write if only its response was lost.
      const batch=retryBatch||[...SAVE_QUEUE.values()];if(!retryBatch)SAVE_QUEUE.clear();
      if(!batch.length)return Promise.resolve();
      saveInFlight=true;inFlightBatch=batch;
      savePromise=saveRequest({method:"POST",url:"/api/store/batch",operations:batch},false)
        .then(function(payload){
          const values={};batch.forEach(function(item){if(!SAVE_QUEUE.has(item.key)&&STORE[item.key]===item.value)values[item.key]=payload.storeValues[item.key];if(item.method==="DELETE"&&!SAVE_QUEUE.has(item.key)&&!Object.prototype.hasOwnProperty.call(STORE,item.key))values[item.key]=payload.storeValues[item.key];});
          Object.keys(payload.storeValues||{}).forEach(function(key){if(!batch.some(item=>item.key===key)&&!SAVE_QUEUE.has(key))values[key]=payload.storeValues[key];});
          if(payload.academicIdentityChanged)MODEL_UPDATES.add("academic_public_state");
          Object.keys(values).forEach(function(key){
            const item=batch.find(function(row){return row.key===key;});
            if(item && values[key]!==item.value){RUNTIME_BASE.set(key,item.value===undefined?null:item.value);MODEL_UPDATES.add(key);}
          });
          applyServerStoreSnapshot(values,true);
          window.__workbenchLastSavedAt=Date.now();
          if(payload.remoteMergedKeys&&payload.remoteMergedKeys.length)window.__workbenchRemoteRefresh=true;
          return payload;
        })
        .catch(function(error){if(error&&error.code==="DEMO_MODE_READ_ONLY"){throw error;}failedBatch=batch;notifySaveFailure(error);throw error;})
        .finally(function(){saveInFlight=false;inFlightBatch=[];if(SAVE_QUEUE.size&&!failedBatch&&!sessionLocked)scheduleSaveDrain();});
      return savePromise;
    }
    function scheduleSaveDrain(){
      if(saveTimer)return;
      saveTimer=setTimeout(function(){saveTimer=null;startSaveDrain().catch(function(){});},25);
    }
    function queueSave(key,method,url,value,baseValue){storeVersion++;const existing=SAVE_QUEUE.get(key);const operation={key:key,method:method,url:url,value:value,baseValue:existing?existing.baseValue:baseValue,sequence:++saveSequence};if(existing&&existing.studentIdRenames)operation.studentIdRenames=existing.studentIdRenames;SAVE_QUEUE.set(key,operation);if(!failedBatch)scheduleSaveDrain();}
    function registerStudentIdRename(from,to){
      const operation=SAVE_QUEUE.get("nnuzc_students");if(!operation)throw new Error("学生主档尚未排队保存，请刷新后重试。");
      const renames=operation.studentIdRenames||(operation.studentIdRenames=[]),previous=renames.find(item=>item.to===String(from));
      if(previous){previous.to=String(to);if(previous.from===previous.to)renames.splice(renames.indexOf(previous),1);}else renames.push({from:String(from),to:String(to)});
    }
    async function flushStoreQueue(){
      if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
      do{await startSaveDrain();}while(saveInFlight||SAVE_QUEUE.size);
    }
    function commitExplicitBatch(operations,recycleCheckClassIds){
      const batch=operations.map(function(operation){return Object.assign({},operation);});
      explicitPending++;storeVersion++;
      const result=explicitTail.catch(function(){}).then(async function(){
        await flushStoreQueue();explicitActive=true;explicitBatch=batch;
        try{
          const payload=await saveRequest({method:"POST",url:"/api/store/batch",operations:batch,recycleCheckClassIds:recycleCheckClassIds},false);
          const values={};
          batch.forEach(function(item){if(!SAVE_QUEUE.has(item.key)){
            values[item.key]=payload.storeValues[item.key];
            // The caller adopts its submitted model after this promise resolves.
            // Its next edit must use that model, not the pre-import cache, as base.
            RUNTIME_BASE.set(item.key,item.value===undefined?null:item.value);
            if(values[item.key]!==item.value)MODEL_UPDATES.add(item.key);
          }});
          Object.keys(payload.storeValues||{}).forEach(function(key){if(!batch.some(item=>item.key===key)&&!SAVE_QUEUE.has(key))values[key]=payload.storeValues[key];});
          if(payload.academicIdentityChanged)MODEL_UPDATES.add("academic_public_state");
          applyServerStoreSnapshot(values,true);window.__workbenchLastSavedAt=Date.now();
          return payload;
        }finally{explicitActive=false;explicitBatch=[];}
      }).finally(function(){explicitPending--;if(SAVE_QUEUE.size&&!failedBatch&&!sessionLocked)scheduleSaveDrain();});
      explicitTail=result;return result;
    }
    function applyServerStoreSnapshot(values,acknowledged){
      const applied={};
      if(!values||typeof values!=="object")return applied;
      Object.keys(values).forEach(function(key){
        if(!/^nnuzc_[A-Za-z0-9_]+$/.test(key)||key==="nnuzc_session"||key==="nnuzc_accounts")return;
        // External tool/recycle responses must not replace an unconfirmed local edit.
        if(!acknowledged&&(SAVE_QUEUE.has(key)||explicitBatch.some(function(item){return item.key===key;})||inFlightBatch.some(function(item){return item.key===key;})||(failedBatch||[]).some(function(item){return item.key===key;}))){window.__workbenchRemoteRefresh=true;return;}
        const value=values[key];
        if(STORE[key]!==value){if(!RUNTIME_BASE.has(key))RUNTIME_BASE.set(key,STORE[key]===undefined?null:STORE[key]);storeVersion++;MODEL_UPDATES.add(key);}
        if(value===null||value===undefined){delete STORE[key];try{nativeRemove.call(localStorage,key);}catch(_error){}}
        else{STORE[key]=String(value);try{nativeSet.call(localStorage,key,String(value));}catch(_error){}}
        applied[key]=value;
      });
      window.__workbenchStore=STORE;
      return applied;
    }
    function replaceServerStoreSnapshot(values){
      const next=values&&typeof values==="object"?values:{},delta={};
      new Set(Object.keys(STORE).concat(Object.keys(next))).forEach(function(key){
        const value=Object.prototype.hasOwnProperty.call(next,key)?next[key]:null;
        if(STORE[key]!==value && !(STORE[key]===undefined&&value===null))delta[key]=value;
      });
      const applied=applyServerStoreSnapshot(delta,true);
      /* 权威清空/恢复已经替换了整个服务端快照，旧基线和模型更新标记不能再次回写。 */
      RUNTIME_BASE.clear();MODEL_UPDATES.clear();failedBatch=null;
      return applied;
    }
    async function recycleJson(url,options){
      const response=await fetch(url,options||{}), payload=await response.json().catch(function(){return {};});
      if(!response.ok){const error=new Error(payload.error||"回收站操作失败");error.code=payload.code||"";error.status=response.status;throw error;}
      if(payload.storeValues)payload.storeValues=applyServerStoreSnapshot(payload.storeValues);
      return payload;
    }
    function notifySaveFailure(error){
      if(window.__workbenchSaveFailure) return;
      window.__workbenchSaveFailure=true;
      const message="保存未能确认："+(error&&error.message?error.message:"未知错误")+"。请求可能已到达主机，草稿已保留；请使用保存异常提示重试或核对最新数据。";
      window.__workbenchSaveError=message;
      setTimeout(function(){if(typeof window.showToast==="function")window.showToast(message,"error");},0);
    }
    Storage.prototype.getItem=function(key){
      const k=String(key);
      if(this===localStorage && k.indexOf("nnuzc_")===0 && k!=="nnuzc_session"){
        if(window.__workbenchStore && Object.prototype.hasOwnProperty.call(window.__workbenchStore,k)) return window.__workbenchStore[k];
        // Shared browser cache may contain another tab's uncommitted writes.
        // Missing business keys must remain absent from this page's snapshot.
        return k==="nnuzc_accounts"?nativeGet.call(this,k):null;
      }
      return nativeGet.call(this,k);
    };
    Storage.prototype.setItem=function(key,value){
      const k=String(key), v=String(value);
      if(this===localStorage && /^nnuzc_[A-Za-z0-9_]+$/.test(k) && k!=="nnuzc_session" && k!=="nnuzc_accounts"){
        if(sessionLocked)return;
        if(window.__WORKBENCH_READ_ONLY__||SESSION.role==="viewer"){
          /* 只读浏览期间仅允许当前学期作为本次会话的查看条件，不写入数据库。 */
          if(k==="nnuzc_current_term"&&window.__workbenchStore)window.__workbenchStore[k]=v;
          try{return nativeSet.call(this,k,v);}catch(_e){return;}
        }
        const baseValue=RUNTIME_BASE.has(k)?RUNTIME_BASE.get(k):STORE[k]===undefined?null:STORE[k];
        if(window.__workbenchStore) window.__workbenchStore[k]=v;
        if(baseValue!==v)queueSave(k,"PUT","/api/store/"+encodeURIComponent(k),v,baseValue);
      }
      try{ return nativeSet.call(this,k,v); }catch(_e){ /* 本地缓存可选，配额失败忽略 */ }
    };
    Storage.prototype.removeItem=function(key){
      const k=String(key);
      if(this===localStorage && /^nnuzc_[A-Za-z0-9_]+$/.test(k) && k!=="nnuzc_session" && k!=="nnuzc_accounts"){
        if(sessionLocked)return;
        if(window.__WORKBENCH_READ_ONLY__||SESSION.role==="viewer"){try{return nativeRemove.call(this,k);}catch(_e){return;}}
        const baseValue=RUNTIME_BASE.has(k)?RUNTIME_BASE.get(k):STORE[k]===undefined?null:STORE[k];
        if(window.__workbenchStore) delete window.__workbenchStore[k];
        if(baseValue!==null)queueSave(k,"DELETE","/api/store/"+encodeURIComponent(k),undefined,baseValue);
      }
      try{ return nativeRemove.call(this,k); }catch(_e){}
    };
    window.addEventListener("beforeunload",function(event){if(saveInFlight||explicitPending||SAVE_QUEUE.size||failedBatch||(sessionLocked&&lockedFormDrafts.length)){event.preventDefault();event.returnValue="";}});
    window.__workbenchStoreSync={
      busy:function(){return saveInFlight||explicitPending>0||SAVE_QUEUE.size>0||!!failedBatch;},
      failed:function(){return !!failedBatch;},
      draft:workbenchDraft,
      forms:function(){return sessionLocked?lockedFormDrafts:captureFormSnapshots();},
      retry:async function(){if(sessionLocked)throw new Error("会话已失效，请重新登录后再处理草稿。");if(saveInFlight)throw new Error("正在保存，请等待当前保存完成后再重试。");if(!failedBatch)return flushStoreQueue();const original=failedBatch;failedBatch=null;window.__workbenchSaveFailure=false;window.__workbenchSaveError="";await startSaveDrain(original);return flushStoreQueue();},
      values:function(){return STORE;}
      ,version:function(){return storeVersion;}
      ,acceptSnapshot:function(values,nextAcademicVersion){
        if(saveInFlight||explicitPending||SAVE_QUEUE.size||failedBatch||sessionLocked)return false;
        const delta={};
        new Set(Object.keys(STORE).concat(Object.keys(values||{}))).forEach(function(key){
          const value=Object.hasOwn(values||{},key)?values[key]:null;
          if(STORE[key]!==value && !(STORE[key]===undefined&&value===null))delta[key]=value;
        });
        applyServerStoreSnapshot(delta,true);
        if(Number.isSafeInteger(nextAcademicVersion)&&nextAcademicVersion!==academicVersion){MODEL_UPDATES.add("academic_public_state");academicVersion=nextAcademicVersion;}
        return true;
      }
      ,hydrate:function(){
        if(saveInFlight||explicitPending||SAVE_QUEUE.size||failedBatch||sessionLocked)return false;
        if(MODEL_UPDATES.size){
          if(typeof window.workbenchApplySyncedData!=="function")return false;
          const keys=[...MODEL_UPDATES];window.workbenchApplySyncedData(keys);
          keys.forEach(function(key){MODEL_UPDATES.delete(key);RUNTIME_BASE.delete(key);});
        }
        window.__workbenchRemoteRefresh=false;return true;
      }
      ,pendingModels:function(){return MODEL_UPDATES.size>0;}
    };
    window.workbench={legacy:{
      flushStore:flushStoreQueue,
      registerStudentIdRename:registerStudentIdRename,
      commitStoreBatch:commitExplicitBatch,
      readStoreSnapshot:async function(){await flushStoreQueue();const version=storeVersion;const response=await contextFetch("/api/store",{headers:{"X-Workbench-Token":TOKEN},cache:"no-store"});const values=await response.json();if(!response.ok)throw new Error(values.error||"读取数据失败");if(version===storeVersion)applyServerStoreSnapshot(values,false);return values;},
      applyServerStoreSnapshot:applyServerStoreSnapshot,
      partyImport:async function(rows){await flushStoreQueue();return recycleJson("/api/party/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows:rows||[],baseValue:STORE.nnuzc_students||"[]"})});},
      recycleList:async(query)=>recycleJson("/api/recycle-bin"+(query?"?"+new URLSearchParams(query).toString():""),{cache:"no-store"}),
      recycleGet:async(id)=>recycleJson("/api/recycle-bin/"+encodeURIComponent(id),{cache:"no-store"}),
      recycleDeletePreview:async(body)=>{await flushStoreQueue();return recycleJson("/api/recycle-bin/delete-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});},
      recycleMove:async(body)=>{await flushStoreQueue();return recycleJson("/api/recycle-bin/move",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});},
      recycleStudentDeletePreview:async(studentIds)=>{await flushStoreQueue();return recycleJson("/api/recycle-bin/student-delete-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({studentIds:studentIds||[]})});},
      recycleStudentMove:async(body)=>{await flushStoreQueue();return recycleJson("/api/recycle-bin/student-move",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});},
      recycleRestorePreview:async(id)=>recycleJson("/api/recycle-bin/"+encodeURIComponent(id)+"/restore-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),
      recycleRestore:async(id,body)=>recycleJson("/api/recycle-bin/"+encodeURIComponent(id)+"/restore",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),
      recyclePurge:async(id,body)=>recycleJson("/api/recycle-bin/"+encodeURIComponent(id)+"/purge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),
      recycleRestoreBatchPreview:async(ids)=>recycleJson("/api/recycle-bin/restore-batch-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids||[]})}),
      recycleRestoreBatch:async(body)=>recycleJson("/api/recycle-bin/restore-batch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),
      recyclePurgeBatchPreview:async(body)=>recycleJson("/api/recycle-bin/purge-batch-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),
      recyclePurgeBatch:async(body)=>recycleJson("/api/recycle-bin/purge-batch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),
      recycleSetRetention:async(body)=>recycleJson("/api/recycle-bin/retention",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),
      recycleAuditList:async(limit)=>recycleJson("/api/recycle-bin/audit?limit="+encodeURIComponent(limit||100),{cache:"no-store"}),
      backupList:async()=>{const r=await fetch("/api/backups",{headers:{"X-Workbench-Token":TOKEN}});if(!r.ok)throw new Error("读取备份失败");return r.json();},
      backupCreate:async()=>{await flushStoreQueue();const r=await fetch("/api/backups",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({note:"网页端手动备份"})});if(!r.ok)throw new Error("创建备份失败");return r.json();},
      storeExport:async()=>{await flushStoreQueue();const r=await fetch("/api/store",{headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"读取备份数据失败");const data={};Object.keys(j).forEach((key)=>{if(/^nnuzc_[A-Za-z0-9_]+$/.test(key)&&key!=="nnuzc_session"&&key!=="nnuzc_accounts"){try{data[key]=JSON.parse(j[key]);}catch(_e){}}});return data;},
      jsonBackupRestore:async(data)=>{await flushStoreQueue();const r=await fetch("/api/store/restore-json",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({data:data})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"导入备份失败");return j;},
      backupPreflight:async(id)=>{const r=await fetch("/api/backups/"+encodeURIComponent(id)+"/preflight",{headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"恢复前检查失败");return j;},
      backupRestore:async(id,preflight,mode)=>{await flushStoreQueue();const p=preflight||await window.workbench.legacy.backupPreflight(id);const r=await fetch("/api/backups/"+encodeURIComponent(id)+"/restore",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({confirmId:id,sha256:p.sha256,mode:mode||"replace"})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"恢复备份失败");return j;},
       backupDelete:async(id)=>{const r=await fetch("/api/backups/"+encodeURIComponent(id),{method:"DELETE",headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"删除备份失败");if(!j.deleted||j.verified!==true||Array.isArray(j.remainingArtifacts)&&j.remainingArtifacts.length)throw new Error("服务器未能确认备份文件已完整删除");return j;},
      clearLocalBusinessData:async()=>{await flushStoreQueue();const r=await fetch("/api/store/clear-local-business-data",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({confirmation:"清空本地全部数据"})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"清空本地数据失败");replaceServerStoreSnapshot(j.storeValues||{});return j;},
      demoStatus:async()=>{const r=await fetch("/api/demo/status",{headers:{"X-Workbench-Token":TOKEN},cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"读取演示数据状态失败");return j;},
      demoLoad:async()=>{await flushStoreQueue();const r=await fetch("/api/demo/load",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:"{}"});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||"载入演示数据失败");e.code=j.code||"";throw e;}return j;},
      demoClear:async()=>{failedBatch=null;SAVE_QUEUE.clear();window.__workbenchSaveFailure=false;window.__workbenchSaveError="";const r=await fetch("/api/demo/clear",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:"{}"});const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||"清除演示数据失败");e.code=j.code||"";throw e;}return j;},
      legacyBackupReport:async()=>{const r=await fetch("/api/backups/legacy-report",{headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"历史备份扫描失败");return j;},
      legacyBackupPurge:async(report)=>{const r=await fetch("/api/backups/legacy-purge",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({action:"purge",phrase:report.actionPhrase,confirmCount:report.fileCount,confirmBytes:report.totalBytes})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"历史备份清理失败");return j;},
      systemHealth:async()=>{const r=await fetch("/api/system/health",{headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"读取系统健康状态失败");return j;},
      webdavStatus:async()=>{const r=await fetch("/api/webdav/status",{headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"读取 WebDAV 状态失败");return j;},
      webdavConfig:async(body)=>{const r=await fetch("/api/webdav/config",{method:"PUT",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify(body||{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"保存 WebDAV 配置失败");return j;},
      webdavTest:async(body)=>{const r=await fetch("/api/webdav/test",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify(body||{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"WebDAV 连接测试失败");return j;},
      webdavBackup:async(syncPassword)=>{const r=await fetch("/api/webdav/backup",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({syncPassword:syncPassword})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"WebDAV 备份失败");return j;},
      webdavRestore:async(syncPassword)=>{const r=await fetch("/api/webdav/restore",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({syncPassword:syncPassword,confirmation:"恢复云端数据"})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"WebDAV 恢复失败");return j;},
      attachmentUpload:async(name,contentBase64)=>{const binary=atob(String(contentBase64||"")),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);const r=await fetch("/api/attachments?name="+encodeURIComponent(name||"附件"),{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/octet-stream"},body:bytes});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"附件保存失败");}return r.json();},
      attachmentUploadFile:async(name,file)=>{const r=await fetch("/api/attachments?name="+encodeURIComponent(name||"附件"),{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/octet-stream"},body:file});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"附件保存失败");}return r.json();},
      attachmentMaintenance:async()=>{const r=await fetch("/api/attachments/maintenance",{headers:{"X-Workbench-Token":TOKEN}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"附件扫描失败");return j;},
      attachmentQuarantine:async(report)=>{const r=await fetch("/api/attachments/maintenance",{method:"POST",headers:{"X-Workbench-Token":TOKEN,"Content-Type":"application/json"},body:JSON.stringify({action:"quarantine",phrase:"隔离孤立附件",confirmCount:report.orphanCount})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"附件隔离失败");return j;},
      attachmentDelete:async(id)=>{await flushStoreQueue();const r=await fetch("/api/attachments/"+encodeURIComponent(id),{method:"DELETE",headers:{"X-Workbench-Token":TOKEN}});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||"附件删除失败");}return r.json();},
    }};
    setTimeout(()=>{
      window.desktopBackupRestore=async function(id){
        let preflight;
        try { preflight=await window.workbench.legacy.backupPreflight(id); }
        catch(error) { alert("恢复前检查失败："+error.message); return; }
        const size=(preflight.size/1024/1024).toFixed(2)+" MB";
        const answer=prompt("即将恢复备份：\\n创建时间："+(preflight.createdAt||"未知")+"\\n备注："+(preflight.note||"无")+"\\n数据库："+size+"\\n附件："+preflight.attachmentCount+" 个\\n完整性：已通过\\n\\n恢复会覆盖当前数据；如需保留当前数据，请先手动创建本机备份。请输入“确认恢复”继续：","");
        if(answer!=="确认恢复") return;
        try { await window.workbench.legacy.backupRestore(id,preflight); alert("备份已恢复，网页将刷新以加载恢复后的数据。"); window.location.reload(); }
        catch(error) { alert("恢复失败："+error.message); }
      };
      window.desktopBackupRender=async function(){
        const host=document.getElementById("desktopBackupRows"); if(!host) return;
        try { const rows=await window.workbench.legacy.backupList(); host.innerHTML=rows.length?'<table><thead><tr><th>创建时间</th><th>备注</th><th>文件</th><th>操作</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.created_at)+'</td><td>'+esc(r.note||'')+'</td><td>'+esc(r.relative_path)+'</td><td><button class="btn btn-ghost btn-sm" data-id="'+attr(r.id)+'" onclick="desktopBackupRestore(this.dataset.id)">恢复</button> <button class="btn btn-ghost btn-sm" data-id="'+attr(r.id)+'" onclick="desktopBackupDelete(this.dataset.id,this)">删除</button></td></tr>').join('')+'</tbody></table>':'暂无备份。'; }
        catch(error) { host.textContent='读取失败：'+error.message; }
      };
      window.desktopBackupDelete=async function(id,button){
        if(!confirm("确认删除此备份文件？删除后无法恢复。")) return;
        const oldText=button&&button.textContent;if(button){button.disabled=true;button.textContent="删除中…";}
        try { const result=await window.workbench.legacy.backupDelete(id);if(!result||result.verified!==true||(result.remainingArtifacts||[]).length)throw new Error("未能确认备份文件已完整删除");await window.desktopBackupRender();showToast("备份文件及关联数据已彻底删除","ok"); }
        catch(error) { if(button&&button.isConnected){button.disabled=false;button.textContent=oldText||"删除";}alert("删除失败："+error.message); }
      };
      window.desktopBackupCreate=async function(){
        try { await window.workbench.legacy.backupCreate(); await window.desktopBackupRender(); showToast("备份已创建","ok"); }
        catch(error) { alert("创建备份失败："+error.message); }
      };
    },0);
    (${workbenchSaveBrowser.toString()})();
  })();`;
}

const academicPublicService = createAcademicPublicService(()=>database,{encrypt:encryptText,decrypt:decryptText,store:readStore,accounts:()=>[],task:task=>{const tasks=JSON.parse(readStore().nnuzc_tasks||"[]");if(!tasks.some(t=>t.id===task.id))tasks.unshift(task);database.prepare("INSERT INTO legacy_ui_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run("nnuzc_tasks",encryptText(JSON.stringify(tasks)));},assert:assertRequestSession,json:sendJson,read:readJson,buffer:readBuffer,download:(response,bytes,name)=>send(response,200,bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",{"Content-Disposition":"attachment; filename*=UTF-8\'\'"+encodeURIComponent(name),"Cache-Control":"no-store"})});

async function handler(request, response) {
  try {
    if (!isLocalRequest(request)) return sendJson(response, 403, { error: "此版本仅允许在安装本机使用。" });
    // Apply the same origin boundary before pages can issue a session or preload data.
    // Loopback sockets alone do not prevent DNS rebinding to an untrusted Host.
    if (!requestOriginAllowed(request)) return sendJson(response, 403, { error: "请求来源无效。" });
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    if(url.pathname.startsWith("/api/lan/")||url.pathname==="/pair"||url.pathname.startsWith("/api/collaboration/")||url.pathname==="/collaboration-login"||url.pathname==="/api/academic-public/access")return sendJson(response,404,{error:"Not found"});
    // 指纹只绑定页面身份，不能代替HttpOnly会话认证；旧标签不得借用新账号的Cookie。
    const pageContext = request.headers["x-workbench-context"];
    if (url.pathname.startsWith("/api/") && pageContext) {
      const active = currentSession(request, false);
      if (!active || pageContext !== active.context) return sendJson(response, 401, { error: "页面会话已失效或账号已切换，请重新登录。", code: "SESSION_INVALID" }, { "X-Workbench-Session": "invalid" });
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") url.pathname = "/assets/login-logo-icon.png";
    if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { ok: true, service: "xiangcai-workbench", version: APP_VERSION, port: PORT, pid: process.pid, serverHash: SERVER_SOURCE_HASH, appHash: APP_SOURCE_HASH, studentLinkIntegrityHash: STUDENT_LINK_INTEGRITY_HASH, indexHash: INDEX_FILE_HASH, counselorGrowthHash: COUNSELOR_GROWTH_MODULE_SOURCE_HASH, demoDataHash: DEMO_DATA_SOURCE_HASH, searchableFilterHash: SEARCHABLE_FILTER_SELECTS_HASH, searchableFilterCssHash: SEARCHABLE_FILTER_SELECTS_CSS_HASH, startedAt: SERVER_STARTED_AT, license: licensePublicStatus() });
    if (request.method === "GET" && url.pathname === "/api/branding") return sendJson(response, 200, brandingPublicConfig());
    /* 商业授权接口只接受本机同源调用；学生、课程等业务数据不会发送到授权服务器。 */
    if (request.method === "GET" && url.pathname === "/api/license/status") {
      if (!isLocalRequest(request)) return sendJson(response, 403, { error: "仅允许在安装本机上查询授权。" });
      /* 状态查询按验证间隔走：未到期只返回本地凭证状态，不产生云端调用；强制复核走 /api/license/refresh。 */
      return sendJson(response, 200, await licenseClient.ensureUsable());
    }
    if (request.method === "POST" && url.pathname === "/api/license/activate") {
      if (!isLocalRequest(request) || !requestOriginAllowed(request)) return sendJson(response, 403, { error: "仅允许在安装本机上激活。" });
      try { return sendJson(response, 200, await licenseClient.activate((await readJson(request)).code)); }
      catch (error) { return sendJson(response, Number(error.statusCode) || 400, { error: error.message, code: error.code || "ACTIVATION_FAILED" }); }
    }
    if (request.method === "POST" && url.pathname === "/api/license/refresh") {
      if (!isLocalRequest(request) || !requestOriginAllowed(request)) return sendJson(response, 403, { error: "仅允许在安装本机上验证授权。" });
      try { return sendJson(response, 200, await licenseClient.ensureUsable(true)); }
      catch (error) { return sendJson(response, Number(error.statusCode) || 400, { error: error.message, code: error.code || "VERIFY_FAILED" }); }
    }
    if (request.method === "POST" && url.pathname === "/api/license/deactivate") {
      if (!isLocalRequest(request) || !requestOriginAllowed(request)) return sendJson(response, 403, { error: "仅允许在安装本机上解除激活。" });
      try { return sendJson(response, 200, await licenseClient.deactivate()); }
      catch (error) { return sendJson(response, Number(error.statusCode) || 400, { error: error.message, code: error.code || "DEACTIVATION_FAILED" }); }
    }
    /* 免密本机入口：仍限制本机同源，并以不按使用时长过期的 HttpOnly 会话保护业务接口。 */
    if (request.method === "GET" && url.pathname === "/api/auth/status") {
      return sendJson(response, 200, { mode: activeDataKey ? "ready" : "legacy_migration_required", authenticated: !!currentSession(request, false), sessionPersistent: true, license: licensePublicStatus() });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/enter") {
      if (!requestOriginAllowed(request)) return sendJson(response, 403, { error: "请求来源无效。" });
      if (!activeDataKey) return sendJson(response, 409, { error: "历史加密数据需要先完成一次迁移。", migrationRequired: true });
      /* 进入系统时按验证间隔复核（到期才联网，默认 72 小时一次）；「联网验证授权」按钮仍强制立即复核。
         明确停用/解绑最迟在下一次到期验证时清除旧凭证并转为只读；真实断网或云端临时故障继续使用离线宽限。 */
      if (isLocalRequest(request)) await licenseClient.ensureUsable();
      const session = createSession();
      return sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie(session.id) });
    }
    if (request.method === "POST" && url.pathname === "/api/auth/migrate-legacy-password") {
      if (!requestOriginAllowed(request)) return sendJson(response, 403, { error: "请求来源无效。" });
      if (activeDataKey || !loadLocalAuth()) return sendJson(response, 409, { error: "当前系统已是免密进入模式。" });
      const attempt = loginAttemptState(request);
      if (attempt.blockedUntil > Date.now()) return sendJson(response, 429, { error: "连续失败次数过多，请稍后再试。" }, { "Retry-After": String(Math.ceil((attempt.blockedUntil - Date.now()) / 1000)) });
      const body = await readJson(request);
      try { migrateLegacyPasswordToPortableMode(body.password); }
      catch (error) {
        if (/原本机密码不正确/.test(String(error.message || ""))) { noteLoginFailure(request); return sendJson(response, 401, { error: error.message }); }
        log(`免密进入迁移失败：${error.message}`); return sendJson(response, 500, { error: "迁移失败，历史数据未被修改。请检查备份后重试。" });
      }
      clearLoginFailures(request);
      const session = createSession();
      return sendJson(response, 200, { ok: true }, { "Set-Cookie": sessionCookie(session.id) });
    }
    /* 受保护的非 API 路由（bridge 令牌 + 附件下载，须本地认证） */
    const authenticatedSession = currentSession(request, false);
    if (authorize(request)) {
      if (request.method === "GET" && url.pathname === "/bridge.js") return sendCompressed(request, response, 200, compressedAsset(bridgeScript(authenticatedSession)), "application/javascript; charset=utf-8", "no-store");
      const attachment = url.pathname.match(/^\/attachments\/([a-f0-9-]{36})$/i);
      if (request.method === "GET" && attachment) {
        if (!licenseAllowsOperations()) return sendJson(response, 403, licenseReadOnlyPayload());
        const file = attachmentPath(attachment[1]);
        if (!fs.existsSync(file)) return send(response, 404, "Not found", "text/plain; charset=utf-8");
        const requestedType = String(url.searchParams.get("type") || "").toLowerCase();
        const requestedName = String(url.searchParams.get("name") || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120);
        const inlineTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/flac", "video/mp4", "video/webm", "video/ogg", "video/x-msvideo"]);
        const downloadTypes = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "application/zip", "application/json", "application/json; charset=utf-8", "text/csv", "text/plain"]);
        const responseType = inlineTypes.has(requestedType) || downloadTypes.has(requestedType) ? requestedType : (requestedName ? contentType(requestedName.toLowerCase()) : "application/octet-stream");
        const responseHeaders = requestedName ? { "Content-Disposition": academicWarningDisposition(requestedName), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } : undefined;
        return send(response, 200, decryptBuffer(fs.readFileSync(file)), responseType, responseHeaders);
      }
    }
    if (url.pathname.startsWith("/api/")) {
      if (!authorize(request)) return sendJson(response, 401, { error: "本地会话无效。" }, { "X-Workbench-Session": "invalid" });
      /* 演示模式由服务端强制只读。即使已激活，也不能通过直接调用接口混入真实数据。 */
      if (loadDemoState() && request.method !== "GET" && request.method !== "HEAD" && !demoAllowsOperation(request, url)) return sendJson(response, 423, demoLockedPayload());
      /* 授权不可用时保留查询与演示入口，业务写入必须重新激活。 */
      if (!licenseAllowsOperations() && !licenseAllowsLockedOperation(request, url)) return sendJson(response, 403, licenseReadOnlyPayload());
      // 只对白名单内的无业务写入渲染接口允许只读POST；模板编辑等仍按写操作拦截。
      const readOnlyRender = workbenchReadOnlyRender(request, url);
      const actor = currentSession(request, false), mutation = !["GET", "HEAD"].includes(request.method) && !readOnlyRender;
      request.workbenchAuthorizedSession = actor;
      academicPublicService.init();
      const adminOnly = /^\/api\/(?:updates|branding|webdav|ai\/(?:config|test)|store\/(?:restore-json|clear-local-business-data)|demo|backups|maintenance|system)/.test(url.pathname) || /\/purge(?:-|$|\/)|\/retention$/.test(url.pathname);
      if ((mutation && actor.role === "viewer") || (adminOnly && (!isLocalRequest(request)||actor.uid!=="local-super-admin"))) return sendJson(response, 403, { error: "当前账号没有此操作权限。", code: "COLLABORATION_FORBIDDEN" });
      if (url.pathname.startsWith("/api/data-center/")) return await getDataCenterService().handle(request,response,url,actor);
      if (url.pathname.startsWith("/api/academic-public/")) return academicPublicService.handle(request,response,url,actor);
      if (request.method === "GET" && url.pathname === "/api/workbench/state") {
        const snapshot = workbenchSnapshot(), changed = url.searchParams.get("known") !== snapshot.revision;
        return sendJson(response, 200, { revision: snapshot.revision, changed, storeValues: changed ? snapshot.storeValues : undefined, academicVersion: snapshot.academicVersion });
      }
      if (request.method === "GET" && url.pathname === "/api/updates/status") return sendJson(response, 200, updatePublicStatus());
      if (request.method === "POST" && url.pathname === "/api/updates/check") return sendJson(response, 200, await updateClient.check(true));
      if (request.method === "POST" && url.pathname === "/api/updates/download") return sendJson(response, 200, await updateClient.download());
      if (request.method === "POST" && url.pathname === "/api/updates/install") return sendJson(response, 202, scheduleDownloadedUpdateInstall());
      if (request.method === "GET" && url.pathname === "/api/demo/status") return sendJson(response, 200, demoStatus());
      if (request.method === "POST" && url.pathname === "/api/demo/load") return sendJson(response, 200, loadDemoData());
      if (request.method === "POST" && url.pathname === "/api/demo/clear") return sendJson(response, 200, clearDemoData());
      if (request.method === "PUT" && url.pathname === "/api/branding") return sendJson(response, 200, saveBrandingConfig(await readJson(request)));
      if (request.method === "GET" && url.pathname === "/api/webdav/status") return sendJson(response, 200, webdavPublicConfig());
      if (request.method === "PUT" && url.pathname === "/api/webdav/config") {
        const config = normalizeWebdavConfig(await readJson(request), loadWebdavSecret()); saveWebdavSecret(config); return sendJson(response, 200, webdavPublicConfig());
      }
      if (request.method === "POST" && url.pathname === "/api/webdav/test") {
        const saved = loadWebdavSecret(); const body = await readJson(request); const config = body && Object.keys(body).length ? normalizeWebdavConfig(body, saved) : saved;
        if (!config) throw httpError(400, "请先配置 WebDAV 私有云。", true); const result = await testWebdav(config); return sendJson(response, 200, result);
      }
      if (request.method === "POST" && url.pathname === "/api/webdav/backup") return sendJson(response, 200, await uploadWebdavBackup((await readJson(request)).syncPassword, request));
      if (request.method === "POST" && url.pathname === "/api/webdav/restore") { const body = await readJson(request); return sendJson(response, 200, await restoreWebdavBackup(body.syncPassword, body.confirmation, request)); }
      if (request.method === "GET" && url.pathname === "/api/backups") return sendJson(response, 200, listBackups());
      if (request.method === "GET" && url.pathname === "/api/system/health") {
        const attachment = attachmentMaintenanceReport();
        return sendJson(response, 200, { database: "ok", localBackupCount: listBackups().length, attachment, logRotationBytes: LOG_ROTATE_BYTES });
      }
      if (request.method === "POST" && url.pathname === "/api/backups") { const body = await readJson(request); return sendJson(response, 201, createBackup(body.note || "网页端手动备份")); }
      const backupCheck = url.pathname.match(/^\/api\/backups\/([^/]+)\/preflight$/);
      if (request.method === "GET" && backupCheck) return sendJson(response, 200, backupPreflight(decodeURIComponent(backupCheck[1])));
      const restore = url.pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
      if (request.method === "POST" && restore) return sendJson(response, 200, restoreBackup(decodeURIComponent(restore[1]), await readJson(request)));
      if (request.method === "GET" && url.pathname === "/api/backups/legacy-report") return sendJson(response, 200, legacyBackupReport());
      if (request.method === "POST" && url.pathname === "/api/backups/legacy-purge") return sendJson(response, 200, purgeLegacyBackups(await readJson(request)));
      const backup = url.pathname.match(/^\/api\/backups\/([^/]+)$/);
      if (request.method === "DELETE" && backup) return sendJson(response, 200, deleteBackup(decodeURIComponent(backup[1])));
      if (request.method === "GET" && url.pathname === "/api/attachments/maintenance") return sendJson(response, 200, attachmentMaintenanceReport());
      if (request.method === "POST" && url.pathname === "/api/attachments/maintenance") return sendJson(response, 200, quarantineOrphanAttachments(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/attachments") {
        const content = await readBuffer(request, MAX_ATTACHMENT_BYTES);
        return sendJson(response, 201, saveAttachment(url.searchParams.get("name"), content));
      }
      const attachmentDelete = url.pathname.match(/^\/api\/attachments\/([a-f0-9-]{36})$/i);
      if (request.method === "DELETE" && attachmentDelete) return sendJson(response, 200, deleteAttachment(attachmentDelete[1]));
      if (request.method === "GET" && url.pathname === "/api/recycle-bin") return sendJson(response, 200, recycleList(url));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/delete-preview") return sendJson(response, 200, recycleDeletePreview(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/move") return sendJson(response, 200, recycleMove(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/student-delete-preview") return sendJson(response, 200, recycleStudentDeletePreview(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/student-move") return sendJson(response, 200, recycleStudentMove(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/restore-batch-preview") return sendJson(response, 200, recycleRestoreBatchPreview(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/restore-batch") return sendJson(response, 200, recycleRestoreBatchTracked(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/purge-batch-preview") return sendJson(response, 200, recyclePurgeBatchPreview(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/purge-batch") return sendJson(response, 200, recyclePurgeBatch(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/recycle-bin/retention") return sendJson(response, 200, recycleSetRetention(await readJson(request)));
      if (request.method === "GET" && url.pathname === "/api/recycle-bin/audit") return sendJson(response, 200, recycleAuditList(url));
      const recycleRestorePreviewRoute = url.pathname.match(/^\/api\/recycle-bin\/([a-f0-9-]{36})\/restore-preview$/i);
      if (request.method === "POST" && recycleRestorePreviewRoute) return sendJson(response, 200, recycleRestorePreview(recycleRestorePreviewRoute[1]));
      const recycleRestoreRoute = url.pathname.match(/^\/api\/recycle-bin\/([a-f0-9-]{36})\/restore$/i);
      if (request.method === "POST" && recycleRestoreRoute) return sendJson(response, 200, recycleRestoreTracked(recycleRestoreRoute[1], await readJson(request)));
      const recyclePurgeRoute = url.pathname.match(/^\/api\/recycle-bin\/([a-f0-9-]{36})\/purge$/i);
      if (request.method === "POST" && recyclePurgeRoute) return sendJson(response, 200, recyclePurge(recyclePurgeRoute[1], await readJson(request)));
      const recycleDetailRoute = url.pathname.match(/^\/api\/recycle-bin\/([a-f0-9-]{36})$/i);
      if (request.method === "GET" && recycleDetailRoute) return sendJson(response, 200, recycleGet(recycleDetailRoute[1]));
      if (request.method === "GET" && url.pathname === "/api/academic-analysis/history") return sendJson(response, 200, { ok: true, records: listAcademicAnalysisHistory() });
      if (request.method === "POST" && url.pathname === "/api/academic-analysis/run") {
        const content = await readBuffer(request, MAX_ATTACHMENT_BYTES);
        const isMultipart = /^multipart\/form-data\b/i.test(String(request.headers["content-type"] || ""));
        const upload = isMultipart ? parseAcademicAnalysisMultipart(request.headers["content-type"], content) : { file: { content, name: url.searchParams.get("filename") || "单学期成绩.xlsx" } };
        const teachers = upload.teacherFile;
        const result = await queueAcademicAnalysis(() => { assertRequestSession(request); return runAcademicAnalysis(upload.file.content, upload.file.name, teachers && teachers.content, teachers && teachers.name); });
        assertRequestSession(request);
        return sendJson(response, 200, result);
      }
      const academicAnalysisFile = url.pathname.match(/^\/api\/academic-analysis\/download\/(\d{8}-\d{6}-[a-f0-9]{6})\/(summary|reports|audit)$/i);
      if (request.method === "GET" && academicAnalysisFile) {
        const output = academicAnalysisDownload(academicAnalysisFile[1], academicAnalysisFile[2].toLowerCase());
        if (!output) return sendJson(response, 404, { error: "学业分析结果不存在或已清理。" });
        return send(response, 200, output.data, output.type, { "Content-Disposition": academicWarningDisposition(output.name), "Content-Length": String(output.data.length), "Cache-Control": "no-store" });
      }
      const academicAnalysisRunDelete = url.pathname.match(/^\/api\/academic-analysis\/run\/(\d{8}-\d{6}-[a-f0-9]{6})$/i);
      if (request.method === "DELETE" && academicAnalysisRunDelete) return sendJson(response, 200, deleteAcademicAnalysisRun(academicAnalysisRunDelete[1]));
      if (request.method === "GET" && url.pathname === "/api/academic-warning/template/status") return sendJson(response, 200, academicWarningTemplateStatus());
      if (request.method === "GET" && url.pathname === "/api/academic-warning/template") {
        const template = academicWarningTemplateBytes(), type = template.extension === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/msword";
        return send(response, 200, template.content, type, { "Content-Disposition": academicWarningDisposition(template.name), "Content-Length": String(template.content.length), "Cache-Control": "no-store" });
      }
      if (request.method === "POST" && url.pathname === "/api/academic-warning/template") return sendJson(response, 200, await saveAcademicWarningCustomTemplate(request, url));
      if (request.method === "DELETE" && url.pathname === "/api/academic-warning/template") return sendJson(response, 200, await queueAcademicWarningRender(() => { assertRequestSession(request); return resetAcademicWarningCustomTemplate(); }));
      if (request.method === "POST" && url.pathname === "/api/academic-warning/render") {
        const body = await readAcademicWarningJson(request);
        const rendered = await queueAcademicWarningRender(() => { assertRequestSession(request); return runAcademicWarningPowerShell(body, false); });
        assertRequestSession(request);
        const item = body.item || {};
        const extension = rendered.format === "pdf" ? ".pdf" : rendered.format === "editor-html" ? ".html" : ".doc";
        const filename = `${String(item.fileBase || "学业预警（个人版）单").slice(0, 160)}${extension}`;
        const type = rendered.format === "pdf" ? "application/pdf" : rendered.format === "editor-html" ? "text/html; charset=utf-8" : "application/msword";
        const disposition = rendered.format === "editor-html" ? "inline" : academicWarningDisposition(filename);
        const headers = { "Content-Disposition": disposition, "Content-Length": String(rendered.output.length), "Cache-Control": "no-store" };
        if (rendered.format === "editor-html") headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-same-origin";
        return send(response, 200, rendered.output, type, headers);
      }
      if (request.method === "POST" && url.pathname === "/api/academic-warning/batch") {
        const body = await readAcademicWarningJson(request);
        const rendered = await queueAcademicWarningRender(() => { assertRequestSession(request); return runAcademicWarningPowerShell(body, true); });
        assertRequestSession(request);
        const filename = `学业预警（个人版）单_${String(body.term || "学期").slice(0, 100)}_${rendered.format === "pdf" ? "PDF" : "Word"}.zip`;
        return send(response, 200, rendered.output, "application/zip", { "Content-Disposition": academicWarningDisposition(filename), "Content-Length": String(rendered.output.length) });
      }
      if (request.method === "GET" && url.pathname === "/api/store") return sendJson(response, 200, readStore());
      if (request.method === "POST" && url.pathname === "/api/party/import") {
        const body = await readJson(request);
        assertRequestSession(request);
        return sendJson(response, 200, importPartyLedger(body, actor));
      }
      if (request.method === "POST" && url.pathname === "/api/store/batch") {
        try { const body = await readJson(request); return sendJson(response, 200, applyStoreBatch(body, false)); }
        catch (error) { if (error && error.code === "STUDENTS_DROP_GUARD") return sendJson(response, 409, { ok: false, code: error.code, error: error.message, guard: error.guard }); throw error; }
      }
      if (request.method === "POST" && url.pathname === "/api/store/restore-json") return sendJson(response, 200, restoreJsonBackup(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/store/clear-local-business-data") return sendJson(response, 200, clearLocalBusinessData(await readJson(request)));
      const store = url.pathname.match(/^\/api\/store\/([^/]+)$/);
      if (store && request.method === "GET") {
        const key = decodeURIComponent(store[1]);
        if (!safeStoreKey(key)) return sendJson(response, 400, { error: "数据键无效。" });
        if (isRetiredStoreKey(key)) { purgeRetiredKnowledgeFeature(); return sendJson(response, 200, { key, value: null, retired: true }); }
        if (CORE_STORE_KEYS.has(key)) return sendJson(response, 200, { key, value: readStore()[key] ?? null });
        const row = database.prepare("SELECT value FROM legacy_ui_store WHERE key=?").get(key);
        return sendJson(response, 200, { key, value: row ? decryptText(row.value) : null });
      }
      if (store && request.method === "PUT") {
        const key = decodeURIComponent(store[1]); const body = await readJson(request);
        if (!safeStoreKey(key) || typeof body.value !== "string" || Buffer.byteLength(body.value, "utf8") > MAX_BODY_BYTES) return sendJson(response, 400, { error: "数据键或内容无效。" });
        if (isRetiredStoreKey(key)) return sendJson(response, 410, { error: "该功能已经下线，相关数据不能再写入。", retired: true });
        try {
          const operation = { key, method: "PUT", value: body.value };
          if (Object.hasOwn(body, "baseValue")) operation.baseValue = body.baseValue;
          return sendJson(response, 200, applyStoreBatch({ operations: [operation], force: body.force }, false));
        } catch (error) {
          if (error && error.code === "STUDENTS_DROP_GUARD") return sendJson(response, 409, { ok: false, code: error.code, error: error.message, guard: error.guard });
          throw error;
        }
      }
      if (store && request.method === "DELETE") {
        const key = decodeURIComponent(store[1]);
        if (!safeStoreKey(key)) return sendJson(response, 400, { error: "数据键无效。" });
        if (isRetiredStoreKey(key)) { purgeRetiredKnowledgeFeature(); return sendJson(response, 200, { ok: true, retired: true }); }
        const body = await readJson(request), operation = { key, method: "DELETE" };
              if (Object.hasOwn(body, "baseValue")) operation.baseValue = body.baseValue;
        return sendJson(response, 200, applyStoreBatch({ operations: [operation] }, false));
      }
      /* ---- AI 配置代理（密钥不暴露给前端；GET 不含 apiKey，PUT 落服务端保管） ---- */
      if (request.method === "GET" && url.pathname === "/api/ai/config") return sendJson(response, 200, aiPublicConfig());
      if (request.method === "PUT" && url.pathname === "/api/ai/config") {
        const b = await readJson(request);
        if (!b || typeof b.baseUrl !== "string" || typeof b.model !== "string") return sendJson(response, 400, { error: "baseUrl 与 model 必须为字符串。" });
        const existing = loadAiSecret() || {};
        const enabled = b.enabled != null ? !!b.enabled : (existing.enabled != null ? !!existing.enabled : true);
        const provider = typeof b.provider === "string" ? b.provider.trim() : (existing.provider || "");
        const allowedProviders = new Set(["", "tongyi", "openai", "gemini", "anthropic", "deepseek", "kimi", "siliconflow", "openrouter", "zhipu", "agnes"]);
        if (!allowedProviders.has(provider)) return sendJson(response, 400, { error: "不支持的 AI 服务商。" });
        if (b.baseUrl.length > 2048 || b.model.length > 200 || (enabled && (!b.baseUrl.trim() || !b.model.trim()))) return sendJson(response, 400, { error: "开启 AI 时，Base URL 与模型名称必须正确填写。" });
        if ((b.economyModel != null && (typeof b.economyModel !== "string" || b.economyModel.length > 200)) || (b.visionModel != null && (typeof b.visionModel !== "string" || b.visionModel.length > 200))) return sendJson(response, 400, { error: "分功能模型名称格式无效。" });
        if (b.apiKey != null && (typeof b.apiKey !== "string" || b.apiKey.length > 4096)) return sendJson(response, 400, { error: "API Key 格式无效。" });
        let validated = null;
        let parsedBase = null;
        if (b.baseUrl.trim()) {
          try {
            parsedBase = parseAiBaseUrl(b.baseUrl);
            if (enabled) validated = await validateAiEndpoint(b.baseUrl);
          }
          catch (error) { return sendJson(response, 400, { error: error.message }); }
        }
        const requestedTemperature = b.temperature != null ? Number(b.temperature) : Number(existing.temperature != null ? existing.temperature : 0.4);
        if (!Number.isFinite(requestedTemperature) || requestedTemperature < 0 || requestedTemperature > 2) return sendJson(response, 400, { error: "Temperature 必须在 0 到 2 之间。" });
        if (b.features != null && (!b.features || typeof b.features !== "object" || Array.isArray(b.features))) return sendJson(response, 400, { error: "AI 功能开关格式无效。" });
        const dailyRequestLimit = normalizeAiLimit(b.dailyRequestLimit, existing.dailyRequestLimit, 10000);
        const dailyInputLimit = normalizeAiLimit(b.dailyInputLimit, existing.dailyInputLimit, 1000000);
        if (dailyRequestLimit == null || dailyInputLimit == null) return sendJson(response, 400, { error: "AI 调用额度必须是允许范围内的非负整数。" });
        const inputPricePerMillion = normalizeAiPrice(b.inputPricePerMillion, existing.inputPricePerMillion);
        const outputPricePerMillion = normalizeAiPrice(b.outputPricePerMillion, existing.outputPricePerMillion);
        if (inputPricePerMillion == null || outputPricePerMillion == null) return sendJson(response, 400, { error: "Token 单价必须是非负数字。" });
        const nextKey = b.clearApiKey ? "" : (b.apiKey && b.apiKey.trim() ? b.apiKey.trim() : (existing.apiKey || ""));
        const merged = {
          enabled,
          provider,
          baseUrl: parsedBase ? parsedBase.toString().replace(/\/$/, "") : "",
          model: provider === "gemini" ? b.model.trim().replace(/^models\//, "") : b.model.trim(),
          economyModel: String(b.economyModel == null ? existing.economyModel || "" : b.economyModel).trim().replace(provider === "gemini" ? /^models\// : /$^/, ""),
          visionModel: String(b.visionModel == null ? existing.visionModel || "" : b.visionModel).trim().replace(provider === "gemini" ? /^models\// : /$^/, ""),
          apiKey: nextKey,
          temperature: requestedTemperature,
          features: normalizeAiFeatures(b.features, existing.features),
          dailyRequestLimit,
          dailyInputLimit,
          inputPricePerMillion,
          outputPricePerMillion,
          usageWindowStartedAt: existing.usageWindowStartedAt || "",
          usageRequests: Math.max(0, Number(existing.usageRequests) || 0),
          usageInputChars: Math.max(0, Number(existing.usageInputChars) || 0),
          usageLedgerMigratedAt: existing.usageLedgerMigratedAt || "",
          certificateOutboundApproved: b.certificateOutboundApproved == null ? existing.certificateOutboundApproved === true : b.certificateOutboundApproved === true,
          certificateOutboundApprovedAt: (b.certificateOutboundApproved == null ? existing.certificateOutboundApproved === true : b.certificateOutboundApproved === true)
            ? (b.certificateOutboundApproved === true && existing.certificateOutboundApproved !== true ? new Date().toISOString() : (existing.certificateOutboundApprovedAt || new Date().toISOString()))
            : "",
          courseScheduleOutboundApproved: b.courseScheduleOutboundApproved == null ? existing.courseScheduleOutboundApproved === true : b.courseScheduleOutboundApproved === true,
          courseScheduleOutboundApprovedAt: (b.courseScheduleOutboundApproved == null ? existing.courseScheduleOutboundApproved === true : b.courseScheduleOutboundApproved === true)
            ? (b.courseScheduleOutboundApproved === true && existing.courseScheduleOutboundApproved !== true ? new Date().toISOString() : (existing.courseScheduleOutboundApprovedAt || new Date().toISOString()))
            : "",
          lastTestAt: existing.lastTestAt || "",
          lastTestOk: existing.lastTestOk,
          lastTestMs: existing.lastTestMs || 0
        };
        const connectionChanged = merged.provider !== (existing.provider || "") || merged.baseUrl !== (existing.baseUrl || "") || merged.model !== (existing.model || "") || merged.economyModel !== (existing.economyModel || "") || merged.visionModel !== (existing.visionModel || "") || nextKey !== (existing.apiKey || "");
        if (connectionChanged) { merged.lastTestAt = ""; merged.lastTestOk = null; merged.lastTestMs = 0; }
        assertRequestSession(request);
        saveAiSecret(merged);
        const host = parsedBase ? parsedBase.host : "";
        appendAiAudit({ status: 200, model: merged.model, host, note: enabled ? "AI 配置已保存到服务端" : "AI 功能已停用" });
        return sendJson(response, 200, aiPublicConfig());
      }
      if (request.method === "POST" && url.pathname === "/api/ai/test") {
        const r = await aiProxyChat({ system: "You are a connectivity test. Reply only with OK.", user: "connection test", feature: "test" });
        const latest = loadAiSecret();
        if (latest) {
          latest.lastTestAt = new Date().toISOString();
          latest.lastTestOk = r.status === 200;
          latest.lastTestMs = r.ms || 0;
          saveAiSecret(latest);
        }
        return sendJson(response, r.status, { ok: r.status === 200, ms: r.ms || 0, error: r.error || "", redactedCount: r.redactedCount || 0 });
      }
      if (request.method === "GET" && url.pathname === "/api/ai/models") {
        const r = await aiListModels();
        return sendJson(response, r.status, r);
      }
      if (request.method === "POST" && url.pathname === "/api/ai/redaction-preview") {
        const body = await readJson(request);
        if (!body || typeof body.text !== "string" || body.text.length > 32000) return sendJson(response, 400, { error: "预览文本格式无效或超过 32000 字符。" });
        const redacted = redactAiOutbound("", body.text);
        return sendJson(response, 200, { text: redacted.user, redactedCount: redacted.count });
      }
      if (request.method === "POST" && url.pathname === "/api/ai/certificate-recognize") { const r = await aiProxyCertificateRecognition(await readJson(request)); return sendJson(response, r.status, r); }
      if (request.method === "POST" && url.pathname === "/api/ai/course-schedule-recognize") { const r = await aiProxyCourseScheduleVision(await readJson(request)); return sendJson(response, r.status, r); }
      if (request.method === "POST" && url.pathname === "/api/ai/chat") { const r = await aiProxyChat(await readJson(request)); return sendJson(response, r.status, r); }
      if (request.method === "GET" && url.pathname === "/api/ai/audit") { const lim = Number(url.searchParams.get("limit")) || 50; return sendJson(response, 200, readAiAudit(lim)); }
      if (request.method === "GET" && url.pathname === "/api/ai/usage") { const hours = Number(url.searchParams.get("hours")) || 24; return sendJson(response, 200, { hours: Math.max(1, Math.min(24 * 90, Math.floor(hours))), rows: readAiUsageSummary(hours), usage: aiPublicConfig().usage }); }
      return sendJson(response, 404, { error: "接口不存在。" });
    }
    if (request.method === "GET" && url.pathname === "/assets/academic-public-user-manual.docx") {
      if (!activeDataKey) return send(response, 503, "旧版加密数据尚未迁移，请联系维护人员。", "text/plain; charset=utf-8");
      const manualAccess = ensureAccessSession(request);
      if (!manualAccess) return sendJson(response, 403, { error: "仅允许本机访问。" });
      const manualPath = path.join(ROOT, "assets", "academic-public-user-manual.docx");
      if (!fs.existsSync(manualPath)) return send(response, 404, "手册文件暂不可用，请联系维护人员。", "text/plain; charset=utf-8");
      const manualBytes = fs.readFileSync(manualPath);
      const manualHeaders = manualAccess.created ? { "Set-Cookie": sessionCookie(manualAccess.session.id) } : {};
      return send(response, 200, manualBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Object.assign({}, manualHeaders, {
        "Content-Disposition": academicWarningDisposition("学业情况公用版使用与操作手册.docx"),
        "Content-Length": String(manualBytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
      }));
    }
    const academicSummaryReferenceFiles = {
      "/assets/academic-summary-reference/zongce-1.xlsx": ["zongce-1.xlsx", "综测1.xlsx"],
      "/assets/academic-summary-reference/zongce-2.xlsx": ["zongce-2.xlsx", "综测2.xlsx"],
      "/assets/academic-summary-reference/academic.xlsx": ["academic.xlsx", "学业成绩.xlsx"],
      "/assets/academic-summary-reference/course.xlsx": ["course.xlsx", "课程成绩.xlsx"],
      "/assets/academic-summary-reference/summary.xlsx": ["summary.xlsx", "汇总.xlsx"]
    };
    const academicSummaryReference = academicSummaryReferenceFiles[url.pathname];
    if (request.method === "GET" && academicSummaryReference) {
      if (!activeDataKey) return send(response, 503, "旧版加密数据尚未迁移，请联系维护人员。", "text/plain; charset=utf-8");
      const referenceAccess = ensureAccessSession(request);
      if (!referenceAccess) return sendJson(response,403,{error:"仅允许本机访问。"});
      const referencePath = path.join(ROOT, "assets", "academic-summary-reference", academicSummaryReference[0]);
      if (!fs.existsSync(referencePath)) return send(response, 404, "Not found", "text/plain; charset=utf-8");
      const referenceHeaders = referenceAccess.created ? { "Set-Cookie": sessionCookie(referenceAccess.session.id) } : {};
      return send(response, 200, fs.readFileSync(referencePath), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Object.assign({}, referenceHeaders, { "Cache-Control": "private, max-age=3600", "Content-Disposition": academicWarningDisposition(academicSummaryReference[1]) }));
    }
    if (request.method !== "GET" || !["/", "/index.html", "/login.html", "/manifest.webmanifest", "/workbench-bridge.js", "/academic-public-module.js", "/academic-public.css", "/app.js", "/student-leave-engine.js", "/student-leave-module.js", "/student-leave.css", "/student-link-integrity.js", "/party-import-engine.js", "/chaoxing-attendance-module.js", "/searchable-filter-selects.js", "/searchable-filter-selects.css", "/dorm-spatial-module.js", "/dorm-spatial-module.css", "/achievement-enhancements.js", "/award-statistics-module.js", "/other-violation-module.js", "/dorm-roster-module.js", "/custom-roster-module.js", "/counselor-growth-module.js", "/data-center-module.js", "/custom-fields-module.js", "/intelligence-enhancements.js", "/html2pdf.bundle.min.js", "/jszip.min.js", "/xlsx.full.min.js", "/assets/tool-history-client.js", "/assets/workbench-ui.js", "/assets/workbench-ui.css", "/assets/academic-warning-editor-template.html", "/assets/academic-summary-tool.html", "/assets/academic-summary-tool.js", "/assets/academic-summary-tool.css", "/assets/academic-summary-tool-fixes.css", "/assets/academic-analysis-tool.html", "/assets/academic-analysis-tool.js", "/assets/academic-analysis-tool.css", "/assets/academic-analysis-rules.docx", "/assets/academic-analysis-field-template.xlsx", "/assets/excel-merge-tool.html", "/assets/excel-merge-app.js", "/assets/excel-merge-worker.js", "/assets/excel-merge-extract.js", "/assets/excel-check-tool.html", "/assets/excel-check-app.js", "/assets/excel-check-style.css", "/assets/data-match-tool.html", "/assets/data-match-app.js", "/assets/data-match-style.css", "/assets/login-logo.png", "/assets/login-logo-icon.png", "/assets/branding-logo", "/student-org.html"].includes(url.pathname)) return send(response, 404, "Not found", "text/plain; charset=utf-8");
    if (url.pathname === "/manifest.webmanifest") return send(response, 200, JSON.stringify(brandedPwaManifest()), "application/manifest+json", { "Cache-Control": "no-cache" });
    if (url.pathname === "/student-org.html") {
      /* 学生组织页面只能由主系统同源嵌入；直接访问会绕过父页桥接，导致数据不同步。 */
      if (url.searchParams.get("embedded") !== "1") return send(response, 302, "", "text/plain; charset=utf-8", { Location: "/" });
      if (!activeDataKey) return send(response, 503, "旧版加密数据尚未迁移，请联系维护人员。", "text/plain; charset=utf-8");
      const studentOrgAccess = ensureAccessSession(request);
      if (!studentOrgAccess) return sendJson(response,403,{error:"仅允许本机访问。"});
      const studentOrgHeaders = studentOrgAccess.created ? { "Set-Cookie": sessionCookie(studentOrgAccess.session.id) } : {};
      return sendCompressed(request, response, 200, STATIC_ASSETS.studentOrg, "text/html; charset=utf-8", "no-store", Object.assign({}, studentOrgHeaders, {
        /* 学生组织管理只允许被同源主系统内容区嵌入，其他网站仍禁止嵌入。 */
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "default-src 'self' data:; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self' blob:; object-src 'self' blob: data:; base-uri 'none'; frame-ancestors 'self'"
      }));
    }
    if (url.pathname === "/login.html") {
      return sendCompressed(request, response, 200, STATIC_ASSETS.login, contentType("login.html"), "no-store");
    }
    if (url.pathname === "/assets/login-logo.png") return sendCompressed(request, response, 200, STATIC_ASSETS.loginLogoPng, contentType("login-logo.png"), "no-cache");
    if (url.pathname === "/assets/login-logo-icon.png") return sendCompressed(request, response, 200, STATIC_ASSETS.loginLogoIcon, contentType("login-logo-icon.png"), "no-cache");
    if (url.pathname === "/assets/branding-logo") {
      const config = readBrandingConfig();
      const logo = brandingLogoInfo(url.searchParams.get("target") === "sidebar" ? config.sidebarLogoData : config.loginLogoData);
      if (!logo) return send(response, 404, "Not found", "text/plain; charset=utf-8");
      return send(response, 200, logo.data, logo.mime, { "Cache-Control": "no-store" });
    }
    if (url.pathname === "/html2pdf.bundle.min.js") return sendCompressed(request, response, 200, STATIC_ASSETS.html2pdf, contentType("html2pdf.bundle.min.js"), "private, max-age=31536000, immutable");
    if (url.pathname === "/jszip.min.js") return sendCompressed(request, response, 200, STATIC_ASSETS.jszip, contentType("jszip.min.js"), "private, max-age=31536000, immutable");
    if (url.pathname === "/xlsx.full.min.js") return sendCompressed(request, response, 200, STATIC_ASSETS.xlsx, contentType("xlsx.full.min.js"), "private, max-age=31536000, immutable");
    if (!activeDataKey) return send(response, 503, "旧版加密数据尚未迁移，请联系维护人员。", "text/plain; charset=utf-8");
    const pageAccess = ensureAccessSession(request);
    if (!pageAccess) return sendJson(response,403,{error:"仅允许本机访问。"});
    const pageHeaders = pageAccess.created ? { "Set-Cookie": sessionCookie(pageAccess.session.id) } : {};
    if (url.pathname === "/data-center-module.js") return send(response,200,fs.existsSync(path.join(ROOT,"data-center-module.js"))?fs.readFileSync(path.join(ROOT,"data-center-module.js")):"PAGES.dataCenter=function(){return '<div class=card>数据中心资源缺失，请重新安装完整更新包。</div>';};","application/javascript; charset=utf-8");
    if (["/assets/workbench-ui.js","/assets/workbench-ui.css"].includes(url.pathname)) return send(response,200,fs.readFileSync(path.join(ROOT,url.pathname.slice(1))),contentType(url.pathname),{"Cache-Control":"no-cache"});
    if (url.pathname === "/assets/tool-history-client.js") {
      const identity = JSON.stringify({ context: pageAccess.session.context, uid: pageAccess.session.uid, role: pageAccess.session.role }).replace(/</g, "\\u003c");
      const source = Buffer.concat([Buffer.from(`window.__WORKBENCH_TOOL_SESSION__=${identity};\n`, "utf8"), TOOL_HISTORY_CLIENT_SOURCE]);
      return sendCompressed(request, response, 200, compressedAsset(source), contentType("tool-history-client.js"), "no-store", pageHeaders);
    }
    if (url.pathname === "/workbench-bridge.js") {
      /* 页面加载/刷新路径不强制云验证（到期才联网），避免每次刷新工作台都产生云端调用。 */
      const openingIdentity={id:pageAccess.session.id,context:pageAccess.session.context};
      await licenseClient.ensureUsable();
      const currentIdentity=currentSession(request,false);
      if(!currentIdentity||currentIdentity.id!==openingIdentity.id||currentIdentity.context!==openingIdentity.context)return sendJson(response,401,{error:"页面身份已变化，请重新登录。"},{"X-Workbench-Session":"invalid"});
      return sendCompressed(request, response, 200, compressedAsset(bridgeScript(pageAccess.session)), contentType("workbench-bridge.js"), "no-store", pageHeaders);
    }
    if(["/student-leave-engine.js","/student-leave-module.js","/student-leave.css"].includes(url.pathname))return send(response,200,fs.readFileSync(path.join(ROOT,url.pathname.slice(1))),contentType(url.pathname),{"Cache-Control":"no-cache"});
    if (url.pathname === "/app.js") return sendCompressed(request, response, 200, STATIC_ASSETS.app, contentType("app.js"), url.searchParams.get("v") === APP_SOURCE_HASH ? "private, max-age=31536000, immutable" : "no-cache");
    if (url.pathname === "/student-link-integrity.js") return sendCompressed(request,response,200,STATIC_ASSETS.studentLinkIntegrity,contentType("student-link-integrity.js"),url.searchParams.get("v")===STUDENT_LINK_INTEGRITY_HASH?"private, max-age=31536000, immutable":"no-cache",pageHeaders);
    if (url.pathname === "/party-import-engine.js") return sendCompressed(request, response, 200, STATIC_ASSETS.partyImportEngine, contentType("party-import-engine.js"), "no-cache", pageHeaders);
    if (url.pathname === "/dorm-spatial-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.dormSpatialModule, contentType("dorm-spatial-module.js"), "no-cache", pageHeaders);
    if (url.pathname === "/dorm-spatial-module.css") return sendCompressed(request, response, 200, STATIC_ASSETS.dormSpatialModuleCss, contentType("dorm-spatial-module.css"), "no-cache", pageHeaders);
    if (url.pathname === "/searchable-filter-selects.js") return sendCompressed(request, response, 200, STATIC_ASSETS.searchableFilterSelects, contentType("searchable-filter-selects.js"), "no-cache", pageHeaders);
    if (url.pathname === "/searchable-filter-selects.css") return sendCompressed(request, response, 200, STATIC_ASSETS.searchableFilterSelectsCss, contentType("searchable-filter-selects.css"), "no-cache", pageHeaders);
    if (url.pathname === "/achievement-enhancements.js") return sendCompressed(request, response, 200, STATIC_ASSETS.achievementEnhancements, contentType("achievement-enhancements.js"), "no-cache");
    if (url.pathname === "/award-statistics-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.awardStatisticsModule, contentType("award-statistics-module.js"), "no-cache");
    if (url.pathname === "/assets/academic-warning-editor-template.html") return sendCompressed(request, response, 200, STATIC_ASSETS.academicWarningEditor, contentType("academic-warning-editor-template.html"), "no-store");
    if (url.pathname === "/other-violation-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.otherViolation, contentType("other-violation-module.js"), "no-cache");
    if (url.pathname === "/dorm-roster-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.dormRosterModule, contentType("dorm-roster-module.js"), "no-cache");
    if (url.pathname === "/academic-public-module.js") return sendCompressed(request,response,200,STATIC_ASSETS.academicPublic,contentType("academic-public-module.js"),"no-cache");
    if (url.pathname === "/academic-public.css") return sendCompressed(request,response,200,STATIC_ASSETS.academicPublicStyle,contentType("academic-public.css"),"no-cache");
    if (url.pathname === "/custom-roster-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.customRosterModule, contentType("custom-roster-module.js"), "no-cache");
    if (url.pathname === "/counselor-growth-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.counselorGrowthModule, contentType("counselor-growth-module.js"), "no-cache");
    if (url.pathname === "/chaoxing-attendance-module.js") return send(response, 200, fs.readFileSync(path.join(ROOT,"chaoxing-attendance-module.js")), contentType("chaoxing-attendance-module.js"), "no-cache");
    if (url.pathname === "/custom-fields-module.js") return sendCompressed(request, response, 200, STATIC_ASSETS.customFieldsModule, contentType("custom-fields-module.js"), "no-cache");
    if (url.pathname === "/intelligence-enhancements.js") return sendCompressed(request, response, 200, STATIC_ASSETS.intelligenceEnhancements, contentType("intelligence-enhancements.js"), "no-cache");
    if (url.pathname === "/assets/academic-summary-tool.html") return sendCompressed(request, response, 200, STATIC_ASSETS.academicSummaryToolHtml, "text/html; charset=utf-8", "no-store", Object.assign({}, pageHeaders, { "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }));
    if (url.pathname === "/assets/academic-summary-tool.js") return sendCompressed(request, response, 200, STATIC_ASSETS.academicSummaryToolJs, contentType("academic-summary-tool.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/academic-summary-tool.css") return sendCompressed(request, response, 200, STATIC_ASSETS.academicSummaryToolCss, contentType("academic-summary-tool.css"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/academic-summary-tool-fixes.css") return sendCompressed(request, response, 200, STATIC_ASSETS.academicSummaryToolFixes, contentType("academic-summary-tool-fixes.css"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/academic-analysis-tool.html") return sendCompressed(request, response, 200, STATIC_ASSETS.academicAnalysisToolHtml, "text/html; charset=utf-8", "no-store", Object.assign({}, pageHeaders, { "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }));
    if (url.pathname === "/assets/academic-analysis-tool.js") return sendCompressed(request, response, 200, STATIC_ASSETS.academicAnalysisToolJs, contentType("academic-analysis-tool.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/academic-analysis-tool.css") return sendCompressed(request, response, 200, STATIC_ASSETS.academicAnalysisToolCss, contentType("academic-analysis-tool.css"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/academic-analysis-rules.docx") return sendCompressed(request, response, 200, STATIC_ASSETS.academicAnalysisRules, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "private, max-age=3600", Object.assign({}, pageHeaders, { "Content-Disposition": academicWarningDisposition("统计规则（更新版）.docx") }));
    if (url.pathname === "/assets/academic-analysis-field-template.xlsx") return sendCompressed(request, response, 200, STATIC_ASSETS.academicAnalysisFieldTemplate, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "private, max-age=3600", Object.assign({}, pageHeaders, { "Content-Disposition": academicWarningDisposition("单学期成绩导入模板.xlsx") }));
    if (url.pathname === "/assets/excel-merge-tool.html") return sendCompressed(request, response, 200, STATIC_ASSETS.excelMergeToolHtml, "text/html; charset=utf-8", "no-store", Object.assign({}, pageHeaders, { "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }));
    if (url.pathname === "/assets/excel-merge-app.js") return sendCompressed(request, response, 200, STATIC_ASSETS.excelMergeApp, contentType("excel-merge-app.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/excel-merge-worker.js") return sendCompressed(request, response, 200, STATIC_ASSETS.excelMergeWorker, contentType("excel-merge-worker.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/excel-merge-extract.js") return sendCompressed(request, response, 200, STATIC_ASSETS.excelMergeExtract, contentType("excel-merge-extract.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/excel-check-tool.html") return sendCompressed(request, response, 200, STATIC_ASSETS.excelCheckToolHtml, "text/html; charset=utf-8", "no-store", Object.assign({}, pageHeaders, { "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }));
    if (url.pathname === "/assets/excel-check-app.js") return sendCompressed(request, response, 200, STATIC_ASSETS.excelCheckApp, contentType("excel-check-app.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/excel-check-style.css") return sendCompressed(request, response, 200, STATIC_ASSETS.excelCheckStyle, contentType("excel-check-style.css"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/data-match-tool.html") return sendCompressed(request, response, 200, STATIC_ASSETS.dataMatchToolHtml, "text/html; charset=utf-8", "no-store", Object.assign({}, pageHeaders, { "Content-Security-Policy": "default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" }));
    if (url.pathname === "/assets/data-match-app.js") return sendCompressed(request, response, 200, STATIC_ASSETS.dataMatchApp, contentType("data-match-app.js"), "no-cache", pageHeaders);
    if (url.pathname === "/assets/data-match-style.css") return sendCompressed(request, response, 200, STATIC_ASSETS.dataMatchStyle, contentType("data-match-style.css"), "no-cache", pageHeaders);
    return sendCompressed(request, response, 200, STATIC_ASSETS.index, contentType("index.html"), "no-store", pageHeaders);
  } catch (error) {
    log(`请求失败：${error && error.message ? error.message : error}`);
    const status = Number(error && error.statusCode) || 400;
    const payload = { error: error && error.expose ? error.message : "服务处理失败，请稍后重试。" };
    if (error && error.expose && error.code) payload.code = error.code;
    if (error && error.expose && error.license) payload.license = error.license;
    if (error && error.expose && error.changedKeyCount) payload.changedKeyCount = error.changedKeyCount;
    return sendJson(response, status, payload, status === 401 ? { "X-Workbench-Session": "invalid" } : {});
  }
}

function stopExistingServer() {
  const options = { hostname: HOST, port: PORT, path: "/api/health", method: "GET", timeout: 800 };
  const request = http.request(options, (response) => { process.exit(response.statusCode === 200 ? 0 : 1); });
  request.on("error", () => process.exit(0));
  request.on("timeout", () => { request.destroy(); process.exit(0); });
  request.end();
}

function startWorkbenchServer() {
  ensureDirectories();
  /* 本地/开发版：授权门禁遵循 license-config.json（当前 enabled:false 即不启用激活）。
     打包正式商业版时可改回 forceEnabled: true 以强制授权。 */
  licenseClient = new LicenseClient({ root: ROOT, dataDir: DATA_DIR, appVersion: APP_VERSION, forceEnabled: false });
  updateClient = new UpdateClient({ root: ROOT, dataDir: DATA_DIR, appVersion: APP_VERSION, licenseClient });
  log(licenseClient.isEnabled() ? "云端设备授权已启用。" : "云端设备授权未启用（按 license-config.json 配置）。");
  migrateLegacyDatabaseOnce();
  openDatabase();
  pruneAiAudit(); /* 启动即按 AI_AUDIT_RETENTION 清理存量审计记录，当前保留最新 1000 条。 */
  const portable = enablePortableDataMode();
  if (portable.ready) {
    const expiredRecycleRecords = recyclePurgeExpired();
    if (expiredRecycleRecords) log(`已在启动时清理 ${expiredRecycleRecords} 条超过保留期的回收站数据。`);
    const retiredNameCheckRecords = purgeRetiredNameCheckHistory();
    if (retiredNameCheckRecords) log(`已清理 ${retiredNameCheckRecords} 条下线的名单核对历史数据。`);
    const retiredCounselorGrowthPlans = purgeRetiredCounselorGrowthPlans();
    if (retiredCounselorGrowthPlans) log("已清理下线的辅导员成长计划与复盘数据。");
    const retiredKnowledgeRecords = purgeRetiredKnowledgeFeature();
    if (retiredKnowledgeRecords) log(`已清理 ${retiredKnowledgeRecords} 项下线的校本知识功能数据。`);
    const retiredStudentLegacyFields = purgeRetiredStudentLegacyFields();
    if (retiredStudentLegacyFields) log(`已清理 ${retiredStudentLegacyFields} 条已下线的学生备注及旧版自定义字段数据。`);
    const identityFilled = backfillStudentIdentityBlanks();
    if (identityFilled) log(`已补齐 ${identityFilled} 名学生为空的出生日期或性别。`);
    log(portable.migrated ? "已创建便携数据密钥，工作台可免密进入。" : "已加载便携数据密钥，工作台可免密进入。");
  }
  else log("检测到历史密码加密数据，等待一次性迁移后进入。");
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    fs.writeFileSync(PID_PATH, String(process.pid), "utf8");
    log(`本地网页服务已启动：http://${HOST}:${PORT}`);
  });
  server.on("error", (error) => { log(`服务启动失败：${error.message}`); process.exit(1); });
  const close = () => {
    lockSensitiveData();
    try { if (database) database.close(); } catch (_error) {}
    try { fs.unlinkSync(PID_PATH); } catch (_error) {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

if (require.main === module) {
  if (process.argv.includes("--health")) stopExistingServer();
  else startWorkbenchServer();
}

module.exports = {
  mergeStoreData,
  mergeConcurrentStoreValue,
  AI_FEATURE_KEYS,
  aiProviderProtocol,
  aiStructuredOutputMode,
  applyAiStructuredOutput,
  buildAiPayload,
  buildAiVisionPayload,
  certificateAiSchema,
  parseAiJsonObject,
  validateCertificateAiResult,
  extractAiUsage,
  selectAiModel,
  detectImageMime,
  extractAiContent,
  aiUpstreamErrorMessage,
  attachmentReferencesFromStore,
  mergeCurrentFirst,
  mergeStoreValue,
  readStoreFromDatabase
};
