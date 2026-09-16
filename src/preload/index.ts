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

contextBridge.exposeInMainWorld('quadrantApi', api)
