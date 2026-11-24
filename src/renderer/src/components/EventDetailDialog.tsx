import { useEffect, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import type { Quadrant, QuadrantEvent } from '../../../shared/types'
import { MAX_EVENT_PHOTOS } from '../../../shared/types'
import { autoEventWidth, QUADRANT_META } from '../lib/quadrantMath'
import { useClosing } from '../hooks/useClosing'
import { usePhotoUrls } from '../hooks/usePhotoUrls'
import ConfirmDialog from './ConfirmDialog'
import GlassModal, { shouldAutoFocusModalInput } from './glass/GlassModal'

interface Props {
  event: QuadrantEvent
  onSave: (patch: Partial<QuadrantEvent>) => void
  onClose: () => void
  onAddPhotos: () => void
  onDeletePhoto: (photoId: string) => void
  photoBusy: boolean
  photoFailed: boolean
}

export default function EventDetailDialog({
  event, onSave, onClose, onAddPhotos, onDeletePhoto, photoBusy, photoFailed
}: Props): JSX.Element {
  const { closing, close } = useClosing(onClose)
  const { text: title, quadrant: eventQuadrant, remark: eventRemark, deadline: eventDeadline, escalateAt: eventEscalateAt } = event
  const [text, setText] = useState(title)
  const [quadrant, setQuadrant] = useState<Quadrant>(eventQuadrant)
  const [remark, setRemark] = useState(eventRemark)
  const [deadline, setDeadline] = useState(toLocalInput(eventDeadline))
  const [escalateAt, setEscalateAt] = useState(toLocalInput(eventEscalateAt))
  const [photoToDelete, setPhotoToDelete] = useState<string | null>(null)
  const photos = event.photos ?? []
  const urls = usePhotoUrls(photos)

  useEffect(() => {
    setText(title)
    setQuadrant(eventQuadrant)
    setRemark(eventRemark)
    setDeadline(toLocalInput(eventDeadline))
    setEscalateAt(toLocalInput(eventEscalateAt))
  }, [title, eventQuadrant, eventRemark, eventDeadline, eventEscalateAt])

  const save = (): void => {
    const title = text.trim()
    if (!title) return
    onSave({
      ...(title === event.text ? {} : { text: title, width: autoEventWidth(title) }),
      quadrant,
      remark,
      deadline: fromLocalInput(deadline),
      escalateAt:
        (quadrant === 2 || quadrant === 3) && escalateAt
          ? fromLocalInput(escalateAt)
          : undefined
    })
    close()
  }

  return (<>
    <GlassModal closing={closing} onMaskClick={close}>
      <h3>事件详细信息</h3>
      <label className="modal-field">
        名称
        <input value={text} onChange={(e) => setText(e.target.value)} autoFocus={shouldAutoFocusModalInput()} />
      </label>
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
      <section className="event-detail-photos" aria-label="事件照片">
        <div className="event-detail-photo-header">
          <span>照片 {photos.length}/{MAX_EVENT_PHOTOS}</span>
          <button type="button" className="modal-btn event-detail-photo-add" onClick={onAddPhotos}
            disabled={photoBusy || photos.length >= MAX_EVENT_PHOTOS}>
            <ImagePlus size={16} aria-hidden="true" />
            {photoBusy ? '正在添加…' : '添加照片'}
          </button>
        </div>
        {photoFailed && <p className="event-detail-photo-status" role="status">照片添加失败，请重新选择。</p>}
        {photos.length > 0 && (
          <ul className="event-detail-photo-list">
            {photos.map((id, index) => (
              <li key={id}>
                {urls[index]
                  ? <img src={urls[index]!} alt={`第 ${index + 1} 张照片`} />
                  : <span className="event-detail-photo-placeholder">照片 {index + 1}</span>}
                <button type="button" className="event-detail-photo-delete"
                  aria-label={`删除第 ${index + 1} 张照片`} disabled={photoBusy}
                  onClick={() => setPhotoToDelete(id)}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="modal-actions">
        <button className="modal-btn" onClick={close}>
          取消
        </button>
        <button className="modal-btn primary" onClick={save} disabled={!text.trim()}>
          保存
        </button>
      </div>
    </GlassModal>
    {photoToDelete && (
      <ConfirmDialog message="确定删除这张照片？"
        onConfirm={() => onDeletePhoto(photoToDelete)}
        onCancel={() => setPhotoToDelete(null)}
      />
    )}
  </>)
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
