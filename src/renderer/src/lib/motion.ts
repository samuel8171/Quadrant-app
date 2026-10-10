/**
 * 应用内「块级元素的增 / 删 / 让位」的统一动效参数。
 *
 * 为什么放在共享模块：这套数值会被**多处** `useAutoAnimate` 与幽灵卡片的手写
 * `transition` 同时使用（预设排序、目标增删、象限卡片…）。散在各组件里就会各自
 * 漂移 —— 本项目已经因为「几何常量分两处」吃过亏，节奏类的常量同理。
 *
 * ⭐⭐ **一条硬规矩：增删/让位只走 `transform` 与 `opacity`（WAAPI 合成器动画）。**
 * 不要用 `grid-template-rows` / `height` / `margin` 这类**布局动画**做移出：
 * 它们每帧都要重算轨道、重排整列并重绘，卡片一多就明显掉帧 ——
 * 2026-10-10 用户报的「现有动画会卡顿」正是 `.goal-card-slot` 上那条
 * `grid-template-rows: 1fr → 0fr` 过渡（已删除）。auto-animate 用的是
 * `el.animate()`，全程不触发布局，且 `prefers-reduced-motion` 时它会自我禁用。
 */

/** 增删与让位的时长。⚠️ auto-animate 的**新增**动画用它的 1.5 倍（库内写死）。 */
export const MOTION_MS = 200

/**
 * 先快后缓 = "迅速让开、轻轻停住"。
 * 与 auto-animate 的 `easing` 选项同源，也喂给幽灵卡片的内联 `transition`。
 */
export const MOTION_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** 落位（拖拽松手后归位）比让位略短促一点，避免拖泥带水。 */
export const MOTION_SETTLE_MS = 180
