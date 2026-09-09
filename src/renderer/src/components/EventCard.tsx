import { useRef, useState } from 'react'
import type { QuadrantEvent } from '../../../shared/types'
import { UNIT } from '../lib/quadrantMath'

interface Props {
  event: QuadrantEvent
  overdue: boolean
  selected: boolean
  onSelect: () => void
  onDragStart: (e: React.PointerEvent, event: QuadrantEvent) => void
  onContextMenu: (e: React.MouseEvent, event: QuadrantEvent) => void
  onLongPress: (e: React.PointerEvent, event: QuadrantEvent) => void
  onEdit: (event: QuadrantEvent) => void
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EventCard({
  event,
  overdue,
  selected,
  onSelect,
  onDragStart,
  onContextMenu,
  onLongPress,
  onEdit
}: Props): JSX.Element {
  const [hover, setHover] = useState(false)
  const [touchDragging, setTouchDragging] = useState(false)
  const longPressRef = useRef<number | null>(null)

  const clearLongPress = (): void => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  return (
    <div
      className={`event-card q${event.quadrant}${touchDragging ? ' touch-dragging' : ''}${overdue ? ' overdue' : ''}${
        selected ? ' selected' : ''
      }`}
      style={{ left: event.x * UNIT, top: -event.y * UNIT, width: event.width * UNIT }}
      onPointerDown={(e) => {
        onSelect()
        if (e.pointerType === 'touch') {
          clearLongPress()
          longPressRef.current = window.setTimeout(() => {
            longPressRef.current = null
            setTouchDragging(true)
            onLongPress(e, event)
          }, 550)
        }
      }}
      onPointerUp={() => { clearLongPress(); setTouchDragging(false) }}
      onPointerCancel={() => { clearLongPress(); setTouchDragging(false) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        clearLongPress()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onEdit(event)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, event)
      }}
    >
      {(hover || selected) && (
        <span
          className="event-handle"
          onPointerDown={(e) => {
            e.stopPropagation()
            onSelect()
            onDragStart(e, event)
          }}
        />
      )}
      <span className="event-text">{event.text}</span>
      {event.deadline && (
        <span className="event-deadline">截止：{formatDeadline(event.deadline)}</span>
      )}
    </div>
  )
}
