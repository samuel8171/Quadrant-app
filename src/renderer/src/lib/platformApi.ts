import { decodeAppDataText, LOCAL_SNAPSHOT_META_KEY, validAppData } from '../../../shared/appDataCodec'
import { defaultData } from '../../../shared/defaults'
import type {
  LocalSnapshot,
  QuadrantApi,
  ReviewExport,
  ReviewRecord,
  SyncMeta
} from '../../../shared/types'

const DATA_KEY = 'quadrant-web-data-v2'
const REVIEWS_KEY = 'quadrant-web-reviews-v1'
/** 同步元信息独立键位：与业务数据分开，避免"清数据"时把同步记忆一起清掉。 */
export const SYNC_META_KEY = 'quadrant-web-sync-meta-v1'

export class LocalSnapshotConflict extends Error {
  override name = 'LocalSnapshotConflict'
}

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

function getDefaultStorage(): WebStorage {
  try {
    const browser = globalThis as unknown as BrowserGlobals
    return browser.window?.localStorage ?? { getItem: () => null, setItem: () => { throw new Error('浏览器存储不可用') } }
  } catch {
    return { getItem: () => null, setItem: () => { throw new Error('浏览器存储不可用') } }
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
  function embeddedMeta(raw: string | null): Partial<SyncMeta> | null {
    const value: unknown = raw ? JSON.parse(raw) : null
    const embedded = isRecord(value) ? value[LOCAL_SNAPSHOT_META_KEY] : null
    return isRecord(embedded) && typeof embedded.snapshotId === 'string'
      ? (embedded as Partial<SyncMeta>)
      : null
  }

  function readMetadata(raw: string | null): Partial<SyncMeta> | null {
    const embedded = embeddedMeta(raw)
    let stored: unknown
    try {
      const rawMeta = safeStorage.getItem(SYNC_META_KEY)
      stored = rawMeta ? JSON.parse(rawMeta) : null
    } catch {
      stored = null
    }
    if (embedded && !(
      isRecord(stored) && stored.snapshotId === embedded.snapshotId && stored.deviceId === embedded.deviceId
    )) return embedded
    if (!isRecord(stored)) return null
    if (!embedded && typeof stored.snapshotId === 'string') {
      const { snapshotId: _staleId, ...legacy } = stored
      return { ...legacy, dirty: false } as Partial<SyncMeta>
    }
    return stored as Partial<SyncMeta>
  }

  function loadSnapshot(): LocalSnapshot {
    try {
      const raw = safeStorage.getItem(DATA_KEY)
      const result = decodeAppDataText(raw)
      if (result.kind === 'recovery') return result
      return { ...result, syncMeta: readMetadata(raw) }
    } catch {
      return { kind: 'recovery', data: defaultData() }
    }
  }

  function save(data: LocalSnapshot['data'], meta?: SyncMeta, previousSnapshotId?: string): void {
    const raw = safeStorage.getItem(DATA_KEY)
    if (decodeAppDataText(raw).kind === 'recovery') throw new Error('存档需要恢复，原始数据已保留')
    if (!validAppData(data)) throw new Error('存档结构无效')
    if (meta && embeddedMeta(raw)?.snapshotId !== previousSnapshotId) {
      throw new LocalSnapshotConflict('另一个网页标签已保存，请刷新后继续')
    }
    // Payload and its pending revision share one Storage write.
    safeStorage.setItem(DATA_KEY, JSON.stringify(meta ? { ...data, [LOCAL_SNAPSHOT_META_KEY]: meta } : data))
  }

  return {
    async loadData() {
      return loadSnapshot().data
    },
    async loadSnapshot() {
      return loadSnapshot()
    },
    async saveData(data) {
      save(data)
    },
    commitWebSnapshot: save,
    async loadSyncMeta() {
      return readMetadata(safeStorage.getItem(DATA_KEY))
    },
    async saveSyncMeta(meta) {
      safeStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
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
