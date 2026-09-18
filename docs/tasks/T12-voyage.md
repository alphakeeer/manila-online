# T12：联机三轮移动、领航与海盗

Phase 3 · 推荐 agent：Terra。阶段分支多，必须保持现有引擎顺序和可推进性。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

从首轮移动走完三个移动轮和所有领航/海盗分支，看到下一航程或终局。

## Scope

- 加入 moveBoat/pilotMove/boardPirate/choosePlunderDestination schema、server adapters、视图和 UI。
- 服务端下发已掷骰子与合法移动组合，客户端仅选择；靠港舢板保留同伙显示。
- 阶段变化和结算后发送完整视图，暂只显示结果摘要；详细财务记录由 T14 提供。

## Non-goals

- 不做客户端掷骰、不改海盗/领航规则，不用动画延迟来控制回合。
- 不新增人机或网络重放引擎。

## Dependencies

- [T11 统一联机放置、抵押和偷渡交互](T11-placement.md)

## Acceptance Criteria

- 标准和加强海盗、船长先登、满员挤人、劫掠去向、两个领航员组合都有可执行 UI。
- B01 修复在真实服务器链路中成立；没有船可动时不会出现空操作死局。
- 公开骰子、泊位、同伙、航程、行情/排名跨浏览器一致，靠港船同伙可见。

## Validation

- 真实服务定向 fixture 覆盖海盗两个分支和领航顺序，至少一条浏览器 E2E 从下水走到下一航程。
- 保留数据库状态后重连，验证移动只发生一次；轮转/错误提交不泄漏私人 DecisionView。
