import { describe, expect, it } from 'vitest'
import { parseData, serializeData } from '../src/main/dataCodec'
import { defaultData } from '../src/shared/defaults'

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
})
