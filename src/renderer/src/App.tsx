import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import GoalsPage from './pages/GoalsPage'
import QuadrantPage from './pages/QuadrantPage'
import WeeklyPage from './pages/WeeklyPage'
import ReviewPage from './pages/ReviewPage'
import { useAppStore } from './state/appStore'

export default function App(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const init = useAppStore((s) => s.init)
  const applyEscalations = useAppStore((s) => s.applyEscalations)
  const pendingPage = useAppStore((s) => s.pendingPage)
  const resolveLeave = useAppStore((s) => s.resolveLeave)

  useEffect(() => {
    void init()
    const timer = window.setInterval(() => applyEscalations(), 60_000)
    return () => window.clearInterval(timer)
  }, [init, applyEscalations])

  return (
    <div className="app">
      <Sidebar />
      <main className="content">
        {page === 'goals' && <GoalsPage />}
        {page === 'quadrant' && <QuadrantPage />}
        {page === 'weekly' && <WeeklyPage />}
        {page === 'review' && <ReviewPage />}
      </main>
      {pendingPage && (
        <div className="modal-mask">
          <div className="modal confirm-modal">
            <h3>是否保存草稿？</h3>
            <p className="confirm-message">当前复盘内容有未保存的修改。</p>
            <div className="modal-actions">
              <button className="modal-btn" onClick={() => resolveLeave('cancel')}>
                取消
              </button>
              <button className="modal-btn" onClick={() => resolveLeave('discard')}>
                不保存
              </button>
              <button className="modal-btn primary" onClick={() => resolveLeave('save')}>
                保存草稿
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
