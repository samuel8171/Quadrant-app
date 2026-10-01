import { useMemo, useState } from 'react'
import { dateKey } from '../../../shared/dateKey'
import { selectMoneyStats } from '../../../shared/money'
import BalanceWidget from '../components/mine/BalanceWidget'
import LeisureTrendWidget from '../components/mine/LeisureTrendWidget'
import NightWidget from '../components/mine/NightWidget'
import PenaltyWidget from '../components/mine/PenaltyWidget'
import QualityWidget from '../components/mine/QualityWidget'
import TimeCoinTrendWidget from '../components/mine/TimeCoinTrendWidget'
import { useAppStore } from '../state/appStore'

/**
 * 「我的」页。
 *
 * 三个分组：金钱（受开关控制）、设置、关于。金钱组里的六个小组件都只吃
 * `selectMoneyStats` 的返回值，页面本身不参与任何计算 —— 组件与数据源之间
 * 只有 `MoneyStats` 这一个契约。
 */
export default function MinePage(): JSX.Element {
  const money = useAppStore((s) => s.data.money)
  const moneyEnabled = useAppStore((s) => s.data.money?.enabled === true)
  const setMoneyEnabled = useAppStore((s) => s.setMoneyEnabled)
  const [notice, setNotice] = useState<string | null>(null)

  /*
   * `today` 每次渲染都现算（与 `SettlePanel` 取法一致），并进 `useMemo` 的依赖。
   *
   * 为什么不把 `dateKey(new Date())` 写进回调里只按 `[money]` 记忆：那样 `today` 只在
   * `money` 变化时被捕获一次，跨零点（尤其是**跨周**，`selectMoneyStats` 的周一与周额度
   * 都会整体换一档）以后组件若因别的原因重渲染，读到的仍是旧的 `today`，与日结面板当场
   * 算出来的那份直接矛盾 —— 同一屏两个数字不同源。
   *
   * 依赖收的是 `today` 这个**字符串**：一天之内它恒定，`useMemo` 因而不会多做功；跨零点
   * 它变化，下一次渲染就会重算。**不引入轮询定时器**：`today` 只在渲染时才有意义，而
   * 「我的」页只会在用户交互/状态变化时重渲染 —— 那一刻现算即是正确值，为此常驻一个
   * 每 60 秒的定时器，代价（无谓的重渲染与 selector 重跑）远大于收益（一天一次的边界）。
   */
  const today = dateKey(new Date())
  const stats = useMemo(
    () => (money?.enabled === true ? selectMoneyStats(money, today) : null),
    [money, today]
  )

  const isDesktop = Boolean((window as any).quadrantApi)

  const showNotice = (msg: string): void => {
    setNotice(msg)
    window.setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 2200)
  }

  const toggleMoney = (): void => {
    setMoneyEnabled(!moneyEnabled)
    // 数据写盘是即时的，但账本要等下次结算/统计才被真正读起来，
    // 所以这里明确告诉用户「现在改的还不是最终生效时刻」。
    showNotice('需要重启生效')
  }

  return (
    <div className="page mine-page">
      <header className="page-header">
        <h1>我的</h1>
        <span className="title-underline" />
      </header>

      {/*
        金钱组**整组**受开关控制：关闭时连标题都不渲染。
        留一个空标题会被读成"这里坏了"，比不显示更糟。
      */}
      {moneyEnabled && (
        <section className="mine-group">
          <h2 className="mine-group-title">金钱</h2>
          {/*
            DOM 顺序 = 屏幕顺序：两个 hero（双币余额、惩罚预告）在前，四个小卡随后。
            桌面端靠这条顺序自动排成「hero 占满第一行、四张小卡占满第二行」，
            手机档（单列）也就自然把最重要的两个排在最上面 —— 不需要第二套排布规则。
            四张小卡里的前两张是 R2-I 的荧光折线（时币蓝 / 娱币淡粉），取代了旧的柱状图与热力格。
          */}
          {stats && (
            <div className="money-grid">
              <BalanceWidget stats={stats} />
              <PenaltyWidget stats={stats} />
              <TimeCoinTrendWidget stats={stats} />
              <LeisureTrendWidget stats={stats} />
              <NightWidget stats={stats} />
              <QualityWidget stats={stats} />
            </div>
          )}
        </section>
      )}

      <section className="mine-group">
        <h2 className="mine-group-title">设置</h2>
        <div className="mine-card">
          <div className="mine-row">
            <span className="mine-row-label">金钱系统</span>
            <button
              type="button"
              role="switch"
              aria-checked={moneyEnabled}
              aria-label="金钱系统"
              className={`mine-switch${moneyEnabled ? ' on' : ''}`}
              onClick={toggleMoney}
            >
              <span className="mine-switch-knob" />
            </button>
          </div>
        </div>
      </section>

      <section className="mine-group">
        <h2 className="mine-group-title">关于</h2>
        <div className="mine-card">
          <div className="mine-row">
            <span className="mine-row-label">云同步状态</span>
            <span className="mine-row-value">
              {isDesktop ? '桌面端手动同步' : '网页端自动同步'}
            </span>
          </div>
        </div>
      </section>

      {notice && <div className="mine-toast">{notice}</div>}
    </div>
  )
}
