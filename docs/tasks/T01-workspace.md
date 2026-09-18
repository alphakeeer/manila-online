# T01：迁移现有代码并锁定验证入口

Phase 0 · 推荐 agent：Luna。路径和构建调整有明确边界；发现模块设计变更时交 Terra 评估。

执行前阅读 [架构约定](../ARCHITECTURE.md) 和 [实际状态](../STATUS.md)；任务完成状态只在 STATUS 维护。

## Goal

把现有可运行原型迁移到 apps/web 与 packages/game，为后续切片提供稳定构建入口。

## Scope

- 迁移 src/game 及规则测试到 packages/game，React 入口/UI/CSS 到 apps/web；调整 tsconfig、Vite、测试、simulate 和素材引用。
- 建立 npm workspaces 与 root scripts；保留 npm test / build / simulate 的入口语义，记录引擎迁移前后的文件内容对应关系。
- 更新 README/STATUS 源码路径；保留 annotator 和原图位置。

## Non-goals

- 不创建空 server/protocol/config 包，不改规则或修 B01/B02。
- 不重做 UI、不升级 React/Vite、不增加网络依赖。

## Dependencies

无；先确认工作区和现有验证基线。

## Acceptance Criteria

- 原有 43 测试仍通过，simulate 与生产 build 可从仓库根运行。
- 纯 game 不依赖 DOM/React，内部实现除导入/构建路径外不变；原型能显示版图与行情。
- Linux 大小写敏感路径与本地路径均可解析，迁移没有丢失素材或测试。

## Validation

- 运行 npm ci、npm test、npm run build、npm run simulate -- --games 20 --players 5 --seed 20260918。
- 比较迁移前后 engine/setup/rng/constants 实现；浏览器冒烟验证开始游戏、交接、版图和行情。
