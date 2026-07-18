import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parseAuditQuery } from "./admin/auditQuery";
import { canCreateContent, canEdit, canMutateContent, canTransition, contentStatuses } from "./admin/contentTransitions";
import { safeAuditMetadata } from "./admin/safeAuditMetadata";
import { claimsAreAdmin } from "./supabase/claims";

const hardeningMigration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20260719_wisdom_os_admin_audit_hardening.sql"), "utf8");
const detailRoute = readFileSync(resolve(process.cwd(), "src/app/api/admin/content/[kind]/[id]/route.ts"), "utf8");
const listRoute = readFileSync(resolve(process.cwd(), "src/app/api/admin/content/[kind]/route.ts"), "utf8");
const auditRoute = readFileSync(resolve(process.cwd(), "src/app/api/admin/audit/route.ts"), "utf8");

test("新 knowledge 只能 draft 建立", () => assert.equal(canCreateContent("draft"), true));
test("新 case 的 reviewed 建立被拒絕", () => assert.equal(canCreateContent("reviewed"), false));
test("新內容的 published 建立被拒絕", () => assert.equal(canCreateContent("published"), false));
test("新內容的 archived 建立被拒絕", () => assert.equal(canCreateContent("archived"), false));

for (const [from, to] of [["draft", "reviewed"], ["reviewed", "published"], ["published", "archived"], ["archived", "draft"]] as const) {
  test(`合法內容轉換 ${from} → ${to}`, () => assert.equal(canTransition(from, to), true));
}

for (const [from, to] of [["draft", "published"], ["draft", "archived"], ["reviewed", "archived"], ["published", "draft"], ["published", "reviewed"], ["archived", "reviewed"], ["archived", "published"]] as const) {
  test(`非法內容轉換 ${from} → ${to} 被拒絕`, () => assert.equal(canTransition(from, to), false));
}

test("draft → draft 可以修正 payload", () => assert.equal(canMutateContent("draft", "draft"), true));
test("reviewed → reviewed 保留必要審核修正", () => assert.equal(canMutateContent("reviewed", "reviewed"), true));
test("published → published 的原地寫入被拒絕", () => assert.equal(canMutateContent("published", "published"), false));
test("archived → archived 的原地寫入被拒絕", () => assert.equal(canMutateContent("archived", "archived"), false));
test("只有 draft 與 reviewed 可編輯", () => assert.deepEqual(contentStatuses.filter(canEdit), ["draft", "reviewed"]));

test("資料庫 trigger 強制新記錄只能 draft", () => assert.match(hardeningMigration, /if new\.status <> 'draft' or new\.deleted_at is not null then/));
test("資料庫 trigger 拒絕已發布內容原地寫入", () => assert.match(hardeningMigration, /elsif old\.status not in \('draft', 'reviewed'\) then/));
test("資料庫 trigger 拒絕封存內容原地寫入", () => assert.match(hardeningMigration, /old\.status in \('published', 'archived'\) and new\.payload is distinct from old\.payload/));
test("資料庫 trigger 對兩種內容表都生效", () => {
  assert.match(hardeningMigration, /before insert or update on public\.knowledge_entries/);
  assert.match(hardeningMigration, /before insert or update on public\.case_entries/);
});
test("資料庫 trigger 僅信任 app metadata admin 或 server-only role", () => {
  assert.match(hardeningMigration, /elsif public\.is_admin\(\) and auth\.uid\(\) is not null then/);
  assert.doesNotMatch(hardeningMigration, /user_metadata/);
});
test("system seed 路徑僅允許 service_role，且不接受瀏覽器 actor", () => {
  assert.match(hardeningMigration, /if auth\.role\(\) = 'service_role' then[\s\S]*system_seed := true/);
  assert.match(hardeningMigration, /if new\.created_by is not null or new\.updated_by is not null[\s\S]*new\.status <> 'published'/);
  assert.doesNotMatch(hardeningMigration, /user_metadata/);
});
test("system seed 不可建立 draft、軟刪除或覆寫 canonical drift", () => {
  assert.match(hardeningMigration, /if new\.payload is not distinct from old\.payload then[\s\S]*return null/);
  assert.match(hardeningMigration, /old\.status <> 'published' or old\.deleted_at is not null/);
  assert.match(hardeningMigration, /raise exception using errcode = 'P0001', message = 'content workflow rejected'/);
});
test("資料庫 trigger 不信任瀏覽器傳入 actor", () => assert.match(hardeningMigration, /new\.updated_by := trusted_actor/));
test("資料庫 trigger 為內容版本遞增", () => assert.match(hardeningMigration, /new\.version := old\.version \+ 1/));

test("create 與 audit 由 after trigger 原子處理", () => assert.match(hardeningMigration, /after insert or update on public\.knowledge_entries[\s\S]*audit_admin_content_mutation/));
test("audit 失敗會讓內容交易回滾", () => assert.match(hardeningMigration, /Any error[\s\S]*rolls the entire mutation back/));
test("audit action 由資料庫 mutation 類型推導", () => {
  for (const action of ["create", "update", "status_transition", "soft_delete"]) assert.match(hardeningMigration, new RegExp(`audit_action := '${action}'`));
});
test("system seed audit 為衍生 event，actor 固定 null 且不含 payload", () => {
  assert.match(hardeningMigration, /audit_action := 'system_seed_create'/);
  assert.match(hardeningMigration, /case when system_seed then null else new\.updated_by end/);
  assert.match(hardeningMigration, /'systemOperation', case when system_seed then 'canonical_seed'/);
});
test("audit metadata 不會寫入 payload", () => {
  const auditFunction = hardeningMigration.slice(hardeningMigration.indexOf("create or replace function public.audit_admin_content_mutation"));
  assert.doesNotMatch(auditFunction, /new\.payload|old\.payload/);
  assert.match(auditFunction, /'previousStatus'/);
  assert.match(auditFunction, /'nextStatus'/);
  assert.match(auditFunction, /'version'/);
});
test("audit trigger 函式固定 search_path 並撤銷執行權限", () => {
  assert.match(hardeningMigration, /audit_admin_content_mutation\(\)[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(hardeningMigration, /revoke all on function public\.audit_admin_content_mutation\(\) from public, anon, authenticated, service_role/);
});
test("直接 Data API 的非法 published create 仍由 trigger 拒絕", () => assert.match(hardeningMigration, /raise exception using errcode = 'P0001', message = 'content workflow rejected'/));

test("API create 使用 insert 而非模糊 upsert", () => assert.match(detailRoute, /\.insert\(\{/));
test("API 不再進行 best-effort audit 寫入", () => assert.doesNotMatch(detailRoute, /\baudit\(/));
test("API 在更新前套用同一套狀態規則", () => assert.match(detailRoute, /canMutateContent\(currentResult\.data\.status, body\.status\)/));
test("不存在的非 draft API 建立會回傳衝突", () => assert.match(detailRoute, /if \(!canCreateContent\(body\.status\)\) return conflict\(\)/));
test("DELETE 先確認 active 記錄存在", () => assert.match(detailRoute, /select\("id"\)\.eq\("id", id\)\.is\("deleted_at", null\)\.maybeSingle\(\)/));
test("DELETE 零筆命中回傳 404", () => assert.match(detailRoute, /if \(!currentResult\.data\) return notFound\(\)/));
test("DELETE 對同一 ID 再次操作不會產生第二次 audit", () => assert.match(detailRoute, /\.is\("deleted_at", null\)[\s\S]*\.select\("id"\)/));
test("Admin 預設列表排除軟刪除內容", () => assert.match(listRoute, /\.is\("deleted_at", null\)/));
test("公開 repository 持續排除 draft reviewed archived 與 deleted", () => {
  const repository = readFileSync(resolve(process.cwd(), "src/lib/contentRepository.ts"), "utf8");
  assert.match(repository, /\.eq\("status", "published"\)\.is\("deleted_at", null\)/);
});

test("audit 查詢預設有界 limit", () => assert.deepEqual(parseAuditQuery(new URLSearchParams()), { offset: 0, limit: 50, action: null, entityType: null }));
test("audit 查詢允許有界 offset 與 limit", () => assert.deepEqual(parseAuditQuery(new URLSearchParams("offset=100&limit=25&action=create&entity_type=knowledge")), { offset: 100, limit: 25, action: "create", entityType: "knowledge" }));
test("audit 查詢拒絕負 offset", () => assert.equal(parseAuditQuery(new URLSearchParams("offset=-1")), null));
test("audit 查詢拒絕超大 limit", () => assert.equal(parseAuditQuery(new URLSearchParams("limit=101")), null));
test("audit 查詢拒絕未知 action", () => assert.equal(parseAuditQuery(new URLSearchParams("action=payload_export")), null));
test("audit 查詢拒絕未知 entity type", () => assert.equal(parseAuditQuery(new URLSearchParams("entity_type=reports")), null));
test("audit route 對非法分頁或篩選回傳 422", () => assert.match(auditRoute, /if \(!parsed\) return NextResponse\.json\(\{ error: \{ code: "CLOUD_INVALID_INPUT" \} \}, \{ status: 422 \}\)/));
test("audit route 的 actor 只回傳安全標籤", () => assert.match(auditRoute, /actor: item\.actor_id \? "authenticated-admin" : "system"/));

test("safe audit metadata 僅保留狀態與版本", () => assert.deepEqual(
  safeAuditMetadata({ previousStatus: "draft", nextStatus: "reviewed", version: 2, payload: { hidden: true }, token: "hidden" }),
  { previousStatus: "draft", nextStatus: "reviewed", version: 2 },
));
test("safe audit metadata 拒絕未 allowlist 的變更欄位", () => assert.deepEqual(
  safeAuditMetadata({ changedFields: ["payload", "sql", "cookie"], secret: "hidden" }),
  { changedFields: ["payload"] },
));
test("safe audit metadata 拒絕無效狀態與非整數版本", () => assert.deepEqual(safeAuditMetadata({ previousStatus: "published-now", version: 1.5 }), {}));
test("safe audit metadata 只允許固定的 canonical seed 標記", () => assert.deepEqual(safeAuditMetadata({ systemOperation: "canonical_seed", token: "hidden" }), { systemOperation: "canonical_seed" }));
test("user_metadata admin 仍不授權", () => assert.equal(claimsAreAdmin({ app_metadata: {}, user_metadata: { role: "admin" } } as never), false));
test("只有 app_metadata admin 授權", () => assert.equal(claimsAreAdmin({ app_metadata: { role: "admin" } }), true));
test("舊 JWT 未含 app metadata admin 時仍被拒絕", () => assert.equal(claimsAreAdmin({ app_metadata: {} }), false));
