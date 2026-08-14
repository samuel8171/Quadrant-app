import { describe, expect, it } from 'vitest'
import { withAlpha } from '../src/renderer/src/lib/color'

describe('color', () => {
  it('converts hex to rgba with the given alpha', () => {
    expect(withAlpha('#8AB4F8', 0.18)).toBe('rgba(138, 180, 248, 0.18)')
    expect(withAlpha('#E8A0A0', 0.55)).toBe('rgba(232, 160, 160, 0.55)')
    expect(withAlpha('#A9C49C', 0)).toBe('rgba(169, 196, 156, 0)')
  })

  it('normalizes a missing hash prefix', () => {
    expect(withAlpha('8AB4F8', 0.5)).toBe('rgba(138, 180, 248, 0.5)')
  })
})
