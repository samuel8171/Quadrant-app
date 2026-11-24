import type { MoneyStats } from '../../../../shared/money'
import { formatMoney } from './formatMoney'
import WidgetShell from './WidgetShell'

const TIER_LABELS = ['无扣减', '轻度扣减', '中度扣减', '重度扣减'] as const

export default function PenaltyWidget({ stats }: { stats: MoneyStats }): JSX.Element {
  const tier = stats.penaltyTier
  const over = Math.max(0, stats.spentTC - stats.weekTC)
  return (
    <WidgetShell
      title="下周额度预估"
      className="money-widget--forecast"
      action={<span className={`money-forecast-status${tier > 0 ? ' is-penalized' : ''}`}>{TIER_LABELS[tier]}</span>}
    >
      <dl className="money-forecast-amounts">
        <div><dt>时币</dt><dd>{formatMoney(stats.nextWeekTC)}</dd></div>
        <div><dt>娱币</dt><dd>{formatMoney(stats.nextWeekLT)}</dd></div>
      </dl>
      <p className="money-widget-foot">{over > 0 ? `本周已超支 ${formatMoney(over)} 时币` : '按当前账目推算'}</p>
    </WidgetShell>
  )
}
