import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TrendPeriod } from '../../lib/moneyTrend'

interface Props {
  period: TrendPeriod
  rangeLabel: string
  canGoBack: boolean
  canGoForward: boolean
  onStep: (direction: -1 | 1) => void
  onPeriodChange: (period: TrendPeriod) => void
}

export default function TrendDateControl({ period, rangeLabel, canGoBack, canGoForward, onStep, onPeriodChange }: Props): JSX.Element {
  const isWeek = period === 'week'
  return (
    <div className="money-trend-controls">
      <div className="money-trend-navigation" role="group" aria-label="账目日期范围">
        <button type="button" aria-label={isWeek ? '上一周' : '上个月'} disabled={!canGoBack} onClick={() => onStep(-1)}><ChevronLeft size={16} /></button>
        <span className="money-trend-range">{rangeLabel}</span>
        <button type="button" aria-label={isWeek ? '下一周' : '下个月'} disabled={!canGoForward} onClick={() => onStep(1)}><ChevronRight size={16} /></button>
      </div>
      <div className="money-period-picker" role="group" aria-label="趋势周期">
        <button type="button" aria-pressed={isWeek} onClick={() => onPeriodChange('week')}>周</button>
        <button type="button" aria-pressed={!isWeek} onClick={() => onPeriodChange('month')}>月</button>
      </div>
    </div>
  )
}
