# 实际状态与审计记录

审计日期：2026-09-18。源码基线：`2579595`（本轮文档提交的父提交）。审计开始工作区干净，无 AGENTS.md，无 Git remote。
这是一份基于代码和本次运行的状态记录；架构目标见 [ARCHITECTURE](ARCHITECTURE.md)，不能据其目录图认定功能已实现。

## 1. 代码与 Git 事实

| 范围 | 实际状态 | 证据 |
| --- | --- | --- |
| 规则 | 纯 TS 状态机、3–5 人、两种海盗规则、财务/结算/终局已实现；存在下述两个复现缺陷 | [engine](../packages/game/src/engine.ts)、[setup](../packages/game/src/setup.ts)、[types](../packages/game/src/types.ts) |
| 随机性 | 状态内 Mulberry32 RNG，可重现；浏览器新局 seed 固定为 20260819 | [rng](../packages/game/src/rng.ts)、[ManilaApp](../apps/web/src/ui/ManilaApp.tsx) |
| UI | 仍为本地热座，React useState 保存完整 GameState，直接调用 createGame/transition/getDecision | [App](../apps/web/src/App.tsx)、[ManilaApp](../apps/web/src/ui/ManilaApp.tsx) |
| 决策 | 十类 Decision 有基础 UI；独立 mortgageShare/redeemShare 无入口 | [DecisionPanel](../apps/web/src/ui/DecisionPanel.tsx)、[types](../packages/game/src/types.ts) |
| 版图/行情 | 真实状态驱动、标注坐标、行情动画已经提交，非未跟踪实验 | [GameBoard](../apps/web/src/ui/GameBoard.tsx)、[MarketPriceTrack](../apps/web/src/ui/MarketPriceTrack.tsx) |
| 标注器 | 独立原生 JS，localStorage 保存的是坐标，不是游戏存档 | [annotator](../annotator/app.js)、[JSON](../annotator/board-and-shares-annotations.json) |
| 网络与身份 | 无 server、protocol、房间、Token、Cookie 会话、WS、服务端隐私投影 | [package.json](../package.json)、当前 src 文件结构 |
| 存储与运维 | 无数据库、迁移、CI、容器、部署配置或 E2E 框架 | [vite.config](../apps/web/vite.config.ts)、[package.json](../package.json)、Git 跟踪文件 |
| 工具链 | React 19、TS 5.8、Vite 7、Vitest 3、Testing Library/jsdom；TS strict | [package.json](../package.json)、[tsconfig](../tsconfig.json) |

关键历史：b918b33 引入引擎；71b5e81 接入真实决策面板；2579595 清理固定 Demo 并确立在线目标。
Git 总计 11 个历史提交。旧 TableView/BoardStage/DemoOverlays/demoState 已删除，无需重复清理。
在 `apps/web/`、`packages/game/`、scripts、annotator 与构建配置中检索 TODO/FIXME/mock/placeholder/stub/demo 未命中；这不证明功能完备。原型确实调用规则引擎，并非 Mock 在线服务，联网能力是完全缺失而非隐藏开关。
当前仍有少量展示映射重复、压缩单行组件和坐标硬编码；随网络视图改造收敛，不单独大重构。

## 2. 本次验证

环境：Node v26.7.0、npm 11.19.0；package 要求 >=22 / >=10，但本轮未逐一验证所有允许的 Node 版本。

| 验证 | 结果与边界 |
| --- | --- |
| npm test | 11 文件、43 测试通过；规则 23、UI/坐标/样式 20 |
| npm run build | tsc --noEmit + Vite 成功；没有证明服务端部署能力 |
| runAcceptanceSimulation | 3/4/5 人各 20 局，rootSeed=20260918，交替两种海盗规则，共 60 局完成 |
| 定向边界检查 | B01、B02 可复现；两者 validateState 都未报告错误 |
| 构建资源 | CSS 12.36 kB，JS 252.50 kB（gzip 77.89 kB），五张棋子各约 2.3–2.5 MB，原图被广泛打包 |
| 文档一致性 | 25 份 Markdown、19 个任务：本地链接有效，六项任务字段齐全，依赖无环且全部收录路线图；另人工核对身份/同步/阶段口径 |

模拟通过 Node + tsx 调用 [simulation.ts](../packages/game/src/simulation.ts) 的 runAcceptanceSimulation；
可用当前 npm run simulate -- --games 20 --players N --seed 20260918 分别复跑。
模拟策略不主动 mortgage/redeem，领航员策略仅前移/放弃，不能据此宣布全部规则正确。
本轮未做浏览器外观/移动设备验收、npm 安全审计或公网网络测试。
样式测试为源码断言，不等同于响应式浏览器验收。

## 3. 缺陷与缺口

| ID | 证据与影响 | 计划 |
| --- | --- | --- |
| B01 已复现 | 两船在港，最后一船 13 格，小领航员 +1 后进入 movementOrder(round=3, remainingBoatIds=[])，无推进动作；前后不变量合法。[engine.rollDice](../packages/game/src/engine.ts) 没处理空移动集合 | [T02](tasks/T02-movement-liveness.md) |
| B02 已复现 | 初始 30，出价 31 并声明一张抵押；拍卖结束前独立抵押同一股份，其他人放弃后余额 23（应为 30+12−31=11）。[engine.finishAuction](../packages/game/src/engine.ts) 再次 applyMortgages，重复发放 12 | [T03](tasks/T03-auction-finance.md) |
| U01 代码证据 | 决策输入 bid 初值总为 1，可能低于 minimumBid；同一玩家连续阶段本地字段不重置 | [T08](tasks/T08-live-auction.md)、[T11](tasks/T11-placement.md) |
| U02 代码证据 | 版图热点固定 mortgageShareIds=[]，不带 stowaway；与面板行为不同 | [T11](tasks/T11-placement.md) |
| U03 代码证据 | 私人股份仅文字；独立抵押/赎回不可操作 | [T13](tasks/T13-finance.md) |
| U04 代码证据 | ManilaApp 丢弃 transition.events；settleVoyage 也未产出详细分项事件，旧实现不能直接支撑真实结算明细 | [T14](tasks/T14-settlement.md) |
| U05 代码证据 | 到港船只仅显示货物标签，cargo 同伙只在 sailing 卡片绘制，靠港后原同伙不显示 | [T12](tasks/T12-voyage.md) |
| Q01 缺失 | 无整航程 UI、多人隐私、并发、断网和崩溃恢复测试 | T08 起逐片加入；[T18](tasks/T18-release-tests.md) 汇总 |
| Q02 缺口 | validateState 不验证完整阶段可推进性/输入 schema；GameEvent 为开放字典，不能直接当线上协议 | T02、[T07](tasks/T07-authoritative-commands.md)、T14 |
| Q03 代码证据 | Dialog 有 Escape 和恢复焦点，未实现焦点圈定；行情计时器没有卸载清理 | [T16](tasks/T16-usability.md) |
| Q04 资源问题 | 动态素材 URL 导致大量原图进入产物；无资源预算或 E2E 视觉检查 | [T17](tasks/T17-assets.md) |

更正旧审计：跨玩家交接时 visible=false 会卸载 DecisionPanel，所以“抵押选择必然泄漏到下一玩家”没有证据。
需测试同一玩家连续阶段和重复渲染，而非把推测当作已复现 bug。
另一处过度陈述是“引擎已提供结算明细，只须接 UI”：现有事件不足，T14 必须补充观察性记录。

B01 使用通过现有不变量的构造中间状态复现，未完成从新局到该状态的合法动作回放；T02 应补充回放/到达性验证。
B02 使用新局开始的合法 API 动作序列复现；当前 UI 没有独立抵押入口，但联网开放财务动作前必须解决。
所有规则修复都需先红测试，再小范围修改；本轮没有修改引擎、UI 或测试代码。

## 4. 任务状态的唯一记录

[任务索引和依赖](ROADMAP.md) 描述计划，不代表完成；task 文件描述验收，不另设易漂移的状态字段。

- 本轮规划：完成文档拆分、代码核验和任务设计；提交由 Git 历史记录。
- T01：done / 提交待写入 / `npm ci`、`npm test`、`npm run build`、`npm run simulate -- --games 20 --players 5 --seed 20260918` 通过；浏览器冒烟仍待后续人工界面验收。
- T02–T19：TODO。
- 当前可启动：T02、T03；两者修改同一引擎文件，按路线图串行执行。
- MVP 尚不可公网发布；下一项执行 T02。

后续完成记录按任务一行追加：任务 ID / done 或 blocked / 实现提交 / 执行的验证及结果 / 未解决限制。
修改功能所在路径时同步本页证据链接；审计数字保留其日期，新增验证另记，避免覆盖历史事实。
