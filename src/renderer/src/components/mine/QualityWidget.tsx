import type { MoneyStats } from '../../../../shared/money'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

const W = 300

/** 四段的固定顺序与颜色（计划外且已完成的条目按契约不进任何一类，所以四段之和可能小于总数）。 */
const SEGMENTS = [
  { key: 'efficient', label: '高效', cls: 'money-seg-efficient' },
  { key: 'normal', label: '正常', cls: 'money-seg-normal' },
  { key: 'inefficient', label: '低效', cls: 'money-seg-inefficient' },
  { key: 'missed', label: '未完成', cls: 'money-seg-missed' }
] as const

/**
 * 组件 5：执行质量（四段堆叠条 + 图例）。
 *
 * 各段宽度按计数占比分配 viewBox 宽度。**计数全为 0 时整条不画**（分母为 0 会让
 * 每段宽度变成 NaN/0），只留底槽 —— 它同时是「本周还没有记录」的视觉表达。
 *
 * 四类只统计**计划内 + 已完成**的条目与**没做**的条目：计划外且已完成的不进任何一类
 * （见 `selectMoneyStats` 的注释），所以四段之和未必等于「本周条目数」，图例里
 * 逐类给数字而不是给百分比，避免读者以为它们归一化到 100%。
 */
export default function QualityWidget({ stats }: Props): JSX.Element {
  const counts = SEGMENTS.map((seg) => ({ ...seg, count: stats.quality[seg.key] }))
  const total = counts.reduce((sum, seg) => sum + seg.count, 0)

  let cursor = 0
  const drawn = counts.map((seg) => {
    const width = total > 0 ? (seg.count / total) * W : 0
    const x = cursor
    cursor += width
    return { ...seg, x, width }
  })

  return (
    <WidgetShell title="执行质量" subtitle={`本周共 ${total} 条可判定的记录`} span={3}>
      <div className="money-track">
        <svg
          className="money-track-svg"
          viewBox={`0 0 ${W} 14`}
          preserveAspectRatio="none"
          role="img"
          aria-label={counts.map((seg) => `${seg.label} ${seg.count}`).join('、')}
        >
          {drawn
            .filter((seg) => seg.width > 0)
            .map((seg) => (
              <rect
                key={seg.key}
                x={seg.x}
                y="0"
                width={seg.width}
                height="14"
                className={`money-seg ${seg.cls}`}
              />
            ))}
        </svg>
      </div>

      <ul className="money-legend">
        {counts.map((seg) => (
          <li key={seg.key}>
            <span className={`money-swatch ${seg.cls}`} />
            {seg.label}
            <b>{seg.count}</b>
          </li>
        ))}
      </ul>
    </WidgetShell>
  )
}
