# 象限移动竖屏 Web 版设计规格

## 目标

在保留现有 Electron 桌面体验和业务规则的前提下，为“象限”增加可部署到 GitHub Pages 的移动竖屏 Web 版。手机端采用 Apple 风格的深色界面、底部毛玻璃 Tab Bar、至少 44px 的触控热区，并针对目标、四象限、周计划和周日复盘分别重排。

本次以当前工作区标注的 `0.4.0` 为目标版本；隔离分支会同步现有仅包含版本号的 `package.json` 与 `package-lock.json` 变更，不带入 QA 临时目录。

## 范围

### 包含

- 桌面端继续使用左侧导航，移动端将同一组四个一级入口移动到底部。
- 移动端导航、页面布局、弹窗、菜单、列表、周计划和四象限触控适配。
- Web 数据适配层，使浏览器环境不依赖 Electron preload。
- 独立的 Web 构建命令和 GitHub Pages 友好的相对资源路径。
- 自动测试、类型检查、Electron 构建和 Web 构建验证。
- README 中补充本地 Web 预览及 GitHub Pages 部署说明。
- 提供可用于生图或图生图的页面提示词。

### 不包含

- 自动创建 GitHub 仓库、推送、发布或修改 GitHub 权限。
- 账号体系、云同步、服务端数据库和多人协作。
- 重写现有业务规则或迁移用户现有 Electron 数据。
- 在 Web 端生成 `.docx`；Web 端复盘使用浏览器可下载的文本文件并保存本地记录，Electron 仍生成 Word。

## 响应式架构

桌面布局保持现状。`767px` 及以下进入移动模式；`768px–1023px` 使用紧凑桌面/平板模式；`1024px` 及以上维持桌面布局。

移动端根布局使用动态视口高度 `100dvh`，内容区域为唯一主滚动容器。内容底部预留 Tab Bar 高度和 `env(safe-area-inset-bottom)`，避免列表或画布被遮挡。所有横向溢出均限制在明确的时间轴或卡片轨道内，页面本身不得产生意外横向滚动。

页面切换沿用当前顺序：目标 → 四象限 → 周计划 → 周日复盘。桌面端保留纵向转场；移动端使用短距离横向位移与淡入，且尊重 `prefers-reduced-motion`。

## 导航与 Apple 风格材质

`Sidebar` 继续作为单一导航组件，但根据 CSS 断点呈现两种形态：

- 桌面：220px 左侧栏、品牌和口号保持不变。
- 手机：固定在视口底部的四等分 Tab Bar，顺序和业务页面一致：目标、四象限、周计划、复盘。
- 手机 Tab Bar 距离左右边缘 12px，圆角 26px；主体使用半透明深灰背景、`backdrop-filter: blur(24px) saturate(150%)`、顶部高光边和柔和外阴影。
- 活跃项使用蓝色图标与文字，并在图标后方显示克制的蓝色半透明圆角底；非活跃项为中性灰。
- 每个 Tab 的实际触控区域不小于 44×44px；图标与文本均参与点击。
- 在不支持 `backdrop-filter` 时使用不透明深灰回退色，保证文字对比度。

## 目标页面

- 目标首页由桌面双列在手机上变为“长期目标”“短期目标”单列堆叠。
- 目标卡片保持复选框、名称、进度和操作能力；触控按钮扩大到 44px，允许按钮行在窄屏换行，但不得压缩标题为不可读宽度。
- 长期目标详情中的分组统一变为单列卡片流，卡片自身不再依赖固定高度；组内列表自然增高并由页面滚动。
- 依赖双击的分组重命名在手机端增加清晰的编辑按钮，桌面双击仍可使用。

## 四象限页面

### 位置语义

四个象限严格按以下位置和语义排列，不得调换：

| 位置 | 象限 | 标题 | 辅助文案 | 主色 |
| --- | --- | --- | --- | --- |
| 右上 | Q1 | 重要紧急 |  | 橙 `#FF8C00` |
| 左上 | Q2 | 重要不紧急 |  | 黄 `#FFA500` |
| 左下 | Q3 | 不重要不紧急 |  | 青 `#008B8B` |
| 右下 | Q4 | 不重要紧急 |  | 紫 `#483D8B` |

现有数学坐标和视觉位置保持原程序设置：Q1 世界坐标 `x >= 0, y >= 0`（右上），Q2 `x < 0, y >= 0`（左上），Q3 `x < 0, y < 0`（左下），Q4 `x >= 0, y < 0`（右下）。移动端不得通过 CSS 或数据转换调换象限。

### 手机交互

- 手机默认显示适合竖屏的 2×2 象限画布；各象限以半透明主色背景和同色边框区分。
- 标题标签固定在各自象限角落，颜色与表格一致。
- 单指拖动画布；双指捏合缩放；双击空白区域新建事件。
- 长按事件打开操作菜单；手机菜单呈现为底部 action sheet，桌面仍为右键浮层。
- 事件卡片支持拖动跨象限，放置后必须沿用现有业务规则更新 `quadrant`。
- 顶部桌面提示在手机上改为“拖动画布 · 双指缩放 · 双击新建”。

## 周计划页面

周计划主页面参考用户给出的图一，但沿用项目现有功能和色板：

- 顶部显示“本周计划”、日期范围和“第 N 周”，左右切周按钮保持可见。
- 日期轨道单独位于时间轴上方，七天等分；今天用蓝色实心圆与小圆点标记。点击日期进入单日页。
- 下方为 07:00–24:00 的纵向时间轴，左侧固定时间标尺，右侧七日列可在窄屏横向滚动；初始优先让今天列进入可视区域。
- 事件块继续使用预设颜色，展示开始时间和标题；高度按时长计算，短事件只显示最必要信息。
- 桌面仍一次展示完整七列，不改变当前概览行为。
- 单日页保留纵向时间轴；右侧预设面板在手机上改为时间轴下方的可折叠预设区，预设点击后进入事件创建表单，不要求 HTML5 拖放。
- 手机端支持点击时间轴空白处创建事件，作为桌面双击的触控替代。

## 周日复盘页面

- 标题和操作按钮在手机上分为两行，主要保存操作保持醒目。
- 三个分段滑杆由水平“标签 + 控件”变成纵向卡片，轨道保持完整宽度。
- 文本区最小高度适配剩余空间，页面内容过长时正常纵向滚动。
- 复盘记录行在手机上压缩为图标、文件名/日期和大小三段，避免横向溢出。
- Toast 位于底部导航上方。

## 弹窗、菜单与表单

- 桌面维持居中 modal；手机端统一贴底为 bottom sheet，顶部圆角 22px，最大高度 `86dvh`，内容区可滚动。
- 表单输入、选择器、按钮的有效高度至少 44px；主次操作在极窄屏可等宽排列。
- 四象限和周计划的上下文菜单在手机上使用 action sheet，危险操作保持红色。
- 键盘弹出时页面允许滚动到当前输入框，不锁死内容。

## 平台 API 与数据流

新增 renderer 可用的平台 API 入口，调用方不再直接假设 `window.quadrantApi` 必然存在：

1. Electron 环境检测到 preload API 后，所有行为透传现有 IPC。
2. Web 环境用 `localStorage` 保存 `AppData`，键名带版本前缀；解析失败时回退 `defaultData()`，同时保留损坏字符串直到下一次成功保存，避免无提示销毁。
3. Web 复盘保存为浏览器本地记录，并触发 UTF-8 `.txt` 下载；列表从 localStorage 中读取，打开记录时再次下载对应内容。
4. `scheduleSave` 继续作为写入节流入口，因此 Electron 与 Web 的状态更新语义一致。
5. 存储不可用或下载失败时抛出可读错误，由现有错误弹窗展示。

## 构建与 GitHub Pages

- 保留 `npm run dev`、`npm run build`、`npm run package` 的 Electron 含义。
- 新增 `npm run dev:web` 和 `npm run build:web`，使用 renderer 专用 Vite 配置。
- Web 构建使用相对 `base`，产物放入独立目录，支持仓库子路径下的 GitHub Pages。
- 应用不使用 URL 路由，因此刷新不会产生 SPA 404。
- README 给出 `npm run build:web` 和将产物目录发布到 GitHub Pages 的步骤，但本任务不执行发布。

## 测试与验收

### 自动测试

- 为平台 API 添加 Web fallback 测试：空存储、有效数据、损坏数据、保存数据、保存/列出/打开复盘。
- 为响应式纯逻辑添加可测试的设备/交互判定，避免关键行为仅依赖人工观察。
- 四象限现有数学测试继续验证 Q1/Q2/Q3/Q4 的坐标映射；增加颜色/文案映射断言。
- 运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run build:web`。

### 视觉验收尺寸

- iPhone SE 类：375×667。
- 主流 iPhone：390×844。
- 大屏 iPhone：430×932。
- 桌面回归：1280×800。

视觉验收需确认：无页面级横向溢出、底栏不遮挡内容、底部安全区正确、触控目标至少 44px、四象限位置/颜色正确、周计划当天标记和事件块清晰、毛玻璃有不支持时的回退。

## 生图与图生图提示词

### 周计划主页面

`A high-fidelity iOS dark-mode mobile productivity app screen in a 9:19 portrait ratio, Chinese interface for a weekly planner. Top status bar, large title “本周计划”, date range and week number, compact previous/next controls, seven-day date strip with today highlighted by a bright Apple-blue circle. Below it, a vertically scrollable calendar timeline from 07:00 to 24:00, thin graphite grid, seven day columns, colorful compact event blocks in blue, green, purple, orange and amber with time and Chinese titles. Floating frosted-glass bottom tab bar with four items: 目标, 四象限, 周计划, 复盘; 周计划 is active in blue. Apple Human Interface Guidelines, deep black graphite background, translucent materials, subtle borders, restrained glow, highly legible typography, realistic app screenshot, no device frame.`

图生图补充：`Preserve the reference image’s weekly calendar hierarchy and spacing, but replace its navigation labels with 目标 / 四象限 / 周计划 / 复盘, keep all typography in Simplified Chinese, preserve the project’s muted event color palette, remove search and unrelated profile features.`

### 四象限主页面

`A high-fidelity iOS dark-mode Eisenhower matrix productivity app in a 9:19 portrait ratio, Chinese interface. Large title “四象限”. Preserve the original program’s quadrant mapping and placement exactly: top-right Q1 重要紧急 in orange, top-left Q2 重要不紧急 in amber, bottom-left Q3 不重要不紧急 in teal, bottom-right Q4 不重要紧急 in indigo. Do not swap quadrant positions or semantics. Each quadrant contains compact translucent task cards with clear touch affordances and small count badges. Below the grid, a subtle gesture hint and a frosted-glass bottom action sheet for quick task creation. Floating frosted-glass bottom tab bar with 目标 / 四象限 / 周计划 / 复盘, 四象限 active in blue. Apple HIG, graphite black background, restrained colored glow, accessible contrast, realistic app screenshot, no device frame.`

图生图补充：`Preserve the original app’s quadrant positions and colors: Q1 top-right orange, Q2 top-left amber, Q3 bottom-left teal, Q4 bottom-right indigo. Do not reinterpret or swap the original program mapping. Replace the reference bottom navigation labels with the project’s four modules.`

### 目标页面

`High-fidelity iOS dark-mode goal manager, portrait 9:19, Chinese UI. Large title “目标”, two vertically stacked sections “长期目标” and “短期目标”, compact graphite cards with checkbox, progress, title and discreet touch actions, blue and green section accents, generous mobile spacing, frosted-glass bottom tab bar with 目标 active, Apple HIG, subtle depth, no device frame.`

### 周日复盘页面

`High-fidelity iOS dark-mode weekly reflection app screen, portrait 9:19, Chinese UI. Large title “周日复盘”, three stacked evaluation cards for 计划完成度, 计划完成质量, 压力指数 with colorful segmented sliders and clear values, large comfortable writing area with placeholder “写下本周的复盘…”, compact save actions, frosted-glass bottom tab bar with 复盘 active in Apple blue, accessible typography, graphite black materials, no device frame.`
