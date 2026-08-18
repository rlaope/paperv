import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { ipcContracts } from '@paprv/contracts'
import { createWindowOptions, installNavigationPolicy } from './window-policy'

let mainWindow: BrowserWindow | null = null

function registerIpc(): void {
  ipcMain.handle(ipcContracts.systemGetInfo.channel, (_event, payload: unknown) => {
    ipcContracts.systemGetInfo.request.parse(payload)
    return ipcContracts.systemGetInfo.response.parse({ platform: process.platform, version: app.getVersion() })
  })
}

async function createMainWindow(): Promise<void> {
  const preload = join(__dirname, '../preload/index.js')
  const window = new BrowserWindow(createWindowOptions(preload))
  mainWindow = window
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const initialUrl = developmentUrl ?? new URL('../renderer/index.html', `file://${__dirname}/`).href
  installNavigationPolicy(window, initialUrl)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { mainWindow = null })
  if (developmentUrl) await window.loadURL(developmentUrl)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    registerIpc()
    await createMainWindow()
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createMainWindow()
    })
  }).catch((error: unknown) => {
    process.stderr.write(`Paprv startup failed: ${error instanceof Error ? error.message : 'unknown error'}
`)
    app.quit()
  })
  app.on('window-all-closed', () => app.quit())
}
