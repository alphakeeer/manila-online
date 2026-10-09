# T25：性能优化（先测量后优化）

Phase 4 补充 · 推荐 agent：Terra。不改变规则、协议语义或鉴权。

## Goal

用可重复的基准找出真实瓶颈并优化：手机进入对局的等待、首屏体积、广播延迟与无效请求。

## Scope

- 基准：`npm run bench:server`（5 人 WebSocket 在线随机整局，命令延迟与全员收到新 revision 的耗时）、`npm run bench:web`（生产构建 + 模拟手机 4G 4 Mbps/100 ms 冷加载）。
- 图片：`scripts/optimize-assets.py` 由 `manila_assets/` 原图生成 WebP（原图保留），预算测试收紧到 600 KB。
- 代码分包：对局界面懒加载；进入房间即预取对局代码与版图图片。
- 结算历史只在航程变化或终局时拉取，不再每个 revision 请求一次。
- 广播：一次一致读取（房间+存档+成员单条语句、会话批量校验）为全部订阅者投影，替代每人一个加锁事务；校验逻辑与 `latest()` 相同。

## Non-goals

- 不做 SSR、Service Worker、CDN；不替换 React/Zod；压缩仍由 Caddy 负责。

## Acceptance Criteria

- 基准前后对比写入 STATUS；功能与隐私边界由 integration/E2E 证明不变。

## Validation

- `npm test`、`npm run test:integration`、三条 E2E、两项基准各跑多次取中位数。
