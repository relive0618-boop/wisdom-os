import { test, expect, type Page } from "@playwright/test";

async function createLocalReport(page: Page, title = "E2E 決策") {
  await page.goto("/decision");
  await page.getByPlaceholder("例如：现在适合离职创业吗？").fill(title);
  await page.getByPlaceholder("描述事情经过、你目前的犹豫，以及为什么现在需要决定。").fill("我有一個需要在今年評估的真實決策，請協助我找出可逆的行動路徑。");
  await page.getByLabel("分析模式").selectOption("local");
  await page.getByRole("button", { name: "继续", exact: true }).click({ force: true });
  await expect(page.getByPlaceholder("你拥有哪些条件？事情目前发展到哪一步？")).toBeVisible();
  await page.getByPlaceholder("你拥有哪些条件？事情目前发展到哪一步？").fill("已有小型團隊與有限預算。");
  await page.getByPlaceholder("你希望最终得到什么结果？").fill("降低試錯成本並驗證需求。");
  await page.getByRole("button", { name: "继续", exact: true }).click({ force: true });
  await expect(page.getByPlaceholder("资金、时间、人脉、能力、信息")).toBeVisible();
  await page.getByPlaceholder("资金、时间、人脉、能力、信息").fill("時間、客戶回饋與既有能力。");
  await page.getByPlaceholder("预算、时间、责任、关系、规则").fill("不能影響現有工作與家庭責任。");
  await page.getByPlaceholder("失败后最严重的后果是什么？").fill("投入後沒有足夠回報。");
  await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  await page.waitForURL(/\/report\?reportId=/);
  return new URL(page.url()).searchParams.get("reportId") as string;
}

async function storeReport(page: Page, payload: Record<string, unknown>) {
  await page.goto("/");
  await page.evaluate((value) => {
    const existing = JSON.parse(localStorage.getItem("wisdom_reports_v1") || "[]") as unknown[];
    localStorage.setItem("wisdom_reports_v1", JSON.stringify([{ ...value, createdAt: new Date().toISOString() }, ...existing]));
  }, payload);
  const reportId = String(payload.reportId);
  await page.goto(`/report?reportId=${reportId}`);
  return reportId;
}

async function createStoredLocalReport(page: Page, title = "E2E 決策") {
  const response = await page.request.post("/api/analyze", { data: { title, question: "我有一個需要評估的真實決策。", category: "创业", background: "已有小型團隊。", goal: "降低試錯成本。", resources: "有限預算。", constraints: "不能影響現有工作。", risks: "可能沒有回報。", analysisMode: "local" }, headers: { "x-forwarded-for": "e2e-stored" } });
  expect(response.status()).toBe(200);
  return storeReport(page, await response.json());
}

async function mockBrowserApiReport(page: Page, payload: Record<string, unknown>) {
  await page.route("**/api/analyze", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.goto("/");
  const result = await page.evaluate(async () => (await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "mock browser request", analysisMode: "auto" }) })).json());
  return storeReport(page, result);
}

function remotePayload(mode: "remote" | "local" = "remote") {
  return {
    decisionId: "e2e-decision", reportId: "e2e-report", cycleId: "e2e-cycle",
    report: {
      decisionId: "e2e-decision", reportId: "e2e-report", mode, category: "创业", problem_summary: "测试决策摘要。", core_conflict: "机会与限制之间的平衡。", situation_assessment: "应先比较资源、时机与风险，再采取可逆行动。",
      citations: [{ id: "k1", chapter: "始计篇", title: "五事七计", source: "source-1" }, { id: "k2", chapter: "军形篇", title: "善守者藏于九地之下", source: "source-2" }],
      strategies: [
        { name: "稳健方案", position: "先验证再投入。", actions: ["小范围测试。"], suitable_when: "信息不足时。", risk: "速度较慢。" },
        { name: "平衡方案", position: "保持基本盘并推进。", actions: ["拆解目标。"], suitable_when: "需要推进时。", risk: "执行复杂。" },
        { name: "进取方案", position: "抓住窗口主动投入。", actions: ["集中资源。"], suitable_when: "资源可控时。", risk: "消耗较快。" },
      ],
      recommended_strategy: "推荐平衡方案，因为它兼顾验证速度与失败成本。", risks: ["市场风险。", "资源风险。", "执行风险。"], action_plan_7d: ["一", "二", "三", "四", "五", "六", "七"], review_questions: ["目标？", "事实？", "停止条件？"], disclaimer: "仅供决策辅助。",
    }, retrievedAt: new Date().toISOString(), analysisMode: "auto", provider: "openai-compatible", model: "mock", qualityScore: 88, qualityWarnings: [], qualityPassed: true, fallbackReason: null, remoteAttempted: true, remoteSucceeded: true,
  };
}

test("本地模式生成报告", async ({ page }) => { await createLocalReport(page); await expect(page.getByText("Local Wisdom Report")).toBeVisible(); });
test("reportId 導航", async ({ page }) => { const id = await createStoredLocalReport(page); expect(id).toMatch(/^[0-9a-f-]{36}$/); expect(page.url()).toContain(`reportId=${id}`); });
test("歷史報告重新開啟", async ({ page }) => { const id = await createStoredLocalReport(page, "歷史開啟測試"); await page.goto("/history"); await page.locator(`a[href="/report?reportId=${id}"]`).click(); await expect(page).toHaveURL(new RegExp(`reportId=${id}`)); });
test("同名報告不覆蓋", async ({ page }) => { await createStoredLocalReport(page, "同名決策"); await createStoredLocalReport(page, "同名決策"); await page.goto("/history"); await expect(page.locator('a[href*="/report?reportId="]')).toHaveCount(2); });
test("PDCA 第二輪", async ({ page }) => { await createStoredLocalReport(page, "PDCA E2E"); await page.locator("select").first().selectOption({ label: "完成" }); await page.getByRole("button", { name: "开启下一轮", exact: true }).click(); await page.getByRole("textbox", { name: "本轮总体结果如何？" }).fill("已完成驗證。"); await page.getByRole("textbox", { name: "最大的教训是什么？" }).fill("先驗證需求。"); await page.getByRole("textbox", { name: "下一轮要重点解决什么？" }).fill("擴大客戶訪談。"); await page.getByRole("button", { name: "确认 & 开始下一轮", exact: true }).click(); await expect(page.getByText("第 2 轮循环")).toBeVisible(); });
test("深色模式持久化", async ({ page }) => { await page.goto("/settings"); await page.getByRole("button", { name: "🌙 切换深色", exact: true }).click(); await page.reload(); await expect(page.getByText("当前：深色模式")).toBeVisible(); });
test("手機版導航", async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/decision"); await expect(page.getByRole("heading", { name: "你现在面对什么局势？" })).toBeVisible(); await expect(page.getByRole("link", { name: /历史记录/ })).toBeVisible(); });
test("遠端 mock 成功", async ({ page }) => { await mockBrowserApiReport(page, remotePayload()); await expect(page.getByText("Remote AI Report")).toBeVisible(); });
test("遠端 mock fallback", async ({ page }) => { await mockBrowserApiReport(page, { ...remotePayload("local"), fallbackReason: "REMOTE_TIMEOUT", remoteSucceeded: false, provider: "local" }); await expect(page.getByText("Fallback：REMOTE_TIMEOUT")).toBeVisible(); });
test("無效 citation fallback metadata", async ({ page }) => { await mockBrowserApiReport(page, { ...remotePayload("local"), fallbackReason: "REMOTE_CITATION_INVALID", remoteSucceeded: false, provider: "local" }); await expect(page.getByText("Fallback：REMOTE_CITATION_INVALID")).toBeVisible(); });
test("無效輸入顯示錯誤", async ({ request }) => { const response = await request.post("/api/analyze", { data: { question: "   " }, headers: { "x-forwarded-for": "e2e-invalid" } }); expect(response.status()).toBe(422); expect((await response.json()).error.code).toBe("INVALID_INPUT"); });
test("rate limit 回傳 429", async ({ request }) => { const headers = { "x-forwarded-for": "e2e-rate-limit" }; for (let index = 0; index < 10; index += 1) await request.post("/api/analyze", { data: { question: "rate test", analysisMode: "local" }, headers }); const response = await request.post("/api/analyze", { data: { question: "rate test", analysisMode: "local" }, headers }); expect(response.status()).toBe(429); });
test("未配置時首頁與決策保持可用", async ({ page }) => { await page.goto("/"); await expect(page.getByText("决策智库")).toBeVisible(); await page.goto("/decision"); await expect(page.getByText("你现在面对什么局势？")).toBeVisible(); });
test("未配置時 login 顯示雲端未啟用", async ({ page }) => { await page.goto("/login"); await page.getByRole("button", { name: "登入", exact: true }).click(); await expect(page.getByText("雲端帳號尚未啟用")).toBeVisible(); });
test("未登入 account 導向 login", async ({ page }) => { await page.goto("/account"); await expect(page).toHaveURL(/\/login\?next=%2Faccount|\/login\?next=\/account/); });
test("未登入 sync 導向 login", async ({ page }) => { await page.goto("/sync"); await expect(page).toHaveURL(/\/login\?next=%2Fsync|\/login\?next=\/sync/); });
test("非管理者 admin 導向 login", async ({ page }) => { await page.goto("/admin"); await expect(page).toHaveURL(/\/login/); });
test("手機版可到帳號導航", async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/"); await expect(page.getByRole("link", { name: /帳號同步/ })).toBeVisible(); });
test("sync API 未配置安全回應", async ({ request }) => { const response = await request.get("/api/cloud/sync/status"); expect(response.status()).toBe(503); expect((await response.json()).error.code).toBe("CLOUD_NOT_CONFIGURED"); });
test("content API 標示本地來源", async ({ request }) => { const response = await request.get("/api/knowledge"); expect(response.status()).toBe(200); expect((await response.json()).source).toBe("local"); });
