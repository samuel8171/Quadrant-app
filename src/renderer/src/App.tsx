import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import GoalsPage from './pages/GoalsPage'
import QuadrantPage from './pages/QuadrantPage'
import PlaceholderPage from './pages/PlaceholderPage'
import { useAppStore } from './state/appStore'

export default function App(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const init = useAppStore((s) => s.init)
  const applyEscalations = useAppStore((s) => s.applyEscalations)

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
        {page === 'weekly' && <PlaceholderPage title="周计划" />}
        {page === 'review' && <PlaceholderPage title="周日复盘" />}
      </main>
    </div>
  )
}
