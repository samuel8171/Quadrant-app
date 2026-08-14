interface Props {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, onConfirm, onCancel }: Props): JSX.Element {
  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>确认操作</h3>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn" autoFocus onClick={onCancel}>
            取消
          </button>
          <button
            className="modal-btn primary"
            onClick={() => {
              onConfirm()
              onCancel()
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
