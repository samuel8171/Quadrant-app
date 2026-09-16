import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultData, isEmptyData, defaultSyncMeta } from '../src/shared/defaults'
import type { AppData, CloudMeta, SyncMeta } from '../src/shared/types'
import {
  decideStartup,
  hasCloudRevision,
  isCloudChangedElsewhere,
  markPulled,
  markPushed,
  markSyncDirty,
  normalizeSyncMeta,
  patchSyncMeta,
  readSyncMeta,
  resetSyncMetaCache,
  shouldPushOnStartup
} from '../src/renderer/src/lib/syncMeta'

const data = (patch: Partial<AppData> = {}): AppData => ({ ...defaultData(), ...patch })
const nonEmpty = (): AppData =>
  data({
    goals: [
      {
        id: 'g1',
        title: '目标',
        type: 'long',
        done: false,
        remark: '',
        groupTitles: [],
        subtasks: [],
        order: 0,
        createdAt: '2026-09-01T00:00:00.000Z'
      }
    ]
  })
const meta = (patch: Partial<SyncMeta> = {}): SyncMeta => ({ ...defaultSyncMeta('dev-1'), ...patch })
const cloud = (revision: string | null): CloudMeta => ({ exists: revision !== null, revision })

describe('同步元信息：启动判定', () => {
  it('没有云端会话时一律保留本地（桌面端靠这条关掉自动同步）', () => {
    const action = decideStartup({
      hasSession: false,
      local: nonEmpty(),
      cloud: cloud('r2'),
      meta: meta({ cloudRevision: 'r1' })
    })
    expect(action).toEqual({ kind: 'keep-local', reason: 'no-session' })
  })

  it('云端没有有效修订号时不采纳云端', () => {
    expect(
      decideStartup({ hasSession: true, local: nonEmpty(), cloud: cloud(null), meta: meta() })
    ).toEqual({ kind: 'keep-local', reason: 'cloud-empty' })
  })

  it('本地为空而云端有数据时采纳云端（堵住"新设备覆盖云端为空"）', () => {
    expect(
      decideStartup({ hasSession: true, local: data(), cloud: cloud('r1'), meta: meta() })
    ).toEqual({ kind: 'adopt-cloud', reason: 'local-empty' })
  })

  it('本地有未上传改动时保留本地，且优先于"云端更新"', () => {
    expect(
      decideStartup({
        hasSession: true,
        local: nonEmpty(),
        cloud: cloud('r9'),
        meta: meta({ cloudRevision: 'r1', dirty: true })
      })
    ).toEqual({ kind: 'keep-local', reason: 'local-dirty' })
  })

  it('修订号一致时判定为已同步', () => {
    expect(
      decideStartup({
        hasSession: true,
        local: nonEmpty(),
        cloud: cloud('r1'),
        meta: meta({ cloudRevision: 'r1' })
      })
    ).toEqual({ kind: 'keep-local', reason: 'already-synced' })
  })

  it('修订号不一致且本地干净时采纳云端', () => {
    expect(
      decideStartup({
        hasSession: true,
        local: nonEmpty(),
        cloud: cloud('r2'),
        meta: meta({ cloudRevision: 'r1' })
      })
    ).toEqual({ kind: 'adopt-cloud', reason: 'cloud-newer' })
  })

  it('首次同步（本机没有记忆）也走采纳云端', () => {
    expect(
      decideStartup({ hasSession: true, local: nonEmpty(), cloud: cloud('r1'), meta: meta() }).kind
    ).toBe('adopt-cloud')
  })
})

describe('同步元信息：补传与变更识别', () => {
  it('只有"有会话 + 非空 + dirty"才补传', () => {
    const base = { hasSession: true, local: nonEmpty(), cloud: cloud('r1'), meta: meta({ dirty: true }) }
    expect(shouldPushOnStartup(base)).toBe(true)
    expect(shouldPushOnStartup({ ...base, meta: meta({ dirty: false }) })).toBe(false)
    expect(shouldPushOnStartup({ ...base, hasSession: false })).toBe(false)
    expect(shouldPushOnStartup({ ...base, local: data() })).toBe(false)
  })

  it('isCloudChangedElsewhere 只认有效修订号的不一致', () => {
    expect(isCloudChangedElsewhere(cloud('r2'), meta({ cloudRevision: 'r1' }))).toBe(true)
    expect(isCloudChangedElsewhere(cloud('r1'), meta({ cloudRevision: 'r1' }))).toBe(false)
    expect(isCloudChangedElsewhere(cloud(null), meta({ cloudRevision: 'r1' }))).toBe(false)
    expect(isCloudChangedElsewhere(cloud('r1'), meta({ cloudRevision: null }))).toBe(true)
  })

  it('hasCloudRevision 要求同时存在行与修订号', () => {
    expect(hasCloudRevision({ exists: true, revision: 'r1' })).toBe(true)
    expect(hasCloudRevision({ exists: true, revision: null })).toBe(false)
    expect(hasCloudRevision({ exists: false, revision: 'r1' })).toBe(false)
  })
})

describe('同步元信息：形状校验', () => {
  it('损坏输入被补齐为完整形状并生成 deviceId', () => {
    const fixed = normalizeSyncMeta({ dirty: 'yes', cloudRevision: 5 })
    expect(fixed.deviceId.length).toBeGreaterThan(0)
    expect(fixed.dirty).toBe(false)
    expect(fixed.cloudRevision).toBeNull()
    expect(fixed.lastPulledAt).toBeNull()
  })

  it('保留合法字段', () => {
    const kept = normalizeSyncMeta({
      deviceId: 'abc',
      cloudRevision: 'r7',
      lastPushedAt: '2026-09-16T00:00:00.000Z',
      dirty: true
    })
    expect(kept).toEqual({
      deviceId: 'abc',
      cloudRevision: 'r7',
      lastPushedAt: '2026-09-16T00:00:00.000Z',
      lastPulledAt: null,
      dirty: true
    })
  })
})

describe('同步元信息：持久化', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    resetSyncMetaCache()
    ;(globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value)
      }
    }
  })

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window
    resetSyncMetaCache()
  })

  it('deviceId 跨"重启"保持一致，且不是每次读取都重新生成', async () => {
    const first = await readSyncMeta()
    expect(first.deviceId.length).toBeGreaterThan(0)
    resetSyncMetaCache()
    const second = await readSyncMeta()
    expect(second.deviceId).toBe(first.deviceId)
  })

  it('dirty / 修订号 / 时间戳都会落盘', async () => {
    await markSyncDirty()
    expect((await readSyncMeta()).dirty).toBe(true)

    await markPushed('r-push')
    resetSyncMetaCache()
    const afterPush = await readSyncMeta()
    expect(afterPush.dirty).toBe(false)
    expect(afterPush.cloudRevision).toBe('r-push')
    expect(afterPush.lastPushedAt).not.toBeNull()

    await markPulled('r-pull')
    resetSyncMetaCache()
    const afterPull = await readSyncMeta()
    expect(afterPull.cloudRevision).toBe('r-pull')
    expect(afterPull.lastPulledAt).not.toBeNull()
  })

  it('局部更新不会丢掉既有字段', async () => {
    await markPushed('r1')
    await patchSyncMeta({ dirty: true })
    const merged = await readSyncMeta()
    expect(merged.cloudRevision).toBe('r1')
    expect(merged.dirty).toBe(true)
    expect(merged.lastPushedAt).not.toBeNull()
  })
})

describe('空数据判定', () => {
  it('四类实体全空才算空', () => {
    expect(isEmptyData(defaultData())).toBe(true)
    expect(isEmptyData(nonEmpty())).toBe(false)
    expect(isEmptyData(data({ weekCounterOffset: 120 }))).toBe(true)
  })
})
