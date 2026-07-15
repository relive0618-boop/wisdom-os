import { CaseSchema, KnowledgeItemSchema } from "../packages/shared/src/index";

export type SeedMode = "dry-run" | "apply";
export type SeedTable = "knowledge_entries" | "case_entries";

type SeedRow = {
  id: string;
  payload: Record<string, unknown>;
  status: "published";
  deleted_at: null;
};

export type SeedDataset = {
  knowledge: unknown;
  cases: unknown;
};

export type SeedValidation = {
  knowledgeEntries: number;
  caseEntries: number;
  uniqueIds: number;
  crossTableIdCollisions: number;
  duplicateIds: number;
  invalidEntries: number;
  valid: boolean;
};

export type SeedTableResult = {
  table: SeedTable;
  expected: number;
  confirmed: number;
  success: boolean;
  errorCode: string | null;
};

export type SeedApplyResult = {
  success: boolean;
  knowledge: SeedTableResult;
  cases: SeedTableResult;
};

export type SeedQueryResult = {
  data: unknown;
  error: unknown;
  status?: number;
  statusText?: string;
};

export type SeedClient = {
  upsert: (table: SeedTable, rows: SeedRow[]) => Promise<SeedQueryResult>;
  verify: (table: SeedTable, ids: string[]) => Promise<SeedQueryResult>;
};

export class SeedUsageError extends Error {
  constructor() {
    super("SEED_USAGE_REQUIRED");
  }
}

export function parseSeedMode(args: string[]): SeedMode {
  if (args.length !== 1 || (args[0] !== "--dry-run" && args[0] !== "--apply")) {
    throw new SeedUsageError();
  }
  return args[0] === "--apply" ? "apply" : "dry-run";
}

export function applyConfiguration(env: Record<string, string | undefined>): { url: string; secret: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("SUPABASE_SEED_URL_MISSING");
  if (!secret) throw new Error("SUPABASE_SEED_SECRET_MISSING");
  return { url, secret };
}

function isSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return false;
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isSerializable(item, seen));
  return Object.values(value as Record<string, unknown>).every((item) => isSerializable(item, seen));
}

function validateCollection(value: unknown, schema: typeof KnowledgeItemSchema | typeof CaseSchema) {
  if (!Array.isArray(value)) return { count: 0, duplicates: 0, invalid: 1, ids: [] as string[], rows: [] as SeedRow[] };

  const ids = new Set<string>();
  let duplicates = 0;
  let invalid = 0;
  const validIds: string[] = [];
  const rows: SeedRow[] = [];
  for (const entry of value) {
    const parsed = schema.safeParse(entry);
    const id = parsed.success ? parsed.data.id : null;
    if (!parsed.success || !id || !id.trim() || !isSerializable(entry)) {
      invalid += 1;
      continue;
    }
    if (ids.has(id)) {
      duplicates += 1;
      continue;
    }
    ids.add(id);
    validIds.push(id);
    rows.push({ id, payload: parsed.data as Record<string, unknown>, status: "published", deleted_at: null });
  }
  return { count: value.length, duplicates, invalid, ids: validIds, rows };
}

export function validateSeedData(dataset: SeedDataset): SeedValidation & { knowledgeRows: SeedRow[]; caseRows: SeedRow[] } {
  const knowledge = validateCollection(dataset.knowledge, KnowledgeItemSchema);
  const cases = validateCollection(dataset.cases, CaseSchema);
  const knowledgeIds = new Set(knowledge.ids);
  const crossTableIdCollisions = cases.ids.filter((id) => knowledgeIds.has(id)).length;
  const duplicateIds = knowledge.duplicates + cases.duplicates;
  const invalidEntries = knowledge.invalid + cases.invalid;
  return {
    knowledgeEntries: knowledge.count,
    caseEntries: cases.count,
    uniqueIds: new Set([...knowledge.ids, ...cases.ids]).size,
    crossTableIdCollisions,
    duplicateIds,
    invalidEntries,
    valid: duplicateIds === 0 && invalidEntries === 0,
    knowledgeRows: knowledge.rows,
    caseRows: cases.rows,
  };
}

export function formatDryRun(validation: SeedValidation): string {
  return [
    `Seed dry-run: ${validation.valid ? "SAFE" : "FAILED"}`,
    `Knowledge entries: ${validation.knowledgeEntries}`,
    `Case entries: ${validation.caseEntries}`,
    `Unique IDs: ${validation.uniqueIds}`,
    `Cross-table ID collisions: ${validation.crossTableIdCollisions} (allowed: separate tables)`,
    `Duplicate IDs: ${validation.duplicateIds}`,
    `Invalid entries: ${validation.invalidEntries}`,
    "Remote writes: 0",
  ].join("\n");
}

function resultIsSuccessful(result: SeedQueryResult): boolean {
  const validStatusText = result.statusText === undefined || typeof result.statusText === "string";
  return !result.error && validStatusText && (result.status === undefined || (result.status >= 200 && result.status < 300));
}

function rowsArePublished(data: unknown, expectedIds: string[]): boolean {
  if (!Array.isArray(data) || data.length !== expectedIds.length) return false;
  const expected = new Set(expectedIds);
  return data.every((row) => {
    if (!row || typeof row !== "object") return false;
    const value = row as { id?: unknown; status?: unknown; deleted_at?: unknown };
    return typeof value.id === "string" && expected.has(value.id) && value.status === "published" && value.deleted_at === null;
  });
}

function chunks<T>(items: T[], size = 50): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

async function applyTable(client: SeedClient, table: SeedTable, rows: SeedRow[]): Promise<SeedTableResult> {
  const expected = rows.length;
  try {
    const upsert = await client.upsert(table, rows);
    if (!resultIsSuccessful(upsert)) return { table, expected, confirmed: 0, success: false, errorCode: "SEED_UPSERT_FAILED" };

    let confirmed = 0;
    for (const ids of chunks(rows.map((row) => row.id))) {
      const verification = await client.verify(table, ids);
      if (!resultIsSuccessful(verification) || !rowsArePublished(verification.data, ids)) {
        return { table, expected, confirmed, success: false, errorCode: "SEED_VERIFICATION_FAILED" };
      }
      confirmed += ids.length;
    }
    return { table, expected, confirmed, success: true, errorCode: null };
  } catch {
    return { table, expected, confirmed: 0, success: false, errorCode: "SEED_NETWORK_FAILED" };
  }
}

export async function applySeed(client: SeedClient, validation: ReturnType<typeof validateSeedData>): Promise<SeedApplyResult> {
  if (!validation.valid) {
    return {
      success: false,
      knowledge: { table: "knowledge_entries", expected: validation.knowledgeEntries, confirmed: 0, success: false, errorCode: "SEED_VALIDATION_FAILED" },
      cases: { table: "case_entries", expected: validation.caseEntries, confirmed: 0, success: false, errorCode: "SEED_VALIDATION_FAILED" },
    };
  }
  const knowledge = await applyTable(client, "knowledge_entries", validation.knowledgeRows);
  if (!knowledge.success) {
    return {
      success: false,
      knowledge,
      cases: { table: "case_entries", expected: validation.caseEntries, confirmed: 0, success: false, errorCode: "SEED_SKIPPED_AFTER_FAILURE" },
    };
  }
  const cases = await applyTable(client, "case_entries", validation.caseRows);
  return { success: knowledge.success && cases.success, knowledge, cases };
}

export function formatApplyResult(result: SeedApplyResult): string {
  const state = result.success ? "SAFE" : "FAILED";
  return [
    `Seed apply: ${state}`,
    `Knowledge: ${result.knowledge.success ? "SUCCESS" : "FAILED"} (${result.knowledge.confirmed}/${result.knowledge.expected})`,
    `Cases: ${result.cases.success ? "SUCCESS" : "FAILED"} (${result.cases.confirmed}/${result.cases.expected})`,
    `Knowledge error: ${result.knowledge.errorCode ?? "NONE"}`,
    `Cases error: ${result.cases.errorCode ?? "NONE"}`,
    "Writes are idempotent upserts and can be safely re-run after a partial failure.",
  ].join("\n");
}
