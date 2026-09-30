import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from '../src/shared/types'
import {
  DEFAULT_MONEY_CONFIG,
  costOfEntry,
  dayLimitOf,
  leisureDelta,
  nightMinutesOf,
  settleDay
} from '../src/shared/money'

// ============================================================================
// 共享夹具与辅助函数（后续任务在下方追加用例，请保留本区块在最顶部）
// ============================================================================

// ============================================================================
// >>>> 条目构造辅助 mkEntry：Task 3/4/5/8/10 共用（扩展时请在这两个标记行之间追加）>>>>
// ============================================================================

let entrySeq = 0

/**
 * 构造一条 `LedgerEntry`。
 *
 * 默认值：`kind: 'planned'`、`plannedMin: 60`、`actualMin: 0`、`nightMin: 0`、
 * `done: true`、`sourceId: null`、`quadrant: null`。
 *
 * `costTC` / `deltaLT` 默认留 0：`settleDay` 一律从原始字段重新推导，不读这两个镜像字段 ——
 * 留 0 反而让用例顺带证明了「结算不是把 entry.costTC 加起来」。需要特定值请显式覆盖。
 */
function mkEntry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: `entry-${++entrySeq}`,
    kind: 'planned',
    sourceId: null,
    title: '测试条目',
    quadrant: null,
    plannedMin: 60,
    actualMin: 0,
    done: true,
    nightMin: 0,
    costTC: 0,
    deltaLT: 0,
    ...over
  }
}

// ============================================================================
// <<<< mkEntry 共用辅助结束 <<<<
// ============================================================================

// ============================================================================
// Task 2：单条计费与娱币判定
// ============================================================================

describe('costOfEntry', () => {
  it('按实际时长计费：2 小时 × 10 币 = 20', () => {
    expect(costOfEntry({ actualMin: 120, nightMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(20)
  })

  it('深夜倍率只作用于落在深夜区间的那部分分钟数', () => {
    // 120 分钟中 60 分钟在深夜：(60 + 60 × 1.5) / 60 × 10 = 25
    expect(costOfEntry({ actualMin: 120, nightMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(25)
    expect(costOfEntry({ actualMin: 120, nightMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(30)
  })

  it('实际时长为 0 时不产生费用', () => {
    expect(costOfEntry({ actualMin: 0, nightMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(0)
  })
})

describe('nightMinutesOf', () => {
  it('nightMinutesOf：区间左闭右开，恰好 23:30 结束不算深夜', () => {
    expect(nightMinutesOf({ startMin: 1350, actualMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(0) // 22:30 + 60
    expect(nightMinutesOf({ startMin: 1350, actualMin: 90 }, DEFAULT_MONEY_CONFIG)).toBe(30) // 22:30 + 90
    expect(nightMinutesOf({ startMin: 1380, actualMin: 60 }, DEFAULT_MONEY_CONFIG)).toBe(30) // 23:00 + 60
  })

  it('nightMinutesOf：跨零点到次日清晨', () => {
    // 23:00 开始做 480 分钟 → 落在 [23:30, 06:00) 内的是 390 分钟
    expect(nightMinutesOf({ startMin: 1380, actualMin: 480 }, DEFAULT_MONEY_CONFIG)).toBe(390)
  })

  it('nightMinutesOf：完全在白天为 0', () => {
    expect(nightMinutesOf({ startMin: 600, actualMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(0)
  })
})

describe('leisureDelta', () => {
  it('没做的事扣娱币，不看时长', () => {
    expect(
      leisureDelta({ kind: 'planned', done: false, actualMin: 0, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(-1)
  })

  it('高效完成有奖励，低效完成有惩罚，中间段为 0', () => {
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 60, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0.5)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 120, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(-0.5)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 80, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })

  it('边界：恰好等于计划时长算高效，恰好 1.5 倍不算低效', () => {
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 60, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0.5)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 90, plannedMin: 60 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })

  it('计划外条目不参与娱币（否则随手加一条就能刷币）', () => {
    expect(
      leisureDelta({ kind: 'unplanned', done: true, actualMin: 30, plannedMin: null }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })

  it('plannedMin 为 null 或 0 时返回 0，不产生 NaN', () => {
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 30, plannedMin: null }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
    expect(
      leisureDelta({ kind: 'planned', done: true, actualMin: 30, plannedMin: 0 }, DEFAULT_MONEY_CONFIG)
    ).toBe(0)
  })
})

// ============================================================================
// Task 3：日结算（额度、透支、保底）
// ============================================================================

describe('dayLimitOf', () => {
  it('无透支时当日额度等于周额度除以 7', () => {
    expect(dayLimitOf(0, DEFAULT_MONEY_CONFIG)).toBe(50)
  })

  it('透支从次日额度扣除，且不击穿保底线', () => {
    expect(dayLimitOf(30, DEFAULT_MONEY_CONFIG)).toBe(20)
    expect(dayLimitOf(999, DEFAULT_MONEY_CONFIG)).toBe(10) // 50 × 0.2
  })
})

describe('settleDay', () => {
  it('未超限的普通日：透支为 0，花费等于条目之和', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: '2026-09-28T23:20:00.000Z',
      entries: [
        mkEntry({ actualMin: 120, plannedMin: 120, done: true }),
        mkEntry({ actualMin: 60, plannedMin: 60, done: true })
      ],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.spentTC).toBe(30)
    expect(day.overdraft).toBe(0)
    expect(day.dayLimit).toBe(50)
  })

  it('超限日的透支等于花费减额度', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 480, plannedMin: 480, done: true })], // 80 币
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.overdraft).toBe(30)
  })

  it('自修复：透支一天后正常消费，第三天额度恢复', () => {
    const d1 = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 480, plannedMin: 480, done: true })],
      config: DEFAULT_MONEY_CONFIG
    })
    const d2 = settleDay({
      date: '2026-09-29',
      previousOverdraft: d1.overdraft,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(d2.dayLimit).toBe(20)
    expect(d2.overdraft).toBe(0)
    expect(dayLimitOf(d2.overdraft, DEFAULT_MONEY_CONFIG)).toBe(50)
  })

  it('deltaLT 是当日全部条目娱币增量之和', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ done: false }), mkEntry({ done: true, actualMin: 30, plannedMin: 60 })],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.deltaLT).toBe(-0.5)
  })

  it('settledAt 原样写入、nightPending 置为 true', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: '2026-09-28T23:20:00.000Z',
      entries: [mkEntry({ actualMin: 60, plannedMin: 60, done: true })],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.date).toBe('2026-09-28')
    expect(day.settledAt).toBe('2026-09-28T23:20:00.000Z')
    expect(day.nightPending).toBe(true)
  })

  it('空的一天：花费与透支均为 0，额度仍为 50', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.spentTC).toBe(0)
    expect(day.overdraft).toBe(0)
    expect(day.dayLimit).toBe(50)
    expect(day.deltaLT).toBe(0)
  })

  it('结算快照独占自己的条目数组：调用方事后改动不会改写已冻结的账', () => {
    const entries = [mkEntry({ actualMin: 120, plannedMin: 120, done: true })]
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries,
      config: DEFAULT_MONEY_CONFIG
    })

    // 调用方继续往自己那个数组里塞条目（组装/落盘过程中的常见写法）
    entries.push(mkEntry({ actualMin: 480, plannedMin: 480, done: true }))

    expect(day.entries).not.toBe(entries)
    expect(day.entries).toHaveLength(1)
    expect(day.spentTC).toBe(20)
    // 快照必须自洽：冻结的 spentTC 仍等于快照内条目之和
    expect(
      day.entries.reduce(
        (sum, e) => sum + costOfEntry({ actualMin: e.actualMin, nightMin: e.nightMin }, DEFAULT_MONEY_CONFIG),
        0
      )
    ).toBe(day.spentTC)
  })
})
