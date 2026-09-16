/**
 * 指针手势状态机（纯函数，无 DOM 依赖）。
 *
 * `useCanvasGestures` 只是它的适配器：负责 DOM（指针捕获）、定时器与 React 状态，
 * 所有"什么时候算拖动 / 什么时候算长按 / 什么时候复位"的判定都在这里，
 * 因此可用单元测试覆盖完整序列——这正是旧实现缺的那一层
 * （旧代码把长按与拖动混在同一个 `setTimeout` 里，无法测，也就无法发现语义冲突）。
 */
import {
  DRAG_SLOP_PX,
  exceedsSlop,
  isDoubleTap,
  isLongPress,
  isTap,
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

export function reduce(state: MachineState, input: MachineInput, slop = DRAG_SLOP_PX): MachineResult {
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
      if (!pointer.moved && exceedsSlop(pointer.start, moved.current, slop)) {
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
      return { state: { ...state, armedId: pointer.hit.id ?? null }, effects: [] }
    }
  }
}
