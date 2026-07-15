import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
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
} from "../../scripts/seed-supabase-content-lib";

const knowledge = {
  id: "knowledge-1", chapter: "第一篇", title: "知己知彼", source: "孙子兵法", plain: "先评估条件。",
  principle: "认识条件", applications: ["盘点资源"], limits: ["不保证结果"], tags: ["评估"],
};
const caseEntry = {
  id: "case-1", title: "小规模验证", scenario: "资源有限", summary: "先测试", result: "得到反馈",
  lessons: ["先验证"], tags: ["测试"], case_type: "composite", source_title: null, source_url: null, source_date: null, review_status: "reviewed",
};
const validData = () => ({ knowledge: [knowledge], cases: [caseEntry] });
const mockUrl = `https://${"seed-runner-test"}.supabase.co`;
const mockSecret = ["sb", "secret", "seed", "runner", "test"].join("_");
const repositoryRoot = resolve(process.cwd(), "../..");

function runSeedCommand(extraEnv: Record<string, string> = {}) {
  return spawnSync("pnpm", ["seed:supabase:apply"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: mockUrl, SUPABASE_SECRET_KEY: mockSecret, WISDOM_SEED_TEST_FETCH: "mock", ...extraEnv },
  });
}

function successfulClient(options: { failKnowledge?: boolean; failCases?: boolean; invalidVerification?: boolean; probeResult?: { data: unknown; error: unknown; status: number; statusText: string } } = {}): SeedClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    probe: async (table) => {
      calls.push(`probe:${table}`);
      return options.probeResult ?? { data: null, error: null, status: 200, statusText: "OK" };
    },
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
  const source = readFileSync(resolve(process.cwd(), "scripts/seed-supabase-content.ts"), "utf8");
  assert.doesNotMatch(source, /^import\s+\{\s*createClient/m);
  assert.match(source, /if \(mode === "dry-run"\)[\s\S]*return;[\s\S]*createApplyClient/);
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
test("apply 缺 URL 被安全拒絕", () => assert.throws(() => applyConfiguration({ SUPABASE_SECRET_KEY: mockSecret }), /SEED_URL_INVALID/));
test("apply 缺 Secret 被安全拒絕", () => assert.throws(() => applyConfiguration({ NEXT_PUBLIC_SUPABASE_URL: mockUrl }), /SEED_SECRET_FORMAT_INVALID/));
test("apply 拒絕不安全 URL 與非 Secret Key", () => {
  assert.throws(() => applyConfiguration({ NEXT_PUBLIC_SUPABASE_URL: "http://project.supabase.co", SUPABASE_SECRET_KEY: mockSecret }), /SEED_URL_INVALID/);
  assert.throws(() => applyConfiguration({ NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@project.supabase.co", SUPABASE_SECRET_KEY: mockSecret }), /SEED_URL_INVALID/);
  assert.throws(() => applyConfiguration({ NEXT_PUBLIC_SUPABASE_URL: mockUrl, SUPABASE_SECRET_KEY: "wisdom_os_preview_vercel" }), /SEED_SECRET_FORMAT_INVALID/);
});
test("apply 成功後核對遠端 ID 與數量", async () => {
  const client = successfulClient();
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.success, true);
  assert.equal(result.knowledge.confirmed, 1);
  assert.equal(result.cases.confirmed, 1);
  assert.deepEqual(client.calls, ["probe:knowledge_entries", "probe:case_entries", "upsert:knowledge_entries:1", "verify:knowledge_entries:1", "upsert:case_entries:1", "verify:case_entries:1"]);
});
test("knowledge upsert error 被安全捕捉且停止後續寫入", async () => {
  const client = successfulClient({ failKnowledge: true });
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.success, false);
  assert.equal(result.knowledge.errorCode, "SEED_REQUEST_INVALID");
  assert.equal(result.cases.errorCode, "SEED_SKIPPED_AFTER_FAILURE");
  assert.deepEqual(client.calls, ["probe:knowledge_entries", "probe:case_entries", "upsert:knowledge_entries:1"]);
});
test("case upsert error 被安全捕捉且不謊稱整體成功", async () => {
  const client = successfulClient({ failCases: true });
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.success, false);
  assert.equal(result.knowledge.success, true);
  assert.equal(result.cases.errorCode, "SEED_REQUEST_INVALID");
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
  const source = readFileSync(resolve(process.cwd(), "scripts/seed-supabase-content-lib.ts"), "utf8");
  assert.doesNotMatch(source, /\.delete\s*\(|\.truncate\s*\(|\bdrop\s+/i);
});
function diagnosticClient(status: number, code: string | null): SeedClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    probe: async (table) => { calls.push(`probe:${table}`); return { data: null, error: { code, message: "private message", details: "private details", hint: "private hint" }, status, statusText: "Error" }; },
    upsert: async () => { calls.push("upsert"); return { data: null, error: null, status: 200, statusText: "OK" }; },
    verify: async () => ({ data: [], error: null, status: 200, statusText: "OK" }),
  };
}
for (const [status, code, expected] of [[401, null, "SEED_AUTH_FAILED"], [403, "42501", "SEED_PERMISSION_DENIED"], [404, "PGRST205", "SEED_TABLE_NOT_EXPOSED"], [409, "23505", "SEED_CONFLICT_FAILED"], [500, null, "SEED_PROVIDER_UNAVAILABLE"]] as const) {
  test(`probe ${status} 安全分類為 ${expected}`, async () => {
    const client = diagnosticClient(status, code); const result = await applySeed(client, validateSeedData(validData()));
    assert.equal(result.knowledge.errorCode, expected); assert.equal(result.knowledge.httpStatus, status); assert.equal(result.knowledge.providerCode, code); assert.equal(result.knowledge.phase, "client_init"); assert.equal(result.remoteWrites, 0); assert.deepEqual(client.calls, ["probe:knowledge_entries"]);
  });
}
test("probe network throw 為 SEED_NETWORK_FAILED 且零寫入", async () => {
  const client: SeedClient = { probe: async () => { throw new Error(); }, upsert: async () => ({ data: null, error: null, status: 200, statusText: "OK" }), verify: async () => ({ data: [], error: null, status: 200, statusText: "OK" }) };
  const result = await applySeed(client, validateSeedData(validData()));
  assert.equal(result.knowledge.errorCode, "SEED_NETWORK_FAILED"); assert.equal(result.remoteWrites, 0);
});
test("安全診斷不輸出 provider message details 或 hint", async () => {
  const result = await applySeed(diagnosticClient(404, "PGRST205"), validateSeedData(validData())); const output = formatApplyResult(result);
  assert.match(output, /Knowledge HTTP status: 404[\s\S]*Knowledge provider code: PGRST205[\s\S]*SEED_TABLE_NOT_EXPOSED/);
  assert.doesNotMatch(output, /private message|private details|private hint/);
});
test("未知 provider code 會脫敏為 SEED_PROVIDER_ERROR", async () => {
  const result = await applySeed(diagnosticClient(418, "UNSAFE_CODE"), validateSeedData(validData()));
  assert.equal(result.knowledge.providerCode, "SEED_PROVIDER_ERROR"); assert.equal(result.knowledge.errorCode, "SEED_UPSERT_FAILED");
});
test("web package 從 runner 位置可解析 Supabase SDK", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'process.stdout.write(import.meta.resolve("@supabase/supabase-js"))'], { cwd: resolve(process.cwd(), "scripts"), encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /supabase-js/);
});
test("實際 package apply command 可初始化 client 且不發出網路請求", () => {
  const result = runSeedCommand(); const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0);
  assert.match(output, /Seed apply: SAFE/);
  assert.doesNotMatch(output, new RegExp(`${mockUrl}|${mockSecret}`));
});
test("實際 package command 的 import 失敗回傳安全代碼", () => {
  const result = runSeedCommand({ WISDOM_SEED_TEST_IMPORT_FAILURE: "1" }); const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1);
  assert.match(output, /SEED_CLIENT_IMPORT_FAILED/);
  assert.doesNotMatch(output, new RegExp(`${mockUrl}|${mockSecret}|SEED_FAILED`));
});
test("實際 package command 的 client 初始化失敗回傳安全代碼", () => {
  const result = runSeedCommand({ WISDOM_SEED_TEST_CLIENT_INIT_FAILURE: "1" }); const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1);
  assert.match(output, /SEED_CLIENT_INIT_FAILED/);
  assert.doesNotMatch(output, new RegExp(`${mockUrl}|${mockSecret}|SEED_FAILED`));
});
test("實際 package command 可安全回報 Data API table exposure 失敗", () => {
  const result = runSeedCommand({ WISDOM_SEED_TEST_RESPONSE_STATUS: "404", WISDOM_SEED_TEST_PROVIDER_CODE: "PGRST205" }); const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1);
  assert.match(output, /Knowledge phase: client_init[\s\S]*Knowledge HTTP status: 404[\s\S]*Knowledge provider code: PGRST205[\s\S]*SEED_TABLE_NOT_EXPOSED/);
  assert.doesNotMatch(output, new RegExp(`${mockUrl}|${mockSecret}|private message|details|hint`));
});
