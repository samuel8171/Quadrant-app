/**
 * 预设排序的**纯几何**部分。
 *
 * 单独成模块的理由与 `gestureMachine` 一致：拖拽的判定是"给定若干矩形与一个指针
 * 坐标，算出落点"，把它写成只吃数字的纯函数就能单测；而指针捕获、`getBoundingClientRect`
 * 这些浏览器 API 留在组件里。这个项目里凡是"看起来像数学"的逻辑都不与 DOM 同住
 * （见 `AGENTS.md` 的"纯逻辑别与顶层有副作用的模块同文件"）。
 */

/** 排序轴。预设列表在桌面端是纵向、在手机抽屉里是横向，两者共用同一套判定。 */
export type Axis = 'x' | 'y'

export interface DropTarget {
  id: string
  /** 沿本轴方向的起始坐标。坐标系任意，只要同一批矩形取自同一次测量。 */
  start: number
  /** 沿本轴方向的尺寸。 */
  size: number
}

/**
 * 由指针沿轴坐标解出"插到第几位"。
 *
 * 返回的是**剔除被拖项之后**的插入下标，取值 `0..others.length`：
 * - `0` = 插到最前；
 * - `others.length` = 追加到最后。
 *
 * 判据是"指针越过某张卡片的**中线**"——用中线而不是边缘，才能让"拖到哪一张的
 * 后半段就排到它后面"符合直觉。列表为空（或只剩被拖项）时返回 0。
 *
 * 刻意**不**在拖动过程中重排 DOM：那样被拖的元素会跟着重排跳到手指下面，
 * 观感是"卡片在打架"。调用方改成画一条插入位置指示线，抬手时才提交。
 */
export function resolveDropIndex(
  targets: DropTarget[],
  draggedId: string,
  pointer: number
): number {
  const others = targets.filter((t) => t.id !== draggedId)
  for (let i = 0; i < others.length; i++) {
    if (pointer < others[i].start + others[i].size / 2) return i
  }
  return others.length
}

/**
 * 把 `id` 移到下标 `to`（`to` 是**移动之后**的目标下标，按原数组语义）。
 *
 * `to` 会被夹到合法区间；`id` 不在数组里、或夹取后位置未变时**原样返回同一个数组**
 * （调用方据此短路掉无谓的落盘）。上移/下移按钮与拖拽提交都走这里，两条路径的顺序
 * 语义因此完全一致。
 */
export function moveWithin(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids
  const clamped = Math.max(0, Math.min(ids.length - 1, to))
  if (clamped === from) return ids
  const next = [...ids]
  next.splice(from, 1)
  next.splice(clamped, 0, id)
  return next
}

/**
 * 由「插入下标 + 被拖项 id」算出完整的新顺序。
 *
 * 与 `resolveDropIndex` 配对使用：`index` 是它在**剔除被拖项之后**的坐标系里的值，
 * 所以这里也先剔除再插入，两处的口径必须一致——否则拖到最前/最后会差一位。
 */
export function orderAfterDrop(ids: string[], draggedId: string, index: number): string[] {
  const others = ids.filter((id) => id !== draggedId)
  const clamped = Math.max(0, Math.min(others.length, index))
  const next = [...others]
  next.splice(clamped, 0, draggedId)
  return next
}
