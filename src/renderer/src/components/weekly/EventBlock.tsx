import type { WeekEvent } from '../../../../shared/types'
import { withAlpha } from '../../lib/color'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { minutesToLabel } from '../../lib/weekRules'
import MoneyIcon from '../money/MoneyIcon'

interface Props {
  event: WeekEvent
  top: number
  height: number
  interactive: boolean
  overview?: boolean
  /**
   * 该事件的**预估**时币花费（spec R2 §7 第 2 项）。
   *
   * 由宿主现算后传入，而不是在本组件里读 store / 调 `costOfEntry`：
   * - 本组件同时被日视图与周视图复用，**周视图不显示估值**（用户说的是「周计划的子页面」，
   *   即日视图）。宿主不传 ⇒ 这里不渲染 —— 不需要在本组件里判断概览态，也就不会
   *   因为将来某个概览入口忘了传 `overview` 而漏出估值；
   * - 计算口径与调用点留在日视图一处，和 `costOfEntry` 的其它调用点一样集中可审。
   *
   * `null` / `undefined` = 不显示（周视图走的就是这条）。
   */
  costTC?: number | null
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
  costTC,
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
  const showCost = costTC !== null && costTC !== undefined

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
      <div className="day-event-head">
        {showTitle && (
          <div className={`day-event-title${shrinkTitle ? ' short' : ''}`}>{event.title}</div>
        )}
        {showCost && (
          <span
            className="day-event-cost"
            title={`预计 ${costTC} 时币。实际花费在日结时才定：要问实际做了多久、有多少落在 23:30–06:00。`}
          >
            <MoneyIcon kind="tc" size={12} />
            {`≈${costTC}`}
          </span>
        )}
      </div>
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
