import { useState } from 'react'
import { useClosing } from '../hooks/useClosing'

interface Props {
  title: string
  remark: string
  onSave: (remark: string) => void
  onClose: () => void
}

export default function GoalDetailDialog({ title, remark, onSave, onClose }: Props): JSX.Element {
  const [draft, setDraft] = useState(remark)
  const { closing, close } = useClosing(onClose)

  return (
    <div className={`modal-mask${closing ? ' closing' : ''}`} onClick={close}>
      <div className={`modal${closing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h3>目标详细信息</h3>
        <label className="modal-field">
          标题
          <span className="goal-detail-title">{title}</span>
        </label>
        <label className="modal-field">
          备注
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="添加备注…"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="modal-btn" onClick={close}>
            取消
          </button>
          <button
            className="modal-btn primary"
            onClick={() => {
              onSave(draft)
              close()
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
