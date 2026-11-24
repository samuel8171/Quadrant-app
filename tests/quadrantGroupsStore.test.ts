import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validAppData } from '../src/shared/appDataCodec'
import { defaultData } from '../src/shared/defaults'
import { DEFAULT_MONEY_CONFIG, settleDay } from '../src/shared/money'
import type { AppData, QuadrantEvent } from '../src/shared/types'

const cloud = vi.hoisted(() => ({
  pushCloudData: vi.fn(), fetchCloudData: vi.fn(), fetchCloudMeta: vi.fn(),
  hasCloudSession: vi.fn(), announceSync: vi.fn()
}))
vi.mock('../src/renderer/src/lib/cloudSync2', () => cloud)

import { useAppStore } from '../src/renderer/src/state/appStore'

const view = { zoom: 1, panX: 0, panY: 0 }

function event(fields: Partial<QuadrantEvent> & Pick<QuadrantEvent, 'id' | 'quadrant'>): QuadrantEvent {
  const { id, quadrant, ...rest } = fields
  return { id, text: id, remark: '', quadrant,
    x: quadrant === 1 || quadrant === 4 ? 20 : -30,
    y: quadrant === 1 || quadrant === 2 ? 30 : -30,
    width: 6, createdAt: '2026-11-20T00:00:00.000Z', ...rest }
}

describe('quadrant group store actions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAppStore.setState({ data: defaultData(), loaded: true })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    useAppStore.setState({ data: defaultData(), loaded: false })
  })

  it('moves a mixed-quadrant group as one operation while preserving event IDs, photos, and week links', () => {
    const data: AppData = {
      ...defaultData(),
      eventGroups: [{ id: 'g1', name: '准备答辩', anchorQuadrant: 1, anchorX: 20, anchorY: 30 }],
      events: [
        event({ id: 'a', quadrant: 1, groupId: 'g1', photos: ['photo-a'], remark: '备注 A' }),
        event({ id: 'b', quadrant: 2, groupId: 'g1', photos: ['photo-b'] })
      ],
      weekEvents: [{ id: 'w1', date: '2026-11-16', title: 'a', color: '#8AB4F8', quadrant: 1,
        startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'a', createdAt: 'x' }]
    }
    useAppStore.setState({ data })

    useAppStore.getState().moveEventGroup('a', 3, -5, -70)

    const moved = useAppStore.getState().data
    expect(moved.events.map(({ id, quadrant }) => [id, quadrant])).toEqual([['a', 3], ['b', 3]])
    expect(moved.events.find((item) => item.id === 'a')).toMatchObject({ photos: ['photo-a'], remark: '备注 A', groupId: 'g1' })
    expect(moved.events.find((item) => item.id === 'b')).toMatchObject({ photos: ['photo-b'], groupId: 'g1' })
    expect(moved.weekEvents[0]).toMatchObject({ quadrantEventId: 'a', showInQuadrant: true })
    expect(moved.eventGroups?.[0]).toMatchObject({ anchorQuadrant: 3 })
  })

  it('moves the chosen card to its group anchor, and removes the group when its last member leaves', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '目标', anchorQuadrant: 2, anchorX: -40, anchorY: 40 }]
    data.events = [event({ id: 'target', quadrant: 2, groupId: 'g1' }), event({ id: 'dragged', quadrant: 1, photos: ['photo-x'] })]
    useAppStore.setState({ data })

    useAppStore.getState().assignEventToGroup('dragged', 'g1', 3)
    const joined = useAppStore.getState().data
    expect(joined.events.find((item) => item.id === 'dragged')).toMatchObject({
      quadrant: 3, groupId: 'g1', x: -40, photos: ['photo-x']
    })
    expect(joined.events.find((item) => item.id === 'dragged')?.y).toBeLessThan(0)

    useAppStore.getState().assignEventToGroup('dragged', undefined)
    expect(useAppStore.getState().data.events.find((item) => item.id === 'dragged')).toMatchObject({ quadrant: 3, photos: ['photo-x'] })
    expect(useAppStore.getState().data.eventGroups).toHaveLength(1)
    useAppStore.getState().assignEventToGroup('target', undefined)
    expect(useAppStore.getState().data.eventGroups).toEqual([])
  })

  it('places the whole group and its primary anchor in a new quadrant and updates its bounds', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '列表组', anchorQuadrant: 1, anchorX: 20, anchorY: 30 }]
    data.events = [event({ id: 'a', quadrant: 1, groupId: 'g1' }), event({ id: 'b', quadrant: 2, groupId: 'g1' })]
    useAppStore.setState({ data })

    const observe = vi.fn()
    const unsubscribe = useAppStore.subscribe(observe)
    try {
      useAppStore.getState().moveEventGroup('a', 4, 300, -200, { x: 318, y: -180 })
      const moved = useAppStore.getState().data
      expect(observe).toHaveBeenCalledTimes(1)
      expect(moved.events.every((item) => item.quadrant === 4 && item.x > 0 && item.y < 0)).toBe(true)
      expect(moved.eventGroups?.[0]).toMatchObject({ anchorQuadrant: 4, anchorX: 318, anchorY: -180 })
      expect(moved.canvasBounds?.maxX).toBeGreaterThan(324)
      expect(moved.canvasBounds?.minY).toBeLessThan(-180)
    } finally {
      unsubscribe()
    }
  })

  it('updates a linked week event through the store while preserving its card identity and independent quadrant', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '准备答辩', anchorQuadrant: 1, anchorX: 20, anchorY: 30 }]
    data.events = [event({ id: 'q1', quadrant: 3, groupId: 'g1', photos: ['photo-1'], remark: '卡片备注' })]
    data.weekEvents = [{ id: 'w1', date: '2026-11-16', title: '旧标题', color: '#8AB4F8', quadrant: 1,
      startMin: 600, endMin: 660, remark: '计划备注', showInQuadrant: true, quadrantEventId: 'q1', createdAt: 'x' }]
    useAppStore.setState({ data })

    expect(useAppStore.getState().updateWeekEvent('w1', { title: '新标题' })).toEqual({ ok: true })
    let updated = useAppStore.getState().data
    expect(updated.events[0]).toMatchObject({ id: 'q1', text: '新标题', remark: '卡片备注', quadrant: 3, groupId: 'g1', photos: ['photo-1'] })
    expect(updated.weekEvents[0].quadrantEventId).toBe('q1')

    expect(useAppStore.getState().updateWeekEvent('w1', { quadrant: 2 })).toEqual({ ok: true })
    updated = useAppStore.getState().data
    expect(updated.events[0]).toMatchObject({ id: 'q1', quadrant: 2, remark: '卡片备注', groupId: 'g1', photos: ['photo-1'] })
    expect(updated.events[0].x + updated.events[0].width).toBeLessThan(0)
    expect(updated.events[0].y).toBeGreaterThan(0)
  })

  it('keeps the week event and linked card unchanged if its new quadrant is full', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '目标', anchorQuadrant: 1, anchorX: 20, anchorY: 30 }]
    data.events = [event({ id: 'q1', quadrant: 1, groupId: 'g1' }),
      ...Array.from({ length: 30 }, (_, index) => event({ id: `existing-${index}`, quadrant: 2 }))]
    data.weekEvents = [{ id: 'w1', date: '2026-11-16', title: '计划', color: '#8AB4F8', quadrant: 1,
      startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'q1', createdAt: 'x' }]
    useAppStore.setState({ data })

    expect(useAppStore.getState().updateWeekEvent('w1', { quadrant: 2 })).toEqual({ ok: false, reason: 'quadrant-full' })
    expect(useAppStore.getState().data).toBe(data)
  })

  it('pastes the last cut group member as a valid ungrouped card and extends the canvas', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '目标', anchorQuadrant: 2, anchorX: -40, anchorY: 40 }]
    data.events = [event({ id: 'last', quadrant: 2, groupId: 'g1', photos: ['keep'] })]
    data.weekEvents = [{ id: 'w1', date: '2026-11-16', title: '计划', color: '#8AB4F8', quadrant: 2,
      startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'last', createdAt: 'x' }]
    useAppStore.setState({ data })

    useAppStore.getState().cutEvent('last')
    useAppStore.getState().pasteEvent(view, 350, 300)

    const pasted = useAppStore.getState().data
    expect(pasted.eventGroups).toEqual([])
    expect(pasted.events[0]).toMatchObject({ x: 350, y: 300, photos: ['keep'] })
    expect(pasted.events[0].groupId).toBeUndefined()
    expect(pasted.canvasBounds?.maxX).toBeGreaterThan(350)
    expect(pasted.weekEvents[0]).toMatchObject({ id: 'w1', showInQuadrant: false })
    expect(pasted.weekEvents[0].quadrantEventId).toBeUndefined()
    expect(validAppData(pasted)).toBe(true)
  })

  it('copies the card and its photos without cloning the week link', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '目标', anchorQuadrant: 2, anchorX: -40, anchorY: 40 }]
    data.events = [event({ id: 'source', quadrant: 2, groupId: 'g1', photos: ['photo-id'], remark: '备忘' })]
    data.weekEvents = [{ id: 'w1', date: '2026-11-16', title: '计划', color: '#8AB4F8', quadrant: 2,
      startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'source', createdAt: 'x' }]
    useAppStore.setState({ data })

    useAppStore.getState().copyEvent('source')
    useAppStore.getState().pasteEvent(view)

    const pasted = useAppStore.getState().data
    expect(pasted.events[1]).toMatchObject({ groupId: 'g1', photos: ['photo-id'], remark: '备忘' })
    expect(pasted.events[1].id).not.toBe('source')
    expect(pasted.weekEvents).toEqual(data.weekEvents)
    expect(validAppData(pasted)).toBe(true)
  })

  it('removes the emptied source group when an existing member forms a new stack', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '之前的组', anchorQuadrant: 1, anchorX: 20, anchorY: 30 }]
    data.events = [event({ id: 'target', quadrant: 2 }), event({ id: 'dragged', quadrant: 1, groupId: 'g1' })]
    useAppStore.setState({ data })
    const observe = vi.fn()
    const unsubscribe = useAppStore.subscribe(observe)
    try {
      const id = useAppStore.getState().createEventGroupWithEvents({ name: '新组', anchorQuadrant: 2, anchorX: -30, anchorY: 30 },
        ['target', 'dragged'], 'dragged', 2)
      const grouped = useAppStore.getState().data
      expect(observe).toHaveBeenCalledTimes(1)
      expect(grouped.eventGroups?.map((group) => group.id)).toEqual([id])
      expect(grouped.events.find((item) => item.id === 'dragged')).toMatchObject({ groupId: id, quadrant: 2, x: -30, y: 30 })
    } finally {
      unsubscribe()
    }
  })

  it('places a newly joined member at the selected remote stack in one change', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '远端目标', anchorQuadrant: 1, anchorX: 20, anchorY: 30 }]
    data.events = [event({ id: 'anchor', quadrant: 1, groupId: 'g1' }),
      event({ id: 'remote', quadrant: 3, groupId: 'g1', x: -150, y: -130 }), event({ id: 'source', quadrant: 4 })]
    useAppStore.setState({ data })
    const observe = vi.fn()
    const unsubscribe = useAppStore.subscribe(observe)
    try {
      useAppStore.getState().assignEventToGroup('source', 'g1', 3, { x: -150, y: -130 })
      const next = useAppStore.getState().data
      expect(observe).toHaveBeenCalledTimes(1)
      expect(next.events[2]).toMatchObject({ quadrant: 3, x: -150, y: -130, groupId: 'g1' })
      expect(next.eventGroups).toEqual(data.eventGroups)
      expect(next.canvasBounds?.minX).toBeLessThan(-150)
    } finally {
      unsubscribe()
    }
  })

  it('keeps the primary anchor in place when moving an individual card', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '目标', anchorQuadrant: 2, anchorX: -30, anchorY: 30 }]
    data.events = [event({ id: 'only', quadrant: 2, groupId: 'g1' })]
    useAppStore.setState({ data })

    useAppStore.getState().moveEventToQuadrant('only', 1)

    const moved = useAppStore.getState().data
    expect(moved.events[0]).toMatchObject({ quadrant: 1, groupId: 'g1', x: 24, y: 30 })
    expect(moved.eventGroups).toEqual(data.eventGroups)
  })

  it('moves a primary anchor without changing member coordinates and includes it in the saved bounds', () => {
    const data = defaultData()
    data.eventGroups = [{ id: 'g1', name: '目标', anchorQuadrant: 2, anchorX: -30, anchorY: 30 }]
    data.events = [event({ id: 'remote', quadrant: 1, groupId: 'g1' })]
    useAppStore.setState({ data })

    useAppStore.getState().moveEventGroupAnchor('g1', -160, 155)

    const moved = useAppStore.getState().data
    expect(moved.events).toBe(data.events)
    expect(moved.eventGroups?.[0]).toMatchObject({ anchorQuadrant: 2, anchorX: -160, anchorY: 155 })
    expect(moved.canvasBounds).toMatchObject({ minX: -164, maxY: 159 })
  })

  it('moves only the due card and keeps the group’s old anchor, the week link, and settled data', () => {
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'))
    const local = defaultData()
    const group = { id: 'g1', name: '目标', anchorQuadrant: 2 as const, anchorX: -300, anchorY: 40 }
    const pending = event({ id: 'pending', quadrant: 3, groupId: 'g1', escalateAt: '2026-11-22T00:00:00.000Z' })
    const day = settleDay({ date: '2026-11-19', settledAt: '2026-11-20T10:00:00.000Z', entries: [],
      previousOverdraft: 0, config: DEFAULT_MONEY_CONFIG })
    local.money = { enabled: false, config: DEFAULT_MONEY_CONFIG, days: [day], weeks: [] }
    local.eventGroups = [group]
    local.events = [event({ id: 'due', quadrant: 2, groupId: 'g1', x: -300,
      escalateAt: '2026-11-21T11:00:00.000Z' }), pending]
    local.weekEvents = [{ id: 'w1', date: '2026-11-21', title: '到期', color: '#8AB4F8', quadrant: 2,
      startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'due', createdAt: 'x' }]
    local.canvasBounds = { minX: -305, minY: -100, maxX: 120, maxY: 100 }
    useAppStore.setState({ data: local })

    useAppStore.getState().applyEscalations()

    const escalated = useAppStore.getState().data
    expect(escalated.events[0]).toMatchObject({ id: 'due', quadrant: 1, groupId: 'g1', x: 294 })
    expect(escalated.events[0].escalateAt).toBeUndefined()
    expect(escalated.events[1]).toBe(pending)
    expect(escalated.eventGroups?.[0]).toEqual(group)
    expect(escalated.weekEvents).toBe(local.weekEvents)
    expect(escalated.money).toBe(local.money)
    expect(escalated.canvasBounds?.maxX).toBeGreaterThan(300)
  })

  it('cleans up groups when disabling or deleting the last weekly mirror', () => {
    const data = defaultData()
    data.eventGroups = [
      { id: 'off-group', name: '关闭镜像', anchorQuadrant: 1, anchorX: 20, anchorY: 30 },
      { id: 'delete-group', name: '删除周计划', anchorQuadrant: 2, anchorX: -20, anchorY: 30 }
    ]
    data.events = [
      event({ id: 'q-off', quadrant: 1, groupId: 'off-group', photos: ['keep-photo'] }),
      event({ id: 'q-delete', quadrant: 2, groupId: 'delete-group' })
    ]
    data.weekEvents = [
      { id: 'w-off', date: '2026-11-16', title: '关闭', color: '#8AB4F8', quadrant: 1,
        startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'q-off', createdAt: 'x' },
      { id: 'w-delete', date: '2026-11-17', title: '删除', color: '#8AB4F8', quadrant: 2,
        startMin: 600, endMin: 660, remark: '', showInQuadrant: true, quadrantEventId: 'q-delete', createdAt: 'x' }
    ]
    useAppStore.setState({ data })

    useAppStore.getState().updateWeekEvent('w-off', { showInQuadrant: false })
    expect(useAppStore.getState().data.events.some((item) => item.id === 'q-off')).toBe(false)
    expect(useAppStore.getState().data.eventGroups?.some((group) => group.id === 'off-group')).toBe(false)

    useAppStore.getState().deleteWeekEvent('w-delete')
    expect(useAppStore.getState().data.events.some((item) => item.id === 'q-delete')).toBe(false)
    expect(useAppStore.getState().data.eventGroups).toEqual([])
  })
})
