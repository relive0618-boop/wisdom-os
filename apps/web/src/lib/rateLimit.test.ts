import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GET as healthGET } from "@/app/api/health/route";
import { checkRateLimit, checkRateLimitForRequest, getClientIp, hashRateLimitIdentifier, isAllowedRateLimitRoute, parsePersistentRateLimitRow, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS, resetRateLimit } from "./rateLimit";
import { persistentRateLimitReady } from "./supabase/serverConfig";

const hardenedMigration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260720100901_wisdom_os_rate_limit_hardening.sql"), "utf8");
const legacyMigration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260715_wisdom_os_v04.sql"), "utf8");
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

test("合法 persistent RPC row 有完整安全欄位", () => assert.deepEqual(parsePersistentRateLimitRow(validRow(), now), { allowed: true, remaining: 9, resetAt: now + RATE_LIMIT_WINDOW_MS }));
test("RPC data 非單一 row 時拒絕", () => assert.equal(parsePersistentRateLimitRow([], now), null));
test("RPC resetAt 超出合理範圍時拒絕", () => assert.equal(parsePersistentRateLimitRow(validRow({ reset_at: new Date(now + RATE_LIMIT_WINDOW_MS * 3).toISOString() }), now), null));

test("新 migration 沒有修改舊 migration 的舊 bucket 主鍵設計", () => assert.match(legacyMigration, /primary key\(identifier_hash, route, window_start\)/));
test("新 migration 以 identifier 與 route 單行主鍵提供容量上界", () => assert.match(hardenedMigration, /primary key \(identifier_hash, route\)/));
test("新 migration 僅允許 64 位小寫 hex HMAC", () => assert.match(hardenedMigration, /identifier_hash ~ '\^\[0-9a-f\]\{64\}\$'/));
test("新 migration 的 route 僅允許 analyze", () => assert.match(hardenedMigration, /route = '\/api\/analyze'/));
test("新 migration 固定正式 limit 與 window", () => { assert.match(hardenedMigration, /limit_count <> 10/); assert.match(hardenedMigration, /window_seconds <> 60/); });
test("新 migration 的 RPC 僅 service role 可執行", () => { assert.match(hardenedMigration, /revoke all on function public\.consume_rate_limit[\s\S]*from public, anon, authenticated, service_role/); assert.match(hardenedMigration, /grant execute on function public\.consume_rate_limit[\s\S]*to service_role/); });
test("新 migration 固定 SECURITY DEFINER search path", () => assert.match(hardenedMigration, /security definer\s+set search_path = pg_catalog, pg_temp/i));
test("新 migration 原子 upsert 而且沒有 raw IP 欄位", () => { assert.match(hardenedMigration, /on conflict \(identifier_hash, route\) do update/i); assert.doesNotMatch(hardenedMigration, /raw_ip|ip_address|client_ip/i); });
test("新 migration 保持 browser 無 rate-limit table grant", () => assert.doesNotMatch(hardenedMigration, /grant [^;]*rate_limit_buckets[^;]*to (?:anon|authenticated)/i));

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
