import { describe, expect, it } from 'vitest'
import { DEFAULT_MONEY_CONFIG, selectMoneyStats } from '../src/shared/money'
import type { LedgerDay, MoneyState } from '../src/shared/types'
import { accumulateTrend, buildMoneyTrend, shiftTrendDate } from '../src/renderer/src/lib/moneyTrend'
import { buildTrendCurve } from '../src/renderer/src/lib/trendCurve'

function day(date: string, patch: Partial<LedgerDay> = {}): LedgerDay {
  return {
    date,
    settledAt: `${date}T13:00:00Z`,
    entries: [],
    videoMin: 0,
    gameMin: 0,
    latePhone: false,
    dayLimit: 80,
    spentTC: 0,
    overdraft: 0,
    deltaLT: 0,
    nightPending: false,
    isRestDay: false,
    ...patch
  }
}

function ledger(days: LedgerDay[]): MoneyState {
  return { enabled: true, config: DEFAULT_MONEY_CONFIG, days, weeks: [] }
}

describe('dashboard money trend', () => {
  it('shows Monday through Sunday and distinguishes zero, missing and future days', () => {
    const money = ledger([
      day('2026-11-16'),
      day('2026-11-18', { settledAt: null }),
      day('2026-11-20', { spentTC: 72, deltaLT: -2 }),
      day('2026-11-21', { spentTC: 99, deltaLT: 3 })
    ])
    const trend = buildMoneyTrend(money, 'week', '2026-11-20', '2026-11-20')
    expect([trend.start, trend.end]).toEqual(['2026-11-16', '2026-11-22'])
    expect(trend.days.map(({ spentTC }) => spentTC)).toEqual([0, null, null, null, 72, null, null])
    expect(trend.days.map(({ status }) => status)).toEqual(['recorded', 'missing', 'missing', 'missing', 'recorded', 'future', 'future'])
    expect(trend.days[4].deltaLT).toBe(-2)
    expect([trend.spentTC, trend.deltaLT, trend.recordedDays]).toEqual([72, -2, 2])
  })

  it('samples every day in a leap-year month and counts only observations inside it', () => {
    const money = ledger([
      day('2024-01-31', { spentTC: 55 }),
      day('2024-02-01', { spentTC: 8, deltaLT: 2 }),
      day('2024-02-11', { spentTC: 20, deltaLT: -1 }),
      day('2024-02-29', { spentTC: 22, deltaLT: -3 }),
      day('2024-03-01', { spentTC: 80 })
    ])
    const trend = buildMoneyTrend(money, 'month', '2024-02-12', '2024-03-05')
    expect(trend.days).toHaveLength(29)
    expect(trend.days.filter(({ status }) => status === 'recorded').map(({ label, spentTC }) => [label, spentTC]))
      .toEqual([['1', 8], ['11', 20], ['29', 22]])
    expect([trend.spentTC, trend.deltaLT, trend.recordedDays]).toEqual([50, -2, 3])
  })

  it('uses the live ledger calculation for consumption and carried overnight charges', () => {
    const today = '2026-11-20'
    const money = ledger([
      day('2026-11-19', { latePhone: true }),
      day(today, { settledAt: null, videoMin: 60, gameMin: 30 })
    ])
    const current = selectMoneyStats(money, today).daily[4]
    const trend = buildMoneyTrend(money, 'week', today, today)
    expect(trend.days[4]).toMatchObject({ spentTC: current.spentTC, deltaLT: current.spentLT, status: 'recorded' })
    expect(current.spentTC).toBe(DEFAULT_MONEY_CONFIG.latePhoneTC)
    expect(current.spentLT).toBeLessThan(0)
  })

  it('totals a week across recorded dates without treating gaps as recorded zeroes', () => {
    const trend = buildMoneyTrend(ledger([
      day('2026-11-15', { spentTC: 41, deltaLT: 3 }),
      day('2026-11-17', { spentTC: 22, deltaLT: 2 }),
      day('2026-11-19', { spentTC: 0, deltaLT: -4 }),
      day('2026-11-20', { spentTC: 17, deltaLT: -1 }),
      day('2026-11-21', { spentTC: 99, deltaLT: 6 })
    ]), 'week', '2026-11-20', '2026-11-20')

    expect(accumulateTrend(trend.days.map(day => day.spentTC))).toEqual([null, 22, null, 22, 39, null, null])
    expect(accumulateTrend(trend.days.map(day => day.deltaLT))).toEqual([null, 2, null, -2, -3, null, null])
    expect([trend.spentTC, trend.deltaLT]).toEqual([39, -3])
  })

  it('never counts future dates in a partial month or lets month navigation drift onto the next month', () => {
    const trend = buildMoneyTrend(ledger([day('2026-11-23', { spentTC: 7 })]), 'month', '2026-11-20', '2026-11-20')
    expect(trend.days).toHaveLength(30)
    expect(trend.days.filter(({ status }) => status === 'future')).toHaveLength(10)
    expect(trend.recordedDays).toBe(0)
    expect(shiftTrendDate('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftTrendDate('week', '2026-01-01', -1)).toBe('2025-12-22')
  })
})

describe('dashboard smooth trend', () => {
  it('connects observations with cubic controls and marks only interior gaps as interpolated', () => {
    const { points, segments } = buildTrendCurve([null, 0, null, null, 120, 1, 90, null])
    expect(points).toEqual([{ x: 1, y: 0 }, { x: 4, y: 120 }, { x: 5, y: 1 }, { x: 6, y: 90 }])
    expect(segments.map(({ interpolated }) => interpolated)).toEqual([true, false, false])
    expect(segments[0].controlFrom.y).toBe(0)
    for (const segment of segments) {
      const min = Math.min(segment.from.y, segment.to.y)
      const max = Math.max(segment.from.y, segment.to.y)
      for (const control of [segment.controlFrom, segment.controlTo]) {
        expect(control.y).toBeGreaterThanOrEqual(min)
        expect(control.y).toBeLessThanOrEqual(max)
      }
    }
  })
})
