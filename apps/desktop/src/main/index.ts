import { app, BrowserWindow, ipcMain } from 'electron'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { ipcContracts } from '@paprv/contracts'
import { createWindowOptions, installNavigationPolicy } from './window-policy'
import { createSafeLogger } from './safe-logger'

let mainWindow: BrowserWindow | null = null
const smokeTest = process.argv.includes('--smoke-test')
const smokeFailure = smokeTest ? process.env.PAPRV_SMOKE_FAILURE : undefined
const logger = createSafeLogger((line) => process.stderr.write(`${line}\n`))

const smokeFailureExitCodes = {
  startup: 41,
  preload: 42,
  ipc: 43,
  renderer: 44
} as const

class RendererReadinessError extends Error {}

function configureSmokeUserData(): boolean {
  if (!smokeTest) return true
  const candidate = process.env.PAPRV_SMOKE_USER_DATA
  if (
    candidate === undefined ||
    !isAbsolute(candidate) ||
    dirname(resolve(candidate)) !== resolve(tmpdir()) ||
    !/^paprv-smoke-[A-Za-z0-9]+$/.test(basename(candidate))
  ) {
    logger.error('app.startup.failed', {
      operation: 'app.startup',
      errorCode: 'STARTUP_FAILURE',
      outcome: 'failure',
      retryable: false
    })
    app.exit(smokeFailureExitCodes.startup)
    return false
  }
  app.setPath('userData', candidate)
  return true
}

function smokeExitCode(): number {
  if (smokeFailure === 'preload') return smokeFailureExitCodes.preload
  if (smokeFailure === 'ipc') return smokeFailureExitCodes.ipc
  if (smokeFailure === 'renderer') return smokeFailureExitCodes.renderer
  if (smokeFailure !== undefined) return smokeFailureExitCodes.startup
  return 1
}

async function waitForRendererReadiness(window: BrowserWindow): Promise<unknown> {
  try {
    return await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000
        const inspect = () => {
          const marker = {
            ready: document.documentElement.dataset.paprvReady,
            platform: document.documentElement.dataset.paprvPlatform,
            version: document.documentElement.dataset.paprvVersion
          }
          if (marker.ready === 'true') resolve(marker)
          else if (Date.now() >= deadline) reject(new Error('renderer readiness timeout'))
          else setTimeout(inspect, 25)
        }
        inspect()
      })
    `)
  } catch (error) {
    throw new RendererReadinessError('Packaged renderer did not become ready', { cause: error })
  }
}

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
  const developmentUrl = smokeTest ? undefined : process.env.ELECTRON_RENDERER_URL
  const initialUrl = developmentUrl ?? new URL('../renderer/index.html', `file://${__dirname}/`).href
  installNavigationPolicy(window, initialUrl)
  window.once('ready-to-show', () => {
    if (!smokeTest) window.show()
  })
  window.on('closed', () => { mainWindow = null })
  if (developmentUrl) await window.loadURL(developmentUrl)
  else {
    const rendererFile = smokeFailure === 'renderer' ? 'missing-renderer.html' : 'index.html'
    try {
      await window.loadFile(join(__dirname, `../renderer/${rendererFile}`))
    } catch (error) {
      if (smokeTest) throw new RendererReadinessError('Packaged renderer failed to load', { cause: error })
      throw error
    }
  }
  if (smokeTest) {
    const marker = await waitForRendererReadiness(window) as {
      ready?: unknown
      platform?: unknown
      version?: unknown
    }
    if (marker.ready !== 'true') throw new RendererReadinessError('Renderer readiness marker is invalid')
    let markerInfo
    try {
      markerInfo = ipcContracts.systemGetInfo.response.parse({
        platform: marker.platform,
        version: marker.version
      })
    } catch (error) {
      throw new RendererReadinessError('Renderer readiness marker data is invalid', { cause: error })
    }
    const response: unknown = await window.webContents.executeJavaScript('window.paprv.system.getInfo()')
    const info = ipcContracts.systemGetInfo.response.parse(response)
    if (markerInfo.platform !== info.platform || markerInfo.version !== info.version) {
      throw new RendererReadinessError('Renderer readiness marker does not match startup IPC')
    }
    process.stdout.write(`Paprv Electron smoke passed: ${info.platform} ${info.version}\n`)
    window.destroy()
    app.quit()
  }
}

if (!configureSmokeUserData()) {
  // Invalid smoke configuration exits before acquiring a shared lock.
} else if (!app.requestSingleInstanceLock()) {
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
    if (smokeFailure !== undefined && !Object.hasOwn(smokeFailureExitCodes, smokeFailure)) {
      throw new Error('unknown injected smoke failure')
    }
    if (smokeFailure !== 'ipc') registerIpc()
    await createMainWindow()
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createMainWindow()
    })
  }).catch((error: unknown) => {
    logger.error('app.startup.failed', {
      operation: 'app.startup',
      errorCode: 'STARTUP_FAILURE',
      outcome: 'failure',
      retryable: false
    })
    const exitCode = smokeFailure !== undefined
      ? smokeExitCode()
      : error instanceof RendererReadinessError
        ? smokeFailureExitCodes.renderer
        : 1
    app.exit(smokeTest ? exitCode : 1)
  })
  app.on('window-all-closed', () => app.quit())
}
