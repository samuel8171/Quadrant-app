import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Info,
  Lock,
  Mountain,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Goal, Subtask } from '../../../shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import GoalDetailDialog from '../components/GoalDetailDialog'
import {
  MAX_GROUPS,
  canCheckSubtask,
  groupCountOf,
  groupTitleOf,
  progressOf
} from '../lib/goalRules'
import { useAppStore } from '../state/appStore'

export default function GoalsPage(): JSX.Element {
  const activeGoalId = useAppStore((s) => s.activeGoalId)
  if (activeGoalId) return <LongTermDetailPage goalId={activeGoalId} />
  return (
    <div className="page goals-page">
      <header className="page-header">
        <h1>目标</h1>
        <span className="title-underline" />
      </header>
      <div className="goal-columns">
        <GoalColumn type="long" title="长期目标" icon={Mountain} accentClass="accent-blue" />
        <GoalColumn type="short" title="短期目标" icon={Calendar} accentClass="accent-green" />
      </div>
    </div>
  )
}

function GoalColumn({
  type,
  title,
  icon: Icon,
  accentClass
}: {
  type: 'long' | 'short'
  title: string
  icon: typeof Mountain
  accentClass: string
}): JSX.Element {
  const goals = useAppStore((s) => s.data.goals.filter((g) => g.type === type))
  const addGoal = useAppStore((s) => s.addGoal)
  const updateGoalRemark = useAppStore((s) => s.updateGoalRemark)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)

  const submitNew = (): void => {
    if (draft.trim()) addGoal(type, draft)
    setDraft('')
    setAdding(false)
  }

  const submitEdit = (id: string): void => {
    useAppStore.getState().updateGoalTitle(id, editingText)
    setEditingId(null)
  }

  const detailGoal = detailId ? goals.find((g) => g.id === detailId) : undefined
  const deletePendingGoal = deletePendingId
    ? goals.find((g) => g.id === deletePendingId)
    : undefined

  return (
    <section className={`goal-column ${accentClass}`}>
      <h2 className="goal-column-title">
        <Icon size={18} />
        {title}
      </h2>
      <div className="goal-list">
        {goals.map((goal) => (
          <div key={goal.id} className={`goal-card${goal.done ? ' done' : ''}`}>
            <label className="goal-check">
              <input
                type="checkbox"
                checked={goal.done}
                onChange={() => useAppStore.getState().toggleGoal(goal.id)}
              />
              <span className="checkmark" />
            </label>
            {editingId === goal.id ? (
              <input
                className="goal-edit-input"
                value={editingText}
                autoFocus
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => submitEdit(goal.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEdit(goal.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="goal-title">{goal.title}</span>
            )}
            {goal.type === 'long' && goal.subtasks.length > 0 && (
              <span className="goal-progress">
                {progressOf(goal).done}/{progressOf(goal).total}
              </span>
            )}
            <button className="icon-btn" title="详细信息" onClick={() => setDetailId(goal.id)}>
              <Info size={15} />
            </button>
            <button
              className="icon-btn"
              title="编辑"
              onClick={() => {
                setEditingId(goal.id)
                setEditingText(goal.title)
              }}
            >
              <Pencil size={15} />
            </button>
            {goal.type === 'long' && (
              <button
                className="icon-btn"
                title="展开子目标"
                onClick={() => useAppStore.getState().openGoal(goal.id)}
              >
                <ChevronRight size={16} />
              </button>
            )}
            <button
              className="icon-btn danger"
              title="删除"
              onClick={() => setDeletePendingId(goal.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="add-goal-row">
          <input
            autoFocus
            value={draft}
            placeholder="输入目标名称"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        </div>
      ) : (
        <button className="add-goal-btn" onClick={() => setAdding(true)}>
          <Plus size={16} />
          添加{title}
        </button>
      )}
      {detailGoal && (
        <GoalDetailDialog
          title={detailGoal.title}
          remark={detailGoal.remark}
          onSave={(remark) => updateGoalRemark(detailGoal.id, remark)}
          onClose={() => setDetailId(null)}
        />
      )}
      {deletePendingGoal && (
        <ConfirmDialog
          message={`确定删除目标「${deletePendingGoal.title}」？`}
          onConfirm={() => useAppStore.getState().deleteGoal(deletePendingGoal.id)}
          onCancel={() => setDeletePendingId(null)}
        />
      )}
    </section>
  )
}

function LongTermDetailPage({ goalId }: { goalId: string }): JSX.Element {
  const goal = useAppStore((s) => s.data.goals.find((g) => g.id === goalId))
  const closeGoal = useAppStore((s) => s.closeGoal)
  const addGroup = useAppStore((s) => s.addGroup)
  const renameGroup = useAppStore((s) => s.renameGroup)
  const removeGroup = useAppStore((s) => s.removeGroup)
  const addSubtask = useAppStore((s) => s.addSubtask)
  const toggleSubtask = useAppStore((s) => s.toggleSubtask)
  const updateSubtaskTitle = useAppStore((s) => s.updateSubtaskTitle)
  const updateSubtaskRemark = useAppStore((s) => s.updateSubtaskRemark)
  const deleteSubtask = useAppStore((s) => s.deleteSubtask)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [detailSubtaskId, setDetailSubtaskId] = useState<string | null>(null)
  const [deletePendingSubtaskId, setDeletePendingSubtaskId] = useState<string | null>(null)
  const [deletePendingGroup, setDeletePendingGroup] = useState<number | null>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = (): void => {
      setArea({ width: el.clientWidth, height: el.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!goal) {
    return (
      <div className="page">
        <button className="back-btn" onClick={closeGoal}>
          <ArrowLeft size={16} />
          返回
        </button>
      </div>
    )
  }

  const { done, total } = progressOf(goal)
  const groupCount = groupCountOf(goal)
  const rows = groupCount <= 2 ? 1 : Math.ceil(groupCount / 2)
  const cols = groupCount === 1 ? 1 : 2
  const gap = 16

  let gridStyle: React.CSSProperties
  if (groupCount === 1) {
    gridStyle = { width: 'min(96%, 860px)', height: '96%' }
  } else if (groupCount === 2) {
    gridStyle = { width: '100%', height: '100%' }
  } else {
    const scrollbar = 14
    const cellW = Math.max(140, (area.width - gap - scrollbar) / 2)
    const cellH = Math.max(140, (area.height - gap) / 2)
    gridStyle = {
      width: cellW * 2 + gap,
      height: cellH * rows + (rows - 1) * gap
    }
  }

  const detailSubtask = detailSubtaskId
    ? goal.subtasks.find((s) => s.id === detailSubtaskId)
    : undefined
  const deletePendingSubtask = deletePendingSubtaskId
    ? goal.subtasks.find((s) => s.id === deletePendingSubtaskId)
    : undefined

  return (
    <div className="page subtask-page">
      <div className="subtask-topbar">
        <button className="back-btn" onClick={closeGoal}>
          <ArrowLeft size={16} />
          返回
        </button>
        <header className="subtask-header">
          <h1>{goal.title}</h1>
          <span className="subtask-progress">
            进度 {done}/{total}
          </span>
        </header>
        <button
          className="add-group-btn"
          disabled={groupCount >= MAX_GROUPS}
          title={groupCount >= MAX_GROUPS ? `最多 ${MAX_GROUPS} 个分组` : '添加分组'}
          onClick={() => addGroup(goalId)}
        >
          <Plus size={15} />
          添加分组
        </button>
      </div>
      <div ref={areaRef} className="subtask-area">
        <div
          className="group-grid"
          style={{
            ...gridStyle,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
          }}
        >
          {Array.from({ length: groupCount }, (_, i) => i + 1).map((group) => (
            <GroupCard
              key={group}
              group={group}
              title={groupTitleOf(goal, group)}
              showTitle={groupCount > 1}
              subtasks={goal.subtasks.filter((s) => s.group === group)}
              canCheck={(subtask) => canCheckSubtask(goal, subtask)}
              editingId={editingId}
              editingText={editingText}
              onStartEdit={(subtask) => {
                setEditingId(subtask.id)
                setEditingText(subtask.title)
              }}
              onChangeEdit={setEditingText}
              onCommitEdit={(subtask) => {
                updateSubtaskTitle(goalId, subtask.id, editingText)
                setEditingId(null)
              }}
              onCancelEdit={() => setEditingId(null)}
              onToggle={(subtask) => toggleSubtask(goalId, subtask.id)}
              onDelete={(subtask) => setDeletePendingSubtaskId(subtask.id)}
              onDetail={(subtask) => setDetailSubtaskId(subtask.id)}
              onAdd={(text) => addSubtask(goalId, text, group)}
              onRename={(text) => renameGroup(goalId, group, text)}
              canDelete={groupCount > 1}
              onDeleteGroup={() => setDeletePendingGroup(group)}
            />
          ))}
        </div>
      </div>
      {detailSubtask && (
        <GoalDetailDialog
          title={detailSubtask.title}
          remark={detailSubtask.remark}
          onSave={(remark) => updateSubtaskRemark(goalId, detailSubtask.id, remark)}
          onClose={() => setDetailSubtaskId(null)}
        />
      )}
      {deletePendingSubtask && (
        <ConfirmDialog
          message={`确定删除子目标「${deletePendingSubtask.title}」？`}
          onConfirm={() => deleteSubtask(goalId, deletePendingSubtask.id)}
          onCancel={() => setDeletePendingSubtaskId(null)}
        />
      )}
      {deletePendingGroup !== null && (
        <ConfirmDialog
          message={`确定删除「${groupTitleOf(goal, deletePendingGroup)}」？组内 ${
            goal.subtasks.filter((s) => s.group === deletePendingGroup).length
          } 个子目标将一并删除。`}
          onConfirm={() => removeGroup(goalId, deletePendingGroup)}
          onCancel={() => setDeletePendingGroup(null)}
        />
      )}
    </div>
  )
}

interface GroupCardProps {
  group: number
  title: string
  showTitle: boolean
  subtasks: Subtask[]
  canCheck: (subtask: Subtask) => boolean
  editingId: string | null
  editingText: string
  onStartEdit: (subtask: Subtask) => void
  onChangeEdit: (text: string) => void
  onCommitEdit: (subtask: Subtask) => void
  onCancelEdit: () => void
  onToggle: (subtask: Subtask) => void
  onDelete: (subtask: Subtask) => void
  onDetail: (subtask: Subtask) => void
  onAdd: (text: string) => void
  onRename: (text: string) => void
  canDelete: boolean
  onDeleteGroup: () => void
}

function GroupCard({
  title,
  showTitle,
  subtasks,
  canCheck,
  editingId,
  editingText,
  onStartEdit,
  onChangeEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onDelete,
  onDetail,
  onAdd,
  onRename,
  canDelete,
  onDeleteGroup
}: GroupCardProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')

  const submit = (): void => {
    if (draft.trim()) onAdd(draft)
    setDraft('')
  }

  return (
    <section className="group-card">
      {showTitle &&
        (renaming ? (
          <div className="group-card-head">
            <input
              className="group-title-input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                onRename(name)
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onRename(name)
                  setRenaming(false)
                }
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          </div>
        ) : (
          <div className="group-card-head">
            <h3
              className="group-card-title"
              title="双击重命名分组"
              onDoubleClick={() => {
                setName(title)
                setRenaming(true)
              }}
            >
              {title}
            </h3>
            {canDelete && (
              <button
                className="icon-btn danger group-delete-btn"
                title="删除分组"
                onClick={onDeleteGroup}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      <div className="group-card-body">
        {subtasks.map((subtask) => {
          const locked = !canCheck(subtask) && !subtask.done
          return (
            <div key={subtask.id} className={`subtask-card${subtask.done ? ' done' : ''}`}>
              <label
                className={`goal-check${locked ? ' locked' : ''}`}
                title={locked ? '该分组尚未解锁' : undefined}
              >
                <input
                  type="checkbox"
                  checked={subtask.done}
                  disabled={locked}
                  onChange={() => onToggle(subtask)}
                />
                <span className="checkmark" />
              </label>
              {locked && <Lock size={13} className="lock-icon" />}
              {editingId === subtask.id ? (
                <input
                  className="goal-edit-input"
                  value={editingText}
                  autoFocus
                  onChange={(e) => onChangeEdit(e.target.value)}
                  onBlur={() => onCommitEdit(subtask)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitEdit(subtask)
                    if (e.key === 'Escape') onCancelEdit()
                  }}
                />
              ) : (
                <span className="goal-title">{subtask.title}</span>
              )}
              <button className="icon-btn" title="详细信息" onClick={() => onDetail(subtask)}>
                <Info size={15} />
              </button>
              <button className="icon-btn" title="编辑" onClick={() => onStartEdit(subtask)}>
                <Pencil size={15} />
              </button>
              <button className="icon-btn danger" title="删除" onClick={() => onDelete(subtask)}>
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
        {subtasks.length === 0 && <div className="group-empty">暂无子目标</div>}
      </div>
      <div className="add-subtask-row">
        <input
          value={draft}
          placeholder="新子目标"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="add-goal-btn" onClick={submit}>
          <Plus size={16} />
          添加子目标
        </button>
      </div>
    </section>
  )
}
