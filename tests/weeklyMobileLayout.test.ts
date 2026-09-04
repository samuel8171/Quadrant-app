import { describe, expect, it } from 'vitest'
import {
  MOBILE_WEEK_DAY_MIN_WIDTH,
  MOBILE_WEEK_END_MIN,
  MOBILE_WEEK_START_MIN,
  shouldCreateOnCanvasClick,
  shouldUsePresetOnTap
} from '../src/renderer/src/lib/weeklyMobileLayout'

describe('weekly mobile layout metrics', () => {
  it('uses the mobile weekly timeline window', () => {
    expect(MOBILE_WEEK_START_MIN).toBe(420)
    expect(MOBILE_WEEK_END_MIN).toBe(1440)
    expect(MOBILE_WEEK_DAY_MIN_WIDTH).toBeGreaterThanOrEqual(96)
  })

  it('creates events only for a single touch tap that was not a drag', () => {
    expect(shouldCreateOnCanvasClick('touch', 1, false)).toBe(true)
    expect(shouldCreateOnCanvasClick('mouse', 1, false)).toBe(false)
    expect(shouldCreateOnCanvasClick('touch', 2, false)).toBe(false)
    expect(shouldCreateOnCanvasClick('touch', 1, true)).toBe(false)
  })

  it('uses a preset tap as event creation only in the mobile breakpoint', () => {
    expect(shouldUsePresetOnTap(767)).toBe(true)
    expect(shouldUsePresetOnTap(375)).toBe(true)
    expect(shouldUsePresetOnTap(768)).toBe(false)
  })
})
