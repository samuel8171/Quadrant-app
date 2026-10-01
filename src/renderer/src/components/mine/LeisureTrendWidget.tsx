import type { MoneyStats } from '../../../../shared/money'
import { formatMoney } from './formatMoney'
import TrendChart from './TrendChart'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

/**
 * 组件 3：娱币趋势（淡粉色荧光折线）。取代旧的 `DailyHeatWidget`（7 个热力格）。
 *
 * 数据源是 `daily[i].spentLT` —— 每天的娱币**净变化**（奖励为正、惩罚为负），
 * 与本周合计 `spentLT` 同一套推导（已结算日读冻结快照，未结算日按条目现算并叠加
 * 刷视频 / 打游戏两条纯消费）。因此这条折线的起伏与「双币余额」卡里的娱币数字始终自洽。
 *
 * 娱币没有「日额度」这种硬线，所以本图不带参考线，值域上下都含 0。
 */
export default function LeisureTrendWidget({ stats }: Props): JSX.Element {
  const total = formatMoney(stats.spentLT)

  return (
    <WidgetShell title="娱币趋势" subtitle={`本周净变化 ${total} 娱币`} span={3}>
      <TrendChart
        accent="lt"
        values={stats.daily.map((d) => d.spentLT)}
        labels={stats.daily.map((d) => d.weekday)}
        ariaLabel={`本周七天娱币净变化，合计 ${total}`}
      />
    </WidgetShell>
  )
}
