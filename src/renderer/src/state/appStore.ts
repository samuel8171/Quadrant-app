import { create } from 'zustand'
import type {
  AppData,
  Quadrant,
  QuadrantEvent,
  WeekEvent,
  WeekPreset
} from '../../../shared/types'
import { defaultData } from '../../../shared/defaults'
import * as eventRules from '../lib/eventRules'
import * as goalRules from '../lib/goalRules'
import * as weekRules from '../lib/weekRules'
import type { ViewState } from '../lib/quadrantMath'
import { scheduleSave } from '../lib/scheduleSave'

export type Page = 'goals' | 'quadrant' | 'weekly' | 'review'

interface AppState {
  data: AppData
  page: Page
  activeGoalId: string | null
  loaded: boolean
  init: () => Promise<void>
  setPage: (page: Page) => void
  openGoal: (id: string) => void
  closeGoal: () => void
  addGoal: (type: 'long' | 'short', title: string) => void
  toggleGoal: (id: string) => void
  updateGoalTitle: (id: string, title: string) => void
  updateGoalRemark: (id: string, remark: string) => void
  deleteGoal: (id: string) => void
  addGroup: (goalId: string) => void
  renameGroup: (goalId: string, group: number, title: string) => void
  removeGroup: (goalId: string, group: number) => void
  addSubtask: (goalId: string, title: string, group: number) => void
  toggleSubtask: (goalId: string, subtaskId: string) => void
  updateSubtaskTitle: (goalId: string, subtaskId: string, title: string) => void
  updateSubtaskRemark: (goalId: string, subtaskId: string, remark: string) => void
  deleteSubtask: (goalId: string, subtaskId: string) => void
  addEvent: (text: string, quadrant: Quadrant, worldX: number, worldY: number, view: ViewState) => void
  updateEvent: (id: string, patch: Partial<QuadrantEvent>, view: ViewState) => void
  deleteEvent: (id: string) => void
  moveEvent: (id: string, worldX: number, worldY: number, view: ViewState) => void
  copyEvent: (id: string) => void
  cutEvent: (id: string) => void
  pasteEvent: (view: ViewState, targetX?: number, targetY?: number) => void
  applyEscalations: () => void
  addPreset: (fields: {
    title: string
    color: string
    quadrant: Quadrant
    durationMin: number
    remark: string
  }) => void
  updatePreset: (id: string, patch: Partial<WeekPreset>) => void
  deletePreset: (id: string) => void
  addWeekEvent: (fields: {
    date: string
    title: string
    color: string
    quadrant: Quadrant
    startMin: number
    endMin: number
    remark: string
    presetId?: string
  }) => void
  updateWeekEvent: (id: string, patch: Partial<WeekEvent>) => void
  deleteWeekEvent: (id: string) => void
  moveWeekEvent: (id: string, startMin: number) => void
  setWeekCounterOffset: (offset: number) => void
  saveNow: () => void
}

let clipboard: QuadrantEvent | null = null

export function hasClipboardEvent(): boolean {
  return clipboard !== null
}

function saveSoon(data: AppData): void {
  scheduleSave(() => {
    void window.quadrantApi.saveData(data)
  })
}

export const useAppStore = create<AppState>((set, get) => ({
  data: defaultData(),
  page: 'goals',
  activeGoalId: null,
  loaded: false,

  init: async () => {
    const data = await window.quadrantApi.loadData()
    set({ data, loaded: true })
  },

  setPage: (page) => set({ page }),
  openGoal: (id) => set({ activeGoalId: id }),
  closeGoal: () => set({ activeGoalId: null }),

  addGoal: (type, title) => {
    const data = { ...get().data, goals: goalRules.addGoalToList(get().data.goals, type, title) }
    saveSoon(data)
    set({ data })
  },

  toggleGoal: (id) => {
    const data = { ...get().data, goals: goalRules.toggleGoalInList(get().data.goals, id) }
    saveSoon(data)
    set({ data })
  },

  updateGoalTitle: (id, title) => {
    const data = {
      ...get().data,
      goals: goalRules.updateGoalTitleInList(get().data.goals, id, title)
    }
    saveSoon(data)
    set({ data })
  },

  updateGoalRemark: (id, remark) => {
    const data = {
      ...get().data,
      goals: goalRules.updateGoalRemarkInList(get().data.goals, id, remark)
    }
    saveSoon(data)
    set({ data })
  },

  deleteGoal: (id) => {
    const data = { ...get().data, goals: goalRules.removeGoalFromList(get().data.goals, id) }
    saveSoon(data)
    set({ data })
  },

  addGroup: (goalId) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) => (g.id === goalId ? goalRules.addGroupToGoal(g) : g))
    }
    saveSoon(data)
    set({ data })
  },

  renameGroup: (goalId, group, title) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.renameGroupInGoal(g, group, title) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  removeGroup: (goalId, group) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.removeGroupFromGoal(g, group) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  addSubtask: (goalId, title, group) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.addSubtaskToGoal(g, title, group) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  toggleSubtask: (goalId, subtaskId) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.toggleSubtaskInGoal(g, subtaskId) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  updateSubtaskTitle: (goalId, subtaskId, title) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.updateSubtaskTitleInGoal(g, subtaskId, title) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  updateSubtaskRemark: (goalId, subtaskId, remark) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.updateSubtaskRemarkInGoal(g, subtaskId, remark) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  deleteSubtask: (goalId, subtaskId) => {
    const data = {
      ...get().data,
      goals: get().data.goals.map((g) =>
        g.id === goalId ? goalRules.removeSubtaskFromGoal(g, subtaskId) : g
      )
    }
    saveSoon(data)
    set({ data })
  },

  addEvent: (text, quadrant, worldX, worldY, view) => {
    const event = eventRules.createEvent(text, quadrant, worldX, worldY, view)
    const data = { ...get().data, events: [...get().data.events, event] }
    saveSoon(data)
    set({ data })
  },

  updateEvent: (id, patch, view) => {
    const data = {
      ...get().data,
      events: eventRules.updateEventInList(get().data.events, id, patch, view)
    }
    saveSoon(data)
    set({ data })
  },

  deleteEvent: (id) => {
    const data = { ...get().data, events: eventRules.deleteEventFromList(get().data.events, id) }
    saveSoon(data)
    set({ data })
  },

  moveEvent: (id, worldX, worldY, view) => {
    const data = {
      ...get().data,
      events: eventRules.moveEvent(get().data.events, id, worldX, worldY, view)
    }
    saveSoon(data)
    set({ data })
  },

  copyEvent: (id) => {
    clipboard = get().data.events.find((e) => e.id === id) ?? null
  },

  cutEvent: (id) => {
    clipboard = get().data.events.find((e) => e.id === id) ?? null
    if (clipboard) {
      const data = { ...get().data, events: eventRules.deleteEventFromList(get().data.events, id) }
      saveSoon(data)
      set({ data })
    }
  },

  pasteEvent: (view, targetX, targetY) => {
    if (!clipboard) return
    const data = {
      ...get().data,
      events: eventRules.pasteEvent(get().data.events, clipboard, view, targetX, targetY)
    }
    saveSoon(data)
    set({ data })
  },

  addPreset: (fields) => {
    if (!fields.title.trim()) return
    const preset = weekRules.createPreset(
      fields.title,
      fields.color,
      fields.quadrant,
      fields.durationMin,
      fields.remark
    )
    const data = { ...get().data, weekPresets: [...get().data.weekPresets, preset] }
    saveSoon(data)
    set({ data })
  },

  updatePreset: (id, patch) => {
    const data = {
      ...get().data,
      weekPresets: weekRules.updatePresetInList(get().data.weekPresets, id, patch)
    }
    saveSoon(data)
    set({ data })
  },

  deletePreset: (id) => {
    const data = {
      ...get().data,
      weekPresets: weekRules.deletePresetFromList(get().data.weekPresets, id)
    }
    saveSoon(data)
    set({ data })
  },

  addWeekEvent: (fields) => {
    if (!fields.title.trim()) return
    const times = weekRules.clampEventTimes(fields.startMin, fields.endMin)
    const event: WeekEvent = {
      id: crypto.randomUUID(),
      date: fields.date,
      title: fields.title.trim(),
      color: fields.color,
      quadrant: fields.quadrant,
      startMin: times.startMin,
      endMin: times.endMin,
      remark: fields.remark,
      presetId: fields.presetId,
      createdAt: new Date().toISOString()
    }
    const data = { ...get().data, weekEvents: [...get().data.weekEvents, event] }
    saveSoon(data)
    set({ data })
  },

  updateWeekEvent: (id, patch) => {
    const data = {
      ...get().data,
      weekEvents: weekRules.updateWeekEventInList(get().data.weekEvents, id, patch)
    }
    saveSoon(data)
    set({ data })
  },

  deleteWeekEvent: (id) => {
    const data = {
      ...get().data,
      weekEvents: weekRules.deleteWeekEventFromList(get().data.weekEvents, id)
    }
    saveSoon(data)
    set({ data })
  },

  moveWeekEvent: (id, startMin) => {
    const data = {
      ...get().data,
      weekEvents: weekRules.moveWeekEventInList(get().data.weekEvents, id, startMin)
    }
    saveSoon(data)
    set({ data })
  },

  setWeekCounterOffset: (offset) => {
    const data = { ...get().data, weekCounterOffset: offset }
    saveSoon(data)
    set({ data })
  },

  applyEscalations: () => {
    const events = eventRules.applyEscalations(get().data.events, new Date())
    if (events === get().data.events) return
    const data = { ...get().data, events }
    saveSoon(data)
    set({ data })
  },

  saveNow: () => {
    void window.quadrantApi.saveData(get().data)
  }
}))
