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
 * 为「计划过、但账本里还没有记录」的过去日期补出一条未结算的日账本（spec 7.1）。
 *
 * **为什么需要它**：`pendingDays` 只能扫出**已存在**的日账本，而计费是在象限页完成时才追加条目的。
 * 于是「周末排了计划、当天没打开应用」这种最常见的情况下，压根没有人会为那天写下一条记录，
 * 日结卡片就永远不出现 —— 整个子系统唯一的日常交互入口形同虚设。本函数就是那条缺失的接线。
 *
 * **窗口只回看两周**：`[本周一 − 7, 今天)`。上限是刻意的 —— 用户离开一个月再回来时，
 * 若把整月的计划日全部物化出来，卡片会一次报出几十天待结算，那不是提醒而是惩罚；
 * 两周足够覆盖「隔了一个周末才回来」。窗口**不含今天**：它还没结束，此刻谈结算为时过早。
 *
 * **只补不碰**：`days` 里已有该日期的记录（无论已结算还是未结算）一律原样跳过 ——
 * 已结算的快照不可变，未结算的记录里可能已经有用户录入的条目，物化不能覆盖它们。
 *
 * 无变化时**原对象返回**：调用方（appStore）据返回值恒等短路，避免每次冷启动都白写一遍盘。
 * 纯函数：`today` 与 `plannedDates` 都是入参，不读时钟；`plannedDates` 里的重复项在内部去重，
 * 不要求调用方先去重。
 */
export function ensureLedgerDays(
  money: MoneyState,
  plannedDates: string[],
  today: string
): MoneyState {
  const windowStart = dateKey(addDays(mondayOf(parseDateKey(today)), -7))
  const existing = new Set(money.days.map((day) => day.date))
  const missing = new Set<string>()
  for (const date of plannedDates) {
    if (date < windowStart || date >= today) continue
    if (existing.has(date)) continue
    missing.add(date)
  }
  if (missing.size === 0) return money

  const days = [...money.days]
  for (const date of missing) {
    days.push({
      date,
      settledAt: null,
      entries: [],
      dayLimit: 0,
      spentTC: 0,
      overdraft: 0,
      deltaLT: 0,
      nightPending: true
    })
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { ...money, days }
}

/**
 * 补齐跨周结算（spec 7.5）：从「最后一次结算的下一周」一路补到「上一个已结束的周」，
 * 逐周调用 `settleWeek`。**本周不结算** —— 它还没结束。
 *
 * **含未结算日、或含深夜待补记的周一律推迟**（本任务新增）：只要这一周里还有
 * `settledAt === null` 的日账本，**或**还有 `nightPending === true` 的日账本，就整周不结算，
 * 并**就此停止**、不再往后补。三条理由：
 * - `settleWeek` 只读 `day.spentTC`，而未结算的快照是 0 —— 现在结算等于把这一周冻结成一个
 *   永远为 0 的假数字，而快照一经写入就不许改（唯一豁免只有深夜补记）；
 * - 周日 23:30 之后的做事只能由周一的日结回头补记（见 `confirmNight`）。`nightPending`
 *   未清就结算，等于把「周日深夜那一段」永久排除在周快照之外：周 `spentTC` 少报，
 *   可能把 `penaltyTier` 压低一档，再顺着 `nextWeekTC` 传导成下一周的额度错误 —— 全链静默。
 * - 若跳过它去结算后面的周，额度链（`currentQuota` → 本周 `nextWeekTC` → 下下周 `weekTC`）
 *   就会用错误的前序额度算下去，错得很安静。
 *
 * **推迟是有意的取舍，不是疏忽**：被罚的那一周，其缩水后的额度会**晚一点**才生效 ——
 * 在新的一周里，`nightPending` 没清完之前，本周仍按配置额度运行；等上一周最后一个
 * `nightPending` 清掉，滚动立即补上，额度随即收敛到正确值。我们**宁可要一个有界、
 * 能自愈的延迟，也不要一个安静的账本错误** —— 未来的读者必须能看出这是选择，不是 bug。
 * 闭环由调用方负责：`commitDaySettlement` 与 `confirmNight` 每次清 `nightPending` 后
 * 都会重跑 `rolloverMoneyWeek`，所以推迟最多持续到「下一个能清标记的日子」，不会拖到重启。
 *
 * 中间没有任何数据的周按空周结算（`spentTC = 0`）：`[].some(...) === false` 是假言真值，
 * 所以「一个记录都没有的周」无需任何特判就会走原路径。
 *
 * 每一周的额度取值链是 `currentQuota` → 本周结算的 `nextWeekTC` → 下一周的 `weekTC`，
 * 所以逐周补结算与「每周一打开应用一次」的结果完全一致。
 *
 * 没有待补的周（或第一周就被推迟）时**原对象返回**：调用方（appStore）把它写回 state，
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
    // 日账本按 date 升序，日期键可直接字典序比区间
    const days = state.days.filter((day) => day.date >= weekStart && day.date <= weekEnd)
    // 还有没结算的日、或还有深夜待补记 → 整周推迟，且不再往后补（见函数头注释）。
    // 深夜待补记这一条是刻意的：早结算会让周日 23:30 之后的事永远进不了周快照。
    if (days.some((day) => day.settledAt === null || day.nightPending)) break
    const settlement = settleWeek({
      weekStart,
      weekEnd,
      days,
      weekTC: quota.weekTC,
      weekLT: quota.weekLT,
      config: state.config
    })
    weeks.push(settlement)
    quota = { weekTC: settlement.nextWeekTC, weekLT: settlement.nextWeekLT }
  }

  // 第一周就被推迟时 weeks 没有增长 —— 返回原对象，别制造无谓的落盘
  if (weeks.length === state.weeks.length) return state
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

/**
 * `MoneyStats.daily[i].weekday` 的取值：周一~周日的**裸单字**。
 *
 * 不能复用 `weekRules` 的 `WEEKDAY_NAMES`：那个常量返回 `['周一', '周二', …]`（带「周」前缀），
 * 而且住在 `renderer/` —— `shared/` 反向依赖界面层会破坏依赖方向（理由同 `dateKey.ts`）。
 */
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

/**
 * `selectMoneyStats` 的返回契约：Task 7 的六个小组件**只**消费它，字段名逐字固定。
 *
 * 每个字段都是**派生**值，没有一个落盘 —— 这正是 `MoneyState` 刻意不设 `balance` 的原因
 * （见 `currentQuota`）：额度与余额永远现算，就不可能和账本不一致。
 * 单条日统计里也没有 `balance`：只有 `spentTC` / `limit` / `ratio`。
 */
export interface MoneyStats {
  /** 本周周一（'YYYY-MM-DD'）。 */
  weekStart: string
  /** 本周发放的时币额度（已含上周惩罚后的值，见 `currentQuota`）。 */
  weekTC: number
  /** 本周已花时币（逐日花费之和：已结算的日取冻结快照，未结算的日按条目现算）。 */
  spentTC: number
  /** 本周剩余时币，恒等于 `weekTC − spentTC`（超支时为负）。 */
  remainingTC: number
  /** 本周发放的娱币额度。 */
  weekLT: number
  /** 本周娱币净变化：奖励为正、惩罚为负（逐日 `deltaLT` 之和，口径同 `spentTC`）。 */
  spentLT: number
  /** 本周剩余娱币，恒等于 `weekLT + spentLT`。 */
  remainingLT: number
  /** 周一~周日**恒 7 项**，缺席的日按零花计。 */
  daily: { date: string; weekday: string; spentTC: number; limit: number; ratio: number }[]
  /** 本周深夜做事总分钟数。 */
  nightMin: number
  /** 深夜分钟数占本周实际做事分钟数的比例（0~1；本周没有做事时为 0）。 */
  nightRatio: number
  /**
   * 条目质量四分类计数。
   *
   * 计划外**且已完成**的不进任何一类；但没做的条目（无论计划内外）都算 `missed` ——
   * 分类顺序与 `leisureDelta` 一致，`!done` 先判。
   */
  quality: { efficient: number; normal: number; inefficient: number; missed: number }
  /** **实时预演**：本周若此刻结束会落到的档位（不是任何已存的结算值）。 */
  penaltyTier: PenaltyTier
  /** 该档位下下周的时币额度 = `config.weeklyTC × 档位系数`。 */
  nextWeekTC: number
  /** 该档位下下周的娱币额度 = `config.weeklyLT × 档位系数`。 */
  nextWeekLT: number
}

/**
 * 把整份 `MoneyState` 摊成小组件要读的**只读视图模型**（spec 12.5）。
 *
 * 纯函数：`today` 是入参，不读时钟、不用随机数；同一份输入永远得到同一份输出。
 *
 * **只读条目自身的快照字段**：`LedgerEntry.sourceId` 可能指向一个已被删除的源事件，
 * 而 `MoneyState` 里根本没有 `weekEvents` —— 本函数不做任何源查找，因此既不会抛错、
 * 也不会漏算（标题等快照字段在记录时就已冻结）。
 *
 * **每一天的钱只有一个真源**，否则同屏的两个小组件会互相矛盾（今天的条目进了
 * 执行质量，却进不了本周已用）：
 * - **已结算**的日（`settledAt` 非 null）→ 冻结快照（`spentTC` / `deltaLT`）就是权威，
 *   即使它与条目重算的结果不符也不得改写（快照优先，与 `settleWeek` 同一条规矩）；
 * - **未结算**的日（`settledAt` 为 null）→ 快照还没冻结（字段仍是 0），按 `settleDay`
 *   的同一套算法从条目现算：`spentTC = Σ costOfEntry(...)`、`deltaLT = Σ leisureDelta(...)`。
 *
 * 理由：仪表盘的职责是「显示到目前为止已经记录下的东西」。今天的数字因此是**临时**的，
 * 白天会随着新条目一直长；23:20 结算后，冻结快照整体取代这份推导，数字不会跳变。
 * 缺席的日（本周没有这个日账本）仍然按零计。
 *
 * 同一条规矩也管**跨日透支**：`previousOverdraft` 是 `daily[i].limit` 与 `daily[i].ratio`
 * 的唯一输入，所以它同样按日择一真源 —— 已结算的日取快照 `overdraft`，未结算的日取
 * `max(0, 当天现算花费 − 当天 limit)`。否则「今天超支」会既画进柱子、又传不到明天。
 *
 * 计数与时长（`quality` / `nightMin` / `nightRatio`）本来就只能来自条目 —— 没有快照可读，
 * 所以它们对每一天都读 `entries`，与上面的口径天然一致。
 */
export function selectMoneyStats(money: MoneyState, today: string): MoneyStats {
  const weekStartDate = mondayOf(parseDateKey(today))
  const weekStart = dateKey(weekStartDate)
  const quota = currentQuota(money)

  // 本周 7 天的日期键由它锁定 daily 的长度与顺序（周一定为下标 0）
  const dates: string[] = []
  for (let i = 0; i < 7; i++) dates.push(dateKey(addDays(weekStartDate, i)))
  const weekEnd = dates[6]

  // 日期键是定长 `YYYY-MM-DD`，字典序即时间序。`days` 按 date 升序，后写覆盖先写
  const byDate = new Map<string, LedgerDay>()
  for (const day of money.days) {
    if (day.date >= weekStart && day.date <= weekEnd) byDate.set(day.date, day)
  }

  const daily: MoneyStats['daily'] = []
  const quality = { efficient: 0, normal: 0, inefficient: 0, missed: 0 }
  let spentTC = 0
  let spentLT = 0
  let nightMin = 0
  let actualMin = 0
  // 跨日滚动的透支：周一（下标 0）没有前一日，从 0 起
  let previousOverdraft = 0

  for (let i = 0; i < 7; i++) {
    const date = dates[i]
    const day = byDate.get(date)

    // 一天的钱只认一个真源：已结算读冻结快照，未结算按条目现算（见函数头注释）。
    // 两处都用既有辅助，不另写计费/娱币公式。缺席的日（day 为 undefined）恒为 0。
    let daySpent = 0
    let dayDelta = 0
    if (day) {
      if (day.settledAt !== null) {
        daySpent = day.spentTC
        dayDelta = day.deltaLT
      } else {
        for (const entry of day.entries) {
          daySpent += costOfEntry({ actualMin: entry.actualMin, nightMin: entry.nightMin }, money.config)
          dayDelta += leisureDelta(
            {
              kind: entry.kind,
              done: entry.done,
              actualMin: entry.actualMin,
              plannedMin: entry.plannedMin
            },
            money.config
          )
        }
      }
    }

    // `limit` 只走 dayLimitOf：它是「当日可用额度」的单一真源，由**配置的周池**派生。
    // 这里若改写成 weekTC / 7 就是第二套公式 —— 受罚周会把 40 币的一天也算成超限，
    // 且与冻结在 LedgerDay.dayLimit 里的数字自相矛盾（这正是前一版修掉的 bug）。
    // 传入的是**前一日**的透支（见循环末尾的滚动）。
    const limit = dayLimitOf(previousOverdraft, money.config)
    daily.push({
      date,
      weekday: WEEKDAY_LABELS[i],
      spentTC: daySpent,
      limit,
      // limit 为 0 时不许出现 Infinity / NaN：无额度可谈，比例取 0
      ratio: limit > 0 ? daySpent / limit : 0
    })
    spentTC += daySpent
    spentLT += dayDelta

    if (day) {
      for (const entry of day.entries) {
        actualMin += entry.actualMin
        nightMin += entry.nightMin

        // 与 leisureDelta 同序：没做优先于计划外，只有「计划内 + 已完成」才有质量可判
        if (!entry.done) {
          quality.missed++
        } else if (entry.kind === 'planned') {
          const planned = entry.plannedMin
          if (planned === null || planned <= 0) {
            quality.normal++ // 没有可比基准，既不奖励也不惩罚
          } else if (entry.actualMin <= planned) {
            quality.efficient++
          } else if (entry.actualMin > planned * 1.5) {
            quality.inefficient++
          } else {
            quality.normal++
          }
        }
      }
    }

    // 透支只带入**次日**（与 settleDay 同一条规则），且必须和当天的钱同源：
    // 已结算的日认冻结快照；未结算的日按同一天现算的花费算 —— 若这里退回读
    // `day.overdraft`（未冻结时恒为 0），今天超支的部分就传不到明天，
    // 次日的额度会虚高，而当天那根柱子却已经画成超限。
    previousOverdraft =
      day && day.settledAt !== null ? day.overdraft : Math.max(0, daySpent - limit)
  }

  // 与 settleWeek 的收尾同源：档位由本周的实时花费预演，系数乘的是**配置的基础额度**
  const weekOver = Math.max(0, spentTC - quota.weekTC)
  const penaltyTier = penaltyTierOf(weekOver, quota.weekTC)
  const scale = TIER_SCALE[penaltyTier]

  return {
    weekStart,
    weekTC: quota.weekTC,
    spentTC,
    remainingTC: quota.weekTC - spentTC,
    weekLT: quota.weekLT,
    spentLT,
    remainingLT: quota.weekLT + spentLT,
    daily,
    nightMin,
    nightRatio: actualMin > 0 ? nightMin / actualMin : 0,
    quality,
    penaltyTier,
    nextWeekTC: money.config.weeklyTC * scale.tc,
    nextWeekLT: money.config.weeklyLT * scale.lt
  }
}

/**
 * 待结算的日期列表（spec 7.1 的日结卡片数据源），按日期升序。
 *
 * 判定只有两条：`settledAt === null`（尚未结算）且 `date < today`（这一天已经过完）。
 * **今天不计入** —— 它还没结束，此刻结算等于拿半天的账当整天结；判定用的是日期字符串
 * 而非时间戳，正是因为「一天是否结束」在本地日历上是纯粹的日期比较。
 *
 * 日期键是定长 `YYYY-MM-DD`，字典序即时间序，所以 `<` 与 `.sort()` 都不需要解析回 `Date`。
 * 返回前显式排序，不依赖 `days` 已按升序这一点：调用方守不守约不该改变本函数的语义。
 *
 * 与 `selectMoneyStats` 同源：两者都只读 `money`、把 `today` 当入参，不读时钟、不用随机数。
 */
export function pendingDays(money: MoneyState, today: string): string[] {
  return money.days
    .filter((day) => day.settledAt === null && day.date < today)
    .map((day) => day.date)
    .sort()
}
