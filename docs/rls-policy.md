# RLS 与权限

所有 public 表均开启 RLS。`user_reports` 和 `user_pdca_cycles` 使用 `auth.uid() = user_id`；内容读者只可读取 `published`；后台角色由受签 JWT 的 `app_metadata.role = admin` 决定。rate-limit 表没有 anon/authenticated 表权限，只能通过受限 RPC 使用。
