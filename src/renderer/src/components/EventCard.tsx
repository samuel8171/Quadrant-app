import { useState } from 'react'
import type { QuadrantEvent } from '../../../shared/types'
import { UNIT } from '../lib/quadrantMath'

interface Props {
  event: QuadrantEvent
  overdue: boolean
  selected: boolean
  /** 长按已就绪（视觉抬起），抬起手指即打开菜单。 */
  armed: boolean
  /** 正在拖动（预览位置已由父级传入 event）。 */
  dragging: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent, event: QuadrantEvent) => void
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 事件卡片。这里**不处理手势**——轻触/拖动/长按/双击统一由父级的手势内核判定，
 * 卡片只负责渲染与"选中"这一简单交互。鼠标的拖动把手 `.event-handle` 仅作为命中区，
 * 触屏下由 CSS 隐藏（触屏整卡可拖）。
 */
export default function EventCard({
  event,
  overdue,
  selected,
  armed,
  dragging,
  onSelect,
  onContextMenu
}: Props): JSX.Element {
  const [hover, setHover] = useState(false)

  return (
    <div
      data-event-id={event.id}
      className={`event-card q${event.quadrant}${armed ? ' armed' : ''}${
        dragging ? ' dragging' : ''
      }${overdue ? ' overdue' : ''}${selected ? ' selected' : ''}`}
      style={{ left: event.x * UNIT, top: -event.y * UNIT, width: event.width * UNIT }}
      onPointerDown={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e, event)
      }}
    >
      {(hover || selected) && <span className="event-handle" />}
      <span className="event-text">{event.text}</span>
      {event.deadline && (
        <span className="event-deadline">截止：{formatDeadline(event.deadline)}</span>
      )}
    </div>
  )
}
