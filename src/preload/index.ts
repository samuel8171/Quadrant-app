import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, QuadrantApi } from '../shared/types'

const api: QuadrantApi = {
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<void> => ipcRenderer.invoke('data:save', data),
  saveReview: (payload) => ipcRenderer.invoke('review:save', payload),
  listReviews: () => ipcRenderer.invoke('review:list'),
  openReview: (filePath) => ipcRenderer.invoke('review:open', filePath)
}

contextBridge.exposeInMainWorld('quadrantApi', api)
