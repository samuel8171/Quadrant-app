import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { WeekPreset } from '../../../../shared/types'
import { withAlpha } from '../../lib/color'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { formatDuration } from '../../lib/weekRules'

interface Props {
  presets: WeekPreset[]
  onAdd: () => void
  onEdit: (preset: WeekPreset) => void
  onDelete: (preset: WeekPreset) => void
}

export default function PresetPanel({
  presets,
  onAdd,
  onEdit,
  onDelete
}: Props): JSX.Element {
  const sorted = [...presets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return (
    <aside className="preset-panel">
      <div className="preset-head">
        <h3>事件预设</h3>
        <button className="icon-btn" title="新建预设" onClick={onAdd}>
          <Plus size={16} />
        </button>
      </div>
      <div className="preset-list">
        {sorted.length === 0 && <div className="preset-empty">暂无预设，点击 ＋ 新建</div>}
        {sorted.map((preset) => {
          const quadrant = QUADRANT_META[preset.quadrant]
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
                height: Math.min(260, Math.max(56, 56 + (preset.durationMin / 60) * 24))
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-preset-id', preset.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => onEdit(preset)}
            >
              <div className="preset-title">{preset.title}</div>
              <div className="preset-meta">
                <span className="quad-dot" style={{ background: quadrant.color }} />
                <span>{quadrant.label}</span>
              </div>
              <div className="preset-duration">{formatDuration(preset.durationMin)}</div>
              <div className="preset-actions">
                <button className="icon-btn" title="编辑预设" onClick={() => onEdit(preset)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  title="删除预设"
                  onClick={() => onDelete(preset)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
