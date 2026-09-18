# T03：修复竞拍抵押重复入账

Phase 0 · 推荐 agent：Terra。有实际经济漏洞，需校对竞拍承诺与随时贷款的交互。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

修复 STATUS B02，保证同一笔未赎回抵押不重复发放贷款。

## Scope

- 将下面合法动作序列固化为失败测试，检查 finishAuction/applyMortgages/handleFinance 的相互作用。
- 仅调整竞拍结算对已实际抵押股份的处理；校验期间其他贷款/赎回对可支付能力的影响。
- 保持规则允许的非行动回合贷款，不通过全面禁用财务操作来掩盖漏洞。

## Non-goals

- 不引入账号/网络鉴权、不重做经济规则。
- 不更改 12 比索贷款、15 比索赎回和终局扣款。

## Dependencies

- [T01 迁移现有代码并锁定验证入口](T01-workspace.md)

## Acceptance Criteria

- 新局现金 30，抵押一张并出价 31 后赢得竞拍，最终现金为 11，不是 23；只有一张已抵押。
- 同一股份赎回后再次抵押的真实新贷款仍合法；竞拍失败不额外扣费。
- 获胜支付不能制造负现金；相关极端交互先有复现和规则依据再修改。

## Validation

- 执行精确复现及贷款/赎回、竞拍输赢、非法动作不修改输入的规则测试。
- 运行全部规则测试与三种人数固定 seed 模拟，检查与修复无关状态不变。

## 证据起点

createGame 三人、seed=31；取 p1 第一张 shareId。依次 bid(p1,31,[shareId]) → mortgageShare(p1,shareId) → passAuction(p2) → passAuction(p3)。当前 30+12+12−31=23，正确应只贷一次为 11；validateState 未捕获。依据：中文规则「拍卖港务长职务」「贷款」。
