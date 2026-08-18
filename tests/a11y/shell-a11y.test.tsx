/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import axe from 'axe-core'
import { signalRuntimeSmokeReady, systemGetInfo } from '../../src/api/system'
import { App } from '../../src/App'

const storage = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  clear: () => storage.clear(), getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value)
} })

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' })
vi.mocked(signalRuntimeSmokeReady).mockResolvedValue(false)
let root: Root | undefined
afterEach(() => { root?.unmount(); root = undefined; document.body.innerHTML = ''; window.localStorage.clear() })

describe('desktop shell accessibility', () => {
  it('uses English landmarks and has no critical or serious axe violations', async () => {
    document.documentElement.lang = 'en'; document.title = 'Paprv'
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<App />)
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Paper Explorer"]')).not.toBeNull())
    expect(document.documentElement.lang).toBe('en')
    expect(host.querySelector('main[aria-label="Markdown paper note"]')).not.toBeNull()
    expect(host.querySelector('aside[aria-label="Evidence and backlinks"]')).not.toBeNull()
    // jsdom has no layout renderer, so axe color contrast requires fresh rendered visual QA.
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } }
    })
    expect(result.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([])
  })
})
