# T24：玩家快速、方便地加入

Phase 4 补充 · 推荐 agent：Luna。纯前端任务（新增依赖 `uqr`，按需加载）。

## Goal

把“发 Token、报房间码、手动输入”的加入流程缩短为“点开链接 / 扫码 → 输 Token → 自动入座”。

## Scope

- 房间页“复制邀请链接 / 复制房间码 / 系统分享 / 二维码”；链接为 `/?join=<房间码>`，进入后从地址栏移除。
- 受邀登录页提示；登录后房间码自动填好，记住的昵称直接自动加入。
- 粘贴完整 8 位 Token 自动登录；昵称记在 localStorage；大厅刷新间隔 3 s → 2 s。

## Non-goals

- Token 不进 URL、不做免 Token 加入；不改服务端鉴权。

## Dependencies

- [T23](T23-seat-autopilot.md)（同一入口也用于中途接回）

## Acceptance Criteria

- 受邀链接 + 已记住昵称：输入 Token 后无需其它操作即入座；未记住昵称时房间码已预填。
- 二维码可扫码打开同一链接；QR 编码器不进入首屏包。

## Validation

- 多浏览器脚本实测邀请链接、自动加入与二维码渲染；三条 E2E 通过。
