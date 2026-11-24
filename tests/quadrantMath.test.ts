import { describe, expect, it } from 'vitest'
import type { QuadrantEvent } from '../src/shared/types'
import {
  AXIS_GAP_PX,
  AXIS_GAP_UNITS,
  DEFAULT_WORLD_BOUNDS,
  EVENT_HEIGHT_UNITS,
  QUADRANT_META,
  MAX_EVENT_WIDTH_UNITS,
  MIN_EVENT_WIDTH_UNITS,
  autoEventWidth,
  boundsForEvents,
  clampEventToQuadrant,
  clampOrigin,
  clampZoom,
  escalateEvent,
  eventScreenRect,
  fitBounds,
  quadrantOfEventCenter,
  quadrantOfWorldPoint,
  shouldClearDragOnPointerLeave,
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
    expect(clampZoom(0.1)).toBe(0.1)
    expect(clampZoom(0)).toBeGreaterThan(0)
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

  it('classifies an event by its center, not by its top-left anchor', () => {
    // 宽 10、高 1.6 的卡片：左上角已在轴上方，但中心仍在轴下方 → 归下半象限。
    expect(quadrantOfEventCenter({ x: 0, y: 0.5, width: 10 })).toBe(4)
    expect(quadrantOfEventCenter({ x: 0, y: 5, width: 10 })).toBe(1)
    expect(quadrantOfEventCenter({ x: -10, y: 5, width: 10 })).toBe(2)
    expect(quadrantOfEventCenter({ x: -12, y: 0.5, width: 10 })).toBe(3)
  })

  it('keeps the axis gap in world units so it does not shrink when zooming out', () => {
    // 轴距是世界单位常量，与缩放无关；旧实现按屏幕像素夹取，zoom 2.5 时留下的
    // 合法事件缩到 0.5 后视觉轴距只剩约 2px。
    expect(AXIS_GAP_UNITS).toBe(AXIS_GAP_PX / 20)
    const nearAxis = event({ quadrant: 1, x: -3, y: -3 })
    for (const zoom of [0.5, 1, 2.5]) {
      const clamped = clampEventToQuadrant(nearAxis, { ...view, zoom })
      expect(clamped.x).toBeCloseTo(AXIS_GAP_UNITS)
      expect(clamped.y).toBeCloseTo(AXIS_GAP_UNITS + EVENT_HEIGHT_UNITS)
    }
  })

  it('does not cancel touch or pen drags when leaving the viewport', () => {
    expect(shouldClearDragOnPointerLeave('touch')).toBe(false)
    expect(shouldClearDragOnPointerLeave('pen')).toBe(false)
    expect(shouldClearDragOnPointerLeave('mouse')).toBe(true)
  })

  it('allows the axes offscreen and keeps part of the workspace in view', () => {
    const awayFromOrigin = { zoom: 1, panX: -300, panY: 850 }
    expect(clampOrigin(awayFromOrigin, 800, 600)).toEqual(awayFromOrigin)
    const clamped = clampOrigin({ zoom: 1, panX: -9999, panY: 9999 }, 800, 600)
    expect(worldToScreenX(DEFAULT_WORLD_BOUNDS.maxX, clamped)).toBe(10)
    expect(worldToScreenY(DEFAULT_WORLD_BOUNDS.maxY, clamped)).toBe(590)
  })

  it('fits the upper and lower edges plus horizontally offset cards in the available rectangle', () => {
    const top = event({ x: -220, y: 190, width: 20 })
    const bottom = event({ x: 230, y: -260, width: 20 })
    const bounds = boundsForEvents([top, bottom])
    const { width, height, padding } = { width: 375, height: 491, padding: 20 }
    const fit = fitBounds(bounds, width, height, padding)
    expect(fit.zoom).toBeLessThan(0.1)
    expect(worldToScreenY(bounds.maxY, fit)).toBeGreaterThanOrEqual(padding - 0.001)
    expect(worldToScreenY(bounds.minY, fit)).toBeLessThanOrEqual(height - padding + 0.001)
    for (const card of [top, bottom]) {
      const rect = eventScreenRect(card, fit)
      expect(rect.left).toBeGreaterThan(padding)
      expect(rect.left + rect.width).toBeLessThan(width - padding)
      expect(rect.top + rect.height).toBeLessThan(height - padding)
    }
  })

  it('fits unusually large persisted boards below the normal manual zoom range', () => {
    const bounds = { ...DEFAULT_WORLD_BOUNDS, maxY: 40_000 }
    const fit = fitBounds(bounds, 375, 450)
    expect(fit.zoom).toBeLessThan(clampZoom(0))
    expect(worldToScreenY(bounds.maxY, fit)).toBeCloseTo(40)
    expect(worldToScreenY(bounds.minY, fit)).toBeCloseTo(410)
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
