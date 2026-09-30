import { describe, expect, it } from 'vitest'
import { parseData, serializeData } from '../src/main/dataCodec'
import { defaultData } from '../src/shared/defaults'
import { DEFAULT_MONEY_CONFIG } from '../src/shared/money'
import type { AppData } from '../src/shared/types'

const baseData: AppData = {
  version: 2,
  goals: [],
  events: [],
  weekPresets: [],
  weekEvents: [],
  weekCounterOffset: 0
}

const sampleDataWithMoney: AppData = {
  ...baseData,
  money: {
    enabled: true,
    config: {
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
    },
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
          },
          {
            id: 'le-2',
            kind: 'unplanned',
            sourceId: null,
            title: '临时会议',
            quadrant: null,
            plannedMin: null,
            actualMin: 45,
            done: true,
            nightMin: 30,
            costTC: 12,
            deltaLT: 0
          }
        ],
        dayLimit: 80,
        spentTC: 32,
        overdraft: 0,
        deltaLT: 0.5,
        nightPending: true
      }
    ],
    weeks: []
  }
}

describe('dataCodec', () => {
  it('round-trips default data', () => {
    const data = defaultData()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('migrates version 1 payload to version 2 with empty week fields', () => {
    const v1 = JSON.stringify({ version: 1, goals: [], events: [] })
    expect(parseData(v1)).toEqual(defaultData())
  })

  it('normalizes weekly preset fields', () => {
    const data = defaultData()
    data.weekPresets = [
      {
        id: 'p1',
        title: '健身',
        color: '#123456',
        quadrant: 9 as never,
        durationMin: 88,
        remark: '',
        createdAt: 'x'
      }
    ]
    const parsed = parseData(serializeData(data))
    expect(parsed.weekPresets[0].color).toBe('#8AB4F8')
    expect(parsed.weekPresets[0].quadrant).toBe(1)
    expect(parsed.weekPresets[0].durationMin).toBe(90)
  })

  it('normalizes weekly event times', () => {
    const data = defaultData()
    data.weekEvents = [
      {
        id: 'e1',
        date: '2026-08-14',
        title: '考核',
        color: '#8CD9C1',
        quadrant: 2,
        startMin: 1500,
        endMin: 400,
        remark: '',
        showInQuadrant: true,
        quadrantEventId: 'qe-1',
        createdAt: 'x'
      }
    ]
    const parsed = parseData(serializeData(data))
    expect(parsed.weekEvents[0].startMin).toBe(420)
    expect(parsed.weekEvents[0].endMin).toBe(480)
    expect(parsed.weekEvents[0].showInQuadrant).toBe(true)
    expect(parsed.weekEvents[0].quadrantEventId).toBe('qe-1')
  })

  it('defaults weekly event quadrant sync fields when absent', () => {
    const data = defaultData()
    data.weekEvents = [
      {
        id: 'e1',
        date: '2026-08-14',
        title: '考核',
        color: '#8AB4F8',
        quadrant: 1,
        startMin: 480,
        endMin: 570,
        remark: '',
        createdAt: 'x'
      } as never
    ]
    const parsed = parseData(serializeData(data))
    expect(parsed.weekEvents[0].showInQuadrant).toBe(false)
    expect(parsed.weekEvents[0].quadrantEventId).toBeUndefined()
  })

  it('rejects invalid payload', () => {
    expect(() => parseData('{"version":3}')).toThrow()
    expect(() => parseData('not json')).toThrow()
    expect(parseData('{"version":2}')).toEqual(defaultData())
  })

  it('preserves event photo ids across a round trip', () => {
    // normalizeEvent 是逐字段重建的，漏掉 photos 就会静默擦掉照片——
    // 桌面端每次读写都走这条路径，所以这个回归必须有测试兜住。
    const data = defaultData()
    data.events = [
      {
        id: 'e1',
        text: '带照片的事件',
        remark: '',
        quadrant: 1,
        x: 0,
        y: 0,
        width: 6,
        createdAt: 'x',
        photos: ['ph-a', 'ph-b']
      }
    ]
    const parsed = parseData(serializeData(data))
    expect(parsed.events[0].photos).toEqual(['ph-a', 'ph-b'])
  })

  it('drops non-string photo ids and enforces the cap', () => {
    const raw = JSON.stringify({
      version: 2,
      goals: [],
      events: [
        {
          id: 'e1',
          text: 't',
          remark: '',
          quadrant: 1,
          x: 0,
          y: 0,
          width: 6,
          createdAt: 'x',
          // 混入非法项 + 超过上限，两者都该被规整掉而不是让渲染层炸掉。
          photos: ['ok', 42, null, 'a', 'b', 'c', 'd']
        }
      ],
      weekPresets: [],
      weekEvents: [],
      weekCounterOffset: 0
    })
    const parsed = parseData(raw)
    expect(parsed.events[0].photos).toEqual(['ok', 'a', 'b'])
  })

  it('omits photos entirely when absent or empty', () => {
    const data = defaultData()
    data.events = [
      { id: 'e1', text: 't', remark: '', quadrant: 1, x: 0, y: 0, width: 6, createdAt: 'x', photos: [] }
    ]
    const parsed = parseData(serializeData(data))
    // 空数组统一收敛成 undefined，避免"有字段但无内容"的两种等价形态同时存在。
    expect(parsed.events[0].photos).toBeUndefined()
  })

  it('无 money 字段的 v2 数据往返后逐字节不变', () => {
    const raw = { version: 2, goals: [], events: [], weekPresets: [], weekEvents: [], weekCounterOffset: 0 }
    expect(parseData(JSON.stringify(raw))).toEqual(raw)
  })

  it('money 为非对象时被丢弃为 undefined，不影响其余字段', () => {
    const out = parseData(JSON.stringify({ ...baseData, money: 42 }))
    expect(out.money).toBeUndefined()
    expect(out.goals).toEqual(baseData.goals)
  })

  it('合法 money 往返保真（含一天已结算记录）', () => {
    const out = parseData(JSON.stringify(sampleDataWithMoney))
    expect(out.money).toEqual(sampleDataWithMoney.money)
  })

  it('config 的非默认取值原样保留（规整不是「一律返回默认」）', () => {
    const raw = {
      ...baseData,
      money: {
        enabled: true,
        config: { ...DEFAULT_MONEY_CONFIG, weeklyTC: 600, dailyCapTC: 90 },
        days: [],
        weeks: []
      }
    }
    const out = parseData(JSON.stringify(raw))
    expect(out.money?.config.weeklyTC).toBe(600)
    expect(out.money?.config.dailyCapTC).toBe(90)
  })

  it('config 缺新键时逐键回退到默认值', () => {
    // 老数据（R2 之前）只有旧键集：新键必须回退到 DEFAULT_MONEY_CONFIG，而不是 undefined/0
    const legacyConfig = {
      weeklyTC: 350,
      tcPerHour: 10,
      nightStartMin: 1410,
      nightEndMin: 360,
      nightMultiplier: 1.5,
      minCapRatio: 0.2,
      weeklyLT: 10,
      rewardLT: 0.5,
      penaltyLT: 0.5,
      missPenaltyLT: 1
    }
    const out = parseData(
      JSON.stringify({ ...baseData, money: { enabled: true, config: legacyConfig, days: [], weeks: [] } })
    )
    // 已有的旧键保留，缺的新键补默认
    expect(out.money?.config.weeklyTC).toBe(350)
    expect(out.money?.config.weeklyLT).toBe(10)
    expect(out.money?.config.dailyCapTC).toBe(DEFAULT_MONEY_CONFIG.dailyCapTC)
    expect(out.money?.config.abandonedDayTC).toBe(DEFAULT_MONEY_CONFIG.abandonedDayTC)
    expect(out.money?.config.quadrantMultiplier).toEqual(DEFAULT_MONEY_CONFIG.quadrantMultiplier)
  })

  it('quadrantMultiplier 局部对象被逐键修复，不整块丢弃', () => {
    const out = parseData(
      JSON.stringify({
        ...baseData,
        money: {
          enabled: true,
          config: { ...DEFAULT_MONEY_CONFIG, quadrantMultiplier: { q1: 9 } },
          days: [],
          weeks: []
        }
      })
    )
    // 桌面端口径：已有的键保留、缺的键各自回退 —— 与 web 端「缺一个键就整份拒收」相反
    expect(out.money?.config.quadrantMultiplier).toEqual({ q1: 9, q2: 1, q3: 1.2, q4: 0.5 })
  })

  it('quadrantMultiplier 修复用的对象不是 DEFAULT_MONEY_CONFIG 的嵌套引用', () => {
    const raw = JSON.stringify({
      ...baseData,
      money: {
        enabled: true,
        config: { ...DEFAULT_MONEY_CONFIG, quadrantMultiplier: { q1: 9, q2: 9, q3: 9, q4: 9 } },
        days: [],
        weeks: []
      }
    })
    const out = parseData(raw)
    expect(out.money?.config.quadrantMultiplier).not.toBe(DEFAULT_MONEY_CONFIG.quadrantMultiplier)
    // 关键：规整过程不得改动共享常量本身
    expect(DEFAULT_MONEY_CONFIG.quadrantMultiplier).toEqual({ q1: 1.5, q2: 1, q3: 1.2, q4: 0.5 })
  })

  it('桌面端不会因 money 坏了而丢掉用户数据（与 web 端 loadData 的三档降级对照）', () => {
    // parseData 是「逐字段重建」：goal / event / preset / weekEvent 各自独立规整，
    // money 的规整结果只影响 money 自己（`...(money ? { money } : {})`），
    // 因此**任何** money 损毁都不会连带丢弃其余实体 —— 这也是桌面端不需要
    // platformApi.loadData 那套三档降级的原因。
    const goal = {
      id: 'g1',
      title: '目标',
      type: 'long' as const,
      done: false,
      remark: '',
      groupTitles: [''],
      subtasks: [],
      order: 0,
      createdAt: 'now'
    }
    const withBadMoney = JSON.stringify({
      ...baseData,
      goals: [goal],
      money: { enabled: true, config: { weeklyTC: 560 }, days: [], weeks: [] }
    })
    const repaired = parseData(withBadMoney)
    expect(repaired.goals).toHaveLength(1)
    expect(repaired.goals[0].id).toBe('g1')
    // 桌面端口径：money 被**修复**（缺键回退到默认）而不是像 web 端那样被丢掉
    expect(repaired.money?.config.dailyCapTC).toBe(DEFAULT_MONEY_CONFIG.dailyCapTC)
    expect(repaired.money?.config.quadrantMultiplier).toEqual(DEFAULT_MONEY_CONFIG.quadrantMultiplier)

    // money 连 enabled 都不是布尔（normalizeMoney 整块放弃）时，其余实体同样必须保住
    const withGarbageMoney = JSON.stringify({
      ...baseData,
      goals: [goal],
      money: { enabled: 'yes', config: {}, days: [], weeks: [] }
    })
    const dropped = parseData(withGarbageMoney)
    expect(dropped.money).toBeUndefined()
    expect(dropped.goals).toHaveLength(1)
    expect(dropped.goals[0].id).toBe('g1')
  })
})
