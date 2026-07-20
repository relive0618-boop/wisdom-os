# 帐号流程

## Scope 与 Architecture

登入、注册、Magic Link、重设密码与 callback 使用 Supabase Auth。浏览器只使用 Publishable Key；Proxy 和 server 通过 `getClaims()` 验证 claims。授权只来自 `app_metadata.role`，绝不信任 `user_metadata` 或浏览器 user ID。

## Flow 与 Error handling

公开页面在未配置 Supabase 时不受影响，Auth UI 显示「雲端帳號尚未啟用」。callback 仅允许站内相对 `next`，拒绝 scheme、`//` 与编码外站 URL。所有 Auth 错误均为通用提示，不显示 provider 原始错误。

## Security boundary、Feature flags、Manual verification

不显示 JWT、token、cookie 或密码。设置 URL 和 Publishable Key 后，以 Preview 验证 signup、email confirmation、password login、Magic Link、forgot password 与过期连结；Production 在本 PR 保持关闭。已知限制：尚未在真实 Dashboard 验证 callback URL。
