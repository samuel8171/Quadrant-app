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
  /**
   * 金钱系统状态。**可选**：`undefined` = 该功能从未启用（等价于关闭）。
   *
   * 关闭时字段必须保留、不得清除（否则「关一下开关」= 账本全删，不可逆）。
   */
  money?: MoneyState
}

/** 计费与结算的全局参数。默认值见 `shared/money.ts` 的 `DEFAULT_MONEY_CONFIG`。 */
export interface MoneyConfig {
  /** W：每周发放的时币总额。 */
  weeklyTC: number
  /** 币/小时。 */
  tcPerHour: number
  /** 深夜时段起点（分钟，自 0 点起算）；1410 = 23:30。 */
  nightStartMin: number
  /** 深夜时段终点；360 = 06:00。深夜区间左闭右开。 */
  nightEndMin: number
  /** 深夜倍率。 */
  nightMultiplier: number
  /** 额度保底比例：无论前一日透支多少，次日至少保留此比例的日额度。 */
  minCapRatio: number
  /** 娱币周定额。 */
  weeklyLT: number
  /** 高效完成的娱币奖励。 */
  rewardLT: number
  /** 低效完成的娱币惩罚。 */
  penaltyLT: number
  /** 有事情没做的娱币惩罚。 */
  missPenaltyLT: number
}

export type LedgerEntryKind = 'planned' | 'unplanned'

export interface LedgerEntry {
  id: string
  kind: LedgerEntryKind
  /** planned → weekEvent.id / quadrantEvent.id；unplanned 为 null。 */
  sourceId: string | null
  /** 标题快照，源事件被删除后账本仍可读。 */
  title: string
  quadrant: Quadrant | null
  /** 计划时长；计划外为 null。 */
  plannedMin: number | null
  actualMin: number
  done: boolean
  /** 落在深夜区间内的分钟数；0 表示无。 */
  nightMin: number
  costTC: number
  deltaLT: number
}

export interface LedgerDay {
  /** 'YYYY-MM-DD'，本地日期。 */
  date: string
  /** ISO 时刻；null = 未结算。 */
  settledAt: string | null
  entries: LedgerEntry[]
  // —— 结算快照，settledAt 写入后不再变化 ——
  /** 当日实际可用额度。 */
  dayLimit: number
  spentTC: number
  /** 带入次日的透支额。 */
  overdraft: number
  /** 当日娱币净变化。 */
  deltaLT: number
  /** 深夜补记是否仍待确认。 */
  nightPending: boolean
}

export type PenaltyTier = 0 | 1 | 2 | 3

export interface WeekSettlement {
  /** 周一。 */
  weekStart: string
  /** 周日。 */
  weekEnd: string
  /** 本周发放额度（已含上周惩罚后的值）。 */
  weekTC: number
  spentTC: number
  /** 超支额；0 表示未超。 */
  weekOver: number
  plannedMin: number
  actualMin: number
  doneCount: number
  missCount: number
  unplannedCount: number
  unplannedMin: number
  /** 深夜做事总时长。 */
  nightMin: number
  /** 超日软上限的天数。 */
  overLimitDays: number
  /** 0 = 无惩罚。 */
  penaltyTier: PenaltyTier
  nextWeekTC: number
  nextWeekLT: number
  /** 自动生成的结论，逐条可解释。 */
  notes: string[]
}

/**
 * 金钱系统状态。
 *
 * **刻意不设 `balance` 字段**：当前周的额度与余额全部由 `weeks` 与 `days` 派生
 * （本周额度 = `weeks.at(-1)?.nextWeekTC ?? config.weeklyTC`）。冗余的 `balance`
 * 会成为唯一可能与账本不一致的状态，而数据量极小，派生成本可忽略。
 */
export interface MoneyState {
  enabled: boolean
  config: MoneyConfig
  /** 日账本，按 date 升序。 */
  days: LedgerDay[]
  /** 周结算记录，按 weekStart 升序。 */
  weeks: WeekSettlement[]
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
