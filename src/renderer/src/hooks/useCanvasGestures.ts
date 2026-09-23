import { useCallback, useEffect, useRef, useState } from 'react'
import { COMPAT_MOUSE_GUARD_MS, LONG_PRESS_MS, emitsCompatMouse, type Point } from '../lib/gestures'
import {
  initialMachineState,
  reduce,
  type GestureHit,
  type MachineEffect,
  type MachineInput,
  type MachinePointer,
  type MachineState
} from '../lib/gestureMachine'

export type { GestureHit }

export interface GestureContext {
  pointerId: number
  pointerType: string
  /** 按下时的 client 坐标（拖动起点，用于计算抓取偏移）。 */
  start: Point
  /** 当前 client 坐标。 */
  current: Point
  dx: number
  dy: number
  hit: GestureHit
  button: number
  ctrlKey: boolean
  /** 手势发生时长按是否已就绪。 */
  armed: boolean
}

export interface CanvasGestureOptions {
  /** 判定指针落在哪个元素上。鼠标可用它区分"把手拖动"与"整卡拖动"。 */
  resolveHit: (e: React.PointerEvent) => GestureHit
  /** 返回 false 时忽略该指针（例如双指缩放已接管）。 */
  isEnabled?: (e: React.PointerEvent) => boolean
  /**
   * 触摸设备上"拖动"是否必须先长按解锁。
   *
   * 默认 `true`（见 `gestures.requiresLongPressToDrag`）——时间轴那类**可滚动**
   * 的容器必须如此，否则手指落在事件块上滑动会拖动块而不是滚动，用户无法看别处。
   *
   * 四象限画布**没有滚动**，不存在这个争抢，长按闸门只剩下纯损耗：
   * 单指平移画布要"先按住 380ms 再动"，几乎无人能猜到；而且在此之前
   * `panRef` 根本不会被设置，单指平移等于完全不可用。
   * 因此画布传 `false`，让单指位移直接进入拖动（平移）。
   */
  requiresLongPress?: boolean
  /** 位移越过阈值，拖动成立。 */
  onDragStart?: (ctx: GestureContext) => void
  onDragMove?: (ctx: GestureContext) => void
  /** 拖动结束并提交。取消手势不会触发本回调。 */
  onDragEnd?: (ctx: GestureContext) => void
  /** 静止按住满阈值后抬起手指 → 打开菜单。 */
  onLongPress?: (ctx: GestureContext) => void
  /** 轻触；`isDouble` 为真表示与上一次轻触构成双击。 */
  onTap?: (ctx: GestureContext, isDouble: boolean) => void
  /** 手势被取消（`pointercancel`、双指接管、外部 `cancel()`）。不提交。 */
  onCancel?: (ctx: GestureContext | null) => void
}

export interface CanvasGestures {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  /** 主动取消（双指缩放接管、Esc 回滚等）。 */
  cancel: () => void
  /**
   * 内核是否正在跟踪某个指针。
   * 用于"内核已退出但页面仍需自行接管"的场景（如双指缩放后剩下一指继续平移）。
   */
  isActive: () => boolean
  /** 当前处于"长按已就绪"状态的项 id，供渲染抬起态。 */
  armedId: string | null
}

/**
 * 指针手势的 DOM 适配层：把指针事件翻译成状态机输入，把状态机输出翻译成
 * 指针捕获与语义回调。所有判定都在 `lib/gestureMachine.ts` 里（可单测）。
 */
export function useCanvasGestures(options: CanvasGestureOptions): CanvasGestures {
  const optionsRef = useRef(options)
  optionsRef.current = options

  const stateRef = useRef<MachineState>(initialMachineState)
  const timerRef = useRef<number | null>(null)
  const guardTimerRef = useRef<number | null>(null)
  const captureRef = useRef(new Map<number, Element>())
  const targetRef = useRef<Element | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /**
   * 让紧随触屏双击之后的那一次兼容性 `mousedown` 失去默认动作——阻止它把焦点
   * 从"刚被双击打开、正在等待输入的元素"上抢走（否则输入框会闪现即消失）。
   *
   * 监听在捕获阶段挂在 `window` 上，并在第一次 `mousedown` 后立刻自行卸载，
   * 因此作用域严格限定在同一手势补发的那一次事件上，不会残留全局拦截。
   */
  const guardCompatMouseDown = useCallback((): void => {
    const onDown = (e: MouseEvent): void => {
      window.removeEventListener('mousedown', onDown, true)
      e.preventDefault()
    }
    window.addEventListener('mousedown', onDown, true)
    if (guardTimerRef.current !== null) window.clearTimeout(guardTimerRef.current)
    guardTimerRef.current = window.setTimeout(() => {
      guardTimerRef.current = null
      window.removeEventListener('mousedown', onDown, true)
    }, COMPAT_MOUSE_GUARD_MS)
  }, [])

  const toContext = (pointer: MachinePointer, armed: boolean): GestureContext => ({
    pointerId: pointer.id,
    pointerType: pointer.pointerType,
    start: pointer.start,
    current: pointer.current,
    dx: pointer.current.x - pointer.start.x,
    dy: pointer.current.y - pointer.start.y,
    hit: pointer.hit,
    button: pointer.button,
    ctrlKey: pointer.ctrlKey,
    armed
  })

  const dispatch = useCallback(
    (input: MachineInput, target?: Element | null): void => {
      if (target !== undefined) targetRef.current = target
      const previous = stateRef.current
      const { state, effects } = reduce(previous, input)
      stateRef.current = state
      if (state.armedId !== previous.armedId) setArmedId(state.armedId)

      const armedDuring = previous.armedId !== null
      for (const effect of effects) {
        switch (effect.kind) {
          case 'startTimer':
            clearTimer()
            timerRef.current = window.setTimeout(() => {
              timerRef.current = null
              dispatch({ type: 'arm', id: effect.id })
            }, LONG_PRESS_MS)
            break
          case 'clearTimer':
            clearTimer()
            break
          case 'capture': {
            const el = targetRef.current
            if (!el) break
            try {
              el.setPointerCapture?.(effect.id)
              captureRef.current.set(effect.id, el)
            } catch {
              /* 指针可能已被浏览器取消 */
            }
            break
          }
          case 'release': {
            const el = captureRef.current.get(effect.id)
            captureRef.current.delete(effect.id)
            try {
              if (el?.hasPointerCapture?.(effect.id)) el.releasePointerCapture(effect.id)
            } catch {
              /* 指针已消失时 releasePointerCapture 会抛错，忽略即可 */
            }
            break
          }
          case 'dragStart':
            optionsRef.current.onDragStart?.(toContext(effect.pointer, armedDuring))
            break
          case 'dragMove':
            optionsRef.current.onDragMove?.(toContext(effect.pointer, armedDuring))
            break
          case 'dragEnd':
            optionsRef.current.onDragEnd?.(toContext(effect.pointer, armedDuring))
            break
          case 'longPress':
            optionsRef.current.onLongPress?.(toContext(effect.pointer, true))
            break
          case 'tap':
            // 双击是唯一会打开"等待输入的界面"的轻触语义，也只有它需要挡住
            // 浏览器补发的 `mousedown` 抢焦点；单击保持原样，以保证
            // "轻触已打开的输入框即可聚焦并唤起键盘"不被破坏。
            if (effect.isDouble && emitsCompatMouse(effect.pointer.pointerType)) {
              guardCompatMouseDown()
            }
            optionsRef.current.onTap?.(toContext(effect.pointer, false), effect.isDouble)
            break
          case 'cancel':
            optionsRef.current.onCancel?.(
              effect.pointer ? toContext(effect.pointer, armedDuring) : null
            )
            break
        }
      }
    },
    [clearTimer, guardCompatMouseDown]
  )

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (guardTimerRef.current !== null) window.clearTimeout(guardTimerRef.current)
    },
    []
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      const opts = optionsRef.current
      const buttonOk = e.pointerType !== 'mouse' || e.button === 0 || e.button === 1
      const trackable = buttonOk && (!opts.isEnabled || opts.isEnabled(e))
      dispatch(
        {
          type: 'down',
          id: e.pointerId,
          pointerType: e.pointerType,
          button: e.button,
          ctrlKey: e.ctrlKey,
          x: e.clientX,
          y: e.clientY,
          t: performance.now(),
          hit: opts.resolveHit(e),
          trackable,
          // 省略时状态机按指针类型取默认值（触摸需要长按、鼠标不需要）。
          needsLongPress: opts.requiresLongPress
        },
        e.currentTarget as Element | null
      )
    },
    [dispatch]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      dispatch(
        { type: 'move', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() },
        e.currentTarget as Element | null
      )
    },
    [dispatch]
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent): void => {
      dispatch({ type: 'up', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() })
    },
    [dispatch]
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent): void => {
      dispatch({ type: 'cancel', id: e.pointerId })
    },
    [dispatch]
  )

  /** 取消任意进行中的手势（不提交）。 */
  const cancel = useCallback((): void => {
    const pointer = stateRef.current.pointer
    if (!pointer) return
    dispatch({ type: 'cancel', id: pointer.id })
  }, [dispatch])

  const isActive = useCallback((): boolean => stateRef.current.pointer !== null, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, cancel, isActive, armedId }
}
