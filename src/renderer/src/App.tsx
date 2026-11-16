import { useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import DockGlass from './components/glass/DockGlass'
import LeaveConfirmDialog from './components/LeaveConfirmDialog'
import GoalsPage from './pages/GoalsPage'
import QuadrantPage from './pages/QuadrantPage'
import WeeklyPage from './pages/WeeklyPage'
import ReviewPage from './pages/ReviewPage'
import MinePage from './pages/MinePage'
import { installInertialScroll } from './lib/inertialScroll'
import { useAppStore, type Page } from './state/appStore'
import LoginPage from './pages/LoginPage'
import { subscribeSyncNotices, supabase } from './lib/cloudSync2'
import { readConflictCopies } from './lib/snapshotSync'
import { readSyncMeta } from './lib/syncMeta'

const PAGE_ORDER: Page[] = ['goals', 'quadrant', 'weekly', 'review', 'mine']

function downloadConflictCopies(): void {
  const copies = readConflictCopies()
  if (!copies) return
  const url = URL.createObjectURL(new Blob([copies], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = '象限-同步冲突副本.json'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App(): JSX.Element {
  const isDesktop = Boolean((window as any).quadrantApi)
  const [authenticated, setAuthenticated] = useState(isDesktop)
  useEffect(() => { if (!isDesktop) { supabase.auth.getSession().then(({ data }) => setAuthenticated(Boolean(data.session))); const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthenticated(Boolean(session))); return () => sub.subscription.unsubscribe() } }, [isDesktop])
  const page = useAppStore((s) => s.page)
  const storageNotice = useAppStore((s) => s.storageNotice)
  const recoveryData = useAppStore((s) => s.recoveryMode ? s.data : null)
  const hasConflictCopies = useAppStore((s) => s.hasConflictCopies)
  const loaded = useAppStore((s) => s.loaded)
  const saveNow = useAppStore((s) => s.saveNow)
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
    const timer = window.setInterval(() => { if (!useAppStore.getState().recoveryMode) applyEscalations() }, 60_000)
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
    const onHide = (): void => saveNow()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
    }
  }, [saveNow])

  if (!authenticated) return <LoginPage onLoggedIn={() => setAuthenticated(true)} />

  if (!loaded) return <main role="status">{storageNotice || '正在读取存档…'}</main>

  return (
    <div className="app">
      {/*
       * 手机底栏 dock 的玻璃层 —— **必须挂在 `.app` 上，不能挂进 `<Sidebar>`**，
       * 且**排在 `<Sidebar>` 之前**（两者都是 z:auto 的已定位兄弟，同层按树序绘制，
       * 材质才会落到底下）。为什么不放进 Sidebar：手机档 `.sidebar` 是
       * `fixed + z-index: 100`，那是一张合成面，会把材质板的背景采样截断在它内部
       * ⇒ chromium 档只剩染色。完整推导与实测数字见 `components/glass/DockGlass.tsx`。
       *
       * 桌面端由 CSS 隐藏（`.gs-layer--dock { display: none }`）。
       */}
      <DockGlass />
      <Sidebar />
      <main className="content">
        {(storageNotice || hasConflictCopies) && (
          <div className="storage-notice">
            {storageNotice && <span role="status">{storageNotice}</span>}
            {hasConflictCopies && (
              <button type="button" onClick={downloadConflictCopies}>下载本地冲突副本</button>
            )}
          </div>
        )}
        {recoveryData ? (
          <details className="storage-notice" open>
            <summary>可读存档内容</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {JSON.stringify(recoveryData, null, 2)}
            </pre>
          </details>
        ) : (
          <div
            className={`page-switch${firstRef.current ? '' : ` page-switch-${dir}`}`}
            key={page}
          >
            {page === 'goals' && <GoalsPage />}
            {page === 'quadrant' && <QuadrantPage />}
            {page === 'weekly' && <WeeklyPage />}
            {page === 'review' && <ReviewPage />}
            {page === 'mine' && <MinePage />}
          </div>
        )}
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
