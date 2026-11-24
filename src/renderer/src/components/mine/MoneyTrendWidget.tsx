import { useMemo, useState } from 'react'
import type { MoneyState } from '../../../../shared/types'
import { buildMoneyTrend, shiftTrendDate, trendDateRange, type TrendPeriod } from '../../lib/moneyTrend'
import { formatMoney, formatSignedMoney } from './formatMoney'
import TrendChart, { describeTrendDay } from './TrendChart'
import TrendDateControl from './TrendDateControl'
import WidgetShell from './WidgetShell'

function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
}

function rangeLabel(period: TrendPeriod, start: string, end: string, today: string): string {
  const year = start.slice(0, 4)
  if (period === 'month') return `${year}年${Number(start.slice(5, 7))}月`
  const prefix = year === today.slice(0, 4) && year === end.slice(0, 4) ? '' : `${year}年`
  return `${prefix}${shortDate(start)}–${shortDate(end)}`
}

export default function MoneyTrendWidget({ money, today }: { money: MoneyState; today: string }): JSX.Element {
  const [period, setPeriod] = useState<TrendPeriod>('week')
  const [anchor, setAnchor] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const trend = useMemo(() => buildMoneyTrend(money, period, anchor ?? today, today), [money, period, anchor, today])
  const currentStart = trendDateRange(period, today).start
  const oldestStart = trendDateRange(period, trend.earliest).start
  const activeIndex = trend.days.findIndex(({ date }) => date === selectedDate)
  const currentIndex = trend.days.findIndex(({ date }) => date === today)
  const lastRecorded = trend.days.reduce((last, day, index) => day.status === 'recorded' ? index : last, 0)
  const selectedIndex = activeIndex >= 0 ? activeIndex : currentIndex >= 0 ? currentIndex : lastRecorded
  const active = trend.days[selectedIndex]

  const step = (direction: -1 | 1): void => {
    const target = shiftTrendDate(period, trend.start, direction)
    setAnchor(target === currentStart ? null : target)
    setSelectedDate(null)
  }

  const changePeriod = (next: TrendPeriod): void => {
    if (next === period) return
    const date = active.date > today ? today : active.date
    const target = trendDateRange(next, date).start
    setAnchor(target === trendDateRange(next, today).start ? null : target)
    setPeriod(next)
    setSelectedDate(date)
  }

  return (
    <WidgetShell
      title="账目趋势"
      className="money-widget--trend"
      action={<TrendDateControl
        period={period}
        rangeLabel={rangeLabel(period, trend.start, trend.end, today)}
        canGoBack={trend.start > oldestStart}
        canGoForward={trend.start < currentStart}
        onStep={step}
        onPeriodChange={changePeriod}
      />}
    >
      <div className="money-trend-legend">
        <span className="money-legend-time"><i aria-hidden="true" />时币消耗 <strong>{trend.recordedDays ? formatMoney(trend.spentTC) : '—'}</strong></span>
        <span className="money-legend-leisure"><i aria-hidden="true" />娱币净变化 <strong>{trend.recordedDays ? formatSignedMoney(trend.deltaLT) : '—'}</strong></span>
      </div>
      <TrendChart
        days={trend.days}
        period={period}
        selectedIndex={selectedIndex}
        onSelect={(index) => setSelectedDate(trend.days[index].date)}
        dailyReference={period === 'week' && trend.start === currentStart ? money.config.dailyCapTC : undefined}
      />
      <output className="money-trend-readout" aria-live="polite" aria-label={describeTrendDay(active)}>
        <time dateTime={active.date}>{shortDate(active.date)}</time>
        {active.spentTC !== null && active.deltaLT !== null
          ? <><b className="money-trend-time">{formatMoney(active.spentTC)} 时币</b><b className="money-trend-leisure">{formatSignedMoney(active.deltaLT)} 娱币</b></>
          : <span>{active.status === 'future' ? '日期未到' : '未记录'}</span>}
      </output>
    </WidgetShell>
  )
}
