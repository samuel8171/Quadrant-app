import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import path from 'node:path'
import type { AppData, ReviewExport, SyncMeta } from '../shared/types'
import { flushPendingWrites, loadData, saveData } from './dataStore'
import { loadSyncMeta, saveSyncMeta } from './syncStore'
import { listReviews, openReview, saveReview } from './review'

/** 退出前等待最后一批写入的上限；超过则直接退出，不能卡住用户关窗口。 */
const QUIT_FLUSH_TIMEOUT_MS = 3000

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: '象限',
    backgroundColor: '#0F1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  ipcMain.handle('data:load', () => loadData())
  ipcMain.handle('data:save', (_event, data: AppData) => saveData(data))
  ipcMain.handle('sync:load', () => loadSyncMeta())
  ipcMain.handle('sync:save', (_event, meta: SyncMeta) => saveSyncMeta(meta))
  ipcMain.handle('review:save', (_event, payload: ReviewExport) => saveReview(payload))
  ipcMain.handle('review:list', () => listReviews())
  ipcMain.handle('review:open', (_event, filePath: string) => openReview(filePath))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  // 窗口销毁时渲染进程可能刚发出最后一次 `data:save`，这里等它落盘再退。
  // 只拦一次，超时放行，避免写入异常时关不掉窗口。
  event.preventDefault()
  quitting = true
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS))
  void Promise.race([flushPendingWrites(), timeout]).finally(() => app.quit())
})
