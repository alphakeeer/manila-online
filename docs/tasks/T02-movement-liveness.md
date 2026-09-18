# T02：修复没有待移动船只时的卡局

Phase 0 · 推荐 agent：Terra。涉及阶段推进和 RNG 消耗，需保持其他规则行为。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

修复 STATUS B01，使所有船已到港的合法航程能够完成结算。

## Scope

- 先复现 B01，补充由正常迁移到达“领航员送最后一船入港”的 fixture/动作序列。
- 只修复空 remainingBoatIds 的推进；覆盖第二轮已全到港与第三轮领航员送船场景。
- 明确空移动轮的掷骰/RNG 消耗，依照现有规则与顺序最小变更，记录修复影响。

## Non-goals

- 不重写引擎、改利润或海盗规则。
- 不通过客户端自动伪造 moveBoat 或放弃动作绕过卡局。

## Dependencies

- [T01 迁移现有代码并锁定验证入口](T01-workspace.md)

## Acceptance Criteria

- 原先进入 movementOrder(round=3, remainingBoatIds=[]) 的复现可结束该航程，且只结算一次。
- 第二轮全到港时余下合法放置/领航决策不被无依据跳过。
- 终局/下一航程均可到达，不增加递归死循环；不受影响种子的结果保持一致。

## Validation

- 先增加失败回归，再验证修复；包含三种人数、标准/加强海盗和 terminal/nonterminal 行情。
- 运行规则全套及固定 seed 模拟；对变化的 seed/事件/RNG 结果给出原因。

## 证据起点

复现：新建三人局 seed=31；三船货物 nutmeg/silk/jade、起点均 3，前两船 port A/B、position=null，第三船 sailing at 13；p1 拥有 smallPilot 且 phase=smallPilot。提交 boat-3 +1 后当前实现卡在空移动集合。输入/输出 validateState 均为 []。规则依据：中文规则「领航员行动」「利润分配」。
