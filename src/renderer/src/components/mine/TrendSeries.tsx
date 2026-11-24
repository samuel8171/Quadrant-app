import { useId } from 'react'
import { buildTrendCurve, type TrendPoint } from '../../lib/trendCurve'

interface Props {
  kind: 'time' | 'leisure'
  values: (number | null)[]
  xOf: (index: number) => number
  yOf: (value: number) => number
  height: number
}

export default function TrendSeries({ kind, values, xOf, yOf, height }: Props): JSX.Element {
  const gradient = useId()
  const { points, segments } = buildTrendCurve(values)
  const coords = ({ x, y }: TrendPoint): string => `${xOf(x)} ${yOf(y)}`
  const curves = segments.map(({ from, controlFrom, controlTo, to, interpolated }) => ({
    from: xOf(from.x),
    to: xOf(to.x),
    move: `M ${coords(from)}`,
    curve: `C ${coords(controlFrom)} ${coords(controlTo)} ${coords(to)}`,
    interpolated
  }))
  const areas: string[] = []
  let run: typeof curves = []
  for (const segment of curves) {
    if (segment.interpolated) {
      if (run.length) {
        areas.push(areaPath(run))
        run = []
      }
    } else {
      run.push(segment)
    }
  }
  if (run.length) areas.push(areaPath(run))

  function areaPath(connected: typeof curves): string {
    const first = connected[0]
    const last = connected[connected.length - 1]
    const base = yOf(0)
    return `${first.move} ${connected.map(({ curve }) => curve).join(' ')} L ${last.to} ${base} L ${first.from} ${base} Z`
  }

  const solid = curves.filter((segment) => !segment.interpolated)
  const gaps = curves.filter((segment) => segment.interpolated)
  const line = (segments: typeof curves): string => segments.map(({ move, curve }) => `${move} ${curve}`).join(' ')
  return (
    <g className={`money-series money-series--${kind}`} data-series={kind}>
      <defs>
        <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2={height}>
          <stop offset="0%" stopColor="currentColor" stopOpacity=".38" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {areas.length > 0 && <path d={areas.join(' ')} fill={`url(#${gradient})`} />}
      {solid.length > 0 && <path d={line(solid)} className="money-series-line" />}
      {gaps.length > 0 && <path d={line(gaps)} className="money-series-line is-interpolated" />}
      {points.filter(({ x }) => values[x - 1] == null || values[x + 1] == null).map(({ x, y }) => (
        <circle key={x} cx={xOf(x)} cy={yOf(y)} r="2.6" className="money-series-point" />
      ))}
    </g>
  )
}
