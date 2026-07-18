# AI Wisdom OS

以《孙子兵法》十三篇为知识骨架，将东方经典转化为结构化、可执行决策建议的智慧操作系统。

## 功能

- **决策分析** — 输入你的现实问题，系统检索相关知识，生成三种策略方案（稳健/平衡/进取）
- **知识库** — 56 条孙子兵法原则，附原文、白话解释、适用边界与风险提示
- **现代案例** — 30 个情境化综合案例，帮助理解经典原则的现代应用
- **PDCA 循环追踪** — 将策略报告转化为可执行的待办清单，支持状态跟踪、复盘记录与多轮改善循环
- **决策历史** — 本地优先保存，可选择同步到自己的云端帐户
- **云端帐户与同步** — Supabase Auth、报告与 PDCA 的按需分批同步、冲突选择与离线保护

## 快速开始

```bash
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:3000`

## 技术栈

- **框架** — Next.js 16 (App Router + Turbopack)
- **语言** — TypeScript
- **样式** — Tailwind CSS v4
- **数据** — JSON 知识库 + 浏览器 localStorage（报告与每轮 PDCA 独立保存）
- **共享类型** — `packages/shared`（Zod schemas）

## 项目结构

```
wisdom-os/
├── apps/web/          # Next.js 主应用
│   └── src/
│       ├── app/       # 路由页面 + API 路由
│       ├── components/ # 共享组件
│       └── lib/       # 引擎 + 工具函数
├── packages/shared/   # 共享类型定义 (Zod schemas)
└── docs/              # 架构文档
```

## 架构

当前使用本地知识引擎（`lib/engine.js`）进行规则检索与策略生成，无需任何 API Key。
通过服务器环境变量配置 OpenAI-compatible API 后可启用远程 AI 模式。API 会用 Zod 验证输入、远程输出和最终报告；远程请求失败时自动回退本地引擎。

### 三种分析模式

| 模式 | 适用场景 | API 费用 |
|------|---------|---------|
| `auto` | 远程已配置时优先，失败自动回退 | 依配置而定 |
| `local` | 完全使用本地引擎，不呼叫远程 API | 零费用 |
| `remote` | 优先尝试远程，失败仍安全回退本地 | 需 API Key |

决策页面可以选择分析模式。每份报告会记录 provider、model、quality score、引用验证结果、是否尝试远程，以及 fallback reason。远程失败不会把 provider body、URL query、API Key 或 stack trace 返回给浏览器。

### AI quality gate

远程报告必须通过 Zod schema、citation provenance 与质量检查：正好三项策略、三项以上风险、正好七项行动、三项以上复盘问题、至少两条有效引用、推荐理由、策略差异、绝对化字词与问题重复检查。质量分数低于 70 会触发一次带具体 warnings 的修复请求；修复仍失败则使用本地报告并记录 `REMOTE_QUALITY_FAILED`。修复请求不会重新检索知识。

## API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/knowledge` | GET | 知识库列表 |
| `/api/cases` | GET | 案例库列表 |
| `/api/analyze` | POST | 执行决策分析 |

## 配置

参考 `.env.example`。这些变量只能配置在 Vercel Project Settings 的 Environment Variables，不能使用 `NEXT_PUBLIC_` 前缀，也不会发送到浏览器：

```
AI_BASE_URL=https://api.openai.com/v1/chat/completions
AI_API_KEY=sk-xxx
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=25000
AI_MAX_RETRIES=1
AI_MAX_OUTPUT_TOKENS=1800
AI_RESPONSE_FORMAT_MODE=prompt
AI_TOTAL_BUDGET_MS=45000
AI_THINKING_MODE=provider_default
```

这些变量只能放在服务器环境变量中，不能使用 `NEXT_PUBLIC_` 前缀。`AI_BASE_URL` 预期是完整的 `/chat/completions` URL。`AI_TIMEOUT_MS` 默认 25 秒，`AI_MAX_RETRIES` 默认 1 且最多只能是 1。`AI_MAX_OUTPUT_TOKENS` 默认 1800，范围为 800–4000；`AI_RESPONSE_FORMAT_MODE` 默认 `prompt`，只用提示词要求 JSON，以提高 OpenAI-compatible provider 相容性；只有设为 `json_object` 时才传 `response_format`。`AI_TOTAL_BUDGET_MS` 默认 45 秒，范围为 15–55 秒，剩余时间少于 10 秒时不会再进行品质修复。`AI_THINKING_MODE` 默认 `provider_default`；设为 `off` 时会传送 `chat_template_kwargs.enable_thinking=false`，设为 `on` 时传送 `true`，其他值一律回退默认值。推理内容绝不会作为报告、保存资料或 API 回应的一部分。

不配置或请求失败时自动使用本地引擎；`remoteError` 与 `fallbackReason` 只使用安全错误代码。`/api/health` 只返回配置状态、脱敏 Base URL、模型、timeout、retry、输出上限、JSON 模式、Thinking 模式与总预算，不返回 API Key、请求内容或推理内容。

本地开发不需要 API Key。远程 provider 使用统一的 `AiProvider` 介面，当前只有 generic OpenAI-compatible 实作，不引入供应商专用 SDK。

### Rate limit

`/api/analyze` 使用可替换的服务器端 abstraction，目前为记忆体实现：每个 IP 每分钟最多 10 次，超过后返回 HTTP 429 与 `RATE_LIMITED`。未来可以将同一介面替换为 Redis 或 Supabase，而不改变 API 路由。

### 测试

```bash
pnpm test       # 单元/整合测试
pnpm test:e2e   # Playwright，使用 production-like next start
```

测试不使用真实 API Key。远程成功、timeout、非 2xx、无效 JSON、citation 伪造、品质修复、fallback、rate limit 与主要报告/PDCA/主题流程均使用 mock 或本地数据验证。

## Vercel 部署

1. 在 Vercel 中将 Root Directory 留空，使用 repository 根目录。repository 根目录已包含 `package.json`、`pnpm-workspace.yaml`、`vercel.json`、`apps` 与 `packages`。本机执行命令时才需要先进入 `wisdom-os` 文件夹。
2. 使用默认的 `pnpm install` 与 `pnpm run build`。
3. 在 Preview 与 Production 环境分别设置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS`、`AI_MAX_RETRIES`、`AI_MAX_OUTPUT_TOKENS`、`AI_RESPONSE_FORMAT_MODE`、`AI_TOTAL_BUDGET_MS`、`AI_THINKING_MODE`；不设置也可以零成本运行本地模式。
4. 部署后访问 `/api/health`，确认 `remote.configured` 是否符合预期。

### 云端帐号与同步（v0.4）

云端功能默认关闭，未配置时应用维持原有本地模式，不要求 API Key。启用时仅可公开的 Supabase URL 与 Publishable Key 使用 `NEXT_PUBLIC_` 前缀；`SUPABASE_SECRET_KEY` 与 `RATE_LIMIT_HASH_SECRET` 仅在服务器使用，绝不进入浏览器、localStorage 或 API 回应。

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_WISDOM_CLOUD_SYNC_ENABLED=false
NEXT_PUBLIC_WISDOM_ADMIN_ENABLED=false
WISDOM_PERSISTENT_RATE_LIMIT_ENABLED=false
RATE_LIMIT_HASH_SECRET=
```

在 Supabase 先执行 `supabase/migrations/20260715_wisdom_os_v04.sql`。`pnpm seed:supabase` 是完全离线的预检：不读取环境变量、不建立 Supabase client、不会发出网络请求或写入资料。实际 runner 位于拥有 `@supabase/supabase-js` 的 `apps/web` package，避免 pnpm workspace 的跨 package 解析依赖。只有在 Preview 的服务器环境已安全配置后，才明确执行 `pnpm seed:supabase:apply`；它会先拒绝不安全的 URL 或非 Secret Key，再只以 `id` upsert `knowledge_entries` 与 `case_entries`，并逐批只读核对 `published` 与 `deleted_at` 状态。两张表不是跨表 transaction，若后段失败会清楚标记部分成功；可安全重跑 apply。迁移会开启 RLS：用户只能访问自己的报告和 PDCA；公开内容只读取 `published`；管理员角色只取自 JWT `app_metadata.role`。同步永远由使用者在 `/sync` 明确开始，每批最多 25 笔。下载只还原本机缺少的报告与 PDCA；同 ID 的云端资料绝不覆盖或重复写入本机，而是标示为已有对应本机资料。

持久化 rate limit 是可选项：服务器先以 HMAC-SHA256 将 IP 匿名化后才传到数据库，数据库不保存原始 IP；数据库异常会安全降级为记忆体限流。详细作业说明见 `docs/`。

Preview Supabase 已完成真实 migration、RLS／Policies／Data API grants 验证与内容 seed：`knowledge_entries` 为 56 笔、`case_entries` 为 30 笔。seed runner 直接保留 Supabase 原生 query result 的 `status`／`statusText`，不使用共享 FIFO 推测 HTTP 状态。Protected Preview smoke test、同帐号跨装置下载与 Account A／B 隔离验收均已通过：云端一份报告与一轮 PDCA 可安全还原为两笔本机资料；同 ID 不会覆盖本机；Account B 无法列出、读取、更新或删除 Account A 的资料；临时验收资料已清除。Production flags 与 credentials 保持未设定。

本轮自动化验证：309 个 unit/integration tests 与 27 个 Playwright E2E tests 均通过。

已配置 Preview 后，可使用完全只读的 smoke test：

```bash
pnpm verify:preview -- --base-url <PREVIEW_URL>
```

它只接受 HTTPS URL（本机须额外传 `--allow-local`）、只发送 GET，不读取任何 server secret，也不会建立帐号、登入或改动云端资料。

通过 pnpm script 传参时，`--` 是参数分隔符，verifier 会安全忽略最前方的单一分隔符。若 Preview 受 Vercel Deployment Protection 保护，可额外传 `--vercel-protected`，让官方 `vercel curl` 使用当前 Vercel CLI 登录状态进行只读 GET；不会保存、显示或手动传递任何 Protection 凭证。

## 路线图

- [x] 决策分析引擎（56 条孙子兵法知识）
- [x] 知识库浏览 + 搜索
- [x] 现代案例库
- [x] 三步引导式输入
- [x] PDCA 循环追踪
- [x] 决策历史 + 报告/PDCA 本地持久化
- [x] OpenAI-compatible 远程 AI + 本地 fallback
- [x] Zod 输入、输出与报告校验
- [~] Supabase 云端帐号、RLS 迁移与选择性同步（Preview migration、RLS／grants、内容 seed、Auth、同帐号跨装置下载与 Account A／B 隔离已真实验证；Admin 与 rate limit 仍待验收）
- [~] 知识与案例管理的审核资料模型（Preview 待浏览器验收；Production feature flags 保持关闭）
- [ ] 个人决策模型（偏好学习）
- [ ] 多经典扩展（易经、鬼谷子...）
- [ ] Stripe 商业化
