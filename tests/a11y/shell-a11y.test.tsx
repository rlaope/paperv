/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import axe from 'axe-core'
import { App } from '../../apps/desktop/src/renderer/App'

afterEach(() => { document.body.innerHTML = '' })

describe('desktop shell accessibility', () => {
  it('has no critical or serious axe violations', async () => {
    document.documentElement.lang = 'ko'
    document.title = 'Paprv'
    const host = document.createElement('div')
    document.body.append(host)
    createRoot(host).render(<App />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } }
    })
    expect(result.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([])
  })
})
