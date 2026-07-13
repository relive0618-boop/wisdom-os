import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnalyzeInputSchema, AnalyzeResponseSchema, ReportQualitySchema, ReportSchema, type Report } from "@wisdom/shared";
import { assessReportQuality } from "./ai/quality";
import { remoteConfig, publicRemoteConfig } from "./ai/config";
import { requestRemoteReport } from "./ai/openaiCompatible";
import { createEngine } from "./engine.js";
import knowledge from "./knowledge.json" with { type: "json" };
import cases from "./cases.json" with { type: "json" };
import { POST as analyzePOST } from "../app/api/analyze/route";
import { checkRateLimit, resetRateLimit } from "./rateLimit";
import { GET as healthGET } from "../app/api/health/route";

const engine = createEngine(knowledge, cases);
const input = AnalyzeInputSchema.parse({
  title: "测试决策",
  question: "我是否应该在今年启动新项目？",
  category: "创业",
  background: "已有客户和小型团队",
  goal: "验证市场需求",
  resources: "时间与预算有限",
  constraints: "不能影响现有业务",
  risks: "可能没有回报",
  deadline: "2026-12-31",
  analysisMode: "auto",
});
const retrieved = engine.retrieve(input);

function report(): Report {
  const ids = retrieved.knowledge.slice(0, 3) as Array<{ id: string; chapter: string; title: string; source: string; plain: string }>;
  return ReportSchema.parse({
    decisionId: "test-decision",
    reportId: "test-report",
    mode: "remote" as const,
    category: retrieved.category,
    problem_summary: "这是一个需要比较条件与风险的测试决策。",
    core_conflict: "机会与资源约束之间需要取得平衡。",
    situation_assessment: "先比较资源、时机与风险，再选择可逆的验证路径。",
    citations: ids.map((item) => ({ id: item.id, chapter: item.chapter, title: item.title, source: item.source, explanation: item.plain })),
    strategies: [
      { name: "稳健方案", position: "先验证再投入。", actions: ["小范围测试。", "设定停止条件。"], suitable_when: "信息不足时。", risk: "速度较慢。" },
      { name: "平衡方案", position: "保持基本盘并推进。", actions: ["拆解目标。", "比较路径。"], suitable_when: "需要推进时。", risk: "执行复杂。" },
      { name: "进取方案", position: "抓住窗口主动投入。", actions: ["集中资源。", "准备退出方案。"], suitable_when: "资源可控时。", risk: "消耗较快。" },
    ],
    recommended_strategy: "推荐平衡方案，因为它兼顾验证速度与失败成本。",
    risks: ["市场风险：需求可能不足。", "资源风险：预算可能超支。", "执行风险：团队可能分心。"],
    action_plan_7d: ["第1天确认目标。", "第2天访谈客户。", "第3天列出路径。", "第4天估算成本。", "第5天做小测试。", "第6天复盘结果。", "第7天决定下一步。"],
    review_questions: ["目标是否清楚？", "哪些是事实？", "何时应该停止？"],
    disclaimer: "仅供一般决策辅助，不构成专业意见。",
  });
}

function configure() {
  process.env.AI_BASE_URL = "https://example.test/v1/chat/completions";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
}

function clear() {
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.AI_TIMEOUT_MS;
  delete process.env.AI_MAX_RETRIES;
}

test("analysisMode 預設 auto", () => assert.equal(AnalyzeInputSchema.parse({ question: "問題" }).analysisMode, "auto"));
test("local analysisMode 可解析", () => assert.equal(AnalyzeInputSchema.parse({ question: "問題", analysisMode: "local" }).analysisMode, "local"));
test("remote analysisMode 可解析", () => assert.equal(AnalyzeInputSchema.parse({ question: "問題", analysisMode: "remote" }).analysisMode, "remote"));
test("ReportQualitySchema 限制分數範圍", () => assert.equal(ReportQualitySchema.safeParse({ qualityScore: 101, qualityWarnings: [], qualityPassed: false }).success, false));
test("品質檢查接受完整報告", () => assert.equal(assessReportQuality(report(), input.question).qualityPassed, true));
test("品質檢查拒絕兩項策略", () => assert.ok(assessReportQuality({ ...report(), strategies: report().strategies.slice(0, 2) }, input.question).qualityWarnings.includes("strategies 必须正好三项")));
test("品質檢查拒絕過少風險", () => assert.ok(assessReportQuality({ ...report(), risks: ["只有一項"] }, input.question).qualityWarnings.includes("risks 至少需要三项")));
test("品質檢查拒絕絕對化字詞", () => assert.ok(assessReportQuality({ ...report(), recommended_strategy: "这个方案一定保证成功，因为条件很好。" }, input.question).qualityWarnings.includes("报告含有明显绝对化字词")));
test("品質檢查拒絕重複問題", () => assert.ok(assessReportQuality({ ...report(), situation_assessment: input.question }, input.question).qualityWarnings.includes("situation_assessment 只是重复问题")));
test("遠端設定 timeout 可配置", () => { process.env.AI_TIMEOUT_MS = "12000"; assert.equal(remoteConfig().timeoutMs, 12000); clear(); });
test("遠端設定 retries 上限為 1", () => { process.env.AI_MAX_RETRIES = "9"; assert.equal(remoteConfig().maxRetries, 1); clear(); });
test("public config 不包含 API key", () => { configure(); assert.equal("apiKey" in publicRemoteConfig(), false); clear(); });
test("remote provider 成功並回傳品質分數", async () => { configure(); const old = globalThis.fetch; const value = report(); globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 }); const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input); globalThis.fetch = old; clear(); assert.equal(result.errorCode, null); assert.ok(result.quality.qualityScore >= 70); });
test("remote provider 移除 markdown fence", async () => { configure(); const old = globalThis.fetch; const value = report(); globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(value)}\n\`\`\`` } }] }), { status: 200 }); const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input); globalThis.fetch = old; clear(); assert.equal(result.errorCode, null); });
test("remote quality failure 會嘗試一次修復後回退", async () => { configure(); const old = globalThis.fetch; const bad = { ...report(), strategies: report().strategies.slice(0, 2) }; let calls = 0; globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bad) } }] }), { status: 200 }); }; const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input); globalThis.fetch = old; clear(); assert.equal(calls, 2); assert.equal(result.errorCode, "REMOTE_QUALITY_FAILED"); });
test("rate limit 每個 key 第 11 次拒絕", () => { resetRateLimit(); for (let i = 0; i < 10; i += 1) assert.equal(checkRateLimit("test-ip", 1000).allowed, true); assert.equal(checkRateLimit("test-ip", 1000).allowed, false); resetRateLimit(); });
test("rate limit 不同 IP 分開計算", () => { resetRateLimit(); for (let i = 0; i < 10; i += 1) checkRateLimit("ip-a", 1000); assert.equal(checkRateLimit("ip-b", 1000).allowed, true); resetRateLimit(); });
test("rate limit 視窗到期後重置", () => { resetRateLimit(); for (let i = 0; i < 10; i += 1) checkRateLimit("ip-a", 1000); assert.equal(checkRateLimit("ip-a", 61001).allowed, true); resetRateLimit(); });
test("API local mode 不呼叫遠端", async () => { clear(); const old = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error("should not call"); }; const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "local-test" }, body: JSON.stringify({ ...input, analysisMode: "local" }) })); globalThis.fetch = old; assert.equal(response.status, 200); const payload = await response.json(); assert.equal(payload.report.mode, "local"); assert.equal(payload.fallbackReason, "USER_SELECTED_LOCAL"); assert.equal(calls, 0); });
test("API remote 未配置安全回退", async () => { clear(); const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "remote-unconfigured" }, body: JSON.stringify({ ...input, analysisMode: "remote" }) })); const payload = await response.json(); assert.equal(response.status, 200); assert.equal(payload.fallbackReason, "REMOTE_NOT_CONFIGURED"); });
test("API rate limit 回傳統一 429", async () => { resetRateLimit(); clear(); const make = () => analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "limited-test" }, body: JSON.stringify({ ...input, analysisMode: "local" }) })); for (let i = 0; i < 10; i += 1) await make(); const response = await make(); assert.equal(response.status, 429); assert.equal((await response.json()).error.code, "RATE_LIMITED"); resetRateLimit(); });
test("AnalyzeResponseSchema 舊資料使用新欄位預設值", () => { const parsed = AnalyzeResponseSchema.safeParse({ decisionId: "d", reportId: "r", cycleId: "c", report: { ...report(), mode: "local", decisionId: "d", reportId: "r" }, retrievedAt: new Date().toISOString() }); assert.equal(parsed.success, true); if (parsed.success) assert.equal(parsed.data.provider, "local"); });
test("ai.ts 只保留相容 re-export", () => { assert.equal(readFileSync(new URL("./ai.ts", import.meta.url), "utf8").trim(), 'export * from "./ai/index";'); });
test("health 不回傳 API Key", async () => { process.env.AI_BASE_URL = "https://example.test/v1/chat/completions"; process.env.AI_API_KEY = "health-secret-key"; process.env.AI_MODEL = "test-model"; const payload = await (await healthGET()).json(); clear(); assert.equal(JSON.stringify(payload).includes("health-secret-key"), false); });
test("health 不回傳 URL query、帳號密碼或 fragment", async () => { process.env.AI_BASE_URL = "https://user:password@example.test/v1/chat/completions?api_key=url-secret#fragment"; process.env.AI_API_KEY = "test-key"; process.env.AI_MODEL = "test-model"; const payload = await (await healthGET()).json(); clear(); assert.equal(payload.remote.safeBaseUrl, "https://example.test/v1/chat/completions"); assert.equal(JSON.stringify(payload).includes("url-secret"), false); assert.equal(JSON.stringify(payload).includes("password"), false); assert.equal(JSON.stringify(payload).includes("fragment"), false); });
test("README 案例數為 30", () => { assert.match(readFileSync(new URL("../../../../README.md", import.meta.url), "utf8"), /现代案例.*30 个情境化综合案例/); });
