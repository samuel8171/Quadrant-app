import type { Goal, Subtask, SubtaskRelation } from '../../../shared/types'

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function addGoalToList(goals: Goal[], type: 'long' | 'short', title: string): Goal[] {
  const trimmed = title.trim()
  if (!trimmed) return goals
  const goal: Goal = {
    id: newId('goal'),
    title: trimmed,
    type,
    done: false,
    subtasks: [],
    order: goals.length,
    createdAt: new Date().toISOString()
  }
  return [...goals, goal]
}

export function toggleGoalInList(goals: Goal[], id: string): Goal[] {
  return goals.map((g) => (g.id === id ? { ...g, done: !g.done } : g))
}

export function updateGoalTitleInList(goals: Goal[], id: string, title: string): Goal[] {
  const trimmed = title.trim()
  if (!trimmed) return goals
  return goals.map((g) => (g.id === id ? { ...g, title: trimmed } : g))
}

export function removeGoalFromList(goals: Goal[], id: string): Goal[] {
  return goals.filter((g) => g.id !== id)
}

export function canCheckSubtask(goal: Goal, subtask: Subtask): boolean {
  if (subtask.done || subtask.relation !== 'sequential') return true
  const idx = goal.subtasks.findIndex((s) => s.id === subtask.id)
  if (idx <= 0) return true
  return goal.subtasks[idx - 1].done
}

export function addSubtaskToGoal(
  goal: Goal,
  title: string,
  relation: SubtaskRelation
): Goal {
  const trimmed = title.trim()
  if (!trimmed || goal.type !== 'long') return goal
  const subtask: Subtask = {
    id: newId('sub'),
    title: trimmed,
    done: false,
    relation,
    order: goal.subtasks.length
  }
  return { ...goal, done: false, subtasks: [...goal.subtasks, subtask] }
}

export function toggleSubtaskInGoal(goal: Goal, subtaskId: string): Goal {
  const subtask = goal.subtasks.find((s) => s.id === subtaskId)
  if (!subtask || !canCheckSubtask(goal, subtask)) return goal
  const subtasks = goal.subtasks.map((s) =>
    s.id === subtaskId ? { ...s, done: !s.done } : s
  )
  return autoCompleteParent({ ...goal, subtasks })
}

export function updateSubtaskTitleInGoal(goal: Goal, subtaskId: string, title: string): Goal {
  const trimmed = title.trim()
  if (!trimmed) return goal
  return {
    ...goal,
    subtasks: goal.subtasks.map((s) => (s.id === subtaskId ? { ...s, title: trimmed } : s))
  }
}

export function updateSubtaskRelation(
  goal: Goal,
  subtaskId: string,
  relation: SubtaskRelation
): Goal {
  return {
    ...goal,
    subtasks: goal.subtasks.map((s) => (s.id === subtaskId ? { ...s, relation } : s))
  }
}

export function removeSubtaskFromGoal(goal: Goal, subtaskId: string): Goal {
  return {
    ...goal,
    subtasks: goal.subtasks.filter((s) => s.id !== subtaskId)
  }
}

export function progressOf(goal: Goal): { done: number; total: number } {
  const total = goal.subtasks.length
  const done = goal.subtasks.filter((s) => s.done).length
  return { done, total }
}

export function autoCompleteParent(goal: Goal): Goal {
  const { done, total } = progressOf(goal)
  return { ...goal, done: total > 0 && done === total }
}
