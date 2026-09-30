import { defaultData } from '../../../shared/defaults'
import type {
  AppData,
  QuadrantApi,
  ReviewExport,
  ReviewRecord,
  SyncMeta
} from '../../../shared/types'

const DATA_KEY = 'quadrant-web-data-v2'
const REVIEWS_KEY = 'quadrant-web-reviews-v1'
/** 同步元信息独立键位：与业务数据分开，避免"清数据"时把同步记忆一起清掉。 */
export const SYNC_META_KEY = 'quadrant-web-sync-meta-v1'

type StoredReview = { fileName: string; content: string; modifiedAt: string }
export interface WebStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type BrowserGlobals = {
  window?: { localStorage: WebStorage; quadrantApi?: QuadrantApi }
  document?: { createElement(tag: string): { href: string; download: string; click(): void } }
  Blob?: new (parts: string[], options: { type: string }) => unknown
  URL?: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function hasStringFields(value: unknown, fields: string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string')
}

/**
 * `photos` 是**可选**字段（老数据没有），但一旦存在就必须是字符串数组。
 *
 * 关键在于校验器对未知字段是"整体放行"的——`validAppData` 只检查白名单字段的
 * 类型，多余字段不校验也不剔除。所以这里必须显式校验，否则一个 `photos: 123`
 * 会被当合法数据收进来，随后渲染层 `.map` 直接抛错。
 */
function validPhotos(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((id) => typeof id === 'string'))
}

const MONEY_NUMERIC_KEYS = [
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
] as const

const QUADRANT_MULTIPLIER_KEYS = ['q1', 'q2', 'q3', 'q4'] as const

const WEEK_SETTLEMENT_NUMERIC_KEYS = [
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
] as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function validLedgerEntry(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
  if (value.kind !== 'planned' && value.kind !== 'unplanned') return false
  if (typeof value.done !== 'boolean') return false
  if (value.sourceId !== null && typeof value.sourceId !== 'string') return false
  if (value.plannedMin !== null && !isFiniteNumber(value.plannedMin)) return false
  if (!isFiniteNumber(value.actualMin) || !isFiniteNumber(value.nightMin)) return false
  if (!isFiniteNumber(value.costTC) || !isFiniteNumber(value.deltaLT)) return false
  return value.quadrant === null || [1, 2, 3, 4].includes(value.quadrant as number)
}

function validLedgerDay(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isDateKey(value.date)) return false
  if (value.settledAt !== null && typeof value.settledAt !== 'string') return false
  if (typeof value.nightPending !== 'boolean') return false
  if (!isFiniteNumber(value.dayLimit) || !isFiniteNumber(value.spentTC)) return false
  if (!isFiniteNumber(value.overdraft) || !isFiniteNumber(value.deltaLT)) return false
  return Array.isArray(value.entries) && value.entries.every(validLedgerEntry)
}

function validWeekSettlement(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isDateKey(value.weekStart) || !isDateKey(value.weekEnd)) return false
  if (![0, 1, 2, 3].includes(value.penaltyTier as number)) return false
  if (!Array.isArray(value.notes) || !value.notes.every((note) => typeof note === 'string')) {
    return false
  }
  return WEEK_SETTLEMENT_NUMERIC_KEYS.every((key) => isFiniteNumber(value[key]))
}

/**
 * `quadrantMultiplier` 是配置里**唯一的非标量字段**，必须整块存在且四个键都是有限数字。
 *
 * 局部对象**不被接受**（缺一个键就判非法）：这与扁平键的处理方式一致 ——
 * 上面 `MONEY_NUMERIC_KEYS` 里少任何一个键同样会让 `isFiniteNumber(undefined)` 为假、
 * 整份数据被拒。桌面的 `dataCodec.normalizeMoney` 走的是另一套口径（逐键回退修复），
 * 一严一宽各自与同侧既有字段保持一致。
 */
function validQuadrantMultiplier(value: unknown): boolean {
  return isRecord(value) && QUADRANT_MULTIPLIER_KEYS.every((key) => isFiniteNumber(value[key]))
}

/**
 * `money` 是**可选**字段（老数据没有），但一旦存在就必须整块合规。
 *
 * 与 `validPhotos` 同一套宽严标准：`undefined` 放行（由 `validAppData` 判断），
 * 存在时逐字段校验。任何一处不合规都判整份数据非法——这是刻意的，宁可让用户
 * 看到默认数据也不要让半截的账本进入渲染层。
 */
function validMoney(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.enabled !== 'boolean') return false
  const config = value.config
  if (!isRecord(config) || !MONEY_NUMERIC_KEYS.every((key) => isFiniteNumber(config[key]))) {
    return false
  }
  if (!validQuadrantMultiplier(config.quadrantMultiplier)) return false
  if (!Array.isArray(value.days) || !value.days.every(validLedgerDay)) return false
  if (!Array.isArray(value.weeks) || !value.weeks.every(validWeekSettlement)) return false
  return true
}

/**
 * `AppData` 形状校验的**唯一实现**。`checkMoney` 决定是否连带校验可选字段 `money`：
 *
 * - `true` —— 完整校验（`validAppData` 用它，是保存 / 同步前的严格判定）；
 * - `false` —— **完全忽略 `money`**（`loadData` 的第二档降级用它，见那里的注释）。
 *
 * 抽成一个函数而不是复制两份：这套校验器一旦分叉，两条路径对「什么算合法」就会
 * 给出不同答案，而它们除 `money` 这一处刻意的例外之外必须永远一致。
 */
function validAppDataCore(value: unknown, checkMoney: boolean): boolean {
  if (!isRecord(value)) return false
  const data = value as Partial<AppData>
  if (data.version !== 2 || !Number.isFinite(data.weekCounterOffset) ||
    !Array.isArray(data.goals) || !Array.isArray(data.events) ||
    !Array.isArray(data.weekPresets) || !Array.isArray(data.weekEvents)) return false
  return data.goals.every((goal) => isRecord(goal) && hasStringFields(goal, ['id', 'title', 'type', 'remark', 'createdAt']) &&
    (goal.type === 'long' || goal.type === 'short') && typeof goal.done === 'boolean' &&
    typeof goal.order === 'number' && Number.isFinite(goal.order) &&
    Array.isArray(goal.groupTitles) && goal.groupTitles.every((v) => typeof v === 'string') &&
    Array.isArray(goal.subtasks) && goal.subtasks.every((subtask) => isRecord(subtask) &&
      hasStringFields(subtask, ['id', 'title', 'remark']) && typeof subtask.done === 'boolean' &&
      typeof subtask.group === 'number' && Number.isFinite(subtask.group) && typeof subtask.order === 'number' && Number.isFinite(subtask.order))) &&
    data.events.every((event) => isRecord(event) && hasStringFields(event, ['id', 'text', 'remark', 'createdAt']) &&
      [1, 2, 3, 4].includes(event.quadrant as number) && validPhotos(event.photos) &&
      ['x', 'y', 'width'].every((field) => typeof event[field] === 'number' && Number.isFinite(event[field] as number))) &&
    data.weekPresets.every((preset) => isRecord(preset) && hasStringFields(preset, ['id', 'title', 'color', 'remark', 'createdAt']) &&
      [1, 2, 3, 4].includes(preset.quadrant as number) && typeof preset.durationMin === 'number' && Number.isFinite(preset.durationMin)) &&
    data.weekEvents.every((event) => isRecord(event) && hasStringFields(event, ['id', 'date', 'title', 'color', 'remark', 'createdAt']) &&
      [1, 2, 3, 4].includes(event.quadrant as number) && typeof event.startMin === 'number' &&
      typeof event.endMin === 'number' && Number.isFinite(event.startMin) && Number.isFinite(event.endMin) && typeof event.showInQuadrant === 'boolean') &&
    (!checkMoney || data.money === undefined || validMoney(data.money))
}

/** 完整校验（含 `money`）：`money === undefined` 仍然合法。 */
function validAppData(value: unknown): value is AppData {
  return validAppDataCore(value, true)
}

function getDefaultStorage(): WebStorage {
  try {
    const browser = globalThis as unknown as BrowserGlobals
    return browser.window?.localStorage ?? { getItem: () => null, setItem: () => undefined }
  } catch {
    return { getItem: () => null, setItem: () => undefined }
  }
}

function readReviews(storage: WebStorage): StoredReview[] {
  try {
    const raw = storage.getItem(REVIEWS_KEY)
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is StoredReview => {
      if (!item || typeof item !== 'object') return false
      const review = item as Partial<StoredReview>
      return typeof review.fileName === 'string' && typeof review.content === 'string' &&
        typeof review.modifiedAt === 'string'
    })
  } catch {
    return []
  }
}

function toRecord(review: StoredReview): ReviewRecord {
  return {
    fileName: review.fileName,
    filePath: `web-review:${review.fileName}`,
    size: new TextEncoder().encode(review.content).byteLength,
    modifiedAt: review.modifiedAt
  }
}

export function createWebPlatformApi(storage?: WebStorage): QuadrantApi {
  const safeStorage = storage ?? getDefaultStorage()
  return {
    async loadData() {
      try {
        const raw = safeStorage.getItem(DATA_KEY)
        if (!raw) return defaultData()
        const value: unknown = JSON.parse(raw)
        if (validAppData(value)) return value
        // 降级分三档，而不是「合法 / 非法」两档：
        //   1. 完整合法 → 原样返回（上面那行）；
        //   2. 除 money 外都合法 → 只丢账本，保住用户的目标 / 事件 / 预设；
        //   3. 其余 → defaultData()。
        //
        // 第 2 档是必须的：`money` 是**可选**字段，而它的 `config` 会随版本加键。
        // 少了这一档，任何一次加键都会让旧账本 payload 整份被判非法，于是用户的全部
        // 数据被 defaultData() 静默清空 —— 不可逆，且用户无从察觉。
        // `money: undefined` 与「该功能从未启用」是同一语义（见 types.ts 的 money 注释）。
        //
        // 注意判定用的是**同一份** validAppDataCore（checkMoney = false），不是复制品：
        // 两条路径对「其余字段是否合法」必须永远给出同一个答案，否则第 2 档就会成为
        // 夹带非法数据的后门。
        if (validAppDataCore(value, false)) {
          return { ...(value as AppData), money: undefined }
        }
        return defaultData()
      } catch {
        return defaultData()
      }
    },
    async saveData(data) {
      try { safeStorage.setItem(DATA_KEY, JSON.stringify(data)) } catch { /* unavailable storage */ }
    },
    async loadSyncMeta() {
      try {
        const raw = safeStorage.getItem(SYNC_META_KEY)
        if (!raw) return null
        const value: unknown = JSON.parse(raw)
        return isRecord(value) ? (value as unknown as Partial<SyncMeta>) : null
      } catch {
        return null
      }
    },
    async saveSyncMeta(meta) {
      try { safeStorage.setItem(SYNC_META_KEY, JSON.stringify(meta)) } catch { /* unavailable storage */ }
    },
    async saveReview(payload: ReviewExport) {
      const now = new Date()
      const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
      const fileName = `${date}复盘-${now.getTime()}.txt`
      const content = `计划完成度：${payload.completion}\n计划完成质量：${payload.quality}\n压力指数：${payload.stress}\n\n${payload.text}`
      const review: StoredReview = { fileName, content, modifiedAt: now.toISOString() }
      try {
        const reviews = readReviews(safeStorage).filter((item) => item.fileName !== fileName)
        safeStorage.setItem(REVIEWS_KEY, JSON.stringify([...reviews, review]))
      } catch (error) { throw error instanceof Error ? error : new Error('无法保存复盘记录') }
      return toRecord(review)
    },
    async listReviews() {
      return readReviews(safeStorage).map(toRecord).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    },
    async openReview(filePath) {
      if (!filePath.startsWith('web-review:')) return { ok: false, error: '文件不存在或已被移动' }
      const fileName = filePath.slice('web-review:'.length)
      const review = readReviews(safeStorage).find((item) => item.fileName === fileName)
      if (!review) return { ok: false, error: '文件不存在或已被移动' }
      const browser = globalThis as unknown as BrowserGlobals
      if (!browser.document || !browser.URL || !browser.Blob) {
        return { ok: false, error: '当前环境不支持下载文件' }
      }
      let url: string | undefined
      try {
        url = browser.URL.createObjectURL(new browser.Blob([review.content], { type: 'text/plain;charset=utf-8' }))
        const anchor = browser.document.createElement('a')
        anchor.href = url
        anchor.download = fileName
        anchor.click()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '无法下载文件' }
      } finally {
        if (url) {
          try { browser.URL.revokeObjectURL(url) } catch { /* cleanup failures must not reject */ }
        }
      }
    }
  }
}

export function getPlatformApi(): QuadrantApi {
  const browser = globalThis as unknown as BrowserGlobals
  if (browser.window?.quadrantApi) return browser.window.quadrantApi
  return createWebPlatformApi()
}

/** 是否运行在 Electron 壳里（据此决定是否启用自动云同步）。 */
export function isDesktopRuntime(): boolean {
  const browser = globalThis as unknown as BrowserGlobals
  return Boolean(browser.window?.quadrantApi)
}
