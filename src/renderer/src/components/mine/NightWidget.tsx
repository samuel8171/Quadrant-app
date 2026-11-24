import { Moon } from 'lucide-react'
import type { MoneyStats } from '../../../../shared/money'
import MoneyMetricCard from './MoneyMetricCard'

interface Props {
  stats: MoneyStats
  hasRecords: boolean
}

export default function NightWidget({ stats, hasRecords }: Props): JSX.Element {
  const percent = Math.round(stats.nightRatio * 100)
  return (
    <MoneyMetricCard
      label="深夜时长"
      value={hasRecords ? String(stats.nightMin) : '—'}
      unit={hasRecords ? '分钟' : undefined}
      detail={hasRecords ? `占实际时长 ${percent}%` : '暂无记录'}
      icon={<Moon size={22} />}
    />
  )
}
