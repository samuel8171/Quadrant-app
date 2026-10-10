import { describe, expect, it } from 'vitest'
import type { Goal } from '../src/shared/types'
import {
  addGoalToList,
  addGroupToGoal,
  addSubtaskToGoal,
  autoCompleteParent,
  canCheckSubtask,
  groupCountOf,
  groupTitleOf,
  partitionGoals,
  removeGoalFromList,
  removeGroupFromGoal,
  removeSubtaskFromGoal,
  renameGroupInGoal,
  toggleGoalInList,
  toggleSubtaskInGoal,
  updateGoalRemarkInList,
  updateGoalTitleInList,
  updateSubtaskRemarkInGoal,
  updateSubtaskTitleInGoal
} from '../src/renderer/src/lib/goalRules'

function makeGoal(): Goal {
  return {
    id: 'g1',
    title: '考研英语 85+',
    type: 'long',
    done: false,
    remark: '',
    groupTitles: [''],
    subtasks: [],
    order: 0,
    createdAt: '2026-08-12T00:00:00.000Z'
  }
}

describe('goalRules', () => {
  it('adds and trims goals, ignores empty titles', () => {
    const one = addGoalToList([], 'long', '  背单词  ')
    expect(one[0].title).toBe('背单词')
    expect(one[0].groupTitles).toEqual([''])
    expect(one[0].remark).toBe('')
    expect(addGoalToList([], 'short', '   ')).toHaveLength(0)
  })

  it('toggles goal done', () => {
    const goal = makeGoal()
    const toggled = toggleGoalInList([goal], 'g1')[0]
    expect(toggled.done).toBe(true)
  })

  it('updates title, remark and removes goals', () => {
    const goal = makeGoal()
    expect(updateGoalTitleInList([goal], 'g1', '新标题')[0].title).toBe('新标题')
    expect(updateGoalRemarkInList([goal], 'g1', '这是一段备注')[0].remark).toBe('这是一段备注')
    expect(removeGoalFromList([goal], 'g1')).toHaveLength(0)
  })

  it('starts with a single default group and caps at 8 groups', () => {
    let goal = makeGoal()
    expect(groupCountOf(goal)).toBe(1)
    for (let i = 0; i < 10; i++) goal = addGroupToGoal(goal)
    expect(groupCountOf(goal)).toBe(8)
  })

  it('renames groups and falls back to default names', () => {
    let goal = makeGoal()
    goal = addGroupToGoal(goal)
    goal = renameGroupInGoal(goal, 1, '基础阶段')
    goal = renameGroupInGoal(goal, 2, '')
    expect(groupTitleOf(goal, 1)).toBe('基础阶段')
    expect(groupTitleOf(goal, 2)).toBe('分组2')
  })

  it('unlocks a group only when every earlier group is complete', () => {
    let goal = makeGoal()
    goal = addSubtaskToGoal(goal, 'A1', 1)
    goal = addSubtaskToGoal(goal, 'B1', 2)
    goal = addSubtaskToGoal(goal, 'C1', 3)
    const [a1, b1, c1] = goal.subtasks
    expect(canCheckSubtask(goal, a1)).toBe(true)
    expect(canCheckSubtask(goal, b1)).toBe(false)
    expect(canCheckSubtask(goal, c1)).toBe(false)
    goal = toggleSubtaskInGoal(goal, a1.id)
    expect(canCheckSubtask(goal, b1)).toBe(true)
    expect(canCheckSubtask(goal, c1)).toBe(false)
    goal = toggleSubtaskInGoal(goal, b1.id)
    expect(canCheckSubtask(goal, c1)).toBe(true)
  })

  it('blocks checking a locked subtask', () => {
    let goal = makeGoal()
    goal = addSubtaskToGoal(goal, 'A', 1)
    goal = addSubtaskToGoal(goal, 'B', 2)
    const blocked = toggleSubtaskInGoal(goal, goal.subtasks[1].id)
    expect(blocked.subtasks[1].done).toBe(false)
  })

  it('allows unchecking a done subtask even when its group is locked', () => {
    let goal = makeGoal()
    goal = addSubtaskToGoal(goal, 'A', 1)
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    goal = addSubtaskToGoal(goal, 'B', 1)
    goal = toggleSubtaskInGoal(goal, goal.subtasks[1].id)
    const unchecked = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    expect(unchecked.subtasks[0].done).toBe(false)
  })

  it('auto-completes parent when all subtasks are done', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 1)
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    expect(goal.done).toBe(true)
  })

  it('adding a new subtask un-completes the parent', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 1)
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    goal = addSubtaskToGoal(goal, 'B', 1)
    expect(goal.done).toBe(false)
  })

  it('updates subtask title, remark and removal', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 1)
    const id = goal.subtasks[0].id
    goal = updateSubtaskTitleInGoal(goal, id, '改名')
    expect(goal.subtasks[0].title).toBe('改名')
    goal = updateSubtaskRemarkInGoal(goal, id, '子目标备注')
    expect(goal.subtasks[0].remark).toBe('子目标备注')
    goal = removeSubtaskFromGoal(goal, id)
    expect(goal.subtasks).toHaveLength(0)
    expect(autoCompleteParent(goal).done).toBe(false)
  })

  it('keeps the single default group from being removed', () => {
    const goal = addSubtaskToGoal(makeGoal(), 'A', 1)
    const result = removeGroupFromGoal(goal, 1)
    expect(result).toBe(goal)
  })

  it('removes a group with its subtasks and renumbers later groups', () => {
    let goal = makeGoal()
    goal = addGroupToGoal(goal)
    goal = addGroupToGoal(goal)
    goal = renameGroupInGoal(goal, 3, '冲刺阶段')
    goal = addSubtaskToGoal(goal, 'A1', 1)
    goal = addSubtaskToGoal(goal, 'B2', 2)
    goal = addSubtaskToGoal(goal, 'C3', 3)

    const result = removeGroupFromGoal(goal, 2)
    expect(result.groupTitles).toEqual(['', '冲刺阶段'])
    expect(result.subtasks.map((s) => s.title)).toEqual(['A1', 'C3'])
    expect(result.subtasks[1].group).toBe(2)
    expect(groupCountOf(result)).toBe(2)
  })

  it('removes an empty group and keeps progress consistent', () => {
    let goal = makeGoal()
    goal = addGroupToGoal(goal)
    goal = addSubtaskToGoal(goal, 'A1', 1)
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    expect(goal.done).toBe(true)

    const result = removeGroupFromGoal(goal, 2)
    expect(groupCountOf(result)).toBe(1)
    expect(result.done).toBe(true)
  })
})

// ============================================================================
// 主页 / 历史的归属划分
// ============================================================================

describe('goalRules · partitionGoals', () => {
  const activeGoal: Goal = { ...makeGoal(), id: 'g-active', done: false }
  const doneGoal: Goal = { ...makeGoal(), id: 'g-done', done: true }
  const holdingGoal: Goal = { ...makeGoal(), id: 'g-holding', done: true }
  const shortGoal: Goal = { ...makeGoal(), id: 'g-short', type: 'short', done: true }
  const all = [activeGoal, doneGoal, holdingGoal, shortGoal]

  it('未完成的在主页、已完成且不在窗口内的在历史', () => {
    const { active, history } = partitionGoals(all, 'long', new Set())
    expect(active.map((g) => g.id)).toEqual(['g-active'])
    expect(history.map((g) => g.id)).toEqual(['g-done', 'g-holding'])
  })

  it('保持窗口内的目标仍算主页 —— 两个集合互斥', () => {
    const { active, history } = partitionGoals(all, 'long', new Set(['g-holding']))
    expect(active.map((g) => g.id)).toEqual(['g-active', 'g-holding'])
    expect(history.map((g) => g.id)).toEqual(['g-done'])
  })

  it('两类目标各算各的：同一份数据按 type 划分互不串台', () => {
    const { active, history } = partitionGoals(all, 'short', new Set())
    expect(active).toHaveLength(0)
    expect(history.map((g) => g.id)).toEqual(['g-short'])
  })

  it('两个集合合起来恰好覆盖全部目标，各自保持原数组内的相对顺序', () => {
    const { active, history } = partitionGoals(all, 'long', new Set(['g-holding']))
    expect([...active, ...history].map((g) => g.id)).toEqual([
      'g-active',
      'g-holding',
      'g-done'
    ])
  })
})
