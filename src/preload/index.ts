import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, QuadrantApi } from '../shared/types'

const api: QuadrantApi = {
  loadData: (): Promise<AppData> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<void> => ipcRenderer.invoke('data:save', data)
}

contextBridge.exposeInMainWorld('quadrantApi', api)
