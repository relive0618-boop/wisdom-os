import { createHmac } from "node:crypto";
import { isIP } from "node:net";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_ROUTES = ["/api/analyze"] as const;
const MAX_FORWARDED_HEADER_LENGTH = 512;

type PersistentRateLimitRow = { allowed: unknown; remaining: unknown; reset_at: unknown };
type PersistentRateLimitClient = { rpc: (name: "consume_rate_limit", input: { identifier_hash_input: string; route_name: string; limit_count: number; window_seconds: number }) => PromiseLike<{ data: unknown; error: unknown }> };
type RuntimeConfig = { persistentRateLimitReady: boolean };
export type RateLimitDependencies = {
  now?: () => number;
  config?: RuntimeConfig;
  secret?: string | null;
  createClient?: () => PersistentRateLimitClient | null;
};

function validIp(value: string | null) {
  if (!value || value.length > MAX_FORWARDED_HEADER_LENGTH) return null;
  const first = value.split(",", 1)[0]?.trim() || "";
  const unbracketed = /^\[([^\[\]]+)\]$/.exec(first)?.[1] ?? first;
  return isIP(unbracketed) ? unbracketed : null;
}

export function getClientIp(request: Request) {
  return validIp(request.headers.get("x-vercel-forwarded-for"))
    || validIp(request.headers.get("x-forwarded-for"))
    || validIp(request.headers.get("x-real-ip"))
    || "unknown";
}

export function checkRateLimit(key: string, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return { allowed: false, remaining: 0, resetAt: current.resetAt };
  current.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - current.count, resetAt: current.resetAt };
}

export function resetRateLimit() {
  buckets.clear();
}

export type RateLimitResult = ReturnType<typeof checkRateLimit> & { backend: "memory" | "supabase" };

export function isAllowedRateLimitRoute(route: string): route is (typeof RATE_LIMIT_ROUTES)[number] {
  return (RATE_LIMIT_ROUTES as readonly string[]).includes(route);
}

export function hashRateLimitIdentifier(ip: string, route: string, secret: string) {
  return createHmac("sha256", secret).update(`${route}\u0000${ip}`).digest("hex");
}

export function parsePersistentRateLimitRow(value: unknown, now = Date.now()): Omit<RateLimitResult, "backend"> | null {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") return null;
  const row = value[0] as PersistentRateLimitRow;
  const remaining = row.remaining;
  if (typeof row.allowed !== "boolean" || typeof remaining !== "number" || !Number.isInteger(remaining) || remaining < 0 || remaining > RATE_LIMIT_MAX_REQUESTS) return null;
  const resetAt = typeof row.reset_at === "string" ? new Date(row.reset_at).getTime() : Number.NaN;
  if (!Number.isFinite(resetAt) || resetAt <= now - 5_000 || resetAt > now + RATE_LIMIT_WINDOW_MS * 2) return null;
  return { allowed: row.allowed, remaining, resetAt };
}

function invalidRouteResult(now: number): RateLimitResult {
  return { allowed: false, remaining: 0, resetAt: now + RATE_LIMIT_WINDOW_MS, backend: "memory" };
}

export async function checkRateLimitForRequest(ip: string, route = "/api/analyze", dependencies: RateLimitDependencies = {}): Promise<RateLimitResult> {
  const now = dependencies.now?.() ?? Date.now();
  if (!isAllowedRateLimitRoute(route)) return invalidRouteResult(now);
  const memory = () => ({ ...checkRateLimit(`${route}:${ip}`, now), backend: "memory" as const });
  let config = dependencies.config;
  let secret = dependencies.secret;
  if (!config || secret === undefined) {
    const { persistentRateLimitReady, serverSupabaseConfig } = await import("@/lib/supabase/serverConfig");
    const serverConfig = serverSupabaseConfig();
    config = { persistentRateLimitReady: persistentRateLimitReady(serverConfig) };
    secret = process.env.RATE_LIMIT_HASH_SECRET?.trim() || null;
  }
  if (!config.persistentRateLimitReady || !secret || secret.length < 32) return memory();
  try {
    const identifierHash = hashRateLimitIdentifier(ip, route, secret);
    let client = dependencies.createClient?.();
    if (!client) {
      const { getAdminSupabaseClient } = await import("@/lib/supabase/admin");
      client = getAdminSupabaseClient();
    }
    if (!client) return memory();
    const { data, error } = await client.rpc("consume_rate_limit", { identifier_hash_input: identifierHash, route_name: route, limit_count: RATE_LIMIT_MAX_REQUESTS, window_seconds: RATE_LIMIT_WINDOW_MS / 1000 });
    const row = error ? null : parsePersistentRateLimitRow(data, now);
    return row ? { ...row, backend: "supabase" } : memory();
  } catch { return memory(); }
}
