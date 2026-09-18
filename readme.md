# Manila 私人多人网页版

目标是让本人和朋友持有效的 **8 位 Token**，通过各自浏览器进行 3–5 人 Manila。
服务器保存并裁决权威游戏状态，客户端只展示状态和提交操作。

规则引擎和本地热座原型仍在保留中。服务现已提供 Token 登录、持久 Cookie 会话和持久大厅；实时同步与对局命令将按路线图逐片接入。实际验证结果和已知问题见 [STATUS](docs/STATUS.md)。

## 开发导航

| 文档 | 唯一职责 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | coding agent 导航和核心约束 |
| [PROJECT_DIRECTION](docs/PROJECT_DIRECTION.md) | 产品范围与非目标 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 目标模块边界、鉴权、同步和持久化约定 |
| [ROADMAP](docs/ROADMAP.md) | Phase、任务依赖、Terra/Luna 分工 |
| [STATUS](docs/STATUS.md) | 当前代码事实、风险、完成记录和验证证据 |
| [tasks/](docs/tasks/) | 单任务 Goal、Scope、Non-goals、Dependencies、Acceptance Criteria、Validation |

## 当前目录与运行

- `packages/game/src/`：规则、seed RNG、不变量和模拟；[规则依据](马尼拉_中文规则_翻译.md)、[术语表](马尼拉_术语表.md)。
- `apps/web/src/`：真实规则驱动的本地热座原型、版图和行情轨道。
- `apps/server/src/`：Fastify 进程、PostgreSQL 连接与 SQL migration runner；尚未提供登录业务。
- `apps/server/migrations/`：按文件名排序、在单一事务中运行的数据库迁移。
- `apps/server/src/lobby/`：房间、成员、revision 和命令去重的持久大厅事务。
- `packages/protocol/src/`：登录、会话与稳定 API 错误码的严格 Zod schema。
- `scripts/simulate.ts`：随机整局验收；不是产品 AI。
- `annotator/`：静态标注工具和语义坐标 JSON；可直接打开 `annotator/index.html`，导入已有 JSON 后编辑。
- `manila_assets/`：原始图片；后续压缩资源时保留原图。

当前要求 Node.js >=22、npm >=10（见 [package.json](package.json)）：

```bash
npm ci
npm run dev
npm test
npm run simulate -- --games 20 --players 5 --seed 20260918
npm run build
```

### 本地 PostgreSQL 与服务底座

Docker Desktop 可用后，复制 `.env.example` 为 `.env` 并填入本地开发凭证。服务、迁移和 Token CLI 会自动读取根 `.env`。`DATABASE_URL` 必须指向 `manila`，`TEST_DATABASE_URL` 必须指向名称严格为 `manila_test` 的独立库；测试工具只会重建后者的 `public` schema。

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev:server
npm run test:integration
```

`/health/live` 仅表示进程存活；`/health/ready` 会在数据库不可达或迁移未完成时返回 `STORAGE_UNAVAILABLE`，不会输出连接信息。迁移 runner 在一个 PostgreSQL 事务和 advisory lock 内执行，失败时不会记录版本或留下部分业务表。

用主机 CLI 创建或撤销门禁 Token；创建时原始 Token 只输出一次，撤销使用输出的 Token ID：

```bash
npm run tokens -- create "friends"
npm run tokens -- revoke <token-id>
```

设置非空 `AUTH_PEPPER`。生产环境还要求 HTTPS 的逗号分隔 `ALLOWED_ORIGINS`，并强制 Secure、HttpOnly、SameSite=Strict 的 7 天绝对期 Cookie。Vite 开发服务器会将 `/api` 代理到 `MANILA_SERVER_URL`（默认 `http://127.0.0.1:3000`）。登录 API 对来源 IP 限制每分钟 5 次，认证写请求对会话限制每分钟 30 次。

端到端浏览器测试需要已运行的 Web/服务和由 CLI 生成的临时 Token：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 E2E_ACCESS_TOKEN=... npm run test:e2e
```

不传这两个变量时 E2E 用例会跳过，避免把测试 Token 写入仓库。

登录后可创建或输入房间码加入一个最多 5 人的私人大厅。大厅短轮询成员和准备状态；创建、加入、准备、规则变体和离开都带随机 `commandId`，已入房命令还带当前 `revision`，因此超时重试不会重复修改状态。房主始终是最低有效座位；成员变更、离开或海盗规则变更会清空全员准备。开局、公开房间列表、聊天和 WebSocket 仍未实现。

上述服务命令目前只建立基础存储能力，不构成可公网使用的多人服务。
