import { app, BrowserWindow } from 'electron'

app.whenReady().then(() => {
  new BrowserWindow({ width: 800, height: 600 })
})
