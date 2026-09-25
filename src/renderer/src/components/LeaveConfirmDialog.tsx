import { useState } from 'react'
import GlassModal from './glass/GlassModal'

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
    <GlassModal
      closing={closing}
      onMaskClick={() => finish(onCancel)}
      className="confirm-modal"
      contentWidth="min(312px, calc(100vw - 96px))"
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
    </GlassModal>
  )
}
