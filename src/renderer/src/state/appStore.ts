import { create } from 'zustand'
import type {
  AppData,
  CloudMeta,
  Quadrant,
  QuadrantEvent,
  ReviewDraft,
  WeekEvent,
  WeekPreset
} from '../../../shared/types'
import { defaultData, isEmptyData } from '../../../shared/defaults'
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

export type Page = 'goals' | 'quadrant' | 'weekly' | 'review'

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

  saveNow: () => {
    // 先兑现挂起的防抖写入（它捕获的 data 可能比此刻的内存快照更早被触发），
    // 再落一次当前快照，确保两笔都不丢。
    flushPendingSave()
    void getPlatformApi().saveData(get().data)
  }
}))
