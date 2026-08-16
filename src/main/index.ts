import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import path from 'node:path'
import type { AppData, ReviewExport } from '../shared/types'
import { loadData, saveData } from './dataStore'
import { listReviews, openReview, saveReview } from './review'

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
