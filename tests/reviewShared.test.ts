import { describe, expect, it } from 'vitest'
import { clampReviewValue, percentLabel } from '../src/shared/review'

describe('review shared', () => {
  it('clamps review value to integer 0..10', () => {
    expect(clampReviewValue(3)).toBe(3)
    expect(clampReviewValue(3.7)).toBe(4)
    expect(clampReviewValue(-2)).toBe(0)
    expect(clampReviewValue(99)).toBe(10)
    expect(clampReviewValue(Number.NaN)).toBe(0)
  })

  it('formats percentage as 10n%', () => {
    expect(percentLabel(0)).toBe('0%')
    expect(percentLabel(1)).toBe('10%')
    expect(percentLabel(10)).toBe('100%')
  })
})
