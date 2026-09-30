import type { MoneyStats } from '../../../../shared/money'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

const W = 300
const CHART_H = 108
/** 7 天等分：柱子居中于各自那一格，下面的文字轴用同样的 7 等分对齐。 */
const SLOT = W / 7
const BAR_W = 22

/**
 * 组件 2：本周消耗（周一到周日 7 根柱 + 日额度基准线）。
 *
 * **基准线取 `daily[0].limit`，也就是周一那一格。** 周一没有前一日，它的 `limit`
 * 就是未经透支缩减的满额日软上限 —— 这正是 spec 6.2 里的 D（`config.weeklyTC / 7`）。
 * 三条不能走的岔路：
 * - 不用 `weekTC / 7`：受罚周会把 40 币的一天也算成超限，与冻结在账本里的日额度自相矛盾；
 * - 不用每天的 `daily[i].limit`：那个值含了前一日的透支，基准线会变成锯齿；
 * - 不逐日各画一条：基准线只有一条才谈得上「基准」。
 *
 * 归一化上限取「峰值与基准线中更大的那个 × 1.15」，保证满额柱不会顶到框、
 * 也保证基准线永远落在可视区内（即使整周花费为 0，基准线也在）。
 */
export default function WeeklySpendWidget({ stats }: Props): JSX.Element {
  const cap = stats.daily[0]?.limit ?? 0
  const peak = Math.max(cap, ...stats.daily.map((d) => d.spentTC))
  const max = peak > 0 ? peak * 1.15 : 1
  const yOf = (value: number): number => CHART_H - (value / max) * CHART_H
  const overDays = stats.daily.filter((d) => d.spentTC > cap).length

  return (
    <WidgetShell
      title="本周消耗"
      subtitle={`日额度 ${cap} 币 · 超限 ${overDays} 天`}
      span={3}
    >
      <svg
        className="money-chart"
        viewBox={`0 0 ${W} ${CHART_H}`}
        role="img"
        aria-label={`本周七天时币消耗，日额度 ${cap} 币`}
      >
        {stats.daily.map((day, i) => {
          const height = (day.spentTC / max) * CHART_H
          return (
            <rect
              key={day.date}
              x={i * SLOT + (SLOT - BAR_W) / 2}
              y={CHART_H - height}
              width={BAR_W}
              height={height}
              rx="3"
              className={day.spentTC > cap ? 'money-bar over' : 'money-bar'}
            />
          )
        })}
        <line
          x1="0"
          y1={yOf(cap)}
          x2={W}
          y2={yOf(cap)}
          className="money-baseline"
        />
      </svg>
      <div className="money-axis">
        {stats.daily.map((day) => (
          <span key={day.date}>{day.weekday}</span>
        ))}
      </div>
    </WidgetShell>
  )
}
