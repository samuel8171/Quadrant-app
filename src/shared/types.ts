export type Quadrant = 1 | 2 | 3 | 4

export type GoalType = 'long' | 'short'

/**
 * 单个事件的照片上限。
 *
 * 取 3 是**版式与存储的双重约束**：事件块本身只有 `EVENT_HEIGHT_UNITS`（1.6 单位）
 * 高，缩略图条再多就会把卡片撑到覆盖相邻事件；而按 pica 压完约 100 kB/张计，
 * 一个事件 3 张也只有 300 kB 量级，IndexedDB 完全没有压力。
 */
export const MAX_EVENT_PHOTOS = 3

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
  /**
   * 照片实体 id 列表（上限 3 张，见 `MAX_EVENT_PHOTOS`）。
   *
   * **这里只存 id，不存图片本身**：整份 `AppData` 会被 JSON 进 localStorage 且
   * 整行 upsert 到云端，内嵌 base64 必然撑爆两者。实体走 IndexedDB / 桌面端文件，
   * 读取见 `lib/photoStore.ts`。
   */
  photos?: string[]
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
  showInQuadrant: boolean
  quadrantEventId?: string
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

/**
 * 同步元信息。**刻意独立于 `AppData`**：它描述的是"本机视角的同步状态"，
 * 不属于用户数据。若塞进 `AppData`，它会被当作业务数据一起上传到云端，
 * 并且每次同步都会把一个无意义的字段差异写进云端载荷。
 */
export interface SyncMeta {
  /** 本机标识；用来判断一条云端变更是否由自己写入（回环抑制）。 */
  deviceId: string
  /** 最近一次从云端成功读取的时刻（ISO）。 */
  lastPulledAt: string | null
  /** 最近一次成功写入云端的时刻（ISO）。 */
  lastPushedAt: string | null
  /** 最近一次已知的云端修订号（当前实现取云端行的 `updated_at`）。 */
  cloudRevision: string | null
  /** 本地存在尚未成功上传的改动（离线编辑期间为 true）。 */
  dirty: boolean
}

/** 云端快照的元信息（不含整份数据，用于廉价地比对"云端是否变了"）。 */
export interface CloudMeta {
  exists: boolean
  revision: string | null
}

export interface ReviewDraft {
  completion: number
  quality: number
  stress: number
  text: string
}

export interface ReviewExport {
  completion: number
  quality: number
  stress: number
  text: string
}

export interface ReviewRecord {
  fileName: string
  filePath: string
  size: number
  modifiedAt: string
}

export interface QuadrantApi {
  loadData(): Promise<AppData>
  saveData(data: AppData): Promise<void>
  saveReview(payload: ReviewExport): Promise<ReviewRecord>
  listReviews(): Promise<ReviewRecord[]>
  openReview(filePath: string): Promise<{ ok: boolean; error?: string }>
  /** 同步元信息独立存放：网页端 localStorage，桌面端 `sync.json`。 */
  loadSyncMeta(): Promise<Partial<SyncMeta> | null>
  saveSyncMeta(meta: SyncMeta): Promise<void>
}
