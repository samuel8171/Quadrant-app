import { useCallback, useRef } from 'react'

/**
 * 时间轴的手动滚动（移动端专用）。
 *
 * ## 为什么需要它
 *
 * 移动端 `.day-event` 的 `touch-action` 必须是 `none`，原因见 `theme.css` 里那段
 * 长注释：`touch-action` 在 `pointerdown` 时锁存，整段手势期间改类无效，
 * 所以无法"未解锁时 pan-y、解锁后 none"。既然 CSS 无法中途切换，
 * 就只能从一开始就拿走浏览器的默认滚动，改由本 hook 实现。
 *
 * ## 它做什么
 *
 * 在**未长按解锁**的前提下，把手指的纵向位移写进滚动容器：
 *   - 位移超过 `START_SLOP_PX` 才认定是滚动，避免轻触时抖动导致画面跳动；
 *   - 一旦认定滚动，本次手指序列不再交给拖动（`claim` 返回 false）；
 *   - 长按解锁后（`isArmed()` 为真）完全让位，由状态机做拖动。
 *
 * ## 与状态机的分工
 *
 * 两者都监听同一组指针事件，判定输入却互不相同：
 *   本 hook 只关心"是否已解锁"与"纵向位移"；
 *   状态机关心"是否越过 slop、是否该起拖"。
 * 解锁前状态机不会起拖（见 gestureMachine 的 longPressed 闸门），
 * 所以两条路径不会同时生效。
 */
export interface EventBlockScrollOptions {
  /** 滚动容器；为 null 时不接管。 */
  getScroller: () => HTMLElement | null
  /** 当前手指是否已长按解锁（解锁后交还拖动，不再滚动）。 */
  isArmed: () => boolean
}

/** 认定"这是滚动而不是抖动"所需的最小纵向位移。 */
export const SCROLL_START_SLOP_PX = 6

export interface EventBlockScroll {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  /** 本次指针序列是否已被本 hook 认领为滚动。 */
  isScrolling: () => boolean
}

export function useEventBlockScroll(opts: EventBlockScrollOptions): EventBlockScroll {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const pointerIdRef = useRef<number | null>(null)
  const startYRef = useRef(0)
  const startScrollRef = useRef(0)
  const scrollingRef = useRef(false)

  const reset = useCallback((): void => {
    pointerIdRef.current = null
    scrollingRef.current = false
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent): void => {
    /* 桌面的鼠标序列不参与：滚轮/触控板已经能滚，抢过来反而破坏惯性滚动。 */
    if (e.pointerType === 'mouse') return
    /* 已被状态机认领的指针（拖动中）不接管。 */
    if (pointerIdRef.current !== null) return
    const scroller = optsRef.current.getScroller()
    if (!scroller) return
    pointerIdRef.current = e.pointerId
    startYRef.current = e.clientY
    startScrollRef.current = scroller.scrollTop
    scrollingRef.current = false
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent): void => {
    if (pointerIdRef.current !== e.pointerId) return
    /* 长按已解锁 → 这一指是来拖块的，立即交还。 */
    if (optsRef.current.isArmed()) {
      reset()
      return
    }
    const dy = e.clientY - startYRef.current
    if (!scrollingRef.current) {
      if (Math.abs(dy) < SCROLL_START_SLOP_PX) return
      scrollingRef.current = true
    }
    const scroller = optsRef.current.getScroller()
    if (!scroller) return
    scroller.scrollTop = startScrollRef.current - dy
  }, [reset])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: reset,
    onPointerCancel: reset,
    isScrolling: () => scrollingRef.current
  }
}
