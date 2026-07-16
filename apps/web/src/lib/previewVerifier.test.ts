import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { formatPreviewVerification, normalizePreviewBaseUrl, parsePreviewVerifierArgs, PreviewVerifierUsageError, type VercelCurlExecutor, verifyPreview } from "../../../../scripts/verify-preview-lib";

const repositoryRoot = resolve(process.cwd(), "../..");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const standardResponses: Record<string, () => Response> = {
  "/api/health": () => json({ ok: true, cloud: { configured: true } }),
  "/api/knowledge": () => json({ knowledge: Array.from({ length: 56 }, (_, index) => ({ id: `knowledge-${index}` })) }),
  "/api/cases": () => json({ cases: Array.from({ length: 30 }, (_, index) => ({ id: `case-${index}` })) }),
  "/api/cloud/reports": () => json({ error: { code: "AUTH_REQUIRED" } }, 401),
  "/api/cloud/pdca": () => json({ error: { code: "AUTH_REQUIRED" } }, 401),
  "/api/admin/content/knowledge": () => json({ error: { code: "CLOUD_FORBIDDEN" } }, 403),
};

function mockFetch(overrides: Record<string, Response> = {}, methods: string[] = []): typeof fetch {
  return async (input, init) => {
    methods.push(init?.method ?? "GET");
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    return overrides[path] ?? standardResponses[path]?.() ?? json({ error: { code: "NOT_FOUND" } }, 404);
  };
}

function protectedExecutor(calls: string[][] = [], options: Array<{ cwd: string }> = []): VercelCurlExecutor {
  return async (_file, args, executionOptions) => {
    calls.push(args);
    options.push({ cwd: executionOptions.cwd });
    if (args[0] === "whoami") return { stdout: "test-user\n" };
    const path = args[1];
    const response = standardResponses[path]?.() ?? json({ error: { code: "NOT_FOUND" } }, 404);
    const body = await response.text();
    return { stdout: `${body}\n__WISDOM_HTTP_STATUS__:${response.status}\n__WISDOM_CONTENT_TYPE__:application/json\n` };
  };
}

async function withLocalPreviewServer(run: (baseUrl: string, methods: string[]) => Promise<void>): Promise<void> {
  const methods: string[] = [];
  const server = createServer(async (request, response) => {
    methods.push(request.method ?? "GET");
    const item = standardResponses[request.url ?? ""]?.() ?? json({ error: { code: "NOT_FOUND" } }, 404);
    response.writeHead(item.status, { "content-type": item.headers.get("content-type") ?? "application/json" });
    response.end(await item.text());
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_SERVER_UNAVAILABLE");
    await run(`http://127.0.0.1:${address.port}`, methods);
  } finally { await new Promise<void>((resolveClose) => server.close(() => resolveClose())); }
}

function runRootPreviewScript(args: string[]): Promise<{ status: number | null; output: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("pnpm", ["verify:preview", "--", ...args], { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (status) => resolveRun({ status, output }));
  });
}

test("Preview verifier 驗證 knowledge 為 56 筆且 cases 為 30 筆", async () => {
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", fetchImpl: mockFetch() });
  assert.equal(result.passed, true);
  assert.equal(result.checks.find((item) => item.name === "knowledge count")?.passed, true);
  assert.equal(result.checks.find((item) => item.name === "cases count")?.passed, true);
});
test("Preview verifier 偵測 health 的秘密欄位而不輸出內容", async () => {
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", fetchImpl: mockFetch({ "/api/health": json({ SUPABASE_SECRET_KEY: "test-only" }) }) });
  const output = formatPreviewVerification(result);
  assert.equal(result.checks.find((item) => item.name === "health response secrets")?.passed, false);
  assert.doesNotMatch(output, /test-only/);
});
test("Preview verifier 驗證未登入 cloud 與 admin API 被拒絕", async () => {
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", fetchImpl: mockFetch() });
  for (const name of ["cloud reports unauthenticated", "cloud PDCA unauthenticated", "admin unauthenticated"]) assert.equal(result.checks.find((item) => item.name === name)?.passed, true);
});
test("Preview verifier 拒絕非 HTTPS URL 與未明確允許的 localhost", () => {
  assert.throws(() => normalizePreviewBaseUrl("http://preview.example.test"), PreviewVerifierUsageError);
  assert.throws(() => normalizePreviewBaseUrl("http://localhost:3000"), PreviewVerifierUsageError);
  assert.equal(normalizePreviewBaseUrl("http://localhost:3000", true), "http://localhost:3000");
});
test("Preview verifier timeout 只輸出安全摘要", async () => {
  const fetchImpl: typeof fetch = async () => new Promise<Response>(() => undefined);
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", timeoutMs: 1, fetchImpl });
  const output = formatPreviewVerification(result);
  assert.equal(result.passed, false);
  assert.match(output, /TIMEOUT/);
  assert.doesNotMatch(output, /Error|stack|https?:/i);
});
test("Preview verifier 不讀取 Secret env，且只發出 GET", async () => {
  const methods: string[] = [];
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", fetchImpl: mockFetch({}, methods) });
  const source = readFileSync(resolve(repositoryRoot, "scripts/verify-preview-lib.ts"), "utf8");
  assert.equal(result.passed, true);
  assert.deepEqual(new Set(methods), new Set(["GET"]));
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});
test("公開內容含 draft 或 deleted 訊號時 Preview verifier 失敗", async () => {
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", fetchImpl: mockFetch({ "/api/knowledge": json({ knowledge: [{ id: "draft", status: "draft" }] }) }) });
  assert.equal(result.checks.find((item) => item.name === "knowledge published content")?.passed, false);
});
test("Preview verifier CLI 參數只忽略最前方一個分隔符", () => {
  assert.deepEqual(parsePreviewVerifierArgs(["--base-url", "https://preview.example.test"]), { baseUrl: "https://preview.example.test", allowLocal: false, transport: "fetch" });
  assert.deepEqual(parsePreviewVerifierArgs(["--", "--base-url", "https://preview.example.test"]), { baseUrl: "https://preview.example.test", allowLocal: false, transport: "fetch" });
  assert.deepEqual(parsePreviewVerifierArgs(["--", "--base-url", "https://preview.example.test", "--allow-local"]), { baseUrl: "https://preview.example.test", allowLocal: true, transport: "fetch" });
  assert.throws(() => parsePreviewVerifierArgs([]), PreviewVerifierUsageError);
  assert.throws(() => parsePreviewVerifierArgs(["--unknown"]), PreviewVerifierUsageError);
  assert.throws(() => parsePreviewVerifierArgs(["--", "--", "--base-url", "https://preview.example.test"]), PreviewVerifierUsageError);
  assert.throws(() => parsePreviewVerifierArgs(["--base-url", "https://preview.example.test", "--"]), PreviewVerifierUsageError);
  assert.throws(() => parsePreviewVerifierArgs(["--base-url", "https://a.example.test", "--base-url", "https://b.example.test"]), PreviewVerifierUsageError);
  assert.throws(() => parsePreviewVerifierArgs(["--base-url", "https://preview.example.test", "--allow-local", "--allow-local"]), PreviewVerifierUsageError);
});
test("Preview verifier 解析受保護 Preview transport 並拒絕本機組合", () => {
  assert.deepEqual(parsePreviewVerifierArgs(["--", "--base-url", "https://preview.example.test", "--vercel-protected"]), { baseUrl: "https://preview.example.test", allowLocal: false, transport: "vercel-curl" });
  assert.throws(() => parsePreviewVerifierArgs(["--base-url", "https://preview.example.test", "--vercel-protected", "--allow-local"]), PreviewVerifierUsageError);
});
test("受保護 Preview transport 僅呼叫 vercel curl 的固定 GET endpoint", async () => {
  const calls: string[][] = [];
  const executionOptions: Array<{ cwd: string }> = [];
  const fetchCalls: string[] = [];
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", transport: "vercel-curl", fetchImpl: mockFetch({}, fetchCalls), vercelExec: protectedExecutor(calls, executionOptions) });
  assert.equal(result.passed, true);
  assert.deepEqual(fetchCalls, []);
  assert.deepEqual(calls[0], ["whoami"]);
  assert.deepEqual(new Set(executionOptions.map((options) => options.cwd)), new Set([repositoryRoot]));
  const requestCalls = calls.slice(1);
  assert.deepEqual(requestCalls.map((args) => args[1]), ["/api/health", "/api/knowledge", "/api/cases", "/api/cloud/reports", "/api/cloud/pdca", "/api/admin/content/knowledge"]);
  for (const args of requestCalls) {
    assert.equal(args[0], "curl");
    assert.equal(args.includes("--deployment"), true);
    assert.equal(args.includes("https://preview.example.test"), true);
    assert.equal(args.includes("--request"), false);
    assert.equal(args.some((value) => /(?:POST|PUT|PATCH|DELETE|--prod|production|protection-bypass)/i.test(value)), false);
  }
});
test("受保護 Preview transport 的 CLI 失敗只回傳安全錯誤碼", async () => {
  const executor: VercelCurlExecutor = async () => { const error = Object.assign(new Error("private"), { code: "ENOENT", stderr: "token" }); throw error; };
  const result = await verifyPreview({ baseUrl: "https://preview.example.test", transport: "vercel-curl", vercelExec: executor });
  const output = formatPreviewVerification(result);
  assert.match(output, /VERCEL_CURL_UNAVAILABLE/);
  assert.doesNotMatch(output, /private|token|stack/i);
});
test("根 package script 可轉送最前方分隔符且仍只發送 GET", async () => {
  await withLocalPreviewServer(async (baseUrl, methods) => {
    const result = await runRootPreviewScript(["--base-url", baseUrl, "--allow-local"]);
    assert.equal(result.status, 0);
    assert.match(result.output, /Preview verification: PASS/);
    assert.deepEqual(new Set(methods), new Set(["GET"]));
  });
});
test("pnpm 設定只在 pnpm-workspace.yaml 保留 onlyBuiltDependencies", () => {
  const rootPackage = readFileSync(resolve(repositoryRoot, "package.json"), "utf8");
  const webPackage = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
  const workspace = readFileSync(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  assert.doesNotMatch(rootPackage, /onlyBuiltDependencies/);
  assert.doesNotMatch(webPackage, /onlyBuiltDependencies/);
  assert.match(workspace, /onlyBuiltDependencies:[\s\S]*sharp[\s\S]*unrs-resolver/);
});
