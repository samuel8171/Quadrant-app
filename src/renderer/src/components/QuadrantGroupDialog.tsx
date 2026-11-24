import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { X } from 'lucide-react'
import type { EventGroup, Quadrant, QuadrantEvent } from '../../../shared/types'
import { MOTION_EASE, MOTION_MS } from '../lib/motion'
import { QUADRANT_META } from '../lib/quadrantMath'
import GlassModal from './glass/GlassModal'

const DISPLAY_ORDER = [2, 1, 3, 4] as const
const LIST_MOTION = { duration: MOTION_MS, easing: MOTION_EASE }

export function QuadrantChoices(): JSX.Element {
  return <>{DISPLAY_ORDER.map((id) => <option key={id} value={id}>{QUADRANT_META[id].label}</option>)}</>
}

export function QuadrantDialog({
  title, width, onClose, children
}: {
  title: string
  width: number
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  useLayoutEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])

  return (
    <GlassModal className="quadrant-group-glass" onMaskClick={onClose} contentWidth={`min(${width}px, calc(100vw - 28px))`} padding="20px">
      <section
        ref={panel}
        className="quadrant-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            e.stopPropagation()
            onClose()
            return
          }
          if (e.key !== 'Tab') return
          const items = e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
          )
          const first = items[0]
          const last = items[items.length - 1]
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            e.preventDefault()
            last?.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="quadrant-dialog-close" type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        {children}
      </section>
    </GlassModal>
  )
}

interface GroupProps {
  group: EventGroup
  members: QuadrantEvent[]
  candidates: QuadrantEvent[]
  onClose: () => void
  onRename: (name: string) => void
  onMoveGroup: (quadrant: Quadrant) => void
  onMoveMember: (event: QuadrantEvent, quadrant: Quadrant) => void
  onLocate: (event: QuadrantEvent) => void
  onEdit: (event: QuadrantEvent) => void
  onRemove: (eventId: string) => void
  onAdd: (eventId: string) => void
}

export default function QuadrantGroupDialog({
  group, members, candidates, onClose, onRename, onMoveGroup, onMoveMember, onLocate, onEdit, onRemove, onAdd
}: GroupProps): JSX.Element {
  const [memberList] = useAutoAnimate<HTMLDivElement>(LIST_MOTION)
  const addSelect = useRef<HTMLSelectElement>(null)
  const ordered = DISPLAY_ORDER.flatMap((q) => members.filter((event) => event.quadrant === q))

  return (
    <QuadrantDialog title={`卡组 · ${members.length} 张卡`} width={560} onClose={onClose}>
      <label className="modal-field">
        卡组名称
        <input
          key={group.id}
          defaultValue={group.name}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim() || group.name
            e.currentTarget.value = name
            if (name !== group.name) onRename(name)
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur() }}
        />
      </label>
      <div className="quadrant-group-members" ref={memberList}>
        {ordered.map((event) => (
          <article key={event.id}>
            <div className="quadrant-group-member-label">
              <button className="quadrant-group-member-title" type="button" onClick={() => onEdit(event)}>{event.text}</button>
              {(event.deadline || event.remark) && <small>
                {event.deadline ? `截止 ${new Date(event.deadline).toLocaleString()}` : event.remark}
              </small>}
            </div>
            <div className="quadrant-group-member-actions">
              <select aria-label={`移动「${event.text}」`} value={event.quadrant} onChange={(e) => onMoveMember(event, Number(e.target.value) as Quadrant)}>
                <QuadrantChoices />
              </select>
              <button type="button" onClick={() => onLocate(event)}>定位</button>
              <button type="button" onClick={() => onRemove(event.id)}>移出组</button>
            </div>
          </article>
        ))}
      </div>
      {candidates.length > 0 && (
        <form className="quadrant-group-add" onSubmit={(e) => {
          e.preventDefault()
          const select = addSelect.current
          if (!select?.value) return
          onAdd(select.value)
          select.value = ''
        }}>
          <select aria-label="选择要加入的事件" defaultValue="" ref={addSelect} required>
            <option value="">选择要加入的事件</option>
            {candidates.map((event) => <option key={event.id} value={event.id}>{event.text} · {QUADRANT_META[event.quadrant].label}</option>)}
          </select>
          <button className="modal-btn" type="submit">加入卡组</button>
        </form>
      )}
      <label className="quadrant-group-move">
        整组移动到
        <select value={group.anchorQuadrant} onChange={(e) => onMoveGroup(Number(e.target.value) as Quadrant)}>
          <QuadrantChoices />
        </select>
      </label>
    </QuadrantDialog>
  )
}
