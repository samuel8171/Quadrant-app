import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { acquirePhotoUrl, releasePhotoUrl } from '../lib/photoStore'
import { useClosing } from '../hooks/useClosing'

interface Props {
  /** 该事件的全部照片 id（至少 1 张）。 */
  photoIds: string[]
  /** 初始显示第几张。 */
  initialIndex: number
  /** 事件标题，作为查看器的副标题。 */
  caption?: string
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 6

/**
 * 大图查看器。
 *
 * 交互按手机相册的直觉来：
 * - 左右切换：横向拖拽超过阈值即翻页（单指）；桌面另有 ←/→ 与底部圆点。
 * - 缩放：双指捏合（触屏）或滚轮（桌面）；双击放大/还原。
 * - 退出：右上角按钮，另支持 Esc 与下滑手势。
 *
 * 实现要点：**缩放与翻页共用同一个手势上下文**，因此必须在一开始就区分
 * "单指还是双指"。这里用 `pointers` Map 跟踪活动指针，2 个以上才进入捏合，
 * 单指只做平移（未放大时即翻页）——否则捏合过程中画面会被当成拖拽而乱跳。
 */
export default function ImageViewer({ photoIds, initialIndex, caption, onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose, 160)
  const [index, setIndex] = useState(() => clampIndex(initialIndex, photoIds.length))
  const [url, setUrl] = useState<string | null>(null)
  const [scale, setScale] = useState(MIN_SCALE)
  /** 缩放后的位移（受限于容器边界，见 clampOffset）。 */
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  const stageRef = useRef<HTMLDivElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  /** 捏合开始时的基准：起始间距与起始缩放。 */
  const pinch = useRef<{ distance: number; scale: number } | null>(null)
  /** 单指横向拖拽的起点，用于判定翻页。 */
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)

  const currentId = photoIds[index]

  // 解析 object URL，切换图片或卸载时释放。
  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    acquirePhotoUrl(currentId).then((next) => {
      if (cancelled) {
        if (next) releasePhotoUrl(currentId)
        return
      }
      setUrl(next)
    })
    return () => {
      cancelled = true
      releasePhotoUrl(currentId)
    }
  }, [currentId])

  // 换图即复位缩放与位移——否则从放大态翻到下一张会莫名其妙地偏着。
  useEffect(() => {
    setScale(MIN_SCALE)
    setOffset({ x: 0, y: 0 })
  }, [currentId])

  /*
   * 照片列表被外部删短时把下标夹回有效范围。
   *
   * 父级在删除时已经会修正传入的 `initialIndex`，但那是一次性的 props 快照；
   * 查看器自己的 `index` 是内部状态，若列表从 3 张变成 1 张而当时停在
   * 第 3 张，`photoIds[index]` 就是 undefined → `currentId` 为空 → 渲染
   * "图片不可用"。这里兜住这条路径。
   */
  useEffect(() => {
    setIndex((prev) => clampIndex(prev, photoIds.length))
  }, [photoIds.length])

  const resetZoom = useCallback((): void => {
    setScale(MIN_SCALE)
    setOffset({ x: 0, y: 0 })
  }, [])

  const go = useCallback(
    (delta: number): void => {
      setIndex((prev) => {
        const next = prev + delta
        if (next < 0 || next >= photoIds.length) return prev
        return next
      })
    },
    [photoIds.length]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === '0') resetZoom()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, go, resetZoom])

  const onPointerDown = (e: React.PointerEvent): void => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale }
      swipe.current = null
      return
    }
    if (pointers.current.size === 1) {
      swipe.current = { x: e.clientX, y: e.clientY, t: performance.now() }
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // 双指捏合：按间距比例缩放，避免逐次累乘导致的漂移。
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current.distance > 0) {
        const next = clampScale((distance / pinch.current.distance) * pinch.current.scale)
        setScale(next)
        if (next <= MIN_SCALE) setOffset({ x: 0, y: 0 })
      }
      return
    }

    // 已放大：单指拖动平移画面。
    if (scale > MIN_SCALE && pointers.current.size === 1) {
      setOffset((prev) => clampOffset({ x: prev.x + e.movementX, y: prev.y + e.movementY }, scale, stageRef.current))
      swipe.current = null
      return
    }

    if (!swipe.current) return
  }

  const settleSwipe = (e: React.PointerEvent): void => {
    const start = swipe.current
    swipe.current = null
    if (!start || scale > MIN_SCALE) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    // 横向位移占优且够远才算翻页；纵向留给下滑退出。
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1)
      return
    }
    if (dy > 96 && Math.abs(dy) > Math.abs(dx)) close()
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) settleSwipe(e)
  }

  const onPointerCancel = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    swipe.current = null
  }

  const onWheel = (e: React.WheelEvent): void => {
    // 桌面缩放：按住 Ctrl 或直接滚（查看器里滚轮没有别的用途，避免与画布缩放冲突）。
    const next = clampScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
    setScale(next)
    if (next <= MIN_SCALE) setOffset({ x: 0, y: 0 })
  }

  const onDoubleClick = (): void => {
    if (scale > MIN_SCALE) resetZoom()
    else setScale(2.5)
  }

  return (
    <div
      className={`image-viewer${closing ? ' closing' : ''}`}
      onClick={close}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
    >
      <button
        type="button"
        className="image-viewer-close"
        aria-label="退出图片查看"
        // 右上角退出：独立于遮罩点击，并且不冒泡（否则会被 close 处理两次）。
        onClick={(e) => {
          e.stopPropagation()
          close()
        }}
      >
        <X size={20} />
      </button>

      {photoIds.length > 1 && (
        <div className="image-viewer-counter" aria-live="polite">
          {index + 1} / {photoIds.length}
        </div>
      )}

      <div
        ref={stageRef}
        className="image-viewer-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {url ? (
          <img
            src={url}
            alt={caption ?? ''}
            draggable={false}
            style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
          />
        ) : (
          <div className="image-viewer-missing">
            图片不可用
            <span>该照片的实体不在本设备上（照片不随云端同步）</span>
          </div>
        )}
      </div>

      {photoIds.length > 1 && (
        <div className="image-viewer-dots" onClick={(e) => e.stopPropagation()}>
          {photoIds.map((id, i) => (
            <button
              key={id}
              type="button"
              className={`image-viewer-dot${i === index ? ' active' : ''}`}
              aria-label={`第 ${i + 1} 张`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || length <= 0) return 0
  return Math.min(length - 1, Math.max(0, Math.trunc(index)))
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * 限制缩放后的平移范围，保证图片不会被拖出视野外。
 *
 * 边界取「放大出来的溢出量的一半」——即图片边缘最多推到容器边缘。
 * 容器尺寸读不到（未挂载）时不限制，属于退化路径，不影响正确性。
 */
function clampOffset(
  offset: { x: number; y: number },
  scale: number,
  stage: HTMLElement | null
): { x: number; y: number } {
  if (!stage || scale <= MIN_SCALE) return offset
  const limitX = (stage.clientWidth * (scale - 1)) / 2
  const limitY = (stage.clientHeight * (scale - 1)) / 2
  return {
    x: Math.min(limitX, Math.max(-limitX, offset.x)),
    y: Math.min(limitY, Math.max(-limitY, offset.y))
  }
}
