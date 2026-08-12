import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import ContextMenu, { type ContextMenuState } from '../components/ContextMenu'
import EventCard from '../components/EventCard'
import EventDetailDialog from '../components/EventDetailDialog'
import {
  AXIS_GAP_PX,
  QUADRANT_META,
  UNIT,
  clampOrigin,
  quadrantOfWorldPoint,
  screenToWorldX,
  screenToWorldY,
  zoomAt,
  type ViewState
} from '../lib/quadrantMath'
import { useAppStore } from '../state/appStore'

interface EditingState {
  mode: 'create' | 'edit'
  id?: string
  text: string
  quadrant: Quadrant
  x: number
  y: number
}

const RADIUS = 12

export default function QuadrantPage(): JSX.Element {
  const events = useAppStore((s) => s.data.events)
  const addEvent = useAppStore((s) => s.addEvent)
  const updateEvent = useAppStore((s) => s.updateEvent)
  const deleteEvent = useAppStore((s) => s.deleteEvent)
  const moveEvent = useAppStore((s) => s.moveEvent)
  const copyEvent = useAppStore((s) => s.copyEvent)
  const cutEvent = useAppStore((s) => s.cutEvent)
  const pasteEvent = useAppStore((s) => s.pasteEvent)
  const saveNow = useAppStore((s) => s.saveNow)

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panRef = useRef<{ startX: number; startY: number; startView: ViewState } | null>(null)
  const dragRef = useRef<{ id: string } | null>(null)

  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverQuadrant, setHoverQuadrant] = useState<Quadrant | null>(null)
  const [labelVisible, setLabelVisible] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => {
      const rect = el.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
      setView((v) => clampOrigin(v, rect.width, rect.height))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (size.width > 0 && view.panX === 0 && view.panY === 0) {
      setView({ zoom: 1, panX: size.width / 2, panY: size.height / 2 })
    }
  }, [size, view.panX, view.panY])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      setView((v) => {
        const z = v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)
        return clampOrigin(zoomAt(x, y, z, v), rect.width, rect.height)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    if (!hoverQuadrant) {
      setLabelVisible(false)
      return
    }
    const timer = window.setTimeout(() => setLabelVisible(true), 1000)
    return () => window.clearTimeout(timer)
  }, [hoverQuadrant])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const regions: Record<
      Quadrant,
      { x: number; y: number; w: number; h: number; radii: number[] }
    > = {
      1: {
        x: view.panX + AXIS_GAP_PX,
        y: view.panY + AXIS_GAP_PX,
        w: size.width - view.panX - AXIS_GAP_PX,
        h: size.height - view.panY - AXIS_GAP_PX,
        radii: [RADIUS, 0, 0, 0]
      },
      2: {
        x: 0,
        y: view.panY + AXIS_GAP_PX,
        w: view.panX - AXIS_GAP_PX,
        h: size.height - view.panY - AXIS_GAP_PX,
        radii: [0, RADIUS, 0, 0]
      },
      3: {
        x: 0,
        y: 0,
        w: view.panX - AXIS_GAP_PX,
        h: view.panY - AXIS_GAP_PX,
        radii: [0, 0, RADIUS, 0]
      },
      4: {
        x: view.panX + AXIS_GAP_PX,
        y: 0,
        w: size.width - view.panX - AXIS_GAP_PX,
        h: view.panY - AXIS_GAP_PX,
        radii: [0, 0, 0, RADIUS]
      }
    }

    ;([1, 2, 3, 4] as Quadrant[]).forEach((q) => {
      const r = regions[q]
      if (r.w <= 0 || r.h <= 0) return
      const color = QUADRANT_META[q].color
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, r.radii)
      ctx.fillStyle = color + '2B'
      ctx.fill()
      ctx.strokeStyle = color + 'E6'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })

    ctx.strokeStyle = '#555555'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, view.panY)
    ctx.lineTo(size.width, view.panY)
    ctx.moveTo(view.panX, 0)
    ctx.lineTo(view.panX, size.height)
    ctx.stroke()

    ctx.fillStyle = '#555555'
    ctx.beginPath()
    ctx.moveTo(size.width - 8, view.panY - 4)
    ctx.lineTo(size.width - 8, view.panY + 4)
    ctx.lineTo(size.width - 1, view.panY)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(view.panX - 4, 8)
    ctx.lineTo(view.panX + 4, 8)
    ctx.lineTo(view.panX, 1)
    ctx.closePath()
    ctx.fill()
  }, [view, size])

  useEffect(() => {
    draw()
  }, [draw])

  const clientToViewport = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault()
      viewportRef.current?.setPointerCapture(e.pointerId)
      panRef.current = { startX: e.clientX, startY: e.clientY, startView: view }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (panRef.current) {
      const start = panRef.current
      const dx = e.clientX - start.startX
      const dy = e.clientY - start.startY
      setView(
        clampOrigin(
          { ...start.startView, panX: start.startView.panX + dx, panY: start.startView.panY + dy },
          rect.width,
          rect.height
        )
      )
    }

    if (dragRef.current) {
      const wx = screenToWorldX(x, view)
      const wy = screenToWorldY(y, view)
      moveEvent(dragRef.current.id, wx, wy, view)
    }

    setHoverQuadrant(quadrantOfWorldPoint(screenToWorldX(x, view), screenToWorldY(y, view)))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    panRef.current = null
    dragRef.current = null
    if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as Element
    if (!target.closest('.event-card')) {
      const { x, y } = clientToViewport(e.clientX, e.clientY)
      const wx = screenToWorldX(x, view)
      const wy = screenToWorldY(y, view)
      setEditing({
        mode: 'create',
        text: '',
        quadrant: quadrantOfWorldPoint(wx, wy),
        x: wx,
        y: wy
      })
    }
  }

  const onEventDragStart = (e: React.PointerEvent, event: QuadrantEvent): void => {
    e.preventDefault()
    viewportRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { id: event.id }
  }

  const onEventContextMenu = (e: React.MouseEvent, event: QuadrantEvent): void => {
    setMenu({ x: e.clientX, y: e.clientY, eventId: event.id })
  }

  const onEditEvent = (event: QuadrantEvent): void => {
    setEditing({
      mode: 'edit',
      id: event.id,
      text: event.text,
      quadrant: event.quadrant,
      x: event.x,
      y: event.y
    })
  }

  const commitEditing = (): void => {
    if (!editing) return
    if (editing.mode === 'create') {
      if (editing.text.trim()) addEvent(editing.text, editing.quadrant, editing.x, editing.y, view)
    } else if (editing.id && editing.text.trim()) {
      updateEvent(editing.id, { text: editing.text.trim() }, view)
    }
    setEditing(null)
  }

  const detailEvent = detailId ? events.find((e) => e.id === detailId) : undefined
  const overdue = (e: QuadrantEvent): boolean =>
    !!e.deadline && new Date(e.deadline).getTime() < Date.now()

  return (
    <div className="quadrant-page">
      <header className="page-header quadrant-header">
        <h1>四象限</h1>
        <span className="title-underline" />
        <span className="hint-pill">🖱️ Ctrl+拖拽 平移 / 滚轮 缩放</span>
      </header>
      <div
        ref={viewportRef}
        className="quadrant-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          panRef.current = null
          dragRef.current = null
          setHoverQuadrant(null)
        }}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvasRef} className="quadrant-canvas" />
        <div
          className="event-layer"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              overdue={overdue(e)}
              onDragStart={onEventDragStart}
              onContextMenu={onEventContextMenu}
              onEdit={onEditEvent}
            />
          ))}
          {editing && (
            <textarea
              className="event-input"
              autoFocus
              value={editing.text}
              placeholder="输入事件，回车保存"
              style={{
                left: editing.x * UNIT,
                top: editing.y * UNIT,
                width: Math.max(editing.text.length, 8) * 10
              }}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitEditing()
                }
                if (e.key === 'Escape') setEditing(null)
              }}
              onBlur={() => setEditing(null)}
            />
          )}
        </div>
        {labelVisible && hoverQuadrant && (
          <div className={`quadrant-label q${hoverQuadrant}`}>
            {QUADRANT_META[hoverQuadrant].label}
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          menu={menu}
          canPaste={useAppStore.getState().data.events.length >= 0}
          onAction={(action) => {
            if (action === 'cut') cutEvent(menu.eventId)
            if (action === 'copy') copyEvent(menu.eventId)
            if (action === 'paste') pasteEvent(view)
            if (action === 'delete') {
              if (window.confirm('删除该事件？')) deleteEvent(menu.eventId)
            }
            if (action === 'save') saveNow()
            if (action === 'detail') setDetailId(menu.eventId)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {detailEvent && (
        <EventDetailDialog
          event={detailEvent}
          onSave={(patch) => updateEvent(detailEvent.id, patch, view)}
          onClose={() => setDetailId(null)}
        />
      )}
      <span className="tick-sink">{tick}</span>
    </div>
  )
}
