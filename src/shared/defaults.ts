import type { AppData, SyncMeta } from './types'

export function defaultData(): AppData {
  return {
    version: 2,
    goals: [],
    events: [],
    weekPresets: [],
    weekEvents: [],
    weekCounterOffset: 0
  }
}

export function defaultSyncMeta(deviceId: string): SyncMeta {
  return {
    deviceId,
    lastPulledAt: null,
    lastPushedAt: null,
    cloudRevision: null,
    dirty: false
  }
}

/**
 * 是否为「空数据」（四类实体全空）。
 *
 * 用途是同步层的**空数据写入保护**：新设备、清过浏览器缓存的设备读不到本地
 * 数据时会退化为空数据，此时若照常自动上传，就会把云端的真实数据整份覆盖。
 * 只数实体，不看 `weekCounterOffset`——一个滚动位置不构成「用户数据」。
 */
export function isEmptyData(data: AppData): boolean {
  return (
    data.goals.length === 0 &&
    data.events.length === 0 &&
    data.weekPresets.length === 0 &&
    data.weekEvents.length === 0
  )
}
