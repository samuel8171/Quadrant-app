/**
 * 图片缩放的纯几何规则。
 *
 * **刻意与 `photoCompress.ts` 分开**：那边依赖 canvas / pica，是浏览器专属代码；
 * 这里只有算术，因此能被 `tsconfig.node.json` 覆盖的测试直接导入。
 * 若把 `targetSize` 留在 `photoCompress.ts`，测试就会把 DOM 依赖拖进 Node 侧的
 * 类型检查（`lib` 里没有 DOM），`tsc -p tsconfig.node.json` 会报一堆
 * `Cannot find name 'HTMLCanvasElement'`。
 *
 * 这与 `cloudValidation.ts` 从 `cloudSync2.ts` 拆出来的理由完全一致——
 * 见那个文件顶部的长注释。
 */

/** 长边超过该值才缩放；小于它的图原样保留（放大只会更糊，且白白增加体积）。 */
export const MAX_LONG_EDGE = 1600

/** 计算缩放后的目标尺寸：只缩不放，且保持长宽比。 */
export function targetSize(
  width: number,
  height: number,
  maxLongEdge: number = MAX_LONG_EDGE
): { width: number; height: number } {
  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) return { width, height }
  const ratio = maxLongEdge / longEdge
  // 至少留 1px，避免极端长条图算出 0 导致 canvas 抛错。
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  }
}
