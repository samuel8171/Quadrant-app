import type { ReactNode } from 'react'
import DashboardGlass from './DashboardGlass'

interface Props {
  title: string
  subtitle?: string
  className?: string
  action?: ReactNode
  children: ReactNode
}

export default function WidgetShell({ title, subtitle, className = '', action, children }: Props): JSX.Element {
  return (
    <section className={`money-widget ${className}`.trim()}>
      <DashboardGlass />
      <header className="money-widget-head">
        <div>
          <h3 className="money-widget-title">{title}</h3>
          {subtitle && <p className="money-widget-subtitle">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="money-widget-body">{children}</div>
    </section>
  )
}
