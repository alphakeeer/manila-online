# 单机公网部署与运维手册

本手册对应 [T19](tasks/T19-deployment.md)，目标是在一台 Linux 公网服务器上以单机 Compose 形态运行 Manila。架构边界见 [ARCHITECTURE](ARCHITECTURE.md)，当前验证证据见 [STATUS](STATUS.md)。

> 真实域名、DNS、证书和秘密必须由项目所有者提供。仓库不会自动购买资源、上传秘密或声称已经上线；首次真实上线属于 [T20](tasks/T20-public-launch.md)。

## 1. 生产形态

```
Browser ──HTTPS/WSS──> Caddy ──HTTP──> Node app ──> PostgreSQL
               80/443           app:3000        postgres:5432 (仅内部网络)
```

- 单个 `app` 容器：Fastify + `@fastify/static` 同源提供 `dist/`、REST、WebSocket；启动时自动执行排序迁移。
- `caddy` 容器：自动申请/续期 TLS，反向代理 Web/API/WSS，附加 HSTS 等安全头。
- `postgres` 容器：持久卷保存房间、游戏、命令、事件、Token 和会话；**不映射主机端口**。
- 只有 Caddy 暴露 80/443；数据库不对公网开放。

生产配置要求（由 `loadConfig` 强制）：
- `MANILA_ENV=production`
- `AUTH_PEPPER` 非空
- `ALLOWED_ORIGINS` 是非空 HTTPS Origin 列表，且与公开域名完全一致
- `WEB_DIST_DIR` 指向构建后的 `dist/`
- Cookie 强制 `Secure`、`HttpOnly`、`SameSite=Strict`
- `TRUST_PROXY=true`，使限流和日志读取 Caddy 提供的真实客户端地址

## 2. 前置条件

- 一台有公网 IPv4/IPv6 的 Linux 服务器，已安装 Docker Engine 与 Compose v2。
- 一个 A/AAAA 记录指向服务器的域名（例如 `manila.example.com`）。
- 防火墙只放行 22、80、443；不要放行 5432。
- 已复制本仓库到服务器，例如 `/opt/manila`。

## 3. 首次部署

### 3.1 准备秘密

```bash
cd /opt/manila
cp .env.production.example .env
chmod 600 .env
openssl rand -hex 32   # 生成 AUTH_PEPPER
openssl rand -base64 32  # 生成 PostgreSQL 密码
```

编辑 `.env`：

```dotenv
MANILA_DOMAIN=manila.example.com
ALLOWED_ORIGINS=https://manila.example.com
POSTGRES_USER=manila
POSTGRES_PASSWORD=<上一步生成的随机密码>
POSTGRES_DB=manila
AUTH_PEPPER=<独立生成的长随机值>
MANILA_IMAGE_TAG=2026-09-19
```

规则：
- `AUTH_PEPPER` 与数据库密码必须不同，且都不进入 Git、日志或镜像。
- `ALLOWED_ORIGINS` 必须与浏览器实际访问的 `https://域名` 完全一致（无尾斜杠、无通配符）。
- 数据库密码如含 URL 保留字符，需要按 URL 编码后才能放进 `DATABASE_URL`；Compose 会根据 `POSTGRES_*` 自动拼接。

### 3.2 构建并启动

```bash
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs -f app
```

应用启动时会在单个事务和 advisory lock 内执行迁移；迁移失败时进程保持未就绪，不会留下部分业务表。

### 3.3 健康检查

```bash
curl -fsS https://manila.example.com/health/live   # 仅进程存活
curl -fsS https://manila.example.com/health/ready  # 数据库可达且迁移完成
```

`/health/ready` 在数据库不可达时返回 503 `STORAGE_UNAVAILABLE`，且不输出连接信息。

### 3.4 创建第一个门禁 Token

原始 Token 只显示一次；Token ID 用于撤销：

```bash
docker compose -f compose.prod.yaml exec -T app \
  node --import tsx apps/server/scripts/tokens.ts create "friends"
```

### 3.5 部署后自动验证

在部署主机或任意能访问公网的机器安装 Node 22 后运行：

```bash
cd /opt/manila
PUBLIC_BASE_URL=https://manila.example.com \
E2E_ACCESS_TOKEN=<上面创建的 Token> \
npm run verify:deployment
```

脚本会检查 HTTPS、健康检查、同源 Web/静态资源、无效 Token、Cookie 安全属性、鉴权接口、登出和匿名 WSS 拒绝。对使用自签证书的本地演练可临时加 `ALLOW_INSECURE=1` 与 `NODE_TLS_REJECT_UNAUTHORIZED=0`，正式环境不要使用。

## 4. 日常运维

```bash
# 查看状态与日志（日志已省略凭证与私有 payload）
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs -f app

# 重启应用（保留数据库）
docker compose -f compose.prod.yaml restart app

# 停止（保留卷）
docker compose -f compose.prod.yaml down

# 停止并删除数据库卷（不可恢复）
docker compose -f compose.prod.yaml down -v
```

Token 与房间管理：

```bash
docker compose -f compose.prod.yaml exec -T app node --import tsx apps/server/scripts/tokens.ts list
docker compose -f compose.prod.yaml exec -T app node --import tsx apps/server/scripts/tokens.ts revoke <token-id>
docker compose -f compose.prod.yaml exec -T app node --import tsx apps/server/scripts/rooms.ts list
docker compose -f compose.prod.yaml exec -T app node --import tsx apps/server/scripts/rooms.ts close <room-code>
```

- 撤销 Token 会立即关闭其关联连接，后续 REST/WS 请求返回 `TOKEN_REVOKED`。
- 关闭房间保留只读快照，拒绝新命令；空置 lobby 默认 24 小时自动关闭。
- 撤销不会自动删除历史，也不会修改比赛结果。

## 5. 升级与回滚

### 5.1 升级

```bash
# 1) 先备份
COMPOSE_FILE=compose.prod.yaml npm run db:backup -- backup/manila-before-upgrade.dump

# 2) 检出/拉取新版本并构建
git fetch --all && git checkout <tag-or-commit>
docker compose -f compose.prod.yaml build app
docker compose -f compose.prod.yaml up -d app

# 3) 验证
curl -fsS https://manila.example.com/health/ready
PUBLIC_BASE_URL=https://manila.example.com E2E_ACCESS_TOKEN=... npm run verify:deployment
```

迁移是单向的：版本兼容门禁依赖镜像内迁移；不要假设不兼容迁移能自动降级。

### 5.2 应用回滚

如果新应用版本有问题但数据库兼容：

```bash
MANILA_IMAGE_TAG=<previous-tag> docker compose -f compose.prod.yaml up -d --no-build app
```

旧镜像必须仍在本机（升级前不要清理）。

### 5.3 数据库恢复

数据库恢复会丢失备份之后的所有进度。步骤：

```bash
docker compose -f compose.prod.yaml stop app caddy
# 在同项目 postgres 容器中恢复到目标库（示例：覆盖 manila）
docker compose -f compose.prod.yaml exec -T postgres \
  dropdb -U "$POSTGRES_USER" --if-exists manila
docker compose -f compose.prod.yaml exec -T postgres \
  createdb -U "$POSTGRES_USER" manila
docker compose -f compose.prod.yaml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d manila --no-owner < backup/manila-before-upgrade.dump
docker compose -f compose.prod.yaml up -d
```

`AUTH_PEPPER` 必须与新数据库对应；如果 pepper 丢失，历史 Token/会话无法验证，需要重新签发 Token。

## 6. 备份与恢复演练

### 6.1 备份

```bash
COMPOSE_FILE=compose.prod.yaml npm run db:backup -- backup/manila-$(date -u +%Y%m%dT%H%M%SZ).dump
```

- 备份文件包含 Token/会话摘要、房间、游戏快照、命令和事件。
- `AUTH_PEPPER` 不写入数据库，必须独立安全备份；没有 pepper，Token 摘要和会话 Cookie 无法继续使用。
- 备份文件应保存在服务器之外的受控位置，并设置严格权限。

### 6.2 独立恢复演练

```bash
COMPOSE_FILE=compose.prod.yaml npm run db:restore-drill
```

脚本会：备份当前库 → 创建隔离库 `manila_restore_drill` → `pg_restore` → 逐表比较 `access_tokens`、`sessions`、`rooms`、`room_members`、`games`、`commands`、`events` 的行数。停止 `app`/`caddy` 后恢复真实数据仍按第 5.3 节执行。

## 7. Pepper 保管、轮换与泄漏处置

- `AUTH_PEPPER` 只存在于部署环境变量/秘密管理器中，不入库、不进 Git、不打印。
- 更换 pepper 会使全部 Token 摘要和会话摘要失效：旧 Token 需要重新创建并分发给朋友，旧 Cookie 需重新登录。
- 怀疑泄漏时：立即停止写入或下线 → 备份数据库 → 换新 pepper → 重启 → 用 CLI 撤销所有旧 Token 并重新签发 → 通知玩家重新登录。

## 8. 安全与故障边界

- 只通过 HTTPS 访问；Caddy 自动 HTTPS/重定向并附加 HSTS。
- Cookie 为 7 天绝对期的 `Secure; HttpOnly; SameSite=Strict`。
- 登录按来源 IP 限制（默认 5/分钟），认证写操作按会话限制（默认 30/分钟）；可在 `.env` 用 `LOGIN_RATE_LIMIT_MAX`、`SESSION_WRITE_RATE_LIMIT_MAX` 调整。
- WS 握手与每条 REST/WS 入站消息都重新校验会话和 Token 状态；撤销立即断开，过期最多 30 秒内断开。
- 数据库故障时拒绝写入并返回 `STORAGE_UNAVAILABLE`，不切换内存模式、不显示伪成功。
- 未知 `stateVersion`/`rulesVersion`/`protocolVersion` 的存档会把房间标记为 `isolated`，禁止继续推进，不覆盖原存档。
- 日志只包含请求 ID、房间码、revision 和错误码；`AUTH_PEPPER`、数据库 URL、Cookie 和私有 payload 不进入日志或响应。

## 9. 未完成事项

- 真正的公网 DNS/TLS/主机验收需要项目所有者提供主机、域名和秘密并明确授权，按 [T20](tasks/T20-public-launch.md) 执行并记录。
- 升级门禁目前依赖“迁移失败即未就绪”，不支持自动回滚不兼容迁移；回滚必须使用应用镜像回退或数据库备份恢复。
