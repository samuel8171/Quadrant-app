import { defaultData } from '../../../shared/defaults'
import type { AppData, QuadrantApi, ReviewExport, ReviewRecord } from '../../../shared/types'

const DATA_KEY = 'quadrant-web-data-v2'
const REVIEWS_KEY = 'quadrant-web-reviews-v1'

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

function validAppData(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<AppData>
  return data.version === 2 && Array.isArray(data.goals) && Array.isArray(data.events) &&
    Array.isArray(data.weekPresets) && Array.isArray(data.weekEvents) &&
    typeof data.weekCounterOffset === 'number'
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

export function createWebPlatformApi(storage: WebStorage = (globalThis as unknown as BrowserGlobals).window!.localStorage): QuadrantApi {
  return {
    async loadData() {
      try {
        const raw = storage.getItem(DATA_KEY)
        if (!raw) return defaultData()
        const value: unknown = JSON.parse(raw)
        return validAppData(value) ? value : defaultData()
      } catch {
        return defaultData()
      }
    },
    async saveData(data) {
      try { storage.setItem(DATA_KEY, JSON.stringify(data)) } catch { /* unavailable storage */ }
    },
    async saveReview(payload: ReviewExport) {
      const now = new Date()
      const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
      const fileName = `${date}复盘-${now.getTime()}.txt`
      const content = `计划完成度：${payload.completion}\n计划完成质量：${payload.quality}\n压力指数：${payload.stress}\n\n${payload.text}`
      const review: StoredReview = { fileName, content, modifiedAt: now.toISOString() }
      try {
        const reviews = readReviews(storage).filter((item) => item.fileName !== fileName)
        storage.setItem(REVIEWS_KEY, JSON.stringify([...reviews, review]))
      } catch { /* unavailable storage */ }
      return toRecord(review)
    },
    async listReviews() {
      return readReviews(storage).map(toRecord).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    },
    async openReview(filePath) {
      if (!filePath.startsWith('web-review:')) return { ok: false, error: '文件不存在或已被移动' }
      const fileName = filePath.slice('web-review:'.length)
      const review = readReviews(storage).find((item) => item.fileName === fileName)
      if (!review) return { ok: false, error: '文件不存在或已被移动' }
      const browser = globalThis as unknown as BrowserGlobals
      if (!browser.document || !browser.URL || !browser.Blob) {
        return { ok: false, error: '当前环境不支持下载文件' }
      }
      const url = browser.URL.createObjectURL(new browser.Blob([review.content], { type: 'text/plain;charset=utf-8' }))
      const anchor = browser.document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      browser.URL.revokeObjectURL(url)
      return { ok: true }
    }
  }
}

export function getPlatformApi(): QuadrantApi {
  const browser = globalThis as unknown as BrowserGlobals
  if (browser.window?.quadrantApi) return browser.window.quadrantApi
  return createWebPlatformApi()
}
