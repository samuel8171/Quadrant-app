import { useEffect, useState } from 'react'
import { CalendarDays, Cloud, CloudUpload, Grid2x2, RefreshCcw, Target } from 'lucide-react'
import type { Page } from '../state/appStore'
import { useAppStore } from '../state/appStore'
import ConfirmDialog from './ConfirmDialog'
import CloudLoginDialog from './CloudLoginDialog'
import type { SyncAction } from '../lib/syncSummary'
import { hasCloudSession, supabase } from '../lib/cloudSync2'

const NAV: { page: Page; label: string; icon: typeof Target }[] = [
  { page: 'goals', label: '目标', icon: Target },
  { page: 'quadrant', label: '四象限', icon: Grid2x2 },
  { page: 'weekly', label: '周计划', icon: CalendarDays },
  { page: 'review', label: '周日复盘', icon: RefreshCcw }
]

interface PendingConfirm {
  action: SyncAction
  detail: string
  warning: boolean
}

export default function Sidebar(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const requestPage = useAppStore((s) => s.requestPage)
  const activeIndex = NAV.findIndex((n) => n.page === page)
  const inspectCloud = useAppStore((s) => s.inspectCloud)
  const pushToCloud = useAppStore((s) => s.pushToCloud)
  const pullFromCloud = useAppStore((s) => s.pullFromCloud)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<SyncAction | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const isDesktop = Boolean((window as any).quadrantApi)

  useEffect(() => {
    if (!isDesktop) return
    let active = true
    void hasCloudSession().then((ok) => {
      if (active) setHasSession(ok)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      setHasSession(Boolean(session))
    )
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [isDesktop])

  async function perform(action: SyncAction): Promise<void> {
    setBusy(true)
    const r = action === 'push' ? await pushToCloud() : await pullFromCloud()
    setMessage(r.message)
    setBusy(false)
    window.setTimeout(() => setMessage(''), 2500)
  }

  /**
   * 先取差异摘要再弹确认框。
   *
   * 这一步是本期同步方案的核心护栏：两个方向都是「整份覆盖」，没有行级合并，
   * 用户必须在按下确认前看到"会被覆盖多少条、云端是什么时候的"。
   */
  async function openConfirm(action: SyncAction): Promise<void> {
    setBusy(true)
    const info = await inspectCloud(action)
    setBusy(false)
    setConfirm({ action, detail: info.detail, warning: info.hasWarning })
  }

  async function run(action: SyncAction): Promise<void> {
    const ok = await hasCloudSession()
    setHasSession(ok)
    if (!ok) {
      setPendingAction(action)
      setLoginOpen(true)
      return
    }
    await openConfirm(action)
  }

  function handleLoggedIn(): void {
    const action = pendingAction
    setPendingAction(null)
    setHasSession(true)
    if (action) void openConfirm(action)
  }

  function confirmLabel(action: SyncAction): string {
    return action === 'push' ? '确认上传到云端？' : '确认从云端恢复？'
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-logo">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">象限</span>
      </div>
      <nav className="nav">
        <span
          className="nav-indicator"
          style={{ transform: `translateY(${activeIndex * 46}px)` }}
        />
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <button
            key={p}
            className={`nav-item${page === p ? ' active' : ''}`}
            aria-current={page === p ? 'page' : undefined}
            onClick={() => requestPage(p)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {isDesktop && (
        <>
          {hasSession ? (
            <>
              <button
                className="nav-item upload-button"
                onClick={() => void run('push')}
                disabled={busy}
                title="用本机数据覆盖云端"
              >
                <CloudUpload size={18} />
                <span>{busy ? '处理中…' : '上传到云端'}</span>
              </button>
              <button
                className="nav-item sync-button"
                onClick={() => void run('pull')}
                disabled={busy}
                title="用云端数据覆盖本机"
              >
                <Cloud size={18} />
                <span>从云端恢复</span>
              </button>
            </>
          ) : (
            <button className="nav-item login-button" onClick={() => setLoginOpen(true)} disabled={busy}>
              <Cloud size={18} />
              <span>登录云端</span>
            </button>
          )}
          {message && <div className="sync-message">{message}</div>}
        </>
      )}
      <div className="tagline">
        <span>✨ 专注当下，赢得未来</span>
        <span>每一个小目标，都是通往大目标的基石。</span>
      </div>
      {confirm && (
        <ConfirmDialog
          message={confirmLabel(confirm.action)}
          detail={confirm.detail}
          warning={confirm.warning}
          onConfirm={() => void perform(confirm.action)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {loginOpen && <CloudLoginDialog onCancel={() => { setLoginOpen(false); setPendingAction(null) }} onLoggedIn={handleLoggedIn} />}
    </aside>
  )
}
