/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import axe from 'axe-core'
import { signalRuntimeSmokeReady, systemGetInfo } from '../../src/api/system'
import { App } from '../../src/App'
import { GenerationApiError } from '../../src/api/generation'
import { StudyApiError } from '../../src/api/study'
import { DocumentWorkspace } from '../../src/features/editor/NoteWorkspace'
import { StudyGenerationDialog } from '../../src/features/transform/TransformDialog'
import type { WorkspaceApis } from '../../src/features/workspace/types'

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' })
vi.mocked(signalRuntimeSmokeReady).mockResolvedValue(false)

const storage = new Map<string, string>()
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key),
  setItem: (key: string, value: string) => storage.set(key, value)
} })
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: vi.fn(() => ({ measureText: () => ({ width: 0 }) }))
})
const jsdomGetComputedStyle = window.getComputedStyle.bind(window)
Object.defineProperty(window, 'getComputedStyle', {
  configurable: true,
  value: (element: Element) => jsdomGetComputedStyle(element)
})

const readyProvider = {
  provider: 'claude_code', displayName: 'Claude Code', integration: 'generation', installation: 'installed',
  authentication: 'authenticated', capability: 'supported', overall: 'ready', blocker: null, version: '1'
} as const
const blockedClaude = {
  provider: 'claude_code', displayName: 'Claude Code', integration: 'generation', installation: 'installed',
  authentication: 'unauthenticated', capability: 'supported', overall: 'blocked', blocker: 'provider_auth_required', version: '1'
} as const
const blockedCodex = {
  provider: 'codex_cli', displayName: 'Codex CLI', integration: 'discovery_only', installation: 'installed',
  authentication: 'not_checked', capability: 'unsupported', overall: 'blocked', blocker: 'provider_capability_unsupported', version: null
} as const
const success = {
  status: 'succeeded', markdown: '# Aid', paperId: '1706.03762', provider: 'claude_code', providerVersion: '1',
  sourceKind: 'abstract', sourceDocumentId: null, sourceRevision: null, selectionStartUtf8: null, selectionEndUtf8: null,
  level: 'explain_simply', outputLanguage: 'english', generatedAt: '2026-08-18T08:00:00Z'
} as const

let root: Root | undefined

afterEach(() => {
  root?.unmount()
  root = undefined
  document.body.innerHTML = ''
  storage.clear()
  window.innerWidth = 1024
  window.innerHeight = 768
  vi.clearAllMocks()
})

function host(): HTMLDivElement {
  document.documentElement.lang = 'en'
  document.title = 'Paprv'
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  return element
}

async function expectNoSeriousStructuralViolations(): Promise<void> {
  // jsdom does not resolve CSS colors; contrast is enforced by contrast-contract.test.ts.
  // Keep axe's contrast rule enabled so this suite never hides it behind configuration.
  const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
  expect(result.violations.filter((item) => ['critical', 'serious'].includes(item.impact ?? ''))).toEqual([])
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')]
    .find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
  expect(found, `missing button ${name}`).toBeTruthy()
  return found!
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function renderGeneration(options: {
  getReadiness?: ReturnType<typeof vi.fn>
  start?: ReturnType<typeof vi.fn>
  getRun?: ReturnType<typeof vi.fn>
  cancel?: ReturnType<typeof vi.fn>
  saveArtifact?: ReturnType<typeof vi.fn>
  documents?: Array<{ id: string; title: string; revision: number; updatedAt: string }>
  flushDocument?: ReturnType<typeof vi.fn>
} = {}) {
  const generation = {
    getReadiness: options.getReadiness ?? vi.fn().mockResolvedValue({ providers: [readyProvider, blockedCodex] }),
    start: options.start ?? vi.fn().mockResolvedValue({ runId: 'run-1' }),
    getRun: options.getRun ?? vi.fn().mockResolvedValue(success),
    cancel: options.cancel ?? vi.fn().mockResolvedValue(null)
  }
  const study = {
    get: vi.fn(), listArtifacts: vi.fn(),
    saveArtifact: options.saveArtifact ?? vi.fn().mockResolvedValue(null), deleteArtifact: vi.fn()
  }
  const element = host()
  root!.render(<StudyGenerationDialog
    paperId="1706.03762"
    documents={options.documents ?? []}
    selection={null}
    generation={generation}
    study={study}
    flushDocument={options.flushDocument ?? vi.fn()}
    onSaved={vi.fn()}
    onClose={vi.fn()}
  />)
  return { host: element, generation, study }
}

async function dialog(container: ParentNode): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const found = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(found).not.toBeNull()
    return found!
  })
}

async function beginGeneration(container: ParentNode): Promise<void> {
  const request = await vi.waitFor(() => {
    const found = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Study request"]')
    expect(found).not.toBeNull()
    return found!
  })
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(request, 'Explain this simply in Korean.')
  request.dispatchEvent(new Event('input', { bubbles: true }))
  const send = await vi.waitFor(() => findButton(container, 'Send'))
  click(send)
}

describe('Vault and Study shell accessibility', () => {
  it('exposes activity, explorer, mixed-tab workspace, and inspector landmarks without serious axe violations', async () => {
    const element = host()
    root!.render(<App />)
    await vi.waitFor(() => expect(element.querySelector('[aria-label="Activities"]')).not.toBeNull())
    expect(element.querySelector('button[aria-label="Library"]')).not.toBeNull()
    expect(element.querySelector('button[aria-label="Vault"]')).not.toBeNull()
    expect(element.querySelector('main[aria-label="Study and Markdown workspace"]')).not.toBeNull()
    expect(element.querySelector('aside[aria-label="Properties and backlinks"]')).not.toBeNull()
    await expectNoSeriousStructuralViolations()
  })

  it('checks the populated Markdown editor state', async () => {
    const element = host()
    const documentValue = {
      id: 'legacy-note:1706.03762', title: 'Editor state', markdown: '# Body', revision: 2,
      createdAt: '2026-08-18T10:00:00Z', updatedAt: '2026-08-18T10:01:00Z'
    }
    root!.render(<DocumentWorkspace activeDocumentId={documentValue.id} api={{
      list: vi.fn(), get: vi.fn().mockResolvedValue(documentValue), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
      getProperties: vi.fn(), linkPaper: vi.fn(), unlinkPaper: vi.fn(), linkArtifact: vi.fn(), unlinkArtifact: vi.fn()
    }} />)
    await vi.waitFor(() => expect(element.querySelector('textarea[placeholder="Start writing in Markdown…"]')).not.toBeNull())
    await expectNoSeriousStructuralViolations()
  })

  it('checks the compact ready composer without exposing readiness details', async () => {
    const { host: element } = renderGeneration()
    const modal = await dialog(element)
    await vi.waitFor(() => expect(modal.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
    expect(findButton(modal, 'Send').disabled).toBe(true)
    expect(modal.querySelector('select[aria-label="Agent"]')?.textContent).toContain('Codex CLI (discovery only)')
    expect(modal.textContent).not.toMatch(/Installation:|Sign-in:|Safe generation:/u)
    await expectNoSeriousStructuralViolations()
  })

  it('keeps generation disabled when every provider is blocked', async () => {
    const { host: element } = renderGeneration({
      getReadiness: vi.fn().mockResolvedValue({ providers: [blockedClaude, blockedCodex] })
    })
    const modal = await dialog(element)
    await vi.waitFor(() => expect(findButton(modal, 'Send').disabled).toBe(true))
    await expectNoSeriousStructuralViolations()
  })

  it('focuses and announces a provider readiness error', async () => {
    const { host: element } = renderGeneration({
      getReadiness: vi.fn().mockRejectedValue(new Error('unavailable'))
    })
    const modal = await dialog(element)
    const alert = await vi.waitFor(() => {
      const found = modal.querySelector<HTMLElement>('[role="alert"]')
      expect(found?.textContent).toContain('readiness could not be checked')
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(alert.getAttribute('data-generation-focus')).toBe('configure_error')
    expect(findButton(modal, 'Send').disabled).toBe(true)
    await expectNoSeriousStructuralViolations()
  })

  it('checks the compact 720 by 520 chat composer state', async () => {
    window.innerWidth = 720
    window.innerHeight = 520
    const { host: element } = renderGeneration()
    const modal = await dialog(element)
    await vi.waitFor(() => expect(modal.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
    expect(modal.querySelectorAll('fieldset')).toHaveLength(0)
    await expectNoSeriousStructuralViolations()
  })

  it('checks and focuses the cancellable pending generation start state', async () => {
    const { host: element } = renderGeneration({ start: vi.fn().mockReturnValue(new Promise(() => undefined)) })
    await beginGeneration(element)
    const status = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>('[data-generation-focus="starting"]')
      expect(found).not.toBeNull()
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(status.textContent).toBe('Starting generation…')
    expect(findButton(element, 'Cancel start')).toBeTruthy()
    await expectNoSeriousStructuralViolations()
  })

  it('checks and focuses the running generation state', async () => {
    const { host: element } = renderGeneration({ getRun: vi.fn().mockReturnValue(new Promise(() => undefined)) })
    await beginGeneration(element)
    const modal = await dialog(element)
    const status = await vi.waitFor(() => {
      const found = modal.querySelector<HTMLElement>('[data-generation-focus="running"]')
      expect(found).not.toBeNull()
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(status.textContent).toBe('Generating…')
    expect(modal.getAttribute('aria-busy')).toBe('true')
    expect(findButton(modal, 'Cancel run').disabled).toBe(false)
    await expectNoSeriousStructuralViolations()
  })

  it('announces a running cancellation error and restores its action', async () => {
    const { host: element } = renderGeneration({
      getRun: vi.fn().mockReturnValue(new Promise(() => undefined)),
      cancel: vi.fn().mockRejectedValue(new GenerationApiError('provider_termination_failed'))
    })
    await beginGeneration(element)
    const modal = await dialog(element)
    click(await vi.waitFor(() => findButton(modal, 'Cancel run')))
    const alert = await vi.waitFor(() => {
      const found = modal.querySelector<HTMLElement>('[role="alert"]')
      expect(found?.textContent).toContain('could not be stopped safely')
      return found!
    })
    expect(alert.textContent).toContain('Cancellation could not be requested')
    expect(findButton(modal, 'Cancel run').disabled).toBe(false)
    await expectNoSeriousStructuralViolations()
  })

  it('checks and focuses the successful preview state', async () => {
    const { host: element } = renderGeneration()
    await beginGeneration(element)
    const preview = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>('[data-generation-focus="succeeded"]')
      expect(found).not.toBeNull()
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(preview.textContent).toBe('Preview')
    await expectNoSeriousStructuralViolations()
  })

  it('focuses and announces a retry-safe artifact save error', async () => {
    const { host: element } = renderGeneration({
      saveArtifact: vi.fn().mockRejectedValue(new StudyApiError('internal_unavailable'))
    })
    await beginGeneration(element)
    const modal = await dialog(element)
    click(await vi.waitFor(() => findButton(modal, 'Save artifact')))
    const alert = await vi.waitFor(() => {
      const found = modal.querySelector<HTMLElement>('[data-generation-focus="save_failed"]')
      expect(found?.getAttribute('role')).toBe('alert')
      expect(found?.textContent).toContain('Retrying is safe')
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(alert.textContent).toContain('internal unavailable')
    expect(findButton(modal, 'Retry save artifact').disabled).toBe(false)
    await expectNoSeriousStructuralViolations()
  })

  it('checks and focuses the failed generation state', async () => {
    const { host: element } = renderGeneration({
      start: vi.fn().mockRejectedValue(new GenerationApiError('provider_spawn_failed'))
    })
    await beginGeneration(element)
    const failure = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>('[data-generation-focus="failed"]')
      expect(found).not.toBeNull()
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(failure.textContent).toBe('Generation failed')
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('could not be started')
    await expectNoSeriousStructuralViolations()
  })

  it('marks cancellable source preparation busy and keeps it accessible', async () => {
    const { host: element } = renderGeneration({
      documents: [{ id: 'doc-1', title: 'Draft', revision: 1, updatedAt: '2026-08-18T10:00:00Z' }],
      flushDocument: vi.fn().mockReturnValue(new Promise(() => undefined))
    })
    const modal = await dialog(element)
    const context = modal.querySelector<HTMLSelectElement>('select[aria-label="Context"]')!
    context.value = 'document:doc-1'
    context.dispatchEvent(new Event('change', { bubbles: true }))
    await beginGeneration(element)
    await vi.waitFor(() => {
      expect(modal.getAttribute('aria-busy')).toBe('true')
      expect(document.activeElement).toBe(modal.querySelector('[data-generation-focus="preparing"]'))
      expect(findButton(modal, 'Cancel preparation')).toBeTruthy()
    })
    await expectNoSeriousStructuralViolations()
  })

  it('announces and disables a pending permanent delete without accessibility violations', async () => {
    const paper = {
      arxivId: '1706.03762', arxivVersion: 1, title: 'Paper', authors: ['Author'], primaryCategory: 'cs.CL',
      publishedAt: '2026-08-18T00:00:00Z', metadataFetchedAt: '2026-08-18T00:00:00Z', summary: 'Abstract',
      categories: ['cs.CL'], sourceUpdatedAt: '2026-08-18T00:00:00Z', importedAt: '2026-08-18T00:00:00Z'
    }
    const documentValue = {
      id: 'doc-1', title: 'Draft', markdown: 'Body', revision: 1,
      createdAt: '2026-08-18T00:00:00Z', updatedAt: '2026-08-18T00:00:00Z'
    }
    const api: WorkspaceApis = {
      papers: { listPapers: vi.fn().mockResolvedValue([paper]), getPaper: vi.fn().mockResolvedValue(paper), importArxivPaper: vi.fn() },
      documents: {
        list: vi.fn().mockResolvedValue([{ id: documentValue.id, title: documentValue.title, revision: documentValue.revision, updatedAt: documentValue.updatedAt }]),
        get: vi.fn().mockResolvedValue(documentValue), create: vi.fn(), update: vi.fn(), delete: vi.fn().mockReturnValue(new Promise(() => undefined)),
        getProperties: vi.fn().mockResolvedValue({ documentId: documentValue.id, papers: [], artifacts: [] }),
        linkPaper: vi.fn(), unlinkPaper: vi.fn(), linkArtifact: vi.fn(), unlinkArtifact: vi.fn()
      },
      study: { get: vi.fn(), listArtifacts: vi.fn(), saveArtifact: vi.fn(), deleteArtifact: vi.fn() },
      generation: { getReadiness: vi.fn(), start: vi.fn(), getRun: vi.fn(), cancel: vi.fn() }
    }
    const element = host()
    root!.render(<App apis={api} />)
    await vi.waitFor(() => expect(findButton(element, 'Vault')).toBeTruthy())
    click(findButton(element, 'Vault'))
    const item = await vi.waitFor(() => {
      const found = element.querySelector('[data-document-id]')
      expect(found).not.toBeNull()
      return found!
    })
    click(item)
    click(await vi.waitFor(() => findButton(element, 'Delete document')))
    const alertDialog = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>('[role="alertdialog"]')
      expect(found).not.toBeNull()
      return found!
    })
    click(findButton(alertDialog, 'Delete permanently'))
    await vi.waitFor(() => {
      expect(alertDialog.getAttribute('aria-busy')).toBe('true')
      expect(alertDialog.textContent).toContain('Deleting document…')
      expect(findButton(alertDialog, 'Deleting…').disabled).toBe(true)
      expect(document.activeElement).toBe(alertDialog.querySelector('[data-delete-busy]'))
    })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(alertDialog.querySelector('[data-delete-busy]'))
    await expectNoSeriousStructuralViolations()
  })
})
