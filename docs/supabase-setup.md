# Supabase 设置

## Scope 与 Architecture

建立专案后执行 migration。先运行 `pnpm seed:supabase` 完成本机离线预检；它不读取环境变量、不建立 client、没有网络或远端写入。确认计数与 schema 正确后，才以部署平台的 server-only Secret Key 明确运行 `pnpm seed:supabase:apply`。apply 只会以 `id` upsert `knowledge_entries` 与 `case_entries`，写入后会分批只读核对；不包含 delete、truncate 或其他表的操作。浏览器只取得 URL 与 Publishable Key；Secret Key 与 `RATE_LIMIT_HASH_SECRET` 只在部署平台服务器环境。

## Preview flow

之后可在 Preview 设置变量、Auth redirect URL 与邮件模板，执行 `supabase db push`、`pnpm seed:supabase`，并在明确确认后才执行 `pnpm seed:supabase:apply`，再验证 RLS 与 Auth callback。不要将真实值写入 `.env`、Git 或日志。

## Production boundary、Manual verification 与 limitations

Production 本 PR 不设置任何变量，feature flags 保持 false。执行 `docs/v0.4-rls-verification.sql` 的只读查询，确认 RLS、policy 和 function grants。已知限制：尚未连接真实 Supabase，故 migration 和 seed 尚未实测。
