import type { ReactNode } from 'react'
import GlassSurface from './GlassSurface'

/*
 * 弹窗外壳：遮罩 + 液态玻璃面板。
 *
 * 改造前每个弹窗都各写一遍
 *   <div className="modal-mask"><div className="modal xxx">…</div></div>
 * 六处重复。统一到这里之后，"换材质"变成只改一处——这也正是本轮能
 * 一次性覆盖全部弹窗的原因。
 *
 * ── 遮罩为什么必须画在玻璃层的**内部**（2026-09-25 定案，别改回去）
 *
 * 遮罩的活儿有两件：压暗页面（聚焦）与"点外面关闭"。但它是材质板**背景采样**的一部分：
 * 材质板采到的是「遮罩 × 页面」，遮罩越黑，采到的对比度越低。
 *
 * 于是只有两种摆法，差别是量出来的，不是想出来的（同一组条纹、同一块材质板）：
 *
 *   ① 遮罩包在外面（层是它的后代）  保留率 0.30  板内亮度 24.9  ← 采样被截在遮罩那张合成面内
 *   ② 遮罩放在层里、锚点之前        保留率 0.02  板内亮度 45.1  ← 与菜单同质量
 *
 * ①为什么坏：遮罩为了压过事件卡必须带 `z-index`，那是**合成面**，材质板的背景采样被截在
 * 它内部 ⇒ 只剩"糊一层半透明黑"。②让它当材质板的**兄弟**（树序在前）就没事。
 *
 * 遮罩的浓度则决定了弹窗与菜单像不像：浓度 0.55 时板内亮度 45（菜单 76），
 * 0.20 时 74（最接近菜单）。浓度只是**亮度旋钮**了 —— 结构改对之后，
 * 它不再影响糊不糊（0.02 在 0.55/0.35/0.20/0.10 下都一样）。
 * 故 `.modal-mask` 的 0.55 已调成 0.20，见 theme.css。
 *
 * `modal` 这个类仍然挂在玻璃根节点上，让 `.modal h3` / `.modal-actions`
 * / `.modal-btn` 等一批后代选择器继续生效；它的旧壳属性由
 * `.modal.glass-host` 交还给玻璃层（见 glass.css §四）。
 */

interface Props {
  children: ReactNode
  /** 点遮罩关闭。不传则遮罩不可点关闭 */
  onMaskClick?: () => void
  /** 追加到玻璃根节点的类（各弹窗自己的宽度/样式钩子，如 `confirm-modal`） */
  className?: string
  closing?: boolean
  /** 内容层宽度；默认按原 `.modal` 的 420px 外宽换算（见 glass.css 的 .gs-content） */
  contentWidth?: string
  /** 面板内边距。原 `.modal` 是 20px，玻璃版取 24px 以容纳镜面边 */
  padding?: string
}

export default function GlassModal({
  children,
  onMaskClick,
  className = '',
  closing = false,
  contentWidth,
  padding = '24px'
}: Props): JSX.Element {
  return (
    <GlassSurface
      center={{ top: '50%', left: '50%' }}
      contentWidth={contentWidth}
      padding={padding}
      layerClassName="gs-layer--dialog"
      panelClassName={`modal glass-host ${className}`.trim()}
      /* 限高滚动见 glass.css §七：shrink-to-fit 的面板需要自己给出上限 */
      contentClassName="gs-dialog-body"
      anim={closing ? 'out' : 'in'}
      layerPrefix={
        <div
          className={`modal-mask${closing ? ' closing' : ''}`}
          /*
           * 用「目标是不是遮罩本身」判定，而不是靠面板 stopPropagation。
           * 定位层是 pointer-events: none、不参与命中测试，所以面板外的空白处
           * 目标必然是遮罩自身；面板内的任何元素都不会等于 currentTarget。
           * 这样面板的 DOM 结构怎么改都不会误关弹窗。
           */
          onClick={(e) => {
            if (e.target === e.currentTarget) onMaskClick?.()
          }}
        />
      }
    >
      {children}
    </GlassSurface>
  )
}
