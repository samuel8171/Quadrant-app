import type { MoneyStats } from '../../../../shared/money'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

/** 与 `PenaltyTier` 的下标一一对应。 */
const TIER_LABELS = ['无惩罚', '轻度', '中度', '重度'] as const

/**
 * 先四舍五入到一位小数再判整：`nextWeekTC = config.weeklyTC × 档位系数`，
 * 而 `350 × 0.7` 在二进制里是 `244.99999999999997` —— 直接判整会显示成 "245.0"。
 * 见 BalanceWidget 里同名函数的注释。
 */
const fmt = (n: number): string => {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * 组件 6（hero）：惩罚预告。
 *
 * `penaltyTier` / `nextWeekTC` / `nextWeekLT` 是**实时预演**（本周若此刻结束会怎样），
 * 不是任何已存的结算值 —— 所以这张卡片在下周一到来的那一刻会自己回到「无惩罚」，
 * 不需要有人去改它。
 *
 * 两个百分比分别是 `nextWeekTC / weekTC` 与 `nextWeekLT / weekLT`。按 spec 6.5，
 * 档位系数乘的是**配置的基础额度**，而 `weekTC` / `weekLT` 是本周实发额度
 * （已含上周惩罚），所以受罚周里的这两个比值可能不是 100% / 85% / 70% / 50% 那张表
 * 里的数 —— 这是语义正确的：它回答的是「比本周少发多少」，不是「档位系数是多少」。
 *
 * 额度为 0 时不给百分比（0 / 0 会得到 NaN），直接按「无折扣」显示 100%。
 */
export default function PenaltyWidget({ stats }: Props): JSX.Element {
  const tier = stats.penaltyTier
  const tcPercent = stats.weekTC > 0 ? Math.round((stats.nextWeekTC / stats.weekTC) * 100) : 100
  const ltPercent = stats.weekLT > 0 ? Math.round((stats.nextWeekLT / stats.weekLT) * 100) : 100
  const weekOver = Math.max(0, stats.spentTC - stats.weekTC)

  return (
    <WidgetShell
      title="惩罚预告"
      subtitle={`本周若此刻结束：已花 ${fmt(stats.spentTC)} / ${fmt(stats.weekTC)} 币`}
      span={6}
    >
      <div className="money-penalty">
        <svg
          className="money-tier-badge"
          viewBox="0 0 56 56"
          role="img"
          aria-label={`惩罚档位 ${tier}，${TIER_LABELS[tier]}`}
        >
          <circle cx="28" cy="28" r="25" className={`money-tier-${tier}`} />
          <text x="28" y="28" dy="0.36em" textAnchor="middle" className="money-tier-num">
            {tier}
          </text>
        </svg>

        <div className="money-penalty-body">
          <p className="money-penalty-head">
            档位 {tier} · {TIER_LABELS[tier]}
          </p>
          <ul className="money-penalty-rates">
            <li>
              <span className="money-rate-label">下周时币</span>
              <b className="money-rate-value">{tcPercent}%</b>
              <span className="money-rate-quota">{fmt(stats.nextWeekTC)} 币</span>
            </li>
            <li>
              <span className="money-rate-label">下周娱币</span>
              <b className="money-rate-value">{ltPercent}%</b>
              <span className="money-rate-quota">{fmt(stats.nextWeekLT)} 币</span>
            </li>
          </ul>
        </div>
      </div>

      <p className="money-widget-foot">
        {weekOver > 0 ? `本周已超支 ${fmt(weekOver)} 币` : '本周尚未超支'}
      </p>
    </WidgetShell>
  )
}
