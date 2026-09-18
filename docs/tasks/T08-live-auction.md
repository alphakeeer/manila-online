# T08：多浏览器实时竞拍

Phase 2 · 推荐 agent：Terra。视图迁移、WS 顺序和操作状态需要一起验收。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

三名玩家从登录和大厅走到实时竞拍，浏览器不再裁决正式游戏。

## Scope

- 建立鉴权 WS 订阅、room.snapshot 与 presence，提交仍走 REST；仅已提交状态广播。
- 原有 GameBoard/MarketPriceTrack/竞拍表单改为消费公开视图和 self/decision；移除生产热座入口及 game 运行时依赖。
- 临时表单按决策身份清理，bid 默认合法最低值；pending 禁止重复点，拒绝后允许更正。
- 增加 get latest snapshot 流程；未来阶段 UI 显示等待实现，不回退本地引擎。
- 游戏中显式退出登录先提示会失去原座位恢复能力，用户确认后才撤销会话。

## Non-goals

- 不实现全部决策、不引入双向 WS 写协议或乐观权威迁移。
- 不将对手的状态先发到浏览器再隐藏。

## Dependencies

- [T07 开局、竞拍命令与私人视图事务](T07-authoritative-commands.md)

## Acceptance Criteria

- 三浏览器登录→房间→准备→开始→出价/放弃，所有人观察相同 revision 和公开最高出价。
- 非行动者只显示等待，自己的股份仍可查看；竞拍结束正确进入购股等待视图。
- 无会话/外部 Origin/非成员不能订阅；消息大小和频率受限；关键错误显示而非静默。
- 生产包无 createGame/transition/getDecision 执行路径或本地热座绕过；没有复制一套完整 GameState 类型。

## Validation

- 真实服务 + 数据库 + 三浏览器 E2E 完成首轮竞拍，检查每个接收者网络 payload。
- 断开一个订阅与提交写失败分别验证：未提交不广播，已提交可经快照读到。
- 检查 production bundle 依赖图；组件测试验证 minimumBid 更新、pending 和连续阶段清理。
