import { useClosing } from '../hooks/useClosing'

interface Props {
  title?: string
  message: string
  onClose: () => void
}

export default function AlertDialog({ title = '提示', message, onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose)
  return (
    <div className={`modal-mask${closing ? ' closing' : ''}`} onClick={close}>
      <div
        className={`modal confirm-modal${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn primary" autoFocus onClick={close}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
