import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type PreviewCheck = { name: string; passed: boolean; code: string };
export type PreviewVerification = { passed: boolean; checks: PreviewCheck[] };
export type PreviewTransport = "fetch" | "vercel-curl";
export type VercelCurlExecutor = (file: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number; windowsHide: boolean }) => Promise<{ stdout: string }>;
export type PreviewVerifierOptions = { baseUrl: string; allowLocal?: boolean; timeoutMs?: number; fetchImpl?: typeof fetch; transport?: PreviewTransport; vercelExec?: VercelCurlExecutor };

const expectedKnowledgeEntries = 56;
const expectedCaseEntries = 30;
const defaultTimeoutMs = 10_000;
const vercelTimeoutMs = 15_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewPaths = ["/api/health", "/api/knowledge", "/api/cases", "/api/cloud/reports", "/api/cloud/pdca", "/api/admin/content/knowledge"] as const;
type PreviewPath = (typeof previewPaths)[number];
type TransportFailure = "TIMEOUT" | "NETWORK_FAILED" | "VERCEL_CURL_UNAVAILABLE" | "VERCEL_CURL_AUTH_FAILED" | "VERCEL_CURL_REQUEST_FAILED" | "VERCEL_CURL_STATUS_INVALID" | "VERCEL_CURL_JSON_INVALID";
const execFileAsync = promisify(execFile);

export class PreviewVerifierUsageError extends Error {
  constructor() { super("PREVIEW_VERIFIER_USAGE"); }
}

export function parsePreviewVerifierArgs(inputArgs: string[]): { baseUrl: string; allowLocal: boolean; transport: PreviewTransport } {
  const args = inputArgs[0] === "--" ? inputArgs.slice(1) : inputArgs;
  let baseUrl: string | null = null;
  let allowLocal = false;
  let transport: PreviewTransport = "fetch";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--allow-local") {
      if (allowLocal) throw new PreviewVerifierUsageError();
      allowLocal = true;
      continue;
    }
    if (argument === "--vercel-protected") {
      if (transport === "vercel-curl") throw new PreviewVerifierUsageError();
      transport = "vercel-curl";
      continue;
    }
    if (argument === "--base-url" && !baseUrl && typeof args[index + 1] === "string") {
      baseUrl = args[index + 1];
      index += 1;
      continue;
    }
    throw new PreviewVerifierUsageError();
  }
  if (!baseUrl || (allowLocal && transport === "vercel-curl")) throw new PreviewVerifierUsageError();
  return { baseUrl, allowLocal, transport };
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

type SafeResponse = { status: number | null; contentType: string | null; json: unknown; failure: TransportFailure | null };

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
    if (!contentType.toLowerCase().includes("application/json")) return { status: response.status, contentType, json: null, failure: null };
    try { return { status: response.status, contentType, json: await response.json(), failure: null }; } catch { return { status: response.status, contentType, json: null, failure: null }; }
  } catch {
    return { status: null, contentType: null, json: null, failure: timeout ? "TIMEOUT" : "NETWORK_FAILED" };
  } finally { if (timer) clearTimeout(timer); }
}

function responseCheck(name: string, result: SafeResponse, statuses: number[]): PreviewCheck {
  if (result.failure) return check(name, false, result.failure);
  if (result.status === null) return check(name, false, "NETWORK_FAILED");
  if (!result.contentType?.toLowerCase().includes("application/json")) return check(name, false, "CONTENT_TYPE_INVALID");
  return check(name, statuses.includes(result.status), safeStatus(result.status));
}

const systemVercelExec: VercelCurlExecutor = async (file, args, options) => {
  const result = await execFileAsync(file, args, options);
  return { stdout: String(result.stdout) };
};

function isMissingExecutable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

async function verifyVercelAccess(executor: VercelCurlExecutor): Promise<TransportFailure | null> {
  try {
    const result = await executor("vercel", ["whoami"], { cwd: repositoryRoot, timeout: vercelTimeoutMs, maxBuffer: 1024 * 1024, windowsHide: true });
    return result.stdout.trim() ? null : "VERCEL_CURL_AUTH_FAILED";
  } catch (error) {
    return isMissingExecutable(error) ? "VERCEL_CURL_UNAVAILABLE" : "VERCEL_CURL_AUTH_FAILED";
  }
}

function parseVercelCurlOutput(stdout: string): { status: number; contentType: string; json: unknown } | TransportFailure {
  const marker = /(?:^|\n)__WISDOM_HTTP_STATUS__:(\d{3})\r?\n__WISDOM_CONTENT_TYPE__:([^\r\n]*)\s*$/;
  const match = marker.exec(stdout);
  if (!match) return "VERCEL_CURL_STATUS_INVALID";
  const status = Number(match[1]);
  if (!Number.isInteger(status) || status < 100 || status > 599) return "VERCEL_CURL_STATUS_INVALID";
  const body = stdout.slice(0, match.index).trim();
  try { return { status, contentType: match[2].trim(), json: JSON.parse(body) }; } catch { return "VERCEL_CURL_JSON_INVALID"; }
}

async function getProtectedJson(executor: VercelCurlExecutor, baseUrl: string, path: PreviewPath): Promise<SafeResponse> {
  const args = [
    "curl", path, "--deployment", baseUrl, "--", "--silent", "--show-error", "--location",
    "--write-out", "\n__WISDOM_HTTP_STATUS__:%{http_code}\n__WISDOM_CONTENT_TYPE__:%{content_type}\n",
  ];
  try {
    const parsed = parseVercelCurlOutput((await executor("vercel", args, { cwd: repositoryRoot, timeout: vercelTimeoutMs, maxBuffer: 1024 * 1024, windowsHide: true })).stdout);
    if (typeof parsed === "string") return { status: null, contentType: null, json: null, failure: parsed };
    return { ...parsed, failure: null };
  } catch (error) {
    return { status: null, contentType: null, json: null, failure: isMissingExecutable(error) ? "VERCEL_CURL_UNAVAILABLE" : "VERCEL_CURL_REQUEST_FAILED" };
  }
}

export async function verifyPreview(options: PreviewVerifierOptions): Promise<PreviewVerification> {
  const transport = options.transport ?? "fetch";
  if (transport === "vercel-curl" && options.allowLocal) throw new PreviewVerifierUsageError();
  const baseUrl = normalizePreviewBaseUrl(options.baseUrl, options.allowLocal);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const executor = options.vercelExec ?? systemVercelExec;
  const accessFailure = transport === "vercel-curl" ? await verifyVercelAccess(executor) : null;
  const requests = accessFailure
    ? previewPaths.map(() => Promise.resolve({ status: null, contentType: null, json: null, failure: accessFailure }))
    : transport === "vercel-curl"
      ? previewPaths.map((path) => getProtectedJson(executor, baseUrl, path))
      : previewPaths.map((path) => getJson(fetchImpl, `${baseUrl}${path}`, timeoutMs));
  const [health, knowledge, cases, reports, pdca, admin] = await Promise.all(requests);
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
