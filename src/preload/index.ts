import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, QuadrantApi, SyncMeta } from '../shared/types'

const api: QuadrantApi = {
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<void> => ipcRenderer.invoke('data:save', data),
  loadSyncMeta: () => ipcRenderer.invoke('sync:load'),
  saveSyncMeta: (meta: SyncMeta): Promise<void> => ipcRenderer.invoke('sync:save', meta),
  saveReview: (payload) => ipcRenderer.invoke('review:save', payload),
  listReviews: () => ipcRenderer.invoke('review:list'),
  openReview: (filePath) => ipcRenderer.invoke('review:open', filePath)
}

/**
 * 照片实体接口。**故意与 `QuadrantApi` 分开**：
 * 前者是"业务数据"（会被整份 JSON 进 localStorage / upsert 到云端），
 * 照片是二进制实体，两条通道的生命周期与失败语义完全不同，
 * 混在一个接口里以后很容易被误当成可序列化数据。
 */
const photos = {
  savePhoto: (id: string, dataUrl: string): Promise<void> => ipcRenderer.invoke('photo:save', id, dataUrl),
  loadPhoto: (id: string): Promise<string | null> => ipcRenderer.invoke('photo:load', id),
  deletePhoto: (id: string): Promise<void> => ipcRenderer.invoke('photo:delete', id)
}

contextBridge.exposeInMainWorld('quadrantApi', api)
contextBridge.exposeInMainWorld('quadrantPhotos', photos)
