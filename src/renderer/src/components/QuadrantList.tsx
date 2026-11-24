import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Info, Trash2 } from 'lucide-react'
import type { EventGroup, Quadrant, QuadrantEvent } from '../../../shared/types'
import { MOTION_SETTLE_MS, MOTION_EASE } from '../lib/motion'
import { QUADRANT_META, QUADRANT_ORDER } from '../lib/quadrantMath'
import './quadrant-list.css'

interface Props {
  events: QuadrantEvent[]
  groups: EventGroup[]
  onEdit: (event: QuadrantEvent) => void
  onDelete: (event: QuadrantEvent) => void
  onMove: (event: QuadrantEvent, quadrant: Quadrant) => void
  onMoveGroup: (event: QuadrantEvent, quadrant: Quadrant) => void
  onOpenGroup: (groupId: string, trigger: HTMLButtonElement) => void
  onGroupDrop: (event: QuadrantEvent, target: QuadrantEvent) => void
}

const MOVE_OPTIONS: Quadrant[] = [1, 2, 4, 3]
const DRAG_THRESHOLD = 8
const DWELL_MS = 400
const DWELL_SLOP = 6
const SCROLL_EDGE = 48
const MAX_SCROLL_SPEED = 720

interface Row {
  event: QuadrantEvent
  group?: EventGroup
  localCount: number
  totalCount: number
}

interface Point { x: number; y: number }

interface DragState {
  source: Row
  handle: HTMLButtonElement
  pointerId: number
  start: Point
  point: Point
  active: boolean
  frame: number
  lastTime: number
  dwell: (Point & { id: string; since: number }) | null
  preview: DragPreview | null
}

interface DragPreview extends Point {
  sourceId: string
  quadrant: Quadrant | null
  groupTargetId: string | null
  groupAction: string
  title: string
}

function makeRows(events: QuadrantEvent[], groups: EventGroup[]): Record<Quadrant, Row[]> {
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const totals = new Map<string, number>()
  for (const event of events) {
    if (event.groupId) totals.set(event.groupId, (totals.get(event.groupId) ?? 0) + 1)
  }
  const rows: Record<Quadrant, Row[]> = { 1: [], 2: [], 3: [], 4: [] }
  const stacks: Record<Quadrant, Map<string, Row>> = { 1: new Map(), 2: new Map(), 3: new Map(), 4: new Map() }
  for (const event of events) {
    const group = event.groupId ? groupsById.get(event.groupId) : undefined
    const stack = group ? stacks[event.quadrant].get(group.id) : undefined
    if (stack) {
      stack.localCount++
      continue
    }
    const row = { event, group, localCount: 1, totalCount: group ? (totals.get(group.id) ?? 1) : 1 }
    rows[event.quadrant].push(row)
    if (group) stacks[event.quadrant].set(group.id, row)
  }
  return rows
}

function isMainStack(row: Row): boolean {
  return row.group?.anchorQuadrant === row.event.quadrant
}

function direction(from: Quadrant, to: Quadrant): string {
  const [fromY, fromX] = QUADRANT_META[from].corner.split('-')
  const [toY, toX] = QUADRANT_META[to].corner.split('-')
  if (fromY === toY) return toX === 'left' ? '←' : '→'
  if (fromX === toX) return toY === 'top' ? '↑' : '↓'
  if (toY === 'top') return toX === 'left' ? '↖' : '↗'
  return toX === 'left' ? '↙' : '↘'
}

function isInsideCenter(card: HTMLElement, { x, y }: Point): boolean {
  const { left, top, width, height } = card.getBoundingClientRect()
  return Math.abs(x - (left + width / 2)) < width * 0.26 &&
    Math.abs(y - (top + height / 2)) < height * 0.3
}

function scrollAtEdge(list: HTMLDivElement, { x, y }: Point, elapsed: number): boolean {
  const rect = list.getBoundingClientRect()
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false
  const towardTop = Math.max(0, SCROLL_EDGE - (y - rect.top))
  const towardBottom = Math.max(0, SCROLL_EDGE - (rect.bottom - y))
  const offset = ((towardBottom - towardTop) / SCROLL_EDGE) * MAX_SCROLL_SPEED * elapsed / 1000
  const before = list.scrollTop
  if (offset) list.scrollTop += Math.sign(offset) * Math.max(1, Math.abs(offset))
  return before !== list.scrollTop
}

function clearDrag(state: DragState): void {
  cancelAnimationFrame(state.frame)
  if (state.handle.hasPointerCapture(state.pointerId)) state.handle.releasePointerCapture(state.pointerId)
}

export default function QuadrantList({ events, groups, onEdit, onDelete, onMove, onMoveGroup, onOpenGroup, onGroupDrop }: Props): JSX.Element {
  const dragRef = useRef<DragState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const rows = useMemo(() => makeRows(events, groups), [events, groups])
  const eventsById = useMemo(() => new Map(events.map((event) => [event.id, event])), [events])
  const emptyAnchors = useMemo(() => {
    const anchors: Record<Quadrant, EventGroup[]> = { 1: [], 2: [], 3: [], 4: [] }
    const counted = new Set<string>()
    for (const q of QUADRANT_ORDER) {
      for (const { group } of rows[q]) {
        if (!group || counted.has(group.id)) continue
        counted.add(group.id)
        if (!rows[group.anchorQuadrant].some((row) => row.group?.id === group.id)) {
          anchors[group.anchorQuadrant].push(group)
        }
      }
    }
    return anchors
  }, [rows])

  const stopDrag = useCallback((): DragState | null => {
    const state = dragRef.current
    if (!state) return null
    dragRef.current = null
    clearDrag(state)
    setPreview(null)
    return state
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (dragRef.current && dragRef.current.pointerId !== event.pointerId) {
        stopDrag()
        // A second contact must not pick up another handle during the same event.
        if (event.target instanceof Element && event.target.closest('.quadrant-list-drag')) {
          event.stopPropagation()
        }
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !dragRef.current) return
      event.preventDefault()
      event.stopPropagation()
      stopDrag()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', stopDrag)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', stopDrag)
      const state = dragRef.current
      dragRef.current = null
      if (state) clearDrag(state)
    }
  }, [stopDrag])

  const getDropPreview = (state: DragState, now: number, scrolled = false): DragPreview => {
    const { point, source } = state
    const list = listRef.current
    const hit = document.elementFromPoint(point.x, point.y)
    const section = hit?.closest<HTMLElement>('.quadrant-list-column[data-quadrant]')
    const quadrant = section && list?.contains(section) ? Number(section.dataset.quadrant) as Quadrant : null
    const card = quadrant === null ? null : hit?.closest<HTMLElement>('.quadrant-list-event[data-event-id]')
    const cardId = card?.dataset.eventId
    const groupingAllowed = !isMainStack(source) && (!source.group || source.localCount === 1)
    const validGroupTarget = groupingAllowed && card && cardId && cardId !== source.event.id &&
      (!source.group || source.group.id !== card.dataset.groupId) && isInsideCenter(card, point)
    if (!validGroupTarget || scrolled) {
      state.dwell = null
    } else if (state.dwell?.id !== cardId ||
      Math.hypot(point.x - state.dwell.x, point.y - state.dwell.y) > DWELL_SLOP) {
      state.dwell = { ...point, id: cardId, since: now }
    }
    const groupTargetId = state.dwell && now - state.dwell.since >= DWELL_MS ? state.dwell.id : null
    return {
      ...point,
      sourceId: source.event.id,
      quadrant,
      groupTargetId,
      groupAction: groupTargetId ? (card?.dataset.groupId ? '松手加入' : '松手成组') : '',
      title: isMainStack(source) ? (source.group?.name ?? source.event.text) : source.event.text
    }
  }

  const tick = (state: DragState, now: number): void => {
    if (dragRef.current !== state) return
    const list = listRef.current
    const scrolled = list ? scrollAtEdge(list, state.point, Math.min(now - state.lastTime, 32)) : false
    state.lastTime = now
    const next = getDropPreview(state, now, scrolled)
    const previous = state.preview
    if (!previous || previous.x !== next.x || previous.y !== next.y ||
      previous.quadrant !== next.quadrant || previous.groupTargetId !== next.groupTargetId ||
      previous.groupAction !== next.groupAction) {
      state.preview = next
      setPreview(next)
    }
    state.frame = requestAnimationFrame((time) => tick(state, time))
  }

  const begin = (source: Row, event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.focus({ preventScroll: true })
    handle.setPointerCapture(event.pointerId)
    const point = { x: event.clientX, y: event.clientY }
    dragRef.current = {
      source, handle, pointerId: event.pointerId, start: point, point, active: false,
      frame: 0, lastTime: 0, dwell: null, preview: null
    }
  }

  const move = (event: ReactPointerEvent): void => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    state.point = { x: event.clientX, y: event.clientY }
    if (state.active || Math.hypot(state.point.x - state.start.x, state.point.y - state.start.y) < DRAG_THRESHOLD) return
    state.active = true
    state.lastTime = performance.now()
    tick(state, state.lastTime)
  }

  const finish = (event: ReactPointerEvent, canceled = false): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    const state = stopDrag()
    if (canceled || !state?.active) return

    const source = eventsById.get(state.source.event.id)
    if (!source || source.quadrant !== state.source.event.quadrant || source.groupId !== state.source.event.groupId) return
    const currentRow = rows[source.quadrant].find((row) => row.event.id === source.id)
    if (!currentRow || currentRow.localCount !== state.source.localCount ||
      currentRow.group?.anchorQuadrant !== state.source.group?.anchorQuadrant) return
    state.source = currentRow
    state.point = { x: event.clientX, y: event.clientY }
    const drop = getDropPreview(state, performance.now())
    if (drop.groupTargetId) {
      const target = eventsById.get(drop.groupTargetId)
      if (target) onGroupDrop(source, target)
      return
    }
    if (drop.quadrant === null || drop.quadrant === source.quadrant) return
    if (isMainStack(state.source)) onMoveGroup(source, drop.quadrant)
    else onMove(source, drop.quadrant)
  }

  const moveFromSelect = (row: Row, destination: Quadrant): void => {
    const { event, group } = row
    if (event.quadrant === destination) return
    if (isMainStack(row)) onMoveGroup(event, destination)
    else onMove(event, destination)
    requestAnimationFrame(() => {
      const column = listRef.current?.querySelector(`.quadrant-list-column[data-quadrant="${destination}"]`)
      const cards = column?.querySelectorAll<HTMLElement>('.quadrant-list-event')
      const replacement = Array.from(cards ?? []).find((card) => group
        ? card.dataset.groupId === group.id : card.dataset.eventId === event.id)
      const focus = replacement?.querySelector<HTMLElement>('select') ??
        replacement?.querySelector<HTMLElement>('.quadrant-list-title')
      focus?.focus()
    })
  }

  return (
    <div ref={listRef} className="quadrant-list-view"
      onPointerMove={move} onPointerUp={finish}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}>
      {QUADRANT_ORDER.map((q) => {
        const visible = rows[q]
        const count = visible.reduce((total, row) => total + row.localCount, 0)
        return (
          <section className={`quadrant-list-column q${q}`}
            data-quadrant={q} data-drop-active={preview?.quadrant === q || undefined}
            key={q} aria-label={QUADRANT_META[q].label}>
            <header><span>{QUADRANT_META[q].label}</span><strong aria-label={`${count} 张卡`}>{count}</strong></header>
            <div className="quadrant-list-items">
              {visible.map((row) => {
                const { event, group, localCount, totalCount } = row
                const mainStack = isMainStack(row)
                const title = group ? group.name : event.text
                const canMove = mainStack || localCount === 1
                const armed = preview?.groupTargetId === event.id
                return (
                  <article className={`quadrant-list-event${armed ? ' group-drop-target' : ''}${preview?.sourceId === event.id ? ' is-list-dragging' : ''}`}
                    data-event-id={event.id} data-group-id={group?.id} data-stacked={localCount > 1 || undefined}
                    key={group ? `group:${group.id}` : `event:${event.id}`}>
                    {canMove && (
                      <button className="quadrant-list-drag" type="button"
                        aria-label={`拖动${mainStack ? '卡组' : '卡片'}「${title}」`}
                        onPointerDown={(pointer) => begin(row, pointer)}
                        onClick={(click) => {
                          if (click.detail !== 0) return
                          const card = click.currentTarget.closest('article')
                          const select = card?.querySelector('select')
                          const detail = card?.querySelector<HTMLButtonElement>('.quadrant-list-detail')
                          if (select?.getClientRects().length) select.focus()
                          else detail?.focus()
                        }}>
                        <span aria-hidden="true">⠿</span>
                      </button>
                    )}
                    <div className="quadrant-list-copy">
                      <button className="quadrant-list-title" type="button"
                        onClick={(click) => group ? onOpenGroup(group.id, click.currentTarget) : onEdit(event)}>
                        <span>{group && !mainStack ? `${direction(q, group.anchorQuadrant)} ` : ''}{title}</span>
                        {group && <small className="quadrant-list-group">{localCount} 张在此 · 全组 {totalCount} 张</small>}
                      </button>
                      {!group && event.deadline && <small>截止 {new Date(event.deadline).toLocaleString()}</small>}
                    </div>
                    {canMove && (
                      <label className="quadrant-list-move">
                        {mainStack ? '整组移到' : '移动到'}
                        <select aria-label={`${mainStack ? '整组移动' : '移动'}「${title}」`}
                          value={q} onChange={(change) => moveFromSelect(row, Number(change.currentTarget.value) as Quadrant)}>
                          {MOVE_OPTIONS.map((dest) => <option key={dest} value={dest}>{QUADRANT_META[dest].label}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="quadrant-list-actions">
                      <button type="button" className="quadrant-list-detail" aria-label={`详细信息「${event.text}」`}
                        title="详细信息" onClick={() => onEdit(event)}>
                        <Info size={17} aria-hidden="true" />
                      </button>
                      <button type="button" className="quadrant-list-delete" aria-label={`删除事件「${event.text}」`}
                        title="删除事件" onClick={() => onDelete(event)}>
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                )
              })}
              {emptyAnchors[q].map((group) => (
                <button className="quadrant-list-anchor" data-group-id={group.id} key={group.id}
                  type="button" onClick={(click) => onOpenGroup(group.id, click.currentTarget)}>
                  <span>{group.name}</span><small>主象限暂空 · 查看组员</small>
                </button>
              ))}
            </div>
          </section>
        )
      })}
      {preview && createPortal((
        <div className={`quadrant-list-drag-preview${preview.groupTargetId ? ' is-grouping' : ''}`}
          style={{
            left: `min(${Math.max(8, preview.x + 12)}px, calc(100vw - min(240px, 65vw) - 8px))`,
            top: preview.y < window.innerHeight - 80 ? Math.max(8, preview.y + 12) : undefined,
            bottom: preview.y >= window.innerHeight - 80 ? Math.max(8, window.innerHeight - preview.y + 12) : undefined,
            transition: `border-color ${MOTION_SETTLE_MS}ms ${MOTION_EASE}, box-shadow ${MOTION_SETTLE_MS}ms ${MOTION_EASE}`
          }}
          aria-hidden="true">
          <span>{preview.title}</span>
          {preview.groupAction && <small>{preview.groupAction}</small>}
        </div>
      ), document.body)}
    </div>
  )
}
