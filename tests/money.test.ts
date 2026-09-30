import { describe, expect, it } from 'vitest'
import type { LedgerDay, LedgerEntry, MoneyConfig, MoneyState, WeekSettlement } from '../src/shared/types'
import { addDays, dateKey, parseDateKey } from '../src/shared/dateKey'
import {
  DEFAULT_MONEY_CONFIG,
  costOfEntry,
  currentQuota,
  dayLimitOf,
  ensureWeekRollover,
  leisureDelta,
  nightMinutesOf,
  penaltyTierOf,
  pendingDays,
  selectMoneyStats,
  settleDay,
  settleWeek
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
// >>>> Task 4/10 共用夹具 mkWeek / mkSettledWeek（扩展时请在这两个标记行之间追加）>>>>
// ============================================================================

/** 夹具周的周一：2026-09-07（周日为 2026-09-13）。 */
const FIXTURE_WEEK_START = '2026-09-07'

/**
 * 把一笔时币摊成若干条计划内条目，逐条 `costOfEntry` 之和**恰好**等于 `cost`。
 *
 * `actualMin` 取 `cost × 6` 分钟且不含深夜：`round(6c / 60 × 10) === c`，是精确逆运算。
 * 单条封顶 600 分钟（域模型 `MAX_DURATION_MIN`），所以按 100 币一段拆分。
 */
function fillerEntries(cost: number): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (let left = cost; left > 0; left -= 100) {
    const minutes = Math.min(left, 100) * 6
    out.push(mkEntry({ actualMin: minutes, plannedMin: minutes, done: true }))
  }
  return out
}

/** 237 分钟里 30 分钟落在深夜：round((207 + 45) / 6) = 42 币。 */
function nightEntry(): LedgerEntry {
  return mkEntry({ kind: 'planned', actualMin: 237, plannedMin: 300, nightMin: 30, done: true })
}

/** 45 分钟的计划外事项：round(7.5) = 8 币，且不参与娱币。 */
function unplannedEntry(): LedgerEntry {
  return mkEntry({ kind: 'unplanned', actualMin: 45, plannedMin: null, done: true })
}

/** 有事情没做：花费 0。 */
function missedEntry(): LedgerEntry {
  return mkEntry({ kind: 'planned', actualMin: 0, plannedMin: 60, done: false })
}

/**
 * 造 `settleWeek` 的入参：一周 7 天的 `LedgerDay`，默认总花费 `spent = 300`。
 *
 * 默认形状被五个聚合断言钉死：
 * - 单日花费 110 / 50 / 50 / 50 / 40 / 0 / 0 —— 只有周一超过日软上限 50 ⇒ `overLimitDays = 1`；
 * - 周二固定挂特征条目：一条 45 分钟计划外（8 币）⇒ `unplannedCount = 1`、`unplannedMin = 45`，
 *   一条 30 分钟深夜（42 币）⇒ `nightMin = 30`，两条合计 50 币，与该日耗费恰好相等；
 * - 周六是「没做」那天 ⇒ `missCount = 1`。
 *
 * 每天的 `spentTC` 与当天条目 `costOfEntry` 之和**严格相等**：`spent` 与 300 的差额全部
 * 记在周一的填充条目上（按 100 币一段拆分，满足 600 分钟的域上限），
 * `dayLimit` / `overdraft` 按 `dayLimitOf` 逐日滚动 —— 与 `settleDay` 同算法。
 * 想精确控制某天的花费就用 `spent`：周一那天的花费恒为 `spent − 190`。
 *
 * 这个滚动不是装饰：周一的花费把后面几天的 `dayLimit` 压到保底 10，于是「只算周一超限」
 * 与「凡 `spentTC > dayLimit` 就算超限」（后者会数出 5 天）在这里分道扬镳。
 *
 * `spent` 低于 190 会让周一的填充量变成负数；本任务的用例用到 200 及以上。
 */
function mkWeek(
  over: { spent?: number; weekStart?: string; nextWeekTC?: number; nextWeekLT?: number } = {}
): Parameters<typeof settleWeek>[0] {
  const spent = over.spent ?? 300
  const weekStart = over.weekStart ?? FIXTURE_WEEK_START
  const monday = parseDateKey(weekStart)

  const daySpends = [110 + (spent - 300), 50, 50, 50, 40, 0, 0]
  const days: LedgerDay[] = []
  let previousOverdraft = 0
  for (let i = 0; i < daySpends.length; i++) {
    const daySpend = daySpends[i]
    const date = dateKey(addDays(monday, i))
    const dayLimit = dayLimitOf(previousOverdraft, DEFAULT_MONEY_CONFIG)
    const overdraft = Math.max(0, daySpend - dayLimit)
    const entries =
      i === 1
        ? [nightEntry(), unplannedEntry()]
        : i === 5
          ? [missedEntry()]
          : fillerEntries(daySpend)
    days.push({
      date,
      settledAt: `${date}T23:20:00.000Z`,
      entries,
      dayLimit,
      spentTC: daySpend,
      overdraft,
      deltaLT: 0,
      nightPending: false
    })
    previousOverdraft = overdraft
  }

  return {
    weekStart,
    weekEnd: dateKey(addDays(monday, 6)),
    days,
    weekTC: over.nextWeekTC ?? 350,
    weekLT: over.nextWeekLT ?? 10,
    config: DEFAULT_MONEY_CONFIG
  }
}

/**
 * 一个**已算好**的 `WeekSettlement`，供跨周滚动与 Task 10 复用。
 *
 * 默认即一份空周结果：花费 0、档位 0、下周额度回到配置值 350 / 10。
 */
function mkSettledWeek(over: Partial<WeekSettlement> = {}): WeekSettlement {
  const weekStart = over.weekStart ?? FIXTURE_WEEK_START
  return {
    weekStart,
    weekEnd: dateKey(addDays(parseDateKey(weekStart), 6)),
    weekTC: 350,
    spentTC: 0,
    weekOver: 0,
    plannedMin: 0,
    actualMin: 0,
    doneCount: 0,
    missCount: 0,
    unplannedCount: 0,
    unplannedMin: 0,
    nightMin: 0,
    overLimitDays: 0,
    penaltyTier: 0,
    nextWeekTC: 350,
    nextWeekLT: 10,
    notes: [],
    ...over
  }
}

// ============================================================================
// <<<< Task 4/10 共用夹具结束 <<<<
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

// ============================================================================
// Task 4：周结算、档位惩罚与跨周滚动
// ============================================================================

describe('penaltyTierOf', () => {
  it('档位边界', () => {
    expect(penaltyTierOf(0, 350)).toBe(0)
    expect(penaltyTierOf(35, 350)).toBe(1) // 恰好 10%
    expect(penaltyTierOf(36, 350)).toBe(2)
    expect(penaltyTierOf(105, 350)).toBe(2) // 恰好 30%
    expect(penaltyTierOf(106, 350)).toBe(3)
  })
})

describe('settleWeek', () => {
  it('各档位对应的下周额度', () => {
    expect(settleWeek(mkWeek({ spent: 300 })).nextWeekTC).toBe(350)
    expect(settleWeek(mkWeek({ spent: 385 })).nextWeekTC).toBeCloseTo(297.5)
    expect(settleWeek(mkWeek({ spent: 420 })).nextWeekTC).toBeCloseTo(245)
    expect(settleWeek(mkWeek({ spent: 460 })).nextWeekTC).toBeCloseTo(175)
  })

  it('未超支时娱币不打折', () => {
    expect(settleWeek(mkWeek({ spent: 300 })).nextWeekLT).toBe(10)
  })

  it('档位 2 的娱币打折比例是 60%', () => {
    expect(settleWeek(mkWeek({ spent: 420 })).nextWeekLT).toBeCloseTo(6)
  })

  it('周汇总的字段来自日账本', () => {
    const w = settleWeek(mkWeek({ spent: 300 }))
    expect(w.spentTC).toBe(300)
    expect(w.weekOver).toBe(0)
    expect(w.penaltyTier).toBe(0)
    expect(w.overLimitDays).toBe(1)
    expect(w.unplannedCount).toBe(1)
    expect(w.unplannedMin).toBe(45)
    expect(w.missCount).toBe(1)
    expect(w.nightMin).toBe(30)
  })

  it('overLimitDays 比的是配置里的日软上限 50，不是受罚周缩水后的 35', () => {
    // 这一周只发了 245（上周受罚）：若按 weekTC / 7 = 35 算，下面的 40 与 50 全会被误判成超限
    const fortyOnMonday = settleWeek(mkWeek({ spent: 230, nextWeekTC: 245 }))
    expect(fortyOnMonday.weekTC).toBe(245)
    expect(fortyOnMonday.spentTC).toBe(230)
    expect(fortyOnMonday.overLimitDays).toBe(0)

    // 同一额度下周一花 60：超过配置日软上限 50，只有它算超限
    const sixtyOnMonday = settleWeek(mkWeek({ spent: 250, nextWeekTC: 245 }))
    expect(sixtyOnMonday.spentTC).toBe(250)
    expect(sixtyOnMonday.overLimitDays).toBe(1)
  })

  it('缺失的日按零计', () => {
    const input = mkWeek({ spent: 300 })
    // 只留周一到周四：110 + 50 + 50 + 50 = 260，周六那条「没做」也跟着缺失
    const partial = settleWeek({ ...input, days: input.days.slice(0, 4) })
    expect(partial.spentTC).toBe(260)
    expect(partial.missCount).toBe(0)
    expect(partial.nightMin).toBe(30)
    expect(partial.unplannedMin).toBe(45)
  })

  it('notes 是 2–4 条可解释结论', () => {
    const w = settleWeek(mkWeek({ spent: 300 }))
    expect(w.notes.length).toBeGreaterThanOrEqual(2)
    expect(w.notes.length).toBeLessThanOrEqual(4)
    expect(w.notes.join(' ')).toContain('深夜')
    expect(w.notes.join(' ')).toContain('计划外')
  })

  it('超支时给出的档位与百分比逐字对应 spec 6.5', () => {
    const w = settleWeek(mkWeek({ spent: 420 }))
    expect(w.weekOver).toBe(70)
    expect(w.penaltyTier).toBe(2)
    expect(w.notes.join(' ')).toContain('70%')
    expect(w.notes.join(' ')).toContain('60%')
  })
})

describe('ensureWeekRollover / currentQuota', () => {
  it('跨周滚动：缺失的周按空周处理，不惩罚、额度重置', () => {
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [],
      weeks: [mkSettledWeek({ weekStart: '2026-09-07', nextWeekTC: 245, nextWeekLT: 6 })]
    }
    const next = ensureWeekRollover(state, '2026-09-28') // 距今跨了 09-14、09-21 两个周
    expect(next).not.toBe(state)
    expect(next.weeks).toHaveLength(3)
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    expect(next.weeks[1].weekTC).toBeCloseTo(245)
    expect(next.weeks[2].weekTC).toBe(350)
    expect(currentQuota(next)).toEqual({ weekTC: 350, weekLT: 10 })
    // 空周不产生惩罚，也没有账本可写
    expect(next.weeks[1].penaltyTier).toBe(0)
    expect(next.weeks[1].spentTC).toBe(0)
    expect(next.weeks[1].nextWeekLT).toBe(10)
    // 未被触及的字段原样保留
    expect(next.enabled).toBe(true)
    expect(next.days).toEqual([])
  })

  it('没有待补的周时原对象返回', () => {
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [],
      weeks: [mkSettledWeek({ weekStart: '2026-09-21' })]
    }
    // 09-21 那一周还没结束（本周才刚开始），不结算
    expect(ensureWeekRollover(state, '2026-09-28')).toBe(state)
    expect(ensureWeekRollover(state, '2026-09-30')).toBe(state)
  })

  it('从未产生过账本时不虚构历史', () => {
    const state: MoneyState = { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [] }
    expect(ensureWeekRollover(state, '2026-09-28')).toBe(state)
    expect(currentQuota(state)).toEqual({ weekTC: 350, weekLT: 10 })
  })

  it('weeks 为空但已有日账本时，从最早那天所在周开始补', () => {
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: mkWeek({ weekStart: '2026-09-07' }).days,
      weeks: []
    }
    const next = ensureWeekRollover(state, '2026-09-28')
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    expect(next.weeks[0].spentTC).toBe(300)
    expect(next.weeks[0].weekTC).toBe(350)
    expect(currentQuota(next)).toEqual({ weekTC: 350, weekLT: 10 })
  })

  it('惩罚跨周不累积：中间的空周把额度清回配置值', () => {
    // 第 1 周超支落档位 2（下周 245 / 6），第 2、3 周空 → 额度回 350 / 10
    const first = settleWeek(mkWeek({ spent: 420 }))
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      // 账本只落在最后一个待补的周（09-28），中间的 09-14 / 09-21 是真·空周
      days: mkWeek({ spent: 300, weekStart: '2026-09-28' }).days,
      weeks: [first]
    }
    const next = ensureWeekRollover(state, '2026-10-05')
    expect(next.weeks).toHaveLength(4) // 09-07、09-14、09-21、09-28
    expect(next.weeks[1].weekTC).toBeCloseTo(245)
    expect(next.weeks[1].spentTC).toBe(0)
    expect(next.weeks[2].weekTC).toBe(350)
    expect(next.weeks[2].penaltyTier).toBe(0)
    // 09-28 这一周有账本（300 币），不再享受空周重置，但未超支所以也不打折
    expect(next.weeks[3].spentTC).toBe(300)
    expect(next.weeks[3].weekTC).toBe(350)
    expect(next.weeks[3].nextWeekTC).toBe(350)
    expect(currentQuota(next)).toEqual({ weekTC: 350, weekLT: 10 })
  })

  it('惩罚只作用于下一周：未超支的一周把额度拉回配置值', () => {
    // A 周受罚：只发 245、花 294（超支 20%）→ 档位 2 → 350 × 70% ≈ 245（已算好的快照）
    const weekA = mkSettledWeek({
      weekStart: '2026-09-07',
      weekTC: 245,
      spentTC: 294,
      weekOver: 49,
      penaltyTier: 2,
      nextWeekTC: 245,
      nextWeekLT: 6
    })

    // B 周拿到 245，花 200（非零、未超支）→ 档位 0 → 下周回到配置的 350，而不是 245
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: mkWeek({ spent: 200, weekStart: '2026-09-14' }).days,
      weeks: [weekA]
    }
    const next = ensureWeekRollover(state, '2026-09-21') // 补 09-14 这一周
    expect(currentQuota(next)).toEqual({ weekTC: 350, weekLT: 10 })
    expect(next.weeks).toHaveLength(2)
    expect(next.weeks[1].weekTC).toBeCloseTo(245)
    expect(next.weeks[1].spentTC).toBe(200)
    expect(next.weeks[1].penaltyTier).toBe(0)

    // 同一件事在档位 2 上的表现：70% 乘的是配置基础额度，所以是 245 而不是 245 × 70% = 171.5
    const penalised = settleWeek(mkWeek({ spent: 294, weekStart: '2026-09-07', nextWeekTC: 245 }))
    expect(penalised.penaltyTier).toBe(2)
    expect(penalised.nextWeekTC).toBeCloseTo(245)
  })

  it('currentQuota 在没有任何结算时回退到配置值', () => {
    const state: MoneyState = { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [] }
    expect(currentQuota(state)).toEqual({ weekTC: 350, weekLT: 10 })
  })
})

// ============================================================================
// Task 5：派生统计（小组件的数据源）
// ============================================================================

/** 用 `settleDay` 造一天：额度、透支、花费都与实现同源，不手抄。 */
function settledDay(date: string, entries: LedgerEntry[], previousOverdraft = 0): LedgerDay {
  return settleDay({
    date,
    entries,
    previousOverdraft,
    settledAt: `${date}T23:20:00.000Z`,
    config: DEFAULT_MONEY_CONFIG
  })
}

/**
 * 造一个**未结算**的日账本（`settledAt === null`），快照字段一律留 0 ——
 * 现实里也正是如此：快照要等 23:20 的结算才冻结，在那之前钱只能从 `entries` 现算。
 */
function unsettledDay(date: string, entries: LedgerEntry[]): LedgerDay {
  return {
    date,
    settledAt: null,
    entries,
    dayLimit: 0,
    spentTC: 0,
    overdraft: 0,
    deltaLT: 0,
    nightPending: true
  }
}

/** 只带日账本、没有周结算记录的状态：本周额度回落到配置值 350 / 10。 */
function mkMoney(days: LedgerDay[], weeks: WeekSettlement[] = []): MoneyState {
  return { enabled: true, config: DEFAULT_MONEY_CONFIG, days, weeks }
}

/** `selectMoneyStats` 的观察日：2026-09-30（周三），本周周一为 2026-09-28。 */
const TODAY = '2026-09-30'
const THIS_WEEK_START = '2026-09-28'

/**
 * 本周已结算两天、周一一整天空缺：
 * - 周二：一条「没做」+ 一条恰好按计划完成 ⇒ missed 1、efficient 1，花费 10 币；
 * - 周三：一条用了 1.5 倍时长 ⇒ normal，花费 15 币。
 */
const moneyWithTwoSettledDays: MoneyState = (() => {
  const tue = settledDay('2026-09-29', [
    mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 0, done: false }),
    mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 60, done: true })
  ])
  const wed = settledDay(
    '2026-09-30',
    [mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 90, done: true })],
    tue.overdraft
  )
  return mkMoney([tue, wed])
})()

/** 周池为 0 ⇒ 日额度与保底线都是 0，但周一仍然花了 20 币。 */
const moneyWithZeroLimitDay: MoneyState = (() => {
  const config: MoneyConfig = { ...DEFAULT_MONEY_CONFIG, weeklyTC: 0 }
  const mon = settleDay({
    date: THIS_WEEK_START,
    entries: [mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true })],
    previousOverdraft: 0,
    settledAt: `${THIS_WEEK_START}T23:20:00.000Z`,
    config
  })
  return { enabled: true, config, days: [mon], weeks: [] }
})()

/**
 * 账本里的 `sourceId` 指向一个**已不存在**的 `weekEvent.id`。
 *
 * `MoneyState` 里根本没有 `weekEvents`，选择器因此连查找源事件的机会都没有 ——
 * 它只能读条目自身的 `title` / `actualMin` 等快照字段（Review Focus 第 4 条）。
 */
const moneyWithDanglingSourceId: MoneyState = mkMoney([
  settledDay('2026-09-29', [
    mkEntry({
      kind: 'planned',
      sourceId: 'weekEvent-已被删除',
      title: '已删除事件的标题快照',
      plannedMin: 120,
      actualMin: 120,
      done: true
    })
  ])
])

describe('selectMoneyStats', () => {
  it('daily 恒为 7 项，未结算的日子按零计', () => {
    const stats = selectMoneyStats(moneyWithTwoSettledDays, TODAY)
    expect(stats.daily).toHaveLength(7)
    expect(stats.daily[0].ratio).toBe(0)
    expect(stats.daily[0].limit).toBeCloseTo(50)
    expect(stats.daily.map((d) => d.weekday)).toEqual(['一', '二', '三', '四', '五', '六', '日'])
  })

  it('余额 = 额度减本周已花', () => {
    const stats = selectMoneyStats(moneyWithTwoSettledDays, TODAY)
    expect(stats.remainingTC).toBeCloseTo(stats.weekTC - stats.spentTC)
  })

  it('ratio = spentTC / limit，limit 为 0 时不产生 Infinity', () => {
    const stats = selectMoneyStats(moneyWithZeroLimitDay, TODAY)
    expect(Number.isFinite(stats.daily[0].ratio)).toBe(true)
    expect(stats.daily[0].ratio).toBe(0)
  })

  it('quality 四类计数与条目一一对应', () => {
    const stats = selectMoneyStats(moneyWithTwoSettledDays, TODAY)
    expect(stats.quality.missed).toBe(1)
    expect(stats.quality.efficient).toBe(1)
  })

  it('源事件被删除后仍按 title 快照正常计入，不抛错', () => {
    // 该账本里的 sourceId 指向一个已不存在的 weekEvent.id
    const stats = selectMoneyStats(moneyWithDanglingSourceId, TODAY)
    expect(stats.spentTC).toBeGreaterThan(0)
    expect(Number.isFinite(stats.remainingTC)).toBe(true)
    expect(stats.daily.some((d) => d.spentTC > 0)).toBe(true)
  })

  it('daily[i].limit 由 dayLimitOf(前一日透支) 得出，不受受罚周缩水的周额度影响', () => {
    // 周一花 80 币（额度 50）⇒ 透支 30；本周额度被上周的档位 2 压到 245
    const mon = settledDay(THIS_WEEK_START, [
      mkEntry({ kind: 'planned', plannedMin: 480, actualMin: 480, done: true })
    ])
    const stats = selectMoneyStats(
      mkMoney([mon], [mkSettledWeek({ weekStart: '2026-09-21', nextWeekTC: 245, nextWeekLT: 6 })]),
      TODAY
    )

    expect(stats.weekStart).toBe(THIS_WEEK_START)
    expect(stats.weekTC).toBeCloseTo(245)
    expect(stats.weekTC / 7).toBeCloseTo(35) // 按 weekTC / 7 重算就会得到 35
    expect(stats.daily[0].limit).toBe(50) // 日额度是配置派生出的固定值，不受惩罚影响
    expect(stats.daily[1].limit).toBe(20) // 50 − 周一透支的 30
    expect(stats.daily[1].limit).toBe(dayLimitOf(mon.overdraft, DEFAULT_MONEY_CONFIG))
  })

  it('quality：计划外不进任何一类，恰好 1.5 倍算正常，超过 1.5 倍算低效', () => {
    const day = settledDay('2026-09-29', [
      mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 45, done: true }),
      mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 90, done: true }), // 恰好 1.5 倍
      mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 91, done: true }), // 超过 1.5 倍
      mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 0, done: false })
    ])
    const stats = selectMoneyStats(mkMoney([day]), TODAY)
    expect(stats.quality).toEqual({ efficient: 0, normal: 1, inefficient: 1, missed: 1 })
  })

  it('深夜时长与占比、娱币余额都来自本周条目', () => {
    const day = settledDay('2026-09-29', [
      mkEntry({ kind: 'planned', plannedMin: 300, actualMin: 237, nightMin: 30, done: true }), // 高效 ⇒ +0.5
      mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 3, done: true }), // 娱币中性
      mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 0, done: false }) // 没做 ⇒ −1
    ])
    const stats = selectMoneyStats(mkMoney([day]), TODAY)

    expect(stats.nightMin).toBe(30)
    expect(stats.nightRatio).toBeCloseTo(30 / 240) // 237 + 3 分钟实际做事
    expect(stats.weekLT).toBe(10)
    expect(stats.spentLT).toBeCloseTo(-0.5)
    expect(stats.remainingLT).toBeCloseTo(stats.weekLT + stats.spentLT)
  })

  it('penaltyTier 与下周额度是本周花费的实时预演', () => {
    const stats = selectMoneyStats(mkMoney(mkWeek({ spent: 420, weekStart: THIS_WEEK_START }).days), TODAY)

    expect(stats.spentTC).toBe(420)
    expect(stats.weekTC).toBe(350)
    expect(stats.remainingTC).toBeCloseTo(-70)
    expect(stats.penaltyTier).toBe(2) // 超支 70 / 350 = 20%
    expect(stats.nextWeekTC).toBeCloseTo(245) // 350 × 70%
    expect(stats.nextWeekLT).toBeCloseTo(6) // 10 × 60%
  })

  it('只统计本周：上一周的账本不进 daily', () => {
    const stats = selectMoneyStats(mkMoney(mkWeek({ weekStart: '2026-09-21' }).days), TODAY)

    expect(stats.weekStart).toBe(THIS_WEEK_START)
    expect(stats.spentTC).toBe(0)
    expect(stats.daily.map((d) => d.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04'
    ])
    expect(stats.daily.every((d) => d.spentTC === 0 && d.ratio === 0)).toBe(true)
    expect(stats.quality).toEqual({ efficient: 0, normal: 0, inefficient: 0, missed: 0 })
  })

  it('返回的字段与契约逐字一致，且没有 balance 这类冗余余额', () => {
    const stats = selectMoneyStats(moneyWithTwoSettledDays, TODAY)
    expect(Object.keys(stats).sort()).toEqual([
      'daily',
      'nextWeekLT',
      'nextWeekTC',
      'nightMin',
      'nightRatio',
      'penaltyTier',
      'quality',
      'remainingLT',
      'remainingTC',
      'spentLT',
      'spentTC',
      'weekLT',
      'weekStart',
      'weekTC'
    ])
    expect(Object.keys(stats.daily[0]).sort()).toEqual(['date', 'limit', 'ratio', 'spentTC', 'weekday'])
  })

  it('未结算的日：钱按条目现算，与当天的质量计数同源', () => {
    // 今天（周三）已经记了一条 2 小时的计划内条目，但还没结算
    const today = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true })
    ])
    const stats = selectMoneyStats(mkMoney([today]), TODAY)

    // 快照字段全是 0，若读快照就会得到 0 —— 必须由条目现算，否则「执行质量」会动而「本周已用」不动
    expect(stats.daily[2].spentTC).toBe(20)
    expect(stats.daily[2].ratio).toBeCloseTo(20 / 50)
    expect(stats.quality.efficient).toBe(1)
    expect(stats.spentTC).toBe(20)
    expect(stats.remainingTC).toBeCloseTo(350 - 20)
  })

  it('已结算的日：冻结快照优先，即使与条目重算的结果不符也不改写', () => {
    // 故意造一份不一致的账本：条目重算该得 20 币 / +0.5 娱币，快照却冻结在 7 币 / 0
    const frozen: LedgerDay = {
      ...settledDay('2026-09-29', [
        mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true })
      ]),
      spentTC: 7,
      deltaLT: 0
    }
    const stats = selectMoneyStats(mkMoney([frozen]), TODAY)

    expect(
      frozen.entries.reduce(
        (sum, e) => sum + costOfEntry({ actualMin: e.actualMin, nightMin: e.nightMin }, DEFAULT_MONEY_CONFIG),
        0
      )
    ).toBe(20) // 条目确实值 20 币……

    expect(stats.daily[1].spentTC).toBe(7) // ……但已结算的日只认快照
    expect(stats.spentTC).toBe(7)
    expect(stats.spentLT).toBe(0) // 条目重算该是 +0.5，快照说了算
    expect(stats.remainingTC).toBeCloseTo(350 - 7)
  })

  it('未结算的日超额度时，它现算出的透支要带入次日额度', () => {
    // 周三（未结算）按条目现算出 80 币 > 日额度 50 ⇒ 透支 30 ⇒ 周四额度该是 20
    const wed = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 480, actualMin: 480, done: true })
    ])
    const stats = selectMoneyStats(mkMoney([wed]), TODAY)

    expect(stats.daily[2].spentTC).toBe(80)
    expect(stats.daily[2].limit).toBe(50) // 当天额度由传入的透支 0 决定
    expect(stats.daily[2].ratio).toBeCloseTo(80 / 50)
    expect(stats.daily[3].limit).toBe(20) // 50 − 30，透支必须传下去
  })

  it('未结算的日没超额度时，次日额度不受影响', () => {
    // 对照：同样未结算，只花 20 币（未过 50），次日额度仍是满额
    const wed = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true })
    ])
    const stats = selectMoneyStats(mkMoney([wed]), TODAY)

    expect(stats.daily[2].spentTC).toBe(20)
    expect(stats.daily[3].limit).toBe(50)
  })
})

// ============================================================================
// Task 8：待结算判定（日结卡片的唯一数据源）
// ============================================================================

/**
 * 混合账本：周六已结算、周日与周一未结算、周二（今天）未结算。
 *
 * 观察日取 `TODAY`（2026-09-30，周三）。这里故意让「今天」也留一条未结算记录——
 * 就是要证明待结算的判定**不能只看向 `settledAt`**，还必须把「今天尚未结束」排除掉。
 */
const moneyWithMixedDays: MoneyState = mkMoney([
  settledDay('2026-09-27', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
  unsettledDay('2026-09-28', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
  unsettledDay('2026-09-29', [mkEntry({ actualMin: 0, plannedMin: 60, done: false })]),
  unsettledDay('2026-09-30', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
])

/** 只有今天一条未结算记录：不应有任何待结算。 */
const moneyWithTodayOnly: MoneyState = mkMoney([
  unsettledDay('2026-09-30', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
])

describe('pendingDays', () => {
  it('待结算 = 早于今天且 settledAt 为 null 的日子，按升序', () => {
    expect(pendingDays(moneyWithMixedDays, '2026-09-30')).toEqual(['2026-09-28', '2026-09-29'])
  })

  it('今天尚未结束，不计入待结算', () => {
    expect(pendingDays(moneyWithTodayOnly, '2026-09-30')).toEqual([])
  })

  it('全部已结算时为空', () => {
    const allSettled = mkMoney([
      settledDay('2026-09-28', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      settledDay('2026-09-29', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    ])
    expect(pendingDays(allSettled, '2026-09-30')).toEqual([])
  })

  it('账本里日期乱序时，返回值仍按升序', () => {
    // 契约里 days 按 date 升序，但选择器不该依赖调用方守约：这里故意倒着放
    const shuffled = mkMoney([unsettledDay('2026-09-29', []), unsettledDay('2026-09-27', [])])
    expect(pendingDays(shuffled, '2026-09-30')).toEqual(['2026-09-27', '2026-09-29'])
  })

  it('没有账本时为空', () => {
    expect(pendingDays(mkMoney([]), '2026-09-30')).toEqual([])
  })
})
