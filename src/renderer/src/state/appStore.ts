import { create } from 'zustand'
import type {
  AppData,
  CloudMeta,
  LedgerDay,
  LedgerEntry,
  MoneyConfig,
  MoneyState,
  Quadrant,
  QuadrantEvent,
  ReviewDraft,
  WeekEvent,
  WeekPreset
} from '../../../shared/types'
import { defaultData, isEmptyData } from '../../../shared/defaults'
import { addDays, dateKey, parseDateKey } from '../../../shared/dateKey'
import {
  DEFAULT_MONEY_CONFIG,
  abandonExpiredDays,
  costOfEntry,
  dayLimitOf,
  ensureLedgerDays,
  ensureWeekRollover,
  isFreeUnplannedSettlement,
  leisureDelta,
  nightMinutesOf,
  previousLatePhone,
  settleDay
} from '../../../shared/money'
import * as eventRules from '../lib/eventRules'
import * as goalRules from '../lib/goalRules'
import * as quadrantSync from '../lib/quadrantSync'
import * as weekRules from '../lib/weekRules'
import { reviewDirty } from '../lib/reviewRules'
import type { ViewState } from '../lib/quadrantMath'
import { flushPendingSave, scheduleSave } from '../lib/scheduleSave'
import { getPlatformApi, isDesktopRuntime } from '../lib/platformApi'
import {
  announceSync,
  fetchCloudData,
  fetchCloudMeta,
  hasCloudSession,
  pushCloudData
} from '../lib/cloudSync2'
import {
  buildSyncDetail,
  countEntities,
  formatSyncDetail,
  type SyncAction
} from '../lib/syncSummary'
import {
  decideStartup,
  isCloudChangedElsewhere,
  markPulled,
  markPushed,
  markSyncDirty,
  readSyncMeta,
  shouldPushOnStartup
} from '../lib/syncMeta'

export type Page = 'goals' | 'quadrant' | 'weekly' | 'review' | 'mine'

/**
 * 日结面板三问的答案 —— **日级**输入，不属于任何单条条目。
 *
 * 它们与 `entries` 一起交给 `settleDay`：`videoMin` / `gameMin` 是本日两条纯消费
 * （只扣娱币），`latePhone` 是本日对「昨天 24:00 后有没有刷手机」的答案（**记在本日、
 * 扣在次日**）。三个字段都必须随每次结算一起透传，漏传任一都会被 `settleDay` 的缺省值
 * 静默抹成 0 / false（见 `confirmNight` 的重跑）。
 */
export interface DayAnswers {
  videoMin: number
  gameMin: number
  latePhone: boolean
}

export interface CloudInspect {
  ok: boolean
  /** 差异摘要正文（失败时是错误原因）。 */
  detail: string
  /** 摘要中是否含需要用户额外注意的警示。 */
  hasWarning: boolean
}

interface AppState {
  data: AppData
  page: Page
  activeGoalId: string | null
  loaded: boolean
  init: () => Promise<void>
  inspectCloud: (action: SyncAction) => Promise<CloudInspect>
  pushToCloud: () => Promise<{ ok: boolean; message: string }>
  pullFromCloud: () => Promise<{ ok: boolean; message: string }>
  /** 前台恢复 / 网络恢复时对账一次。 */
  syncOnResume: () => Promise<void>
  applyCloudData: (data: AppData) => void
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
    showInQuadrant?: boolean
  }) => WeekSyncResult
  updateWeekEvent: (id: string, patch: Partial<WeekEvent>) => WeekSyncResult
  deleteWeekEvent: (id: string) => void
  moveWeekEvent: (id: string, startMin: number) => void
  setWeekCounterOffset: (offset: number) => void
  saveNow: () => void
  reviewDraft: ReviewDraft
  reviewEdit: ReviewDraft
  pendingPage: Page | null
  setReviewEdit: (patch: Partial<ReviewDraft>) => void
  saveReviewDraft: () => void
  discardReviewDraft: () => void
  requestPage: (page: Page) => void
  resolveLeave: (action: 'save' | 'discard' | 'cancel') => void
  setMoneyEnabled: (enabled: boolean) => void
  rolloverMoneyWeek: () => void
  /** 补出 `[今天 − 7, 今天)` 里每一天的未结算日账本（日结卡片的入口）。 */
  materializeLedgerDays: () => void
  /** 把掉出 7 天窗口仍未结算的日账本按满额扣款并冻结（spec R2 §4「逾期即放弃」）。 */
  abandonExpiredLedgerDays: () => void
  /**
   * 用 `entries` + 日级答案 `answers` 结算 `date`（Task 8 的正向路径，快照只有这里能首次冻结）。
   *
   * 无计划之日若会被结算成 0 花费，本动作直接拒绝（见 `isFreeUnplannedSettlement`）。
   */
  commitDaySettlement: (date: string, entries: LedgerEntry[], answers: DayAnswers) => void
  /** 把 `date` 申报为**休息日**并当场结算（spec R2 §4.3 的分支 A，固定扣 64 币、娱币不动）。 */
  markRestDay: (date: string, answers: DayAnswers) => void
  /** 把一条计划外条目追加进 `date`（未结算）的账本。 */
  addUnplannedEntry: (date: string, entry: LedgerEntry) => void
  /** 深夜补记：回写 `previousDate` 这一份**已结算**快照（全库唯一例外，见实现处注释）。 */
  confirmNight: (previousDate: string, answer: { worked: boolean; endMin?: number }) => void
}

let clipboard: QuadrantEvent | null = null

export function hasClipboardEvent(): boolean {
  return clipboard !== null
}

export type WeekSyncResult = { ok: true } | { ok: false; reason: 'quadrant-full' }

function saveSoon(data: AppData): void {
  scheduleSave(() => {
    void getPlatformApi().saveData(data)
    void syncAfterLocalSave(data)
  })
}

/**
 * 本地落盘之后的云端副作用。
 *
 * 关键约束：**桌面端不自动上传**。桌面端的云端动作全部是显式按钮行为
 * （「上传到云端」/「从云端恢复」），这样用户对"什么被覆盖"始终有感知。
 */
async function syncAfterLocalSave(data: AppData): Promise<void> {
  if (isDesktopRuntime()) return
  try {
    const before = await readSyncMeta()
    await markSyncDirty()
    if (isEmptyData(data) && before.cloudRevision === null) {
      // 空数据写入保护。触发场景：新设备、或清了浏览器缓存 → 读不到本地数据 →
      // 本地退化为空。此时若照常自动上传，**第一笔操作就会把云端整份覆盖成空**。
      //
      // 判据特意收紧到「本机没有任何同步记忆」：有记忆说明本机同步过，此刻为空
      // 就是用户真的把内容删光了，那是正常编辑，必须照常上传（否则会"删了又回来"）。
      // 清缓存/换设备都会连同步记忆一起丢，所以真正危险的场景仍然被覆盖。
      const cloud = await fetchCloudData()
      if (cloud.data && !isEmptyData(cloud.data)) {
        useAppStore.getState().applyCloudData(cloud.data)
        await markPulled(cloud.revision)
      }
      return
    }
    const { revision } = await pushCloudData(data)
    const meta = await markPushed(revision)
    void announceSync({ deviceId: meta.deviceId, revision })
  } catch {
    /* 离线或未登录：保留 dirty，留给启动对账与前台恢复补传 */
  }
}

/**
 * 启动 / 前台恢复时的对账：先比元信息（廉价），再决定拉还是推。
 *
 * 首屏不会被它阻塞——调用方先把本地数据渲染出来，再在后台跑这里。
 */
async function reconcileWithCloud(): Promise<void> {
  const state = useAppStore.getState()
  const local = state.data
  const meta = await readSyncMeta()
  let cloud: CloudMeta
  try {
    cloud = await fetchCloudMeta()
  } catch {
    return
  }
  const session = await hasCloudSession()
  const input = { hasSession: session, local, cloud, meta }

  if (decideStartup(input).kind === 'adopt-cloud') {
    try {
      const { revision, data } = await fetchCloudData()
      if (!data) return
      state.applyCloudData(data)
      await markPulled(revision)
    } catch {
      /* 拉取失败保持原状，下次前台恢复会重试 */
    }
    return
  }

  if (shouldPushOnStartup(input)) {
    try {
      const { revision } = await pushCloudData(local)
      const next = await markPushed(revision)
      void announceSync({ deviceId: next.deviceId, revision })
    } catch {
      /* 补传失败不致命：dirty 仍为真 */
    }
  }
}

/**
 * 把一条日账本按日期升序写回账本数组，**同日的旧记录整体替换**。
 *
 * 「整体替换」正是结算的语义：一天的快照是原子的，不存在「半个快照」。
 * 日账本的唯一真源是 `date`，`upsert` 而不是 `push` 才能保证重复结算（异常重入）
 * 不会在同一天留下两条记录。
 */
function upsertLedgerDay(days: LedgerDay[], day: LedgerDay): LedgerDay[] {
  const next = days.filter((d) => d.date !== day.date)
  next.push(day)
  next.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return next
}

/**
 * 结算 `date` 时该带入的「前一日透支额」。
 *
 * 透支只带入**次日**（与 `settleDay` / `selectMoneyStats` 同一条规则），所以这里只看
 * 日历上的昨天：昨天没有账本 → 0；昨天已结算 → 直接取冻结快照的 `overdraft`。
 *
 * 「昨天未结算」这一支在正常路径上到不了 —— 结算按最早优先，昨天必定已结算。
 * 保留它是为了让异常输入也算出正确的额度，而不是悄悄按 0 处理（那会把额度算高）。
 */
function carriedOverdraft(money: MoneyState, date: string): number {
  const prevDate = dateKey(addDays(parseDateKey(date), -1))
  const prev = money.days.find((d) => d.date === prevDate)
  if (!prev) return 0
  if (prev.settledAt !== null) return prev.overdraft
  const limit = dayLimitOf(carriedOverdraft(money, prevDate), money.config)
  const spent = prev.entries.reduce(
    (sum, e) =>
      sum + costOfEntry({ actualMin: e.actualMin, nightMin: e.nightMin, quadrant: e.quadrant }, money.config),
    0
  )
  return Math.max(0, spent - limit)
}

/**
 * 深夜补记条目：从 `nightStartMin`（23:30）起算、到 `endMin` 结束的那一段。
 *
 * `endMin` 是「持续到几点」的钟点（自 0 点起算）；不大于 `nightEndMin`（06:00）即
 * 跨过零点，加 1440 归一。时长下限 1 分钟、上限一个深夜窗口（390 分钟）——
 * 补记只回答「深夜还在做什么」，超过窗口的部分不属于这一问。
 *
 * 记成 `kind: 'unplanned'`：这段工作没有计划基准（`plannedMin` 只能为 null），
 * 因此按 `leisureDelta` 的口径它不参与娱币，只按时长计 TC（深夜部分带倍率）。
 */
function buildNightEntry(endMin: number, config: MoneyConfig): LedgerEntry {
  const window = config.nightEndMin + 1440 - config.nightStartMin
  const normalizedEnd = endMin <= config.nightEndMin ? endMin + 1440 : endMin
  const actualMin = Math.max(1, Math.min(normalizedEnd - config.nightStartMin, window))
  const nightMin = nightMinutesOf({ startMin: config.nightStartMin, actualMin }, config)
  return {
    id: crypto.randomUUID(),
    kind: 'unplanned',
    sourceId: null,
    title: '深夜做事',
    quadrant: null,
    plannedMin: null,
    actualMin,
    done: true,
    nightMin,
    costTC: costOfEntry({ actualMin, nightMin, quadrant: null }, config),
    deltaLT: leisureDelta(
      { kind: 'unplanned', done: true, actualMin, plannedMin: null },
      config
    )
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  data: defaultData(),
  page: 'goals',
  activeGoalId: null,
  loaded: false,
  reviewDraft: { completion: 0, quality: 0, stress: 0, text: '' },
  reviewEdit: { completion: 0, quality: 0, stress: 0, text: '' },
  pendingPage: null,

  init: async () => {
    // 先把本地数据渲染出来，云端对账放到后面——网络慢时首屏不该等它。
    const data = await getPlatformApi().loadData()
    set({ data, loaded: true })
    // 顺序不能反：先物化 [今天−7, 今天) 的每一天，再把掉出窗口的未结算日放弃冻结，
    // 最后才滚动周结算。放弃必须在滚动之前 —— 被放弃的一天会变成「已结算」，
    // 而一周只有在它的日账本全部已结算、且没有 nightPending 时才结算（见 ensureWeekRollover）。
    get().materializeLedgerDays()
    get().abandonExpiredLedgerDays()
    get().rolloverMoneyWeek()
    if (isDesktopRuntime()) return
    await reconcileWithCloud()
  },

  inspectCloud: async (action) => {
    const local = countEntities(get().data)
    try {
      const meta = await readSyncMeta()
      const { revision, data } = await fetchCloudData()
      const detail = buildSyncDetail({
        action,
        local,
        cloud: data ? countEntities(data) : null,
        cloudUpdatedAt: revision,
        cloudChangedElsewhere: isCloudChangedElsewhere(
          { exists: revision !== null, revision },
          meta
        ),
        localDirty: meta.dirty
      })
      return { ok: true, detail: formatSyncDetail(detail), hasWarning: detail.warning !== null }
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : '无法读取云端信息',
        hasWarning: true
      }
    }
  },

  pushToCloud: async () => {
    try {
      const { revision } = await pushCloudData(get().data)
      const meta = await markPushed(revision)
      void announceSync({ deviceId: meta.deviceId, revision })
      return { ok: true, message: '已上传到云端' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '上传失败' }
    }
  },

  pullFromCloud: async () => {
    try {
      const { revision, data } = await fetchCloudData()
      if (!data) return { ok: false, message: '云端暂无数据' }
      get().applyCloudData(data)
      await markPulled(revision)
      return { ok: true, message: '已从云端恢复' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '恢复失败' }
    }
  },

  syncOnResume: async () => {
    if (isDesktopRuntime()) return
    await reconcileWithCloud()
  },

  applyCloudData: (data) => {
    // 实时/对账推送过来的数据必须**落盘**：只改内存的话，下次冷启动又回到旧数据，
    // 表现为"同步过的东西过一会儿自己变回去了"。
    set({ data })
    void getPlatformApi().saveData(data)
    // 云端那份可能是另一台设备写的：先补出窗口内的未结算日、放弃逾期日，再补周结算
    // （顺序同 init —— 物化与放弃都必须在滚动之前）。
    get().materializeLedgerDays()
    get().abandonExpiredLedgerDays()
    // 云端那份可能是在另一个设备上、跨了周才写下的，落地后立刻补一次周结算。
    get().rolloverMoneyWeek()
  },

  setPage: (page) => set({ page }),
  setReviewEdit: (patch) => set((s) => ({ reviewEdit: { ...s.reviewEdit, ...patch } })),
  saveReviewDraft: () => set((s) => ({ reviewDraft: s.reviewEdit })),
  discardReviewDraft: () => set((s) => ({ reviewEdit: s.reviewDraft })),
  requestPage: (page) => {
    const s = get()
    if (s.page === 'review' && reviewDirty(s.reviewEdit, s.reviewDraft)) {
      set({ pendingPage: page })
    } else {
      set({ page })
    }
  },
  resolveLeave: (action) => {
    const s = get()
    const target = s.pendingPage
    if (!target) return
    if (action === 'save') set({ reviewDraft: s.reviewEdit })
    if (action === 'discard') set({ reviewEdit: s.reviewDraft })
    if (action !== 'cancel') set({ page: target })
    set({ pendingPage: null })
  },
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
    if (!fields.title.trim()) return { ok: true }
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
      showInQuadrant: fields.showInQuadrant ?? false,
      createdAt: new Date().toISOString()
    }
    let events = get().data.events
    if (event.showInQuadrant) {
      const pos = quadrantSync.findFreePosition(
        events,
        event.quadrant,
        quadrantSync.widthForTitle(event.title)
      )
      if (!pos) return { ok: false, reason: 'quadrant-full' }
      const synced = quadrantSync.buildQuadrantEvent(event, pos.x, pos.y)
      event.quadrantEventId = synced.id
      events = [...events, synced]
    }
    const data = { ...get().data, events, weekEvents: [...get().data.weekEvents, event] }
    saveSoon(data)
    set({ data })
    return { ok: true }
  },

  updateWeekEvent: (id, patch) => {
    const current = get().data.weekEvents.find((e) => e.id === id)
    if (!current) return { ok: true }
    const nextWeekEvents = weekRules.updateWeekEventInList(get().data.weekEvents, id, patch)
    const nextEvent = nextWeekEvents.find((e) => e.id === id)
    if (!nextEvent) return { ok: true }
    let events = get().data.events
    const show =
      patch.showInQuadrant !== undefined ? patch.showInQuadrant : current.showInQuadrant

    if (show && !nextEvent.quadrantEventId) {
      const pos = quadrantSync.findFreePosition(
        events,
        nextEvent.quadrant,
        quadrantSync.widthForTitle(nextEvent.title)
      )
      if (!pos) return { ok: false, reason: 'quadrant-full' }
      const synced = quadrantSync.buildQuadrantEvent(nextEvent, pos.x, pos.y)
      nextEvent.quadrantEventId = synced.id
      events = [...events, synced]
    } else if (!show && current.quadrantEventId) {
      events = events.filter((e) => e.id !== current.quadrantEventId)
      nextEvent.quadrantEventId = undefined
    } else if (show && current.quadrantEventId) {
      const existing = events.find((e) => e.id === current.quadrantEventId)
      const width = quadrantSync.widthForTitle(nextEvent.title)
      if (existing && existing.quadrant === nextEvent.quadrant) {
        events = events.map((e) =>
          e.id === existing.id
            ? { ...e, text: nextEvent.title, remark: nextEvent.remark, width }
            : e
        )
      } else {
        const withoutOld = events.filter((e) => e.id !== current.quadrantEventId)
        const pos = quadrantSync.findFreePosition(withoutOld, nextEvent.quadrant, width)
        if (!pos) return { ok: false, reason: 'quadrant-full' }
        const synced = quadrantSync.buildQuadrantEvent(nextEvent, pos.x, pos.y)
        nextEvent.quadrantEventId = synced.id
        events = [...withoutOld, synced]
      }
    }
    const data = {
      ...get().data,
      events,
      weekEvents: nextWeekEvents
    }
    saveSoon(data)
    set({ data })
    return { ok: true }
  },

  deleteWeekEvent: (id) => {
    const current = get().data.weekEvents.find((e) => e.id === id)
    const events = current?.quadrantEventId
      ? get().data.events.filter((e) => e.id !== current.quadrantEventId)
      : get().data.events
    const data = {
      ...get().data,
      events,
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

  /**
   * 金钱系统的总开关。
   *
   * **首次开启必须写一份完整的 `MoneyState`**：网页端的校验器要求四个顶层字段
   * 齐全、`config` 十个键齐全，否则**整份 `AppData` 都会被判非法**，
   * `loadData()` 随之回退到 `defaultData()` —— 用户的目标与事件会被无声清空。
   * 所以 `config` 直接引用 `DEFAULT_MONEY_CONFIG`，不手抄字面量（抄一份就会漂移）。
   *
   * **关闭只翻 `enabled`**：`days` / `weeks` / `enabledAt` 原样保留（spec 4.3）。
   * 关一下开关不该等于把账本删了 —— 那是不可逆的。
   *
   * **每次「关 → 开」都刷新 `enabledAt`（不只是首次）**：记账窗口的下界会被夹到
   * `max(今天 − 7, enabledAt)`（见 `shared/money.ts` 的 `ledgerWindowStart`）。中途停用
   * 三天的用户在那三天同样「不在场」，重新开启后不能被追溯扣款，所以启用日必须跟着这次
   * 开启走。`enabled` 已经是 `true` 时再调本动作不是「转换」，不刷新 —— 否则一次多余的
   * 重开就会把窗口往前推、把已经物化出来的待结算日全部夹掉。
   */
  setMoneyEnabled: (enabled) => {
    const current = get().data
    // 从未启用过又要关：没有可改的状态，不凭空写出一份空账本。
    if (!current.money && !enabled) return
    // false → true 才算「开启」；首次启用时 current.money 为 undefined，同样是开启。
    const entering = enabled && current.money?.enabled !== true
    const enabledAt = dateKey(new Date())
    const money: MoneyState = current.money
      ? { ...current.money, enabled, ...(entering ? { enabledAt } : {}) }
      : { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [], enabledAt }
    const data = { ...current, money }
    saveSoon(data)
    set({ data })
  },

  /**
   * 补出 `[今天 − 7, 今天)` 里**每一天**的未结算日账本（spec R2 §4）。
   *
   * 这是日结卡片能出现的**前提**：没有它，`pendingDays` 永远扫不到任何东西 ——
   * 计费只发生在象限页完成事件的那一刻，而「当天没打开应用」根本不会产生日账本。
   * R2-D 起不再看「有没有计划」：没有安排计划的天同样要问。
   * 未启用时是空操作；`ensureLedgerDays` 无变化时原对象返回，据此短路掉无谓的落盘。
   *
   * 必须在 `abandonExpiredLedgerDays` 与 `rolloverMoneyWeek` **之前**调用：物化出来的未结算日会让
   * 含它的那一周被推迟结算（见 `ensureWeekRollover`），而不是先被冻结成一个 0。
   */
  materializeLedgerDays: () => {
    const data = get().data
    if (data.money?.enabled !== true) return
    const money = ensureLedgerDays(data.money, dateKey(new Date()))
    if (money === data.money) return
    const next = { ...data, money }
    saveSoon(next)
    set({ data: next })
  },

  /**
   * 把掉出 7 天窗口、却仍未结算的日账本按满额扣款并冻结（spec R2 §4「逾期即放弃」）。
   *
   * 必须在 `materializeLedgerDays` **之后**、`rolloverMoneyWeek` **之前**调用：
   * 放弃会把一天从「未结算」翻成「已结算」，而一周只有在它的日账本全部已结算、且没有
   * `nightPending` 时才结算 —— 顺序反了，被放弃的那一周就到不了可结算状态。
   * 未启用时是空操作；`abandonExpiredDays` 无逾期记录时原对象返回，据此短路掉无谓的落盘。
   */
  abandonExpiredLedgerDays: () => {
    const data = get().data
    if (data.money?.enabled !== true) return
    const money = abandonExpiredDays(data.money, dateKey(new Date()))
    if (money === data.money) return
    const next = { ...data, money }
    saveSoon(next)
    set({ data: next })
  },

  /**
   * 补齐跨周结算（spec 7.5）。未启用时是空操作。
   *
   * `ensureWeekRollover` 在没有待补的周时**原对象返回**，据此短路：
   * 既省掉一次无意义的落盘，也避免每次冷启动都白写一遍同步元信息。
   */
  rolloverMoneyWeek: () => {
    const data = get().data
    if (data.money?.enabled !== true) return
    const money = ensureWeekRollover(data.money, dateKey(new Date()))
    if (money === data.money) return
    const next = { ...data, money }
    saveSoon(next)
    set({ data: next })
  },

  /**
   * 把一天的结算写进账本（日结面板的「结算这一天」）。
   *
   * `entries` 是这一天的**完整**条目集（面板把计划内 + 计划外一起交上来），
   * 由 `settleDay` 从原始字段重新推导 `spentTC` / `overdraft` / `deltaLT`。
   * `answers` 是**日级**的三问答案（两条纯消费 + 昨夜刷手机），它们不属于任何单条条目，
   * 必须随这次结算一起透传 —— 漏传就会被 `settleDay` 的缺省值静默抹成 0 / false。
   * 写入的 `money` 是**四个字段齐全**的新对象（`...money` 只换 `days`）——
   * 半截 `money` 会被网页端校验器判非法，进而静默清空用户的全部数据。
   *
   * 已结算的日子**直接拒绝**（与 `addUnplannedEntry` 同一道闸）：已冻结的快照只能由
   * `confirmNight` 那一处改动。少了这道闸，「只有深夜补记能改快照」就只剩调用方自觉，
   * 任何一次误调用都会把某天的快照整体覆盖掉。
   *
   * **无计划之日若会被结算成 0 花费，本动作直接拒绝**：那里的便宜路是主动申报休息日，
   * 不是免费（判据见实现处与 `isFreeUnplannedSettlement` 的注释）。
   *
   * 结算完再补一次周结算，这是推迟机制**闭环**的一半：`ensureWeekRollover` 只有在
   * 「这一周的日账本全部已结算、且没有任何 `nightPending`」时才结算该周。因此
   * - 「先结算了旧日账本、此前无周可补」时，这一天才让某个已结束的周第一次变得可结算；
   * - 「上周还挂着 `nightPending`」时，这一天的日结会在面板里先把那些未收尾的深夜
   *   （可能是多个，见 `openNightsBefore`）逐条问过（见 `confirmNight`），把标记清掉，
   *   这里的重跑随即把上周补结算掉。
   * `ensureWeekRollover` 幂等，后续每次调用都原对象返回，所以只触发一次。
   */
  commitDaySettlement: (date, entries, answers) => {
    const data = get().data
    const money = data.money
    if (money?.enabled !== true) return
    if (money.days.find((d) => d.date === date)?.settledAt != null) return
    /*
     * 关掉「无计划之日以 0 花费结算」这条免费路（spec R2 §4.3 / §9.2）。
     *
     * 病根：面板的提交按钮在「记了计划外事项」时就会出现，而计划外事项的时长可以被改成 0
     * （输入框允许 0），于是 spentTC 归零、绕开休息日的 64。把守卫放在**这里**而不是只放在
     * 面板，是因为面板是 UI、可以被任何新的调用点绕过；本动作是所有正向结算的唯一闸门。
     * 判定逻辑住在纯函数里（`isFreeUnplannedSettlement`），面板与本动作读的是同一条规则。
     */
    if (isFreeUnplannedSettlement(entries, money.config)) return
    const settled = settleDay({
      date,
      entries,
      previousOverdraft: carriedOverdraft(money, date),
      // 前一日「昨夜 24:00 后有没有刷手机」的答案，由账本现查（没有前一日即 false ⇒ 不扣）。
      previousLatePhone: previousLatePhone(money.days, date),
      // 本日三问的答案：两条纯消费只扣娱币；刷手机记在本日、由次日结算读取后扣款。
      videoMin: answers.videoMin,
      gameMin: answers.gameMin,
      latePhone: answers.latePhone,
      settledAt: new Date().toISOString(),
      config: money.config
    })
    const next = { ...data, money: { ...money, days: upsertLedgerDay(money.days, settled) } }
    saveSoon(next)
    set({ data: next })
    get().rolloverMoneyWeek()
  },

  /**
   * 把一天申报为**休息日**并当场结算（spec R2 §4.3 的分支 A / §9.2）。
   *
   * 休息日是「没有安排计划的那一天」两条路里的那条便宜的：固定扣 `restDayCost(config)`
   * （默认 `round(80 × 0.8) = 64`）、娱币不动、条目恒为空。它与 `commitDaySettlement` 走
   * **同一个** `settleDay`，只是多传一个 `isRestDay: true` —— 没有旁路、没有第二套快照逻辑。
   *
   * 与 `commitDaySettlement` 同一道闸：已结算的日子直接拒绝（快照只许 `confirmNight` 改）。
   * 结算完同样补一次周结算：休息日的 `nightPending` 为 false，所以这一天不会成为
   * `ensureWeekRollover` 的阻塞项，被它挡住的周会在这里立刻补上。
   *
   * `answers` 里**只有 `latePhone` 有意义**：`settleDay` 的休息日分支会把 `videoMin` /
   * `gameMin` 归 0（休息日 = 这天不安排、也没做事），但**照记** `latePhone` ——
   * 那一问问的是**昨晚**，与今天休不休息无关；不透传就会让「刷完手机第二天申报休息」
   * 成为一条逃逸通道（settleDay 的休息日分支注释与用例都钉死了这条契约）。
   */
  markRestDay: (date, answers) => {
    const data = get().data
    const money = data.money
    if (money?.enabled !== true) return
    if (money.days.find((d) => d.date === date)?.settledAt != null) return
    const settled = settleDay({
      date,
      entries: [],
      isRestDay: true,
      previousOverdraft: carriedOverdraft(money, date),
      // 休息日**不免除**昨夜的连带扣款（spec R2 §6 / ruling 1）：同样查前一日答案。
      previousLatePhone: previousLatePhone(money.days, date),
      // 本日的「昨晚有没有刷手机」答案照记：它扣的是次日，与今天休不休息无关。
      latePhone: answers.latePhone,
      settledAt: new Date().toISOString(),
      config: money.config
    })
    const next = { ...data, money: { ...money, days: upsertLedgerDay(money.days, settled) } }
    saveSoon(next)
    set({ data: next })
    get().rolloverMoneyWeek()
  },

  /**
   * 追加一条计划外条目到 `date` 的账本（日结面板「有没有计划外的事」）。
   *
   * 面板每录一条就落一次盘，而不是攒到结算时一起写 —— 计划外事项是账本里最有价值的
   * 信息（spec 5），不该因为中途关掉面板就丢。当天已有**已结算**快照时直接拒绝：
   * 已冻结的一天只能由 `confirmNight` 那一处改动，别的入口不许碰。
   */
  addUnplannedEntry: (date, entry) => {
    const data = get().data
    const money = data.money
    if (money?.enabled !== true) return
    const existing = money.days.find((d) => d.date === date)
    if (existing?.settledAt != null) return
    const day: LedgerDay = existing
      ? { ...existing, entries: [...existing.entries, entry] }
      : {
          date,
          settledAt: null,
          entries: [entry],
          videoMin: 0,
          gameMin: 0,
          // 未结算的记录还没有那一问的答案：它要等这一天的日结才问（spec R2 §6）。
          latePhone: false,
          dayLimit: 0,
          spentTC: 0,
          overdraft: 0,
          deltaLT: 0,
          nightPending: true,
          // 未结算的记录不可能是休息日：休息日一经申报即结算（见 markRestDay）。
          isRestDay: false
        }
    const next = { ...data, money: { ...money, days: upsertLedgerDay(money.days, day) } }
    saveSoon(next)
    set({ data: next })
  },

  /**
   * 深夜补记（spec 7.3）——**全代码库唯一允许修改已结算快照的地方**。
   *
   * 时序决定了它必须存在：日结在 23:20 触发，而深夜窗口 23:30 才开启，于是第 `i` 天
   * 结算时根本看不到当晚 23:30 之后的做事；只能由第 `i+1` 天的日结回头补记。
   *
   * 这里**不是给数字打补丁**：把补记条目并进原来的条目集，再整日重跑 `settleDay`
   * 重新推导 `spentTC` / `overdraft` / `deltaLT` —— 否则快照会出现
   * 「汇总与条目互相对不上」的隐性错误，并顺着 `overdraft` 传导到周结算。
   * `settledAt` 沿用旧值：补记不改变「这一天是什么时候结算的」。
   * 无论答「是」还是「否」，都把 `nightPending` 置 false —— 这一问已经问过了。
   *
   * `previousDate` **不要求是日历上的昨天**：面板会挑出「正在结算的那一天之前、**所有**
   * 还挂着 `nightPending` 的已结算日」逐个来问（见 `SettlePanel` 与 `openNightsBefore`）。
   * 一次结算可能距上次开机好几天，且窗口左界那天（今天 − 7）的前一天落在窗口之外、可能没有记录；
   * 若死等「昨天」，更早那个未收尾的深夜就永远没人问、那一周也就永远结算不了。也正因为要问「所有」，
   * 这个 action 一次只清一天 —— 面板逐条调用它，谁也不会被落下。
   *
   * 面板的「那天我什么都没做」也会对**当天自己**调用它并传 `worked: false`：一天既然
   * 什么都没做，当晚 23:30 之后自然也没有做事，顺手把这一天自己的深夜问记成「否」。
   */
  confirmNight: (previousDate, answer) => {
    const data = get().data
    const money = data.money
    if (money?.enabled !== true) return
    const day = money.days.find((d) => d.date === previousDate)
    if (!day || day.settledAt === null) return
    const entries =
      answer.worked && answer.endMin !== undefined
        ? [...day.entries, buildNightEntry(answer.endMin, money.config)]
        : day.entries
    const recomputed = settleDay({
      date: previousDate,
      entries,
      // 两条娱币纯消费是**日级**输入，重算整天时必须原样带过去：
      // 漏传就等于把「那天刷视频 / 打游戏」的扣款从 deltaLT 里静默抹掉。
      // `?? 0` 兜底：网页端校验器只校验、不修复，本字段加入之前的老记录载入后
      // 在运行时可能仍是 `undefined`（类型上的非可选并不保证运行时如此）。
      videoMin: day.videoMin ?? 0,
      gameMin: day.gameMin ?? 0,
      // 休息日的申报状态同样是**日级**输入：它是「无计划日」分支的产物，条目为空，
      // 重算时若不透传，休息日会被当成一条 0 花费的普通日 —— 64 币被静默抹掉。
      // （休息日的 nightPending 已是 false，正常情况下 confirmNight 根本选不中它；
      //  这里透传是**第二道防线**：任何路径整日重跑都还原成休息日，而不是退化成 0。）
      isRestDay: day.isRestDay === true,
      // 深夜刷手机的答案同样是**日级**输入，而且跨着两天，重跑时最容易丢：
      // - `latePhone: day.latePhone` 是**本日（previousDate）自己**的答案，它决定 `次日` 的扣款。
      //   不透传就会把它静默重置成 false，于是次日那笔连带扣款**永久丢失**；
      // - `previousLatePhone` 是**前一日**的答案，它决定 `本日` 的扣款。不透传就会把本日快照里
      //   那笔扣款**静默抹掉**（与「休息日申报」同一类漏传事故）。
      // 侧写：`day.latePhone === true` 把老记录的缺席也收敛成 false。
      latePhone: day.latePhone === true,
      previousLatePhone: previousLatePhone(money.days, previousDate),
      previousOverdraft: carriedOverdraft(money, previousDate),
      settledAt: day.settledAt,
      config: money.config
    })
    const patched: LedgerDay = { ...recomputed, nightPending: false }
    const next = { ...data, money: { ...money, days: upsertLedgerDay(money.days, patched) } }
    saveSoon(next)
    set({ data: next })
    // 清掉 `nightPending` 后补一次周结算，这是推迟机制**闭环**的另一半：某个被推迟的周
    // （周日深夜待补记未清）正是在这里变得可结算。少了这一行，被推迟的周只能等下次开机才补上。
    get().rolloverMoneyWeek()
  },

  saveNow: () => {
    // 先兑现挂起的防抖写入（它捕获的 data 可能比此刻的内存快照更早被触发），
    // 再落一次当前快照，确保两笔都不丢。
    flushPendingSave()
    void getPlatformApi().saveData(get().data)
  }
}))
