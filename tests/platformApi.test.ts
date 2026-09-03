import { describe, expect, it } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import type { ReviewRecord } from '../src/shared/types'
import { createWebPlatformApi, type WebStorage } from '../src/renderer/src/lib/platformApi'

function memoryStorage(): WebStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

describe('web platform API', () => {
  it('returns default data when web storage is empty or malformed', async () => {
    const storage = memoryStorage()
    const api = createWebPlatformApi(storage)
    expect(await api.loadData()).toEqual(defaultData())
    storage.setItem('quadrant-web-data-v2', JSON.stringify({ ...defaultData(), goals: [null] }))
    expect(await api.loadData()).toEqual(defaultData())
    storage.setItem('quadrant-web-data-v2', JSON.stringify({ ...defaultData(), goals: [{ id: 'g', title: 'x', type: 'long', done: false, remark: '', groupTitles: [''], subtasks: [], createdAt: 'now' }] }))
    expect(await api.loadData()).toEqual(defaultData())
    storage.setItem('quadrant-web-data-v2', JSON.stringify({ ...defaultData(), events: [{ id: 'e', text: 'x', remark: '', quadrant: 1, x: Number.NaN, y: 0, width: 1, createdAt: 'now' }] }))
    expect(await api.loadData()).toEqual(defaultData())
    storage.setItem('quadrant-web-data-v2', '{broken')
    expect(await api.loadData()).toEqual(defaultData())
  })

  it('round-trips app data and review records in web storage', async () => {
    const storage = memoryStorage()
    const api = createWebPlatformApi(storage)
    const data = { ...defaultData(), weekCounterOffset: 3 }
    await api.saveData(data)
    expect(await api.loadData()).toEqual(data)
    const record = await api.saveReview({ completion: 2, quality: 1, stress: 0, text: '本周完成' })
    expect(record.filePath).toMatch(/^web-review:/)
    expect((await api.listReviews()).map((r: ReviewRecord) => r.fileName)).toContain(record.fileName)
  })

  it('uses a no-op fallback when localStorage is unavailable and rejects failed review writes', async () => {
    const api = createWebPlatformApi({
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') }
    })
    expect(await api.loadData()).toEqual(defaultData())
    await expect(api.saveReview({ completion: 2, quality: 1, stress: 0, text: '失败' })).rejects.toThrow()
  })

  it('does not reject when download URL cleanup throws', async () => {
    const storage = memoryStorage()
    const api = createWebPlatformApi(storage)
    const record = await api.saveReview({ completion: 1, quality: 1, stress: 1, text: 'x' })
    const oldDocument = (globalThis as any).document
    const oldBlob = (globalThis as any).Blob
    const oldURL = (globalThis as any).URL
    ;(globalThis as any).Blob = class { constructor(public parts: string[]) {} }
    ;(globalThis as any).document = { createElement: () => ({ click() {} }) }
    ;(globalThis as any).URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => { throw new Error('cleanup') } }
    await expect(api.openReview(record.filePath)).resolves.toEqual({ ok: true })
    ;(globalThis as any).document = oldDocument
    ;(globalThis as any).Blob = oldBlob
    ;(globalThis as any).URL = oldURL
  })
})
