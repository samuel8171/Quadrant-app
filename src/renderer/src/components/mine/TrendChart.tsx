interface Props {
  /** 七个数据点，按周一→周日排序。娱币可为负（净变化：奖励为正、惩罚为负）。 */
  values: number[]
  /** 与 `values` 等长的横轴标签（本周的裸单字「一」…「日」）。 */
  labels: string[]
  /** 荧光配色：`tc` = 蓝色（时币）、`lt` = 淡粉（娱币）。 */
  accent: 'tc' | 'lt'
  /** 水平参考线（时币的日软上限）；不传则不画。 */
  baseline?: number
  ariaLabel: string
}

const W = 300
const H = 108
/** 上下各留一段内边距：光晕（feGaussianBlur）不会贴到 viewBox 边缘被裁掉。 */
const PAD_TOP = 16
const PAD_BOTTOM = 12
const PLOT_H = H - PAD_TOP - PAD_BOTTOM
/** 7 天等分：点居中于各自那一格，与下方 `.money-axis` 的 7 等分网格天然对齐。 */
const SLOT = W / 7

/**
 * 手写荧光折线（spec R2 §7 第 3 项）。**零依赖**，不用任何图表库。
 *
 * **荧光 = 双层描边**：先画一条更宽、半透明、被 `feGaussianBlur` 糊开的线作光晕，
 * 再在上面压一条细实线。SVG 框显式 `overflow: hidden`（见 theme.css），光晕被裁在
 * 卡片内、不会渗到相邻卡片；线本身保持锐利（光晕只垫在下面，不吃掉实线）。
 * 颜色走 `--trend`（tc=蓝=令牌 `--accent`，lt=淡粉=令牌 `--money-trend-lt`）。
 *
 * **每一处除法都先守零**：纵向映射的跨度 `span` 恒 > 0（全零时把上界顶到 1），
 * 所以 `y` 永远不会是 `NaN` / `Infinity`；非有限入参也先归零，免得一个坏数把整条线的
 * 属性污染成 "NaN"。
 *
 * 入场只做透明度淡入，且**包在 `prefers-reduced-motion: no-preference` 里**（见 theme.css）：
 * 系统开启「减弱动态效果」时不挂任何动画。
 */
export default function TrendChart({ values, labels, accent, baseline, ariaLabel }: Props): JSX.Element {
  // 非有限值归零：图表是视图模型的末端消费者，宁可画一条平线，也不让 "NaN" 进 SVG 属性。
  const vals = values.map((v) => (Number.isFinite(v) ? v : 0))

  // 值域：把 0 与参考线都纳入，再各留 15% 余量；全零时把上界顶到 1，保证 span > 0。
  const extremes = baseline === undefined ? vals : [...vals, baseline]
  let lo = Math.min(0, ...extremes)
  let hi = Math.max(0, ...extremes)
  if (hi > 0) hi *= 1.15
  if (lo < 0) lo *= 1.15
  if (hi - lo <= 0) hi = lo + 1
  const span = hi - lo

  const yOf = (value: number): number => PAD_TOP + ((hi - value) / span) * PLOT_H
  const xOf = (i: number): number => SLOT * i + SLOT / 2
  const points = vals.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')
  const glowId = `money-trend-glow-${accent}`

  return (
    <>
      <svg className={`money-trend money-trend-${accent}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        <defs>
          {/*
           * userSpaceOnUse + 外扩 24px：默认的 -10%/10% 以元素包围盒为基准，平线时
           * 包围盒很扁会把光晕裁成一条硬边。固定区域保证光晕圆润（根 SVG 仍会裁到卡片内）。
           */}
          <filter
            id={glowId}
            filterUnits="userSpaceOnUse"
            x={-24}
            y={-24}
            width={W + 48}
            height={H + 48}
          >
            <feGaussianBlur stdDeviation="3.4" />
          </filter>
        </defs>

        {baseline !== undefined && (
          <line x1="0" y1={yOf(baseline)} x2={W} y2={yOf(baseline)} className="money-trend-cap" />
        )}

        <polyline points={points} className="money-trend-glow" filter={`url(#${glowId})`} />
        <polyline points={points} className="money-trend-line" />
        {vals.map((v, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(v)} r="2.4" className="money-trend-dot" />
        ))}
      </svg>
      <div className="money-axis">
        {labels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
    </>
  )
}
