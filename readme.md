# Manila 私人多人网页版

目标是让本人和朋友持有效的 **8 位 Token**，通过各自浏览器进行 3–5 人 Manila。
服务器保存并裁决权威游戏状态，客户端只展示状态和提交操作。

当前仍是纯 TypeScript 规则引擎加 React 本地热座原型；Token、服务端、房间、同步和数据库尚未实现。
本地页面不能直接作为公网多人服务发布。实际验证结果和已知问题见 [STATUS](docs/STATUS.md)。

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

- `src/game/`：规则、seed RNG、不变量和模拟；[规则依据](马尼拉_中文规则_翻译.md)、[术语表](马尼拉_术语表.md)。
- `src/ui/`：真实规则驱动的本地热座原型、版图和行情轨道。
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

上述命令启动或验证本地原型，不包含服务器或数据库。将来新增命令应在所属任务中实现并更新此处。
下一项工作从 [T01](docs/tasks/T01-workspace.md) 开始；本轮规划不包含业务实现。
