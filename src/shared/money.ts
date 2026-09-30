import { addDays, dateKey, mondayOf, parseDateKey } from './dateKey'
import type {
  LedgerDay,
  LedgerEntry,
  LedgerEntryKind,
  MoneyConfig,
  MoneyState,
  PenaltyTier,
  WeekSettlement
} from './types'

/**
 * 计费与结算参数的默认值（spec 第 11 节）。
 *
 * 这是这些常量的**单一真源**：`dataCodec.normalizeMoney` 的非法值回退、
 * 开启开关时写入的初始 `config`，都应引用这里而不是各自重抄一遍。
 */
export const DEFAULT_MONEY_CONFIG: MoneyConfig = {
  weeklyTC: 350,
  tcPerHour: 10,
  nightStartMin: 1410,
  nightEndMin: 360,
  nightMultiplier: 1.5,
  minCapRatio: 0.2,
  weeklyLT: 10,
  rewardLT: 0.5,
  penaltyLT: 0.5,
  missPenaltyLT: 1
}

/**
 * 单条条目里落在深夜区间内的分钟数（spec 6.3「深夜判定」）。
 *
 * 深夜区间跨零点：`[nightStartMin, 1440) ∪ [0, nightEndMin)`，**左闭右开** ——
 * 22:30 开始做 60 分钟、恰好 23:30 结束的条目计 0；落在 06:00 整的那一分钟同样不计。
 *
 * `startMin` 自 0 点起算且**可以 ≥ 1440**（条目跨过午夜），所以逐分钟对 1440 取模。
 *
 * 刻意用逐分钟循环而不是闭式公式：闭式在「跨零点」与「跨多日」这两处极易写错，
 * 而域模型把 `actualMin` 限制在 600 分钟以内，循环代价可忽略。
 */
export function nightMinutesOf(
  input: { startMin: number; actualMin: number },
  config: MoneyConfig
): number {
  let night = 0
  for (let i = 0; i < input.actualMin; i++) {
    const m = (input.startMin + i) % 1440
    if (m >= config.nightStartMin || m < config.nightEndMin) night++
  }
  return night
}

/**
 * 单条条目的时币花费（spec 6.3「单条条目」）：
 *
 * ```
 * dayMin = actualMin − nightMin
 * base   = (dayMin + nightMin × nightMultiplier) / 60 × tcPerHour
 * ```
 *
 * 只对落在深夜区间内的**那部分分钟数**乘倍率，不是整条乘 —— 这正是入参收
 * `nightMin` 这个数字而不是「是否深夜」布尔标记的原因：布尔表达不了部分倍率，
 * 且一旦与分钟数并存，两者就可能不一致。
 */
export function costOfEntry(input: { actualMin: number; nightMin: number }, config: MoneyConfig): number {
  const dayMin = input.actualMin - input.nightMin
  const base = ((dayMin + input.nightMin * config.nightMultiplier) / 60) * config.tcPerHour
  return Math.round(base)
}

/**
 * 单条条目的娱币净变化（spec 6.4）。
 *
 * **判定顺序即语义，不可重排**：
 * 1. `!done` → `−missPenaltyLT`（有事情没做，不看时长、也不看是否为计划外）；
 * 2. `kind === 'unplanned'` → 0（计划外事项只计 TC，否则随手加一条就能刷币）；
 * 3. `plannedMin` 为 null 或非正数 → 0（没有可比基准，必须返回 0 而不是 NaN）；
 * 4. `actualMin ≤ plannedMin × 1.0` → `+rewardLT`（恰好等于计划时长算高效）；
 * 5. `actualMin > plannedMin × 1.5` → `−penaltyLT`（恰好 1.5 倍不算低效）；
 * 6. 其余（1.0 < ratio ≤ 1.5）→ 0。
 */
export function leisureDelta(
  input: { kind: LedgerEntryKind; done: boolean; actualMin: number; plannedMin: number | null },
  config: MoneyConfig
): number {
  if (!input.done) return -config.missPenaltyLT
  if (input.kind === 'unplanned') return 0

  const planned = input.plannedMin
  if (planned === null || planned <= 0) return 0

  if (input.actualMin <= planned) return config.rewardLT
  if (input.actualMin > planned * 1.5) return -config.penaltyLT
  return 0
}

/**
 * 当日可用额度（spec 6.2）：
 *
 * ```
 * dayLimit(i) = max(D × minCapRatio, D − overdraft(i−1))，其中 D = weeklyTC / 7
 * ```
 *
 * 日软上限 `D`（默认 50）**不阻止消费**，只决定透支：透支只带入**次日**、不累积，
 * 靠 `minCapRatio`（默认 0.2 → 保底 10 币）兜底 —— 这正是防死亡螺旋的那一层，
 * 否则一次大额透支会让后续额度长期贴地。自修复也由此而来：超支 30 的次日额度为 20，
 * 只在额度内消费则不产生新透支，第三天回到 50。
 *
 * 保底线取 `D × minCapRatio` 而**不是** `weeklyTC × minCapRatio`：后者在默认值下是
 * 70 币，比日额度本身还高，保底会退化成「永远不扣」。
 */
export function dayLimitOf(previousOverdraft: number, config: MoneyConfig): number {
  const softCap = config.weeklyTC / 7
  return Math.max(softCap * config.minCapRatio, softCap - previousOverdraft)
}

/**
 * 对一天做结算（spec 6.2 / 7.3）。
 *
 * `spentTC` 与 `deltaLT` 都**由原始字段重新推导**（逐条 `costOfEntry` / `leisureDelta` 求和），
 * 不读条目上已存的 `costTC` / `deltaLT`：结算快照是唯一真源，条目字段只是记录时的镜像，
 * 两者若有偏差必须以结算为准。
 *
 * `settledAt` 由调用方传入并原样写入 —— 函数因此保持纯的、可测的，不自取当前时间。
 *
 * `nightPending` 恒为 `true`：结算发生在 23:20，而深夜窗口 23:30 才开启，
 * 「昨夜 23:30 之后是否还在做事」只能由**次日**的结算补记（Task 8 消费此字段）。
 *
 * 返回值对条目数组做的是**浅拷贝**：数组归快照所有，但条目对象仍与调用方共享 ——
 * 调用方不得原地改这些对象（账本是追加写的，条目一旦记录即视为不可变）。
 */
export function settleDay(input: {
  date: string
  entries: LedgerEntry[]
  previousOverdraft: number
  settledAt: string
  config: MoneyConfig
}): LedgerDay {
  const dayLimit = dayLimitOf(input.previousOverdraft, input.config)

  let spentTC = 0
  let deltaLT = 0
  for (const entry of input.entries) {
    spentTC += costOfEntry({ actualMin: entry.actualMin, nightMin: entry.nightMin }, input.config)
    deltaLT += leisureDelta(
      { kind: entry.kind, done: entry.done, actualMin: entry.actualMin, plannedMin: entry.plannedMin },
      input.config
    )
  }

  return {
    date: input.date,
    settledAt: input.settledAt,
    // 快照独占自己的数组：直接存 input.entries 等于把它交给调用方，
    // 调用方在组装/落盘途中 push/splice 就会改到已冻结的 spentTC/overdraft/dayLimit。
    // 唯一获准修改已结算快照的地方是 Task 8 的深夜补记，且它必须**重算**各项汇总。
    entries: [...input.entries],
    dayLimit,
    spentTC,
    overdraft: Math.max(0, spentTC - dayLimit),
    deltaLT,
    nightPending: true
  }
}

/**
 * 档位 → 下周额度的折扣比例（spec 6.5 的表格逐字抄录）。
 *
 * 系数乘的是**配置的基础额度**（`config.weeklyTC` / `config.weeklyLT`），
 * 不是本周实发的额度：惩罚只作用于下一周，见 `settleWeek` 的注释。
 *
 * 用查表而不是连续公式：更好解释、更好调参，也天然不会把下周罚到归零
 * （守住「不能封锁」的红线）。
 */
const TIER_SCALE: Record<PenaltyTier, { tc: number; lt: number }> = {
  0: { tc: 1, lt: 1 },
  1: { tc: 0.85, lt: 0.85 },
  2: { tc: 0.7, lt: 0.6 },
  3: { tc: 0.5, lt: 0.4 }
}

/**
 * 超支比例落在哪一档（spec 6.5）。
 *
 * 边界**下含**：`weekOver / weekTC` 恰好等于 0.10 是档位 1、恰好等于 0.30 是档位 2。
 * 这里不需要 epsilon —— `105 / 350` 与字面量 `0.3` 舍入到同一个 double，
 * `<=` 直接成立。
 *
 * `weekTC` 为 0 时不特判：比例算成 Infinity，自然落到档位 3（额度为零却还有花费，
 * 只能是最重的一档）；而 `weekOver <= 0` 已经先行返回档位 0。
 */
export function penaltyTierOf(weekOver: number, weekTC: number): PenaltyTier {
  if (weekOver <= 0) return 0
  const ratio = weekOver / weekTC
  if (ratio <= 0.1) return 1
  if (ratio <= 0.3) return 2
  return 3
}

/**
 * 对一周做结算（spec 6.5 / 7.5），产出复盘页要用的全部汇总。
 *
 * **入参 `days` 就是这一周的日子**：调用方给几天就汇总几天，缺失的日按零计
 * （`ensureWeekRollover` 只挑出落在本周区间内的日账本，因此缺席的日不产生任何贡献）。
 *
 * **日快照是唯一真源**：`spentTC` 逐日相加 `day.spentTC`，不重新遍历条目算钱 ——
 * 与 `settleDay` 里「快照优于条目镜像字段」同一条规矩。计数与时长类字段
 * （`plannedMin` / `actualMin` / `doneCount` / `missCount` / `unplannedCount` /
 * `unplannedMin` / `nightMin`）只能来自条目，没有快照可读。
 *
 * `overLimitDays` 比的是**日软上限** `config.weeklyTC / 7`（spec 6.2 的 D），
 * 与 `dayLimitOf` 同源，而不是 `day.dayLimit`，也不是本周缩水后的 `weekTC / 7`：
 * - 不用 `day.dayLimit`：它已经含了前一日透支，连续透支的日子会被重复计数，
 *   一周里「几天超限」就失去意义；
 * - 不用 `weekTC / 7`：日软上限是由**配置的周池**决定的固定值，惩罚周只削减该周的总量，
 *   不改变每天多少算超限 —— 否则受罚周会把 40 币的一天也算成超限，
 *   与冻结在 `LedgerDay.dayLimit` 里的数字（50）自相矛盾。
 *
 * **惩罚只作用于下一周**：所有档位都是「配置的基础额度 × 档位系数」，
 * 而不是「本周已缩水的额度 × 档位系数」。档位 0 是 100% / 100%，即回到
 * `config.weeklyTC` / `config.weeklyLT`；因此空周（`spentTC === 0`）无需任何特判，
 * 它天然落档位 0 并恢复基础额度，惩罚也就不会一路传下去。
 *
 * 由此，入参 `weekLT` 不再参与任何计算：`WeekSettlement` 里没有「本周娱币额度」这个字段，
 * 而 `nextWeekLT` 已经改成「配置基础额度 × 档位系数」。它保留在签名里是因为这是计划
 * 既定的接口（`ensureWeekRollover` 与 Task 6 都按它传参），删掉它只会制造无谓的跨任务改动。
 */
export function settleWeek(input: {
  weekStart: string
  weekEnd: string
  days: LedgerDay[]
  weekTC: number
  weekLT: number
  config: MoneyConfig
}): WeekSettlement {
  let spentTC = 0
  let plannedMin = 0
  let actualMin = 0
  let doneCount = 0
  let missCount = 0
  let unplannedCount = 0
  let unplannedMin = 0
  let nightMin = 0
  let overLimitDays = 0

  // 日软上限取 config 而不是本周实发的 weekTC：见函数头注释
  const daySoftCap = input.config.weeklyTC / 7
  for (const day of input.days) {
    spentTC += day.spentTC
    if (day.spentTC > daySoftCap) overLimitDays++

    for (const entry of day.entries) {
      plannedMin += entry.plannedMin ?? 0
      actualMin += entry.actualMin
      // done / miss 是对全部条目的一条划分：doneCount + missCount === 条目总数
      if (entry.done) doneCount++
      else missCount++
      if (entry.kind === 'unplanned') {
        unplannedCount++
        unplannedMin += entry.actualMin
      }
      nightMin += entry.nightMin
    }
  }

  const weekOver = Math.max(0, spentTC - input.weekTC)
  const penaltyTier = penaltyTierOf(weekOver, input.weekTC)
  const scale = TIER_SCALE[penaltyTier]
  // 惩罚只作用于下一周：档位系数乘的是**配置的基础额度**。空周天然落档位 0
  // （weekOver = 0），于是恢复基础额度这件事不需要单独一条分支。
  const nextWeekTC = input.config.weeklyTC * scale.tc
  const nextWeekLT = input.config.weeklyLT * scale.lt

  // notes 恒为 2–4 条：前两条必有（结论 + 执行情况），后两条按有无比重的数据才出现
  const notes: string[] = [
    penaltyTier === 0
      ? `本周花费 ${spentTC} / ${input.weekTC} 币，未超支，下周额度不打折`
      : `本周花费 ${spentTC} / ${input.weekTC} 币，超支 ${weekOver} 币，` +
        `下周时币 ×${Math.round(scale.tc * 100)}%、娱币 ×${Math.round(scale.lt * 100)}%`,
    unplannedCount > 0
      ? `完成 ${doneCount} 件，没做 ${missCount} 件，计划外 ${unplannedCount} 件 ${unplannedMin} 分钟`
      : `完成 ${doneCount} 件，没做 ${missCount} 件，无计划外事项`
  ]
  if (overLimitDays > 0) notes.push(`有 ${overLimitDays} 天超出日额度 ${daySoftCap} 币`)
  if (nightMin > 0) notes.push(`深夜做事 ${nightMin} 分钟`)

  return {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    weekTC: input.weekTC,
    spentTC,
    weekOver,
    plannedMin,
    actualMin,
    doneCount,
    missCount,
    unplannedCount,
    unplannedMin,
    nightMin,
    overLimitDays,
    penaltyTier,
    nextWeekTC,
    nextWeekLT,
    notes
  }
}

/**
 * 当前周的额度（spec 5 的派生式）：`weeks` 最后一条的 `nextWeekTC` / `nextWeekLT`；
 * 一条结算都没有时回退到配置值。
 *
 * 这里就是「刻意不设 `balance` 字段」的兑现处：额度与余额永远现算、从不落盘，
 * 因此不可能与账本不一致。
 */
export function currentQuota(state: MoneyState): { weekTC: number; weekLT: number } {
  const last = state.weeks[state.weeks.length - 1]
  if (!last) return { weekTC: state.config.weeklyTC, weekLT: state.config.weeklyLT }
  return { weekTC: last.nextWeekTC, weekLT: last.nextWeekLT }
}

/**
 * 补齐跨周结算（spec 7.5）：从「最后一次结算的下一周」一路补到「上一个已结束的周」，
 * 逐周调用 `settleWeek`。**本周不结算** —— 它还没结束。
 *
 * 中间没有任何数据的周按空周结算（`spentTC = 0`）：档位 0 的下一周额度就是配置的基础额度，
 * 因此惩罚不会跨过空周继续衰减。更一般地，任何**未超支**的一周都会把额度拉回配置值 ——
 * 惩罚只作用于下一周。
 *
 * 每一周的额度取值链是 `currentQuota` → 本周结算的 `nextWeekTC` → 下一周的 `weekTC`，
 * 所以逐周补结算与「每周一打开应用一次」的结果完全一致。
 *
 * 没有待补的周时**原对象返回**：调用方（appStore）把它写回 state，
 * 返回值恒等意味着不会触发无谓的重渲染与落盘。
 */
export function ensureWeekRollover(state: MoneyState, today: string): MoneyState {
  const thisMonday = mondayOf(parseDateKey(today))
  const lastCompletedMonday = addDays(thisMonday, -7)
  const firstUnsettled = firstUnsettledMonday(state, lastCompletedMonday)
  if (firstUnsettled === null) return state

  const weeks = [...state.weeks]
  let quota = currentQuota(state)
  for (
    let cursor = firstUnsettled;
    cursor.getTime() <= lastCompletedMonday.getTime();
    cursor = addDays(cursor, 7)
  ) {
    const weekStart = dateKey(cursor)
    const weekEnd = dateKey(addDays(cursor, 6))
    const settlement = settleWeek({
      weekStart,
      weekEnd,
      // 日账本按 date 升序，日期键可直接字典序比区间
      days: state.days.filter((day) => day.date >= weekStart && day.date <= weekEnd),
      weekTC: quota.weekTC,
      weekLT: quota.weekLT,
      config: state.config
    })
    weeks.push(settlement)
    quota = { weekTC: settlement.nextWeekTC, weekLT: settlement.nextWeekLT }
  }

  return { ...state, weeks }
}

/**
 * 第一个待结算的周一；没有待结算的周时返回 `null`。
 *
 * - `weeks` 非空 → 最后一次结算的下一周；
 * - `weeks` 为空但已有日账本 → **最早那天所在周**。少了这条分支，开关开启后
 *   `weeks` 会永远空着（每次都无周可补），已经结算过的日账本永远进不了周结算；
 * - 两者都没有 → `null`：从未产生过账本，不虚构历史。
 *
 * 起始周晚于 `lastCompletedMonday` 时同样返回 `null`，即本周及以后不结算。
 */
function firstUnsettledMonday(state: MoneyState, lastCompletedMonday: Date): Date | null {
  const last = state.weeks[state.weeks.length - 1]
  let start: Date
  if (last) {
    start = addDays(mondayOf(parseDateKey(last.weekStart)), 7)
  } else if (state.days.length > 0) {
    start = mondayOf(parseDateKey(state.days[0].date))
  } else {
    return null
  }
  return start.getTime() <= lastCompletedMonday.getTime() ? start : null
}

