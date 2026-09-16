import type { Quadrant, QuadrantEvent } from '../../../shared/types'

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

export const UNIT = 20
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5
/** 轴距（屏幕像素），仅用于画布绘制与旧测试基准。 */
export const AXIS_GAP_PX = 10
/**
 * 轴距（世界单位）。事件坐标以世界单位落库，因此约束必须用世界单位表达；
 * 若沿用 `AXIS_GAP_PX` 直接算屏幕矩形，合法位置会随缩放漂移
 * （zoom 2.5 时合法 → zoom 0.5 时视觉轴距只剩 2px）。
 */
export const AXIS_GAP_UNITS = AXIS_GAP_PX / UNIT
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
  return view.panY - wy * UNIT * view.zoom
}

export function screenToWorldX(sx: number, view: ViewState): number {
  return (sx - view.panX) / (UNIT * view.zoom)
}

export function screenToWorldY(sy: number, view: ViewState): number {
  return (view.panY - sy) / (UNIT * view.zoom)
}

export function quadrantOfWorldPoint(wx: number, wy: number): Quadrant {
  if (wx >= 0 && wy >= 0) return 1
  if (wx < 0 && wy >= 0) return 2
  if (wx < 0 && wy < 0) return 3
  return 4
}

/** 鼠标离开视口时取消拖动；触屏/笔由指针捕获接管，不应因此中断。 */
export function shouldClearDragOnPointerLeave(pointerType: string): boolean {
  return pointerType !== 'touch' && pointerType !== 'pen'
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
    panY: viewportY + wy * UNIT * zoom
  }
}

export function autoEventWidth(text: string): number {
  const estimated = Math.ceil(text.length * 0.9) + 2
  return Math.min(MAX_EVENT_WIDTH_UNITS, Math.max(MIN_EVENT_WIDTH_UNITS, estimated))
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

/**
 * 事件所属象限，按**卡片中心**判定而非左上角锚点。
 * 事件在世界坐标系里占据 x ∈ [x, x+width)、y ∈ [y-EVENT_HEIGHT_UNITS, y]
 * （屏幕向下 = 世界 y 减小），因此中心为 (x+width/2, y-EVENT_HEIGHT_UNITS/2)。
 * 用锚点判定会让贴轴卡片在拖动时反复翻转象限。
 */
export function quadrantOfEventCenter(
  e: Pick<QuadrantEvent, 'x' | 'y' | 'width'>
): Quadrant {
  return quadrantOfWorldPoint(e.x + e.width / 2, e.y - EVENT_HEIGHT_UNITS / 2)
}

/**
 * 把事件夹进它所属象限，并保持与坐标轴的最小间距。
 *
 * `view` 参数**有意不使用**：轴距现在是世界单位常量（`AXIS_GAP_UNITS`），
 * 与缩放无关。保留形参是为了不改动既有调用点与测试基准。
 * 旧实现按屏幕像素夹取，等价于世界间距 = AXIS_GAP_PX / (UNIT * zoom)，
 * 于是 zoom 2.5 时合法的位置缩到 0.5 后视觉轴距只剩约 2px。
 */
export function clampEventToQuadrant(e: QuadrantEvent, view: ViewState): QuadrantEvent {
  void view
  const gap = AXIS_GAP_UNITS
  let x = e.x
  let y = e.y
  if (e.quadrant === 1 || e.quadrant === 4) {
    x = Math.max(x, gap)
  } else {
    x = Math.min(x + e.width, -gap) - e.width
  }
  if (e.quadrant === 1 || e.quadrant === 2) {
    y = Math.max(y, gap + EVENT_HEIGHT_UNITS)
  } else {
    y = Math.min(y, -gap)
  }
  return { ...e, x, y }
}

export function escalateEvent(e: QuadrantEvent, now: Date): QuadrantEvent {
  if (!e.escalateAt || e.quadrant === 1 || e.quadrant === 4) return e
  if (new Date(e.escalateAt).getTime() > now.getTime()) return e
  const target: Quadrant = e.quadrant === 2 ? 1 : 4
  return { ...e, quadrant: target, x: -e.x - e.width, escalateAt: undefined }
}
