# Mobile Portrait Web Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将象限 0.4.0 桌面应用扩展为可部署到 GitHub Pages 的手机竖屏 Web 版，同时保留 Electron 桌面布局、数据规则和四象限语义。

**Architecture:** 通过 renderer 平台 API 适配层统一 Electron IPC 与 Web localStorage/下载能力；通过单一 Sidebar 组件和 CSS media queries 切换桌面左侧导航与移动底部毛玻璃 Tab Bar。移动端优先调整页面容器、时间轴溢出、弹窗/菜单呈现和触控热区，不改动现有业务规则及四象限数学坐标。

**Tech Stack:** React 18, TypeScript, Zustand, Vite/Electron-Vite, Vitest, lucide-react, CSS media queries, localStorage, Blob download.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-portrait-web-design.md`

## Global Constraints

- 桌面布局保持现状。`767px` 及以下进入移动模式；`768px–1023px` 使用紧凑桌面/平板模式；`1024px` 及以上维持桌面布局。
- 手机 Tab Bar 距离左右边缘 12px，圆角 26px；主体使用半透明深灰背景、`backdrop-filter: blur(24px) saturate(150%)`、顶部高光边和柔和外阴影。
- 每个 Tab 的实际触控区域不小于 44×44px；图标与文本均参与点击。
- 四个象限位置和颜色保持原程序设置：右上 Q1 橙 `#FF8C00`，左上 Q2 黄 `#FFA500`，左下 Q3 青 `#008B8B`，右下 Q4 紫 `#483D8B`。
- 现有数学坐标保持原程序设置：Q1 `x >= 0, y >= 0`，Q2 `x < 0, y >= 0`，Q3 `x < 0, y < 0`，Q4 `x >= 0, y < 0`。
- 移动端根布局使用动态视口高度 `100dvh`，内容底部预留 Tab Bar 高度和 `env(safe-area-inset-bottom)`。
- 所有横向溢出必须限制在明确的时间轴或卡片轨道内，页面本身不得产生意外横向滚动。
- Electron 环境检测到 preload API 后透传现有 IPC；Web 环境使用 localStorage 保存 AppData。
- 不自动创建 GitHub 仓库、推送、发布或修改 GitHub 权限。
- API key、生成图片凭据和任何个人秘密不得写入仓库、源码、README 或构建产物。

---

### Task 1: 平台 API 适配与 Web 复盘存储

**Files:**
- Create: `src/renderer/src/lib/platformApi.ts`
- Modify: `src/renderer/src/state/appStore.ts`
- Modify: `src/renderer/src/pages/ReviewPage.tsx`
- Modify: `src/renderer/src/components/review/ReviewRecords.tsx`
- Create: `tests/platformApi.test.ts`

**Interfaces:**
- Produces `getPlatformApi(): QuadrantApi`，在每次调用时选择 Electron preload API 或 Web fallback。
- Web fallback 使用键 `quadrant-web-data-v2` 保存序列化 AppData，使用键 `quadrant-web-reviews-v1` 保存 `{ fileName, content, modifiedAt }[]`。
- Web `saveReview` 返回现有 `ReviewRecord` 形状，`filePath` 使用 `web-review:<fileName>`；`openReview` 对该值重新触发 UTF-8 `.txt` 下载。

- [ ] **Step 1: Write the failing tests**

```ts
it('returns default data when web storage is empty or malformed', async () => {
  const api = createWebPlatformApi(memoryStorage())
  expect(await api.loadData()).toEqual(defaultData())
  memoryStorage().setItem('quadrant-web-data-v2', '{broken')
  expect(await api.loadData()).toEqual(defaultData())
})

it('round-trips app data and review records in web storage', async () => {
  const storage = memoryStorage()
  const api = createWebPlatformApi(storage)
  const data = { ...defaultData(), weekCounterOffset: 3 }
  await api.saveData(data)
  expect(await api.loadData()).toEqual(data)
  const record = await api.saveReview({ completion: 2, quality: 1, stress: 0, text: '本周完成' })
  expect(record.filePath).toMatch(/^web-review:/)
  expect((await api.listReviews()).map((r) => r.fileName)).toContain(record.fileName)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/platformApi.test.ts`
Expected: FAIL because `createWebPlatformApi` and platform adapter do not exist.

- [ ] **Step 3: Implement the minimal adapter**

Implement `createWebPlatformApi(storage = window.localStorage)` with guarded storage access, `parseData`/`serializeData`, Blob download for review files, and deterministic review listing metadata. Implement `getPlatformApi()` so Electron callers continue to use `window.quadrantApi` unchanged.

- [ ] **Step 4: Update all renderer callers**

Replace direct `window.quadrantApi` usage in store, review compose and review records with `getPlatformApi()`, preserving existing error handling and Electron behavior.

- [ ] **Step 5: Run focused and full tests**

Run: `npm test -- tests/platformApi.test.ts` then `npm test`
Expected: focused tests pass, then all existing tests and platform tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/platformApi.ts src/renderer/src/state/appStore.ts src/renderer/src/pages/ReviewPage.tsx src/renderer/src/components/review/ReviewRecords.tsx tests/platformApi.test.ts
git commit -m "feat: add web platform storage adapter"
```

### Task 2: Responsive shell and Apple-style bottom navigation

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/theme.css`
- Create: `tests/responsiveLayout.test.ts`

**Interfaces:**
- Sidebar keeps the existing `NAV` page ordering and `requestPage` calls.
- CSS exposes `--mobile-nav-height` and `.mobile-only`/`.desktop-only` behavior without duplicating navigation markup.

- [ ] **Step 1: Write failing pure layout tests**

```ts
it('defines mobile breakpoint and safe-area navigation metrics', () => {
  expect(MOBILE_BREAKPOINT).toBe(767)
  expect(MOBILE_NAV_MIN_HEIGHT).toBeGreaterThanOrEqual(64)
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/responsiveLayout.test.ts`
Expected: FAIL because layout constants do not exist.

- [ ] **Step 3: Implement mobile shell CSS and constants**

Add a small `responsiveLayout.ts` constants module, convert `.app` to `100dvh` with overflow guards, keep desktop sidebar rules, and add a fixed mobile `.sidebar` style with 12px side insets, 26px radius, blur/saturation, fallback background, safe-area padding, four equal nav items, selected blue treatment, and 44px touch targets.

- [ ] **Step 4: Update App content spacing and transitions**

Reserve bottom navigation space in `.content`/`.page-switch`, keep desktop animation classes, add mobile reduced-distance transition and `prefers-reduced-motion` override.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- tests/responsiveLayout.test.ts` and `npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx src/renderer/src/styles/theme.css src/renderer/src/lib/responsiveLayout.ts tests/responsiveLayout.test.ts
git commit -m "feat: add mobile glass bottom navigation"
```

### Task 3: Mobile goals, modals, menus and touch affordances

**Files:**
- Modify: `src/renderer/src/styles/theme.css`
- Modify: `src/renderer/src/pages/GoalsPage.tsx`
- Modify: `src/renderer/src/components/ContextMenu.tsx`
- Modify: `src/renderer/src/components/ConfirmDialog.tsx`
- Modify: `src/renderer/src/components/GoalDetailDialog.tsx`
- Modify: `src/renderer/src/components/EventDetailDialog.tsx`
- Modify: `src/renderer/src/components/LeaveConfirmDialog.tsx`

**Interfaces:**
- Existing callbacks and store actions remain unchanged.
- Existing desktop context menus and dialogs remain available; CSS changes their mobile presentation to bottom sheets/action sheets.

- [ ] **Step 1: Add behavior assertions for touch sizing**

```ts
it('uses the Apple minimum touch target', () => {
  expect(TOUCH_TARGET_MIN).toBe(44)
})
```

- [ ] **Step 2: Verify the new test fails**

Run: `npm test -- tests/responsiveLayout.test.ts -t "touch target"`
Expected: FAIL until `TOUCH_TARGET_MIN` is exported.

- [ ] **Step 3: Implement responsive goals and sheet styles**

At mobile width, stack goal columns, allow goal action rows to wrap, enlarge icon/check controls to 44px, change long-term group grids to one column with natural height, and add a visible single-tap group rename button while preserving double-click rename on desktop.

- [ ] **Step 4: Implement mobile dialogs and action sheets**

Set mobile modal masks to bottom alignment, modal width to `min(100%, 560px)`, max height `86dvh`, rounded top corners 22px, scrollable body, safe-area action padding, and 44px controls. Make context menus fixed bottom sheets on mobile with full-width action rows and red danger styling.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/responsiveLayout.test.ts` and `npm run typecheck`
Expected: PASS and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/styles/theme.css src/renderer/src/pages/GoalsPage.tsx src/renderer/src/components/ContextMenu.tsx src/renderer/src/components/ConfirmDialog.tsx src/renderer/src/components/GoalDetailDialog.tsx src/renderer/src/components/EventDetailDialog.tsx src/renderer/src/components/LeaveConfirmDialog.tsx src/renderer/src/lib/responsiveLayout.ts tests/responsiveLayout.test.ts
git commit -m "feat: adapt goals and dialogs for touch"
```

### Task 4: Mobile four-quadrant visual mapping and interaction hints

**Files:**
- Modify: `src/renderer/src/lib/quadrantMath.ts`
- Modify: `src/renderer/src/pages/QuadrantPage.tsx`
- Modify: `src/renderer/src/components/ContextMenu.tsx`
- Modify: `src/renderer/src/styles/theme.css`
- Modify: `tests/quadrantMath.test.ts`

**Interfaces:**
- Preserve existing `quadrantOfWorldPoint`, `screenToWorldX`, `screenToWorldY`, `ViewState`, and event update APIs.
- Preserve the existing `QUADRANT_META` positions, colors and labels; mobile adaptation must not remap quadrant semantics.

- [ ] **Step 1: Add failing mapping/color assertions**

```ts
it('keeps semantic quadrant positions and mobile colors', () => {
  expect(QUADRANT_META[1]).toMatchObject({ color: '#FF8C00', label: '重要紧急', corner: 'top-right' })
  expect(QUADRANT_META[2]).toMatchObject({ color: '#FFA500', label: '重要不紧急', corner: 'top-left' })
  expect(QUADRANT_META[3]).toMatchObject({ color: '#008B8B', label: '不重要不紧急', corner: 'bottom-left' })
  expect(QUADRANT_META[4]).toMatchObject({ color: '#483D8B', label: '不重要紧急', corner: 'bottom-right' })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/quadrantMath.test.ts`
Expected: FAIL if current metadata does not match the four required colors/labels.

- [ ] **Step 3: Preserve metadata and implement mobile presentation**

Keep `QUADRANT_META`, world-to-screen math, event persistence, and existing quadrant positions unchanged. On mobile show the gesture hint and use larger event touch handles; preserve desktop Ctrl+drag/scroll hint.

- [ ] **Step 4: Add touch gesture support without breaking mouse input**

Track a second pointer for pinch zoom, keep one-pointer canvas pan, and keep double-click creation. Long-press an event to open the existing menu state; the CSS turns it into an action sheet.

- [ ] **Step 5: Run quadrant tests and typecheck**

Run: `npm test -- tests/quadrantMath.test.ts` and `npm run typecheck`
Expected: all quadrant tests pass and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/lib/quadrantMath.ts src/renderer/src/pages/QuadrantPage.tsx src/renderer/src/components/ContextMenu.tsx src/renderer/src/styles/theme.css tests/quadrantMath.test.ts
git commit -m "feat: align quadrant mobile mapping and gestures"
```

### Task 5: Mobile weekly planner layout and preset interaction

**Files:**
- Modify: `src/renderer/src/components/weekly/WeekOverview.tsx`
- Modify: `src/renderer/src/components/weekly/DayView.tsx`
- Modify: `src/renderer/src/components/weekly/PresetPanel.tsx`
- Modify: `src/renderer/src/styles/theme.css`
- Create: `tests/weeklyMobileLayout.test.ts`

**Interfaces:**
- Preserve `weekRules` event positioning, dates, and store mutations.
- Keep desktop seven-column overview unchanged; mobile gets a contained horizontally scrollable timeline with date rail above it.

- [ ] **Step 1: Write failing layout tests**

```ts
it('uses the mobile weekly timeline window', () => {
  expect(MOBILE_WEEK_START_MIN).toBe(420)
  expect(MOBILE_WEEK_END_MIN).toBe(1440)
  expect(MOBILE_WEEK_DAY_MIN_WIDTH).toBeGreaterThanOrEqual(96)
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/weeklyMobileLayout.test.ts`
Expected: FAIL because the mobile layout constants do not exist.

- [ ] **Step 3: Implement weekly mobile structure**

Add semantic wrappers for title/date rail/timeline so mobile CSS can make the date rail sticky within the board and constrain horizontal scrolling to `.week-grid`. Mark today with the existing date data and accessible label. Keep event blocks readable at compact widths.

- [ ] **Step 4: Implement mobile day interactions**

Allow tapping an empty time-axis area to open event creation, keep drag-to-move for touch, and render preset panel below the timeline as a collapsible section. Clicking a preset opens the existing form; desktop drag-and-drop remains available.

- [ ] **Step 5: Add reference-aligned visual tokens**

Use graphite grid lines, blue today marker, colored event blocks, compact top controls, and bottom-nav-safe board padding while retaining project event colors.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm test -- tests/weeklyMobileLayout.test.ts` and `npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/weekly/WeekOverview.tsx src/renderer/src/components/weekly/DayView.tsx src/renderer/src/components/weekly/PresetPanel.tsx src/renderer/src/styles/theme.css src/renderer/src/lib/weeklyMobileLayout.ts tests/weeklyMobileLayout.test.ts
git commit -m "feat: optimize weekly planner for portrait screens"
```

### Task 6: Mobile review layout, Web build and documentation

**Files:**
- Modify: `src/renderer/src/pages/ReviewPage.tsx`
- Modify: `src/renderer/src/components/review/SegmentedSlider.tsx`
- Modify: `src/renderer/src/components/review/ReviewRecords.tsx`
- Modify: `src/renderer/src/styles/theme.css`
- Create: `vite.web.config.ts`
- Modify: `package.json`
- Modify: `README.md`
- Create: `scripts/visual-self-check.mjs`

**Interfaces:**
- `npm run dev:web` runs a Vite dev server using `vite.web.config.ts`.
- `npm run build:web` emits a static site under `dist-web/` with relative asset base.
- `node scripts/visual-self-check.mjs --prompt-file <file> --output <file>` reads `RIGHTAPI_API_KEY` from the environment and calls the configured rightapi endpoint; no key is accepted from committed files or command history.

- [ ] **Step 1: Add failing build/script contract tests**

```ts
it('exposes web build scripts and relative base', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.scripts['build:web']).toContain('vite.web.config.ts')
  expect(readFileSync('vite.web.config.ts', 'utf8')).toContain("base: './'")
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/webBuild.test.ts`
Expected: FAIL because the web config and scripts do not exist.

- [ ] **Step 3: Implement review mobile layout**

Stack review sliders into cards, split compact action rows, reserve textarea space above the bottom bar, move toast above the nav, and compress records rows without overflow.

- [ ] **Step 4: Implement Web Vite config and scripts**

Create a renderer-only Vite config using React plugin, `root: src/renderer`, `base: './'`, `build.outDir: '../../dist-web'`, and `emptyOutDir: true`. Add `dev:web` and `build:web` scripts while preserving Electron scripts.

- [ ] **Step 5: Implement visual self-check CLI**

Create `scripts/visual-self-check.mjs` with endpoint default `https://www.rightapi.ai/draw`, model default `gpt-image-2`, prompt-file input, output path, timeout, and response parsing for common OpenAI-compatible image URL/base64 shapes. Require `RIGHTAPI_API_KEY`; never print it. The script may optionally pass a reference image path only when explicitly supplied by the user.

- [ ] **Step 6: Update README**

Document `npm run dev:web`, `npm run build:web`, GitHub Pages deployment from `dist-web`, responsive breakpoints, the four quadrant color/position rules, and local visual self-check usage with an environment variable example.

- [ ] **Step 7: Run tests and builds**

Run: `npm test`, `npm run typecheck`, `npm run build`, `npm run build:web`
Expected: all tests pass; both builds exit 0; `dist-web/` contains static assets.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/ReviewPage.tsx src/renderer/src/components/review/SegmentedSlider.tsx src/renderer/src/components/review/ReviewRecords.tsx src/renderer/src/styles/theme.css vite.web.config.ts package.json README.md scripts/visual-self-check.mjs tests/webBuild.test.ts
git commit -m "feat: add web build and portrait review experience"
```

### Task 7: Visual QA with generated references and final verification

**Files:**
- Create: `docs/visual-self-check/weekly-prompt.txt`
- Create: `docs/visual-self-check/quadrant-prompt.txt`
- Create: `docs/visual-self-check/README.md`
- Generated outputs: `docs/visual-self-check/*.png` (not required to commit if API unavailable)

- [ ] **Step 1: Prepare prompt files**

Copy the approved weekly and quadrant prompts from the spec into the prompt files, including the explicit instruction not to swap Q2/Q3 colors or positions.

- [ ] **Step 2: Run the local Web app**

Run: `npm run dev:web -- --host 127.0.0.1`
Expected: Vite serves the renderer without Electron preload errors; browser fallback storage initializes to default data.

- [ ] **Step 3: Generate visual references only if the endpoint is reachable**

Set `RIGHTAPI_API_KEY` in the local process environment and invoke the self-check script for both prompt files. Do not save the key, include it in output, or upload project data. If the endpoint is unavailable, record the concrete network error and continue with browser screenshot QA.

- [ ] **Step 4: Inspect responsive viewports**

Use 375×667, 390×844, 430×932 and 1280×800. Verify no page-level horizontal overflow, bottom bar safe-area spacing, 44px touch targets, weekly today marker/event readability, and quadrant position/color semantics.

- [ ] **Step 5: Run final verification**

Run: `npm test`, `npm run typecheck`, `npm run build`, `npm run build:web`, `git diff --check`
Expected: 0 failures, 0 type errors, both builds successful, no whitespace errors.

- [ ] **Step 6: Commit QA prompt documentation**

```bash
git add docs/visual-self-check/weekly-prompt.txt docs/visual-self-check/quadrant-prompt.txt docs/visual-self-check/README.md
git commit -m "docs: add visual self-check prompts"
```
