import { useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Mountain,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { Goal, SubtaskRelation } from '../../../shared/types'
import { progressOf } from '../lib/goalRules'
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
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  const submitNew = (): void => {
    if (draft.trim()) addGoal(type, draft)
    setDraft('')
    setAdding(false)
  }

  const submitEdit = (id: string): void => {
    useAppStore.getState().updateGoalTitle(id, editingText)
    setEditingId(null)
  }

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
              onClick={() => {
                if (window.confirm(`删除目标「${goal.title}」？`)) {
                  useAppStore.getState().deleteGoal(goal.id)
                }
              }}
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
    </section>
  )
}

function LongTermDetailPage({ goalId }: { goalId: string }): JSX.Element {
  const goal = useAppStore((s) => s.data.goals.find((g) => g.id === goalId))
  const closeGoal = useAppStore((s) => s.closeGoal)
  const [draft, setDraft] = useState('')
  const [relation, setRelation] = useState<SubtaskRelation>('parallel')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

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

  const submitNew = (): void => {
    if (draft.trim()) useAppStore.getState().addSubtask(goalId, draft, relation)
    setDraft('')
  }

  return (
    <div className="page subtask-page">
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
      <div className="subtask-list">
        {goal.subtasks.map((subtask, index) => (
          <div key={subtask.id} className={`subtask-card${subtask.done ? ' done' : ''}`}>
            <label className="goal-check">
              <input
                type="checkbox"
                checked={subtask.done}
                disabled={
                  !subtask.done &&
                  subtask.relation === 'sequential' &&
                  index > 0 &&
                  !goal.subtasks[index - 1].done
                }
                onChange={() => useAppStore.getState().toggleSubtask(goalId, subtask.id)}
              />
              <span className="checkmark" />
            </label>
            <span className={`relation-badge ${subtask.relation}`}>
              {subtask.relation === 'sequential' ? '顺序' : '并列'}
            </span>
            {editingId === subtask.id ? (
              <input
                className="goal-edit-input"
                value={editingText}
                autoFocus
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => {
                  useAppStore.getState().updateSubtaskTitle(goalId, subtask.id, editingText)
                  setEditingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    useAppStore.getState().updateSubtaskTitle(goalId, subtask.id, editingText)
                    setEditingId(null)
                  }
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="goal-title">{subtask.title}</span>
            )}
            <select
              className="relation-select"
              value={subtask.relation}
              title="与前一个子目标的关系"
              onChange={(e) =>
                useAppStore.getState().updateSubtaskRelation(
                  goalId,
                  subtask.id,
                  e.target.value as SubtaskRelation
                )
              }
            >
              <option value="parallel">并列</option>
              <option value="sequential">顺序</option>
            </select>
            <button
              className="icon-btn"
              title="编辑"
              onClick={() => {
                setEditingId(subtask.id)
                setEditingText(subtask.title)
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-btn danger"
              title="删除"
              onClick={() => {
                if (window.confirm(`删除子目标「${subtask.title}」？`)) {
                  useAppStore.getState().deleteSubtask(goalId, subtask.id)
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="add-subtask-row">
        <input
          value={draft}
          placeholder="新子目标"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNew()
          }}
        />
        <select value={relation} onChange={(e) => setRelation(e.target.value as SubtaskRelation)}>
          <option value="parallel">并列</option>
          <option value="sequential">顺序</option>
        </select>
        <button className="add-goal-btn" onClick={submitNew}>
          <Plus size={16} />
          添加子目标
        </button>
      </div>
    </div>
  )
}
