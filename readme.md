本仓库旨在实现网页版马尼拉供作者与朋友游玩，支持手机/电脑
# 马尼拉（Manila）网页版规则引擎

Zoch 2005 年桌游《马尼拉》的纯 TypeScript 规则引擎。当前版本提供完整的本地游戏状态机、单元测试和随机 AI 验收脚本；React 仅保留项目入口，尚未实现可玩界面。

## 环境与命令

- Node.js 22+
- npm 10+

```bash
npm install
npm run dev
npm test
npm run simulate
npm run build
```

模拟脚本默认让 3 个随机决策 AI 完成 10 局游戏，标准和加强海盗规则交替启用。可以覆盖参数：

```bash
npm run simulate -- --games 20 --players 4 --seed 1296125513
```

## 代码结构

- `src/game/`：不依赖 React、DOM、系统时间或 `Math.random()` 的纯规则层。
- `src/game/__tests__/`：规则行为、非法动作、不变量和完整游戏模拟测试。
- `scripts/simulate.ts`：命令行随机 AI 验收脚本。
- `manila_assets/`：原始版图、货物、股份和比索素材，保持不变供后续 UI 使用。

规则层主要导出 `createGame`、`getDecision`、`transition`、`validateState` 和 `getStandings`。所有随机行为由状态内的 `mulberry32-v1` seed 驱动，失败游戏可准确重现。

## 规则来源

一切规则判断以 [`马尼拉_中文规则_翻译.md`](./马尼拉_中文规则_翻译.md) 为准，界面及领域术语以 [`马尼拉_术语表.md`](./马尼拉_术语表.md) 为准。
