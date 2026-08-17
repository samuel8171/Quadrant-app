import { useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar'
import LeaveConfirmDialog from './components/LeaveConfirmDialog'
import GoalsPage from './pages/GoalsPage'
import QuadrantPage from './pages/QuadrantPage'
import WeeklyPage from './pages/WeeklyPage'
import ReviewPage from './pages/ReviewPage'
import { installInertialScroll } from './lib/inertialScroll'
import { useAppStore, type Page } from './state/appStore'

const PAGE_ORDER: Page[] = ['goals', 'quadrant', 'weekly', 'review']

export default function App(): JSX.Element {
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
    void init()
    const timer = window.setInterval(() => applyEscalations(), 60_000)
    const dispose = installInertialScroll()
    return () => {
      window.clearInterval(timer)
      dispose()
    }
  }, [init, applyEscalations])

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
