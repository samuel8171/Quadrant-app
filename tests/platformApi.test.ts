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
})
