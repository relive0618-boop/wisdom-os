# 云端同步

## Scope 与 Architecture

本地 localStorage 是第一份资料；Report、PDCA 与 sync metadata 通过 repository interface 分离。metadata 包含 revision、hash、时间、来源、状态与 pending operation。

## Flow 与 Error handling

用户在 `/sync` 明确扫描并选择后才上传；每批最多 25 笔。网络、Auth、数据库失败不会删除本地资料。冲突可保留本机、云端或两份，revision 改变时返回安全 conflict code。

## Security boundary、Feature flags、Manual verification

Feature flag 关闭时不会请求 Supabase。只传 schema 验证过的 payload 和 SHA-256，不传 credentials。Preview 可在真实 Project 验证两个浏览器的 conflict；Production 本 PR 不启用。已知限制：目前 UI 的批次执行和 diff 仍需真实服务端串接测试。
