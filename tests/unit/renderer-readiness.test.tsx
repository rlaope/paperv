/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SystemInfo } from '@paprv/contracts'
import { App } from '../../apps/desktop/src/renderer/App'

let root: Root | undefined

afterEach(() => {
  root?.unmount()
  root = undefined
  document.body.innerHTML = ''
  delete document.documentElement.dataset.paprvReady
  delete document.documentElement.dataset.paprvPlatform
  delete document.documentElement.dataset.paprvVersion
  vi.restoreAllMocks()
})

describe('renderer-owned readiness', () => {
  it('marks the mounted renderer ready only after validated startup IPC succeeds', async () => {
    let resolveInfo: ((info: SystemInfo) => void) | undefined
    const getInfo = vi.fn(() => new Promise<SystemInfo>((resolve) => {
      resolveInfo = resolve
    }))
    window.paprv = { system: { getInfo } }
    const host = document.createElement('div')
    document.body.append(host)

    root = createRoot(host)
    root.render(<App />)
    await vi.waitFor(() => { expect(getInfo).toHaveBeenCalledOnce() })

    expect(document.documentElement.dataset.paprvReady).toBeUndefined()
    resolveInfo?.({ platform: 'darwin', version: '0.0.1' })
    await vi.waitFor(() => { expect(document.documentElement.dataset.paprvReady).toBe('true') })

    expect(document.documentElement.dataset).toMatchObject({
      paprvReady: 'true',
      paprvPlatform: 'darwin',
      paprvVersion: '0.0.1'
    })
    expect(host.textContent).toContain('darwin')
    expect(host.textContent).toContain('0.0.1')
  })

  it('keeps readiness unset and shows an error when startup IPC fails', async () => {
    window.paprv = { system: { getInfo: vi.fn().mockRejectedValue(new Error('IPC unavailable')) } }
    const host = document.createElement('div')
    document.body.append(host)

    root = createRoot(host)
    root.render(<App />)
    await vi.waitFor(() => { expect(host.textContent).toContain('시작 정보를 확인할 수 없습니다') })

    expect(document.documentElement.dataset.paprvReady).toBeUndefined()
  })
})
