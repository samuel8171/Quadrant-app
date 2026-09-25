import { create } from 'zustand'

/*
 * ============================================================ 液态玻璃外观设置
 *
 * 参数名与语义**一一对应 liquid-glass-react 的 props**，不做二次封装改名——
 * 上游库一旦升级、或需要对着它的文档排查，命名一致能省掉一次翻译。
 *
 * 持久化走 localStorage 而不是 AppData，理由是**外观属于设备级偏好**：
 *   · 引擎不同 → 可调项不同。Chromium 能调折射，WebKit 只能调模糊与圆角，
 *     一套数值同步过去，其中一半在另一台设备上是无效的。
 *   · 尺寸不同 → 合适的位移与圆角不同。390px 的手机与 1440px 的桌面
 *     共用 118 的位移量必然有一端不合适。
 *   · 代价：不跨设备同步。这是刻意的取舍，不是遗漏。
 *
 * 另一层考虑：写进 AppData 就要同时改 `shared/types.ts` 与
 * `platformApi.validAppData` 两处校验，漏一处会静默丢字段；而外观设置
 * 完全没有跨端同步的价值，不值得去碰那条最易出错的链路。
 */

export type RefractionMode = 'standard' | 'polar' | 'prominent' | 'shader'

/**
 * 渲染引擎。只区分「能折射」与「不能折射」两档，不区分具体浏览器：
 * 目标是**能力**而不是品牌——Firefox 与 Safari 在这件事上是同一档。
 */
export type GlassEngine = 'chromium' | 'fallback'

export interface GlassSettings {
  /** 折射模式。仅 Chromium 生效 */
  mode: RefractionMode
  /** 边缘位移强度。仅 Chromium 生效 */
  displacementScale: number
  /** 背景模糊量。库的语义是系数，实际像素 = 基础值 + 本值 × 32 */
  blurAmount: number
  /** 背景饱和度百分比。两引擎均生效 */
  saturation: number
  /** RGB 通道分离强度。仅 Chromium 生效 */
  aberrationIntensity: number
  /** 元件朝光标方向的弹性位移。仅 Chromium 生效 */
  elasticity: number
  /** 圆角像素。两引擎均生效 */
  cornerRadius: number
  /** 引擎覆盖，用于在桌面浏览器里预览 iOS 降级效果 */
  forceEngine: 'auto' | GlassEngine
}

export const GLASS_DEFAULTS: GlassSettings = {
  mode: 'standard',
  displacementScale: 118,
  blurAmount: 0.4,
  saturation: 140,
  aberrationIntensity: 3,
  elasticity: 0.1,
  cornerRadius: 32,
  forceEngine: 'auto'
}

export interface GlassSlider {
  key: keyof Pick<
    GlassSettings,
    | 'displacementScale'
    | 'blurAmount'
    | 'saturation'
    | 'aberrationIntensity'
    | 'elasticity'
    | 'cornerRadius'
  >
  label: string
  min: number
  max: number
  step: number
  /** 数值读数的后缀 */
  suffix: string
  /** 参数的作用说明 */
  hint: string
  /** 是否只有 Chromium 引擎会响应（降级引擎下置灰并标注） */
  chromiumOnly?: boolean
}

export const GLASS_SLIDERS: GlassSlider[] = [
  {
    key: 'displacementScale',
    label: '位移强度',
    min: 0,
    max: 200,
    step: 1,
    suffix: '',
    hint: '边缘把身后像素搬运的幅度，折射感的来源。0 等于关掉折射。',
    chromiumOnly: true
  },
  {
    key: 'blurAmount',
    label: '模糊量',
    min: 0,
    max: 1,
    step: 0.01,
    suffix: '',
    hint: '磨砂粗细。实际像素 = 4 + 本值 × 32，所以 0.4 等于 16.8px。',
  },
  {
    key: 'saturation',
    label: '饱和度',
    min: 100,
    max: 220,
    step: 1,
    suffix: '%',
    hint: '真实玻璃会把身后的颜色推浓。低于 100% 会显得像磨砂塑料。',
  },
  {
    key: 'aberrationIntensity',
    label: '色差',
    min: 0,
    max: 10,
    step: 0.1,
    suffix: '',
    hint: '边缘的 RGB 分离。仅在折射明显时才看得出来。',
    chromiumOnly: true
  },
  {
    key: 'elasticity',
    label: '弹性',
    min: 0,
    max: 1,
    step: 0.01,
    suffix: '',
    hint: '光标靠近时元件朝它拉伸的幅度。',
    chromiumOnly: true
  },
  {
    key: 'cornerRadius',
    label: '圆角',
    min: 0,
    max: 64,
    step: 1,
    suffix: 'px',
    hint: '玻璃切边圆角。胶囊形控件要接近其高度的一半。',
  }
]

export const GLASS_MODES: { value: RefractionMode; label: string; hint: string }[] = [
  { value: 'standard', label: 'Standard', hint: '标准折射贴图，最通用' },
  { value: 'polar', label: 'Polar', hint: '极坐标贴图，边缘弯曲更均匀' },
  { value: 'prominent', label: 'Prominent', hint: '位移幅度更大，折射更抢眼' },
  {
    value: 'shader',
    label: 'Shader',
    hint:
      '运行时逐像素计算位移贴图。实测代价：每打开一个玻璃层，主线程会卡住约 1.3 秒' +
      '（1280×800 下弹窗 468×708 的实测值，贴图越大越慢、与像素数成正比）。' +
      '除非确实要它那种边缘形状，否则不建议长期开着。'
  }
]

/**
 * 引擎判定。
 *
 * 判据是 liquid-glass-react 的核心机制：位移滤镜通过 `filter: url(#svg)`
 * 叠在 `backdrop-filter` 之上，**只有 Chromium 会这样合成**。
 * 上游 README 自己写着 「Safari and Firefox only partially support the effect
 * (displacement will not be visible)」。
 *
 * iOS 上所有浏览器（包括 CriOS / FxiOS / EdgiOS）都被强制使用 WebKit，
 * 所以必须**先判 iOS 再判品牌**——只看 UA 里的 "Chrome" 会把 iOS 版 Chrome
 * 误判成 Chromium，然后在真机上什么折射都看不到。
 */
export function detectGlassEngine(): GlassEngine {
  if (typeof navigator === 'undefined') return 'fallback'
  const ua = navigator.userAgent
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  if (/iPad|iPhone|iPod/.test(ua) || touchMac) return 'fallback'
  if (/firefox|fxios/i.test(ua)) return 'fallback'
  // Edge / Opera / Brave 都是 Chromium，一律归于可折射档
  if (/chrome|chromium|crios|edg\//i.test(ua)) return 'chromium'
  return 'fallback'
}

/** 库的模糊语义：overLight 为 false 时实际像素 = 4 + blurAmount × 32 */
export function effectiveBlurPx(blurAmount: number): number {
  return 4 + blurAmount * 32
}

const STORE_KEY = 'quadrant-glass-v1'

function read(): GlassSettings {
  if (typeof localStorage === 'undefined') return { ...GLASS_DEFAULTS }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...GLASS_DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<GlassSettings>
    return sanitize(parsed)
  } catch {
    return { ...GLASS_DEFAULTS }
  }
}

/**
 * 逐字段收敛。不能直接展开解析结果：localStorage 是用户可改的，
 * 一个字符串型数值传进库会拼出 `blur(NaNpx)`，整块玻璃静默失效。
 */
export function sanitize(input: Partial<GlassSettings>): GlassSettings {
  const out = { ...GLASS_DEFAULTS }
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

  out.mode = GLASS_MODES.some((m) => m.value === input.mode) ? (input.mode as RefractionMode) : 'standard'
  for (const s of GLASS_SLIDERS) {
    out[s.key] = clamp(num(input[s.key], GLASS_DEFAULTS[s.key]), s.min, s.max)
  }
  out.forceEngine =
    input.forceEngine === 'chromium' || input.forceEngine === 'fallback'
      ? input.forceEngine
      : 'auto'
  return out
}

/**
 * 把设置同步成根节点上的 CSS 自定义属性。
 *
 * 为什么需要：有些样式无法从组件侧传下去——例如底部 dock 的指示块圆角
 * 必须比容器圆角小一圈（`calc(var(--gs-radius) - 11px)`），而容器圆角
 * 是用户可调的设置值。走全局变量可以保持「一个数字一份定义」，
 * 不必在 CSS 里写死一个 21px 再靠注释提醒同步。
 */
export function syncGlassCssVars(s: GlassSettings): void {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  style.setProperty('--gs-radius', `${s.cornerRadius}px`)
  style.setProperty('--gs-blur', `${effectiveBlurPx(s.blurAmount)}px`)
  style.setProperty('--gs-sat', `${s.saturation}%`)
}

interface GlassStore extends GlassSettings {
  set: (patch: Partial<GlassSettings>) => void
  reset: () => void
  /** 真实生效的引擎（已把 forceEngine 覆盖算进去） */
  engine: GlassEngine
}

function persist(s: GlassSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    // 存不下不影响本次会话的观感，不做任何上报
  }
}

const pick = (s: GlassSettings): GlassSettings => ({
  mode: s.mode,
  displacementScale: s.displacementScale,
  blurAmount: s.blurAmount,
  saturation: s.saturation,
  aberrationIntensity: s.aberrationIntensity,
  elasticity: s.elasticity,
  cornerRadius: s.cornerRadius,
  forceEngine: s.forceEngine
})

export const useGlassStore = create<GlassStore>((set, get) => {
  const initial = read()
  syncGlassCssVars(initial)
  return {
    ...initial,
    engine: initial.forceEngine === 'auto' ? detectGlassEngine() : initial.forceEngine,
    set: (patch) => {
      set(patch)
      const next = pick(get())
      persist(next)
      syncGlassCssVars(next)
      if (patch.forceEngine !== undefined) {
        set({ engine: patch.forceEngine === 'auto' ? detectGlassEngine() : patch.forceEngine })
      }
    },
    reset: () => {
      const engine =
        GLASS_DEFAULTS.forceEngine === 'auto' ? detectGlassEngine() : GLASS_DEFAULTS.forceEngine
      set({ ...GLASS_DEFAULTS, engine })
      persist(GLASS_DEFAULTS)
      syncGlassCssVars(GLASS_DEFAULTS)
    }
  }
})

/** 供非 React 上下文（探针、日志）读取当前设置 */
export function currentGlassSettings(): GlassSettings {
  return pick(useGlassStore.getState())
}
