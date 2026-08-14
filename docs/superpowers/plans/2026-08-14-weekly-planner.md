# 周计划表模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"璞石界限"周计划占位页替换为完整模块：周视图总览（自适应、只读）+ 单日时间轴视图（滚动、拖拽吸附、全局事件预设、增删改）。

**Architecture:** 沿用现有 Electron + React + Zustand 架构。纯逻辑放 `weekRules.ts`（周数/时间/吸附/CRUD 纯函数，Vitest 测试），状态经 appStore 的 saveSoon 持久化；UI 用 DOM + CSS 实现（与 QuadrantPage 一致，不引入新依赖）。数据模型升到 AppData v2，dataCodec 兼容 v1 自动迁移。

**Tech Stack:** Electron 31、electron-vite、React 18、TypeScript、Zustand、lucide-react、Vitest、playwright-core（截图验收）。

---

## File Structure

- Modify: `src/shared/types.ts`（新增周计划类型，version 升 2）
- Modify: `src/shared/defaults.ts`（v2 默认值）
- Modify: `src/main/dataCodec.ts`（v1→v2 迁移与字段规整）
- Modify: `src/main/dataStore.ts`（fallback 使用 defaultData）
- Modify: `tests/dataCodec.test.ts`（迁移用例）
- Create: `src/renderer/src/lib/weekRules.ts`（周数/时间/吸附/CRUD 纯函数）
- Create: `tests/weekRules.test.ts`
- Modify: `src/renderer/src/state/appStore.ts`（周计划 actions）
- Modify: `src/renderer/src/App.tsx`（weekly 路由到 WeeklyPage）
- Create: `src/renderer/src/pages/WeeklyPage.tsx`（周视图/单日视图切换与周导航状态）
- Create: `src/renderer/src/components/weekly/WeekOverview.tsx`
- Create: `src/renderer/src/components/weekly/DayView.tsx`
- Create: `src/renderer/src/components/weekly/PresetPanel.tsx`
- Create: `src/renderer/src/components/weekly/EventBlock.tsx`
- Create: `src/renderer/src/components/weekly/EventFormDialog.tsx`
- Modify: `src/renderer/src/styles/theme.css`（周计划样式）
- Create: `docs/qa-weekly.mjs`（Playwright 截图验收脚本）

## Task 1: 共享类型与默认值

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/defaults.ts`

- [ ] **Step 1: 在 types.ts 追加类型**

在文件末尾追加（保持现有 Goal/QuadrantEvent 不动）：

```ts
export const WEEK_COLORS = [
  '#8AB4F8',
  '#8CD9C1',
  '#F8B18C',
  '#B4A7E6',
  '#E8A0A0',
  '#DBC8A8',
  '#A9C49C',
  '#C2C8D0'
] as const

export interface WeekPreset {
  id: string
  title: string
  color: string
  quadrant: Quadrant
  durationMin: number
  remark: string
  createdAt: string
}

export interface WeekEvent {
  id: string
  date: string
  title: string
  color: string
  quadrant: Quadrant
  startMin: number
  endMin: number
  remark: string
  presetId?: string
  createdAt: string
}

export interface AppData {
  version: 2
  goals: Goal[]
  events: QuadrantEvent[]
  weekPresets: WeekPreset[]
  weekEvents: WeekEvent[]
  weekCounterOffset: number
}
```

注意：原 `version: 1` 的 AppData 定义改为上面这份（version 改为 2 并增加三个字段）。

- [ ] **Step 2: 更新 defaults.ts**

```ts
import type { AppData } from './types'

export function defaultData(): AppData {
  return {
    version: 2,
    goals: [],
    events: [],
    weekPresets: [],
    weekEvents: [],
    weekCounterOffset: 0
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/shared/types.ts src/shared/defaults.ts
git commit -m "feat: add weekly planner shared types and defaults"
```

## Task 2: dataCodec 迁移（TDD）

**Files:**
- Modify: `tests/dataCodec.test.ts`
- Modify: `src/main/dataCodec.ts`
- Modify: `src/main/dataStore.ts`

- [ ] **Step 1: 重写测试（先失败）**

```ts
import { describe, expect, it } from 'vitest'
import { parseData, serializeData } from '../src/main/dataCodec'
import { defaultData } from '../src/shared/defaults'

describe('dataCodec', () => {
  it('round-trips default data', () => {
    const data = defaultData()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('migrates version 1 payload to version 2 with empty week fields', () => {
    const v1 = JSON.stringify({ version: 1, goals: [], events: [] })
    expect(parseData(v1)).toEqual(defaultData())
  })

  it('normalizes weekly preset fields', () => {
    const data = defaultData()
    data.weekPresets = [
      {
        id: 'p1',
        title: '健身',
        color: '#123456',
        quadrant: 9 as never,
        durationMin: 88,
        remark: '',
        createdAt: 'x'
      }
    ]
    const parsed = parseData(serializeData(data))
    expect(parsed.weekPresets[0].color).toBe('#8AB4F8')
    expect(parsed.weekPresets[0].quadrant).toBe(1)
    expect(parsed.weekPresets[0].durationMin).toBe(90)
  })

  it('normalizes weekly event times', () => {
    const data = defaultData()
    data.weekEvents = [
      {
        id: 'e1',
        date: '2026-08-14',
        title: '考核',
        color: '#8CD9C1',
        quadrant: 2,
        startMin: 1500,
        endMin: 400,
        remark: '',
        createdAt: 'x'
      }
    ]
    const parsed = parseData(serializeData(data))
    expect(parsed.weekEvents[0].startMin).toBe(420)
    expect(parsed.weekEvents[0].endMin).toBe(480)
  })

  it('rejects invalid payload', () => {
    expect(() => parseData('{"version":3}')).toThrow()
    expect(() => parseData('not json')).toThrow()
    expect(() => parseData('{"version":2}')).toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/dataCodec.test.ts`
Expected: FAIL（类型不匹配/迁移未实现）。

- [ ] **Step 3: 实现 dataCodec**

保留 normalizeGoal/normalizeEvent/normalizeSubtask，改动 parseData 并新增规整函数：

```ts
import { WEEK_COLORS, type AppData, type Goal, type Quadrant, type QuadrantEvent, type Subtask, type WeekEvent, type WeekPreset } from '../shared/types'

export function serializeData(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function parseData(raw: string): AppData {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new Error('invalid data file')
  }
  const goals = Array.isArray(parsed.goals)
    ? (parsed.goals as unknown[]).map((g) => normalizeGoal(g as Record<string, unknown>))
    : []
  const events = Array.isArray(parsed.events)
    ? (parsed.events as unknown[]).map((e) => normalizeEvent(e as Record<string, unknown>))
    : []
  const presets = Array.isArray(parsed.weekPresets)
    ? (parsed.weekPresets as unknown[]).map((p) => normalizeWeekPreset(p as Record<string, unknown>))
    : []
  const weekEvents = Array.isArray(parsed.weekEvents)
    ? (parsed.weekEvents as unknown[]).map((e) => normalizeWeekEvent(e as Record<string, unknown>))
    : []
  return {
    version: 2,
    goals,
    events,
    weekPresets: presets,
    weekEvents,
    weekCounterOffset: typeof parsed.weekCounterOffset === 'number' ? parsed.weekCounterOffset : 0
  }
}

function isQuadrant(v: unknown): v is Quadrant {
  return v === 1 || v === 2 || v === 3 || v === 4
}

function normalizeDuration(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v / 5) * 5 : 60
  return Math.min(600, Math.max(5, n))
}

function normalizeWeekPreset(raw: Record<string, unknown>): WeekPreset {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    color: typeof raw.color === 'string' && (WEEK_COLORS as readonly string[]).includes(raw.color)
      ? raw.color
      : WEEK_COLORS[0],
    quadrant: isQuadrant(raw.quadrant) ? raw.quadrant : 1,
    durationMin: normalizeDuration(raw.durationMin),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function todayKey(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function normalizeWeekEvent(raw: Record<string, unknown>): WeekEvent {
  let start = typeof raw.startMin === 'number' ? Math.round(raw.startMin / 5) * 5 : 420
  let end = typeof raw.endMin === 'number' ? Math.round(raw.endMin / 5) * 5 : 480
  if (!(start >= 0 && start < 1440)) start = 420
  if (!(end > start)) end = start + 60
  if (end > 1440) end = 1440
  if (end - start > 600) end = start + 600
  return {
    id: String(raw.id ?? ''),
    date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : todayKey(),
    title: String(raw.title ?? ''),
    color: typeof raw.color === 'string' && (WEEK_COLORS as readonly string[]).includes(raw.color)
      ? raw.color
      : WEEK_COLORS[0],
    quadrant: isQuadrant(raw.quadrant) ? raw.quadrant : 1,
    startMin: start,
    endMin: end,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    presetId: typeof raw.presetId === 'string' ? raw.presetId : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}
```

注意：原 parseData 中"缺 goals/events 即 throw"改为缺省空数组（仅 version 与 JSON 合法性校验失败才 throw）。

- [ ] **Step 4: dataStore fallback 用 defaultData**

`loadData` 的两处 `return { version: 1, goals: [], events: [] }` 改为 `return defaultData()`（顶部导入）。

- [ ] **Step 5: 测试通过后提交**

Run: `npx vitest run tests/dataCodec.test.ts`
Expected: PASS。

```bash
git add tests/dataCodec.test.ts src/main/dataCodec.ts src/main/dataStore.ts
git commit -m "feat: migrate app data to v2 with weekly planner fields"
```

## Task 3: weekRules 纯函数（TDD）

**Files:**
- Create: `tests/weekRules.test.ts`
- Create: `src/renderer/src/lib/weekRules.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import type { WeekEvent, WeekPreset } from '../src/shared/types'
import {
  clampEventStart,
  clampEventTimes,
  createPreset,
  createWeekEvent,
  dateKey,
  deletePresetFromList,
  eventsOnDate,
  formatDateRange,
  formatDuration,
  minutesToLabel,
  mondayOf,
  moveWeekEventInList,
  snapToHour,
  streakNumber,
  updatePresetInList,
  updateWeekEventInList,
  weekDays,
  weekIndexFromAnchor
} from '../src/renderer/src/lib/weekRules'

function preset(over: Partial<WeekPreset> = {}): WeekPreset {
  return {
    id: 'p1',
    title: '健身',
    color: '#8CD9C1',
    quadrant: 2,
    durationMin: 90,
    remark: '',
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over
  }
}

function event(over: Partial<WeekEvent> = {}): WeekEvent {
  return {
    id: 'e1',
    date: '2026-08-14',
    title: '考核',
    color: '#8AB4F8',
    quadrant: 1,
    startMin: 480,
    endMin: 570,
    remark: '',
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over
  }
}

describe('weekRules', () => {
  it('computes monday of a date and the seven day keys', () => {
    expect(dateKey(mondayOf(new Date(2026, 7, 14)))).toBe('2026-08-10')
    expect(weekDays(mondayOf(new Date(2026, 7, 14))).map(dateKey)).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
      '2026-08-14', '2026-08-15', '2026-08-16'
    ])
  })

  it('counts weeks since anchor with manual offset, floored at 1', () => {
    const anchor = mondayOf(new Date(2026, 7, 10))
    expect(weekIndexFromAnchor(anchor)).toBe(0)
    expect(streakNumber(anchor, 0)).toBe(1)
    const next = mondayOf(new Date(2026, 7, 17))
    expect(weekIndexFromAnchor(next)).toBe(1)
    expect(streakNumber(next, 2)).toBe(4)
    expect(streakNumber(mondayOf(new Date(2026, 6, 27)), -5)).toBe(1)
  })

  it('snaps minutes to the nearest hour', () => {
    expect(snapToHour(449)).toBe(420)
    expect(snapToHour(450)).toBe(480)
    expect(snapToHour(1410)).toBe(1440)
  })

  it('clamps event start inside day and keeps whole-hour end fit', () => {
    expect(clampEventStart(400, 60)).toBe(420)
    expect(clampEventStart(1380, 90)).toBe(1320)
    expect(clampEventStart(830, 600)).toBe(840)
  })

  it('clamps arbitrary start/end for direct events', () => {
    expect(clampEventTimes(600, 660)).toEqual({ startMin: 600, endMin: 660 })
    expect(clampEventTimes(1320, 1440)).toEqual({ startMin: 1320, endMin: 1440 })
    expect(clampEventTimes(600, 1380)).toEqual({ startMin: 600, endMin: 1200 })
    expect(clampEventTimes(1000, 900)).toEqual({ startMin: 1000, endMin: 1005 })
  })

  it('creates a preset and a copied day event from it', () => {
    const p = createPreset('健身', '#8CD9C1', 2, 90, '')
    expect(p.durationMin).toBe(90)
    expect(p.id).not.toBe('')
    const e = createWeekEvent('2026-08-14', p, 455)
    expect(e.startMin).toBe(480)
    expect(e.endMin).toBe(570)
    expect(e.title).toBe('健身')
    expect(e.presetId).toBe(p.id)
    expect(e.id).not.toBe(p.id)
  })

  it('updates and deletes presets', () => {
    const list = [preset()]
    expect(updatePresetInList(list, 'p1', { durationMin: 205 })[0].durationMin).toBe(205)
    expect(updatePresetInList(list, 'p1', { durationMin: 999 })[0].durationMin).toBe(600)
    expect(deletePresetFromList(list, 'p1')).toHaveLength(0)
  })

  it('moves an event, snapping start and preserving duration', () => {
    const list = [event()]
    const moved = moveWeekEventInList(list, 'e1', 955)[0]
    expect(moved.startMin).toBe(960)
    expect(moved.endMin).toBe(1050)
    expect(moveWeekEventInList(list, 'e1', 1380)[0].startMin).toBe(1320)
    expect(moveWeekEventInList(list, 'e1', 1380)[1]).toBeUndefined()
  })

  it('updates an event and re-clamps its times', () => {
    const updated = updateWeekEventInList([event()], 'e1', { startMin: 1000 })[0]
    expect(updated.startMin).toBe(1000)
    expect(updated.endMin).toBe(1090)
    expect(updateWeekEventInList([event()], 'e1', { endMin: 100 })[0].endMin).toBe(485)
  })

  it('formats labels', () => {
    expect(minutesToLabel(420)).toBe('7:00')
    expect(minutesToLabel(555)).toBe('9:15')
    expect(minutesToLabel(1440)).toBe('24:00')
    expect(formatDuration(30)).toBe('30分钟')
    expect(formatDuration(60)).toBe('1小时')
    expect(formatDuration(90)).toBe('1.5小时')
    expect(formatDuration(85)).toBe('1小时25分钟')
    expect(formatDuration(600)).toBe('10小时')
    expect(formatDateRange(mondayOf(new Date(2026, 7, 14)))).toBe('8月10日-8月16日')
  })

  it('filters and sorts events of a date', () => {
    const a = event({ id: 'a', startMin: 900 })
    const b = event({ id: 'b', startMin: 480, date: '2026-08-15' })
    const c = event({ id: 'c', startMin: 600 })
    expect(eventsOnDate([a, b, c], '2026-08-14').map((e) => e.id)).toEqual(['c', 'a'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/weekRules.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 weekRules.ts**

```ts
import { WEEK_COLORS, type Quadrant, type WeekEvent, type WeekPreset } from '../../../shared/types'

export const DAY_START_MIN = 7 * 60
export const DAY_END_MIN = 24 * 60
export const MIN_DURATION_MIN = 5
export const MAX_DURATION_MIN = 10 * 60
export const DAY_HOUR_PX = 48

export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const MS_PER_DAY = 86_400_000
const ANCHOR_UTC_DAY = Date.UTC(2026, 7, 10) / MS_PER_DAY

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

export function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export function weekdayName(d: Date): string {
  return WEEKDAY_NAMES[(d.getDay() + 6) % 7]
}

export function formatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function formatDateRange(monday: Date): string {
  return `${formatMonthDay(monday)}-${formatMonthDay(addDays(monday, 6))}`
}

export function formatDayTitle(d: Date): string {
  return `${weekdayName(d)} · ${formatMonthDay(d)}`
}

export function weekIndexFromAnchor(monday: Date): number {
  const utcDay = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) / MS_PER_DAY
  return (utcDay - ANCHOR_UTC_DAY) / 7
}

export function streakNumber(monday: Date, offset: number): number {
  return Math.max(1, weekIndexFromAnchor(monday) + 1 + offset)
}

export function minutesToLabel(min: number): string {
  return `${Math.floor(min / 60)}:${pad2(min % 60)}`
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min}分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (m === 0) return `${h}小时`
  if (m === 30) return `${h}.5小时`
  return `${h}小时${m}分钟`
}

export function snapToHour(min: number): number {
  return Math.round(min / 60) * 60
}

export function normalizeDuration(min: number): number {
  const rounded = Math.round(min / 5) * 5
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, rounded))
}

export function clampEventStart(startMin: number, durationMin: number): number {
  const duration = normalizeDuration(durationMin)
  const hi = Math.floor((DAY_END_MIN - duration) / 60) * 60
  return Math.min(Math.max(snapToHour(startMin), DAY_START_MIN), hi)
}

export function clampEventTimes(startMin: number, endMin: number): { startMin: number; endMin: number } {
  let start = Math.round(Math.min(Math.max(startMin, DAY_START_MIN), DAY_END_MIN - 5) / 5) * 5
  let end = Math.round(Math.min(Math.max(endMin, start + 5), DAY_END_MIN) / 5) * 5
  if (end - start > MAX_DURATION_MIN) end = start + MAX_DURATION_MIN
  return { startMin: start, endMin: end }
}

export function eventTopPx(startMin: number, hourPx: number): number {
  return ((startMin - DAY_START_MIN) / 60) * hourPx
}

export function eventHeightPx(startMin: number, endMin: number, hourPx: number): number {
  return Math.max(4, ((endMin - startMin) / 60) * hourPx - 2)
}

export function minuteFromOffsetY(y: number, hourPx: number): number {
  return (y / hourPx) * 60
}

function colorOf(value: string): string {
  return (WEEK_COLORS as readonly string[]).includes(value) ? value : WEEK_COLORS[0]
}

export function createPreset(
  title: string,
  color: string,
  quadrant: Quadrant,
  durationMin: number,
  remark: string
): WeekPreset {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    color: colorOf(color),
    quadrant,
    durationMin: normalizeDuration(durationMin),
    remark,
    createdAt: new Date().toISOString()
  }
}

export function updatePresetInList(
  list: WeekPreset[],
  id: string,
  patch: Partial<WeekPreset>
): WeekPreset[] {
  return list.map((p) => {
    if (p.id !== id) return p
    const next = { ...p, ...patch }
    next.color = colorOf(next.color)
    if (typeof patch.durationMin === 'number') next.durationMin = normalizeDuration(patch.durationMin)
    return next
  })
}

export function deletePresetFromList(list: WeekPreset[], id: string): WeekPreset[] {
  return list.filter((p) => p.id !== id)
}

export function createWeekEvent(date: string, preset: WeekPreset, startMin: number): WeekEvent {
  const start = clampEventStart(startMin, preset.durationMin)
  return {
    id: crypto.randomUUID(),
    date,
    title: preset.title,
    color: preset.color,
    quadrant: preset.quadrant,
    startMin: start,
    endMin: start + preset.durationMin,
    remark: preset.remark,
    presetId: preset.id,
    createdAt: new Date().toISOString()
  }
}

export function updateWeekEventInList(
  list: WeekEvent[],
  id: string,
  patch: Partial<WeekEvent>
): WeekEvent[] {
  return list.map((e) => {
    if (e.id !== id) return e
    const next = { ...e, ...patch }
    next.color = colorOf(next.color)
    if (patch.startMin !== undefined && patch.endMin === undefined) {
      const duration = next.endMin - next.startMin
      const start = Math.round(
        Math.min(Math.max(patch.startMin, DAY_START_MIN), DAY_END_MIN - duration) / 5
      ) * 5
      next.startMin = start
      next.endMin = start + duration
    } else if (patch.startMin !== undefined || patch.endMin !== undefined) {
      const times = clampEventTimes(next.startMin, next.endMin)
      next.startMin = times.startMin
      next.endMin = times.endMin
    }
    return next
  })
}

export function deleteWeekEventFromList(list: WeekEvent[], id: string): WeekEvent[] {
  return list.filter((e) => e.id !== id)
}

export function moveWeekEventInList(
  list: WeekEvent[],
  id: string,
  newStartMin: number
): WeekEvent[] {
  return list.map((e) => {
    if (e.id !== id) return e
    const duration = e.endMin - e.startMin
    const start = clampEventStart(newStartMin, duration)
    return { ...e, startMin: start, endMin: start + duration }
  })
}

export function eventsOnDate(list: WeekEvent[], date: string): WeekEvent[] {
  return list
    .filter((e) => e.date === date)
    .sort((a, b) => a.startMin - b.startMin || a.createdAt.localeCompare(b.createdAt))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/weekRules.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tests/weekRules.test.ts src/renderer/src/lib/weekRules.ts
git commit -m "feat: add weekly planner rules and tests"
```

## Task 4: appStore 周计划 actions

**Files:**
- Modify: `src/renderer/src/state/appStore.ts`

- [ ] **Step 1: 追加 actions**

在 AppState 接口追加并实现（沿用 saveSoon 模式）：

```ts
addPreset: (fields: { title: string; color: string; quadrant: Quadrant; durationMin: number; remark: string }) => void
updatePreset: (id: string, patch: Partial<WeekPreset>) => void
deletePreset: (id: string) => void
addWeekEvent: (fields: { date: string; title: string; color: string; quadrant: Quadrant; startMin: number; endMin: number; remark: string; presetId?: string }) => void
updateWeekEvent: (id: string, patch: Partial<WeekEvent>) => void
deleteWeekEvent: (id: string) => void
moveWeekEvent: (id: string, startMin: number) => void
setWeekCounterOffset: (offset: number) => void
```

实现要点：

- `addPreset`：`weekRules.createPreset(...)` 追加到 weekPresets。
- `addWeekEvent`：用 `weekRules.clampEventTimes` 规整 start/end，`id: crypto.randomUUID()`、`createdAt: new Date().toISOString()`。
- `moveWeekEvent`：`weekRules.moveWeekEventInList`。
- 其余直接用对应 weekRules 纯函数；每次变更 `saveSoon(data)` 后 `set({ data })`。

- [ ] **Step 2: 类型检查后提交**

Run: `npm run typecheck`
Expected: 退出码 0。

```bash
git add src/renderer/src/state/appStore.ts
git commit -m "feat: add weekly planner store actions"
```

## Task 5: WeeklyPage 与周视图

**Files:**
- Create: `src/renderer/src/pages/WeeklyPage.tsx`
- Create: `src/renderer/src/components/weekly/WeekOverview.tsx`

**WeeklyPage.tsx**

- 本地状态：`view: { kind: 'week'; monday: Date } | { kind: 'day'; date: string }`。
- 初始：`{ kind: 'week', monday: mondayOf(new Date()) }`。
- 周视图渲染 `<WeekOverview monday onOpenDay={(dateKey) => setView({kind:'day',date:dateKey})} onShift={(n) => ...} />`。
- 日视图渲染 `<DayView date={parseDateKey(view.date)} onBack={() => setView({kind:'week', monday: mondayOf(parseDateKey(view.date))})} onShiftDay={(n) => setView({kind:'day', date: dateKey(addDays(parseDateKey(view.date), n))})} />`。

**WeekOverview.tsx**

- 结构：`.weekly-page` > `.weekly-header`（h1 周计划 + `.week-nav` ‹ › + `.streak` 坚持第 n 周）+ `.week-board`。
- streak：`.streak-value` 按钮显示 n，点击换成 `.streak-input`（type=number min=1），Enter/失焦时 `setWeekCounterOffset(n - (weekIndexFromAnchor(monday)+1))`。
- 尺寸：对 `.week-board` 用 ResizeObserver 取可用高度，`hourPx = clamp((boardH - 表头高44) / 17, 28, 64)`；`.week-cols` 高度 = 17*hourPx，小于可用高度时内部纵向滚动。
- 表头行高 44px，`.week-time-gutter` 宽 52px，7 列 `grid-template-columns: 52px repeat(7, 1fr)`。
- 时间刻度：17 个 `.week-hour-label`（7:00…24:00，右对齐），每行 height=hourPx；`.week-col-body` 用 `repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0 1px, transparent 1px ${hourPx}px)` 画横线。
- 事件块：`eventsOnDate(weekEvents, dateKey(day))`，绝对定位 `top=eventTopPx(startMin,hourPx)`、`height=eventHeightPx(startMin,endMin,hourPx)`；`pointer-events:none`；高度 < 18px 时不显示文字。
- 表头按钮 `.week-col-head`：第一行星期名 + 第二行日期（`M/D`），点击 `onOpenDay(dateKey(day))`。

## Task 6: 单日视图与时间轴交互

**Files:**
- Create: `src/renderer/src/components/weekly/DayView.tsx`
- Create: `src/renderer/src/components/weekly/EventBlock.tsx`

**EventBlock.tsx**

- Props：`event: WeekEvent; hourPx: number; onDragStart(pointerEvent, event): void; onContextMenu(mouseEvent, event): void; dragging?: boolean`。
- 绝对定位（由 DayView 传入 top/height style），类名 `.day-event`；填充色 18% 透明、边框 55% 同色、左侧 3px 色条。
- 内部：`.day-event-title`（标题）、`.day-event-meta`（时间范围 `9:00-10:30` + 四象限小圆点 `.quad-dot` + 类型文字）。
- `onPointerDown` 触发 `onDragStart`；`onContextMenu` 阻止默认并上报。

**DayView.tsx**

- 状态：`dialog`（见 Task 7）、`menu: {x,y,eventId} | null`、`drag: {id, top} | null`、`deletePendingId`、`tick`（每分钟刷新当前时间线）。
- 结构：`.day-page` > `.day-topbar`（返回、上一日/下一日、`.day-title`、`.day-add-btn`）+ `.day-body`。
- `.day-body`：左侧 `.day-scroll`（overflow-y:auto，内含 `.day-gutter` 52px + `.day-canvas` position:relative，高度 17*48=816px）；右侧 `<PresetPanel onDropPreset={(preset, startMin) => addWeekEvent(...)} />`。
- `.day-gutter`：17 个整点标签；`.day-canvas` 网格线用 repeating-linear-gradient(1px per 48px)。
- 当前时间线 `.now-line`：nowMin ∈ [420,1440) 时渲染，top=(nowMin-420)/60*48，红色 #E5484D + 左端小圆点。
- 双击空白处：`startMin = snapToHour(minuteFromOffsetY(e.clientY - rect.top + scrollTop, 48))`，clamp 后打开 event-create 对话框。
- 拖动事件：pointerdown 记录 `drag = {id, grabOffsetPx}`；pointermove 时 `top = clamp(初始top + dy, 0, 816 - blockHeight)`；pointerup 时 `moveWeekEvent(id, snapToHour(minuteFromOffsetY(top, 48)))` 并清空 drag。pointer capture 设到 `.day-canvas`。
- 右键事件：`menu={x:e.clientX,y:e.clientY,eventId}`；`.day-menu` 两项：修改信息（打开 event-edit 对话框）、删除（ConfirmDialog）。
- 预设拖入：`.day-canvas` 的 `onDragOver={e=>e.preventDefault()}`、`onDrop`：读 `e.dataTransfer.getData('application/x-preset-id')`，`dropMin = minuteFromOffsetY(e.clientY - rect.top + scrollTop, 48)`，`addWeekEvent({date, ...preset字段, startMin: clampEventStart(dropMin, preset.durationMin), endMin: start+duration})`。仅复制，预设不动。
- 事件块不可拖回右侧（预设面板不接收 day-event 的 drag；day-event 不设置 draggable）。

## Task 7: 事件预设面板

**Files:**
- Create: `src/renderer/src/components/weekly/PresetPanel.tsx`

- 标题行：`事件预设` + `.preset-add-btn`（＋ 新建预设，打开 preset-create 对话框，由 DayView 管理 dialog 状态或面板自身管理）。
- 卡片 `.preset-card`：`draggable`，`onDragStart` 里 `e.dataTransfer.setData('application/x-preset-id', preset.id)`、`e.dataTransfer.effectAllowed='copy'`。
- 卡片内容：填充色 = 颜色 12% 透明 + 45% 同色边框；`.preset-title`、`.preset-meta`（四象限圆点 + 类型）、`.preset-duration`（`formatDuration(durationMin)`）；高度 `clamp(56, 56 + durationMin/60*24, 260)`。
- hover 显示 `.preset-actions` 两个 icon-btn：编辑（打开 preset-edit 对话框）、删除（ConfirmDialog）。
- 排序：按 `createdAt` 升序。

## Task 8: EventFormDialog（菜单栏）

**Files:**
- Create: `src/renderer/src/components/weekly/EventFormDialog.tsx`

- Props：

```ts
type FormState =
  | { kind: 'preset-create' }
  | { kind: 'preset-edit'; preset: WeekPreset }
  | { kind: 'event-create'; date: string; startMin: number }
  | { kind: 'event-edit'; event: WeekEvent }
```

- 布局复用 `.modal-mask` / `.modal`（`.weekly-dialog`，宽 460px）：标题（input）、颜色（8 个 `.color-dot` 24px 圆，选中加 2px #4DA3FF 描边）、重要紧急程度（4 个 `.quad-option`：`.quad-dot` 用 QUADRANT_META 颜色 + 标签）、时间区、备注 textarea、`.dialog-error`、按钮行（取消 / 删除（仅 edit）/ 保存）。
- 时间区：
  - preset 模式：`.duration-quick` 7 个 chip（0.5/1/1.5/2/2.5/3/4 小时）+ `.duration-custom`（小时 select 0~10 + 分钟 select 步进 5，min 0~55）；选中自定义时启用两个 select；保存时 `durationMin = h*60+m`，`normalizeDuration` 后若 <5 或 >600 显示错误。
  - event 模式：开始时间（小时 select 7~23 + 分钟 select 步进 5）+ 截止时间（小时 select 7~24 + 分钟 select 步进 5，小时=24 时只允许分钟 0）；保存时 `clampEventTimes`，若 end<=start 或时长>600 显示错误并阻止。
- 保存动作：
  - preset-create → `addPreset`
  - preset-edit → `updatePreset`
  - event-create → `addWeekEvent`（含 date）
  - event-edit → `updateWeekEvent`（含 start/end）
  - 删除按钮 → `deletePreset` / `deleteWeekEvent`（先经 ConfirmDialog 确认）。
- 默认值：新建 preset：标题空、颜色 WEEK_COLORS[0]、象限 1、时长 60；新建 event：标题空、颜色 WEEK_COLORS[0]、象限 1、startMin 由调用方传入、end = start+60（clamp 后）。

## Task 9: 样式

**Files:**
- Modify: `src/renderer/src/styles/theme.css`

在文件末尾追加 `.weekly-*`、`.day-*`、`.preset-*`、`.color-dot`、`.quad-dot/quad-option`、`.duration-*`、`.week-*` 等类：

- 面板/边框/文字沿用现有 CSS 变量；发丝网格线 `rgba(255,255,255,0.06)`。
- `.week-board`：`border:1px solid var(--border); border-radius: var(--radius-lg); background:#0c0e12; overflow:hidden;` 内部分区 flex。
- `.week-col + .week-col` 左发丝线；表头 hover 背景 `rgba(255,255,255,0.04)`。
- `.day-event`：`position:absolute; left:2px; right:2px; border-radius:6px; border:1px solid; overflow:hidden; cursor:grab; user-select:none;` 背景 `color-mix` 不可用时用 `rgba` 转换后的 18% 填充（由组件内联 style 计算）；左侧 3px 色条用 `box-shadow: inset 3px 0 0 0 <color>` 或 `::before`。
- `.preset-card`：`cursor:grab;` 拖动中 `opacity:.5`。
- `.day-menu` 复用 `.context-menu` 视觉；`.now-line`：`position:absolute; left:52px; right:0; height:0; border-top:1px solid var(--danger);`。
- 事件/预设颜色用内联 style（背景 rgba、边框色、色条），避免为 8 色写 8 组类。

## Task 10: 接线、类型检查与构建

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: App.tsx**

把 `{page === 'weekly' && <PlaceholderPage title="周计划" />}` 改为 `{page === 'weekly' && <WeeklyPage />}`，并 import WeeklyPage。

- [ ] **Step 2: 全量验证**

```bash
npm run typecheck
npm test
npm run build
```

Expected: 全部退出码 0。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src
git commit -m "feat: implement weekly planner UI"
```

## Task 11: 截图验收

**Files:**
- Create: `docs/qa-weekly.mjs`

- 参照 `docs/qa-electron.mjs`：`_electron.launch` 构建产物，临时 `--user-data-dir` 写入 `docs/.qa-weekly-userdata`，产出 `docs/qa-weekly/`。
- 场景：进入周计划页截图；点击表头进单日；新建 2 个预设（不同颜色/象限/时长）；拖一个预设到时间轴；双击空白新建事件；右键菜单截图；拖动事件验证吸附后时间变化（evaluate 读取 `.day-event-meta` 文本与 data）。
- 每步截图 + JSON 断言结果；截图用 claude-vision 技能核对深色苹果日历观感。

## Self-Review

- 覆盖检查：周计数（Task 1/5 streak）、周视图自适应只读（Task 5/9）、单日滚动不缩放（Task 6，无 wheel 缩放逻辑）、8 色与四象限（Task 8）、时长快捷+自定义≤10h（Task 8 + weekRules normalizeDuration）、拖动吸附与复制语义（Task 3/6）、右键修改删除（Task 6/8）、全局共享预设（预设存在 AppData 顶层，非按天）、深色苹果视觉（Task 9/11）。全部有对应任务。
- 无占位符、类型名跨任务一致（weekRules 导出名与 Task 6/8 引用一致）。
