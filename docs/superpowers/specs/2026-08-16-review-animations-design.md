# 周日复盘模块 + 全局动画设计文档

- 日期：2026-08-16
- 状态：已获用户确认（含 4 点澄清）
- 技术栈：Electron + React + TypeScript + Zustand + Vitest

## 1. 目标与范围

在现有"象限"应用（目标、四象限、周计划、周日复盘四个主页面）中：

1. 把周日复盘占位页替换为完整模块：三个指数滑动条、复盘文本框、草稿保存、Word 导出、复盘记录子页。
2. 全局动画：侧边栏活动高亮条上下滑动、子页面左右滑动、周计划单日打开放大/关闭右滑、四象限缩放/平移惯性并修复缩放抖动。

本阶段复盘草稿仅保存在内存中，不写入 `plan.json`，关闭程序后消失（用户明确要求）。

## 2. 数据模型与接口

### 2.1 内存草稿（不持久化）

```ts
export interface ReviewDraft {
  completion: number // 计划完成度 0..10
  quality: number    // 计划完成质量 0..10
  stress: number     // 压力指数 0..10
  text: string
}
```

`ReviewDraft` 放在 Zustand store 中，但不放进 `AppData.data`，因此 `saveSoon` 不会持久化它；应用关闭后自然消失。UI 的"未保存"由当前编辑值是否等于最近保存的草稿判断。

### 2.2 复盘记录文件元信息

```ts
export interface ReviewRecord {
  fileName: string   // 例如 2026年8月16日周日复盘.docx
  filePath: string   // 绝对路径
  size: number       // 字节
  modifiedAt: string // ISO 时间
}

export interface ReviewExport {
  completion: number
  quality: number
  stress: number
  text: string
}
```

### 2.3 IPC 扩展

在现有 `QuadrantApi` 上增加三个方法（preload 同对象暴露）：

```ts
saveReview(payload: ReviewExport): Promise<ReviewRecord>
listReviews(): Promise<ReviewRecord[]>
openReview(filePath: string): Promise<{ ok: boolean; error?: string }>
```

- `saveReview`：生成（或覆盖）当天 `.docx`，返回文件元信息。
- `listReviews`：扫描复盘目录，返回按修改时间倒序的记录。
- `openReview`：用 `shell.openPath` 用系统默认程序打开；文件不存在返回 `{ ok: false, error }`。

## 3. 周日复盘页 UI

### 3.1 布局

- 顶部页头：标题"周日复盘" + 标题下划线；右侧按钮组：`保存草稿`、`保存`（输出 Word）、`复盘记录`。
- 主体分三行滑动条，每行：左侧文字，右侧圆角分段滑动条。
- 下端复盘文本框：随内容自动向下扩展；初始高度使其底部距页面边界 20px；内容超长时页面滚动、底部保持 20px 留白；输入文字字号约 16px。

### 3.2 滑动条

- 名称：计划完成度、计划完成质量、压力指数。
- 每根 10 档，全量程定为 1；选中第 n 档（n=1..10）时显示 `10n%`（标签在滑动条上方），填色部分为左侧 n 段，右侧 10-n 段为中性灰；默认 0%（全部灰色）。
- 前两根红→绿，第三根绿→红。
- 支持点击选择与按住拖动选择；拇指位置变化带平滑过渡。

### 3.3 色阶（10 色，HSL 等步长：红 0°→绿 120°，S=70%、L=50%）

| 档 | 红→绿 | 档 | 绿→红 |
|---|---|---|---|
| 1 | `#d92626` | 1 | `#26d926` |
| 2 | `#d94e26` | 2 | `#4ed926` |
| 3 | `#d97626` | 3 | `#76d926` |
| 4 | `#d99d26` | 4 | `#9dd926` |
| 5 | `#d9c526` | 5 | `#c5d926` |
| 6 | `#c5d926` | 6 | `#d9c526` |
| 7 | `#9dd926` | 7 | `#d99d26` |
| 8 | `#76d926` | 8 | `#d97626` |
| 9 | `#4ed926` | 9 | `#d94e26` |
| 10 | `#26d926` | 10 | `#d92626` |

### 3.4 草稿与保存

- `保存草稿`：把当前三个指数与文字写入内存 `reviewDraft`，清除"未保存"标记，并给出轻提示"草稿已保存"。
- `保存`：调用 `saveReview` 输出当天 Word 文档，成功后提示并刷新复盘记录。
- 若编辑后有未保存变更，且用户要切到其它主页面：弹确认框"是否保存草稿？"，选项为 保存草稿 / 不保存 / 取消。
  - 保存草稿：写入草稿后离开。
  - 不保存：丢弃未保存变更，保留最近一次已保存草稿，离开。
  - 取消：留在当前页。

## 4. Word 文档生成（主进程）

- 依赖：`docx`（npm 运行时依赖，打包进主进程）。
- 文件名：`${年}年${月}日${日}日${周几}复盘.docx`，取当前本地日期；例 `2026年8月16日周日复盘.docx`。同一天再次保存覆盖同名文件。
- 目录：`%APPDATA%/象限/reviews/`，首次自动创建。
- 内容排版（简单排版）：
  - 标题：左对齐、20pt、加粗，文字为"周日复盘"。
  - 紧随标题下一行显示日期（如 `2026年8月16日 周日`）。
  - 三行指数：`计划完成度：80%`、`计划完成质量：70%`、`压力指数：60%`。
  - 空一行后输出复盘正文。

## 5. 复盘记录子页

- 为周日复盘页内的子视图（从右侧进入，类似资源管理器内容视图）。
- 列表项：Word 图标 + 文件名 + 元信息（类型/大小），右侧显示修改日期与大小；卡片圆角；深色主题。
- 空态：显示"暂无复盘记录"。
- 双击记录：`openReview` 用默认程序打开；失败（如文件不存在）弹出符合深色设计规范的报错框。

## 6. 动画方案

参考 `awesome-design-md/apple/DESIGN.md` 的按压缩放（`transform: scale(0.95)`）与克制的过渡节奏，结合惯性：

### 6.1 侧边栏高亮条

- 侧边栏改为单一浮动高亮条（绝对定位），随当前活动项上下滑动到对应位置（`transform: translateY` + 过渡，约 0.25s，ease-out）。
- 顶层主页面切换本身不做内容过渡动画（用户澄清）。

### 6.2 子页面左右滑动

- 进入子页面（目标详情、复盘记录）：从右侧滑入。
- 返回主页面：向右滑出。
- 用 CSS `transform`/`opacity` 过渡实现；周计划单日不套用本节，按 6.4 特殊处理。

### 6.3 四象限惯性缩放/平移 + 修复抖动

- 抖动根因（已复现）：滚轮缩放时 `clampOrigin` 把原点 clamp 进视口边距，光标不在原点时破坏"光标锚定"，原点在两个边界值间震荡。
- 修复：缩放路径不再 clamp 原点，只 clamp zoom；把"光标下的世界点"作为锚点。
- 惯性缩放：滚轮累积目标 zoom，用 `requestAnimationFrame` + 指数阻尼趋近目标，每帧重算 pan 以保持锚点不动。
- 惯性平移：拖拽松手时记录速度，按速度继续平移并用摩擦阻尼衰减；期间原点不 clamp（或仅保留宽松边界），结束后可选归位。

### 6.4 周计划单日

- 打开"周几"：iOS 打开 App 式放大动画（scale 0.92→1 + opacity 0→1，约 0.28s，ease-out）。
- 关闭"周几"：向右滑出（translateX 0→100%，约 0.25s，ease-in）。

## 7. 文件改动清单

- Modify `src/shared/types.ts`：新增 `ReviewDraft`/`ReviewRecord`/`ReviewExport`，扩展 `QuadrantApi`。
- Create `src/main/review.ts`：复盘目录、文件名、docx 生成、列表、打开。
- Modify `src/main/index.ts`：注册 `review:*` IPC。
- Modify `src/preload/index.ts`：暴露 review 方法。
- Create `src/renderer/src/lib/reviewRules.ts`：色阶、档位→百分比等纯函数。
- Create `src/renderer/src/components/review/SegmentedSlider.tsx`。
- Create `src/renderer/src/components/review/ReviewRecords.tsx`。
- Create `src/renderer/src/pages/ReviewPage.tsx`。
- Modify `src/renderer/src/state/appStore.ts`：内存 `reviewDraft` 与 actions。
- Modify `src/renderer/src/components/Sidebar.tsx`：浮动高亮条。
- Modify `src/renderer/src/App.tsx`：review 路由到 ReviewPage。
- Modify `src/renderer/src/pages/QuadrantPage.tsx`：惯性缩放/平移 + 抖动修复。
- Modify `src/renderer/src/pages/WeeklyPage.tsx` 与 `components/weekly/DayView.tsx`：打开/关闭动画。
- Modify `src/renderer/src/styles/theme.css`：新增样式。
- Create `tests/reviewRules.test.ts` 与 `tests/review.test.ts`。
- Create `docs/qa-review.mjs`：Playwright 截图验收脚本。

## 8. 测试与验收

- 单元测试（Vitest，TDD）：`reviewRules`（档位→百分比、色阶），`review`（文件名生成、记录规整）。
- `npm run typecheck`、`npm run build` 通过；`npm test` 通过（若沙箱拦截读取父目录，用放行方式运行）。
- Playwright 驱动构建产物截图验收：周日复盘页、滑动条选中态、复盘记录列表、报错框、侧边栏高亮条、单日打开/关闭动画关键帧。

## 9. 修订记录

### 9.1 用户澄清（2026-08-16）

1. 上下滑动动画作用于侧边栏活动高亮条；主页面切换不做动画。
2. 文件名用当前日期，同天覆盖同名文件：可接受。
3. Word 文档简单排版，标题左对齐、20pt、加粗。
4. 增加"保存草稿"按钮；有未保存变更时切换页面提示"是否保存草稿"；草稿仅在关闭程序后消失。
