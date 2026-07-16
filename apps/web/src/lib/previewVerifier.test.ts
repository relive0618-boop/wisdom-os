import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatPreviewVerification, normalizePreviewBaseUrl, parsePreviewVerifierArgs, PreviewVerifierUsageError, verifyPreview } from "../../../../scripts/verify-preview-lib";

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
test("Preview verifier CLI 參數必須明確提供 base URL", () => {
  assert.deepEqual(parsePreviewVerifierArgs(["--base-url", "https://preview.example.test"]), { baseUrl: "https://preview.example.test", allowLocal: false });
  assert.throws(() => parsePreviewVerifierArgs([]), PreviewVerifierUsageError);
  assert.throws(() => parsePreviewVerifierArgs(["--unknown"]), PreviewVerifierUsageError);
});
test("pnpm 設定只在 pnpm-workspace.yaml 保留 onlyBuiltDependencies", () => {
  const rootPackage = readFileSync(resolve(repositoryRoot, "package.json"), "utf8");
  const webPackage = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
  const workspace = readFileSync(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  assert.doesNotMatch(rootPackage, /onlyBuiltDependencies/);
  assert.doesNotMatch(webPackage, /onlyBuiltDependencies/);
  assert.match(workspace, /onlyBuiltDependencies:[\s\S]*sharp[\s\S]*unrs-resolver/);
});
