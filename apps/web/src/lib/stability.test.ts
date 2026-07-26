import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import knowledge from "./knowledge.json" with { type: "json" };
import cases from "./cases.json" with { type: "json" };
import { createEngine } from "./engine.js";
import {
  AnalyzeInputSchema,
  AnalyzeResponseSchema,
  PdcaCycleSchema,
  ReportSchema,
} from "@wisdom/shared";
import {
  requestRemoteReport,
  validateCitationProvenance,
} from "./ai";
import {
  listReports,
  loadReport,
  migrateLastReport,
  migrateLegacyCycles,
  restoreReport,
  saveReport,
} from "./reportStore";
import {
  createNewCycle,
  generateInitialItems,
  listCycles,
  loadCycle,
  restoreCycle,
  saveCycle,
} from "./pdca";
import { POST as analyzePOST } from "../app/api/analyze/route";
import { GET as healthGET } from "../app/api/health/route";

const engine = createEngine(knowledge, cases);
const input = {
  title: "是否进入新市场",
  question: "竞争对手领先，我要不要跟进？",
  category: "创业",
  background: "团队资源有限",
  goal: "降低试错成本",
  resources: "有一批老客户",
  constraints: "现金流需要保护",
  risks: "投入后没有回报",
  deadline: "2026-12-31",
};
const retrieved = engine.retrieve(input);

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  clear() { this.values.clear(); }
}

function resetStorage() {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  (globalThis as typeof globalThis & { window: Window & typeof globalThis }).window = globalThis as unknown as Window & typeof globalThis;
  (globalThis as typeof globalThis & { localStorage: MemoryStorage }).localStorage = local;
  (globalThis as typeof globalThis & { sessionStorage: MemoryStorage }).sessionStorage = session;
  return { local, session };
}

function makeReport(decisionId = crypto.randomUUID(), reportId = crypto.randomUUID()) {
  return ReportSchema.parse({
    ...engine.buildLocalReport(input, retrieved),
    decisionId,
    reportId,
    mode: "local",
  });
}

function makeResponse() {
  const decisionId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const cycleId = crypto.randomUUID();
  return AnalyzeResponseSchema.parse({
    decisionId,
    reportId,
    cycleId,
    report: makeReport(decisionId, reportId),
    remoteError: null,
    retrievedAt: new Date().toISOString(),
  });
}

function configureRemote() {
  process.env.AI_BASE_URL = "https://example.test/v1/chat/completions";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
}

function clearRemote() {
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
}

test("自動問題分類", () => {
  assert.equal(retrieved.category, "创业");
});

test("知識檢索排序", () => {
  assert.ok(retrieved.knowledge.length >= 3);
  assert.ok(retrieved.knowledge[0].applications.includes("创业") || retrieved.knowledge[0].tags.length > 0);
});

test("AnalyzeInputSchema 有效輸入", () => {
  assert.equal(AnalyzeInputSchema.parse(input).question, input.question);
});

test("空白問題拒絕", () => {
  assert.equal(AnalyzeInputSchema.safeParse({ ...input, question: "   " }).success, false);
});

test("過長輸入拒絕", () => {
  assert.equal(AnalyzeInputSchema.safeParse({ ...input, question: "x".repeat(2001) }).success, false);
});

test("ReportSchema 有效報告", () => {
  assert.equal(ReportSchema.safeParse(makeReport()).success, true);
});

test("ReportSchema 缺欄位拒絕", () => {
  const report = makeReport();
  const missing: Partial<typeof report> = { ...report };
  delete missing.recommended_strategy;
  assert.equal(ReportSchema.safeParse(missing).success, false);
});

test("遠端 AI 成功", async () => {
  configureRemote();
  const original = globalThis.fetch;
  const report = makeReport();
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(report) } }] }), { status: 200 });
  const result = await requestRemoteReport(retrieved, "prompt", report.decisionId, report.reportId);
  globalThis.fetch = original;
  clearRemote();
  assert.equal(result.errorCode, null);
  assert.equal(result.report?.mode, "remote");
});

test("遠端 AI timeout 回退", async () => {
  configureRemote();
  const original = globalThis.fetch;
  globalThis.fetch = async () => { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; };
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID());
  globalThis.fetch = original;
  clearRemote();
  assert.equal(result.report, null);
  assert.equal(result.errorCode, "REMOTE_TIMEOUT");
});

test("遠端 AI 非 2xx 回退", async () => {
  configureRemote();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("provider body", { status: 503 });
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID());
  globalThis.fetch = original;
  clearRemote();
  assert.equal(result.errorCode, "REMOTE_HTTP_ERROR");
});

test("遠端 AI 無效 JSON 回退", async () => {
  configureRemote();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID());
  globalThis.fetch = original;
  clearRemote();
  assert.equal(result.errorCode, "REMOTE_INVALID_JSON");
});

test("遠端 AI 無效 citation ID 回退", () => {
  const report = makeReport();
  const invalid = { ...report, citations: [{ ...report.citations[0], id: "not-in-knowledge" }, report.citations[1]] };
  assert.equal(validateCitationProvenance(invalid, retrieved), null);
});

test("遠端 AI 偽造 source 回退", () => {
  const report = makeReport();
  const invalid = { ...report, citations: [{ ...report.citations[0], source: "伪造原文" }, report.citations[1]] };
  assert.equal(validateCitationProvenance(invalid, retrieved), null);
});

test("reportStore 保存與讀取", () => {
  resetStorage();
  const response = makeResponse();
  saveReport(response);
  assert.equal(loadReport(response.reportId)?.reportId, response.reportId);
});

test("雲端還原報告只新增缺少的本機資料", () => {
  resetStorage();
  const response = makeResponse();
  const restored = restoreReport(response, "2026-07-18T00:00:00.000Z");
  assert.equal(restored.ok, true);
  assert.equal(loadReport(response.reportId)?.createdAt, "2026-07-18T00:00:00.000Z");
  assert.equal(listReports().length, 1);
});

test("還原報告與 PDCA 可在重新讀取 localStorage 後保持關聯", () => {
  resetStorage();
  const response = makeResponse();
  const cycle = createNewCycle(response.reportId, response.decisionId, "還原驗收", "创业", [], 1, response.cycleId);
  assert.equal(restoreReport(response, "2026-07-18T00:00:00.000Z").ok, true);
  assert.deepEqual(restoreCycle(cycle), { ok: true });
  assert.equal(loadReport(response.reportId)?.reportId, response.reportId);
  assert.equal(loadCycle(cycle.cycleId)?.reportId, response.reportId);
  assert.equal(listCycles().filter((item) => item.reportId === response.reportId).length, 1);
});

test("雲端同 ID 報告不覆蓋本機資料", () => {
  resetStorage();
  const response = makeResponse();
  const local = saveReport(response);
  const restored = restoreReport(response, "2020-01-01T00:00:00.000Z");
  assert.deepEqual(restored, { ok: false, code: "REPORT_ALREADY_EXISTS" });
  assert.equal(loadReport(response.reportId)?.createdAt, local.createdAt);
});

test("相同標題產生不同 reportId", () => {
  resetStorage();
  const first = makeResponse();
  const second = makeResponse();
  saveReport(first);
  saveReport(second);
  assert.equal(listReports().length, 2);
  assert.notEqual(first.reportId, second.reportId);
});

test("localStorage 損壞安全處理", () => {
  const { local } = resetStorage();
  local.setItem("wisdom_reports_v1", "broken-json");
  assert.deepEqual(listReports(), []);
});

test("v0.1 lastReport 遷移", () => {
  const { session } = resetStorage();
  const oldReport = engine.buildLocalReport(input, retrieved);
  session.setItem("lastReport", JSON.stringify({ report: oldReport, retrievedAt: "2026-01-01T00:00:00.000Z" }));
  const migrated = migrateLastReport();
  assert.ok(migrated?.reportId && migrated.decisionId && migrated.cycleId);
  assert.equal(session.getItem("lastReport"), null);
  assert.ok(loadCycle(migrated!.cycleId));
});

test("migration 不會重複", () => {
  resetStorage();
  const { session } = resetStorage();
  session.setItem("lastReport", JSON.stringify({ report: engine.buildLocalReport(input, retrieved) }));
  const first = migrateLastReport();
  const second = migrateLastReport();
  assert.equal(first?.reportId, second?.reportId);
  assert.equal(listReports().length, 1);
});

test("v0.1 PDCA 遷移", () => {
  const { local } = resetStorage();
  const oldCycle = {
    id: "old-cycle",
    cycleNumber: 1,
    reportTitle: "旧版决策",
    reportCategory: "创业",
    startedAt: new Date().toISOString(),
    completedAt: null,
    items: [{ id: "item-1", text: "保留事项", status: "pending", note: "", source: "custom", createdAt: new Date().toISOString() }],
    checkins: [],
    reflection: null,
  };
  local.setItem("wisdom_pdca_旧版决策", JSON.stringify(oldCycle));
  assert.equal(migrateLegacyCycles(), 1);
  assert.equal(local.getItem("wisdom_pdca_旧版决策"), null);
  assert.equal(listCycles().length, 1);
});

test("v0.1 PDCA 遷移失敗保留舊 key", () => {
  const { local } = resetStorage();
  local.setItem("wisdom_pdca_broken", "{bad");
  assert.equal(migrateLegacyCycles(), 0);
  assert.equal(local.getItem("wisdom_pdca_broken"), "{bad");
});

test("PDCA 第二輪不覆蓋第一輪", () => {
  resetStorage();
  const response = makeResponse();
  const first = createNewCycle(response.reportId, response.decisionId, "同名", "创业", [], 1, response.cycleId);
  const second = createNewCycle(response.reportId, response.decisionId, "同名", "创业", [], 2);
  saveCycle(first);
  saveCycle(second);
  assert.equal(listCycles().length, 2);
  assert.ok(loadCycle(first.cycleId));
});

test("雲端同 ID PDCA 不覆蓋本機資料", () => {
  resetStorage();
  const response = makeResponse();
  const cycle = createNewCycle(response.reportId, response.decisionId, "同步測試", "创业", [], 1, response.cycleId);
  assert.deepEqual(restoreCycle(cycle), { ok: true });
  assert.deepEqual(restoreCycle({ ...cycle, reportTitle: "雲端版本" }), { ok: false, code: "PDCA_CYCLE_ALREADY_EXISTS" });
  assert.equal(loadCycle(cycle.cycleId)?.reportTitle, "同步測試");
});

test("未完成事項帶入下一輪", () => {
  const response = makeResponse();
  const item = generateInitialItems(response.report)[0];
  const next = createNewCycle(response.reportId, response.decisionId, "同名", "创业", [item], 2);
  assert.equal(next.items[0].text, item.text);
});

test("相同標題不同決策互不影響", () => {
  resetStorage();
  const first = makeResponse();
  const second = makeResponse();
  const firstCycle = createNewCycle(first.reportId, first.decisionId, "同名", "创业", [], 1, first.cycleId);
  const secondCycle = createNewCycle(second.reportId, second.decisionId, "同名", "创业", [], 1, second.cycleId);
  saveCycle(firstCycle);
  saveCycle(secondCycle);
  assert.equal(loadCycle(first.cycleId)?.decisionId, first.decisionId);
  assert.equal(loadCycle(second.cycleId)?.decisionId, second.decisionId);
});

test("無效 response 保存回傳明確錯誤", () => {
  resetStorage();
  assert.throws(() => saveReport({} as never), /REPORT_STORAGE_SAVE_FAILED/);
});

test("案例正式 metadata", () => {
  assert.ok(cases.every((item) => item.case_type === "composite" && item.source_title === null && item.source_url === null && item.source_date === null));
});

test("遠端 AI 未配置使用安全代碼", async () => {
  clearRemote();
  const result = await requestRemoteReport(retrieved, "prompt", crypto.randomUUID(), crypto.randomUUID());
  assert.equal(result.errorCode, "REMOTE_NOT_CONFIGURED");
});

test("citation provenance 至少需要兩條有效引用", () => {
  const report = makeReport();
  assert.equal(validateCitationProvenance({ ...report, citations: [report.citations[0]] }, retrieved), null);
});

test("PdcaCycleSchema 拒絕損壞資料", () => {
  assert.equal(PdcaCycleSchema.safeParse({ cycleId: "only-id" }).success, false);
});

test("History 首次 render 不讀寫 storage", () => {
  const source = readFileSync(new URL("../app/history/page.tsx", import.meta.url), "utf8");
  assert.match(source, /useState<StoredReport\[\]>\(\[\]\)/);
  assert.match(source, /useState<PdcaCycle\[\]>\(\[\]\)/);
  assert.match(source, /useState\(true\)/);
  assert.match(source, /useEffect\(\(\) =>/);
  assert.doesNotMatch(source, /useState<StoredReport\[\]>\(\(\) =>/);
  assert.doesNotMatch(source, /useState<PdcaCycle\[\]>\(\(\) =>/);
});

test("/api/analyze 無效 JSON", async () => {
  const response = await analyzePOST(new Request("http://localhost/api/analyze", { method: "POST", body: "{bad" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_JSON");
});

test("/api/analyze 空問題", async () => {
  const response = await analyzePOST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, question: " " }),
  }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "INVALID_INPUT");
});

test("/api/analyze 遠端失敗仍回傳 local report", async () => {
  configureRemote();
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("provider unavailable"); };
  const response = await analyzePOST(new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
  globalThis.fetch = original;
  clearRemote();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.report.mode, "local");
  assert.equal(payload.remoteError, "REMOTE_HTTP_ERROR");
});

test("/api/health 不暴露 API Key", async () => {
  process.env.AI_BASE_URL = "https://example.test/v1/chat/completions";
  process.env.AI_API_KEY = "secret-key-that-must-not-appear";
  process.env.AI_MODEL = "test-model";
  const payload = await (await healthGET()).json();
  clearRemote();
  assert.equal(payload.remote.configured, true);
  assert.equal(JSON.stringify(payload).includes("secret-key-that-must-not-appear"), false);
});
