import { describe, expect, it } from 'vitest'
import type { QuadrantEvent } from '../src/shared/types'
import {
  AXIS_GAP_PX,
  QUADRANT_META,
  MAX_EVENT_WIDTH_UNITS,
  MIN_EVENT_WIDTH_UNITS,
  autoEventWidth,
  clampEventToQuadrant,
  clampOrigin,
  clampZoom,
  escalateEvent,
  eventScreenRect,
  quadrantOfWorldPoint,
  shouldCaptureTouchPointer,
  shouldCaptureEventPointer,
  shouldClearDragOnPointerLeave,
  shouldProcessTouchMove,
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

  it('preserves original quadrant metadata positions and colors', () => {
    expect(QUADRANT_META[1]).toMatchObject({ label: '重要紧急', color: '#FF8C00', corner: 'top-right' })
    expect(QUADRANT_META[2]).toMatchObject({ label: '重要不紧急', color: '#FFA500', corner: 'top-left' })
    expect(QUADRANT_META[3]).toMatchObject({ label: '不重要不紧急', color: '#008B8B', corner: 'bottom-left' })
    expect(QUADRANT_META[4]).toMatchObject({ label: '不重要紧急', color: '#483D8B', corner: 'bottom-right' })
  })

  it('keeps event touches out of viewport capture while allowing canvas touches', () => {
    expect(shouldCaptureTouchPointer(false)).toBe(true)
    expect(shouldCaptureTouchPointer(true)).toBe(false)
  })

  it('processes a touch drag even when the event handle owns capture', () => {
    expect(shouldProcessTouchMove(false, true)).toBe(true)
    expect(shouldProcessTouchMove(false, false)).toBe(false)
  })

  it('captures the event element for touch and pen drags', () => {
    expect(shouldCaptureEventPointer('touch')).toBe(true)
    expect(shouldCaptureEventPointer('pen')).toBe(true)
    expect(shouldCaptureEventPointer('mouse')).toBe(false)
  })

  it('does not cancel touch or pen drags when leaving the viewport', () => {
    expect(shouldClearDragOnPointerLeave('touch')).toBe(false)
    expect(shouldClearDragOnPointerLeave('pen')).toBe(false)
    expect(shouldClearDragOnPointerLeave('mouse')).toBe(true)
  })

  it('clamps origin 10px from every viewport edge', () => {
    const clamped = clampOrigin({ zoom: 1, panX: -50, panY: 9999 }, 800, 600)
    expect(clamped.panX).toBe(10)
    expect(clamped.panY).toBe(590)
  })

  it('zoomAt keeps the cursor world point fixed', () => {
    const next = zoomAt(400, 300, 2, view)
    expect(screenToWorldX(400, next)).toBeCloseTo(screenToWorldX(400, view))
    expect(screenToWorldY(300, next)).toBeCloseTo(screenToWorldY(300, view))
  })

  it('keeps the cursor world point fixed across repeated anchored zoom steps', () => {
    let current: ViewState = view
    const anchorX = 400
    const anchorY = 300
    const wx0 = screenToWorldX(anchorX, current)
    const wy0 = screenToWorldY(anchorY, current)

    for (let i = 0; i < 12; i += 1) {
      const nextZoom = clampZoom(current.zoom * 1.12)
      current = zoomAt(anchorX, anchorY, nextZoom, current)
      expect(screenToWorldX(anchorX, current)).toBeCloseTo(wx0)
      expect(screenToWorldY(anchorY, current)).toBeCloseTo(wy0)
    }
  })

  it('autoEventWidth stays within bounds', () => {
    expect(autoEventWidth('')).toBeGreaterThanOrEqual(MIN_EVENT_WIDTH_UNITS)
    expect(autoEventWidth('x'.repeat(200))).toBeLessThanOrEqual(MAX_EVENT_WIDTH_UNITS)
  })

  it('clamps event inside Q1 colored block (top-right)', () => {
    const result = clampEventToQuadrant(
      event({ quadrant: 1, x: -1, y: -1 }),
      view
    )
    expect(worldToScreenX(result.x, view)).toBeGreaterThanOrEqual(200 + AXIS_GAP_PX)
    const rect = eventScreenRect(result, view)
    expect(worldToScreenY(result.y, view) + rect.height).toBeLessThanOrEqual(150 - AXIS_GAP_PX)
  })

  it('clamps event inside Q3 colored block (bottom-left)', () => {
    const e = event({ quadrant: 3, x: 1, y: 1, width: 4 })
    const result = clampEventToQuadrant(e, view)
    expect(worldToScreenX(result.x + result.width, view)).toBeLessThanOrEqual(200 - AXIS_GAP_PX)
    expect(worldToScreenY(result.y, view)).toBeGreaterThanOrEqual(150 + AXIS_GAP_PX)
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
