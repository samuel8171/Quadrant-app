import { describe, expect, it } from 'vitest'
import { MOBILE_BREAKPOINT, MOBILE_NAV_MIN_HEIGHT, TOUCH_TARGET_MIN } from '../src/renderer/src/lib/responsiveLayout'

describe('responsive layout metrics', () => {
  it('defines mobile breakpoint and safe-area navigation metrics', () => {
    expect(MOBILE_BREAKPOINT).toBe(767)
    expect(MOBILE_NAV_MIN_HEIGHT).toBeGreaterThanOrEqual(64)
  })

  it('uses the Apple minimum touch target', () => {
    expect(TOUCH_TARGET_MIN).toBe(44)
  })
})
