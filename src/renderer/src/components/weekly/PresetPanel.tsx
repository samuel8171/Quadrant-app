import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WeekPreset } from '../../../../shared/types'
import { withAlpha } from '../../lib/color'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { formatDuration } from '../../lib/weekRules'
import { shouldUsePresetOnTap } from '../../lib/weeklyMobileLayout'
import { PRESET_DRAG_MIME, beginPresetDrag, endPresetDrag } from '../../lib/presetDrag'

interface Props {
  presets: WeekPreset[]
  onAdd: () => void
  onEdit: (preset: WeekPreset) => void
  onUse: (preset: WeekPreset) => void
  onDelete: (preset: WeekPreset) => void
}

export default function PresetPanel({
  presets,
  onAdd,
  onEdit,
  onUse,
  onDelete
}: Props): JSX.Element {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth
  )
  /*
   * 窄屏默认收起。展开态的抽屉是浮层，会盖住时间轴下部约 190px（实测），
   * 一进来就默认展开等于白送掉这些像素；桌面端面板在侧栏里不遮挡任何东西，仍默认展开。
   */
  const [expanded, setExpanded] = useState(
    () => !shouldUsePresetOnTap(typeof window === 'undefined' ? 1024 : window.innerWidth)
  )
  const sorted = [...presets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  useEffect(() => {
    const updateViewportWidth = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  const isMobile = shouldUsePresetOnTap(viewportWidth)

  /*
   * 跨过断点时重置展开态：面板从侧栏变成底部抽屉（或反过来）时，
   * 沿用上一次的展开状态没有意义——手机端一进来就展开会盖掉约 190px 时间轴。
   */
  useEffect(() => {
    setExpanded(!isMobile)
  }, [isMobile])

  /*
   * 桌面端没有"收起"这个概念：面板在侧栏里不遮挡任何东西，列表恒显、标题不可点。
   * 只有窄屏（抽屉形态）才需要折叠，所以这里把「是否渲染折叠控件」与「列表是否显示」
   * 分开表达，而不是共用一个 expanded。
   */
  const collapsible = isMobile
  const listOpen = !collapsible || expanded

  const headContent = (
    <>
      <h3>事件预设{presets.length > 0 ? ` · ${presets.length}` : ''}</h3>
      {collapsible && <ChevronDown size={16} />}
    </>
  )

  return (
    <aside className={`preset-panel${listOpen ? ' expanded' : ' collapsed'}`}>
      <div className="preset-head">
        {collapsible ? (
          <button
            className="preset-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {headContent}
          </button>
        ) : (
          <div className="preset-toggle static">{headContent}</div>
        )}
        <button className="icon-btn" title="新建预设" aria-label="新建预设" onClick={onAdd}>
          <Plus size={16} />
        </button>
      </div>
      {/*
       * 外层只负责高度过渡，内层负责排列与滚动。
       * 用 grid-template-rows 0fr → 1fr 而不是 max-height：fr 是数值，浏览器可插值，
       * 于是"高度自适应内容"也能有过渡，且时长恒定（max-height 会因猜不准而忽快忽慢）。
       * 内层的 min-height: 0 必须写，否则轨道不会被压到 0，收起等于没反应。
       */}
      <div className="preset-collapse">
        <div className="preset-list">
          {sorted.length === 0 && <div className="preset-empty">暂无预设，点击 ＋ 新建</div>}
        {sorted.map((preset) => {
          const quadrant = QUADRANT_META[preset.quadrant]
          const showMeta = preset.durationMin >= 45
          return (
            <div
              key={preset.id}
              data-preset-id={preset.id}
              className="preset-card"
              draggable
              title="拖到左侧时间轴创建事件"
              style={{
                background: withAlpha(preset.color, 0.12),
                borderColor: withAlpha(preset.color, 0.45),
                // 高度只在桌面端随预设时长伸缩；手机抽屉里的卡片是固定尺寸的横排条目，
                // 尺寸交给 CSS（theme.css 的 .preset-card），内联高度会盖掉它。
                height: isMobile
                  ? undefined
                  : Math.min(260, Math.max(56, 56 + (preset.durationMin / 60) * 24))
              }}
              onDragStart={(e) => {
                // 时间轴在 dragover 阶段读不到 dataTransfer 内容，靠这个登记簿反查预设。
                beginPresetDrag(preset.id)
                e.dataTransfer.setData(PRESET_DRAG_MIME, preset.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              // 拖到画布外松手、或按 Esc 取消时，必须清掉登记簿与预览，
              // 否则时间轴上会残留一个永远不会消失的落点幽灵。
              onDragEnd={() => endPresetDrag()}
              onClick={() => (isMobile ? onUse(preset) : onEdit(preset))}
              onDoubleClick={() => {
                if (!isMobile) onEdit(preset)
              }}
            >
              <div className="preset-title">{preset.title}</div>
              {showMeta && (
                <div className="preset-meta">
                  <span className="quad-dot" style={{ background: quadrant.color }} />
                  <span>{quadrant.label}</span>
                </div>
              )}
              <div className="preset-duration">{formatDuration(preset.durationMin)}</div>
              <div className="preset-actions">
                <button className="icon-btn" title="编辑预设" onClick={(e) => { e.stopPropagation(); onEdit(preset) }}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除预设"
                  onClick={(e) => { e.stopPropagation(); onDelete(preset) }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
        </div>
      </div>
    </aside>
  )
}
