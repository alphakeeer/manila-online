# T06：创建、加入和准备房间

Phase 1 · 推荐 agent：Terra。并发成员关系、会话座位和大厅行为需要一致设计。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

三位朋友通过独立浏览器进入同一持久大厅并准备游戏。

## Scope

- 增加 rooms/room_members migrations、短随机房间码、昵称、房主和准备/离开命令。
- REST 查询与大厅 UI；本阶段可短轮询刷新，T08 改为 WS 通知。
- 为大厅写操作建立 commandId/revision 事务工具和行锁；T07 复用到游戏。
- 创建房间以会话范围去重/锁定；加入按房间码在锁内取得 revision，无需预先成员身份或客户端 expectedRevision，单房间约束跨房间并发也成立。其他已入房操作携带 expectedRevision。

## Non-goals

- 不开始引擎对局、不做公开列表/匹配/聊天。
- 不允许一个会话占多个未结束房间或按昵称恢复身份。

## Dependencies

- [T05 Token 输入到持久会话的完整切片](T05-token-access.md)

## Acceptance Criteria

- 创建者为房主，最多 5 席；并发争抢末席仅一人成功，重复 join 不新增席位。
- 加入/准备/离开持久化并增加 revision；他人不能修改别人的准备状态。
- 房主离开移交、空房关闭、配置变更清准备符合架构；刷新/进程重启能恢复大厅。

## Validation

- 至少三浏览器创建→输入房间码→加入→准备→刷新；错误房间码和第六人加入失败。
- 真实数据库并发末席/同会话加入两房、重复 commandId、过时 revision、非成员越权写入测试；成功离房后的同 ID 重试返回原安全结果。
