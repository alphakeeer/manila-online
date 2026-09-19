# 实际状态与审计记录

审计日期：2026-09-18。源码基线：`2579595`（本轮文档提交的父提交）。审计开始工作区干净，无 AGENTS.md，无 Git remote。
这是一份基于代码和本次运行的状态记录；架构目标见 [ARCHITECTURE](ARCHITECTURE.md)，不能据其目录图认定功能已实现。

## 1. 代码与 Git 事实

| 范围 | 实际状态 | 证据 |
| --- | --- | --- |
| 规则 | 纯 TS 状态机、3–5 人、两种海盗规则、财务/结算/终局已实现；Phase 0 已修复已复现的 B01/B02 | [engine](../packages/game/src/engine.ts)、[setup](../packages/game/src/setup.ts)、[types](../packages/game/src/types.ts) |
| 随机性 | 规则状态内 Mulberry32 RNG 可重现；在线开局由服务端生成并持久化 uint32 seed，不下发浏览器 | [rng](../packages/game/src/rng.ts)、[game service](../apps/server/src/game/service.ts) |
| UI | 登录、持久大厅和线上首轮竞拍已实现；浏览器只消费接收者视图，不保存完整 GameState | [App](../apps/web/src/App.tsx)、[GameRoom](../apps/web/src/ui/GameRoom.tsx) |
| 决策 | 线上仅开放首轮 bid/passAuction；其余阶段等待后续切片，不存在热座旁路 | [protocol](../packages/protocol/src/index.ts)、[game service](../apps/server/src/game/service.ts) |
| 版图/行情 | 真实状态驱动、标注坐标、行情动画已经提交，非未跟踪实验 | [GameBoard](../apps/web/src/ui/GameBoard.tsx)、[MarketPriceTrack](../apps/web/src/ui/MarketPriceTrack.tsx) |
| 标注器 | 独立原生 JS，localStorage 保存的是坐标，不是游戏存档 | [annotator](../annotator/app.js)、[JSON](../annotator/board-and-shares-annotations.json) |
| 网络与身份 | Fastify、Token/Cookie 会话、持久房间、REST 命令、WebSocket 接收者快照和 presence 已实现 | [server](../apps/server/src/server.ts)、[protocol](../packages/protocol/src/index.ts) |
| 存储与运维 | PostgreSQL Compose、可排序 migrations、健康检查和真实 integration/E2E 已验证；生产部署和 CI 仍未实现 | [compose](../compose.yaml)、[migrations](../apps/server/migrations)、[Playwright](../tests/e2e/session.spec.ts) |
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
| B01 已修复 | 小领航员将最后一艘船送入港后，`rollDice` 识别空待移动集合并直接完成第三轮结算，不生成卡死 phase 或消耗额外 RNG。seed 347 动作链覆盖标准/加强海盗，seed 1413 覆盖第二轮全到港与最终领航机会。 | [T02](tasks/T02-movement-liveness.md) |
| B02 已修复 | 竞拍结算仅为尚未抵押的声明股份发放贷款；seed 31 的独立抵押再获胜序列最终余额为 11。最高出价者的赎回若使“现金 + 尚待执行声明抵押”不足支付，则被拒绝，结算也保留防止负现金的校验。 | [T03](tasks/T03-auction-finance.md) |
| U01 范围限制 | 线上竞拍表单以服务器 minimumBid 初始化并在新决策时重置；后续阶段 UI 尚未接入 | [T11](tasks/T11-placement.md) |
| U02 范围限制 | 当前公开投影还未包含同伙位置或 stowaway；T11 接入放置时扩展 | [T11](tasks/T11-placement.md) |
| U03 范围限制 | self 已显示股份/抵押状态，但独立抵押与赎回尚无线上命令入口 | [T13](tasks/T13-finance.md) |
| U04 范围限制 | games/events 已持久化安全竞拍摘要；详细结算明细仍需 T14 的只读观察性记录 | [T14](tasks/T14-settlement.md) |
| U05 范围限制 | 公开版图显示船只和行情；同伙和完整航程视觉状态待 T12 | [T12](tasks/T12-voyage.md) |
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
- T01：done / `ad1081d` / `npm ci`、`npm test`、`npm run build`、`npm run simulate -- --games 20 --players 5 --seed 20260918` 通过；浏览器冒烟仍待后续人工界面验收。
- T02：done / `1ca5d47` / 窄回归 11 项、全套 46 项、生产构建和 3/4/5 人各 20 局固定种子模拟通过；第三轮无船时不再掷骰，正常航程的既有 RNG 顺序不变。
- T03：done / `7d886b3` / 窄回归 15 项、全套 51 项、生产构建和 3/4/5 人各 20 局固定种子模拟通过；重复抵押不再重复放款，竞拍承诺期间的赎回不会造成负现金。
- T04：done / `ab0f398`、`a441a03`、`7d81f58` / Docker Compose PostgreSQL 已启动，`npm run db:migrate` 与 `npm run test:integration`（真实 `manila_test`）通过；仍不包含生产部署。
- T05：done / `57e8c13`、`7d81f58` / 真实 PostgreSQL 会话、Token 规范化、撤销和限流 integration 通过；Chromium 两独立 Cookie 上下文的登录、刷新和登出 E2E 通过。
- T06：done / `c05521a`、`a441a03` / 真实 PostgreSQL integration 覆盖创建/加入/准备/规则变体/离房、并发末席、revision 和 commandId 重放；三人完整竞拍流程由 T08 Chromium E2E 覆盖。
- T07：done / `b1a568c` / `npm run db:migrate`、`npm test`、`npm run build`、`npm run test:integration` 通过；3 人真实数据库开局、私有投影、竞拍 ACK 重放和冲突 commandId 已覆盖。首位出价者由服务端密码学随机选取。
- T08：done / `19fd395`、`3bc93d0` / `npm test`、`npm run build`、`npm run test:integration` 通过；真实 WebSocket 验证订阅初始视图、presence、接收者私有隔离和提交后相同 revision 广播；三独立 Chromium 上下文完成创建、准备、随机首位竞拍与同步。生产入口不再依赖 `@manila/game`。
- T09：done / `656b0fa` / `npm test`、`npm run build`、`npm run test:integration` 通过；客户端快照门禁、断线只读、20 秒心跳、指数重连和 sessionStorage commandId 重试已实现，未知协议版本存档会标记 isolated。进程级故障注入与完整断网 Chromium 情景留待 T18 扩展。
- T10–T14：in progress / 未提交 / 已扩展权威协议与服务端动作适配，接入购股、选货、下水、放置、航行、领航、海盗及独立财务入口；结算事件、私有结算存储和历史读取已初步接通。`npm test`、`npm run build`、`npm run test:integration` 通过；尚缺逐任务 E2E、热点交互、完整对局回归和每项独立提交，不能标记 done。
- T15–T19：TODO。
- 当前可启动：T10（T04–T09 已完成）。
- MVP 尚不可公网发布；Phase 0 已完成，下一项执行 T04。

后续完成记录按任务一行追加：任务 ID / done 或 blocked / 实现提交 / 执行的验证及结果 / 未解决限制。
修改功能所在路径时同步本页证据链接；审计数字保留其日期，新增验证另记，避免覆盖历史事实。
