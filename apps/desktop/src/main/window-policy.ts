import type { BrowserWindowConstructorOptions } from 'electron'

export function createWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Paprv',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  }
}

export function isAllowedNavigation(targetUrl: string, initialUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const initial = new URL(initialUrl)
    if (target.protocol !== initial.protocol) return false
    if (initial.protocol === 'file:') return target.href === initial.href
    return target.origin === initial.origin
  } catch {
    return false
  }
}

export function denyNewWindow(): { action: 'deny' } {
  return { action: 'deny' }
}

export function installNavigationPolicy(window: Electron.BrowserWindow, initialUrl: string): void {
  window.webContents.setWindowOpenHandler(() => denyNewWindow())
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl, initialUrl)) event.preventDefault()
  })
}
