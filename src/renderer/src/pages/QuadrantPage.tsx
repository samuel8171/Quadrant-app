import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu, { type ContextMenuState } from '../components/ContextMenu'
import EventCard from '../components/EventCard'
import EventDetailDialog from '../components/EventDetailDialog'
import {
  AXIS_GAP_PX,
  QUADRANT_META,
  UNIT,
  autoEventWidth,
  clampZoom,
  clampOrigin,
  quadrantOfWorldPoint,
  shouldCaptureTouchPointer,
  shouldProcessTouchMove,
  screenToWorldX,
  screenToWorldY,
  zoomAt,
  type ViewState
} from '../lib/quadrantMath'
import { hasClipboardEvent, useAppStore } from '../state/appStore'

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
  const centeredRef = useRef(false)
  const hoverRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const viewRef = useRef<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const targetZoomRef = useRef(1)
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const zoomAnimRef = useRef<number | null>(null)
  const panAnimRef = useRef<number | null>(null)
  const panLastRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const panVelRef = useRef({ x: 0, y: 0 })
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number; view: ViewState } | null>(null)

  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverQuadrant, setHoverQuadrant] = useState<Quadrant | null>(null)
  const [labelVisible, setLabelVisible] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  viewRef.current = view

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

  // 每次打开页面时把原点放到视口中央。
  useEffect(() => {
    if (!centeredRef.current && size.width > 0 && size.height > 0) {
      centeredRef.current = true
      targetZoomRef.current = 1
      setView({ zoom: 1, panX: size.width / 2, panY: size.height / 2 })
    }
  }, [size])

  const startZoomAnim = useCallback(() => {
    if (zoomAnimRef.current !== null) return
    const step = (): void => {
      const current = viewRef.current
      const target = targetZoomRef.current
      const anchor = zoomAnchorRef.current
      const nextZoom = clampZoom(current.zoom + (target - current.zoom) * 0.22)
      const next = anchor
        ? zoomAt(anchor.x, anchor.y, nextZoom, current)
        : { ...current, zoom: nextZoom }
      viewRef.current = next
      setView(next)
      if (Math.abs(target - nextZoom) > 0.0005) {
        zoomAnimRef.current = requestAnimationFrame(step)
      } else {
        zoomAnimRef.current = null
      }
    }
    zoomAnimRef.current = requestAnimationFrame(step)
  }, [setView])

  const startPanInertia = useCallback(() => {
    if (panAnimRef.current !== null) return
    let last = performance.now()
    const step = (now: number): void => {
      const dt = Math.min(64, now - last)
      last = now
      const el = viewportRef.current
      const current = viewRef.current
      if (el && dt > 0) {
        const rect = el.getBoundingClientRect()
        const v = panVelRef.current
        const next = clampOrigin(
          { ...current, panX: current.panX + v.x * dt, panY: current.panY + v.y * dt },
          rect.width,
          rect.height
        )
        viewRef.current = next
        setView(next)
        const damping = Math.exp(-dt / 140)
        v.x *= damping
        v.y *= damping
      }
      if (Math.hypot(panVelRef.current.x, panVelRef.current.y) < 0.04) {
        panAnimRef.current = null
        return
      }
      panAnimRef.current = requestAnimationFrame(step)
    }
    panAnimRef.current = requestAnimationFrame(step)
  }, [setView])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const delta = Math.abs(e.deltaY)
      const steps = Math.min(4, Math.max(0.25, delta / 100))
      const factor = e.deltaY < 0 ? Math.pow(1.12, steps) : Math.pow(1 / 1.12, steps)
      targetZoomRef.current = clampZoom(targetZoomRef.current * factor)
      zoomAnchorRef.current = { x, y }
      startZoomAnim()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [startZoomAnim])

  useEffect(() => {
    return () => {
      if (zoomAnimRef.current !== null) cancelAnimationFrame(zoomAnimRef.current)
      if (panAnimRef.current !== null) cancelAnimationFrame(panAnimRef.current)
    }
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

  // 左键点击菜单外任意位置时收起右键菜单。
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (target && target.closest('.context-menu')) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menu])

  // Ctrl+C / Ctrl+X / Ctrl+V 键盘复制粘贴。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (!e.ctrlKey || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'c' || key === 'x') {
        const id = selectedId ?? menu?.eventId
        if (!id) return
        e.preventDefault()
        if (key === 'c') {
          copyEvent(id)
        } else {
          cutEvent(id)
          if (selectedId === id) setSelectedId(null)
        }
      } else if (key === 'v') {
        e.preventDefault()
        const hover = hoverRef.current
        const rect = viewportRef.current?.getBoundingClientRect()
        if (hover && rect) {
          const wx = screenToWorldX(hover.clientX - rect.left, viewRef.current)
          const wy = screenToWorldY(hover.clientY - rect.top, viewRef.current)
          pasteEvent(viewRef.current, wx, wy)
        } else {
          pasteEvent(viewRef.current)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, menu?.eventId, copyEvent, cutEvent, pasteEvent])

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
        y: 0,
        w: size.width - view.panX - AXIS_GAP_PX,
        h: view.panY - AXIS_GAP_PX,
        radii: [0, 0, 0, RADIUS]
      },
      2: {
        x: 0,
        y: 0,
        w: view.panX - AXIS_GAP_PX,
        h: view.panY - AXIS_GAP_PX,
        radii: [0, 0, RADIUS, 0]
      },
      3: {
        x: 0,
        y: view.panY + AXIS_GAP_PX,
        w: view.panX - AXIS_GAP_PX,
        h: size.height - view.panY - AXIS_GAP_PX,
        radii: [0, RADIUS, 0, 0]
      },
      4: {
        x: view.panX + AXIS_GAP_PX,
        y: view.panY + AXIS_GAP_PX,
        w: size.width - view.panX - AXIS_GAP_PX,
        h: size.height - view.panY - AXIS_GAP_PX,
        radii: [RADIUS, 0, 0, 0]
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
    if (e.pointerType === 'touch') {
      const points = touchPointsRef.current
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const target = e.target as Element | null
      const targetIsEvent = !!target?.closest('.event-card')
      if (shouldCaptureTouchPointer(targetIsEvent)) {
        viewportRef.current?.setPointerCapture(e.pointerId)
      }
      if (points.size === 1 && targetIsEvent) {
        return
      }
      if (points.size === 1) {
        panRef.current = { startX: e.clientX, startY: e.clientY, startView: view }
        panLastRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
        panVelRef.current = { x: 0, y: 0 }
      } else if (points.size === 2) {
        panRef.current = null
        const [a, b] = [...points.values()]
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: view.zoom,
          view
        }
      }
      return
    }
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      e.preventDefault()
      viewportRef.current?.setPointerCapture(e.pointerId)
      panRef.current = { startX: e.clientX, startY: e.clientY, startView: view }
      panLastRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      panVelRef.current = { x: 0, y: 0 }
      if (panAnimRef.current !== null) {
        cancelAnimationFrame(panAnimRef.current)
        panAnimRef.current = null
      }
    }
    if (e.button === 0 && !e.ctrlKey) {
      const target = e.target as Element | null
      if (!target?.closest('.event-card')) setSelectedId(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    hoverRef.current = { clientX: e.clientX, clientY: e.clientY }
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (e.pointerType === 'touch') {
      const points = touchPointsRef.current
      if (!shouldProcessTouchMove(points.has(e.pointerId), dragRef.current !== null)) return
      if (points.has(e.pointerId)) points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (points.size >= 2 && pinchRef.current) {
        const [a, b] = [...points.values()]
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const centerX = (a.x + b.x) / 2 - rect.left
        const centerY = (a.y + b.y) / 2 - rect.top
        const next = zoomAt(
          centerX,
          centerY,
          pinchRef.current.zoom * (distance / pinchRef.current.distance),
          pinchRef.current.view
        )
        viewRef.current = next
        setView(next)
        return
      }
    }

    if (panRef.current) {
      const start = panRef.current
      const dx = e.clientX - start.startX
      const dy = e.clientY - start.startY
      const next = clampOrigin(
        { ...start.startView, panX: start.startView.panX + dx, panY: start.startView.panY + dy },
        rect.width,
        rect.height
      )
      viewRef.current = next
      setView(next)
      const now = performance.now()
      const last = panLastRef.current
      if (last && now > last.t) {
        panVelRef.current = {
          x: (e.clientX - last.x) / (now - last.t),
          y: (e.clientY - last.y) / (now - last.t)
        }
      }
      panLastRef.current = { x: e.clientX, y: e.clientY, t: now }
    }

    if (dragRef.current) {
      const wx = screenToWorldX(x, view)
      const wy = screenToWorldY(y, view)
      moveEvent(dragRef.current.id, wx, wy, view)
    }

    setHoverQuadrant(quadrantOfWorldPoint(screenToWorldX(x, view), screenToWorldY(y, view)))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') {
      touchPointsRef.current.delete(e.pointerId)
      pinchRef.current = null
      dragRef.current = null
      if (touchPointsRef.current.size === 0) {
        panRef.current = null
      } else {
        const [point] = [...touchPointsRef.current.values()]
        panRef.current = { startX: point.x, startY: point.y, startView: viewRef.current }
      }
      if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
      return
    }
    const wasPanning = panRef.current !== null
    panRef.current = null
    dragRef.current = null
    if (e.target instanceof Element) e.target.releasePointerCapture?.(e.pointerId)
    if (wasPanning && Math.hypot(panVelRef.current.x, panVelRef.current.y) > 0.05) {
      startPanInertia()
    }
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

  const onViewportContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const { x, y } = clientToViewport(e.clientX, e.clientY)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      worldX: screenToWorldX(x, view),
      worldY: screenToWorldY(y, view)
    })
  }

  const onEventDragStart = (e: React.PointerEvent, event: QuadrantEvent): void => {
    e.preventDefault()
    viewportRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { id: event.id }
  }

  const onEventLongPress = (event: QuadrantEvent, clientX: number, clientY: number): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenu({
      x: clientX,
      y: clientY,
      eventId: event.id,
      worldX: screenToWorldX(clientX - rect.left, viewRef.current),
      worldY: screenToWorldY(clientY - rect.top, viewRef.current)
    })
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
      const text = editing.text.trim()
      updateEvent(editing.id, { text, width: autoEventWidth(text) }, view)
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
        <span className="hint-pill desktop-only">🖱️ Ctrl+拖拽 平移 / 滚轮 缩放</span>
        <span className="hint-pill mobile-only">👆 拖动画布 · 双指缩放 · 双击新建</span>
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
          hoverRef.current = null
          setHoverQuadrant(null)
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onViewportContextMenu}
      >
        <canvas ref={canvasRef} className="quadrant-canvas" />
        <div
          className="event-layer"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {events.map((e) =>
            editing?.id === e.id ? null : (
              <EventCard
                key={e.id}
                event={e}
                overdue={overdue(e)}
                selected={selectedId === e.id}
                onSelect={() => setSelectedId(e.id)}
                onDragStart={onEventDragStart}
                onContextMenu={onEventContextMenu}
                onLongPress={onEventLongPress}
                onEdit={onEditEvent}
              />
            )
          )}
          {editing && (
            <input
              className="event-input"
              autoFocus
              value={editing.text}
              placeholder="输入事件，回车保存"
              style={{
                left: editing.x * UNIT,
                top: -editing.y * UNIT,
                width: Math.max(140, autoEventWidth(editing.text) * UNIT)
              }}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
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
          canPaste={hasClipboardEvent()}
          onAction={(action) => {
            if (action === 'cut') {
              cutEvent(menu.eventId!)
              if (selectedId === menu.eventId) setSelectedId(null)
            }
            if (action === 'copy') {
              copyEvent(menu.eventId!)
              setSelectedId(menu.eventId!)
            }
            if (action === 'paste') pasteEvent(view, menu.worldX, menu.worldY)
            if (action === 'delete') {
              setDeletePendingId(menu.eventId!)
            }
            if (action === 'save') saveNow()
            if (action === 'detail') setDetailId(menu.eventId!)
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
      {deletePendingId && (
        <ConfirmDialog
          message="确定删除该事件？"
          onConfirm={() => {
            deleteEvent(deletePendingId)
            if (selectedId === deletePendingId) setSelectedId(null)
          }}
          onCancel={() => setDeletePendingId(null)}
        />
      )}
      <span className="tick-sink">{tick}</span>
    </div>
  )
}
