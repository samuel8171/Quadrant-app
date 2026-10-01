import {
  MAX_EVENT_PHOTOS,
  WEEK_COLORS,
  type AppData,
  type Goal,
  type LedgerDay,
  type LedgerEntry,
  type MoneyConfig,
  type MoneyState,
  type PenaltyTier,
  type Quadrant,
  type QuadrantEvent,
  type QuadrantMultiplier,
  type Subtask,
  type WeekEvent,
  type WeekPreset,
  type WeekSettlement
} from '../shared/types'
import { DEFAULT_MONEY_CONFIG } from '../shared/money'

export function serializeData(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function parseData(raw: string): AppData {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  if (!parsed || (parsed.version !== 1 && parsed.version !== 2)) {
    throw new Error('invalid data file')
  }
  const goals = Array.isArray(parsed.goals)
    ? (parsed.goals as unknown[]).map((g) => normalizeGoal(g as Record<string, unknown>))
    : []
  const events = Array.isArray(parsed.events)
    ? (parsed.events as unknown[]).map((e) => normalizeEvent(e as Record<string, unknown>))
    : []
  const weekPresets = Array.isArray(parsed.weekPresets)
    ? (parsed.weekPresets as unknown[]).map((p) =>
        normalizeWeekPreset(p as Record<string, unknown>)
      )
    : []
  const weekEvents = Array.isArray(parsed.weekEvents)
    ? (parsed.weekEvents as unknown[]).map((e) =>
        normalizeWeekEvent(e as Record<string, unknown>)
      )
    : []
  const money = normalizeMoney(parsed.money)
  return {
    version: 2,
    goals,
    events,
    weekPresets,
    weekEvents,
    weekCounterOffset:
      typeof parsed.weekCounterOffset === 'number' ? parsed.weekCounterOffset : 0,
    ...(money ? { money } : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isPenaltyTier(value: unknown): value is PenaltyTier {
  return value === 0 || value === 1 || value === 2 || value === 3
}

/**
 * `MoneyConfig` 里所有**标量**键。
 *
 * 显式排除 `quadrantMultiplier`：它不是数字而是嵌套对象，混进来会让
 * `config[key] = value` 的赋值类型退化成 `number & QuadrantMultiplier`。
 */
type NumericMoneyKey = Exclude<keyof MoneyConfig, 'quadrantMultiplier'>

const MONEY_NUMERIC_KEYS: readonly NumericMoneyKey[] = [
  'weeklyTC',
  'dailyCapTC',
  'tcPerHour',
  'nightStartMin',
  'nightEndMin',
  'nightMultiplier',
  'minCapRatio',
  'weeklyLT',
  'rewardLT',
  'penaltyLT',
  'missPenaltyLT',
  'videoLTPerHour',
  'gameLTPerHour',
  'restDayFactor',
  'abandonedDayTC',
  'latePhoneTC',
  'latePhoneLT'
]

/** `quadrantMultiplier` 的四个键；嵌套字段单独走一套回退，不混进扁平键列表。 */
const QUADRANT_KEYS: readonly (keyof QuadrantMultiplier)[] = ['q1', 'q2', 'q3', 'q4']

/**
 * `config` 逐键校验：非有限数字的键回退到 `DEFAULT_MONEY_CONFIG` 的同名值。
 *
 * **嵌套字段（`quadrantMultiplier`）也逐键回退**：整体缺失时四个键都取默认值；
 * 只缺一两个键时，缺的那些单独回退、已有的保留 —— 即**局部对象被修复而不是整块丢弃**。
 * 这与 web 端的 `validMoney`（整体存在但任一键不是有限数字就判整份数据非法）是
 * 一严一宽的两套口径，各自与同侧既有字段的处理方式保持一致。
 *
 * 回退出来的 `quadrantMultiplier` 是**新对象**：`{ ...DEFAULT_MONEY_CONFIG }` 只复制
 * 顶层，嵌套对象仍是共享引用，直接改写它会污染 `DEFAULT_MONEY_CONFIG`。
 */
function normalizeMoneyConfig(raw: unknown): MoneyConfig {
  const source = isRecord(raw) ? raw : {}
  const config: MoneyConfig = { ...DEFAULT_MONEY_CONFIG }
  for (const key of MONEY_NUMERIC_KEYS) {
    const value = source[key]
    if (isFiniteNumber(value)) config[key] = value
  }
  const rawQuadrant = isRecord(source.quadrantMultiplier) ? source.quadrantMultiplier : {}
  const quadrantMultiplier: QuadrantMultiplier = { ...DEFAULT_MONEY_CONFIG.quadrantMultiplier }
  for (const key of QUADRANT_KEYS) {
    const value = rawQuadrant[key]
    if (isFiniteNumber(value)) quadrantMultiplier[key] = value
  }
  config.quadrantMultiplier = quadrantMultiplier
  return config
}

/** 结构不全的单条条目返回 `null`（由调用方丢弃），不使整份数据失效。 */
function normalizeLedgerEntry(raw: unknown): LedgerEntry | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  if (raw.kind !== 'planned' && raw.kind !== 'unplanned') return null
  if (typeof raw.done !== 'boolean') return null
  if (raw.sourceId !== null && typeof raw.sourceId !== 'string') return null
  if (raw.plannedMin !== null && !isFiniteNumber(raw.plannedMin)) return null
  if (!isFiniteNumber(raw.actualMin) || !isFiniteNumber(raw.nightMin)) return null
  if (!isFiniteNumber(raw.costTC) || !isFiniteNumber(raw.deltaLT)) return null
  const quadrant =
    raw.quadrant === null ? null : isQuadrant(raw.quadrant) ? raw.quadrant : undefined
  if (quadrant === undefined) return null
  return {
    id: raw.id,
    kind: raw.kind,
    sourceId: raw.sourceId,
    title: raw.title,
    quadrant,
    plannedMin: raw.plannedMin,
    actualMin: raw.actualMin,
    done: raw.done,
    nightMin: raw.nightMin,
    costTC: raw.costTC,
    deltaLT: raw.deltaLT
  }
}

function normalizeLedgerDay(raw: unknown): LedgerDay | null {
  if (!isRecord(raw)) return null
  if (!isDateKey(raw.date)) return null
  if (raw.settledAt !== null && typeof raw.settledAt !== 'string') return null
  if (typeof raw.nightPending !== 'boolean') return null
  if (!isFiniteNumber(raw.dayLimit) || !isFiniteNumber(raw.spentTC)) return null
  if (!isFiniteNumber(raw.overdraft) || !isFiniteNumber(raw.deltaLT)) return null
  if (!Array.isArray(raw.entries)) return null
  const entries = raw.entries
    .map((entry) => normalizeLedgerEntry(entry))
    .filter((entry): entry is LedgerEntry => entry !== null)
  return {
    date: raw.date,
    settledAt: raw.settledAt,
    entries,
    // 两条纯消费是**逐字段有限回退**，缺失/非有限一律回退到 0，而**不是**整日丢帧：
    // 它们是在本字段加入之前的老记录里合法缺席的，缺席只意味着「那天没记录消费」。
    // 若照其他快照标量那样判空即 return null，桌面端会静默丢掉整个旧日账本。
    videoMin: isFiniteNumber(raw.videoMin) ? raw.videoMin : 0,
    gameMin: isFiniteNumber(raw.gameMin) ? raw.gameMin : 0,
    // `latePhone` 与本字段之前的旧记录的关系同 `isRestDay`：缺席是合法的，一律按 false
    // （「没刷」）补齐，而不是判空即 `return null` 丢掉整个旧日账本。非布尔同样回退 false。
    latePhone: raw.latePhone === true,
    dayLimit: raw.dayLimit,
    spentTC: raw.spentTC,
    overdraft: raw.overdraft,
    deltaLT: raw.deltaLT,
    nightPending: raw.nightPending,
    // `isRestDay` 与本字段之前的旧记录的关系同 `videoMin` / `gameMin`：缺席是合法的，
    // 一律按 false（「不是休息日」）补齐，而不是判空即 `return null` 丢掉整个旧日账本。
    // 非布尔同样回退 false：布尔快照字段没法像数字那样「修复成有限值」，只能取唯一安全的默认。
    isRestDay: raw.isRestDay === true
  }
}

function normalizeWeekSettlement(raw: unknown): WeekSettlement | null {
  if (!isRecord(raw)) return null
  if (!isDateKey(raw.weekStart) || !isDateKey(raw.weekEnd)) return null
  if (!isPenaltyTier(raw.penaltyTier)) return null
  if (!Array.isArray(raw.notes) || !raw.notes.every((note) => typeof note === 'string')) {
    return null
  }
  const numbers: (keyof WeekSettlement)[] = [
    'weekTC',
    'spentTC',
    'weekOver',
    'plannedMin',
    'actualMin',
    'doneCount',
    'missCount',
    'unplannedCount',
    'unplannedMin',
    'nightMin',
    'overLimitDays',
    'nextWeekTC',
    'nextWeekLT'
  ]
  if (!numbers.every((key) => isFiniteNumber(raw[key]))) return null
  return {
    weekStart: raw.weekStart,
    weekEnd: raw.weekEnd,
    weekTC: raw.weekTC as number,
    spentTC: raw.spentTC as number,
    weekOver: raw.weekOver as number,
    plannedMin: raw.plannedMin as number,
    actualMin: raw.actualMin as number,
    doneCount: raw.doneCount as number,
    missCount: raw.missCount as number,
    unplannedCount: raw.unplannedCount as number,
    unplannedMin: raw.unplannedMin as number,
    nightMin: raw.nightMin as number,
    overLimitDays: raw.overLimitDays as number,
    penaltyTier: raw.penaltyTier,
    nextWeekTC: raw.nextWeekTC as number,
    nextWeekLT: raw.nextWeekLT as number,
    notes: raw.notes
  }
}

/**
 * 把持久化的 `money` 值规整成 `MoneyState`；不合法时返回 `undefined`。
 *
 * 语义与 `validAppData` 的「整体放行未知字段」不同：这里是**逐字段重建**。
 * 非对象、或 `enabled` 不是布尔 → 整块丢弃（返回 `undefined`）；
 * `days` / `weeks` 逐项结构过滤，字段不全的项丢弃但不使整份数据失效。
 *
 * `enabledAt` 是**后加的可选字段**：只有合法日期键才保留，缺席或非法一律落成 undefined
 * （= 不夹取窗口下界）。这必须与 `MoneyState.enabledAt` 的语义一致 —— 若在这里替旧数据
 * 补一个「今天」，旧账本里合法的待结算日会被下一步的窗口夹取直接抹掉。
 */
export function normalizeMoney(raw: unknown): MoneyState | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.enabled !== 'boolean') return undefined
  const days = Array.isArray(raw.days)
    ? raw.days
        .map((day) => normalizeLedgerDay(day))
        .filter((day): day is LedgerDay => day !== null)
    : []
  const weeks = Array.isArray(raw.weeks)
    ? raw.weeks
        .map((week) => normalizeWeekSettlement(week))
        .filter((week): week is WeekSettlement => week !== null)
    : []
  return {
    enabled: raw.enabled,
    config: normalizeMoneyConfig(raw.config),
    days,
    weeks,
    ...(isDateKey(raw.enabledAt) ? { enabledAt: raw.enabledAt } : {})
  }
}

function isQuadrant(v: unknown): v is Quadrant {
  return v === 1 || v === 2 || v === 3 || v === 4
}

function normalizeDuration(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v / 5) * 5 : 60
  return Math.min(600, Math.max(5, n))
}

function normalizeWeekPreset(raw: Record<string, unknown>): WeekPreset {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    color:
      typeof raw.color === 'string' && (WEEK_COLORS as readonly string[]).includes(raw.color)
        ? raw.color
        : WEEK_COLORS[0],
    quadrant: isQuadrant(raw.quadrant) ? raw.quadrant : 1,
    durationMin: normalizeDuration(raw.durationMin),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function todayKey(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function normalizeWeekEvent(raw: Record<string, unknown>): WeekEvent {
  let start = typeof raw.startMin === 'number' ? Math.round(raw.startMin / 5) * 5 : 420
  let end = typeof raw.endMin === 'number' ? Math.round(raw.endMin / 5) * 5 : 480
  if (!(start >= 0 && start < 1440)) start = 420
  if (!(end > start)) end = start + 60
  if (end > 1440) end = 1440
  if (end - start > 600) end = start + 600
  return {
    id: String(raw.id ?? ''),
    date:
      typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
        ? raw.date
        : todayKey(),
    title: String(raw.title ?? ''),
    color:
      typeof raw.color === 'string' && (WEEK_COLORS as readonly string[]).includes(raw.color)
        ? raw.color
        : WEEK_COLORS[0],
    quadrant: isQuadrant(raw.quadrant) ? raw.quadrant : 1,
    startMin: start,
    endMin: end,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    presetId: typeof raw.presetId === 'string' ? raw.presetId : undefined,
    showInQuadrant: Boolean(raw.showInQuadrant),
    quadrantEventId:
      typeof raw.quadrantEventId === 'string' ? raw.quadrantEventId : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function normalizeSubtask(raw: Record<string, unknown>): Subtask {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    done: Boolean(raw.done),
    group: typeof raw.group === 'number' && raw.group >= 1 ? Math.floor(raw.group) : 1,
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    order: typeof raw.order === 'number' ? raw.order : 0
  }
}

function normalizeGoal(raw: Record<string, unknown>): Goal {
  const groupTitles = Array.isArray(raw.groupTitles)
    ? raw.groupTitles
        .slice(0, 8)
        .map((title) => (typeof title === 'string' ? title : ''))
    : []
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    type: raw.type === 'short' ? 'short' : 'long',
    done: Boolean(raw.done),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    groupTitles: groupTitles.length > 0 ? groupTitles : [''],
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.map(normalizeSubtask) : [],
    order: typeof raw.order === 'number' ? raw.order : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  }
}

function normalizeEvent(raw: Record<string, unknown>): QuadrantEvent {
  // `photos` 走显式白名单：本函数是**逐字段重建**（不是展开原对象），
  // 漏掉这里的话，桌面端每次读写都会把照片 id 静默擦掉。
  const photos = Array.isArray(raw.photos)
    ? raw.photos.filter((id): id is string => typeof id === 'string').slice(0, MAX_EVENT_PHOTOS)
    : undefined
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    remark: typeof raw.remark === 'string' ? raw.remark : '',
    quadrant: raw.quadrant === 2 || raw.quadrant === 3 || raw.quadrant === 4 ? raw.quadrant : 1,
    x: typeof raw.x === 'number' ? raw.x : 0,
    y: typeof raw.y === 'number' ? raw.y : 0,
    width: typeof raw.width === 'number' ? raw.width : 6,
    deadline: typeof raw.deadline === 'string' ? raw.deadline : undefined,
    escalateAt: typeof raw.escalateAt === 'string' ? raw.escalateAt : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    photos: photos && photos.length > 0 ? photos : undefined
  }
}
