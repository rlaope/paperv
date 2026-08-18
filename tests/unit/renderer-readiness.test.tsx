/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalRuntimeSmokeReady, systemGetInfo, type SystemInfo } from '../../src/api/system'
import { App } from '../../src/App'

const storage = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  clear: () => storage.clear(), getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value)
} })

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
const getInfo = vi.mocked(systemGetInfo)
const signalReady = vi.mocked(signalRuntimeSmokeReady)
let root: Root | undefined

afterEach(() => {
  root?.unmount(); root = undefined; document.body.innerHTML = ''
  delete document.documentElement.dataset.paprvReady
  delete document.documentElement.dataset.paprvPlatform
  delete document.documentElement.dataset.paprvVersion
  delete document.documentElement.dataset.theme
  window.localStorage.clear()
  getInfo.mockReset()
  signalReady.mockReset()
})

describe('renderer-owned readiness', () => {
  it('keeps the English startup boundary until validated command success', async () => {
    signalReady.mockResolvedValue(false)
    let resolveInfo: ((info: SystemInfo) => void) | undefined
    getInfo.mockImplementation(() => new Promise((resolve) => { resolveInfo = resolve }))
    const host = document.createElement('div'); document.body.append(host)
    root = createRoot(host); root.render(<App />)
    await vi.waitFor(() => expect(getInfo).toHaveBeenCalledOnce())
    expect(host.textContent).toContain('Opening your paper workspace…')
    expect(document.documentElement.dataset.paprvReady).toBeUndefined()
    resolveInfo?.({ platform: 'macos', version: '0.0.1' })
    await vi.waitFor(() => expect(document.documentElement.dataset.paprvReady).toBe('true'))
    expect(document.documentElement.dataset).toMatchObject({ paprvReady: 'true', paprvPlatform: 'macos', paprvVersion: '0.0.1' })
    expect(host.querySelector('[data-paprv-runtime-ready="true"]')?.textContent).toBe('PAPRV_RENDERER_READY:macos:0.0.1')
    expect(signalReady).toHaveBeenCalledWith({ platform: 'macos', version: '0.0.1' })
  })

  it('keeps readiness unset and offers an English retry when the command fails', async () => {
    getInfo.mockRejectedValue(new Error('unavailable'))
    const host = document.createElement('div'); document.body.append(host)
    root = createRoot(host); root.render(<App />)
    await vi.waitFor(() => expect(host.textContent).toContain('Paprv could not start'))
    expect(host.textContent).toContain('Reconnect to the desktop runtime, then try again.')
    expect(host.querySelector('button')?.textContent).toBe('Try again')
    expect(document.documentElement.dataset.paprvReady).toBeUndefined()
    expect(host.querySelector('[data-paprv-runtime-ready]')).toBeNull()
  })
})
