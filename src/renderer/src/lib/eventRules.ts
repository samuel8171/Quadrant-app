import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import {
  autoEventWidth,
  clampEventToQuadrant,
  escalateEvent,
  quadrantOfEventCenter,
  type ViewState
} from './quadrantMath'

export function createEvent(
  text: string,
  quadrant: Quadrant,
  worldX: number,
  worldY: number,
  view: ViewState
): QuadrantEvent {
  const e: QuadrantEvent = {
    id: crypto.randomUUID(),
    text: text.trim(),
    remark: '',
    quadrant,
    x: worldX,
    y: worldY,
    width: autoEventWidth(text),
    createdAt: new Date().toISOString()
  }
  return clampEventToQuadrant(e, view)
}

/**
 * 把事件移动到新的左上角世界坐标。
 * 象限按卡片中心判定，避免贴轴时反复翻转；`view` 仅用于夹取（夹取本身已在世界单位下进行）。
 */
export function moveEvent(
  events: QuadrantEvent[],
  id: string,
  worldX: number,
  worldY: number,
  view: ViewState
): QuadrantEvent[] {
  return events.map((e) => {
    if (e.id !== id) return e
    const moved: QuadrantEvent = { ...e, x: worldX, y: worldY }
    return clampEventToQuadrant({ ...moved, quadrant: quadrantOfEventCenter(moved) }, view)
  })
}

/**
 * 拖动落点的纯计算版本：给定抓取偏移与指针世界坐标，算出夹取后的最终事件。
 * 拖动期间由页面用它渲染预览，抬起时才提交，避免逐帧写库。
 */
export function previewMove(
  e: QuadrantEvent,
  pointerWorldX: number,
  pointerWorldY: number,
  grabOffsetX: number,
  grabOffsetY: number,
  view: ViewState
): QuadrantEvent {
  const moved: QuadrantEvent = {
    ...e,
    x: pointerWorldX - grabOffsetX,
    y: pointerWorldY - grabOffsetY
  }
  return clampEventToQuadrant({ ...moved, quadrant: quadrantOfEventCenter(moved) }, view)
}

export function updateEventInList(
  events: QuadrantEvent[],
  id: string,
  patch: Partial<QuadrantEvent>,
  view: ViewState
): QuadrantEvent[] {
  return events.map((e) => {
    if (e.id !== id) return e
    const merged = { ...e, ...patch }
    if (
      merged.quadrant !== e.quadrant ||
      merged.x !== e.x ||
      merged.y !== e.y ||
      merged.width !== e.width
    ) {
      return clampEventToQuadrant(merged, view)
    }
    return merged
  })
}

export function deleteEventFromList(events: QuadrantEvent[], id: string): QuadrantEvent[] {
  return events.filter((e) => e.id !== id)
}

export function pasteEvent(
  events: QuadrantEvent[],
  source: QuadrantEvent,
  view: ViewState,
  targetX?: number,
  targetY?: number
): QuadrantEvent[] {
  const hasTarget = targetX !== undefined && targetY !== undefined
  const draft: QuadrantEvent = {
    ...source,
    id: crypto.randomUUID(),
    x: hasTarget ? (targetX as number) : source.x + 0.8,
    y: hasTarget ? (targetY as number) : source.y + 0.8,
    width: autoEventWidth(source.text)
  }
  const quadrant = hasTarget ? quadrantOfEventCenter(draft) : source.quadrant
  return [...events, clampEventToQuadrant({ ...draft, quadrant }, view)]
}

export function applyEscalations(events: QuadrantEvent[], now: Date): QuadrantEvent[] {
  let changed = false
  const next = events.map((e) => {
    const escalated = escalateEvent(e, now)
    if (escalated !== e) changed = true
    return escalated
  })
  return changed ? next : events
}
