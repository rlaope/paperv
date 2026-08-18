/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signalRuntimeSmokeReady, systemGetInfo } from '../../src/api/system'
import { App } from '../../src/App'
import { normalizeArxivReference } from '../../src/features/import/ImportPaperDialog'
import type { PaperDetail } from '../../src/api/papers'
import type { WorkspacePapersApi } from '../../src/features/workspace/types'

const storage = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  clear: () => storage.clear(), getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value)
} })

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' })
vi.mocked(signalRuntimeSmokeReady).mockResolvedValue(false)

const paper: PaperDetail = {
  arxivId: '1706.03762', arxivVersion: 7, title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'], primaryCategory: 'cs.CL',
  publishedAt: '2017-06-12T17:57:34Z', metadataFetchedAt: '2026-08-18T06:00:00Z',
  summary: 'The dominant sequence transduction models use attention.', categories: ['cs.CL', 'cs.LG'],
  sourceUpdatedAt: '2023-08-02T00:00:00Z', importedAt: '2026-08-18T06:00:00Z', note: null
}

function createApi(overrides: Partial<WorkspacePapersApi> = {}): WorkspacePapersApi {
  return {
    listPapers: vi.fn().mockResolvedValue([]), getPaper: vi.fn().mockResolvedValue(paper),
    importArxivPaper: vi.fn().mockResolvedValue(paper),
    savePaperNote: vi.fn().mockResolvedValue({ markdown: '', updatedAt: '2026-08-18T06:00:00Z' }), ...overrides
  }
}
let root: Root | undefined
afterEach(() => {
  root?.unmount(); root = undefined; document.body.innerHTML = ''; window.innerWidth = 1024
  window.localStorage.clear(); delete document.documentElement.dataset.theme; vi.clearAllMocks()
})
function renderApp(papersApi = createApi()): HTMLElement {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<App papersApi={papersApi} />); return host
}
function namedButton(host: ParentNode, name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${name}`)
  return match
}
function click(element: Element): void { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
function enter(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Paprv workspace shell', () => {
  it('normalizes supported modern and legacy arXiv references', () => {
    expect(normalizeArxivReference('1706.03762')).toBe('1706.03762')
    expect(normalizeArxivReference('arXiv:1706.03762v7')).toBe('1706.03762')
    expect(normalizeArxivReference('https://arxiv.org/abs/1706.03762')).toBe('1706.03762')
    expect(normalizeArxivReference('hep-th/9901001')).toBe('hep-th/9901001')
    expect(normalizeArxivReference('https://example.com/abs/1706.03762')).toBeNull()
  })

  it('renders the English academic workbench and all generic ribbon actions', async () => {
    const host = renderApp()
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Paper Explorer"]')).not.toBeNull())
    expect(host.querySelector('main[aria-label="Markdown paper note"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Evidence and backlinks"]')).not.toBeNull()
    for (const label of ['Paper Explorer', 'Search Papers', 'Fetch from arXiv', 'Evidence and Backlinks', 'Switch to light theme']) {
      expect(host.querySelector(`.activity-ribbon button[aria-label="${label}"]`)).not.toBeNull()
    }
    expect(host.textContent).toContain('No papers in your library yet.')
    expect(host.textContent).toContain('Select a paper to begin a note')
    expect(host.textContent).toContain('Welcome')
    expect(host.textContent).not.toContain('Local Markdown notes grounded')
    expect(host.querySelector('[data-paprv-runtime-ready="true"]')?.textContent).toBe('PAPRV_RENDERER_READY:macos:0.0.1')
  })

  it('defaults to dark and persists a token-only light theme under paprv.theme', async () => {
    const host = renderApp()
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Switch to light theme"]')).not.toBeNull())
    expect(document.documentElement.dataset.theme).toBe('dark')
    click(namedButton(host, 'Switch to light theme'))
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(window.localStorage.getItem('paprv.theme')).toBe('light')
    expect(host.querySelector('[aria-label="Switch to dark theme"]')).not.toBeNull()
  })

  it('uses the exact responsive geometry contract in the stylesheet', () => {
    const css = process.getBuiltinModule('fs').readFileSync(`${process.cwd()}/src/style.css`, 'utf8')
    expect(css).toMatch(/grid-template-rows:\s*38px minmax\(0, 1fr\) 24px/)
    expect(css).toMatch(/grid-template-columns:\s*44px 220px minmax\(0, 1fr\) 260px/)
    expect(css).toMatch(/linear-gradient/)
    expect(css).toMatch(/radial-gradient/)
    const tauriConfig = JSON.parse(process.getBuiltinModule('fs').readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    expect(tauriConfig.app.windows[0]).toMatchObject({ width: 1280, height: 820, minWidth: 720, minHeight: 520 })
    expect(css).toMatch(/@media \(min-width: 800px\) and \(max-width: 1023px\)/)
    expect(css).toMatch(/grid-template-columns:\s*44px 224px minmax\(0, 1fr\)/)
    expect(css).toMatch(/@media \(max-width: 799px\)/)
    expect(css).toMatch(/grid-template-columns:\s*44px minmax\(0, 1fr\)/)
    expect(css).toMatch(/width:\s*272px/)
    expect(css).toMatch(/width:\s*320px/)
  })

  it('searches papers and shows only honest metadata in properties and the active tab', async () => {
    const api = createApi({ listPapers: vi.fn().mockResolvedValue([paper]) })
    const host = renderApp(api)
    const search = await vi.waitFor(() => {
      const match = host.querySelector('input[aria-label="Search papers"]')
      expect(match).toBeInstanceOf(HTMLInputElement)
      return match as HTMLInputElement
    })
    expect(search.placeholder).toBe('Search title, author, or arXiv ID')
    enter(search, 'missing')
    await vi.waitFor(() => expect(host.textContent).toContain('No matching papers.'))
    click(namedButton(host, 'Clear search'))
    const option = await vi.waitFor(() => {
      const match = host.querySelector('[role="option"]')
      expect(match).not.toBeNull()
      return match as HTMLElement
    })
    click(option)
    const properties = await vi.waitFor(() => {
      expect(api.getPaper).toHaveBeenCalledWith('1706.03762')
      const match = host.querySelector('.paper-properties')
      expect(match?.textContent).toContain('Attention Is All You Need')
      return match as HTMLElement
    })
    expect(properties.textContent).toContain('Attention Is All You Need')
    expect(properties.textContent).toContain('2017-06-12')
    expect(properties.textContent).toContain('Ashish Vaswani, Noam Shazeer')
    expect(host.querySelector('.active-document-tab')?.textContent).toContain(paper.title)
    expect(host.textContent).not.toContain('Recent')
    click(namedButton(host, 'Close paper'))
    await vi.waitFor(() => expect(host.querySelector('.active-document-tab')?.textContent).toContain('Welcome'))
    expect(host.textContent).toContain('No paper selected')
  })

  it('uses mutually exclusive compact modal drawers and returns focus after Escape', async () => {
    window.innerWidth = 720
    const host = renderApp()
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Paper Explorer"]')).not.toBeNull())
    const explorerToggle = namedButton(host, 'Paper Explorer')
    const evidenceToggle = namedButton(host, 'Evidence and Backlinks')
    const explorer = host.querySelector('aside[aria-label="Paper Explorer"]') as HTMLElement
    const evidence = host.querySelector('aside[aria-label="Evidence and backlinks"]') as HTMLElement
    expect(explorer.hidden).toBe(true); expect(evidence.hidden).toBe(true)
    click(explorerToggle)
    await vi.waitFor(() => expect(explorer.hidden).toBe(false))
    expect(explorer.getAttribute('role')).toBe('dialog'); expect(explorer.getAttribute('aria-modal')).toBe('true')
    expect(explorerToggle.getAttribute('aria-expanded')).toBe('true')
    click(evidenceToggle)
    await vi.waitFor(() => { expect(explorer.hidden).toBe(true); expect(evidence.hidden).toBe(false) })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(evidence.hidden).toBe(true))
    expect(document.activeElement).toBe(evidenceToggle)
  })

  it('adds a successfully fetched paper to the library even when the result is closed', async () => {
    const api = createApi(); const host = renderApp(api)
    await vi.waitFor(() => expect(host.textContent).toContain('No papers in your library yet.'))
    click(namedButton(host, 'Fetch from arXiv'))
    const dialog = await vi.waitFor(() => {
      const match = host.querySelector('.import-dialog')
      expect(match).not.toBeNull()
      return match as HTMLElement
    })
    const input = dialog.querySelector('input[aria-label="arXiv URL or ID"]') as HTMLInputElement
    enter(input, paper.arxivId)
    click(namedButton(dialog, 'Fetch paper'))

    await vi.waitFor(() => expect(dialog.textContent).toContain('Paper fetched from arXiv and added to your library.'))
    click(namedButton(dialog, 'Close'))

    await vi.waitFor(() => {
      expect(host.querySelector('.import-dialog')).toBeNull()
      expect(host.querySelector('[role="option"]')?.textContent).toContain(paper.title)
    })
    expect(host.querySelector('.active-document-tab')?.textContent).toContain('Welcome')
    expect(api.getPaper).not.toHaveBeenCalled()
  })

  it('labels arXiv acquisition as fetch rather than generic import and preserves the acknowledgement', async () => {
    const api = createApi(); const host = renderApp(api)
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Fetch from arXiv"]')).not.toBeNull())
    expect(host.querySelector('.topbar-import')?.textContent).toContain('Fetch from arXiv')
    expect(host.textContent).not.toContain('Import your first paper')
    click(namedButton(host, 'Fetch from arXiv'))
    const dialog = await vi.waitFor(() => {
      const match = host.querySelector('.import-dialog')
      expect(match).not.toBeNull()
      return match as HTMLElement
    })
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('Fetch paper metadata from arXiv by entering a paper URL or ID. Paprv is not endorsed by arXiv.')
    expect(dialog.textContent).toContain('Thank you to arXiv for use of its open access interoperability.')
    const input = dialog.querySelector('input[aria-label="arXiv URL or ID"]') as HTMLInputElement
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    expect(dialog.textContent).toContain('Fetch paper metadata from arXiv')
    enter(input, 'paper.pdf'); click(namedButton(dialog, 'Fetch paper'))
    await vi.waitFor(() => expect(dialog.textContent).toContain('Enter a valid arXiv URL or paper ID.'))
    expect(api.importArxivPaper).not.toHaveBeenCalled()
  })
})
