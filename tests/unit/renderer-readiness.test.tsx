/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalRuntimeSmokeReady, systemGetInfo, type SystemInfo } from '../../src/api/system'
import { App } from '../../src/App'

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
const getInfo = vi.mocked(systemGetInfo)
const signalReady = vi.mocked(signalRuntimeSmokeReady)
let root: Root | undefined

afterEach(() => {
  root?.unmount(); root = undefined; document.body.innerHTML = ''
  delete document.documentElement.dataset.paprvReady
  delete document.documentElement.dataset.paprvPlatform
  delete document.documentElement.dataset.paprvVersion
  getInfo.mockReset()
  signalReady.mockReset()
})

describe('renderer-owned readiness', () => {
  it('marks the mounted renderer ready only after validated command success', async () => {
    signalReady.mockResolvedValue(false)
    let resolveInfo: ((info: SystemInfo) => void) | undefined
    getInfo.mockImplementation(() => new Promise((resolve) => { resolveInfo = resolve }))
    const host = document.createElement('div'); document.body.append(host)
    root = createRoot(host); root.render(<App />)
    await vi.waitFor(() => expect(getInfo).toHaveBeenCalledOnce())
    expect(document.documentElement.dataset.paprvReady).toBeUndefined()
    resolveInfo?.({ platform: 'macos', version: '0.0.1' })
    await vi.waitFor(() => expect(document.documentElement.dataset.paprvReady).toBe('true'))
    expect(document.documentElement.dataset).toMatchObject({ paprvReady: 'true', paprvPlatform: 'macos', paprvVersion: '0.0.1' })
    expect(host.textContent).toContain('macos')
    expect(host.querySelector('[data-paprv-runtime-ready="true"]')?.textContent).toBe('PAPRV_RENDERER_READY:macos:0.0.1')
    expect(signalReady).toHaveBeenCalledWith({ platform: 'macos', version: '0.0.1' })
  })

  it('keeps readiness unset and shows an error when the command fails', async () => {
    getInfo.mockRejectedValue(new Error('unavailable'))
    const host = document.createElement('div'); document.body.append(host)
    root = createRoot(host); root.render(<App />)
    await vi.waitFor(() => expect(host.textContent).toContain('시작 정보를 확인할 수 없습니다'))
    expect(document.documentElement.dataset.paprvReady).toBeUndefined()
    expect(host.querySelector('[data-paprv-runtime-ready]')).toBeNull()
  })
})
