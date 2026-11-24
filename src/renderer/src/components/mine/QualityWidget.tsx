import { ListChecks } from 'lucide-react'
import type { MoneyStats } from '../../../../shared/money'
import MoneyMetricCard from './MoneyMetricCard'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

const SEGMENTS = [
  { key: 'efficient', label: '高效', cls: 'money-seg-efficient' },
  { key: 'normal', label: '正常', cls: 'money-seg-normal' },
  { key: 'inefficient', label: '低效', cls: 'money-seg-inefficient' },
  { key: 'missed', label: '未完成', cls: 'money-seg-missed' }
] as const

function qualityTotals({ efficient, normal, inefficient, missed }: MoneyStats['quality']): { completed: number; total: number } {
  const completed = efficient + normal + inefficient
  return { completed, total: completed + missed }
}

export function CompletionMetric({ stats }: Props): JSX.Element {
  const { completed, total } = qualityTotals(stats.quality)
  return (
    <MoneyMetricCard
      label="执行完成"
      value={total ? `${Math.round(completed / total * 100)}%` : '—'}
      detail={total ? `${completed}／${total} 条` : '暂无记录'}
      icon={<ListChecks size={22} />}
    />
  )
}

export default function QualityWidget({ stats }: Props): JSX.Element {
  const { total } = qualityTotals(stats.quality)
  return (
    <WidgetShell title="执行质量" className="money-widget--quality" action={<span className="money-widget-subtitle">{total} 条</span>}>
      {total > 0 ? (
        <>
          <div className="money-quality-track" aria-hidden="true">
            {SEGMENTS.filter(({ key }) => stats.quality[key] > 0).map(({ key, cls }) => (
              <span key={key} className={cls} style={{ flexGrow: stats.quality[key] }} />
            ))}
          </div>
          <dl className="money-quality-counts">
            {SEGMENTS.map(({ key, label, cls }) => (
              <div key={key} className={cls}><dt>{label}</dt><dd>{stats.quality[key]}</dd></div>
            ))}
          </dl>
        </>
      ) : <p className="money-quality-empty">本周暂无可分类条目</p>}
    </WidgetShell>
  )
}
