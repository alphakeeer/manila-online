# Manila 私人多人网页版

目标是让本人和朋友持有效的 **8 位 Token**，通过各自浏览器进行 3–5 人 Manila。
服务器保存并裁决权威游戏状态，客户端只展示状态和提交操作。

规则引擎和本地热座原型仍在保留中。服务底座现已提供 PostgreSQL migration 与健康检查；Token、房间和线上同步将按路线图逐片接入。实际验证结果和已知问题见 [STATUS](docs/STATUS.md)。

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

Docker Desktop 可用后，复制 `.env.example` 为 `.env` 并填入本地开发凭证。`DATABASE_URL` 必须指向 `manila`，`TEST_DATABASE_URL` 必须指向名称严格为 `manila_test` 的独立库；测试工具只会重建后者的 `public` schema。

```bash
docker compose up -d postgres
npm run db:migrate
npm run dev:server
npm run test:integration
```

`/health/live` 仅表示进程存活；`/health/ready` 会在数据库不可达或迁移未完成时返回 `STORAGE_UNAVAILABLE`，不会输出连接信息。迁移 runner 在一个 PostgreSQL 事务和 advisory lock 内执行，失败时不会记录版本或留下部分业务表。

上述服务命令目前只建立基础存储能力，不构成可公网使用的多人服务。
