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
  clampEndForDuration,
  clampEventTimes,
  clampStartForDuration,
  validateEventTimes,
  normalizeDuration
} from '../../lib/weekRules'
import { useAppStore } from '../../state/appStore'
import ConfirmDialog from '../ConfirmDialog'
import { useClosing } from '../../hooks/useClosing'

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
  showInQuadrant: boolean
  lockDuration: boolean
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
      endMin: 480,
      showInQuadrant: false,
      lockDuration: false
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
      endMin: form.event.endMin,
      showInQuadrant: form.event.showInQuadrant,
      lockDuration: false
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
      endMin: times.endMin,
      showInQuadrant: false,
      lockDuration: false
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
    endMin: 480,
    showInQuadrant: false,
    lockDuration: false
  }
}

export default function EventFormDialog({ form, onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose)
  const addPreset = useAppStore((s) => s.addPreset)
  const updatePreset = useAppStore((s) => s.updatePreset)
  const deletePreset = useAppStore((s) => s.deletePreset)
  const addWeekEvent = useAppStore((s) => s.addWeekEvent)
  const updateWeekEvent = useAppStore((s) => s.updateWeekEvent)
  const deleteWeekEvent = useAppStore((s) => s.deleteWeekEvent)
  const weekPresets = useAppStore((s) => s.data.weekPresets)

  const [fields, setFields] = useState<FieldState>(() => initState(form))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mode, setMode] = useState<'custom' | 'preset'>('custom')
  const [selectedPresetId, setSelectedPresetId] = useState('')

  useEffect(() => {
    setFields(initState(form))
    setMode('custom')
    setSelectedPresetId('')
  }, [form])

  const isPreset = form.kind === 'preset-create' || form.kind === 'preset-edit'
  const isEdit = form.kind === 'preset-edit' || form.kind === 'event-edit'
  const sortedPresets = [...weekPresets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const startHour = Math.min(23, Math.max(7, Math.floor(fields.startMin / 60)))
  const startMinute = fields.startMin % 60
  const endHour = Math.min(24, Math.max(7, Math.floor(fields.endMin / 60)))
  const endMinute = fields.endMin % 60
  const customHour = Math.min(10, Math.floor(fields.durationMin / 60))
  const customMinute = fields.durationMin % 60

  const applyPreset = (presetId: string): void => {
    setSelectedPresetId(presetId)
    const preset = weekPresets.find((p) => p.id === presetId)
    if (!preset) return
    const duration = preset.durationMin
    const start = clampStartForDuration(fields.startMin, duration)
    setFields((f) => ({
      ...f,
      title: preset.title,
      color: preset.color,
      quadrant: preset.quadrant,
      remark: preset.remark,
      startMin: start,
      endMin: start + duration,
      durationMin: duration,
      customDuration: false,
      error: ''
    }))
  }

  const setStartTime = (value: number): void => {
    if (!fields.lockDuration) {
      setFields((f) => ({ ...f, startMin: value, error: '' }))
      return
    }
    const duration = normalizeDuration(fields.endMin - fields.startMin)
    const start = clampStartForDuration(value, duration)
    setFields((f) => ({ ...f, startMin: start, endMin: start + duration, error: '' }))
  }

  const setEndTime = (value: number): void => {
    if (!fields.lockDuration) {
      setFields((f) => ({ ...f, endMin: value, error: '' }))
      return
    }
    const duration = normalizeDuration(fields.endMin - fields.startMin)
    const end = clampEndForDuration(value, duration)
    setFields((f) => ({ ...f, startMin: end - duration, endMin: end, error: '' }))
  }

  const switchMode = (next: 'custom' | 'preset'): void => {
    setMode(next)
    if (next === 'custom') {
      setFields(initState(form))
      setSelectedPresetId('')
    }
  }

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
      close()
      return
    }
    const timeError = validateEventTimes(fields.startMin, fields.endMin)
    if (timeError) {
      setFields((f) => ({ ...f, error: timeError }))
      return
    }
    const times = clampEventTimes(fields.startMin, fields.endMin)
    if (form.kind === 'event-create') {
      const result = addWeekEvent({
        date: form.date,
        title,
        color: fields.color,
        quadrant: fields.quadrant,
        startMin: times.startMin,
        endMin: times.endMin,
        remark: fields.remark,
        showInQuadrant: fields.showInQuadrant
      })
      if (!result.ok) {
        setFields((f) => ({ ...f, error: '该象限事件已达30个，无法继续添加' }))
        return
      }
    } else {
      const result = updateWeekEvent(form.event.id, {
        title,
        color: fields.color,
        quadrant: fields.quadrant,
        startMin: times.startMin,
        endMin: times.endMin,
        remark: fields.remark,
        showInQuadrant: fields.showInQuadrant
      })
      if (!result.ok) {
        setFields((f) => ({ ...f, error: '该象限事件已达30个，无法继续添加' }))
        return
      }
    }
    close()
  }

  const doDelete = (): void => {
    if (form.kind === 'preset-edit') deletePreset(form.preset.id)
    if (form.kind === 'event-edit') deleteWeekEvent(form.event.id)
    close()
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
      <div className={`modal-mask${closing ? ' closing' : ''}`} onClick={close}>
        <div
          className={`modal weekly-dialog${closing ? ' closing' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
        <h3>{titleText}</h3>
        {form.kind === 'event-create' && (
          <div className="modal-field">
            <div className="create-mode-toggle">
              <button
                type="button"
                className={mode === 'custom' ? 'selected' : ''}
                onClick={() => switchMode('custom')}
              >
                自定义
              </button>
              <button
                type="button"
                className={mode === 'preset' ? 'selected' : ''}
                onClick={() => switchMode('preset')}
              >
                从事件预设
              </button>
            </div>
            {mode === 'preset' && (
              <select
                className="preset-select"
                value={selectedPresetId}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="">选择事件预设</option>
                {sortedPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
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
              if (e.key === 'Escape') close()
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
        {!isPreset && (
          <label className="modal-field">
            <span className="toggle-row">
              <input
                type="checkbox"
                checked={fields.showInQuadrant}
                onChange={(e) =>
                  setFields((f) => ({ ...f, showInQuadrant: e.target.checked, error: '' }))
                }
              />
              在四象限中呈现
            </span>
          </label>
        )}
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
            <div className="time-head">
              <span>时间</span>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={fields.lockDuration}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, lockDuration: e.target.checked, error: '' }))
                  }
                />
                锁定时长
              </label>
            </div>
            <div className="time-row">
              <span className="time-label">开始</span>
              <select
                value={startHour}
                onChange={(e) => setStartTime(Number(e.target.value) * 60 + startMinute)}
              >
                {Array.from({ length: 17 }, (_, i) => i + 7).map((h) => (
                  <option key={h} value={h}>
                    {h}时
                  </option>
                ))}
              </select>
              <select
                value={startMinute}
                onChange={(e) => setStartTime(startHour * 60 + Number(e.target.value))}
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
                  setEndTime(
                    Number(e.target.value) * 60 + (Number(e.target.value) === 24 ? 0 : endMinute)
                  )
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
                onChange={(e) => setEndTime(endHour * 60 + Number(e.target.value))}
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
          <button className="modal-btn" onClick={close}>
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
