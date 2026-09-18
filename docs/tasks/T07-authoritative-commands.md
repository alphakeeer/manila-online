# T07：开局、竞拍命令与私人视图事务

Phase 2 · 推荐 agent：Terra。核心权威、幂等和隐私边界，需跨层验证。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

服务端可创建游戏并持久处理首个竞拍命令，向不同玩家返回不同的安全视图。

## Scope

- 房主开始命令检查 3–5 人全准备；生成并保存 seed/GameState/版本，不向客户端公开 seed。
- 复用大厅写事务；按架构实现游戏快照、commands/events 表和竞拍动作 schema/适配器。
- 实现白名单 PlayerGameView、DecisionView、命令结果与业务拒绝记录；REST 返回 recipient 视图。
- 阶段只接入 bid/passAuction，后续动作返回明确未开放结果，不伪造下一阶段。

## Non-goals

- 不一次性描述所有动作 schema，不重写引擎 Decision/GameEvent。
- 不直接返回 GameState、raw events 或最高竞拍抵押声明。

## Dependencies

- [T02 修复没有待移动船只时的卡局](T02-movement-liveness.md)
- [T03 修复竞拍抵押重复入账](T03-auction-finance.md)
- [T06 创建、加入和准备房间](T06-room-lobby.md)

## Acceptance Criteria

- 同时开始只创建一局；玩家不能伪造 playerId/roomId 代替成员授权。
- 重复相同命令只执行一次，冲突 ID 被拒；已接受的旧 revision 重试返回先前结果，新的旧 revision 命令失败。
- 事务失败不增加现金/股份/revision、不返回成功；校验每个状态快照。
- 每人只收到自己的资金/股份；非行动者无他人决策上限或 collateral，RNG 完全不出线。

## Validation

- 真实数据库注入提交失败，双命令同 revision 并发、ACK 丢失重试、业务拒绝重试。
- 测试 REST 实际序列化 payload/错误/命令 ACK 的字段白名单，而非只测试投影函数。
- 增加三至五人开局和竞拍 API 集成测试；旧规则测试通过。
