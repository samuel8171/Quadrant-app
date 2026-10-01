interface Props {
  kind: 'tc' | 'lt'
  /** 边长（px）。SVG 是正方形 viewBox，等比缩放到该值。 */
  size?: number
}

/**
 * 两种货币的手写小图标（spec R2 §7 第 1 项）。
 *
 * 两枚标记**只靠形状区分**，颜色一律走 `currentColor`：
 * - `tc`（时币）＝ 表盘（描边圆 + 两根指针），读作「时间」；
 * - `lt`（娱币）＝ 四角星芒（实心），读作「消遣 / 娱乐」。
 *
 * 不写死任何 `fill` / `stroke` 颜色，是因为图标会出现在深浅不同的底色上：
 * 余额卡里它跟着 `var(--text)`（白），日结行里跟着 `var(--text-secondary)`（灰），
 * 事件块里又落在事件色半透明底上。让颜色由外层文字色决定，三处都不需要各自特判。
 *
 * 用 16×16 的坐标系而不是 24：`size` 的实际取值是 11–22px，16 的坐标系在
 * 12px 附近几乎是 1:1，指针那类细线不会被缩放吃掉。描边宽度取 1.5（约 0.09 边长），
 * 缩到 11px 仍有约 1px 的实线，不糊。
 *
 * 装饰性图形：语义由相邻文字（「时币剩余」/「娱币剩余」/「币」/「LT」）承担，
 * 因此 `aria-hidden`，读屏不会读出两个空 SVG。
 */
export default function MoneyIcon({ kind, size = 16 }: Props): JSX.Element {
  return (
    <svg
      className={`money-icon money-icon-${kind}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'tc' ? (
        <>
          {/* 表盘：fill="none" 是必须的 —— 否则默认黑色填充会盖住描边。 */}
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {/* 指针：12 点 → 圆心 → 4 点方向，圆头收尾。 */}
          <path
            d="M8 4.4 V8 L10.7 9.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        /* 四角星芒：四个凹入的尖角，实心填充在小尺寸下比描边更清晰。 */
        <path
          d="M8 1.4 C8.55 5.15 10.85 7.45 14.6 8 C10.85 8.55 8.55 10.85 8 14.6 C7.45 10.85 5.15 8.55 1.4 8 C5.15 7.45 7.45 5.15 8 1.4 Z"
          fill="currentColor"
        />
      )}
    </svg>
  )
}
