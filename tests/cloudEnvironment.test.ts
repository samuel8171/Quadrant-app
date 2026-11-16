import { afterEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('@supabase/supabase-js', () => ({ createClient }))

async function startClient(url: string | undefined, key: string | undefined) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', key)
  return import('../src/renderer/src/lib/cloudSync2')
}

afterEach(() => {
  vi.unstubAllEnvs()
  createClient.mockClear()
})

describe('独立同步环境', () => {
  it('将隔离项目的 URL 与公开密钥一起交给客户端', async () => {
    await startClient('http://127.0.0.1:54321', 'sb_publishable_local_test')
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'sb_publishable_local_test')
  })

  it('地址或密钥缺失时拒绝混用默认项目的配置', async () => {
    await expect(startClient('https://staging.supabase.co', undefined)).rejects.toThrow('必须成对配置')
    await expect(startClient(undefined, 'sb_publishable_local_test')).rejects.toThrow('必须成对配置')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('拒绝将服务端密钥交给浏览器客户端', async () => {
    await expect(startClient('http://127.0.0.1:54321', 'sb_secret_test')).rejects.toThrow('公开密钥')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('兼容现有 Pages 工作流只传默认地址', async () => {
    const DEFAULT_URL = 'https://nktsnjbkvdyhxdjfbxkh.supabase.co'
    await startClient(DEFAULT_URL, undefined)
    expect(createClient).toHaveBeenCalledWith(DEFAULT_URL, expect.stringMatching(/^sb_publishable_/))
  })
})
