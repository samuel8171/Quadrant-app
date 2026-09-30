interface Props {
  /** 待结算天数（`pendingDays` 的长度）。为 0 时**不渲染任何东西**。 */
  count: number
  onOpen: () => void
}

/**
 * 日结卡片：金钱子系统唯一的日常交互入口（spec 7.1）。
 *
 * **被动出现** —— 只有当存在「已过完但尚未结算」的日子时才渲染。这里没有定时器、
 * 没有通知、没有后台轮询：网页端跑不起来可靠的调度器，所以「什么时候提醒」这件事
 * 被换成了「打开应用时看一眼账本」。
 *
 * 组件本身只吃一个计数，不知道待结算的是哪天 —— 遍历与结算全在 `SettlePanel` 里。
 * 计数为 0 时返回 `null`：留一张「0 天待结算」的空卡会被读成「这里坏了」。
 */
export default function SettleCard({ count, onOpen }: Props): JSX.Element | null {
  if (count <= 0) return null
  return (
    <button type="button" className="settle-card" onClick={onOpen}>
      <span className="settle-card-dot" aria-hidden="true" />
      <span className="settle-card-text">有 {count} 天待结算</span>
      <span className="settle-card-hint">点击开始日结 →</span>
    </button>
  )
}
