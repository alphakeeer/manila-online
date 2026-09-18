# Manila 多人在线网页版

本项目的目标是实现一个可部署到公网服务器的《Manila》多人在线网页游戏，供小型朋友群体私下游玩。访问者必须持有服务端认可的 **8 位 Token**。

> 当前状态：规则引擎和本地客户端原型已经可运行；服务端、房间、Token 鉴权、实时同步和持久化尚未实现。当前页面仅用于在联网架构落地前验证规则与交互，不能作为最终的多人游戏架构。

完整产品范围和架构决策见 [项目方向文档](./docs/PROJECT_DIRECTION.md)。

## 核心原则

- **服务器保存并裁决权威游戏状态。** 骰子、回合、资金、股份、合法动作和结算全部由服务端决定。
- **客户端只负责展示和提交操作。** 浏览器不能自行推进权威游戏，也不能获得其他玩家的私有状态。
- **Token 只用于私人访问控制。** 不建设注册、密码找回、OAuth、好友等复杂账号系统。
- 支持创建/加入房间、3–5 人实时游戏、断线重连和服务重启恢复。
- 房间命令按顺序处理，使用 revision 和 commandId 防止并发覆盖与重复执行。

## 当前已有能力

### 规则引擎

`src/game/` 是不依赖 React、DOM、网络、系统时间或 `Math.random()` 的纯 TypeScript 规则层。它目前提供：

- `createGame`：创建 3–5 人游戏并按 seed 发放股份。
- `getDecision`：返回当前玩家和可执行决策。
- `transition`：验证动作并生成下一状态与规则事件。
- `validateState`：检查资金、股份、同伙、舢板和泊位等不变量。
- `getStandings`：计算终局财富和并列赢家。
- 标准及加强海盗规则、贷款、保险、领航员、行情和终局结算。

规则随机性保存在状态内，使用 `mulberry32-v1`，相同 seed 可重现。

### 客户端原型

`src/ui/` 当前是一套使用真实规则引擎的本地热座原型，包含：

- 游戏配置和玩家交接。
- 全部规则决策的基础操作面板。
- 版图、舢板、同伙、泊位和商品行情轨道。
- 私人资金和股份的基础隐藏机制。

该原型仍在浏览器内直接调用规则引擎。实现联网架构时，这些调用将替换为服务端命令和接收者专属状态视图。

### 开发工具与素材

- `annotator/`：独立的版图/货物牌坐标标注工具。
- `annotator/board-and-shares-annotations.json`：版图和货物位点的语义坐标。
- `manila_assets/`：版图、股份、货物、玩家和比索原始素材。
- `scripts/simulate.ts`：随机 AI 完整对局验收脚本。
- `马尼拉_中文规则_翻译.md`：规则判断依据。
- `马尼拉_术语表.md`：界面和领域模型术语。

## 目标架构

后续建议演进为 npm workspaces 单仓库：

```text
apps/
  web/           React + Vite 客户端
  server/        HTTP、WebSocket、Token 会话和房间运行时
packages/
  game/          纯 TypeScript 规则引擎
  protocol/      命令、事件、视图和运行时校验 schema
docs/
  PROJECT_DIRECTION.md
tools/
  annotator/
```

推荐使用模块化单体 Node.js 服务、Fastify、WebSocket、Zod 和 PostgreSQL。首版以单台公网服务器为部署目标，不提前拆分微服务。

## 当前目录

| 路径 | 职责 |
| --- | --- |
| `src/game/` | 可复用的纯规则引擎；未来迁移到 `packages/game/`。 |
| `src/game/__tests__/` | 规则行为、非法动作、不变量和随机整局模拟。 |
| `src/ui/` | 当前客户端原型；未来迁移到 `apps/web/` 并改为消费服务端视图。 |
| `src/ui/ManilaApp.tsx` | 客户端原型入口和本地热座状态。 |
| `src/ui/DecisionPanel.tsx` | 将规则 Decision 渲染为操作控件。 |
| `src/ui/GameBoard.tsx` | 版图、舢板、同伙、泊位和可点击位置。 |
| `src/ui/MarketPriceTrack.tsx` | 商品行情轨道和变动动画。 |
| `annotator/` | 开发期坐标标注工具。 |
| `docs/PROJECT_DIRECTION.md` | 最终产品、MVP、非目标和联网架构规划。 |

## 本地开发

要求：

- Node.js 22+
- npm 10+

```bash
npm install
npm run dev
npm test
npm run simulate
npm run build
```

运行更多随机游戏：

```bash
npm run simulate -- --games 50 --players 5 --seed 1296125513
```

## 当前限制

- 没有服务端或数据库，刷新页面会丢失当前游戏。
- 没有 Token 验证、房间和 WebSocket。
- 当前热座 UI 不是权威架构，不能直接扩展成浏览器之间的状态同步。
- 抵押/赎回、航程结算反馈和跨回合表单状态仍需完善。
- 尚无正式部署、CI 或端到端多人测试。

下一阶段应优先建立共享协议、服务端私有视图边界和 Token/房间纵向切片，而不是继续向客户端添加本地权威逻辑。
