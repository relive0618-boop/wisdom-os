# AI Wisdom OS

以《孙子兵法》十三篇为知识骨架，将东方经典转化为结构化、可执行决策建议的智慧操作系统。

## 功能

- **决策分析** — 输入你的现实问题，系统检索相关知识，生成三种策略方案（稳健/平衡/进取）
- **知识库** — 56 条孙子兵法原则，附原文、白话解释、适用边界与风险提示
- **现代案例** — 30 个情境化综合案例，帮助理解经典原则的现代应用
- **PDCA 循环追踪** — 将策略报告转化为可执行的待办清单，支持状态跟踪、复盘记录与多轮改善循环
- **决策历史** — 所有分析记录保存在本地，可随时回溯与继续追踪

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
```

这些变量只能放在服务器环境变量中，不能使用 `NEXT_PUBLIC_` 前缀。`AI_BASE_URL` 预期是完整的 `/chat/completions` URL。`AI_TIMEOUT_MS` 默认 25 秒，`AI_MAX_RETRIES` 默认 1 且最多只能是 1。不配置或请求失败时自动使用本地引擎；`remoteError` 与 `fallbackReason` 只使用安全错误代码。`/api/health` 只返回配置状态、Base URL、模型、timeout 与 retry 数，不返回 API Key。

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
3. 在 Preview 与 Production 环境分别设置 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS`、`AI_MAX_RETRIES`；不设置也可以零成本运行本地模式。
4. 部署后访问 `/api/health`，确认 `remote.configured` 是否符合预期。

报告和 PDCA 当前保存在浏览器本机；清除浏览器站点数据会删除这些记录。云端同步仍是后续 Supabase 计划。

## 路线图

- [x] 决策分析引擎（56 条孙子兵法知识）
- [x] 知识库浏览 + 搜索
- [x] 现代案例库
- [x] 三步引导式输入
- [x] PDCA 循环追踪
- [x] 决策历史 + 报告/PDCA 本地持久化
- [x] OpenAI-compatible 远程 AI + 本地 fallback
- [x] Zod 输入、输出与报告校验
- [ ] Supabase 云同步
- [ ] 管理后台（知识 CRUD + 审核流程）
- [ ] 个人决策模型（偏好学习）
- [ ] 多经典扩展（易经、鬼谷子...）
- [ ] Stripe 商业化
