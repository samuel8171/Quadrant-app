import type { MoneyStats } from '../../../../shared/money'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

const W = 300

/**
 * 组件 4：深夜时段。
 *
 * `nightRatio` 是 **0–1 的比例**，不是百分数：当它当尺寸用时必须自己乘开
 * （这里 `* W`，viewBox 宽 300），只有显示给人看的那处才 `* 100` 并取整。
 * 本周没有做事时选择器给 0（不是 NaN），所以除零不会发生。
 *
 * 占比条用 `preserveAspectRatio="none"` 横向拉满卡片宽度：填充的是纯色矩形，
 * 拉伸看不出来；圆角交给外层 `.money-track` 的 `border-radius` + `overflow: hidden`。
 */
export default function NightWidget({ stats }: Props): JSX.Element {
  const ratio = Math.min(1, Math.max(0, stats.nightRatio))
  const percent = Math.round(stats.nightRatio * 100)

  return (
    <WidgetShell title="深夜时段" subtitle="本周深夜做事的时长与占比" span={3}>
      <div className="money-meter-row">
        <div className="money-track">
          <svg
            className="money-track-svg"
            viewBox={`0 0 ${W} 14`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`深夜做事 ${stats.nightMin} 分钟，占本周做事时长 ${percent}%`}
          >
            <rect x="0" y="0" width={ratio * W} height="14" className="money-fill-night" />
          </svg>
        </div>
        <span className="money-meter-note">{stats.nightMin} 分钟</span>
      </div>
      <p className="money-widget-foot">占本周做事时长 {percent}%</p>
    </WidgetShell>
  )
}
