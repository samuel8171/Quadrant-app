import { useState } from 'react'
import type { QuadrantEvent } from '../../../shared/types'
import { UNIT } from '../lib/quadrantMath'

interface Props {
  event: QuadrantEvent
  overdue: boolean
  onDragStart: (e: React.PointerEvent, event: QuadrantEvent) => void
  onContextMenu: (e: React.MouseEvent, event: QuadrantEvent) => void
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
  onDragStart,
  onContextMenu,
  onEdit
}: Props): JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <div
      className={`event-card q${event.quadrant}${overdue ? ' overdue' : ''}`}
      style={{ left: event.x * UNIT, top: event.y * UNIT, width: event.width * UNIT }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
      {hover && (
        <span
          className="event-handle"
          onPointerDown={(e) => {
            e.stopPropagation()
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
