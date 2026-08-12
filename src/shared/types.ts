export type Quadrant = 1 | 2 | 3 | 4

export type GoalType = 'long' | 'short'

export type SubtaskRelation = 'sequential' | 'parallel'

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
  relation: SubtaskRelation
  order: number
}

export interface Goal {
  id: string
  title: string
  type: GoalType
  done: boolean
  subtasks: Subtask[]
  order: number
  createdAt: string
}

export interface AppData {
  version: 1
  goals: Goal[]
  events: QuadrantEvent[]
}

export interface QuadrantApi {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
}
