import { expect, test } from "@playwright/test";

const report = {
  decisionId: "e2e-decision",
  reportId: "e2e-report",
  cycleId: "e2e-cycle",
  retrievedAt: "2026-07-26T00:00:00.000Z",
  analysisMode: "local",
  provider: "local",
  model: null,
  qualityScore: 100,
  qualityWarnings: [],
  qualityPassed: true,
  fallbackReason: "USER_SELECTED_LOCAL",
  remoteAttempted: false,
  remoteSucceeded: false,
  report: {
    decisionId: "e2e-decision",
    reportId: "e2e-report",
    mode: "local",
    category: "綜合決策",
    problem_summary: "E2E 同步測試",
    core_conflict: "測試",
    situation_assessment: "測試",
    citations: [{ id: "one", chapter: "一", title: "一", source: "一" }],
    strategies: [
      { name: "甲", position: "甲", actions: ["甲"], suitable_when: "甲", risk: "甲" },
      { name: "乙", position: "乙", actions: ["乙"], suitable_when: "乙", risk: "乙" },
    ],
    recommended_strategy: "甲",
    risks: ["甲"],
    action_plan_7d: ["1", "2", "3", "4", "5", "6", "7"],
    review_questions: ["甲"],
    disclaimer: "測試",
  },
};

const cycle = {
  id: "e2e-cycle",
  cycleId: "e2e-cycle",
  reportId: "e2e-report",
  decisionId: "e2e-decision",
  cycleNumber: 1,
  reportTitle: "E2E 同步測試",
  reportCategory: "綜合決策",
  startedAt: "2026-07-26T00:00:00.000Z",
  completedAt: null,
  items: [],
  checkins: [],
  reflection: null,
};

test("Migration wizard 實際以選取範圍送出本機資料", async ({ page }) => {
  const sent: Array<{ entityType: string; entityId: string }> = [];
  await page.setExtraHTTPHeaders({ "x-wisdom-e2e-sync": "1" });
  await page.addInitScript(({ storedReport, storedCycle }) => {
    localStorage.setItem("wisdom_reports_v1", JSON.stringify([{ ...storedReport, createdAt: "2026-07-26T00:00:00.000Z" }]));
    localStorage.setItem("wisdom_pdca_cycle_e2e-cycle", JSON.stringify(storedCycle));
  }, { storedReport: report, storedCycle: cycle });
  await page.route("**/api/health", async (route) => route.fulfill({ json: { cloud: { configured: true, authEnabled: true, syncEnabled: true } } }));
  await page.route("**/api/cloud/sync/pull", async (route) => route.fulfill({ json: { reports: [], cycles: [], invalid: { reports: 0, cycles: 0 } } }));
  await page.route("**/api/cloud/sync/push", async (route) => {
    const body = route.request().postDataJSON() as { entities: Array<{ entityType: string; entityId: string }> };
    sent.push(...body.entities);
    await route.fulfill({ json: { results: body.entities.map((entity) => ({ ...entity, success: true, operation: "upload_create", cloudRevision: 1, errorCode: null })) } });
  });

  await page.goto("/sync");
  await expect(page.getByRole("heading", { name: "同步與遷移" })).toBeVisible();
  await expect(page.getByText("本機報告").locator("..").getByText("1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "選擇資料" }).click();
  const pdca = page.getByLabel(/PDCA 2（新增）/);
  await pdca.uncheck();
  await page.getByRole("button", { name: "開始分批執行" }).click();
  await expect(page.getByRole("status")).toContainText("遷移完成：1 筆成功，0 筆待重試。");
  expect(sent.map(({ entityType, entityId }) => ({ entityType, entityId }))).toEqual([{ entityType: "report", entityId: "e2e-report" }]);
});
test("Migration wizard 取消後只繼續送出未完成批次", async ({ page }) => {
  const reports = Array.from({ length: 26 }, (_, index) => {
    const reportId = `e2e-resume-${index}`;
    return {
      ...report,
      decisionId: `e2e-decision-${index}`,
      reportId,
      cycleId: `e2e-cycle-${index}`,
      report: { ...report.report, decisionId: `e2e-decision-${index}`, reportId },
      createdAt: "2026-07-26T00:00:00.000Z",
    };
  });
  const sent: string[][] = [];
  let beginFirstRequest!: () => void;
  let releaseFirstRequest!: () => void;
  const firstRequest = new Promise<void>((resolve) => { beginFirstRequest = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
  const cloudReports = new Map<string, Record<string, unknown>>();
  let calls = 0;
  await page.setExtraHTTPHeaders({ "x-wisdom-e2e-sync": "1" });
  await page.addInitScript((storedReports) => localStorage.setItem("wisdom_reports_v1", JSON.stringify(storedReports)), reports);
  await page.route("**/api/health", async (route) => route.fulfill({ json: { cloud: { configured: true, authEnabled: true, syncEnabled: true } } }));
  await page.route("**/api/cloud/sync/pull", async (route) => route.fulfill({ json: { reports: [...cloudReports.values()], cycles: [], invalid: { reports: 0, cycles: 0 } } }));
  await page.route("**/api/cloud/sync/push", async (route) => {
    calls += 1;
    const body = route.request().postDataJSON() as { entities: Array<{ entityId: string }> };
    sent.push(body.entities.map((entity) => entity.entityId));
    if (calls === 1) { beginFirstRequest(); await firstRelease; }
    for (const entity of body.entities) {
      const source = reports.find((item) => item.reportId === entity.entityId);
      if (!source) continue;
      cloudReports.set(entity.entityId, {
        reportId: entity.entityId,
        decisionId: source.decisionId,
        title: null,
        category: null,
        payload: source,
        revision: 1,
        deviceId: null,
        clientUpdatedAt: source.createdAt,
        updatedAt: "2026-07-26T00:00:00.000Z",
        deletedAt: null,
      });
    }
    await route.fulfill({ json: { results: body.entities.map((entity) => ({ entityType: "report", entityId: entity.entityId, success: true, operation: "upload_create", cloudRevision: 1, errorCode: null })) } });
  });

  await page.goto("/sync");
  await expect(page.getByText("本機報告").locator("..").getByText("26", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "開始分批執行" }).click();
  await firstRequest;
  await page.getByRole("button", { name: "取消並保留進度" }).click();
  releaseFirstRequest();
  await expect(page.getByRole("status")).toContainText("已在安全批次邊界取消");
  await page.getByRole("button", { name: "繼續未完成項目" }).click();
  await expect(page.getByRole("status")).toContainText("遷移完成：1 筆成功，0 筆待重試。");
  expect(sent.map((batch) => batch.length)).toEqual([25, 1]);
  expect(new Set(sent.flat()).size).toBe(26);
});
test("沒有重設憑證時新密碼表單維持停用", async ({ page }) => { await page.goto("/reset-password"); await expect(page.getByRole("button", { name: "更新密碼", exact: true })).toBeDisabled(); });
test("未配置 cloud API 不執行同步", async ({ request }) => { const response = await request.post("/api/cloud/sync/pull"); expect(response.status()).toBe(503); });
test("未登入 admin API 安全拒絕", async ({ request }) => { const response = await request.get("/api/admin/content/knowledge"); expect(response.status()).toBe(401); expect((await response.json()).error.code).toBe("AUTH_REQUIRED"); });
test("未登入 audit API 安全拒絕", async ({ request }) => { const response = await request.get("/api/admin/audit"); expect(response.status()).toBe(401); });
test("手機版保留同步帳號入口", async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/"); await expect(page.getByRole("link", { name: /帳號同步/ })).toBeVisible(); });
test("內容 API 本地 fallback 仍為 200", async ({ request }) => { const response = await request.get("/api/cases"); expect(response.status()).toBe(200); expect((await response.json()).source).toBe("local"); });
