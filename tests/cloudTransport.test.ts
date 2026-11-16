import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MONEY_CONFIG } from '../src/shared/money'
import { defaultData } from '../src/shared/defaults'

const client = vi.hoisted(() => ({
  auth: { getSession: vi.fn() },
  rpc: vi.fn(),
  from: vi.fn()
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }))

import { fetchCloudData, fetchCloudMeta, pushCloudData } from '../src/renderer/src/lib/cloudSync2'

beforeEach(() => {
  vi.resetAllMocks()
  client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner' } } } })
})

describe('Supabase 快照适配器', () => {
  it('提交原子写入请求时包含预期修订，只认服务端返回的修订', async () => {
    client.rpc.mockResolvedValue({ data: '6b97bb68-ee24-4193-be27-b02e5981629a', error: null })
    const data = defaultData()
    await expect(pushCloudData(data, 'r0')).resolves.toEqual({ revision: '6b97bb68-ee24-4193-be27-b02e5981629a' })
    expect(client.rpc).toHaveBeenCalledWith('commit_user_snapshot', {
      expected_owner: 'owner',
      expected_revision: 'r0',
      snapshot: data
    })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('会话切换后不发送上一账号的待上传快照', async () => {
    await expect(pushCloudData(defaultData(), null, 'previous-owner')).rejects.toThrow('登录账号已改变')
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('读云端旧账本时补齐默认配置，丢弃仅本地使用的元信息', async () => {
    const content = {
      ...defaultData(),
      __quadrantLocalSnapshot: { snapshotId: 'unexpected' },
      money: { enabled: false, config: { ...DEFAULT_MONEY_CONFIG, latePhoneTC: undefined }, days: [], weeks: [] }
    }
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { revision: 'r1', updated_at: 'time', data: JSON.parse(JSON.stringify(content)) },
      error: null
    })
    client.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) })
    const result = await fetchCloudData()
    expect(result.data?.money?.config.latePhoneTC).toBe(DEFAULT_MONEY_CONFIG.latePhoneTC)
    expect(result.data).not.toHaveProperty('__quadrantLocalSnapshot')
  })

  it('没有匹配的行属于修订冲突', async () => {
    client.rpc.mockResolvedValue({ data: null, error: null })
    await expect(pushCloudData(defaultData(), null)).rejects.toMatchObject({ name: 'CloudRevisionConflict' })
  })

  it('无法识别现有云端行的修订时报告失败', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { updated_at: 'now' }, error: null })
    client.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) })
    await expect(fetchCloudMeta()).rejects.toThrow('云端修订号无效')
  })
})
