import { useClosing } from '../hooks/useClosing'

interface Props {
  message: string
  /** 可选的补充说明（同步差异摘要、影响范围等），支持换行。 */
  detail?: string
  /** `detail` 中是否含⚠️警示，决定其配色。 */
  warning?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({ message, detail, warning, onConfirm, onCancel }: Props): JSX.Element {
  const { closing, close } = useClosing(onCancel)
  return (
    <div className={`modal-mask${closing ? ' closing' : ''}`} onClick={close}>
      <div
        className={`modal confirm-modal${closing ? ' closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>确认操作</h3>
        <p className="confirm-message">{message}</p>
        {detail && <div className={`confirm-detail${warning ? ' warning' : ''}`}>{detail}</div>}
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
