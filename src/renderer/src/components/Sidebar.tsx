import { CalendarDays, Grid2x2, RefreshCcw, Target } from 'lucide-react'
import type { Page } from '../state/appStore'
import { useAppStore } from '../state/appStore'

const NAV: { page: Page; label: string; icon: typeof Target }[] = [
  { page: 'goals', label: '目标', icon: Target },
  { page: 'quadrant', label: '四象限', icon: Grid2x2 },
  { page: 'weekly', label: '周计划', icon: CalendarDays },
  { page: 'review', label: '周日复盘', icon: RefreshCcw }
]

export default function Sidebar(): JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)

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
        {NAV.map(({ page: p, label, icon: Icon }) => (
          <button
            key={p}
            className={`nav-item${page === p ? ' active' : ''}`}
            onClick={() => setPage(p)}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="tagline">
        <span>✨ 专注当下，赢得未来</span>
        <span>每一个小目标，都是通往大目标的基石。</span>
      </div>
    </aside>
  )
}
