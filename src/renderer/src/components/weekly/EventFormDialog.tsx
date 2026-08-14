import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  WEEK_COLORS,
  type Quadrant,
  type WeekEvent,
  type WeekPreset
} from '../../../../shared/types'
import { QUADRANT_META } from '../../lib/quadrantMath'
import {
  MAX_DURATION_MIN,
  MIN_DURATION_MIN,
  clampEventTimes,
  normalizeDuration
} from '../../lib/weekRules'
import { useAppStore } from '../../state/appStore'
import ConfirmDialog from '../ConfirmDialog'

export type WeeklyFormState =
  | { kind: 'preset-create' }
  | { kind: 'preset-edit'; preset: WeekPreset }
  | { kind: 'event-create'; date: string; startMin: number }
  | { kind: 'event-edit'; event: WeekEvent }

interface Props {
  form: WeeklyFormState
  onClose: () => void
}

const QUICK_DURATIONS = [30, 60, 90, 120, 150, 180, 240]
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5)

interface FieldState {
  title: string
  color: string
  quadrant: Quadrant
  remark: string
  error: string
  durationMin: number
  customDuration: boolean
  startMin: number
  endMin: number
}

function initState(form: WeeklyFormState): FieldState {
  if (form.kind === 'preset-edit') {
    return {
      title: form.preset.title,
      color: form.preset.color,
      quadrant: form.preset.quadrant,
      remark: form.preset.remark,
      error: '',
      durationMin: form.preset.durationMin,
      customDuration: false,
      startMin: 420,
      endMin: 480
    }
  }
  if (form.kind === 'event-edit') {
    return {
      title: form.event.title,
      color: form.event.color,
      quadrant: form.event.quadrant,
      remark: form.event.remark,
      error: '',
      durationMin: 60,
      customDuration: false,
      startMin: form.event.startMin,
      endMin: form.event.endMin
    }
  }
  if (form.kind === 'event-create') {
    const times = clampEventTimes(form.startMin, form.startMin + 60)
    return {
      title: '',
      color: WEEK_COLORS[0],
      quadrant: 1,
      remark: '',
      error: '',
      durationMin: 60,
      customDuration: false,
      startMin: times.startMin,
      endMin: times.endMin
    }
  }
  return {
    title: '',
    color: WEEK_COLORS[0],
    quadrant: 1,
    remark: '',
    error: '',
    durationMin: 60,
    customDuration: false,
    startMin: 420,
    endMin: 480
  }
}

export default function EventFormDialog({ form, onClose }: Props): JSX.Element {
  const addPreset = useAppStore((s) => s.addPreset)
  const updatePreset = useAppStore((s) => s.updatePreset)
  const deletePreset = useAppStore((s) => s.deletePreset)
  const addWeekEvent = useAppStore((s) => s.addWeekEvent)
  const updateWeekEvent = useAppStore((s) => s.updateWeekEvent)
  const deleteWeekEvent = useAppStore((s) => s.deleteWeekEvent)

  const [fields, setFields] = useState<FieldState>(() => initState(form))
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setFields(initState(form))
  }, [form])

  const isPreset = form.kind === 'preset-create' || form.kind === 'preset-edit'
  const isEdit = form.kind === 'preset-edit' || form.kind === 'event-edit'

  const startHour = Math.min(23, Math.max(7, Math.floor(fields.startMin / 60)))
  const startMinute = fields.startMin % 60
  const endHour = Math.min(24, Math.max(7, Math.floor(fields.endMin / 60)))
  const endMinute = fields.endMin % 60
  const customHour = Math.min(10, Math.floor(fields.durationMin / 60))
  const customMinute = fields.durationMin % 60

  const save = (): void => {
    const title = fields.title.trim()
    if (!title) {
      setFields((f) => ({ ...f, error: '请输入标题' }))
      return
    }
    if (isPreset) {
      const duration = normalizeDuration(fields.durationMin)
      if (fields.durationMin < MIN_DURATION_MIN || fields.durationMin > MAX_DURATION_MIN) {
        setFields((f) => ({ ...f, error: `时长需在${MIN_DURATION_MIN}分钟到10小时之间` }))
        return
      }
      if (form.kind === 'preset-create') {
        addPreset({ title, color: fields.color, quadrant: fields.quadrant, durationMin: duration, remark: fields.remark })
      } else {
        updatePreset(form.preset.id, {
          title,
          color: fields.color,
          quadrant: fields.quadrant,
          durationMin: duration,
          remark: fields.remark
        })
      }
      onClose()
      return
    }
    if (fields.endMin - fields.startMin > MAX_DURATION_MIN) {
      setFields((f) => ({ ...f, error: '时长不能超过10小时' }))
      return
    }
    const times = clampEventTimes(fields.startMin, fields.endMin)
    if (times.endMin <= times.startMin) {
      setFields((f) => ({ ...f, error: '截止时间需晚于开始时间' }))
      return
    }
    if (form.kind === 'event-create') {
      addWeekEvent({
        date: form.date,
        title,
        color: fields.color,
        quadrant: fields.quadrant,
        startMin: times.startMin,
        endMin: times.endMin,
        remark: fields.remark
      })
    } else {
      updateWeekEvent(form.event.id, {
        title,
        color: fields.color,
        quadrant: fields.quadrant,
        startMin: times.startMin,
        endMin: times.endMin,
        remark: fields.remark
      })
    }
    onClose()
  }

  const doDelete = (): void => {
    if (form.kind === 'preset-edit') deletePreset(form.preset.id)
    if (form.kind === 'event-edit') deleteWeekEvent(form.event.id)
    onClose()
  }

  const titleText =
    form.kind === 'preset-create'
      ? '新建事件预设'
      : form.kind === 'preset-edit'
        ? '编辑事件预设'
        : form.kind === 'event-create'
          ? '新建事件'
          : '编辑事件'

  return (
    <>
      <div className="modal-mask" onClick={onClose}>
        <div className="modal weekly-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{titleText}</h3>
        <label className="modal-field">
          标题
          <input
            value={fields.title}
            autoFocus
            placeholder="输入事件标题"
            onChange={(e) => setFields((f) => ({ ...f, title: e.target.value, error: '' }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
              if (e.key === 'Escape') onClose()
            }}
          />
        </label>
        <div className="modal-field">
          颜色
          <div className="color-row">
            {WEEK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-dot${fields.color === color ? ' selected' : ''}`}
                style={{ background: color }}
                title={color}
                onClick={() => setFields((f) => ({ ...f, color, error: '' }))}
              />
            ))}
          </div>
        </div>
        <div className="modal-field">
          重要紧急程度
          <div className="quad-row">
            {([1, 2, 3, 4] as Quadrant[]).map((q) => (
              <button
                key={q}
                type="button"
                className={`quad-option${fields.quadrant === q ? ' selected' : ''}`}
                onClick={() => setFields((f) => ({ ...f, quadrant: q, error: '' }))}
              >
                <span className="quad-dot" style={{ background: QUADRANT_META[q].color }} />
                <span>{QUADRANT_META[q].label}</span>
              </button>
            ))}
          </div>
        </div>
        {isPreset ? (
          <div className="modal-field">
            事件时间长度
            <div className="duration-row">
              {QUICK_DURATIONS.map((duration) => (
                <button
                  key={duration}
                  type="button"
                  className={`duration-chip${
                    !fields.customDuration && fields.durationMin === duration ? ' selected' : ''
                  }`}
                  onClick={() =>
                    setFields((f) => ({
                      ...f,
                      durationMin: duration,
                      customDuration: false,
                      error: ''
                    }))
                  }
                >
                  {duration / 60}小时
                </button>
              ))}
              <button
                type="button"
                className={`duration-chip${fields.customDuration ? ' selected' : ''}`}
                onClick={() => setFields((f) => ({ ...f, customDuration: true, error: '' }))}
              >
                自定义
              </button>
            </div>
            {fields.customDuration && (
              <div className="duration-custom">
                <select
                  className="duration-select"
                  value={customHour}
                  onChange={(e) =>
                    setFields((f) => ({
                      ...f,
                      durationMin: Number(e.target.value) * 60 + customMinute,
                      error: ''
                    }))
                  }
                >
                  {Array.from({ length: 11 }, (_, h) => (
                    <option key={h} value={h}>
                      {h}小时
                    </option>
                  ))}
                </select>
                <select
                  className="duration-select"
                  value={customMinute}
                  onChange={(e) =>
                    setFields((f) => ({
                      ...f,
                      durationMin: customHour * 60 + Number(e.target.value),
                      error: ''
                    }))
                  }
                >
                  {MINUTE_STEPS.map((m) => (
                    <option key={m} value={m}>
                      {m}分钟
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : (
          <div className="modal-field">
            时间
            <div className="time-row">
              <span className="time-label">开始</span>
              <select
                value={startHour}
                onChange={(e) =>
                  setFields((f) => ({
                    ...f,
                    startMin: Number(e.target.value) * 60 + startMinute,
                    error: ''
                  }))
                }
              >
                {Array.from({ length: 17 }, (_, i) => i + 7).map((h) => (
                  <option key={h} value={h}>
                    {h}时
                  </option>
                ))}
              </select>
              <select
                value={startMinute}
                onChange={(e) =>
                  setFields((f) => ({
                    ...f,
                    startMin: startHour * 60 + Number(e.target.value),
                    error: ''
                  }))
                }
              >
                {MINUTE_STEPS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}分
                  </option>
                ))}
              </select>
            </div>
            <div className="time-row">
              <span className="time-label">截止</span>
              <select
                value={endHour}
                onChange={(e) =>
                  setFields((f) => ({
                    ...f,
                    endMin: Number(e.target.value) * 60 + (Number(e.target.value) === 24 ? 0 : endMinute),
                    error: ''
                  }))
                }
              >
                {Array.from({ length: 18 }, (_, i) => i + 7).map((h) => (
                  <option key={h} value={h}>
                    {h}时
                  </option>
                ))}
              </select>
              <select
                value={endMinute}
                disabled={endHour === 24}
                onChange={(e) =>
                  setFields((f) => ({
                    ...f,
                    endMin: endHour * 60 + Number(e.target.value),
                    error: ''
                  }))
                }
              >
                {MINUTE_STEPS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}分
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <label className="modal-field">
          备注
          <textarea
            value={fields.remark}
            rows={3}
            placeholder="可选"
            onChange={(e) => setFields((f) => ({ ...f, remark: e.target.value }))}
          />
        </label>
        {fields.error && <div className="dialog-error">{fields.error}</div>}
        <div className="modal-actions">
          {isEdit && (
            <button className="modal-btn danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} />
              删除
            </button>
          )}
          <span className="modal-spacer" />
          <button className="modal-btn" onClick={onClose}>
            取消
          </button>
          <button className="modal-btn primary" onClick={save}>
            保存
          </button>
        </div>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          message="确定删除？此操作不可撤销。"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
