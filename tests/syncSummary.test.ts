import { describe, expect, it } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import type { AppData } from '../src/shared/types'
import {
  buildSyncDetail,
  countEntities,
  formatCloudUpdatedAt,
  formatSyncDetail,
  type EntityCounts
} from '../src/renderer/src/lib/syncSummary'

const counts = (patch: Partial<EntityCounts> = {}): EntityCounts => ({
  goals: 0,
  events: 0,
  weekPresets: 0,
  weekEvents: 0,
  total: 0,
  ...patch
})

const base = {
  local: counts({ goals: 2, events: 5, total: 7 }),
  cloudUpdatedAt: '2026-09-16T07:20:00.000Z',
  cloudChangedElsewhere: false,
  localDirty: false
}

describe('实体计数', () => {
  it('按四类实体计总和', () => {
    const data: AppData = {
      ...defaultData(),
      goals: [{} as never, {} as never],
      events: [{} as never],
      weekPresets: [{} as never, {} as never, {} as never],
      weekEvents: [{} as never]
    }
    expect(countEntities(data)).toEqual({
      goals: 2,
      events: 1,
      weekPresets: 3,
      weekEvents: 1,
      total: 7
    })
  })

  it('空数据计数全为 0', () => {
    expect(countEntities(defaultData()).total).toBe(0)
  })
})

describe('云端时间格式化', () => {
  it('缺失或无法解析时返回未知', () => {
    expect(formatCloudUpdatedAt(null)).toBe('未知')
    expect(formatCloudUpdatedAt('not-a-date')).toBe('未知')
    expect(formatCloudUpdatedAt('')).toBe('未知')
  })

  it('当天显示"今天 HH:mm"，跨天显示日期', () => {
    // 用本地时间分量构造，断言与运行环境的时区无关
    const now = new Date(2026, 8, 16, 20, 0)
    expect(formatCloudUpdatedAt(new Date(2026, 8, 16, 9, 5).toISOString(), now)).toBe('今天 09:05')
    expect(formatCloudUpdatedAt(new Date(2026, 8, 1, 9, 5).toISOString(), now)).toBe(
      '2026-09-01 09:05'
    )
  })
})

describe('同步差异摘要', () => {
  it('上传：给出两侧条数与云端更新时间，无风险时不警示', () => {
    const detail = buildSyncDetail({ ...base, action: 'push', cloud: counts({ total: 4 }) })
    expect(detail.warning).toBeNull()
    expect(detail.lines[0]).toContain('本地：')
    expect(detail.lines[0]).toContain('共 7 条')
    expect(detail.lines[1]).toContain('共 4 条')
    expect(detail.lines[2]).toContain('云端最后更新：')
  })

  it('上传：云端被别的设备改过时警示会被覆盖', () => {
    const detail = buildSyncDetail({
      ...base,
      action: 'push',
      cloud: counts({ total: 4 }),
      cloudChangedElsewhere: true
    })
    expect(detail.warning).toContain('其他设备')
    expect(detail.warning).toContain('覆盖')
  })

  it('恢复：本地有未上传改动时警示会丢弃', () => {
    const detail = buildSyncDetail({
      ...base,
      action: 'pull',
      cloud: counts({ total: 4 }),
      localDirty: true
    })
    expect(detail.warning).toContain('尚未上传')
  })

  it('恢复：云端为空时明确说明无变化', () => {
    const detail = buildSyncDetail({ ...base, action: 'pull', cloud: null, cloudUpdatedAt: null })
    expect(detail.warning).toContain('云端还没有数据')
    expect(detail.lines[1]).toContain('暂无数据')
  })

  it('恢复：本地干净且云端有数据时不警示（正常路径）', () => {
    const detail = buildSyncDetail({ ...base, action: 'pull', cloud: counts({ total: 9 }) })
    expect(detail.warning).toBeNull()
  })

  it('拼装后的正文含警示行，无警示时不留空行', () => {
    const withWarning = formatSyncDetail(
      buildSyncDetail({ ...base, action: 'pull', cloud: null, cloudUpdatedAt: null })
    )
    expect(withWarning).toContain('⚠️')
    const clean = formatSyncDetail(buildSyncDetail({ ...base, action: 'push', cloud: counts() }))
    expect(clean).not.toContain('⚠️')
    expect(clean.split('\n')).toHaveLength(3)
  })
})
