import { describe, expect, it } from 'vitest'
import type { QuadrantEvent, WeekEvent } from '../src/shared/types'
import {
  MAX_EVENTS_PER_QUADRANT,
  buildQuadrantEvent,
  canAddToQuadrant,
  countInQuadrant,
  findFreePosition,
  quadrantEventRect,
  rectsOverlap
} from '../src/renderer/src/lib/quadrantSync'

function qe(over: Partial<QuadrantEvent> = {}): QuadrantEvent {
  return {
    id: 'q1',
    text: '事件',
    remark: '',
    quadrant: 1,
    x: 1,
    y: 3,
    width: 6,
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over
  }
}

function weekEvent(over: Partial<WeekEvent> = {}): WeekEvent {
  return {
    id: 'w1',
    date: '2026-08-14',
    title: '健身',
    color: '#8CD9C1',
    quadrant: 2,
    startMin: 480,
    endMin: 570,
    remark: '备注',
    showInQuadrant: true,
    createdAt: '2026-08-14T00:00:00.000Z',
    ...over
  }
}

describe('quadrantSync', () => {
  it('counts events per quadrant and enforces the cap', () => {
    expect(countInQuadrant([qe(), qe({ quadrant: 2 })], 1)).toBe(1)
    const full = Array.from({ length: MAX_EVENTS_PER_QUADRANT }, (_, i) =>
      qe({ id: `e${i}`, x: 1 + i * 7 })
    )
    expect(canAddToQuadrant(full, 1)).toBe(false)
    expect(canAddToQuadrant(full.slice(0, 29), 1)).toBe(true)
  })

  it('places the first event inside each quadrant near the origin', () => {
    expect(findFreePosition([], 1, 6)).toEqual({ x: 1, y: 3 })
    expect(findFreePosition([], 2, 6)).toEqual({ x: -7, y: 3 })
    expect(findFreePosition([], 3, 6)).toEqual({ x: -7, y: -3 })
    expect(findFreePosition([], 4, 6)).toEqual({ x: 1, y: -3 })
  })

  it('avoids overlapping an existing event in the same row', () => {
    const existing = qe({ x: 1, y: 3, width: 6 })
    const pos = findFreePosition([existing], 1, 6)
    expect(pos).toEqual({ x: 7.6, y: 3 })
    expect(
      rectsOverlap(quadrantEventRect(existing), {
        left: pos!.x,
        top: pos!.y,
        width: 6,
        height: 1.6
      })
    ).toBe(false)
  })

  it('moves to the next row when a row is full', () => {
    const events = [1, 7.6, 14.2, 20.8, 27.4, 34].map((x) => qe({ x }))
    const pos = findFreePosition(events, 1, 6)
    expect(pos).toEqual({ x: 1, y: 5.2 })
  })

  it('returns null when the quadrant already has 30 events', () => {
    const full = Array.from({ length: MAX_EVENTS_PER_QUADRANT }, (_, i) =>
      qe({ id: `e${i}`, x: 1 + i * 7 })
    )
    expect(findFreePosition(full, 1, 6)).toBeNull()
  })

  it('detects rectangle overlaps', () => {
    const a = { left: 1, top: 3, width: 6, height: 1.6 }
    expect(rectsOverlap(a, { left: 6.9, top: 3, width: 6, height: 1.6 })).toBe(true)
    expect(rectsOverlap(a, { left: 7.6, top: 3, width: 6, height: 1.6 })).toBe(false)
    expect(rectsOverlap(a, { left: 1, top: 5.2, width: 6, height: 1.6 })).toBe(false)
  })

  it('builds a quadrant event with the same information', () => {
    const built = buildQuadrantEvent(weekEvent(), -7, 3)
    expect(built.text).toBe('健身')
    expect(built.remark).toBe('备注')
    expect(built.quadrant).toBe(2)
    expect(built.x).toBe(-7)
    expect(built.y).toBe(3)
    expect(built.width).toBeGreaterThan(0)
    expect(built.id).not.toBe('')
  })
})
