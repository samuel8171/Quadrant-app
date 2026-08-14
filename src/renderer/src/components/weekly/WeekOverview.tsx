import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '../../state/appStore'
import {
  dateKey,
  eventsOnDate,
  eventHeightPx,
  eventTopPx,
  formatDateRange,
  minutesToLabel,
  streakNumber,
  weekDays,
  weekIndexFromAnchor,
  weekdayName
} from '../../lib/weekRules'
import EventBlock from './EventBlock'

const HEADER_H = 44

interface Props {
  monday: Date
  onOpenDay: (key: string) => void
  onShift: (weeks: number) => void
}

export default function WeekOverview({ monday, onOpenDay, onShift }: Props): JSX.Element {
  const weekEvents = useAppStore((s) => s.data.weekEvents)
  const offset = useAppStore((s) => s.data.weekCounterOffset)
  const setOffset = useAppStore((s) => s.setWeekCounterOffset)
  const boardRef = useRef<HTMLDivElement>(null)
  const [boardH, setBoardH] = useState(0)
  const [editingStreak, setEditingStreak] = useState<string | null>(null)

  useEffect(() => {
    const el = boardRef.current
    if (!el) return
    const update = (): void => setBoardH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hourPx = Math.min(64, Math.max(28, (boardH - HEADER_H) / 17))
  const base = weekIndexFromAnchor(monday)
  const n = streakNumber(monday, offset)
  const days = weekDays(monday)
  const hours = Array.from({ length: 17 }, (_, i) => 420 + i * 60)

  const commitStreak = (value: string): void => {
    const parsed = parseInt(value, 10)
    const next = Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : n
    setOffset(next - (base + 1))
    setEditingStreak(null)
  }

  return (
    <div className="weekly-page">
      <header className="page-header weekly-header">
        <h1>周计划</h1>
        <span className="title-underline" />
        <div className="week-nav">
          <button className="icon-btn" title="上一周" onClick={() => onShift(-1)}>
            <ChevronLeft size={16} />
          </button>
          <button className="icon-btn" title="下一周" onClick={() => onShift(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="streak">
          {editingStreak === null ? (
            <button
              className="streak-value"
              title="点击修改周数"
              onClick={() => setEditingStreak(String(n))}
            >
              坚持第 {n} 周
            </button>
          ) : (
            <input
              className="streak-input"
              autoFocus
              type="number"
              min={1}
              value={editingStreak}
              onChange={(e) => setEditingStreak(e.target.value)}
              onBlur={() => commitStreak(editingStreak)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitStreak(editingStreak)
                if (e.key === 'Escape') setEditingStreak(null)
              }}
            />
          )}
        </div>
      </header>
      <div className="week-range">{formatDateRange(monday)}</div>
      <div className="week-board" ref={boardRef}>
        <div className="week-grid">
          <div className="week-gutter">
            <div className="week-gutter-head" />
            <div className="week-hour-labels">
              {hours.map((h) => (
                <div key={h} className="week-hour-label" style={{ height: hourPx }}>
                  {minutesToLabel(h)}
                </div>
              ))}
            </div>
          </div>
          {days.map((day) => {
            const key = dateKey(day)
            const events = eventsOnDate(weekEvents, key)
            return (
              <div className="week-col" key={key}>
                <button className="week-col-head" onClick={() => onOpenDay(key)}>
                  <span className="week-col-weekday">{weekdayName(day)}</span>
                  <span className="week-col-date">
                    {day.getMonth() + 1}/{day.getDate()}
                  </span>
                </button>
                <div
                  className="week-col-body"
                  style={{
                    height: 17 * hourPx,
                    backgroundImage: `repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent ${hourPx}px)`
                  }}
                >
                  {events.map((e) => (
                    <EventBlock
                      key={e.id}
                      event={e}
                      interactive={false}
                      top={eventTopPx(e.startMin, hourPx)}
                      height={eventHeightPx(e.startMin, e.endMin, hourPx)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
