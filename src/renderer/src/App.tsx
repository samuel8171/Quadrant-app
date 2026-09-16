import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import LeaveConfirmDialog from './components/LeaveConfirmDialog'
import GoalsPage from './pages/GoalsPage'
import QuadrantPage from './pages/QuadrantPage'
import WeeklyPage from './pages/WeeklyPage'
import ReviewPage from './pages/ReviewPage'
import { installInertialScroll } from './lib/inertialScroll'
import { useAppStore, type Page } from './state/appStore'
import LoginPage from './pages/LoginPage'
import { subscribeSyncNotices, supabase } from './lib/cloudSync2'
import { flushPendingSave } from './lib/scheduleSave'
import { readSyncMeta } from './lib/syncMeta'

const PAGE_ORDER: Page[] = ['goals', 'quadrant', 'weekly', 'review']

export default function App(): JSX.Element {
  const isDesktop = Boolean((window as any).quadrantApi)
  const [authenticated, setAuthenticated] = useState(isDesktop)
  useEffect(() => { if (!isDesktop) { supabase.auth.getSession().then(({ data }) => setAuthenticated(Boolean(data.session))); const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthenticated(Boolean(session))); return () => sub.subscription.unsubscribe() } }, [isDesktop])
  const page = useAppStore((s) => s.page)
  const init = useAppStore((s) => s.init)
  const applyEscalations = useAppStore((s) => s.applyEscalations)
  const syncOnResume = useAppStore((s) => s.syncOnResume)
  const pendingPage = useAppStore((s) => s.pendingPage)
  const resolveLeave = useAppStore((s) => s.resolveLeave)

  const prevIndexRef = useRef(0)
  const firstRef = useRef(true)
  const index = PAGE_ORDER.indexOf(page)
  const dir = index >= prevIndexRef.current ? 'up' : 'down'

  useEffect(() => {
    prevIndexRef.current = index
    firstRef.current = false
  }, [index])

  useEffect(() => {
    if (!authenticated) return
    void init()
    const timer = window.setInterval(() => applyEscalations(), 60_000)
    const dispose = installInertialScroll()
    return () => {
      window.clearInterval(timer)
      dispose()
    }
  }, [authenticated, init, applyEscalations])

  useEffect(() => {
    if (!authenticated || isDesktop) return
    // 变更通知只当"该去对账了"的信号：拉不拉由 syncOnResume 里的修订号比对决定，
    // 所以重复通知、乱序通知都不会造成多余写入。deviceId 抑制自己的回环。
    return subscribeSyncNotices((notice) => {
      void (async () => {
        const meta = await readSyncMeta()
        if (notice.deviceId === meta.deviceId) return
        await syncOnResume()
      })()
    })
  }, [authenticated, isDesktop, syncOnResume])

  useEffect(() => {
    if (!authenticated || isDesktop) return
    // 移动端最关键的一条：Safari 冻结后台页面会断开 WebSocket，期间的云端变更
    // 一条都收不到，回到前台必须主动补拉一次。
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void syncOnResume()
    }
    const onOnline = (): void => void syncOnResume()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [authenticated, isDesktop, syncOnResume])

  useEffect(() => {
    // 保存防抖是 500ms，而浏览器/Electron 关闭页面时不会等定时器。
    const onHide = (): void => flushPendingSave()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
    }
  }, [])

  if (!authenticated) return <LoginPage onLoggedIn={() => setAuthenticated(true)} />

  return (
    <div className="app">
      <Sidebar />
      <main className="content">
        <div
          className={`page-switch${firstRef.current ? '' : ` page-switch-${dir}`}`}
          key={page}
        >
          {page === 'goals' && <GoalsPage />}
          {page === 'quadrant' && <QuadrantPage />}
          {page === 'weekly' && <WeeklyPage />}
          {page === 'review' && <ReviewPage />}
        </div>
      </main>
      {pendingPage && (
        <LeaveConfirmDialog
          onResolve={(action) => resolveLeave(action)}
          onCancel={() => resolveLeave('cancel')}
        />
      )}
    </div>
  )
}
