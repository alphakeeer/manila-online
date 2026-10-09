# 实际状态与审计记录

审计日期：2026-09-18。源码基线：`2579595`（本轮文档提交的父提交）。审计开始工作区干净，无 AGENTS.md，无 Git remote。
这是一份基于代码和本次运行的状态记录；架构目标见 [ARCHITECTURE](ARCHITECTURE.md)，不能据其目录图认定功能已实现。

> Phase 3/4 的完成记录与新增验证见第 4 节；第 1–3 节保留 2026-09-18 的历史基线，不覆盖旧证据。

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
- T10：done / `908938b` / 购股（commodity 意图由服务端选 supply shareId）、选货、下水协议、服务端适配、接收者视图和表单已接通；非法航线/非整数起点/非港务长操作由 strict schema 或引擎拒绝。三条 Phase 3/4 `playthrough` integration 从开局走到终局，覆盖买股与跳过的路径。
- T11：done / `908938b`、`3eaac0f` / 放置/放弃协议、版图热点与面板共用确认区（collateral/stowaway/费用）已实现；版图显示本人与公开同伙位置（含靠港舢板）。修复引擎 `sameLocation` 对 JSON 键序敏感导致 PostgreSQL JSONB 回合后重复占位的问题，新增 key 重排回归和版图热点/同伙组件测试。
- T12：done / `908938b`、`3eaac0f` / moveBoat、pilotMove、boardPirate、choosePlunderDestination 适配与 UI 已接通；加强海盗满员挤人提供被挤同伙选择，靠港/修船厂舢板保留同伙标记。3/4/5 人 × 标准/加强海盗的真实 HTTP 全链路对局全部到达终局。
- T13：done / `908938b` / 独立 mortgageShare/redeemShare 协议与个人财务面板已实现；非当前行动玩家可在竞拍等待时贷款/赎回，伪造 shareId、重复抵押、过期 revision 均被拒绝且不改变状态。
- T14：done / `908938b` / `settleVoyage` 增加结构化只读 `incomes`/`payments`（货物、海盗、港口/修船厂泊位、强制贷款、保险赔付与港口金库代付），协议分别投影公开船只/行情与本人明细，历史读取按座位过滤；新增分支测试验证账目与实际现金差一致。
- T15：done / `908938b` / 主机 CLI 可脱敏列出/关闭房间；关闭房间保持只读快照并拒绝新命令；24 小时无活动 lobby 自动关闭并释放成员；PostgreSQL `LISTEN/NOTIFY` 撤销监听会立即关闭关联 WebSocket。真实数据库并发/重启/关闭测试通过。
- T16：done / `908938b` / 新增焦点圈定、Escape 关闭和焦点恢复的 Dialog；行情变化动画计时器在卸载时清理；错误码映射为中文下一步提示；移动断点、reduced motion 和 44px 触控目标保留。
- T17：done / `908938b` / Web 版图改为显式资源表并仅打包压缩后的 `game_board.jpg` 与四张 `*_shares.png`；原图保留在 `manila_assets/`。新增预算测试冻结 5 MB 上限，生产构建图片合计约 1.77 MB。
- T18：done / `908938b` / 新增 3/4/5 人 × 两种海盗规则的权威 HTTP 整局矩阵、财务/生命周期/撤销/进程重启/输入边界 integration；新增三独立 Chromium 完整对局 E2E 和 CI `verify` + `e2e` 两个作业。
- T19：done / `626b8e9` / 多阶段 `Dockerfile`、`compose.prod.yaml`（Caddy HTTPS + app + 内部 PostgreSQL）、同源静态服务、生产配置门禁、备份/恢复脚本、`verify:deployment` 自检和 [部署手册](DEPLOYMENT.md) 已交付；本地生产形态、HTTPS/WSS E2E、重启持久化与真实备份恢复演练通过，证据见 4.2。
- T20：blocked / 工具已就绪（Phase 6 任务与验证脚本已提交），等待真实主机、域名、DNS、TLS 和秘密授权；未执行真实公网部署，也未对外上线。
- T21：done / `621a22f`、`bd4d8b9` / 纯前端重构见 [T21](tasks/T21-play-experience.md)：`npm test` 18 文件 71 测试、`npm run build`（JS gzip 112.60 kB，图片不变）通过；在本地 PostgreSQL + `SESSION_WRITE_RATE_LIMIT_MAX=100000 LOGIN_RATE_LIMIT_MAX=1000`（与 CI 相同）下，会话、三人竞拍、三人完整对局 3 条 Chromium E2E 通过（完整对局 29.5 s）；另以 1440×900 / iPhone 13 / 1180×820 三视口自动打完整局并人工复核截图。修正版图展示标注：港口泊位 A/C 与图面字母对调、修船厂同伙位移至右侧码头（仅标注名称，坐标未改），新增方向回归测试。未在真实手机物理设备上验收。
- T22：done / `b7bf437` / [T22](tasks/T22-bot-table-game-over.md)：`npm test` 20 文件 84 测试（新增机器人全决策类型合法性与终局画面渲染测试）、`npm run build`（JS gzip 116.79 kB，产物不含 `botDelay`）通过；放宽限流下 3 条 Chromium E2E 通过（完整对局 34.5 s）；`npm run bots -- --players 4 --phones 1 --delay 900` 有头四窗口实跑至终局（288 s，无卡死），另以 1440×900 与 iPhone 13 视口截图复核终局画面。限制：终局后玩家无法离房再开一局（服务端只允许大厅阶段离房）。
- 当前可启动：T20（Phase 5 已完成；Phase 6 需外部条件）。
- MVP 功能范围和生产部署形态已在本地真实链路验证；真实公网发布仍以 T20 为前提。

## 4.1 Phase 3/4 验证证据（2026-09-19，提交 `908938b`）

环境：Node v22.23.2、npm 10.9.8；真实 PostgreSQL 17（Docker，`manila_test`）；Chromium headless。

| 验证 | 结果与边界 |
| --- | --- |
| `npm test` | 16 文件、59 测试通过；新增结算分支、JSON 键序、Dialog 焦点、行情计时器、资源预算和版图热点用例 |
| `npm run build` | `tsc --noEmit` + Vite 成功；图片约 1.77 MB（board 814.40 kB + 四张 share 236.72–243.86 kB），JS 368.89 kB（gzip 110.91 kB），CSS 13.97 kB |
| `npm run test:integration` | 8 文件、23 测试通过；含 3/4/5 人 × 标准/加强海盗共 6 局服务端整局、非行动玩家财务、过期 revision、关闭房间只读、空置 lobby、撤销监听和重启恢复 |
| `npm run test:e2e` | 会话、三人竞拍和三人完整对局 3 条 Chromium 用例通过（完整对局约 30 s；需 `E2E_FULL_GAME=1`、运行中的 Web/服务和 CLI Token） |
| `npm run simulate` | 3/4/5 人各 20 局、固定 seed `20260918`、交替海盗规则全部状态合法 |
| CI | `.github/workflows/ci.yml` 新增干净安装/单元/构建/集成/模拟作业与 PostgreSQL + Chromium E2E 作业 |

未覆盖与限制：
- 整局浏览器 E2E 为控制时长采用“竞拍放弃、购股跳过”的保守策略；出价、抵押竞拍与购股由三人竞拍 E2E 和 integration 覆盖，不等同于随机策略下的完整资金矩阵。
- 未在真实 390px/1280px 物理设备上留存截图；移动布局由 CSS 断点、组件测试与浏览器可用性检查覆盖。
- 大厅超时使用可注入时钟的 integration 验证，未等待真实 24 小时。
- T19 部署、备份恢复和真实公网故障矩阵当时未实现；T19 已于提交 `626b8e9` 完成，证据见 4.2，真实公网部分归入 T20。

## 4.2 Phase 5 本地生产形态验证证据（2026-09-19，提交 `626b8e9`）

环境：Node v22.23.2、npm 10.9.8、Docker Engine + Compose v2、PostgreSQL 17-alpine、Caddy 2.8-alpine、Chromium headless。使用 `MANILA_DOMAIN=localhost` 和 Caddy 内部 CA 在 `https://localhost:8443` 完成本地生产形态演练；未使用真实公网域名。

| 验证 | 结果与边界 |
| --- | --- |
| `docker build -t manila-app:local .` | 多阶段镜像构建成功；运行时以非 root `manila` 用户、`node --import tsx` 启动，`WEB_DIST_DIR=/app/dist` |
| `npm run verify:deployment` | 在 `https://localhost:8443` 上 11/11 通过：HTTPS、live/ready、无数据库 URL 泄漏、SPA、hashed asset immutable、无效 Token、Cookie `Secure/HttpOnly/SameSite=Strict`、鉴权 API、登出、匿名 WSS 1008 |
| `npm run test:e2e`（生产形态） | 经 Caddy HTTPS/WSS 的三条 Chromium 用例全部通过：会话隔离与登出、三人竞拍、三浏览器完整对局（约 27 s） |
| 应用重启持久化 | `docker compose restart app` 后 `/health/ready` 200；重启前创建的会话 Cookie 调 `/api/session` 仍返回 200；`rooms/games/sessions` 计数不变 |
| 数据库隔离 | `docker compose port postgres 5432` 无映射；主机 `127.0.0.1:5432` 连接被拒绝 |
| 日志脱敏 | app 日志中数据库密码与 pepper 命中 0 次 |
| `npm run db:restore-drill`（生产 Compose） | 备份→`manila_prod_drill` 独立库恢复通过，逐表一致：access_tokens 1、sessions 16、rooms 3、room_members 9、games 3、commands 174、events 27 |
| 危险配置拒绝 | 空 `AUTH_PEPPER`、非 HTTPS `ALLOWED_ORIGINS`、缺少 `WEB_DIST_DIR`、错误 Origin、未知 `stateVersion` 均有测试覆盖并拒绝 |
| `npm test` / `npm run build` / `npm run test:integration` | 16 文件 62 测试、Vite 构建、8 文件 23 integration 全部通过 |

未覆盖与限制：
- 未在真实公网 DNS/TLS/主机上运行；本地演练使用 Caddy 内部 CA，`ALLOW_INSECURE=1` 仅用于自签证书自检。
- 备份恢复演练在同一 PostgreSQL 实例上完成，未覆盖异地存储和主机级磁盘故障。
- 升级回滚流程已写明，但未对不兼容迁移做自动化降级演练。
- 真实公网部署、真实域名证书和三浏览器公网对局属于 [T20](tasks/T20-public-launch.md)，当前 blocked，等待主机、域名和秘密授权。

后续完成记录按任务一行追加：任务 ID / done 或 blocked / 实现提交 / 执行的验证及结果 / 未解决限制。
修改功能所在路径时同步本页证据链接；审计数字保留其日期，新增验证另记，避免覆盖历史事实。
