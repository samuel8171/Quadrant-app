import { useId, type PointerEvent } from 'react'
import { accumulateTrend, type MoneyTrendPoint, type TrendPeriod } from '../../lib/moneyTrend'
import { formatMoney, formatSignedMoney } from './formatMoney'
import TrendSeries from './TrendSeries'

interface Props {
  days: MoneyTrendPoint[]
  period: TrendPeriod
  selectedIndex: number
  onSelect: (index: number) => void
  dailyReference?: number
}

const WIDTH = 720
const HEIGHT = 244
const INSET = 12
const SERIES = ['time', 'leisure'] as const

type SeriesKind = (typeof SERIES)[number]
type SeriesValues = Record<SeriesKind, (number | null)[]>

function niceBound(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value))
  const multiplier = [1, 2, 2.5, 5, 10].find((candidate) => value / power <= candidate) ?? 10
  const rounded = multiplier * power
  return Number.isFinite(rounded) ? rounded : value
}

function makeScale(values: (number | null)[], signed: boolean, reference = 0) {
  const numbers = values.flatMap((value) => value === null ? [] : [value])
  const negative = Math.max(0, -Math.min(0, ...numbers))
  const top = niceBound(Math.max(1, reference, negative * 2, ...numbers))
  // Leave one third of both scales below zero whenever either series has negative values.
  const baseline = INSET + (HEIGHT - INSET * 2) * (signed ? 2 / 3 : 1)
  return {
    y: (value: number) => baseline - value / top * (baseline - INSET),
    ticks: negative > 0 ? [top, 0, -top / 2] : [top, top / 2, 0]
  }
}

function axisTickStyle(y: number): { top: string } {
  return { top: `${y / HEIGHT * 100}%` }
}

export function describeTrendDay(day: MoneyTrendPoint): string {
  const date = `${Number(day.date.slice(5, 7))}月${Number(day.date.slice(8, 10))}日`
  if (day.spentTC !== null && day.deltaLT !== null) {
    return `${date}，${formatMoney(day.spentTC)} 时币，娱币净变化 ${formatSignedMoney(day.deltaLT)}`
  }
  return `${date}，${day.status === 'future' ? '日期未到' : '未记录'}`
}

interface TrackProps {
  values: SeriesValues
  selectedIndex: number
  xOf: (index: number) => number
  kind: 'daily' | 'cumulative'
  reference?: number
}

function TrendTrack({ values, selectedIndex, xOf, kind, reference }: TrackProps): JSX.Element {
  const signed = SERIES.some((series) => values[series].some((value) => value !== null && value < 0))
  const scales = {
    time: makeScale(values.time, signed, reference),
    leisure: makeScale(values.leisure, signed)
  }
  const zeroY = scales.time.y(0)
  const slot = WIDTH / values.time.length
  const barWidth = Math.min(25, slot * .3)
  const barGap = Math.min(7, slot * .1)
  const x = xOf(selectedIndex)
  const haveRecords = values.time.some((value) => value !== null)
  const rules = [INSET, (INSET + zeroY) / 2, zeroY]
  if (signed) rules.push(HEIGHT - INSET)

  const scale = (series: SeriesKind): JSX.Element => (
    <div className={`money-chart-scale money-chart-scale--${series}`} aria-hidden="true">
      {scales[series].ticks.map((tick) => (
        <span key={tick} style={axisTickStyle(scales[series].y(tick))}>
          {series === 'time' ? formatMoney(tick) : formatSignedMoney(tick)}
        </span>
      ))}
    </div>
  )

  return (
    <>
      {scale('time')}
      <div className="money-chart-plot" data-chart={kind} aria-hidden="true">
        <svg
          className={kind === 'daily' ? 'money-trend money-chart-svg' : 'money-chart-svg'}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
        >
          <rect x={x - slot * .45} y={INSET} width={slot * .9} height={HEIGHT - INSET * 2} rx="3" className="money-chart-selection" />
          {rules.map((y) => (
            <line key={y} x1="0" x2={WIDTH} y1={y} y2={y} className={y === zeroY ? 'money-chart-zero' : 'money-chart-rule'} />
          ))}
          {reference !== undefined && haveRecords && (
            <line x1="0" x2={WIDTH} y1={scales.time.y(reference)} y2={scales.time.y(reference)} className="money-chart-cap" />
          )}
          {kind === 'daily' ? SERIES.map((series) => (
            <g key={series} className={`money-series--${series}`} data-bars={series}>
              {values[series].map((value, index) => {
                if (value === null) return null
                const left = xOf(index) + (series === 'time' ? -barWidth - barGap / 2 : barGap / 2)
                const y = scales[series].y(value)
                return value === 0 ? (
                  <line key={index} data-day={index} x1={left} x2={left + barWidth} y1={zeroY} y2={zeroY} className="money-bar-zero" />
                ) : (
                  <rect
                    key={index}
                    data-day={index}
                    x={left}
                    y={Math.min(zeroY, y)}
                    width={barWidth}
                    height={Math.abs(zeroY - y)}
                    rx={Math.min(3, barWidth / 2)}
                    className={'money-bar' + (index === selectedIndex ? ' is-current' : '')}
                  />
                )
              })}
            </g>
          )) : SERIES.map((series) => (
            <TrendSeries key={series} kind={series} values={values[series]} xOf={xOf} yOf={scales[series].y} height={HEIGHT} />
          ))}
        </svg>
        {reference !== undefined && haveRecords && (
          <span className="money-chart-cap-label" style={axisTickStyle(scales.time.y(reference))}>日额度 {formatMoney(reference)}</span>
        )}
        {kind === 'daily' && !haveRecords && <p className="money-chart-empty">这段时间暂无记录</p>}
        {kind === 'cumulative' && SERIES.map((series) => {
          const value = values[series][selectedIndex]
          return value !== null && (
            <i
              key={series}
              className={`money-chart-dot money-series--${series}`}
              style={{ left: `${x / WIDTH * 100}%`, ...axisTickStyle(scales[series].y(value)) }}
            />
          )
        })}
      </div>
      {scale('leisure')}
    </>
  )
}

export default function TrendChart({ days, period, selectedIndex, onSelect, dailyReference }: Props): JSX.Element {
  const chartDescription = useId()
  const daily = { time: days.map((day) => day.spentTC), leisure: days.map((day) => day.deltaLT) }
  const cumulative = period === 'week' ? {
    time: accumulateTrend(daily.time),
    leisure: accumulateTrend(daily.leisure)
  } : null
  const xOf = (index: number): number => (index + .5) / days.length * WIDTH
  const xTickIndices = period === 'week' ? days.map((_, index) => index) : [0, 6, 13, 20, days.length - 1]
  const totalTime = cumulative?.time[selectedIndex]
  const totalLeisure = cumulative?.leisure[selectedIndex]
  const totalText = totalTime != null && totalLeisure != null
    ? `，累计 ${formatMoney(totalTime)} 时币，娱币累计净变化 ${formatSignedMoney(totalLeisure)}`
    : ''
  const select = (index: number): void => onSelect(Math.max(0, Math.min(days.length - 1, index)))

  const chooseAt = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    select(Math.floor((event.clientX - bounds.left) / bounds.width * days.length))
  }

  return (
    <div className={`money-chart money-chart--${period}`}>
      <span id={chartDescription} className="money-visually-hidden">
        蓝色为时币消耗，使用左侧刻度。青色为娱币净变化，使用右侧刻度。
        {cumulative && '上方为每日柱状图，下方为周内累计曲线。虚线连接缺记录日期前后的累计值。'}
      </span>
      <div className="money-chart-track-heading"><h4>每日账目</h4></div>
      <TrendTrack kind="daily" values={daily} selectedIndex={selectedIndex} xOf={xOf} reference={dailyReference} />
      {cumulative && (
        <>
          <div className="money-chart-track-heading">
            <h4>周内累计</h4>
            {(totalTime != null && totalLeisure != null) && (
              <span className="money-chart-cumulative-values" aria-hidden="true">
                <b className="money-trend-time">{formatMoney(totalTime)} 时币</b>
                <b className="money-trend-leisure">{formatSignedMoney(totalLeisure)} 娱币</b>
              </span>
            )}
          </div>
          <TrendTrack kind="cumulative" values={cumulative} selectedIndex={selectedIndex} xOf={xOf} />
        </>
      )}
      <div className="money-chart-axis" aria-hidden="true">
        {xTickIndices.map((index) => (
          <span
            key={index}
            style={{ left: `${xOf(index) / WIDTH * 100}%` }}
            className={index === selectedIndex ? 'is-current' : undefined}
          >{days[index].label}</span>
        ))}
      </div>
      <div
        className="money-chart-picker"
        role="slider"
        tabIndex={0}
        aria-label="查看某天账目"
        aria-describedby={chartDescription}
        aria-valuemin={1}
        aria-valuemax={days.length}
        aria-valuenow={selectedIndex + 1}
        aria-valuetext={describeTrendDay(days[selectedIndex]) + totalText}
        onPointerDown={chooseAt}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') chooseAt(e) }}
        onKeyDown={(e) => {
          let next: number
          switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown': next = selectedIndex - 1; break
            case 'ArrowRight':
            case 'ArrowUp': next = selectedIndex + 1; break
            case 'Home': next = 0; break
            case 'End': next = days.length - 1; break
            default: return
          }
          e.preventDefault()
          select(next)
        }}
      />
    </div>
  )
}
