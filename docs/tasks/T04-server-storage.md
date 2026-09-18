# T04：启动最小服务与可回滚数据库迁移

Phase 1 · 推荐 agent：Terra。建立事务和进程边界，后续所有切片依赖其可靠性。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

本地启动一个 Fastify 服务和 PostgreSQL，为 Token 切片提供实际存储。

## Scope

- 创建 apps/server、pg 数据访问与 SQL migration runner，补齐本地数据库启动说明。
- 先只建 Token/会话需要的表；配置校验、日志脱敏、live/ready 健康检查、关闭连接池。
- 为集成测试提供独立测试数据库和清理约定；敏感配置只给 .env.example 空占位，实际 .env 不跟踪。

## Non-goals

- 不预建全部房间/事件表，不实现 ORM/Redis/多实例。
- 不在本任务加入登录业务或生产部署。

## Dependencies

- [T01 迁移现有代码并锁定验证入口](T01-workspace.md)

## Acceptance Criteria

- 空数据库可迁移，重复运行不重复应用；迁移失败不留下半张表或假版本。
- 数据库不可用时 readiness 失败且启动/运行行为明确，liveness 不泄漏配置。
- 干净环境按文档可启动，测试数据库不会误清理开发/生产数据。

## Validation

- 新增并执行 npm run test:integration（未来命令，由本任务创建），真实 PostgreSQL 验证成功/失败迁移和健康检查。
- 运行 npm test、npm run build；配置缺失时验证可读错误和日志无连接串。
