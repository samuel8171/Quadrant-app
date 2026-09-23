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

  it('keeps the mobile goal check touch target at 44px with a visible ring', () => {
    // 触摸区仍是 44px（Apple 最小触摸目标）。
    expect(mobileCss).toMatch(/\.goal-check\s*\{[\s\S]*width:\s*44px[\s\S]*height:\s*44px/)
    /*
     * 可见圆环 20px：10px 放不下「环 2px + 间隙 1.5px」这层细节会糊成一坨，
     * 故与桌面端统一为 20px。几何取自设计参考图（核/外径 0.68、环厚/外径 0.09）。
     */
    expect(mobileCss).toMatch(/\.goal-check \.checkmark\s*\{\s*width:\s*20px;\s*height:\s*20px/)
  })

  it('renders the goal check as a circle with a core-gap-ring structure', () => {
    // 圆形而非圆角方块。
    expect(themeCss).toMatch(/\.checkmark\s*\{[\s\S]*border-radius:\s*50%/)
    // 圆环由 border 撑起，勾选后内核填充，间隙用 inset 阴影（页面底色）留出。
    expect(themeCss).toMatch(/\.checkmark\s*\{[\s\S]*border:\s*2px solid var\(--text-secondary\)/)
    expect(themeCss).toMatch(
      /\.goal-check input:checked \+ \.checkmark\s*\{[\s\S]*background:\s*var\(--accent\)[\s\S]*inset 0 0 0 1\.5px/
    )
    // 勾选态必须仍是原蓝色，不能变成参考图的橙色。
    expect(themeCss).toMatch(/\.goal-check input:checked \+ \.checkmark\s*\{[\s\S]*var\(--accent\)/)
  })

  it('lets mobile subtask cards grow with content and caps their width', () => {
    expect(mobileCss).toMatch(/\.group-grid\s*\{[\s\S]*max-width:\s*1000px[\s\S]*grid-auto-rows:\s*max-content/)
    expect(mobileCss).toMatch(/\.group-card\s*\{[\s\S]*height:\s*max-content/)
  })

  it('keeps mobile page top padding clear of the status-bar blur feather', () => {
    /*
     * 顶部内边距必须是 24px + safe-top，而不是 12px + safe-top。
     * env(safe-area-inset-top) 是安全区的**硬边界**，iOS 状态栏毛玻璃在边界
     * 之下还有 8~14px 羽化带；只避让到边界（12px + safe-top）时标题墨迹
     * 恰好落进羽化区，真机上看就是"被虚化了一部分"。
     */
    expect(mobileCss).toMatch(
      /\.page,[\s\S]*?\.day-page\s*\{[\s\S]*padding:\s*calc\(24px \+ var\(--safe-top\)\)/
    )
    // 四象限悬浮页头是绝对定位，不随容器 padding 走，必须同样多留 12px。
    expect(mobileCss).toMatch(/\.quadrant-header\s*\{[\s\S]*top:\s*calc\(24px \+ var\(--safe-top\)\)/)
  })

  it('aligns the accent bar with the page title on every header variant', () => {
    // 移动端 .review-header 是 flex-start，3px 高的强调条会贴到标题上沿，
    // 必须自我居中，否则视觉上"没对齐"。
    expect(themeCss).toMatch(/\.title-underline\s*\{[\s\S]*align-self:\s*center/)
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

  it('keeps the mobile quadrant gesture hint aligned with the gesture vocabulary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/QuadrantPage.tsx'), 'utf8')
    // 手机端提示必须同时覆盖三件事，它们分别由位移阈值、长按阈值与自研双击判定实现：
    expect(source).toContain('拖动移动 · 长按菜单 · 双击新建')
    expect(source).toContain('mobile-only')
  })

  it('routes quadrant and day-view gestures through the shared kernel', () => {
    const quadrant = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/QuadrantPage.tsx'), 'utf8')
    const dayView = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/weekly/DayView.tsx'),
      'utf8'
    )
    // 禁止回退到"按 550ms 静止才算长按拖动"的旧实现，也禁止依赖原生 dblclick 做触屏双击。
    for (const source of [quadrant, dayView]) {
      expect(source).toContain('useCanvasGestures')
      expect(source).toMatch(/onPointerCancel/)
      expect(source).not.toMatch(/setTimeout\([\s\S]{0,120}?550/)
    }
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
