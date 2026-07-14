type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

export function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

export function checkRateLimit(key: string, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }
  if (current.count >= MAX_REQUESTS) return { allowed: false, remaining: 0, resetAt: current.resetAt };
  current.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - current.count, resetAt: current.resetAt };
}

export function resetRateLimit() {
  buckets.clear();
}

export type RateLimitResult = ReturnType<typeof checkRateLimit> & { backend: "memory" | "supabase" };

export async function checkRateLimitForRequest(ip: string, route = "/api/analyze"): Promise<RateLimitResult> {
  const { supabaseConfig } = await import("@/lib/supabase/config");
  const config = supabaseConfig();
  const memory = () => ({ ...checkRateLimit(`${route}:${ip}`), backend: "memory" as const });
  if (!config.flags.persistentRateLimitEnabled || !config.secretKey || !process.env.RATE_LIMIT_HASH_SECRET) return memory();
  try {
    const { createHmac } = await import("node:crypto");
    const identifierHash = createHmac("sha256", process.env.RATE_LIMIT_HASH_SECRET).update(ip).digest("hex");
    const { getAdminSupabaseClient } = await import("@/lib/supabase/admin");
    const client = getAdminSupabaseClient(); if (!client) return memory();
    const { data, error } = await client.rpc("consume_rate_limit", { identifier_hash_input: identifierHash, route_name: route, limit_count: MAX_REQUESTS, window_seconds: 60 });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || typeof row.allowed !== "boolean") return memory();
    return { allowed: row.allowed, remaining: Number(row.remaining) || 0, resetAt: new Date(String(row.reset_at)).getTime(), backend: "supabase" };
  } catch { return memory(); }
}
