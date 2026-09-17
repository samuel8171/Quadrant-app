import type { AppData } from '../../../shared/types'

/**
 * 云端数据的形状校验。**故意与 cloudSync2.ts 分开。**
 *
 * cloudSync2.ts 顶层会执行 `createClient(...)`，而 supabase 的 realtime 层要求
 * 运行环境提供原生 `WebSocket` 全局（Node 22+ 或浏览器）。Node 20 没有这个全局，
 * 于是 `createClient` 会在**模块加载期**抛 `Node.js detected but native WebSocket
 * not found`。
 *
 * 此前 `validCloudData` / `validSyncNotice` 和那个客户端同住一个模块，结果
 * "只测两个纯函数"的单元测试也把整个客户端拖进模块图——CI（Node 20）上整个测试
 * 套件因此加载失败、3 秒内退出，而本地（Node 22+）永远是绿的。把纯校验拆出来，
 * 这个耦合就断了。
 */
export function validCloudData(value: unknown): value is AppData {
  const d = value as Partial<AppData> | null
  return !!d && d.version === 2 && Array.isArray(d.goals) && Array.isArray(d.events) && Array.isArray(d.weekPresets) && Array.isArray(d.weekEvents)
}

export interface SyncNotice {
  /** 写入方的设备标识，用于抑制回环。 */
  deviceId: string
  /** 写入后的云端修订号。 */
  revision: string
}

export function validSyncNotice(value: unknown): value is SyncNotice {
  const n = value as Partial<SyncNotice> | null
  return !!n && typeof n.deviceId === 'string' && n.deviceId.length > 0 && typeof n.revision === 'string' && n.revision.length > 0
}
