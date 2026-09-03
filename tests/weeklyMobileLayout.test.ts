import { describe, expect, it } from 'vitest'
import {
  MOBILE_WEEK_DAY_MIN_WIDTH,
  MOBILE_WEEK_END_MIN,
  MOBILE_WEEK_START_MIN
} from '../src/renderer/src/lib/weeklyMobileLayout'

describe('weekly mobile layout metrics', () => {
  it('uses the mobile weekly timeline window', () => {
    expect(MOBILE_WEEK_START_MIN).toBe(420)
    expect(MOBILE_WEEK_END_MIN).toBe(1440)
    expect(MOBILE_WEEK_DAY_MIN_WIDTH).toBeGreaterThanOrEqual(96)
  })
})
