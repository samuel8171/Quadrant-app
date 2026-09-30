import type { LedgerDay, LedgerEntry, LedgerEntryKind, MoneyConfig } from './types'

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
    entries: input.entries,
    dayLimit,
    spentTC,
    overdraft: Math.max(0, spentTC - dayLimit),
    deltaLT,
    nightPending: true
  }
}
