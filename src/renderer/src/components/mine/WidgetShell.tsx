import type { CSSProperties, ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  /** 桌面端跨几列（12 栏基准）：两个 hero 传 6，四个小卡传 3。手机档恒为整行。 */
  span: number
  children: ReactNode
}

/**
 * 金钱小组件的卡片外壳：标题 + 可选副标题 + 内容。
 *
 * **刻意不玻璃化**（不加 `.gs-*`、不加 `backdrop-filter`，理由见 spec 12.4）：
 * 每新增一个材质宿主都要重新满足「祖先链上不能有 fixed / sticky / 非 auto 的 z-index」
 * 这条约束，本项目为此返工过多次。普通面板色 + `var(--border)` 已经够用，
 * 玻璃化是后续的可选项，不在本期范围内。
 *
 * 跨栏数走 CSS 变量 `--money-span` 而不是内联 `grid-column`：**内联样式的优先级高于
 * 媒体查询**，写成内联就没法在手机档用一条规则改成整行。`--money-span` 在
 * `theme.css` 的 `.money-widget` 里被消费（`grid-column: span var(--money-span)`）。
 */
export default function WidgetShell({ title, subtitle, span, children }: Props): JSX.Element {
  return (
    <section className="money-widget" style={{ '--money-span': span } as CSSProperties}>
      <header className="money-widget-head">
        <h3 className="money-widget-title">{title}</h3>
        {subtitle && <p className="money-widget-subtitle">{subtitle}</p>}
      </header>
      <div className="money-widget-body">{children}</div>
    </section>
  )
}
