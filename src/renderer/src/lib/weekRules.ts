import {
  WEEK_COLORS,
  type Quadrant,
  type WeekEvent,
  type WeekPreset
} from '../../../shared/types'

export const DAY_START_MIN = 7 * 60
export const DAY_END_MIN = 24 * 60
export const MIN_DURATION_MIN = 5
export const MAX_DURATION_MIN = 10 * 60
export const DAY_HOUR_PX = 48
export const DAY_PAD_PX = 10

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

export function eventHeightPx(startMin: number, endMin: number, hourPx: number): number {
  return Math.max(4, ((endMin - startMin) / 60) * hourPx - 2)
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

export function snapEventStart(
  others: WeekEvent[],
  durationMin: number,
  pointerMin: number
): number | null {
  if (others.length === 0) {
    return clampEventStart(pointerMin, durationMin)
  }

  const duration = normalizeDuration(durationMin)
  let nearest = others[0]
  let nearestDist = intervalDistance(pointerMin, nearest)
  for (let i = 1; i < others.length; i++) {
    const e = others[i]
    const d = intervalDistance(pointerMin, e)
    if (d < nearestDist || (d === nearestDist && e.startMin < nearest.startMin)) {
      nearest = e
      nearestDist = d
    }
  }

  let start: number
  if (pointerMin < nearest.startMin) {
    start = nearest.startMin - duration
  } else if (pointerMin > nearest.endMin) {
    start = nearest.endMin
  } else if (pointerMin - nearest.startMin <= nearest.endMin - pointerMin) {
    start = nearest.startMin - duration
  } else {
    start = nearest.endMin
  }

  if (start < DAY_START_MIN || start + duration > DAY_END_MIN) return null
  if (others.some((o) => overlaps(start, start + duration, o.startMin, o.endMin))) return null
  return start
}

function intervalDistance(p: number, e: WeekEvent): number {
  if (p < e.startMin) return e.startMin - p
  if (p > e.endMin) return p - e.endMin
  return 0
}

function overlaps(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && s2 < e1
}
