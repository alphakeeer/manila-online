# T20：首次真实公网部署与上线后验证

Phase 6 · 推荐 agent：Terra。需要真实主机、域名、DNS 和秘密；没有这些条件时只能完成演练工具，不能声称已上线。

执行前阅读 [部署手册](../DEPLOYMENT.md)、[架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

在项目所有者提供真实主机、域名和秘密后，完成首次公网部署，并用可重复脚本确认生产链路、持久化、备份恢复和故障行为。

## Scope

- 按 [DEPLOYMENT](../DEPLOYMENT.md) 在真实 Linux 主机部署生产 Compose：Caddy HTTPS + app + 不暴露端口的 PostgreSQL。
- 配置真实域名、DNS、TLS、`AUTH_PEPPER`、数据库密码和 `ALLOWED_ORIGINS`，生成第一批私人 Token。
- 运行 `PUBLIC_BASE_URL=https://<domain> E2E_ACCESS_TOKEN=... npm run verify:deployment`，必要时再跑三浏览器完整对局 E2E。
- 在真实主机执行一次备份→独立库恢复演练，并验证 app/PostgreSQL 容器重启后会话与游戏不丢。
- 记录主机/镜像/运行时版本、执行命令、结果和剩余风险到 STATUS。

## Non-goals

- 不自动购买域名、证书或云资源；不把秘密写入 Git 或工单。
- 不引入多实例、Kubernetes、托管数据库或复杂监控平台。
- 不承诺不兼容数据库迁移无损回滚；回滚依赖应用镜像回退或备份恢复。

## Dependencies

- [T19 单机公网部署与备份恢复手册](T19-deployment.md)

## Acceptance Criteria

- 真实域名通过 HTTPS 提供 Web/REST/WSS，HTTP 重定向到 HTTPS；Cookie 为 `Secure; HttpOnly; SameSite=Strict`。
- `/health/live` 与 `/health/ready` 正确；数据库端口在公网不可达；生产无 Vite dev server。
- 三独立浏览器凭 Token 完成登录、房间和整局对局；容器重启后仍能读取同一会话与游戏快照。
- 真实备份恢复到隔离数据库后，Token/会话/房间/游戏/命令/事件关系保留；pepper 有独立备份说明。
- `verify:deployment` 全部通过；失败项、未覆盖项和真实主机信息记录到 STATUS。

## Validation

- 在真实主机执行部署手册的构建、健康检查、`verify:deployment` 与 `npm run db:restore-drill`。
- 运行关键 E2E：登录/刷新、三人竞拍和三人完整对局；保留失败 trace 与容器日志。
- 检查主机防火墙、`docker compose port` 输出和日志，确认无数据库端口与秘密泄漏。
- 记录可复现命令、镜像摘要、域名和授权范围；没有授权不得对外发布。
