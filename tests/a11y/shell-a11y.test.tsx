/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import axe from 'axe-core'
import { systemGetInfo } from '../../src/api/system'
import { App } from '../../src/App'

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn() }))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' })
afterEach(() => { document.body.innerHTML = '' })

describe('desktop shell accessibility', () => {
  it('has no critical or serious axe violations', async () => {
    document.documentElement.lang = 'ko'; document.title = 'Paprv'
    const host = document.createElement('div'); document.body.append(host); createRoot(host).render(<App />)
    await vi.waitFor(() => expect(host.textContent).toContain('macos'))
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([])
  })
})
