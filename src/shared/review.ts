export function clampReviewValue(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(10, Math.max(0, Math.round(v)))
}

export function percentLabel(v: number): string {
  return `${clampReviewValue(v) * 10}%`
}
