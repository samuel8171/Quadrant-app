import { describe, expect, it } from 'vitest'
import {
  REVIEW_GREEN_RED,
  REVIEW_RED_GREEN,
  reviewDirty
} from '../src/renderer/src/lib/reviewRules'

describe('reviewRules', () => {
  it('provides red-green and reversed green-red scales', () => {
    expect(REVIEW_RED_GREEN).toHaveLength(10)
    expect(REVIEW_GREEN_RED).toHaveLength(10)
    expect(REVIEW_GREEN_RED[0]).toBe('#8CD9C1')
    expect(REVIEW_GREEN_RED[9]).toBe('#C85C5C')
    expect(REVIEW_RED_GREEN[0]).toBe('#C85C5C')
    expect(REVIEW_RED_GREEN[9]).toBe('#8CD9C1')
  })

  it('detects dirty draft vs saved', () => {
    const a = { completion: 1, quality: 2, stress: 3, text: 'a' }
    expect(reviewDirty(a, a)).toBe(false)
    expect(reviewDirty(a, { ...a, text: 'b' })).toBe(true)
    expect(reviewDirty(a, { ...a, stress: 4 })).toBe(true)
  })
})
