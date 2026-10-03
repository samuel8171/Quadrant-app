import { useMemo, useState } from 'react'
import type { MoneyConfig, QuadrantEvent } from '../../../../shared/types'
import { quadrantCostOf } from '../../../../shared/money'
import { MAX_DURATION_MIN } from '../../lib/weekRules'
import { worldToScreenX, worldToScreenY, type ViewState } from '../../lib/quadrantMath'
import GlassSurface from '../glass/GlassSurface'

/** 小时输入的允许上界，由域模型的时长上限换算（10 小时）。 */
const MAX_HOURS = MAX_DURATION_MIN / 60

/** 气泡锚定的事件的必要字段：展示（text/quadrant）与定位（x/y）各取所需。 */
type BubbleEvent = Pick<QuadrantEvent, 'id' | 'text' | 'quadrant' | 'x' | 'y'>

interface Props {
  /** 触发这次完成的事件卡片。 */
  event: BubbleEvent
  /**
   * 画布视图（pan/zoom）。
   *
   * **R3-D 起必须传入**：气泡的玻璃层已从 `.event-layer` 内部**搬到它的兄弟位置**
   * （挂在 `.quadrant-viewport` 下），因为 `.event-layer` 恒带 `transform`
   * —— 而 Chromium 里祖先的 `transform` 就是合成面，会把材质采到的背景截断
   * （实测保留率 0.659 = 只剩染色）。搬出来之后，定位不能再靠 `.event-layer`
   * 的包含块，得由这里用 `worldToScreenX/Y` 把画布坐标换算成**视口局部**坐标。
   * 详见组件头注释。
   */
  view: ViewState
  /**
   * 完成时刻自 0 点起的分钟数。
   *
   * **由父级传入、并在确认时原样复用**：气泡里的实时预览与最终落账读的是同一个数字，
   * 于是「气泡显示的数」必然等于「账本记下的数」（本任务的核心裁定之一）。
   * 页面的 `tick` 每分钟重渲染一次，这个值随之刷新。
   */
  nowMin: number
  config: MoneyConfig
  /** 该事件今天是否已经计过费（store 之外的第二道提示；真正的拦截在 store）。 */
  alreadyBilled: boolean
  /** 确认。`billable` 为 false 时上游**不写任何账**。 */
  onConfirm: (answer: { billable: boolean; actualMin: number }) => void
  onCancel: () => void
}

/**
 * 象限事件完成时的计费气泡（spec 7.4）。
 *
 * **非模态、内联**：四象限画布是高频拖拽区，模态会打断操作，所以这里既没有遮罩也不抢焦点。
 * 正因如此，根节点用 `role="group"`（带 `aria-label` 的可访问名）而**不是** `role="dialog"`：
 * 读屏软件对 `dialog` 的预期是「焦点会移进来、多半还有焦点陷阱」，而本气泡两样都没有 ——
 * 挂了 `dialog` 反而会误导用户去找一个并不存在的模态焦点区。`group` 准确地描述了
 * 「一组内联的、可选中的控件」。子层「是否计费」那个 `role="group"` 是它自己的分组，二者不冲突。
 * 两行 —— 第一行「是否计费」（**默认不计费**，一键即可跳过），第二行小时数输入
 * （**不预填**，spec 13.1 决策 2：给 `QuadrantEvent` 加预估时长字段要牵动 5 个持久化同步点，
 * 为一个小交互不值）。
 *
 * **手势隔离**：本组件挂在 `event-layer` 内、事件卡片之上，而整个 `.quadrant-viewport` 上
 * 绑着 `useCanvasGestures` 的 `pointerdown`（React 合成事件自下向上冒泡）。因此根节点把
 * `pointerdown` / `pointerup` / `click` / `dblclick` / `contextmenu` 一律 `stopPropagation`
 * —— 在气泡上按下指针既不会落进手势内核（拖动 / 平移 / 长按），也不会被画布的单击、
 * 双击（新建）与右键菜单处理。CSS 侧再以 `pointer-events: auto` 保证事件落在气泡本身
 * 而不是穿透到下层的画布。
 *
 * **实时数字**：勾选「计费」后，用当前时刻按 `quadrantCostOf` 现算时币与深夜分钟数。
 * 深夜判定与落账共用同一函数，因此显示值恒等于结算值。
 */
export default function QuadrantCostBubble({
  event,
  view,
  nowMin,
  config,
  alreadyBilled,
  onConfirm,
  onCancel
}: Props): JSX.Element {
  // 默认「不计费」：大多数象限事项不花钱，一键确认即可。
  const [billable, setBillable] = useState(false)
  // 刻意不预填（spec 13.1 决策 2）。
  const [hoursText, setHoursText] = useState('')

  const hours = Number(hoursText)
  const validHours = Number.isFinite(hours) && hours > 0
  // 时长为空 / 非法 / 非正时按 0 处理；上界由输入框的 max 与这里的钳制共同守住。
  const actualMin = validHours ? Math.min(MAX_DURATION_MIN, Math.round(hours * 60)) : 0

  // 只有「计费 + 有正时长」才需要预览；`useMemo` 的依赖里含 nowMin，保证跨分钟刷新。
  const preview = useMemo(
    () =>
      billable && actualMin > 0
        ? quadrantCostOf({ quadrant: event.quadrant, actualMin, nowMin }, config)
        : null,
    [billable, actualMin, event.quadrant, nowMin, config]
  )

  // 已计过费直接锁死确认（store 还会再拦一次）；勾了「计费」却没填有效时长同样不可确认。
  const confirmDisabled = alreadyBilled || (billable && !validHours)

  /*
   * 气泡的**视口局部**几何（R3-D）。
   *
   * 事件在世界坐标里的锚点是卡片左上角 `(x, -y*UNIT 方向)`；
   * `worldToScreenX/Y` 已含 pan 与 zoom，返回的是**相对 `.quadrant-viewport` 内边**
   * 的像素（`.event-layer` 就在该内边原点、无额外偏移）。
   *
   * 气泡底边贴在卡片顶边之上 8px、左边缘与卡片左对齐：
   *   left   = cardLeft
   *   bottom = cardTop - 8
   * 锚点取气泡中心，纵向再用 `--gs-panel-h` 把"底边对齐"换算成"中心对齐"：
   *   centerX = cardLeft + W/2
   *   centerY = cardTop - 8 - H/2
   * `W/H` 由 GlassSurface 实测（`--gs-panel-w/h`）—— 气泡高度随预览/提示变化，
   * 写死必错一格。`calc()` 读同一个数，两者恒等。
   */
  const cardLeft = worldToScreenX(event.x, view)
  const cardTop = worldToScreenY(event.y, view)

  return (
    /*
     * 液态玻璃外壳（R3-D）。
     *
     * ── ⭐ 为什么玻璃层必须挂在 `.event-layer` **之外**（R3-D 实测结论）
     *
     * 直觉上"气泡随画布平移缩放"⇒ 玻璃层该跟气泡一起待在 `.event-layer` 里。
     * 这条直觉**是错的**，而且错得很贵：Chromium 里**祖先的 `transform` 就是合成面**，
     * 会把 `backdrop-filter` 的背景采样截在那一层内部 ⇒ 材质只剩染色。
     *
     * 实测（同一组条纹、同一块材质板、同一个气泡，只动 `.event-layer` 的 transform）：
     *
     *   transform: translate(pan) scale(zoom)（真实值）  保留率 0.659  ← 死（只剩染色）
     *   transform: matrix(1,0,0,1,0,0)（**恒等**，仍存在） 保留率 0.659  ← 死
     *   transform: none（属性整个移除）                   保留率 0.111  ← 活
     *
     * 关键在第二行：连**恒等矩阵**都致病 ⇒ 与变换的数值无关，只要那一层上有
     * 一个 `transform` 声明就成立。而 `quadrantMath` 的视图恒写成
     * `translate(...) scale(...)`，不存在"pan=0/zoom=1 时就没事"的侥幸。
     *
     * ⇒ 结论：**`.event-layer` 是禁入区**（与 `.sidebar` 同理）。
     *   玻璃层改挂在 `.quadrant-viewport` 的直接子节点上（`.event-layer` 的**兄弟**），
     *   祖先链变成 `.gs-layer--bubble → .quadrant-viewport(relative/z:auto) → … → body`，
     *   全程无 `fixed` / `sticky` / `transform` / 非 auto 的 `z-index`。
     *
     * 代价是定位不再免费：不能再靠 `.event-layer` 的包含块，得把画布坐标
     * **显式换算**成视口局部坐标（上面 `worldToScreenX/Y`）。这反而是好事 ——
     * 换算出来的就是屏幕像素，与材质板采到的背景处在同一个坐标系里。
     *
     * ⚠️ **既有的画布拖拽/缩放要重渲染**：`view` 变化时本组件跟着重渲染，
     * 位置随 `worldToScreenX/Y` 刷新，所以气泡仍与卡片同步平移缩放。
     * `view` 因此是必需 prop（不是可选优化）。
     *
     * ── 另一处被探针逼出来的改法：玻璃体**就是**气泡
     *
     * 更早的实现把已成形的 `.quadrant-cost-bubble`（`position:absolute` +
     * `transform: translateY(-100% - 8px)`）整块塞进 GlassSurface 内容层，两个后果：
     *   ① 内容层只有一个绝对定位子节点 ⇒ 不贡献高度 ⇒ 玻璃面高 24px（只剩内边距），
     *      材质板量成 256×24，而气泡实际 260×136；
     *   ② 气泡靠自身 transform 上移 `100%+8px`，材质板却按**布局**位置居中
     *      （`ResizeObserver` 报 borderBox、不含 transform）⇒ 纵向错开一整块。
     * 实测该形态 fallback 0.461 / chromium 0.656。
     *
     * 现在让浮层内容进入正常流（撑开玻璃面），外观类 `.quadrant-cost-bubble`
     * 挂到**内容层**（`contentClassName`）负责排版与指针行为；
     * 定位与"贴到卡片上方"的位移由上面的锚点表达式承担。
     *
     * ── 6 条约束的落点（逐条）
     *   ① 材质板 `.gs-plate` 是面板的**兄弟**、挂在不带 transform 的 `.gs-anchor` 上 —— 符合。
     *   ② 祖先链：`.gs-plate → .gs-anchor → .gs-layer--bubble → .quadrant-viewport(relative)
     *      → .quadrant-page(relative) → … → body`。**无 transform**（关键，见上）、
     *      无 `fixed` / `sticky` / 非 auto 的 `z-index` —— 符合。层级走 `--gs-z`。
     *   ③ 位移滤镜由库写在材质板的 `backdrop-filter` 的 `url()` 里（GlassSurface 负责）—— 符合。
     *   ④ 玻璃层的 `backdrop-filter` 里不含 `url(` —— 由 GlassSurface 守。
     *   ⑤ 本层的含块是 `.quadrant-viewport`（有尺寸），故 `inset: 0` 也可用；
     *      但层自身不需要尺寸（几何全在锚点上），仍按 §五之二 写 `inset: auto`。
     *   ⑥ 手机端 forceEngine=fallback 由探针两档各量一次覆盖。
     *
     * ── 手势隔离
     *
     * 玻璃层自己 `pointer-events: none`；接指针的仍是内容层上的 `.quadrant-cost-bubble`，
     * 它的 `stopPropagation` 与 `pointer-events: auto` 原样保留 —— 玻璃化不改变
     * 任何指针行为（R3-D 的硬要求，探针里单列一条）。
     */
    <GlassSurface
      center={{
        top: `calc(${cardTop}px - 8px - var(--gs-panel-h, 0px) / 2)`,
        left: `calc(${cardLeft}px + var(--gs-panel-w, 0px) / 2)`
      }}
      contentWidth="232px"
      padding="12px"
      layerClassName="gs-layer--bubble"
      panelClassName="quadrant-cost-bubble-panel"
      contentClassName="quadrant-cost-bubble"
    >
      <div
        role="group"
        aria-label={`为「${event.text}」记一次用时`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
      <div className="qcb-line qcb-line--toggle">
        <span className="qcb-label">是否计费</span>
        <div className="qcb-toggle" role="group" aria-label="是否计费">
          <button
            type="button"
            className={`qcb-opt${billable ? '' : ' active'}`}
            aria-pressed={!billable}
            onClick={() => setBillable(false)}
          >
            不计费
          </button>
          <button
            type="button"
            className={`qcb-opt${billable ? ' active' : ''}`}
            aria-pressed={billable}
            onClick={() => setBillable(true)}
          >
            计费
          </button>
        </div>
      </div>

      <label className="qcb-line qcb-line--hours">
        <span className="qcb-label">用时</span>
        <input
          className="qcb-hours"
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_HOURS}
          step={0.5}
          placeholder="0"
          value={hoursText}
          disabled={!billable}
          onChange={(e) => setHoursText(e.target.value)}
        />
        <span className="qcb-unit">小时</span>
      </label>

      {billable && (
        <p className="qcb-preview">
          {preview ? (
            <>
              本条目约 <strong>{preview.costTC}</strong> 币
              {preview.nightMin > 0 && (
                <span className="qcb-night">
                  （含深夜 {preview.nightMin} 分钟 ×{config.nightMultiplier}）
                </span>
              )}
            </>
          ) : (
            <span className="qcb-hint">填一个大于 0 的小时数</span>
          )}
        </p>
      )}

      {alreadyBilled && (
        <p className="qcb-warn">今天已为这条记录过一次，重复确认不会再记一笔</p>
      )}

      <div className="qcb-actions">
        <button type="button" className="qcb-btn" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="qcb-btn qcb-btn--primary"
          disabled={confirmDisabled}
          onClick={() => onConfirm({ billable, actualMin })}
        >
          确认
        </button>
      </div>
      </div>
    </GlassSurface>
  )
}
