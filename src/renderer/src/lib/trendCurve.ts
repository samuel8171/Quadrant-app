export interface TrendPoint {
  x: number
  y: number
}

interface TrendSegment {
  from: TrendPoint
  controlFrom: TrendPoint
  controlTo: TrendPoint
  to: TrendPoint
  interpolated: boolean
}

export function buildTrendCurve(values: readonly (number | null)[]): { points: TrendPoint[]; segments: TrendSegment[] } {
  const points = values.flatMap((y, x) => y !== null && Number.isFinite(y) ? [{ x, y }] : [])
  // Weighted harmonic slopes preserve the shape across irregular intervals. At an extremum
  // or the end of the recorded range, a horizontal tangent eases the change in direction.
  const slopes = points.map((point, index) => {
    const before = points[index - 1]
    const after = points[index + 1]
    if (!before || !after) return 0
    const leftWidth = point.x - before.x
    const rightWidth = after.x - point.x
    const left = (point.y - before.y) / leftWidth
    const right = (after.y - point.y) / rightWidth
    if (Math.sign(left) !== Math.sign(right) || left === 0) return 0
    const leftWeight = 2 * rightWidth + leftWidth
    const rightWeight = rightWidth + 2 * leftWidth
    return (leftWeight + rightWeight) / (leftWeight / left + rightWeight / right)
  })

  const segments = points.slice(1).map((to, index) => {
    const from = points[index]
    const width = to.x - from.x
    const min = Math.min(from.y, to.y)
    const max = Math.max(from.y, to.y)
    const clamp = (value: number): number => Math.min(max, Math.max(min, value))
    return {
      from,
      controlFrom: { x: from.x + width / 3, y: clamp(from.y + slopes[index] * width / 3) },
      controlTo: { x: to.x - width / 3, y: clamp(to.y - slopes[index + 1] * width / 3) },
      to,
      interpolated: width > 1
    }
  })

  return { points, segments }
}
