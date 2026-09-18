# T05：Token 输入到持久会话的完整切片

Phase 1 · 推荐 agent：Terra。身份、Cookie、持久化和界面共同决定安全边界。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

用户输入有效 8 位 Token 后获得可刷新恢复的独立浏览器会话。

## Scope

- 创建 packages/protocol 的登录/会话 schema，按架构固定字符集与规范化规则。
- 实现 Token 生成 CLI、摘要存储、验证 POST、会话查询/退出、Origin 校验、限流和 Cookie。
- Web 登录页、错误与已登录空大厅；部署前热座原型仅开发可用，不绕过游戏 API。

## Non-goals

- 不做账号、找回密码或 Token=玩家身份映射。
- 不实现房间/WS、不在浏览器保存 Token 或完整状态。

## Dependencies

- [T04 启动最小服务与可回滚数据库迁移](T04-server-storage.md)

## Acceptance Criteria

- 无效长度/字符、错误或撤销 Token 不能获得会话；错误统一且节流可观察。
- 两个浏览器使用同一 Token 获得不同会话；刷新保留身份；服务重启仍认可未过期会话。
- 生产 Cookie 属性齐全，外部 Origin 写请求被拒，日志/URL 不出现 Token；退出清除并撤销会话。

## Validation

- HTTP 集成测试真实数据库 + 两个隔离浏览器上下文验证登录与刷新。
- 新增 npm run test:e2e（未来命令，由本任务引入 Playwright）覆盖正确/错误 Token、Cookie、登出。
- 限流、有效期用可控服务器时钟测试，不把时间依赖加入 game。
