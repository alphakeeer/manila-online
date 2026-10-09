# T26：一条命令快速部署

Phase 5 补充 · 推荐 agent：Terra。复用 T19 的 Compose 形态，不改变生产安全约束。

## Goal

把“复制模板、手工生成秘密、构建、等健康、进容器建 Token、自检”压缩为一条可重复执行的命令，并支持升级与本机演练。

## Scope

- `scripts/deploy.sh`：检查 Docker/Compose；首次生成 `.env.production`（随机数据库密码、`AUTH_PEPPER`，600 权限，Git 忽略）；构建启动；容器内与公网 HTTPS 健康检查；首次打印门禁 Token；`--update` 先备份再重建；`--tokens N`；`--local` 以 `https://localhost` 演练。
- 备份/恢复脚本识别 `.env.production`；Compose 与模板加入 `AUTOPILOT_*`；Docker 构建上下文排除 `manila_assets`（前端只用 WebP 派生图）。
- 部署手册新增“一条命令部署”，保留手工步骤。

## Non-goals

- 不代购服务器/域名、不上传秘密、不替代 T20 的真实上线验收。

## Dependencies

- [T19](T19-deployment.md)、[T25](T25-performance.md)

## Acceptance Criteria

- 新主机仅需 Docker 与域名：一条命令到可登录；重复执行不覆盖秘密；`--update` 产生备份文件。

## Validation

- 本机 `scripts/deploy.sh --local`：构建、就绪、HTTPS、Token、`verify:deployment`（ALLOW_INSECURE=1）通过；随后 `--update` 生成备份并恢复就绪。
