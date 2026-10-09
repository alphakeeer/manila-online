# T23：中途离开由机器人托管、重进接回座位

Phase 4 补充 · 推荐 agent：Terra。涉及服务端、协议与迁移；不修改规则引擎。

执行前阅读 [架构约定](../ARCHITECTURE.md) 第 2、3 节与 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

玩家掉线、关闭页面或退出登录时，牌局不再卡在他的回合：服务端机器人稳健代打；玩家回来（同一浏览器重连，或新会话用房间码 + 原昵称）即可继续。

## Scope

- 迁移 `005_seat_autopilot.sql`：`room_members.autopilot`（NULL / away / manual）。
- 协议：`public.players[].autopilot`、`POST /api/rooms/:code/autopilot {enabled}`、错误码 `SEAT_NOT_CLAIMABLE`；随机/稳健决策 `chooseAction` 移入 `@manila/protocol` 供前后端共用。
- 服务端：`SeatAutopilot` 计时调度（离线宽限 `AUTOPILOT_AWAY_MS`、思考间隔 `AUTOPILOT_THINK_MS`、周期巡检）；`GameService.autopilotAct` 复用人类命令的同一事务路径并遵守“会话 → 房间”锁顺序；重连解除 away；本人命令解除托管。
- 大厅：对局中加入 = 按昵称接回可接回座位；已结束/已关闭房间可返回大厅。
- 前端：托管开关、托管横幅与“我回来了”、玩家卡托管徽标、退出确认文案、终局“返回大厅”。

## Non-goals

- 不做强 AI；不做回合倒计时；不允许接回在线玩家的座位；不跨进程共享计时器。

## Dependencies

- [T22](T22-bot-table-game-over.md)

## Acceptance Criteria

- 托管动作只来自该座位 DecisionView，审计记录 `autopilot:` commandId；全部座位托管时能打到终局。
- 退出登录立即托管；断线超过宽限后托管；重连/本人操作/接回后徽标消失。
- 错误昵称或在线座位接回返回 `SEAT_NOT_CLAIMABLE`；无死锁。

## Validation

- `npm run test:integration`（新增 `seatAutopilot.test.ts` 4 例，重复运行稳定）、`npm test`、三条 E2E。
- 多浏览器实测：关闭手机窗口约 30 秒后被托管，新浏览器以原昵称接回。
