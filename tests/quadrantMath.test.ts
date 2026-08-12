import { describe, expect, it } from 'vitest'
import type { QuadrantEvent } from '../src/shared/types'
import {
  AXIS_GAP_PX,
  MAX_EVENT_WIDTH_UNITS,
  MIN_EVENT_WIDTH_UNITS,
  autoEventWidth,
  clampEventToQuadrant,
  clampOrigin,
  clampZoom,
  escalateEvent,
  quadrantOfWorldPoint,
  screenToWorldX,
  screenToWorldY,
  worldToScreenX,
  worldToScreenY,
  zoomAt,
  type ViewState
} from '../src/renderer/src/lib/quadrantMath'

const view: ViewState = { zoom: 1, panX: 200, panY: 150 }

function event(overrides: Partial<QuadrantEvent>): QuadrantEvent {
  return {
    id: 'e1',
    text: '任务',
    remark: '',
    quadrant: 1,
    x: 5,
    y: 5,
    width: 10,
    createdAt: '2026-08-12T00:00:00.000Z',
    ...overrides
  }
}

describe('quadrantMath', () => {
  it('clamps zoom range', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(3)).toBe(2.5)
    expect(clampZoom(1)).toBe(1)
  })

  it('round-trips world and screen coordinates', () => {
    const sx = worldToScreenX(3, view)
    const sy = worldToScreenY(-2, view)
    expect(screenToWorldX(sx, view)).toBeCloseTo(3)
    expect(screenToWorldY(sy, view)).toBeCloseTo(-2)
  })

  it('classifies quadrants by world point', () => {
    expect(quadrantOfWorldPoint(1, 1)).toBe(1)
    expect(quadrantOfWorldPoint(-1, 1)).toBe(2)
    expect(quadrantOfWorldPoint(-1, -1)).toBe(3)
    expect(quadrantOfWorldPoint(1, -1)).toBe(4)
  })

  it('clamps origin 10px from every viewport edge', () => {
    const clamped = clampOrigin({ zoom: 1, panX: -50, panY: 9999 }, 800, 600)
    expect(clamped.panX).toBe(10)
    expect(clamped.panY).toBe(590)
  })

  it('zoomAt keeps the cursor world point fixed', () => {
    const next = zoomAt(400, 300, 2, view)
    const wxBefore = screenToWorldX(400, view)
    const wxAfter = screenToWorldX(400, next)
    expect(wxAfter).toBeCloseTo(wxBefore)
  })

  it('autoEventWidth stays within bounds', () => {
    expect(autoEventWidth('')).toBeGreaterThanOrEqual(MIN_EVENT_WIDTH_UNITS)
    expect(autoEventWidth('x'.repeat(200))).toBeLessThanOrEqual(MAX_EVENT_WIDTH_UNITS)
  })

  it('clamps event inside Q1 colored block', () => {
    const result = clampEventToQuadrant(
      event({ quadrant: 1, x: -1, y: -1 }),
      view
    )
    expect(worldToScreenX(result.x, view)).toBeGreaterThanOrEqual(200 + AXIS_GAP_PX)
    expect(worldToScreenY(result.y, view)).toBeGreaterThanOrEqual(150 + AXIS_GAP_PX)
  })

  it('clamps event inside Q3 colored block', () => {
    const e = event({ quadrant: 3, x: 1, y: 1, width: 4 })
    const result = clampEventToQuadrant(e, view)
    expect(worldToScreenX(result.x + result.width, view)).toBeLessThanOrEqual(200 - AXIS_GAP_PX)
    expect(worldToScreenY(result.y, view)).toBeLessThanOrEqual(150 - AXIS_GAP_PX)
  })

  it('escalation mirrors Q2 to Q1 horizontally without changing y', () => {
    const e = event({
      quadrant: 2,
      x: -12,
      y: 4,
      width: 8,
      escalateAt: '2026-08-01T00:00:00.000Z'
    })
    const result = escalateEvent(e, new Date('2026-08-12T00:00:00.000Z'))
    expect(result.quadrant).toBe(1)
    expect(result.x).toBe(4)
    expect(result.y).toBe(4)
    expect(result.escalateAt).toBeUndefined()
  })

  it('does not escalate before escalateAt', () => {
    const e = event({
      quadrant: 2,
      x: -12,
      y: 4,
      width: 8,
      escalateAt: '2026-09-01T00:00:00.000Z'
    })
    const result = escalateEvent(e, new Date('2026-08-12T00:00:00.000Z'))
    expect(result.quadrant).toBe(2)
  })
})
