export const MOBILE_WEEK_START_MIN = 420
export const MOBILE_WEEK_END_MIN = 1440
export const MOBILE_WEEK_DAY_MIN_WIDTH = 96

export function shouldCreateOnCanvasClick(
  pointerType: string | undefined,
  detail: number,
  wasDragging: boolean
): boolean {
  return pointerType === 'touch' && detail === 1 && !wasDragging
}

export function shouldUsePresetOnTap(viewportWidth: number): boolean {
  return viewportWidth <= 767
}
