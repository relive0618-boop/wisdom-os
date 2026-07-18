import { CaseSchema, KnowledgeItemSchema } from "@wisdom/shared";

export type SeedMode = "dry-run" | "apply";
export type SeedTable = "knowledge_entries" | "case_entries";
export const SeedErrorCodes = [
  "SEED_CLIENT_IMPORT_FAILED", "SEED_CLIENT_INIT_FAILED", "SEED_URL_INVALID", "SEED_SECRET_FORMAT_INVALID",
  "SEED_NETWORK_FAILED", "SEED_UPSERT_FAILED", "SEED_VERIFICATION_FAILED", "SEED_VALIDATION_FAILED", "SEED_SKIPPED_AFTER_FAILURE",
  "SEED_AUTH_FAILED", "SEED_PERMISSION_DENIED", "SEED_TABLE_NOT_EXPOSED", "SEED_CONFLICT_FAILED", "SEED_REQUEST_INVALID", "SEED_PROVIDER_UNAVAILABLE",
  "SEED_CONTENT_DRIFT", "SEED_ADMIN_MANAGED_CONFLICT", "SEED_STATUS_CONFLICT", "SEED_DELETED_CONFLICT",
] as const;
export type SeedErrorCode = (typeof SeedErrorCodes)[number];
export type SeedPhase = "client_init" | "preflight" | "upsert" | "verification";

export type SeedRow = {
  id: string;
  payload: Record<string, unknown>;
  status: "published";
  deleted_at: null;
  created_by: null;
  updated_by: null;
};
type SeedRemoteRow = {
  id?: unknown;
  payload?: unknown;
  status?: unknown;
  deleted_at?: unknown;
  created_by?: unknown;
  updated_by?: unknown;
};
export type SeedDataset = { knowledge: unknown; cases: unknown };
export type SeedValidation = { knowledgeEntries: number; caseEntries: number; uniqueIds: number; crossTableIdCollisions: number; duplicateIds: number; invalidEntries: number; valid: boolean };
export type SeedPreflight = { missing: number; identical: number; drifted: number; adminManaged: number; statusConflict: number; deleted: number };
export type SeedTableResult = {
  table: SeedTable;
  expected: number;
  confirmed: number;
  rowsInserted: number;
  preflight: SeedPreflight;
  success: boolean;
  errorCode: SeedErrorCode | null;
  httpStatus: number | null;
  providerCode: string | null;
  phase: SeedPhase;
};
export type SeedApplyResult = { success: boolean; knowledge: SeedTableResult; cases: SeedTableResult; upsertCallsAttempted: number; rowsInserted: number; remoteRowsConfirmed: number };
export type SeedQueryResult = { data: unknown; error: unknown; status: number; statusText: string };
export type SeedClient = {
  probe: (table: SeedTable) => Promise<SeedQueryResult>;
  inspect: (table: SeedTable, ids: string[]) => Promise<SeedQueryResult>;
  upsert: (table: SeedTable, rows: SeedRow[]) => Promise<SeedQueryResult>;
  verify: (table: SeedTable, ids: string[]) => Promise<SeedQueryResult>;
};

export class SeedUsageError extends Error { constructor() { super("SEED_USAGE_REQUIRED"); } }
export class SeedError extends Error { constructor(readonly code: SeedErrorCode) { super(code); } }

const emptyPreflight = (): SeedPreflight => ({ missing: 0, identical: 0, drifted: 0, adminManaged: 0, statusConflict: 0, deleted: 0 });

export function parseSeedMode(args: string[]): SeedMode {
  if (args.length !== 1 || (args[0] !== "--dry-run" && args[0] !== "--apply")) throw new SeedUsageError();
  return args[0] === "--apply" ? "apply" : "dry-run";
}

export function applyConfiguration(env: Record<string, string | undefined>): { url: string; secret: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url) throw new SeedError("SEED_URL_INVALID");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co") || parsed.username || parsed.password || parsed.search || parsed.hash) throw new SeedError("SEED_URL_INVALID");
  } catch (error) {
    if (error instanceof SeedError) throw error;
    throw new SeedError("SEED_URL_INVALID");
  }
  if (!secret || !/^sb_secret_[A-Za-z0-9_-]+$/.test(secret) || secret === "wisdom_os_preview_vercel") throw new SeedError("SEED_SECRET_FORMAT_INVALID");
  return { url, secret };
}

function isSerializable(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "undefined" || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") return false;
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Array.isArray(value) ? value.every((item) => isSerializable(item, seen)) : Object.values(value as Record<string, unknown>).every((item) => isSerializable(item, seen));
}

function validateCollection(value: unknown, schema: typeof KnowledgeItemSchema | typeof CaseSchema) {
  if (!Array.isArray(value)) return { count: 0, duplicates: 0, invalid: 1, ids: [] as string[], rows: [] as SeedRow[] };
  const ids = new Set<string>(); let duplicates = 0; let invalid = 0; const validIds: string[] = []; const rows: SeedRow[] = [];
  for (const entry of value) {
    const parsed = schema.safeParse(entry); const id = parsed.success ? parsed.data.id : null;
    if (!parsed.success || !id || !id.trim() || !isSerializable(entry)) { invalid += 1; continue; }
    if (ids.has(id)) { duplicates += 1; continue; }
    ids.add(id); validIds.push(id);
    rows.push({ id, payload: parsed.data as Record<string, unknown>, status: "published", deleted_at: null, created_by: null, updated_by: null });
  }
  return { count: value.length, duplicates, invalid, ids: validIds, rows };
}

export function validateSeedData(dataset: SeedDataset): SeedValidation & { knowledgeRows: SeedRow[]; caseRows: SeedRow[] } {
  const knowledge = validateCollection(dataset.knowledge, KnowledgeItemSchema); const cases = validateCollection(dataset.cases, CaseSchema);
  const knowledgeIds = new Set(knowledge.ids); const crossTableIdCollisions = cases.ids.filter((id) => knowledgeIds.has(id)).length;
  const duplicateIds = knowledge.duplicates + cases.duplicates; const invalidEntries = knowledge.invalid + cases.invalid;
  return { knowledgeEntries: knowledge.count, caseEntries: cases.count, uniqueIds: new Set([...knowledge.ids, ...cases.ids]).size, crossTableIdCollisions, duplicateIds, invalidEntries, valid: duplicateIds === 0 && invalidEntries === 0, knowledgeRows: knowledge.rows, caseRows: cases.rows };
}

export function formatDryRun(validation: SeedValidation): string {
  return [`Seed dry-run: ${validation.valid ? "SAFE" : "FAILED"}`, `Knowledge entries: ${validation.knowledgeEntries}`, `Case entries: ${validation.caseEntries}`, `Unique IDs: ${validation.uniqueIds}`, `Cross-table ID collisions: ${validation.crossTableIdCollisions} (allowed: separate tables)`, `Duplicate IDs: ${validation.duplicateIds}`, `Invalid entries: ${validation.invalidEntries}`, "Remote writes: 0"].join("\n");
}

function resultIsSuccessful(result: SeedQueryResult): boolean { return !result.error && result.status >= 200 && result.status < 300 && typeof result.statusText === "string"; }
function safeHttpStatus(status: unknown): number | null { return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null; }
export function normalizeNativeQueryResult(result: { data: unknown; error: unknown; status: number; statusText: string }): SeedQueryResult { return { data: result.data, error: result.error, status: result.status, statusText: result.statusText }; }
function rawProviderCode(error: unknown): string | null { return error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : null; }
function safeProviderCode(error: unknown): string | null {
  const code = rawProviderCode(error); if (!code) return null;
  return /^PGRST[2-9]\d\d$/.test(code) || ["23505", "23503", "42501", "42P01", "42703", "22P02"].includes(code) ? code : "SEED_PROVIDER_ERROR";
}
function classifyFailure(result: SeedQueryResult, fallback: SeedErrorCode): SeedErrorCode {
  const status = safeHttpStatus(result.status); const code = rawProviderCode(result.error);
  if (result.error && status === null && !code) return "SEED_NETWORK_FAILED";
  if (status === 401) return "SEED_AUTH_FAILED";
  if (status === 403 || code === "42501") return "SEED_PERMISSION_DENIED";
  if (status === 404 || code === "PGRST205" || code === "42P01") return "SEED_TABLE_NOT_EXPOSED";
  if (status === 409 || code === "23505") return "SEED_CONFLICT_FAILED";
  if (status === 400 || code === "42703" || code === "22P02") return "SEED_REQUEST_INVALID";
  if (status !== null && status >= 500) return "SEED_PROVIDER_UNAVAILABLE";
  return fallback;
}
function successResult(table: SeedTable, expected: number, confirmed: number, rowsInserted: number, preflight: SeedPreflight, phase: SeedPhase, query: SeedQueryResult): SeedTableResult {
  return { table, expected, confirmed, rowsInserted, preflight, success: true, errorCode: null, httpStatus: safeHttpStatus(query.status), providerCode: safeProviderCode(query.error), phase };
}
function failedResult(table: SeedTable, expected: number, confirmed: number, rowsInserted: number, preflight: SeedPreflight, phase: SeedPhase, errorCode: SeedErrorCode, query?: SeedQueryResult): SeedTableResult {
  return { table, expected, confirmed, rowsInserted, preflight, success: false, errorCode: query ? classifyFailure(query, errorCode) : errorCode, httpStatus: query ? safeHttpStatus(query.status) : null, providerCode: query ? safeProviderCode(query.error) : null, phase };
}
function chunks<T>(items: T[], size = 50): T[][] { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size)); }
function stableJson(value: unknown): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) { const items = value.map(stableJson); return items.some((item) => item === null) ? null : `[${items.join(",")}]`; }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>; const entries = Object.keys(record).sort().map((key) => {
    const encoded = stableJson(record[key]); return encoded === null ? null : `${JSON.stringify(key)}:${encoded}`;
  });
  return entries.some((entry) => entry === null) ? null : `{${entries.join(",")}}`;
}
function rowsArePublished(data: unknown, expectedIds: string[]): boolean {
  if (!Array.isArray(data) || data.length !== expectedIds.length) return false;
  const expected = new Set(expectedIds);
  return data.every((row) => { const value = row && typeof row === "object" ? row as { id?: unknown; status?: unknown; deleted_at?: unknown } : null; return Boolean(value && typeof value.id === "string" && expected.has(value.id) && value.status === "published" && value.deleted_at === null); });
}

export function classifySeedPreflight(rows: SeedRow[], remoteData: unknown): { preflight: SeedPreflight; missingRows: SeedRow[]; blockedError: SeedErrorCode | null } | null {
  if (!Array.isArray(remoteData)) return null;
  const expected = new Map(rows.map((row) => [row.id, row])); const remote = new Map<string, SeedRemoteRow>();
  for (const value of remoteData) {
    if (!value || typeof value !== "object" || typeof (value as SeedRemoteRow).id !== "string") return null;
    const id = (value as SeedRemoteRow).id as string;
    if (!expected.has(id) || remote.has(id)) return null;
    remote.set(id, value as SeedRemoteRow);
  }
  const preflight = emptyPreflight(); const missingRows: SeedRow[] = [];
  for (const row of rows) {
    const existing = remote.get(row.id);
    if (!existing) { preflight.missing += 1; missingRows.push(row); continue; }
    if (existing.deleted_at !== null && existing.deleted_at !== undefined) { preflight.deleted += 1; continue; }
    if (existing.status !== "published") { preflight.statusConflict += 1; continue; }
    if ((existing.created_by !== null && existing.created_by !== undefined) || (existing.updated_by !== null && existing.updated_by !== undefined)) { preflight.adminManaged += 1; continue; }
    if (stableJson(existing.payload) === stableJson(row.payload)) preflight.identical += 1;
    else preflight.drifted += 1;
  }
  const blockedError = preflight.deleted ? "SEED_DELETED_CONFLICT"
    : preflight.statusConflict ? "SEED_STATUS_CONFLICT"
      : preflight.adminManaged ? "SEED_ADMIN_MANAGED_CONFLICT"
        : preflight.drifted ? "SEED_CONTENT_DRIFT" : null;
  return { preflight, missingRows, blockedError };
}

type PreflightOutcome = { missingRows: SeedRow[]; preflight: SeedPreflight; error?: SeedTableResult; blockedError: SeedErrorCode | null };
async function preflightTable(client: SeedClient, table: SeedTable, rows: SeedRow[]): Promise<PreflightOutcome> {
  const allRemote: unknown[] = [];
  for (const ids of chunks(rows.map((row) => row.id))) {
    try {
      const query = await client.inspect(table, ids);
      if (!resultIsSuccessful(query)) return { missingRows: [], preflight: emptyPreflight(), blockedError: null, error: failedResult(table, rows.length, 0, 0, emptyPreflight(), "preflight", "SEED_UPSERT_FAILED", query) };
      if (!Array.isArray(query.data)) return { missingRows: [], preflight: emptyPreflight(), blockedError: null, error: failedResult(table, rows.length, 0, 0, emptyPreflight(), "preflight", "SEED_VERIFICATION_FAILED", query) };
      allRemote.push(...query.data);
    } catch { return { missingRows: [], preflight: emptyPreflight(), blockedError: null, error: failedResult(table, rows.length, 0, 0, emptyPreflight(), "preflight", "SEED_NETWORK_FAILED") }; }
  }
  const classified = classifySeedPreflight(rows, allRemote);
  if (!classified) return { missingRows: [], preflight: emptyPreflight(), blockedError: null, error: failedResult(table, rows.length, 0, 0, emptyPreflight(), "preflight", "SEED_VERIFICATION_FAILED") };
  return classified;
}
function skippedResult(table: SeedTable, expected: number, preflight = emptyPreflight()): SeedTableResult {
  return failedResult(table, expected, 0, 0, preflight, "preflight", "SEED_SKIPPED_AFTER_FAILURE");
}
async function verifyAll(client: SeedClient, table: SeedTable, rows: SeedRow[], preflight: SeedPreflight, rowsInserted: number, query: SeedQueryResult): Promise<SeedTableResult> {
  let confirmed = 0;
  for (const ids of chunks(rows.map((row) => row.id))) {
    try {
      const verification = await client.verify(table, ids);
      if (!resultIsSuccessful(verification) || !rowsArePublished(verification.data, ids)) return failedResult(table, rows.length, confirmed, rowsInserted, preflight, "verification", "SEED_VERIFICATION_FAILED", verification);
      confirmed += ids.length;
    } catch { return failedResult(table, rows.length, confirmed, rowsInserted, preflight, "verification", "SEED_NETWORK_FAILED"); }
  }
  return successResult(table, rows.length, confirmed, rowsInserted, preflight, "verification", query);
}
async function applyMissingRows(client: SeedClient, table: SeedTable, rows: SeedRow[], missingRows: SeedRow[], preflight: SeedPreflight): Promise<{ result: SeedTableResult; upsertCalls: number }> {
  if (!missingRows.length) return { result: await verifyAll(client, table, rows, preflight, 0, { data: null, error: null, status: 200, statusText: "OK" }), upsertCalls: 0 };
  try {
    const upsert = await client.upsert(table, missingRows);
    if (!resultIsSuccessful(upsert)) return { result: failedResult(table, rows.length, 0, 0, preflight, "upsert", "SEED_UPSERT_FAILED", upsert), upsertCalls: 1 };
    return { result: await verifyAll(client, table, rows, preflight, missingRows.length, upsert), upsertCalls: 1 };
  } catch { return { result: failedResult(table, rows.length, 0, 0, preflight, "upsert", "SEED_NETWORK_FAILED"), upsertCalls: 1 }; }
}

export async function applySeed(client: SeedClient, validation: ReturnType<typeof validateSeedData>): Promise<SeedApplyResult> {
  const invalid = (table: SeedTable, expected: number) => failedResult(table, expected, 0, 0, emptyPreflight(), "client_init", "SEED_VALIDATION_FAILED");
  if (!validation.valid) return { success: false, knowledge: invalid("knowledge_entries", validation.knowledgeEntries), cases: invalid("case_entries", validation.caseEntries), upsertCallsAttempted: 0, rowsInserted: 0, remoteRowsConfirmed: 0 };
  for (const table of ["knowledge_entries", "case_entries"] as const) {
    try {
      const probe = await client.probe(table);
      if (!resultIsSuccessful(probe)) {
        const failed = failedResult(table, table === "knowledge_entries" ? validation.knowledgeEntries : validation.caseEntries, 0, 0, emptyPreflight(), "client_init", "SEED_UPSERT_FAILED", probe);
        return table === "knowledge_entries"
          ? { success: false, knowledge: failed, cases: skippedResult("case_entries", validation.caseEntries), upsertCallsAttempted: 0, rowsInserted: 0, remoteRowsConfirmed: 0 }
          : { success: false, knowledge: skippedResult("knowledge_entries", validation.knowledgeEntries), cases: failed, upsertCallsAttempted: 0, rowsInserted: 0, remoteRowsConfirmed: 0 };
      }
    } catch {
      const failed = failedResult(table, table === "knowledge_entries" ? validation.knowledgeEntries : validation.caseEntries, 0, 0, emptyPreflight(), "client_init", "SEED_NETWORK_FAILED");
      return table === "knowledge_entries"
        ? { success: false, knowledge: failed, cases: skippedResult("case_entries", validation.caseEntries), upsertCallsAttempted: 0, rowsInserted: 0, remoteRowsConfirmed: 0 }
        : { success: false, knowledge: skippedResult("knowledge_entries", validation.knowledgeEntries), cases: failed, upsertCallsAttempted: 0, rowsInserted: 0, remoteRowsConfirmed: 0 };
    }
  }

  const knowledgePreflight = await preflightTable(client, "knowledge_entries", validation.knowledgeRows);
  const casesPreflight = await preflightTable(client, "case_entries", validation.caseRows);
  if (knowledgePreflight.error || casesPreflight.error || knowledgePreflight.blockedError || casesPreflight.blockedError) {
    const knowledge = knowledgePreflight.error ?? (knowledgePreflight.blockedError
      ? failedResult("knowledge_entries", validation.knowledgeEntries, 0, 0, knowledgePreflight.preflight, "preflight", knowledgePreflight.blockedError)
      : skippedResult("knowledge_entries", validation.knowledgeEntries, knowledgePreflight.preflight));
    const cases = casesPreflight.error ?? (casesPreflight.blockedError
      ? failedResult("case_entries", validation.caseEntries, 0, 0, casesPreflight.preflight, "preflight", casesPreflight.blockedError)
      : skippedResult("case_entries", validation.caseEntries, casesPreflight.preflight));
    return { success: false, knowledge, cases, upsertCallsAttempted: 0, rowsInserted: 0, remoteRowsConfirmed: 0 };
  }

  const knowledgeApply = await applyMissingRows(client, "knowledge_entries", validation.knowledgeRows, knowledgePreflight.missingRows, knowledgePreflight.preflight);
  if (!knowledgeApply.result.success) return { success: false, knowledge: knowledgeApply.result, cases: skippedResult("case_entries", validation.caseEntries, casesPreflight.preflight), upsertCallsAttempted: knowledgeApply.upsertCalls, rowsInserted: knowledgeApply.result.rowsInserted, remoteRowsConfirmed: knowledgeApply.result.confirmed };
  const casesApply = await applyMissingRows(client, "case_entries", validation.caseRows, casesPreflight.missingRows, casesPreflight.preflight);
  return {
    success: knowledgeApply.result.success && casesApply.result.success,
    knowledge: knowledgeApply.result,
    cases: casesApply.result,
    upsertCallsAttempted: knowledgeApply.upsertCalls + casesApply.upsertCalls,
    rowsInserted: knowledgeApply.result.rowsInserted + casesApply.result.rowsInserted,
    remoteRowsConfirmed: knowledgeApply.result.confirmed + casesApply.result.confirmed,
  };
}

export function formatApplyResult(result: SeedApplyResult): string {
  const details = (label: string, item: SeedTableResult) => [
    `${label}: ${item.success ? "SUCCESS" : "FAILED"} (${item.confirmed}/${item.expected})`,
    `${label} preflight: Missing rows: ${item.preflight.missing}; Identical rows skipped: ${item.preflight.identical}; Drifted rows: ${item.preflight.drifted}; Admin-managed rows: ${item.preflight.adminManaged}; Status conflicts: ${item.preflight.statusConflict}; Deleted rows: ${item.preflight.deleted}`,
    `${label} rows inserted: ${item.rowsInserted}`,
    `${label} phase: ${item.phase}`,
    `${label} HTTP status: ${item.httpStatus ?? "NONE"}`,
    `${label} provider code: ${item.providerCode ?? "NONE"}`,
    `${label} error: ${item.errorCode ?? "NONE"}`,
  ];
  return [
    `Seed apply: ${result.success ? "SAFE" : "FAILED"}`,
    ...details("Knowledge", result.knowledge),
    ...details("Cases", result.cases),
    `Upsert calls attempted: ${result.upsertCallsAttempted}`,
    `Rows inserted: ${result.rowsInserted}`,
    `Remote rows confirmed: ${result.remoteRowsConfirmed}`,
    "Canonical seed is fail-closed: identical system rows are skipped; drifted, admin-managed, non-published, and deleted rows are never overwritten.",
  ].join("\n");
}
