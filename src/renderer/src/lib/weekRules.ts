import {
  WEEK_COLORS,
  type Quadrant,
  type WeekEvent,
  type WeekPreset
} from '../../../shared/types'
import { addDays, dateKey, mondayOf, pad2, parseDateKey } from '../../../shared/dateKey'

/**
 * 纯日期函数已于本任务**下沉**到 `shared/dateKey.ts`（原因见该文件头部注释）。
 * 这里原样 re-export，签名与名字都不变，所有既有 import 点无需改动。
 */
export { addDays, dateKey, mondayOf, pad2, parseDateKey }

export const DAY_START_MIN = 7 * 60
export const DAY_END_MIN = 24 * 60
export const MIN_DURATION_MIN = 5
export const MAX_DURATION_MIN = 10 * 60
export const DAY_HOUR_PX = 48
export const DAY_PAD_PX = 10

export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const MS_PER_DAY = 86_400_000
const ANCHOR_UTC_DAY = Date.UTC(2026, 7, 10) / MS_PER_DAY

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
  const utcDay =
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) / MS_PER_DAY
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

export function clampEventTimes(
  startMin: number,
  endMin: number
): { startMin: number; endMin: number } {
  let start = Math.round(Math.min(Math.max(startMin, DAY_START_MIN), DAY_END_MIN - 5) / 5) * 5
  let end = Math.round(Math.min(Math.max(endMin, start + 5), DAY_END_MIN) / 5) * 5
  if (end - start > MAX_DURATION_MIN) end = start + MAX_DURATION_MIN
  return { startMin: start, endMin: end }
}

export function eventTopPx(startMin: number, hourPx: number): number {
  return ((startMin - DAY_START_MIN) / 60) * hourPx
}

/**
 * 事件块高度：**精确对应它声明的时间区间**，不留内缩。
 *
 * 曾经这里减 2px 当作"相邻块之间的呼吸缝"，但那样 15:00-16:00 的块会停在
 * 15:58 而不是 16:00，块体与标尺线对不上（实测 1 小时块只有 46px，见
 * docs/probes/axis-geometry-before.md）。分隔改由块体自身的 1px 描边与
 * 6px 圆角承担，几何回到真实值。
 */
export function eventHeightPx(startMin: number, endMin: number, hourPx: number): number {
  return Math.max(4, ((endMin - startMin) / 60) * hourPx)
}

export function minuteFromOffsetY(y: number, hourPx: number): number {
  return DAY_START_MIN + (y / hourPx) * 60
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
    if (typeof patch.durationMin === 'number') {
      next.durationMin = normalizeDuration(patch.durationMin)
    }
    return next
  })
}

export function deletePresetFromList(list: WeekPreset[], id: string): WeekPreset[] {
  return list.filter((p) => p.id !== id)
}

/**
 * 按给定 id 顺序重排预设列表 —— **数组顺序就是显示顺序**。
 *
 * 为什么不给 `WeekPreset` 加 `order` 字段：数组顺序本来就已持久化
 * （`addPreset` 一直是尾部追加，`createdAt` 只是恰好与之同序），而加字段要同步
 * `shared/types.ts` / `main/dataCodec.normalizeWeekPreset`（逐字段重建）/
 * `lib/platformApi.validAppData`（网页端校验）三处，还得给旧数据做一次性迁移赋值；
 * 漏一处的代价是静默丢字段。数组顺序的改动面为零，且"列表的顺序就是数组的顺序"
 * 本来就是最诚实的表达。
 *
 * **`ids` 里没提到的预设一律追加到尾部**（保持它们之间的相对顺序）：任何一次不完整的
 * 调用都不会让预设凭空消失 —— 丢预设是不可逆的。重复的 id 只取第一次，多余的 id 忽略。
 *
 * 顺序未变时**返回原数组对象**，调用方据此短路掉无谓的落盘与云同步。
 */
export function reorderPresetsInList(list: WeekPreset[], ids: string[]): WeekPreset[] {
  const byId = new Map(list.map((p) => [p.id, p]))
  const next: WeekPreset[] = []
  for (const id of ids) {
    const preset = byId.get(id)
    if (!preset) continue
    next.push(preset)
    byId.delete(id)
  }
  // 未被提及的按原数组顺序补到尾部，保证一个都不少。
  for (const preset of list) {
    if (!byId.has(preset.id)) continue
    next.push(preset)
    byId.delete(preset.id)
  }
  if (next.length === list.length && next.every((p, i) => p === list[i])) return list
  return next
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
    showInQuadrant: false,
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
      const duration = e.endMin - e.startMin
      const start =
        Math.round(
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

/**
 * 解除周计划事件与四象限卡片之间的**镜像链接**。
 *
 * 背景：`WeekEvent.showInQuadrant === true` 表示"这条计划在四象限里有一份镜像"，
 * `quadrantEventId` 是那份镜像的 id（见 `appStore.addWeekEvent` / `updateWeekEvent`）。
 *
 * 为什么必须显式解除：镜像被删掉（完成、删除、剪切）之后这两个字段若原样保留，
 * 就留下一个**悬空引用**。用户下次在周计划里编辑这条事件时会走进
 * `updateWeekEvent` 的「show 为真、但 events 里找不到 `quadrantEventId`」分支，
 * 于是 `findFreePosition` **重新造一张卡片**出来 —— 用户看到的是
 * "我明明已经完成了 / 删掉了，它又自己回来了"。这类"幽灵复活"极难从界面上归因，
 * 所以删除镜像的三条路径（`completeQuadrantEvent` / `deleteEvent` / `cutEvent`）
 * 都必须调用本函数。
 *
 * 只按 id 精确匹配；没有任何一条命中时**返回原数组对象**，调用方据此短路掉无谓的落盘。
 */
export function unlinkQuadrantEvent(weekEvents: WeekEvent[], quadrantEventId: string): WeekEvent[] {
  let changed = false
  const next = weekEvents.map((e) => {
    if (e.quadrantEventId !== quadrantEventId) return e
    changed = true
    const copy: WeekEvent = { ...e, showInQuadrant: false }
    delete copy.quadrantEventId
    return copy
  })
  return changed ? next : weekEvents
}

export function moveWeekEventInList(
  list: WeekEvent[],
  id: string,
  newStartMin: number
): WeekEvent[] {
  return list.map((e) => {
    if (e.id !== id) return e
    const duration = e.endMin - e.startMin
    const start =
      Math.round(
        Math.min(Math.max(newStartMin, DAY_START_MIN), DAY_END_MIN - duration) / 5
      ) * 5
    return { ...e, startMin: start, endMin: start + duration }
  })
}

export function eventsOnDate(list: WeekEvent[], date: string): WeekEvent[] {
  return list
    .filter((e) => e.date === date)
    .sort((a, b) => a.startMin - b.startMin || a.createdAt.localeCompare(b.createdAt))
}

export function validateEventTimes(startMin: number, endMin: number): string | null {
  if (endMin <= startMin) return '截止时间需晚于开始时间'
  if (endMin - startMin > MAX_DURATION_MIN) return '时长不能超过10小时'
  return null
}

export function clampStartForDuration(startMin: number, durationMin: number): number {
  const duration = normalizeDuration(durationMin)
  return (
    Math.round(
      Math.min(Math.max(startMin, DAY_START_MIN), DAY_END_MIN - duration) / 5
    ) * 5
  )
}

export function clampEndForDuration(endMin: number, durationMin: number): number {
  const duration = normalizeDuration(durationMin)
  return (
    Math.round(
      Math.min(Math.max(endMin, DAY_START_MIN + duration), DAY_END_MIN) / 5
    ) * 5
  )
}

export const SNAP_STEP_MIN = 5
/** 落点被占用时向两侧滑动的最大搜索距离。 */
export const SNAP_SEARCH_LIMIT_MIN = 12 * 60

/**
 * 触摸拖动提交所需的最小位移（分钟）。
 *
 * 为什么需要：触摸阈值 16px 只是"挡掉大多数抖动"，仍会有恰好凑够阈值的
 * 残余情况。此刻若立刻按吸附结果提交，块体会真的被挪走一格（5 分钟）。
 * 引入这条门槛后，位移不足 10 分钟（= 2 格）的拖动视为误触，不提交、
 * 块体回原位。鼠标不受限——精确设备上拖 5 分钟是明确的意图。
 */
export const MIN_TOUCH_MOVE_MIN = 10

/**
 * 判断一次拖动是否值得提交。
 *
 * @param originStart 拖动开始时的开始分钟
 * @param snapStart   吸附后的落点分钟
 * @param pointerType 指针类型；触摸设备要求位移达到 MIN_TOUCH_MOVE_MIN
 */
export function shouldCommitMove(
  originStart: number,
  snapStart: number,
  pointerType: string
): boolean {
  const delta = Math.abs(snapStart - originStart)
  if (delta === 0) return false
  if (pointerType === 'mouse') return true
  return delta >= MIN_TOUCH_MOVE_MIN
}

/** 拖动方向提示：决定落点被占用时优先向哪一侧滑动。 */
export type SnapHint = 'earlier' | 'later'

/** 把分钟数吸附到 5 分钟网格并保证整个事件落在当天范围内。 */
function clampToGrid(min: number, duration: number): number {
  const rounded = Math.round(min / SNAP_STEP_MIN) * SNAP_STEP_MIN
  return Math.min(Math.max(rounded, DAY_START_MIN), DAY_END_MIN - duration)
}

function isFreeSlot(others: WeekEvent[], start: number, duration: number): boolean {
  return !others.some((o) => overlaps(start, start + duration, o.startMin, o.endMin))
}

/**
 * 计算拖动落点：**落点即所见**。
 *
 * 与旧实现（贴到最近事件的边缘，越界或重叠即整体回退）的差别：
 * 1. 以 5 分钟网格吸附指针位置，而不是吸附到邻事件边缘——块体不再跳到与手指无关的位置；
 * 2. 落点被占用时，先沿拖动方向以 5 分钟为步长滑动到最近的空位（上限 12 小时），
 *    该方向确实无空位时才回退到反方向；
 * 3. 完全没有空位时返回 `null`，由调用方保持原位（不提交）。
 */
export function snapEventStart(
  others: WeekEvent[],
  durationMin: number,
  pointerMin: number,
  hint?: SnapHint
): number | null {
  const duration = normalizeDuration(durationMin)
  const desired = clampToGrid(pointerMin, duration)
  if (isFreeSlot(others, desired, duration)) return desired

  const directions: SnapHint[] = hint === 'later' ? ['later', 'earlier'] : ['earlier', 'later']
  for (const direction of directions) {
    const found = scanDirection(others, duration, desired, direction)
    if (found !== null) return found
  }
  return null
}

function scanDirection(
  others: WeekEvent[],
  duration: number,
  desired: number,
  direction: SnapHint
): number | null {
  for (let d = SNAP_STEP_MIN; d <= SNAP_SEARCH_LIMIT_MIN; d += SNAP_STEP_MIN) {
    const candidate = direction === 'later' ? desired + d : desired - d
    if (candidate < DAY_START_MIN || candidate + duration > DAY_END_MIN) continue
    if (isFreeSlot(others, candidate, duration)) return candidate
  }
  return null
}

function overlaps(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && s2 < e1
}
