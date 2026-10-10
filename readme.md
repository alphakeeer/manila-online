# Manila 马尼拉 · 私人多人网页版

和朋友在各自的浏览器里玩一局 3–5 人的桌游《马尼拉》（Manila）：竞拍港务长、押注货物、派同伙上船、收买海盗与领航员，看谁在马尼拉黑市赚得最多。

- **私人**：只有持有效 **8 位访问 Token** 的人才能进入，不需要注册账号。
- **服务器权威**：所有规则由服务器裁决，浏览器只显示自己能看的信息并提交操作；别人的现金与股份不会下发到你的浏览器。
- **手机电脑都能玩**：桌面三栏布局，手机为版图 + 可收起的底部操作面板。
- **掉线不卡局**：有人离开时机器人稳健代打，回来后原样接回座位。
- **一条命令部署**：一台装了 Docker 的服务器 + 一个域名即可上线，自动 HTTPS。

> 当前状态：功能完整，已在本机生产形态（Caddy HTTPS + Docker）完整验证；**尚未在真实公网主机上线**（见 [T20](docs/tasks/T20-public-launch.md)）。逐项验证证据见 [STATUS](docs/STATUS.md)。

---

## 目录

1. [玩起来是什么样](#1-玩起来是什么样)
2. [快速开始（本地开发）](#2-快速开始本地开发)
3. [本地看机器人对局](#3-本地看机器人对局)
4. [部署到公网](#4-部署到公网)
5. [架构](#5-架构)
6. [目录结构](#6-目录结构)
7. [命令速查](#7-命令速查)
8. [配置项](#8-配置项)
9. [测试与质量](#9-测试与质量)
10. [运维与管理](#10-运维与管理)
11. [开发约定](#11-开发约定)
12. [已知限制](#12-已知限制)
13. [文档导航](#13-文档导航)

---

## 1. 玩起来是什么样

### 进门与组局

1. 房主把 **Token** 和 **邀请链接**（或二维码）发给朋友。链接形如 `https://你的域名/?join=房间码`，只带房间码，不带 Token。
2. 朋友打开链接 → 输入（或直接粘贴）Token → 房间码已自动填好；之前用过的昵称会被记住，直接入座。
3. 房间页显示 5 个座位、谁已准备；3–5 人全部准备后，房主选择海盗规则（标准 / 加强）并点“开始竞拍”。

### 对局界面

| 区域 | 内容 |
| --- | --- |
| 顶栏 | 航程数、当前阶段（竞拍 → 港务长 → 放置 → 航行）、房间码与连接状态、音效开关、托管开关 |
| 玩家条 | 每个人的头像色、行动中/港务长/当前出价/机器人托管标记、剩余同伙；自己的现金带增减动画 |
| 版图 | 真实桌游版图；舢板在航道与泊位间平滑移动，同伙标记显示昵称首字，行情标记随结算跳动 |
| 操作面板 | 只在轮到你时出现：竞拍步进器与快捷出价、商品卡片、按航道下水（版图实时预览）、按区域分组的放置列表（附规则提示）、带骰面与落点的推进按钮、领航走法预览、海盗登船/劫掠 |
| 航海日志 | 由前后两次快照的差异生成：谁出价、谁放弃、掷骰、谁把同伙派到哪、靠港、遭劫、行情变化 |
| 我的钱袋 | 股份卡片、随时抵押（+12）/赎回（15）、各航程账本 |

轮到你时会有横幅、标题提示、手机振动和提示音；每个航程结束弹出个人结算卡；终局显示冠军、领奖台、统计卡与三张图（每航程收益、收入来源、货物行情走势），之后可“返回大厅”再开一局。

### 中途离开怎么办

| 情况 | 结果 |
| --- | --- |
| 关掉页面、断网 | 轮到你且离线超过 30 秒，服务器的机器人替你“稳健”行动（放弃竞拍、不买股份、只做低风险放置）；同一浏览器重新打开即自动接回 |
| 点“🤖 托管” | 立即交给机器人，点“我回来了”或自己操作任意一步即接回 |
| 点“退出”登录 / 换手机 | 座位立即托管；重新输入 Token，在“加入朋友”里填**原房间码 + 原昵称**即可接回 |

在线玩家的座位不会被别人接走。机器人只从服务器给该座位的合法选项中选择，与真人操作走同一套规则裁决和审计记录。

---

## 2. 快速开始（本地开发）

### 前置条件

- Node.js **≥ 22**、npm **≥ 10**
- Docker（用于本地 PostgreSQL）

### 步骤

```bash
npm ci
cp .env.example .env
```

编辑 `.env`（示例值，仅本机使用）：

```dotenv
POSTGRES_USER=manila
POSTGRES_PASSWORD=换成本地密码
POSTGRES_PORT=54329
DATABASE_URL=postgresql://manila:换成本地密码@127.0.0.1:54329/manila
TEST_DATABASE_URL=postgresql://manila:换成本地密码@127.0.0.1:54329/manila_test
MANILA_ENV=development
PORT=3000
ALLOWED_ORIGINS=http://localhost:5173
AUTH_PEPPER=任意一段长随机字符串
```

`TEST_DATABASE_URL` 的库名必须严格为 `manila_test`，测试会重建它的 `public` schema；开发库 `manila` 不会被测试触碰。

```bash
docker compose up -d postgres
npm run db:migrate
npm run tokens -- create "me"
```

最后一条会打印一个 8 位 Token（只显示一次）。然后分别在两个终端启动后端与前端：

```bash
npm run dev:server
```

```bash
npm run dev
```

打开 <http://localhost:5173>，输入 Token。想一个人试玩多人对局，可以用不同浏览器（或无痕窗口）各登录一次，每个浏览器是一个独立玩家；或直接看下一节的机器人对局。

Vite 会把 `/api`（含 WebSocket）代理到 `MANILA_SERVER_URL`（默认 `http://127.0.0.1:3000`）。

---

## 3. 本地看机器人对局

一条命令打开多个真实浏览器窗口，每个窗口一个独立会话，自动建房、加入、准备、开局，并由随机机器人打完整局；终局后窗口保留，可查看结算画面。

```bash
npm run dev:server:relaxed
```

```bash
npm run dev
```

```bash
npm run bots -- --players 4 --phones 1 --delay 1200 --variant strengthened
```

| 参数 | 说明 |
| --- | --- |
| `--players 3-5` | 座位数（默认 3） |
| `--phones N` | 其中几个窗口用手机视口（默认 1） |
| `--delay 毫秒` | 机器人每步思考时间（默认 1200） |
| `--variant standard\|strengthened` | 海盗规则 |
| `--token XXXXXXXX` | 指定 Token；不填会在本地库创建标签为 `bot-table` 的测试 Token |
| `--exit` | 终局后自动关闭窗口 |

`dev:server:relaxed` 放宽了登录与写操作限流（与 CI 相同），否则机器人很快会触发默认的 30 次/分钟写限制。每个窗口右上角的“🎲 随机托管”可暂停该座位，由你亲自接手。

这个随机机器人只在 Vite 开发服务器上通过 `?bot=1&botDelay=毫秒` 启用，**生产构建中不存在**；它与第 1 节服务器端的“稳健托管”是两回事。

---

## 4. 部署到公网

需要：一台有公网 IP 的 Linux 服务器（已装 Docker Engine 与 Compose v2）、一个解析到它的域名、防火墙放行 80/443。

```bash
git clone <本仓库> /opt/manila && cd /opt/manila
scripts/deploy.sh --domain manila.example.com
```

脚本会：检查 Docker → 首次生成 `.env.production`（随机数据库密码与 `AUTH_PEPPER`，权限 600、不进 Git）→ 构建并启动 Caddy + 应用 + PostgreSQL → 等待容器内与 `https://域名` 就绪（首启签发证书约 1 分钟）→ 没有可用 Token 时签发一个并打印 → 打印后续命令。可重复执行，不会覆盖已有秘密。

| 场景 | 命令 |
| --- | --- |
| 升级（先自动备份数据库） | `git pull && scripts/deploy.sh --update` |
| 再发几个 Token | `scripts/deploy.sh --tokens 3` |
| 换域名 | `scripts/deploy.sh --domain new.example.com` |
| 在本机演练生产形态 | `scripts/deploy.sh --local`（`https://localhost`，Caddy 内部 CA） |
| 部署后自检（11 项） | `PUBLIC_BASE_URL=https://域名 E2E_ACCESS_TOKEN=... npm run verify:deployment` |

**务必把 `.env.production`（尤其 `AUTH_PEPPER`）和数据库备份另存到服务器之外。** 丢失 pepper 后所有 Token 与会话都无法再校验。手工部署步骤、升级回滚、备份恢复演练见 [部署手册](docs/DEPLOYMENT.md)。

生产形态：

```
浏览器 ──HTTPS/WSS──▶ Caddy ──HTTP──▶ Node 应用（Fastify） ──▶ PostgreSQL
            80/443      自动证书        app:3000              仅内部网络，不映射端口
```

---

## 5. 架构

### 5.1 模块与依赖

```
apps/web  ──▶ packages/protocol ◀── apps/server ──▶ packages/game
(浏览器)        (线上契约/Zod)        (权威服务)        (纯规则引擎)
```

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| `packages/game` | 纯 TypeScript 规则状态机：开局、合法决策、状态迁移、结算、终局、种子化 RNG、不变量校验、整局模拟 | 身份、网络、数据库、系统时钟 |
| `packages/protocol` | 线上命令/视图/错误码的严格 Zod schema；前后端共用的托管决策 `chooseAction` | 执行规则、导出完整游戏状态 |
| `apps/server` | Token 与会话、房间、命令事务、调用引擎、按接收者投影视图、WebSocket 广播与在线状态、座位托管 | 复制规则、浏览器交互 |
| `apps/web` | 登录、大厅、对局界面与动画、命令提交/重试/重连 | 裁决规则、持有完整状态 |

浏览器端不打包规则引擎，也拿不到完整游戏状态。

### 5.2 一次操作的生命周期

1. 浏览器 `POST /api/rooms/:code/commands`，携带 `protocolVersion`、随机 `commandId`、当前 `expectedRevision` 和动作。
2. 服务器在一个数据库事务里：校验会话与 Token → 按固定顺序加锁（**先会话、后房间**）→ 查幂等记录（同一 `commandId` 重试返回同一结果）→ 比对 revision → 把动作交给引擎裁决 → 校验不变量 → 写入新快照、revision、事件与命令结果。
3. 提交后，服务器用一次一致读取为每位在线玩家生成**各自的**视图，经 WebSocket 推送（`room.snapshot`）；在线状态另发 `room.presence`。
4. 浏览器只接受不旧于当前的 revision，并从前后快照差异生成日志与动画。断线时禁止提交，指数退避重连后先拉最新快照；未确认的命令以原 `commandId` 重试。

### 5.3 视图与隐私

| 谁能看到 | 内容 |
| --- | --- |
| 所有人 | 成员与座位、版图、同伙位置、舢板与泊位、行情、阶段与行动者、已掷骰子、公开出价、股份剩余数、托管状态、终局排名与财富 |
| 只有本人 | 自己的现金、股份与抵押状态、轮到自己时的决策选项、各航程个人收支明细 |
| 永不下发 | 随机种子与 RNG 状态、完整游戏状态、会话/Token 摘要、他人的现金与股份 |

### 5.4 身份、会话与座位

- Token 为 8 个字符（`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`），数据库只存加 pepper 的 HMAC 摘要；登录后发放 HttpOnly + SameSite=Strict（生产另加 Secure）的会话 Cookie，默认 7 天。
- 同一个 Token 可以发给多位朋友，每个浏览器会话是一个独立玩家；一个会话同时只在一个未结束的房间里。
- 座位托管状态存于 `room_members.autopilot`（空 / `away` / `manual`），计时器只在进程内，服务重启后由周期巡检重建；详见 [ARCHITECTURE](docs/ARCHITECTURE.md) 第 2、3 节。

### 5.5 持久化与恢复

PostgreSQL 表：`access_tokens`、`sessions`、`rooms`、`room_members`、`games`（完整 JSON 快照 + 种子 + 版本）、`commands`（幂等结果与审计）、`events`（公开/私有事件）。迁移位于 `apps/server/migrations/`，启动时在单一事务与 advisory lock 内按序执行。

恢复以快照为准，不依赖事件重放；加载时校验版本与不变量，异常存档会被隔离而非覆盖。服务重启后会话、房间和对局都能继续。

---

## 6. 目录结构

```
.
├── apps/
│   ├── server/                 # Fastify 服务
│   │   ├── migrations/         # 按文件名排序的 SQL 迁移
│   │   ├── scripts/            # 管理 CLI：tokens / rooms / migrate
│   │   └── src/
│   │       ├── auth/           # Token 与会话凭证、限流
│   │       ├── lobby/          # 房间、成员、准备、离开、座位接回
│   │       ├── game/           # 权威命令、视图投影、结算历史、座位托管
│   │       ├── realtime/       # 按房间串行的广播、在线状态、撤销监听
│   │       └── persistence/    # 连接池、事务、迁移
│   └── web/
│       └── src/
│           ├── assets/         # 由原图生成的 WebP 版图与股份图
│           └── ui/             # 登录/大厅、对局界面、操作面板、版图、终局画面
├── packages/
│   ├── game/                   # 规则引擎、RNG、不变量、模拟
│   └── protocol/               # Zod 协议与共享托管决策
├── tests/
│   ├── integration/            # 真实 PostgreSQL + HTTP + WebSocket
│   └── e2e/                    # Playwright 多浏览器全链路
├── scripts/                    # 部署、备份恢复、自检、机器人对局、基准、图片压缩、规则模拟
├── deploy/Caddyfile            # HTTPS 反向代理
├── annotator/                  # 版图坐标标注工具与语义坐标 JSON
├── manila_assets/              # 原始美术素材（只作来源，不直接打包）
├── docs/                       # 产品方向、架构、路线图、状态、部署手册、任务卡
├── Dockerfile · compose.yaml · compose.prod.yaml
├── 马尼拉_中文规则_翻译.md · 马尼拉_术语表.md
└── AGENTS.md                   # coding agent 导航与约束
```

---

## 7. 命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 前端开发服务器（:5173） |
| `npm run dev:server` | 后端开发服务器（:3000，文件改动自动重启，启动时自动迁移） |
| `npm run dev:server:relaxed` | 同上，但放宽限流，供机器人对局与 E2E 使用 |
| `npm run build` | 类型检查 + 生产构建到 `dist/` |
| `npm test` | 单元与组件测试 |
| `npm run test:integration` | 真实 PostgreSQL 集成测试（使用 `manila_test`） |
| `npm run test:e2e` | Playwright 浏览器测试（见第 9 节所需变量） |
| `npm run simulate -- --games 20 --players 5 --seed 20260918` | 用固定种子随机打多局，校验规则引擎不卡死、不出非法状态 |
| `npm run bots -- ...` | 多窗口机器人对局（第 3 节） |
| `npm run bench:server` / `npm run bench:web` | 广播延迟基准 / 模拟手机 4G 冷加载基准 |
| `npm run db:migrate` | 执行数据库迁移 |
| `npm run tokens -- create\|list\|revoke` | 管理访问 Token |
| `npm run db:backup` / `npm run db:restore-drill` | 备份 / 恢复演练（生产 Compose） |
| `npm run verify:deployment` | 部署后自检 |
| `scripts/deploy.sh` | 一条命令部署（第 4 节） |
| `python3 scripts/optimize-assets.py` | 从 `manila_assets/` 重新生成 WebP 图片 |

---

## 8. 配置项

开发读取根目录 `.env`；`scripts/deploy.sh` 部署读取 `.env.production`（模板见 `.env.production.example`）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MANILA_ENV` | `development` | `production` 时强制 HTTPS Origin、pepper、静态目录与 Secure Cookie |
| `DATABASE_URL` | — | PostgreSQL 连接串（必填） |
| `TEST_DATABASE_URL` | — | 仅测试；库名必须为 `manila_test` |
| `AUTH_PEPPER` | — | Token 与会话摘要的服务器秘密；生产必填，需单独备份 |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | 允许写请求与 WebSocket 的精确 Origin，逗号分隔 |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | 监听地址 |
| `WEB_DIST_DIR` | — | 同源提供前端构建产物的目录（生产必填） |
| `TRUST_PROXY` | 生产为 `true` | 信任反向代理传来的客户端地址 |
| `SESSION_TTL_MS` | 7 天 | 会话绝对有效期 |
| `LOBBY_IDLE_TIMEOUT_MS` | 24 小时 | 无活动大厅自动关闭 |
| `LOGIN_RATE_LIMIT_MAX` | 5 | 每 IP 每分钟登录次数 |
| `SESSION_WRITE_RATE_LIMIT_MAX` | 30 | 每会话每分钟写请求数 |
| `AUTOPILOT_AWAY_MS` | 30000 | 轮到离线玩家多久后由机器人接手 |
| `AUTOPILOT_THINK_MS` | 1500 | 托管机器人每步的停顿 |
| `LOG_LEVEL` | `info` | 日志级别（日志不含凭证与私有数据） |
| `MANILA_SERVER_URL` | `http://127.0.0.1:3000` | 仅 Vite 开发代理目标 |

生产部署另用 `MANILA_DOMAIN`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`MANILA_IMAGE_TAG`（见 `.env.production.example`）。

---

## 9. 测试与质量

| 层级 | 位置 | 规模（最近一次） | 覆盖 |
| --- | --- | --- | --- |
| 单元/组件 | `packages/*/src/__tests__`、`apps/*/src/**/__tests__` | 20 文件 · 85 测试 | 规则回归、协议、托管决策、事件日志、版图坐标、终局画面、样式约束、资源预算 |
| 集成 | `tests/integration` | 9 文件 · 27 测试 | 会话与撤销、大厅并发、命令幂等与 revision、私有投影、WebSocket 广播、财务、生命周期与重启、3/4/5 人 × 两种海盗规则整局、座位托管与接回 |
| 端到端 | `tests/e2e` | 3 个用例 | 两浏览器会话隔离与登出、三人实时竞拍、三浏览器完整对局 |
| 规则模拟 | `npm run simulate` | 3/4/5 人各 20 局 | 固定种子随机整局，状态始终合法 |

E2E 需要运行中的前后端和一个 Token：

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5173 E2E_ACCESS_TOKEN=你的Token E2E_FULL_GAME=1 npm run test:e2e
```

完整对局用例出手很快，请用 `npm run dev:server:relaxed` 启动后端。未提供 Token 时 E2E 自动跳过，避免把测试 Token 写进仓库。CI（`.github/workflows/ci.yml`）在干净环境中执行安装、单元、构建、集成、模拟与 E2E。

性能基线（`npm run bench:*`，详见 STATUS）：版图与股份图片 342 KB；模拟手机 4G 下进入对局约 1 秒；5 人在线时一次操作到全员收到更新 p50 约 5.5 ms。

---

## 10. 运维与管理

```bash
npm run tokens -- create "friends"     # 新 Token，原文只显示一次
npm run tokens -- list                 # 列出（不显示原文）
npm run tokens -- revoke <token-id>    # 撤销：相关会话立即断开
npm run rooms -- list                  # 列出房间
npm run rooms -- close <room-code>     # 关闭房间，保留只读记录
```

生产环境在容器内执行，例如：

```bash
docker compose --env-file .env.production -f compose.prod.yaml exec -T app node --import tsx apps/server/scripts/tokens.ts list
```

- `/health/live`：进程存活；`/health/ready`：数据库可达且迁移完成。
- 备份：`scripts/backup-db.sh`；恢复演练：`scripts/restore-drill.sh`（恢复到独立库逐表比对）。
- 升级回滚、日志查看与排障见 [部署手册](docs/DEPLOYMENT.md)。

---

## 11. 开发约定

完整约束见 [AGENTS.md](AGENTS.md)，要点：

- 服务器持有并裁决权威状态；客户端只显示接收者视图并提交命令；私有字段和随机数不出服务器，不靠前端隐藏来做隔离。
- **规则修改**必须附最小复现、规则依据（[中文规则](马尼拉_中文规则_翻译.md)）和回归测试，且与结构调整分开提交。
- 每次聚焦一个任务卡（`docs/tasks/`）；新增范围先写任务卡并更新 [ARCHITECTURE](docs/ARCHITECTURE.md)。
- 完成后在 [STATUS](docs/STATUS.md) 记录任务 ID、提交和验证证据；计划不写成已完成。
- 数据库事务遵守“先会话、后房间”的加锁顺序。

---

## 12. 已知限制

- 尚未在真实公网主机、真实域名证书下验收（T20 需要服务器、域名与授权）。
- 没有公开房间列表、聊天、观战或排行榜；不提供强 AI，托管机器人只求“不坑队友”。
- 同一 Token 下的朋友理论上可以用他人昵称接回其**正在托管**的座位，这是为“退出/换设备后能回来”所接受的风险。
- 未在真实手机实体设备上留存验收截图；手机布局由组件测试与浏览器手机视口检查覆盖。
- 备份恢复演练在同一 PostgreSQL 实例上完成，未覆盖异地存储与磁盘故障。

---

## 13. 文档导航

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | coding agent 导航与核心约束 |
| [PROJECT_DIRECTION](docs/PROJECT_DIRECTION.md) | 产品目标、范围与非目标 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 模块边界、鉴权、同步、持久化、托管与接回的决策与理由 |
| [ROADMAP](docs/ROADMAP.md) | 阶段、任务依赖与分工 |
| [STATUS](docs/STATUS.md) | 当前代码事实、完成记录与验证证据 |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | 部署、升级、备份恢复与运维手册 |
| [docs/tasks/](docs/tasks/) | 每个任务的目标、范围、验收与验证方式 |
| [马尼拉_中文规则_翻译.md](马尼拉_中文规则_翻译.md) · [马尼拉_术语表.md](马尼拉_术语表.md) | 规则依据与术语 |
