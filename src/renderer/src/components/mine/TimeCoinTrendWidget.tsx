import type { MoneyStats } from '../../../../shared/money'
import { formatMoney } from './formatMoney'
import TrendChart from './TrendChart'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

/**
 * 组件 2：时币趋势（蓝色荧光折线 + 日额度基准线）。取代旧的 `WeeklySpendWidget`（7 根柱）。
 *
 * **基准线取 `daily[0].limit`（周一那一格）** —— 周一没有前一日，它的 `limit` 就是未经
 * 透支缩减的满额日软上限（spec R2 §3.2 的 `dailyCapTC`）。三条不能走的岔路同旧柱状图：
 * 不用 `weekTC / 7`（受罚周会把 40 币的一天也算成超限）、不用逐日的 `daily[i].limit`
 * （那是锯齿，不是基准）、不逐日各画一条。
 *
 * 这张卡**取代了热力格**，所以「哪些天超了额度」这条信息不能丢：额度以水平参考线保留在
 * 图上，超限天数则写进副标题。娱币趋势另外成卡（见 `LeisureTrendWidget`）。
 */
export default function TimeCoinTrendWidget({ stats }: Props): JSX.Element {
  const cap = stats.daily[0]?.limit ?? 0
  const overDays = stats.daily.filter((d) => d.spentTC > cap).length

  return (
    <WidgetShell
      title="时币趋势"
      subtitle={`日额度 ${formatMoney(cap)} 币 · 超限 ${overDays} 天`}
      span={3}
    >
      <TrendChart
        accent="tc"
        values={stats.daily.map((d) => d.spentTC)}
        labels={stats.daily.map((d) => d.weekday)}
        baseline={cap}
        ariaLabel={`本周七天时币消耗趋势，日额度 ${formatMoney(cap)} 币`}
      />
    </WidgetShell>
  )
}
