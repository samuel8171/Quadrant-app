import { addDays, dateKey, mondayOf, parseDateKey } from '../../../shared/dateKey'
import { selectMoneyStats, type MoneyStats } from '../../../shared/money'
import type { LedgerDay, MoneyState } from '../../../shared/types'

export type TrendPeriod = 'week' | 'month'

interface DateRange {
  start: string
  end: string
}

export interface MoneyTrendPoint {
  date: string
  label: string
  spentTC: number | null
  deltaLT: number | null
  status: 'recorded' | 'missing' | 'future'
}

export interface MoneyTrend extends DateRange {
  days: MoneyTrendPoint[]
  spentTC: number
  deltaLT: number
  recordedDays: number
  earliest: string
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

export function trendDateRange(period: TrendPeriod, anchor: string): DateRange {
  const date = parseDateKey(anchor)
  if (period === 'month') {
    const year = date.getFullYear()
    const month = date.getMonth()
    return { start: dateKey(new Date(year, month, 1)), end: dateKey(new Date(year, month + 1, 0)) }
  }
  const monday = mondayOf(date)
  return { start: dateKey(monday), end: dateKey(addDays(monday, 6)) }
}

export function shiftTrendDate(period: TrendPeriod, anchor: string, offset: -1 | 1): string {
  const date = parseDateKey(anchor)
  return period === 'month'
    ? dateKey(new Date(date.getFullYear(), date.getMonth() + offset, 1))
    : dateKey(addDays(mondayOf(date), offset * 7))
}

export function accumulateTrend(values: readonly (number | null)[]): (number | null)[] {
  let total = 0
  return values.map((value) => {
    if (value === null) return null
    total += value
    return total
  })
}

function hasRecordedActivity(day: LedgerDay): boolean {
  return day.settledAt !== null || day.entries.length > 0 ||
    day.videoMin > 0 || day.gameMin > 0 || day.latePhone === true
}

export function buildMoneyTrend(money: MoneyState, period: TrendPeriod, anchor: string, today: string): MoneyTrend {
  const range = trendDateRange(period, anchor)
  const days = new Map(money.days.map((day) => [day.date, day]))
  const daily = new Map<string, MoneyStats['daily'][number]>()
  let earliest = today
  for (const day of days.values()) {
    if (day.date < earliest && hasRecordedActivity(day)) earliest = day.date
  }

  // Use the same day totals as the weekly balance, including settled snapshots and live charges.
  for (let monday = mondayOf(parseDateKey(range.start)); dateKey(monday) <= range.end; monday = addDays(monday, 7)) {
    for (const point of selectMoneyStats(money, dateKey(monday)).daily) daily.set(point.date, point)
  }

  const points: MoneyTrendPoint[] = []
  let spentTC = 0
  let deltaLT = 0
  let recordedDays = 0
  for (let cursor = parseDateKey(range.start); dateKey(cursor) <= range.end; cursor = addDays(cursor, 1)) {
    const date = dateKey(cursor)
    const label = period === 'week' ? WEEKDAYS[points.length] : String(cursor.getDate())
    const day = days.get(date)
    const total = daily.get(date)
    const recorded = date <= today && day && total &&
      (hasRecordedActivity(day) || total.spentTC !== 0 || total.spentLT !== 0)
    if (recorded) {
      points.push({ date, label, spentTC: total.spentTC, deltaLT: total.spentLT, status: 'recorded' })
      spentTC += total.spentTC
      deltaLT += total.spentLT
      recordedDays++
    } else {
      points.push({ date, label, spentTC: null, deltaLT: null, status: date > today ? 'future' : 'missing' })
    }
  }

  return { ...range, days: points, spentTC, deltaLT, recordedDays, earliest }
}
