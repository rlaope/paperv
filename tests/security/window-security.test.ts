import { describe, expect, it, vi } from 'vitest'
import {
  createWindowOptions,
  denyNewWindow,
  installNavigationPolicy,
  isAllowedNavigation
} from '../../apps/desktop/src/main/window-policy'

describe('BrowserWindow security policy', () => {
  it('enforces renderer isolation and sandboxing', () => {
    const options = createWindowOptions('/tmp/preload.js')
    expect(options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true })
  })

  it('allows only the packaged renderer and local development origin', () => {
    expect(isAllowedNavigation('file:///app/out/renderer/index.html', 'file:///app/out/renderer/index.html')).toBe(true)
    expect(isAllowedNavigation('http://localhost:5173/settings', 'http://localhost:5173/')).toBe(true)
    expect(isAllowedNavigation('https://attacker.example', 'http://localhost:5173/')).toBe(false)
    expect(isAllowedNavigation('javascript:alert(1)', 'file:///app/out/renderer/index.html')).toBe(false)
  })

  it('denies every renderer request to open a new window', () => {
    expect(denyNewWindow()).toEqual({ action: 'deny' })
  })

  it('installs navigate, main-frame redirect, and window-open handlers', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    let openHandler: (() => { action: 'deny' }) | undefined
    const webContents = {
      setWindowOpenHandler: (handler: () => { action: 'deny' }) => { openHandler = handler },
      on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler) }
    }
    installNavigationPolicy({ webContents } as unknown as Electron.BrowserWindow, 'https://paprv.local/app')

    expect([...handlers.keys()]).toEqual(['will-navigate', 'will-redirect'])
    expect(openHandler?.()).toEqual({ action: 'deny' })

    const navigatePreventDefault = vi.fn()
    handlers.get('will-navigate')?.({ preventDefault: navigatePreventDefault }, 'https://attacker.example')
    expect(navigatePreventDefault).toHaveBeenCalledOnce()

    const redirectPreventDefault = vi.fn()
    handlers.get('will-redirect')?.(
      { preventDefault: redirectPreventDefault },
      'https://attacker.example',
      false,
      true
    )
    expect(redirectPreventDefault).toHaveBeenCalledOnce()

    const subframePreventDefault = vi.fn()
    handlers.get('will-redirect')?.(
      { preventDefault: subframePreventDefault },
      'https://attacker.example',
      false,
      false
    )
    expect(subframePreventDefault).not.toHaveBeenCalled()
  })
})
