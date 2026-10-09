# 目标架构

状态：MVP 设计，Phase 0–4 已实现并验证；当前代码事实见 [STATUS](STATUS.md)，范围见 [PROJECT_DIRECTION](PROJECT_DIRECTION.md)。

## 1. 结构与依赖边界

单个 Node.js 服务进程 + PostgreSQL + 同源 Web 静态资源。使用现有 React/TypeScript/Vite，新增 Fastify、@fastify/websocket、@fastify/static、Zod 和 pg + SQL migrations。
具体兼容版本在引入依赖的任务中锁定；不引入 ORM、共享 config 包、Redis 或微服务。

| 模块 | 目标路径 | 负责 | 不负责 |
| --- | --- | --- | --- |
| frontend | apps/web/ | 登录、大厅、接收者视图、临时表单、命令 pending/错误、重连 | 权威迁移、掷骰、完整 GameState、数据库 |
| server | apps/server/src/ | 会话、房间、授权、串行命令、调用 game、视图投影、连接与广播 | 复制游戏规则、浏览器交互 |
| game | packages/game/ | createGame/getDecision/transition/validateState/getStandings、seed RNG | 用户身份、网络、SQL、系统时钟、全局随机源 |
| protocol | packages/protocol/ | 线上的命令/视图/错误及 Zod schema；按切片逐步加入 | 导出完整 GameState、执行裁决、数据访问 |
| persistence | apps/server/src/persistence/ | SQL migrations、事务、快照、会话、幂等结果、读取恢复 | 广播、业务规则、独立服务 |
| tools | annotator/、scripts/ | 坐标编辑、规则模拟 | 生产 HTTP 路由或后台管理 |

目标生产依赖：web → protocol；server → protocol + game + persistence。game 不依赖其他层，persistence 仅类型依赖 game，protocol 不运行或重新实现 game。
前端展示常量以稳定公开字段组织；服务端适配 protocol 输入为 GameAction，并填入会话确定的 playerId。
迁移任务仅移动实际已有模块；不提前创建空服务端/协议包。标注器和原图留在原位置，避免纯路径改动扩大范围。

生产 Web 入口是网络客户端，不打包 game 的运行时或完整状态类型；规则 fixture 仅用于测试，不属于产品状态。生产镜像在运行时使用锁定版本的 `tsx` 执行服务端 TypeScript，单进程同源提供静态资源、REST 和 WSS。

## 2. Token、会话和座位

- 门禁 Token 为 8 个字符：`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`，输入去首尾空白并转大写后校验长度与字符；不是限定 8 位数字。
- 服务端使用密码学随机源生成 Token。数据库存带服务端秘密 pepper 的 HMAC-SHA-256 摘要、Token ID、撤销状态；不存明文，pepper 不入库。
- 登录页公开；HTTPS POST /api/session 验证 Token，生成高熵随机会话凭证。数据库仅保存其摘要，Cookie 为 HttpOnly、Secure、SameSite=Strict。
- 同源本地 HTTP 开发可显式关闭 Secure；生产配置缺少安全属性时拒绝启动。Token/Cookie 不进入 URL、localStorage、响应日志或 Git。
- Token 可发给多位朋友；每个浏览器会话有独立身份。一个会话最多处于一个未结束房间；房间内绑定一个稳定 playerId。
- 保留 Cookie 的刷新/重连恢复原座位。会话有效期默认 7 天、绝对过期，可配置；重新输入门禁 Token 建立新会话，不自动夺取旧座位。
- 座位接回（T23，2026-10 起）：新会话可在对局中通过“房间码 + 原昵称（不区分大小写）”接回座位，但仅限该座位正由机器人托管，或其原会话已撤销/过期/Token 被撤销；在线玩家的座位不可被接回。理由：朋友局里退出登录、换设备或清 Cookie 后能回到牌局，比“座位永久丢失”更重要；Token 门禁内的朋友可冒用昵称这一风险被接受，原玩家可用同一方式再接回。
- 邀请链接 `/?join=<房间码>` 只携带房间码（房间码不是凭证，本就不替代鉴权）；Token 仍只在登录框输入，绝不进入 URL。昵称记在 localStorage 只为便利，非身份。
- 每个受保护 REST 请求、WS 握手与入站消息验证会话和 Token 状态。撤销立即关闭关联连接，过期由连接心跳检查（最长 30 秒）关闭；旧座位保留，等待管理员关闭异常房间。
- Cookie 写请求和 WS 握手检查精确 Origin allowlist；登录也校验 Origin。限流按来源 IP 和会话，可信代理配置明确，限制 Token 尝试、消息大小和频率。
- Token 管理通过主机 CLI；没有 Web 管理员账号。缺少 pepper/数据库配置时不得用默认 Token 或内存仓库启动生产。

Token 生成和摘要可使用 [Node crypto](https://nodejs.org/api/crypto.html) 的随机和 HMAC API；这里的字符集和会话政策是为本 MVP 选定的设计，不是当前实现或 Manila 桌游规则。8 位门禁强度有限，HTTPS、限流和可撤销不可省略。

## 3. 房间生命周期

`lobby → playing → finished`；管理员可将 lobby/playing/finished 标记为 closed。

- 创建者是房主；加入需有效会话和不可预测的房间码，房间码不替代鉴权。
- 大厅允许 3–5 人开局；所有成员准备，房主发开始命令。昵称只是显示文本，重复名字不合并身份，按纯文本渲染。
- 大厅成员加入/离开/变更规则配置会清除准备；房主离开则按座位顺序移交，无成员时关闭。
- 开局锁定成员、座位和规则；第一位出价者由服务端以密码学随机源从全部已准备成员中选取，后续由引擎决定。服务端产生 uint32 seed 并保存，不下发。
- 座位托管（T23，替代原“掉线不代打”）：`room_members.autopilot` 为 NULL（本人）、`away`（服务端自动托管）或 `manual`（本人主动托管）。轮到某座位决策时，若其无连接超过 `AUTOPILOT_AWAY_MS`（默认 30 秒）或其会话已失效，服务端标记 `away` 并以“稳健”策略代为决策（放弃竞拍、不购股、仅低风险放置）；`manual` 则在思考间隔（`AUTOPILOT_THINK_MS`，默认 1.5 秒）后行动。代打动作只从该座位的 DecisionView 中选择，走与人类命令相同的事务（先锁会话再锁房间、revision 校验、引擎裁决、事件与审计记录，commandId 以 `autopilot:` 前缀），不改变规则。玩家重连自动结束 `away`；本人提交任何命令或点“我回来了”结束托管。计时器只在进程内，重启后由周期巡检重建。
- 已结束游戏提供最终排名和只读记录；玩家可“返回大厅”（仅解除会话与已结束/已关闭房间的关联，成员记录保留供他人查看排名），再次游玩创建新房间，不复用旧 revision。
- presence 仅表示瞬时连接状态，准备/成员仍由持久快照表达；presence 不修改游戏 revision；显式退出登录会撤销该会话，其座位立即进入托管，可按上文规则接回，游戏中需提醒确认；同一会话多标签页共享身份，多个连接以统一命令队列处理。
- 只有 lobby 在默认 24 小时无持久业务活动后自动关闭（可配置）；playing 不自动过期，管理员可显式关闭。数据库保留已关闭记录，首版不自动删除存档。

## 4. 接收者视图

所有响应由服务端白名单投影，REST、WS、命令 ACK、历史和错误都遵守同一边界。

| 视图 | 允许内容 |
| --- | --- |
| 公共 | 房间成员/座位/准备、版图和同伙、舢板/泊位、行情、航程/阶段、行动玩家、已掷骰子、公开竞拍金额/领先者、股份供应数量 |
| self | 本人的现金、股份与抵押状态、可用财务操作；仅轮到本人时提供私人 DecisionView |
| 终局 | 公开最终总财富和名次；仍不公开其他玩家完整股份与现金明细 |
| 永不发送 | RNG/seed、完整 GameState、会话/Token 摘要、其他人的现金/股份/抵押 IDs、拍卖抵押声明、原始命令审计对象 |

“私人”指不主动下发真实明细，不承诺阻止玩家根据公开行动推算资金。
不能直接序列化 GamePhase 或 GameEvent：例如最高出价可能带 mortgageShareIds，购股事件含可关联的 shareId。
购买命令推荐以 commodity 表达意图；服务端从供应堆选定 shareId，玩家自己的抵押/赎回使用其私有视图中的 shareId。
DecisionView 按切片扩展；客户端不通过全局 GameState 计算下一位玩家或合法动作。

结算通过只读 `voyageSettled` 事件记录逐项收入/支付，公开船只与行情、私有明细分别投影；追加事件不改变资金、阶段或 RNG 行为。
客户端播放动画不阻塞服务端状态推进，不要求所有人确认动画才能进行下一步。

## 5. 协议与权威事务

MVP 固定：REST 提交命令，WebSocket 只用于订阅和接收通知，避免维护两套写入口。
最小消息：room.snapshot、room.presence、session.expired；每次接受命令下发完整的接收者快照，不做增量 patch 或断线事件回放。

- 已入房 REST 命令包含 protocolVersion、commandId、expectedRevision、action；房间由受会话授权的 URL room code 选择，绝不接受客户端 roomId 或 playerId。action 严格 schema 拒绝额外字段。创建房间尚无 revision，以会话为范围做 commandId 去重并锁会话行；加入提交房间码，无需预先获取成员快照或 expectedRevision，由服务端锁定目标房间并检查容量和单房间约束。
- 每房间一个 revision，覆盖大厅持久变更和游戏动作；一次成功写操作 +1，拒绝/重复不增加。已入房客户端展示 revision N 时只能提交 expectedRevision=N；创建/加入是上述明确例外。
- 每会话每房间的 commandId 是随机唯一 ID。超时重试保持同 ID、同 payload、同 expectedRevision；更换动作或确认新状态后重新提交必须使用新 ID。
- 事务流程：验证当前有效会话/Token → 按统一锁顺序锁定必要的会话/房间 → 查本会话幂等记录 → 校验新命令权限/成员关系 → 比较 revision → 映射动作/调用引擎 → 检查不变量 → 写新快照、revision、结果与事件 → commit → ACK 和逐接收者广播。
- 相同 ID 和 payload 返回此前结果；相同 ID 不同 payload 拒绝。幂等检查先于 revision 检查，才能处理“已提交但 ACK 丢失”的重试。
- 已成功离房的命令允许同一有效会话重取安全结果摘要，不因其已不是成员而重复执行；任何新的快照/历史读取仍检查当前成员关系。
- schema/鉴权失败不记录幂等结果；经过鉴权的业务拒绝也记录安全结果摘要，同 ID 重试不得后来变成成功。
- 一般游戏动作由引擎校验回合；财务动作允许游戏中非当前行动玩家操作自己的股份，不应一概拦截成“非本人回合”。
- 唯一写入通道使用数据库事务/行锁；进程内房间队列负责调度，不能作为持久正确性的唯一保障。
- 接受确认只能在 commit 后发送。广播失败不回滚已提交状态；连接重建读最新快照。不引入事务 outbox/消息队列；连接心跳同时携带最新 room revision，发现落后即拉取快照，保证连接未断但广播漏送时也能收敛。
- 不把异常数据库详情或私有状态回传；错误码至少区分 AUTH_REQUIRED、TOKEN_REVOKED、NOT_MEMBER、REVISION_CONFLICT、COMMAND_ID_REUSED、RULE_REJECTED、STORAGE_UNAVAILABLE。

数据库行锁约定依据 [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)。
WS 身份检查在握手和订阅时执行；WS 消息序列化不能依赖 HTTP 响应钩子，参见 [@fastify/websocket](https://github.com/fastify/fastify-websocket)。

## 6. 恢复与持久化

逻辑数据：access_tokens、sessions、rooms、room_members、games、commands、events；按当前切片新增表，不预建未来字段。

- games 保存完整 JSON 快照、stateVersion、rulesVersion；room 保存 revision；协议另有 protocolVersion，三者不混用。
- 房间命令 commands 唯一键为 (roomId, sessionId, commandId)，包含请求指纹、结果和接受 revision；events 包含事件 ID、revision、可见范围。
- 快照是恢复依据，事件用于展示和排障；不依赖从初始状态重放全部事件恢复。
- 游戏种子、RNG、已抵押股份和所有阶段内部字段必须持久化。加载前做形状/版本及不变量验证，未知版本隔离房间并报告，禁止重建一局覆盖原存档。
- 重连先读取最新接收者快照，再建立订阅；服务端按房间队列串行化订阅初始快照和随后广播，客户端忽略旧 revision，避免“快照与订阅之间丢更新”。
- 客户端忽略旧 revision；断线立即禁用游戏写入，以带抖动的指数退避恢复。新快照确认前不开放写入；pending 命令以原 commandId 查询/重试。
- 服务重启后从数据库恢复会话、成员和状态；连接 presence 重建。进程启动不自动掷骰、不重复结算。
- 数据库故障时拒绝写操作，保留已提交状态；不切换内存模式或显示伪成功。

## 7. 部署及演进限制

单台公网服务器，HTTPS 反向代理 + 一个 Node 服务 + PostgreSQL 持久卷。静态资源、REST 与 WSS 同源；生产不使用 Vite dev server。
/health/live 检查进程，/health/ready 检查迁移与数据库；日志只含请求 ID、roomId、revision、错误码，排除凭证和私有 payload。

T19 已提供多阶段 `Dockerfile`、`compose.prod.yaml`（app + Caddy + 不暴露端口的 PostgreSQL）、同源静态服务（`WEB_DIST_DIR`）、备份/恢复脚本、部署自检脚本和 [部署手册](DEPLOYMENT.md)；生产配置强制 HTTPS Origin、pepper、`WEB_DIST_DIR` 与 Secure Cookie。首次真实部署需有实际主机、域名和秘密配置，属于 T20。
改变上述决策时在本文对应段落记录理由并同步受影响任务。不得因代码容易实现而悄悄改变规则、身份模型或持久化保证。
