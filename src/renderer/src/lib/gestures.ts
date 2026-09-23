/**
 * 触摸手势判据（纯函数层）。
 *
 * 背景：此前各页面分别用原生 `dblclick`、`contextmenu` 与 `setTimeout(550)` 拼凑手势，
 * 导致同一手势被绑到两件事上（长按既是"开菜单"又是"开始拖动"），且触屏下不可靠。
 * 这里把"什么算长按 / 什么算拖动 / 什么算双击"抽成与 DOM 无关的纯判据，
 * 由 `hooks/useCanvasGestures.ts` 负责指针生命周期，页面只消费语义回调。
 */

export interface Point {
  x: number
  y: number
}

export interface TimedPoint extends Point {
  t: number
}

/** 位移超过该值即判定为拖动，不再可能是轻触/长按。鼠标用：精确设备，保持灵敏。 */
export const DRAG_SLOP_PX = 8
/**
 * 触摸专用的拖动阈值。
 *
 * 手指在玻璃上轻点时的自然抖动远超直觉——指尖接触面积约 8-10mm，
 * 按压过程中接触点本身就会漂移，加上滚动容器的轻微惯性，8px 的圆
 * 几乎必然被越过。桌面鼠标是精确设备，8px 合理；手指不是。
 * 取 16px（≈ 4mm 物理位移）作为分界。
 */
export const DRAG_SLOP_TOUCH_PX = 16
/** 轻触的最长按住时间：超过它仍未位移，就不再算轻触。 */
export const TAP_MAX_MS = 320
/** 静止按住该时长后进入"长按已就绪"（视觉抬起）。 */
export const LONG_PRESS_MS = 380
/** 两次轻触的时间上限。 */
export const DOUBLE_TAP_MS = 280
/** 两次轻触的位置容差。 */
export const DOUBLE_TAP_DIST_PX = 28

/**
 * 触摸设备上，"拖动"是否需要一个前置的长按解锁。
 *
 * 起因：事件块占据时间轴的大部分面积。若手指落在块上纵向滑动就直接拖动块，
 * 用户就再也无法在块上滚动时间轴——两个手势争抢同一个动作，必须定序。
 * 规则改为：触摸设备先按住 LONG_PRESS_MS 进入 armed（视觉抬起），
 * 之后的位移才算拖动；未 armed 时的位移交还给浏览器做滚动，
 * 浏览器随即派发 pointercancel，状态机收到即中止。
 *
 * 鼠标不受此限：桌面没有"滚动与拖动争抢"的问题（滚轮负责滚动），
 * 保持即点即拖。
 */
export function requiresLongPressToDrag(pointerType: string): boolean {
  return pointerType !== 'mouse'
}

/** 按指针类型选取拖动阈值。 */
export function slopFor(pointerType: string): number {
  return pointerType === 'mouse' ? DRAG_SLOP_PX : DRAG_SLOP_TOUCH_PX
}

/**
 * 触屏/笔的轻触之后，浏览器会补发一串兼容性鼠标事件，且**时序在 `pointerup` 之后**
 * （实测 Chrome/Edge：`pointerup → touchend → mousedown → mouseup → click`）。
 * 其中 `mousedown` 的默认动作是"把焦点移到被点中的元素"，而此刻点击位置下的元素
 * 可能正是刚由本次双击打开、并依赖 `blur` 判定生命周期的输入框——结果为输入框
 * 挂载后立刻失焦并被卸载（现象是"输入框闪现即消失"）。
 *
 * 因此需要在这个窗口内让紧随其后的那一次 `mousedown` 失去默认动作。
 */
export const COMPAT_MOUSE_GUARD_MS = 400

/**
 * 只有触屏与笔会产生补发的兼容性鼠标事件；鼠标自身就是原生序列，不能拦截，
 * 否则会阻断正常的"点击聚焦"行为。
 */
export function emitsCompatMouse(pointerType: string): boolean {
  return pointerType !== 'mouse'
}

/**
 * 单指针相位。`pressed` 只记录按下点与按下时刻；位移是否发生由 `moved` 标记，
 * 这样判据函数无需知道指针当前位置就能判断"是否还算静止"。
 */
export type PointerPhase =
  | { kind: 'pressed'; id: number; x: number; y: number; t: number; moved: boolean }
  | { kind: 'dragging'; id: number; from: Point; last: Point }
  | null

export interface DoubleTapOptions {
  maxMs?: number
  maxDist?: number
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** 位移是否超过拖动阈值（默认 8px）。 */
export function exceedsSlop(from: Point, to: Point, slop: number = DRAG_SLOP_PX): boolean {
  return distance(from, to) > slop
}

/**
 * 长按判据：仍处于按下态、未发生位移、且按住时长已达阈值。
 * 抬起手指时若本函数仍为 true，语义是"长按抬起 → 打开菜单"。
 */
export function isLongPress(
  phase: PointerPhase,
  now: number,
  threshold: number = LONG_PRESS_MS
): boolean {
  if (!phase || phase.kind !== 'pressed') return false
  if (phase.moved) return false
  return now - phase.t >= threshold
}

/** 轻触判据：按下后未位移，且在 TAP_MAX_MS 内抬起。 */
export function isTap(phase: PointerPhase, now: number, maxMs: number = TAP_MAX_MS): boolean {
  if (!phase || phase.kind !== 'pressed') return false
  if (phase.moved) return false
  return now - phase.t <= maxMs
}

/**
 * 双击判据：与上一次轻触的时间间隔与位移都在阈值内。
 * 不依赖原生 `dblclick`——该事件在触屏上由浏览器合成，受 `touch-action`、
 * 两次轻触的间隔与位移、以及 `preventDefault` 影响，各浏览器行为不一致。
 */
export function isDoubleTap(
  prev: TimedPoint | null,
  next: TimedPoint,
  options: DoubleTapOptions = {}
): boolean {
  if (!prev) return false
  const maxMs = options.maxMs ?? DOUBLE_TAP_MS
  const maxDist = options.maxDist ?? DOUBLE_TAP_DIST_PX
  if (next.t - prev.t > maxMs) return false
  return distance(prev, next) <= maxDist
}
