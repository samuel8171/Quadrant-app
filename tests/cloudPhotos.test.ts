import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 照片云端存储层的守卫行为。
 *
 * 这层的核心契约是「**失败不抛**」：照片是附件，云端不可达时必须静默退化成
 * 纯本地（照片仍能在当前设备看到），绝不能因为一次上传失败就让"加照片"整体报错。
 * 所以这里断言的全是"失败时返回什么"，而不是"成功时调用了几次"。
 */
const supabaseMock = vi.hoisted(() => {
  const upload = vi.fn()
  const download = vi.fn()
  const remove = vi.fn()
  const from = vi.fn(() => ({ upload, download, remove }))
  const getSession = vi.fn()
  return {
    supabase: { storage: { from }, auth: { getSession } },
    upload,
    download,
    remove,
    from,
    getSession
  }
})

vi.mock('../src/renderer/src/lib/cloudSync2', () => ({ supabase: supabaseMock.supabase }))

import { canUseCloudPhotos, deleteCloudPhoto, downloadPhoto, uploadPhoto } from '../src/renderer/src/lib/cloudPhotos'

const UID = '11111111-2222-3333-4444-555555555555'
const blob = new Blob(['x'], { type: 'image/jpeg' })

beforeEach(() => {
  vi.clearAllMocks()
  supabaseMock.getSession.mockResolvedValue({ data: { session: { user: { id: UID } } } })
  supabaseMock.supabase.storage.from.mockImplementation(() => ({
    upload: supabaseMock.upload,
    download: supabaseMock.download,
    remove: supabaseMock.remove
  }))
})

describe('cloudPhotos', () => {
  it('reports cloud availability only when a session exists', async () => {
    expect(await canUseCloudPhotos()).toBe(true)
    supabaseMock.getSession.mockResolvedValue({ data: { session: null } })
    expect(await canUseCloudPhotos()).toBe(false)
  })

  /*
   * 路径必须落在 `attachments/<uid>/` 之下——`supabase/schema.sql` 的 RLS 策略
   * 按 `(storage.foldername(name))[1] = auth.uid()::text` 授权。层级错了会静默 403。
   */
  it('writes to the uid-scoped path required by the RLS policy', async () => {
    supabaseMock.upload.mockResolvedValue({ error: null })
    expect(await uploadPhoto('ph-abc', blob)).toBe(true)
    expect(supabaseMock.supabase.storage.from).toHaveBeenCalledWith('attachments')
    const [path, , options] = supabaseMock.upload.mock.calls[0]
    expect(path).toBe(`${UID}/ph-abc.jpg`)
    // 同一 id 只应写一次；覆盖写会让"重传"悄悄替换掉既有对象。
    expect(options.upsert).toBe(false)
  })

  /* id 里的异常字符不得逃出本人目录。 */
  it('sanitises the photo id so it cannot escape the owner folder', async () => {
    supabaseMock.upload.mockResolvedValue({ error: null })
    await uploadPhoto('ph-../../evil', blob)
    const [path] = supabaseMock.upload.mock.calls[0]
    expect(path.startsWith(`${UID}/`)).toBe(true)
    expect(path).not.toContain('..')
    expect(path).not.toContain('/evil')
  })

  it('returns false instead of throwing when the upload fails', async () => {
    supabaseMock.upload.mockResolvedValue({ error: { message: 'Bucket not found' } })
    expect(await uploadPhoto('ph-abc', blob)).toBe(false)
  })

  it('returns false instead of throwing when not signed in', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: null } })
    expect(await uploadPhoto('ph-abc', blob)).toBe(false)
    expect(supabaseMock.upload).not.toHaveBeenCalled()
  })

  it('treats a network exception as a failed upload, not a crash', async () => {
    supabaseMock.upload.mockRejectedValue(new Error('offline'))
    expect(await uploadPhoto('ph-abc', blob)).toBe(false)
  })

  it('downloads from the same path', async () => {
    supabaseMock.download.mockResolvedValue({ data: blob, error: null })
    expect(await downloadPhoto('ph-abc')).toBe(blob)
    expect(supabaseMock.download.mock.calls[0][0]).toBe(`${UID}/ph-abc.jpg`)
  })

  it('returns null on download error or missing data', async () => {
    supabaseMock.download.mockResolvedValue({ data: null, error: { message: 'nope' } })
    expect(await downloadPhoto('ph-abc')).toBeNull()
    supabaseMock.download.mockRejectedValue(new Error('offline'))
    expect(await downloadPhoto('ph-abc')).toBeNull()
  })

  /* 删除同样不能抛：本地实体已摘掉，残留云端对象只是垃圾字节。 */
  it('swallows delete failures', async () => {
    supabaseMock.remove.mockRejectedValue(new Error('offline'))
    await expect(deleteCloudPhoto('ph-abc')).resolves.toBeUndefined()
    supabaseMock.remove.mockResolvedValue({ error: { message: 'nope' } })
    await expect(deleteCloudPhoto('ph-abc')).resolves.toBeUndefined()
  })

  it('does not call the API at all when signed out', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: null } })
    expect(await downloadPhoto('ph-abc')).toBeNull()
    await deleteCloudPhoto('ph-abc')
    expect(supabaseMock.download).not.toHaveBeenCalled()
    expect(supabaseMock.remove).not.toHaveBeenCalled()
  })
})
