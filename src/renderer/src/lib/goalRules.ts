import type { Goal, Subtask } from '../../../shared/types'

export const MAX_GROUPS = 8

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
    remark: '',
    groupTitles: [''],
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

export function updateGoalRemarkInList(goals: Goal[], id: string, remark: string): Goal[] {
  return goals.map((g) => (g.id === id ? { ...g, remark } : g))
}

export function removeGoalFromList(goals: Goal[], id: string): Goal[] {
  return goals.filter((g) => g.id !== id)
}

export function groupCountOf(goal: Goal): number {
  const fromSubtasks = goal.subtasks.reduce((max, s) => Math.max(max, s.group), 0)
  return Math.min(MAX_GROUPS, Math.max(1, goal.groupTitles.length, fromSubtasks))
}

export function groupTitleOf(goal: Goal, group: number): string {
  const custom = goal.groupTitles[group - 1]?.trim()
  return custom || `分组${group}`
}

export function addGroupToGoal(goal: Goal): Goal {
  if (groupCountOf(goal) >= MAX_GROUPS) return goal
  return { ...goal, groupTitles: [...goal.groupTitles, ''] }
}

export function renameGroupInGoal(goal: Goal, group: number, title: string): Goal {
  if (group < 1 || group > groupCountOf(goal)) return goal
  const groupTitles = [...goal.groupTitles]
  while (groupTitles.length < group) groupTitles.push('')
  groupTitles[group - 1] = title.trim()
  return { ...goal, groupTitles }
}

export function removeGroupFromGoal(goal: Goal, group: number): Goal {
  if (group < 1 || group > groupCountOf(goal) || groupCountOf(goal) <= 1) return goal
  const subtasks = goal.subtasks
    .filter((s) => s.group !== group)
    .map((s) => (s.group > group ? { ...s, group: s.group - 1 } : s))
  const groupTitles = [...goal.groupTitles]
  groupTitles.splice(group - 1, 1)
  return autoCompleteParent({ ...goal, subtasks, groupTitles })
}

export function canCheckSubtask(goal: Goal, subtask: Subtask): boolean {
  if (subtask.done) return true
  return goal.subtasks
    .filter((s) => s.group < subtask.group)
    .every((s) => s.done)
}

export function addSubtaskToGoal(goal: Goal, title: string, group: number): Goal {
  const trimmed = title.trim()
  if (!trimmed || goal.type !== 'long') return goal
  const safeGroup = Math.max(1, Math.floor(group) || 1)
  const subtask: Subtask = {
    id: newId('sub'),
    title: trimmed,
    done: false,
    group: safeGroup,
    remark: '',
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

export function updateSubtaskRemarkInGoal(goal: Goal, subtaskId: string, remark: string): Goal {
  return {
    ...goal,
    subtasks: goal.subtasks.map((s) => (s.id === subtaskId ? { ...s, remark } : s))
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
