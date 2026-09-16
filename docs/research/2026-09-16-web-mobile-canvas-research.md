# 象限 · 网页端现状盘点与同类项目调研

- 日期：2026-09-16
- 基线：`main`（`e0bf647`，release 1.0.0）
- 性质：只读调研，未修改任何源码
- 方法：① 通读设计文档、构建配置与前端实现；② 检索 GitHub 同类项目并用 GitHub API 核实星标/许可/活跃度（数据截至 2026-09-16）

---

## 第一部分 · 网页端现状

### 1.1 设计风格：文档与实装是两套东西

仓库里存在两份互不相干的设计依据：

| 来源 | 内容 | 与实装的关系 |
| --- | --- | --- |
| `design/DESIGN.md`（+`design/README.md` 指向 getdesign.md） | 完整的 **Notion 设计体系**：浅色 `#ffffff` 画布、暖炭灰正文 `#37352f`、紫色主 CTA `#5645d4`、9 色 pastel 卡片、8px 矩形按钮、4 档间距体系 | **未落地**。实装没有任何一个该令牌 |
| `docs/superpowers/specs/2026-08-12-quadrant-app-design.md` §3 | 桌面端设计意图：**暗色、低饱和、蓝色强调色**、GPT 概念图风格 | 已落地，是实装的实际来源 |
| `docs/superpowers/specs/2026-09-03-mobile-portrait-web-design.md` §导航 | 移动端意图：**Apple 风格**深色 + 毛玻璃 Tab Bar | 已落地 |

实装的真实设计令牌只有 11 个变量（`src/renderer/src/styles/theme.css:1-16`）：`--bg #0f1115`、`--panel #1a1d23`、`--card #1f242c`、`--border #2c3036`、`--accent #4da3ff`、`--success #66bb6a`、`--danger #e5484d`、三档圆角、以及 `--mobile-nav-height`。

由此得出三条客观判断：

1. **设计语言是"深色单主题 + 蓝色强调 + lucide 图标 + 卡片化"**，与 `design/DESIGN.md` 的 Notion 浅色体系方向相反。这份参考目前是"悬空资产"——既没被使用，也没被删除，构成两份设计真相。
2. `theme.css:1` 写死 `color-scheme: dark`，**没有浅色主题通道**；颜色全部硬编码在变量里，没有 `prefers-color-scheme` 分支。
3. 字体栈是 Windows 优先（`"Segoe UI", "Microsoft YaHei", system-ui`，`theme.css:31`）。移动端规格要求 Apple 风格，但字体未针对 iOS 调整，实际 iPhone 上会落到 `system-ui`（表现可接受，但"Apple 感"来自材质而非字体）。

### 1.2 架构：四层，边界清晰

```
┌─────────────────────────────────────────────────┐
│ 页面层  pages/{Goals,Quadrant,Weekly,Review}    │  4 个一级页，无路由
│         单页状态机：useAppStore.page             │  page: 'goals'|'quadrant'|'weekly'|'review'
├─────────────────────────────────────────────────┤
│ 状态层  state/appStore.ts（zustand 单 store）     │  所有变更产出新 AppData
│         + lib/*Rules.ts 纯函数（事件/目标/周/复盘）│  → scheduleSave（500ms 防抖）
├─────────────────────────────────────────────────┤
│ 平台层  lib/platformApi.ts                       │  Electron: window.quadrantApi（IPC）
│         getPlatformApi() 运行时二选一             │  Web: localStorage（键带版本前缀）
├─────────────────────────────────────────────────┤
│ 同步层  lib/cloudSync2.ts（supabase-js）          │  鉴权 + 整份 upsert + realtime 订阅
└─────────────────────────────────────────────────┘
        构建：electron-vite（桌面）/ vite.web.config.ts（网页，base './' → dist-web）
```

值得肯定的三点，这在同类 hobby 项目里属于超额完成：

- **纯逻辑与 UI 严格分离**：`quadrantMath` / `goalRules` / `weekRules` / `eventRules` / `reviewRules` / `quadrantSync` 都是可测纯函数，15 个测试文件 102 个用例全部覆盖这一层。
- **平台抽象干净**：`getPlatformApi()` 让 Electron 与 Web 共用同一套 store 动作与写入节流，调用方不再假设 `window.quadrantApi` 存在（这正是 dev 分支最致命缺陷的正确修法）。
- **Web 端有可测的构建契约**：`tests/webBuild.test.ts` 断言 `package.json` 脚本与 `vite.web.config.ts` 的 `base: './'`，避免产物路径回归。CI（`.github/workflows/deploy-pages.yml`）用 `path: dist-web`，与配置一致，线上站点可用。

架构上的真实缺口：

- **桌面端被排除在实时同步之外**：`App.tsx:47-50` 明确 `if (!authenticated || isDesktop) return`，桌面端不订阅 realtime；`appStore.ts:99-104` 的 `saveSoon` 在桌面端**不上传云端**。合起来是"手机改了，桌面必须手点同步；桌面改了，云端不知道"。
- **同步是整份覆盖**：`cloudSync2.ts:16-26` 读出云端行 → `validCloudData` 通过就用云端整份替换本地 → 再 upsert 回去。`tests/cloudSync.test.ts` 正是这样断言的。数据模型是**单行单 jsonb**（`user_data.data`），所以 LWW（后写覆盖）的粒度是"整个应用数据"，不是"某一条事件"。单用户双设备交替编辑 → 必然丢数据。
- **云端数据校验过松**：`cloudSync2.ts:12-15` 只检查 `version===2` 与四个字段是数组；而 `platformApi.ts:28-49` 做的是逐字段深度校验。一份结构不完整的云端数据能通过浅校验、整份覆盖本地，进而在渲染层引发崩溃。**两套校验器并存且强度不一致**，是明确的缺陷。
- **数据库定义没有版本控制**：`supabase/schema.sql` 只存在于 `dev/quadrant-app`（10 行）与归档标签里，`main` 上 `supabase/` 目录已整体删除（`git ls-tree origin/main -- supabase` 为空）。RLS 策略因此失去了仓库内的备份。
- **无路由**：`spec` §构建 明确"不使用 URL 路由，因此刷新不会产生 SPA 404"。这是有意的权衡，但代价在移动端具体可见：周计划单日页、复盘记录页都无法用浏览器返回键／iOS 边缘手势返回，也无法做深链接与分享。
- **无 ESLint/Prettier**；CI 只跑 `npm ci && npm run build:web`，**typecheck 与 102 个测试从不自动执行**。

### 1.3 功能逻辑清单

| 模块 | 核心逻辑 | 数据形态 |
| --- | --- | --- |
| 目标 | 长期/短期两栏；长期目标含分组（group）+ 组内子任务；顺序依赖门禁 | `goals[].subtasks[]` |
| 四象限 | 世界坐标系（1 单位 = 20px，缩放 0.5–2.5x）；事件宽由文本自适应（6–20 单位，上限 400px）；原点距边 ≥10px 钳制；象限内边界约束（距轴 10px、不跨轴）；紧急升级 Q2→Q1 / Q3→Q4（保持 y，水平镜像） | `events[]`（x/y/width 为世界坐标） |
| 周计划 | 07:00–24:00 纵向时间轴；预设（preset）拖入创建；周概览 7 列 + 单日页；事件可"同步到四象限"（上限 30 条/象限） | `weekEvents[]` + `weekPresets[]` |
| 周日复盘 | 三个 0–10 分段滑杆 + 长文本；草稿/正式双状态（离开时提示保存）；记录列表 | `reviewDraft`（经 `saveReview` 落为导出文件） |
| 云同步 | 用户名→`@quadrant.app` 别名登录；整份 upsert；网页端 realtime 订阅 | `user_data.data`（jsonb） |
| 复盘导出 | 桌面 → `.docx`（`src/main/reviewDoc.ts`）；网页 → `.txt` 下载 + localStorage 记录 | `ReviewRecord` |

### 1.4 移动端适配：规格与实现逐条对照

移动规格（`2026-09-03-mobile-portrait-web-design.md`）写得相当完整，实现完成度**比预期高**——以下为逐条核对结果。

**已实现（有代码依据）**

| 规格要求 | 实现位置 |
| --- | --- |
| ≤767px 进移动模式，三档断点 | `responsiveLayout.ts:1`、`theme.css` 三处 `@media` |
| 底部毛玻璃 Tab Bar（12px 内缩、26px 圆角、blur(24px) saturate(150%)、回退色） | `theme.css:2183-2194` |
| 安全区适配 `env(safe-area-inset-bottom)` | `theme.css:2183/2187/2252/2321/2571/2612` |
| 弹窗贴底为 bottom sheet（22px 圆角、`86dvh`、内容可滚） | `theme.css:2602-2612` |
| 44px 触控目标常量 | `responsiveLayout.ts:3` `TOUCH_TARGET_MIN = 44` |
| 单指平移 + 双指捏合缩放 + 指针捕获 | `QuadrantPage.tsx:334-458`（touchPointsRef / pinchRef） |
| 象限位置与颜色语义不被调换 | `quadrantMath.ts:18-26` `QUADRANT_META` + 对应测试 |
| 手势提示文案分流 | `QuadrantPage.tsx:537-538`（`desktop-only` / `mobile-only`） |
| 周计划手机端时间窗口与最小列宽 | `weeklyMobileLayout.ts:1-3`（420–1440 分、≥96px） |
| 手机端点击空白创建事件（替代双击） | `weeklyMobileLayout.ts:5-11` `shouldCreateOnCanvasClick` |

**未实现或与规格不符**

| 规格要求 | 实际情况 | 依据 |
| --- | --- | --- |
| Task 4 Step 4：**"长按事件打开操作菜单"** | 长按被实现为**开始拖动**，菜单仅由原生 `contextmenu` 触发。同一手势存在两条互不协调的路径 | `EventCard.tsx:54-59`（550ms → `onLongPress`）→ `QuadrantPage.tsx:497-500`（`onEventLongPress` 只设 `dragRef`）；菜单走 `onContextMenu` → `QuadrantPage.tsx:502-504` |
| 移动端便捷新建（规格提示词含"底部 action sheet 快速创建"） | 四象限新建**只有双击一条路**（`onDoubleClick`，鼠标语义），移动端无 FAB／无按钮 | `QuadrantPage.tsx:460-474`；`mobile-only` 元素全仓仅 1 处，且是提示文案 |
| 触控热区 ≥44px | 事件拖动把手移动端为 **14×14px**，且仅在 `hover \|\| selected` 时渲染（触屏无 hover，需先点选一次） | `theme.css:2359-2364` vs `responsiveLayout.ts:3`；`EventCard.tsx:79-88` |
| iOS 长按体验 | 无 `-webkit-touch-callout` 与 `-webkit-tap-highlight-color` 处理（只有全局 `user-select: none`） | `theme.css:34`，全仓无前两者 |

**待实测确认（不凭代码断言）**

- 四象限页 `touch-action: none` + `flex:1` 在手机上是否会与页面纵向滚动冲突（`theme.css:609-618`）——需在 375/390/430 视口实跑。
- iOS Safari 是否对普通 `div` 派发 `contextmenu`（决定事件菜单在 iPhone 上是否可开）。
- 双击（`dblclick`）在触屏上的可靠性——它同时承担"新建事件"与"打开详情"。

---

## 第二部分 · GitHub 同类项目调研

分四组检索。每组给出定位、技术选型、可借鉴点与不足。星标/许可/活跃度均由 GitHub API 于 2026-09-16 核实。

### A 组 · 四象限／艾森豪威尔任务管理（与象限最同源）

| 项目 | 规模 | 技术选型 | 数据与同步 | 可借鉴 | 不足 |
| --- | --- | --- | --- | --- | --- |
| [NickKasten/PriorityMatrix](https://github.com/NickKasten/PriorityMatrix) | 0★ · TypeScript · 最后提交 2025-11 | React Router v7 + TypeScript + Supabase + Tailwind + **@dnd-kit** + Playwright | Supabase（**同为 GitHub Pages + Supabase 组合**）；邮件 magic-link 鉴权；含"1 任务/秒写入、30 活跃任务上限、100 用户租户上限"的**用量护栏**（SQL 迁移里用触发器实现） | 「任务在重要/紧急二维图上定位」的交互；**用量护栏设在数据库层**而非前端；`supabase/migrations/` 承载 schema 版本 | 无星标、无社区；纯二维图非坐标系；未解决冲突合并 |
| [khalidnawab/eisentasker](https://github.com/khalidnawab/eisentasker) | 0★ · TypeScript · 最后提交 2025-11 | React 18 + Vite + Tailwind + **@dnd-kit** + Recharts + date-fns | 纯 localStorage；JSON 导入导出；浏览器通知 | 「**智能时间分配**」：由截止时间与剩余工作量反算每日所需工时、超载预警、不可能的截止日提示——这类"算给你看"的派生指标正是象限缺失的 | 无云同步；Context+useReducer 规模上限低；无测试 |
| [Clarru/dcyde](https://github.com/Clarru/dcyde) | 3★ · MIT · TypeScript · 最后提交 2025-06 | React 18 + Vite + **React Router** + Zustand + Tailwind + Framer Motion | 本地；多矩阵（每个矩阵有独立 URL） | **多矩阵 + URL 即状态**（`/matrix-name`，浏览器前进/后退可用）；四象限头部的批量操作菜单 | 无同步；无测试 |
| [Lil-mast/TaskManagement](https://github.com/Lil-mast/TaskManagement) | — · React + TS + Tailwind | Firebase Auth + Supabase 双后端；**"本地模式"零配置即可用** | 强调"Local Mode: Works immediately without setup"，云同步为可选增强 | 与象限"网页端必须登录"形成对照：**本地优先、云端可选**的取舍 | README 大量"Coming Soon"（AI 排期、日历同步等未实现）；设计与功能落差大 |

**A 组结论**：四象限类项目的共性是「网格/卡片 + 拖放 + 本地存储」，**没有一个做"可自由定位的坐标系画布"**。象限的四象限模块在该品类里是独一份的重交互实现。反过来讲，该品类最值得偷的是两样：**URL 可寻址**（dcyde、PriorityMatrix）与**派生指标计算**（eisentasker）。

### B 组 · 无限画布／白板（交互与渲染参照）

| 项目 | 规模 | 许可 | 可借鉴 | 不足／风险 |
| --- | --- | --- | --- | --- |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 132,066★ | **MIT** | 图片元素（upload + 落盘为 base64 或文件）；本地优先 + E2E 加密协作；可嵌入（Obsidian/Notion 都在用）；场景序列化为 JSON | 手绘风是产品个性，硬套会破坏象限视觉；整包体量大 |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | 72,648★ | Other（多许可，需自行确认） | **同一份数据两种视图**：文档模式 ↔ Edgeless 无限画布，块（block）模型可在两态间迁移——与象限"周计划 → 四象限"联动是同族问题 | 体量与架构复杂度远超个人项目；许可是混合制 |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | 50,380★ | **Other（非 OSI，含商业条款与水印移除付费）** | React SDK 化程度最高；`asset store` 抽象（图片/视频资产的注册、加载、缓存）值得照搬概念 | **许可证是硬约束**：商业使用受限、付费去水印。不适合直接引入 |
| [plait-board/drawnix](https://github.com/plait-board/drawnix) | 14,717★ | **MIT** | 插件化架构；思维导图/流程图/自由画统一坐标系；图片插入 | 以绘图为中心，非"任务承载" |
| [spacedeck/spacedeck-open](https://github.com/spacedeck/spacedeck-open) | 1,138★ | AGPL-3.0 | 富媒体（图片/视频/PDF）直接摆放在无限画布上——"贴纸附图片"的早期实现 | **最后提交 2023-10，已停更约 3 年** |

**B 组结论**：若象限将来要扩成"自由拼贴 + 贴纸附照片"，**交互范式可从 B 组借，代码不必借**。现有 DOM + CSS transform 方案（事件卡是 DOM，`<canvas>` 只画象限底色与坐标轴）在"每象限 ≤30 事件"的规模下是**正确选择**：可用 CSS 做样式、可访问性好、命中测试免费。

### C 组 · 拼贴／照片看板（贴纸挂图片的直接参照）

| 项目 | 规模 | 技术选型 | 数据 | 可借鉴 | 不足 |
| --- | --- | --- | --- | --- | --- |
| [CGSeb/moodcrate](https://github.com/CGSeb/moodcrate) | 3★ · GPL-3.0 · Tauri v2 + React 19 | 桌面应用 | localStorage | **三段式信息架构**：Collections（素材）→ Tags（层级标签，无限深度）→ Moodboards（自由画布，拖放/缩放/框选/多选移动/Markdown 文本块）；**缩略图异步批量生成 + 磁盘缓存**；测试同时跑 Vitest 与 cargo test 并上传覆盖率 | 无云同步；Tauri/Rust 栈与象限不同 |
| [davidbrum25/moodinfinite](https://github.com/davidbrum25/moodinfinite) | 1★ · GPL-3.0 · 纯静态 JS | LocalForage（IndexedDB） | 项目 = ZIP 包（`state.json` + 图片压成 `.webp`）；Google Drive 云同步含**冲突处理**；**"Moodlist"：类 Google Keep 的清单卡，每张卡可挂图片附件**——与需求"贴纸可附可视化照片文件"最接近 | 无构建工具、无测试；单人项目 |
| [Sneha-Chakraborty/VisionVault](https://github.com/Sneha-Chakraborty/VisionVault) | 0★ · JavaScript | React 18 + Tailwind，纯客户端 | localStorage | **上传即压缩**（`fileToDataUrlResized`）；画廊 → 拼贴（网格/马赛克预设）→ 自由画布（拖动/缩放/旋转 + 便利贴 + 文本）三段式；Canvas API 导出 PNG | 用 localStorage 存图片，**容量天花板极低**（见第四部分 D3） |
| [RukhsarAhmed77/moodboard.app](https://github.com/RukhsarAhmed77/moodboard.app) | — · React 19 + Vite + Tailwind v4 + **Supabase** + @dnd-kit + shadcn/ui | Supabase `boards` 表，`images jsonb`，**RLS 策略为 `using (true)`**（任何人可读写任何人） | 「React 19 + Supabase + dnd-kit + 画布拖放」是本项目最接近的全栈组合；表结构极简（id/name/images jsonb/时间戳） | **RLS 是明确的安全反模式**——象限的 `auth.uid() = user_id` 明显更正确 |
| [3oaza/Vibey](https://github.com/3oaza/Vibey) | 浏览器扩展 | 原生 JS + HTML5 Canvas + CCapture/gif.js | 无限画布（400% 缩放）、图层管理、从网页拖图入画布、导出 GIF/4K MP4 | 「从外部拖入素材」+「图层可见性/分组」是贴纸类产品的成熟交互 | Manifest V3 扩展形态，与本项目场景不同 |

**C 组结论**：这一组直接回答了"贴纸挂照片"该怎么做——**素材库 + 标签 + 自由画布 三段式**（moodcrate 最完整），以及**上传即压缩 + 缩略图异步生成 + 大文件不进 localStorage**（moodinfinite 用 IndexedDB，VisionVault 因为用 localStorage 而受限于容量）。象限当前**没有任何附件字段，数据层也放不下图片**，这是做该功能前必须先解决的前置条件。

### D 组 · 双端（桌面 + 手机）任务管理器（架构参照）

| 项目 | 规模 | 技术选型 | 数据与同步 | 可借鉴 | 不足 |
| --- | --- | --- | --- | --- | --- |
| [super-productivity/super-productivity](https://github.com/super-productivity/super-productivity) | 22,059★ · **MIT** · 活跃 | TypeScript（Angular）；桌面 Electron + Android/iOS 原生壳 + Web | **无需账号、不收集数据、用户自选存储位置**；同步后端可选：自研 **SuperSync（端到端加密、支持自托管，独立包 `packages/super-sync-server`）**、Dropbox、WebDAV；另有 Jira/Trello/GitHub/Linear 等任务导入 | 「**用户自选同步后端**」这一设计把"个人数据主权"与"多设备"同时满足——象限把全部身家押在单一 Supabase 项目上，风险集中；README 明示 **Web 版功能弱于桌面版**，与象限"网页手机端不如桌面端"的现实一致（说明这是普遍难点） | 冲突处理策略未在 README 说明，需要读源码；Angular 栈 |
| [kanriapp/kanri](https://github.com/kanriapp/kanri) | 2,028★ · GPL-3.0 · 活跃 | **Tauri + Nuxt（Vue）** | 完全离线，无账号无云 | 「**离线优先的桌面看板**」——不做云同步也能成为成熟产品（2k★ 且今日仍在更新）；拖放与列的交互细节 | 无移动端；Vue 栈 |
| [go-vikunja/vikunja](https://github.com/go-vikunja/vikunja) | 5,413★ · AGPL-3.0 · 活跃 | Go 后端 + Vue 前端 | 自托管服务端；另有移动端 | 「自托管 + PWA」路线：数据在自己服务器上，同时获得手机可用性 | AGPL 传染性与自托管运维成本 |
| [revezone/revezone](https://github.com/revezone/revezone) | 2,656★ · AGPL-3.0 | 本地优先 + Excalidraw/Tldraw 白板 + 类 Notion 笔记 | 本地优先 | 「**图形为中心 + 本地优先**」的组合思路；把成熟白板作为嵌入组件而非自研 | **最后提交 2024-01，已停更约 20 个月**，不可作为技术依赖 |

**D 组结论**：双端产品在"网页端功能弱于桌面端"上是**普遍现象**（super-productivity 直接把这一点写进 README）。象限的情况不是能力不足，而是**资源分配问题**。同时 D 组给出一条重要替代路径：**不引入服务端也能做多设备同步**（WebDAV/自有网盘/自托管 E2EE 服务）。

---

## 第三部分 · 横向对比

### 3.1 技术选型对照

| 维度 | 象限（现状） | A 组（四象限类） | B 组（画布类） | C 组（拼贴类） | D 组（双端类） |
| --- | --- | --- | --- | --- | --- |
| 画布渲染 | 混合：`<canvas>` 画底 + DOM 事件卡 + CSS transform | DOM 网格 | Konva/Fabric/自研 canvas 场景图 | DOM + transform 为主 | 视项目而定 |
| 平移缩放 | 自研（wheel + pointer + 双指捏合） | 无 | 自研或库（tldraw/Excalidraw 自研） | 自研 | — |
| 拖放 | 自研 pointer + setPointerCapture | **@dnd-kit 为主流** | 自研 | **@dnd-kit（React 项目）** | — |
| 状态管理 | zustand 单 store | zustand / Redux / Context | 自研 store / Yjs | React state / LocalForage | Angular services |
| 本地存储 | localStorage（单键整份 JSON） | localStorage 为主 | IndexedDB / 自有格式 | **IndexedDB（LocalForage）/ Tauri 文件** | 文件 + IndexedDB |
| 云同步 | **Supabase 单行 jsonb + 整份覆盖 + LWW** | Supabase（PriorityMatrix）/ 无 | CRDT（Yjs，可选） | Google Drive（含冲突处理） | 网盘/WebDAV/自托管 E2EE |
| 冲突策略 | **无（整份覆盖）** | 无 | CRDT | 文件级冲突副本 | 未明示 |
| 鉴权 | 用户名别名 → Supabase Auth | magic-link / Firebase | 无账号（Excalidraw）/ 多许可 | 无 | 无账号 |
| 移动适配 | 媒体查询 + 毛玻璃底栏 + bottom sheet + 安全区 | 响应式为主 | 以鼠标 + 触控板为主 | 桌面优先 | 原生壳 |
| 测试 | **102 个纯逻辑用例** | 多为 0 | 大量单测 + e2e | 多为 0–少量 | 完整 CI |

### 3.2 象限已经做对的地方（对照结论）

1. **平台抽象层**：`getPlatformApi()` 的做法比 A/C 组绝大多数项目（到处直接读 `localStorage` 或 `window.electronAPI`）更干净。这正是 dev 分支 `ReviewRecords.tsx` 直连 `window.quadrantApi` 导致网页崩溃的根因治理。
2. **纯逻辑可测**：102 个用例覆盖象限数学、边界约束、升级规则、周计划规则、数据校验。A/C 组多数项目**测试为零**——象限在这项上是上游水平。
3. **RLS 正确**：`auth.uid() = user_id` 对比 `moodboard.app` 的 `using (true)`，安全模型明显更对。
4. **移动规格先行**：把断点、44px、安全区、`86dvh`、毛玻璃回退写成文档再实现，这在个人项目里罕见。缺陷不在规划，而在**实现与规划的偏差没有被核对**。
5. **构建契约可测**：`webBuild.test.ts` 把"产物路径必须是相对 base"变成测试，避免 GH Pages 子路径 404。

### 3.3 象限相对同类的独特之处

四象限做成**可平移缩放的坐标系 + 世界坐标存储 + 象限边界钳制 + 紧急升级**，在检索到的四象限品类里没有同类实现（A 组全是固定网格）。这是产品差异化所在，也是**技术债集中区**（自研手势、自研碰撞、坐标空间与屏幕空间混用）。

---

## 第四部分 · 修改建议

按"先让手机能用、再让数据不丢、最后扩展能力"排序。每条给出依据、方案、成本与风险。

### P0-1 统一触控语义：长按 = 打开 action sheet，而非拖动

- **问题**：长按事件被绑成"开始拖动"（`EventCard.tsx:54-59` → `QuadrantPage.tsx:497-500`），而操作菜单依赖浏览器原生 `contextmenu`（`QuadrantPage.tsx:502-504`）。同一手势两条路径，行为取决于浏览器实现；移动规格 Task 4 Step 4 要求的是"长按打开菜单"。
- **方案**：长按（450–550ms）→ 打开 action sheet（复用现有 `ContextMenu` + 现有移动端底部样式）；拖动改为**长按后不松手继续移动**或**选中后拖 44px 把手**；`contextmenu` 仅保留给桌面。
- **成本**：低（改动集中在 `EventCard.tsx` 一个组件的手势状态机）。
- **风险**：需实测抖动阈值，避免"轻微移动被误判为长按"。

### P0-2 四象限移动端补一个显式新建入口

- **问题**：移动端新建事件只有双击（`onDoubleClick`，鼠标语义），全仓 `mobile-only` 元素仅 1 处且是提示文案。用户第一次打开不知道该怎么加事件。
- **方案**：底部悬浮「＋」按钮（位于 Tab Bar 上方，避开安全区），点击进入 `setEditing({ mode: 'create', ... })`，位置取视口中心对应的世界坐标；顺手在新建时默认归属可见中心象限。
- **成本**：低（复用现有 `setEditing` 通路）。
- **风险**：与 Tab Bar 视觉层级需协调（`z-index`）。

### P0-3 同步语义：把"整份覆盖"改成"可判定的合并"

- **问题**：数据是单行单 jsonb，LWW 粒度 = 整个应用数据。手机与桌面各改一次必然互相覆盖。参考资料的一致结论：**LWW 对"行/实体"粒度足够（约 95% 场景），对"整份文档"粒度则必然丢数据**；此时才需要 CRDT。
- **方案（按成本递增，建议先做 A）**
  - **A（推荐）行级化 + LWW**：把 `user_data.data` 一个 jsonb 拆成实体行（`goals` / `events` / `week_events` / `week_presets`），每行带 `id`、`updated_at`、`_deleted` 软删标记，加 `(user_id, updated_at)` 索引与 `updated_at` 更新触发器。冲突单位从"整份"降到"单条"。参考 `rapidevelopers.com` 的 Supabase 同步模板与 PowerSync 的 LWW 经验。
  - **B（最小改动）**：保留 blob，但加 `revision` / `updatedAt` 与**覆盖前二次确认**（项目已有 `ConfirmDialog`，接线成本极低），并在覆盖前把本地写一份快照，提供"撤销到上一次同步前"。
  - **C（不推荐）**：Yjs/Automerge CRDT。单用户双设备场景收益极低，复杂度与体积成本很高。
- **成本**：A 为中（需数据迁移 + 改 5 处 store 的读写路径），B 为低。
- **风险**：A 需处理旧数据的首次迁移与回滚。

### P0-4 统一数据校验器，堵住云端注入不完整数据

- **问题**：`cloudSync2.validCloudData` 浅校验（`version` + 四个数组）vs `platformApi.validAppData` 深度校验（逐字段）。浅校验通过即可整份覆盖本地，随后渲染层崩。
- **方案**：把 `validAppData` 提到 `src/shared/`，两个入口共用同一实现；云端数据校验不通过时**拒绝覆盖**并提示，而不是静默采用。
- **成本**：低（移动一个函数 + 两处引用）。
- **风险**：几乎无。

### P1-1 桌面端接入 realtime 与上行同步

- **问题**：`App.tsx:47-50` 明确桌面端不订阅 realtime；`appStore.ts:99-104` 桌面端 `saveSoon` 不上传。结果是双向滞后。
- **方案**：与 P0-3 一并做。桌面端订阅 realtime 时**必须同时具备"本地优先"的写路径**（本地先落盘 → 异步上行），避免网络抖动阻塞编辑。参考 Supabase Realtime 的已知限制：Postgres CDC 有 200–500ms 延迟下限、WebSocket 空闲约 60s 断开、**自动重连不可靠，需要显式重连并监听 `window.online` 强制重建 channel**（该坑在 `trolz.dk` 的复盘文章里有完整记录）。
- **成本**：中。
- **风险**：需先有 P0-3 的行级粒度，否则实时推送整份覆盖会放大丢数据问题。

### P1-2 在 HTML 根节点区分运行壳，隔离桌面／网页样式

- **问题**：所有移动适配都基于 `@media (max-width: 767px)`，**没有桌面豁免**。Electron 窗口被拖窄即变手机版：`.upload-button { display: none }`（`theme.css:2202`）会隐藏桌面的上传按钮，底部 Tab Bar 也会顶替侧边栏。
- **方案**：`main.tsx` 启动时给 `document.documentElement` 打 `data-shell="electron" | "web"`；移动规则写成 `[data-shell='web']` 作用域内。
- **成本**：低（一处初始化 + 媒体查询选择器加前缀）。
- **风险**：需回归检查桌面窄窗口的表现。

### P1-3 把 typecheck 与测试接进 CI

- **问题**：`.github/workflows/deploy-pages.yml` 只跑 `npm ci && npm run build:web`；102 个测试与两套 tsconfig 从不自动执行。
- **方案**：build job 前加 `npm run typecheck && npm test`。
- **成本**：极低（3 行 YAML）。
- **风险**：无。

### P1-4 建立"规格 ↔ 实现"的核对机制

- **问题**：移动规格里的"长按打开菜单"没被实现，而没人发现。这不是能力问题，是**流程缺环**。
- **方案**：把规格中的验收项（断点、44px、象限语义、安全区、bottom sheet）写成可执行的检查清单或 e2e（项目已有 Playwright 可用的环境基础，`docs/cdp-inspect.mjs`、`docs/qa-*.mjs` 是现成的 CDP 脚本）。
- **成本**：中。

### P2-1 移动端返回手势：给单日页／记录页加一层历史记录

- **问题**：无路由 → 周计划单日页、复盘记录页无法用浏览器返回键或 iOS 边缘手势返回（移动端最基础的操作习惯被破坏）。
- **方案**：仅在这两个子页 `history.pushState` 时入栈，监听 `popstate` 做"返回上一级"；无需引入路由库。
- **成本**：低。
- **风险**：需处理"已入栈但用户点击应用内返回按钮"的双路径，避免栈失衡。

### P2-2 设计真相收敛

- **问题**：`design/DESIGN.md`（Notion 浅色体系）与实装（深色单主题）互不相干，构成两份设计真相。
- **方案**：二选一——① 归档该参考，在 `design/README.md` 注明"未采用"；② 把 Notion 令牌作为未来浅色主题的输入，并把实装令牌补成完整语义化体系（现状只有 11 个变量，缺少 `--space-*`、`--text-*`、`--radius-*` 的完整梯度）。
- **建议**：明确采用 ①，理由是本项目在桌面与移动上的视觉方向（深色 + 玻璃拟态 + 蓝色强调）已经自洽，引入浅色体系会分裂两套维护成本。

### P2-3 附件（贴纸挂照片）能力：先解决存储，再做 UI

- **问题**：数据模型无附件字段；网页端存储是 localStorage（**容量约 5MB**），base64 图片体积约为原文件的 1.37 倍。VisionVault 用 localStorage 存图，是其最明显的天花板；moodinfinite 改用 IndexedDB（LocalForage）后才敢做批量图片。
- **方案（分三步）**
  1. **存储先行**：图片走 Supabase Storage（bucket + 按 `auth.uid()` 的 RLS 策略），本地缓存走 IndexedDB；`AppData` 只存引用（`{ assetId, width, height, thumbKey }`），不存二进制。
  2. **上传即压缩**（照抄 VisionVault 的 `fileToDataUrlResized` 思路）：客户端生成 ≤1600px 的长边版本 + 200px 缩略图，缩略图异步批量生成（照抄 moodcrate）。
  3. **再做 UI**：贴纸 = 事件的扩展（`rotation`、`z`、`assetId` 字段），沿用现有 DOM + transform 渲染。
- **成本**：高（跨数据层、同步层与 UI 层）。
- **风险**：若跳过第 1 步直接做 UI，会立刻撞上 localStorage 配额，且同步 blob 会因图片而急剧膨胀。**这是本报告中唯一"顺序不能颠倒"的建议。**

---

## 第五部分 · 明确不建议做的事

1. **不要引入 tldraw**：许可为非 OSI（含商业条款与水印移除付费），且其交互范式（无限白板）与象限（固定四象限坐标系 + 语义约束）不匹配。
2. **不要引入 CRDT（Yjs/Automerge）**：单用户双设备、冲突单位是实体行时，LWW 已足够；CRDT 会带来体积、调试与迁移的复合成本。
3. **不要把渲染层重写为 Canvas 场景图（Konva/Fabric）**：当前每象限 ≤30 事件的规模下，DOM + transform 在性能、可访问性与开发效率上都更优；该方案的上限约在千级元素，尚有很大余量。
4. **不要为"网页端能离线"而自建后端**：super-productivity 的 WebDAV/网盘路线证明无需服务端也能多设备同步；若将来要脱敏，优先考虑"用户自选同步后端"，而不是再加一个自研服务。
5. **不要把任何密钥/口令写回客户端**：bundle 内的密钥必然可被解出，正确的动作是让密钥不存在于客户端（桌面端已改为会话持久化 + 按需登录）。

---

## 第六部分 · 建议的执行顺序

| 顺序 | 事项 | 直接收益 | 成本 |
| --- | --- | --- | --- |
| 1 | P0-1 触控语义统一 | 手机端"长按 = 菜单"符合直觉 | 低 |
| 2 | P0-2 新建入口 | 手机端"能加事件"可见 | 低 |
| 3 | P0-4 校验器统一 | 堵住云端坏数据覆盖 | 低 |
| 4 | P1-3 CI 加门禁 | 后续改动不再裸奔 | 极低 |
| 5 | P0-3(A) 行级 LWW | 双设备不再互相覆盖 | 中 |
| 6 | P1-1 桌面 realtime + 上行 | 双端真正一致 | 中 |
| 7 | P1-2 运行壳区分 | 桌面窄窗口不再样式错乱 | 低 |
| 8 | P2-1 返回手势 | 移动端基础习惯 | 低 |
| 9 | P1-4 规格核对机制 | 防止再次"规格未落地" | 中 |
| 10 | P2-3 附件能力 | 贴纸挂照片 | 高（前置：存储层） |

**下一步建议**：在动任何代码前，先做一次**移动端实测取证**——用 375×667 / 390×844 / 430×932 三个视口，在真机或 DevTools 触控模拟下逐页记录实际问题（含本报告标注的"待实测确认"三项），形成可核对的问题清单。凭代码推断的结论已经在本次调研中修正过一次（长按实际被实现为拖动），实测能避免同类偏差。

---

## 附录 · 数据来源与核实方式

- 本地代码与文档：`main` 基线（`e0bf647`）实际文件内容，引用均标注 `文件:行号`。
- 项目元数据：GitHub REST API `/repos/{owner}/{repo}` 与 `/license`，查询时间 2026-09-16；星标为查询时点数值。
- 技术结论：Supabase Realtime 的延迟下限与连接行为、LWW 与 CRDT 的适用边界，来源为 PowerSync、rapidevelopers、starterpick、trolz.dk 等公开工程实践文章；均已标注为"公开资料的一致结论"，非本项目实测。
- 未核实项（保持标注）：`super-productivity` 的冲突处理细节未在其 README 说明，本报告未对其做任何断言。
