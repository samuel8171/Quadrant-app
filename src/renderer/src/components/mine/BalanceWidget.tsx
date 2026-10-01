import type { MoneyStats } from '../../../../shared/money'
import MoneyIcon from '../money/MoneyIcon'
import { formatMoney as fmt } from './formatMoney'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

/**
 * 组件 1（hero）：双币余额。
 *
 * 两个大数字直接取 `remainingTC` / `remainingLT` —— 它们是选择器算好的派生值，
 * **不要在这里重算**：`remainingTC = weekTC − spentTC`（超支时为负），
 * `remainingLT = weekLT + spentLT`（`spentLT` 是有符号净变化，奖励为正、惩罚为负）。
 * 把 `spentLT` 当花费去减，符号就反了。
 *
 * 进度条画的是 `spentTC / weekTC`（已用比例，不是剩余比例）：超支时宽度钉在 100%
 * 并换成警示色 —— 条本身表达不了「超出」的量，数字才能。
 */
export default function BalanceWidget({ stats }: Props): JSX.Element {
  const spentRatio = stats.weekTC > 0 ? Math.min(1, Math.max(0, stats.spentTC / stats.weekTC)) : 0
  const overBudget = stats.spentTC > stats.weekTC

  return (
    <WidgetShell
      title="双币余额"
      subtitle={`本周额度 ${fmt(stats.weekTC)} 时币 · ${fmt(stats.weekLT)} 娱币`}
      span={6}
    >
      <div className="money-balances">
        <div className="money-balance">
          <span className="money-balance-label">时币剩余</span>
          <span className="money-balance-line">
            <MoneyIcon kind="tc" size={22} />
            <strong className={`money-balance-value${stats.remainingTC < 0 ? ' neg' : ''}`}>
              {fmt(stats.remainingTC)}
            </strong>
          </span>
        </div>
        <div className="money-balance">
          <span className="money-balance-label">娱币剩余</span>
          <span className="money-balance-line">
            <MoneyIcon kind="lt" size={22} />
            <strong className={`money-balance-value${stats.remainingLT < 0 ? ' neg' : ''}`}>
              {fmt(stats.remainingLT)}
            </strong>
          </span>
        </div>
      </div>

      <div className="money-meter-row">
        <div className="money-track">
          <svg
            className="money-track-svg"
            viewBox="0 0 300 14"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <rect
              x="0"
              y="0"
              width={spentRatio * 300}
              height="14"
              className={overBudget ? 'money-fill-danger' : 'money-fill-accent'}
            />
          </svg>
        </div>
        <span className="money-meter-note">
          {fmt(stats.spentTC)} / {fmt(stats.weekTC)}
        </span>
      </div>
    </WidgetShell>
  )
}
