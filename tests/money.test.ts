import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LedgerDay,
  LedgerEntry,
  MoneyConfig,
  MoneyState,
  Quadrant,
  WeekSettlement
} from '../src/shared/types'
import { defaultData } from '../src/shared/defaults'
import { addDays, dateKey, parseDateKey } from '../src/shared/dateKey'
import {
  DEFAULT_MONEY_CONFIG,
  abandonExpiredDays,
  consumptionDeltaLT,
  costOfEntry,
  currentQuota,
  dayLimitOf,
  ensureLedgerDays,
  ensureWeekRollover,
  isFreeUnplannedSettlement,
  leisureDelta,
  nightMinutesOf,
  openNightsBefore,
  penaltyTierOf,
  pendingDays,
  previousLatePhone,
  restDayCost,
  selectMoneyStats,
  settleDay,
  settleWeek
} from '../src/shared/money'

/*
 * 「开关写入 enabledAt」那一组是**唯一的** store 级用例 —— 其余全是纯函数。
 * `appStore` 顶层（间接）import 了 `cloudSync2`，而后者在顶层就 `createClient(...)`，
 * 在没有原生 `WebSocket` 的环境（CI 锁 Node 20）一 import 就抛，会把整个套件拖垮。
 * 用同名 mock 把那棵树隔掉（与 tests/cloudGuard.test.ts 同一手法）。
 */
const moneyCloud = vi.hoisted(() => ({
  pushCloudData: vi.fn(),
  fetchCloudData: vi.fn(),
  fetchCloudMeta: vi.fn(),
  hasCloudSession: vi.fn(),
  announceSync: vi.fn()
}))
vi.mock('../src/renderer/src/lib/cloudSync2', () => moneyCloud)

import { useAppStore } from '../src/renderer/src/state/appStore'

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
 * `quadrant` 默认**刻意留 null**（→ 计费倍率 1.0，中性）：夹具不替调用方编造象限，
 * 于是所有既有用例仍在验证「时长 × 基准费率」这条公式本身，而不是被象限倍率悄悄改写。
 * 象限倍率由 `costOfEntry` 的专门用例覆盖，另加一组「两个调用点同口径」的集成用例。
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
 * - 单日花费 110 / 50 / 50 / 50 / 40 / 0 / 0 —— 只有周一超过日软上限 80 ⇒ `overLimitDays = 1`；
 * - 周二固定挂特征条目：一条 45 分钟计划外（8 币）⇒ `unplannedCount = 1`、`unplannedMin = 45`，
 *   一条 30 分钟深夜（42 币）⇒ `nightMin = 30`，两条合计 50 币，与该日耗费恰好相等；
 * - 周六是「没做」那天 ⇒ `missCount = 1`。
 *
 * 每天的 `spentTC` 与当天条目 `costOfEntry` 之和**严格相等**：`spent` 与 300 的差额全部
 * 记在周一的填充条目上（按 100 币一段拆分，满足 600 分钟的域上限），
 * `dayLimit` / `overdraft` 按 `dayLimitOf` 逐日滚动 —— 与 `settleDay` 同算法。
 * 想精确控制某天的花费就用 `spent`：周一那天的花费恒为 `spent − 190`。
 *
 * 日软上限（80）与保底线（16）现在由 `dailyCapTC` 直读；默认 `spent = 300` 时周一 110
 * 只透支到 30，周二 50 恰好用满自己的额度，于是「只算周一超限」与「凡
 * `spentTC > day.dayLimit` 就算超限」在这里仍分道扬镳（后者会在 `spent` 更大的用例里
 * 数出更多天）。日上限与周总额解耦这件事由专门的判别器用例覆盖，不依赖本夹具。
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
      videoMin: 0,
      gameMin: 0,
      latePhone: false,
      dayLimit,
      spentTC: daySpend,
      overdraft,
      deltaLT: 0,
      nightPending: false,
      isRestDay: false
    })
    previousOverdraft = overdraft
  }

  return {
    weekStart,
    weekEnd: dateKey(addDays(monday, 6)),
    days,
    weekTC: over.nextWeekTC ?? 560,
    weekLT: over.nextWeekLT ?? 20,
    config: DEFAULT_MONEY_CONFIG
  }
}

/**
 * 一个**已算好**的 `WeekSettlement`，供跨周滚动与 Task 10 复用。
 *
 * 默认即一份空周结果：花费 0、档位 0、下周额度回到配置值 560 / 20。
 */
function mkSettledWeek(over: Partial<WeekSettlement> = {}): WeekSettlement {
  const weekStart = over.weekStart ?? FIXTURE_WEEK_START
  return {
    weekStart,
    weekEnd: dateKey(addDays(parseDateKey(weekStart), 6)),
    weekTC: 560,
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
    nextWeekTC: 560,
    nextWeekLT: 20,
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
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 2 }, DEFAULT_MONEY_CONFIG)).toBe(20)
  })

  it('深夜倍率只作用于落在深夜区间的那部分分钟数', () => {
    // 120 分钟中 60 分钟在深夜：(60 + 60 × 1.5) / 60 × 10 = 25
    expect(costOfEntry({ actualMin: 120, nightMin: 60, quadrant: 2 }, DEFAULT_MONEY_CONFIG)).toBe(25)
    expect(costOfEntry({ actualMin: 120, nightMin: 120, quadrant: 2 }, DEFAULT_MONEY_CONFIG)).toBe(30)
  })

  it('实际时长为 0 时不产生费用', () => {
    expect(costOfEntry({ actualMin: 0, nightMin: 0, quadrant: 2 }, DEFAULT_MONEY_CONFIG)).toBe(0)
  })

  it('象限倍率：同样 120 分钟 0 深夜，Q1 30、Q3 24、Q2 20、Q4 10', () => {
    // 基准 base = 120 / 60 × 10 = 20，再乘各自倍率
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 1 }, DEFAULT_MONEY_CONFIG)).toBe(30)
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 3 }, DEFAULT_MONEY_CONFIG)).toBe(24)
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 2 }, DEFAULT_MONEY_CONFIG)).toBe(20)
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 4 }, DEFAULT_MONEY_CONFIG)).toBe(10)
  })

  it('Q3（不重要但紧急）刻意比 Q2（重要不紧急）贵：24 > 20', () => {
    // 用户取向是「紧急 > 重要」——系统对「被紧急事推着走」收得更贵，这正是
    // 艾森豪威尔矩阵要纠正的那件事。实现时不得「顺手修正」这个大小关系。
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 3 }, DEFAULT_MONEY_CONFIG)).toBe(24)
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 2 }, DEFAULT_MONEY_CONFIG)).toBe(20)
  })

  it('深夜倍率与象限倍率相乘：120 分钟全深夜、Q1 ⇒ round((120×1.5/60×10)×1.5) = 45', () => {
    expect(costOfEntry({ actualMin: 120, nightMin: 120, quadrant: 1 }, DEFAULT_MONEY_CONFIG)).toBe(45)
  })

  it('quadrant 为 null 时取中性 1.0（stub 令 q2 ≠ 1，避免与 Q2 撞数而无法判别）', () => {
    // 无象限的条目（计划外，或计划内但没记录象限）不带价值信号 → 中性。
    // 默认配置里 q2 恰好也是 1.0，于是「null 得 20」**区分不出**「走 null 中性分支」与
    // 「误把 null 当成 q2」。这里把 q2 换成一个不等于 1 的值，让两条分支彻底分开：
    // null 的结果必须仍等于 round(base × 1)，与 q2 的取值无关。
    const stub: MoneyConfig = {
      ...DEFAULT_MONEY_CONFIG,
      // 必须再 spread 一层：`{ ...DEFAULT_MONEY_CONFIG }` 的嵌套对象仍是共享引用。
      quadrantMultiplier: { ...DEFAULT_MONEY_CONFIG.quadrantMultiplier, q2: 9 }
    }
    const base = (120 / 60) * DEFAULT_MONEY_CONFIG.tcPerHour // 20
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: null }, stub)).toBe(Math.round(base * 1))
    // 判别器自检：同一 stub 下 q2 明确走 9 倍 —— 证明这个 stub 确实把 null 与 q2 分开了
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 2 }, stub)).toBe(Math.round(base * 9))
    // stub 不得污染共享常量
    expect(DEFAULT_MONEY_CONFIG.quadrantMultiplier.q2).toBe(1)
  })

  it('倍率链是显式的：意外象限值按中性 1.0 计价，而不是静默落到 Q4 的 0.5 倍', () => {
    // 类型上 quadrant ∈ {1,2,3,4}，但运行时数据来自持久化 / 云端，可能是任何值。
    // 若倍率链以 `else → q4` 收尾，`undefined` 这类意外值会被当成 Q4 定价（10 币），
    // 与函数自述的「没有信号 → 中性 1.0」直接矛盾。这里把它钉死在中性价上。
    const unexpected = undefined as unknown as Quadrant
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: unexpected }, DEFAULT_MONEY_CONFIG)).toBe(20)
    // 合法的 Q4 仍然必须走 0.5 倍 —— 显式化不能把 Q4 也一起中性化
    expect(costOfEntry({ actualMin: 120, nightMin: 0, quadrant: 4 }, DEFAULT_MONEY_CONFIG)).toBe(10)
  })
})

// ============================================================================
// Task R2-C：娱币的两条纯消费来源（刷视频 / 打游戏）
// ============================================================================

/**
 * 两条消费**只扣娱币、不产生任何时币**，且在**结算时**由用户当场回答、不预先计划。
 * 公式逐字取自 spec：`−(videoMin / 60 × videoLTPerHour) − (gameMin / 60 × gameLTPerHour)`。
 */
describe('consumptionDeltaLT', () => {
  it('刷视频 60 分钟 → −1（60 / 60 × 1）', () => {
    expect(consumptionDeltaLT({ videoMin: 60, gameMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(-1)
  })

  it('打游戏 120 分钟 → −3（120 / 60 × 1.5）', () => {
    expect(consumptionDeltaLT({ videoMin: 0, gameMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(-3)
  })

  it('两者合计 → −4', () => {
    expect(consumptionDeltaLT({ videoMin: 60, gameMin: 120 }, DEFAULT_MONEY_CONFIG)).toBe(-4)
  })

  it('都没发生时为 0（不产生 −0）', () => {
    expect(consumptionDeltaLT({ videoMin: 0, gameMin: 0 }, DEFAULT_MONEY_CONFIG)).toBe(0)
  })

  it('分钟数与费率相乘：30 视频 + 30 游戏 → −(0.5 + 0.75)', () => {
    expect(consumptionDeltaLT({ videoMin: 30, gameMin: 30 }, DEFAULT_MONEY_CONFIG)).toBe(-1.25)
  })

  it('两条费率取自 config，不是写死的常量', () => {
    // 判别器：把两条费率换成非默认值，结果必须跟着变
    const config: MoneyConfig = {
      ...DEFAULT_MONEY_CONFIG,
      videoLTPerHour: 2,
      gameLTPerHour: 3
    }
    expect(consumptionDeltaLT({ videoMin: 60, gameMin: 60 }, config)).toBe(-5) // −2 − 3
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
  it('无透支时当日额度等于配置的独立字段 dailyCapTC（不再由周总额派生）', () => {
    expect(dayLimitOf(0, DEFAULT_MONEY_CONFIG)).toBe(80)
  })

  it('日软上限直读 dailyCapTC：把周总额换成一个除不尽 7 的数，额度纹丝不动', () => {
    // 判别器。560 / 7 恰好也是 80，所以「等于 80」本身区分不出「派生」与「直读」——
    // 必须让 weeklyTC 与 dailyCapTC 不相等，才能证明这里读的是独立字段。
    const oddWeek: MoneyConfig = { ...DEFAULT_MONEY_CONFIG, weeklyTC: 999 }
    expect(dayLimitOf(0, oddWeek)).toBe(80)
  })

  it('透支从次日额度扣除，且不击穿保底线', () => {
    expect(dayLimitOf(30, DEFAULT_MONEY_CONFIG)).toBe(50)
    expect(dayLimitOf(999, DEFAULT_MONEY_CONFIG)).toBe(16) // 80 × 0.2
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
    expect(day.dayLimit).toBe(80)
  })

  it('超限日的透支等于花费减额度', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 600, plannedMin: 600, done: true })], // 100 币 > 日上限 80
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.overdraft).toBe(20)
  })

  it('自修复：透支一天后正常消费，第三天额度恢复', () => {
    const d1 = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 600, plannedMin: 600, done: true })], // 100 币 ⇒ 透支 20
      config: DEFAULT_MONEY_CONFIG
    })
    const d2 = settleDay({
      date: '2026-09-29',
      previousOverdraft: d1.overdraft,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(d2.dayLimit).toBe(60) // 80 − 20
    expect(d2.overdraft).toBe(0)
    expect(dayLimitOf(d2.overdraft, DEFAULT_MONEY_CONFIG)).toBe(80)
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

  it('空的一天：花费与透支均为 0，额度仍为 80', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      videoMin: 0,
      gameMin: 0,
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.spentTC).toBe(0)
    expect(day.overdraft).toBe(0)
    expect(day.dayLimit).toBe(80)
    expect(day.deltaLT).toBe(0)
  })

  it('两条纯消费折进 deltaLT：刷视频 60 + 打游戏 120 ⇒ deltaLT = −4', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      videoMin: 60,
      gameMin: 120,
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.deltaLT).toBe(-4)
  })

  it('消费与条目娱币叠加：高效条目 +0.5 与刷视频 60 分钟 ⇒ −0.5', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ done: true, actualMin: 60, plannedMin: 60 })],
      videoMin: 60,
      gameMin: 0,
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.deltaLT).toBe(-0.5)
  })

  it('消费**不改变** spentTC：刷视频 / 打游戏只扣娱币', () => {
    const withConsumption = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })],
      videoMin: 600,
      gameMin: 600,
      config: DEFAULT_MONEY_CONFIG
    })
    const withoutConsumption = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })],
      videoMin: 0,
      gameMin: 0,
      config: DEFAULT_MONEY_CONFIG
    })
    // 时币花费与消费无关：两天的 spentTC / overdraft / dayLimit 逐字相同
    expect(withConsumption.spentTC).toBe(20)
    expect(withConsumption.spentTC).toBe(withoutConsumption.spentTC)
    expect(withConsumption.overdraft).toBe(withoutConsumption.overdraft)
    expect(withConsumption.dayLimit).toBe(withoutConsumption.dayLimit)
    // 娱币则明确不同：条目高效 +0.5，叠加消费 −(10 × 1) − (10 × 1.5) = −25 ⇒ −24.5
    expect(withConsumption.deltaLT).toBe(-24.5)
    expect(withoutConsumption.deltaLT).toBe(0.5)
  })

  it('结算快照原样带上 videoMin / gameMin（持久化字段）', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      videoMin: 45,
      gameMin: 15,
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.videoMin).toBe(45)
    expect(day.gameMin).toBe(15)
  })

  it('消费**不进** quality 四分类（那四类只谈计划 vs 实际的工作质量）', () => {
    const day = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      videoMin: 60,
      gameMin: 120,
      config: DEFAULT_MONEY_CONFIG
    })
    const stats = selectMoneyStats(mkMoney([day]), TODAY)
    expect(stats.quality).toEqual({ efficient: 0, normal: 0, inefficient: 0, missed: 0 })
    // 但娱币余额确实被消费拉低了：settled 日读冻结快照 deltaLT
    expect(stats.spentLT).toBe(-4)
    expect(stats.remainingLT).toBeCloseTo(20 - 4)
    // 消费也完全不影响时币
    expect(stats.spentTC).toBe(0)
  })

  it('未结算的日：消费同样计入现算的 spentLT，且不碰 spentTC', () => {
    // 面板在结算前先把两问写进日账本时，未结算的那天也必须立刻反映消费 ——
    // selectMoneyStats 的未结算支路声明「按 settleDay 同一套算法现算」，就得含这一项。
    const wed: LedgerDay = { ...unsettledDay('2026-09-30', []), videoMin: 60, gameMin: 120 }
    const stats = selectMoneyStats(mkMoney([wed]), TODAY)
    expect(stats.spentLT).toBe(-4)
    expect(stats.spentTC).toBe(0)
    expect(stats.daily[2].spentTC).toBe(0)
  })

  it('同一条消费，已结算与未结算给出同一个 spentLT（两个派生口径同口径）', () => {
    const settled = selectMoneyStats(
      mkMoney([
        settleDay({
          date: '2026-09-30',
          entries: [],
          previousOverdraft: 0,
          settledAt: 'x',
          videoMin: 60,
          gameMin: 120,
          config: DEFAULT_MONEY_CONFIG
        })
      ]),
      TODAY
    )
    const unsettled = selectMoneyStats(
      mkMoney([{ ...unsettledDay('2026-09-30', []), videoMin: 60, gameMin: 120 }]),
      TODAY
    )
    expect(settled.spentLT).toBe(-4)
    expect(unsettled.spentLT).toBe(-4)
    expect(settled.spentLT).toBe(unsettled.spentLT)
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
        (sum, e) =>
          sum + costOfEntry({ actualMin: e.actualMin, nightMin: e.nightMin, quadrant: e.quadrant }, DEFAULT_MONEY_CONFIG),
        0
      )
    ).toBe(day.spentTC)
  })
})

// ============================================================================
// Task R2-E：休息日（无计划之日的两条分支之一，spec R2 §4.3 / §9.2）
// ============================================================================

describe('restDayCost', () => {
  it('= round(dailyCapTC × restDayFactor)：默认 80 × 0.8 = 64', () => {
    expect(restDayCost(DEFAULT_MONEY_CONFIG)).toBe(64)
  })

  it('两个因子都取自 config，而不是写死的 64', () => {
    expect(restDayCost({ ...DEFAULT_MONEY_CONFIG, dailyCapTC: 90, restDayFactor: 0.5 })).toBe(45)
    expect(restDayCost({ ...DEFAULT_MONEY_CONFIG, dailyCapTC: 35, restDayFactor: 1 })).toBe(35)
  })

  it('四舍五入到整数：50 × 0.35 = 17.5 → 18（不是截断成 17）', () => {
    expect(restDayCost({ ...DEFAULT_MONEY_CONFIG, dailyCapTC: 50, restDayFactor: 0.35 })).toBe(18)
  })
})

// ============================================================================
// 免费的无计划日守卫（spec R2 §4.3 / §9.2 的闭环）
// ============================================================================

describe('isFreeUnplannedSettlement（无计划之日不得以 0 花费结算）', () => {
  it('空条目集 ⇒ true：这就是「无计划日直接提交」那条要给堵掉的免费路', () => {
    expect(isFreeUnplannedSettlement([], DEFAULT_MONEY_CONFIG)).toBe(true)
  })

  it('只有一条 0 分钟的计划外条目 ⇒ 仍是 true：复现「把时长改成 0」的漏洞现场', () => {
    const zero = mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 0 })
    // 漏洞现场：settleDay 确实会把它结算成 0 花费（这正是面板提交按钮漏出去的价）……
    const settled = settleDay({
      date: '2026-09-28',
      entries: [zero],
      previousOverdraft: 0,
      settledAt: 'x',
      config: DEFAULT_MONEY_CONFIG
    })
    expect(settled.spentTC).toBe(0)
    // ……所以必须由本函数把它判成「免费的无计划日」而被拒绝。
    expect(isFreeUnplannedSettlement([zero], DEFAULT_MONEY_CONFIG)).toBe(true)
  })

  it('判据比的是花费不是时长：1 分钟的计划外条目计费后仍是 0 币，故也是 true', () => {
    const tiny = mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 1 })
    expect(costOfEntry({ actualMin: 1, nightMin: 0, quadrant: null }, DEFAULT_MONEY_CONFIG)).toBe(0)
    expect(isFreeUnplannedSettlement([tiny], DEFAULT_MONEY_CONFIG)).toBe(true)
  })

  it('真有花费的计划外条目 ⇒ false：无计划之日只要确实花了时币就不拦', () => {
    const real = mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 30 })
    expect(isFreeUnplannedSettlement([real], DEFAULT_MONEY_CONFIG)).toBe(false)
  })

  it('只要有一条计划内条目 ⇒ false，哪怕它花费为 0（计划日的免费路不归这条规则管）', () => {
    const missed = mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 0, done: false })
    expect(isFreeUnplannedSettlement([missed], DEFAULT_MONEY_CONFIG)).toBe(false)
  })

  it('只看条目自身的花费，不含昨夜连带扣款：不能拿「昨夜刷手机」凑出非零花费蒙混过关', () => {
    // 前一日答「有」只让**次日**多扣 latePhoneTC，与今天的条目花费无关。若把连带扣款算进来，
    // 「刷完手机 + 今天空着」就能凑出一个 >0 的花费、以低于休息日的价格过关 —— 正是要堵的路。
    const zero = mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 0 })
    expect(DEFAULT_MONEY_CONFIG.latePhoneTC).toBeGreaterThan(0)
    expect(isFreeUnplannedSettlement([zero], DEFAULT_MONEY_CONFIG)).toBe(true)
  })

  it('花费逐条由 costOfEntry 现算、随 config 变：费率归零后同一份条目才变免费', () => {
    const real = mkEntry({ kind: 'unplanned', plannedMin: null, actualMin: 30 })
    expect(isFreeUnplannedSettlement([real], { ...DEFAULT_MONEY_CONFIG, tcPerHour: 0 })).toBe(true)
    expect(isFreeUnplannedSettlement([real], DEFAULT_MONEY_CONFIG)).toBe(false)
  })
})

describe('settleDay · 休息日分支', () => {
  const base = {
    date: '2026-09-28',
    previousOverdraft: 0,
    settledAt: '2026-09-28T23:20:00.000Z',
    config: DEFAULT_MONEY_CONFIG
  }

  it('休息日：固定扣 64、娱币不动、条目为空、isRestDay 为 true、settledAt 正常写入', () => {
    const day = settleDay({ ...base, entries: [], isRestDay: true })
    expect(day.spentTC).toBe(64)
    expect(day.deltaLT).toBe(0)
    expect(day.entries).toEqual([])
    expect(day.isRestDay).toBe(true)
    expect(day.settledAt).toBe(base.settledAt)
    expect(day.date).toBe(base.date)
    expect(day.dayLimit).toBe(80)
    expect(day.overdraft).toBe(0)
  })

  it('对照组：其余入参完全相同、只是没有 isRestDay ⇒ spentTC = 0（休息日不是默认）', () => {
    const day = settleDay({ ...base, entries: [] })
    expect(day.spentTC).toBe(0)
    expect(day.isRestDay).toBe(false)
  })

  it('休息日的花费与条目 / 两条纯消费无关：传进来也一律不采纳（重跑不能把它抹掉）', () => {
    const day = settleDay({
      ...base,
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })],
      videoMin: 60,
      gameMin: 120,
      isRestDay: true
    })
    expect(day.spentTC).toBe(64)
    expect(day.deltaLT).toBe(0)
    expect(day.entries).toEqual([])
    expect(day.videoMin).toBe(0)
    expect(day.gameMin).toBe(0)
  })

  it('休息日不可重结：nightPending 置 false，因此不会被 openNightsBefore 选中', () => {
    const rest = settleDay({ ...base, entries: [], isRestDay: true })
    expect(rest.nightPending).toBe(false)
    const later = unsettledDay('2026-09-29', [])
    expect(openNightsBefore([rest, later], '2026-09-29')).toEqual([])
    // 判别器：一个已结算但仍挂 nightPending 的日子**确实**会被选中 ——
    // 证明「选不中」是 nightPending=false 的功劳，不是 openNightsBefore 恰好空转。
    const stillOpen: LedgerDay = { ...rest, nightPending: true }
    expect(openNightsBefore([stillOpen, later], '2026-09-29').map((d) => d.date)).toEqual([
      '2026-09-28'
    ])
  })

  it('休息日被整日重跑（confirmNight 的路径）后仍是休息日，不会退化成 0 花费的普通日', () => {
    const original = settleDay({ ...base, entries: [], isRestDay: true })
    // confirmNight 会把原条目 + 补记条目一起交回来、并透传 day.isRestDay
    const recomputed = settleDay({
      ...base,
      entries: [
        ...original.entries,
        mkEntry({ kind: 'unplanned', actualMin: 30, plannedMin: null, done: true })
      ],
      settledAt: original.settledAt ?? base.settledAt,
      isRestDay: original.isRestDay
    })
    expect(recomputed.isRestDay).toBe(true)
    expect(recomputed.spentTC).toBe(64)
    expect(recomputed.deltaLT).toBe(0)
    expect(recomputed.entries).toEqual([])
  })

  it('休息日计入透支：前一日透支 30 ⇒ 当日额度 50、透支 14', () => {
    const day = settleDay({ ...base, entries: [], previousOverdraft: 30, isRestDay: true })
    expect(day.dayLimit).toBe(50)
    expect(day.overdraft).toBe(14)
  })

  it('休息日的花费由 config 派生：改 restDayFactor ⇒ 结果随之改变', () => {
    const day = settleDay({
      ...base,
      entries: [],
      isRestDay: true,
      config: { ...DEFAULT_MONEY_CONFIG, restDayFactor: 0.5 }
    })
    expect(day.spentTC).toBe(40)
  })

  it('有计划的日子的结算数据里不出现休息日产物（休息日不是默认计价）', () => {
    const day = settleDay({
      ...base,
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true })]
    })
    expect(day.isRestDay).toBe(false)
    expect(day.spentTC).toBe(20) // 条目之和，不是 64
    expect(day.entries).toHaveLength(1)
  })

  it('selectMoneyStats：休息日按冻结快照计 64 币、娱币 0，且不产生质量分类 / 深夜计数', () => {
    const rest = settleDay({
      date: '2026-09-29',
      entries: [],
      previousOverdraft: 0,
      settledAt: 'x',
      isRestDay: true,
      config: DEFAULT_MONEY_CONFIG
    })
    const stats = selectMoneyStats(mkMoney([rest]), TODAY)
    expect(stats.spentTC).toBe(64)
    expect(stats.spentLT).toBe(0)
    expect(stats.quality).toEqual({ efficient: 0, normal: 0, inefficient: 0, missed: 0 })
    expect(stats.nightMin).toBe(0)
  })
})

// ============================================================================
// Task R2-F：深夜刷手机的次日连带扣款（spec R2 §6）
// ============================================================================

/**
 * 连带扣款用一份**独立标定**的 config 来测。
 *
 * `latePhoneTC` / `latePhoneLT` 是用户只说「大量」而未定数的**占位值**，随时可能被重新定标。
 * 所以这里既不写死默认的 40 / 2，也不用默认 config —— 换一组与默认值、与其他任何字段都
 * 不相同的数（7 / 1.25）。逻辑若偷偷写死 40 / 2，这些断言会当场失败；默认值重定标也不会
 * 让用例「假绿」。
 */
const LATE_CONFIG: MoneyConfig = {
  ...DEFAULT_MONEY_CONFIG,
  latePhoneTC: 7,
  latePhoneLT: 1.25
}

/** 把一份日账本按自定义 config 包成 `MoneyState`（`mkMoney` 固定用默认 config）。 */
function moneyWithConfig(days: LedgerDay[], config: MoneyConfig): MoneyState {
  return { enabled: true, config, days, weeks: [] }
}

describe('settleDay · 深夜刷手机的次日连带扣款', () => {
  it('答「有」的**次日**扣款：spentTC 加 latePhoneTC、deltaLT 减 latePhoneLT', () => {
    const next = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    expect(next.spentTC).toBe(LATE_CONFIG.latePhoneTC)
    expect(next.deltaLT).toBe(-LATE_CONFIG.latePhoneLT)
  })

  it('扣款只落次日：D 自己记下答案，但 D 的 spentTC / deltaLT 都不变', () => {
    const same = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    expect(same.spentTC).toBe(0)
    expect(same.deltaLT).toBe(0)
    // 答案被持久化下来，等次日结算时兑现
    expect(same.latePhone).toBe(true)
  })

  it('两端对照：前一日答「有」才扣、答「无」不扣', () => {
    const yes = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    const no = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      previousLatePhone: false,
      config: LATE_CONFIG
    })
    expect(no.spentTC).toBe(0)
    expect(no.deltaLT).toBe(0)
    expect(yes.spentTC - no.spentTC).toBe(LATE_CONFIG.latePhoneTC)
    expect(no.deltaLT - yes.deltaLT).toBe(LATE_CONFIG.latePhoneLT)
  })

  it('没有前一日（缺省 previousLatePhone）⇒ 一分不扣，绝不凭空扣一笔', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      config: LATE_CONFIG
    })
    expect(day.spentTC).toBe(0)
    expect(day.deltaLT).toBe(0)
    // 未记录答案的缺省也是「否」
    expect(day.latePhone).toBe(false)
  })

  it('答案作为持久化字段落进快照：缺省即 false，显式「有」即 true', () => {
    const no = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      config: LATE_CONFIG
    })
    const yes = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    expect(no.latePhone).toBe(false)
    expect(yes.latePhone).toBe(true)
  })

  it('连带扣款计入 spentTC 因而推动 overdraft（ruling 2：它是「那天花掉的钱」）', () => {
    // 条目花掉 76 币（未过日上限 80），再叠一笔前夜连带扣款 7 ⇒ 83 > 80 ⇒ 透支 3
    const withNo = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: fillerEntries(76),
      previousLatePhone: false,
      config: LATE_CONFIG
    })
    const withYes = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: fillerEntries(76),
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    expect(withNo.spentTC).toBe(76)
    expect(withNo.overdraft).toBe(0)
    expect(withYes.spentTC).toBe(76 + LATE_CONFIG.latePhoneTC)
    expect(withYes.overdraft).toBe(76 + LATE_CONFIG.latePhoneTC - LATE_CONFIG.dailyCapTC)
  })

  it('连带扣款把一天推进「超日上限」：settleWeek 的 overLimitDays 因此 +1', () => {
    const base = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: fillerEntries(76),
      previousLatePhone: false,
      config: LATE_CONFIG
    })
    const penalized = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: fillerEntries(76),
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    const week = (day: LedgerDay): WeekSettlement =>
      settleWeek({
        weekStart: '2026-09-28',
        weekEnd: '2026-10-04',
        days: [day],
        weekTC: LATE_CONFIG.weeklyTC,
        weekLT: LATE_CONFIG.weeklyLT,
        config: LATE_CONFIG
      })
    expect(base.spentTC).toBeLessThanOrEqual(LATE_CONFIG.dailyCapTC)
    expect(week(base).overLimitDays).toBe(0)
    expect(week(penalized).overLimitDays).toBe(1)
  })

  it('休息日也不能免除连带扣款：spentTC = restDayCost + latePhoneTC，娱币照样扣', () => {
    const rest = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      isRestDay: true,
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    expect(rest.isRestDay).toBe(true)
    expect(rest.spentTC).toBe(restDayCost(LATE_CONFIG) + LATE_CONFIG.latePhoneTC)
    expect(rest.deltaLT).toBe(-LATE_CONFIG.latePhoneLT)
  })

  it('对照：休息日 + 前一日答「无」⇒ 只有 restDayCost，娱币为 0', () => {
    const rest = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      isRestDay: true,
      previousLatePhone: false,
      config: LATE_CONFIG
    })
    expect(rest.spentTC).toBe(restDayCost(LATE_CONFIG))
    expect(rest.deltaLT).toBe(0)
  })

  it('休息日也会**记录**答案：休息日的 latePhone 同样扣到它次日头上', () => {
    const rest = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      isRestDay: true,
      latePhone: true,
      config: LATE_CONFIG
    })
    expect(rest.latePhone).toBe(true)
    const next = settleDay({
      date: '2026-09-29',
      previousOverdraft: rest.overdraft,
      settledAt: 'x',
      entries: [],
      previousLatePhone: rest.latePhone,
      config: LATE_CONFIG
    })
    expect(next.spentTC).toBe(LATE_CONFIG.latePhoneTC)
  })

  it('整日重跑（confirmNight 路径）既不会扣两次、也不会丢：重跑结果与原快照逐字相同', () => {
    const original = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 60, plannedMin: 60, done: true })],
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    const rerun = settleDay({
      date: original.date,
      previousOverdraft: 0,
      settledAt: original.settledAt ?? 'x',
      entries: original.entries,
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    expect(original.spentTC).toBe(10 + LATE_CONFIG.latePhoneTC)
    expect(rerun.spentTC).toBe(original.spentTC)
    expect(rerun.deltaLT).toBe(original.deltaLT)
  })

  it('休息日的连带扣款在整日重跑后仍然自洽（重跑必须透传 previousLatePhone）', () => {
    const original = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      isRestDay: true,
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    const rerun = settleDay({
      date: original.date,
      previousOverdraft: 0,
      settledAt: original.settledAt ?? 'x',
      entries: original.entries,
      isRestDay: original.isRestDay,
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    expect(original.spentTC).toBe(restDayCost(LATE_CONFIG) + LATE_CONFIG.latePhoneTC)
    expect(rerun.spentTC).toBe(original.spentTC)
    expect(rerun.deltaLT).toBe(original.deltaLT)
  })

  it('Rider A：重跑**漏传** latePhone 会把答案重置成 false，次日那笔扣款随之永久丢失', () => {
    // 固定住 appStore.confirmNight 所依赖的那条契约：`latePhone: day.latePhone === true`
    // 这个透传是**承重**的，不是可有可无的装饰 —— 它决定的是**次日**那笔扣款。
    // 这里只在纯函数层复刻「透传」与「漏传」两种重跑，不去搭 appStore 的测试台。
    const first = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    expect(first.latePhone).toBe(true)
    expect(previousLatePhone([first], '2026-09-29')).toBe(true)

    // 漏传（= confirmNight 不透传时的样子）：答案被静默重置，次日的连累消失
    const dropped = settleDay({
      date: first.date,
      previousOverdraft: 0,
      settledAt: first.settledAt ?? 'x',
      entries: first.entries,
      config: LATE_CONFIG
    })
    expect(dropped.latePhone).toBe(false)
    expect(previousLatePhone([dropped], '2026-09-29')).toBe(false)

    // 透传（= confirmNight 的实际做法）：答案保住，次日仍会被扣
    const kept = settleDay({
      date: first.date,
      previousOverdraft: 0,
      settledAt: first.settledAt ?? 'x',
      entries: first.entries,
      latePhone: first.latePhone,
      config: LATE_CONFIG
    })
    expect(kept.latePhone).toBe(true)
    expect(previousLatePhone([kept], '2026-09-29')).toBe(true)
  })

  it('selectMoneyStats 未结算日同样叠加连带扣款：结算前与结算后同一个价', () => {
    const prev = settleDay({
      date: '2026-09-29',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    const settledToday = settleDay({
      date: '2026-09-30',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      previousLatePhone: true,
      config: LATE_CONFIG
    })
    const unsettledToday = unsettledDay('2026-09-30', [])

    const settled = selectMoneyStats(moneyWithConfig([prev, settledToday], LATE_CONFIG), TODAY)
    const unsettled = selectMoneyStats(moneyWithConfig([prev, unsettledToday], LATE_CONFIG), TODAY)

    expect(settled.daily[2].spentTC).toBe(LATE_CONFIG.latePhoneTC)
    expect(unsettled.daily[2].spentTC).toBe(LATE_CONFIG.latePhoneTC)
    expect(unsettled.daily[2].spentTC).toBe(settled.daily[2].spentTC)
    expect(unsettled.spentLT).toBe(-LATE_CONFIG.latePhoneLT)
    expect(unsettled.spentLT).toBe(settled.spentLT)
  })
})

describe('previousLatePhone（「前一日答案」的唯一真源）', () => {
  it('账本里根本没有前一日 ⇒ false（无前一日 = 不扣，绝不凭空扣一笔）', () => {
    expect(previousLatePhone([], '2026-09-29')).toBe(false)
    // 判别器：只有「更早」的日子时，它也不是 09-29 的前一日
    const older = settleDay({
      date: '2026-09-27',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    expect(previousLatePhone([older], '2026-09-29')).toBe(false)
  })

  it('前一日存在且答「有」⇒ true；答「无」⇒ false', () => {
    const yes = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    const no = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      config: LATE_CONFIG
    })
    expect(previousLatePhone([yes], '2026-09-29')).toBe(true)
    expect(previousLatePhone([no], '2026-09-29')).toBe(false)
  })

  it('前一日是**老记录**、字段整个缺席 ⇒ 视为 false（不是 undefined 漏出去）', () => {
    // 复刻加字段之前的 plan.json：那一天的对象里根本没有 latePhone 这个键
    const legacy = { ...unsettledDay('2026-09-28', []) } as Partial<LedgerDay>
    delete legacy.latePhone
    expect(previousLatePhone([legacy as LedgerDay], '2026-09-29')).toBe(false)
  })

  it('只认日历上的昨天：前一日未结算（快照尚未冻结）也按已记录的值读', () => {
    // 未结算日不可能有真实答案（缺省 false），这里钉的是「查的是字段、不是 settledAt」
    const unsettled: LedgerDay = { ...unsettledDay('2026-09-28', []), latePhone: true }
    expect(previousLatePhone([unsettled], '2026-09-29')).toBe(true)
  })
})

// ============================================================================
// Task 4：周结算、档位惩罚与跨周滚动
// ============================================================================

describe('penaltyTierOf', () => {
  it('档位边界', () => {
    // 规则测试：边界**下含**，分母换成新的周总额 560（10% = 56、30% = 168）
    expect(penaltyTierOf(0, 560)).toBe(0)
    expect(penaltyTierOf(56, 560)).toBe(1) // 恰好 10%
    expect(penaltyTierOf(57, 560)).toBe(2)
    expect(penaltyTierOf(168, 560)).toBe(2) // 恰好 30%
    expect(penaltyTierOf(169, 560)).toBe(3)
  })
})

describe('settleWeek', () => {
  it('各档位对应的下周额度', () => {
    expect(settleWeek(mkWeek({ spent: 300 })).nextWeekTC).toBe(560)
    expect(settleWeek(mkWeek({ spent: 616 })).nextWeekTC).toBeCloseTo(476) // 恰好超支 10% ⇒ 560 × 85%
    expect(settleWeek(mkWeek({ spent: 728 })).nextWeekTC).toBeCloseTo(392) // 恰好超支 30% ⇒ 560 × 70%
    expect(settleWeek(mkWeek({ spent: 800 })).nextWeekTC).toBeCloseTo(280) // 超过 30% ⇒ 560 × 50%
  })

  it('未超支时娱币不打折', () => {
    expect(settleWeek(mkWeek({ spent: 300 })).nextWeekLT).toBe(20)
  })

  it('档位 2 的娱币打折比例是 60%', () => {
    expect(settleWeek(mkWeek({ spent: 728 })).nextWeekLT).toBeCloseTo(12)
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

  it('settleWeek 的日软上限同样直读 dailyCapTC，与周总额解耦', () => {
    // 判别器：config.weeklyTC = 999 ⇒ 若派生则日软上限 ≈ 142.7，周一的 110 就不算超限
    const config: MoneyConfig = { ...DEFAULT_MONEY_CONFIG, weeklyTC: 999 }
    const w = settleWeek({ ...mkWeek({ spent: 300 }), config })
    expect(w.overLimitDays).toBe(1)
    expect(w.notes.join(' ')).toContain('日额度 80 币')
  })

  it('overLimitDays 比的是配置里的日软上限 80，不是受罚周缩水后的 35', () => {
    // 这一周只发了 245（上周受罚）：若按 weekTC / 7 = 35 算，下面的 40 与 50 全会被误判成超限
    const fortyOnMonday = settleWeek(mkWeek({ spent: 230, nextWeekTC: 245 }))
    expect(fortyOnMonday.weekTC).toBe(245)
    expect(fortyOnMonday.spentTC).toBe(230)
    expect(fortyOnMonday.overLimitDays).toBe(0)

    // 同一额度下周一花 90：超过配置日软上限 80，只有它算超限
    const ninetyOnMonday = settleWeek(mkWeek({ spent: 280, nextWeekTC: 245 }))
    expect(ninetyOnMonday.spentTC).toBe(280)
    expect(ninetyOnMonday.overLimitDays).toBe(1)
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
    const w = settleWeek(mkWeek({ spent: 728 }))
    expect(w.weekOver).toBe(168)
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
    expect(next.weeks[2].weekTC).toBe(560)
    expect(currentQuota(next)).toEqual({ weekTC: 560, weekLT: 20 })
    // 空周不产生惩罚，也没有账本可写
    expect(next.weeks[1].penaltyTier).toBe(0)
    expect(next.weeks[1].spentTC).toBe(0)
    expect(next.weeks[1].nextWeekLT).toBe(20)
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
    expect(currentQuota(state)).toEqual({ weekTC: 560, weekLT: 20 })
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
    expect(next.weeks[0].weekTC).toBe(560)
    expect(currentQuota(next)).toEqual({ weekTC: 560, weekLT: 20 })
  })

  it('惩罚跨周不累积：中间的空周把额度清回配置值', () => {
    // 第 1 周超支落档位 2（下周 392 / 12），第 2、3 周空 → 额度回 560 / 20
    const first = settleWeek(mkWeek({ spent: 700 }))
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      // 账本只落在最后一个待补的周（09-28），中间的 09-14 / 09-21 是真·空周
      days: mkWeek({ spent: 300, weekStart: '2026-09-28' }).days,
      weeks: [first]
    }
    const next = ensureWeekRollover(state, '2026-10-05')
    expect(next.weeks).toHaveLength(4) // 09-07、09-14、09-21、09-28
    expect(next.weeks[1].weekTC).toBeCloseTo(392)
    expect(next.weeks[1].spentTC).toBe(0)
    expect(next.weeks[2].weekTC).toBe(560)
    expect(next.weeks[2].penaltyTier).toBe(0)
    // 09-28 这一周有账本（300 币），不再享受空周重置，但未超支所以也不打折
    expect(next.weeks[3].spentTC).toBe(300)
    expect(next.weeks[3].weekTC).toBe(560)
    expect(next.weeks[3].nextWeekTC).toBe(560)
    expect(currentQuota(next)).toEqual({ weekTC: 560, weekLT: 20 })
  })

  it('惩罚只作用于下一周：未超支的一周把额度拉回配置值', () => {
    // A 周受罚：只发 392、花 672（超支 20%）→ 档位 2 → 560 × 70% = 392（已算好的快照）
    const weekA = mkSettledWeek({
      weekStart: '2026-09-07',
      weekTC: 560,
      spentTC: 672,
      weekOver: 112,
      penaltyTier: 2,
      nextWeekTC: 392,
      nextWeekLT: 12
    })

    // B 周拿到 392，花 200（非零、未超支）→ 档位 0 → 下周回到配置的 560，而不是 392
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: mkWeek({ spent: 200, weekStart: '2026-09-14' }).days,
      weeks: [weekA]
    }
    const next = ensureWeekRollover(state, '2026-09-21') // 补 09-14 这一周
    expect(currentQuota(next)).toEqual({ weekTC: 560, weekLT: 20 })
    expect(next.weeks).toHaveLength(2)
    expect(next.weeks[1].weekTC).toBeCloseTo(392)
    expect(next.weeks[1].spentTC).toBe(200)
    expect(next.weeks[1].penaltyTier).toBe(0)

    // 同一件事在档位 2 上的表现：70% 乘的是配置基础额度，所以是 392 而不是 392 × 70% = 274.4
    const penalised = settleWeek(mkWeek({ spent: 672, weekStart: '2026-09-07', nextWeekTC: 560 }))
    expect(penalised.penaltyTier).toBe(2)
    expect(penalised.nextWeekTC).toBeCloseTo(392)
  })

  it('currentQuota 在没有任何结算时回退到配置值', () => {
    const state: MoneyState = { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [] }
    expect(currentQuota(state)).toEqual({ weekTC: 560, weekLT: 20 })
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
    videoMin: 0,
    gameMin: 0,
    latePhone: false,
    dayLimit: 0,
    spentTC: 0,
    overdraft: 0,
    deltaLT: 0,
    nightPending: true,
    isRestDay: false
  }
}

/**
 * 已结算、**且深夜那一问已经答过**（`nightPending === false`）的一天。
 *
 * 这是「一周可以滚动」的完整前提：`settleDay` 造出来的一律是 `nightPending: true`
 * （结算发生在 23:20，深夜窗口 23:30 才开），要等次日的日结回头补记才置 false。
 * 因此凡把「上周某天」当作已了结的样本喂给 `ensureWeekRollover`，都得用它，
 * 而不是裸的 `settledDay` —— 后者会因 `nightPending` 未清而让整周按新规则推迟。
 */
function nightAnsweredDay(date: string, entries: LedgerEntry[], previousOverdraft = 0): LedgerDay {
  return { ...settledDay(date, entries, previousOverdraft), nightPending: false }
}

/** 只带日账本、没有周结算记录的状态：本周额度回落到配置值 560 / 20。 */
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

/** 日上限为 0 ⇒ 日额度与保底线都是 0，但周一仍然花了 20 币。 */
const moneyWithZeroLimitDay: MoneyState = (() => {
  const config: MoneyConfig = { ...DEFAULT_MONEY_CONFIG, dailyCapTC: 0 }
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
    expect(stats.daily[0].limit).toBeCloseTo(80)
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
    // 周一花 100 币（日上限 80）⇒ 透支 20；本周额度被上周的档位 2 压到 245
    const mon = settledDay(THIS_WEEK_START, [
      mkEntry({ kind: 'planned', plannedMin: 600, actualMin: 600, done: true })
    ])
    const stats = selectMoneyStats(
      mkMoney([mon], [mkSettledWeek({ weekStart: '2026-09-21', nextWeekTC: 245, nextWeekLT: 6 })]),
      TODAY
    )

    expect(stats.weekStart).toBe(THIS_WEEK_START)
    expect(stats.weekTC).toBeCloseTo(245)
    expect(stats.weekTC / 7).toBeCloseTo(35) // 按 weekTC / 7 重算就会得到 35
    expect(stats.daily[0].limit).toBe(80) // 日额度直读 dailyCapTC，不受惩罚影响
    expect(stats.daily[1].limit).toBe(60) // 80 − 周一透支的 20
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
    expect(stats.weekLT).toBe(20)
    expect(stats.spentLT).toBeCloseTo(-0.5)
    expect(stats.remainingLT).toBeCloseTo(stats.weekLT + stats.spentLT)
  })

  it('penaltyTier 与下周额度是本周花费的实时预演', () => {
    const stats = selectMoneyStats(mkMoney(mkWeek({ spent: 700, weekStart: THIS_WEEK_START }).days), TODAY)

    expect(stats.spentTC).toBe(700)
    expect(stats.weekTC).toBe(560)
    expect(stats.remainingTC).toBeCloseTo(-140)
    expect(stats.penaltyTier).toBe(2) // 超支 140 / 560 = 25%
    expect(stats.nextWeekTC).toBeCloseTo(392) // 560 × 70%
    expect(stats.nextWeekLT).toBeCloseTo(12) // 20 × 60%
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
    expect(Object.keys(stats.daily[0]).sort()).toEqual([
      'date',
      'limit',
      'ratio',
      'spentLT',
      'spentTC',
      'weekday'
    ])
  })

  it('未结算的日：钱按条目现算，与当天的质量计数同源', () => {
    // 今天（周三）已经记了一条 2 小时的计划内条目，但还没结算
    const today = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true })
    ])
    const stats = selectMoneyStats(mkMoney([today]), TODAY)

    // 快照字段全是 0，若读快照就会得到 0 —— 必须由条目现算，否则「执行质量」会动而「本周已用」不动
    expect(stats.daily[2].spentTC).toBe(20)
    expect(stats.daily[2].ratio).toBeCloseTo(20 / 80)
    expect(stats.quality.efficient).toBe(1)
    expect(stats.spentTC).toBe(20)
    expect(stats.remainingTC).toBeCloseTo(560 - 20)
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
        (sum, e) =>
          sum + costOfEntry({ actualMin: e.actualMin, nightMin: e.nightMin, quadrant: e.quadrant }, DEFAULT_MONEY_CONFIG),
        0
      )
    ).toBe(20) // 条目确实值 20 币……

    expect(stats.daily[1].spentTC).toBe(7) // ……但已结算的日只认快照
    expect(stats.spentTC).toBe(7)
    expect(stats.spentLT).toBe(0) // 条目重算该是 +0.5，快照说了算
    expect(stats.remainingTC).toBeCloseTo(560 - 7)
  })

  it('未结算的日超额度时，它现算出的透支要带入次日额度', () => {
    // 周三（未结算）按条目现算出 100 币 > 日额度 80 ⇒ 透支 20 ⇒ 周四额度该是 60
    const wed = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 600, actualMin: 600, done: true })
    ])
    const stats = selectMoneyStats(mkMoney([wed]), TODAY)

    expect(stats.daily[2].spentTC).toBe(100)
    expect(stats.daily[2].limit).toBe(80) // 当天额度由传入的透支 0 决定
    expect(stats.daily[2].ratio).toBeCloseTo(100 / 80)
    expect(stats.daily[3].limit).toBe(60) // 80 − 20，透支必须传下去
  })

  it('未结算的日没超额度时，次日额度不受影响', () => {
    // 对照：同样未结算，只花 20 币（未过 80），次日额度仍是满额
    const wed = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true })
    ])
    const stats = selectMoneyStats(mkMoney([wed]), TODAY)

    expect(stats.daily[2].spentTC).toBe(20)
    expect(stats.daily[3].limit).toBe(80)
  })
})

// ============================================================================
// Task R2-I：每日娱币（「我的」页娱币趋势折线图的数据源）
// ============================================================================

/**
 * `MoneyStats.daily` 新增的 `spentLT` 是**视图模型字段**，不落盘（无 `LedgerDay` 改动）。
 * 它必须与本周合计 `spentLT` **同源**：已结算日读冻结快照、未结算日按条目现算并叠加两条
 * 纯消费 —— 也就是复用循环里已经在算的 `dayDelta`，绝不能再写第三套推导。
 * 下面四条把两种日状态各钉一次，并堵住空周产出 NaN 的可能。
 */
describe('selectMoneyStats · 每日娱币 spentLT', () => {
  it('已结算日读冻结快照：周二 −0.5、周三 0，逐日之和等于本周 spentLT', () => {
    const stats = selectMoneyStats(moneyWithTwoSettledDays, TODAY)

    // 周二：一条没做 −1、一条按计划完成 +0.5 ⇒ −0.5；周三：恰好 1.5 倍 ⇒ 0
    expect(stats.daily[1].spentLT).toBeCloseTo(-0.5)
    expect(stats.daily[2].spentLT).toBe(0)
    expect(stats.daily.reduce((sum, d) => sum + d.spentLT, 0)).toBeCloseTo(stats.spentLT)
  })

  it('未结算日按条目现算，且叠加两条纯消费（与合计同一套推导）', () => {
    // 条目：恰好 1.5 倍 ⇒ 娱币 0；刷视频 30 分钟 ⇒ −0.5。合计应与该日逐字相等。
    const wed = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 90, done: true })
    ])
    const stats = selectMoneyStats(
      mkMoney([{ ...wed, videoMin: 30 }]),
      TODAY
    )

    expect(stats.daily[2].spentLT).toBeCloseTo(-0.5)
    expect(stats.spentLT).toBeCloseTo(-0.5)
  })

  it('未结算日的 spentLT 与「先结算再读快照」给出同一个值', () => {
    const entry = mkEntry({ kind: 'planned', plannedMin: 60, actualMin: 0, done: false }) // −1
    const settled = selectMoneyStats(mkMoney([settledDay('2026-09-30', [entry])]), TODAY)
    const unsettled = selectMoneyStats(mkMoney([unsettledDay('2026-09-30', [entry])]), TODAY)

    expect(unsettled.daily[2].spentLT).toBe(settled.daily[2].spentLT)
    expect(unsettled.daily[2].spentLT).toBeCloseTo(-1)
  })

  it('空周：七天 spentLT 全为 0 且有限，不是 NaN', () => {
    const stats = selectMoneyStats(mkMoney([]), TODAY)

    expect(stats.daily.map((d) => d.spentLT)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(stats.daily.every((d) => Number.isFinite(d.spentLT))).toBe(true)
    expect(Number.isFinite(stats.spentLT)).toBe(true)
  })
})

// ============================================================================
// Task R2-B：象限倍率接入计费的两个调用点（settleDay / selectMoneyStats 未结算推导）
// ============================================================================

/**
 * `costOfEntry` 有**两个**会派生「一天花费」的调用点：`settleDay`（已结算日的冻结快照）
 * 与 `selectMoneyStats`（未结算日按条目现算）。只改一处就会出现两套口径 ——
 * 同一个事件，结算前一个价、结算后另一个价。下面三条用例把两处钉在同一个数上。
 */
describe('象限倍率接入结算的两个调用点', () => {
  it('settleDay：已结算日的 spentTC 计入象限倍率', () => {
    const day = settleDay({
      date: '2026-09-28',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [mkEntry({ actualMin: 120, plannedMin: 120, done: true, quadrant: 1 })],
      config: DEFAULT_MONEY_CONFIG
    })
    expect(day.spentTC).toBe(30) // 20 × 1.5
  })

  it('selectMoneyStats：未结算日的现算花费同样计入象限倍率', () => {
    const wed = unsettledDay('2026-09-30', [
      mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true, quadrant: 1 })
    ])
    const stats = selectMoneyStats(mkMoney([wed]), TODAY)
    expect(stats.daily[2].spentTC).toBe(30)
    expect(stats.spentTC).toBe(30)
  })

  it('同一条目已结算与未结算给出同一个价（两个调用点同口径）', () => {
    const entry = mkEntry({ kind: 'planned', plannedMin: 120, actualMin: 120, done: true, quadrant: 1 })
    const settled = selectMoneyStats(mkMoney([settledDay('2026-09-30', [entry])]), TODAY)
    const unsettled = selectMoneyStats(mkMoney([unsettledDay('2026-09-30', [entry])]), TODAY)
    expect(settled.daily[2].spentTC).toBe(30)
    expect(unsettled.daily[2].spentTC).toBe(30)
    expect(settled.daily[2].spentTC).toBe(unsettled.daily[2].spentTC)
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

  it('R2-D 窗口下界：今天 − 7 计入、今天 − 8 不计入（即便仍未结算）', () => {
    // 桌面端跨零点后 today 前进，而开机链不再跑：今天 − 8 会仍是「未结算」。
    // 它必须被窗口挡在卡片之外，否则面板会按真实花费结掉它，绕过逾期满额。
    const money = mkMoney([
      unsettledDay('2026-09-22', []), // 今天 − 8：已掉出 7 天窗口
      unsettledDay('2026-09-23', []), // 今天 − 7：窗口下界，含
      unsettledDay('2026-09-30', []) // 今天：尚未结束
    ])
    expect(pendingDays(money, '2026-09-30')).toEqual(['2026-09-23'])
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

// ============================================================================
// Task 8 追加：补建过去日与「周结算推迟」
// Task R2-D 修正：窗口固定为 [今天 − 7, 今天)，不再要求「有计划」
// ============================================================================

/**
 * `ensureLedgerDays` / `abandonExpiredDays` 的观察日：2026-09-30（周三）。
 * 固定 7 天窗口 = `[2026-09-23, 2026-09-30)`：
 * - `2026-09-23`（= 今天 − 7）在窗口内，必须被物化；
 * - `2026-09-22`（= 今天 − 8）在窗口外，已有记录则被放弃；
 * - `2026-09-30`（今天）不在窗口内，永不物化。
 */
const R2D_TODAY = '2026-09-30'
const R2D_WINDOW = [
  '2026-09-23',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-09-28',
  '2026-09-29'
]

/** 一条「窗口内未结算空记录」的逐字形状（与 `ensureLedgerDays` 的产物对齐）。 */
function emptyLedgerDay(date: string): LedgerDay {
  return {
    date,
    settledAt: null,
    entries: [],
    videoMin: 0,
    gameMin: 0,
    latePhone: false,
    dayLimit: 0,
    spentTC: 0,
    overdraft: 0,
    deltaLT: 0,
    nightPending: true,
    isRestDay: false
  }
}

describe('ensureLedgerDays', () => {
  it('窗口内每一天都补一条未结算空记录 —— 没有安排计划的天同样要问', () => {
    const money = mkMoney([])
    const next = ensureLedgerDays(money, R2D_TODAY)
    expect(next).not.toBe(money)
    // 逐字形状：窗口 7 条，每条的所有字段都钉死（与改前「只钉一条」同等强度）
    expect(next.days).toEqual(R2D_WINDOW.map(emptyLedgerDay))
    // 其余字段原样带过
    expect(next.enabled).toBe(true)
    expect(next.config).toBe(DEFAULT_MONEY_CONFIG)
    expect(next.weeks).toEqual([])
  })

  it('窗口是固定 7 天：今天 − 7 在内、今天 − 8 与今天都在外', () => {
    const dates = ensureLedgerDays(mkMoney([]), R2D_TODAY).days.map((d) => d.date)
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-09-23') // 今天 − 7，窗口下界（含）
    expect(dates[6]).toBe('2026-09-29') // 今天 − 1
    expect(dates).not.toContain('2026-09-22') // 今天 − 8，窗口外
    expect(dates).not.toContain('2026-09-30') // 今天尚未结束，永不物化
  })

  it('已有记录的日期（已结算或未结算）一个字节都不动', () => {
    const pending = unsettledDay('2026-09-25', [])
    const settled = settledDay('2026-09-29', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    const money = mkMoney([pending, settled])
    const next = ensureLedgerDays(money, R2D_TODAY)
    // 窗口里还有另外 5 天空缺，所以整体是新对象；但两条已有记录必须是同一个引用
    expect(next).not.toBe(money)
    expect(next.days.find((d) => d.date === '2026-09-25')).toBe(pending)
    expect(next.days.find((d) => d.date === '2026-09-29')).toBe(settled)
    expect(next.days.map((d) => d.date)).toEqual(R2D_WINDOW)
  })

  it('窗口内每天都已有记录时，原对象返回（无变化不落盘）', () => {
    const full = mkMoney(R2D_WINDOW.map((date) => unsettledDay(date, [])))
    expect(ensureLedgerDays(full, R2D_TODAY)).toBe(full)
  })

  it('返回值按 date 升序，即使已有记录乱序', () => {
    const money = mkMoney([unsettledDay('2026-09-29', []), unsettledDay('2026-09-25', [])])
    const next = ensureLedgerDays(money, R2D_TODAY)
    expect(next.days.map((d) => d.date)).toEqual(R2D_WINDOW)
    // 物化出来的每一天都进待结算（含窗口下界 09-23）
    expect(pendingDays(next, R2D_TODAY)).toEqual(R2D_WINDOW)
  })
})

// ============================================================================
// Task R2-D：逾期放弃 —— 掉出 7 天窗口的未结算日按满额扣款
// ============================================================================

describe('abandonExpiredDays', () => {
  it('超过窗口的未结算日：按 abandonedDayTC 全额落账，娱币不动（Step 1）', () => {
    // deltaLT 故意给一个非零哨兵：既证明它「不被清零」，也证明它「不被重算」
    const old: LedgerDay = {
      ...unsettledDay('2026-09-22', [
        mkEntry({ actualMin: 120, plannedMin: 120, done: true })
      ]),
      deltaLT: -3
    }
    const money = mkMoney([old])
    const next = abandonExpiredDays(money, R2D_TODAY)
    expect(next).not.toBe(money)
    const day = next.days[0]
    expect(day.spentTC).toBe(80) // abandonedDayTC，全额
    expect(day.deltaLT).toBe(-3) // 逐字不变：不扣娱币、不重算
    expect(day.dayLimit).toBe(0) // 其余快照字段保持未结算时的值
    expect(day.overdraft).toBe(0)
    expect(day.entries).toBe(old.entries) // 条目原样保留（同引用，不重建）
    // 其余字段原样带过
    expect(next.enabled).toBe(true)
    expect(next.config).toBe(DEFAULT_MONEY_CONFIG)
    expect(next.weeks).toEqual([])
  })

  it('放弃日也要承担昨夜的连带扣款：spentTC = abandonedDayTC + latePhoneTC、deltaLT 再减 latePhoneLT', () => {
    // 与休息日同一条裁定：一天不能靠「不结算」躲掉昨夜的账（spec R2 §6）。
    // 用 LATE_CONFIG 标定，断言全部由它派生，不写死 40 / 2。
    const prev = settleDay({
      date: '2026-09-21',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      latePhone: true,
      config: LATE_CONFIG
    })
    const expired = unsettledDay('2026-09-22', [])
    const next = abandonExpiredDays(moneyWithConfig([prev, expired], LATE_CONFIG), R2D_TODAY)
    const day = next.days.find((d) => d.date === '2026-09-22')

    expect(day?.spentTC).toBe(LATE_CONFIG.abandonedDayTC + LATE_CONFIG.latePhoneTC)
    expect(day?.deltaLT).toBe(-LATE_CONFIG.latePhoneLT)
    // 放弃日**自己**不记答案：那一问从没对这一天问过，替用户作答就是凭空发明数据。
    // 后果是它不会连累它的次日 —— 这是这一问「没问」的固有性质，不是漏扣。
    expect(day?.latePhone).toBe(false)
  })

  it('对照：前一日答「无」⇒ 放弃日仍只有 abandonedDayTC，deltaLT 逐字不变', () => {
    const prev = settleDay({
      date: '2026-09-21',
      previousOverdraft: 0,
      settledAt: 'x',
      entries: [],
      previousLatePhone: false,
      config: LATE_CONFIG
    })
    // deltaLT 故意给一个非零哨兵：证明「不扣娱币」这条仍然成立，而不是被清零
    const expired: LedgerDay = { ...unsettledDay('2026-09-22', []), deltaLT: -3 }
    const next = abandonExpiredDays(moneyWithConfig([prev, expired], LATE_CONFIG), R2D_TODAY)
    const day = next.days.find((d) => d.date === '2026-09-22')

    expect(day?.spentTC).toBe(LATE_CONFIG.abandonedDayTC)
    expect(day?.deltaLT).toBe(-3)
  })

  it('窗口边界：今天 − 7 不放弃、今天 − 8 放弃', () => {
    const edgeIn = unsettledDay('2026-09-23', []) // 今天 − 7，仍在窗口内
    const edgeOut = unsettledDay('2026-09-22', []) // 今天 − 8，已掉出窗口
    const next = abandonExpiredDays(mkMoney([edgeOut, edgeIn]), R2D_TODAY)
    const inDay = next.days.find((d) => d.date === '2026-09-23')
    const outDay = next.days.find((d) => d.date === '2026-09-22')
    expect(inDay).toBe(edgeIn) // 未结算、未被动过
    expect(inDay?.settledAt).toBeNull()
    expect(outDay).not.toBe(edgeOut)
    expect(outDay?.settledAt).not.toBeNull()
    expect(outDay?.spentTC).toBe(80)
  })

  it('今天本身永不放弃（它既不在窗口内、也不该被落账）', () => {
    const today = unsettledDay(R2D_TODAY, [])
    const money = mkMoney([today])
    expect(abandonExpiredDays(money, R2D_TODAY)).toBe(money)
  })

  it('没有逾期记录时原对象返回', () => {
    const money = mkMoney([unsettledDay('2026-09-25', []), settledDay('2026-09-26', [])])
    expect(abandonExpiredDays(money, R2D_TODAY)).toBe(money)
  })

  it('已结算的往日不进放弃：settledAt 非 null 即不可碰', () => {
    const settled = settledDay('2026-09-22', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    const money = mkMoney([settled])
    const next = abandonExpiredDays(money, R2D_TODAY)
    expect(next).toBe(money) // 无未结算逾期 → 原对象
    expect(next.days[0].spentTC).toBe(settled.spentTC) // 10，不是 80
  })

  it('放弃日被冻结：settledAt 置为到期日、nightPending 清掉', () => {
    const next = abandonExpiredDays(mkMoney([unsettledDay('2026-09-22', [])]), R2D_TODAY)
    const day = next.days[0]
    // 2026-09-22 在窗口里待到 2026-09-29（= date + 7）—— 那就是它的到期日
    expect(day.settledAt).toBe('2026-09-29')
    expect(day.nightPending).toBe(false)
  })

  it('放弃日不可重结：不再是待结算日，也不会被 confirmNight 重跑（nightPending 已清）', () => {
    const next = abandonExpiredDays(mkMoney([unsettledDay('2026-09-22', [])]), R2D_TODAY)

    // 不再是待结算日（从日结卡片彻底消失）
    expect(pendingDays(next, R2D_TODAY)).toEqual([])

    // 判别器：「已结算」本身挡不住 confirmNight —— 它会整日重跑 settleDay，
    // 而一个已结算但仍挂 nightPending 的日子确实会被 openNightsBefore 选中。
    const stillOpen: LedgerDay = { ...next.days[0], nightPending: true }
    expect(openNightsBefore([stillOpen], R2D_TODAY)).toHaveLength(1)
    // 放弃日显式清了 nightPending，所以选不中 → 永不被重跑、80 不会被抹成 0
    expect(openNightsBefore(next.days, R2D_TODAY)).toEqual([])
  })

  it('缺席不罚：账本里没有记录的往日不会被凭空扣款（放弃只作用于已存在的记录）', () => {
    // 一个月没打开：账本空白。开机链只补出窗口内的 7 天空记录，没有任何一天被扣 80。
    const money = abandonExpiredDays(ensureLedgerDays(mkMoney([]), R2D_TODAY), R2D_TODAY)
    expect(money.days).toHaveLength(7)
    expect(money.days.every((d) => d.settledAt === null && d.spentTC === 0)).toBe(true)
  })

  it('已结算日（含放弃日）在两次开机后逐字节不变', () => {
    const abandoned = abandonExpiredDays(mkMoney([unsettledDay('2026-09-22', [])]), R2D_TODAY)
    const settled = settledDay('2026-09-25', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    const money: MoneyState = {
      ...abandoned,
      days: [...abandoned.days, settled].sort((a, b) => (a.date < b.date ? -1 : 1))
    }

    // 一次开机 = 物化 → 放弃 → 周结算（appStore.init 的顺序）
    const boot = (m: MoneyState): MoneyState =>
      ensureWeekRollover(
        abandonExpiredDays(ensureLedgerDays(m, R2D_TODAY), R2D_TODAY),
        R2D_TODAY
      )

    const first = boot(money)
    const second = boot(first)
    // 第二次开机整条链原地短路（无变化 → 同一对象 → 不触发落盘）
    expect(second).toBe(first)
    // 被放弃那天与被正常结算那天，数字与标记逐字不动
    expect(second.days.find((d) => d.date === '2026-09-22')).toEqual(
      first.days.find((d) => d.date === '2026-09-22')
    )
    expect(second.days.find((d) => d.date === '2026-09-25')).toBe(settled)
    expect(second.days.find((d) => d.date === '2026-09-22')?.spentTC).toBe(80)
  })
})

describe('ensureWeekRollover 推迟含未结算日的周', () => {
  it('上一周还有未结算的日 → 整周不结算、且不越周往后补', () => {
    // 09-21 那一周里 09-25 还没结算；再往前还有一周（09-14）也没结算
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [unsettledDay('2026-09-25', [])],
      weeks: []
    }
    const same = ensureWeekRollover(state, '2026-09-30')
    expect(same).toBe(state)
    expect(same.weeks).toEqual([])
    // 没有任何周结算 → 本周额度回落到配置值
    expect(currentQuota(same)).toEqual({ weekTC: 560, weekLT: 20 })
  })

  it('那一天结算、且深夜答完后，滚动随即推进', () => {
    const pendingState: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [unsettledDay('2026-09-25', [])],
      weeks: []
    }
    const settled = nightAnsweredDay('2026-09-25', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    const next = ensureWeekRollover({ ...pendingState, days: [settled] }, '2026-09-30')
    expect(next).not.toBe(pendingState)
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-21'])
    expect(next.weeks[0].spentTC).toBe(10)
    expect(next.weeks[0].penaltyTier).toBe(0)
  })

  it('推迟后重新扫描：先前的周已结算、本周未结算的那一周仍推迟', () => {
    // 前一周已全部结算（09-21 周），本周（09-28 周）里 09-29 未结算
    const mon = nightAnsweredDay('2026-09-21', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    const pendingThisWeek = unsettledDay('2026-09-29', [])
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [mon, pendingThisWeek],
      weeks: []
    }
    // 上一周（09-21）全部已结算 → 结算它；本周还没结束，本来就不结算
    const next = ensureWeekRollover(state, '2026-09-30')
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-21'])
    expect(next.weeks[0].spentTC).toBe(10)
  })

  it('没有任何日账本的周仍按空周结算（假言真值，不特判）', () => {
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [],
      weeks: []
    }
    expect(ensureWeekRollover(state, '2026-09-30')).toBe(state)
    // 有账本才会滚：最早账本所在周起逐周补，中间空周按零
    const withOld = ensureWeekRollover(
      {
        ...state,
        days: [nightAnsweredDay('2026-09-14', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])]
      },
      '2026-09-30'
    )
    expect(withOld.weeks.map((w) => w.weekStart)).toEqual(['2026-09-14', '2026-09-21'])
    expect(withOld.weeks[1].spentTC).toBe(0)
  })
})

// ============================================================================
// Task 8（第三轮）：含深夜待补记的周一律推迟
// ============================================================================

/**
 * 周日 23:30 之后的做事只能由周一的日结回头补记（见 `confirmNight`）。若在周日那天
 * `nightPending` 还没清掉时就结算了这一周，周快照会把周日深夜那一段永久排除在外 ——
 * 周 `spentTC` 少报，可能压低 `penaltyTier`，再顺着 `nextWeekTC` 把额度错误传下去。
 * 所以「一周可结算」的第二个前提是：这一周里没有任何 `nightPending === true` 的日账本。
 */
describe('ensureWeekRollover 推迟含深夜待补记的周', () => {
  it('日账本都已结算、但有一天还挂着 nightPending → 整周不结算，额度停在配置值', () => {
    // 09-21 那一周只有 09-25（周五）一天账本：已结算，但深夜那一问还没答
    const fri: LedgerDay = {
      ...settledDay('2026-09-25', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      nightPending: true
    }
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [fri],
      weeks: []
    }
    const same = ensureWeekRollover(state, '2026-09-30')
    expect(same).toBe(state)
    expect(same.weeks).toEqual([])
    // 没有任何周结算 → 本周额度仍按配置值（推迟的代价只是「晚一点收敛」）
    expect(currentQuota(same)).toEqual({ weekTC: 560, weekLT: 20 })
  })

  it('nightPending 清掉后，滚动立即补上那一周', () => {
    const pending: LedgerDay = {
      ...settledDay('2026-09-25', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      nightPending: true
    }
    const deferred: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [pending],
      weeks: []
    }
    // 先确认 nightPending 未清时确实推迟
    expect(ensureWeekRollover(deferred, '2026-09-30').weeks).toEqual([])

    // 次日日结（在本周周一 09-28）答完深夜那一问：09-25 的 nightPending 置 false
    const cleared = nightAnsweredDay('2026-09-25', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    const next = ensureWeekRollover({ ...deferred, days: [cleared] }, '2026-09-30')
    expect(next).not.toBe(deferred)
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-21'])
    expect(next.weeks[0].spentTC).toBe(10)
    expect(next.weeks[0].penaltyTier).toBe(0)
  })

  it('一个记录都没有的周仍按空周结算（nightPending 不适用，假言真值）', () => {
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [],
      weeks: []
    }
    expect(ensureWeekRollover(state, '2026-09-30')).toBe(state)
    const withOld = ensureWeekRollover(
      {
        ...state,
        days: [
          nightAnsweredDay('2026-09-14', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
        ]
      },
      '2026-09-30'
    )
    expect(withOld.weeks.map((w) => w.weekStart)).toEqual(['2026-09-14', '2026-09-21'])
    expect(withOld.weeks[1].spentTC).toBe(0)
  })
})

// ============================================================================
// Task 8（第五轮）：一次结算问遍所有未收尾的深夜，而不是只问最新的那一个
// ============================================================================

/**
 * `openNightsBefore` 是「结算某天时该回头问哪些夜」的判定，取代了第四轮的 `latestOpenNight`。
 *
 * 第四轮把「严格 `date − 1`」换成「`date` 之前**最近**的一个未收尾深夜」，修好了跨空洞的死锁，
 * 却漏出同一类的另一个状态：**同一天之前并存两个未收尾的深夜时，只问最新的那一个**。
 * 更旧的那个再也选不中（每次结算都清掉一个更新的、又把自己变成一个更新的），于是它所在的那一周
 * 被 `ensureWeekRollover` 的 `break` 永久推迟，后面的周跟着一起堵死，`currentQuota` 永远返回配置值。
 * 本轮的修法：**一次结算问遍所有早于它的未收尾深夜**，最早优先；`openNightsBefore` 是这条判定的唯一真源。
 */
describe('openNightsBefore', () => {
  it('返回 date 之前所有「已结算且 nightPending」的日子，按最早优先', () => {
    const older = settledDay('2026-09-24', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    const newer = settledDay('2026-09-26', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    // 入参故意乱序：返回值必须自己排好，不依赖调用方
    expect(openNightsBefore([newer, older], '2026-09-29').map((d) => d.date)).toEqual([
      '2026-09-24',
      '2026-09-26'
    ])
  })

  it('跳过未结算的日账本（`nightPending` 虽为 true，但它还没到问深夜的时候）', () => {
    const unsettled = unsettledDay('2026-09-26', [])
    const settledOpen = settledDay('2026-09-24', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    expect(openNightsBefore([settledOpen, unsettled], '2026-09-29').map((d) => d.date)).toEqual([
      '2026-09-24'
    ])
  })

  it('跳过已答完（nightPending === false）的，以及 date 当天 / 之后的记录', () => {
    const answered = nightAnsweredDay('2026-09-27', [
      mkEntry({ actualMin: 60, plannedMin: 60, done: true })
    ])
    const sameDay = settledDay('2026-09-29', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    expect(openNightsBefore([answered, sameDay], '2026-09-29')).toEqual([])
  })
})

describe('跨空洞也能收尾的深夜（第四轮 Critical 回归）', () => {
  it('只在周六、周二有计划、周日 / 周一没记录时，周二仍能问出周六那一夜，并让周六那周结算', () => {
    // 周六已结算但仍挂着 nightPending；周二还没结算；周日 / 周一**没有记录**（空洞）
    const sat = settledDay('2026-09-26', [mkEntry({ actualMin: 120, plannedMin: 120, done: true })])
    const tue = unsettledDay('2026-09-29', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    const days = [sat, tue]

    // 结算周二时要问的深夜必须是周六，而不是不存在的前一天
    expect(openNightsBefore(days, '2026-09-29').map((d) => d.date)).toEqual(['2026-09-26'])

    // 还没答之前：周六所在的 09-21 周被推迟（nightPending 未清，且是 break 不是 skip）
    const before = ensureWeekRollover(
      { enabled: true, config: DEFAULT_MONEY_CONFIG, days, weeks: [] },
      '2026-09-30'
    )
    expect(before.weeks).toEqual([])

    // 答完（= 面板结算周二时对周六调 confirmNight 的效果）后，09-21 周立即结算
    const cleared: LedgerDay = { ...sat, nightPending: false }
    const after = ensureWeekRollover(
      { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [cleared, tue], weeks: [] },
      '2026-09-30'
    )
    expect(after.weeks.map((w) => w.weekStart)).toEqual(['2026-09-21'])
    expect(after.weeks[0].spentTC).toBe(20)
    expect(after.weeks[0].penaltyTier).toBe(0)
  })
})

describe('两个同时未收尾的深夜（第五轮要修的类）', () => {
  it('两个都早于待结算日时，一次结算把两个都问到、都清掉，更旧那个所在的那一周随即结算', () => {
    // 09-25（周五，上一周 09-21）与 09-29（周二，本周 09-28）都还挂着 nightPending；
    // 待结算日是 09-30（周三），两个深夜都早于它。
    const fri: LedgerDay = {
      ...settledDay('2026-09-25', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      nightPending: true
    }
    const tue: LedgerDay = {
      ...settledDay('2026-09-29', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      nightPending: true
    }
    const wed = unsettledDay('2026-09-30', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })])
    const days = [fri, tue, wed]
    const state: MoneyState = { enabled: true, config: DEFAULT_MONEY_CONFIG, days, weeks: [] }

    // 判定：两个都在，最早优先 —— 不是只挑最近的那一个
    expect(openNightsBefore(days, '2026-09-30').map((d) => d.date)).toEqual([
      '2026-09-25',
      '2026-09-29'
    ])

    // 一个都没答之前：09-21 那一周被推迟
    expect(ensureWeekRollover(state, '2026-09-30').weeks).toEqual([])

    // 只清最新的那一个（第四轮的实际行为）：09-25 没被问到，它那周仍然被推迟 —— 这正是要修的缺陷
    const onlyNewestCleared = days.map((d) =>
      d.date === '2026-09-29' ? { ...d, nightPending: false } : d
    )
    expect(ensureWeekRollover({ ...state, days: onlyNewestCleared }, '2026-09-30').weeks).toEqual([])

    // 两个都清掉之后：09-21 那一周结算，且只结算它（本周还没结束，本来就不结算）
    const bothCleared = days.map((d) => (d.settledAt !== null ? { ...d, nightPending: false } : d))
    const next = ensureWeekRollover({ ...state, days: bothCleared }, '2026-09-30')
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-21'])
    expect(next.weeks[0].spentTC).toBe(10)
    expect(next.weeks[0].penaltyTier).toBe(0)
  })

  it('复刻缺陷现场：较旧的一天在较新的一天之后才被结算 —— 并存不是死局，下一个更晚的结算会把两个一起问', () => {
    // 先结算了 09-29（较新、仍挂着 nightPending），随后 09-28（较旧）才作为未结算日出现并被结算。
    // 结算 09-28 时，09-29 并不早于它 —— 那一刻什么也不问，09-28 也以 nightPending 落账（两个并存）。
    const tue: LedgerDay = {
      ...settledDay('2026-09-29', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      nightPending: true
    }
    const mon: LedgerDay = {
      ...settledDay('2026-09-28', [mkEntry({ actualMin: 60, plannedMin: 60, done: true })]),
      nightPending: true
    }
    const days = [mon, tue]

    // 结算 09-28 时没有可问的深夜（09-29 不早于它）—— 于是两个并存
    expect(openNightsBefore(days, '2026-09-28')).toEqual([])

    // 但并存不是死局：下一个更晚的结算（09-30）会把两个一起问到，最早优先 ——
    // 较旧的那个不再永远选不中（第四轮只挑最新，会把它永久留在账本里堵住周滚动）
    expect(openNightsBefore(days, '2026-09-30').map((d) => d.date)).toEqual([
      '2026-09-28',
      '2026-09-29'
    ])
  })
})

describe('「那天我什么都没做」释放被推迟的周', () => {
  it('一周的日账本全清空后，周里不再有 nightPending，于是结算（而不是永远挂着）', () => {
    // 面板「什么都没做」= settleDay（计划全记未完成）后再对**当天自己** confirmNight({worked:false})，
    // 把当天的 nightPending 记成「否」。这里复刻那两步的产物：
    const sat = nightAnsweredDay('2026-09-26', [
      mkEntry({ plannedMin: 120, actualMin: 120, done: true })
    ])
    const sun: LedgerDay = {
      ...settledDay('2026-09-27', [mkEntry({ plannedMin: 60, actualMin: 0, done: false })]),
      nightPending: false
    }
    const state: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [sat, sun],
      weeks: []
    }

    // 周里不再有未收尾的深夜：下一个待结算日挑不到任何补记目标
    expect(openNightsBefore(state.days, '2026-09-30')).toEqual([])

    const next = ensureWeekRollover(state, '2026-09-30')
    expect(next.weeks.map((w) => w.weekStart)).toEqual(['2026-09-21'])
    expect(next.weeks[0].spentTC).toBe(20) // 周六 20 币；周日「什么都没做」0 币
    expect(next.weeks[0].missCount).toBe(1) // 周日那条计划被记成未完成
  })
})

// ============================================================================
// Fix Wave：enabledAt —— 把记账窗口的下界夹到 max(今天 − 7, enabledAt)
//
// 病根：setMoneyEnabled(true) 写下空账本，下次开机 ensureLedgerDays 会补满
// [今天 − 7, 今天 − 1]，于是新用户第一屏就是「有 7 天待结算」，不理它还会被
// abandonExpiredDays 按满额逐日扣款 —— 把「缺席」当成「看见了却不结」。
// ============================================================================

/**
 * 观察日 2026-09-30（周三），`enabledAt = 2026-09-27`（三天前）。
 * 夹取后的窗口 = [2026-09-27, 2026-09-30) —— 恰好三天。
 */
const ENABLED_TODAY = '2026-09-30'
const ENABLED_AT = '2026-09-27'

/** 带 `enabledAt` 的状态（`mkMoney` 固定不带该字段）。 */
function moneyEnabledAt(days: LedgerDay[], enabledAt?: string): MoneyState {
  return {
    enabled: true,
    config: DEFAULT_MONEY_CONFIG,
    days,
    weeks: [],
    ...(enabledAt === undefined ? {} : { enabledAt })
  }
}

describe('enabledAt · 窗口下界夹取', () => {
  it('enabledAt 三天前：只物化这三天（09-27 / 09-28 / 09-29）', () => {
    const money = moneyEnabledAt([], ENABLED_AT)
    const next = ensureLedgerDays(money, ENABLED_TODAY)
    expect(next).not.toBe(money)
    expect(next.days.map((d) => d.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29'])
    // 夹取只影响窗口，不吞掉字段本身
    expect(next.enabledAt).toBe(ENABLED_AT)
  })

  it('enabledAt 就是今天：窗口为空，一条都不物化', () => {
    // 这正是「刚开启功能」的那一刻：第一屏不该出现任何待结算日。
    const money = moneyEnabledAt([], ENABLED_TODAY)
    expect(ensureLedgerDays(money, ENABLED_TODAY)).toBe(money)
  })

  it('pendingDays 排除早于 enabledAt 的日子（即便它仍在 7 天窗口内）', () => {
    const money = moneyEnabledAt(
      [
        unsettledDay('2026-09-25', []), // 早于 enabledAt：不报
        unsettledDay('2026-09-27', []), // = enabledAt，窗口下界，报
        unsettledDay('2026-09-28', []),
        unsettledDay('2026-09-29', [])
      ],
      ENABLED_AT
    )
    expect(pendingDays(money, ENABLED_TODAY)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29'
    ])
  })

  it('abandonExpiredDays 放过早于 enabledAt 的逾期未结算日（不按缺席扣款）', () => {
    // 09-22 = 今天 − 8，已掉出 7 天窗口；但它早于 enabledAt，属于「功能还不存在」的那几天，
    // 满额扣款惩罚的是「看见了却不结」，不是「不在场」—— 一分都不能扣。
    const older = unsettledDay('2026-09-22', [])
    const money = moneyEnabledAt([older], ENABLED_AT)
    expect(abandonExpiredDays(money, ENABLED_TODAY)).toBe(money)
    expect(money.days[0].settledAt).toBeNull()
    expect(money.days[0].spentTC).toBe(0)
  })

  it('只放弃「生效之后、又掉出窗口」的那条带：enabledAt 之前不动，之后才扣', () => {
    // enabledAt 很早（09-01）：09-22（今天−8）在 [enabledAt, 今天−7) 这条带里 ⇒ 正常放弃；
    // 08-30 早于 enabledAt ⇒ 不动。
    const afterEnable = unsettledDay('2026-09-22', [])
    const beforeEnable = unsettledDay('2026-08-30', [])
    const money = moneyEnabledAt([beforeEnable, afterEnable], '2026-09-01')
    const next = abandonExpiredDays(money, ENABLED_TODAY)

    const abandoned = next.days.find((d) => d.date === '2026-09-22')
    const untouched = next.days.find((d) => d.date === '2026-08-30')
    expect(abandoned?.settledAt).not.toBeNull()
    expect(abandoned?.spentTC).toBe(DEFAULT_MONEY_CONFIG.abandonedDayTC)
    expect(untouched).toBe(beforeEnable) // 同引用：一个字节都没动
  })

  it('enabledAt 缺席 ⇒ 三处行为与加本字段之前逐字一致（向后兼容不回退）', () => {
    // 物化：仍是完整 7 天窗口
    expect(ensureLedgerDays(mkMoney([]), R2D_TODAY).days.map((d) => d.date)).toEqual(R2D_WINDOW)
    // 待结算：今天−7 仍在报（不被任何夹取挡掉）
    expect(pendingDays(mkMoney([unsettledDay('2026-09-23', [])]), R2D_TODAY)).toEqual([
      '2026-09-23'
    ])
    // 放弃：今天−8 仍按满额放弃
    const expired = unsettledDay('2026-09-22', [])
    const next = abandonExpiredDays(mkMoney([expired]), R2D_TODAY)
    expect(next.days[0].settledAt).not.toBeNull()
    expect(next.days[0].spentTC).toBe(DEFAULT_MONEY_CONFIG.abandonedDayTC)
  })
})

// ============================================================================
// Fix Wave：setMoneyEnabled 写 enabledAt（store 级；本文件唯一的非纯函数用例）
// ============================================================================

describe('setMoneyEnabled · enabledAt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 固定「今天」= 2026-09-30，让写入值与断言同源
    vi.setSystemTime(new Date('2026-09-30T10:00:00'))
    useAppStore.setState({ data: defaultData(), loaded: true })
  })

  afterEach(() => {
    useAppStore.setState({ data: defaultData(), loaded: true })
    vi.useRealTimers()
  })

  it('首次开启写 enabledAt = 今天，并带上完整的 MoneyState', () => {
    useAppStore.getState().setMoneyEnabled(true)
    const money = useAppStore.getState().data.money
    expect(money?.enabled).toBe(true)
    expect(money?.enabledAt).toBe('2026-09-30')
    expect(money?.config).toBe(DEFAULT_MONEY_CONFIG)
    expect(money?.days).toEqual([])
    expect(money?.weeks).toEqual([])
  })

  it('关 → 再开时刷新为新的启用日（不是首次才写）', () => {
    useAppStore.setState({
      data: {
        ...defaultData(),
        money: {
          enabled: false,
          config: DEFAULT_MONEY_CONFIG,
          days: [],
          weeks: [],
          enabledAt: '2026-09-28'
        }
      }
    })
    useAppStore.getState().setMoneyEnabled(true)
    expect(useAppStore.getState().data.money?.enabledAt).toBe('2026-09-30')
  })

  it('关闭只翻 enabled：保留 enabledAt、不清空账本', () => {
    const money: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [],
      weeks: [],
      enabledAt: '2026-09-28'
    }
    useAppStore.setState({ data: { ...defaultData(), money } })
    useAppStore.getState().setMoneyEnabled(false)
    const next = useAppStore.getState().data.money
    expect(next?.enabled).toBe(false)
    expect(next?.enabledAt).toBe('2026-09-28')
  })

  it('已是开启态时再开不刷新 enabledAt（非 false→true 转换）', () => {
    const money: MoneyState = {
      enabled: true,
      config: DEFAULT_MONEY_CONFIG,
      days: [],
      weeks: [],
      enabledAt: '2026-09-28'
    }
    useAppStore.setState({ data: { ...defaultData(), money } })
    useAppStore.getState().setMoneyEnabled(true)
    expect(useAppStore.getState().data.money?.enabledAt).toBe('2026-09-28')
  })
})
