import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { GET as healthGET } from "@/app/api/health/route";
import { checkRateLimit, checkRateLimitForRequest, getClientIp, hashRateLimitIdentifier, isAllowedRateLimitRoute, parsePersistentRateLimitRow, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS, resetRateLimit } from "./rateLimit";
import { persistentRateLimitReady } from "./supabase/serverConfig";

const hardenedMigration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260720100901_wisdom_os_rate_limit_hardening.sql"), "utf8");
const legacyMigration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260715_wisdom_os_v04.sql"), "utf8");
const adminAuditMigration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260719_wisdom_os_admin_audit_hardening.sql"), "utf8");
const verificationSql = readFileSync(resolve(process.cwd(), "../../docs/v0.4-rate-limit-verification.sql"), "utf8");
const baseConfig = { url: "https://project.example.test", publishableKey: "publishable", secretKey: "server-only", flags: { persistentRateLimitEnabled: true } };
const secret = "x".repeat(32);
const now = 1_700_000_000_000;

function request(headers: Record<string, string>) {
  return new Request("https://app.example.test/api/analyze", { headers });
}

function validRow(overrides: Record<string, unknown> = {}) {
  return [{ allowed: true, remaining: 9, reset_at: new Date(now + RATE_LIMIT_WINDOW_MS).toISOString(), ...overrides }];
}

test("flag false 時 persistent readiness 為 memory", () => assert.equal(persistentRateLimitReady({ ...baseConfig, flags: { persistentRateLimitEnabled: false } }, secret), false));
test("缺少 server secret 時 persistent readiness 為 memory", () => assert.equal(persistentRateLimitReady({ ...baseConfig, secretKey: null }, secret), false));
test("缺少 hash secret 時 persistent readiness 為 memory", () => assert.equal(persistentRateLimitReady(baseConfig, null), false));
test("過短 hash secret 時 persistent readiness 為 memory", () => assert.equal(persistentRateLimitReady(baseConfig, "short"), false));
test("完整 server-only 配置時 persistent readiness 為 supabase", () => assert.equal(persistentRateLimitReady(baseConfig, secret), true));
test("不安全 Supabase URL 不會通過 readiness", () => { assert.equal(persistentRateLimitReady({ ...baseConfig, url: "https://user:pass@example.test" }, secret), false); assert.equal(persistentRateLimitReady({ ...baseConfig, url: "http://project.example.test" }, secret), false); });

test("優先採用 Vercel forwarded IP", () => assert.equal(getClientIp(request({ "x-vercel-forwarded-for": "203.0.113.8", "x-forwarded-for": "198.51.100.8" })), "203.0.113.8"));
test("合法 x-forwarded-for 可使用", () => assert.equal(getClientIp(request({ "x-forwarded-for": "198.51.100.8" })), "198.51.100.8"));
test("forwarded list 僅使用第一個地址", () => assert.equal(getClientIp(request({ "x-forwarded-for": "198.51.100.8, 203.0.113.8" })), "198.51.100.8"));
test("合法 bracket IPv6 可使用", () => assert.equal(getClientIp(request({ "x-forwarded-for": "[2001:db8::8]" })), "2001:db8::8"));
test("非法 forwarded 值使用固定 unknown", () => assert.equal(getClientIp(request({ "x-forwarded-for": "not-an-ip" })), "unknown"));
test("超長 forwarded 值使用固定 unknown", () => assert.equal(getClientIp(request({ "x-forwarded-for": "a".repeat(513) })), "unknown"));
test("非法高優先 header 不會阻擋下一個合法 header", () => assert.equal(getClientIp(request({ "x-vercel-forwarded-for": "invalid", "x-forwarded-for": "198.51.100.8" })), "198.51.100.8"));

test("相同 identifier 與 secret 產生固定 64 hex HMAC", () => {
  const first = hashRateLimitIdentifier("198.51.100.8", "/api/analyze", secret);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, hashRateLimitIdentifier("198.51.100.8", "/api/analyze", secret));
});
test("不同 identifier 產生不同 HMAC", () => assert.notEqual(hashRateLimitIdentifier("198.51.100.8", "/api/analyze", secret), hashRateLimitIdentifier("198.51.100.9", "/api/analyze", secret)));
test("不同 secret 產生不同 HMAC", () => assert.notEqual(hashRateLimitIdentifier("198.51.100.8", "/api/analyze", secret), hashRateLimitIdentifier("198.51.100.8", "/api/analyze", "y".repeat(32))));
test("只允許正式 analyze route", () => { assert.equal(isAllowedRateLimitRoute("/api/analyze"), true); assert.equal(isAllowedRateLimitRoute("/api/unknown"), false); });

test("合法 RPC row 使用 Supabase backend 且不傳原始 IP", async () => {
  let capturedHash = "";
  let sentRawIdentifier = true;
  const result = await checkRateLimitForRequest("198.51.100.8", "/api/analyze", {
    now: () => now,
    config: { persistentRateLimitReady: true },
    secret,
    createClient: () => ({ rpc: async (_name, value) => { capturedHash = value.identifier_hash_input; sentRawIdentifier = JSON.stringify(value).includes("198.51.100.8"); return { data: validRow(), error: null }; } }),
  });
  assert.equal(result.backend, "supabase");
  assert.match(capturedHash, /^[a-f0-9]{64}$/);
  assert.equal(sentRawIdentifier, false);
});
test("allowed 非 boolean 時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-a", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => ({ data: validRow({ allowed: "yes" }), error: null }) }) })).backend, "memory"));
test("remaining 非數字時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-b", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => ({ data: validRow({ remaining: "9" }), error: null }) }) })).backend, "memory"));
test("negative remaining 時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-c", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => ({ data: validRow({ remaining: -1 }), error: null }) }) })).backend, "memory"));
test("超出限制的 remaining 時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-d", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => ({ data: validRow({ remaining: RATE_LIMIT_MAX_REQUESTS + 1 }), error: null }) }) })).backend, "memory"));
test("無效 reset_at 時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-e", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => ({ data: validRow({ reset_at: "invalid" }), error: null }) }) })).backend, "memory"));
test("RPC error 時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-f", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => ({ data: null, error: {} }) }) })).backend, "memory"));
test("client 建立失敗時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-g", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => null })).backend, "memory"));
test("RPC throw 時回退 memory", async () => assert.equal((await checkRateLimitForRequest("ip-h", "/api/analyze", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => { throw new Error("network"); } }) })).backend, "memory"));
test("未知 route 拒絕且不呼叫資料庫", async () => {
  let called = false;
  const result = await checkRateLimitForRequest("ip-i", "/api/unknown", { now: () => now, config: { persistentRateLimitReady: true }, secret, createClient: () => ({ rpc: async () => { called = true; return { data: validRow(), error: null }; } }) });
  assert.equal(result.allowed, false); assert.equal(called, false);
});
test("memory fallback 仍在第 11 次拒絕", async () => {
  resetRateLimit();
  const dependency = { now: () => now, config: { persistentRateLimitReady: false }, secret: null };
  for (let index = 0; index < 10; index += 1) assert.equal((await checkRateLimitForRequest("fallback", "/api/analyze", dependency)).allowed, true);
  assert.equal((await checkRateLimitForRequest("fallback", "/api/analyze", dependency)).allowed, false);
  resetRateLimit();
});
test("memory limiter 新視窗後恢復", () => { resetRateLimit(); for (let index = 0; index < 10; index += 1) checkRateLimit("window", now); assert.equal(checkRateLimit("window", now + RATE_LIMIT_WINDOW_MS + 1).allowed, true); resetRateLimit(); });
test("不同 identifier 的記憶體 bucket 彼此獨立", () => {
  resetRateLimit();
  for (let index = 0; index < 10; index += 1) assert.equal(checkRateLimit("first", now).allowed, true);
  assert.equal(checkRateLimit("first", now).allowed, false);
  assert.equal(checkRateLimit("second", now).allowed, true);
  resetRateLimit();
});

test("合法 persistent RPC row 有完整安全欄位", () => assert.deepEqual(parsePersistentRateLimitRow(validRow(), now), { allowed: true, remaining: 9, resetAt: now + RATE_LIMIT_WINDOW_MS }));
test("RPC data 非單一 row 時拒絕", () => assert.equal(parsePersistentRateLimitRow([], now), null));
test("RPC resetAt 超出合理範圍時拒絕", () => assert.equal(parsePersistentRateLimitRow(validRow({ reset_at: new Date(now + RATE_LIMIT_WINDOW_MS * 3).toISOString() }), now), null));

test("新 migration 沒有修改舊 migration 的舊 bucket 主鍵設計", () => assert.match(legacyMigration, /primary key\(identifier_hash, route, window_start\)/));
test("兩份已套用 migration 保持原始內容", () => {
  assert.equal(createHash("sha256").update(legacyMigration).digest("hex"), "c10c8d6506dc19250ca0f722eb89a94cc5a7a6bd01cb5f205857d52113bf7b23");
  assert.equal(createHash("sha256").update(adminAuditMigration).digest("hex"), "f49ddcf4fd0f9a5f4db36534397fe6056d4348abc5a6479309a9e392b06e2d92");
});
test("新 migration 以 identifier 與 route 單行主鍵提供容量上界", () => assert.match(hardenedMigration, /primary key \(identifier_hash, route\)/));
test("新 migration 僅允許 64 位小寫 hex HMAC", () => assert.match(hardenedMigration, /identifier_hash ~ '\^\[0-9a-f\]\{64\}\$'/));
test("新 migration 的 route 僅允許 analyze", () => assert.match(hardenedMigration, /route = '\/api\/analyze'/));
test("新 migration 固定正式 limit 與 window", () => { assert.match(hardenedMigration, /limit_count <> 10/); assert.match(hardenedMigration, /window_seconds <> 60/); });
test("新 migration 的 RPC 僅 service role 可執行", () => { assert.match(hardenedMigration, /revoke all on function public\.consume_rate_limit[\s\S]*from public, anon, authenticated, service_role/); assert.match(hardenedMigration, /grant execute on function public\.consume_rate_limit[\s\S]*to service_role/); });
test("新 migration 固定 SECURITY DEFINER search path", () => assert.match(hardenedMigration, /security definer\s+set search_path = pg_catalog, pg_temp/i));
test("新 migration 原子 upsert 而且沒有 raw IP 欄位", () => { assert.match(hardenedMigration, /on conflict \(identifier_hash, route\) do update/i); assert.doesNotMatch(hardenedMigration, /raw_ip|ip_address|client_ip/i); });
test("新 migration 保持 browser 無 rate-limit table grant", () => assert.doesNotMatch(hardenedMigration, /grant [^;]*rate_limit_buckets[^;]*to (?:anon|authenticated)/i));
test("新 migration 啟用 pg_cron 並只建立固定名稱的清理 job", () => {
  assert.match(hardenedMigration, /create extension if not exists pg_cron/i);
  assert.match(hardenedMigration, /cron\.schedule\(\s*'wisdom-os-rate-limit-prune'/i);
  assert.doesNotMatch(hardenedMigration, /cron\.schedule\([\s\S]*wisdom-os-rate-limit-prune[\s\S]*cron\.schedule\(/i);
});
test("新 migration 的清理 job 每五分鐘執行唯一允許的 command", () => {
  assert.match(hardenedMigration, /'\*\/5 \* \* \* \*'/);
  assert.match(hardenedMigration, /'select public\.prune_wisdom_rate_limit_buckets\(\);'/i);
});
test("新 migration 只會移除同名舊 cron job", () => {
  assert.match(hardenedMigration, /from cron\.job\s+where jobname = 'wisdom-os-rate-limit-prune'/i);
  assert.match(hardenedMigration, /perform cron\.unschedule\(existing_job_id\)/i);
});
test("清理函式沒有參數且只刪除過期 rate-limit buckets", () => {
  const cleanup = hardenedMigration.slice(hardenedMigration.indexOf("create or replace function public.prune_wisdom_rate_limit_buckets"), hardenedMigration.indexOf("revoke all on function public.prune_wisdom_rate_limit_buckets"));
  assert.match(cleanup, /public\.prune_wisdom_rate_limit_buckets\(\)\s*returns bigint/i);
  assert.match(cleanup, /delete from public\.rate_limit_buckets\s+where updated_at < now\(\) - interval '15 minutes'/i);
  assert.doesNotMatch(cleanup, /user_reports|user_pdca_cycles|knowledge_entries|case_entries|profiles|admin_audit_logs/i);
});
test("清理函式固定 SECURITY DEFINER search path 並且沒有直接 execute grant", () => {
  const cleanup = hardenedMigration.slice(hardenedMigration.indexOf("create or replace function public.prune_wisdom_rate_limit_buckets"));
  assert.match(cleanup, /security definer\s+set search_path = pg_catalog, pg_temp/i);
  assert.match(cleanup, /revoke all on function public\.prune_wisdom_rate_limit_buckets\(\) from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(cleanup, /grant execute on function public\.prune_wisdom_rate_limit_buckets/i);
});
test("migration 在收斂時清除十五分鐘前的舊 bucket", () => assert.match(hardenedMigration, /delete from public\.rate_limit_buckets\s+where updated_at < now\(\) - interval '15 minutes'/i));
test("migration 在安裝 range constraint 前將舊計數壓到 11", () => {
  assert.match(hardenedMigration, /update public\.rate_limit_buckets\s+set request_count = 11\s+where request_count > 11/i);
  assert.match(hardenedMigration, /check \(request_count between 0 and 11\)/i);
});
test("atomic RPC 對第十二次以上請求把資料列計數封頂為 11", () => {
  assert.match(hardenedMigration, /request_count = least\([\s\S]*public\.rate_limit_buckets\.request_count \+ 1[\s\S]*11[\s\S]*\)/i);
  assert.match(hardenedMigration, /select current_count <= limit_count/i);
});
test("atomic RPC 新視窗仍從一開始並以 10 次作為對外允許上限", () => {
  assert.match(hardenedMigration, /else 1\s+end,\s+11/i);
  assert.match(hardenedMigration, /limit_count <> 10/i);
});
test("migration 為 TTL 清理建立 updated_at index", () => assert.match(hardenedMigration, /create index if not exists rate_limit_buckets_updated_at_idx\s+on public\.rate_limit_buckets\(updated_at\)/i));
test("migration 沒有對 cron schema 授予 browser 或 service-role 權限", () => assert.doesNotMatch(hardenedMigration, /(?:grant|revoke) [^;]* on (?:schema )?cron/i));
test("migration 不會修改其他 business table", () => assert.doesNotMatch(hardenedMigration, /(?:insert into|update|delete from|alter table|lock table) public\.(?:user_reports|user_pdca_cycles|knowledge_entries|case_entries|profiles|admin_audit_logs)/i));
test("只讀 verification SQL 檢查 cron、清理 function、TTL index 與 bucket 健康度", () => {
  assert.match(verificationSql, /from cron\.job\s+where jobname = 'wisdom-os-rate-limit-prune'/i);
  assert.match(verificationSql, /prune_wisdom_rate_limit_buckets/i);
  assert.match(verificationSql, /rate_limit_buckets_updated_at_idx/i);
  assert.match(verificationSql, /request_count > 11/i);
  assert.match(verificationSql, /updated_at < now\(\) - interval '20 minutes'/i);
});
test("只讀 verification SQL 不列出 hash 或 cron job 清單，也不包含寫入語句", () => {
  assert.doesNotMatch(verificationSql, /identifier_hash\s+as\s+/i);
  assert.doesNotMatch(verificationSql, /select\s+\*\s+from\s+cron\.job/i);
  assert.doesNotMatch(verificationSql, /\b(?:insert|update|delete|alter|drop|truncate|grant|revoke)\b/i);
});
test("只讀 verification SQL 檢查 consume 與 cleanup 的最小 execute 權限", () => {
  assert.match(verificationSql, /anon_consume_execute/i);
  assert.match(verificationSql, /service_role_consume_execute/i);
  assert.match(verificationSql, /anon_prune_execute/i);
  assert.match(verificationSql, /service_role_prune_execute/i);
});

test("health 在不完整 persistent 配置時回報 memory 且不洩漏 secrets", async () => {
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, server: process.env.SUPABASE_SECRET_KEY, enabled: process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED, hash: process.env.RATE_LIMIT_HASH_SECRET };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable";
  process.env.SUPABASE_SECRET_KEY = "server-only-value";
  process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED = "true";
  process.env.RATE_LIMIT_HASH_SECRET = "short";
  try {
    const payload = await (await healthGET()).json();
    assert.equal(payload.cloud.rateLimitBackend, "memory");
    assert.equal(payload.cloud.persistentRateLimitEnabled, false);
    assert.equal(JSON.stringify(payload).includes("server-only-value"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === "url" ? "NEXT_PUBLIC_SUPABASE_URL" : key === "key" ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : key === "server" ? "SUPABASE_SECRET_KEY" : key === "enabled" ? "WISDOM_PERSISTENT_RATE_LIMIT_ENABLED" : "RATE_LIMIT_HASH_SECRET";
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
  }
});

test("health 僅在完整 server-only 配置時回報 supabase 且 databaseReachable 保持 null", async () => {
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, server: process.env.SUPABASE_SECRET_KEY, enabled: process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED, hash: process.env.RATE_LIMIT_HASH_SECRET };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable";
  process.env.SUPABASE_SECRET_KEY = "server-only-value";
  process.env.WISDOM_PERSISTENT_RATE_LIMIT_ENABLED = "true";
  process.env.RATE_LIMIT_HASH_SECRET = "x".repeat(32);
  try {
    const payload = await (await healthGET()).json();
    assert.equal(payload.cloud.rateLimitBackend, "supabase");
    assert.equal(payload.cloud.persistentRateLimitEnabled, true);
    assert.equal(payload.cloud.databaseReachable, null);
    assert.equal(JSON.stringify(payload).includes("server-only-value"), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === "url" ? "NEXT_PUBLIC_SUPABASE_URL" : key === "key" ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : key === "server" ? "SUPABASE_SECRET_KEY" : key === "enabled" ? "WISDOM_PERSISTENT_RATE_LIMIT_ENABLED" : "RATE_LIMIT_HASH_SECRET";
      if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
    }
  }
});
