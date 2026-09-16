/**
 * 开发期探测页：直接挂载真实页面组件，**绕开网页端登录门禁**，
 * 供 `scripts/ui-probe.mjs` 在真实浏览器里采集事件序列与验证交互。
 *
 * 存在的理由：本项目的多处缺陷只在真实指针事件的时序下暴露（例如浏览器在 `pointerup`
 * 之后补发的兼容性 `mousedown` 会抢走刚打开输入框的焦点），靠读代码推断已多次得出错误结论。
 * 它不参与构建产物（Vite 默认只以 `index.html` 为入口），可在地址栏直接打开调试。
 *
 * 用法：/probe.html?page=quadrant|weekly|goals|review[&strict=0][&sidebar=1]
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import Sidebar from '../src/components/Sidebar'
import GoalsPage from '../src/pages/GoalsPage'
import QuadrantPage from '../src/pages/QuadrantPage'
import ReviewPage from '../src/pages/ReviewPage'
import WeeklyPage from '../src/pages/WeeklyPage'
import { useAppStore, type Page } from '../src/state/appStore'
import '../src/styles/theme.css'

const params = new URLSearchParams(location.search)
const pageName = (params.get('page') ?? 'quadrant') as Page
const withSidebar = params.get('sidebar') === '1'
const strict = params.get('strict') !== '0'

const PAGES: Record<Page, () => JSX.Element> = {
  goals: GoalsPage,
  quadrant: QuadrantPage,
  weekly: WeeklyPage,
  review: ReviewPage
}

function Probe(): JSX.Element {
  const init = useAppStore((s) => s.init)
  const loaded = useAppStore((s) => s.loaded)
  const setPage = useAppStore((s) => s.setPage)

  React.useEffect(() => {
    void init()
  }, [init])

  React.useEffect(() => {
    setPage(pageName)
  }, [setPage])

  if (!loaded) return <div style={{ padding: 20 }}>loading…</div>
  const Page = PAGES[pageName] ?? QuadrantPage
  return (
    <div className="app">
      {withSidebar && <Sidebar />}
      <main className="content">
        <div className={`page-switch page-switch-${pageName}`} key={pageName}>
          <Page />
        </div>
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  strict ? (
    <React.StrictMode>
      <Probe />
    </React.StrictMode>
  ) : (
    <Probe />
  )
)
