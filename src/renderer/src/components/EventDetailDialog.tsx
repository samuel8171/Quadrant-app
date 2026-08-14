import { useEffect, useState } from 'react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import { QUADRANT_META } from '../lib/quadrantMath'

interface Props {
  event: QuadrantEvent
  onSave: (patch: Partial<QuadrantEvent>) => void
  onClose: () => void
}

export default function EventDetailDialog({ event, onSave, onClose }: Props): JSX.Element {
  const [quadrant, setQuadrant] = useState<Quadrant>(event.quadrant)
  const [remark, setRemark] = useState(event.remark)
  const [deadline, setDeadline] = useState(toLocalInput(event.deadline))
  const [escalateAt, setEscalateAt] = useState(toLocalInput(event.escalateAt))

  useEffect(() => {
    setQuadrant(event.quadrant)
    setRemark(event.remark)
    setDeadline(toLocalInput(event.deadline))
    setEscalateAt(toLocalInput(event.escalateAt))
  }, [event])

  const save = (): void => {
    onSave({
      quadrant,
      remark,
      deadline: fromLocalInput(deadline),
      escalateAt:
        (quadrant === 2 || quadrant === 3) && escalateAt
          ? fromLocalInput(escalateAt)
          : undefined
    })
    onClose()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>事件详细信息</h3>
        <label className="modal-field">
          所属象限
          <select value={quadrant} onChange={(e) => setQuadrant(Number(e.target.value) as Quadrant)}>
            {([1, 2, 3, 4] as Quadrant[]).map((q) => (
              <option key={q} value={q}>
                {QUADRANT_META[q].label}
              </option>
            ))}
          </select>
        </label>
        <label className="modal-field">
          备注
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={3}
            autoFocus
          />
        </label>
        <label className="modal-field">
          截止时间
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </label>
        {(quadrant === 2 || quadrant === 3) && (
          <label className="modal-field">
            转为紧急时间
            <input
              type="datetime-local"
              value={escalateAt}
              onChange={(e) => setEscalateAt(e.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="modal-btn" onClick={onClose}>
            取消
          </button>
          <button className="modal-btn primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}
