import { useState } from 'react'
import type { QuadrantEvent } from '../../../shared/types'
import { MAX_EVENT_PHOTOS } from '../../../shared/types'
import { UNIT } from '../lib/quadrantMath'
import { usePhotoUrls } from '../hooks/usePhotoUrls'

interface Props {
  event: QuadrantEvent
  overdue: boolean
  selected: boolean
  /** 长按已就绪（视觉抬起），抬起手指即打开菜单。 */
  armed: boolean
  /** 正在拖动（预览位置已由父级传入 event）。 */
  dragging: boolean
  /** 缩略图条是否展开（由父级持有，短按切换）。 */
  photosOpen: boolean
  onSelect: () => void
  /** 短按缩略图 → 打开大图查看器，参数为该图在本事件照片里的下标。 */
  onOpenPhoto: (index: number) => void
  onContextMenu: (e: React.MouseEvent, event: QuadrantEvent) => void
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 事件卡片。
 *
 * 这里**不处理画布手势**——轻触/拖动/长按/双击统一由父级的手势内核判定，
 * 卡片只负责渲染与"选中"这一简单交互。唯一的例外是缩略图：它自己是一个
 * 明确的点击目标，点它不等于"点卡片"，因此单独拦截（`stopPropagation`）。
 *
 * 缩略图条只在 `photosOpen` 时渲染：事件块本身只有 1.6 单位高，展开的条会
 * 溢出卡片下沿（`overflow: visible`），这也是"未展开时零成本"的原因。
 */
export default function EventCard({
  event,
  overdue,
  selected,
  armed,
  dragging,
  photosOpen,
  onSelect,
  onOpenPhoto,
  onContextMenu
}: Props): JSX.Element {
  const [hover, setHover] = useState(false)
  const photos = event.photos ?? []
  const urls = usePhotoUrls(photosOpen ? photos : [])

  return (
    <div
      data-event-id={event.id}
      className={`event-card q${event.quadrant}${armed ? ' armed' : ''}${
        dragging ? ' dragging' : ''
      }${overdue ? ' overdue' : ''}${selected ? ' selected' : ''}${
        photosOpen ? ' photos-open' : ''
      }`}
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
      {photos.length > 0 && (
        <span className="event-photo-badge" aria-hidden>
          {photos.length}
        </span>
      )}
      {photosOpen && (
        <div
          className="event-photos"
          // 缩略图条是独立点击目标：不让父级把它当成"点卡片"（会触发选中/拖动判定）。
          onPointerDown={(e) => e.stopPropagation()}
        >
          {urls.map((url, index) => (
            <button
              key={photos[index]}
              type="button"
              className="event-photo"
              // 多张时给后一张叠前一张的视觉：靠负 margin + z-index 递减，
              // 实现"堆叠缩略图"而不需要额外的容器。
              // 叠进量走 CSS 变量（--photo-overlap），因为手机端缩略图更大、
              // 需要不同的叠进量，写死在这里就没法随断点变化。
              style={{
                zIndex: MAX_EVENT_PHOTOS - index,
                marginLeft: index === 0 ? 0 : 'var(--photo-overlap)'
              }}
              onClick={(e) => {
                e.stopPropagation()
                onOpenPhoto(index)
              }}
              title={`查看第 ${index + 1} 张`}
            >
              {url ? (
                <img src={url} alt="" draggable={false} />
              ) : (
                <span className="event-photo-empty" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
