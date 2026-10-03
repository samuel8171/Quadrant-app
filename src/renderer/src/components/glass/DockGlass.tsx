import GlassSurface from './GlassSurface'

/*
 * 手机底栏 dock 的玻璃层 —— `.app` 的直接子节点。
 *
 * ============================================================ 为什么单独抽一个组件
 *
 * 它不是 `.sidebar` 的一部分，而必须是 `.app` 的子节点，**排在 `<Sidebar>` 之前**。
 * 理由（R2-K2，2026-10-02 实测）：
 *
 * 材质板（`.gs-plate`）的 `backdrop-filter` 能不能采到身后的页面，取决于
 * 「从材质板一路到 body」的祖先链上有没有**合成面** —— `position: fixed`、
 * `sticky`，或**非 auto 的 `z-index`**。手机档的 `.sidebar` 是
 * `fixed + z-index: 100`，两个前提同时成立，于是材质板的背景采样被截断在
 * `.sidebar` 内部，只能采到它自己那层保底底 ⇒ chromium 档只剩染色。
 *
 *   测量（`scripts/dock-glass-retention.mjs`，条纹插在页面侧、抓材质开/关两张）：
 *     chromium 档：材质板在 `.sidebar` 里  保留率 0.33   ≈ 只剩染色，死
 *     chromium 档：材质板在 `.app` 里      保留率 ≤0.2   活
 *
 * `.app` 是 `relative + z-index: auto`，不是合成面，所以搬到这里材质就活了。
 * 降级档（iOS 走的那一档）本来就不渲染库那棵含 `mix-blend-mode` 的子树，
 * 缺了另一半前提 ⇒ 两处都活，搬动对它没有影响。
 *
 * ============================================================ 为什么必须抽成组件
 *
 * 两个入口都要挂它：`App.tsx`（生产）与 `probe/main.tsx`（探测页）。
 * 探测页是**独立维护**的 entry（它绕开网页端登录门禁），不共用 App.tsx 的树。
 * 如果两处各写一遍这份 props，早晚会漂移 —— 而漂移的后果不是报错，
 * 是"探针量的是另一套结构"，比不测更糟。所以真源只留这一处。
 *
 * 几何（层的位置尺寸）全部在 CSS 的 `.gs-layer--dock` 上，本组件只给
 * 中心点与内边距 —— 那两项是 `.gs-plate` 的尺寸来源所必需的。
 */
export default function DockGlass(): JSX.Element {
  return (
    <GlassSurface
      center={{ top: '50%', left: '50%' }}
      padding="5px 8px"
      contentClassName="gs-dock-plate"
      layerClassName="gs-layer--dock"
    />
  )
}
