import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultData, defaultSyncMeta, isEmptyData } from '../src/shared/defaults'
import { DEFAULT_MONEY_CONFIG, settleDay } from '../src/shared/money'
import type { AppData } from '../src/shared/types'

const io = vi.hoisted(() => {
  const files = new Map<string, string>()
  const basename = (file: string) => file.split(/[\\/]/).at(-1)!
  return {
    files,
    fs: {
      readFile: vi.fn(async (file: string) => {
        const content = files.get(basename(file))
        if (content === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return content
      }),
      mkdir: vi.fn(),
      copyFile: vi.fn(async () => {}),
      writeFile: vi.fn<(_file: string, _content: string, _encoding: string) => Promise<void>>(),
      rename: vi.fn()
    }
  }
})

const cloud = vi.hoisted(() => ({
  auth: { getSession: vi.fn() },
  from: vi.fn(),
  rpc: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => 'sandbox-data' } }))
vi.mock('node:fs', () => ({ promises: io.fs }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => cloud }))

import { loadSnapshot, saveData } from '../src/main/dataStore'
import { fetchCloudData, pushCloudData } from '../src/renderer/src/lib/cloudSync2'
import { createWebPlatformApi } from '../src/renderer/src/lib/platformApi'

beforeEach(() => {
  io.files.clear()
  vi.clearAllMocks()
  cloud.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner' } } } })
})

describe('同一份存档跨适配器', () => {
  it('在桌面与 Web 用相同规则补齐缺失配置并保留已结算数据', async () => {
    const day = settleDay({
      date: '2026-10-01',
      settledAt: '2026-10-01T18:00:00Z',
      entries: [],
      previousOverdraft: 0,
      config: DEFAULT_MONEY_CONFIG
    })
    const { eventGroups: _absent, ...oldData } = defaultData()
    const raw = JSON.stringify({
      ...oldData,
      money: {
        enabled: false,
        config: { ...DEFAULT_MONEY_CONFIG, latePhoneTC: undefined },
        days: [day],
        weeks: []
      }
    })
    io.files.set('plan.json', raw)
    const desktop = await loadSnapshot()
    const web = await createWebPlatformApi({ getItem: (key) => key === 'quadrant-web-data-v2' ? raw : null, setItem: vi.fn() }).loadSnapshot!()
    expect(desktop.kind).toBe('ready')
    expect(web.data).toEqual(desktop.data)
    expect(desktop.data.money?.days).toEqual([day])
    expect(desktop.data.money?.enabledAt).toBeUndefined()
    expect(desktop.data.eventGroups).toBeUndefined()
    expect(io.files.get('plan.json')).toBe(raw)
  })

  it('主存档不可读时预览备份，保存动作保留主档与备份', async () => {
    io.files.set('plan.json', '{"version":3}')
    const backup = { ...defaultData(), weekCounterOffset: 5 }
    io.files.set('plan.backup.json', JSON.stringify(backup))
    expect(await loadSnapshot()).toEqual({ kind: 'recovery', data: backup })
    await expect(saveData(defaultData())).rejects.toThrow('原始文件已保留')
    expect(io.fs.copyFile).not.toHaveBeenCalled()
    expect(io.fs.writeFile).not.toHaveBeenCalled()
    expect(io.files.get('plan.json')).toBe('{"version":3}')
  })

  it('preserves the layout and data through desktop, Web and cloud using the same revision contract', async () => {
    const data: AppData = {
      ...defaultData(),
      eventGroups: [{ id: 'group', name: '答辩', anchorQuadrant: 2, anchorX: -150, anchorY: 125 }],
      events: [{ id: 'card', groupId: 'group', text: '答辩资料', remark: '备注', quadrant: 4,
        x: 128, y: -115, width: 10, createdAt: '2026-11-20T00:00:00.000Z', photos: ['photo-id'] }],
      weekEvents: [{ id: 'week', quadrantEventId: 'card', date: '2026-11-20', title: '答辩资料', quadrant: 2,
        startMin: 600, endMin: 630, color: '#8AB4F8', remark: '', showInQuadrant: true, createdAt: '2026-11-20T00:00:00.000Z' }],
      canvasBounds: { minX: -170, minY: -120, maxX: 150, maxY: 130 }
    }
    await saveData(data)
    const savedDesktop = io.fs.writeFile.mock.calls[0][1]
    io.files.set('plan.json', savedDesktop)
    expect(await loadSnapshot()).toEqual({ kind: 'ready', data })

    const storage = new Map<string, string>()
    const web = createWebPlatformApi({ getItem: (key) => storage.get(key) ?? null,
      setItem: (key, raw) => { storage.set(key, raw) } })
    const syncMeta = { ...defaultSyncMeta('device'), snapshotId: 'local-1', cloudRevision: 'r0', dirty: true }
    web.commitWebSnapshot!(data, syncMeta)
    expect(await web.loadSnapshot!()).toEqual({ kind: 'ready', data, syncMeta })
    expect(isEmptyData(data)).toBe(false)
    expect(isEmptyData({ ...defaultData(), canvasBounds: data.canvasBounds })).toBe(true)

    let remote: { revision: string; data: unknown } | null = null
    cloud.rpc.mockImplementation(async (_name, { expected_owner, expected_revision, snapshot }) => {
      expect(expected_owner).toBe('owner')
      expect(expected_revision).toBe('r0')
      remote = { revision: 'r1', data: JSON.parse(JSON.stringify(snapshot)) }
      return { data: remote.revision, error: null }
    })
    cloud.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: remote, error: null }) }) }) })
    await expect(pushCloudData((await web.loadSnapshot!()).data, 'r0', 'owner')).resolves.toEqual({ revision: 'r1' })
    await expect(fetchCloudData()).resolves.toMatchObject({ ownerId: 'owner', revision: 'r1', data })
  })

  it('previews a damaged group reference without writing over either local copy or sending it to the cloud', async () => {
    const damaged = { ...defaultData(), events: [{ id: 'card', groupId: '', text: '原卡', remark: '', quadrant: 1,
      x: 5, y: 5, width: 6, createdAt: '2026-11-20T00:00:00.000Z' }] }
    const raw = JSON.stringify(damaged)
    io.files.set('plan.json', raw)
    const web = createWebPlatformApi({ getItem: (key) => key === 'quadrant-web-data-v2' ? raw : null, setItem: vi.fn() })
    const desktop = await loadSnapshot()
    expect(desktop.kind).toBe('recovery')
    expect(desktop.data.events[0]).toMatchObject({ id: 'card', text: '原卡' })
    expect(desktop.data.events[0].groupId).toBeUndefined()
    expect(await web.loadSnapshot!()).toEqual(desktop)
    await expect(web.saveData(defaultData())).rejects.toThrow('原始数据已保留')
    await expect(saveData(defaultData())).rejects.toThrow('原始文件已保留')
    expect(io.files.get('plan.json')).toBe(raw)
    expect(io.fs.writeFile).not.toHaveBeenCalled()
    await expect(pushCloudData(damaged as AppData, 'r0')).rejects.toThrow('存档结构无效')
    expect(cloud.rpc).not.toHaveBeenCalled()
  })
})
