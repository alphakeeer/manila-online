# T10：联机购股、选货与下水

Phase 3 · 推荐 agent：Terra。第一组后续动作切片，需要字段适配和隐私保持。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

竞拍赢家能通过服务端完成购股、选货和下水，朋友看到一致的三艘船。

## Scope

- 按切片加入 buyShare/selectCargo/launchBoats 的 wire schema、server adapter、视图字段和 UI。
- 买股按 commodity 意图选择供应 shareId；支持跳过及抵押，只有本人看到私有余额/持股。
- 起点组合显示对应货物与航线；表单切换决策清理，提交统一走既有命令流程。

## Non-goals

- 不改变起点 0–5、总和 9 等规则，不新增拖拽下水编辑器。
- 不实现放置或后续移动。

## Dependencies

- [T09 刷新、断网与服务重启恢复竞拍](T09-reconnect.md)

## Acceptance Criteria

- 一条 E2E 从竞拍完成走到首次 placement，所有浏览器舢板/行情一致。
- 无货、重复货物、非法航线/起点、非港务长操作在服务端被拒，数据库无部分变更。
- 再次进入新阶段不使用旧 collateral/cargo，过时命令安全失败；买股事件不暴露其他玩家私有 shareId。

## Validation

- 三浏览器完整切片；单独测试付现/抵押/跳过购买。
- schema 边界与网络授权测试，包括客户端伪造 lane=99 和非整数位置；规则层逻辑不为输入校验重写。
