# 灵感爆爆爆 — 智能体导航

> Chrome MV3 扩展，当前覆盖小红书与抖音两条采集链路，纯 JS + Dexie。  
> 本文件职责：提供导航、约束和事实源入口，不单独承担产品或架构的最高权威。

本仓库对应的不是一个独立产品，而是统一产品“内容工作台”中的浏览器执行端。

统一产品分工固定如下：

- 内容工作台：主系统，负责判断、组织、沉淀
- 灵感爆爆爆插件：执行端，负责网页内采集、页面交互、结果回传

无论在本仓库还是工作台仓库协作，都应把两者理解成同一个产品的两个运行面，而不是两个彼此独立的产品。

## Source of Truth

### 权威级别

| 级别 | 文件/目录 | 用途 |
|------|-----------|------|
| 权威 | `docs/product/*.md` | 当前产品能力、用户路径、验收标准 |
| 权威 | `docs/technical/*.md` | 当前技术栈、数据模型、消息协议、平台调研事实 |
| 权威 | `docs/plans/active/*.md` | 当前执行中的审查、修订、编排与活跃计划 |
| 权威 | `docs/decisions/index.md` | 关键架构决策与转向记录 |
| 权威 | `progress.txt` | 真实时间线与阶段进展 |
| 导航/约束 | `AGENTS.md`、`CLAUDE.md` | 阅读入口、协作铁律、工作方式约束 |
| 次级说明 | `BACKEND_STRUCTURE.md` | 本地“后端”结构解释稿，不是 schema 最高事实源 |
| 次级说明 | `IMPLEMENTATION_PLAN.md` | 历史阶段计划快照，不是唯一执行入口 |
| 历史资料 | 外层 `01_*.md`、`02_*.md`、`03_*.md` | 立项期研究与方案草稿，仅供背景参考 |

### 冲突时怎么判断

1. 产品问题优先看 `docs/product/*.md`
2. 技术事实优先看 `docs/technical/*.md` 和真实代码
3. 当前执行顺序优先看 `docs/plans/active/2026-03-project-remediation-execution-plan.md`
4. 关键历史转向优先看 `docs/decisions/index.md`
5. 若外层 `01/02/03` 与内层 `docs/**` 冲突，一律以内层 `docs/**` 为准

## 架构速览

```text
用户操作层（Popup / Dashboard / 页内注入）
  → Chrome 容器（Background Service Worker + Content Script）
    → 平台层（XHS / Douyin 采集器、批量控制、页面检测）
      → 页面上下文桥接（Injected Scripts / 页面侧 fetch / API capture）
        → 本地数据层（Dexie / IndexedDB）
```

当前构建入口仍是 4 个：`content`、`background`、`popup`、`dashboard`。

## 文档导航

| 你要做什么 | 去哪里看 |
|-----------|---------|
| 理解当前产品能力 | [docs/product/PRD.md](docs/product/PRD.md) |
| 理解当前用户操作流 | [docs/product/APP_FLOW.md](docs/product/APP_FLOW.md) |
| 跑功能验收 | [docs/product/TEST_CHECKLIST.md](docs/product/TEST_CHECKLIST.md) |
| 理解模块职责和跨层关系 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 查/改 DOM 选择器 | [docs/SELECTORS.md](docs/SELECTORS.md) |
| 看抖音页面调研结论 | [docs/technical/DOUYIN_FIELD_SURVEY.md](docs/technical/DOUYIN_FIELD_SURVEY.md) |
| 看小红书页面调研结论 | [docs/technical/XHS_FIELD_SURVEY.md](docs/technical/XHS_FIELD_SURVEY.md) |
| 查数据库 schema | [docs/technical/DATA_MODEL.md](docs/technical/DATA_MODEL.md) |
| 查消息协议 | [docs/technical/MESSAGE_PROTOCOL.md](docs/technical/MESSAGE_PROTOCOL.md) |
| 查 AI-ready 数据契约 | [docs/technical/AI_READY_DATA_CONTRACT_V1.md](docs/technical/AI_READY_DATA_CONTRACT_V1.md) |
| 看技术决策历史 | [docs/decisions/index.md](docs/decisions/index.md) |
| 看当前治理编排 | [docs/plans/active/2026-03-project-remediation-execution-plan.md](docs/plans/active/2026-03-project-remediation-execution-plan.md) |
| 看当前 UI/UX 升级计划 | [docs/plans/active/2026-03-ui-ux-upgrade-plan.md](docs/plans/active/2026-03-ui-ux-upgrade-plan.md) |
| 看当前审查报告 | [docs/plans/active/2026-03-project-retrospective-audit.md](docs/plans/active/2026-03-project-retrospective-audit.md) |
| 看当前修订清单 | [docs/plans/active/2026-03-project-remediation-checklist.md](docs/plans/active/2026-03-project-remediation-checklist.md) |
| 看技术债务 | [docs/plans/tech-debt.md](docs/plans/tech-debt.md) |

## 源码地图

| 区域 | 路径 | 当前职责 |
|------|------|---------|
| Chrome 容器 | `src/background/index.js` | 下载、tab 通信、后台路由 |
| Content 主入口 | `src/content/index.js` | 平台识别、消息总路由、批量任务与 Dashboard 桥 |
| 小红书平台 | `src/platforms/xhs/*` | 笔记/评论/博主/批量/UI 注入/反检测 |
| 抖音平台 | `src/platforms/douyin/*` | 视频/评论/博主/批量/UI 注入/页面检测 |
| 页面桥接 | `src/injected/*` | `__INITIAL_STATE__`、抖音 API capture、页面上下文桥接 |
| 数据层 | `src/db/*` | Dexie schema、内容/评论/作者/任务/媒体资产存储 |
| Popup | `src/popup/*` | 全局入口、任务触发、批量设置 |
| Dashboard | `src/dashboard/*` | 数据管理、导出、二次下载入口 |
| 共享模块 | `src/shared/*` | 常量、消息封装、通用工具 |

## 协作铁律

1. **先调研再实现**：禁止猜选择器、猜接口、猜页面状态。
2. **不转嫁技术债给用户**：排查、探针、证据收集优先由 AI 承担。
3. **先修事实源，再修结构，再修体验**：执行顺序服从活跃计划。
4. **文档与代码一起维护**：改选择器、协议、数据结构时必须同步更新对应权威文档。
5. **历史资料不能倒灌实现**：外层 `01/02/03` 只作背景参考，不能直接拿来当现行需求或架构。

## 浏览器执行规则

1. **真实浏览器验收优先使用 Chrome MCP**：若当前会话已挂载可用的 Chrome MCP，并且需要复用用户现成登录态、真实窗口或现有浏览器环境，则优先使用 Chrome MCP 完成验收闭环。
2. **gstack /browse 作为退路，不再是唯一通道**：当 Chrome MCP 不可用，或仅需轻量页面浏览、截图、结构快照时，才退回 gstack `/browse`。
3. **验收结论必须说明浏览环境**：在回复中明确写清“本轮验收基于 Chrome MCP 真实浏览器”还是“基于 gstack 浏览器”，避免把不同运行环境下的结论混为一谈。

## 文档同步硬门禁

> 这是一条项目级硬规则：任何“代码改动 + 测试结论 + 用户反馈”形成闭环后，必须主动完成文档同步，不等待用户提醒。

### 最低门槛

1. **任何一轮实现后，至少更新 `progress.txt`。**
2. **未更新文档的代码回合，不算真正闭环。**

### 触发条件与必须更新的文件

| 触发条件 | 必须主动更新 |
|---------|-------------|
| 任意代码改动已完成并做过测试 | `progress.txt` |
| 用户可见行为、按钮、流程、提示、任务语义发生变化 | `docs/product/PRD.md`、`docs/product/APP_FLOW.md`、`docs/product/TEST_CHECKLIST.md` |
| 字段、数据结构、消息协议、采集深度、任务状态字段发生变化 | `docs/technical/DATA_MODEL.md`、`docs/technical/MESSAGE_PROTOCOL.md`、`docs/technical/AI_READY_DATA_CONTRACT_V1.md` |
| 页面事实、选择器、平台页面类型判断、页面调研结论发生变化 | `docs/technical/SELECTORS.md`、`docs/technical/DOUYIN_FIELD_SURVEY.md` |
| 出现新的稳定策略、架构转向、治理规则、停止/暂停/继续语义结论 | `docs/decisions/index.md`，必要时补 `docs/plans/active/*.md` |

### 关闭一轮工作的标准

一轮工作只有同时满足下面条件才算“已完成”：

1. 代码已修改
2. 构建/自测已完成
3. 用户验收结论已获得，或至少已拿到明确测试反馈
4. 对应权威文档已同步
5. 最终回复中已明确说明“本轮更新了哪些文件”

如果第 4、5 点没做到，这一轮只能算“部分完成”，不能按“已收口”对外表述。

## 构建

```bash
npm run build          # 生产构建 → dist/
npm run dev            # 开发模式（watch）
npm run release:patch  # 语义版本自动化
```
