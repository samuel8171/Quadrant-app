import { useState } from 'react'
import { useAppStore } from '../state/appStore'

/**
 * 「我的」页骨架。
 *
 * 本期只落三件事：三个分组标题、金钱总开关、以及为 Task 7 预留的分组容器。
 * 六个金钱小组件与卡片栅格由 Task 7 填进「金钱」组，本文件不预设任何版式。
 */
export default function MinePage(): JSX.Element {
  const moneyEnabled = useAppStore((s) => s.data.money?.enabled === true)
  const setMoneyEnabled = useAppStore((s) => s.setMoneyEnabled)
  const [notice, setNotice] = useState<string | null>(null)

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
        Task 7 的六个小组件将挂在这个 section 里。
      */}
      {moneyEnabled && (
        <section className="mine-group">
          <h2 className="mine-group-title">金钱</h2>
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
