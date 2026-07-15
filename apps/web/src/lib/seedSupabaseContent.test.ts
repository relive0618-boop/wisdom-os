import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyConfiguration,
  applySeed,
  formatApplyResult,
  formatDryRun,
  parseSeedMode,
  type SeedClient,
  validateSeedData,
} from "../../../../scripts/seed-supabase-content-lib";

const knowledge = {
  id: "knowledge-1", chapter: "第一篇", title: "知己知彼", source: "孙子兵法", plain: "先评估条件。",
  principle: "认识条件", applications: ["盘点资源"], limits: ["不保证结果"], tags: ["评估"],
};
const caseEntry = {
  id: "case-1", title: "小规模验证", scenario: "资源有限", summary: "先测试", result: "得到反馈",
  lessons: ["先验证"], tags: ["测试"], case_type: "composite", source_title: null, source_url: null, source_date: null, review_status: "reviewed",
};
const validData = () => ({ knowledge: [knowledge], cases: [caseEntry] });

function successfulClient(options: { failKnowledge?: boolean; failCases?: boolean; invalidVerification?: boolean } = {}): SeedClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    upsert: async (table, rows) => {
      calls.push(`upsert:${table}:${rows.length}`);
      if ((table === "knowledge_entries" && options.failKnowledge) || (table === "case_entries" && options.failCases)) {
        return { data: null, error: { code: "safe" }, status: 400, statusText: "Bad Request" };
      }
      return { data: rows, error: null, status: 201, statusText: "Created" };
    },
    verify: async (table, ids) => {
      calls.push(`verify:${table}:${ids.length}`);
      return {
        data: options.invalidVerification ? [] : ids.map((id) => ({ id, status: "published", deleted_at: null })),
        error: null,
        status: 200,
        statusText: "OK",
      };
    },
  };
}

test("seed 預設模式需要明確旗標", () => assert.throws(() => parseSeedMode([]), /SEED_USAGE_REQUIRED/));
test("seed 只接受單一 dry-run 或 apply 旗標", () => {
  assert.equal(parseSeedMode(["--dry-run"]), "dry-run");
  assert.equal(parseSeedMode(["--apply"]), "apply");
  assert.throws(() => parseSeedMode(["--dry-run", "--apply"]), /SEED_USAGE_REQUIRED/);
  assert.throws(() => parseSeedMode(["--unknown"]), /SEED_USAGE_REQUIRED/);
});
test("dry-run 本機驗證不需要環境變數或 client", () => {
  const result = validateSeedData(validData());
  assert.equal(result.valid, true);
  assert.match(formatDryRun(result), /Seed dry-run: SAFE[\s\S]*Remote writes: 0/);
});
test("dry-run 路徑不靜態載入 Supabase client 或網路層", () => {
  const source = readFileSync(resolve(process.cwd(), "../../scripts/seed-supabase-content.ts"), "utf8");
  assert.doesNotMatch(source, /^import\s+\{\s*createClient/m);
  assert.match(source, /mode === "dry-run"[\s\S]*else \{[\s\S]*createApplyClient/);
});
test("duplicate id 被拒絕", () => {
  const result = validateSeedData({ knowledge: [knowledge, knowledge], cases: [caseEntry] });
  assert.equal(result.valid, false);
  assert.equal(result.duplicateIds, 1);
});
test("無效 schema 被拒絕", () => {
  const result = validateSeedData({ knowledge: [{ id: "bad" }], cases: [caseEntry] });
  assert.equal(result.valid, false);
  assert.equal(result.invalidEntries, 1);
});
test("跨表相同 id 被明確標為允許", () => {
  const result = validateSeedData({ knowledge: [knowledge], cases: [{ ...caseEntry, id: knowledge.id }] });
  assert.equal(result.valid, true);
  assert.equal(result.crossTableIdCollisions, 1);
  assert.match(formatDryRun(result), /allowed: separate tables/);
});
test("apply 缺 URL 被拒絕且不顯示值", () => assert.throws(() => applyConfiguration({ SUPABASE_SECRET_KEY: "hidden" }), /SUPABASE_SEED_URL_MISSING/));
test("apply 缺 Secret 被拒絕", () => assert.throws(() => applyConfiguration({ NEXT_PUBLIC_SUPABASE_URL: "https://example.test" }), /SUPABASE_SEED_SECRET_MISSING/));
test("apply 成功後核對遠端 ID 與數量", async () => {
  const client = successfulClient();
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.success, true);
  assert.equal(result.knowledge.confirmed, 1);
  assert.equal(result.cases.confirmed, 1);
  assert.deepEqual(client.calls, ["upsert:knowledge_entries:1", "verify:knowledge_entries:1", "upsert:case_entries:1", "verify:case_entries:1"]);
});
test("knowledge upsert error 被安全捕捉且停止後續寫入", async () => {
  const client = successfulClient({ failKnowledge: true });
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.success, false);
  assert.equal(result.knowledge.errorCode, "SEED_UPSERT_FAILED");
  assert.equal(result.cases.errorCode, "SEED_SKIPPED_AFTER_FAILURE");
  assert.deepEqual(client.calls, ["upsert:knowledge_entries:1"]);
});
test("case upsert error 被安全捕捉且不謊稱整體成功", async () => {
  const client = successfulClient({ failCases: true });
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.success, false);
  assert.equal(result.knowledge.success, true);
  assert.equal(result.cases.errorCode, "SEED_UPSERT_FAILED");
  assert.match(formatApplyResult(result), /Seed apply: FAILED/);
});
test("遠端核對不完整被視為失敗", async () => {
  const result = await applySeed(successfulClient({ invalidVerification: true }), validateSeedData(validData()));
  assert.equal(result.success, false);
  assert.equal(result.knowledge.errorCode, "SEED_VERIFICATION_FAILED");
});
test("驗證會以最多 50 筆分批查詢", async () => {
  const many = Array.from({ length: 51 }, (_, index) => ({ ...knowledge, id: `knowledge-${index}` }));
  const client = successfulClient();
  const result = await applySeed(client, validateSeedData({ knowledge: many, cases: [caseEntry] }));
  assert.equal(result.success, true);
  assert.ok(client.calls.includes("verify:knowledge_entries:50"));
  assert.ok(client.calls.includes("verify:knowledge_entries:1"));
});
test("seed 日誌只含安全摘要，不含 payload 或 credential", () => {
  const summary = formatDryRun(validateSeedData(validData()));
  assert.doesNotMatch(summary, /孙子兵法|https?:|secret|token|payload/i);
});
test("seed 實作沒有破壞性資料庫操作", () => {
  const source = readFileSync(resolve(process.cwd(), "../../scripts/seed-supabase-content-lib.ts"), "utf8");
  assert.doesNotMatch(source, /\.delete\s*\(|\.truncate\s*\(|\bdrop\s+/i);
});
