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

function validAppData(value: unknown): value is AppData {
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
      typeof event.endMin === 'number' && Number.isFinite(event.startMin) && Number.isFinite(event.endMin) && typeof event.showInQuadrant === 'boolean')
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
        return validAppData(value) ? value : defaultData()
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
