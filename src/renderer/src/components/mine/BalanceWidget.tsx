import type { MoneyStats } from '../../../../shared/money'
import WidgetShell from './WidgetShell'

interface Props {
  stats: MoneyStats
}

/**
 * 时币是整数、娱币以 0.5 为步长，所以非整数补一位小数就够了。
 *
 * **先四舍五入到一位小数再判整**，不是直接判整：额度是 `配置值 × 档位系数` 算出来的，
 * 而 `350 × 0.7` 在二进制里是 `244.99999999999997` —— 直接判整会显示成 "245.0"，
 * 又丑又误导。四舍五入到一位小数先把这点浮点尘埃清掉。
 */
const fmt = (n: number): string => {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
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
          <strong className={`money-balance-value${stats.remainingTC < 0 ? ' neg' : ''}`}>
            {fmt(stats.remainingTC)}
          </strong>
        </div>
        <div className="money-balance">
          <span className="money-balance-label">娱币剩余</span>
          <strong className={`money-balance-value${stats.remainingLT < 0 ? ' neg' : ''}`}>
            {fmt(stats.remainingLT)}
          </strong>
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
