import type { MoneyStats } from '../../../../shared/money'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

const W = 300
const SIZE = 30
const SLOT = W / 7

/**
 * 填充色分 4 档。分母用**固定的日软上限** `daily[0].limit`，不是每天的
 * `daily[i].ratio`：那个 ratio 的分母含了前一日的透支，一次超支会把次日的额度压到
 * 20 币，「花 20」于是显示成满格 —— 与左边那张柱状图的基准线（也是 `daily[0].limit`）
 * 恰好互相矛盾。两个组件看的是同一件事，分母就必须是同一个数。
 *
 * 第 4 档（> 1，即超过日软上限）与柱状图的警示柱同义。
 */
function heatLevel(spentTC: number, cap: number): 0 | 1 | 2 | 3 {
  if (cap <= 0 || spentTC <= 0) return 0
  const ratio = spentTC / cap
  if (ratio <= 0.5) return 1
  if (ratio <= 1) return 2
  return 3
}

/**
 * 组件 3：日额度热力（7 个方格，GitHub 贡献图的缩小版）。
 *
 * 方格与下面的文字轴都用 7 等分排布，所以两侧天然对齐 —— 不靠手算的像素留白。
 */
export default function DailyHeatWidget({ stats }: Props): JSX.Element {
  const cap = stats.daily[0]?.limit ?? 0
  const summary = stats.daily.map((d) => `${d.weekday} ${d.spentTC} 币`).join('、')

  return (
    <WidgetShell title="日额度热力" subtitle={`按日额度 ${cap} 币分 4 档`} span={3}>
      <svg
        className="money-chart"
        viewBox={`0 0 ${W} ${SIZE}`}
        role="img"
        aria-label={`本周七天消耗：${summary}`}
      >
        {stats.daily.map((day, i) => (
          <rect
            key={day.date}
            x={i * SLOT + (SLOT - SIZE) / 2}
            y="0"
            width={SIZE}
            height={SIZE}
            rx="5"
            className={`money-heat money-heat-${heatLevel(day.spentTC, cap)}`}
          />
        ))}
      </svg>
      <div className="money-axis">
        {stats.daily.map((day) => (
          <span key={day.date}>{day.weekday}</span>
        ))}
      </div>
    </WidgetShell>
  )
}
