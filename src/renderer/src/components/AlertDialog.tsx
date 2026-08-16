interface Props {
  title?: string
  message: string
  onClose: () => void
}

export default function AlertDialog({ title = '提示', message, onClose }: Props): JSX.Element {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn primary" autoFocus onClick={onClose}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
