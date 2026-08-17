import { useState } from 'react'

interface Props {
  onResolve: (action: 'save' | 'discard') => void
  onCancel: () => void
}

export default function LeaveConfirmDialog({ onResolve, onCancel }: Props): JSX.Element {
  const [closing, setClosing] = useState(false)

  const finish = (fn: () => void): void => {
    if (closing) return
    setClosing(true)
    window.setTimeout(fn, 160)
  }

  return (
    <div className={`modal-mask${closing ? ' closing' : ''}`} onClick={() => finish(onCancel)}>
      <div
        className={`modal confirm-modal${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>是否保存草稿？</h3>
        <p className="confirm-message">当前复盘内容有未保存的修改。</p>
        <div className="modal-actions">
          <button className="modal-btn" onClick={() => finish(onCancel)}>
            取消
          </button>
          <button className="modal-btn" onClick={() => finish(() => onResolve('discard'))}>
            不保存
          </button>
          <button className="modal-btn primary" onClick={() => finish(() => onResolve('save'))}>
            保存草稿
          </button>
        </div>
      </div>
    </div>
  )
}
