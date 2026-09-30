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
  costOfEntry,
  dayLimitOf,
  ensureLedgerDays,
  ensureWeekRollover,
  leisureDelta,
  nightMinutesOf,
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
  /** 为「计划过、但账本里还没有记录」的过去日期补出未结算日账本（日结卡片的入口）。 */
  materializeLedgerDays: () => void
  /** 用 `entries` 结算 `date`（Task 8 的正向路径，快照只有这里能首次冻结）。 */
  commitDaySettlement: (date: string, entries: LedgerEntry[]) => void
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
    (sum, e) => sum + costOfEntry({ actualMin: e.actualMin, nightMin: e.nightMin }, money.config),
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
    costTC: costOfEntry({ actualMin, nightMin }, config),
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
    // 顺序不能反：先把「计划过但没有记录」的过去日补进账本，周结算才看得到它们；
    // 否则含未结算日的那些周会被当成空周冻结成一个再也改不了的 0。
    get().materializeLedgerDays()
    // 本地可能已经跨了若干个周（上次打开是很久以前），补齐周结算。桌面端也要跑。
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
    // 云端那份可能是另一台设备写的：先补出「计划过但没记录」的过去日，再补周结算
    // （顺序同 init —— 物化必须在滚动之前）。
    get().materializeLedgerDays()
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
   * **关闭只翻 `enabled`**：`days` / `weeks` 原样保留（spec 4.3）。
   * 关一下开关不该等于把账本删了 —— 那是不可逆的。
   */
  setMoneyEnabled: (enabled) => {
    const current = get().data
    // 从未启用过又要关：没有可改的状态，不凭空写出一份空账本。
    if (!current.money && !enabled) return
    const money: MoneyState = current.money
      ? { ...current.money, enabled }
      : { enabled: true, config: DEFAULT_MONEY_CONFIG, days: [], weeks: [] }
    const data = { ...current, money }
    saveSoon(data)
    set({ data })
  },

  /**
   * 补出「计划过、但账本里还没有记录」的过去日期（spec 7.1）。
   *
   * 这是日结卡片能出现的**前提**：没有它，`pendingDays` 永远扫不到任何东西 ——
   * 计费只发生在象限页完成事件的那一刻，而「排了计划但当天没打开应用」根本不会产生日账本。
   * 未启用时是空操作；`ensureLedgerDays` 无变化时原对象返回，据此短路掉无谓的落盘。
   *
   * 必须在 `rolloverMoneyWeek` **之前**调用：物化出来的未结算日会让含它的那一周被推迟结算
   * （见 `ensureWeekRollover`），而不是先被冻结成一个 0。
   */
  materializeLedgerDays: () => {
    const data = get().data
    if (data.money?.enabled !== true) return
    const money = ensureLedgerDays(
      data.money,
      data.weekEvents.map((event) => event.date),
      dateKey(new Date())
    )
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
   * 写入的 `money` 是**四个字段齐全**的新对象（`...money` 只换 `days`）——
   * 半截 `money` 会被网页端校验器判非法，进而静默清空用户的全部数据。
   *
   * 已结算的日子**直接拒绝**（与 `addUnplannedEntry` 同一道闸）：已冻结的快照只能由
   * `confirmNight` 那一处改动。少了这道闸，「只有深夜补记能改快照」就只剩调用方自觉，
   * 任何一次误调用都会把某天的快照整体覆盖掉。
   *
   * 结算完再补一次周结算，这是推迟机制**闭环**的一半：`ensureWeekRollover` 只有在
   * 「这一周的日账本全部已结算、且没有任何 `nightPending`」时才结算该周。因此
   * - 「先结算了旧日账本、此前无周可补」时，这一天才让某个已结束的周第一次变得可结算；
   * - 「上周还挂着 `nightPending`」时，这一天的日结会在面板里先问过深夜那一问（见
   *   `confirmNight`），把上周的标记清掉，这里的重跑随即把上周补结算掉。
   * `ensureWeekRollover` 幂等，后续每次调用都原对象返回，所以只触发一次。
   */
  commitDaySettlement: (date, entries) => {
    const data = get().data
    const money = data.money
    if (money?.enabled !== true) return
    if (money.days.find((d) => d.date === date)?.settledAt != null) return
    const settled = settleDay({
      date,
      entries,
      previousOverdraft: carriedOverdraft(money, date),
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
          dayLimit: 0,
          spentTC: 0,
          overdraft: 0,
          deltaLT: 0,
          nightPending: true
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
   * `previousDate` **不要求是日历上的昨天**：面板会挑「正在结算的那一天之前、最近的
   * 一个待收尾深夜」来问（见 `SettlePanel`）。materialization 只为计划过的日子建记录，
   * 未计划的日子是空洞；若死等「昨天」，一旦昨天没记录，前一个未收尾的深夜就永远没人问、
   * 那一周也就永远结算不了。
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
