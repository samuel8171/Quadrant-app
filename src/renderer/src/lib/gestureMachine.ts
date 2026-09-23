/**
 * 指针手势状态机（纯函数，无 DOM 依赖）。
 *
 * `useCanvasGestures` 只是它的适配器：负责 DOM（指针捕获）、定时器与 React 状态，
 * 所有"什么时候算拖动 / 什么时候算长按 / 什么时候复位"的判定都在这里，
 * 因此可用单元测试覆盖完整序列——这正是旧实现缺的那一层
 * （旧代码把长按与拖动混在同一个 `setTimeout` 里，无法测，也就无法发现语义冲突）。
 */
import {
  exceedsSlop,
  isDoubleTap,
  isLongPress,
  isTap,
  requiresLongPressToDrag,
  slopFor,
  type Point,
  type PointerPhase,
  type TimedPoint
} from './gestures'

export interface GestureHit {
  kind: 'canvas' | 'item'
  id?: string
}

export interface MachinePointer {
  id: number
  pointerType: string
  button: number
  ctrlKey: boolean
  start: Point
  current: Point
  startedAt: number
  moved: boolean
  dragging: boolean
  /**
   * 长按已解锁（触摸设备上"允许拖动"的通行证）。
   * 一旦为真即保持到指针抬起——用户可能长按后又小幅调整位置。
   */
  longPressed: boolean
  /**
   * 本次手势是否要求"长按解锁后才能拖动"。
   *
   * 由调用方在 `down` 时按容器性质决定（默认取 `requiresLongPressToDrag`）：
   * 可滚动容器（时间轴）为 true，无滚动的画布（四象限）为 false。
   * 存在指针上而非全局，是为了让一次手势的判定在整段生命周期内保持一致。
   */
  needsLongPress: boolean
  hit: GestureHit
}

export interface MachineState {
  pointer: MachinePointer | null
  /** 长按已就绪的项 id（视觉抬起中）。 */
  armedId: string | null
  /** 上一次轻触，用于双击判定。 */
  lastTap: TimedPoint | null
}

export type MachineInput =
  | {
      type: 'down'
      id: number
      pointerType: string
      button: number
      ctrlKey: boolean
      x: number
      y: number
      t: number
      hit: GestureHit
      /** 调用方的前置筛选（鼠标按键、双指接管等）是否允许跟踪本指针。 */
      trackable: boolean
      /**
       * 本次手势是否需要长按解锁才能拖动。省略时按指针类型取默认值
       * （触摸/笔需要，鼠标不需要）。
       */
      needsLongPress?: boolean
    }
  | { type: 'move'; id: number; x: number; y: number; t: number }
  | { type: 'up'; id: number; x: number; y: number; t: number }
  | { type: 'cancel'; id: number }
  /** 外部长按计时器到点。 */
  | { type: 'arm'; id: number }

export type MachineEffect =
  | { kind: 'startTimer'; id: number }
  | { kind: 'clearTimer' }
  | { kind: 'release'; id: number }
  /** 位移越过阈值后立即捕获指针，保证拖出容器仍收到事件。 */
  | { kind: 'capture'; id: number }
  | { kind: 'dragStart'; pointer: MachinePointer }
  | { kind: 'dragMove'; pointer: MachinePointer }
  | { kind: 'dragEnd'; pointer: MachinePointer }
  | { kind: 'longPress'; pointer: MachinePointer }
  | { kind: 'tap'; pointer: MachinePointer; isDouble: boolean }
  | { kind: 'cancel'; pointer: MachinePointer | null }

export interface MachineResult {
  state: MachineState
  effects: MachineEffect[]
}

export const initialMachineState: MachineState = {
  pointer: null,
  armedId: null,
  lastTap: null
}

function phaseOf(pointer: MachinePointer): PointerPhase {
  if (pointer.dragging) {
    return { kind: 'dragging', id: pointer.id, from: pointer.start, last: pointer.current }
  }
  return {
    kind: 'pressed',
    id: pointer.id,
    x: pointer.start.x,
    y: pointer.start.y,
    t: pointer.startedAt,
    moved: pointer.moved
  }
}

/**
 * @param slopOverride 显式覆盖拖动阈值（供单测直接指定）。传 undefined 时
 *   按指针类型自动选取（鼠标 8px / 触摸 16px，见 gestures.slopFor）。
 */
export function reduce(
  state: MachineState,
  input: MachineInput,
  slopOverride?: number
): MachineResult {
  switch (input.type) {
    case 'down': {
      // 已有活动指针时（例如第二根手指落下），先取消它并忽略本次按下——
      // 由调用方决定后续接管方式（四象限页用它启动双指缩放）。
      if (state.pointer) {
        return {
          state: { ...state, pointer: null, armedId: null },
          effects: [{ kind: 'clearTimer' }, { kind: 'release', id: state.pointer.id }, { kind: 'cancel', pointer: state.pointer }]
        }
      }
      if (!input.trackable) return { state, effects: [] }
      const pointer: MachinePointer = {
        id: input.id,
        pointerType: input.pointerType,
        button: input.button,
        ctrlKey: input.ctrlKey,
        start: { x: input.x, y: input.y },
        current: { x: input.x, y: input.y },
        startedAt: input.t,
        moved: false,
        dragging: false,
        longPressed: false,
        needsLongPress: input.needsLongPress ?? requiresLongPressToDrag(input.pointerType),
        hit: input.hit
      }
      const effects: MachineEffect[] = [{ kind: 'clearTimer' }]
      if (pointer.hit.kind === 'item') effects.push({ kind: 'startTimer', id: pointer.id })
      return { state: { ...state, pointer, armedId: null }, effects }
    }

    case 'move': {
      const pointer = state.pointer
      if (!pointer || pointer.id !== input.id) return { state, effects: [] }
      const moved: MachinePointer = { ...pointer, current: { x: input.x, y: input.y } }
      const slop = slopOverride ?? slopFor(pointer.pointerType)
      if (!pointer.moved && exceedsSlop(pointer.start, moved.current, slop)) {
        /*
         * 需要长按解锁的容器（时间轴）：未解锁不得进入拖动。
         *
         * 此时只标记 moved（用于"这已不是轻触/长按"的判定），但不设 dragging、
         * 不发 dragStart。位移转交给 `useEventBlockScroll` 做手动滚动——
         * 因为移动端 .day-event 的 touch-action 是 none（见 theme.css 的长注释），
         * 浏览器不会自己滚，也不会派发 pointercancel，这条分支是唯一的兜底。
         *
         * 不需要解锁的容器（四象限画布）跳过这道闸门，位移即拖动。
         */
        if (pointer.needsLongPress && !pointer.longPressed) {
          moved.moved = true
          return {
            state: { ...state, pointer: moved, armedId: null },
            effects: [{ kind: 'clearTimer' }]
          }
        }
        moved.moved = true
        moved.dragging = true
        return {
          state: { ...state, pointer: moved, armedId: null },
          // 抬起态在进入拖动时就作废；捕获放在这里而不是按下时，
          // 使鼠标左键点空白不被抢走 click/dblclick 的目标元素。
          effects: [{ kind: 'clearTimer' }, { kind: 'capture', id: moved.id }, { kind: 'dragStart', pointer: moved }]
        }
      }
      if (!pointer.dragging) return { state: { ...state, pointer: moved }, effects: [] }
      return { state: { ...state, pointer: moved }, effects: [{ kind: 'dragMove', pointer: moved }] }
    }

    case 'up': {
      const pointer = state.pointer
      if (!pointer || pointer.id !== input.id) return { state, effects: [] }
      const finished: MachinePointer = { ...pointer, current: { x: input.x, y: input.y } }
      const phase = phaseOf(finished)
      const armed = isLongPress(phase, input.t)
      const tap = isTap(phase, input.t)
      const base: MachineEffect[] = [{ kind: 'clearTimer' }, { kind: 'release', id: finished.id }]
      const settled: MachineState = { ...state, pointer: null, armedId: null }

      if (finished.dragging) {
        // 拖动结束：只提交一次，取消手势不会走到这里。
        return { state: settled, effects: [...base, { kind: 'dragEnd', pointer: finished }] }
      }
      if (armed) {
        return { state: settled, effects: [...base, { kind: 'longPress', pointer: finished }] }
      }
      if (!tap) {
        return { state: { ...settled, lastTap: null }, effects: base }
      }
      const sample: TimedPoint = { x: finished.current.x, y: finished.current.y, t: input.t }
      const isDouble = isDoubleTap(state.lastTap, sample)
      return {
        state: { ...settled, lastTap: isDouble ? null : sample },
        effects: [...base, { kind: 'tap', pointer: finished, isDouble }]
      }
    }

    case 'cancel': {
      const pointer = state.pointer
      if (!pointer || pointer.id !== input.id) return { state, effects: [] }
      return {
        state: { ...state, pointer: null, armedId: null },
        effects: [{ kind: 'clearTimer' }, { kind: 'release', id: pointer.id }, { kind: 'cancel', pointer }]
      }
    }

    case 'arm': {
      const pointer = state.pointer
      if (!pointer || pointer.id !== input.id) return { state, effects: [] }
      if (pointer.moved || pointer.dragging || pointer.hit.kind !== 'item') return { state, effects: [] }
      /*
       * longPressed 是触摸设备解锁拖动的开关（见 requiresLongPressToDrag）。
       * 注意 moved 为真的指针不在此列：它已经越过阈值，不再是"静止长按"，
       * 对触摸而言那意味着用户想滚动，手势即将被浏览器的 pointercancel 收走。
       */
      return {
        state: { ...state, pointer: { ...pointer, longPressed: true }, armedId: pointer.hit.id ?? null },
        effects: []
      }
    }
  }
}
