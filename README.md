# AI Wisdom OS

以《孙子兵法》十三篇为知识骨架，将东方经典转化为结构化、可执行决策建议的智慧操作系统。

## 功能

- **决策分析** — 输入你的现实问题，系统检索相关知识，生成三种策略方案（稳健/平衡/进取）
- **知识库** — 56 条孙子兵法原则，附原文、白话解释、适用边界与风险提示
- **现代案例** — 15 个对照案例，帮助理解经典原则的现代应用
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
- **数据** — 当前为 JSON 文件 + localStorage（P0 为 Supabase + pgvector）
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
通过环境变量配置 OpenAI-compatible API 后可启用远程 AI 模式。

### 双模式设计

| 模式 | 适用场景 | API 费用 |
|------|---------|---------|
| `local` | 完全离线使用 | 零费用 |
| `remote` | 需要 AI 增强的报告 | 需 API Key |

## API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/knowledge` | GET | 知识库列表 |
| `/api/cases` | GET | 案例库列表 |
| `/api/analyze` | POST | 执行决策分析 |

## 配置

参考 `.env.example`：

```
AI_BASE_URL=https://api.openai.com/v1/chat/completions
AI_API_KEY=sk-xxx
AI_MODEL=gpt-4o
```

不配置时自动使用本地引擎。

## 路线图

- [x] 决策分析引擎（56 条孙子兵法知识）
- [x] 知识库浏览 + 搜索
- [x] 现代案例库
- [x] 三步引导式输入
- [x] PDCA 循环追踪
- [x] 决策历史 + 本地持久化
- [ ] Supabase 云同步
- [ ] 管理后台（知识 CRUD + 审核流程）
- [ ] 个人决策模型（偏好学习）
- [ ] 多经典扩展（易经、鬼谷子...）
- [ ] Stripe 商业化
