import { useMemo, useState } from 'react'
import type { MoneyConfig, QuadrantEvent } from '../../../../shared/types'
import { quadrantCostOf } from '../../../../shared/money'
import { MAX_DURATION_MIN } from '../../lib/weekRules'
import { UNIT } from '../../lib/quadrantMath'

/** 小时输入的允许上界，由域模型的时长上限换算（10 小时）。 */
const MAX_HOURS = MAX_DURATION_MIN / 60

/** 气泡锚定的事件的必要字段：展示（text/quadrant）与定位（x/y）各取所需。 */
type BubbleEvent = Pick<QuadrantEvent, 'id' | 'text' | 'quadrant' | 'x' | 'y'>

interface Props {
  /** 触发这次完成的事件卡片。 */
  event: BubbleEvent
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

  return (
    <div
      className="quadrant-cost-bubble"
      style={{ left: event.x * UNIT, top: -event.y * UNIT }}
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
  )
}
