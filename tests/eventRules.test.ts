import { describe, expect, it } from 'vitest'
import type { QuadrantEvent } from '../src/shared/types'
import {
  applyEscalations,
  createEvent,
  moveEvent,
  pasteEvent,
  updateEventInList
} from '../src/renderer/src/lib/eventRules'
import type { ViewState } from '../src/renderer/src/lib/quadrantMath'

const view: ViewState = { zoom: 1, panX: 200, panY: 150 }

describe('eventRules', () => {
  it('creates an event clamped to its quadrant', () => {
    const e = createEvent('  明天交作业  ', 2, 1, 1, view)
    expect(e.text).toBe('明天交作业')
    expect(e.quadrant).toBe(2)
    expect(e.x + e.width <= 0).toBe(true)
  })

  it('moves event and switches quadrant when crossing origin', () => {
    const e = createEvent('任务', 3, -5, -5, view)
    const moved = moveEvent([e], e.id, 3, 3, view)[0]
    expect(moved.quadrant).toBe(1)
    expect(moved.x >= 0).toBe(true)
  })

  it('updates event fields and keeps others', () => {
    const e = createEvent('任务', 1, 3, 3, view)
    const updated = updateEventInList([e], e.id, { remark: '备注' }, view)[0]
    expect(updated.remark).toBe('备注')
    expect(updated.text).toBe('任务')
  })

  it('pastes a copy with offset and new id', () => {
    const e = createEvent('任务', 1, 3, 3, view)
    const pasted = pasteEvent([e], e, view)[1]
    expect(pasted.id).not.toBe(e.id)
    expect(pasted.x).toBeGreaterThan(e.x)
    expect(pasted.y).toBeGreaterThan(e.y)
  })

  it('pastes at an explicit target location', () => {
    const e = createEvent('任务', 1, 3, 3, view)
    const pasted = pasteEvent([e], e, view, -5, -5)[1]
    expect(pasted.quadrant).toBe(3)
    expect(pasted.x + pasted.width).toBeLessThanOrEqual(-0.5)
    expect(pasted.y).toBe(-5)
  })

  it('applies escalations only when due', () => {
    const due = createEvent('升级', 2, -5, 3, view)
    due.escalateAt = '2026-08-01T00:00:00.000Z'
    const notDue = createEvent('不升级', 3, -5, -3, view)
    notDue.escalateAt = '2026-09-01T00:00:00.000Z'
    const result = applyEscalations([due, notDue], new Date('2026-08-12T00:00:00.000Z'))
    expect(result[0].quadrant).toBe(1)
    expect(result[1].quadrant).toBe(3)
  })
})
