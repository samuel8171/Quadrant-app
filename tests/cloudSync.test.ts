import { describe, expect, it } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import { validCloudData, validSyncNotice } from '../src/renderer/src/lib/cloudSync2'

describe('cloud sync validation', () => {
  it('accepts complete app data', () => expect(validCloudData(defaultData())).toBe(true))
  it('rejects incomplete data', () => expect(validCloudData({})).toBe(false))
  it('拒绝版本号不符的数据（避免旧格式覆盖新格式）', () =>
    expect(validCloudData({ ...defaultData(), version: 1 })).toBe(false))
  it('拒绝成员不是数组的数据', () =>
    expect(validCloudData({ ...defaultData(), weekEvents: null })).toBe(false))
  it('拒绝空值', () => {
    expect(validCloudData(null)).toBe(false)
    expect(validCloudData(undefined)).toBe(false)
  })
})

describe('sync notice validation', () => {
  it('接受完整的通知载荷', () =>
    expect(validSyncNotice({ deviceId: 'd1', revision: '2026-09-16T00:00:00.000Z' })).toBe(true))

  it('缺少 deviceId 或 revision 时拒绝（否则会当成自己发的而漏拉）', () => {
    expect(validSyncNotice({ deviceId: 'd1' })).toBe(false)
    expect(validSyncNotice({ revision: 'r1' })).toBe(false)
    expect(validSyncNotice({ deviceId: '', revision: 'r1' })).toBe(false)
    expect(validSyncNotice({ deviceId: 'd1', revision: '' })).toBe(false)
  })

  it('拒绝非对象载荷（broadcast 通道可能收到任意内容）', () => {
    expect(validSyncNotice(null)).toBe(false)
    expect(validSyncNotice('data-changed')).toBe(false)
    expect(validSyncNotice(42)).toBe(false)
  })
})
