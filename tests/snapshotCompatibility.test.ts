import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import { DEFAULT_MONEY_CONFIG, settleDay } from '../src/shared/money'

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
      copyFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn()
    }
  }
})

vi.mock('electron', () => ({ app: { getPath: () => 'sandbox-data' } }))
vi.mock('node:fs', () => ({ promises: io.fs }))

import { loadSnapshot, saveData } from '../src/main/dataStore'
import { createWebPlatformApi } from '../src/renderer/src/lib/platformApi'

beforeEach(() => {
  io.files.clear()
  vi.clearAllMocks()
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
    const raw = JSON.stringify({
      ...defaultData(),
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
})
