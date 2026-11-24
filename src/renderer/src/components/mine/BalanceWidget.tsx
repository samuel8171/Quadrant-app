import type { MoneyStats } from '../../../../shared/money'
import MoneyIcon from '../money/MoneyIcon'
import { formatMoney, formatSignedMoney } from './formatMoney'
import MoneyMetricCard from './MoneyMetricCard'

export default function BalanceWidget({ stats }: { stats: MoneyStats }): JSX.Element {
  const overBudget = stats.spentTC > stats.weekTC
  const timeDetail = overBudget
    ? `超出 ${formatMoney(stats.spentTC - stats.weekTC)}`
    : `已用 ${formatMoney(stats.spentTC)}／${formatMoney(stats.weekTC)}`

  return (
    <>
      <MoneyMetricCard
        label="时币余额"
        value={formatMoney(stats.remainingTC)}
        detail={timeDetail}
        tone={overBudget ? 'negative' : undefined}
        icon={<MoneyIcon kind="tc" size={22} />}
      />
      <MoneyMetricCard
        label="娱币余额"
        value={formatMoney(stats.remainingLT)}
        detail={`净变化 ${formatSignedMoney(stats.spentLT)}`}
        tone={stats.remainingLT < 0 ? 'negative' : undefined}
        icon={<MoneyIcon kind="lt" size={22} />}
      />
    </>
  )
}
