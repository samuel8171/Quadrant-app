# 象限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Electron + React + TypeScript 实现暗色桌面软件"象限"的目标模块与四象限模块，并打包为 Windows 便携 exe。

**Architecture:** Electron 主进程负责窗口与 JSON 文件持久化，preload 通过 contextBridge 暴露 `window.quadrantApi`；渲染进程用 React + Zustand 管理状态，四象限采用"Canvas 画坐标轴/色块 + DOM 层放事件卡片"的混合方案，纯逻辑（象限数学、目标规则、事件规则）独立成纯函数并用 Vitest 测试。

**Tech Stack:** Electron 31、electron-vite、React 18、TypeScript、Zustand、lucide-react、Vitest、electron-builder（portable）。

---

## File Structure

```
quadrant-app（即 D:\Samuel\Vibe Coding 根目录）
├── package.json
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── vitest.config.ts
├── .gitignore
├── electron-builder.yml
├── README.md
├── docs/superpowers/plans/2026-08-12-quadrant-app.md
├── tests/
│   ├── dataCodec.test.ts
│   ├── goalRules.test.ts
│   ├── quadrantMath.test.ts
│   └── eventRules.test.ts
└── src/
    ├── shared/
    │   ├── types.ts
    │   └── defaults.ts
    ├── main/
    │   ├── index.ts
    │   ├── dataCodec.ts
    │   ├── dataStore.ts
    │   └── mcp/index.ts
    ├── preload/
    │   ├── index.ts
    │   └── index.d.ts
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx
            ├── styles/theme.css
            ├── state/appStore.ts
            ├── lib/
            │   ├── scheduleSave.ts
            │   ├── goalRules.ts
            │   ├── quadrantMath.ts
            │   └── eventRules.ts
            ├── components/
            │   ├── Sidebar.tsx
            │   ├── EventCard.tsx
            │   ├── ContextMenu.tsx
            │   └── EventDetailDialog.tsx
            └── pages/
                ├── GoalsPage.tsx
                ├── QuadrantPage.tsx
                └── PlaceholderPage.tsx
```

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "quadrant",
  "productName": "象限",
  "version": "0.1.0",
  "description": "大学生时间管理计划软件",
  "main": "out/main/index.js",
  "author": "quadrant",
  "license": "MIT",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "electron-vite build && electron-builder --win portable"
  },
  "dependencies": {
    "lucide-react": "^0.424.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.3.0",
    "electron-builder": "^24.13.3",
    "electron-vite": "^2.3.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: 写 electron.vite.config.ts**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
```

- [ ] **Step 3: 写三个 tsconfig**

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "strict": true,
    "skipLibCheck": true
  },
  "include": []
}
```

`tsconfig.node.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true
  },
  "include": [
    "electron.vite.config.ts",
    "vitest.config.ts",
    "src/main/**/*.ts",
    "src/preload/**/*.ts",
    "src/shared/**/*.ts",
    "tests/**/*.ts"
  ]
}
```

`tsconfig.web.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "useDefineForClassFields": true,
    "noEmit": true
  },
  "include": [
    "src/renderer/src/**/*.ts",
    "src/renderer/src/**/*.tsx",
    "src/shared/**/*.ts",
    "src/preload/index.d.ts"
  ]
}
```

- [ ] **Step 4: 写 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
```

- [ ] **Step 5: 写 .gitignore**

```gitignore
node_modules/
out/
dist/
*.log
```

- [ ] **Step 6: 安装依赖**

Run: `npm install`

Expected: `added N packages`，无报错。若沙箱提示 npm 缓存目录无权限，用提权重跑。

- [ ] **Step 7: 空构建验证**

Run: `npm run build`

Expected: 生成 `out/main/index.js`、`out/preload/index.js`、`out/renderer/`，命令退出码 0。

- [ ] **Step 8: 提交**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json vitest.config.ts .gitignore
git commit -m "chore: scaffold electron-vite react project"
```

## Task 2: 共享类型与数据编解码（TDD）

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/defaults.ts`
- Create: `src/main/dataCodec.ts`
- Test: `tests/dataCodec.test.ts`

- [ ] **Step 1: 写共享类型**

`src/shared/types.ts`：

```ts
export type Quadrant = 1 | 2 | 3 | 4

export type GoalType = 'long' | 'short'

export type SubtaskRelation = 'sequential' | 'parallel'

export interface QuadrantEvent {
  id: string
  text: string
  remark: string
  quadrant: Quadrant
  x: number
  y: number
  width: number
  deadline?: string
  escalateAt?: string
  createdAt: string
}

export interface Subtask {
  id: string
  title: string
  done: boolean
  relation: SubtaskRelation
  order: number
}

export interface Goal {
  id: string
  title: string
  type: GoalType
  done: boolean
  subtasks: Subtask[]
  order: number
  createdAt: string
}

export interface AppData {
  version: 1
  goals: Goal[]
  events: QuadrantEvent[]
}

export interface QuadrantApi {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
}
```

- [ ] **Step 2: 写默认数据**

`src/shared/defaults.ts`：

```ts
import type { AppData } from './types'

export function defaultData(): AppData {
  return { version: 1, goals: [], events: [] }
}
```

- [ ] **Step 3: 写失败测试**

`tests/dataCodec.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseData, serializeData } from '../src/main/dataCodec'
import { defaultData } from '../src/shared/defaults'

describe('dataCodec', () => {
  it('round-trips default data', () => {
    const data = defaultData()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('rejects invalid payload', () => {
    expect(() => parseData('{"version":2}')).toThrow()
    expect(() => parseData('not json')).toThrow()
  })

  it('rejects payload without arrays', () => {
    expect(() => parseData('{"version":1}')).toThrow()
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run tests/dataCodec.test.ts`

Expected: FAIL，找不到 `../src/main/dataCodec` 模块。

- [ ] **Step 5: 实现 dataCodec**

`src/main/dataCodec.ts`：

```ts
import type { AppData } from '../shared/types'

export function serializeData(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function parseData(raw: string): AppData {
  const parsed = JSON.parse(raw) as AppData
  if (
    !parsed ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.goals) ||
    !Array.isArray(parsed.events)
  ) {
    throw new Error('invalid data file')
  }
  return parsed
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/dataCodec.test.ts`

Expected: 3 个测试全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add src/shared/types.ts src/shared/defaults.ts src/main/dataCodec.ts tests/dataCodec.test.ts
git commit -m "feat: add shared types and data codec"
```

## Task 3: Electron 主进程、preload 与 IPC

**Files:**
- Create: `src/main/dataStore.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/preload/index.d.ts`
- Create: `src/renderer/index.html`

- [ ] **Step 1: 实现 dataStore（原子写入 + 备份）**

`src/main/dataStore.ts`：

```ts
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppData } from '../shared/types'
import { parseData, serializeData } from './dataCodec'

const FILE_NAME = 'plan.json'
const BACKUP_NAME = 'plan.backup.json'
const TMP_NAME = 'plan.tmp.json'

function dataDir(): string {
  return app.getPath('userData')
}

export async function loadData(): Promise<AppData> {
  const dir = dataDir()
  const file = path.join(dir, FILE_NAME)
  const backup = path.join(dir, BACKUP_NAME)
  try {
    return parseData(await fs.readFile(file, 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, goals: [], events: [] }
    }
    try {
      return parseData(await fs.readFile(backup, 'utf-8'))
    } catch {
      return { version: 1, goals: [], events: [] }
    }
  }
}

export async function saveData(data: AppData): Promise<void> {
  const dir = dataDir()
  const file = path.join(dir, FILE_NAME)
  const backup = path.join(dir, BACKUP_NAME)
  const tmp = path.join(dir, TMP_NAME)
  await fs.mkdir(dir, { recursive: true })
  await fs.copyFile(file, backup).catch(() => {})
  await fs.writeFile(tmp, serializeData(data), 'utf-8')
  await fs.rename(tmp, file)
}
```

- [ ] **Step 2: 实现主进程入口**

`src/main/index.ts`：

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import type { AppData } from '../shared/types'
import { loadData, saveData } from './dataStore'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: '象限',
    backgroundColor: '#0F1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('data:load', () => loadData())
  ipcMain.handle('data:save', (_event, data: AppData) => saveData(data))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: 实现 preload**

`src/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, QuadrantApi } from '../shared/types'

const api: QuadrantApi = {
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<void> => ipcRenderer.invoke('data:save', data)
}

contextBridge.exposeInMainWorld('quadrantApi', api)
```

`src/preload/index.d.ts`：

```ts
import type { QuadrantApi } from '../shared/types'

declare global {
  interface Window {
    quadrantApi: QuadrantApi
  }
}

export {}
```

- [ ] **Step 4: 写渲染进程 HTML**

`src/renderer/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>象限</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: 类型检查与构建**

Run: `npm run typecheck && npm run build`

Expected: 两项均退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/main src/preload src/renderer/index.html
git commit -m "feat: add electron main process and ipc bridge"
```

## Task 4: 纯逻辑 — 目标规则（TDD）

**Files:**
- Create: `src/renderer/src/lib/goalRules.ts`
- Test: `tests/goalRules.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/goalRules.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { Goal } from '../src/shared/types'
import {
  addGoalToList,
  addSubtaskToGoal,
  autoCompleteParent,
  canCheckSubtask,
  removeGoalFromList,
  removeSubtaskFromGoal,
  toggleGoalInList,
  toggleSubtaskInGoal,
  updateGoalTitleInList,
  updateSubtaskRelation,
  updateSubtaskTitleInGoal
} from '../src/renderer/src/lib/goalRules'

function makeGoal(): Goal {
  return {
    id: 'g1',
    title: '考研英语 85+',
    type: 'long',
    done: false,
    subtasks: [],
    order: 0,
    createdAt: '2026-08-12T00:00:00.000Z'
  }
}

describe('goalRules', () => {
  it('adds and trims goals, ignores empty titles', () => {
    const one = addGoalToList([], 'long', '  背单词  ')
    expect(one[0].title).toBe('背单词')
    expect(addGoalToList([], 'short', '   ')).toHaveLength(0)
  })

  it('toggles goal done', () => {
    const goal = makeGoal()
    const toggled = toggleGoalInList([goal], 'g1')[0]
    expect(toggled.done).toBe(true)
  })

  it('updates and removes goals', () => {
    const goal = makeGoal()
    expect(updateGoalTitleInList([goal], 'g1', '新标题')[0].title).toBe('新标题')
    expect(removeGoalFromList([goal], 'g1')).toHaveLength(0)
  })

  it('sequential subtask requires previous one done', () => {
    let goal = addSubtaskToGoal(makeGoal(), '第一步', 'sequential')
    goal = addSubtaskToGoal(goal, '第二步', 'sequential')
    const first = goal.subtasks[0]
    const second = goal.subtasks[1]
    expect(canCheckSubtask(goal, first)).toBe(true)
    expect(canCheckSubtask(goal, second)).toBe(false)
    goal = toggleSubtaskInGoal(goal, first.id)
    expect(canCheckSubtask(goal, second)).toBe(true)
  })

  it('blocks checking a sequential subtask until previous is done', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'sequential')
    goal = addSubtaskToGoal(goal, 'B', 'sequential')
    const blocked = toggleSubtaskInGoal(goal, goal.subtasks[1].id)
    expect(blocked.subtasks[1].done).toBe(false)
  })

  it('parallel subtask can always be checked', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    goal = addSubtaskToGoal(goal, 'B', 'parallel')
    const toggled = toggleSubtaskInGoal(goal, goal.subtasks[1].id)
    expect(toggled.subtasks[1].done).toBe(true)
  })

  it('auto-completes parent when all subtasks are done', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    expect(goal.done).toBe(true)
  })

  it('adding a new subtask un-completes the parent', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    goal = addSubtaskToGoal(goal, 'B', 'parallel')
    expect(goal.done).toBe(false)
  })

  it('updates subtask title, relation and removal', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    const id = goal.subtasks[0].id
    goal = updateSubtaskTitleInGoal(goal, id, '改名')
    expect(goal.subtasks[0].title).toBe('改名')
    goal = updateSubtaskRelation(goal, id, 'sequential')
    expect(goal.subtasks[0].relation).toBe('sequential')
    goal = removeSubtaskFromGoal(goal, id)
    expect(goal.subtasks).toHaveLength(0)
    expect(autoCompleteParent(goal).done).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/goalRules.test.ts`

Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 goalRules**

`src/renderer/src/lib/goalRules.ts`：

```ts
import type { Goal, Subtask, SubtaskRelation } from '../../../shared/types'

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function addGoalToList(goals: Goal[], type: 'long' | 'short', title: string): Goal[] {
  const trimmed = title.trim()
  if (!trimmed) return goals
  const goal: Goal = {
    id: newId('goal'),
    title: trimmed,
    type,
    done: false,
    subtasks: [],
    order: goals.length,
    createdAt: new Date().toISOString()
  }
  return [...goals, goal]
}

export function toggleGoalInList(goals: Goal[], id: string): Goal[] {
  return goals.map((g) => (g.id === id ? { ...g, done: !g.done } : g))
}

export function updateGoalTitleInList(goals: Goal[], id: string, title: string): Goal[] {
  const trimmed = title.trim()
  if (!trimmed) return goals
  return goals.map((g) => (g.id === id ? { ...g, title: trimmed } : g))
}

export function removeGoalFromList(goals: Goal[], id: string): Goal[] {
  return goals.filter((g) => g.id !== id)
}

export function canCheckSubtask(goal: Goal, subtask: Subtask): boolean {
  if (subtask.done || subtask.relation !== 'sequential') return true
  const idx = goal.subtasks.findIndex((s) => s.id === subtask.id)
  if (idx <= 0) return true
  return goal.subtasks[idx - 1].done
}

export function addSubtaskToGoal(
  goal: Goal,
  title: string,
  relation: SubtaskRelation
): Goal {
  const trimmed = title.trim()
  if (!trimmed || goal.type !== 'long') return goal
  const subtask: Subtask = {
    id: newId('sub'),
    title: trimmed,
    done: false,
    relation,
    order: goal.subtasks.length
  }
  return { ...goal, done: false, subtasks: [...goal.subtasks, subtask] }
}

export function toggleSubtaskInGoal(goal: Goal, subtaskId: string): Goal {
  const subtask = goal.subtasks.find((s) => s.id === subtaskId)
  if (!subtask || !canCheckSubtask(goal, subtask)) return goal
  const subtasks = goal.subtasks.map((s) =>
    s.id === subtaskId ? { ...s, done: !s.done } : s
  )
  return autoCompleteParent({ ...goal, subtasks })
}

export function updateSubtaskTitleInGoal(goal: Goal, subtaskId: string, title: string): Goal {
  const trimmed = title.trim()
  if (!trimmed) return goal
  return {
    ...goal,
    subtasks: goal.subtasks.map((s) => (s.id === subtaskId ? { ...s, title: trimmed } : s))
  }
}

export function updateSubtaskRelation(
  goal: Goal,
  subtaskId: string,
  relation: SubtaskRelation
): Goal {
  return {
    ...goal,
    subtasks: goal.subtasks.map((s) => (s.id === subtaskId ? { ...s, relation } : s))
  }
}

export function removeSubtaskFromGoal(goal: Goal, subtaskId: string): Goal {
  return {
    ...goal,
    subtasks: goal.subtasks.filter((s) => s.id !== subtaskId)
  }
}

export function progressOf(goal: Goal): { done: number; total: number } {
  const total = goal.subtasks.length
  const done = goal.subtasks.filter((s) => s.done).length
  return { done, total }
}

export function autoCompleteParent(goal: Goal): Goal {
  const { done, total } = progressOf(goal)
  return { ...goal, done: total > 0 && done === total }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/goalRules.test.ts`

Expected: 10 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/lib/goalRules.ts tests/goalRules.test.ts
git commit -m "feat: add goal and subtask rules"
```

## Task 5: 纯逻辑 — 四象限数学与事件规则（TDD）

**Files:**
- Create: `src/renderer/src/lib/quadrantMath.ts`
- Create: `src/renderer/src/lib/eventRules.ts`
- Test: `tests/quadrantMath.test.ts`
- Test: `tests/eventRules.test.ts`

- [ ] **Step 1: 写失败测试（quadrantMath）**

`tests/quadrantMath.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { QuadrantEvent } from '../src/shared/types'
import {
  AXIS_GAP_PX,
  MAX_EVENT_WIDTH_UNITS,
  MIN_EVENT_WIDTH_UNITS,
  autoEventWidth,
  clampEventToQuadrant,
  clampOrigin,
  clampZoom,
  escalateEvent,
  quadrantOfWorldPoint,
  screenToWorldX,
  screenToWorldY,
  worldToScreenX,
  worldToScreenY,
  zoomAt,
  type ViewState
} from '../src/renderer/src/lib/quadrantMath'

const view: ViewState = { zoom: 1, panX: 200, panY: 150 }

function event(overrides: Partial<QuadrantEvent>): QuadrantEvent {
  return {
    id: 'e1',
    text: '任务',
    remark: '',
    quadrant: 1,
    x: 5,
    y: 5,
    width: 10,
    createdAt: '2026-08-12T00:00:00.000Z',
    ...overrides
  }
}

describe('quadrantMath', () => {
  it('clamps zoom range', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(3)).toBe(2.5)
    expect(clampZoom(1)).toBe(1)
  })

  it('round-trips world and screen coordinates', () => {
    const sx = worldToScreenX(3, view)
    const sy = worldToScreenY(-2, view)
    expect(screenToWorldX(sx, view)).toBeCloseTo(3)
    expect(screenToWorldY(sy, view)).toBeCloseTo(-2)
  })

  it('classifies quadrants by world point', () => {
    expect(quadrantOfWorldPoint(1, 1)).toBe(1)
    expect(quadrantOfWorldPoint(-1, 1)).toBe(2)
    expect(quadrantOfWorldPoint(-1, -1)).toBe(3)
    expect(quadrantOfWorldPoint(1, -1)).toBe(4)
  })

  it('clamps origin 10px from every viewport edge', () => {
    const clamped = clampOrigin({ zoom: 1, panX: -50, panY: 9999 }, 800, 600)
    expect(clamped.panX).toBe(10)
    expect(clamped.panY).toBe(590)
  })

  it('zoomAt keeps the cursor world point fixed', () => {
    const next = zoomAt(400, 300, 2, view)
    const wxBefore = screenToWorldX(400, view)
    const wxAfter = screenToWorldX(400, next)
    expect(wxAfter).toBeCloseTo(wxBefore)
  })

  it('autoEventWidth stays within bounds', () => {
    expect(autoEventWidth('')).toBeGreaterThanOrEqual(MIN_EVENT_WIDTH_UNITS)
    expect(autoEventWidth('x'.repeat(200))).toBeLessThanOrEqual(MAX_EVENT_WIDTH_UNITS)
  })

  it('clamps event inside Q1 colored block', () => {
    const result = clampEventToQuadrant(
      event({ quadrant: 1, x: -1, y: -1 }),
      view
    )
    expect(worldToScreenX(result.x, view)).toBeGreaterThanOrEqual(200 + AXIS_GAP_PX)
    expect(worldToScreenY(result.y, view)).toBeGreaterThanOrEqual(150 + AXIS_GAP_PX)
  })

  it('clamps event inside Q3 colored block', () => {
    const e = event({ quadrant: 3, x: 1, y: 1, width: 4 })
    const result = clampEventToQuadrant(e, view)
    expect(worldToScreenX(result.x + result.width, view)).toBeLessThanOrEqual(200 - AXIS_GAP_PX)
    expect(worldToScreenY(result.y, view)).toBeLessThanOrEqual(150 - AXIS_GAP_PX)
  })

  it('escalation mirrors Q2 to Q1 horizontally without changing y', () => {
    const e = event({
      quadrant: 2,
      x: -12,
      y: 4,
      width: 8,
      escalateAt: '2026-08-01T00:00:00.000Z'
    })
    const result = escalateEvent(e, new Date('2026-08-12T00:00:00.000Z'))
    expect(result.quadrant).toBe(1)
    expect(result.x).toBe(4)
    expect(result.y).toBe(4)
    expect(result.escalateAt).toBeUndefined()
  })

  it('does not escalate before escalateAt', () => {
    const e = event({
      quadrant: 2,
      x: -12,
      y: 4,
      width: 8,
      escalateAt: '2026-09-01T00:00:00.000Z'
    })
    const result = escalateEvent(e, new Date('2026-08-12T00:00:00.000Z'))
    expect(result.quadrant).toBe(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/quadrantMath.test.ts`

Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现 quadrantMath**

`src/renderer/src/lib/quadrantMath.ts`：

```ts
import type { Quadrant, QuadrantEvent } from '../../../shared/types'

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

export const UNIT = 20
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5
export const AXIS_GAP_PX = 10
export const EDGE_MARGIN_PX = 10
export const MAX_EVENT_WIDTH_UNITS = 20
export const MIN_EVENT_WIDTH_UNITS = 6
export const EVENT_HEIGHT_UNITS = 1.6

export const QUADRANT_META: Record<
  Quadrant,
  { label: string; color: string; corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
> = {
  1: { label: '重要紧急', color: '#FF8C00', corner: 'top-right' },
  2: { label: '重要不紧急', color: '#FFA500', corner: 'top-left' },
  3: { label: '不重要不紧急', color: '#008B8B', corner: 'bottom-left' },
  4: { label: '不重要紧急', color: '#483D8B', corner: 'bottom-right' }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function worldToScreenX(wx: number, view: ViewState): number {
  return view.panX + wx * UNIT * view.zoom
}

export function worldToScreenY(wy: number, view: ViewState): number {
  return view.panY + wy * UNIT * view.zoom
}

export function screenToWorldX(sx: number, view: ViewState): number {
  return (sx - view.panX) / (UNIT * view.zoom)
}

export function screenToWorldY(sy: number, view: ViewState): number {
  return (sy - view.panY) / (UNIT * view.zoom)
}

export function quadrantOfWorldPoint(wx: number, wy: number): Quadrant {
  if (wx >= 0 && wy >= 0) return 1
  if (wx < 0 && wy >= 0) return 2
  if (wx < 0 && wy < 0) return 3
  return 4
}

export function clampOrigin(view: ViewState, width: number, height: number): ViewState {
  return {
    zoom: view.zoom,
    panX: Math.min(width - EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, view.panX)),
    panY: Math.min(height - EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, view.panY))
  }
}

export function zoomAt(
  viewportX: number,
  viewportY: number,
  nextZoom: number,
  view: ViewState
): ViewState {
  const zoom = clampZoom(nextZoom)
  const wx = screenToWorldX(viewportX, view)
  const wy = screenToWorldY(viewportY, view)
  return {
    zoom,
    panX: viewportX - wx * UNIT * zoom,
    panY: viewportY - wy * UNIT * zoom
  }
}

export function autoEventWidth(text: string): number {
  const estimated = Math.max(MIN_EVENT_WIDTH_UNITS, Math.ceil(text.length * 0.7))
  return Math.min(MAX_EVENT_WIDTH_UNITS, estimated)
}

export function eventScreenRect(
  e: QuadrantEvent,
  view: ViewState
): { left: number; top: number; width: number; height: number } {
  return {
    left: worldToScreenX(e.x, view),
    top: worldToScreenY(e.y, view),
    width: e.width * UNIT * view.zoom,
    height: EVENT_HEIGHT_UNITS * UNIT * view.zoom
  }
}

export function clampEventToQuadrant(e: QuadrantEvent, view: ViewState): QuadrantEvent {
  const rect = eventScreenRect(e, view)
  let left = rect.left
  let top = rect.top
  if (e.quadrant === 1 || e.quadrant === 4) {
    left = Math.max(left, view.panX + AXIS_GAP_PX)
  } else {
    left = Math.min(left, view.panX - AXIS_GAP_PX - rect.width)
  }
  if (e.quadrant === 1 || e.quadrant === 2) {
    top = Math.max(top, view.panY + AXIS_GAP_PX)
  } else {
    top = Math.min(top, view.panY - AXIS_GAP_PX - rect.height)
  }
  return { ...e, x: screenToWorldX(left, view), y: screenToWorldY(top, view) }
}

export function escalateEvent(e: QuadrantEvent, now: Date): QuadrantEvent {
  if (!e.escalateAt || e.quadrant === 1 || e.quadrant === 4) return e
  if (new Date(e.escalateAt).getTime() > now.getTime()) return e
  const target: Quadrant = e.quadrant === 2 ? 1 : 4
  return { ...e, quadrant: target, x: -e.x - e.width, escalateAt: undefined }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/quadrantMath.test.ts`

Expected: 11 个测试全部 PASS。

- [ ] **Step 5: 写失败测试（eventRules）**

`tests/eventRules.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { QuadrantEvent } from '../src/shared/types'
import {
  applyEscalations,
  createEvent,
  moveEvent,
  pasteEvent,
  updateEventInList
} from '../src/renderer/src/lib/eventRules'
import type { ViewState } from '../src/renderer/src/lib/quadrantMath'

const view: ViewState = { zoom: 1, panX: 200, panY: 150 }

describe('eventRules', () => {
  it('creates an event clamped to its quadrant', () => {
    const e = createEvent('  明天交作业  ', 2, 1, 1, view)
    expect(e.text).toBe('明天交作业')
    expect(e.quadrant).toBe(2)
    expect(e.x + e.width <= 0).toBe(true)
  })

  it('moves event and switches quadrant when crossing origin', () => {
    const e = createEvent('任务', 3, -5, -5, view)
    const moved = moveEvent([e], e.id, 3, 3, view)[0]
    expect(moved.quadrant).toBe(1)
    expect(moved.x >= 0).toBe(true)
  })

  it('updates event fields and keeps others', () => {
    const e = createEvent('任务', 1, 3, 3, view)
    const updated = updateEventInList([e], e.id, { remark: '备注' }, view)[0]
    expect(updated.remark).toBe('备注')
    expect(updated.text).toBe('任务')
  })

  it('pastes a copy with offset and new id', () => {
    const e = createEvent('任务', 1, 3, 3, view)
    const pasted = pasteEvent([e], e, view)[1]
    expect(pasted.id).not.toBe(e.id)
    expect(pasted.x).toBeGreaterThan(e.x)
    expect(pasted.y).toBeGreaterThan(e.y)
  })

  it('applies escalations only when due', () => {
    const due = createEvent('升级', 2, -5, 3, view)
    due.escalateAt = '2026-08-01T00:00:00.000Z'
    const notDue = createEvent('不升级', 3, -5, -3, view)
    notDue.escalateAt = '2026-09-01T00:00:00.000Z'
    const result = applyEscalations([due, notDue], new Date('2026-08-12T00:00:00.000Z'))
    expect(result[0].quadrant).toBe(1)
    expect(result[1].quadrant).toBe(3)
  })
})
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npx vitest run tests/eventRules.test.ts`

Expected: FAIL，找不到模块。

- [ ] **Step 7: 实现 eventRules**

`src/renderer/src/lib/eventRules.ts`：

```ts
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import {
  autoEventWidth,
  clampEventToQuadrant,
  escalateEvent,
  quadrantOfWorldPoint,
  type ViewState
} from './quadrantMath'

export function createEvent(
  text: string,
  quadrant: Quadrant,
  worldX: number,
  worldY: number,
  view: ViewState
): QuadrantEvent {
  const e: QuadrantEvent = {
    id: crypto.randomUUID(),
    text: text.trim(),
    remark: '',
    quadrant,
    x: worldX,
    y: worldY,
    width: autoEventWidth(text),
    createdAt: new Date().toISOString()
  }
  return clampEventToQuadrant(e, view)
}

export function moveEvent(
  events: QuadrantEvent[],
  id: string,
  worldX: number,
  worldY: number,
  view: ViewState
): QuadrantEvent[] {
  return events.map((e) => {
    if (e.id !== id) return e
    const quadrant = quadrantOfWorldPoint(worldX, worldY)
    return clampEventToQuadrant({ ...e, quadrant, x: worldX, y: worldY }, view)
  })
}

export function updateEventInList(
  events: QuadrantEvent[],
  id: string,
  patch: Partial<QuadrantEvent>,
  view: ViewState
): QuadrantEvent[] {
  return events.map((e) => {
    if (e.id !== id) return e
    const merged = { ...e, ...patch }
    if (
      merged.quadrant !== e.quadrant ||
      merged.x !== e.x ||
      merged.y !== e.y ||
      merged.width !== e.width
    ) {
      return clampEventToQuadrant(merged, view)
    }
    return merged
  })
}

export function deleteEventFromList(events: QuadrantEvent[], id: string): QuadrantEvent[] {
  return events.filter((e) => e.id !== id)
}

export function pasteEvent(
  events: QuadrantEvent[],
  source: QuadrantEvent,
  view: ViewState
): QuadrantEvent[] {
  const copy: QuadrantEvent = {
    ...source,
    id: crypto.randomUUID(),
    x: source.x + 0.8,
    y: source.y + 0.8,
    width: autoEventWidth(source.text)
  }
  return [...events, clampEventToQuadrant(copy, view)]
}

export function applyEscalations(events: QuadrantEvent[], now: Date): QuadrantEvent[] {
  let changed = false
  const next = events.map((e) => {
    const escalated = escalateEvent(e, now)
    if (escalated !== e) changed = true
    return escalated
  })
  return changed ? next : events
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run tests/eventRules.test.ts`

Expected: 5 个测试全部 PASS。

- [ ] **Step 9: 提交**

```bash
git add src/renderer/src/lib/quadrantMath.ts src/renderer/src/lib/eventRules.ts tests/quadrantMath.test.ts tests/eventRules.test.ts
git commit -m "feat: add quadrant math and event rules"
```

## Task 6: Zustand 应用状态与持久化桥

**Files:**
- Create: `src/renderer/src/lib/scheduleSave.ts`
- Create: `src/renderer/src/state/appStore.ts`

- [ ] **Step 1: 实现防抖保存**

`src/renderer/src/lib/scheduleSave.ts`：

```ts
let timer: number | undefined

export function scheduleSave(save: () => void, delay = 500): void {
  window.clearTimeout(timer)
  timer = window.setTimeout(save, delay)
}
```

- [ ] **Step 2: 实现 appStore**

`src/renderer/src/state/appStore.ts`：

```ts
import { create } from 'zustand'
import type { AppData, Quadrant, QuadrantEvent, SubtaskRelation } from '../../../shared/types'
import { defaultData } from '../../../shared/defaults'
import * as eventRules from '../lib/eventRules'
import * as goalRules from '../lib/goalRules'
import type { ViewState } from '../lib/quadrantMath'
import { scheduleSave } from '../lib/scheduleSave'

export type Page = 'goals' | 'quadrant' | 'weekly' | 'review'

interface AppState {
  data: AppData
  page: Page
  activeGoalId: string | null
  loaded: boolean
  init: () => Promise<void>
  setPage: (page: Page) => void
  openGoal: (id: string) => void
  closeGoal: () => void
  addGoal: (type: 'long' | 'short', title: string) => void
  toggleGoal: (id: string) => void
  updateGoalTitle: (id: string, title: string) => void
  deleteGoal: (id: string) => void
  addSubtask: (goalId: string, title: string, relation: SubtaskRelation) => void
  toggleSubtask: (goalId: string, subtaskId: string) => void
  updateSubtaskTitle: (goalId: string, subtaskId: string, title: string) => void
  updateSubtaskRelation: (goalId: string, subtaskId: string, relation: SubtaskRelation) => void
  deleteSubtask: (goalId: string, subtaskId: string) => void
  addEvent: (text: string, quadrant: Quadrant, worldX: number, worldY: number, view: ViewState) => void
  updateEvent: (id: string, patch: Partial<QuadrantEvent>, view: ViewState) => void
  deleteEvent: (id: string) => void
  moveEvent: (id: string, worldX: number, worldY: number, view: ViewState) => void
  copyEvent: (id: string) => void
  cutEvent: (id: string) => void
  pasteEvent: (view: ViewState) => void
  applyEscalations: () => void
  saveNow: () => void
}

let clipboard: QuadrantEvent | null = null

function saveSoon(data: AppData): void {
  scheduleSave(() => {
    void window.quadrantApi.saveData(data)
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  data: defaultData(),
  page: 'goals',
  activeGoalId: null,
  loaded: false,

  init: async () => {
    const data = await window.quadrantApi.loadData()
    set({ data, loaded: true })
  },

  setPage: (page) => set({ page }),
  openGoal: (id) => set({ activeGoalId: id }),
  closeGoal: () => set({ activeGoalId: null }),

  addGoal: (type, title) => {
    const data = { ...get().data, goals: goalRules.addGoalToList(get().data.goals, type, title) }
    saveSoon(data)
    set({ data })
  },

  toggleGoal: (id) => {
    const data = { ...get().data, goals: goalRules.toggleGoalInList(get().data.goals, id) }
    saveSoon(data)
    set({ data })
  },

  updateGoalTitle: (id, title) => {
    const data = {
      ...get().data,
      goals: goalRules.updateGoalTitleInList(get().data.goals, id, title)
    }
    saveSoon(data)
    set({ data })
  },

  deleteGoal: (id) => {
    const data = { ...get().data, goals: goalRules.removeGoalFromList(get().data.goals, id) }
    saveSoon(data)
    set({ data })
  },

  addSubtask: (goalId, title, relation) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.addSubtaskToGoal(g, title, relation) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  toggleSubtask: (goalId, subtaskId) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.toggleSubtaskInGoal(g, subtaskId) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  updateSubtaskTitle: (goalId, subtaskId, title) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.updateSubtaskTitleInGoal(g, subtaskId, title) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  updateSubtaskRelation: (goalId, subtaskId, relation) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.updateSubtaskRelation(g, subtaskId, relation) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  deleteSubtask: (goalId, subtaskId) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.removeSubtaskFromGoal(g, subtaskId) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  addEvent: (text, quadrant, worldX, worldY, view) => {
    const event = eventRules.createEvent(text, quadrant, worldX, worldY, view)
    const data = { ...get().data, events: [...get().data.events, event] }
    saveSoon(data)
    set({ data })
  },

  updateEvent: (id, patch, view) => {
    const data = {
      ...get().data,
      events: eventRules.updateEventInList(get().data.events, id, patch, view)
    }
    saveSoon(data)
    set({ data })
  },

  deleteEvent: (id) => {
    const data = { ...get().data, events: eventRules.deleteEventFromList(get().data.events, id) }
    saveSoon(data)
    set({ data })
  },

  moveEvent: (id, worldX, worldY, view) => {
    const data = {
      ...get().data,
      events: eventRules.moveEvent(get().data.events, id, worldX, worldY, view)
    }
    saveSoon(data)
    set({ data })
  },

  copyEvent: (id) => {
    clipboard = get().data.events.find((e) => e.id === id) ?? null
  },

  cutEvent: (id) => {
    clipboard = get().data.events.find((e) => e.id === id) ?? null
    if (clipboard) {
      const data = { ...get().data, events: eventRules.deleteEventFromList(get().data.events, id) }
      saveSoon(data)
      set({ data })
    }
  },

  pasteEvent: (view) => {
    if (!clipboard) return
    const data = {
      ...get().data,
      events: eventRules.pasteEvent(get().data.events, clipboard, view)
    }
    saveSoon(data)
    set({ data })
  },

  applyEscalations: () => {
    const events = eventRules.applyEscalations(get().data.events, new Date())
    if (events === get().data.events) return
    const data = { ...get().data, events }
    saveSoon(data)
    set({ data })
  },

  saveNow: () => {
    void window.quadrantApi.saveData(get().data)
  }
}))
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/lib/scheduleSave.ts src/renderer/src/state/appStore.ts
git commit -m "feat: add zustand app store with persistence"
```

## Task 7: 应用壳、暗色主题与侧边栏

**Files:**
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/styles/theme.css`
- Create: `src/renderer/src/components/Sidebar.tsx`
- Create: `src/renderer/src/pages/PlaceholderPage.tsx`

- [ ] **Step 1: 写入口文件**

`src/renderer/src/main.tsx`：

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/theme.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 2: 写 App**

`src/renderer/src/App.tsx`：

```tsx
import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import GoalsPage from './pages/GoalsPage'
import QuadrantPage from './pages/QuadrantPage'
import PlaceholderPage from './pages/PlaceholderPage'
import { useAppStore } from './state/appStore'

export default function App(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const init = useAppStore((s) => s.init)
  const applyEscalations = useAppStore((s) => s.applyEscalations)

  useEffect(() => {
    void init()
    const timer = window.setInterval(() => applyEscalations(), 60_000)
    return () => window.clearInterval(timer)
  }, [init, applyEscalations])

  return (
    <div className="app">
      <Sidebar />
      <main className="content">
        {page === 'goals' && <GoalsPage />}
        {page === 'quadrant' && <QuadrantPage />}
        {page === 'weekly' && <PlaceholderPage title="周计划" />}
        {page === 'review' && <PlaceholderPage title="周日复盘" />}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: 写主题样式**

`src/renderer/src/styles/theme.css`：

```css
:root {
  --bg: #0f1115;
  --panel: #1a1d23;
  --card: #1f242c;
  --border: #2c3036;
  --text: #ffffff;
  --text-secondary: #b0b5c0;
  --accent: #4da3ff;
  --success: #66bb6a;
  --danger: #e5484d;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  user-select: none;
  overflow: hidden;
}

.app {
  display: flex;
  height: 100%;
}

.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sidebar {
  width: 220px;
  min-width: 220px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
}

.brand-logo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  width: 20px;
  height: 20px;
}

.brand-logo i {
  background: var(--accent);
  border-radius: 2px;
}

.brand-logo i:nth-child(2),
.brand-logo i:nth-child(3) {
  opacity: 0.55;
}

.brand-name {
  font-size: 17px;
  font-weight: 700;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
}

.nav-item.active {
  background: linear-gradient(135deg, #2d3748, #3a4a5a);
  border-color: var(--accent);
  box-shadow: 0 0 12px rgba(77, 163, 255, 0.35);
  color: var(--text);
  font-weight: 600;
}

.tagline {
  margin-top: auto;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.tagline span:first-child {
  color: var(--text);
  font-weight: 600;
}

.page {
  flex: 1;
  padding: 28px 32px;
  overflow: auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0;
  font-size: 26px;
}

.title-underline {
  width: 44px;
  height: 3px;
  border-radius: 2px;
  background: var(--accent);
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  font-size: 15px;
}
```

- [ ] **Step 4: 写侧边栏**

`src/renderer/src/components/Sidebar.tsx`：

```tsx
import { CalendarDays, Grid2x2, RefreshCcw, Target } from 'lucide-react'
import type { Page } from '../state/appStore'
import { useAppStore } from '../state/appStore'

const NAV: { page: Page; label: string; icon: typeof Target }[] = [
  { page: 'goals', label: '目标', icon: Target },
  { page: 'quadrant', label: '四象限', icon: Grid2x2 },
  { page: 'weekly', label: '周计划', icon: CalendarDays },
  { page: 'review', label: '周日复盘', icon: RefreshCcw }
]

export default function Sidebar(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-logo">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">象限</span>
      </div>
      <nav className="nav">
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <button
            key={p}
            className={`nav-item${page === p ? ' active' : ''}`}
            onClick={() => setPage(p)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="tagline">
        <span>✨ 专注当下，赢得未来</span>
        <span>每一个小目标，都是通往大目标的基石。</span>
      </div>
    </aside>
  )
}
```

- [ ] **Step 5: 写占位页**

`src/renderer/src/pages/PlaceholderPage.tsx`：

```tsx
export default function PlaceholderPage({ title }: { title: string }): JSX.Element {
  return (
    <div className="page">
      <header className="page-header">
        <h1>{title}</h1>
        <span className="title-underline" />
      </header>
      <div className="placeholder">该模块开发中</div>
    </div>
  )
}
```

- [ ] **Step 6: 类型检查与构建**

Run: `npm run typecheck && npm run build`

Expected: 退出码 0（GoalsPage/QuadrantPage 尚未创建，类型检查会在 import 处失败——因此先创建两个占位页面文件再跑本步骤）。

说明：本步骤前先创建 `GoalsPage.tsx` 与 `QuadrantPage.tsx` 的临时占位（各返回一个空 `div`），确保类型检查通过；Task 8/9 会替换为完整实现。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/main.tsx src/renderer/src/App.tsx src/renderer/src/styles/theme.css src/renderer/src/components/Sidebar.tsx src/renderer/src/pages/PlaceholderPage.tsx src/renderer/src/pages/GoalsPage.tsx src/renderer/src/pages/QuadrantPage.tsx
git commit -m "feat: add app shell and dark theme"
```

## Task 8: 目标模块 UI

**Files:**
- Modify: `src/renderer/src/pages/GoalsPage.tsx`（完整实现）
- Modify: `src/renderer/src/styles/theme.css`（追加目标页样式）

- [ ] **Step 1: 实现 GoalsPage**

`src/renderer/src/pages/GoalsPage.tsx`：

```tsx
import { useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Mountain,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Goal, SubtaskRelation } from '../../../shared/types'
import { progressOf } from '../lib/goalRules'
import { useAppStore } from '../state/appStore'

export default function GoalsPage(): JSX.Element {
  const activeGoalId = useAppStore((s) => s.activeGoalId)
  if (activeGoalId) return <LongTermDetailPage goalId={activeGoalId} />
  return (
    <div className="page goals-page">
      <header className="page-header">
        <h1>目标</h1>
        <span className="title-underline" />
      </header>
      <div className="goal-columns">
        <GoalColumn type="long" title="长期目标" icon={Mountain} accentClass="accent-blue" />
        <GoalColumn type="short" title="短期目标" icon={Calendar} accentClass="accent-green" />
      </div>
    </div>
  )
}

function GoalColumn({
  type,
  title,
  icon: Icon,
  accentClass
}: {
  type: 'long' | 'short'
  title: string
  icon: typeof Mountain
  accentClass: string
}): JSX.Element {
  const goals = useAppStore((s) => s.data.goals.filter((g) => g.type === type))
  const addGoal = useAppStore((s) => s.addGoal)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const submitNew = (): void => {
    if (draft.trim()) addGoal(type, draft)
    setDraft('')
    setAdding(false)
  }

  const submitEdit = (id: string): void => {
    useAppStore.getState().updateGoalTitle(id, editingText)
    setEditingId(null)
  }

  return (
    <section className={`goal-column ${accentClass}`}>
      <h2 className="goal-column-title">
        <Icon size={18} />
        {title}
      </h2>
      <div className="goal-list">
        {goals.map((goal) => (
          <div key={goal.id} className={`goal-card${goal.done ? ' done' : ''}`}>
            <label className="goal-check">
              <input
                type="checkbox"
                checked={goal.done}
                onChange={() => useAppStore.getState().toggleGoal(goal.id)}
              />
              <span className="checkmark" />
            </label>
            {editingId === goal.id ? (
              <input
                className="goal-edit-input"
                value={editingText}
                autoFocus
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => submitEdit(goal.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEdit(goal.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="goal-title">{goal.title}</span>
            )}
            {goal.type === 'long' && goal.subtasks.length > 0 && (
              <span className="goal-progress">
                {progressOf(goal).done}/{progressOf(goal).total}
              </span>
            )}
            <button
              className="icon-btn"
              title="编辑"
              onClick={() => {
                setEditingId(goal.id)
                setEditingText(goal.title)
              }}
            >
              <Pencil size={15} />
            </button>
            {goal.type === 'long' && (
              <button
                className="icon-btn"
                title="展开子目标"
                onClick={() => useAppStore.getState().openGoal(goal.id)}
              >
                <ChevronRight size={16} />
              </button>
            )}
            <button
              className="icon-btn danger"
              title="删除"
              onClick={() => {
                if (window.confirm(`删除目标「${goal.title}」？`)) {
                  useAppStore.getState().deleteGoal(goal.id)
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="add-goal-row">
          <input
            autoFocus
            value={draft}
            placeholder="输入目标名称"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        </div>
      ) : (
        <button className="add-goal-btn" onClick={() => setAdding(true)}>
          <Plus size={16} />
          添加{title}
        </button>
      )}
    </section>
  )
}

function LongTermDetailPage({ goalId }: { goalId: string }): JSX.Element {
  const goal = useAppStore((s) => s.data.goals.find((g) => g.id === goalId))
  const closeGoal = useAppStore((s) => s.closeGoal)
  const [draft, setDraft] = useState('')
  const [relation, setRelation] = useState<SubtaskRelation>('parallel')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  if (!goal) {
    return (
      <div className="page">
        <button className="back-btn" onClick={closeGoal}>
          <ArrowLeft size={16} />
          返回
        </button>
      </div>
    )
  }

  const { done, total } = progressOf(goal)

  const submitNew = (): void => {
    if (draft.trim()) useAppStore.getState().addSubtask(goalId, draft, relation)
    setDraft('')
  }

  return (
    <div className="page subtask-page">
      <button className="back-btn" onClick={closeGoal}>
        <ArrowLeft size={16} />
        返回
      </button>
      <header className="subtask-header">
        <h1>{goal.title}</h1>
        <span className="subtask-progress">
          进度 {done}/{total}
        </span>
      </header>
      <div className="subtask-list">
        {goal.subtasks.map((subtask, index) => (
          <div key={subtask.id} className={`subtask-card${subtask.done ? ' done' : ''}`}>
            <label className="goal-check">
              <input
                type="checkbox"
                checked={subtask.done}
                disabled={
                  !subtask.done &&
                  subtask.relation === 'sequential' &&
                  index > 0 &&
                  !goal.subtasks[index - 1].done
                }
                onChange={() => useAppStore.getState().toggleSubtask(goalId, subtask.id)}
              />
              <span className="checkmark" />
            </label>
            <span className={`relation-badge ${subtask.relation}`}>
              {subtask.relation === 'sequential' ? '顺序' : '并列'}
            </span>
            {editingId === subtask.id ? (
              <input
                className="goal-edit-input"
                value={editingText}
                autoFocus
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => {
                  useAppStore.getState().updateSubtaskTitle(goalId, subtask.id, editingText)
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    useAppStore.getState().updateSubtaskTitle(goalId, subtask.id, editingText)
                    setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="goal-title">{subtask.title}</span>
            )}
            <select
              className="relation-select"
              value={subtask.relation}
              title="与前一个子目标的关系"
              onChange={(e) =>
                useAppStore.getState().updateSubtaskRelation(
                  goalId,
                  subtask.id,
                  e.target.value as SubtaskRelation
                )
              }
            >
              <option value="parallel">并列</option>
              <option value="sequential">顺序</option>
            </select>
            <button
              className="icon-btn"
              title="编辑"
              onClick={() => {
                setEditingId(subtask.id)
                setEditingText(subtask.title)
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-btn danger"
              title="删除"
              onClick={() => {
                if (window.confirm(`删除子目标「${subtask.title}」？`)) {
                  useAppStore.getState().deleteSubtask(goalId, subtask.id)
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="add-subtask-row">
        <input
          value={draft}
          placeholder="新子目标"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNew()
          }}
        />
        <select value={relation} onChange={(e) => setRelation(e.target.value as SubtaskRelation)}>
          <option value="parallel">并列</option>
          <option value="sequential">顺序</option>
        </select>
        <button className="add-goal-btn" onClick={submitNew}>
          <Plus size={16} />
          添加子目标
        </button>
      </div>
    </div>
  )
}
```

注意：`updateSubtaskRelation` 已在 Task 6 的 store 接口与实现中提供，本任务直接调用即可。

- [ ] **Step 2: 追加目标页样式**

在 `theme.css` 末尾追加：

```css
.goal-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}

.goal-column {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px;
}

.goal-column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 16px;
}

.accent-blue .goal-column-title {
  color: #9ec7ff;
}

.accent-green .goal-column-title {
  color: #9be0a0;
}

.goal-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.goal-card,
.subtask-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

.goal-card.done .goal-title,
.subtask-card.done .goal-title {
  text-decoration: line-through;
  color: var(--text-secondary);
}

.goal-check {
  position: relative;
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex: none;
  cursor: pointer;
}

.goal-check input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkmark {
  width: 20px;
  height: 20px;
  border: 1px solid var(--text-secondary);
  border-radius: 4px;
  background: transparent;
}

.goal-check input:checked + .checkmark {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 3px rgba(255, 255, 255, 0.9);
}

.goal-title {
  flex: 1;
  font-size: 14px;
}

.goal-progress {
  font-size: 12px;
  color: var(--text-secondary);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.icon-btn.danger:hover {
  color: var(--danger);
}

.add-goal-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 14px;
  cursor: pointer;
}

.accent-green .add-goal-btn {
  color: var(--success);
}

.add-goal-row,
.add-subtask-row {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.add-goal-row input,
.add-subtask-row input,
.goal-edit-input,
.relation-select {
  flex: 1;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
}

.relation-select {
  flex: none;
  width: 72px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 7px 12px;
  cursor: pointer;
  margin-bottom: 18px;
}

.subtask-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
}

.subtask-header h1 {
  margin: 0;
  font-size: 22px;
}

.subtask-progress {
  color: var(--text-secondary);
  font-size: 14px;
}

.subtask-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.relation-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  flex: none;
}

.relation-badge.sequential {
  color: #9ec7ff;
  border-color: #315a8f;
}

.relation-badge.parallel {
  color: #9be0a0;
  border-color: #2f6b36;
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/pages/GoalsPage.tsx src/renderer/src/state/appStore.ts src/renderer/src/styles/theme.css
git commit -m "feat: implement goals and subtasks UI"
```

## Task 9: 四象限模块 UI

**Files:**
- Create: `src/renderer/src/components/EventCard.tsx`
- Create: `src/renderer/src/components/ContextMenu.tsx`
- Create: `src/renderer/src/components/EventDetailDialog.tsx`
- Modify: `src/renderer/src/pages/QuadrantPage.tsx`（完整实现）
- Modify: `src/renderer/src/styles/theme.css`（追加四象限样式）

- [ ] **Step 1: 实现 EventCard**

`src/renderer/src/components/EventCard.tsx`：

```tsx
import { useState } from 'react'
import type { QuadrantEvent } from '../../../shared/types'
import { UNIT } from '../lib/quadrantMath'

interface Props {
  event: QuadrantEvent
  overdue: boolean
  onDragStart: (e: React.PointerEvent, event: QuadrantEvent) => void
  onContextMenu: (e: React.MouseEvent, event: QuadrantEvent) => void
  onEdit: (event: QuadrantEvent) => void
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EventCard({
  event,
  overdue,
  onDragStart,
  onContextMenu,
  onEdit
}: Props): JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <div
      className={`event-card q${event.quadrant}${overdue ? ' overdue' : ''}`}
      style={{ left: event.x * UNIT, top: event.y * UNIT, width: event.width * UNIT }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEdit(event)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, event)
      }}
    >
      {hover && (
        <span
          className="event-handle"
          onPointerDown={(e) => {
            e.stopPropagation()
            onDragStart(e, event)
          }}
        />
      )}
      <span className="event-text">{event.text}</span>
      {event.deadline && (
        <span className="event-deadline">截止：{formatDeadline(event.deadline)}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 实现 ContextMenu**

`src/renderer/src/components/ContextMenu.tsx`：

```tsx
import { ClipboardPaste, Copy, Eraser, Info, Save, Scissors, Trash2 } from 'lucide-react'

export interface ContextMenuState {
  x: number
  y: number
  eventId: string
}

interface Props {
  menu: ContextMenuState
  canPaste: boolean
  onAction: (action: MenuAction) => void
  onClose: () => void
}

type MenuAction = 'cut' | 'copy' | 'paste' | 'delete' | 'save' | 'detail'

const ITEMS: { action: MenuAction; label: string; icon: typeof Copy }[] = [
  { action: 'cut', label: '剪切', icon: Scissors },
  { action: 'copy', label: '复制', icon: Copy },
  { action: 'paste', label: '粘贴', icon: ClipboardPaste },
  { action: 'delete', label: '删除', icon: Trash2 },
  { action: 'save', label: '保存', icon: Save },
  { action: 'detail', label: '详细信息', icon: Info }
]

export default function ContextMenu({ menu, canPaste, onAction, onClose }: Props): JSX.Element {
  return (
    <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
      {ITEMS.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
          className="context-item"
          disabled={action === 'paste' && !canPaste}
          onClick={() => {
            onAction(action)
            onClose()
          }}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 实现 EventDetailDialog**

`src/renderer/src/components/EventDetailDialog.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import { QUADRANT_META } from '../lib/quadrantMath'

interface Props {
  event: QuadrantEvent
  onSave: (patch: Partial<QuadrantEvent>) => void
  onClose: () => void
}

export default function EventDetailDialog({ event, onSave, onClose }: Props): JSX.Element {
  const [quadrant, setQuadrant] = useState<Quadrant>(event.quadrant)
  const [remark, setRemark] = useState(event.remark)
  const [deadline, setDeadline] = useState(toLocalInput(event.deadline))
  const [escalateAt, setEscalateAt] = useState(toLocalInput(event.escalateAt))

  useEffect(() => {
    setQuadrant(event.quadrant)
    setRemark(event.remark)
    setDeadline(toLocalInput(event.deadline))
    setEscalateAt(toLocalInput(event.escalateAt))
  }, [event])

  const save = (): void => {
    onSave({
      quadrant,
      remark,
      deadline: fromLocalInput(deadline),
      escalateAt:
        (quadrant === 2 || quadrant === 3) && escalateAt
          ? fromLocalInput(escalateAt)
          : undefined
    })
    onClose()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>事件详细信息</h3>
        <label className="modal-field">
          所属象限
          <select value={quadrant} onChange={(e) => setQuadrant(Number(e.target.value) as Quadrant)}>
            {([1, 2, 3, 4] as Quadrant[]).map((q) => (
              <option key={q} value={q}>
                {QUADRANT_META[q].label}
              </option>
            ))}
          </select>
        </label>
        <label className="modal-field">
          备注
          <textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} />
        </label>
        <label className="modal-field">
          截止时间
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        {(quadrant === 2 || quadrant === 3) && (
          <label className="modal-field">
            转为紧急时间
            <input
              type="datetime-local"
              value={escalateAt}
              onChange={(e) => setEscalateAt(e.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose}>
            取消
          </button>
          <button className="modal-btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}
```

- [ ] **Step 4: 实现 QuadrantPage**

`src/renderer/src/pages/QuadrantPage.tsx`：

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import ContextMenu, { type ContextMenuState } from '../components/ContextMenu'
import EventCard from '../components/EventCard'
import EventDetailDialog from '../components/EventDetailDialog'
import {
  AXIS_GAP_PX,
  QUADRANT_META,
  UNIT,
  clampOrigin,
  quadrantOfWorldPoint,
  screenToWorldX,
  screenToWorldY,
  zoomAt,
  type ViewState
} from '../lib/quadrantMath'
import { useAppStore } from '../state/appStore'

interface EditingState {
  mode: 'create' | 'edit'
  id?: string
  text: string
  quadrant: Quadrant
  x: number
  y: number
}

const RADIUS = 12

export default function QuadrantPage(): JSX.Element {
  const events = useAppStore((s) => s.data.events)
  const addEvent = useAppStore((s) => s.addEvent)
  const updateEvent = useAppStore((s) => s.updateEvent)
  const deleteEvent = useAppStore((s) => s.deleteEvent)
  const moveEvent = useAppStore((s) => s.moveEvent)
  const copyEvent = useAppStore((s) => s.copyEvent)
  const cutEvent = useAppStore((s) => s.cutEvent)
  const pasteEvent = useAppStore((s) => s.pasteEvent)
  const saveNow = useAppStore((s) => s.saveNow)

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panRef = useRef<{ startX: number; startY: number; startView: ViewState } | null>(null)
  const dragRef = useRef<{ id: string } | null>(null)

  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverQuadrant, setHoverQuadrant] = useState<Quadrant | null>(null)
  const [labelVisible, setLabelVisible] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => {
      const rect = el.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
      setView((v) => clampOrigin(v, rect.width, rect.height))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.width > 0 && view.panX === 0 && view.panY === 0) {
      setView({ zoom: 1, panX: size.width / 2, panY: size.height / 2 })
    }
  }, [size, view.panX, view.panY])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setView((v) => {
        const z = v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)
        return clampOrigin(zoomAt(x, y, z, v), rect.width, rect.height)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (!hoverQuadrant) {
      setLabelVisible(false)
      return
    }
    const timer = window.setTimeout(() => setLabelVisible(true), 1000)
    return () => window.clearTimeout(timer)
  }, [hoverQuadrant])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const regions: Record<Quadrant, { x: number; y: number; w: number; h: number; radii: number[] }> = {
      1: { x: view.panX + AXIS_GAP_PX, y: view.panY + AXIS_GAP_PX, w: size.width - view.panX - AXIS_GAP_PX, h: size.height - view.panY - AXIS_GAP_PX, radii: [RADIUS, 0, 0, 0] },
      2: { x: 0, y: view.panY + AXIS_GAP_PX, w: view.panX - AXIS_GAP_PX, h: size.height - view.panY - AXIS_GAP_PX, radii: [0, RADIUS, 0, 0] },
      3: { x: 0, y: 0, w: view.panX - AXIS_GAP_PX, h: view.panY - AXIS_GAP_PX, radii: [0, 0, RADIUS, 0] },
      4: { x: view.panX + AXIS_GAP_PX, y: 0, w: size.width - view.panX - AXIS_GAP_PX, h: view.panY - AXIS_GAP_PX, radii: [0, 0, 0, RADIUS] }
    }

    ;([1, 2, 3, 4] as Quadrant[]).forEach((q) => {
      const r = regions[q]
      if (r.w <= 0 || r.h <= 0) return
      const color = QUADRANT_META[q].color
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, r.radii)
      ctx.fillStyle = color + '2B'
      ctx.fill()
      ctx.strokeStyle = color + 'E6'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })

    ctx.strokeStyle = '#555555'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, view.panY)
    ctx.lineTo(size.width, view.panY)
    ctx.moveTo(view.panX, 0)
    ctx.lineTo(view.panX, size.height)
    ctx.stroke()

    ctx.fillStyle = '#555555'
    ctx.beginPath()
    ctx.moveTo(size.width - 8, view.panY - 4)
    ctx.lineTo(size.width - 8, view.panY + 4)
    ctx.lineTo(size.width - 1, view.panY)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(view.panX - 4, 8)
    ctx.lineTo(view.panX + 4, 8)
    ctx.lineTo(view.panX, 1)
    ctx.closePath()
    ctx.fill()
  }, [view, size])

  useEffect(() => {
    draw()
  }, [draw])

  const clientToViewport = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault()
      viewportRef.current?.setPointerCapture(e.pointerId)
      panRef.current = { startX: e.clientX, startY: e.clientY, startView: view }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (panRef.current) {
      const start = panRef.current
      const dx = e.clientX - start.startX
      const dy = e.clientY - start.startY
      setView(
        clampOrigin(
          { ...start.startView, panX: start.startView.panX + dx, panY: start.startView.panY + dy },
          rect.width,
          rect.height
        )
      )
    }

    if (dragRef.current) {
      const wx = screenToWorldX(x, view)
      const wy = screenToWorldY(y, view)
      moveEvent(dragRef.current.id, wx, wy, view)
    }

    setHoverQuadrant(quadrantOfWorldPoint(screenToWorldX(x, view), screenToWorldY(y, view)))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    panRef.current = null
    dragRef.current = null
    if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as Element
    if (!target.closest('.event-card')) {
      const { x, y } = clientToViewport(e.clientX, e.clientY)
      const wx = screenToWorldX(x, view)
      const wy = screenToWorldY(y, view)
      setEditing({
        mode: 'create',
        text: '',
        quadrant: quadrantOfWorldPoint(wx, wy),
        x: wx,
        y: wy
      })
    }
  }

  const onEventDragStart = (e: React.PointerEvent, event: QuadrantEvent): void => {
    e.preventDefault()
    viewportRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { id: event.id }
  }

  const onEventContextMenu = (e: React.MouseEvent, event: QuadrantEvent): void => {
    setMenu({ x: e.clientX, y: e.clientY, eventId: event.id })
  }

  const onEditEvent = (event: QuadrantEvent): void => {
    setEditing({
      mode: 'edit',
      id: event.id,
      text: event.text,
      quadrant: event.quadrant,
      x: event.x,
      y: event.y
    })
  }

  const commitEditing = (): void => {
    if (!editing) return
    if (editing.mode === 'create') {
      if (editing.text.trim()) addEvent(editing.text, editing.quadrant, editing.x, editing.y, view)
    } else if (editing.id && editing.text.trim()) {
      updateEvent(editing.id, { text: editing.text.trim() }, view)
    }
    setEditing(null)
  }

  const detailEvent = detailId ? events.find((e) => e.id === detailId) : undefined
  const overdue = (e: QuadrantEvent): boolean =>
    !!e.deadline && new Date(e.deadline).getTime() < Date.now()

  return (
    <div className="quadrant-page">
      <header className="page-header quadrant-header">
        <h1>四象限</h1>
        <span className="title-underline" />
        <span className="hint-pill">🖱️ Ctrl+拖拽 平移 / 滚轮 缩放</span>
      </header>
      <div
        ref={viewportRef}
        className="quadrant-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          panRef.current = null
          dragRef.current = null
          setHoverQuadrant(null)
        }}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvasRef} className="quadrant-canvas" />
        <div
          className="event-layer"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              overdue={overdue(e)}
              onDragStart={onEventDragStart}
              onContextMenu={onEventContextMenu}
              onEdit={onEditEvent}
            />
          ))}
          {editing && (
            <textarea
              className="event-input"
              autoFocus
              value={editing.text}
              placeholder="输入事件，回车保存"
              style={{
                left: editing.x * UNIT,
                top: editing.y * UNIT,
                width: Math.max(editing.text.length, 8) * 10
              }}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitEditing()
                }
                if (e.key === 'Escape') setEditing(null)
              }}
              onBlur={() => setEditing(null)}
            />
          )}
        </div>
        {labelVisible && hoverQuadrant && (
          <div className={`quadrant-label q${hoverQuadrant}`}>
            {QUADRANT_META[hoverQuadrant].label}
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          menu={menu}
          canPaste={useAppStore.getState().data.events.length >= 0}
          onAction={(action) => {
            if (action === 'cut') cutEvent(menu.eventId)
            if (action === 'copy') copyEvent(menu.eventId)
            if (action === 'paste') pasteEvent(view)
            if (action === 'delete') {
              if (window.confirm('删除该事件？')) deleteEvent(menu.eventId)
            }
            if (action === 'save') saveNow()
            if (action === 'detail') setDetailId(menu.eventId)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {detailEvent && (
        <EventDetailDialog
          event={detailEvent}
          onSave={(patch) => updateEvent(detailEvent.id, patch, view)}
          onClose={() => setDetailId(null)}
        />
      )}
      <span className="tick-sink">{tick}</span>
    </div>
  )
}
```

说明：`tick` 仅用于每分钟刷新逾期样式；`canPaste` 在本版始终为 true（内部剪贴板存在与否由 store 决定），后续可改为暴露 `hasClipboard()`。

- [ ] **Step 5: 追加四象限样式**

在 `theme.css` 末尾追加：

```css
.quadrant-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 28px 32px;
  min-height: 0;
}

.quadrant-header {
  margin-bottom: 16px;
}

.hint-pill {
  margin-left: auto;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.quadrant-viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: #0c0e12;
  cursor: default;
  touch-action: none;
}

.quadrant-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.event-layer {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

.event-card {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px 6px 14px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.4);
  font-size: 13px;
  line-height: 1.35;
  cursor: default;
  min-height: 32px;
}

.event-card.q1 {
  border: 1px solid #ff8c00;
  color: #ffd9ad;
}

.event-card.q2 {
  border: 1px solid #ffa500;
  color: #ffe2ad;
}

.event-card.q3 {
  border: 1px solid #008b8b;
  color: #a9e2e2;
}

.event-card.q4 {
  border: 1px solid #483d8b;
  color: #c7c0ea;
}

.event-card.overdue {
  border-color: var(--danger);
  box-shadow: 0 0 8px rgba(229, 72, 77, 0.4);
}

.event-handle {
  position: absolute;
  left: 5px;
  top: 50%;
  width: 8px;
  height: 8px;
  transform: translateY(-50%);
  border: 1.5px solid currentColor;
  border-radius: 50%;
  cursor: grab;
}

.event-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.event-deadline {
  font-size: 11px;
  opacity: 0.75;
}

.event-input {
  position: absolute;
  background: #000000cc;
  color: var(--text);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 13px;
  resize: none;
  outline: none;
  min-height: 32px;
}

.quadrant-label {
  position: absolute;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.55);
  animation: label-in 0.2s ease-out;
  pointer-events: none;
}

.quadrant-label.q1 {
  top: 16px;
  right: 16px;
  color: #ff8c00;
  border: 1px solid #ff8c00;
}

.quadrant-label.q2 {
  top: 16px;
  left: 16px;
  color: #ffa500;
  border: 1px solid #ffa500;
}

.quadrant-label.q3 {
  bottom: 16px;
  left: 16px;
  color: #008b8b;
  border: 1px solid #008b8b;
}

.quadrant-label.q4 {
  bottom: 16px;
  right: 16px;
  color: #483d8b;
  border: 1px solid #483d8b;
}

@keyframes label-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.context-menu {
  position: fixed;
  z-index: 50;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  min-width: 140px;
}

.context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.context-item:hover:not(:disabled) {
  background: rgba(77, 163, 255, 0.15);
}

.context-item:disabled {
  opacity: 0.4;
  cursor: default;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  width: 420px;
  max-width: calc(100vw - 48px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}

.modal h3 {
  margin: 0 0 16px;
}

.modal-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.modal-field select,
.modal-field input,
.modal-field textarea {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 8px 10px;
  font-size: 14px;
  outline: none;
  resize: vertical;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.modal-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  cursor: pointer;
}

.modal-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0b1020;
  font-weight: 600;
}

.tick-sink {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
```

- [ ] **Step 6: 类型检查与构建**

Run: `npm run typecheck && npm run build`

Expected: 退出码 0。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/components src/renderer/src/pages/QuadrantPage.tsx src/renderer/src/styles/theme.css
git commit -m "feat: implement quadrant canvas interactions"
```

## Task 10: MCP 预留与 README

**Files:**
- Create: `src/main/mcp/index.ts`
- Create: `README.md`

- [ ] **Step 1: 实现 MCP 工具清单骨架**

`src/main/mcp/index.ts`：

```ts
import type { AppData } from '../../shared/types'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_goals',
    description: '列出全部目标',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_goal',
    description: '获取单个目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'create_goal',
    description: '创建目标',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { enum: ['long', 'short'] }
      },
      required: ['title', 'type']
    }
  },
  {
    name: 'update_goal',
    description: '修改目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'toggle_goal',
    description: '勾选/取消勾选目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'delete_goal',
    description: '删除目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'list_events',
    description: '列出全部象限事件',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_event',
    description: '创建象限事件',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        quadrant: { enum: [1, 2, 3, 4] },
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['text', 'quadrant']
    }
  },
  {
    name: 'update_event',
    description: '修改象限事件',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'delete_event',
    description: '删除象限事件',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'list_subtasks',
    description: '列出长期目标的子目标',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' } }, required: ['goalId'] }
  },
  {
    name: 'add_subtask',
    description: '添加子目标',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        title: { type: 'string' },
        relation: { enum: ['sequential', 'parallel'] }
      },
      required: ['goalId', 'title', 'relation']
    }
  },
  {
    name: 'toggle_subtask',
    description: '勾选/取消勾选子目标',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' }, subtaskId: { type: 'string' } }, required: ['goalId', 'subtaskId'] }
  }
]

/**
 * MCP stdio 服务入口（后期实现）。
 * 当前仅注册工具清单；不随主程序启动。
 */
export function startMcpServer(_data: AppData): void {
  // 后期：在此启动 stdio JSON-RPC 服务，工具实现复用 dataStore.ts
  throw new Error('MCP server is reserved for a later milestone')
}
```

- [ ] **Step 2: 写 README**

`README.md`：

```markdown
# 象限

面向大学生的时间管理桌面软件（Electron + React + TypeScript）。

## 功能

- 目标：长期/短期目标、子目标顺序/并列关系
- 四象限：可平移缩放的事件坐标系、事件管理
- 周计划 / 周日复盘：占位（开发中）

## 开发

```bash
npm install
npm run dev
```

## 测试

```bash
npm test
```

## 打包

```bash
npm run package
```

产物在 `dist/` 下，为便携单文件 exe。

## 数据

数据保存在 `%APPDATA%/象限/plan.json`，写入前自动备份为 `plan.backup.json`。

## MCP（预留）

后期将提供 MCP stdio 服务，使外部 Agent 可协作读写计划数据；工具清单见 `src/main/mcp/index.ts`，当前不随主程序启动。
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`

Expected: 退出码 0。

- [ ] **Step 4: 提交**

```bash
git add src/main/mcp/index.ts README.md
git commit -m "feat: reserve mcp interface and add readme"
```

## Task 11: 打包 exe 与最终验收

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: 写 electron-builder 配置**

`electron-builder.yml`：

```yaml
appId: com.quadrant.app
productName: 象限
directories:
  output: dist
files:
  - out/**
  - package.json
win:
  target:
    - target: portable
      arch:
        - x64
portable:
  artifactName: 象限-${version}.exe
```

- [ ] **Step 2: 全量测试**

Run: `npm test`

Expected: 全部测试 PASS。

- [ ] **Step 3: 类型检查与构建**

Run: `npm run typecheck && npm run build`

Expected: 退出码 0。

- [ ] **Step 4: 打包**

Run: `npm run package`

Expected: 在 `dist/` 下生成 `象限-0.1.0.exe`。

- [ ] **Step 5: UI 验收（frontend-testing-debugging）**

Run: `npm run dev`（需提权打开窗口），按设计文档第 10 节清单逐项验证：

- 暗色主题、侧边栏高亮、标语卡；
- 目标增删改勾选、长期目标展开/返回、顺序子目标勾选拦截、进度显示；
- 四象限滚轮缩放（以鼠标为中心）、Ctrl 拖拽平移、原点 10px 钳制；
- 双击生成事件、回车保存、Esc 取消；
- 悬停显示空心小圆点、拖动换象限、事件不跨轴；
- 右键菜单剪切/复制/粘贴/删除/保存/详细信息；
- 详细信息修改象限、备注、截止时间、Q2/Q3 紧急升级（等 60 秒周期或重启触发）；
- 周计划/周日复盘占位页。

- [ ] **Step 6: 提交**

```bash
git add electron-builder.yml
git commit -m "build: package portable exe"
```

## Self-Review

对照设计文档逐项核查：

1. 目标模块：两栏、增删改勾选、长期目标详情页、顺序/并列子目标、进度、子目标不进短期栏 —— Task 4 + Task 8 覆盖。
2. 四象限：平移/缩放、原点钳制、色块延伸 + 圆角、悬停 1 秒标签（无方位词）、双击生成、宽度上限、悬停圆点拖动、跨象限切换、右键菜单、详细信息、紧急升级 —— Task 5 + Task 9 覆盖。
3. 持久化：JSON + 原子写 + 备份 —— Task 3 覆盖。
4. MCP 预留：数据层独立、工具清单、不随主程序启动 —— Task 3 + Task 10 覆盖。
5. 周计划/周日复盘占位 —— Task 7 覆盖。
6. 打包 exe —— Task 11 覆盖。

类型一致性：`ViewState`、`QuadrantEvent`、`Goal`、`Subtask` 等类型在 shared/types 定义，Task 4~9 全部引用同一来源；store 方法与组件调用签名一致。
