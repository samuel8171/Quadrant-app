import { describe, expect, it } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import type { AppData, MoneyConfig, ReviewRecord } from '../src/shared/types'
import { createWebPlatformApi, type WebStorage } from '../src/renderer/src/lib/platformApi'

function memoryStorage(): WebStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

/** 只读一份初始载荷的存储；`loadData` 不会回写，正合校验用例所需。 */
function fakeStorage(initial: string): WebStorage {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = String(next) }
  }
}

const baseData: AppData = {
  version: 2,
  goals: [],
  events: [],
  weekPresets: [],
  weekEvents: [],
  weekCounterOffset: 0
}

/** 一条合法 `Goal`：用于验证「money 坏了也没把用户数据一起赔进去」。 */
const validGoal = {
  id: 'g1',
  title: '目标',
  type: 'long',
  done: false,
  remark: '',
  groupTitles: [''],
  subtasks: [],
  order: 0,
  createdAt: 'now'
}

/** 合法 config 基线：与 `sampleDataWithMoney` 共用，供「某处不合规 ⇒ 只丢账本」的用例派生。 */
const validMoneyConfig: MoneyConfig = {
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
  latePhoneTC: 40,
  latePhoneLT: 2,
  quadrantMultiplier: { q1: 1.5, q2: 1, q3: 1.2, q4: 0.5 }
}

const sampleDataWithMoney: AppData = {
  ...baseData,
  money: {
    enabled: true,
    config: validMoneyConfig,
    days: [
      {
        date: '2026-09-28',
        settledAt: '2026-09-28T23:20:00.000Z',
        entries: [
          {
            id: 'le-1',
            kind: 'planned',
            sourceId: 'we-1',
            title: '写周报',
            quadrant: 1,
            plannedMin: 120,
            actualMin: 120,
            done: true,
            nightMin: 0,
            costTC: 20,
            deltaLT: 0.5
          }
        ],
        videoMin: 0,
        gameMin: 0,
        latePhone: false,
        dayLimit: 80,
        spentTC: 20,
        overdraft: 0,
        deltaLT: 0.5,
        nightPending: true,
        isRestDay: false
      }
    ],
    weeks: []
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

  it('keeps events that carry photo ids', async () => {
    const storage = memoryStorage()
    const api = createWebPlatformApi(storage)
    const data = {
      ...defaultData(),
      events: [
        {
          id: 'e1',
          text: '带照片',
          remark: '',
          quadrant: 1 as const,
          x: 0,
          y: 0,
          width: 6,
          createdAt: 'now',
          photos: ['ph-1', 'ph-2']
        }
      ]
    }
    await api.saveData(data)
    expect((await api.loadData()).events[0].photos).toEqual(['ph-1', 'ph-2'])
  })

  it('rejects data whose photos field is not a string array', async () => {
    const storage = memoryStorage()
    const api = createWebPlatformApi(storage)
    const base = {
      id: 'e1',
      text: 't',
      remark: '',
      quadrant: 1,
      x: 0,
      y: 0,
      width: 6,
      createdAt: 'now'
    }
    // 校验器对白名单外的字段整体放行，photos 必须显式校验——
    // 否则一个数字混进来，渲染层的 .map 会直接抛错、整个页面白屏。
    for (const bad of [123, 'ph-1', [1, 2], null]) {
      storage.setItem(
        'quadrant-web-data-v2',
        JSON.stringify({ ...defaultData(), events: [{ ...base, photos: bad }] })
      )
      expect(await api.loadData()).toEqual(defaultData())
    }
    // 缺字段（老数据）与空数组都必须继续被接受。
    storage.setItem('quadrant-web-data-v2', JSON.stringify({ ...defaultData(), events: [base] }))
    expect((await api.loadData()).events).toHaveLength(1)
    storage.setItem(
      'quadrant-web-data-v2',
      JSON.stringify({ ...defaultData(), events: [{ ...base, photos: [] }] })
    )
    expect((await api.loadData()).events).toHaveLength(1)
  })

  it('money === undefined 的数据是合法的（否则老数据会被静默重置）', async () => {
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(baseData)))
    expect(await api.loadData()).toEqual(baseData)
  })

  it('money 存在但 enabled 不是布尔时只丢账本，用户数据保住', async () => {
    const bad = {
      ...baseData,
      goals: [validGoal],
      money: { enabled: 'yes', config: {}, days: [], weeks: [] }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(bad)))
    const loaded = await api.loadData()
    expect(loaded.goals).toHaveLength(1)
    expect(loaded.money).toBeUndefined()
  })

  it('含合法 money 的数据通过校验', async () => {
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(sampleDataWithMoney)))
    expect((await api.loadData()).money).toEqual(sampleDataWithMoney.money)
  })

  it('旧账本缺配置键时完整迁移，保留目标与日结', async () => {
    const money = sampleDataWithMoney.money!
    const config = { ...money.config, latePhoneTC: undefined, quadrantMultiplier: { q1: 1.7 } }
    const raw = JSON.stringify({ ...sampleDataWithMoney, goals: [validGoal], money: { ...money, config } })
    const loaded = await createWebPlatformApi(fakeStorage(raw)).loadData()
    expect(loaded.goals).toEqual([validGoal])
    expect(loaded.money?.days).toEqual(money.days)
    expect(loaded.money?.config).toMatchObject({ latePhoneTC: 40, quadrantMultiplier: { q1: 1.7, q4: 0.5 } })
  })

  it('损坏账本仅作恢复预览，保存不能覆盖原始载荷', async () => {
    const raw = JSON.stringify({ ...baseData, goals: [validGoal], money: { enabled: 'invalid' } })
    const storage = fakeStorage(raw)
    const api = createWebPlatformApi(storage)
    expect((await api.loadData()).goals).toEqual([validGoal])
    await expect(api.saveData(baseData)).rejects.toThrow()
    expect(storage.getItem('quadrant-web-data-v2')).toBe(raw)
  })

  it('损坏的目标不会进入恢复预览，其余可读内容和原档保留', async () => {
    const data = {
      ...baseData,
      // goal 缺 order ⇒ 无论 money 好坏都必须整份回退
      goals: [
        {
          id: 'g1',
          title: '目标',
          type: 'long',
          done: false,
          remark: '',
          groupTitles: [''],
          subtasks: [],
          createdAt: 'now'
        }
      ],
      money: { enabled: true, config: { weeklyTC: 560 }, days: [], weeks: [] }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
    const loaded = await api.loadSnapshot!()
    expect(loaded.kind).toBe('recovery')
    expect(loaded.data.goals).toEqual([])
    expect(loaded.data.money).toMatchObject(data.money)
    await expect(api.saveData(defaultData())).rejects.toThrow()
  })

  it('老记录缺 videoMin / gameMin 时账本不被丢弃（它们是后加的可选字段）', async () => {
    // 加字段之前的载荷里没有这两个字段：判它非法会让第 2 档把用户整份账本丢掉。
    const legacy = {
      ...baseData,
      goals: [validGoal],
      money: {
        enabled: true,
        config: validMoneyConfig,
        days: [
          {
            date: '2026-09-28',
            settledAt: null,
            entries: [],
            dayLimit: 0,
            spentTC: 0,
            overdraft: 0,
            deltaLT: 0,
            nightPending: true
          }
        ],
        weeks: []
      }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(legacy)))
    const loaded = await api.loadData()
    expect(loaded.money?.days).toHaveLength(1)
    expect(loaded.goals).toHaveLength(1)
  })

  it('videoMin / gameMin 存在但不是有限数字时只丢账本（存在即须严格）', async () => {
    for (const bad of ['x', null, {}] as unknown[]) {
      const data = {
        ...baseData,
        goals: [validGoal],
        money: {
          enabled: true,
          config: validMoneyConfig,
          days: [
            {
              date: '2026-09-28',
              settledAt: null,
              entries: [],
              videoMin: bad,
              dayLimit: 0,
              spentTC: 0,
              overdraft: 0,
              deltaLT: 0,
              nightPending: true
            }
          ],
          weeks: []
        }
      }
      const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
      const loaded = await api.loadData()
      expect(loaded.goals).toHaveLength(1)
      expect(loaded.money).toBeUndefined()
    }
  })

  it('老记录缺 isRestDay 时账本不被丢弃（它是后加的可选字段）', async () => {
    // 加字段之前的载荷里没有它：判它非法会让第 2 档把用户整份账本丢掉。
    const legacy = {
      ...baseData,
      goals: [validGoal],
      money: {
        enabled: true,
        config: validMoneyConfig,
        days: [
          {
            date: '2026-09-28',
            settledAt: null,
            entries: [],
            videoMin: 0,
            gameMin: 0,
            dayLimit: 0,
            spentTC: 0,
            overdraft: 0,
            deltaLT: 0,
            nightPending: true
          }
        ],
        weeks: []
      }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(legacy)))
    const loaded = await api.loadData()
    expect(loaded.money?.days).toHaveLength(1)
    expect(loaded.goals).toHaveLength(1)
  })

  it('isRestDay 存在但不是布尔时只丢账本（存在即须严格）', async () => {
    for (const bad of ['yes', 1, null, {}] as unknown[]) {
      const data = {
        ...baseData,
        goals: [validGoal],
        money: {
          enabled: true,
          config: validMoneyConfig,
          days: [
            {
              date: '2026-09-28',
              settledAt: null,
              entries: [],
              videoMin: 0,
              gameMin: 0,
              dayLimit: 0,
              spentTC: 0,
              overdraft: 0,
              deltaLT: 0,
              nightPending: true,
              isRestDay: bad
            }
          ],
          weeks: []
        }
      }
      const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
      const loaded = await api.loadData()
      expect(loaded.goals).toHaveLength(1)
      expect(loaded.money).toBeUndefined()
    }
  })

  it('isRestDay 为 true 的休息日载荷原样通过校验', async () => {
    const data = {
      ...baseData,
      money: {
        enabled: true,
        config: validMoneyConfig,
        days: [
          {
            date: '2026-09-28',
            settledAt: '2026-09-28T23:20:00.000Z',
            entries: [],
            videoMin: 0,
            gameMin: 0,
            dayLimit: 80,
            spentTC: 64,
            overdraft: 0,
            deltaLT: 0,
            nightPending: false,
            isRestDay: true
          }
        ],
        weeks: []
      }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
    const loaded = await api.loadData()
    expect(loaded.money?.days[0].isRestDay).toBe(true)
    expect(loaded.money?.days[0].spentTC).toBe(64)
  })

  it('老记录缺 latePhone 时账本不被丢弃（它是后加的可选字段）', async () => {
    // 加字段之前的载荷里没有它：判它非法会让第 2 档把用户整份账本丢掉。
    const legacy = {
      ...baseData,
      goals: [validGoal],
      money: {
        enabled: true,
        config: validMoneyConfig,
        days: [
          {
            date: '2026-09-28',
            settledAt: null,
            entries: [],
            videoMin: 0,
            gameMin: 0,
            dayLimit: 0,
            spentTC: 0,
            overdraft: 0,
            deltaLT: 0,
            nightPending: true
          }
        ],
        weeks: []
      }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(legacy)))
    const loaded = await api.loadData()
    expect(loaded.money?.days).toHaveLength(1)
    expect(loaded.goals).toHaveLength(1)
  })

  it('latePhone 存在但不是布尔时只丢账本（存在即须严格）', async () => {
    for (const bad of ['yes', 1, null, {}] as unknown[]) {
      const data = {
        ...baseData,
        goals: [validGoal],
        money: {
          enabled: true,
          config: validMoneyConfig,
          days: [
            {
              date: '2026-09-28',
              settledAt: null,
              entries: [],
              videoMin: 0,
              gameMin: 0,
              latePhone: bad,
              dayLimit: 0,
              spentTC: 0,
              overdraft: 0,
              deltaLT: 0,
              nightPending: true
            }
          ],
          weeks: []
        }
      }
      const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
      const loaded = await api.loadData()
      expect(loaded.goals).toHaveLength(1)
      expect(loaded.money).toBeUndefined()
    }
  })

  it('latePhone 为 true 的载荷原样通过校验', async () => {
    const data = {
      ...baseData,
      money: {
        enabled: true,
        config: validMoneyConfig,
        days: [
          {
            date: '2026-09-28',
            settledAt: '2026-09-28T23:20:00.000Z',
            entries: [],
            videoMin: 0,
            gameMin: 0,
            latePhone: true,
            dayLimit: 80,
            spentTC: 0,
            overdraft: 0,
            deltaLT: 0,
            nightPending: false,
            isRestDay: false
          }
        ],
        weeks: []
      }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
    const loaded = await api.loadData()
    expect(loaded.money?.days[0].latePhone).toBe(true)
  })

  it('完全合法的载荷（含 money）原样返回，不走降级分支', async () => {
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(sampleDataWithMoney)))
    const loaded = await api.loadData()
    expect(loaded).toEqual(sampleDataWithMoney)
    expect(loaded.money).toEqual(sampleDataWithMoney.money)
  })

  it('enabledAt 缺席是合法的（本字段加入之前的载荷）', async () => {
    // 缺席 = 不夹取窗口下界。判它非法会让第 2 档把用户整份账本丢掉。
    const legacy = {
      ...baseData,
      goals: [validGoal],
      money: { enabled: true, config: validMoneyConfig, days: [], weeks: [] }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(legacy)))
    const loaded = await api.loadData()
    expect(loaded.goals).toHaveLength(1)
    expect(loaded.money?.enabled).toBe(true)
  })

  it('enabledAt 为合法日期键时原样通过校验', async () => {
    const data = {
      ...baseData,
      money: {
        enabled: true,
        config: validMoneyConfig,
        days: [],
        weeks: [],
        enabledAt: '2026-09-27'
      }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
    const loaded = await api.loadData()
    expect(loaded.money?.enabledAt).toBe('2026-09-27')
  })

  it('enabledAt 存在但不是日期键时只丢账本（存在即须严格）', async () => {
    for (const bad of ['2026/09/27', 'yesterday', 20260927, null, {}] as unknown[]) {
      const data = {
        ...baseData,
        goals: [validGoal],
        money: {
          enabled: true,
          config: validMoneyConfig,
          days: [],
          weeks: [],
          enabledAt: bad
        }
      }
      const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
      const loaded = await api.loadData()
      expect(loaded.goals).toHaveLength(1)
      expect(loaded.money).toBeUndefined()
    }
  })
})
