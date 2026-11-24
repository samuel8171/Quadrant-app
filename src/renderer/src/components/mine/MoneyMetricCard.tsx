import type { ReactNode } from 'react'
import DashboardGlass from './DashboardGlass'

interface Props {
  label: string
  value: string
  unit?: string
  detail: string
  tone?: 'negative'
  icon: ReactNode
}

export default function MoneyMetricCard({ label, value, unit, detail, tone, icon }: Props): JSX.Element {
  return (
    <section className="money-widget money-metric">
      <DashboardGlass />
      <div className="money-metric-copy">
        <h3>{label}</h3>
        <div className={`money-metric-value${tone === 'negative' ? ' is-negative' : ''}`}>
          <strong>{value}</strong>{unit && <span>{unit}</span>}
        </div>
        <p>{detail}</p>
      </div>
      <span className="money-metric-icon" aria-hidden="true">{icon}</span>
    </section>
  )
}
