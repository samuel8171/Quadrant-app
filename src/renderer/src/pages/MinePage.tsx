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
   * 派生统计只在开启时算。`money` 的引用只要没变（store 每次改动都换新对象）
   * 就不会重算，所以拖动/输入引起的重渲染不会反复跑选择器。
   * `today` 取本地日期键，与 store 里 `rolloverMoneyWeek` 的取法一致。
   */
  const stats = useMemo(
    () => (money?.enabled === true ? selectMoneyStats(money, dateKey(new Date())) : null),
    [money]
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
