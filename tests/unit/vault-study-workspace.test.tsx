/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/App'
import { DocumentsApiError, type DocumentProperties } from '../../src/api/documents'
import { GenerationApiError, type GenerationRun } from '../../src/api/generation'
import { StudyApiError } from '../../src/api/study'
import { signalRuntimeSmokeReady, systemGetInfo } from '../../src/api/system'
import { StudyGenerationDialog } from '../../src/features/transform/TransformDialog'
import type { WorkspaceApis } from '../../src/features/workspace/types'

const windowLifecycle = vi.hoisted(() => ({
  closeHandler: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  destroy: vi.fn().mockResolvedValue(undefined),
  unlisten: vi.fn()
}))
vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async (handler: (event: { preventDefault: () => void }) => Promise<void>) => {
      windowLifecycle.closeHandler = handler
      return windowLifecycle.unlisten
    }),
    destroy: windowLifecycle.destroy
  })
}))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' }); vi.mocked(signalRuntimeSmokeReady).mockResolvedValue(false)
const paper = { arxivId: '1706.03762', arxivVersion: 7, title: 'Attention', authors: ['Author'], primaryCategory: 'cs.CL', publishedAt: '2017-06-12T17:57:34Z', metadataFetchedAt: '2026-08-18T06:00:00Z', summary: 'Stored abstract.', categories: ['cs.CL'], sourceUpdatedAt: '2023-08-02T00:00:00Z', importedAt: '2026-08-18T06:00:00Z' }
const docs = [
  { id: '550e8400-e29b-41d4-a716-446655440000', title: 'First', markdown: 'one', revision: 1, createdAt: '2026-08-18T06:00:00Z', updatedAt: '2026-08-18T06:00:00Z' },
  { id: '550e8400-e29b-41d4-a716-446655440001', title: 'Second', markdown: 'two', revision: 4, createdAt: '2026-08-18T06:00:00Z', updatedAt: '2026-08-18T06:00:00Z' }
]
function apis(): WorkspaceApis { return {
  papers: { listPapers: vi.fn().mockResolvedValue([paper]), getPaper: vi.fn().mockResolvedValue(paper), importArxivPaper: vi.fn().mockResolvedValue(paper) },
  documents: { list: vi.fn().mockResolvedValue(docs.map(({ id, title, revision, updatedAt }) => ({ id, title, revision, updatedAt }))), get: vi.fn().mockImplementation(async (id) => docs.find((d) => d.id === id)!), create: vi.fn().mockResolvedValue(docs[0]), update: vi.fn().mockImplementation(async (input) => ({ ...docs.find((d) => d.id === input.documentId)!, ...input, id: input.documentId, revision: input.expectedRevision + 1, updatedAt: '2026-08-18T07:00:00Z' })), delete: vi.fn().mockResolvedValue(null), getProperties: vi.fn().mockImplementation(async (id) => ({ documentId: id, papers: [], artifacts: [] })), linkPaper: vi.fn().mockResolvedValue(null), unlinkPaper: vi.fn().mockResolvedValue(null), linkArtifact: vi.fn().mockResolvedValue(null), unlinkArtifact: vi.fn().mockResolvedValue(null) },
  study: { get: vi.fn().mockResolvedValue({ paperId: paper.arxivId, createdAt: paper.importedAt, updatedAt: paper.importedAt, backlinks: [] }), listArtifacts: vi.fn().mockResolvedValue([]), saveArtifact: vi.fn(), deleteArtifact: vi.fn() },
  generation: { getReadiness: vi.fn().mockResolvedValue({ providers: [{ provider: 'claude_code', displayName: 'Claude Code', installation: 'installed', authentication: 'authenticated', capability: 'supported', overall: 'ready', blocker: null, version: '1' }, { provider: 'codex_cli', displayName: 'Codex', installation: 'installed', authentication: 'authenticated', capability: 'unsupported', overall: 'blocked', blocker: 'provider_capability_unsupported', version: '1' }] }), start: vi.fn().mockResolvedValue({ runId: 'run-1' }), getRun: vi.fn().mockResolvedValue({ status: 'succeeded', markdown: '# Aid', provider: 'claude_code', providerVersion: '1', sourceKind: 'abstract', level: 'explain_simply', outputLanguage: 'english', generatedAt: '2026-08-18T08:00:00Z' }), cancel: vi.fn() }
} }
let root: Root | undefined
function render(api = apis()) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); root.render(<App apis={api} />); return { host, api } }
afterEach(() => { root?.unmount(); root = undefined; document.body.innerHTML = ''; window.innerWidth = 1024; windowLifecycle.closeHandler = undefined; windowLifecycle.destroy.mockClear(); windowLifecycle.unlisten.mockClear(); vi.clearAllMocks() })
const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const button = (host: ParentNode, name: string) => [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name) as HTMLButtonElement
const input = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }
const chooseStudyContext = (dialog: ParentNode, value: string) => input(dialog.querySelector<HTMLSelectElement>('select[aria-label="Context"]')!, value)
const enterStudyRequest = (dialog: ParentNode, text = 'Explain this paper clearly') => input(dialog.querySelector<HTMLTextAreaElement>('textarea[aria-label="Study request"]')!, text)
async function readyStudyRequest(dialog: ParentNode, text = 'Explain this paper clearly') {
  enterStudyRequest(dialog, text)
  await vi.waitFor(() => expect(button(dialog, 'Send').disabled).toBe(false))
}
async function sendStudyRequest(dialog: ParentNode, text = 'Explain this paper clearly') {
  await readyStudyRequest(dialog, text)
  click(button(dialog, 'Send'))
}

describe('independent Vault and Study workspace', () => {
  it('shows an activity-specific empty workspace before any tab is opened', async () => {
    const { host } = render()
    const empty = await vi.waitFor(() => { const found = host.querySelector('.workspace-empty'); expect(found?.textContent).toContain('Open a paper Study'); return found! })
    expect(empty.textContent).not.toContain('Open a Vault document')
    expect(button(host, 'Library').title).toBe('Library · ⌘1')
    expect(button(host, 'Vault').title).toBe('Markdown Vault · ⌘2')
    click(button(host, 'Vault'))
    await vi.waitFor(() => expect(host.textContent).toContain('Open a Vault document'))
  })

  it('opens an editor-first document surface without document chrome', async () => {
    const { host, api } = render()
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const workspace = await vi.waitFor(() => {
      const found = host.querySelector('.document-workspace')
      expect(found?.querySelector('textarea[aria-label="Markdown document editor"]')).not.toBeNull()
      return found!
    })
    const editor = workspace.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown document editor"]')
    const title = workspace.querySelector<HTMLInputElement>('input[aria-label="Document title"]')
    expect(workspace.querySelectorAll('textarea')).toHaveLength(1)
    expect(workspace.querySelectorAll('input')).toHaveLength(1)
    expect(editor?.placeholder).toBe('Start writing in Markdown…')
    expect(title?.value).toBe('First')
    expect(title?.classList.contains('document-name-input')).toBe(true)
    expect(workspace.querySelector('[aria-label="Markdown formatting"]')).toBeNull()
    expect(button(workspace, 'Edit')).toBeUndefined()
    expect(button(workspace, 'Preview')).toBeUndefined()
    expect(workspace.querySelector('.editor-statusbar')).toBeNull()
    expect(workspace.textContent).not.toMatch(/No changes|Saved|Saving|Revision \d+|\d+ words?/)
    input(editor!, 'selected text')
    editor!.setSelectionRange(0, 8)
    editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }))
    await vi.waitFor(() => expect(editor!.value).toBe('**selected** text'))
    editor!.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledOnce())
    const liveStatus = workspace.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')
    await vi.waitFor(() => expect(liveStatus?.textContent).toBe('Saved'))
    expect(liveStatus?.classList.contains('visually-hidden')).toBe(true)
    expect(workspace.querySelector('.save-state')).toBeNull()
    expect(workspace.querySelector('.editor-statusbar')).toBeNull()
  })

  it('keeps mixed Study/document tabs open and switches activities with shortcuts', async () => {
    const { host } = render(); await vi.waitFor(() => expect(button(host, 'Vault')).toBeTruthy())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true, bubbles: true })); await vi.waitFor(() => expect(host.querySelector('[aria-label="Vault Explorer"]')).not.toBeNull())
    click(await vi.waitFor(() => { const item=host.querySelector('[data-document-id]'); expect(item).not.toBeNull(); return item! })); await vi.waitFor(() => expect(host.querySelector('textarea[aria-label="Markdown document editor"]')).not.toBeNull())
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true })); click(await vi.waitFor(() => { const item=host.querySelector('[data-paper-id]'); expect(item).not.toBeNull(); return item! }))
    await vi.waitFor(() => expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2))
    expect(host.textContent).toContain('Stored abstract.'); expect(host.textContent).toContain('Generate study aid')
  })

  it('makes the selected paper or document the explorer tab stop, using the first item only without selection', async () => {
    const secondPaper = { ...paper, arxivId: '2401.00001', title: 'Second paper' }
    const api = apis()
    vi.mocked(api.papers.listPapers).mockResolvedValue([paper, secondPaper])
    vi.mocked(api.papers.getPaper).mockImplementation(async (id) => id === secondPaper.arxivId ? secondPaper : paper)
    const { host } = render(api)

    const paperOptions = await vi.waitFor(() => {
      const found = [...host.querySelectorAll<HTMLButtonElement>('[data-paper-id]')]
      expect(found).toHaveLength(2)
      return found
    })
    expect(paperOptions.map((option) => option.tabIndex)).toEqual([0, -1])
    click(paperOptions[1]!)
    await vi.waitFor(() => {
      expect(paperOptions[1]!.getAttribute('aria-selected')).toBe('true')
      expect(paperOptions.map((option) => option.tabIndex)).toEqual([-1, 0])
    })

    click(button(host, 'Vault'))
    const documentOptions = await vi.waitFor(() => {
      const found = [...host.querySelectorAll<HTMLButtonElement>('[data-document-id]')]
      expect(found).toHaveLength(2)
      return found
    })
    expect(documentOptions.map((option) => option.tabIndex)).toEqual([0, -1])
    click(documentOptions[1]!)
    await vi.waitFor(() => {
      expect(documentOptions[1]!.getAttribute('aria-selected')).toBe('true')
      expect(documentOptions.map((option) => option.tabIndex)).toEqual([-1, 0])
    })
  })

  it('promotes the first visible explorer result when filtering hides the selected item', async () => {
    const secondPaper = { ...paper, arxivId: '2401.00001', title: 'Second paper' }
    const api = apis()
    vi.mocked(api.papers.listPapers).mockResolvedValue([paper, secondPaper])
    vi.mocked(api.papers.getPaper).mockImplementation(async (id) => id === secondPaper.arxivId ? secondPaper : paper)
    const { host } = render(api)

    const paperOptions = await vi.waitFor(() => {
      const found = [...host.querySelectorAll<HTMLButtonElement>('[data-paper-id]')]
      expect(found).toHaveLength(2)
      return found
    })
    click(paperOptions[1]!)
    await vi.waitFor(() => expect(paperOptions[1]!.getAttribute('aria-selected')).toBe('true'))
    const search = host.querySelector<HTMLInputElement>('input[aria-label="Quick search"], input[type="search"]')!
    input(search, 'Attention')
    await vi.waitFor(() => {
      const visible = [...host.querySelectorAll<HTMLButtonElement>('[data-paper-id]')]
      expect(visible).toHaveLength(1)
      expect(visible[0]!.dataset.paperId).toBe(paper.arxivId)
      expect(visible[0]!.tabIndex).toBe(0)
    })

    input(search, '')
    click(button(host, 'Vault'))
    const documentOptions = await vi.waitFor(() => {
      const found = [...host.querySelectorAll<HTMLButtonElement>('[data-document-id]')]
      expect(found).toHaveLength(2)
      return found
    })
    click(documentOptions[1]!)
    await vi.waitFor(() => expect(documentOptions[1]!.getAttribute('aria-selected')).toBe('true'))
    input(search, 'First')
    await vi.waitFor(() => {
      const visible = [...host.querySelectorAll<HTMLButtonElement>('[data-document-id]')]
      expect(visible).toHaveLength(1)
      expect(visible[0]!.dataset.documentId).toBe(docs[0]!.id)
      expect(visible[0]!.tabIndex).toBe(0)
    })
  })

  it('reconciles the roving tab stop when filtering hides the arrow-key target', async () => {
    const { host } = render()
    click(await vi.waitFor(() => {
      const found = button(host, 'Vault')
      expect(found).toBeTruthy()
      return found
    }))
    const options = await vi.waitFor(() => {
      const found = [...host.querySelectorAll<HTMLButtonElement>('[data-document-id]')]
      expect(found).toHaveLength(2)
      return found
    })
    options[0]!.focus()
    options[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await vi.waitFor(() => expect(options.map(option => option.tabIndex)).toEqual([-1, 0]))

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
    input(search, 'First')
    await vi.waitFor(() => {
      const visible = [...host.querySelectorAll<HTMLButtonElement>('[data-document-id]')]
      expect(visible).toHaveLength(1)
      expect(visible[0]!.dataset.documentId).toBe(docs[0]!.id)
      expect(visible.map(option => option.tabIndex)).toEqual([0])
    })
  })

  it('provides roving explorer and mixed-tab keyboard navigation', async () => {
    const { host } = render(); click(await vi.waitFor(() => { const found=button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    const options = await vi.waitFor(() => { const found=[...host.querySelectorAll<HTMLButtonElement>('[role="option"]')]; expect(found).toHaveLength(2); return found })
    options[0]!.focus(); options[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(options[1]); await vi.waitFor(() => { expect(options[1]!.tabIndex).toBe(0); expect(options[0]!.tabIndex).toBe(-1) })
    click(options[0]!); click(options[1]!)
    const tabs = await vi.waitFor(() => { const found=[...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; expect(found).toHaveLength(2); return found })
    tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[0]))
  })

  it('exposes tab close as a separate keyboard control and focuses the replacement tab', async () => {
    const { host }=render();click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-document-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);click(items[1]!)
    const close=await vi.waitFor(()=>{const found=button(host,'Close Second');expect(found).toBeTruthy();return found});expect(close.closest('button')===close).toBe(true);close.focus();close.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));click(close)
    const replacement=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>(`[data-tab-key="document:${docs[0]!.id}"]`);expect(found).not.toBeNull();expect(document.activeElement).toBe(found);return found!});expect(replacement.getAttribute('aria-selected')).toBe('true')
  })

  it('clears the editor draft after closing the final document tab', async () => {
    const {host}=render();click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));click(await vi.waitFor(()=>{const found=button(host,'Close First');expect(found).toBeTruthy();return found}));await vi.waitFor(()=>expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0));expect(host.querySelector('textarea')).toBeNull();expect(host.querySelector('.editor-context')).toBeNull()
  })

  it('focuses a failed document and its recovery control when tab close is blocked', async () => {
    const api=apis();vi.mocked(api.documents.update).mockRejectedValueOnce(new DocumentsApiError('document_conflict'));const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-document-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);const editor=await vi.waitFor(()=>{const found=host.querySelector<HTMLTextAreaElement>('textarea');expect(found).not.toBeNull();return found!});input(editor,'blocked');click(items[1]!);await vi.waitFor(()=>expect(host.querySelector(`[data-tab-key="document:${docs[1]!.id}"]`)?.getAttribute('aria-selected')).toBe('true'));click(button(host,'Close First'));await vi.waitFor(()=>expect(host.querySelector(`[data-tab-key="document:${docs[0]!.id}"]`)?.getAttribute('aria-selected')).toBe('true'));const recovery=button(host,'Retry');expect(document.activeElement).toBe(recovery);expect(button(host,'Reload as copy')).toBeTruthy()
  })

  it('preserves independent drafts and serializes saves per document while allowing other documents', async () => {
    const { host, api } = render(); click(await vi.waitFor(() => { const found=button(host, 'Vault'); expect(found).toBeTruthy(); return found })); const items = await vi.waitFor(() => { const found=[...host.querySelectorAll('[data-document-id]')]; expect(found).toHaveLength(2); return found }); click(items[0]!)
    const first = await vi.waitFor(() => { const found=host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement }); input(first, 'first draft'); click(items[1]!); const second = await vi.waitFor(() => { const found=host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); expect((found as HTMLTextAreaElement).value).toBe('two'); return found as HTMLTextAreaElement }); input(second, 'second draft')
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledTimes(2), { timeout: 1400 })
    click(host.querySelector('[data-tab-key="document:550e8400-e29b-41d4-a716-446655440000"]')!); await vi.waitFor(() => expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('first draft'))
  })

  it('keeps generation preview ephemeral, sends no source text, and saves artifact explicitly without document mutation', async () => {
    const { host, api } = render(); click(await vi.waitFor(() => { const item=host.querySelector('[data-paper-id]'); expect(item).not.toBeNull(); return item! })); click(await vi.waitFor(() => { const item=button(host, 'Generate study aid'); expect(item).toBeTruthy(); return item }))
    const dialog = await vi.waitFor(() => { const found=host.querySelector('[role="dialog"]'); expect(found).not.toBeNull(); return found! }); await sendStudyRequest(dialog)
    await vi.waitFor(() => expect(dialog.textContent).toContain('Preview'))
    expect(api.study.saveArtifact).not.toHaveBeenCalled(); expect(api.documents.update).not.toHaveBeenCalled(); expect(JSON.stringify(vi.mocked(api.generation.start).mock.calls[0]?.[0])).not.toContain('Stored abstract')
    click(button(dialog, 'Save artifact')); await vi.waitFor(() => expect(api.study.saveArtifact).toHaveBeenCalledWith({ paperId: paper.arxivId, runId: 'run-1' })); expect(api.documents.update).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('Add to note')
  })

  it('captures an exact document selection before switching to Study and offers it for generation', async () => {
    const {host,api}=render();click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));const editor=await vi.waitFor(()=>{const found=host.querySelector<HTMLTextAreaElement>('textarea');expect(found).not.toBeNull();return found!});input(editor,'a한글z');editor.setSelectionRange(1,3);click(button(host,'Library'));click(await vi.waitFor(()=>{const found=host.querySelector('[data-paper-id]');expect(found).not.toBeNull();return found!}));const trigger=await vi.waitFor(()=>{const found=button(host,'Generate study aid');expect(found).toBeTruthy();return found});click(trigger);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="Context"]')?.value).toBe(`selection:${docs[0]!.id}`);await sendStudyRequest(dialog);await vi.waitFor(()=>expect(api.generation.start).toHaveBeenCalledWith(expect.objectContaining({source:{kind:'document_selection',documentId:docs[0]!.id,expectedRevision:2,startUtf8:1,endUtf8:7}})));expect(api.generation.start).not.toHaveBeenCalledWith(expect.objectContaining({source:{kind:'document',documentId:docs[0]!.id,expectedRevision:2}}))
  })

  it('never falls back when a captured selection revision has changed', async () => {
    const generation=apis().generation;const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={[]} selection={{documentId:docs[1]!.id,revision:4,startUtf8:0,endUtf8:3}} generation={generation} study={apis().study} flushDocument={vi.fn().mockResolvedValue(5)} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);await vi.waitFor(()=>expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('revision changed'));expect(generation.start).not.toHaveBeenCalled()
  })

  it('restores focus to the generation trigger when the dialog closes', async () => {
    const {host}=render();click(await vi.waitFor(()=>{const item=host.querySelector('[data-paper-id]');expect(item).not.toBeNull();return item!}));const trigger=await vi.waitFor(()=>{const found=button(host,'Generate study aid');expect(found).toBeTruthy();return found});trigger.focus();click(trigger);const dialog=await vi.waitFor(()=>{const found=host.querySelector('[role="dialog"]');expect(found).not.toBeNull();return found!});click(button(dialog,'Close'));await vi.waitFor(()=>expect(document.activeElement).toBe(trigger))
  })

  it('blocks every global workspace shortcut while a generation modal is open', async () => {
    const {host,api}=render();click(await vi.waitFor(()=>{const item=host.querySelector('[data-paper-id]');expect(item).not.toBeNull();return item!}));const trigger=await vi.waitFor(()=>{const found=button(host,'Generate study aid');expect(found).toBeTruthy();return found});click(trigger);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});const close=button(dialog,'Close');close.focus()
    for(const key of ['1','2','n','k','s']) document.dispatchEvent(new KeyboardEvent('keydown',{key,metaKey:true,bubbles:true}))
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'T',metaKey:true,shiftKey:true,bubbles:true}))
    await new Promise(resolve=>window.setTimeout(resolve,0))
    expect(api.documents.create).not.toHaveBeenCalled();expect(api.documents.update).not.toHaveBeenCalled();expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);expect(host.querySelector('[aria-label="Library Explorer"]')).not.toBeNull();expect(document.activeElement).toBe(close)
  })

  it('restores the arXiv Fetch trigger for every close path and blocks shortcuts behind the modal', async () => {
    const {host,api}=render();const trigger=await vi.waitFor(()=>{const found=button(host,'Fetch from arXiv');expect(found).toBeTruthy();return found});trigger.focus();click(trigger);await vi.waitFor(()=>expect(host.querySelector('[role="dialog"]')).not.toBeNull())
    for(const key of ['2','n','k']) document.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'T',ctrlKey:true,shiftKey:true,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await vi.waitFor(()=>expect(document.activeElement).toBe(trigger));expect(api.documents.create).not.toHaveBeenCalled();expect(host.querySelector('[aria-label="Library Explorer"]')).not.toBeNull()
    click(trigger);click(await vi.waitFor(()=>{const found=button(host,'Close arXiv fetch dialog');expect(found).toBeTruthy();return found}));await vi.waitFor(()=>expect(document.activeElement).toBe(trigger))
    click(trigger);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});input(dialog.querySelector<HTMLInputElement>('[aria-label="arXiv URL or ID"]')!,'1706.03762');click(button(dialog,'Fetch paper'));click(await vi.waitFor(()=>{const found=button(dialog,'Open paper');expect(found).toBeTruthy();return found}));await vi.waitFor(()=>{expect(host.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger)})
  })

  it('contains focus and focuses meaningful content through generation transitions', async () => {
    let resolveRun: ((value: GenerationRun) => void) | undefined
    const api = apis()
    vi.mocked(api.generation.getRun).mockReturnValueOnce(new Promise((resolve) => { resolveRun = resolve }))
    const { host } = render(api)
    click(await vi.waitFor(() => { const item=host.querySelector('[data-paper-id]'); expect(item).not.toBeNull(); return item! }))
    click(await vi.waitFor(() => { const found=button(host,'Generate study aid'); expect(found).toBeTruthy(); return found }))
    const dialog = await vi.waitFor(() => { const found=host.querySelector<HTMLElement>('[role="dialog"]'); expect(found).not.toBeNull(); return found! })
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(host.querySelector('main')?.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('nav')?.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('.skip-link')?.hasAttribute('inert')).toBe(true)
    await sendStudyRequest(dialog)
    const runningStatus = await vi.waitFor(() => { const found=dialog.querySelector<HTMLElement>('[data-generation-focus="running"]'); expect(found).not.toBeNull(); expect(document.activeElement).toBe(found); return found! })
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Tab', bubbles:true }))
    expect(dialog.contains(document.activeElement)).toBe(true)
    resolveRun?.({ status:'succeeded', markdown:'# Aid', paperId:paper.arxivId, provider:'claude_code', providerVersion:'1', sourceKind:'abstract', sourceDocumentId:null, sourceRevision:null, selectionStartUtf8:null, selectionEndUtf8:null, level:'explain_simply', outputLanguage:'english', generatedAt:'2026-08-18T08:00:00Z' })
    const preview = await vi.waitFor(() => { const found=dialog.querySelector<HTMLElement>('[data-generation-focus="succeeded"]'); expect(found).not.toBeNull(); expect(document.activeElement).toBe(found); return found! })
    expect(preview.textContent).toBe('Preview')
    click(button(dialog, 'Save artifact'))
    const saved = await vi.waitFor(() => { const found=dialog.querySelector<HTMLElement>('[data-generation-focus="saved"]'); expect(found).not.toBeNull(); expect(document.activeElement).toBe(found); return found! })
    expect(saved.textContent).toContain('Artifact saved')
    expect(runningStatus.isConnected).toBe(false)
  })

  it('disables artifact saving while pending and prevents duplicate persistence', async () => {
    const api = apis(); vi.mocked(api.study.saveArtifact).mockReturnValue(new Promise(() => undefined))
    const { host } = render(api); click(await vi.waitFor(() => { const item=host.querySelector('[data-paper-id]'); expect(item).not.toBeNull(); return item! })); click(await vi.waitFor(() => { const found=button(host, 'Generate study aid'); expect(found).toBeTruthy(); return found }))
    const dialog = await vi.waitFor(() => { const found=host.querySelector('[role="dialog"]'); expect(found).not.toBeNull(); return found! }); await sendStudyRequest(dialog)
    const save = await vi.waitFor(() => { const found=button(dialog, 'Save artifact'); expect(found).toBeTruthy(); return found }); const preview=dialog.querySelector('[data-generation-focus="succeeded"]');click(save)
    await vi.waitFor(() => { expect(button(dialog, 'Save artifact').disabled).toBe(true); expect(document.activeElement).toBe(preview) }); click(button(dialog, 'Save artifact'))
    expect(api.study.saveArtifact).toHaveBeenCalledTimes(1)
  })

  it('uses a request-only generation contract without legacy Task or Output language controls', async () => {
    const generation=apis().generation;const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={[]} selection={null} generation={generation} study={apis().study} flushDocument={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(0);expect([...dialog.querySelectorAll('label')].some(label=>label.textContent?.includes('Task'))).toBe(false);expect([...dialog.querySelectorAll('label')].some(label=>label.textContent?.includes('Output language'))).toBe(false);const agent=dialog.querySelector<HTMLSelectElement>('select[aria-label="Agent"]');expect(agent).not.toBeNull();expect(agent?.value).toBe('claude_code');expect(agent?.querySelector<HTMLOptionElement>('option[value="codex_cli"]')?.disabled).toBe(true);await sendStudyRequest(dialog,'한국어로 핵심을 설명해 주세요.');await vi.waitFor(()=>expect(generation.start).toHaveBeenCalledOnce());const startInput=vi.mocked(generation.start).mock.calls[0]![0];expect(startInput).toMatchObject({request:'한국어로 핵심을 설명해 주세요.'});expect(startInput).not.toHaveProperty('level');expect(startInput).not.toHaveProperty('outputLanguage')
  })

  it('starts generation synchronously so repeated Send activation flushes and starts only once', async () => {
    let resolveFlush: ((value:number|null)=>void)|undefined;const flush=vi.fn().mockReturnValue(new Promise<number|null>(resolve=>{resolveFlush=resolve}));const generation=apis().generation;const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={docs.map(({id,title,revision,updatedAt})=>({id,title,revision,updatedAt}))} selection={null} generation={generation} study={apis().study} flushDocument={flush} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});chooseStudyContext(dialog,`document:${docs[0]!.id}`);await readyStudyRequest(dialog);const send=button(dialog,'Send');click(send);click(send);expect(flush).toHaveBeenCalledTimes(1);resolveFlush?.(2);await vi.waitFor(()=>expect(generation.start).toHaveBeenCalledTimes(1))
  })

  it('cancels a pending source flush without starting generation after the flush resolves', async () => {
    let resolveFlush: ((value:number|null)=>void)|undefined;const flush=vi.fn().mockReturnValue(new Promise<number|null>(resolve=>{resolveFlush=resolve}));const generation=apis().generation;const onClose=vi.fn();const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={docs.map(({id,title,revision,updatedAt})=>({id,title,revision,updatedAt}))} selection={null} generation={generation} study={apis().study} flushDocument={flush} onSaved={vi.fn()} onClose={onClose}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});chooseStudyContext(dialog, `document:${docs[0]!.id}`);await sendStudyRequest(dialog);const cancel=await vi.waitFor(()=>{const found=button(dialog,'Cancel preparation');expect(found).toBeTruthy();return found});click(cancel);expect(onClose).toHaveBeenCalledTimes(1);resolveFlush?.(2);await new Promise(resolve=>window.setTimeout(resolve,0));expect(generation.start).not.toHaveBeenCalled();expect(generation.cancel).not.toHaveBeenCalled()
  })

  it('keeps a pending start mounted, cancels its late exact run, and observes the terminal state', async () => {
    let resolveStart: ((value:{runId:string})=>void)|undefined;const generation=apis().generation;vi.mocked(generation.start).mockReturnValue(new Promise(resolve=>{resolveStart=resolve}));vi.mocked(generation.getRun).mockResolvedValue({status:'cancelled'});const onClose=vi.fn();const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={[]} selection={null} generation={generation} study={apis().study} flushDocument={vi.fn()} onSaved={vi.fn()} onClose={onClose}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);const starting=await vi.waitFor(()=>{const found=dialog.querySelector<HTMLElement>('[data-generation-focus="starting"]');expect(found?.textContent).toBe('Starting generation…');expect(document.activeElement).toBe(found);return found!});expect(starting.isConnected).toBe(true);click(button(dialog,'Cancel start'));expect(onClose).not.toHaveBeenCalled();expect(dialog.isConnected).toBe(true);resolveStart?.({runId:'late-run'});await vi.waitFor(()=>expect(generation.cancel).toHaveBeenCalledWith('late-run'));await vi.waitFor(()=>expect(generation.getRun).toHaveBeenCalledWith('late-run'));await vi.waitFor(()=>expect(dialog.textContent).toContain('Generation was cancelled.'))
  })

  it('cancels a late start after unmount without polling it', async () => {
    let resolveStart:((value:{runId:string})=>void)|undefined;const generation=apis().generation;vi.mocked(generation.start).mockReturnValue(new Promise(resolve=>{resolveStart=resolve}));const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={[]} selection={null} generation={generation} study={apis().study} flushDocument={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);await vi.waitFor(()=>expect(dialog.querySelector('[data-generation-focus="starting"]')).not.toBeNull());root.unmount();root=undefined;resolveStart?.({runId:'unmounted-run'});await vi.waitFor(()=>expect(generation.cancel).toHaveBeenCalledWith('unmounted-run'));expect(generation.getRun).not.toHaveBeenCalled()
  })

  it('clears scheduled polling when generation unmounts', async () => {
    const generation=apis().generation;vi.mocked(generation.getRun).mockResolvedValue({status:'running'});const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={[]} selection={null} generation={generation} study={apis().study} flushDocument={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);await vi.waitFor(()=>expect(generation.getRun).toHaveBeenCalledOnce());root.unmount();root=undefined;await new Promise(resolve=>window.setTimeout(resolve,150));expect(generation.getRun).toHaveBeenCalledOnce()
  })

  it('recovers to configurable generation with focused guidance when source flush fails', async () => {
    const flush=vi.fn().mockResolvedValue(null);const generation=apis().generation;const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={docs.map(({id,title,revision,updatedAt})=>({id,title,revision,updatedAt}))} selection={null} generation={generation} study={apis().study} flushDocument={flush} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});chooseStudyContext(dialog, `document:${docs[0]!.id}`);await sendStudyRequest(dialog);const alert=await vi.waitFor(()=>{const found=dialog.querySelector<HTMLElement>('[role="alert"]');expect(found?.textContent).toContain('Save the selected document');return found!});expect(button(dialog,'Send').disabled).toBe(false);expect(document.activeElement).toBe(alert);expect(generation.start).not.toHaveBeenCalled()
  })

  it('guards repeated running cancellation and visibly recovers from cancel errors', async () => {
    let rejectCancel: ((reason:unknown)=>void)|undefined;const api=apis();vi.mocked(api.generation.getRun).mockReturnValue(new Promise(()=>undefined));vi.mocked(api.generation.cancel).mockReturnValue(new Promise((_,reject)=>{rejectCancel=reject}));const {host}=render(api);click(await vi.waitFor(()=>{const item=host.querySelector('[data-paper-id]');expect(item).not.toBeNull();return item!}));const trigger=await vi.waitFor(()=>{const found=button(host,'Generate study aid');expect(found).toBeTruthy();return found});click(trigger);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);const cancel=await vi.waitFor(()=>{const found=button(dialog,'Cancel run');expect(found).toBeTruthy();return found});click(cancel);click(cancel);expect(api.generation.cancel).toHaveBeenCalledTimes(1);expect(api.generation.cancel).toHaveBeenCalledWith('run-1');rejectCancel?.(new GenerationApiError('provider_termination_failed'));const alert=await vi.waitFor(()=>{const found=dialog.querySelector<HTMLElement>('[role="alert"]');expect(found?.textContent).toContain('Cancellation could not be requested');return found!});expect(alert.textContent).toContain('could not be stopped safely');expect(button(dialog,'Cancel run').disabled).toBe(false)
  })

  it('renders terminal backend cancellation as an explicit cancelled state', async () => {
    const generation=apis().generation;vi.mocked(generation.getRun).mockResolvedValue({status:'cancelled'});const host=document.createElement('div');document.body.append(host);root=createRoot(host);root.render(<StudyGenerationDialog paperId={paper.arxivId} documents={[]} selection={null} generation={generation} study={apis().study} flushDocument={vi.fn()} onSaved={vi.fn()} onClose={vi.fn()}/>);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);const cancelled=await vi.waitFor(()=>{const found=dialog.querySelector<HTMLElement>('[data-generation-focus="cancelled"]');expect(found?.textContent).toBe('Generation cancelled');expect(document.activeElement).toBe(found);return found!});expect(cancelled.textContent).not.toContain('failed');expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Generation was cancelled.')
  })

  it('surfaces an ambiguous artifact save failure and retries the same run idempotency key', async () => {
    const api=apis();vi.mocked(api.study.saveArtifact).mockRejectedValueOnce(new StudyApiError('internal_unavailable')).mockResolvedValueOnce(null as never);const {host}=render(api);click(await vi.waitFor(()=>{const item=host.querySelector('[data-paper-id]');expect(item).not.toBeNull();return item!}));click(await vi.waitFor(()=>{const found=button(host,'Generate study aid');expect(found).toBeTruthy();return found}));const dialog=await vi.waitFor(()=>{const found=host.querySelector('[role="dialog"]');expect(found).not.toBeNull();return found!});await sendStudyRequest(dialog);click(await vi.waitFor(()=>{const found=button(dialog,'Save artifact');expect(found).toBeTruthy();return found}));await vi.waitFor(()=>expect(dialog.textContent).toContain('Artifact could not be saved: internal unavailable. Retrying is safe.'));const retry=button(dialog,'Retry save artifact');expect(retry.disabled).toBe(false);click(retry);await vi.waitFor(()=>expect(api.study.saveArtifact).toHaveBeenCalledTimes(2));expect(vi.mocked(api.study.saveArtifact).mock.calls).toEqual([[{paperId:paper.arxivId,runId:'run-1'}],[{paperId:paper.arxivId,runId:'run-1'}]])
  })

  it('keeps the latest document open intent when an earlier load resolves last', async () => {
    let resolveFirst: ((value: typeof docs[number]) => void)|undefined;let resolveSecond: ((value: typeof docs[number]) => void)|undefined;const api=apis();vi.mocked(api.documents.get).mockImplementation(id=>new Promise(resolve=>{if(id===docs[0]!.id)resolveFirst=resolve;else resolveSecond=resolve}));const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-document-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);click(items[1]!);resolveSecond?.(docs[1]!);await vi.waitFor(()=>expect(host.querySelector(`[data-tab-key="document:${docs[1]!.id}"]`)?.getAttribute('aria-selected')).toBe('true'));resolveFirst?.(docs[0]!);await new Promise(resolve=>window.setTimeout(resolve,0));expect(host.querySelector(`[data-tab-key="document:${docs[1]!.id}"]`)?.getAttribute('aria-selected')).toBe('true');expect(host.querySelector(`[data-tab-key="document:${docs[0]!.id}"]`)?.getAttribute('aria-selected')).not.toBe('true')
  })

  it('keeps the latest Study open intent when an earlier load resolves last', async () => {
    const later={...paper,arxivId:'2401.00001',title:'Later paper'};let resolveFirst: ((value: typeof paper)=>void)|undefined;let resolveSecond: ((value: typeof paper)=>void)|undefined;const api=apis();vi.mocked(api.papers.listPapers).mockResolvedValue([paper,later]);vi.mocked(api.papers.getPaper).mockImplementation(id=>new Promise(resolve=>{if(id===paper.arxivId)resolveFirst=resolve;else resolveSecond=resolve}));const {host}=render(api);const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-paper-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);click(items[1]!);resolveSecond?.(later);await vi.waitFor(()=>expect(host.querySelector(`[data-tab-key="study:${later.arxivId}"]`)?.getAttribute('aria-selected')).toBe('true'));resolveFirst?.(paper);await new Promise(resolve=>window.setTimeout(resolve,0));expect(host.querySelector(`[data-tab-key="study:${later.arxivId}"]`)?.getAttribute('aria-selected')).toBe('true');expect(host.querySelector(`[data-tab-key="study:${paper.arxivId}"]`)?.getAttribute('aria-selected')).not.toBe('true')
  })

  it('ignores a late properties response for a previously active document', async () => {
    let resolveFirst: ((value: Awaited<ReturnType<WorkspaceApis['documents']['getProperties']>>) => void) | undefined
    const api = apis()
    vi.mocked(api.documents.getProperties)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ documentId: docs[1]!.id, papers: [{ arxivId: paper.arxivId, title: 'Second properties', createdAt: paper.importedAt }], artifacts: [] })
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    const items = await vi.waitFor(() => { const found = [...host.querySelectorAll('[data-document-id]')]; expect(found).toHaveLength(2); return found })
    click(items[0]!); await vi.waitFor(() => expect(api.documents.getProperties).toHaveBeenCalledWith(docs[0]!.id))
    click(items[1]!); await vi.waitFor(() => expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Second properties'))
    resolveFirst?.({ documentId: docs[0]!.id, papers: [{ arxivId: paper.arxivId, title: 'Stale properties', createdAt: paper.importedAt }], artifacts: [] })
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Second properties')
    expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).not.toContain('Stale properties')
  })

  it('unlinks using the document identity that owns the rendered properties', async () => {
    const api = apis()
    vi.mocked(api.documents.getProperties)
      .mockResolvedValueOnce({ documentId: docs[0]!.id, papers: [{ arxivId: paper.arxivId, title: paper.title, createdAt: paper.importedAt }], artifacts: [] })
      .mockReturnValueOnce(new Promise(() => undefined))
    const { host } = render(api); click(await vi.waitFor(() => { const found=button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    const items = await vi.waitFor(() => { const found=[...host.querySelectorAll('[data-document-id]')]; expect(found).toHaveLength(2); return found })
    click(items[0]!); const unlink = await vi.waitFor(() => { const found=button(host, 'Unlink paper'); expect(found).toBeTruthy(); return found })
    click(items[1]!); await vi.waitFor(() => expect(host.querySelector(`[data-tab-key="document:${docs[1]!.id}"]`)?.getAttribute('aria-selected')).toBe('true')); click(unlink)
    await vi.waitFor(() => expect(api.documents.unlinkPaper).toHaveBeenCalledWith({ documentId: docs[0]!.id, paperId: paper.arxivId }))
  })

  it('ignores a late post-link properties refresh after the active document changes', async () => {
    let resolveRefresh: ((value: DocumentProperties) => void) | undefined
    const api=apis();vi.mocked(api.documents.getProperties).mockResolvedValueOnce({documentId:docs[0]!.id,papers:[],artifacts:[]}).mockReturnValueOnce(new Promise(resolve=>{resolveRefresh=resolve})).mockResolvedValueOnce({documentId:docs[1]!.id,papers:[{arxivId:paper.arxivId,title:'Current second properties',createdAt:paper.importedAt}],artifacts:[]})
    const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-document-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);const select=await vi.waitFor(()=>{const found=host.querySelector<HTMLSelectElement>('.panel-content select');expect(found).not.toBeNull();return found!});input(select,paper.arxivId);click(button(host,'Link paper'));await vi.waitFor(()=>expect(api.documents.getProperties).toHaveBeenCalledTimes(2));click(items[1]!);await vi.waitFor(()=>expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Current second properties'));resolveRefresh?.({documentId:docs[0]!.id,papers:[{arxivId:paper.arxivId,title:'Stale linked properties',createdAt:paper.importedAt}],artifacts:[]});await new Promise(resolve=>window.setTimeout(resolve,0));expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Current second properties');expect(host.textContent).not.toContain('Stale linked properties')
  })

  it('ignores a late post-unlink properties refresh after the active document changes', async () => {
    let resolveRefresh: ((value: DocumentProperties) => void) | undefined
    const linkedArtifact={artifactId:'artifact-1',paperArxivId:paper.arxivId,level:'explain_simply' as const,createdAt:paper.importedAt}
    const api=apis();vi.mocked(api.documents.getProperties).mockResolvedValueOnce({documentId:docs[0]!.id,papers:[],artifacts:[linkedArtifact]}).mockReturnValueOnce(new Promise(resolve=>{resolveRefresh=resolve})).mockResolvedValueOnce({documentId:docs[1]!.id,papers:[{arxivId:paper.arxivId,title:'Current second properties',createdAt:paper.importedAt}],artifacts:[]})
    const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-document-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);click(await vi.waitFor(()=>{const found=button(host,'Unlink artifact');expect(found).toBeTruthy();return found}));await vi.waitFor(()=>expect(api.documents.getProperties).toHaveBeenCalledTimes(2));click(items[1]!);await vi.waitFor(()=>expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Current second properties'));resolveRefresh?.({documentId:docs[0]!.id,papers:[],artifacts:[]});await new Promise(resolve=>window.setTimeout(resolve,0));expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Current second properties')
  })

  it('renders backlinks only from stored edges and offers explicit link controls', async () => {
    const api = apis(); vi.mocked(api.documents.getProperties).mockResolvedValue({ documentId: docs[0]!.id, papers: [{ arxivId: paper.arxivId, title: paper.title, createdAt: paper.importedAt }], artifacts: [] })
    const { host } = render(api); click(await vi.waitFor(() => { const found=button(host, 'Vault'); expect(found).toBeTruthy(); return found })); click((await vi.waitFor(() => { const item=host.querySelector('[data-document-id]'); expect(item).not.toBeNull(); return item! })))
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('Attention'))
    expect(host.textContent).not.toContain('Link to an evidence section'); expect(button(host, 'Unlink paper')).toBeTruthy()
  })

  it('closes confirmed deletion and focuses recovery when the pre-delete flush conflicts', async () => {
    const api=apis();vi.mocked(api.documents.update).mockRejectedValueOnce(new DocumentsApiError('document_conflict'));const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));const editor=await vi.waitFor(()=>{const found=host.querySelector<HTMLTextAreaElement>('textarea');expect(found).not.toBeNull();return found!});input(editor,'cannot delete yet');click(await vi.waitFor(()=>{const found=button(host,'Delete document');expect(found).toBeTruthy();return found}));const dialog=await vi.waitFor(()=>{const found=host.querySelector('[role="alertdialog"]');expect(found).not.toBeNull();return found!});click(button(dialog,'Delete permanently'));await vi.waitFor(()=>expect(host.querySelector('[role="alertdialog"]')).toBeNull());expect(api.documents.delete).not.toHaveBeenCalled();expect(host.querySelector(`[data-tab-key="document:${docs[0]!.id}"]`)?.getAttribute('aria-selected')).toBe('true');await vi.waitFor(()=>expect(host.textContent).toContain('Deletion blocked: save this document before deleting it'));expect(document.activeElement).toBe(button(host,'Retry'))
  })

  it('requires an explicit focus-managed confirmation before permanent deletion', async () => {
    const { host, api } = render(); click(await vi.waitFor(() => { const found=button(host, 'Vault'); expect(found).toBeTruthy(); return found })); click(await vi.waitFor(() => { const found=host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const trigger = await vi.waitFor(() => { const found=button(host, 'Delete document'); expect(found).toBeTruthy(); return found })
    trigger.focus(); click(trigger)
    const dialog = await vi.waitFor(() => { const found=host.querySelector('[role="alertdialog"]'); expect(found).not.toBeNull(); return found! })
    const cancel = button(dialog, 'Cancel'); await vi.waitFor(() => expect(document.activeElement).toBe(cancel)); click(cancel)
    expect(api.documents.delete).not.toHaveBeenCalled(); await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
    click(trigger); const reopened = await vi.waitFor(() => { const found=host.querySelector('[role="alertdialog"]'); expect(found).not.toBeNull(); return found! }); click(button(reopened, 'Delete permanently'))
    await vi.waitFor(() => expect(api.documents.delete).toHaveBeenCalledWith({ documentId: docs[0]!.id }))
    await vi.waitFor(() => expect(host.querySelector(`[data-tab-key="document:${docs[0]!.id}"]`)).toBeNull()); expect(host.querySelector('textarea')).toBeNull(); await vi.waitFor(() => expect(document.activeElement).toBe(button(host,'New document')))
  })

  it('disables permanent deletion synchronously and sends only one request for repeated activation', async () => {
    const api=apis();vi.mocked(api.documents.delete).mockReturnValue(new Promise(()=>undefined));const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));click(await vi.waitFor(()=>{const found=button(host,'Delete document');expect(found).toBeTruthy();return found}));const dialog=await vi.waitFor(()=>{const found=host.querySelector('[role="alertdialog"]');expect(found).not.toBeNull();return found!});const confirm=button(dialog,'Delete permanently');click(confirm);click(confirm);await vi.waitFor(()=>expect(confirm.disabled).toBe(true));expect(api.documents.delete).toHaveBeenCalledTimes(1)
  })

  it('focuses the busy delete status and contains a zero-control focus trap while pending', async () => {
    const api=apis();vi.mocked(api.documents.delete).mockReturnValue(new Promise(()=>undefined));const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));click(await vi.waitFor(()=>{const found=button(host,'Delete document');expect(found).toBeTruthy();return found}));const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="alertdialog"]');expect(found).not.toBeNull();return found!});click(button(dialog,'Delete permanently'));const busy=await vi.waitFor(()=>{const found=dialog.querySelector<HTMLElement>('[data-delete-busy]');expect(found?.textContent).toBe('Deleting document…');expect(document.activeElement).toBe(found);return found!});for(const shiftKey of [false,true]){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey,bubbles:true}));expect(document.activeElement).toBe(busy);expect(dialog.contains(document.activeElement)).toBe(true)}
  })

  it('keeps a failed permanent deletion open with a focused error and safe retry', async () => {
    const api=apis();vi.mocked(api.documents.delete).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);const {host}=render(api);click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));const trigger=await vi.waitFor(()=>{const found=button(host,'Delete document');expect(found).toBeTruthy();return found});click(trigger);const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="alertdialog"]');expect(found).not.toBeNull();return found!});click(button(dialog,'Delete permanently'));const error=await vi.waitFor(()=>{const found=dialog.querySelector<HTMLElement>('[role="alert"]');expect(found?.textContent).toContain('could not be deleted');expect(document.activeElement).toBe(found);return found!});expect(error.isConnected).toBe(true);click(button(dialog,'Retry delete'));await vi.waitFor(()=>expect(api.documents.delete).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(host.querySelector('[role="alertdialog"]')).toBeNull())
  })

  it('closes the compact inspector and restores visible focus after deleting the final document tab', async () => {
    window.innerWidth=720;const {host,api}=render();click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const inspectorToggle=button(host,'Properties and backlinks drawer');click(inspectorToggle);click(await vi.waitFor(()=>{const found=button(host,'Delete document');expect(found).toBeTruthy();return found}));const dialog=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>('[role="alertdialog"]');expect(found).not.toBeNull();return found!});for(const key of ['1','2','n','k','s'])document.dispatchEvent(new KeyboardEvent('keydown',{key,metaKey:true,bubbles:true}));click(button(dialog,'Delete permanently'))
    await vi.waitFor(()=>{expect(host.querySelector('[role="alertdialog"]')).toBeNull();expect(host.querySelector('[data-drawer-scrim]')).toBeNull();expect((host.querySelector('[aria-label="Properties and backlinks"]') as HTMLElement).hidden).toBe(true);expect(document.activeElement).toBe(inspectorToggle)});expect(api.documents.create).not.toHaveBeenCalled();expect(document.activeElement?.closest('[inert], [hidden]')).toBeNull()
  })

  it('closes the compact inspector and focuses the replacement tab after deletion', async () => {
    window.innerWidth=720;const {host}=render();click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));const items=await vi.waitFor(()=>{const found=[...host.querySelectorAll('[data-document-id]')];expect(found).toHaveLength(2);return found});click(items[0]!);click(items[1]!);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));click(button(host,'Properties and backlinks drawer'));click(await vi.waitFor(()=>{const found=button(host,'Delete document');expect(found).toBeTruthy();return found}));const dialog=await vi.waitFor(()=>{const found=host.querySelector('[role="alertdialog"]');expect(found).not.toBeNull();return found!});click(button(dialog,'Delete permanently'))
    const replacement=await vi.waitFor(()=>{const found=host.querySelector<HTMLElement>(`[data-tab-key="document:${docs[0]!.id}"]`);expect(host.querySelector('[data-drawer-scrim]')).toBeNull();expect(document.activeElement).toBe(found);return found!});expect(replacement.getAttribute('aria-selected')).toBe('true');expect(document.activeElement?.closest('[inert], [hidden]')).toBeNull()
  })

  it('advances the saved revision before serializing a newer draft for the same document', async () => {
    let resolveFirst: ((value: typeof docs[number]) => void) | undefined
    const firstSave = new Promise<typeof docs[number]>((resolve) => { resolveFirst = resolve })
    const api = apis()
    vi.mocked(api.documents.update)
      .mockReturnValueOnce(firstSave)
      .mockImplementationOnce(async (value) => ({ ...docs[0]!, ...value, id: value.documentId, revision: value.expectedRevision + 1, updatedAt: '2026-08-18T08:00:00Z' }))
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    input(editor, 'first save')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledTimes(1))
    input(editor, 'newer draft')
    resolveFirst?.({ ...docs[0]!, markdown: 'first save', revision: 2, updatedAt: '2026-08-18T07:00:00Z' })
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledTimes(2), { timeout: 1_400 })
    expect(vi.mocked(api.documents.update).mock.calls[1]?.[0]).toMatchObject({ expectedRevision: 2, markdown: 'newer draft' })
  })

  it('propagates saved title and revision to the tab and Vault explorer', async () => {
    const {host}=render();click(await vi.waitFor(()=>{const found=button(host,'Vault');expect(found).toBeTruthy();return found}));click(await vi.waitFor(()=>{const found=host.querySelector('[data-document-id]');expect(found).not.toBeNull();return found!}));const title=await vi.waitFor(()=>{const found=host.querySelector<HTMLInputElement>('[aria-label="Document title"]');expect(found).not.toBeNull();return found!});input(title,'Renamed');title.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true}));const editor=host.querySelector<HTMLTextAreaElement>('textarea')!;editor.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,bubbles:true}));await vi.waitFor(()=>expect(host.querySelector(`[data-tab-key="document:${docs[0]!.id}"]`)?.textContent).toContain('Renamed'));expect(host.querySelector(`[data-document-id="${docs[0]!.id}"]`)?.textContent).toContain('Revision 2')
  })

  it('retains a conflicted draft and can reload it as an independent copy', async () => {
    const api = apis()
    vi.mocked(api.documents.update).mockRejectedValueOnce(new DocumentsApiError('document_conflict'))
    vi.mocked(api.documents.create).mockResolvedValueOnce({ ...docs[0]!, id: '550e8400-e29b-41d4-a716-446655440099', title: 'First (conflicted copy)', markdown: 'keep this draft' })
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    input(editor, 'keep this draft')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    const copy = await vi.waitFor(() => { const found = button(host, 'Reload as copy'); expect(found).toBeTruthy(); return found })
    expect(editor.value).toBe('keep this draft')
    click(copy)
    await vi.waitFor(() => expect(api.documents.create).toHaveBeenCalledWith({ title: 'First (conflicted copy)', markdown: 'keep this draft' }))
  })

  it('blocks autosave and close during IME composition, then saves after composition ends', async () => {
    const api = apis(); const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    input(editor, '조합 중')
    await new Promise((resolve) => window.setTimeout(resolve, 700))
    expect(api.documents.update).not.toHaveBeenCalled()
    click(host.querySelector('[aria-label^="Close "]')!)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1)
    editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledWith(expect.objectContaining({ markdown: '조합 중' })), { timeout: 1_400 })
  })

  it('shows Study backlinks from stored edges rather than scanning Markdown', async () => {
    const api = apis()
    vi.mocked(api.study.get).mockResolvedValue({ paperId: paper.arxivId, createdAt: paper.importedAt, updatedAt: paper.importedAt, backlinks: [{ documentId: docs[0]!.id, title: 'First', createdAt: paper.importedAt }] })
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = host.querySelector('[data-paper-id]'); expect(found).not.toBeNull(); return found! }))
    await vi.waitFor(() => expect(api.study.get).toHaveBeenCalledWith(paper.arxivId))
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Properties and backlinks"]')?.textContent).toContain('First'))
  })

  it('reports compact Library and Vault expansion only for the active explorer drawer', async () => {
    window.innerWidth = 720
    const { host } = render()
    const library = await vi.waitFor(() => { const found = button(host, 'Library'); expect(found).toBeTruthy(); return found })
    const vault = button(host, 'Vault')

    expect(library.getAttribute('aria-expanded')).toBe('false')
    expect(vault.getAttribute('aria-expanded')).toBe('false')
    click(vault)
    await vi.waitFor(() => {
      expect(vault.getAttribute('aria-current')).toBe('page')
      expect(vault.getAttribute('aria-expanded')).toBe('true')
      expect(library.getAttribute('aria-expanded')).toBe('false')
    })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    click(library)
    await vi.waitFor(() => {
      expect(library.getAttribute('aria-current')).toBe('page')
      expect(library.getAttribute('aria-expanded')).toBe('true')
      expect(vault.getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('uses mutually exclusive compact modal drawers with scrim, focus containment, and restoration', async () => {
    window.innerWidth = 720
    const { host, api } = render()
    const vault = await vi.waitFor(() => { const found=button(host, 'Vault'); expect(found).toBeTruthy(); return found })
    const explorer = host.querySelector('[aria-label="Library Explorer"]') as HTMLElement
    const inspector = host.querySelector('[aria-label="Properties and backlinks"]') as HTMLElement
    expect(explorer.hidden).toBe(true); expect(inspector.hidden).toBe(true)
    expect(explorer.style.display).toBe('none'); expect(inspector.style.display).toBe('none')
    click(vault)
    await vi.waitFor(() => { expect(explorer.hidden).toBe(false); expect(explorer.getAttribute('role')).toBe('dialog'); expect(explorer.getAttribute('aria-modal')).toBe('true'); expect(explorer.getAttribute('aria-labelledby')).toBe('explorer-drawer-title'); expect(explorer.contains(document.activeElement)).toBe(true) })
    expect(host.querySelector('[data-drawer-scrim]')).not.toBeNull()
    expect(host.querySelector('main')?.hasAttribute('inert')).toBe(true)
    expect(inspector.hasAttribute('inert')).toBe(true)
    for(const key of ['1','2','n','k','s'])document.dispatchEvent(new KeyboardEvent('keydown',{key,metaKey:true,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'T',metaKey:true,shiftKey:true,bubbles:true}));expect(api.documents.create).not.toHaveBeenCalled();expect(explorer.contains(document.activeElement)).toBe(true)
    const explorerControls=[...explorer.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
    explorerControls.at(-1)?.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));expect(document.activeElement).toBe(explorerControls[0])
    const inspectorToggle = button(host, 'Properties and backlinks drawer'); click(inspectorToggle)
    await vi.waitFor(() => { expect(explorer.hidden).toBe(true); expect(inspector.hidden).toBe(false); expect(inspector.getAttribute('role')).toBe('dialog'); expect(inspector.getAttribute('aria-modal')).toBe('true'); expect(inspector.getAttribute('aria-labelledby')).toBe('inspector-drawer-title'); expect(inspector.contains(document.activeElement)).toBe(true) })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => { expect(inspector.hidden).toBe(true); expect(host.querySelector('[data-drawer-scrim]')).toBeNull(); expect(document.activeElement).toBe(inspectorToggle); expect(host.querySelector('main')?.hasAttribute('inert')).toBe(false) })
  })

  it('links a saved Study artifact to an explicitly chosen Vault document', async () => {
    const api = apis()
    const artifact = { id: 'artifact-1', paperId: paper.arxivId, provider: 'claude_code' as const, providerVersion: '1', level: 'explain_simply' as const, outputLanguage: 'english' as const, sourceKind: 'abstract' as const, sourceDocumentId: null, sourceDocumentSnapshotId: null, sourceRevision: null, selectionStartUtf8: null, selectionEndUtf8: null, markdown: '# Saved aid', generatedAt: '2026-08-18T08:00:00Z', savedAt: '2026-08-18T08:01:00Z', backlinks: [] }
    vi.mocked(api.study.listArtifacts).mockResolvedValue([artifact])
    const { host } = render(api)
    click(await vi.waitFor(() => { const item = host.querySelector('[data-paper-id]'); expect(item).not.toBeNull(); return item! }))
    const target = await vi.waitFor(() => { const found = host.querySelector<HTMLSelectElement>('[aria-label="Artifact link document"]'); expect(found).not.toBeNull(); return found! })
    input(target, docs[1]!.id)
    click(button(host, 'Link artifact to document'))
    await vi.waitFor(() => expect(api.documents.linkArtifact).toHaveBeenCalledWith({ documentId: docs[1]!.id, artifactId: artifact.id }))
  })

  it('flushes dirty documents before native close and destroys the window only after save succeeds', async () => {
    let resolveSave: ((value: typeof docs[number]) => void) | undefined
    const api = apis()
    vi.mocked(api.documents.update).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve }))
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    input(editor, 'save before close')
    await vi.waitFor(() => expect(windowLifecycle.closeHandler).toBeTypeOf('function'))
    const preventDefault = vi.fn()
    const closing = windowLifecycle.closeHandler!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(windowLifecycle.destroy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledOnce())
    resolveSave?.({ ...docs[0]!, markdown: 'save before close', revision: 2, updatedAt: '2026-08-18T08:00:00Z' })
    await closing
    expect(windowLifecycle.destroy).toHaveBeenCalledOnce()
  })

  it('serializes concurrent native close requests through one dirty-document flush', async () => {
    let resolveSave: ((value: typeof docs[number]) => void) | undefined
    const api = apis()
    vi.mocked(api.documents.update).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve }))
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    input(editor, 'save once before close')
    await vi.waitFor(() => expect(windowLifecycle.closeHandler).toBeTypeOf('function'))
    const firstPreventDefault = vi.fn()
    const secondPreventDefault = vi.fn()
    const firstClose = windowLifecycle.closeHandler!({ preventDefault: firstPreventDefault })
    const secondClose = windowLifecycle.closeHandler!({ preventDefault: secondPreventDefault })
    expect(firstPreventDefault).toHaveBeenCalledOnce()
    expect(secondPreventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledOnce())
    expect(windowLifecycle.destroy).not.toHaveBeenCalled()
    resolveSave?.({ ...docs[0]!, markdown: 'save once before close', revision: 2, updatedAt: '2026-08-18T08:00:00Z' })
    await Promise.all([firstClose, secondClose])
    expect(windowLifecycle.destroy).toHaveBeenCalledOnce()
  })

  it('does not start an unawaited dirty-document save while the renderer unmounts', async () => {
    const api = apis()
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    input(editor, 'renderer is unmounting')
    root?.unmount()
    root = undefined
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(api.documents.update).not.toHaveBeenCalled()
  })

  it('keeps the native window open when a dirty document cannot be saved', async () => {
    const api = apis()
    vi.mocked(api.documents.update).mockRejectedValueOnce(new DocumentsApiError('document_conflict'))
    const { host } = render(api)
    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector('textarea'); expect(found).toBeInstanceOf(HTMLTextAreaElement); return found as HTMLTextAreaElement })
    input(editor, 'conflicted close')
    await vi.waitFor(() => expect(windowLifecycle.closeHandler).toBeTypeOf('function'))
    const preventDefault = vi.fn()
    await windowLifecycle.closeHandler!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(windowLifecycle.destroy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(host.textContent).toContain('Close blocked'))
  })

})
