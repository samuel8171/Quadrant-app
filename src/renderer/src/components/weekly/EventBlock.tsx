import type { WeekEvent } from '../../../../shared/types'
import { withAlpha } from '../../lib/color'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { minutesToLabel } from '../../lib/weekRules'

interface Props {
  event: WeekEvent
  top: number
  height: number
  interactive: boolean
  dragging?: boolean
  onPointerDown?: (e: React.PointerEvent, event: WeekEvent) => void
  onContextMenu?: (e: React.MouseEvent, event: WeekEvent) => void
}

export default function EventBlock({
  event,
  top,
  height,
  interactive,
  dragging,
  onPointerDown,
  onContextMenu
}: Props): JSX.Element {
  const quadrant = QUADRANT_META[event.quadrant]
  const compact = height < 18

  return (
    <div
      data-event-id={event.id}
      className={`day-event${compact ? ' compact' : ''}${dragging ? ' dragging' : ''}${
        interactive ? '' : ' read-only'
      }`}
      style={{
        top,
        height,
        background: withAlpha(event.color, 0.18),
        borderColor: withAlpha(event.color, 0.55),
        boxShadow: `inset 3px 0 0 0 ${event.color}`
      }}
      title={interactive ? undefined : `${event.title} ${minutesToLabel(event.startMin)}-${minutesToLabel(event.endMin)}`}
      onPointerDown={
        interactive && onPointerDown ? (e) => onPointerDown(e, event) : undefined
      }
      onDoubleClick={(e) => {
        if (interactive) e.stopPropagation()
      }}
      onContextMenu={
        interactive && onContextMenu ? (e) => onContextMenu(e, event) : undefined
      }
    >
      {!compact && (
        <>
          <div className="day-event-title">{event.title}</div>
          <div className="day-event-meta">
            <span className="day-event-time">
              {minutesToLabel(event.startMin)}-{minutesToLabel(event.endMin)}
            </span>
            <span className="quad-dot" style={{ background: quadrant.color }} />
            <span className="day-event-quadrant">{quadrant.label}</span>
          </div>
        </>
      )}
    </div>
  )
}
