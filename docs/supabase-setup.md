# Supabase 设置

## 已完成的 Preview 基础设施验证

Preview Supabase 专案已真实套用 `20260715_wisdom_os_v04.sql`。七张 public table 均已启用 RLS，Policies、Data API table grants 与 function grants 已完成验证。内容 seed 也已真实完成：`knowledge_entries` 为 56 笔，`case_entries` 为 30 笔。

`pnpm seed:supabase` 永远只做本机离线预检：不读取环境变量、不建立 Supabase client、不发出网络请求，且输出 `Remote writes: 0`。真实 apply 已使用 server-only Secret Key 完成，不应在日常或 Preview 验收时重跑。seed runner 使用 Supabase 原生 transport，直接保留每个 query 的原生 `status`／`statusText`；不使用 `captureStatus` wrapper 或 FIFO response queue。

## Preview 环境边界

Preview 才能设置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`NEXT_PUBLIC_WISDOM_CLOUD_SYNC_ENABLED`、`NEXT_PUBLIC_WISDOM_ADMIN_ENABLED`、`WISDOM_PERSISTENT_RATE_LIMIT_ENABLED` 与 `RATE_LIMIT_HASH_SECRET`。只有前两个 `NEXT_PUBLIC_` 值可进入浏览器；两个 Secret 仅能留在服务器环境，不能写入 Git、PR、聊天、截图、日志或 `.env`。

Production 本 PR 不设置云端 credentials，所有 cloud feature flags 保持 false／unset。不要复制 Preview Secret 到 Production。

## 只读 Preview smoke test

Preview 部署后执行：

```bash
pnpm verify:preview -- --base-url <PREVIEW_URL>
```

工具只发送 GET，检查 health、56 条知识、30 个案例、未登入 cloud/admin API 拒绝与 response 安全边界；它不读取 Secret、不会登入、建立帐号或写入 Supabase。完整人工验收流程见 `docs/v0.4-preview-live-verification.md`。
