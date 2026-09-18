# T09：刷新、断网与服务重启恢复竞拍

Phase 2 · 推荐 agent：Terra。连接竞态与事务重试比表面重连按钮更复杂。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

同一会话在真实连接故障后恢复座位、状态和待确认命令。

## Scope

- 心跳、带抖动退避、断线只读、快照加载门禁；订阅与快照按房间队列排序。
- 同 Cookie 多标签页共享玩家，旧 revision 忽略，pending 命令使用原 ID 查询/重试。
- 从数据库恢复 room/session/GameState；验证 state/rules/protocol 版本；未知版本隔离该房。
- 心跳携带最新房间 revision，客户端落后时主动补取快照；测试撤销可使用测试数据库标记，正式管理 CLI 由 T15 完成。

## Non-goals

- 不做事件补发/patch 合并、自动代打、跨设备或 Cookie 丢失找回。
- 不在客户端保存可裁决存档，不引入 outbox。

## Dependencies

- [T08 多浏览器实时竞拍](T08-live-auction.md)

## Acceptance Criteria

- 刷新和断网后仍是原 playerId，未新增席位；原会话有效时重启服务可继续竞拍。
- 命令已提交但响应丢失、尚未提交就断线两种情况都最多执行一次。
- 订阅瞬间发生新动作也不会漏更新或用旧快照覆盖新视图；离线不能继续点操作。
- 过期/撤销会话清除私人视图并停止重试进入游戏，提示重新登录；不能冒领旧座位。

## Validation

- 浏览器断网/联网和页面刷新 E2E；杀进程后保留数据库和 Cookie 恢复。
- 故障注入 commit 前、commit 后 ACK 前、快照/订阅交界点；多标签页并发提交断言 revision。
- 未知 snapshot 版本、数据库临时故障和会话过期集成测试。
- 抑制一次广播但保持连接，验证 revision 心跳触发补取，客户端不永久停在旧状态。
