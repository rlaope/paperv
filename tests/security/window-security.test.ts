import { describe, expect, it } from 'vitest'
import { createWindowOptions, denyNewWindow, isAllowedNavigation } from '../../apps/desktop/src/main/window-policy'

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
})
