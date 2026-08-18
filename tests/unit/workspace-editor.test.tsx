/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/App'
import { signalRuntimeSmokeReady, systemGetInfo } from '../../src/api/system'
import type { PaperDetail, PaperListItem, PaperNote } from '../../src/api/papers'
import type { WorkspacePapersApi } from '../../src/features/workspace/types'

const storage = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  clear: () => storage.clear(), getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key), setItem: (key: string, value: string) => storage.set(key, value)
} })

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' })
vi.mocked(signalRuntimeSmokeReady).mockResolvedValue(false)
const listItem: PaperListItem = {
  arxivId: '1706.03762', arxivVersion: 7, title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'], primaryCategory: 'cs.CL',
  publishedAt: '2017-06-12T17:57:34Z', metadataFetchedAt: '2026-08-18T06:00:00Z'
}
const detail: PaperDetail = {
  ...listItem, summary: 'The Transformer uses attention rather than recurrence or convolution.',
  categories: ['cs.CL', 'cs.LG'], sourceUpdatedAt: '2023-08-02T00:00:00Z', importedAt: '2026-08-18T06:00:00Z',
  note: { markdown: '# Reading note\n\nInitial observation', updatedAt: '2026-08-18T06:00:00Z' }
}
function api(paper = detail): WorkspacePapersApi {
  return {
    listPapers: vi.fn().mockResolvedValue([listItem]), getPaper: vi.fn().mockResolvedValue(paper),
    importArxivPaper: vi.fn().mockResolvedValue(paper),
    savePaperNote: vi.fn().mockImplementation(async (_id, markdown) => ({ markdown, updatedAt: '2026-08-18T07:00:00Z' }))
  }
}
let root: Root | undefined
afterEach(() => { root?.unmount(); root = undefined; document.body.innerHTML = ''; window.localStorage.clear(); vi.clearAllMocks() })
function render(papersApi: WorkspacePapersApi): HTMLElement {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<App papersApi={papersApi} />); return host
}
function click(element: Element): void { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
function namedButton(host: ParentNode, name: string): HTMLButtonElement {
  const match = [...host.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${name}`)
  return match
}
function enter(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
async function selectPaper(host: HTMLElement): Promise<HTMLTextAreaElement> {
  const option = await vi.waitFor(() => {
    const match = host.querySelector('[role="option"]')
    expect(match).not.toBeNull()
    return match as HTMLElement
  })
  click(option)
  return vi.waitFor(() => {
    const editor = host.querySelector('textarea[aria-label="Markdown paper note editor"]')
    expect(editor).toBeInstanceOf(HTMLTextAreaElement)
    return editor as HTMLTextAreaElement
  })
}

describe('Markdown workspace editor', () => {
  it('loads note content verbatim in a native textarea and saves it with Cmd+S', async () => {
    const papersApi = api(); const host = render(papersApi); const editor = await selectPaper(host)
    expect(editor.value).toBe('# Reading note\n\nInitial observation')
    enter(editor, '# Reading note\n\nRevised observation')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    await vi.waitFor(() => {
      expect(papersApi.savePaperNote).toHaveBeenCalledWith('1706.03762', '# Reading note\n\nRevised observation')
      expect(host.querySelector('[role="status"]')?.textContent).toContain('Saved')
    })
  })

  it('uses correct word-count grammar and compact status values', async () => {
    const host = render(api()); const editor = await selectPaper(host)
    enter(editor, 'word')
    await vi.waitFor(() => expect(host.querySelector('.editor-statusbar')?.textContent).toContain('1 word'))
    enter(editor, 'two words')
    await vi.waitFor(() => expect(host.querySelector('.editor-statusbar')?.textContent).toContain('2 words'))
    expect(host.querySelector('.editor-statusbar')?.textContent).toContain('Markdown')
    expect(host.querySelector('.editor-statusbar')?.textContent).toContain('Edit')
    expect(host.querySelector('.editor-statusbar')?.textContent).toContain('Cmd/Ctrl+S')
  })

  it('renders GFM safely, keeps external links inert, and focuses evidence links', async () => {
    const linked = { ...detail, note: { markdown: '# Findings\n\n[Abstract evidence](#evidence-abstract)\n\n[Source](https://example.com)\n\n<script>alert("unsafe")</script>', updatedAt: detail.note!.updatedAt } }
    const host = render(api(linked)); await selectPaper(host); click(namedButton(host, 'Preview'))
    await vi.waitFor(() => expect(host.querySelector('.markdown-preview h1')?.textContent).toBe('Findings'))
    expect(host.querySelector('.markdown-preview script')).toBeNull()
    const external = host.querySelector('[data-external-link="true"]') as HTMLElement
    expect(external.textContent).toBe('Source'); expect(external.hasAttribute('href')).toBe(false)
    click(host.querySelector('.evidence-link') as HTMLButtonElement)
    const abstract = await vi.waitFor(() => {
      const match = host.querySelector('#evidence-abstract[data-selected="true"]')
      expect(document.activeElement).toBe(match)
      return match as HTMLElement
    })
    expect(abstract.parentElement?.textContent).toContain(detail.summary)
  })

  it('shows honest empty backlinks and only actual evidence-link mentions', async () => {
    const host = render(api()); await selectPaper(host)
    click(namedButton(host, 'Backlinks'))
    await vi.waitFor(() => expect(host.textContent).toContain('No linked mentions yet.'))
    expect(host.textContent).toContain('Link to an evidence section from your note to see it here.')

    root?.unmount(); document.body.innerHTML = ''
    const linked = { ...detail, note: { markdown: 'Compare the [abstract](#evidence-abstract) carefully.\nIgnore [web](https://example.com).', updatedAt: detail.note!.updatedAt } }
    const linkedHost = render(api(linked)); await selectPaper(linkedHost); click(namedButton(linkedHost, 'Backlinks'))
    const backlink = await vi.waitFor(() => {
      const match = linkedHost.querySelector('.backlink-item')
      expect(match).not.toBeNull()
      return match as HTMLButtonElement
    })
    expect(backlink.textContent).toContain('Abstract')
    expect(backlink.textContent).toContain('Compare the abstract carefully.')
    expect(linkedHost.querySelectorAll('.backlink-item')).toHaveLength(1)
  })

  it('preserves IME safety and autosaves after the 600ms debounce', async () => {
    const papersApi = api(); const host = render(papersApi); const editor = await selectPaper(host)
    vi.mocked(papersApi.savePaperNote).mockClear()
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    enter(editor, 'Composed note')
    await new Promise((resolve) => window.setTimeout(resolve, 700))
    expect(papersApi.savePaperNote).not.toHaveBeenCalled()
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledWith('1706.03762', 'Composed note'), { timeout: 1_200 })
  })

  it('does not let a stale save response clear a newer dirty draft', async () => {
    let resolveFirst: ((note: PaperNote) => void) | undefined
    const first = new Promise<PaperNote>((resolve) => { resolveFirst = resolve })
    const papersApi = api(); papersApi.savePaperNote = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ markdown: 'newer draft', updatedAt: '2026-08-18T07:01:00Z' })
    const host = render(papersApi); const editor = await selectPaper(host)
    enter(editor, 'first draft')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledTimes(1))
    enter(editor, 'newer draft')
    resolveFirst?.({ markdown: 'first draft', updatedAt: '2026-08-18T07:00:00Z' })
    await vi.waitFor(() => expect(host.querySelector('[data-save-status="dirty"]')).not.toBeNull())
    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledWith('1706.03762', 'newer draft'), { timeout: 1_200 })
  })

  it('does not let a stale failed save replace a newer dirty draft with an error', async () => {
    let rejectFirst: ((error: Error) => void) | undefined
    const first = new Promise<PaperNote>((_resolve, reject) => { rejectFirst = reject })
    const papersApi = api(); papersApi.savePaperNote = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ markdown: 'newer draft', updatedAt: '2026-08-18T07:01:00Z' })
    const host = render(papersApi); const editor = await selectPaper(host)
    enter(editor, 'first draft')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledTimes(1))
    enter(editor, 'newer draft')
    rejectFirst?.(new Error('stale failure'))
    await vi.waitFor(() => expect(host.querySelector('[data-save-status="dirty"]')).not.toBeNull())
    expect(host.querySelector('.editor-statusbar[role="alert"]')).toBeNull()
    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledWith('1706.03762', 'newer draft'), { timeout: 1_200 })
  })

  it('flushes an edited draft and waits for save completion before closing', async () => {
    let resolveSave: ((note: PaperNote) => void) | undefined
    const pending = new Promise<PaperNote>((resolve) => { resolveSave = resolve })
    const papersApi = api(); papersApi.savePaperNote = vi.fn().mockReturnValue(pending)
    const host = render(papersApi); const editor = await selectPaper(host)

    enter(editor, 'close-safe draft')
    click(namedButton(host, 'Close paper'))

    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledWith('1706.03762', 'close-safe draft'))
    expect(host.querySelector('.active-document-tab')?.textContent).toContain(detail.title)
    resolveSave?.({ markdown: 'close-safe draft', updatedAt: '2026-08-18T07:00:00Z' })
    await vi.waitFor(() => expect(host.querySelector('.active-document-tab')?.textContent).toContain('Welcome'))
  })

  it('flushes an edited draft and waits for save completion before switching papers', async () => {
    const secondItem: PaperListItem = { ...listItem, arxivId: '2401.12345', title: 'Second Paper' }
    const secondDetail: PaperDetail = { ...detail, ...secondItem, note: null }
    let resolveSave: ((note: PaperNote) => void) | undefined
    const pending = new Promise<PaperNote>((resolve) => { resolveSave = resolve })
    const papersApi = api()
    papersApi.listPapers = vi.fn().mockResolvedValue([listItem, secondItem])
    papersApi.getPaper = vi.fn().mockImplementation(async (id) => id === secondItem.arxivId ? secondDetail : detail)
    papersApi.savePaperNote = vi.fn().mockReturnValue(pending)
    const host = render(papersApi); const editor = await selectPaper(host)

    enter(editor, 'switch-safe draft')
    const options = await vi.waitFor(() => {
      const matches = [...host.querySelectorAll<HTMLElement>('[role="option"]')]
      expect(matches).toHaveLength(2)
      return matches
    })
    click(options[1]!)

    await vi.waitFor(() => expect(papersApi.savePaperNote).toHaveBeenCalledWith('1706.03762', 'switch-safe draft'))
    expect(host.querySelector('.active-document-tab')?.textContent).toContain(detail.title)
    expect(papersApi.getPaper).not.toHaveBeenCalledWith(secondItem.arxivId)
    resolveSave?.({ markdown: 'switch-safe draft', updatedAt: '2026-08-18T07:00:00Z' })
    await vi.waitFor(() => {
      expect(papersApi.getPaper).toHaveBeenCalledWith(secondItem.arxivId)
      expect(host.querySelector('.active-document-tab')?.textContent).toContain(secondItem.title)
    })
  })

  it('keeps the draft and offers Retry save after failure', async () => {
    const saveMock = vi.fn().mockRejectedValueOnce(new Error('storage closed')).mockResolvedValueOnce({ markdown: 'recover me', updatedAt: '2026-08-18T07:00:00Z' })
    const papersApi = api(); papersApi.savePaperNote = saveMock
    const host = render(papersApi); const editor = await selectPaper(host)
    enter(editor, 'recover me'); editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    const alert = await vi.waitFor(() => {
      const match = host.querySelector('.editor-statusbar[role="alert"]')
      expect(match).not.toBeNull()
      return match as HTMLElement
    })
    expect(alert.textContent).toContain('Save failed'); expect(editor.value).toBe('recover me')
    click(namedButton(alert, 'Retry save'))
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2))
  })
})
