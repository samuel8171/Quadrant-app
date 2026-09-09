import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOBILE_BREAKPOINT, MOBILE_NAV_MIN_HEIGHT, TOUCH_TARGET_MIN } from '../src/renderer/src/lib/responsiveLayout'

const themeCss = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/theme.css'), 'utf8')
const mobileCss = themeCss.slice(themeCss.indexOf('@media (max-width: 767px)'))

describe('responsive layout metrics', () => {
  it('defines mobile breakpoint and safe-area navigation metrics', () => {
    expect(MOBILE_BREAKPOINT).toBe(767)
    expect(MOBILE_NAV_MIN_HEIGHT).toBeGreaterThanOrEqual(64)
  })

  it('uses the Apple minimum touch target', () => {
    expect(TOUCH_TARGET_MIN).toBe(44)
  })

  it('keeps mobile sheets and controls clear of the bottom navigation', () => {
    expect(mobileCss).toMatch(/\.modal-mask\s*\{[\s\S]*z-index:\s*120/)
    expect(mobileCss).toMatch(/\.review-slider-track\s*\{[\s\S]*height:\s*44px/)
    expect(mobileCss).toMatch(/\.day-canvas\s*\{[\s\S]*touch-action:\s*pan-y/)
  })

  it('keeps the weekly ruler pinned while the day columns scroll', () => {
    expect(mobileCss).toMatch(/\.week-gutter\s*\{[\s\S]*position:\s*sticky/)
    expect(themeCss).toMatch(/week-today-dot/)
  })

  it('keeps mobile goal checks compact while preserving a touch target', () => {
    expect(mobileCss).toMatch(/\.goal-check\s*\{[\s\S]*width:\s*44px[\s\S]*height:\s*44px/)
    expect(mobileCss).toMatch(/\.goal-check \.checkmark\s*\{[\s\S]*width:\s*10px[\s\S]*height:\s*10px/)
  })

  it('lets mobile subtask cards grow with content and caps their width', () => {
    expect(mobileCss).toMatch(/\.group-grid\s*\{[\s\S]*max-width:\s*1000px[\s\S]*grid-auto-rows:\s*max-content/)
    expect(mobileCss).toMatch(/\.group-card\s*\{[\s\S]*height:\s*max-content/)
  })

  it('sets mobile day timeline minimum height and review slider layout', () => {
    expect(mobileCss).toMatch(/\.day-canvas\s*\{[\s\S]*min-height:\s*370px/)
    expect(mobileCss).toMatch(/\.review-sliders\s*\{[\s\S]*height:\s*150px/)
    expect(mobileCss).toMatch(/\.review-slider-value\s*\{\s*display:\s*none;/)
  })

  it('stops preset action buttons from opening the card editor', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/weekly/PresetPanel.tsx'), 'utf8')
    expect(source).toMatch(/stopPropagation\(\)/)
  })

  it('keeps the mobile quadrant gesture hint aligned with touch creation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/QuadrantPage.tsx'), 'utf8')
    expect(source).toContain('拖动画布 · 双指缩放 · 双击新建')
  })

  it('defines a compact tablet layout between mobile and desktop', () => {
    expect(themeCss).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023px\)/)
    expect(themeCss).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*\.sidebar\s*\{[\s\S]*width:\s*176px/
    )
    expect(themeCss).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*\.week-grid\s*\{[\s\S]*grid-template-columns:\s*46px/
    )
  })
})
