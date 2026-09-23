import { describe, it, expect } from 'vitest'
import { MAX_LONG_EDGE, targetSize } from '../src/shared/photoRules'
import { MAX_EVENT_PHOTOS } from '../src/shared/types'

/**
 * 只测**纯几何**部分。
 *
 * `compressPhoto` 本身依赖 canvas/pica，在 node 环境跑不了——那是浏览器集成测试
 * 的范畴（见 `tmp/vt/photo-probe.mjs`）。但 `targetSize` 是决定"压完还剩多少像素"
 * 的那个判据，也是唯一会算错导致图片变形的环节，值得单独覆盖。
 *
 * 这里从 `shared/photoRules` 导入而非 `lib/photoCompress`：后者含 DOM 依赖，
 * 拖进来会让 `tsc -p tsconfig.node.json`（`lib` 无 DOM）报错。
 */
describe('photo compression sizing', () => {
  it('scales the long edge down to the cap', () => {
    // 手机竖拍 12MP 是最典型的输入。
    const portrait = targetSize(3024, 4032)
    expect(Math.max(portrait.width, portrait.height)).toBe(MAX_LONG_EDGE)
    expect(portrait.width).toBe(1200)
    expect(portrait.height).toBe(1600)
  })

  it('scales landscape by its long edge too', () => {
    const landscape = targetSize(4032, 3024)
    expect(landscape.width).toBe(1600)
    expect(landscape.height).toBe(1200)
  })

  it('keeps aspect ratio within rounding tolerance', () => {
    const { width, height } = targetSize(3024, 4032)
    // 只允许取整带来的 1px 级偏差。
    expect(Math.abs(width / height - 3024 / 4032)).toBeLessThan(0.001)
  })

  it('never upscales a small image', () => {
    // 放大只会更糊，且白白增加体积。
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(targetSize(MAX_LONG_EDGE, 100)).toEqual({ width: MAX_LONG_EDGE, height: 100 })
  })

  it('handles extreme aspect ratios without producing a zero dimension', () => {
    // 超长图（长截图）缩放后短边可能算出 0，会让 canvas 直接抛错。
    const tall = targetSize(100, 8000)
    expect(tall.width).toBeGreaterThanOrEqual(1)
    expect(tall.height).toBe(MAX_LONG_EDGE)
  })

  it('caps an event at three photos', () => {
    // 上限是版式与存储共同决定的契约，改动必须是显式行为。
    expect(MAX_EVENT_PHOTOS).toBe(3)
  })
})
