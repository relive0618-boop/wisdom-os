export type PreviewCheck = { name: string; passed: boolean; code: string };
export type PreviewVerification = { passed: boolean; checks: PreviewCheck[] };
export type PreviewVerifierOptions = { baseUrl: string; allowLocal?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch };

const expectedKnowledgeEntries = 56;
const expectedCaseEntries = 30;
const defaultTimeoutMs = 10_000;

export class PreviewVerifierUsageError extends Error {
  constructor() { super("PREVIEW_VERIFIER_USAGE"); }
}

export function parsePreviewVerifierArgs(args: string[]): { baseUrl: string; allowLocal: boolean } {
  let baseUrl: string | null = null;
  let allowLocal = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-local") {
      if (allowLocal) throw new PreviewVerifierUsageError();
      allowLocal = true;
      continue;
    }
    if (argument === "--base-url" && !baseUrl && typeof args[index + 1] === "string") {
      baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    throw new PreviewVerifierUsageError();
  }
  if (!baseUrl) throw new PreviewVerifierUsageError();
  return { baseUrl, allowLocal };
}

export function normalizePreviewBaseUrl(value: string, allowLocal = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PreviewVerifierUsageError(); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.username || url.password || url.search || url.hash) throw new PreviewVerifierUsageError();
  if (local) {
    if (!allowLocal) throw new PreviewVerifierUsageError();
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new PreviewVerifierUsageError();
  } else if (url.protocol !== "https:") {
    throw new PreviewVerifierUsageError();
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function check(name: string, passed: boolean, code: string): PreviewCheck { return { name, passed, code }; }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function safeStatus(status: number): string { return Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP_${status}` : "HTTP_UNKNOWN"; }
function hasSensitiveText(value: unknown): boolean {
  const text = JSON.stringify(value);
  return /SUPABASE_SECRET_KEY|RATE_LIMIT_HASH_SECRET|authorization|bearer\s+|provider(?:_|\s)?body|stack(?:trace)?|set-cookie|\beyJ[A-Za-z0-9_-]{12,}\./i.test(text);
}
function hasUnpublishedContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnpublishedContent);
  if (!isObject(value)) return false;
  if (value.deleted_at !== undefined || value.status === "draft" || value.status === "archived" || value.status === "deleted") return true;
  return Object.values(value).some(hasUnpublishedContent);
}

type SafeResponse = { response: Response | null; json: unknown; failure: "TIMEOUT" | "NETWORK_FAILED" | null };

async function getJson(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<SafeResponse> {
  const controller = new AbortController();
  let timeout = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { timeout = true; controller.abort(); reject(new Error()); }, timeoutMs);
    });
    const response = await Promise.race([fetchImpl(url, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal }), timeoutPromise]);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) return { response, json: null, failure: null };
    try { return { response, json: await response.json(), failure: null }; } catch { return { response, json: null, failure: null }; }
  } catch {
    return { response: null, json: null, failure: timeout ? "TIMEOUT" : "NETWORK_FAILED" };
  } finally { if (timer) clearTimeout(timer); }
}

function responseCheck(name: string, result: SafeResponse, statuses: number[]): PreviewCheck {
  if (result.failure) return check(name, false, result.failure);
  if (!result.response) return check(name, false, "NETWORK_FAILED");
  const contentType = result.response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return check(name, false, "CONTENT_TYPE_INVALID");
  return check(name, statuses.includes(result.response.status), safeStatus(result.response.status));
}

export async function verifyPreview(options: PreviewVerifierOptions): Promise<PreviewVerification> {
  const baseUrl = normalizePreviewBaseUrl(options.baseUrl, options.allowLocal);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const requests = await Promise.all([
    getJson(fetchImpl, `${baseUrl}/api/health`, timeoutMs),
    getJson(fetchImpl, `${baseUrl}/api/knowledge`, timeoutMs),
    getJson(fetchImpl, `${baseUrl}/api/cases`, timeoutMs),
    getJson(fetchImpl, `${baseUrl}/api/cloud/reports`, timeoutMs),
    getJson(fetchImpl, `${baseUrl}/api/cloud/pdca`, timeoutMs),
    getJson(fetchImpl, `${baseUrl}/api/admin/content/knowledge`, timeoutMs),
  ]);
  const [health, knowledge, cases, reports, pdca, admin] = requests;
  const checks: PreviewCheck[] = [
    responseCheck("health", health, [200]),
    responseCheck("knowledge", knowledge, [200]),
    responseCheck("cases", cases, [200]),
    responseCheck("cloud reports unauthenticated", reports, [401]),
    responseCheck("cloud PDCA unauthenticated", pdca, [401]),
    responseCheck("admin unauthenticated", admin, [401, 403]),
    check("health response secrets", !hasSensitiveText(health.json), "RESPONSE_SCANNED"),
    check("knowledge published content", !hasUnpublishedContent(knowledge.json), "CONTENT_SCANNED"),
    check("cases published content", !hasUnpublishedContent(cases.json), "CONTENT_SCANNED"),
    check("knowledge count", isObject(knowledge.json) && Array.isArray(knowledge.json.knowledge) && knowledge.json.knowledge.length === expectedKnowledgeEntries, "COUNT_CHECKED"),
    check("cases count", isObject(cases.json) && Array.isArray(cases.json.cases) && cases.json.cases.length === expectedCaseEntries, "COUNT_CHECKED"),
  ];
  return { passed: checks.every((item) => item.passed), checks };
}

export function formatPreviewVerification(result: PreviewVerification): string {
  return [
    ...result.checks.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}: ${item.code}`),
    `Preview verification: ${result.passed ? "PASS" : "FAIL"}`,
  ].join("\n");
}
