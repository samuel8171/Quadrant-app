import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { EventGroup, Quadrant, QuadrantEvent } from '../../../shared/types'
import { MAX_EVENT_PHOTOS } from '../../../shared/types'
import { DEFAULT_MONEY_CONFIG, isEventBilledOn } from '../../../shared/money'
import { dateKey } from '../../../shared/dateKey'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu, { type ContextMenuState } from '../components/ContextMenu'
import EventCard from '../components/EventCard'
import EventDetailDialog from '../components/EventDetailDialog'
import QuadrantGroupDialog, { QuadrantChoices, QuadrantDialog } from '../components/QuadrantGroupDialog'
import QuadrantList from '../components/QuadrantList'
import ImageViewer from '../components/ImageViewer'
import QuadrantCostBubble from '../components/money/QuadrantCostBubble'
import { previewMove } from '../lib/eventRules'
import { quadrantEventRect, rectsOverlap } from '../lib/quadrantSync'
import { compressPhoto } from '../lib/photoCompress'
import { forgetPhotoUrl, newPhotoId, putPhoto, removePhoto } from '../lib/photoStore'
import { DOUBLE_TAP_MS } from '../lib/gestures'
import { MOTION_EASE, MOTION_SETTLE_MS } from '../lib/motion'
import {
  AXIS_GAP_PX,
  DEFAULT_WORLD_BOUNDS,
  EVENT_HEIGHT_UNITS,
  MAX_ZOOM,
  MIN_ZOOM,
  QUADRANT_META,
  QUADRANT_ORDER,
  UNIT,
  autoEventWidth,
  clampZoom,
  clampOrigin,
  clampEventToQuadrant,
  boundsForEvents,
  fitBounds,
  quadrantOfWorldPoint,
  shouldClearDragOnPointerLeave,
  screenToWorldX,
  screenToWorldY,
  worldToScreenX,
  worldToScreenY,
  zoomAt,
  type ViewState
} from '../lib/quadrantMath'
import { useCanvasGestures, type GestureContext } from '../hooks/useCanvasGestures'
import { hasClipboardEvent, useAppStore } from '../state/appStore'

const CANVAS_COLORS = {
  '--quadrant-one': QUADRANT_META[1].color,
  '--quadrant-two': QUADRANT_META[2].color,
  '--quadrant-three': QUADRANT_META[3].color,
  '--quadrant-four': QUADRANT_META[4].color
} as CSSProperties

const LIST_COLORS = {
  '--quadrant-one': '#F6A16B',
  '--quadrant-two': '#E7C875',
  '--quadrant-three': '#67CABE',
  '--quadrant-four': '#ADA0F5'
} as CSSProperties

const INNER_CORNER_RADIUS = 12
const CANVAS_RADII = {
  1: [0, 0, 0, INNER_CORNER_RADIUS],
  2: [0, 0, INNER_CORNER_RADIUS, 0],
  3: [0, INNER_CORNER_RADIUS, 0, 0],
  4: [INNER_CORNER_RADIUS, 0, 0, 0]
}

interface EditingState {
  mode: 'create' | 'edit'
  id?: string
  text: string
  quadrant: Quadrant
  x: number
  y: number
}

interface DragState {
  card: BoardCard
  /** 指针世界坐标 - 卡片左上角世界坐标：拖动时卡片不再跳位。 */
  grabOffsetX: number
  grabOffsetY: number
}

interface PreviewState {
  id: string
  x: number
  y: number
  quadrant: Quadrant
  floatingX: number
  floatingY: number
}

interface ViewportSize {
  width: number
  height: number
}

interface Camera {
  x: number
  y: number
  zoom: number
}

interface BoardCard {
  event: QuadrantEvent
  display: QuadrantEvent
  group?: EventGroup
  total: number
  local: number
}

interface GroupDrop {
  eventId: string
  targetId?: string
  targetGroupId?: string
  sourceQuadrant: Quadrant
  targetQuadrant: Quadrant
}

const CAMERA_STORAGE_KEY = 'quadrant-local-camera-v1'
const EMPTY_GROUPS: EventGroup[] = []
const GROUP_DWELL_MS = 400
const OVERVIEW_MARKER_ZOOM = 0.24

function directionToAnchor(card: QuadrantEvent, group: EventGroup): string {
  const dx = group.anchorX - card.x
  const dy = group.anchorY - card.y
  if (Math.abs(dx) > Math.abs(dy) * 2) return dx > 0 ? '→' : '←'
  if (Math.abs(dy) > Math.abs(dx) * 2) return dy > 0 ? '↑' : '↓'
  if (dy > 0) return dx > 0 ? '↗' : '↖'
  return dx > 0 ? '↘' : '↙'
}

function connectorPath(from: Pick<QuadrantEvent, 'x' | 'y' | 'width'>, to: Pick<QuadrantEvent, 'x' | 'y' | 'width'>): string | null {
  const start = { x: from.x + from.width / 2, y: from.y - EVENT_HEIGHT_UNITS / 2 }
  const end = { x: to.x + to.width / 2, y: to.y - EVENT_HEIGHT_UNITS / 2 }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const edge = (width: number): number => Math.min(
    (width / 2 + 0.15) / Math.abs(dx),
    (EVENT_HEIGHT_UNITS / 2 + 0.15) / Math.abs(dy)
  )
  const outset = edge(from.width)
  const inset = edge(to.width)
  if (outset + inset >= 1) return null
  return `M ${(start.x + dx * outset) * UNIT} ${-(start.y + dy * outset) * UNIT} L ${(end.x - dx * inset) * UNIT} ${-(end.y - dy * inset) * UNIT}`
}

function groupCards(events: QuadrantEvent[], groups: EventGroup[], revealedId: string | null): BoardCard[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const members = new Map<string, QuadrantEvent[]>()
  const cards: BoardCard[] = []
  for (const event of events) {
    if (!event.groupId || !groupsById.has(event.groupId)) {
      cards.push({ event, display: event, total: 1, local: 1 })
      continue
    }
    const existing = members.get(event.groupId) ?? []
    existing.push(event)
    members.set(event.groupId, existing)
  }
  for (const [id, all] of members) {
    const group = groupsById.get(id)!
    for (const quadrant of QUADRANT_ORDER) {
      const local = all.filter((event) => event.quadrant === quadrant)
      if (local.length === 0) continue
      const main = quadrant === group.anchorQuadrant
      const distance = (event: QuadrantEvent): number => Math.hypot(event.x - group.anchorX, event.y - group.anchorY)
      const representative = main
        ? local.reduce((closest, candidate) => distance(candidate) < distance(closest) ? candidate : closest)
        : local[0]
      const event = local.find((member) => member.id === revealedId) ?? representative
      const x = main ? group.anchorX : representative.x
      const y = main ? group.anchorY : representative.y
      const display = clampEventToQuadrant({ ...event, x, y }, { zoom: 1, panX: 0, panY: 0 })
      cards.push({ event, display, group, total: all.length, local: local.length })
    }
  }
  return cards
}

function worldCamera(view: ViewState, { width, height }: ViewportSize): Camera {
  return { x: screenToWorldX(width / 2, view), y: screenToWorldY(height / 2, view), zoom: view.zoom }
}

function centeredOn({ x, y, zoom }: Camera, { width, height }: ViewportSize): ViewState {
  return { zoom, panX: width / 2 - x * UNIT * zoom, panY: height / 2 + y * UNIT * zoom }
}

function readCamera(): Camera {
  try {
    const raw = window.localStorage.getItem(CAMERA_STORAGE_KEY)
    const saved: Partial<Camera> | null = raw ? JSON.parse(raw) : null
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number' && typeof saved.zoom === 'number' &&
        Number.isFinite(saved.x) && Number.isFinite(saved.y) && saved.zoom > 0 && saved.zoom <= MAX_ZOOM) {
      return { x: saved.x, y: saved.y, zoom: saved.zoom }
    }
  } catch { /* Browser storage can be unavailable. */ }
  return { x: 0, y: 0, zoom: 1 }
}

export default function QuadrantPage(): JSX.Element {
  const events = useAppStore((s) => s.data.events)
  const groups = useAppStore((s) => s.data.eventGroups ?? EMPTY_GROUPS)
  const savedBounds = useAppStore((s) => s.data.canvasBounds)
  const createEventGroupWithEvents = useAppStore((s) => s.createEventGroupWithEvents)
  const assignEventToGroup = useAppStore((s) => s.assignEventToGroup)
  const moveEventGroup = useAppStore((s) => s.moveEventGroup)
  const moveEventGroupAnchor = useAppStore((s) => s.moveEventGroupAnchor)
  const moveEventToQuadrant = useAppStore((s) => s.moveEventToQuadrant)
  const renameEventGroup = useAppStore((s) => s.renameEventGroup)
  const addEvent = useAppStore((s) => s.addEvent)
  const updateEvent = useAppStore((s) => s.updateEvent)
  const deleteEvent = useAppStore((s) => s.deleteEvent)
  const moveEvent = useAppStore((s) => s.moveEvent)
  const copyEvent = useAppStore((s) => s.copyEvent)
  const cutEvent = useAppStore((s) => s.cutEvent)
  const pasteEvent = useAppStore((s) => s.pasteEvent)
  const saveNow = useAppStore((s) => s.saveNow)
  const completeQuadrantEvent = useAppStore((s) => s.completeQuadrantEvent)
  const money = useAppStore((s) => s.data.money)
  /** 金钱系统是否开启 —— 关闭时「标记完成」入口必须整个消失（spec §4.3）。 */
  const moneyEnabled = money?.enabled === true

  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panRef = useRef<{ startX: number; startY: number; startView: ViewState } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragPreviewRef = useRef<PreviewState | null>(null)
  const hoverRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const viewRef = useRef<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const targetZoomRef = useRef(1)
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const zoomAnimRef = useRef<number | null>(null)
  const panAnimRef = useRef<number | null>(null)
  const panLastRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const panVelRef = useRef({ x: 0, y: 0 })
  const touchPointsRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; x: number; y: number; view: ViewState } | null>(null)
  const lastPointerTypeRef = useRef<string>('mouse')
  const eventsRef = useRef<QuadrantEvent[]>(events)
  eventsRef.current = events
  const anchorPositions = useMemo(() => groups.map((group) => ({
    x: group.anchorX, y: group.anchorY, width: 8
  })), [groups])
  const bounds = useMemo(() => boundsForEvents([...events, ...anchorPositions], savedBounds
    ? {
        minX: Math.min(DEFAULT_WORLD_BOUNDS.minX, savedBounds.minX),
        maxX: Math.max(DEFAULT_WORLD_BOUNDS.maxX, savedBounds.maxX),
        minY: Math.min(DEFAULT_WORLD_BOUNDS.minY, savedBounds.minY),
        maxY: Math.max(DEFAULT_WORLD_BOUNDS.maxY, savedBounds.maxY)
      }
    : DEFAULT_WORLD_BOUNDS), [events, anchorPositions, savedBounds])
  const overviewBounds = useMemo(() => {
    const items = [...events, ...anchorPositions]
    if (items.length === 0) return bounds
    const x = items[0].x
    return boundsForEvents(items, { ...bounds, minX: x, maxX: x })
  }, [events, anchorPositions, bounds])

  const [view, setView] = useState<ViewState>({ zoom: 1, panX: 0, panY: 0 })
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas')
  const [hasPreviousView, setHasPreviousView] = useState(false)
  const [isOverview, setIsOverview] = useState(false)
  const [groupDialogId, setGroupDialogId] = useState<string | null>(null)
  const [revealedMemberId, setRevealedMemberId] = useState<string | null>(null)
  const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null)
  const [crossGroup, setCrossGroup] = useState<GroupDrop | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [createDraft, setCreateDraft] = useState<{ quadrant: Quadrant; x: number; y: number; fromToolbar?: boolean } | null>(null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  /** 正在为哪个事件记一次用时（计费气泡的锚点）。null = 气泡不显示。 */
  const [billingId, setBillingId] = useState<string | null>(null)
  const [dragPreview, setDragPreview] = useState<PreviewState | null>(null)
  const [tick, setTick] = useState(0)
  /** 已展开缩略图条的事件 id 集合（短按切换，可多个同时展开）。 */
  const [photosOpen, setPhotosOpen] = useState<Set<string>>(() => new Set())
  /** 图片查看器：{ 事件 id, 初始下标 }。 */
  const [viewer, setViewer] = useState<{ eventId: string; index: number } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoFailedId, setPhotoFailedId] = useState<string | null>(null)
  const photoProcessingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** 正在为哪个事件加照片（文件选择器是异步的，须记住发起方）。 */
  const photoTargetRef = useRef<string | null>(null)
  /**
   * 鼠标单击中"开合缩略图条"的延迟定时器。
   *
   * 见 `onViewportClick` 的注释：必须等过双击窗口才能确认这次点击不是双击的开头。
   */
  const clickTimerRef = useRef<number | null>(null)
  const previousViewsRef = useRef<Array<{ camera: Camera; overview: boolean }>>([])
  const groupHoverTimerRef = useRef<number | null>(null)
  const groupCandidateRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const groupDropTargetRef = useRef<string | null>(null)
  const edgeFrameRef = useRef<number | null>(null)
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null)
  const groupTriggerRef = useRef<HTMLElement | null>(null)
  const crossTriggerRef = useRef<HTMLElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const sizeRef = useRef<ViewportSize>({ width: 0, height: 0 })
  const localCameraRef = useRef<Camera | null>(null)
  const lastDragEnd = useRef(0)
  const boardCards = useMemo(() => groupCards(events, groups, revealedMemberId), [events, groups, revealedMemberId])

  const applyView = useCallback((next: ViewState): void => {
    viewRef.current = next
    setView(next)
  }, [])

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => {
      const nextSize = { width: el.clientWidth, height: el.clientHeight }
      const oldSize = sizeRef.current
      const firstLayout = !localCameraRef.current
      if (firstLayout) localCameraRef.current = readCamera()
      sizeRef.current = nextSize
      setSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize)
      const proposed = isOverview
        ? fitBounds(overviewBounds, nextSize.width, nextSize.height, 26)
        : centeredOn(firstLayout ? localCameraRef.current! : worldCamera(viewRef.current, oldSize), nextSize)
      const next = clampOrigin(proposed, nextSize.width, nextSize.height, bounds)
      if (firstLayout || isOverview) targetZoomRef.current = next.zoom
      applyView(next)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [viewMode, isOverview, bounds, overviewBounds, applyView])

  useEffect(() => {
    if (size.width <= 0 || viewMode !== 'canvas') return
    localCameraRef.current = worldCamera(view, size)
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(localCameraRef.current)) } catch { /* Storage unavailable. */ }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [view, size, viewMode])

  const stopCameraMotion = useCallback((): void => {
    if (zoomAnimRef.current !== null) cancelAnimationFrame(zoomAnimRef.current)
    if (panAnimRef.current !== null) cancelAnimationFrame(panAnimRef.current)
    zoomAnimRef.current = null
    panAnimRef.current = null
    targetZoomRef.current = viewRef.current.zoom
  }, [])

  const startZoomAnim = useCallback(() => {
    if (zoomAnimRef.current !== null) return
    const zoomFrame = (nextZoom: number): void => {
      const current = viewRef.current
      const anchor = zoomAnchorRef.current
      const next = anchor ? zoomAt(anchor.x, anchor.y, nextZoom, current) : { ...current, zoom: nextZoom }
      const { width, height } = sizeRef.current
      applyView(clampOrigin(next, width, height, bounds))
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      zoomFrame(targetZoomRef.current)
      return
    }
    const step = (): void => {
      const target = targetZoomRef.current
      const difference = target - viewRef.current.zoom
      const settled = Math.abs(difference) < target * 0.001
      zoomFrame(settled ? target : viewRef.current.zoom + difference * 0.22)
      if (!settled) {
        zoomAnimRef.current = requestAnimationFrame(step)
      } else {
        zoomAnimRef.current = null
      }
    }
    zoomAnimRef.current = requestAnimationFrame(step)
  }, [applyView, bounds])

  const startPanInertia = useCallback(() => {
    if (panAnimRef.current !== null) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let last = performance.now()
    const step = (now: number): void => {
      const dt = Math.min(64, now - last)
      last = now
      const el = viewportRef.current
      const current = viewRef.current
      if (el && dt > 0) {
        const v = panVelRef.current
        const next = clampOrigin(
          { ...current, panX: current.panX + v.x * dt, panY: current.panY + v.y * dt },
          el.clientWidth,
          el.clientHeight,
          bounds
        )
        applyView(next)
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
  }, [applyView, bounds])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (dragRef.current) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - el.clientLeft
      const y = e.clientY - rect.top - el.clientTop
      const delta = Math.abs(e.deltaY)
      const steps = Math.min(4, Math.max(0.25, delta / 100))
      const factor = e.deltaY < 0 ? Math.pow(1.12, steps) : Math.pow(1 / 1.12, steps)
      if (panAnimRef.current !== null) stopCameraMotion()
      setIsOverview(false)
      const minimum = Math.min(MIN_ZOOM, viewRef.current.zoom, fitBounds(overviewBounds, el.clientWidth, el.clientHeight, 26).zoom)
      targetZoomRef.current = clampZoom(targetZoomRef.current * factor, minimum)
      zoomAnchorRef.current = { x, y }
      startZoomAnim()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewMode, overviewBounds, startZoomAnim, stopCameraMotion])

  useEffect(() => {
    return () => {
      stopCameraMotion()
      if (groupHoverTimerRef.current !== null) window.clearTimeout(groupHoverTimerRef.current)
      if (edgeFrameRef.current !== null) cancelAnimationFrame(edgeFrameRef.current)
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
      if (localCameraRef.current) {
        try { window.localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(localCameraRef.current)) } catch { /* Storage unavailable. */ }
      }
    }
  }, [stopCameraMotion])

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 左键点击菜单外任意位置时收起右键菜单。
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      /*
       * 判据是玻璃的**定位层** `.gs-layer--menu`，不再是 `.context-menu`。
       * 菜单玻璃化后 `.context-menu` 这个类已经不存在了——继续用它会让
       * 这条守卫恒不命中，于是**在菜单项上按下指针也会立刻收起菜单**，
       * 而 click 要等 pointerup 才派发，等反应过来元素已经卸载，
       * 整个菜单变成了"看得见、点不动"。
       * closest 沿祖先链上溯，落在定位层即可命中。
       */
      if (target && target.closest('.gs-layer--menu')) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menu])

  const clearGroupTarget = useCallback((): void => {
    if (groupHoverTimerRef.current !== null) window.clearTimeout(groupHoverTimerRef.current)
    groupHoverTimerRef.current = null
    groupCandidateRef.current = null
    groupDropTargetRef.current = null
    setGroupDropTargetId(null)
  }, [])

  const clearDragState = useCallback((): void => {
    clearGroupTarget()
    if (edgeFrameRef.current !== null) cancelAnimationFrame(edgeFrameRef.current)
    edgeFrameRef.current = null
    dragPointerRef.current = null
    panRef.current = null
    dragRef.current = null
    dragPreviewRef.current = null
    setDragPreview(null)
  }, [clearGroupTarget])

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
    const pixelWidth = Math.round(size.width * dpr)
    const pixelHeight = Math.round(size.height * dpr)
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const drawingBounds = dragPreview ? boundsForEvents([
      { x: dragPreview.x, y: dragPreview.y, width: dragRef.current?.card.display.width ?? 6 }
    ], bounds) : bounds
    const left = worldToScreenX(drawingBounds.minX, view)
    const right = worldToScreenX(drawingBounds.maxX, view)
    const top = worldToScreenY(drawingBounds.maxY, view)
    const bottom = worldToScreenY(drawingBounds.minY, view)
    const gap = Math.min(AXIS_GAP_PX * view.zoom, AXIS_GAP_PX)
    ctx.lineWidth = 1.5
    for (const q of QUADRANT_ORDER) {
      const { color, corner } = QUADRANT_META[q]
      const west = corner.endsWith('left')
      const north = corner.startsWith('top')
      const x0 = Math.max(0, west ? left : view.panX + gap)
      const x1 = Math.min(size.width, west ? view.panX - gap : right)
      const y0 = Math.max(0, north ? top : view.panY + gap)
      const y1 = Math.min(size.height, north ? view.panY - gap : bottom)
      if (x1 <= x0 || y1 <= y0) continue
      const innerCornerVisible = (west ? x1 < size.width : x0 > 0) && (north ? y1 < size.height : y0 > 0)
      ctx.beginPath()
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, innerCornerVisible ? CANVAS_RADII[q] : 0)
      ctx.fillStyle = color + '2B'
      ctx.fill()
      ctx.strokeStyle = color + 'E6'
      ctx.stroke()
    }

    const { panX, panY } = view
    const east = Math.min(right, size.width)
    const north = Math.max(top, 0)
    ctx.strokeStyle = '#555555'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(left, panY)
    ctx.lineTo(east, panY)
    ctx.moveTo(panX, north)
    ctx.lineTo(panX, bottom)
    ctx.stroke()

    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.moveTo(east - 8, panY - 4)
    ctx.lineTo(east - 1, panY)
    ctx.lineTo(east - 8, panY + 4)
    ctx.closePath()
    ctx.moveTo(panX - 4, north + 8)
    ctx.lineTo(panX, north + 1)
    ctx.lineTo(panX + 4, north + 8)
    ctx.closePath()
    ctx.fill()
  }, [view, size, bounds, dragPreview])

  useEffect(() => {
    draw()
  }, [draw])

  const clientToViewport = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = viewportRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return { x: clientX - rect.left - el.clientLeft, y: clientY - rect.top - el.clientTop }
  }

  const beginPinch = (): void => {
    const [a, b] = [...touchPointsRef.current.values()]
    if (!a || !b) return
    const midpoint = clientToViewport((a.x + b.x) / 2, (a.y + b.y) / 2)
    setIsOverview(false)
    panRef.current = null
    pinchRef.current = {
      ...midpoint,
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      view: viewRef.current
    }
  }

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
        rect.height,
        bounds
      )
      applyView(next)
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
    [applyView, bounds]
  )

  const dragTargetAt = (x: number, y: number, source: BoardCard): string | null => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('.event-card[data-event-id]')
    const id = target?.dataset.eventId
    if (!target || !id || id === source.event.id || (source.group && target.dataset.groupId === source.group.id)) return null
    const box = target.getBoundingClientRect()
    if (Math.abs(x - (box.left + box.right) / 2) > box.width * 0.3 ||
        Math.abs(y - (box.top + box.bottom) / 2) > box.height * 0.32) return null
    return id
  }

  const settleGroupTarget = (id: string | null, x: number, y: number): void => {
    const candidate = groupCandidateRef.current
    if (id && candidate?.id === id && (groupDropTargetRef.current === id || Math.hypot(x - candidate.x, y - candidate.y) < 8)) return
    if (candidate) clearGroupTarget()
    if (!id) return
    groupCandidateRef.current = { id, x, y }
    groupHoverTimerRef.current = window.setTimeout(() => {
      groupHoverTimerRef.current = null
      groupDropTargetRef.current = id
      setGroupDropTargetId(id)
    }, GROUP_DWELL_MS)
  }

  const updateDragAt = (drag: DragState, clientX: number, clientY: number): void => {
    const local = clientToViewport(clientX, clientY)
    const currentView = viewRef.current
    const x = screenToWorldX(local.x, currentView)
    const y = screenToWorldY(local.y, currentView)
    const next = previewMove(drag.card.display, x, y, drag.grabOffsetX, drag.grabOffsetY, currentView)
    const preview = {
      id: next.id, quadrant: next.quadrant, x: next.x, y: next.y,
      floatingX: x - drag.grabOffsetX, floatingY: y - drag.grabOffsetY
    }
    dragPreviewRef.current = preview
    setDragPreview(preview)
    const { group, event } = drag.card
    if (group?.anchorQuadrant === event.quadrant) return
    settleGroupTarget(dragTargetAt(clientX, clientY, drag.card), clientX, clientY)
  }

  // While a card is held at the visible edge, pan the camera and extend the drop preview.
  const queueEdgePan = (): void => {
    if (edgeFrameRef.current !== null) return
    let lastTime = performance.now()
    const step = (now: number): void => {
      edgeFrameRef.current = null
      const drag = dragRef.current
      const pointer = dragPointerRef.current
      if (!drag || !pointer || document.hidden) return
      const { x, y } = clientToViewport(pointer.x, pointer.y)
      const { width, height } = sizeRef.current
      if (x < 0 || y < 0 || x > width || y > height) return
      const edge = 28
      const speed = (position: number, span: number): number =>
        (Math.max(0, edge - position) - Math.max(0, edge - (span - position))) * 0.38
      const vx = speed(x, width)
      const vy = speed(y, height)
      if (vx === 0 && vy === 0) return
      const frames = Math.min(32, Math.max(0, now - lastTime)) / (1000 / 60)
      lastTime = now
      const current = viewRef.current
      applyView({ ...current, panX: current.panX + vx * frames, panY: current.panY + vy * frames })
      updateDragAt(drag, pointer.x, pointer.y)
      edgeFrameRef.current = requestAnimationFrame(step)
    }
    edgeFrameRef.current = requestAnimationFrame(step)
  }

  const animatePlacement = (preview: PreviewState): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const dx = (preview.floatingX - preview.x) * UNIT
    const dy = (preview.y - preview.floatingY) * UNIT
    if (Math.abs(dx) + Math.abs(dy) < 1) return
    requestAnimationFrame(() => {
      const card = viewportRef.current?.querySelector(`.event-card[data-event-id="${CSS.escape(preview.id)}"]`)
      card?.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: MOTION_SETTLE_MS, easing: MOTION_EASE
      })
    })
  }

  // 手势内核：位移 > 8px 才算拖动，长按满阈值抬起手指才开菜单，
  // 双击由自研判定给出（原生 dblclick 在触屏上不可靠）。
  const gestures = useCanvasGestures({
    /*
     * 四象限画布**不走长按解锁**。
     *
     * `requiresLongPress` 默认是 true，为时间轴那种"拖动与滚动争抢同一个手指动作"
     * 的容器准备。画布没有滚动，长按闸门只会让"单指平移"变成必须"先按住 380ms
     * 再动"——没人能猜到，且在此之前 `panRef` 根本不会被设置，等于单指平移
     * 完全不可用（只能双指缩放）。关掉它，单指位移直接平移画布。
     */
    requiresLongPress: false,
    resolveHit: (e) => {
      const target = e.target as Element | null
      const card = target?.closest('.event-card') as HTMLElement | null
      const id = card?.dataset.eventId
      if (!card || !id) return { kind: 'canvas' }
      return { kind: 'item', id }
    },
    onDragStart: (ctx: GestureContext) => {
      if (ctx.hit.kind === 'item') {
        const card = boardCards.find((item) => item.event.id === ctx.hit.id)
        if (!card) return
        const start = clientToViewport(ctx.start.x, ctx.start.y)
        const worldX = screenToWorldX(start.x, viewRef.current)
        const worldY = screenToWorldY(start.y, viewRef.current)
        const drag = {
          card,
          grabOffsetX: worldX - card.display.x,
          grabOffsetY: worldY - card.display.y
        }
        dragRef.current = drag
        dragPointerRef.current = ctx.current
        setIsOverview(false)
        setSelectedId(card.event.id)
        updateDragAt(drag, ctx.current.x, ctx.current.y)
        queueEdgePan()
        return
      }
      // 画布平移：触屏单指／笔直接平移；鼠标需中键或 Ctrl+左键（与既有桌面习惯一致）。
      const mousePan = ctx.pointerType === 'mouse' && (ctx.button === 1 || ctx.ctrlKey)
      if (ctx.pointerType === 'mouse' && !mousePan) return
      setIsOverview(false)
      stopCameraMotion()
      panRef.current = { startX: ctx.start.x, startY: ctx.start.y, startView: viewRef.current }
      panLastRef.current = { x: ctx.start.x, y: ctx.start.y, t: performance.now() }
      panVelRef.current = { x: 0, y: 0 }
    },
    onDragMove: (ctx: GestureContext) => {
      if (panRef.current) applyPan(ctx.current.x, ctx.current.y)
      const drag = dragRef.current
      if (!drag) return
      dragPointerRef.current = ctx.current
      updateDragAt(drag, ctx.current.x, ctx.current.y)
      queueEdgePan()
    },
    onDragEnd: (ctx: GestureContext) => {
      const wasPanning = panRef.current !== null
      const drag = dragRef.current
      if (drag) updateDragAt(drag, ctx.current.x, ctx.current.y)
      const preview = dragPreviewRef.current
      const targetId = groupDropTargetRef.current
      clearDragState()
      lastDragEnd.current = performance.now()
      if (wasPanning && Math.hypot(panVelRef.current.x, panVelRef.current.y) > 0.05) {
        startPanInertia()
      }
      if (!drag || !preview) return
      const { event, group, display } = drag.card
      const current = eventsRef.current.find((item) => item.id === event.id)
      if (!current || current.groupId !== event.groupId || current.quadrant !== event.quadrant) return
      const targetCard = boardCards.find((item) => item.event.id === targetId)
      if (targetCard) {
        handleGroupDrop(current, targetCard.display)
      } else if (group && group.anchorQuadrant === event.quadrant) {
        if (preview.quadrant === event.quadrant) {
          moveEventGroupAnchor(group.id, preview.x, preview.y)
        } else {
          moveEventGroup(event.id, preview.quadrant, preview.x - display.x, preview.y - display.y, preview)
        }
        animatePlacement(preview)
      } else if (preview.x !== display.x || preview.y !== display.y || preview.quadrant !== event.quadrant) {
        moveEvent(event.id, preview.x, preview.y, viewRef.current)
        setRevealedMemberId(event.id)
        animatePlacement(preview)
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
      /*
       * 桌面（鼠标）不走这条路径，改由原生 click / dblclick 处理——
       * 两条判定路径同时生效会互相打架（同一个动作被处理两次）。
       */
      if (ctx.pointerType === 'mouse') return
      if (ctx.hit.kind === 'item') {
        const card = boardCards.find((item) => item.event.id === ctx.hit.id)
        if (card?.group) {
          openGroup(card.group.id, canvasCardElement(card.event.id))
          return
        }
        if (isDouble && card) {
          openEditById(card.event.id)
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
      openInlineCreate(ctx.current.x, ctx.current.y)
    },
    onCancel: () => {
      if (dragRef.current) {
        const { width, height } = sizeRef.current
        applyView(clampOrigin(viewRef.current, width, height, bounds))
        lastDragEnd.current = performance.now()
      }
      clearDragState()
    }
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
    if ((e.target as Element).closest('input, button, .event-photos')) return
    lastDragEnd.current = 0
    stopCameraMotion()
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
    if (!viewportRef.current) return
    hoverRef.current = { clientX: e.clientX, clientY: e.clientY }

    if (e.pointerType !== 'mouse') {
      const points = touchPointsRef.current
      if (points.has(e.pointerId)) points.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const pinch = pinchRef.current
      if (points.size >= 2 && pinch) {
        const [a, b] = [...points.values()]
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const midpoint = clientToViewport((a.x + b.x) / 2, (a.y + b.y) / 2)
        const zoomed = zoomAt(pinch.x, pinch.y, pinch.view.zoom * dist / pinch.distance, pinch.view)
        const { width, height } = sizeRef.current
        applyView(clampOrigin({
          ...zoomed, panX: zoomed.panX + midpoint.x - pinch.x, panY: zoomed.panY + midpoint.y - pinch.y
        }, width, height, bounds))
        targetZoomRef.current = viewRef.current.zoom
        return
      }
    }

    gestures.onPointerMove(e)
    // 双指缩放后只剩一指：手势内核里已无活动指针，由页面继续平移。
    if (!gestures.isActive() && panRef.current) applyPan(e.clientX, e.clientY)

  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (e.pointerType !== 'mouse') {
      const points = touchPointsRef.current
      points.delete(e.pointerId)
      if (points.size === 0) {
        pinchRef.current = null
        if (!gestures.isActive()) panRef.current = null
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
    if (!gestures.isActive()) clearDragState()
    gestures.onPointerCancel(e)
  }

  /**
   * 鼠标单击：**带照片的事件块 → 展开/收起缩略图条**。
   *
   * 触屏路径在 `gestures.onTap` 里已经处理了这件事，鼠标此前完全没有——
   * 桌面靠原生 `click`，而这里原先只绑了 `dblclick`，于是"点击事件块照片展开"
   * 在电脑版上从来没生效过（用户报告的第一条）。
   *
   * 单击空白处仍然只是取消选中，保持既有语义。缩略图条自己的点击已在
   * `EventCard` 里 `stopPropagation`，不会走到这里被当成"点卡片"而反复开合。
   */
  const onViewportClick = (e: React.MouseEvent): void => {
    if (lastPointerTypeRef.current !== 'mouse') return
    if (lastDragEnd.current && performance.now() - lastDragEnd.current < 250) return
    const target = e.target as Element | null
    const card = target?.closest('.event-card') as HTMLElement | null
    const id = card?.dataset.eventId
    if (!card || !id) return
    // 缩略图条里点单张图是"打开大图"，不是"开合缩略图条"。
    if (target?.closest('.event-photos')) return
    const ev = eventsRef.current.find((item) => item.id === id)
    if (ev?.groupId) {
      openGroup(ev.groupId, card)
      return
    }
    if (!ev || (ev.photos?.length ?? 0) === 0) return
    /*
     * **延迟到双击窗口之后再执行**。
     *
     * 原生双击的事件序列是 `click → click → dblclick`。若在这里同步开合，
     * 双击一个带照片的块会先开合两次（视觉上等于没变）再弹出编辑框，
     * 用户看到的是"双击时缩略图闪了一下"。把单击动作压在 `DOUBLE_TAP_MS`
     * 之后，`dblclick` 一到就取消它——单击与双击各自只产生一个效果。
     */
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      togglePhotos(id)
      setSelectedId(id)
    }, DOUBLE_TAP_MS)
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    // 触屏双击走自研判定（见 gestures.onTap），这里只服务鼠标。
    if (lastPointerTypeRef.current !== 'mouse') return
    // 取消上面那次被延迟的单击动作，避免"开合 + 编辑"同时发生。
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    const target = e.target as Element | null
    if (target?.closest('button, input, .event-photos')) return
    const cardId = (target?.closest('.event-card') as HTMLElement | null)?.dataset.eventId
    if (cardId) {
      if (eventsRef.current.find((event) => event.id === cardId)?.groupId) return
      openEditById(cardId)
      return
    }
    openInlineCreate(e.clientX, e.clientY)
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
    const input = fileInputRef.current
    if (!input || photoProcessingRef.current) return
    photoTargetRef.current = eventId
    setPhotoFailedId(null)
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
    if (!eventId || !fileList || fileList.length === 0 || photoProcessingRef.current) return

    const event = eventsRef.current.find((e) => e.id === eventId)
    if (!event) return
    const existing = event.photos ?? []
    const room = MAX_EVENT_PHOTOS - existing.length
    if (room <= 0) return

    photoProcessingRef.current = true
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
      if (added.length === 0) {
        setPhotoFailedId(eventId)
        return
      }
      const target = useAppStore.getState().data.events.find((e) => e.id === eventId)
      if (!target) {
        // 压缩期间事件被删了：把刚存进去的实体回收掉，别留孤儿。
        await Promise.all(added.map((id) => removePhoto(id)))
        return
      }
      const latest = target.photos ?? []
      const available = Math.max(0, MAX_EVENT_PHOTOS - latest.length)
      const accepted = added.slice(0, available)
      if (accepted.length > 0) {
        updateEvent(eventId, { photos: [...latest, ...accepted] }, viewRef.current)
        setPhotosOpen((prev) => new Set(prev).add(eventId))
        setSelectedId(eventId)
      }
      await Promise.all(added.slice(available).map((id) => removePhoto(id)))
    } catch {
      // 压缩/落盘失败时清掉半成品，保持"要么成功要么无事发生"。
      await Promise.all(added.map((id) => removePhoto(id)))
      setPhotoFailedId(eventId)
    } finally {
      photoProcessingRef.current = false
      setPhotoBusy(false)
    }
  }

  /**
   * 删除事件上指定的照片。
   *
   * 三件事必须一起做，漏一件就出问题：
   * ① 事件上的 id 摘掉（并触发同步）；
   * ② 实体删掉（本地 + 云端，见 `photoStore.removePhoto`）；
   * ③ **object URL 缓存摘掉**（`forgetPhotoUrl`）。第 ③ 步容易漏：即便缩略图
   *    组件已经 unmount，缓存里那条 URL 仍指向已删掉的 blob；更糟的是若用户
   *    正好开着大图查看器看的就是这张，`viewer.index` 会越界指向空槽。
   */
  const removeEventPhoto = async (eventId: string, id: string): Promise<void> => {
    const event = useAppStore.getState().data.events.find((e) => e.id === eventId)
    const photos = event?.photos ?? []
    if (!photos.includes(id)) return
    const remaining = photos.filter((photoId) => photoId !== id)
    updateEvent(eventId, { photos: remaining.length > 0 ? remaining : undefined }, viewRef.current)
    forgetPhotoUrl(id)
    await removePhoto(id)

    // 查看器正开着这条事件：把下标夹回有效范围；一张不剩就关掉它
    // （否则查看器里会显示"图片不可用"，而用户其实刚把它删了）。
    setViewer((prev) => {
      if (!prev || prev.eventId !== eventId) return prev
      if (remaining.length === 0) return null
      return { ...prev, index: Math.min(prev.index, remaining.length - 1) }
    })
  }

  const togglePhotos = (eventId: string): void => {
    setPhotosOpen((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  const commitEditing = (value: string): void => {
    if (!editing) return
    const text = value.trim()
    if (editing.mode === 'create') {
      if (text) addEvent(text, editing.quadrant, editing.x, editing.y, view)
    } else if (editing.id && text) {
      updateEvent(editing.id, { text, width: autoEventWidth(text) }, view)
    }
    setEditing(null)
  }

  const detailEvent = detailId ? events.find((e) => e.id === detailId) : undefined
  const viewerEvent = viewer ? events.find((e) => e.id === viewer.eventId) : undefined
  /*
   * 计费气泡的时钟。象限事件完成是实时的，当前时刻是全系统唯一能实时判定深夜的场合
   * （spec 6.3）。页面每 60s 由 `tick` 重渲染一次，这个值随之刷新；确认时把它**原样**
   * 交给 store，于是「气泡预览」与「账本落账」读的是同一个数字。
   */
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const today = dateKey(now)
  const billingEvent = billingId ? events.find((e) => e.id === billingId) : undefined
  const billingAlreadyDone =
    billingEvent && money ? isEventBilledOn(money.days, today, billingEvent.id) : false
  const overdue = (e: QuadrantEvent): boolean =>
    !!e.deadline && new Date(e.deadline).getTime() < Date.now()

  /** 该事件是否还能再加照片。未达上限才在菜单里显示「添加照片」。 */
  const canAddPhotoTo = (eventId?: string): boolean => {
    if (!eventId || photoBusy) return false
    const target = events.find((e) => e.id === eventId)
    if (!target) return false
    return (target.photos?.length ?? 0) < MAX_EVENT_PHOTOS
  }

  const fitAll = (): void => {
    if (!viewportRef.current || isOverview) return
    rememberView()
    stopCameraMotion()
    setIsOverview(true)
  }

  const rememberView = (): void => {
    if (sizeRef.current.width <= 0) return
    previousViewsRef.current = [...previousViewsRef.current.slice(-7), {
      camera: worldCamera(viewRef.current, sizeRef.current), overview: isOverview
    }]
    setHasPreviousView(true)
  }

  const setCamera = (camera: Camera): void => {
    stopCameraMotion()
    const rect = sizeRef.current
    const next = clampOrigin(centeredOn(camera, rect), rect.width, rect.height, bounds)
    targetZoomRef.current = next.zoom
    applyView(next)
    setViewMode('canvas')
  }

  const returnToPreviousView = (): void => {
    const previous = previousViewsRef.current.pop()
    if (!previous) return
    setHasPreviousView(previousViewsRef.current.length > 0)
    setCamera(previous.camera)
    setIsOverview(previous.overview)
  }

  const locateEvent = (event: QuadrantEvent): void => {
    const position = boardCards.find((card) => card.event.id === event.id ||
      (event.groupId && card.event.groupId === event.groupId && card.event.quadrant === event.quadrant))?.display ?? event
    rememberView()
    setIsOverview(false)
    setCamera({
      x: position.x + position.width / 2,
      y: position.y - EVENT_HEIGHT_UNITS / 2,
      zoom: Math.max(viewRef.current.zoom, 0.8)
    })
    setRevealedMemberId(event.id)
    setSelectedId(event.id)
    requestAnimationFrame(() => canvasCardElement(event.id)?.focus({ preventScroll: true }))
  }

  const openCreate = (): void => {
    const { x, y } = worldCamera(viewRef.current, sizeRef.current)
    setCreateDraft({ quadrant: quadrantOfWorldPoint(x, y), x, y, fromToolbar: true })
  }

  const saveCreate = (text: string, quadrant: Quadrant): void => {
    if (!createDraft) return
    const { x, y } = createDraft
    if (!createDraft.fromToolbar) {
      addEvent(text, quadrant, x, y, viewRef.current)
      return
    }
    const width = autoEventWidth(text)
    const proposed = clampEventToQuadrant({
      id: '', text, quadrant, x: x - width / 2, y, width, createdAt: '', remark: ''
    }, viewRef.current)
    const occupied = boardCards.filter((card) => card.event.quadrant === quadrant).map((card) => quadrantEventRect(card.display))
    const dy = quadrant === 1 || quadrant === 2 ? 2.3 : -2.3
    for (let step = 0; occupied.some((rect) => rectsOverlap(rect, quadrantEventRect(proposed))) && step <= occupied.length; step++) {
      proposed.y += dy
    }
    addEvent(text, quadrant, proposed.x, proposed.y, viewRef.current)
  }

  const closeCreate = (): void => {
    setCreateDraft(null)
    requestAnimationFrame(() => addButtonRef.current?.focus({ preventScroll: true }))
  }

  const openInlineCreate = (clientX: number, clientY: number): void => {
    const local = clientToViewport(clientX, clientY)
    const x = screenToWorldX(local.x, viewRef.current)
    const y = screenToWorldY(local.y, viewRef.current)
    const draft = { x, y, quadrant: quadrantOfWorldPoint(x, y) }
    if (viewRef.current.zoom < 0.45) setCreateDraft(draft)
    else setEditing({ mode: 'create', text: '', ...draft })
  }

  const groupMembers = (groupId: string): QuadrantEvent[] => events.filter((e) => e.groupId === groupId)
  const canvasCardElement = (id: string): HTMLElement | null =>
    viewportRef.current?.querySelector(`.event-card[data-event-id="${CSS.escape(id)}"]`) ?? null

  const openGroup = (groupId: string, target?: HTMLElement | null): void => {
    groupTriggerRef.current = target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setGroupDialogId(groupId)
  }

  const vacantAnchors = groups.filter((group) => !boardCards.some((card) =>
    card.group?.id === group.id && card.event.quadrant === group.anchorQuadrant))
  const selectedGroup = groups.find((group) => group.id === events.find((event) => event.id === selectedId)?.groupId)
  const openedGroup = groups.find((group) => group.id === groupDialogId)
  const openedMembers = openedGroup ? groupMembers(openedGroup.id) : []
  const pendingEvent = events.find((event) => event.id === crossGroup?.eventId)
  const pendingTarget = events.find((event) => event.id === crossGroup?.targetId)
  const pendingGroup = groups.find((group) => group.id === crossGroup?.targetGroupId)

  const closeGroupDialog = (): void => {
    setGroupDialogId(null)
    const groupId = groupDialogId
    requestAnimationFrame(() => {
      const previous = groupTriggerRef.current
      const fallback = groupId && document.querySelector<HTMLElement>(
        `[data-group-id="${CSS.escape(groupId)}"] button, button[data-group-id="${CSS.escape(groupId)}"]`
      )
      const trigger = previous?.isConnected ? previous : fallback || addButtonRef.current
      trigger?.focus({ preventScroll: true })
    })
  }

  const closeCrossGroup = (): void => {
    setCrossGroup(null)
    if (openedGroup) return
    const trigger = crossTriggerRef.current
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
      else addButtonRef.current?.focus({ preventScroll: true })
    })
  }

  const finishCrossGroup = (moveToGroupQuadrant: boolean): void => {
    if (!crossGroup || !pendingEvent) return closeCrossGroup()
    // A sync update can move either card while confirmation is open.
    const validTarget = crossGroup.targetId
      ? pendingTarget?.quadrant === crossGroup.targetQuadrant && pendingTarget.groupId === crossGroup.targetGroupId
      : pendingGroup?.anchorQuadrant === crossGroup.targetQuadrant
    if (!validTarget || pendingEvent.quadrant !== crossGroup.sourceQuadrant) return closeCrossGroup()
    const destination = moveToGroupQuadrant ? crossGroup.targetQuadrant : undefined
    if (pendingGroup) {
      const point = pendingGroup.anchorQuadrant === crossGroup.targetQuadrant
        ? { x: pendingGroup.anchorX, y: pendingGroup.anchorY }
        : pendingTarget
      assignEventToGroup(pendingEvent.id, pendingGroup.id, destination, point)
    } else if (pendingTarget) {
      createEventGroupWithEvents({
        name: pendingTarget.text, anchorQuadrant: pendingTarget.quadrant,
        anchorX: pendingTarget.x, anchorY: pendingTarget.y
      }, [pendingTarget.id, pendingEvent.id], destination ? pendingEvent.id : undefined, destination)
    }
    closeCrossGroup()
  }

  const handleGroupDrop = (event: QuadrantEvent, target: QuadrantEvent): void => {
    if (event.groupId && event.groupId === target.groupId) return
    if (event.quadrant !== target.quadrant) {
      crossTriggerRef.current = canvasCardElement(event.id) ?? document.activeElement as HTMLElement | null
      setCrossGroup({
        eventId: event.id, targetId: target.id, targetGroupId: target.groupId,
        sourceQuadrant: event.quadrant, targetQuadrant: target.quadrant
      })
      return
    }
    if (target.groupId) assignEventToGroup(event.id, target.groupId)
    else createEventGroupWithEvents({
      name: target.text, anchorQuadrant: target.quadrant, anchorX: target.x, anchorY: target.y
    }, [target.id, event.id])
  }

  const addToOpenedGroup = (eventId: string): void => {
    const event = events.find((item) => item.id === eventId)
    if (!event || !openedGroup || event.groupId === openedGroup.id) return
    if (event.quadrant === openedGroup.anchorQuadrant) assignEventToGroup(event.id, openedGroup.id)
    else setCrossGroup({
      eventId: event.id, targetGroupId: openedGroup.id,
      sourceQuadrant: event.quadrant, targetQuadrant: openedGroup.anchorQuadrant
    })
  }

  const locateAnchor = (group: EventGroup): void => {
    const card = boardCards.find((item) => item.group?.id === group.id && item.event.quadrant === group.anchorQuadrant)
    if (card) {
      locateEvent(card.event)
      return
    }
    rememberView()
    setIsOverview(false)
    setCamera({ x: group.anchorX, y: group.anchorY, zoom: Math.max(viewRef.current.zoom, 0.8) })
    requestAnimationFrame(() => viewportRef.current?.querySelector<HTMLElement>(
      `.quadrant-group-anchor[data-group-id="${CSS.escape(group.id)}"]`
    )?.focus({ preventScroll: true }))
  }

  const overviewMarkers = view.zoom < OVERVIEW_MARKER_ZOOM
  const selectedCard = boardCards.find((card) => card.event.id === selectedId)
  const armedDrop = boardCards.find(({ event }) => event.id === groupDropTargetId)
  const anchorCard = selectedGroup && boardCards.find((card) =>
    card.group?.id === selectedGroup.id && card.event.quadrant === selectedGroup.anchorQuadrant)?.display
  const compass = { 1: '↗', 2: '↖', 3: '↙', 4: '↘' } as const

  return (
    <div className="quadrant-page" style={viewMode === 'canvas' ? CANVAS_COLORS : LIST_COLORS}>
      <header className="page-header quadrant-header">
        <h1>四象限</h1>
        <div className="quadrant-toolbar" aria-label="画布工具">
          <div className="quadrant-view-toggle" role="group" aria-label="视图模式">
            <button type="button" aria-pressed={viewMode === 'canvas'} onClick={() => setViewMode('canvas')}>画布</button>
            <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>列表</button>
          </div>
          <button ref={addButtonRef} type="button" className="quadrant-tool-primary" onClick={openCreate}>＋ 添加</button>
          {viewMode === 'canvas' && <button type="button" aria-pressed={isOverview} onClick={fitAll}>全览</button>}
          {hasPreviousView && viewMode === 'canvas' && <button type="button" onClick={returnToPreviousView}>返回刚才位置</button>}
        </div>
      </header>
      {viewMode === 'canvas' ? <div
        ref={viewportRef}
        className="quadrant-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={(e) => {
          hoverRef.current = null
          if (shouldClearDragOnPointerLeave(e.pointerType)) gestures.cancel()
        }}
        onDoubleClick={onDoubleClick}
        onClick={onViewportClick}
        onContextMenu={onViewportContextMenu}
      >
        <canvas ref={canvasRef} className="quadrant-canvas" />
        {QUADRANT_ORDER.map((q) => {
          const { corner, label } = QUADRANT_META[q]
          const horizontal = corner.endsWith('left') ? view.panX : size.width - view.panX
          const vertical = corner.startsWith('top') ? view.panY : size.height - view.panY
          return horizontal > 100 && vertical > 30 && <div key={q} className={`quadrant-compass q${q}`}>{compass[q]} {label}</div>
        })}
        <div
          className="event-layer"
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
        >
          {selectedGroup && (
            <svg className="quadrant-group-connectors" aria-hidden="true">
              {boardCards.filter(({ event }) => event.groupId === selectedGroup.id && event.quadrant !== selectedGroup.anchorQuadrant).map(({ display }) => {
                const path = connectorPath(display, anchorCard ?? { x: selectedGroup.anchorX, y: selectedGroup.anchorY, width: 8 })
                return path && <path key={display.id} d={path} />
              })}
            </svg>
          )}
          {boardCards.map(({ event, display, group, total, local }) => {
            if (editing?.id === event.id) return null
            const preview = dragPreview?.id === event.id ? dragPreview : null
            const shown = preview
              ? { ...display, x: preview.floatingX, y: preview.floatingY, quadrant: preview.quadrant }
              : display
            const isRemote = group && event.quadrant !== group.anchorQuadrant
            return (
              <Fragment key={event.id}>
                {preview && <div aria-hidden="true" className={`quadrant-drop-ghost q${preview.quadrant}`} style={{ left: preview.x * UNIT, top: -preview.y * UNIT, width: display.width * UNIT }} />}
                <EventCard
                  event={shown}
                  overdue={overdue(event)}
                  selected={selectedId === event.id}
                  armed={gestures.armedId === event.id}
                  dragging={!!preview}
                  photosOpen={photosOpen.has(event.id)}
                  groupCount={total}
                  stacked={local > 1}
                  overview={overviewMarkers}
                  groupLabel={group && (isRemote ? `${directionToAnchor(display, group)} ${group.name}` : `${group.name} · ${local}/${total}`)}
                  groupActionLabel={isRemote ? `定位卡组「${group.name}」` : undefined}
                  groupDropTarget={groupDropTargetId === event.id}
                  onOpenGroup={(trigger) => {
                    if (!group) return
                    if (isRemote) locateAnchor(group)
                    else openGroup(group.id, trigger)
                  }}
                  onActivate={(trigger) => {
                    if (group) openGroup(group.id, trigger)
                    else setDetailId(event.id)
                  }}
                  onSelect={() => setSelectedId(event.id)}
                  onOpenPhoto={(index) => setViewer({ eventId: event.id, index })}
                  onDeletePhoto={(index) => {
                    const id = event.photos?.[index]
                    if (id) void removeEventPhoto(event.id, id)
                  }}
                  onContextMenu={onEventContextMenu}
                />
              </Fragment>
            )
          })}
          {vacantAnchors.map((group) => (
            <button key={group.id} type="button" data-group-id={group.id} className={`quadrant-group-anchor q${group.anchorQuadrant}`}
              tabIndex={overviewMarkers ? -1 : 0}
              style={{ left: group.anchorX * UNIT, top: -group.anchorY * UNIT }}
              onFocus={() => setSelectedId(groupMembers(group.id)[0]?.id ?? null)}
              onClick={(e) => openGroup(group.id, e.currentTarget)}>
              {group.name}
            </button>
          ))}
          {editing && (
            <input
              className="event-input"
              enterKeyHint="done"
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
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
                if (e.key !== 'Enter' && e.key !== 'Escape') return
                e.preventDefault()
                e.currentTarget.dataset.finish = e.key === 'Enter' ? 'save' : 'cancel'
                e.currentTarget.blur()
              }}
              onBlur={(e) => {
                const { finish } = e.currentTarget.dataset
                const touch = lastPointerTypeRef.current === 'touch' || window.matchMedia('(pointer: coarse)').matches
                if (finish === 'save' || (touch && finish !== 'cancel')) commitEditing(e.currentTarget.value)
                else setEditing(null)
              }}
            />
          )}
        </div>
        {armedDrop && (
          <output className="quadrant-drop-instruction">
            {armedDrop.event.quadrant !== dragRef.current?.card.event.quadrant
              ? '松手后确认归属'
              : armedDrop.group ? '松手加入卡组' : '松手叠成卡组'}
          </output>
        )}
        {overviewMarkers && (
          <>
            {boardCards.map(({ display, event }) => <button
              key={event.id}
              type="button"
              className={`quadrant-overview-marker q${event.quadrant}${event.id === selectedId ? ' selected' : ''}`}
              style={{ left: worldToScreenX(display.x + display.width / 2, view), top: worldToScreenY(display.y - EVENT_HEIGHT_UNITS / 2, view) }}
              title={event.text}
              aria-label={`定位「${event.text}」`}
              onFocus={() => setSelectedId(event.id)}
              onClick={() => locateEvent(event)}
            />)}
            {vacantAnchors.map((group) => <button
              key={group.id}
              type="button"
              className={`quadrant-overview-marker group-anchor q${group.anchorQuadrant}`}
              style={{ left: worldToScreenX(group.anchorX + 4, view), top: worldToScreenY(group.anchorY - EVENT_HEIGHT_UNITS / 2, view) }}
              aria-label={`定位主卡组「${group.name}」`}
              title={group.name}
              onClick={() => locateAnchor(group)}
            />)}
            {selectedCard && <output className="quadrant-overview-title">{selectedCard.group?.name ?? selectedCard.event.text}</output>}
          </>
        )}
        {/*
          计费气泡：非模态内联（spec 7.4）。

          ⚠️ **挂在 `.event-layer` 之外**（R3-D，2026-10-03）。它与 `.event-layer` 是
          **兄弟**，放在 `.quadrant-viewport` 的直接子节点上 —— 因为 `.event-layer`
          恒带 `transform`，而 Chromium 里祖先的 `transform` 就是合成面，
          会把玻璃材质的背景采样截断（实测保留率 0.659 ⇒ 只剩染色）。
          它仍随画布平移缩放：位置由 `view` 经 `worldToScreenX/Y` 现算
          （见 QuadrantCostBubble 的头注释与 docs/probes/quadrant-bubble/）。

          ⇒ **`.event-layer` 从今天起是玻璃宿主的禁区**（与 `.sidebar` 同理）。
          往里面塞任何带 `backdrop-filter` 的浮层之前，先问：它有没有 transform。

          只在金钱系统开启、且当前正为某事件记账时渲染。手势隔离由组件内部的
          stopPropagation + pointer-events: auto 负责。
        */}
        {moneyEnabled && billingEvent && (
          <QuadrantCostBubble
            event={billingEvent}
            view={view}
            nowMin={nowMin}
            config={money?.config ?? DEFAULT_MONEY_CONFIG}
            alreadyBilled={billingAlreadyDone}
            onConfirm={(answer) => {
              const target = billingEvent
              setBillingId(null)
              if (!target) return
              /*
               * 「不计费」只是**不记账**，卡片一律离场 —— 用户已经在气泡里回答过
               * 「是否计时」这一问，把卡片留在原地会让人以为没生效。删除与记账
               * 收敛在 store 的同一次 set 里（见 completeQuadrantEvent），
               * 顺带会解除它与周计划事件的镜像链接。
               *
               * 把本页持有的日期一并交出去：气泡的 alreadyBilled 用的就是它，
               * 整条路径跑在同一个时钟、同一个日期上（跨零点不再各算各的）。
               */
              const photoIds = target.photos ?? []
              completeQuadrantEvent(target, answer, nowMin, today)
              /*
               * 照片实体必须跟着一起回收，与「删除事件」那条路径同规矩：
               * 事件一旦不在，挂在上面的 id 就再也访问不到，实体却还占着
               * IndexedDB / 桌面文件 / 云端三份空间，是不可回收的孤儿。
               * `forgetPhotoUrl` 顺手把 object URL 缓存摘掉（否则缓存里那条
               * URL 仍指向已删的 blob，而查看器可能正开着这张图）。
               */
              for (const id of photoIds) forgetPhotoUrl(id)
              void Promise.all(photoIds.map((id) => removePhoto(id)))
            }}
            onCancel={() => setBillingId(null)}
          />
        )}
      </div> : (
        <QuadrantList
          events={events}
          groups={groups}
          onEdit={(event) => { setSelectedId(event.id); setDetailId(event.id) }}
          onDelete={(event) => setDeletePendingId(event.id)}
          onMove={(event, quadrant) => moveEventToQuadrant(event.id, quadrant)}
          onMoveGroup={(event, quadrant) => moveEventGroup(event.id, quadrant)}
          onOpenGroup={openGroup}
          onGroupDrop={handleGroupDrop}
        />
      )}
      {menu && (
        <ContextMenu
          menu={menu}
          canPaste={hasClipboardEvent()}
          canAddPhoto={canAddPhotoTo(menu.eventId)}
          canComplete={moneyEnabled}
          onAction={(action) => {
            if (action === 'complete' && menu.eventId) {
              // 打开计费气泡（紧接着 close() 收起菜单），而不是直接落账 ——
              // 落账要等用户在气泡里确认答案。
              setBillingId(menu.eventId)
            }
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
          key={detailEvent.id}
          event={detailEvent}
          onSave={(patch) => updateEvent(detailEvent.id, patch, view)}
          onClose={() => setDetailId(null)}
          onAddPhotos={() => startAddPhoto(detailEvent.id)}
          onDeletePhoto={(id) => void removeEventPhoto(detailEvent.id, id)}
          photoBusy={photoBusy}
          photoFailed={photoFailedId === detailEvent.id}
        />
      )}
      {createDraft && (
        <QuadrantDialog title="添加事件" width={380} onClose={closeCreate}>
          <form className="quadrant-create-form" onSubmit={(e) => {
            e.preventDefault()
            const form = new FormData(e.currentTarget)
            const text = String(form.get('title') ?? '').trim()
            if (!text) return
            saveCreate(text, Number(form.get('quadrant')) as Quadrant)
            closeCreate()
          }}>
            <label className="modal-field">名称<input name="title" enterKeyHint="done" required /></label>
            <label className="modal-field">所属象限
              <select name="quadrant" defaultValue={createDraft.quadrant}><QuadrantChoices /></select>
            </label>
            <div className="modal-actions">
              <button type="button" className="modal-btn" onClick={closeCreate}>取消</button>
              <button type="submit" className="modal-btn primary">添加</button>
            </div>
          </form>
        </QuadrantDialog>
      )}
      {openedGroup && openedMembers.length > 0 && !crossGroup && !detailEvent && (
        <QuadrantGroupDialog
          group={openedGroup}
          members={openedMembers}
          candidates={events.filter((event) => event.groupId !== openedGroup.id)}
          onClose={closeGroupDialog}
          onRename={(name) => renameEventGroup(openedGroup.id, name)}
          onMoveGroup={(quadrant) => moveEventGroup(openedMembers[0].id, quadrant)}
          onMoveMember={(event, quadrant) => moveEventToQuadrant(event.id, quadrant)}
          onLocate={(event) => { setGroupDialogId(null); locateEvent(event) }}
          onEdit={(event) => setDetailId(event.id)}
          onRemove={(id) => {
            if (openedMembers.length === 1) closeGroupDialog()
            assignEventToGroup(id, undefined)
          }}
          onAdd={addToOpenedGroup}
        />
      )}
      {crossGroup && pendingEvent && (pendingGroup || pendingTarget) && (
        <QuadrantDialog title="加入卡组？" width={480} onClose={closeCrossGroup}>
          <p className="quadrant-cross-description">
            加入「{pendingGroup?.name ?? pendingTarget?.text}」时，要把「{pendingEvent.text}」
            从「{QUADRANT_META[crossGroup.sourceQuadrant].label}」移到「{QUADRANT_META[crossGroup.targetQuadrant].label}」吗？
          </p>
          <div className="quadrant-cross-actions">
            <button className="modal-btn" type="button" onClick={() => finishCrossGroup(false)}>保留原象限并加入</button>
            <button className="modal-btn primary" type="button" onClick={() => finishCrossGroup(true)}>移到目标象限并加入</button>
            <button className="modal-btn" type="button" onClick={closeCrossGroup}>取消</button>
          </div>
        </QuadrantDialog>
      )}
      {deletePendingId && (
        <ConfirmDialog
          message={`确定删除事件「${events.find((event) => event.id === deletePendingId)?.text ?? '已选事件'}」？`}
          onConfirm={() => {
            // 事件连同照片一起删：先摘实体再删事件，避免照片文件成为孤儿。
            const target = events.find((e) => e.id === deletePendingId)
            const ids = target?.photos ?? []
            deleteEvent(deletePendingId)
            for (const id of ids) forgetPhotoUrl(id)
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
