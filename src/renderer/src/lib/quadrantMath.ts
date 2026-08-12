import type { Quadrant, QuadrantEvent } from '../../../shared/types'

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

export const UNIT = 20
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5
export const AXIS_GAP_PX = 10
export const EDGE_MARGIN_PX = 10
export const MAX_EVENT_WIDTH_UNITS = 20
export const MIN_EVENT_WIDTH_UNITS = 6
export const EVENT_HEIGHT_UNITS = 1.6

export const QUADRANT_META: Record<
  Quadrant,
  { label: string; color: string; corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
> = {
  1: { label: '重要紧急', color: '#FF8C00', corner: 'top-right' },
  2: { label: '重要不紧急', color: '#FFA500', corner: 'top-left' },
  3: { label: '不重要不紧急', color: '#008B8B', corner: 'bottom-left' },
  4: { label: '不重要紧急', color: '#483D8B', corner: 'bottom-right' }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

export function worldToScreenX(wx: number, view: ViewState): number {
  return view.panX + wx * UNIT * view.zoom
}

export function worldToScreenY(wy: number, view: ViewState): number {
  return view.panY + wy * UNIT * view.zoom
}

export function screenToWorldX(sx: number, view: ViewState): number {
  return (sx - view.panX) / (UNIT * view.zoom)
}

export function screenToWorldY(sy: number, view: ViewState): number {
  return (sy - view.panY) / (UNIT * view.zoom)
}

export function quadrantOfWorldPoint(wx: number, wy: number): Quadrant {
  if (wx >= 0 && wy >= 0) return 1
  if (wx < 0 && wy >= 0) return 2
  if (wx < 0 && wy < 0) return 3
  return 4
}

export function clampOrigin(view: ViewState, width: number, height: number): ViewState {
  return {
    zoom: view.zoom,
    panX: Math.min(width - EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, view.panX)),
    panY: Math.min(height - EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, view.panY))
  }
}

export function zoomAt(
  viewportX: number,
  viewportY: number,
  nextZoom: number,
  view: ViewState
): ViewState {
  const zoom = clampZoom(nextZoom)
  const wx = screenToWorldX(viewportX, view)
  const wy = screenToWorldY(viewportY, view)
  return {
    zoom,
    panX: viewportX - wx * UNIT * zoom,
    panY: viewportY - wy * UNIT * zoom
  }
}

export function autoEventWidth(text: string): number {
  const estimated = Math.max(MIN_EVENT_WIDTH_UNITS, Math.ceil(text.length * 0.7))
  return Math.min(MAX_EVENT_WIDTH_UNITS, estimated)
}

export function eventScreenRect(
  e: QuadrantEvent,
  view: ViewState
): { left: number; top: number; width: number; height: number } {
  return {
    left: worldToScreenX(e.x, view),
    top: worldToScreenY(e.y, view),
    width: e.width * UNIT * view.zoom,
    height: EVENT_HEIGHT_UNITS * UNIT * view.zoom
  }
}

export function clampEventToQuadrant(e: QuadrantEvent, view: ViewState): QuadrantEvent {
  const rect = eventScreenRect(e, view)
  let left = rect.left
  let top = rect.top
  if (e.quadrant === 1 || e.quadrant === 4) {
    left = Math.max(left, view.panX + AXIS_GAP_PX)
  } else {
    left = Math.min(left, view.panX - AXIS_GAP_PX - rect.width)
  }
  if (e.quadrant === 1 || e.quadrant === 2) {
    top = Math.max(top, view.panY + AXIS_GAP_PX)
  } else {
    top = Math.min(top, view.panY - AXIS_GAP_PX - rect.height)
  }
  return { ...e, x: screenToWorldX(left, view), y: screenToWorldY(top, view) }
}

export function escalateEvent(e: QuadrantEvent, now: Date): QuadrantEvent {
  if (!e.escalateAt || e.quadrant === 1 || e.quadrant === 4) return e
  if (new Date(e.escalateAt).getTime() > now.getTime()) return e
  const target: Quadrant = e.quadrant === 2 ? 1 : 4
  return { ...e, quadrant: target, x: -e.x - e.width, escalateAt: undefined }
}
