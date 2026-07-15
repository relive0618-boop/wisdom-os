import knowledge from "../src/lib/knowledge.json" with { type: "json" };
import cases from "../src/lib/cases.json" with { type: "json" };
import { applyConfiguration, applySeed, formatApplyResult, formatDryRun, parseSeedMode, SeedError, SeedUsageError, type SeedClient, type SeedQueryResult, type SeedTable, validateSeedData } from "./seed-supabase-content-lib";

const validation = validateSeedData({ knowledge, cases });
const testHooks = process.env.NODE_ENV === "test";
type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;
type SupabaseSeedClient = {
  from: (table: SeedTable) => {
    upsert: (rows: unknown[], options: { onConflict: string }) => { select: (columns: string) => QueryResult };
    select: (columns: string, options?: { head?: boolean }) => { in: (column: string, ids: string[]) => QueryResult; limit: (count: number) => QueryResult };
  };
};

function safePath(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string") return new URL(input).pathname;
    if (input instanceof URL) return input.pathname;
    if (typeof Request !== "undefined" && input instanceof Request) return new URL(input.url).pathname;
    const url = typeof input === "object" && input && "url" in input ? (input as { url?: unknown }).url : null;
    return typeof url === "string" ? new URL(url).pathname : null;
  } catch { return null; }
}

function testFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (process.env.WISDOM_SEED_TEST_NETWORK_FAILURE === "1") return Promise.reject(new Error());
  const path = safePath(input) ?? ""; const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
  const ids = (url.searchParams.get("id")?.match(/\((.*)\)/)?.[1]?.split(",").filter(Boolean) ?? []);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const data = method === "GET" ? ids.map((id) => ({ id, status: "published", deleted_at: null })) : [];
  const status = Number(process.env.WISDOM_SEED_TEST_RESPONSE_STATUS ?? "200");
  const providerCode = process.env.WISDOM_SEED_TEST_PROVIDER_CODE;
  if (!path.endsWith("/knowledge_entries") && !path.endsWith("/case_entries")) return Promise.resolve(new Response("[]", { status: 200 }));
  return Promise.resolve(new Response(JSON.stringify(status >= 200 && status < 300 ? data : { code: providerCode ?? "mock" }), { status, statusText: status >= 200 && status < 300 ? "OK" : "Error", headers: { "content-type": "application/json" } }));
}

async function createApplyClient(): Promise<SeedClient> {
  const { url, secret } = applyConfiguration(process.env);
  let createClient: typeof import("@supabase/supabase-js").createClient;
  try {
    if (testHooks && process.env.WISDOM_SEED_TEST_IMPORT_FAILURE === "1") throw new Error();
    ({ createClient } = await import("@supabase/supabase-js"));
  } catch { throw new SeedError("SEED_CLIENT_IMPORT_FAILED"); }
  if (testHooks && process.env.WISDOM_SEED_TEST_CLIENT_INIT_FAILURE === "1") throw new SeedError("SEED_CLIENT_INIT_FAILED");
  const responses: Array<{ status: number; statusText: string }> = [];
  const captureStatus: typeof fetch = async (input, init) => {
    const response = await (testHooks && process.env.WISDOM_SEED_TEST_FETCH === "mock" ? testFetch(input, init) : fetch(input, init));
    const pathname = safePath(input);
    if (pathname?.endsWith("/knowledge_entries") || pathname?.endsWith("/case_entries")) responses.push({ status: response.status, statusText: response.statusText });
    return response;
  };
  try {
    const client = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }, global: { fetch: captureStatus } }) as unknown as SupabaseSeedClient;
    const withStatus = async (table: SeedTable, result: PromiseLike<{ data: unknown; error: unknown }>): Promise<SeedQueryResult> => {
      const { data, error } = await result;
      return { data, error, ...responses.shift() };
    };
    return {
      probe: (table) => withStatus(table, client.from(table).select("id", { head: true }).limit(0)),
      upsert: (table, rows) => withStatus(table, client.from(table).upsert(rows, { onConflict: "id" }).select("id,status,deleted_at")),
      verify: (table, ids) => withStatus(table, client.from(table).select("id,status,deleted_at").in("id", ids)),
    };
  } catch { throw new SeedError("SEED_CLIENT_INIT_FAILED"); }
}

async function main() {
  try {
    const mode = parseSeedMode(process.argv.slice(2));
    if (mode === "dry-run") { console.log(formatDryRun(validation)); if (!validation.valid) process.exitCode = 1; return; }
    const client = await createApplyClient(); const result = await applySeed(client, validation); console.log(formatApplyResult(result)); if (!result.success) process.exitCode = 1;
  } catch (error) {
    if (error instanceof SeedUsageError) console.error("Seed usage: pnpm seed:supabase (safe dry-run) or pnpm seed:supabase:apply");
    else if (error instanceof SeedError) console.error(error.code);
    else console.error("SEED_CLIENT_INIT_FAILED");
    process.exitCode = 1;
  }
}

void main();
