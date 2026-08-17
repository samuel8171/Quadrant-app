import { useClosing } from '../hooks/useClosing'

interface Props {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, onConfirm, onCancel }: Props): JSX.Element {
  const { closing, close } = useClosing(onCancel)
  return (
    <div className={`modal-mask${closing ? ' closing' : ''}`} onClick={close}>
      <div
        className={`modal confirm-modal${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>确认操作</h3>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn" autoFocus onClick={close}>
            取消
          </button>
          <button
            className="modal-btn primary"
            onClick={() => {
              onConfirm()
              close()
            }}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
