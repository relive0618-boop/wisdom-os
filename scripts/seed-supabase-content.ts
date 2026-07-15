import knowledge from "../apps/web/src/lib/knowledge.json" with { type: "json" };
import cases from "../apps/web/src/lib/cases.json" with { type: "json" };
import {
  applyConfiguration,
  applySeed,
  formatApplyResult,
  formatDryRun,
  parseSeedMode,
  SeedUsageError,
  type SeedClient,
  type SeedQueryResult,
  type SeedTable,
  validateSeedData,
} from "./seed-supabase-content-lib";

const validation = validateSeedData({ knowledge, cases });

function usage() {
  console.error("Seed usage: pnpm seed:supabase (safe dry-run) or pnpm seed:supabase:apply");
}

async function createApplyClient(): Promise<SeedClient> {
  const { url, secret } = applyConfiguration(process.env);
  const { createClient } = await import("@supabase/supabase-js");
  const status = new Map<SeedTable, { status: number; statusText: string }>();
  const captureStatus: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const pathname = new URL(typeof input === "string" ? input : input.url).pathname;
    const table = pathname.endsWith("/knowledge_entries") ? "knowledge_entries" : pathname.endsWith("/case_entries") ? "case_entries" : null;
    if (table) status.set(table, { status: response.status, statusText: response.statusText });
    return response;
  };
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: captureStatus },
  });
  const withStatus = (table: SeedTable, result: PromiseLike<{ data: unknown; error: unknown }>): Promise<SeedQueryResult> =>
    result.then(({ data, error }) => ({ data, error, ...status.get(table) }));
  return {
    upsert: (table, rows) => withStatus(table, client.from(table).upsert(rows, { onConflict: "id" }).select("id,status,deleted_at")),
    verify: (table, ids) => withStatus(table, client.from(table).select("id,status,deleted_at").in("id", ids)),
  };
}

async function main() {
  try {
    const mode = parseSeedMode(process.argv.slice(2));
    if (mode === "dry-run") {
      console.log(formatDryRun(validation));
      if (!validation.valid) process.exitCode = 1;
    } else {
      const client = await createApplyClient();
      const result = await applySeed(client, validation);
      console.log(formatApplyResult(result));
      if (!result.success) process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof SeedUsageError) usage();
    else if (error instanceof Error && ["SUPABASE_SEED_URL_MISSING", "SUPABASE_SEED_SECRET_MISSING"].includes(error.message)) console.error(error.message);
    else console.error("SEED_FAILED");
    process.exitCode = 1;
  }
}

void main();
