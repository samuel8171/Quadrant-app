import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import { MAX_EVENT_PHOTOS } from '../../../shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu, { type ContextMenuState } from '../components/ContextMenu'
import EventCard from '../components/EventCard'
import EventDetailDialog from '../components/EventDetailDialog'
import ImageViewer from '../components/ImageViewer'
import { previewMove } from '../lib/eventRules'
import { compressPhoto } from '../lib/photoCompress'
import { newPhotoId, putPhoto, removePhoto } from '../lib/photoStore'
import {
  AXIS_GAP_PX,
  QUADRANT_META,
  UNIT,
  autoEventWidth,
  clampZoom,
  clampOrigin,
  quadrantOfWorldPoint,
  shouldClearDragOnPointerLeave,
  screenToWorldX,
  screenToWorldY,
  zoomAt,
  type ViewState
} from '../lib/quadrantMath'
import { useCanvasGestures, type GestureContext } from '../hooks/useCanvasGestures'
import { hasClipboardEvent, useAppStore } from '../state/appStore'

interface EditingState {
  mode: 'create' | 'edit'
  id?: string
  text: string
  quadrant: Quadrant
  x: number
  y: number
}

interface DragState {
  id: string
  /** 指针世界坐标 - 卡片左上角世界坐标：拖动时卡片不再跳位。 */
  grabOffsetX: number
  grabOffsetY: number
}

interface PreviewState {
  id: string
  x: number
  y: number
  quadrant: Quadrant
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
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewRef = useRef<PreviewState | null>(null)
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
  const lastPointerTypeRef = useRef<string>('mouse')
  const eventsRef = useRef<QuadrantEvent[]>(events)
  eventsRef.current = events

  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverQuadrant, setHoverQuadrant] = useState<Quadrant | null>(null)
  const [labelVisible, setLabelVisible] = useState(false)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<PreviewState | null>(null)
  const [tick, setTick] = useState(0)
  /** 已展开缩略图条的事件 id 集合（短按切换，可多个同时展开）。 */
  const [photosOpen, setPhotosOpen] = useState<Set<string>>(() => new Set())
  /** 图片查看器：{ 事件 id, 初始下标 }。 */
  const [viewer, setViewer] = useState<{ eventId: string; index: number } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** 正在为哪个事件加照片（文件选择器是异步的，须记住发起方）。 */
  const photoTargetRef = useRef<string | null>(null)

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

  const clearDragState = useCallback((): void => {
    panRef.current = null
    dragRef.current = null
    dragPreviewRef.current = null
    setDragPreview(null)
  }, [])

  const openEditById = useCallback((id: string): void => {
    const ev = eventsRef.current.find((e) => e.id === id)
    if (!ev) return
    setEditing({
      mode: 'edit',
      id: ev.id,
      text: ev.text,
      quadrant: ev.quadrant,
      x: ev.x,
      y: ev.y
    })
  }, [])

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
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const beginPinch = useCallback((): void => {
    const [a, b] = [...touchPointsRef.current.values()]
    if (!a || !b) return
    panRef.current = null
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: viewRef.current.zoom,
      view: viewRef.current
    }
  }, [])

  /** 平移画布：手势内核与"双指抬起一指后剩余手指继续平移"共用同一实现。 */
  const applyPan = useCallback(
    (clientX: number, clientY: number): void => {
      const pan = panRef.current
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!pan || !rect) return
      const next = clampOrigin(
        {
          ...pan.startView,
          panX: pan.startView.panX + (clientX - pan.startX),
          panY: pan.startView.panY + (clientY - pan.startY)
        },
        rect.width,
        rect.height
      )
      viewRef.current = next
      setView(next)
      const now = performance.now()
      const last = panLastRef.current
      if (last && now > last.t) {
        panVelRef.current = {
          x: (clientX - last.x) / (now - last.t),
          y: (clientY - last.y) / (now - last.t)
        }
      }
      panLastRef.current = { x: clientX, y: clientY, t: now }
    },
    [setView]
  )

  // 手势内核：位移 > 8px 才算拖动，长按满阈值抬起手指才开菜单，
  // 双击由自研判定给出（原生 dblclick 在触屏上不可靠）。
  const gestures = useCanvasGestures({
    resolveHit: (e) => {
      const target = e.target as Element | null
      const card = target?.closest('.event-card') as HTMLElement | null
      const id = card?.dataset.eventId
      if (!card || !id) return { kind: 'canvas' }
      // 鼠标沿用"把手拖动"，避免左键在卡面上误拖；触屏/笔整卡可拖（把手在触屏下隐藏）。
      if (e.pointerType === 'mouse' && !target?.closest('.event-handle')) return { kind: 'canvas' }
      return { kind: 'item', id }
    },
    onDragStart: (ctx: GestureContext) => {
      if (ctx.hit.kind === 'item') {
        const ev = eventsRef.current.find((e) => e.id === ctx.hit.id)
        const rect = viewportRef.current?.getBoundingClientRect()
        if (!ev || !rect) return
        const worldX = screenToWorldX(ctx.start.x - rect.left, viewRef.current)
        const worldY = screenToWorldY(ctx.start.y - rect.top, viewRef.current)
        dragRef.current = {
          id: ev.id,
          grabOffsetX: worldX - ev.x,
          grabOffsetY: worldY - ev.y
        }
        dragPreviewRef.current = { id: ev.id, x: ev.x, y: ev.y, quadrant: ev.quadrant }
        setDragPreview(dragPreviewRef.current)
        setSelectedId(ev.id)
        return
      }
      // 画布平移：触屏单指／笔直接平移；鼠标需中键或 Ctrl+左键（与既有桌面习惯一致）。
      const mousePan = ctx.pointerType === 'mouse' && (ctx.button === 1 || ctx.ctrlKey)
      if (ctx.pointerType === 'mouse' && !mousePan) return
      if (panAnimRef.current !== null) {
        cancelAnimationFrame(panAnimRef.current)
        panAnimRef.current = null
      }
      panRef.current = { startX: ctx.start.x, startY: ctx.start.y, startView: viewRef.current }
      panLastRef.current = { x: ctx.start.x, y: ctx.start.y, t: performance.now() }
      panVelRef.current = { x: 0, y: 0 }
    },
    onDragMove: (ctx: GestureContext) => {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      if (panRef.current) applyPan(ctx.current.x, ctx.current.y)
      const drag = dragRef.current
      if (drag) {
        const ev = eventsRef.current.find((e) => e.id === drag.id)
        if (ev) {
          // 拖动期间只更新预览，不写库；抓取偏移与中心判象限在 previewMove 内完成。
          const next = previewMove(
            ev,
            screenToWorldX(ctx.current.x - rect.left, viewRef.current),
            screenToWorldY(ctx.current.y - rect.top, viewRef.current),
            drag.grabOffsetX,
            drag.grabOffsetY,
            viewRef.current
          )
          const preview: PreviewState = {
            id: next.id,
            x: next.x,
            y: next.y,
            quadrant: next.quadrant
          }
          dragPreviewRef.current = preview
          setDragPreview(preview)
        }
      }
    },
    onDragEnd: () => {
      const wasPanning = panRef.current !== null
      panRef.current = null
      const drag = dragRef.current
      const preview = dragPreviewRef.current
      dragRef.current = null
      dragPreviewRef.current = null
      setDragPreview(null)
      if (drag && preview && preview.id === drag.id) {
        const ev = eventsRef.current.find((e) => e.id === drag.id)
        if (ev && (ev.x !== preview.x || ev.y !== preview.y || ev.quadrant !== preview.quadrant)) {
          // 只在抬起时提交一次，减少 95% 以上写入，并避免拖动过程中被实时同步回滚。
          moveEvent(drag.id, preview.x, preview.y, viewRef.current)
        }
      }
      if (wasPanning && Math.hypot(panVelRef.current.x, panVelRef.current.y) > 0.05) {
        startPanInertia()
      }
    },
    onLongPress: (ctx: GestureContext) => {
      // 桌面已有右键菜单，长按只在触屏/笔上作为菜单入口。
      if (ctx.pointerType === 'mouse') return
      if (ctx.hit.kind === 'item' && ctx.hit.id) {
        setSelectedId(ctx.hit.id)
        setMenu({ x: ctx.current.x, y: ctx.current.y, eventId: ctx.hit.id })
        return
      }
      const { x, y } = clientToViewport(ctx.current.x, ctx.current.y)
      setMenu({
        x: ctx.current.x,
        y: ctx.current.y,
        worldX: screenToWorldX(x, viewRef.current),
        worldY: screenToWorldY(y, viewRef.current)
      })
    },
    onTap: (ctx: GestureContext, isDouble: boolean) => {
      // 桌面沿用原生 click / dblclick，避免两条判定路径互相打架。
      if (ctx.pointerType === 'mouse') return
      if (ctx.hit.kind === 'item') {
        if (isDouble && ctx.hit.id) {
          openEditById(ctx.hit.id)
          return
        }
        // 短按**带照片**的事件块 → 展开/收起缩略图；无照片时保持原语义（仅选中）。
        // 这样不改变任何既有事件的短按行为，只有真的加了照片才多出一个动作。
        if (ctx.hit.id) {
          const target = eventsRef.current.find((e) => e.id === ctx.hit.id)
          if (target && (target.photos?.length ?? 0) > 0) {
            togglePhotos(ctx.hit.id)
            setSelectedId(ctx.hit.id)
          }
        }
        return
      }
      if (!isDouble) {
        setSelectedId(null)
        setMenu(null)
        return
      }
      const { x, y } = clientToViewport(ctx.current.x, ctx.current.y)
      const wx = screenToWorldX(x, viewRef.current)
      const wy = screenToWorldY(y, viewRef.current)
      setEditing({
        mode: 'create',
        text: '',
        quadrant: quadrantOfWorldPoint(wx, wy),
        x: wx,
        y: wy
      })
    },
    onCancel: clearDragState
  })

  const gesturesRef = useRef(gestures)
  gesturesRef.current = gestures

  // Esc 回滚正在进行的拖动（不提交）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (dragRef.current || panRef.current) gesturesRef.current.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onPointerDown = (e: React.PointerEvent): void => {
    lastPointerTypeRef.current = e.pointerType
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const points = touchPointsRef.current
      points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (points.size >= 2) {
        // 双指缩放接管：先取消单指手势，第二指不再进入手势内核。
        gestures.cancel()
        if (points.size === 2) beginPinch()
        return
      }
    }
    gestures.onPointerDown(e)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    hoverRef.current = { clientX: e.clientX, clientY: e.clientY }

    if (e.pointerType !== 'mouse') {
      const points = touchPointsRef.current
      if (points.has(e.pointerId)) points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (points.size >= 2 && pinchRef.current) {
        const [a, b] = [...points.values()]
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const next = zoomAt(
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top,
          pinchRef.current.zoom * (dist / pinchRef.current.distance),
          pinchRef.current.view
        )
        viewRef.current = next
        setView(next)
        return
      }
    }

    gestures.onPointerMove(e)
    // 双指缩放后只剩一指：手势内核里已无活动指针，由页面继续平移。
    if (!gestures.isActive() && panRef.current) applyPan(e.clientX, e.clientY)

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setHoverQuadrant(quadrantOfWorldPoint(screenToWorldX(x, viewRef.current), screenToWorldY(y, viewRef.current)))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (e.pointerType !== 'mouse') {
      const points = touchPointsRef.current
      points.delete(e.pointerId)
      if (points.size === 0) {
        pinchRef.current = null
        panRef.current = null
      } else if (points.size === 1) {
        // 双指抬起一指后，由剩下那一指重新开始平移。
        pinchRef.current = null
        const [point] = [...points.values()]
        panRef.current = { startX: point.x, startY: point.y, startView: viewRef.current }
        panLastRef.current = { x: point.x, y: point.y, t: performance.now() }
        panVelRef.current = { x: 0, y: 0 }
      }
    }
    gestures.onPointerUp(e)
  }

  const onPointerCancel = (e: React.PointerEvent): void => {
    touchPointsRef.current.delete(e.pointerId)
    pinchRef.current = null
    gestures.onPointerCancel(e)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    // 触屏双击走自研判定（见 gestures.onTap），这里只服务鼠标。
    if (lastPointerTypeRef.current !== 'mouse') return
    const target = e.target as Element | null
    const cardId = (target?.closest('.event-card') as HTMLElement | null)?.dataset.eventId
    if (cardId) {
      openEditById(cardId)
      return
    }
    const { x, y } = clientToViewport(e.clientX, e.clientY)
    const wx = screenToWorldX(x, viewRef.current)
    const wy = screenToWorldY(y, viewRef.current)
    setEditing({
      mode: 'create',
      text: '',
      quadrant: quadrantOfWorldPoint(wx, wy),
      x: wx,
      y: wy
    })
  }

  const onViewportContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const { x, y } = clientToViewport(e.clientX, e.clientY)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      worldX: screenToWorldX(x, viewRef.current),
      worldY: screenToWorldY(y, viewRef.current)
    })
  }

  const onEventContextMenu = (e: React.MouseEvent, event: QuadrantEvent): void => {
    setMenu({ x: e.clientX, y: e.clientY, eventId: event.id })
  }

  /**
   * 打开文件选择器。`accept="image/*"` 之外**不设 `capture`**——
   * 用户的照片既可能来自相册也可能来自当场拍摄，交给系统选择器决定。
   */
  const startAddPhoto = (eventId: string): void => {
    photoTargetRef.current = eventId
    const input = fileInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  /**
   * 处理选中的文件：压缩 → 存实体 → 把 id 挂到事件上。
   *
   * 顺序很关键：**先存实体再改事件**。反过来的话，若存实体失败，事件上就有了
   * 一个指向不存在照片的 id，渲染时是一块空白缩略图，且用户无从修复。
   */
  const onPickPhotos = async (fileList: FileList | null): Promise<void> => {
    const eventId = photoTargetRef.current
    photoTargetRef.current = null
    if (!eventId || !fileList || fileList.length === 0) return

    const event = eventsRef.current.find((e) => e.id === eventId)
    if (!event) return
    const existing = event.photos ?? []
    const room = MAX_EVENT_PHOTOS - existing.length
    if (room <= 0) return

    setPhotoBusy(true)
    const added: string[] = []
    try {
      // 多选时按剩余额度截断：宁可少加，也不要静默丢弃用户已经压好的图。
      for (const file of Array.from(fileList).slice(0, room)) {
        if (!file.type.startsWith('image/')) continue
        const { blob } = await compressPhoto(file)
        const id = newPhotoId()
        await putPhoto(id, blob)
        added.push(id)
      }
      if (added.length === 0) return
      const target = eventsRef.current.find((e) => e.id === eventId)
      if (!target) {
        // 压缩期间事件被删了：把刚存进去的实体回收掉，别留孤儿。
        await Promise.all(added.map((id) => removePhoto(id)))
        return
      }
      updateEvent(eventId, { photos: [...(target.photos ?? []), ...added] }, viewRef.current)
      // 加完直接展开，否则用户看不到刚加的照片，会以为没成功。
      setPhotosOpen((prev) => new Set(prev).add(eventId))
      setSelectedId(eventId)
    } catch {
      // 压缩/落盘失败时清掉半成品，保持"要么成功要么无事发生"。
      await Promise.all(added.map((id) => removePhoto(id)))
    } finally {
      setPhotoBusy(false)
    }
  }

  const removeEventPhoto = async (eventId: string, index: number): Promise<void> => {
    const event = eventsRef.current.find((e) => e.id === eventId)
    const photos = event?.photos ?? []
    const id = photos[index]
    if (!id) return
    updateEvent(eventId, { photos: photos.filter((_, i) => i !== index) }, viewRef.current)
    await removePhoto(id)
  }

  const togglePhotos = (eventId: string): void => {
    setPhotosOpen((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
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
  const viewerEvent = viewer ? events.find((e) => e.id === viewer.eventId) : undefined
  const overdue = (e: QuadrantEvent): boolean =>
    !!e.deadline && new Date(e.deadline).getTime() < Date.now()

  /** 该事件是否还能再加照片。未达上限才在菜单里显示「添加照片」。 */
  const canAddPhotoTo = (eventId?: string): boolean => {
    if (!eventId) return false
    const target = events.find((e) => e.id === eventId)
    if (!target) return false
    return (target.photos?.length ?? 0) < MAX_EVENT_PHOTOS
  }

  return (
    <div className="quadrant-page">
      <header className="page-header quadrant-header">
        <h1>四象限</h1>
        <span className="title-underline" />
        <span className="hint-pill desktop-only">🖱️ Ctrl+拖拽 平移 / 滚轮 缩放 / 双击新建</span>
        <span className="hint-pill mobile-only">👆 拖动移动 · 长按菜单 · 双击新建</span>
      </header>
      <div
        ref={viewportRef}
        className="quadrant-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => {
          hoverRef.current = null
          setHoverQuadrant(null)
          if (shouldClearDragOnPointerLeave(e.pointerType)) gestures.cancel()
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onViewportContextMenu}
      >
        <canvas ref={canvasRef} className="quadrant-canvas" />
        <div
          className="event-layer"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {events.map((e) => {
            if (editing?.id === e.id) return null
            const preview = dragPreview?.id === e.id ? dragPreview : null
            const shown = preview ? { ...e, x: preview.x, y: preview.y, quadrant: preview.quadrant } : e
            return (
              <EventCard
                key={e.id}
                event={shown}
                overdue={overdue(e)}
                selected={selectedId === e.id}
                armed={gestures.armedId === e.id}
                dragging={dragPreview?.id === e.id}
                photosOpen={photosOpen.has(e.id)}
                onSelect={() => setSelectedId(e.id)}
                onOpenPhoto={(index) => setViewer({ eventId: e.id, index })}
                onContextMenu={onEventContextMenu}
              />
            )
          })}
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
          canAddPhoto={canAddPhotoTo(menu.eventId)}
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
            if (action === 'photo' && menu.eventId) startAddPhoto(menu.eventId)
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
            // 事件连同照片一起删：先摘实体再删事件，避免照片文件成为孤儿。
            const target = events.find((e) => e.id === deletePendingId)
            const ids = target?.photos ?? []
            deleteEvent(deletePendingId)
            void Promise.all(ids.map((id) => removePhoto(id)))
            if (selectedId === deletePendingId) setSelectedId(null)
          }}
          onCancel={() => setDeletePendingId(null)}
        />
      )}
      {viewer && viewerEvent && (viewerEvent.photos?.length ?? 0) > 0 && (
        <ImageViewer
          photoIds={viewerEvent.photos ?? []}
          initialIndex={viewer.index}
          caption={viewerEvent.text}
          onClose={() => setViewer(null)}
        />
      )}
      {/*
        隐藏的文件选择器：常驻 DOM（而不是点菜单时才创建）。
        iOS 要求 `input.click()` 发生在用户手势的同一个任务里，
        动态挂载再点会被当成"非用户触发"而静默忽略。
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => void onPickPhotos(e.target.files)}
      />
      <span className="tick-sink">{tick}</span>
    </div>
  )
}
