import { useClosing } from '../hooks/useClosing'
import GlassModal from './glass/GlassModal'

interface Props {
  title?: string
  message: string
  onClose: () => void
}

export default function AlertDialog({ title = '提示', message, onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose)
  return (
    <GlassModal
      closing={closing}
      onMaskClick={close}
      className="confirm-modal"
      contentWidth="min(312px, calc(100vw - 96px))"
    >
      <h3>{title}</h3>
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <button className="modal-btn primary" autoFocus onClick={close}>
          确定
        </button>
      </div>
    </GlassModal>
  )
}
