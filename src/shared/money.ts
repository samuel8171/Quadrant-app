import type { LedgerEntryKind, MoneyConfig } from './types'

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
