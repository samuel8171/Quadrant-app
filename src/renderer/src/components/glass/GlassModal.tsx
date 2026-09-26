import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
 *
 * ── 为什么要 portal 到 body：定位层的包含块必须是**视口**（2026-09-25 第十三轮）
 *
 * 定位层（`.gs-layer`）是 `position: absolute; inset: 0` —— 它的尺寸与原点来自
 * **最近的定位祖先**。而弹窗是"浮在整屏之上"的东西，一旦它被渲染进某个定位容器，
 * 那 50%/50% 就不再是屏幕中心。实测（手机档 402×874）：
 *
 *   外观设置弹窗挂在 `aside.sidebar` 里，而手机档的 sidebar 是
 *   `position: fixed; bottom: …; height: 66px` 的**贴底导航条** ⇒
 *   定位层实测 12,798 377×66（就是那条导航条本身），锚点落在 (200.5, 831)
 *   而不是屏幕中心 (201, 437) ⇒ 面板 440→1222，**下越界 348px**，
 *   内容的滚动条被推到屏幕外、滚不动，用户看到"下半部分全被遮住"。
 *
 * 所以弹窗一律 portal 到 `document.body`：
 *   · body 与 #root 都不是定位祖先 ⇒ 包含块退化为初始包含块（文档不滚动，等价视口）；
 *   · 与桌面板无关（桌面档 sidebar 是 static 的 flex 兄弟，本来就正确），
 *     但把这条约束**写在组件里**，以后谁把弹窗放进任何定位容器都不会再翻车；
 *   · 层级不受影响：遮罩 60/120 与材质板 70/130 是正 z，仍然压过手机导航条(100)；
 *   · React 事件依旧沿**组件树**冒泡（portal 的语义），点遮罩关闭、点面板按钮
 *     的行为与 portal 前一致。
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
  /*
   * 挂到 body，而不是留在调用者所在的 DOM 位置 —— 定位层的包含块必须是视口。
   * 反例与实测数据见文件头「为什么要 portal 到 body」。
   *
   * 外面再套一层 `.gs-viewport`（fixed; inset:0）：定位层是 absolute，
   * 它单独挂在 body 下时包含块是**初始包含块（布局视口）**，而遮罩原来是 fixed
   * （挂在**可见视口**）—— 手机浏览器里这两个视口不重合，面板与"挖掉的洞"就会整体错位
   * （用户原话："所有面板和挖洞大小都不匹配"）。视口盒把两者钉在同一个基准上。
   */
  return createPortal(
    <div className="gs-viewport">
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
    </div>,
    document.body
  )
}
