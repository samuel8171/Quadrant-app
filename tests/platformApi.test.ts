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
        dayLimit: 80,
        spentTC: 20,
        overdraft: 0,
        deltaLT: 0.5,
        nightPending: true
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

  it('money 的 config 缺新键时只丢账本：目标与事件原样保留', async () => {
    // 这是本次改动的**核心对比**：money 是可选字段，它坏了只该赔上账本。
    // 改动前 loadData 会因为 validAppData 为假而整份回退 defaultData ——
    // 用户的每一个目标、事件、预设都会静默消失。
    const event = {
      id: 'e1',
      text: '事件',
      remark: '',
      quadrant: 1,
      x: 0,
      y: 0,
      width: 6,
      createdAt: 'now'
    }
    const data = {
      ...baseData,
      goals: [validGoal],
      events: [event],
      // config 只给了 weeklyTC：R2 之前的键集，缺 dailyCapTC 等新键
      money: { enabled: true, config: { weeklyTC: 560 }, days: [], weeks: [] }
    }
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
    const loaded = await api.loadData()
    expect(loaded.goals).toHaveLength(1)
    expect(loaded.goals[0]).toEqual(validGoal)
    expect(loaded.events).toHaveLength(1)
    expect(loaded.events[0]).toEqual(event)
    expect(loaded.money).toBeUndefined()
  })

  it('config 里任意一个新键不是有限数字时只丢账本（不逐键修复）', async () => {
    // 逐一钉住每个新键：少一个（JSON.stringify 会丢掉 undefined 值）都必须判 money 非法。
    // 结果是**账本被丢掉**而不是被修复成默认值 —— 断言 money === undefined 就是在证明这一点。
    for (const key of ['dailyCapTC', 'videoLTPerHour', 'abandonedDayTC', 'latePhoneLT'] as const) {
      const data = {
        ...baseData,
        goals: [validGoal],
        money: {
          enabled: true,
          config: { ...validMoneyConfig, [key]: undefined },
          days: [],
          weeks: []
        }
      }
      const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
      const loaded = await api.loadData()
      expect(loaded.goals).toHaveLength(1)
      expect(loaded.money).toBeUndefined()
    }
  })

  it('quadrantMultiplier 缺键、非数字或非对象时只丢账本（不逐键修复）', async () => {
    const badValues: unknown[] = [
      { q1: 1.5, q2: 1, q3: 1.2 }, // 缺 q4
      { q1: 1.5, q2: 'x', q3: 1.2, q4: 0.5 }, // 某键不是数字
      {}, // 空对象
      42, // 不是对象
      null
    ]
    for (const bad of badValues) {
      const data = {
        ...baseData,
        goals: [validGoal],
        money: {
          enabled: true,
          config: { ...validMoneyConfig, quadrantMultiplier: bad },
          days: [],
          weeks: []
        }
      }
      const api = createWebPlatformApi(fakeStorage(JSON.stringify(data)))
      const loaded = await api.loadData()
      expect(loaded.goals).toHaveLength(1)
      // 若 web 端改成「逐键修复」，money 就会留下一个被补全的对象 ⇒ 这条会失败
      expect(loaded.money).toBeUndefined()
    }
  })

  it('非 money 字段不合规时仍整份回退默认数据（不能借新分支夹带非法数据）', async () => {
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
    expect(await api.loadData()).toEqual(defaultData())
  })

  it('完全合法的载荷（含 money）原样返回，不走降级分支', async () => {
    const api = createWebPlatformApi(fakeStorage(JSON.stringify(sampleDataWithMoney)))
    const loaded = await api.loadData()
    expect(loaded).toEqual(sampleDataWithMoney)
    expect(loaded.money).toEqual(sampleDataWithMoney.money)
  })
})
