import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { QuadrantEvent } from '../../../shared/types'
import { MAX_EVENT_PHOTOS } from '../../../shared/types'
import { UNIT } from '../lib/quadrantMath'
import { usePhotoUrls } from '../hooks/usePhotoUrls'

/** "确认删除"态的存活时长。 */
const DELETE_CONFIRM_MS = 3000
/** 触屏长按多久露出删除按钮。比画布长按（380ms）略长，减少与拖动/查看的误触。 */
const DELETE_REVEAL_MS = 500

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
  /** 删除单张照片（下标）。 */
  onDeletePhoto: (index: number) => void
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
  onDeletePhoto,
  onContextMenu
}: Props): JSX.Element {
  const [hover, setHover] = useState(false)
  /**
   * 正在等待"二次确认删除"的照片下标。
   *
   * 删除是不可逆操作（照片是用户自己拍的，删了找不回来），所以做成两步：
   * 第一下把按钮切到"确认删除"的红色态，3 秒内再点一下才真删。
   * 误触一下不会丢照片。
   */
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  /**
   * 触屏下"删除按钮是否已露出"。
   *
   * 触屏没有 hover，删除按钮平时 `pointer-events: none` 完全点不到，
   * 否则会和"点缩略图看大图"争抢同一个位置。露出方式是在缩略图条上长按，
   * 与整个画布"长按开菜单"的心智一致。
   */
  const [deleteRevealed, setDeleteRevealed] = useState(false)
  /** 触屏长按露出的定时器（按下开始计时，抬起/取消即撤销）。 */
  const revealTimer = useRef<number | null>(null)
  const photos = event.photos ?? []
  const urls = usePhotoUrls(photosOpen ? photos : [])

  // 确认态有时限：把手指放下不管，3 秒后自动回到普通态，避免"红色的叉"
  // 一直挂着、下一次不小心点到就删了。
  useEffect(() => {
    if (pendingDelete === null) return
    const timer = window.setTimeout(() => setPendingDelete(null), DELETE_CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [pendingDelete])

  // 缩略图条收起时把两类临时态都复位，免得下次展开时残留红色确认态。
  useEffect(() => {
    if (!photosOpen) {
      setPendingDelete(null)
      setDeleteRevealed(false)
    }
  }, [photosOpen])

  // 卸载时撤销未触发的长按定时器。
  useEffect(
    () => () => {
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    },
    []
  )

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
          className={`event-photos${deleteRevealed ? ' delete-revealed' : ''}`}
          // 缩略图条是独立点击目标：不让父级把它当成"点卡片"（会触发选中/拖动判定）。
          onPointerDown={(e) => {
            e.stopPropagation()
            // 触屏长按整条 → 露出删除按钮；鼠标交给 CSS :hover。
            if (e.pointerType === 'mouse') return
            revealTimer.current = window.setTimeout(() => setDeleteRevealed(true), DELETE_REVEAL_MS)
          }}
          onPointerUp={() => {
            if (revealTimer.current !== null) {
              window.clearTimeout(revealTimer.current)
              revealTimer.current = null
            }
          }}
          onPointerCancel={() => {
            if (revealTimer.current !== null) {
              window.clearTimeout(revealTimer.current)
              revealTimer.current = null
            }
          }}
        >
          {urls.map((url, index) => (
            <span
              key={photos[index]}
              className="event-photo-slot"
              // 多张时给后一张叠前一张的视觉：靠负 margin + z-index 递减，
              // 实现"堆叠缩略图"而不需要额外的容器。
              // 叠进量走 CSS 变量（--photo-overlap），因为手机端缩略图更大、
              // 需要不同的叠进量，写死在这里就没法随断点变化。
              style={{
                zIndex: MAX_EVENT_PHOTOS - index,
                marginLeft: index === 0 ? 0 : 'var(--photo-overlap)'
              }}
            >
              <button
                type="button"
                className="event-photo"
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
              {/*
                删除按钮。定位在缩略图右上角，**平时不可点**（`pointer-events: none`），
                只在鼠标悬停该槽位、或触屏下该槽位被"激活"时才可点。

                删除是不可逆操作（照片是用户自己拍的，删了找不回来），所以做成
                两步：第一下把按钮变红进入"确认删除"态，3 秒内再点一下才真删。
                误触一下不会丢照片。
              */}
              <button
                type="button"
                className={`event-photo-delete${pendingDelete === index ? ' armed' : ''}`}
                aria-label={
                  pendingDelete === index ? `确认删除第 ${index + 1} 张照片` : `删除第 ${index + 1} 张照片`
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (pendingDelete !== index) {
                    setPendingDelete(index)
                    return
                  }
                  setPendingDelete(null)
                  onDeletePhoto(index)
                }}
              >
                <X size={12} strokeWidth={3} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
