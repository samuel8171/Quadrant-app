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
import { supabase } from './lib/cloudSync2'

const PAGE_ORDER: Page[] = ['goals', 'quadrant', 'weekly', 'review']

export default function App(): JSX.Element {
  const isDesktop = Boolean((window as any).quadrantApi)
  const [authenticated, setAuthenticated] = useState(isDesktop)
  useEffect(() => { if (!isDesktop) { supabase.auth.getSession().then(({ data }) => setAuthenticated(Boolean(data.session))); const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthenticated(Boolean(session))); return () => sub.subscription.unsubscribe() } }, [isDesktop])
  const page = useAppStore((s) => s.page)
  const init = useAppStore((s) => s.init)
  const applyEscalations = useAppStore((s) => s.applyEscalations)
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
