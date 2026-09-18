# 依赖路线图

本文只维护执行顺序和阶段门槛；完成状态唯一记录在 [STATUS](STATUS.md)。产品范围见 [PROJECT_DIRECTION](PROJECT_DIRECTION.md)，技术约定见 [ARCHITECTURE](ARCHITECTURE.md)。

## 执行方式

- 优先纵向切片：每个用户动作同步交付协议、授权/规则适配、持久化、接收者视图、界面与测试。不先做“整个后端”或“整个前端”。
- Phase 0 是已有代码的安全迁移和已证实缺陷修复；T04 是登录切片必要的最小运行底座，不扩展成框架工程。
- 先完成任务的 Dependencies，再按其 Acceptance Criteria 验收；阶段编号是产品交付顺序，具体依赖允许少量提前工作。
- 一个 coding turn 选择一个任务；范围仍过大时先拆分该任务并同步依赖索引，不把无关修改塞入同一提交。
- 引擎迁移和规则修复分开。B01/B02 必须先有失败测试；其他规则行为继续保留。
- 单元/集成/浏览器测试随切片引入。T18 是跨切片发布复核，不是首次测试。
- 当前只有 README 中列出的命令。test:integration 由 T04 新增，test:e2e 由 T05 新增；不能把尚不存在的命令记为已通过。

## Phase 与门槛

| Phase | 交付物 | 通过条件 |
| --- | --- | --- |
| 0 基线与规则阻塞 | T01–T03 | 原型迁移后仍可用；B01/B02 红测试转绿，无无关规则变化 |
| 1 门禁与大厅 | T04–T06 | 独立浏览器凭 Token 进入同一持久房间，刷新/重启不丢成员 |
| 2 首个在线玩法 | T07–T09 | 三浏览器完成实时竞拍，隐私隔离、去重、刷新/重启恢复成立 |
| 3 完整对局 | T10–T14 | 逐片完成下水、放置、航行、财务与结算，可玩到终局 |
| 4 发布质量 | T15–T18 | 管理、可用性、资源、完整对局与故障矩阵通过 |
| 5 可部署交付 | T19 | 生产形态、备份恢复与部署手册验证；真实上线另需主机条件 |

Phase 1/2 的中间交付不是完整游戏，也不得以不完整接口发布给朋友正式使用。
Phase 3 每片都延长同一条登录→房间→对局链路，而非另建一个 Demo。

## 任务索引

“推荐 agent”是本项目的任务分配建议，不是对模型能力的保证，也不自动启动 agent。
Terra 负责跨层一致性、规则缺陷、安全、事务和故障；Luna 负责约束明确的迁移、界面收尾与资源优化。

| ID / 任务 | Phase | 直接依赖 | 推荐 agent |
| --- | --- | --- | --- |
| [T01 迁移现有代码并锁定验证入口](tasks/T01-workspace.md) | 0 | 无 | Luna |
| [T02 修复没有待移动船只时的卡局](tasks/T02-movement-liveness.md) | 0 | T01 | Terra |
| [T03 修复竞拍抵押重复入账](tasks/T03-auction-finance.md) | 0 | T01 | Terra |
| [T04 启动最小服务与可回滚数据库迁移](tasks/T04-server-storage.md) | 1 | T01 | Terra |
| [T05 Token 输入到持久会话的完整切片](tasks/T05-token-access.md) | 1 | T04 | Terra |
| [T06 创建、加入和准备房间](tasks/T06-room-lobby.md) | 1 | T05 | Terra |
| [T07 开局、竞拍命令与私人视图事务](tasks/T07-authoritative-commands.md) | 2 | T02、T03、T06 | Terra |
| [T08 多浏览器实时竞拍](tasks/T08-live-auction.md) | 2 | T07 | Terra |
| [T09 刷新、断网与服务重启恢复竞拍](tasks/T09-reconnect.md) | 2 | T08 | Terra |
| [T10 联机购股、选货与下水](tasks/T10-launch.md) | 3 | T09 | Terra |
| [T11 统一联机放置、抵押和偷渡交互](tasks/T11-placement.md) | 3 | T10 | Terra |
| [T12 联机三轮移动、领航与海盗](tasks/T12-voyage.md) | 3 | T11 | Terra |
| [T13 随时贷款与赎回的联机入口](tasks/T13-finance.md) | 3 | T12 | Terra |
| [T14 结算记录与完整对局结果](tasks/T14-settlement.md) | 3 | T13 | Terra |
| [T15 Token 撤销与异常房间管理](tasks/T15-ops-lifecycle.md) | 4 | T14 | Terra |
| [T16 移动端、键盘与错误反馈收尾](tasks/T16-usability.md) | 4 | T14 | Luna |
| [T17 按需加载与图片体积预算](tasks/T17-assets.md) | 4 | T01 | Luna |
| [T18 发布前多端故障与完整对局验收](tasks/T18-release-tests.md) | 4 | T15、T16、T17 | Terra |
| [T19 单机公网部署与备份恢复手册](tasks/T19-deployment.md) | 5 | T18 | Terra |

## 并行与交接边界

- T01 迁移完成后，T04 可与规则缺陷调查并行；T07 必须等待 T02、T03、T06 全部通过。
- T02/T03 都会修改 engine，默认串行提交；不能无协调地同时改同一文件。
- T17 只依赖迁移，可提前做；若与 Web 视图迁移重叠，先约定素材引用文件所有权。
- T15/T16 可在 T14 后独立推进，T18 汇合全部发布前置项。
- Terra 任务若转交 Luna，先拆成已确定接口的窄子任务；遇到规则、身份或事务决策回到架构评审，不让模型临场补产品规则。
- 交接必须带实际提交、执行命令/结果和剩余限制；更新 STATUS，不复制一份新“完成列表”。

## 本轮边界

只提交导航、审计、架构和任务文档。没有实现工作区迁移、规则修复、网络服务、Token 或数据库。
下一项执行 [T01](tasks/T01-workspace.md)。
