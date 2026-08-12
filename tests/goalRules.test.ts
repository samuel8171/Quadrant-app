import { describe, expect, it } from 'vitest'
import type { Goal } from '../src/shared/types'
import {
  addGoalToList,
  addSubtaskToGoal,
  autoCompleteParent,
  canCheckSubtask,
  removeGoalFromList,
  removeSubtaskFromGoal,
  toggleGoalInList,
  toggleSubtaskInGoal,
  updateGoalTitleInList,
  updateSubtaskRelation,
  updateSubtaskTitleInGoal
} from '../src/renderer/src/lib/goalRules'

function makeGoal(): Goal {
  return {
    id: 'g1',
    title: '考研英语 85+',
    type: 'long',
    done: false,
    subtasks: [],
    order: 0,
    createdAt: '2026-08-12T00:00:00.000Z'
  }
}

describe('goalRules', () => {
  it('adds and trims goals, ignores empty titles', () => {
    const one = addGoalToList([], 'long', '  背单词  ')
    expect(one[0].title).toBe('背单词')
    expect(addGoalToList([], 'short', '   ')).toHaveLength(0)
  })

  it('toggles goal done', () => {
    const goal = makeGoal()
    const toggled = toggleGoalInList([goal], 'g1')[0]
    expect(toggled.done).toBe(true)
  })

  it('updates and removes goals', () => {
    const goal = makeGoal()
    expect(updateGoalTitleInList([goal], 'g1', '新标题')[0].title).toBe('新标题')
    expect(removeGoalFromList([goal], 'g1')).toHaveLength(0)
  })

  it('sequential subtask requires previous one done', () => {
    let goal = addSubtaskToGoal(makeGoal(), '第一步', 'sequential')
    goal = addSubtaskToGoal(goal, '第二步', 'sequential')
    const first = goal.subtasks[0]
    const second = goal.subtasks[1]
    expect(canCheckSubtask(goal, first)).toBe(true)
    expect(canCheckSubtask(goal, second)).toBe(false)
    goal = toggleSubtaskInGoal(goal, first.id)
    expect(canCheckSubtask(goal, second)).toBe(true)
  })

  it('blocks checking a sequential subtask until previous is done', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'sequential')
    goal = addSubtaskToGoal(goal, 'B', 'sequential')
    const blocked = toggleSubtaskInGoal(goal, goal.subtasks[1].id)
    expect(blocked.subtasks[1].done).toBe(false)
  })

  it('parallel subtask can always be checked', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    goal = addSubtaskToGoal(goal, 'B', 'parallel')
    const toggled = toggleSubtaskInGoal(goal, goal.subtasks[1].id)
    expect(toggled.subtasks[1].done).toBe(true)
  })

  it('auto-completes parent when all subtasks are done', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    expect(goal.done).toBe(true)
  })

  it('adding a new subtask un-completes the parent', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    goal = toggleSubtaskInGoal(goal, goal.subtasks[0].id)
    goal = addSubtaskToGoal(goal, 'B', 'parallel')
    expect(goal.done).toBe(false)
  })

  it('updates subtask title, relation and removal', () => {
    let goal = addSubtaskToGoal(makeGoal(), 'A', 'parallel')
    const id = goal.subtasks[0].id
    goal = updateSubtaskTitleInGoal(goal, id, '改名')
    expect(goal.subtasks[0].title).toBe('改名')
    goal = updateSubtaskRelation(goal, id, 'sequential')
    expect(goal.subtasks[0].relation).toBe('sequential')
    goal = removeSubtaskFromGoal(goal, id)
    expect(goal.subtasks).toHaveLength(0)
    expect(autoCompleteParent(goal).done).toBe(false)
  })
})
