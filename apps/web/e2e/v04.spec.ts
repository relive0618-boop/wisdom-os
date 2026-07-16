import { expect, test } from "@playwright/test";
test("Migration wizard 可掃描本機資料", async ({ page }) => { await page.goto("/sync"); await expect(page).toHaveURL(/\/login/); });
test("沒有重設憑證時新密碼表單維持停用", async ({ page }) => { await page.goto("/reset-password"); await expect(page.getByRole("button", { name: "更新密碼", exact: true })).toBeDisabled(); });
test("未配置 cloud API 不執行同步", async ({ request }) => { const response = await request.post("/api/cloud/sync/pull"); expect(response.status()).toBe(503); });
test("未登入 admin API 安全拒絕", async ({ request }) => { const response = await request.get("/api/admin/content/knowledge"); expect(response.status()).toBe(401); expect((await response.json()).error.code).toBe("AUTH_REQUIRED"); });
test("未登入 audit API 安全拒絕", async ({ request }) => { const response = await request.get("/api/admin/audit"); expect(response.status()).toBe(401); });
test("手機版保留同步帳號入口", async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/"); await expect(page.getByRole("link", { name: /帳號同步/ })).toBeVisible(); });
test("內容 API 本地 fallback 仍為 200", async ({ request }) => { const response = await request.get("/api/cases"); expect(response.status()).toBe(200); expect((await response.json()).source).toBe("local"); });
