import { describe, expect, it } from 'vitest'
import {
  COMPAT_MOUSE_GUARD_MS,
  DOUBLE_TAP_DIST_PX,
  DOUBLE_TAP_MS,
  DRAG_SLOP_PX,
  LONG_PRESS_MS,
  TAP_MAX_MS,
  distance,
  emitsCompatMouse,
  exceedsSlop,
  isDoubleTap,
  isLongPress,
  isTap,
  type PointerPhase
} from '../src/renderer/src/lib/gestures'
import {
  initialMachineState,
  reduce,
  type MachineEffect,
  type MachineInput,
  type MachineState
} from '../src/renderer/src/lib/gestureMachine'

function pressed(over: Partial<Extract<PointerPhase, { kind: 'pressed' }>> = {}): PointerPhase {
  return { kind: 'pressed', id: 1, x: 100, y: 100, t: 1000, moved: false, ...over }
}

describe('gestures', () => {
  it('measures distance and slop with the documented threshold', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(DRAG_SLOP_PX).toBe(8)
    expect(exceedsSlop({ x: 0, y: 0 }, { x: 8, y: 0 })).toBe(false)
    expect(exceedsSlop({ x: 0, y: 0 }, { x: 8.01, y: 0 })).toBe(true)
    expect(exceedsSlop({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)).toBe(true)
  })

  it('treats a still hold past the threshold as a long press', () => {
    expect(isLongPress(pressed(), 1000 + LONG_PRESS_MS - 1)).toBe(false)
    expect(isLongPress(pressed(), 1000 + LONG_PRESS_MS)).toBe(true)
    expect(isLongPress(pressed({ moved: true }), 1000 + LONG_PRESS_MS * 3)).toBe(false)
    expect(isLongPress(null, 99999)).toBe(false)
    expect(
      isLongPress({ kind: 'dragging', id: 1, from: { x: 0, y: 0 }, last: { x: 9, y: 0 } }, 99999)
    ).toBe(false)
  })

  it('treats a short still press as a tap', () => {
    expect(isTap(pressed(), 1000 + TAP_MAX_MS)).toBe(true)
    expect(isTap(pressed(), 1000 + TAP_MAX_MS + 1)).toBe(false)
    expect(isTap(pressed({ moved: true }), 1100)).toBe(false)
    expect(isTap(null, 1100)).toBe(false)
  })

  it('requires both a short interval and a small displacement for a double tap', () => {
    const first = { x: 100, y: 100, t: 2000 }
    expect(
      isDoubleTap(first, { x: 104, y: 102, t: 2000 + DOUBLE_TAP_MS })
    ).toBe(true)
    expect(isDoubleTap(first, { x: 100, y: 100, t: 2000 + DOUBLE_TAP_MS + 1 })).toBe(false)
    expect(
      isDoubleTap(first, { x: 100 + DOUBLE_TAP_DIST_PX + 1, y: 100, t: 2100 })
    ).toBe(false)
    expect(isDoubleTap(null, { x: 100, y: 100, t: 2100 })).toBe(false)
    expect(isDoubleTap(first, { x: 100, y: 100, t: 2100 }, { maxMs: 99 })).toBe(false)
    expect(isDoubleTap(first, { x: 100, y: 100, t: 2100 }, { maxDist: 0 })).toBe(true)
  })

  it('does not overlap the tap window with the long press window', () => {
    expect(TAP_MAX_MS).toBeLessThan(LONG_PRESS_MS)
  })

  // 触屏/笔的轻触之后浏览器会补发 mousedown，其默认动作会把焦点从刚打开的可聚焦
  // 元素上抢走。只有非鼠标指针需要这道防线；鼠标是原生序列，拦截它会破坏正常聚焦。
  it('requires the compatibility-mouse guard only for touch and pen', () => {
    expect(emitsCompatMouse('touch')).toBe(true)
    expect(emitsCompatMouse('pen')).toBe(true)
    expect(emitsCompatMouse('mouse')).toBe(false)
    expect(emitsCompatMouse('')).toBe(true)
  })

  it('keeps the compatibility guard window far shorter than a human reaction', () => {
    expect(COMPAT_MOUSE_GUARD_MS).toBeGreaterThan(0)
    expect(COMPAT_MOUSE_GUARD_MS).toBeLessThan(DOUBLE_TAP_MS * 2)
  })
})

/** 依次喂入输入，返回每一步的状态机输出。 */
function feed(
  inputs: MachineInput[],
  from: MachineState = initialMachineState
): {
  state: MachineState
  states: MachineState[]
  effects: MachineEffect[][]
  kinds: string[][]
} {
  let state = from
  const states: MachineState[] = []
  const effects: MachineEffect[][] = []
  for (const input of inputs) {
    const result = reduce(state, input)
    state = result.state
    states.push(state)
    effects.push(result.effects)
  }
  return { state, states, effects, kinds: effects.map((list) => list.map((e) => e.kind)) }
}

const ITEM = { kind: 'item' as const, id: 'e1' }
const CANVAS = { kind: 'canvas' as const }

function down(over: Partial<Extract<MachineInput, { type: 'down' }>> = {}): MachineInput {
  return {
    type: 'down',
    id: 1,
    pointerType: 'touch',
    button: 0,
    ctrlKey: false,
    x: 100,
    y: 100,
    t: 1000,
    hit: CANVAS,
    trackable: true,
    ...over
  }
}

describe('gesture machine', () => {
  it('starts a drag on the first move beyond the slop, without waiting for a timer', () => {
    const { kinds, state } = feed([
      down({ hit: ITEM }),
      { type: 'move', id: 1, x: 104, y: 104, t: 1050 },
      { type: 'move', id: 1, x: 140, y: 130, t: 1100 },
      { type: 'move', id: 1, x: 150, y: 140, t: 1150 },
      { type: 'up', id: 1, x: 150, y: 140, t: 1200 }
    ])
    // 按下 → 建立长按计时；第一次越过 8px 即起拖（旧实现要求静止 550ms）；
    // 之后每帧只走 dragMove；抬起时 dragEnd 一次。
    expect(kinds[0]).toEqual(['clearTimer', 'startTimer'])
    expect(kinds[1]).toEqual([])
    expect(kinds[2]).toEqual(['clearTimer', 'capture', 'dragStart'])
    expect(kinds[3]).toEqual(['dragMove'])
    expect(kinds[4]).toEqual(['clearTimer', 'release', 'dragEnd'])
    expect(state.pointer).toBeNull()
  })

  it('opens the menu when a still hold is released after the long-press threshold', () => {
    const { kinds, states } = feed([
      down({ hit: ITEM }),
      { type: 'arm', id: 1 },
      { type: 'up', id: 1, x: 100, y: 100, t: 1000 + LONG_PRESS_MS }
    ])
    expect(kinds[1]).toEqual([])
    // 计时到点即进入"长按已就绪"（视觉抬起），此时不弹菜单；抬起手指才弹。
    expect(states[1].armedId).toBe('e1')
    expect(kinds[2]).toEqual(['clearTimer', 'release', 'longPress'])
  })

  it('turns an armed long press into a drag as soon as the finger moves', () => {
    const { kinds, state } = feed([
      down({ hit: ITEM }),
      { type: 'arm', id: 1 },
      { type: 'move', id: 1, x: 130, y: 100, t: 1600 }
    ])
    expect(kinds[2]).toEqual(['clearTimer', 'capture', 'dragStart'])
    expect(state.armedId).toBeNull()
  })

  it('ignores an arm timeout that arrives after movement already started', () => {
    const { kinds } = feed([
      down({ hit: ITEM }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1100 },
      { type: 'arm', id: 1 }
    ])
    expect(kinds[2]).toEqual([])
  })

  it('reports a tap and then a double tap for two quick touches', () => {
    const first = feed([down(), { type: 'up', id: 1, x: 100, y: 100, t: 1200 }])
    expect(first.kinds[1]).toEqual(['clearTimer', 'release', 'tap'])
    expect(first.effects[1][2]).toMatchObject({ kind: 'tap', isDouble: false })

    const second = feed(
      [down({ id: 2, t: 1300, x: 102, y: 103 }), { type: 'up', id: 2, x: 102, y: 103, t: 1400 }],
      first.state
    )
    expect(second.effects[1][2]).toMatchObject({ kind: 'tap', isDouble: true })
    expect(second.state.lastTap).toBeNull()
  })

  it('does not treat a long hold as a tap', () => {
    const { kinds } = feed([down(), { type: 'up', id: 1, x: 100, y: 100, t: 1000 + TAP_MAX_MS + 1 }])
    // 既非轻触也非长按（未满阈值）：不触发任何语义回调，只清理计时。
    expect(kinds[1]).toEqual(['clearTimer', 'release'])
  })

  it('clears drag state on pointercancel without committing', () => {
    const { kinds, state } = feed([
      down({ hit: ITEM }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1100 },
      { type: 'cancel', id: 1 }
    ])
    expect(kinds[2]).toEqual(['clearTimer', 'release', 'cancel'])
    expect(state.pointer).toBeNull()
    expect(kinds.flat()).not.toContain('dragEnd')
  })

  it('hands over to the new pointer when a second finger arrives', () => {
    const { kinds, state } = feed([down({ hit: ITEM }), down({ id: 2, x: 160, y: 100, t: 1050 })])
    // 第二指落下：取消第一指的拖动并忽略本次按下（由页面启动双指缩放）。
    expect(kinds[1]).toEqual(['clearTimer', 'release', 'cancel'])
    expect(state.pointer).toBeNull()
  })

  it('ignores a pointer that the caller filtered out', () => {
    const { kinds, state } = feed([down({ trackable: false })])
    expect(kinds[0]).toEqual([])
    expect(state.pointer).toBeNull()
  })

  it('ignores moves and ups that belong to another pointer', () => {
    const { kinds } = feed([
      down(),
      { type: 'move', id: 9, x: 200, y: 200, t: 1100 },
      { type: 'up', id: 9, x: 200, y: 200, t: 1200 }
    ])
    expect(kinds[1]).toEqual([])
    expect(kinds[2]).toEqual([])
  })

  it('keeps the canvas free of the long-press timer', () => {
    const { kinds } = feed([down({ hit: CANVAS })])
    expect(kinds[0]).toEqual(['clearTimer'])
  })
})
