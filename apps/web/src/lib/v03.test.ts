import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnalyzeInputSchema, AnalyzeResponseSchema, RemoteReportContentSchema, ReportQualitySchema, ReportSchema, type Report } from "@wisdom/shared";
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

function remoteContent(overrides: Record<string, unknown> = {}) {
  const systemFields = new Set(["decisionId", "reportId", "mode", "category", "case_refs"]);
  const content = Object.fromEntries(Object.entries(report()).filter(([key]) => !systemFields.has(key)));
  return { ...content, ...overrides };
}

async function requestMockRemote(content: unknown) {
  configure();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  try {
    return await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  } finally {
    globalThis.fetch = original;
    clear();
  }
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
  delete process.env.AI_MAX_OUTPUT_TOKENS;
  delete process.env.AI_RESPONSE_FORMAT_MODE;
  delete process.env.AI_TOTAL_BUDGET_MS;
  delete process.env.AI_THINKING_MODE;
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
test("模型不輸出 category 時由伺服器注入 retrieved.category", async () => {
  const result = await requestMockRemote(remoteContent());
  assert.equal(result.errorCode, null); assert.equal(result.report?.category, retrieved.category);
});
test("模型偽造 category 時由伺服器值覆蓋", async () => {
  const result = await requestMockRemote({ ...remoteContent(), category: "伪造分类" });
  assert.equal(result.report?.category, retrieved.category);
});
test("模型偽造 decisionId 時由伺服器值覆蓋", async () => {
  const decisionId = crypto.randomUUID(); configure(); const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...remoteContent(), decisionId: "forged" }) } }] }), { status: 200 });
  const result = await requestRemoteReport(retrieved, "prompt", decisionId, crypto.randomUUID(), input); globalThis.fetch = original; clear();
  assert.equal(result.report?.decisionId, decisionId);
});
test("模型偽造 reportId 時由伺服器值覆蓋", async () => {
  const reportId = crypto.randomUUID(); configure(); const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...remoteContent(), reportId: "forged" }) } }] }), { status: 200 });
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), reportId, input); globalThis.fetch = original; clear();
  assert.equal(result.report?.reportId, reportId);
});
test("模型偽造 mode=local 時最終仍為 remote", async () => {
  const result = await requestMockRemote({ ...remoteContent(), mode: "local" });
  assert.equal(result.report?.mode, "remote");
});
test("模型偽造 case_refs 時由檢索案例覆蓋", async () => {
  const result = await requestMockRemote({ ...remoteContent(), case_refs: [] });
  assert.deepEqual(result.report?.case_refs?.map((item: { id: string }) => item.id), retrieved.cases.map((item: { id: string }) => item.id));
});
test("RemoteReportContentSchema 缺少 problem_summary 時失敗", () => {
  const missing = remoteContent(); delete missing.problem_summary;
  assert.equal(RemoteReportContentSchema.safeParse(missing).success, false);
});
test("RemoteReportContentSchema 拒絕錯誤 strategies 型態", () => {
  assert.equal(RemoteReportContentSchema.safeParse(remoteContent({ strategies: "not-an-array" })).success, false);
});
test("RemoteReportContentSchema 拒絕非七項 action_plan_7d", () => {
  assert.equal(RemoteReportContentSchema.safeParse(remoteContent({ action_plan_7d: ["one"] })).success, false);
});
test("Schema 診斷只保留路徑而不含模型值", async () => {
  const privateValue = "model-value-must-not-leave-server";
  const result = await requestMockRemote(remoteContent({ strategies: privateValue }));
  assert.equal(result.errorCode, "REMOTE_SCHEMA_INVALID"); assert.ok(result.providerSchemaIssueCount > 0); assert.ok(result.providerSchemaIssuePaths.includes("strategies")); assert.equal(JSON.stringify(result).includes(privateValue), false);
});
test("Analyze response 不包含 Zod 原始 message", async () => {
  configure(); resetRateLimit(); const original = globalThis.fetch;
  const privateValue = "model-value-must-not-leave-server";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(remoteContent({ strategies: privateValue })) } }] }), { status: 200 });
  const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "schema-message-test" }, body: JSON.stringify({ ...input, analysisMode: "remote" }) }));
  const payload = await response.json(); globalThis.fetch = original; clear(); resetRateLimit();
  assert.equal(response.status, 200); assert.equal(payload.remoteSchemaIssuePaths.includes("strategies"), true); assert.equal(JSON.stringify(payload).includes(privateValue), false); assert.equal(JSON.stringify(payload).includes("Expected array"), false);
});
test("舊保存報告可讀取 Schema 診斷預設值", () => {
  const stored = AnalyzeResponseSchema.parse({ decisionId: "d", reportId: "r", cycleId: "c", report: { ...report(), mode: "local", decisionId: "d", reportId: "r" }, retrievedAt: new Date().toISOString() });
  assert.equal(stored.remoteSchemaIssueCount, 0); assert.deepEqual(stored.remoteSchemaIssuePaths, []);
});
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

test("prompt 模式不傳 response_format", async () => {
  configure();
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(result.errorCode, null);
  assert.equal("response_format" in body, false);
});

test("json_object 模式才傳 response_format", async () => {
  configure(); process.env.AI_RESPONSE_FORMAT_MODE = "json_object";
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("預設傳 max_tokens=1800", async () => {
  configure();
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(body.max_tokens, 1800);
});

test("遠端請求固定 stream=false", async () => {
  configure();
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(body.stream, false);
});

test("provider_default 不傳 chat_template_kwargs", async () => {
  configure();
  const original = globalThis.fetch; let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal("chat_template_kwargs" in body, false);
});

test("thinking off 傳 enable_thinking=false", async () => {
  configure(); process.env.AI_THINKING_MODE = "off";
  const original = globalThis.fetch; let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
});

test("thinking on 傳 enable_thinking=true", async () => {
  configure(); process.env.AI_THINKING_MODE = "on";
  const original = globalThis.fetch; let body: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
});

test("無效 thinking mode 回退 provider_default", () => {
  process.env.AI_THINKING_MODE = "unsupported";
  assert.equal(remoteConfig().thinkingMode, "provider_default");
  clear();
});

test("壓縮 prompt 不包含完整案例 JSON", () => {
  const prompt = engine.buildPrompt(input, retrieved);
  assert.equal(prompt.includes(retrieved.cases[0].scenario), false);
  assert.equal(prompt.includes("case_type"), false);
});

test("壓縮 prompt 最多包含三條 knowledge", () => {
  const prompt = engine.buildPrompt(input, retrieved);
  assert.equal(retrieved.knowledge.filter((item: { id: string }) => prompt.includes(`id=${item.id}`)).length, 3);
});

test("壓縮 prompt 不使用漂亮縮排 JSON", () => {
  const prompt = engine.buildPrompt(input, retrieved);
  assert.equal(prompt.includes("{\n  \""), false);
});

test("timeout 不重試", async () => {
  configure(); process.env.AI_MAX_RETRIES = "1";
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; const error = new Error("timeout"); error.name = "TimeoutError"; throw error; };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(result.errorCode, "REMOTE_TIMEOUT"); assert.equal(calls, 1); assert.equal(result.attempts, 1);
});

test("HTTP 429 會重試一次", async () => {
  configure(); process.env.AI_MAX_RETRIES = "1";
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return calls === 1 ? new Response("", { status: 429 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(result.errorCode, null); assert.equal(calls, 2); assert.equal(result.attempts, 2);
});

test("HTTP 503 會重試一次", async () => {
  configure(); process.env.AI_MAX_RETRIES = "1";
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return calls === 1 ? new Response("", { status: 503 }) : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 }); };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(result.errorCode, null); assert.equal(calls, 2); assert.equal(result.attempts, 2);
});

test("HTTP 401 不重試", async () => {
  configure(); process.env.AI_MAX_RETRIES = "1";
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("", { status: 401 }); };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(result.errorCode, "REMOTE_HTTP_ERROR"); assert.equal(calls, 1); assert.equal(result.attempts, 1);
});

test("總預算不足時不執行品質修復", async () => {
  configure(); process.env.AI_TOTAL_BUDGET_MS = "15000";
  const originalFetch = globalThis.fetch; const originalNow = Date.now; let calls = 0; let now = 0;
  Date.now = () => now;
  const incomplete = { ...report(), strategies: report().strategies.slice(0, 2) };
  globalThis.fetch = async () => { calls += 1; now = 6000; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(incomplete) } }] }), { status: 200 }); };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = originalFetch; Date.now = originalNow; clear();
  assert.equal(result.errorCode, "REMOTE_QUALITY_FAILED"); assert.equal(calls, 1); assert.equal(result.repaired, false);
});

test("latencyMs 與 attempts 僅回傳安全數值", async () => {
  configure();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 });
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(typeof result.latencyMs, "number"); assert.equal(result.attempts, 1); assert.equal(JSON.stringify(result).includes("test-key"), false);
});

test("舊報告可讀取新增遠端欄位預設值", () => {
  const parsed = AnalyzeResponseSchema.parse({ decisionId: "d", reportId: "r", cycleId: "c", report: { ...report(), mode: "local", decisionId: "d", reportId: "r" }, retrievedAt: new Date().toISOString() });
  assert.equal(parsed.remoteLatencyMs, null); assert.equal(parsed.remoteAttempts, 0); assert.equal(parsed.remoteRepaired, false);
});

test("舊 StoredReport 可讀取安全診斷欄位預設值", () => {
  const stored = AnalyzeResponseSchema.parse({ decisionId: "d", reportId: "r", cycleId: "c", report: { ...report(), mode: "local", decisionId: "d", reportId: "r" }, retrievedAt: new Date().toISOString() });
  assert.equal(stored.remotePayloadParsed, false); assert.equal(stored.remoteContentLength, null); assert.equal(stored.remoteJsonExtraction, "not_attempted"); assert.equal(stored.remoteReasoningPresent, false); assert.equal(stored.remoteReasoningLength, null);
});

test("Analyze API response 不包含 Provider raw content", async () => {
  configure(); resetRateLimit();
  const original = globalThis.fetch;
  const rawContentMarker = "provider-content-must-not-leave-server";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: `${rawContentMarker}\n${JSON.stringify(report())}` } }] }), { status: 200 });
  const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "raw-content-test" }, body: JSON.stringify({ ...input, analysisMode: "remote" }) }));
  const payload = await response.json();
  globalThis.fetch = original; clear(); resetRateLimit();
  assert.equal(response.status, 200); assert.equal(JSON.stringify(payload).includes(rawContentMarker), false);
});

test("Analyze API response 不包含 Provider payload", async () => {
  configure(); resetRateLimit();
  const original = globalThis.fetch;
  const rawPayloadMarker = "provider-payload-must-not-leave-server";
  globalThis.fetch = async () => new Response(JSON.stringify({ internal_debug: rawPayloadMarker, choices: [{ message: { content: JSON.stringify(report()) } }] }), { status: 200 });
  const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "raw-payload-test" }, body: JSON.stringify({ ...input, analysisMode: "remote" }) }));
  const payload = await response.json();
  globalThis.fetch = original; clear(); resetRateLimit();
  assert.equal(response.status, 200); assert.equal(JSON.stringify(payload).includes(rawPayloadMarker), false);
});

test("Analyze API response 不包含 reasoning 原文", async () => {
  configure(); resetRateLimit();
  const original = globalThis.fetch;
  const rawReasoningMarker = "reasoning-must-not-leave-server";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report()), reasoning_content: rawReasoningMarker } }] }), { status: 200 });
  const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "reasoning-test" }, body: JSON.stringify({ ...input, analysisMode: "remote" }) }));
  const payload = await response.json();
  globalThis.fetch = original; clear(); resetRateLimit();
  assert.equal(response.status, 200); assert.equal(payload.remoteReasoningPresent, true); assert.equal(JSON.stringify(payload).includes(rawReasoningMarker), false);
});

test("reasoning_content 不會被當成最終 report", async () => {
  configure();
  const original = globalThis.fetch;
  const reasoningReport = JSON.stringify(report());
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "", reasoning_content: reasoningReport } }] }), { status: 200 });
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID(), input);
  globalThis.fetch = original; clear();
  assert.equal(result.report, null); assert.equal(result.errorCode, "REMOTE_INVALID_JSON"); assert.equal(result.providerReasoningPresent, true); assert.equal(result.providerReasoningLength, reasoningReport.length);
});

test("health 顯示安全相容設定", async () => {
  configure(); process.env.AI_MAX_OUTPUT_TOKENS = "2200"; process.env.AI_RESPONSE_FORMAT_MODE = "json_object"; process.env.AI_TOTAL_BUDGET_MS = "30000";
  const payload = await (await healthGET()).json(); clear();
  assert.equal(payload.remote.maxOutputTokens, 2200); assert.equal(payload.remote.responseFormatMode, "json_object"); assert.equal(payload.remote.totalBudgetMs, 30000); assert.equal(JSON.stringify(payload).includes("test-key"), false);
});

test("health 顯示 thinkingMode", async () => {
  configure(); process.env.AI_THINKING_MODE = "off";
  const payload = await (await healthGET()).json(); clear();
  assert.equal(payload.remote.thinkingMode, "off"); assert.equal(JSON.stringify(payload).includes("test-key"), false);
});
