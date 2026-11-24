import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { dateKey } from '../../../shared/dateKey'
import { selectMoneyStats } from '../../../shared/money'
import GlassSettingsDialog from '../components/GlassSettingsDialog'
import BalanceWidget from '../components/mine/BalanceWidget'
import DashboardGlass from '../components/mine/DashboardGlass'
import MoneyTrendWidget from '../components/mine/MoneyTrendWidget'
import NightWidget from '../components/mine/NightWidget'
import PenaltyWidget from '../components/mine/PenaltyWidget'
import QualityWidget, { CompletionMetric } from '../components/mine/QualityWidget'
import { isDesktopRuntime } from '../lib/platformApi'
import { useAppStore } from '../state/appStore'
import '../styles/mine-dashboard.css'

function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`
}

export default function MinePage(): JSX.Element {
  const money = useAppStore((s) => s.data.money)
  const setMoneyEnabled = useAppStore((s) => s.setMoneyEnabled)
  const [notice, setNotice] = useState<string | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const today = dateKey(new Date())
  const moneyEnabled = money?.enabled === true
  const stats = useMemo(() => money?.enabled ? selectMoneyStats(money, today) : null, [money, today])
  const hasWeekRecords = !!stats && !!money?.days.some((day) =>
    day.date >= stats.weekStart && day.date <= today && day.entries.length > 0)

  const toggleMoney = (): void => {
    setMoneyEnabled(!moneyEnabled)
    setNotice('需要重启生效')
    window.setTimeout(() => setNotice(null), 2200)
  }

  return (
    <div className="page mine-page">
      <div className="mine-content">
        <header className="page-header mine-page-header"><h1>我的</h1></header>
        {money && stats && (
          <section aria-labelledby="mine-overview-title">
            <div className="mine-overview-heading">
              <h2 id="mine-overview-title">本周账目</h2>
              <span>{monthDay(stats.weekStart)}–{monthDay(stats.daily[6].date)}</span>
            </div>
            <div className="money-grid mine-dashboard-grid">
              <BalanceWidget stats={stats} />
              <NightWidget stats={stats} hasRecords={hasWeekRecords} />
              <CompletionMetric stats={stats} />
              <MoneyTrendWidget money={money} today={today} />
              <div className="mine-insights">
                <PenaltyWidget stats={stats} />
                <QualityWidget stats={stats} />
              </div>
            </div>
          </section>
        )}

        <div className="mine-utility-grid">
          <section className="mine-card mine-utility-card">
            <DashboardGlass />
            <h2>设置</h2>
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
            <button type="button" className="mine-row mine-row-action" onClick={() => setAppearanceOpen(true)}>
              <span className="mine-row-label">外观</span>
              <span className="mine-row-value">液态玻璃 <ChevronRight size={15} aria-hidden="true" /></span>
            </button>
          </section>
          <section className="mine-card mine-utility-card">
            <DashboardGlass />
            <h2>关于</h2>
            <div className="mine-row">
              <span className="mine-row-label">同步方式</span>
              <span className="mine-row-value">{isDesktopRuntime() ? '桌面端手动同步' : '网页端自动同步'}</span>
            </div>
          </section>
        </div>
      </div>

      {notice && <div role="status" className="mine-toast">{notice}</div>}
      {appearanceOpen && <GlassSettingsDialog onClose={() => setAppearanceOpen(false)} />}
    </div>
  )
}
