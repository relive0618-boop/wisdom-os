# Supabase 设置

## 已完成的 Preview 基础设施验证

Preview Supabase 专案已真实套用 `20260715_wisdom_os_v04.sql`。七张 public table 均已启用 RLS，Policies、Data API table grants 与 function grants 已完成验证。内容 seed 也已真实完成：`knowledge_entries` 为 56 笔，`case_entries` 为 30 笔。

`pnpm seed:supabase` 永远只做本机离线预检：不读取环境变量、不建立 Supabase client、不发出网络请求，且输出 `Remote writes: 0`。真实 apply 已使用 server-only Secret Key 完成，不应在日常或 Preview 验收时重跑。runner 使用 Supabase 原生 transport，直接保留每个 query 的原生 `status`／`statusText`；不使用 `captureStatus` wrapper 或 FIFO response queue。

`20260719_wisdom_os_admin_audit_hardening.sql` 已套用到 Preview。四个内容 workflow／audit trigger、两个固定 search path 的 `SECURITY DEFINER` function、function grants 与既有 table grants 已完成只读复核；migration 本身没有新增 audit event。真人 Account B 验收已确认：普通角色与移除角色后重新登入的新 JWT 都无法读取 Admin API；暂时授予 `app_metadata.role=admin` 并重新登入后，draft-only create、合法转换、draft／reviewed 编辑、published／archived 写入拒绝与单次软删除均通过。两笔临时内容最后维持软删除；Audit 产生 10 笔安全事件（create 2、update 2、status_transition 4、soft_delete 2），未记录 payload 或凭证。未来若获得独立批准重跑 `pnpm seed:supabase:apply`，apply 先对两张允许表做只读 preflight：仅可插入缺少的 canonical system 内容（`published`、未删除、`created_by`／`updated_by` 均为 null）。已有且 canonical／稳定 JSON 语义等价的 system 列只验证并跳过；payload 漂移、Admin 管理列、非 published 列或已删除列全部 fail closed，绝不覆盖、复活、删除或修改既有资料。相同列的重跑不建立新版本，也不产生新的 audit event。Preview 的只读 preflight 已确认 knowledge 56／56、cases 30／30 均为相同 canonical 内容，远端写入为 0。

`20260720100901_wisdom_os_rate_limit_hardening.sql` 已加入代码库，但尚未套用 Preview。它把 rate-limit bucket 改为每个 HMAC identifier／`/api/analyze` 最多一行，跨分钟由受限 RPC 原子重设；旧的非法或过期窗口在 migration 内安全收敛。该表仍启用 RLS，anon／authenticated 没有 table grant，`consume_rate_limit` 仍只授予 service_role。套用前请审阅 `docs/v0.4-rate-limit-verification.sql`；它只包含 SELECT，且不输出 hash 值。

## Preview 环境边界

Preview 才能设置 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`NEXT_PUBLIC_WISDOM_CLOUD_SYNC_ENABLED`、`NEXT_PUBLIC_WISDOM_ADMIN_ENABLED`、`WISDOM_PERSISTENT_RATE_LIMIT_ENABLED` 与 `RATE_LIMIT_HASH_SECRET`。只有前两个 `NEXT_PUBLIC_` 值可进入浏览器；两个 Secret 仅能留在服务器环境，不能写入 Git、PR、聊天、截图、日志或 `.env`。persistent rate limit 只有 flag、有效 Supabase URL、Publishable Key、Secret Key 与至少 32 字元的 hash secret 全部存在时才会启用；缺少任一项都会安全回退到记忆体模式。

Production 本 PR 不设置云端 credentials，所有 cloud feature flags 保持 false／unset。不要复制 Preview Secret 到 Production。

## 只读 Preview smoke test

Preview 部署后执行：

```bash
pnpm verify:preview -- --base-url <PREVIEW_URL>
```

工具只发送 GET，检查 health、56 条知识、30 个案例、未登入 cloud/admin API 拒绝与 response 安全边界；它不读取 Secret、不会登入、建立帐号或写入 Supabase。完整人工验收流程见 `docs/v0.4-preview-live-verification.md`。

pnpm script 的 `--` 是参数分隔符，verifier 只会忽略最前方的单一分隔符。若 Preview 启用 Vercel Deployment Protection，可在同一命令后加入 `--vercel-protected`；该模式仅以官方 `vercel curl` 对固定 endpoint 发送 GET，并依当前 CLI 登录状态自动处理临时存取，不会建立、保存或显示 bypass 凭证。
