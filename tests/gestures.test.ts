import { describe, expect, it } from 'vitest'
import {
  COMPAT_MOUSE_GUARD_MS,
  DOUBLE_TAP_DIST_PX,
  DOUBLE_TAP_MS,
  DRAG_SLOP_PX,
  DRAG_SLOP_TOUCH_PX,
  LONG_PRESS_MS,
  TAP_MAX_MS,
  distance,
  emitsCompatMouse,
  exceedsSlop,
  isDoubleTap,
  isLongPress,
  isTap,
  requiresLongPressToDrag,
  slopFor,
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

  /*
   * 触摸阈值必须明显大于鼠标：手指按压时接触点会漂移，8px 几乎必然被越过，
   * 那会让"点一下事件块"变成"挪动事件块"。
   */
  it('uses a wider slop for touch than for mouse', () => {
    expect(slopFor('mouse')).toBe(DRAG_SLOP_PX)
    expect(slopFor('touch')).toBe(DRAG_SLOP_TOUCH_PX)
    expect(slopFor('pen')).toBe(DRAG_SLOP_TOUCH_PX)
    expect(DRAG_SLOP_TOUCH_PX).toBeGreaterThan(DRAG_SLOP_PX)
    // 10px 对鼠标已成拖动，对触摸仍属"抖动"。
    expect(exceedsSlop({ x: 0, y: 0 }, { x: 10, y: 0 }, slopFor('mouse'))).toBe(true)
    expect(exceedsSlop({ x: 0, y: 0 }, { x: 10, y: 0 }, slopFor('touch'))).toBe(false)
  })

  /*
   * 触摸设备上"拖动"必须先长按解锁——否则手指落在事件块上想滚动时间轴时，
   * 会变成把事件块挪走。鼠标没有这个冲突（滚轮负责滚动），保持即点即拖。
   */
  it('requires a long press before dragging on touch, but not on mouse', () => {
    expect(requiresLongPressToDrag('touch')).toBe(true)
    expect(requiresLongPressToDrag('pen')).toBe(true)
    expect(requiresLongPressToDrag('mouse')).toBe(false)
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
    // 用鼠标：桌面端没有"滚动与拖动争抢"的问题，保持即点即拖。
    const { kinds, state } = feed([
      down({ hit: ITEM, pointerType: 'mouse' }),
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

  /*
   * 这是本次修复的核心：触摸时在事件块上滑动必须是滚时间轴，不是挪块。
   * 未长按解锁就位移 → 不进拖动、不发 dragStart，只清计时器，
   * 位移转交 useEventBlockScroll 手动滚动（移动端块体是 touch-action: none，
   * 浏览器不会自己滚，也不会派发 pointercancel）。
   */
  it('does NOT start a drag on touch movement before the long press unlocks it', () => {
    const { kinds, state } = feed([
      down({ hit: ITEM, pointerType: 'touch' }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1100 },
      { type: 'move', id: 1, x: 160, y: 100, t: 1150 }
    ])
    expect(kinds[1]).toEqual(['clearTimer'])
    expect(kinds[2]).toEqual([])
    expect(kinds.flat()).not.toContain('dragStart')
    expect(state.pointer?.dragging).toBe(false)
  })

  /* 触摸的抖动容差比鼠标宽：同样的位移量在触摸下不算拖动。 */
  it('tolerates a larger wobble on touch before considering it movement', () => {
    const { kinds, state } = feed([
      down({ hit: ITEM, pointerType: 'touch' }),
      { type: 'move', id: 1, x: 110, y: 100, t: 1100 } // 10px，鼠标会起拖，触摸不会
    ])
    expect(kinds[1]).toEqual([])
    expect(state.pointer?.moved).toBe(false)
  })

  /*
   * 四象限画布没有滚动，"拖动与滚动争抢"这个前提根本不存在，
   * 因此它传 `needsLongPress: false` 关掉解锁闸门。
   *
   * 这条测试守的是那个 bug：闸门开着时触摸位移只会标记 moved、
   * 永不发 dragStart，于是 `panRef` 从不被设置，单指平移彻底失效
   * （真机上表现为"只能双指缩放"）。
   */
  it('starts a drag on touch immediately when the container opts out of long press', () => {
    const { kinds, state } = feed([
      down({ hit: CANVAS, pointerType: 'touch', needsLongPress: false }),
      { type: 'move', id: 1, x: 140, y: 140, t: 1100 },
      { type: 'move', id: 1, x: 180, y: 180, t: 1150 },
      { type: 'up', id: 1, x: 180, y: 180, t: 1200 }
    ])
    expect(kinds[1]).toEqual(['clearTimer', 'capture', 'dragStart'])
    expect(kinds[2]).toEqual(['dragMove'])
    expect(kinds[3]).toEqual(['clearTimer', 'release', 'dragEnd'])
  })

  /*
   * 同一次手势的判定必须一致：`needsLongPress` 存在指针上而不是每帧重算，
   * 所以一旦按下时定了"要长按"，后续 move 不会因为别的原因改变行为。
   */
  it('keeps the long-press requirement fixed for the lifetime of a gesture', () => {
    const { state } = feed([
      down({ hit: ITEM, pointerType: 'touch', needsLongPress: true }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1100 }
    ])
    expect(state.pointer?.needsLongPress).toBe(true)
    expect(state.pointer?.dragging).toBe(false)
  })

  /* 默认值仍按指针类型取：触摸要长按、鼠标不要。 */
  it('defaults the long-press requirement by pointer type when not specified', () => {
    const touch = feed([down({ hit: ITEM, pointerType: 'touch' })])
    expect(touch.state.pointer?.needsLongPress).toBe(true)
    const mouse = feed([down({ hit: ITEM, pointerType: 'mouse' })])
    expect(mouse.state.pointer?.needsLongPress).toBe(false)
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
      down({ hit: ITEM, pointerType: 'touch' }),
      { type: 'arm', id: 1 },
      { type: 'move', id: 1, x: 130, y: 100, t: 1600 }
    ])
    expect(kinds[2]).toEqual(['clearTimer', 'capture', 'dragStart'])
    expect(state.armedId).toBeNull()
  })

  /* 长按解锁后即使位移很小也应起拖：解锁本身已是明确意图，不该再等阈值。 */
  it('drags on touch after unlock even for a sub-threshold move', () => {
    const { kinds } = feed([
      down({ hit: ITEM, pointerType: 'touch' }),
      { type: 'arm', id: 1 },
      { type: 'move', id: 1, x: 108, y: 100, t: 1600 }
    ])
    expect(kinds.flat()).not.toContain('dragStart')
    // 8px 未过触摸阈值 16px：仍需超过阈值才真正起拖。
    const wider = feed([
      down({ hit: ITEM, pointerType: 'touch' }),
      { type: 'arm', id: 1 },
      { type: 'move', id: 1, x: 120, y: 100, t: 1600 }
    ])
    expect(wider.kinds[2]).toEqual(['clearTimer', 'capture', 'dragStart'])
  })

  it('ignores an arm timeout that arrives after movement already started', () => {
    const { kinds } = feed([
      down({ hit: ITEM, pointerType: 'mouse' }),
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
    // 鼠标：位移即起拖，随后的 pointercancel 必须原样丢弃、不得提交。
    const { kinds, state } = feed([
      down({ hit: ITEM, pointerType: 'mouse' }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1100 },
      { type: 'cancel', id: 1 }
    ])
    expect(kinds[2]).toEqual(['clearTimer', 'release', 'cancel'])
    expect(state.pointer).toBeNull()
    expect(kinds.flat()).not.toContain('dragEnd')
  })

  /*
   * 触摸未解锁时在事件块上滑动：状态机全程未进拖动，cancel 只负责收尾
   * （外部 cancel()、双指接管等路径仍会走到这里）。
   */
  it('accepts a pointercancel for a touch scroll that never became a drag', () => {
    const { kinds, state } = feed([
      down({ hit: ITEM, pointerType: 'touch' }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1100 },
      { type: 'cancel', id: 1 }
    ])
    expect(kinds[1]).toEqual(['clearTimer'])
    expect(kinds[2]).toEqual(['clearTimer', 'release', 'cancel'])
    expect(state.pointer).toBeNull()
    expect(kinds.flat()).not.toContain('dragStart')
    expect(kinds.flat()).not.toContain('dragEnd')
  })

  it('hands over to the new pointer when a second finger arrives', () => {
    // 用鼠标指针：确保第一指此刻已处于拖动中，第二指落下必须打断它（双指缩放优先）。
    const { kinds, state } = feed([
      down({ hit: ITEM, pointerType: 'mouse' }),
      { type: 'move', id: 1, x: 140, y: 100, t: 1050 },
      down({ id: 2, x: 160, y: 100, t: 1050 })
    ])
    // 第二指落下：取消第一指的拖动并忽略本次按下（由页面启动双指缩放）。
    expect(kinds[2]).toEqual(['clearTimer', 'release', 'cancel'])
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
