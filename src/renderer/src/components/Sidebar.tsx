import { useEffect, useState } from 'react'
import { CalendarDays, Cloud, Grid2x2, RefreshCcw, Target } from 'lucide-react'
import type { Page } from '../state/appStore'
import { useAppStore } from '../state/appStore'
import ConfirmDialog from './ConfirmDialog'
import CloudLoginDialog from './CloudLoginDialog'
import { hasCloudSession, supabase } from '../lib/cloudSync2'

const NAV: { page: Page; label: string; icon: typeof Target }[] = [
  { page: 'goals', label: '目标', icon: Target },
  { page: 'quadrant', label: '四象限', icon: Grid2x2 },
  { page: 'weekly', label: '周计划', icon: CalendarDays },
  { page: 'review', label: '周日复盘', icon: RefreshCcw }
]

type CloudAction = 'sync' | 'upload'

export default function Sidebar(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const requestPage = useAppStore((s) => s.requestPage)
  const activeIndex = NAV.findIndex((n) => n.page === page)
  const syncData = useAppStore((s) => s.syncData)
  const uploadData = useAppStore((s) => s.uploadData)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<CloudAction | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<CloudAction | null>(null)
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

  async function perform(action: CloudAction): Promise<void> {
    setBusy(true)
    const r = action === 'sync' ? await syncData() : await uploadData()
    setMessage(r.message)
    setBusy(false)
    window.setTimeout(() => setMessage(''), 2500)
  }

  async function run(action: CloudAction): Promise<void> {
    setConfirm(null)
    const ok = await hasCloudSession()
    setHasSession(ok)
    if (!ok) {
      setPendingAction(action)
      setLoginOpen(true)
      return
    }
    await perform(action)
  }

  function handleLoggedIn(): void {
    const action = pendingAction
    setPendingAction(null)
    setHasSession(true)
    if (action) void perform(action)
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
      {isDesktop && <>{hasSession ? <><button className="nav-item upload-button" onClick={() => setConfirm('upload')} disabled={busy}><Cloud size={18}/><span>上传数据</span></button><button className="nav-item sync-button" onClick={() => setConfirm('sync')} disabled={busy}><Cloud size={18}/><span>{busy ? '处理中…' : '同步数据'}</span></button></> : <button className="nav-item login-button" onClick={() => setLoginOpen(true)} disabled={busy}><Cloud size={18}/><span>登录云端</span></button>}{message && <div className="sync-message">{message}</div>}</>}
      <div className="tagline">
        <span>✨ 专注当下，赢得未来</span>
        <span>每一个小目标，都是通往大目标的基石。</span>
      </div>
      {confirm && <ConfirmDialog message={confirm === 'sync' ? '确认从云端同步数据？' : '确认上传当前数据到云端？'} onConfirm={() => void run(confirm)} onCancel={() => setConfirm(null)} />}
      {loginOpen && <CloudLoginDialog onCancel={() => { setLoginOpen(false); setPendingAction(null) }} onLoggedIn={handleLoggedIn} />}
    </aside>
  )
}
