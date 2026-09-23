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

  /*
   * 照片功能的探测钩子。
   *
   * 加照片要经过系统文件选择器，自动化无法驱动；这里开一条后门直接把事件写进
   * store，让探针能验证「缩略图渲染 / 短按展开 / 查看器」这些真正要测的部分。
   * 仅存在于探测页（不参与构建产物），不进生产代码。
   */
  React.useEffect(() => {
    if (!loaded) return
    const store = useAppStore.getState()
    const view = { zoom: 1, panX: 0, panY: 0 }
    ;(window as unknown as Record<string, unknown>).__probeStore = {
      addEventWithPhotos(text: string, photos: string[]) {
        // addEvent 返回 void，新事件是列表里的最后一个（createEvent 只做追加）。
        store.addEvent(text, 1, 2, 3, view)
        const created = useAppStore.getState().data.events.at(-1)
        if (created) store.updateEvent(created.id, { photos }, view)
      },
      /**
       * 把事件的照片补到上限（3 张）。
       *
       * 补进去的必须也是**有实体**的照片——生产路径永远是"先存实体、再挂 id"，
       * 只挂 id 会制造一个真实代码到不了的状态（缩略图指向不存在的 blob，
       * 浏览器报 ERR_FILE_NOT_FOUND），那样测出来的失败是探针自己的产物。
       */
      async fillPhotosToCap() {
        const target = useAppStore.getState().data.events[0]
        if (!target) return
        const existing = target.photos ?? []
        const { compressPhoto } = await import('../src/lib/photoCompress')
        const { putPhoto, newPhotoId } = await import('../src/lib/photoStore')
        const added: string[] = []
        for (let i = existing.length; i < 3; i++) {
          const canvas = document.createElement('canvas')
          canvas.width = 400
          canvas.height = 300
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.fillStyle = '#b4a7e6'
            ctx.fillRect(0, 0, 400, 300)
          }
          const raw = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
          if (!raw) continue
          const { blob } = await compressPhoto(new File([raw], 'filler.png', { type: 'image/png' }))
          const id = newPhotoId()
          await putPhoto(id, blob)
          added.push(id)
        }
        store.updateEvent(target.id, { photos: [...existing, ...added].slice(0, 3) }, view)
      }
    }
  }, [loaded])

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
