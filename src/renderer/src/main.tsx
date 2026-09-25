import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/theme.css'

/*
 * PWA standalone 检测：在 React 挂载前同步打标，避免首帧用错高度再跳一次。
 *
 * 为什么 CSS 的 @media (display-mode: standalone) 之外还要这一手：
 * WebKit 对 display-mode 的支持历史上有过与实际状态不一致的记录
 * （尤其是从旧版本升级上来的安装实例），而 navigator.standalone 是
 * iOS 上更可靠的判据。两者取或，CSS 侧对应 html[data-standalone='true']。
 */
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true

if (isStandalone) {
  document.documentElement.dataset.standalone = 'true'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/*
      顶层错误边界。此前没有它，任何一处渲染期异常都会让 React 卸载整棵树、
      窗口只剩底色——「桌面端打开无画面」有一半是它放大的（另一半见
      components/glass/GlassSurface.tsx 的 ④）。
    */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
