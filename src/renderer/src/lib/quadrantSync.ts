import type { Quadrant, QuadrantEvent, WeekEvent } from '../../../shared/types'
import { EVENT_HEIGHT_UNITS, autoEventWidth } from './quadrantMath'

export const MAX_EVENTS_PER_QUADRANT = 30

const COLUMN_GAP = 0.6
const ROW_STEP = 2.2
const AXIS_OFFSET = 1
const TOP_ROW_Y = 3
const ROW_MAX_X = 40

export interface QuadRect {
  left: number
  top: number
  width: number
  height: number
}

export function countInQuadrant(events: QuadrantEvent[], quadrant: Quadrant): number {
  return events.filter((e) => e.quadrant === quadrant).length
}

export function canAddToQuadrant(events: QuadrantEvent[], quadrant: Quadrant): boolean {
  return countInQuadrant(events, quadrant) < MAX_EVENTS_PER_QUADRANT
}

export function quadrantEventRect(e: QuadrantEvent): QuadRect {
  return { left: e.x, top: e.y, width: e.width, height: EVENT_HEIGHT_UNITS }
}

export function rectsOverlap(a: QuadRect, b: QuadRect): boolean {
  const xOverlap = a.left < b.left + b.width && b.left < a.left + a.width
  const yOverlap = a.top - a.height < b.top && b.top - b.height < a.top
  return xOverlap && yOverlap
}

export function findFreePosition(
  events: QuadrantEvent[],
  quadrant: Quadrant,
  width: number
): { x: number; y: number } | null {
  if (!canAddToQuadrant(events, quadrant)) return null
  const isLeft = quadrant === 2 || quadrant === 3
  const isTop = quadrant === 1 || quadrant === 2
  const inQuadrant = events
    .filter((e) => e.quadrant === quadrant)
    .map((e) => ({
      left: isLeft ? -(e.x + e.width) : e.x,
      width: e.width,
      top: e.y
    }))

  for (let row = 0; row < MAX_EVENTS_PER_QUADRANT; row++) {
    const rowTop = isTop
      ? TOP_ROW_Y + ROW_STEP * row
      : -(TOP_ROW_Y + ROW_STEP * row)
    const band = inQuadrant
      .filter((r) => Math.abs(r.top - rowTop) < ROW_STEP / 2)
      .sort((a, b) => a.left - b.left)
    let cursor = AXIS_OFFSET
    for (const r of band) {
      if (cursor + width + COLUMN_GAP <= r.left) break
      cursor = Math.max(cursor, r.left + r.width + COLUMN_GAP)
    }
    if (cursor + width <= ROW_MAX_X) {
      return { x: isLeft ? -(cursor + width) : cursor, y: rowTop }
    }
  }
  return null
}

export function buildQuadrantEvent(
  weekEvent: WeekEvent,
  x: number,
  y: number
): QuadrantEvent {
  return {
    id: crypto.randomUUID(),
    text: weekEvent.title,
    remark: weekEvent.remark,
    quadrant: weekEvent.quadrant,
    x,
    y,
    width: autoEventWidth(weekEvent.title),
    createdAt: new Date().toISOString()
  }
}

export function widthForTitle(title: string): number {
  return autoEventWidth(title)
}
