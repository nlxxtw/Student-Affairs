"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  AI_FEATURE_KEYS,
  aiStructuredOutputMode,
  buildAiVisionPayload,
  certificateAiSchema,
  validateCertificateAiResult,
  extractAiUsage,
  selectAiModel
} = require("../web-server.js");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

for (const feature of ["workRecord", "taskAssist", "ledgerInsight", "academicAnalysis"]) {
  assert.ok(AI_FEATURE_KEYS.includes(feature), `server AI feature is missing: ${feature}`);
  assert.match(app, new RegExp(`${feature}:`), `frontend AI feature is missing: ${feature}`);
}
assert.match(app, /aiChat\(system,user,feature\)/, "work-record follow-up must preserve the feature key");
assert.match(app, /aiChat\(system, JSON\.stringify\(stats\),cfg\.feature\)/, "work-record analysis must preserve the feature key");

const schema = certificateAiSchema();
const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
const openaiPayload = buildAiVisionPayload("openai", "gpt-5-mini", "system", "user", png, false, 0.2, schema);
assert.strictEqual(openaiPayload.response_format.type, "json_schema");
assert.strictEqual(openaiPayload.response_format.json_schema.strict, true);
const qwenPayload = buildAiVisionPayload("tongyi", "qwen3.7-plus", "system", "user", png, false, 0.2, schema);
assert.strictEqual(qwenPayload.response_format.type, "json_schema");
const geminiPayload = buildAiVisionPayload("gemini", "gemini-3.6-flash", "system", "user", png, false, 0.2, schema);
assert.strictEqual(geminiPayload.generationConfig.responseMimeType, "application/json");
assert.deepStrictEqual(geminiPayload.generationConfig.responseSchema, schema);
const claudePayload = buildAiVisionPayload("anthropic", "claude-sonnet-5", "system", "user", png, false, 0.2, schema);
assert.strictEqual(claudePayload.output_config.format.type, "json_schema");
assert.strictEqual(aiStructuredOutputMode("deepseek", "deepseek-v4-flash"), "prompt-json");

const textFields = ["role","term","category","level","awardName","edition","track","prize","organization","issuingOrganization","date","teachers","members","certificateNo","verificationUrl","evidence"];
const valid = {
  role:"学生获奖人",term:"2026-2027-1学期",category:"学科竞赛",level:"省级",awardName:"测试奖项",edition:"2026",track:"A组",prize:"一等奖",
  organization:"主办单位",issuingOrganization:"颁发单位",date:"2026-08-29",teachers:"张老师",members:"学生甲",certificateNo:"CERT-1",
  verificationUrl:"https://example.edu/verify",evidence:"证书可见文字",confidence:88,fieldConfidence:{},fieldEvidence:{},rawText:"证书全文",qualityWarnings:[],qrCodes:[],needsReview:false
};
for (const key of textFields) { valid.fieldConfidence[key] = 88; valid.fieldEvidence[key] = "可见文字"; }
const checked = validateCertificateAiResult(valid);
assert.strictEqual(checked.needsReview, true, "server must always require human review");
assert.throws(() => validateCertificateAiResult(Object.assign({}, valid, { confidence: 101 })), /0至100/);
assert.throws(() => validateCertificateAiResult(Object.assign({}, valid, { verificationUrl: "http://example.edu" })), /HTTPS/);

/* 识别结果容错：枚举/日期偏差只降级该字段；学期按落款月份规则推导（1-8月第二学期，9-12月第一学期）。 */
const lenient = validateCertificateAiResult(Object.assign({}, valid, {
  role: "获奖人", category: "比赛", level: "国际级", term: "2026-2027-1", date: "2024年12月3日",
  fieldConfidence: Object.fromEntries(textFields.map((key) => [key, "88"])),
  fieldEvidence: Object.fromEntries(textFields.map((key) => [key, null]))
}));
assert.strictEqual(lenient.role, "未判定");
assert.strictEqual(lenient.category, "未判定");
assert.strictEqual(lenient.level, "未判定");
assert.strictEqual(lenient.date, "2024-12-03");
assert.strictEqual(lenient.term, "2024-2025-1学期");
const february = validateCertificateAiResult(Object.assign({}, valid, { date: "2025年2月10日", term: "" }));
assert.strictEqual(february.date, "2025-02-10");
assert.strictEqual(february.term, "2024-2025-2学期");
const noDate = validateCertificateAiResult(Object.assign({}, valid, { date: "", term: "" }));
assert.strictEqual(noDate.date, "");
assert.strictEqual(noDate.term, "");

assert.deepStrictEqual(extractAiUsage("openai", {usage:{prompt_tokens:12,completion_tokens:5,total_tokens:17}}), {inputTokens:12,outputTokens:5,totalTokens:17});
assert.deepStrictEqual(extractAiUsage("gemini", {usageMetadata:{promptTokenCount:10,candidatesTokenCount:4,totalTokenCount:14}}), {inputTokens:10,outputTokens:4,totalTokens:14});
assert.deepStrictEqual(extractAiUsage("anthropic", {usage:{input_tokens:9,output_tokens:3}}), {inputTokens:9,outputTokens:3,totalTokens:12});

const routed = {model:"quality-model",economyModel:"economy-model",visionModel:"vision-model"};
assert.strictEqual(selectAiModel(routed,"notice"),"economy-model");
assert.strictEqual(selectAiModel(routed,"certificate"),"vision-model");
assert.strictEqual(selectAiModel(routed,"insight"),"quality-model");

assert.ok(!AI_FEATURE_KEYS.includes("knowledge"), "retired knowledge feature must not remain in the server AI feature registry");
assert.match(app, /不发送姓名、学号、班级及事件原文/, "student insight must disclose minimized outbound data");
assert.match(app, /talkAiRedactionPreview\(content\)/, "talk summary must preview server-side redaction before cloud AI");
assert.match(app, /\+preview\.text\+/, "talk summary must send the redacted preview text instead of the raw record");
for (const marker of ["AI 总结草稿（可编辑）", "tfAiReviewed", "aiSourceHash", "原文已修改待重生成", "不得作心理或医学诊断"]) {
  assert.ok(app.includes(marker), `talk summary governance marker is missing: ${marker}`);
}

console.log("qa-ai-governance: passed");
