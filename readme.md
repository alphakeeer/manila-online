# 马尼拉（Manila）网页版

Zoch 2005 年桌游《马尼拉》的网页版项目。仓库包含三部分：可复用的纯 TypeScript 规则引擎、用于确认布局和交互方向的 React 演示界面，以及一个独立运行的版图位点标注器。

## 当前能力

- 规则引擎：管理航程、竞拍、货物运输、骰子移动、海盗、领航员、保险、股份价值和终局结算。
- React 演示：提供主桌面、玩家交接、我的股份和航程结算四个固定示例场景；它不写入真实游戏状态。
- 位点标注器：在 Board 与四张货物 Share 之间切换，编辑可放置组件的坐标，并导入、导出标注 JSON。

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

`npm run simulate` 默认让 3 个随机决策 AI 完成 10 局游戏，并交替启用标准与加强海盗规则。可以覆盖参数：

```bash
npm run simulate -- --games 20 --players 4 --seed 1296125513
```

## 项目结构与职责

| 路径 | 负责内容 |
| --- | --- |
| `src/game/` | 不依赖 React、DOM、系统时间或 `Math.random()` 的纯规则层。导出 `createGame`、`getDecision`、`transition`、`validateState` 和 `getStandings`。随机性由状态内 `mulberry32-v1` seed 控制，因此结果可重现。 |
| `src/game/__tests__/` | 规则行为、非法动作、不变量和完整游戏模拟的单元测试。 |
| `src/ui/` | 手机优先的 React 视觉演示组件、固定演示数据与 UI 交互测试。当前用于展示，不直接驱动规则引擎。 |
| `src/ui/BoardStage.tsx` | 渲染游戏桌面、版图、货物与玩家组件的主要舞台组件。 |
| `src/ui/ManilaDemo.tsx` | 组合演示场景与面板，管理仅供展示的 UI 状态。 |
| `src/ui/manila-demo.css` | 演示界面的响应式布局、桌面与移动端样式。 |
| `scripts/simulate.ts` | 命令行随机 AI 验收脚本，用于重复运行多局规则模拟。 |
| `manila_assets/` | 原始版图、货物、股份、玩家和比索图片；React 演示与 annotator 均复用这些素材。 |
| `annotator/` | 与 React 演示独立的静态位点标注工具和已命名的标注数据。 |
| `马尼拉_中文规则_翻译.md` | 本项目规则判断的中文依据。 |
| `马尼拉_术语表.md` | 界面和领域模型的统一术语。 |

## 位点标注器（`annotator/`）

直接在浏览器打开 [`annotator/index.html`](./annotator/index.html)，即可使用标注器；它不需要启动 Vite。

### 画布与可放置组件

| 画布 | 背景素材 | 可放置组件 | 用途 |
| --- | --- | --- | --- |
| Board | `game_board.jpg` | Share、Player | 标注版图上的航线、港口、修船厂和行动位。 |
| Jade | `jade_shares.png` | Player | 标注 Jade 货物牌上的 4 个随从位。 |
| Nutmeg | `nutmeg_shares.png` | Player | 标注 Nutmeg 货物牌上的 3 个随从位。 |
| Silk | `silk_shares.png` | Player | 标注 Silk 货物牌上的 3 个随从位。 |
| Ginseng | `ginseng_shares.png` | Player | 标注 Ginseng 货物牌上的 3 个随从位。 |

Share 画布会禁用 **Add Share**；即使导入的 JSON 含有其他类型，也会在导入时过滤，以确保 Share 上只能出现 Player。

### 文件职责

| 文件 | 负责内容 |
| --- | --- |
| `annotator/index.html` | 静态页面结构：舞台、Board/Jade/Nutmeg/Silk/Ginseng 切换按钮、编辑面板和导入导出控件。 |
| `annotator/app.js` | 画布状态、切换逻辑、拖拽、键盘微调、坐标编辑、localStorage 自动保存，以及 JSON 的导入导出和旧格式兼容。 |
| `annotator/style.css` | 标注器的自适应画布、选中/拖拽状态和侧边栏样式。 |
| `annotator/board-and-shares-annotations.json` | 当前的命名位点数据：1 个 Board 和 4 张 Share。是后续实现实际组件落点的参考数据。 |

### 操作方式

- 使用顶部按钮切换当前画布；每张画布保存独立的组件与选中状态。
- 点击 **Add Share** 或 **Add Player** 添加组件；拖拽可移动，右侧数值框可精确修改 X/Y、旋转和缩放。
- 方向键移动 1px，`Shift + 方向键` 移动 10px；`Q/E` 旋转 1°，配合 Shift 旋转 5°。
- `Delete` 删除选中项，`Ctrl/Cmd + D` 复制选中项。
- **Export JSON** 下载数据，**Import JSON** 恢复数据，**Copy JSON** 复制数据；浏览器 localStorage 会自动保留最近一次编辑结果。

### 标注数据格式

```json
{
  "board": {
    "width": 1043,
    "height": 2048,
    "items": [{ "id": "share-8", "name": "left-route-space-0", "type": "jade_share", "x": 198.74, "y": 1866.36 }]
  },
  "shares": [
    {
      "id": "share-1",
      "width": 221,
      "height": 568,
      "items": [{ "id": "player-69", "name": "jade-cargo-slot-cost-3", "type": "player_red", "x": 123.48, "y": 152.58 }]
    }
  ]
}
```

每个组件可包含：

- `id`：稳定的组件 ID。
- `name`：可选的语义名称；标注器导入、编辑、导出时会保留此字段。
- `type`：素材类型，目前为 `jade_share` 或 `player_red`。
- `x`、`y`：相对于所属画布原始尺寸的中心坐标。
- `rotation`、`scale`：组件的旋转角度与缩放比例。

当前命名覆盖三条航线的 `space-0` 到 `space-13`、Port/Shipyard 停泊位、四种货物的随从费用位，以及已确认的港口、修船厂、海盗船、领航员和保险事务所 Player 位点。旧的仅 Board 格式已由 `board-and-shares-annotations.json` 取代；导入时仍兼容旧的顶层 `items` 格式。

## 规则来源

规则判断以 [`马尼拉_中文规则_翻译.md`](./马尼拉_中文规则_翻译.md) 为准，界面及领域术语以 [`马尼拉_术语表.md`](./马尼拉_术语表.md) 为准。
