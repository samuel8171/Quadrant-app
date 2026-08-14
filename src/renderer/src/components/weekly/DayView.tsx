import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { WeekEvent } from '../../../../shared/types'
import ConfirmDialog from '../ConfirmDialog'
import EventBlock from './EventBlock'
import EventFormDialog, { type WeeklyFormState } from './EventFormDialog'
import PresetPanel from './PresetPanel'
import { useAppStore } from '../../state/appStore'
import {
  DAY_HOUR_PX,
  clampEventStart,
  dateKey,
  eventsOnDate,
  eventHeightPx,
  eventTopPx,
  formatDayTitle,
  minuteFromOffsetY,
  minutesToLabel,
  snapToHour
} from '../../lib/weekRules'

interface Props {
  date: Date
  onBack: () => void
  onShiftDay: (n: number) => void
}

interface MenuState {
  x: number
  y: number
  eventId: string
}

interface DragState {
  id: string
  top: number
  grabOffset: number
}

interface DeleteTarget {
  kind: 'preset' | 'event'
  id: string
  title: string
}

const CONTENT_H = 17 * DAY_HOUR_PX
const HOURS = Array.from({ length: 17 }, (_, i) => 420 + i * 60)

export default function DayView({ date, onBack, onShiftDay }: Props): JSX.Element {
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
  const [drag, setDrag] = useState<DragState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [tick, setTick] = useState(0)

  const dayKey = dateKey(date)
  const dayEvents = eventsOnDate(weekEvents, dayKey)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (target && target.closest('.day-menu')) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menu])

  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = nowMin >= 420 && nowMin < 1440

  const defaultCreateStart = (): number => {
    const base = nowMin >= 420 && nowMin < 1440 ? snapToHour(nowMin) : 420
    return clampEventStart(base, 60)
  }

  const openCreate = (startMin: number): void => {
    setForm({ kind: 'event-create', date: dayKey, startMin })
  }

  const onEventDragStart = (e: React.PointerEvent, event: WeekEvent): void => {
    e.preventDefault()
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!canvas || !scroller) return
    canvas.setPointerCapture(e.pointerId)
    const rect = canvas.getBoundingClientRect()
    const pointerY = e.clientY - rect.top + scroller.scrollTop
    const top = eventTopPx(event.startMin, DAY_HOUR_PX)
    setDrag({ id: event.id, top, grabOffset: pointerY - top })
  }

  const onCanvasPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!canvas || !scroller) return
    const event = weekEvents.find((ev) => ev.id === drag.id)
    if (!event) return
    const rect = canvas.getBoundingClientRect()
    const pointerY = e.clientY - rect.top + scroller.scrollTop
    const height = eventHeightPx(event.startMin, event.endMin, DAY_HOUR_PX)
    const top = Math.min(CONTENT_H - height, Math.max(0, pointerY - drag.grabOffset))
    setDrag({ ...drag, top })
  }

  const onCanvasPointerUp = (): void => {
    if (!drag) return
    moveWeekEvent(drag.id, minuteFromOffsetY(drag.top, DAY_HOUR_PX))
    setDrag(null)
  }

  const onEventContextMenu = (e: React.MouseEvent, event: WeekEvent): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, eventId: event.id })
  }

  const onCanvasDoubleClick = (e: React.MouseEvent): void => {
    const target = e.target as Element
    if (target.closest('.day-event')) return
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!canvas || !scroller) return
    const rect = canvas.getBoundingClientRect()
    const y = e.clientY - rect.top + scroller.scrollTop
    openCreate(clampEventStart(minuteFromOffsetY(y, DAY_HOUR_PX), 60))
  }

  const onDropPreset = (e: React.DragEvent): void => {
    e.preventDefault()
    const presetId = e.dataTransfer.getData('application/x-preset-id')
    const preset = weekPresets.find((p) => p.id === presetId)
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!preset || !canvas || !scroller) return
    const rect = canvas.getBoundingClientRect()
    const y = e.clientY - rect.top + scroller.scrollTop
    const start = clampEventStart(minuteFromOffsetY(y, DAY_HOUR_PX), preset.durationMin)
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

  return (
    <div className="day-page">
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
      <div className="day-body">
        <div className="day-scroll" ref={scrollRef}>
          <div className="day-gutter">
            {HOURS.map((h) => (
              <div key={h} className="day-hour-label">
                {minutesToLabel(h)}
              </div>
            ))}
          </div>
          <div
            ref={canvasRef}
            className="day-canvas"
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onDoubleClick={onCanvasDoubleClick}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={onDropPreset}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="day-grid-bg"
              style={{
                backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent ${DAY_HOUR_PX}px)`
              }}
            />
            {showNow && (
              <div className="now-line" style={{ top: eventTopPx(nowMin, DAY_HOUR_PX) }}>
                <span className="now-label">{minutesToLabel(nowMin)}</span>
              </div>
            )}
            {dayEvents.map((event) => (
              <EventBlock
                key={event.id}
                event={event}
                interactive
                dragging={drag?.id === event.id}
                top={drag?.id === event.id ? drag.top : eventTopPx(event.startMin, DAY_HOUR_PX)}
                height={eventHeightPx(event.startMin, event.endMin, DAY_HOUR_PX)}
                onPointerDown={onEventDragStart}
                onContextMenu={onEventContextMenu}
              />
            ))}
          </div>
        </div>
        <PresetPanel
          presets={weekPresets}
          onAdd={() => setForm({ kind: 'preset-create' })}
          onEdit={(preset) => setForm({ kind: 'preset-edit', preset })}
          onDelete={(preset) =>
            setDeleteTarget({ kind: 'preset', id: preset.id, title: preset.title })
          }
        />
      </div>
      {form && <EventFormDialog form={form} onClose={() => setForm(null)} />}
      {menu && (
        <div className="context-menu day-menu" style={{ left: menu.x, top: menu.y }}>
          <button
            className="context-item"
            onClick={() => {
              if (menuEvent) setForm({ kind: 'event-edit', event: menuEvent })
              setMenu(null)
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
              setMenu(null)
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
