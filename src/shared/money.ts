import { addDays, dateKey, mondayOf, parseDateKey } from './dateKey'
import type {
  LedgerDay,
  LedgerEntry,
  LedgerEntryKind,
  MoneyConfig,
  MoneyState,
  PenaltyTier,
  Quadrant,
  WeekSettlement
} from './types'

/**
 * 计费与结算参数的默认值（spec R2 第 2 节）。
 *
 * 这是这些常量的**单一真源**：`dataCodec.normalizeMoney` 的非法值回退、
 * 开启开关时写入的初始 `config`，都应引用这里而不是各自重抄一遍。
 *
 * `quadrantMultiplier` 是**首个非标量字段**：它按值展开出一份新对象，
 * 调用方 `{ ...DEFAULT_MONEY_CONFIG }` 得到的是同一份嵌套引用 ——
 * 要改它必须自己再 spread 一层，否则会污染这个共享常量。
 */
export const DEFAULT_MONEY_CONFIG: MoneyConfig = {
  weeklyTC: 560,
  dailyCapTC: 80,
  tcPerHour: 10,
  nightStartMin: 1410,
  nightEndMin: 360,
  nightMultiplier: 1.5,
  minCapRatio: 0.2,
  weeklyLT: 20,
  rewardLT: 0.5,
  penaltyLT: 0.5,
  missPenaltyLT: 1,
  videoLTPerHour: 1,
  gameLTPerHour: 1.5,
  restDayFactor: 0.8,
  abandonedDayTC: 80,
  // ⚠️ 占位值：用户只说了「大量」而未定数，**待用户定标**。
  latePhoneTC: 40,
  // ⚠️ 占位值，同上，**待用户定标**。
  latePhoneLT: 2,
  // 象限倍率的取值见 spec R2 §9.1。Q3 > Q2 是刻意的（「被紧急事推着走」收得更贵）
  quadrantMultiplier: { q1: 1.5, q2: 1.0, q3: 1.2, q4: 0.5 }
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
 * 单条条目的时币花费（spec 6.3「单条条目」+ spec R2 §9.1 的象限倍率）：
 *
 * ```
 * dayMin = actualMin − nightMin
 * base   = (dayMin + nightMin × nightMultiplier) / 60 × tcPerHour
 * costTC = round(base × quadrantMultiplier[quadrant])
 * ```
 *
 * 只对落在深夜区间内的**那部分分钟数**乘倍率，不是整条乘 —— 这正是入参收
 * `nightMin` 这个数字而不是「是否深夜」布尔标记的原因：布尔表达不了部分倍率，
 * 且一旦与分钟数并存，两者就可能不一致。
 *
 * **深夜倍率与象限倍率相乘**：落在深夜的那部分分钟既带深夜倍率、也带象限倍率，
 * 两者不是二选一。例：120 分钟全深夜、Q1 ⇒ `round((120 × 1.5 / 60 × 10) × 1.5) = 45`。
 *
 * `quadrant` 为 `null`（计划外，或计划内但没记录象限）取中性 1.0：象限倍率表达的是
 * **计划工作的价值**，没有象限就没有价值信号，中性费率是唯一不凭空发明信息的取值。
 * 它数值上等于 Q2，但那只是查表的巧合 —— 这里刻意把 `null` 与 `q2` 写成**两条分支**，
 * 将来改 `q2` 的取值不会静默改变无象限条目。
 *
 * 象限权重的取向是「紧急 > 重要」，故 `q3`（1.2）**高于** `q2`（1.0）：
 * 系统对「被紧急事推着走」收得更贵，这正是艾森豪威尔矩阵要纠正的事；`q4`（0.5）最便宜，
 * 因为「无意义消耗」的惩罚通道在娱币那边，不必在时币上重复收一遍。**不要「顺手修正」。**
 */
export function costOfEntry(
  input: { actualMin: number; nightMin: number; quadrant: Quadrant | null },
  config: MoneyConfig
): number {
  const dayMin = input.actualMin - input.nightMin
  const base = ((dayMin + input.nightMin * config.nightMultiplier) / 60) * config.tcPerHour

  const m = config.quadrantMultiplier
  // null 与 q2 分成两条分支：数值相同是查表的巧合，语义不同（无信号 vs 重要不紧急）。
  // 收尾两支**显式列出**：`4 → q4`，其余（运行时的意外值，如 undefined）一律中性 1.0。
  // 若以裸 `else → q4` 收尾，意外值会被静默按 0.5 倍定价，与「没有信号取中性」自相矛盾。
  let multiplier: number
  if (input.quadrant === null) multiplier = 1
  else if (input.quadrant === 1) multiplier = m.q1
  else if (input.quadrant === 2) multiplier = m.q2
  else if (input.quadrant === 3) multiplier = m.q3
  else if (input.quadrant === 4) multiplier = m.q4
  else multiplier = 1

  return Math.round(base * multiplier)
}

/**
 * 当日两条**纯消费**的娱币净变化（spec R2 §6）：
 *
 * ```
 * delta = −(videoMin / 60 × config.videoLTPerHour)
 *       − (gameMin  / 60 × config.gameLTPerHour)
 * ```
 *
 * 「纯消费」是这一支的全部意义：刷视频与打游戏**只扣娱币**，一刻钟的时币也不产生 ——
 * 因此它既不进 `spentTC`、也不进 `quality` 四分类（那四类是「计划 vs 实际」的质量，
 * 与消费无关）。这两问在**结算时**当场问、不预先计划，所以它们不是条目、不进周计划。
 *
 * 返回值恒 ≤ 0；两项都是 0 时返回 `0`（而不是 `−0`）。
 */
export function consumptionDeltaLT(
  input: { videoMin: number; gameMin: number },
  config: MoneyConfig
): number {
  const video = (input.videoMin / 60) * config.videoLTPerHour
  const game = (input.gameMin / 60) * config.gameLTPerHour
  const total = video + game
  // 两项都为 0 时，`-total` 得到的是 `-0`（`Object.is(-0, 0) === false`）：显式收敛成 0，
  // 免得一个负零泄漏进账本与快照比较。
  return total === 0 ? 0 : -total
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
 * 当日可用额度（spec R2 §3.2）：
 *
 * ```
 * dayLimit(i) = max(D × minCapRatio, D − overdraft(i−1))，其中 D = config.dailyCapTC
 * ```
 *
 * 日软上限 `D` **直读独立的 `config.dailyCapTC`（默认 80），不从 `weeklyTC / 7` 派生** ——
 * 派生会让「调周总额」静默改掉「日上限」。注意在默认值下 `560 / 7` 恰好也是 80，
 * 所以「结果等于 80」证明不了任何事：判别它必须让两个数不相等（把 `weeklyTC` 改成 999，
 * 额度仍须是 80）。
 *
 * 日软上限**不阻止消费**，只决定透支：透支只带入**次日**、不累积，靠 `minCapRatio`
 * （默认 0.2 → 保底 16 币）兜底 —— 这正是防死亡螺旋的那一层，否则一次大额透支会让
 * 后续额度长期贴地。自修复也由此而来：超支 30 的次日额度为 50，只在额度内消费则
 * 不产生新透支，第三天回到 80。
 *
 * 保底线取 `D × minCapRatio` 而**不是** `weeklyTC × minCapRatio`：后者在默认值下是
 * 112 币，比日额度本身还高，保底会退化成「永远不扣」。
 */
export function dayLimitOf(previousOverdraft: number, config: MoneyConfig): number {
  const softCap = config.dailyCapTC
  return Math.max(softCap * config.minCapRatio, softCap - previousOverdraft)
}

/**
 * 休息日的固定时币花费（spec R2 §4.3 / §9.2）：`round(dailyCapTC × restDayFactor)`，
 * 默认 `round(80 × 0.8) = 64`。
 *
 * 休息日是「没有安排计划的那一天」里的一条**主动申报**：申报了就只扣这 64 币，
 * 比「逾期未结算」的满额全扣（默认 80）便宜，比一分不花贵。**主动申报能省钱**正是这条规则
 * 存在的意义 —— 它是鼓励用户「看见日结就处理」的激励，不是惩罚。
 *
 * 两个因子都直读 `config`：休息日与日上限同源（`dailyCapTC` 是这条链的单一真源），
 * 写死 64 会在调 `dailyCapTC` / `restDayFactor` 时静默失真。
 */
export function restDayCost(config: MoneyConfig): number {
  return Math.round(config.dailyCapTC * config.restDayFactor)
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
 * —— 休息日是唯一的例外，见下。
 *
 * **娱币的第三条来源是两条纯消费**（`videoMin` / `gameMin`，spec R2 §6）：它们**只扣娱币、
 * 不产生时币**，因此在 `deltaLT` 上叠加 `consumptionDeltaLT`，而对 `spentTC` 毫无影响。
 * 两者都是**可选入参、缺省 0**：本字段加入之前的旧记录没有它们，语义上就是「那天没消费」；
 * 缺省保证了老调用方与老账本都不必改动，同时 `0` 也是唯一不凭空发明消费的取值。
 *
 * **`latePhone` / `previousLatePhone` 是「深夜刷手机」的连带扣款**（spec R2 §6），
 * 两者**不是**同一天的两个输入，而是跨日的两个端点：
 * - `latePhone` —— **本日**日结时用户对「昨天 24:00 后还有没有刷手机」的答案，**原样记进**
 *   返回快照的 `latePhone` 字段；它**不产生本日扣款**（用户明确要求扣次日）。
 * - `previousLatePhone` —— **前一日**记录下的那个答案，由调用方查账本得出。为 `true` 时，
 *   **本日**结算加扣 `config.latePhoneTC` 到 `spentTC`、减 `config.latePhoneLT` 到 `deltaLT`。
 *
 * 两个输入都**缺省 `false`**，且判定一律写成 `=== true`：缺省、`undefined`、旧调用方
 * 一律落到「不扣」。这是刻意的 —— 「没有前一日」与「前一日的记录里根本没有这个字段」
 * （加本字段之前的旧账本）都必须解释成「不扣」，而不是凭空扣一笔。
 *
 * 扣款**计入 `spentTC`**（ruling 2）而不是只减 `deltaLT`：它是那一天**真实花掉的钱**，
 * 因此照常参与 `overdraft` 与 `settleWeek` 的 `overLimitDays`。用户可见的后果是
 * 「昨夜刷手机可能让次日被判超日上限」，这是有意为之。
 *
 * **`isRestDay` 为 true 时走休息日分支**（spec R2 §4.3 / §9.2）：固定扣 `restDayCost(config)`、
 * 条目恒为空、`videoMin` / `gameMin` 归 0。三处刻意的取舍：
 * - **条目与两条消费一律不采纳**：休息日是一整天的主动申报，与「做了多久」无关；传进来的条目
 *   只可能来自一次重跑（见下），若采纳就会把 64 静默抹成条目之和；
 * - **`nightPending` 置 `false`**：休息日不走 23:20 的常规路径，也就没有「深夜补记」这一问。
 *   这与 `abandonExpiredDays` 的处置同源，且同样是**不可重结**的关键 —— 置 false 就把它从
 *   `openNightsBefore` 的候选里摘掉，`confirmNight` 因此永远不会整日重跑它；
 * - `videoMin` / `gameMin` 归 0：那两问属于常规日结流程，休息日整日跳过了它。
 *
 * ⚠️ **但连带扣款是唯一的例外，休息日不免除它**（ruling 1）：`previousLatePhone` 为 true 时
 * `spentTC = restDayCost + config.latePhoneTC`、`deltaLT = −config.latePhoneLT`。理由见下方
 * 休息日分支内的注释 —— 它惩罚的是**昨夜做了什么**，与今天休不休息无关；若让休息日抹掉它，
 * 用户每次刷完手机第二天申报休息就有一条逃生通道。
 * `latePhone`（本日的答案）在休息日同样**照记**，因此休息日也能扣到它次日头上。
 *
 * 返回值对条目数组做的是**浅拷贝**：数组归快照所有，但条目对象仍与调用方共享 ——
 * 调用方不得原地改这些对象（账本是追加写的，条目一旦记录即视为不可变）。
 */
export function settleDay(input: {
  date: string
  entries: LedgerEntry[]
  previousOverdraft: number
  settledAt: string
  /** 当日刷视频分钟数；缺省 0（旧记录 / 未记录）。 */
  videoMin?: number
  /** 当日打游戏分钟数；缺省 0。 */
  gameMin?: number
  /**
   * 是否结算为休息日（spec R2 §4.3）。缺省 `false` ——
   * 休息日必须**显式申报**，绝不能被当成默认计价。
   */
  isRestDay?: boolean
  /**
   * 本日对「昨夜 24:00 后有没有刷手机」的答案，记进快照的 `latePhone`；缺省 `false`。
   * 它**不在本日扣款**，只由次日结算读取。
   */
  latePhone?: boolean
  /**
   * **前一日**记录下的答案；`true` 时本日加扣 `latePhoneTC` / `latePhoneLT`。
   * 缺省 `false`：没有前一日、或前一日没有该字段（旧账本）都是这个取值。
   */
  previousLatePhone?: boolean
  config: MoneyConfig
}): LedgerDay {
  const dayLimit = dayLimitOf(input.previousOverdraft, input.config)

  // 昨夜的连带扣款：落在**本日**，且计入 spentTC（ruling 2，见函数头注释）。
  // 显式 `=== true`：缺省 / undefined 都不扣。两笔都读 config，绝不写死数额。
  const latePenaltyTC = input.previousLatePhone === true ? input.config.latePhoneTC : 0
  const latePenaltyLT = input.previousLatePhone === true ? input.config.latePhoneLT : 0
  // 本日的答案原样记账（缺省即 false）。
  const latePhone = input.latePhone === true

  // 休息日：整天的主动申报，与条目无关。显式 `=== true`，让缺省 / undefined 都落到普通分支。
  if (input.isRestDay === true) {
    const spentTC = restDayCost(input.config) + latePenaltyTC
    return {
      date: input.date,
      settledAt: input.settledAt,
      entries: [],
      videoMin: 0,
      gameMin: 0,
      latePhone,
      dayLimit,
      spentTC,
      overdraft: Math.max(0, spentTC - dayLimit),
      // 休息日的娱币本为 0，但连带扣款照扣：它惩罚的是昨夜做了什么，不是今天休不休息
      // （ruling 1）。若这里抹成 0，用户每次刷完手机第二天申报休息就能躲掉娱币那一半。
      deltaLT: latePenaltyLT === 0 ? 0 : -latePenaltyLT,
      // 见函数头注释：休息日没有「深夜补记」这一问，置 false 同时使它不可重结。
      nightPending: false,
      isRestDay: true
    }
  }

  let spentTC = 0
  let deltaLT = 0
  for (const entry of input.entries) {
    spentTC += costOfEntry(
      { actualMin: entry.actualMin, nightMin: entry.nightMin, quadrant: entry.quadrant },
      input.config
    )
    deltaLT += leisureDelta(
      { kind: entry.kind, done: entry.done, actualMin: entry.actualMin, plannedMin: entry.plannedMin },
      input.config
    )
  }
  // 两条纯消费只扣娱币：叠进 deltaLT，不碰 spentTC（因此也不影响 overdraft / dayLimit）。
  const videoMin = input.videoMin ?? 0
  const gameMin = input.gameMin ?? 0
  deltaLT += consumptionDeltaLT({ videoMin, gameMin }, input.config)

  // 昨夜的连带扣款与上面两条纯消费**不同**：它同时进 spentTC 与 deltaLT（ruling 2）。
  // 顺序无所谓（都是加法），但它必须在 `overdraft` 之前落定 —— 见下面的 spentTC。
  spentTC += latePenaltyTC
  deltaLT -= latePenaltyLT

  return {
    date: input.date,
    settledAt: input.settledAt,
    // 快照独占自己的数组：直接存 input.entries 等于把它交给调用方，
    // 调用方在组装/落盘途中 push/splice 就会改到已冻结的 spentTC/overdraft/dayLimit。
    // 唯一获准修改已结算快照的地方是 Task 8 的深夜补记，且它必须**重算**各项汇总。
    entries: [...input.entries],
    videoMin,
    gameMin,
    latePhone,
    dayLimit,
    spentTC,
    overdraft: Math.max(0, spentTC - dayLimit),
    deltaLT,
    nightPending: true,
    // 普通结算路径恒为 false：休息日必须显式申报（见函数头注释）。
    isRestDay: false
  }
}

/**
 * 结算 `date` 时该带入的「前一日「昨夜刷手机」答案」（spec R2 §6）—— `settleDay` 的
 * `previousLatePhone` 入参的**单一真源**。
 *
 * 只认**日历上的昨天**（与调用方的 `carriedOverdraft` 同一条规矩）：
 * - 昨天没有账本 ⇒ `false`（没有前一日就不扣，**绝不凭空扣一笔**）；
 * - 昨天有账本 ⇒ 它的 `latePhone`；
 * - 昨天有账本但**没有这个字段**（加字段之前的旧记录）⇒ `?? false`。
 *
 * 三支都汇到同一个 `false`，正是「没有前一日」与「旧记录缺席」都解释成「不扣」的兑现处。
 * 抽成纯函数而不是在调用点各写一遍：它是「前一日」这一契约的唯一实现，也因此可被直接测。
 */
export function previousLatePhone(days: LedgerDay[], date: string): boolean {
  const prevDate = dateKey(addDays(parseDateKey(date), -1))
  return days.find((day) => day.date === prevDate)?.latePhone ?? false
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
 * 这里不需要 epsilon —— `168 / 560` 与字面量 `0.3` 舍入到同一个 double，
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
 * `overLimitDays` 比的是**日软上限** `config.dailyCapTC`（spec R2 §3.2 的 D），
 * 与 `dayLimitOf` 同源，而不是 `day.dayLimit`，也不是本周缩水后的 `weekTC / 7`：
 * - 不用 `day.dayLimit`：它已经含了前一日透支，连续透支的日子会被重复计数，
 *   一周里「几天超限」就失去意义；
 * - 不用 `weekTC / 7`：日软上限是由**配置的独立字段**决定的固定值，惩罚周只削减该周的
 *   总量，不改变每天多少算超限 —— 否则受罚周会把 40 币的一天也算成超限，
 *   与冻结在 `LedgerDay.dayLimit` 里的数字（80）自相矛盾。
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

  // 日软上限取 config 的独立字段而不是本周实发的 weekTC：见函数头注释
  const daySoftCap = input.config.dailyCapTC
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
 * 日结窗口长度（天）—— `ensureLedgerDays` / `abandonExpiredDays` / `pendingDays` 的**单一真源**。
 *
 * 它们是一个边界的互补两半，必须由同一常量派生：
 * - `ensureLedgerDays` 物化 `[today − LEDGER_WINDOW_DAYS, today)`；
 * - `abandonExpiredDays` 放弃 `date < today − LEDGER_WINDOW_DAYS`；
 * - `pendingDays` 只返回 `date ≥ today − LEDGER_WINDOW_DAYS` 的待结算日。
 *
 * 若哪一处单独改数，就可能出现「同一次开机里刚物化、又被放弃」——对一个从未存在过的记录扣 80，
 * 直接违反「放弃只作用于已存在的记录」的裁定。
 */
export const LEDGER_WINDOW_DAYS = 7

/**
 * 为 `[today − 7, today)` 里的**每一天**补出一条未结算的日账本（spec R2 §4）。
 *
 * **为什么需要它**：`pendingDays` 只能扫出**已存在**的日账本，而计费是在象限页完成时才追加条目的。
 * 于是「当天没打开应用」这种最常见的情况下，压根没有人会为那天写下一条记录，日结卡片就永远不出现 ——
 * 整个子系统唯一的日常交互入口形同虚设。本函数就是那条缺失的接线。
 *
 * **窗口是固定 7 天、且不再看「有没有计划」**：用户明确要求「没有安排计划的天同样也要问」。
 * 因此本函数**不接受** `plannedDates` —— 它过去只补「计划过的日子」，那正是 R2 推翻的行为：
 * 只在周六、周二有计划的人，周日 / 周一永远不是空洞（空洞会让周滚动永久堵死，见 `openNightsBefore`）。
 * 窗口**不含今天**：它还没结束，此刻谈结算为时过早。
 *
 * **只补不碰**：`days` 里已有该日期的记录（无论已结算还是未结算）一律原样跳过 ——
 * 已结算的快照不可变，未结算的记录里可能已经有用户录入的条目，物化不能覆盖它们。
 *
 * **不物化窗口之外的历史**：用户离开一个月再回来时，只补最近 7 天，更早的日子**不会**被凭空补出来
 * （所以也不会被 `abandonExpiredDays` 扣款 —— 放弃只惩罚「看见了却不结」，不惩罚「不在场」）。
 *
 * 无变化时**原对象返回**：调用方（appStore）据返回值恒等短路，避免每次冷启动都白写一遍盘。
 * 纯函数：`today` 是入参，不读时钟。
 */
export function ensureLedgerDays(money: MoneyState, today: string): MoneyState {
  const todayDate = parseDateKey(today)
  const existing = new Set(money.days.map((day) => day.date))
  const missing: string[] = []
  // offset 从 LEDGER_WINDOW_DAYS 递减到 1：[today−7, today−1]，天然按 date 升序
  for (let offset = LEDGER_WINDOW_DAYS; offset >= 1; offset--) {
    const date = dateKey(addDays(todayDate, -offset))
    if (!existing.has(date)) missing.push(date)
  }
  if (missing.length === 0) return money

  const days = [...money.days]
  for (const date of missing) {
    days.push({
      date,
      settledAt: null,
      entries: [],
      videoMin: 0,
      gameMin: 0,
      // 刚物化出来的空记录还没有答案：那一问要等这一天的日结才问（spec R2 §6）。
      latePhone: false,
      dayLimit: 0,
      spentTC: 0,
      overdraft: 0,
      deltaLT: 0,
      nightPending: true,
      // 刚物化出来的空记录还不是休息日：休息日要由用户主动申报（spec R2 §4.3）。
      isRestDay: false
    })
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { ...money, days }
}

/**
 * 逾期放弃（spec R2 §4「逾期即放弃」）：把掉出 7 天窗口、却仍未结算的日账本
 * 按 `config.abandonedDayTC` **全额**落账（默认 80 = 日上限全额），并冻结为已结算。
 *
 * 用户的规则：日结范围为往前推 7 天，超过范围视为放弃日结，未结算的金钱按照时币当日全扣、娱币不扣。
 * 所以这里只改 `spentTC`（→ 满额），**不动** `deltaLT`（娱币不扣，且条目层面的娱币判定也不再重算）。
 *
 * **放弃只作用于「已经存在的记录」，不补、也不罚「不在场」。** 这是刻意的裁定，不是漏洞：
 * - `ensureLedgerDays` 只物化最近 7 天，一个离开一个月的用户对那几周**没有任何记录**，
 *   于是这里也一分不扣。满额扣款惩罚的是**「看见了日结却不结」**，不是**「缺席」**。
 * - 若改成「按缺席天数无限往回补记录再逐日扣 80」，一个离开整月的人会被扣掉 2000 多币，
 *   一周 560 的池子会被击穿好几倍，产出的是无意义的数字。
 * 因此**不要**把本函数「修」成会物化无界历史的样子。
 *
 * **「已主动结算的空日」与「被放弃的空日」不是一回事**：前者走「那天我什么都没做」的路径，
 * 落成 `spentTC === 0`；后者落成 `spentTC === abandonedDayTC`。数字已经把它俩分开了，
 * 所以**不新增** `LedgerDay` 字段来标记放弃（新标量要动 5 个同步点、多一轮校验，且暂无消费者）。
 *
 * **三个被写死的字段**（其余全部原样保留）：
 * - `spentTC` → `config.abandonedDayTC`（满额）；
 * - `settledAt` → **到期日**，即这个日子最后一次还在窗口内的那一天（`date + LEDGER_WINDOW_DAYS`），
 *   而不是执行时刻 —— 本函数是纯的、不读时钟，只有由 `date` 推出的到期日是可复现的。
 *   注意它写的是**日期键** `YYYY-MM-DD`，不是 `commitDaySettlement` 那种 ISO 时刻，见实现处注释；
 * - `nightPending` → `false`。这一步**必需**，见下。
 *
 * 其余快照字段（`dayLimit` / `overdraft` / `entries` / `videoMin` / `gameMin`）**原样保留**，不是疏忽：
 * 它们对「放弃日」没有消费者 —— `selectMoneyStats` 的日额度走 `dayLimitOf` 现算、`settleWeek` 只累加
 * `spentTC`。满额 80 恰好等于默认日上限，故 `overdraft` 留 0 也表示「一天恰好花掉整天额度、不透支」，
 * 语义自洽；去重算它们只会凭空发明一个从未发生过的结算过程。
 *
 * **为什么必须清 `nightPending`（不可重结的关键）**：`confirmNight` 是唯一获准改动已结算快照的地方，
 * 而它的前提恰恰是「`settledAt !== null`」——**它不拒绝已结算日，它要求的正是已结算日**，然后拿
 * 原来的条目整日重跑 `settleDay`。若被放弃的那天还挂着 `nightPending: true`，`openNightsBefore` 会在
 * 后续某次结算时把它选中，`confirmNight` 随即重跑整天：条目的花费（多为 0）会把这 80 币**静默抹成 0**。
 * 把 `nightPending` 置 false 就把它从 `openNightsBefore` 的候选里摘掉，于是它永不会被重跑。
 * 语义上也成立：从没结算过的一天本来就没有「深夜补记」这一问。
 *
 * 无逾期记录时**原对象返回**：调用方（appStore）据返回值恒等短路，避免无谓落盘。纯函数：`today` 是入参。
 */
export function abandonExpiredDays(money: MoneyState, today: string): MoneyState {
  const windowStart = dateKey(addDays(parseDateKey(today), -LEDGER_WINDOW_DAYS))
  const expired = money.days.some((day) => day.settledAt === null && day.date < windowStart)
  if (!expired) return money

  const days = money.days.map((day) =>
    day.settledAt === null && day.date < windowStart
      ? {
          ...day,
          // `settledAt` 写的是**日期键**（`YYYY-MM-DD`），不是 `commitDaySettlement` 那种 ISO 时刻。
          // 本函数是纯的、不读时钟，只有由 `date` 推出的到期日可复现；现有消费者只判 null / 非 null，
          // 所以格式差异暂无功能影响。将来若有人按 ISO 解析它，必须先改这里 ——
          // 而改它就意味着放弃「纯函数不读时钟」这条性质，要一并重新设计。
          settledAt: dateKey(addDays(parseDateKey(day.date), LEDGER_WINDOW_DAYS)),
          spentTC: money.config.abandonedDayTC,
          nightPending: false
        }
      : day
  )
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
 * 在新的一周里，那个 `nightPending` 没清完之前，本周仍按配置额度运行；等它清掉，滚动立即
 * 补上，额度随即收敛到正确值。我们**宁可要一个延迟，也不要一个安静的账本错误** ——
 * 未来的读者必须能看出这是选择，不是 bug。
 *
 * **延迟的上界（本设计依赖的不变量）**：面板每结算一天 `D`，都会先清掉**所有**早于 `D` 的
 * 未收尾深夜（见 `openNightsBefore`：一次问遍，不是只问最新的那一个）。所以一个挂着
 * `nightPending` 的日账本，会在**下一次晚于它的日结**时被清掉；它一被清掉，它所在的那一周
 * （以及此前所有可结算的周）立刻由这里补上。闭环由调用方负责：`commitDaySettlement` 与
 * `confirmNight` 每次清 `nightPending` 后都会重跑 `rolloverMoneyWeek`，所以被推迟的周不必等重启。
 *
 * **这条上界是「下一个晚于它的日结」，不是墙钟时间上的有界**（如实说明）：用户若从此不再结算
 * 任何更晚的一天，推迟就会一直持续下去；但此时也不再有任何更新的账目等着被滚动。
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
          daySpent += costOfEntry(
            { actualMin: entry.actualMin, nightMin: entry.nightMin, quadrant: entry.quadrant },
            money.config
          )
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
        // 未结算日必须用 settleDay 的**同一套算法**（见函数头注释）：settleDay 现已把两条
        // 纯消费折进 deltaLT，这里就得照样折一遍，否则「结算前一个价、结算后另一个价」。
        // 已结算的日读冻结快照（快照里已含消费），绝不能在这里重复叠加。
        // `?? 0` 兜底：网页端可能载入本字段加入之前的老记录（那时字段合法缺席）。
        dayDelta += consumptionDeltaLT(
          { videoMin: day.videoMin ?? 0, gameMin: day.gameMin ?? 0 },
          money.config
        )
        // 昨夜的连带扣款同理：它由**前一日**的答案触发（settleDay 的 previousLatePhone），
        // 是跨日输入而不是本日字段，所以走 `previousLatePhone` 这个同一真源查账本。
        // 已结算的日走上面那条冻结快照支路（快照里已含扣款），不许在这里重复叠加 ——
        // 否则「结算前」比「结算后」多扣一笔。
        if (previousLatePhone(money.days, date)) {
          daySpent += money.config.latePhoneTC
          dayDelta -= money.config.latePhoneLT
        }
      }
    }

    // `limit` 只走 dayLimitOf：它是「当日可用额度」的单一真源，由**配置的日上限**直读。
    // 这里若改写成 weeklyTC / 7 就是第二套公式 —— 受罚周会把 40 币的一天也算成超限，
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
 * 判定有三条：`settledAt === null`（尚未结算）、`date < today`（这一天已经过完）、
 * 且 `date ≥ today − LEDGER_WINDOW_DAYS`（仍在固定 7 天窗口内）。
 * **今天不计入** —— 它还没结束，此刻结算等于拿半天的账当整天结；判定用的是日期字符串
 * 而非时间戳，正是因为「一天是否结束」在本地日历上是纯粹的日期比较。
 *
 * **下界是本函数的契约，不依赖 `abandonExpiredDays` 是否刚跑过**：桌面端只在 `init` 跑一次开机链，
 * 若应用跨零点一直开着，`today` 前进了而没有人重新物化 / 放弃，昨天还是 `today − 7` 的那天
 * 今天就变成了 `today − 8`、却仍是未结算。此时若把它报成待结算，面板就会按**真实花费**结掉它，
 * 绕过 spec §4 的「逾期即放弃（满额 80）」。所以窗口下界由本函数自己守住 —— 窗口是契约，
 * 开机链只是让账本与契约保持一致的优化。
 *
 * 日期键是定长 `YYYY-MM-DD`，字典序即时间序，所以 `<` / `>=` 与 `.sort()` 都不需要解析回 `Date`。
 * 返回前显式排序，不依赖 `days` 已按升序这一点：调用方守不守约不该改变本函数的语义。
 *
 * 与 `selectMoneyStats` 同源：两者都只读 `money`、把 `today` 当入参，不读时钟、不用随机数。
 */
export function pendingDays(money: MoneyState, today: string): string[] {
  const windowStart = dateKey(addDays(parseDateKey(today), -LEDGER_WINDOW_DAYS))
  return money.days
    .filter((day) => day.settledAt === null && day.date < today && day.date >= windowStart)
    .map((day) => day.date)
    .sort()
}

/**
 * 结算 `date` 时该回头问**哪些**「深夜」：`days` 里所有 `date` **之前**、已结算
 * （`settledAt !== null`）、且 `nightPending === true` 的日账本，按日期**最早优先**返回；
 * 一个都没有就是空数组。
 *
 * **返回全部，而不是只返回最新的那一个** —— 这一点是修一个 Critical 的关键。第四轮的版本
 * 只挑最新，修好了「跨空洞死锁」，却留下同一类的另一个状态：**同一天之前并存两个未收尾的
 * 深夜时，更旧的那一个永远选不中** —— 每次结算都清掉一个更新的、又在被结算的那一天新增一个
 * 更新的，更新的始终存在；更旧的那个于是永远轮不到，它所在的那一周被 `ensureWeekRollover`
 * 的 `break` 永久推迟，后面的周跟着一起堵死，`currentQuota` 永远返回配置值。问遍全部就没有
 * 「选不中」这回事：任何一次晚于它的结算都会把它清掉。
 *
 * **不要求它是日历上的昨天**（第四轮引入，R2-D 保留）：R2-D 之后 `ensureLedgerDays` 会物化
 * `[today − 7, today)` 的**每一天**，窗口内因此不再有空洞；但窗口**左界**那一天（`today − 7`）的前一天
 * `today − 8` 在窗口之外（可能没有记录，或已被 `abandonExpiredDays` 放弃成已结算），所以「严格昨天」
 * 仍会在左界落空。更根本的是：一次结算可能距上一次开机好几天，中途的日子没人问过 —— 死等「昨天」
 * 就会让更早那个未收尾的深夜永远没人问，永久堵死周滚动（见 `ensureWeekRollover` 的 `break`）。
 *
 * **本函数与 `ensureWeekRollover` 共同依赖的不变量**：面板每结算一天，都会先清掉**所有**
 * 早于它的未收尾深夜（逐条问、逐条清）。因此一次结算之后，账本里不会再留下「比被结算日更早
 * 的未收尾深夜」；被推迟的周由此有界 —— 上界是「下一个晚于那个深夜的日结」，不是墙钟时间。
 *
 * 纯函数：只读入参；日期键定长 `YYYY-MM-DD`，比较与排序都靠字典序，不解析回 `Date`，
 * 也不依赖调用方已经按升序排好。
 */
export function openNightsBefore(days: LedgerDay[], date: string): LedgerDay[] {
  return days
    .filter((day) => day.settledAt !== null && day.nightPending && day.date < date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
