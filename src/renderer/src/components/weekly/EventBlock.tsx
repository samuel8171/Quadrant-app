import type { WeekEvent } from '../../../../shared/types'
import { withAlpha } from '../../lib/color'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { minutesToLabel } from '../../lib/weekRules'

interface Props {
  event: WeekEvent
  top: number
  height: number
  interactive: boolean
  overview?: boolean
  /** 正在拖动：块体留在原位并转半透明，落点由幽灵预览表示。 */
  dragging?: boolean
  /** 长按已就绪（视觉抬起），抬起手指即打开菜单。 */
  armed?: boolean
  onContextMenu?: (e: React.MouseEvent, event: WeekEvent) => void
  onEdit?: (event: WeekEvent) => void
}

export default function EventBlock({
  event,
  top,
  height,
  interactive,
  overview,
  dragging,
  armed,
  onContextMenu,
  onEdit
}: Props): JSX.Element {
  const quadrant = QUADRANT_META[event.quadrant]
  const compact = height < 18
  const duration = event.endMin - event.startMin
  const shrinkTitle = !overview && duration < 30
  const short = duration < 45
  const showTitle = overview ? height >= 10 : true
  const showMeta = !overview && !compact && !short

  return (
    <div
      data-event-id={event.id}
      className={`day-event${compact ? ' compact' : ''}${dragging ? ' dragging' : ''}${
        armed ? ' armed' : ''
      }${interactive ? '' : ' read-only'}${overview ? ' overview' : ''}`}
      style={{
        top,
        height,
        background: withAlpha(event.color, overview ? 0.3 : 0.18),
        borderColor: withAlpha(event.color, 0.55),
        boxShadow: `inset 3px 0 0 0 ${event.color}`
      }}
      title={interactive ? undefined : `${event.title} ${minutesToLabel(event.startMin)}-${minutesToLabel(event.endMin)}`}
      onDoubleClick={(e) => {
        if (!interactive) return
        e.stopPropagation()
        onEdit?.(event)
      }}
      onContextMenu={
        interactive && onContextMenu ? (e) => onContextMenu(e, event) : undefined
      }
    >
      {showTitle && (
        <div className={`day-event-title${shrinkTitle ? ' short' : ''}`}>{event.title}</div>
      )}
      {showMeta && (
          <div className="day-event-meta">
            <span className="day-event-time">
              {minutesToLabel(event.startMin)}-{minutesToLabel(event.endMin)}
            </span>
            <span className="quad-dot" style={{ background: quadrant.color }} />
            <span className="day-event-quadrant">{quadrant.label}</span>
          </div>
      )}
    </div>
  )
}
