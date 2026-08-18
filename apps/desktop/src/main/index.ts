import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { ipcContracts } from '@paprv/contracts'
import { createWindowOptions, installNavigationPolicy } from './window-policy'
import { createSafeLogger } from './safe-logger'

let mainWindow: BrowserWindow | null = null
const smokeTest = process.argv.includes('--smoke-test')
const smokeFailure = smokeTest ? process.env.PAPRV_SMOKE_FAILURE : undefined
const logger = createSafeLogger((line) => process.stderr.write(`${line}\n`))

function registerIpc(): void {
  ipcMain.handle(ipcContracts.systemGetInfo.channel, (_event, payload: unknown) => {
    ipcContracts.systemGetInfo.request.parse(payload)
    return ipcContracts.systemGetInfo.response.parse({ platform: process.platform, version: app.getVersion() })
  })
}

async function createMainWindow(): Promise<void> {
  const preload = smokeFailure === 'preload'
    ? join(__dirname, '../preload/missing.js')
    : join(__dirname, '../preload/index.js')
  const window = new BrowserWindow(createWindowOptions(preload))
  mainWindow = window
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const initialUrl = developmentUrl ?? new URL('../renderer/index.html', `file://${__dirname}/`).href
  installNavigationPolicy(window, initialUrl)
  window.once('ready-to-show', () => {
    if (!smokeTest) window.show()
  })
  window.on('closed', () => { mainWindow = null })
  if (developmentUrl) await window.loadURL(developmentUrl)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
  if (smokeTest) {
    const response: unknown = await window.webContents.executeJavaScript('window.paprv.system.getInfo()')
    const info = ipcContracts.systemGetInfo.response.parse(response)
    process.stdout.write(`Paprv Electron smoke passed: ${info.platform} ${info.version}\n`)
    window.destroy()
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  if (smokeTest) app.exit(1)
  else app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    if (smokeFailure === 'startup') throw new Error('injected startup failure')
    if (smokeFailure !== 'ipc') registerIpc()
    await createMainWindow()
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createMainWindow()
    })
  }).catch(() => {
    logger.error('app.startup.failed', {
      operation: 'app.startup',
      errorCode: 'STARTUP_FAILURE',
      outcome: 'failure',
      retryable: false
    })
    app.exit(1)
  })
  app.on('window-all-closed', () => app.quit())
}
