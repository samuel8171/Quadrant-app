import type { Goal, GoalType, Subtask } from '../../../shared/types'

export const MAX_GROUPS = 8

/**
 * 主页面上「确认完成后仍留在主页」的保持窗口（毫秒）。
 *
 * 存在的理由有两个，缺一不可：① 勾选动画（圆环填色）需要被看见，卡片当场消失
 * 会让用户怀疑自己点没点中；② 给误点一次反悔的机会 —— 窗口内再点一下就是取消。
 * 窗口只影响**展示**：`toggleGoal` 在点下的那一刻就把 `done` 落库了，所以刷新、
 * 切页、同步都不会让状态分叉。
 */
export const COMPLETION_HOLD_MS = 3000

/**
 * 按「是否已归档到历史」把同一类型的目标分成两组。
 *
 * 「在历史」的判据就是 `done` —— 需求里「取消勾选回到主页面」正是 `done → false`，
 * 与现有唯一布尔位一一对应。**刻意不另设 `archived` 字段**：那要同步
 * `platformApi.validAppData`（网页端校验）/ `main/dataCodec.normalizeGoal`（桌面端
 * 逐字段重建）/ `shared/types.ts` 三处，漏一处就静默丢字段；而 `done` 已经在
 * 所有同步点上，改动面为零。
 *
 * `holdingIds` 是主页面维护的**保持窗口**（见 `COMPLETION_HOLD_MS`）：
 * - `active`  = 未完成，或刚完成但仍在窗口内；
 * - `history` = 已完成且已离开窗口。
 *
 * 两个集合互斥且覆盖同一类型的全部目标 —— 同一张卡片在任一时刻只会出现在一边。
 */
export function partitionGoals(
  goals: Goal[],
  type: GoalType,
  holdingIds: ReadonlySet<string>
): { active: Goal[]; history: Goal[] } {
  const ofType = goals.filter((g) => g.type === type)
  return {
    active: ofType.filter((g) => !g.done || holdingIds.has(g.id)),
    history: ofType.filter((g) => g.done && !holdingIds.has(g.id))
  }
}

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
