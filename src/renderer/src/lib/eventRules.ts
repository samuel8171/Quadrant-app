import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import {
  autoEventWidth,
  clampEventToQuadrant,
  escalateEvent,
  quadrantOfWorldPoint,
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

export function moveEvent(
  events: QuadrantEvent[],
  id: string,
  worldX: number,
  worldY: number,
  view: ViewState
): QuadrantEvent[] {
  return events.map((e) => {
    if (e.id !== id) return e
    const quadrant = quadrantOfWorldPoint(worldX, worldY)
    return clampEventToQuadrant({ ...e, quadrant, x: worldX, y: worldY }, view)
  })
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
  const copy: QuadrantEvent = {
    ...source,
    id: crypto.randomUUID(),
    x: targetX !== undefined ? targetX : source.x + 0.8,
    y: targetY !== undefined ? targetY : source.y + 0.8,
    width: autoEventWidth(source.text),
    quadrant:
      targetX !== undefined && targetY !== undefined
        ? quadrantOfWorldPoint(targetX, targetY)
        : source.quadrant
  }
  return [...events, clampEventToQuadrant(copy, view)]
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
