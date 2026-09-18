import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { WeekEvent } from '../../../../shared/types'
import ConfirmDialog from '../ConfirmDialog'
import EventBlock from './EventBlock'
import EventFormDialog, { type WeeklyFormState } from './EventFormDialog'
import PresetPanel from './PresetPanel'
import { withAlpha } from '../../lib/color'
import { useAppStore } from '../../state/appStore'
import {
  DAY_HOUR_PX,
  DAY_PAD_PX,
  clampEventStart,
  dateKey,
  eventsOnDate,
  eventHeightPx,
  eventTopPx,
  formatDayTitle,
  minuteFromOffsetY,
  minutesToLabel,
  snapEventStart,
  snapToHour,
  type SnapHint
} from '../../lib/weekRules'
import { shouldCreateOnCanvasClick } from '../../lib/weeklyMobileLayout'
import { PRESET_DRAG_MIME, carriesPresetDrag, endPresetDrag, getDraggingPresetId } from '../../lib/presetDrag'
import { useCanvasGestures } from '../../hooks/useCanvasGestures'

interface Props {
  date: Date
  onBack: () => void
  onShiftDay: (n: number) => void
  className?: string
  slideClass?: string
  onAnimationEnd?: React.AnimationEventHandler<HTMLDivElement>
}

interface MenuState {
  x: number
  y: number
  eventId: string
}

interface DragState {
  id: string
  /** 指针内容坐标 - 块体顶部，保证抓起瞬间不跳位。 */
  grabOffset: number
  height: number
  duration: number
  /** 拖动开始时的开始分钟，用于判断"是否真的会移动"。 */
  originStart: number
  /** 吸附后的开始分钟；null 表示当日已无空位（不提交）。 */
  snapStart: number | null
  hint: SnapHint
  lastDesired: number
}

interface DeleteTarget {
  kind: 'preset' | 'event'
  id: string
  title: string
}

const GRID_H = 17 * DAY_HOUR_PX
const CONTENT_H = DAY_PAD_PX * 2 + GRID_H
const HOURS = Array.from({ length: 18 }, (_, i) => 420 + i * 60)
/** 拖动/取消结束后忽略 click 的时间窗：浏览器的补发 click 会紧随 pointerup 到达。 */
const CLICK_SUPPRESS_MS = 350

export default function DayView({
  date,
  onBack,
  onShiftDay,
  className,
  slideClass,
  onAnimationEnd
}: Props): JSX.Element {
  const weekEvents = useAppStore((s) => s.data.weekEvents)
  const weekPresets = useAppStore((s) => s.data.weekPresets)
  const addWeekEvent = useAppStore((s) => s.addWeekEvent)
  const deleteWeekEvent = useAppStore((s) => s.deleteWeekEvent)
  const moveWeekEvent = useAppStore((s) => s.moveWeekEvent)
  const deletePreset = useAppStore((s) => s.deletePreset)

  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<WeeklyFormState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuClosing, setMenuClosing] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  /** 预设拖入时的落点预览（桌面端 HTML5 DnD）。 */
  const [dropPreview, setDropPreview] = useState<{ startMin: number; presetId: string } | null>(null)
  const [tick, setTick] = useState(0)
  /** 拖动结束后短时间内忽略 click（浏览器会在 pointerup 后补发）。 */
  const suppressCanvasClickUntilRef = useRef(0)
  const lastPointerTypeRef = useRef<string>('mouse')

  const dayKey = dateKey(date)
  const dayEvents = eventsOnDate(weekEvents, dayKey)

  const updateDrag = useCallback((next: DragState | null): void => {
    dragRef.current = next
    setDrag(next)
  }, [])

  const contentY = (clientY: number): number => {
    const scroller = scrollRef.current
    if (!scroller) return 0
    return clientY - scroller.getBoundingClientRect().top + scroller.scrollTop
  }

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const closeMenu = useCallback(() => {
    setMenuClosing(true)
    window.setTimeout(() => {
      setMenu(null)
      setMenuClosing(false)
    }, 140)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (target && target.closest('.day-menu')) return
      closeMenu()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menu, closeMenu])

  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = nowMin >= 420 && nowMin < 1440

  const defaultCreateStart = (): number => {
    const base = nowMin >= 420 && nowMin < 1440 ? snapToHour(nowMin) : 420
    return clampEventStart(base, 60)
  }

  const openCreate = (startMin: number, presetId?: string): void => {
    setForm({ kind: 'event-create', date: dayKey, startMin, presetId })
  }

  /**
   * 时间轴拖动：位移 > 8px 即起拖（不再等 550ms 静止），落点以 5 分钟网格吸附并
   * 滑向最近空位，拖动期间只渲染幽灵预览、抬起时才提交。
   * 取消（`pointercancel` / Esc / 双指）一律不提交。
   */
  const gestures = useCanvasGestures({
    resolveHit: (e) => {
      const el = e.target as Element | null
      const block = el?.closest('.day-event') as HTMLElement | null
      const id = block?.dataset.eventId
      if (!block || !id || block.classList.contains('read-only')) return { kind: 'canvas' }
      return { kind: 'item', id }
    },
    onDragStart: (ctx) => {
      if (ctx.hit.kind !== 'item' || !ctx.hit.id) return
      const event = weekEvents.find((ev) => ev.id === ctx.hit.id)
      if (!event) return
      suppressCanvasClickUntilRef.current = performance.now() + CLICK_SUPPRESS_MS
      const pointerY = contentY(ctx.start.y)
      const top = DAY_PAD_PX + eventTopPx(event.startMin, DAY_HOUR_PX)
      updateDrag({
        id: event.id,
        grabOffset: pointerY - top,
        height: eventHeightPx(event.startMin, event.endMin, DAY_HOUR_PX),
        duration: event.endMin - event.startMin,
        originStart: event.startMin,
        snapStart: event.startMin,
        hint: 'later',
        lastDesired: event.startMin
      })
    },
    onDragMove: (ctx) => {
      const current = dragRef.current
      if (!current) return
      const pointerY = contentY(ctx.current.y)
      const desired = minuteFromOffsetY(pointerY - current.grabOffset - DAY_PAD_PX, DAY_HOUR_PX)
      const hint: SnapHint =
        desired > current.lastDesired ? 'later' : desired < current.lastDesired ? 'earlier' : current.hint
      const others = dayEvents.filter((ev) => ev.id !== current.id)
      const snapStart = snapEventStart(others, current.duration, desired, hint)
      if (snapStart === current.snapStart && hint === current.hint) {
        // 落点未变：只更新方向基准，不触发重渲染。
        dragRef.current = { ...current, lastDesired: desired }
        return
      }
      updateDrag({ ...current, hint, lastDesired: desired, snapStart })
    },
    onDragEnd: () => {
      const current = dragRef.current
      updateDrag(null)
      // 指针抬起后浏览器还会补一个 click：用短时间窗拦掉，避免它被当成"点击空白新建"。
      suppressCanvasClickUntilRef.current = performance.now() + CLICK_SUPPRESS_MS
      if (!current || current.snapStart === null) return
      const event = weekEvents.find((ev) => ev.id === current.id)
      if (!event || event.startMin === current.snapStart) return
      moveWeekEvent(current.id, current.snapStart)
    },
    onLongPress: (ctx) => {
      // 桌面已有右键菜单，长按只在触屏/笔上作为菜单入口。
      if (ctx.pointerType === 'mouse') return
      if (ctx.hit.kind === 'item' && ctx.hit.id) {
        setMenu({ x: ctx.current.x, y: ctx.current.y, eventId: ctx.hit.id })
      }
    },
    onTap: (ctx, isDouble) => {
      if (ctx.pointerType === 'mouse') return
      if (!isDouble || ctx.hit.kind !== 'item' || !ctx.hit.id) return
      const event = weekEvents.find((ev) => ev.id === ctx.hit.id)
      if (event) setForm({ kind: 'event-edit', event })
    },
    onCancel: () => {
      updateDrag(null)
      // 取消（含 Esc）后浏览器仍可能补一个 click，同样需要拦掉。
      suppressCanvasClickUntilRef.current = performance.now() + CLICK_SUPPRESS_MS
    }
  })

  const gesturesRef = useRef(gestures)
  gesturesRef.current = gestures

  // Esc 回滚正在进行的拖动（不提交）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (dragRef.current) gesturesRef.current.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 拖动在画布外结束（松手于别处 / Esc 取消）时不会再有 dragover，
  // 落点预览会永远留在画面上——这两个 window 级事件做兜底清理。
  useEffect(() => {
    if (!dropPreview) return
    const clear = (): void => {
      endPresetDrag()
      setDropPreview(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [dropPreview])

  const onEventContextMenu = (e: React.MouseEvent, event: WeekEvent): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, eventId: event.id })
  }

  const onCanvasDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as Element
    if (target.closest('.day-event')) return
    const y = contentY(e.clientY)
    openCreate(clampEventStart(minuteFromOffsetY(y - DAY_PAD_PX, DAY_HOUR_PX), 60))
  }

  const onCanvasClick = (e: React.MouseEvent): void => {
    const now = performance.now()
    const wasDragging = now < suppressCanvasClickUntilRef.current
    suppressCanvasClickUntilRef.current = 0
    const target = e.target as Element
    if (target.closest('.day-event')) return
    const pointerType =
      (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType ?? lastPointerTypeRef.current
    if (!shouldCreateOnCanvasClick(pointerType, e.detail, wasDragging)) return
    const y = contentY(e.clientY)
    openCreate(clampEventStart(minuteFromOffsetY(y - DAY_PAD_PX, DAY_HOUR_PX), 60))
  }

  const onDropPreset = (e: React.DragEvent): void => {
    e.preventDefault()
    setDropPreview(null)
    const presetId = e.dataTransfer.getData(PRESET_DRAG_MIME) || getDraggingPresetId()
    endPresetDrag()
    const preset = weekPresets.find((p) => p.id === presetId)
    if (!preset) return
    const y = contentY(e.clientY)
    const start = clampEventStart(
      minuteFromOffsetY(y - DAY_PAD_PX, DAY_HOUR_PX),
      preset.durationMin
    )
    addWeekEvent({
      date: dayKey,
      title: preset.title,
      color: preset.color,
      quadrant: preset.quadrant,
      startMin: start,
      endMin: start + preset.durationMin,
      remark: preset.remark,
      presetId: preset.id
    })
  }

  const menuEvent = menu ? weekEvents.find((ev) => ev.id === menu.eventId) : undefined
  const dragEvent = drag ? weekEvents.find((ev) => ev.id === drag.id) : undefined
  const dropPreviewPreset = dropPreview
    ? weekPresets.find((p) => p.id === dropPreview.presetId)
    : undefined

  return (
    <div className={`day-page ${className ?? ''}`} onAnimationEnd={onAnimationEnd}>
      <div className="day-topbar">
        <button className="back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          返回
        </button>
        <button className="day-nav-btn" title="上一日" onClick={() => onShiftDay(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button className="day-nav-btn" title="下一日" onClick={() => onShiftDay(1)}>
          <ChevronRight size={16} />
        </button>
        <h2 className="day-title">{formatDayTitle(date)}</h2>
        <button className="day-add-btn" onClick={() => openCreate(defaultCreateStart())}>
          <Plus size={16} />
          添加
        </button>
      </div>
      <div className={`day-body ${slideClass ?? ''}`} key={dayKey}>
        <div className="day-scroll" ref={scrollRef}>
          <div className="day-gutter">
            {HOURS.map((h, i) => (
              <div
                key={h}
                className="day-hour-label"
                style={{ height: i === HOURS.length - 1 ? DAY_PAD_PX : DAY_HOUR_PX }}
              >
                {minutesToLabel(h)}
              </div>
            ))}
          </div>
          <div
            ref={canvasRef}
            onPointerDownCapture={(e) => { lastPointerTypeRef.current = e.pointerType }}
            className={`day-canvas${dropPreview ? ' drop-active' : ''}`}
            /* 画布总高与左侧标尺列的内容高严格相等，两者一起决定滚动高度。 */
            style={{ height: CONTENT_H }}
            onPointerDown={gestures.onPointerDown}
            onPointerMove={gestures.onPointerMove}
            onPointerUp={gestures.onPointerUp}
            onPointerCancel={gestures.onPointerCancel}
            onClick={onCanvasClick}
            onDoubleClick={onCanvasDoubleClick}
            onDragOver={(e) => {
              // 只接管自家载荷；其他类型（例如从桌面拖进来一个文件）不 preventDefault，
              // 让浏览器保持"此处不可放置"的默认反馈。
              if (!carriesPresetDrag(e.dataTransfer.types)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              const preset = weekPresets.find((p) => p.id === getDraggingPresetId())
              if (!preset) return
              const start = clampEventStart(
                minuteFromOffsetY(contentY(e.clientY) - DAY_PAD_PX, DAY_HOUR_PX),
                preset.durationMin
              )
              setDropPreview((prev) =>
                prev && prev.startMin === start && prev.presetId === preset.id
                  ? prev
                  : { startMin: start, presetId: preset.id }
              )
            }}
            onDragLeave={(e) => {
              // 在画布内部子元素之间移动同样会触发 dragleave，只认真正离开画布的那一次。
              const next = e.relatedTarget as Node | null
              if (next && e.currentTarget.contains(next)) return
              setDropPreview(null)
            }}
            onDrop={onDropPreset}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="day-grid-bg"
              style={{
                top: DAY_PAD_PX,
                height: GRID_H,
                backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent ${DAY_HOUR_PX}px)`
              }}
            />
            {showNow && (
              <div
                className="now-line"
                style={{ top: DAY_PAD_PX + eventTopPx(nowMin, DAY_HOUR_PX) }}
              >
                <span className="now-label">{minutesToLabel(nowMin)}</span>
              </div>
            )}
            {dayEvents.map((event) => {
              const height = eventHeightPx(event.startMin, event.endMin, DAY_HOUR_PX)
              return (
                <EventBlock
                  key={event.id}
                  event={event}
                  interactive
                  dragging={drag?.id === event.id}
                  armed={gestures.armedId === event.id}
                  top={DAY_PAD_PX + eventTopPx(event.startMin, DAY_HOUR_PX)}
                  height={height}
                  onContextMenu={onEventContextMenu}
                  onEdit={(ev) => setForm({ kind: 'event-edit', event: ev })}
                />
              )
            })}
            {drag && drag.snapStart !== null && drag.snapStart !== drag.originStart && dragEvent && (
              <div
                className="day-event-ghost"
                style={{
                  top: DAY_PAD_PX + eventTopPx(drag.snapStart, DAY_HOUR_PX),
                  height: drag.height,
                  background: withAlpha(dragEvent.color, 0.22),
                  borderColor: withAlpha(dragEvent.color, 0.9)
                }}
              >
                <span className="day-event-ghost-time">
                  {minutesToLabel(drag.snapStart)}-{minutesToLabel(drag.snapStart + drag.duration)}
                </span>
              </div>
            )}
            {dropPreview && dropPreviewPreset && (
              <div
                className="day-event-ghost drop-preview"
                style={{
                  top: DAY_PAD_PX + eventTopPx(dropPreview.startMin, DAY_HOUR_PX),
                  height: eventHeightPx(
                    dropPreview.startMin,
                    dropPreview.startMin + dropPreviewPreset.durationMin,
                    DAY_HOUR_PX
                  ),
                  background: withAlpha(dropPreviewPreset.color, 0.22),
                  borderColor: withAlpha(dropPreviewPreset.color, 0.9)
                }}
              >
                <span className="day-event-ghost-time">
                  {minutesToLabel(dropPreview.startMin)}-
                  {minutesToLabel(dropPreview.startMin + dropPreviewPreset.durationMin)}
                </span>
              </div>
            )}
          </div>
        </div>
        <PresetPanel
          presets={weekPresets}
          onAdd={() => setForm({ kind: 'preset-create' })}
          onEdit={(preset) => setForm({ kind: 'preset-edit', preset })}
          onUse={(preset) => openCreate(defaultCreateStart(), preset.id)}
          onDelete={(preset) =>
            setDeleteTarget({ kind: 'preset', id: preset.id, title: preset.title })
          }
        />
      </div>
      {form && <EventFormDialog form={form} onClose={() => setForm(null)} />}
      {menu && (
        <div
          className={`context-menu day-menu${menuClosing ? ' closing' : ''}`}
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="context-item"
            onClick={() => {
              if (menuEvent) setForm({ kind: 'event-edit', event: menuEvent })
              closeMenu()
            }}
          >
            修改信息
          </button>
          <button
            className="context-item danger"
            onClick={() => {
              if (menuEvent) {
                setDeleteTarget({ kind: 'event', id: menuEvent.id, title: menuEvent.title })
              }
              closeMenu()
            }}
          >
            删除
          </button>
        </div>
      )}
      {deleteTarget && (
        <ConfirmDialog
          message={`确定删除「${deleteTarget.title}」？`}
          onConfirm={() => {
            if (deleteTarget.kind === 'event') deleteWeekEvent(deleteTarget.id)
            else deletePreset(deleteTarget.id)
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <span className="tick-sink">{tick}</span>
    </div>
  )
}
