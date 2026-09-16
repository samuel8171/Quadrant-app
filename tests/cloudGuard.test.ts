import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import type { AppData, Goal, QuadrantApi } from '../src/shared/types'
import { flushPendingSave } from '../src/renderer/src/lib/scheduleSave'
import { markPushed, markSyncDirty, readSyncMeta, resetSyncMetaCache } from '../src/renderer/src/lib/syncMeta'

/**
 * 同步层的守卫行为验证（非纯函数部分）。
 *
 * 这里覆盖率最高优先级的一条修复：**空数据覆盖云端**（原方案 3.2 路径 ①）。
 * 触发链条是「新设备/清缓存 → 本地读不到数据 → 本地退化为空 → 第一笔自动上传
 * 把云端整份覆盖成空 → 其他设备再同步就全线变空」，全程没有任何提示。
 * 云端被 mock 掉，以便精确断言"这一笔到底推了还是没推"。
 */
const cloud = vi.hoisted(() => ({
  pushCloudData: vi.fn(),
  fetchCloudData: vi.fn(),
  fetchCloudMeta: vi.fn(),
  hasCloudSession: vi.fn(),
  announceSync: vi.fn()
}))

vi.mock('../src/renderer/src/lib/cloudSync2', () => cloud)

import { useAppStore } from '../src/renderer/src/state/appStore'

const DATA_KEY = 'quadrant-web-data-v2'
const storage = new Map<string, string>()
let desktop = false

const goal = (id: string): Goal => ({
  id,
  title: '目标',
  type: 'long',
  done: false,
  remark: '',
  groupTitles: [],
  subtasks: [],
  order: 0,
  createdAt: '2026-09-01T00:00:00.000Z'
})

const cloudData: AppData = { ...defaultData(), goals: [goal('cloud-1'), goal('cloud-2')] }
const localData: AppData = { ...defaultData(), goals: [goal('local-1')] }

/** 桌面端的 platform API：够用即可，重点是让 `isDesktopRuntime()` 为真。 */
function desktopApi(): QuadrantApi {
  return {
    loadData: async () => JSON.parse(storage.get(DATA_KEY) ?? JSON.stringify(defaultData())),
    saveData: async () => undefined,
    loadSyncMeta: async () => null,
    saveSyncMeta: async () => undefined,
    saveReview: async () => ({ fileName: '', filePath: '', size: 0, modifiedAt: '' }),
    listReviews: async () => [],
    openReview: async () => ({ ok: true })
  }
}

function installWindow(): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value)
    },
    ...(desktop ? { quadrantApi: desktopApi() } : {})
  }
}

const seedLocalData = (data: AppData): void => {
  storage.set(DATA_KEY, JSON.stringify(data))
}

/** 跑过 500ms 防抖窗口，让挂起的保存真正执行。 */
const settleSave = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(600)
}

beforeEach(() => {
  vi.useFakeTimers()
  flushPendingSave()
  vi.clearAllMocks()
  storage.clear()
  desktop = false
  installWindow()
  resetSyncMetaCache()
  cloud.pushCloudData.mockResolvedValue({ revision: 'r-new' })
  cloud.fetchCloudData.mockResolvedValue({ revision: 'r-cloud', data: cloudData })
  cloud.fetchCloudMeta.mockResolvedValue({ exists: true, revision: 'r-cloud' })
  cloud.hasCloudSession.mockResolvedValue(true)
  cloud.announceSync.mockResolvedValue(undefined)
  useAppStore.setState({ data: defaultData(), loaded: true })
})

afterEach(() => {
  flushPendingSave()
  vi.useRealTimers()
})

describe('空数据写入保护（路径 ①）', () => {
  it('本机没有同步记忆时，把内容清空不会上传，改为采纳云端', async () => {
    useAppStore.setState({ data: localData })
    useAppStore.getState().deleteGoal('local-1')
    await settleSave()

    expect(cloud.pushCloudData).not.toHaveBeenCalled()
    expect(cloud.fetchCloudData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['cloud-1', 'cloud-2'])
  })

  it('采纳云端后会把云端数据落盘，冷启动不会退回旧数据', async () => {
    useAppStore.setState({ data: localData })
    useAppStore.getState().deleteGoal('local-1')
    await settleSave()

    expect(storage.get(DATA_KEY)).toContain('cloud-1')
  })

  it('本机同步过时，删空属于正常编辑，照常上传', async () => {
    await markPushed('r-old')
    useAppStore.setState({ data: localData })
    useAppStore.getState().deleteGoal('local-1')
    await settleSave()

    expect(cloud.pushCloudData).toHaveBeenCalledTimes(1)
    expect((cloud.pushCloudData.mock.calls[0][0] as AppData).goals).toEqual([])
  })

  it('云端也是空的时候不会白白拉一次', async () => {
    cloud.fetchCloudData.mockResolvedValue({ revision: 'r-empty', data: defaultData() })
    useAppStore.setState({ data: localData })
    useAppStore.getState().deleteGoal('local-1')
    await settleSave()

    expect(cloud.pushCloudData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data.goals).toEqual([])
  })
})

describe('普通编辑的自动上传', () => {
  it('即时上传并记录修订号与时间戳', async () => {
    await markPushed('r-old')
    useAppStore.getState().addGoal('long', '新目标')
    await settleSave()

    expect(cloud.pushCloudData).toHaveBeenCalledTimes(1)
    const meta = await readSyncMeta()
    expect(meta.cloudRevision).toBe('r-new')
    expect(meta.dirty).toBe(false)
    expect(meta.lastPushedAt).not.toBeNull()
    expect(cloud.announceSync).toHaveBeenCalledWith({ deviceId: meta.deviceId, revision: 'r-new' })
  })

  it('上传失败（离线）时保留 dirty 且不抛异常', async () => {
    cloud.pushCloudData.mockRejectedValue(new Error('offline'))
    useAppStore.getState().addGoal('long', '离线目标')
    await settleSave()

    expect((await readSyncMeta()).dirty).toBe(true)
  })

  it('桌面端不做任何自动上传（云端动作必须是显式按钮）', async () => {
    desktop = true
    installWindow()
    useAppStore.getState().addGoal('long', '桌面目标')
    await settleSave()

    expect(cloud.pushCloudData).not.toHaveBeenCalled()
  })
})

describe('启动对账', () => {
  it('本地为空且无记忆 ⇒ 采纳云端', async () => {
    seedLocalData(defaultData())
    await useAppStore.getState().init()

    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['cloud-1', 'cloud-2'])
    expect(cloud.pushCloudData).not.toHaveBeenCalled()
    expect((await readSyncMeta()).cloudRevision).toBe('r-cloud')
  })

  it('上次离线留下的改动会被补传，而不是被云端盖掉', async () => {
    seedLocalData(localData)
    await markSyncDirty()
    await useAppStore.getState().init()

    expect(cloud.pushCloudData).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['local-1'])
    expect((await readSyncMeta()).cloudRevision).toBe('r-new')
  })

  it('已经同步过且云端未变时不做任何写入', async () => {
    seedLocalData(localData)
    await markPushed('r-cloud')
    await useAppStore.getState().init()

    expect(cloud.pushCloudData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['local-1'])
  })

  it('云端拉取失败不会打断启动', async () => {
    seedLocalData(localData)
    cloud.fetchCloudMeta.mockRejectedValue(new Error('network down'))
    await expect(useAppStore.getState().init()).resolves.toBeUndefined()
    expect(useAppStore.getState().loaded).toBe(true)
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['local-1'])
  })

  it('未登录时保持本地不动', async () => {
    seedLocalData(localData)
    cloud.hasCloudSession.mockResolvedValue(false)
    await useAppStore.getState().init()

    expect(cloud.pushCloudData).not.toHaveBeenCalled()
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['local-1'])
  })
})

describe('显式云端动作', () => {
  it('从云端恢复会整份替换并落盘', async () => {
    useAppStore.setState({ data: localData })
    const result = await useAppStore.getState().pullFromCloud()

    expect(result.ok).toBe(true)
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['cloud-1', 'cloud-2'])
    expect(storage.get(DATA_KEY)).toContain('cloud-1')
  })

  it('云端没有数据时如实报告，不改动本地', async () => {
    cloud.fetchCloudData.mockResolvedValue({ revision: null, data: null })
    useAppStore.setState({ data: localData })
    const result = await useAppStore.getState().pullFromCloud()

    expect(result.ok).toBe(false)
    expect(useAppStore.getState().data.goals.map((g) => g.id)).toEqual(['local-1'])
  })

  it('上传会更新修订号并广播给其他设备', async () => {
    useAppStore.setState({ data: localData })
    const result = await useAppStore.getState().pushToCloud()

    expect(result.ok).toBe(true)
    expect((await readSyncMeta()).cloudRevision).toBe('r-new')
    expect(cloud.announceSync).toHaveBeenCalledTimes(1)
  })

  it('上传失败时把原因回报给界面', async () => {
    cloud.pushCloudData.mockRejectedValue(new Error('请先登录云端账号'))
    const result = await useAppStore.getState().pushToCloud()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('请先登录云端账号')
  })

  it('确认框摘要会指出"云端被其他设备更新过"', async () => {
    await markPushed('r-old')
    useAppStore.setState({ data: localData })
    const info = await useAppStore.getState().inspectCloud('push')

    expect(info.ok).toBe(true)
    expect(info.hasWarning).toBe(true)
    expect(info.detail).toContain('其他设备')
  })

  it('确认框摘要会指出"本地有未上传改动"（恢复方向）', async () => {
    await markSyncDirty()
    useAppStore.setState({ data: localData })
    const info = await useAppStore.getState().inspectCloud('pull')

    expect(info.hasWarning).toBe(true)
    expect(info.detail).toContain('尚未上传')
  })
})
