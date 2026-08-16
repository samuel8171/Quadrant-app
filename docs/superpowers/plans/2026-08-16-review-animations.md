# 周日复盘模块 + 全局动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把周日复盘占位页替换为完整模块（三指数滑动条 + 复盘文本框 + 草稿 + Word 导出 + 复盘记录子页），并加入侧边栏高亮条、子页面左右滑动、四象限惯性缩放/平移（修复抖动）、周计划单日打开/关闭动画。

**Architecture:** 沿用 Electron + React + Zustand。纯逻辑放 `src/shared/review.ts` 与 `src/main/reviewDoc.ts`（Vitest 测试）；复盘草稿只存内存（不写 plan.json）；主进程用 `docx` 生成 Word，经 IPC 暴露 save/list/open；动画用 CSS transition + requestAnimationFrame 惯性。

**Tech Stack:** Electron 31、electron-vite、React 18、TypeScript、Zustand、lucide-react、docx（新增运行时依赖）、Vitest、playwright-core。

---

## File Structure

- Create: `src/shared/review.ts`（档位/百分比纯函数）
- Create: `src/main/reviewDoc.ts`（文件名、日期行、docx 生成）
- Create: `src/main/review.ts`（目录、保存/列表/打开，fs+electron 粘合）
- Modify: `src/shared/types.ts`（新增 ReviewDraft/ReviewRecord/ReviewExport，扩展 QuadrantApi）
- Modify: `src/main/index.ts`（注册 review IPC）
- Modify: `src/preload/index.ts`（暴露 review 方法）
- Create: `src/renderer/src/lib/reviewRules.ts`（色阶 + 草稿差异判断）
- Modify: `src/renderer/src/state/appStore.ts`（reviewDraft/reviewEdit/pendingPage 等）
- Create: `src/renderer/src/components/review/SegmentedSlider.tsx`
- Create: `src/renderer/src/components/review/ReviewRecords.tsx`
- Create: `src/renderer/src/pages/ReviewPage.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`（浮动高亮条）
- Modify: `src/renderer/src/App.tsx`（review 路由 + 离开确认框）
- Modify: `src/renderer/src/pages/QuadrantPage.tsx`（惯性缩放/平移 + 抖动修复）
- Modify: `src/renderer/src/pages/WeeklyPage.tsx`（单日打开/关闭动画状态机）
- Modify: `src/renderer/src/pages/GoalsPage.tsx`（子页面进入/返回动画类名）
- Modify: `src/renderer/src/styles/theme.css`（全部新样式）
- Create: `tests/reviewShared.test.ts`
- Create: `tests/reviewDoc.test.ts`
- Create: `docs/qa-review.mjs`（截图验收）

## Task 1: 安装 docx 依赖

- [ ] **Step 1: 安装**

Run: `npm install docx`

Expected: `package.json` 与 `package-lock.json` 出现 `docx`，`node_modules/docx` 存在。

## Task 2: 共享纯函数 review.ts

**Files:**
- Create: `src/shared/review.ts`
- Test: `tests/reviewShared.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { clampReviewValue, percentLabel } from '../src/shared/review'

describe('review shared', () => {
  it('clamps review value to integer 0..10', () => {
    expect(clampReviewValue(3)).toBe(3)
    expect(clampReviewValue(3.7)).toBe(4)
    expect(clampReviewValue(-2)).toBe(0)
    expect(clampReviewValue(99)).toBe(10)
    expect(clampReviewValue(Number.NaN)).toBe(0)
  })

  it('formats percentage as 10n%', () => {
    expect(percentLabel(0)).toBe('0%')
    expect(percentLabel(1)).toBe('10%')
    expect(percentLabel(10)).toBe('100%')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- --run tests/reviewShared.test.ts`
Expected: 模块不存在导致失败。

- [ ] **Step 3: 实现**

```ts
export function clampReviewValue(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(10, Math.max(0, Math.round(v)))
}

export function percentLabel(v: number): string {
  return `${clampReviewValue(v) * 10}%`
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- --run tests/reviewShared.test.ts`
Expected: PASS。

## Task 3: 主进程 docx 生成 reviewDoc.ts

**Files:**
- Modify: `src/shared/types.ts`（先加 ReviewExport 类型）
- Create: `src/main/reviewDoc.ts`
- Test: `tests/reviewDoc.test.ts`

- [ ] **Step 1: 在 types.ts 追加类型**

```ts
export interface ReviewExport {
  completion: number
  quality: number
  stress: number
  text: string
}
```

- [ ] **Step 2: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { buildReviewDocx, reviewDateLine, reviewFileName } from '../src/main/reviewDoc'

describe('reviewDoc', () => {
  it('builds a local-date file name with weekday', () => {
    expect(reviewFileName(new Date(2026, 7, 16))).toBe('2026年8月16日周日复盘.docx')
    expect(reviewFileName(new Date(2026, 7, 10))).toBe('2026年8月10日周一复盘.docx')
  })

  it('builds a date line', () => {
    expect(reviewDateLine(new Date(2026, 7, 16))).toBe('2026年8月16日 周日')
  })

  it('builds a valid docx containing the values', async () => {
    const buf = await buildReviewDocx(
      { completion: 8, quality: 7, stress: 6, text: '本周复盘\n继续加油' },
      new Date(2026, 7, 16)
    )
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 2).toString()).toBe('PK') // zip magic
    const xml = await extractDocumentXml(buf)
    expect(xml).toContain('周日复盘')
    expect(xml).toContain('计划完成度：80%')
    expect(xml).toContain('压力指数：60%')
    expect(xml).toContain('继续加油')
  })
})
```

> `extractDocumentXml` 用一个只依赖 Node 内置的最小 zip 解包实现，只提取 `word/document.xml`。为保持测试自包含，把该 helper 写进测试文件（用 `zlib.inflateRawSync` 按 local file header 扫描）。docx 内部 XML 用 UTF-8。

- [ ] **Step 3: 运行确认失败**

Run: `npm test -- --run tests/reviewDoc.test.ts`
Expected: `reviewDoc` 模块不存在导致失败。

- [ ] **Step 4: 实现 reviewDoc.ts**

```ts
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx'
import { percentLabel } from '../shared/review'
import type { ReviewExport } from '../shared/types'

export const REVIEW_WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function reviewFileName(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${REVIEW_WEEKDAY_NAMES[d.getDay()]}复盘.docx`
}

export function reviewDateLine(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${REVIEW_WEEKDAY_NAMES[d.getDay()]}`
}

export async function buildReviewDocx(exp: ReviewExport, d: Date): Promise<Buffer> {
  const children = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: '周日复盘', bold: true, size: 40 })]
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: reviewDateLine(d), size: 24, color: '666666' })]
    }),
    new Paragraph({ children: [new TextRun({ text: `计划完成度：${percentLabel(exp.completion)}`, size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: `计划完成质量：${percentLabel(exp.quality)}`, size: 24 })] }),
    new Paragraph({ children: [new TextRun({ text: `压力指数：${percentLabel(exp.stress)}`, size: 24 })] }),
    new Paragraph({ children: [] })
  ]
  if (exp.text.trim()) {
    for (const line of exp.text.replace(/\r\n/g, '\n').split('\n')) {
      children.push(new Paragraph({ children: [new TextRun({ text: line, size: 24 })] }))
    }
  }
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test -- --run tests/reviewDoc.test.ts`
Expected: PASS。

## Task 4: 主进程 review.ts + IPC + preload

**Files:**
- Modify: `src/shared/types.ts`（ReviewRecord + QuadrantApi 扩展）
- Create: `src/main/review.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: 追加 ReviewRecord 并扩展 QuadrantApi**

```ts
export interface ReviewRecord {
  fileName: string
  filePath: string
  size: number
  modifiedAt: string
}

export interface QuadrantApi {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  saveReview(payload: ReviewExport): Promise<ReviewRecord>
  listReviews(): Promise<ReviewRecord[]>
  openReview(filePath: string): Promise<{ ok: boolean; error?: string }>
}
```

- [ ] **Step 2: 实现 review.ts**

```ts
import { app, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ReviewExport, ReviewRecord } from '../shared/types'
import { buildReviewDocx, reviewFileName } from './reviewDoc'

export function reviewsDir(): string {
  return path.join(app.getPath('userData'), 'reviews')
}

export async function saveReview(payload: ReviewExport): Promise<ReviewRecord> {
  const dir = reviewsDir()
  await fs.mkdir(dir, { recursive: true })
  const now = new Date()
  const fileName = reviewFileName(now)
  const filePath = path.join(dir, fileName)
  await fs.writeFile(filePath, await buildReviewDocx(payload, now))
  const stat = await fs.stat(filePath)
  return { fileName, filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() }
}

export async function listReviews(): Promise<ReviewRecord[]> {
  let names: string[]
  try {
    names = await fs.readdir(reviewsDir())
  } catch {
    return []
  }
  const out: ReviewRecord[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.docx')) continue
    const filePath = path.join(reviewsDir(), name)
    try {
      const stat = await fs.stat(filePath)
      out.push({ fileName: name, filePath, size: stat.size, modifiedAt: stat.mtime.toISOString() })
    } catch {
      // skip unreadable
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export async function openReview(filePath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await fs.access(filePath)
  } catch {
    return { ok: false, error: '文件不存在或已被移动' }
  }
  const err = await shell.openPath(filePath)
  return err ? { ok: false, error: err } : { ok: true }
}
```

- [ ] **Step 3: 注册 IPC**

在 `src/main/index.ts` 的 `app.whenReady().then` 内追加：

```ts
ipcMain.handle('review:save', (_event, payload: ReviewExport) => saveReview(payload))
ipcMain.handle('review:list', () => listReviews())
ipcMain.handle('review:open', (_event, filePath: string) => openReview(filePath))
```

并 import：`import { listReviews, openReview, saveReview } from './review'`。

- [ ] **Step 4: preload 暴露**

```ts
const api: QuadrantApi = {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveReview: (payload) => ipcRenderer.invoke('review:save', payload),
  listReviews: () => ipcRenderer.invoke('review:list'),
  openReview: (filePath) => ipcRenderer.invoke('review:open', filePath)
}
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: 无错误。

## Task 5: 渲染层纯函数 reviewRules.ts + 草稿状态

**Files:**
- Create: `src/renderer/src/lib/reviewRules.ts`
- Modify: `src/shared/types.ts`（ReviewDraft）
- Modify: `src/renderer/src/state/appStore.ts`
- Test: `tests/reviewRules.test.ts`

- [ ] **Step 1: 追加 ReviewDraft 类型**

```ts
export interface ReviewDraft {
  completion: number
  quality: number
  stress: number
  text: string
}
```

- [ ] **Step 2: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { REVIEW_GREEN_RED, REVIEW_RED_GREEN, reviewDirty } from '../src/renderer/src/lib/reviewRules'

describe('reviewRules', () => {
  it('provides red-green and reversed green-red scales', () => {
    expect(REVIEW_RED_GREEN).toHaveLength(10)
    expect(REVIEW_GREEN_RED).toHaveLength(10)
    expect(REVIEW_RED_GREEN[0]).toBe('#d92626')
    expect(REVIEW_RED_GREEN[9]).toBe('#26d926')
    expect(REVIEW_GREEN_RED[0]).toBe('#26d926')
    expect(REVIEW_GREEN_RED[9]).toBe('#d92626')
  })

  it('detects dirty draft vs saved', () => {
    const a = { completion: 1, quality: 2, stress: 3, text: 'a' }
    expect(reviewDirty(a, a)).toBe(false)
    expect(reviewDirty(a, { ...a, text: 'b' })).toBe(true)
    expect(reviewDirty(a, { ...a, stress: 4 })).toBe(true)
  })
})
```

- [ ] **Step 3: 实现 reviewRules.ts**

```ts
import type { ReviewDraft } from '../../../../shared/types'

export const REVIEW_RED_GREEN = [
  '#d92626', '#d94e26', '#d97626', '#d99d26', '#d9c526',
  '#c5d926', '#9dd926', '#76d926', '#4ed926', '#26d926'
] as const

export const REVIEW_GREEN_RED: string[] = [...REVIEW_RED_GREEN].reverse()

export function reviewDirty(a: ReviewDraft, b: ReviewDraft): boolean {
  return (
    a.completion !== b.completion ||
    a.quality !== b.quality ||
    a.stress !== b.stress ||
    a.text !== b.text
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- --run tests/reviewRules.test.ts`
Expected: PASS。

- [ ] **Step 5: appStore 增加内存草稿与导航守卫**

在 `AppState` 增加字段与动作，并在 store 实现（`reviewDraft`/`reviewEdit`/`pendingPage` 均为内存态，不进入 `data`）：

```ts
reviewDraft: ReviewDraft
reviewEdit: ReviewDraft
pendingPage: Page | null
setReviewEdit: (patch: Partial<ReviewDraft>) => void
saveReviewDraft: () => void
discardReviewDraft: () => void
requestPage: (page: Page) => void
resolveLeave: (action: 'save' | 'discard' | 'cancel') => void
```

实现要点（`set`/`get` 内联）：

```ts
const emptyReview = (): ReviewDraft => ({ completion: 0, quality: 0, stress: 0, text: '' })

// store 初始值
reviewDraft: emptyReview(),
reviewEdit: emptyReview(),
pendingPage: null,

setReviewEdit: (patch) => set((s) => ({ reviewEdit: { ...s.reviewEdit, ...patch } })),
saveReviewDraft: () => set((s) => ({ reviewDraft: s.reviewEdit })),
discardReviewDraft: () => set((s) => ({ reviewEdit: s.reviewDraft })),
requestPage: (page) => {
  const s = get()
  if (s.page === 'review' && reviewDirty(s.reviewEdit, s.reviewDraft)) {
    set({ pendingPage: page })
  } else {
    set({ page })
  }
},
resolveLeave: (action) => {
  const s = get()
  const target = s.pendingPage
  if (!target) return
  if (action === 'save') set({ reviewDraft: s.reviewEdit })
  if (action === 'discard') set({ reviewEdit: s.reviewDraft })
  if (action !== 'cancel') set({ page: target })
  set({ pendingPage: null })
}
```

同时把 `setPage` 保留（内部逻辑不受影响），`Sidebar` 改为调用 `requestPage`。

- [ ] **Step 6: typecheck + 全量测试**

Run: `npm run typecheck`；`npm test`
Expected: 通过。

## Task 6: SegmentedSlider 组件

**Files:**
- Create: `src/renderer/src/components/review/SegmentedSlider.tsx`

- [ ] **Step 1: 实现**

Props：`label`、`value`（0..10）、`colors`（10 色数组）、`onChange(n)`。
渲染：左 label，右滑动条。滑动条为 10 段等宽圆角色块，`i < value` 用 `colors[i]`，否则 `var(--border)`；上方浮动标签显示 `10n%`。用 `onPointerDown` 计算段索引并 `setPointerCapture`，拖动时按 pointer 位置更新。选中段与百分比标签带平滑过渡。

## Task 7: ReviewPage + ReviewRecords

**Files:**
- Create: `src/renderer/src/pages/ReviewPage.tsx`
- Create: `src/renderer/src/components/review/ReviewRecords.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: ReviewPage**

状态：`view: 'compose' | 'records'`；读取 `reviewEdit` 经 `setReviewEdit` 更新；`dirty = reviewDirty(reviewEdit, reviewDraft)`。
页头按钮：`保存草稿`（saveReviewDraft + toast）、`保存`（saveReview + 刷新 + toast）、`复盘记录`（`setView('records')`）。
离开主页面由 store `requestPage` 守卫处理；App 在 `pendingPage` 非空时渲染三按钮确认框。
文本框用自动增高 textarea，底部距边界 20px。

- [ ] **Step 2: ReviewRecords**

`useEffect` 调用 `listReviews`；空态"暂无复盘记录"；行双击 `openReview`，失败弹报错框；成功无感。

- [ ] **Step 3: App 路由与离开确认**

`page === 'review'` 渲染 `<ReviewPage />`；顶部渲染 `pendingPage` 确认框（复用深色 modal 样式）。

## Task 8: 侧边栏浮动高亮条

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/styles/theme.css`

- [ ] **Step 1: 重构为单一浮动高亮条**

`nav` 使用相对定位容器，内部一个绝对定位 `.nav-indicator`，`top` 按活动项索引 × 项高度定位，`transition: top .25s`；`.nav-item` 不再自带 active 背景，仅保留文字/图标颜色状态。

## Task 9: 子页面左右滑动 + 单日动画

**Files:**
- Modify: `src/renderer/src/styles/theme.css`
- Modify: `src/renderer/src/pages/GoalsPage.tsx`
- Modify: `src/renderer/src/pages/WeeklyPage.tsx`
- Modify: `src/renderer/src/components/weekly/DayView.tsx`

- [ ] **Step 1: CSS keyframes**

新增 `slide-in-right`、`slide-in-left`、`day-open`（scale 0.92→1 + opacity）、`day-close`（translateX 100%）。

- [ ] **Step 2: GoalsPage 子页面动画**

目标列表容器与详情容器分别加 `key` 与 `slide-in-left`/`slide-in-right` 类，进入详情用 right、返回用 left。

- [ ] **Step 3: WeeklyPage 单日状态机**

`view` 增加过渡态：打开时先渲染 DayView 带 `day-open` 动画；关闭时先给 DayView 加 `day-close`，等 `transitionend`/超时后再切回 overview，overview 带 `slide-in-left`。

## Task 10: 四象限惯性缩放/平移 + 抖动修复

**Files:**
- Modify: `src/renderer/src/pages/QuadrantPage.tsx`

- [ ] **Step 1: 用锚点式惯性缩放替换滚轮逻辑**

滚轮事件只更新 `targetZoom`（clamp 0.5..2.5）与锚点；`requestAnimationFrame` 循环让 `zoom` 以指数阻尼趋近 target，每帧用 `zoomAt` 重算 pan 保持锚点不动；**缩放路径不再调用 `clampOrigin`**。

- [ ] **Step 2: 拖拽松手惯性平移**

记录最近 pointer 移动速度；`onPointerUp` 后进入惯性循环，按速度继续更新 pan 并用摩擦阻尼衰减到接近 0。

- [ ] **Step 3: 回归验证**

用 Playwright 或手动确认：光标不在原点时连续滚轮缩放，事件不再左右/上下震荡；拖拽松手后继续平滑滑动并停下。

## Task 11: QA 脚本与最终验证

**Files:**
- Create: `docs/qa-review.mjs`

- [ ] **Step 1: 截图脚本**

基于现有 `docs/qa-electron.mjs` 模式，截图：周日复盘页、三滑动条选中态、复盘记录列表、报错框、侧边栏高亮条、单日打开/关闭动画关键帧。

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck`；`npm test`；`npm run build`
Expected: 全部通过，构建成功。

- [ ] **Step 3: 截图经视觉模型核对**

用 claude-vision 描述关键截图，确认观感与设计要求一致。
