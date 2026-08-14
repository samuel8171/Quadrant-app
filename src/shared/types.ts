export type Quadrant = 1 | 2 | 3 | 4

export type GoalType = 'long' | 'short'

export interface QuadrantEvent {
  id: string
  text: string
  remark: string
  quadrant: Quadrant
  x: number
  y: number
  width: number
  deadline?: string
  escalateAt?: string
  createdAt: string
}

export interface Subtask {
  id: string
  title: string
  done: boolean
  group: number
  remark: string
  order: number
}

export interface Goal {
  id: string
  title: string
  type: GoalType
  done: boolean
  remark: string
  groupTitles: string[]
  subtasks: Subtask[]
  order: number
  createdAt: string
}

export const WEEK_COLORS = [
  '#8AB4F8',
  '#8CD9C1',
  '#F8B18C',
  '#B4A7E6',
  '#E8A0A0',
  '#DBC8A8',
  '#A9C49C',
  '#C2C8D0'
] as const

export interface WeekPreset {
  id: string
  title: string
  color: string
  quadrant: Quadrant
  durationMin: number
  remark: string
  createdAt: string
}

export interface WeekEvent {
  id: string
  date: string
  title: string
  color: string
  quadrant: Quadrant
  startMin: number
  endMin: number
  remark: string
  presetId?: string
  createdAt: string
}

export interface AppData {
  version: 2
  goals: Goal[]
  events: QuadrantEvent[]
  weekPresets: WeekPreset[]
  weekEvents: WeekEvent[]
  weekCounterOffset: number
}

export interface QuadrantApi {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
}
