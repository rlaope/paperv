/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenerationApiError, type GenerationReadiness, type GenerationRun } from '../../src/api/generation'
import type { WorkspaceGenerationApi, WorkspaceStudyApi } from '../../src/features/workspace/types'
import { StudyGenerationDialog } from '../../src/features/transform/TransformDialog'

const documentItems = [
  { id: 'document-visible-id', title: 'Systems Notes', revision: 7, updatedAt: '2026-08-19T08:00:00Z' }
]

const readyReadiness: GenerationReadiness = {
  checkedAt: '2026-08-19T10:00:00Z',
  providers: [
    {
      provider: 'claude_code',
      displayName: 'Claude Code',
      integration: 'generation',
      installation: 'installed',
      authentication: 'authenticated',
      capability: 'supported',
      overall: 'ready',
      blocker: null,
      version: '1.2.3'
    },
    {
      provider: 'codex_cli',
      displayName: 'Codex CLI',
      integration: 'discovery_only',
      installation: 'installed',
      authentication: 'not_checked',
      capability: 'unsupported',
      overall: 'blocked',
      blocker: 'provider_capability_unsupported',
      version: null
    }
  ]
}

const blockedReadiness: GenerationReadiness = {
  ...readyReadiness,
  checkedAt: '2026-08-19T10:01:00Z',
  providers: [
    {
      provider: 'claude_code',
      displayName: 'Claude Code',
      integration: 'generation',
      installation: 'missing',
      authentication: 'indeterminate',
      capability: 'unsupported',
      overall: 'blocked',
      blocker: 'provider_not_installed',
      version: null
    },
    readyReadiness.providers[1]
  ]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function generationApi(overrides: Partial<WorkspaceGenerationApi> = {}): WorkspaceGenerationApi {
  return {
    getReadiness: vi.fn().mockResolvedValue(readyReadiness),
    start: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    getRun: vi.fn().mockResolvedValue({ status: 'running' } satisfies GenerationRun),
    cancel: vi.fn().mockResolvedValue({ status: 'cancel_requested' }),
    ...overrides
  }
}

function studyApi(): WorkspaceStudyApi {
  return {
    get: vi.fn(),
    listArtifacts: vi.fn(),
    saveArtifact: vi.fn(),
    deleteArtifact: vi.fn()
  }
}

let root: Root | undefined
function renderDialog(options: {
  generation?: WorkspaceGenerationApi
  study?: WorkspaceStudyApi
  flushDocument?: (id: string) => Promise<number | null>
  selection?: { documentId: string; revision: number; startUtf8: number; endUtf8: number } | null
  onClose?: () => void
  documents?: typeof documentItems
} = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const generation = options.generation ?? generationApi()
  const study = options.study ?? studyApi()
  const onClose = options.onClose ?? vi.fn()
  root = createRoot(host)
  root.render(
    <StudyGenerationDialog
      paperId="1706.03762"
      documents={options.documents ?? documentItems}
      selection={options.selection ?? null}
      generation={generation}
      study={study}
      flushDocument={options.flushDocument ?? vi.fn().mockResolvedValue(7)}
      onSaved={vi.fn()}
      onClose={onClose}
    />
  )
  return { generation, host, onClose, study }
}

function button(host: ParentNode, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === name || item.getAttribute('aria-label') === name)
  expect(found, `button ${name}`).toBeTruthy()
  return found as HTMLButtonElement
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function setRequest(host: ParentNode, value: string): void {
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Study request"]')
  expect(textarea).not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(textarea, value)
  textarea!.dispatchEvent(new Event('input', { bubbles: true }))
}

function selectValue(host: ParentNode, label: string, value: string): void {
  const select = [...host.querySelectorAll('label')].find((item) => item.textContent?.includes(label))?.querySelector<HTMLSelectElement>('select')
  expect(select, `select ${label}`).toBeTruthy()
  select!.value = value
  select!.dispatchEvent(new Event('change', { bubbles: true }))
}

async function sendRequest(host: ParentNode, request = 'Explain the main idea simply in Korean.'): Promise<void> {
  await vi.waitFor(() => expect(host.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
  setRequest(host, request)
  await vi.waitFor(() => expect(button(host, 'Send').disabled).toBe(false))
  click(button(host, 'Send'))
}

afterEach(() => {
  root?.unmount()
  root = undefined
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('Study generation dialog', () => {
  it('shows a compact Claude-like composer while keeping readiness internal', async () => {
    const { generation, host } = renderDialog()

    await vi.waitFor(() => expect(generation.getReadiness).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(host.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
    expect(host.querySelector('.agent-conversation')).not.toBeNull()
    expect(host.querySelector('.chat-composer')).not.toBeNull()
    expect(host.querySelector('textarea.chat-request')).not.toBeNull()
    expect(host.querySelector('.chat-composer-controls')).not.toBeNull()
    expect(host.querySelectorAll('.chat-compact-control')).toHaveLength(2)
    expect(host.querySelectorAll('fieldset')).toHaveLength(0)
    expect(host.textContent).not.toMatch(/Local providers|Installation:|Sign-in:|Safe generation:|Version 1\.2\.3/u)
    const agent = [...host.querySelectorAll('label')].find((item) => item.textContent?.includes('Agent'))?.querySelector('select')
    expect(agent?.value).toBe('claude_code')
    expect(agent?.querySelector<HTMLOptionElement>('option[value="codex_cli"]')?.disabled).toBe(true)
    expect(host.textContent).toContain('Codex CLI (discovery only)')
    expect(button(host, 'Send').disabled).toBe(true)
    setRequest(host, 'Explain this simply.')
    await vi.waitFor(() => expect(button(host, 'Send').disabled).toBe(false))
  })

  it('announces readiness checking and blocked retry remediation as an atomic polite status', async () => {
    const readiness = deferred<GenerationReadiness>()
    const { host } = renderDialog({ generation: generationApi({ getReadiness: vi.fn().mockReturnValue(readiness.promise) }) })

    const live = await vi.waitFor(() => {
      const found = host.querySelector<HTMLElement>('[data-generation-readiness]')
      expect(found?.textContent).toBe('Checking Claude Code…')
      return found!
    })
    expect(live.getAttribute('role')).toBe('status')
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(live.getAttribute('aria-atomic')).toBe('true')

    readiness.resolve(blockedReadiness)
    await vi.waitFor(() => expect(live.textContent).toBe('Install Claude Code and sign in from Terminal, then retry.'))
    expect(live.getAttribute('role')).toBe('status')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps only the latest explicit readiness response', async () => {
    const first = deferred<GenerationReadiness>()
    const second = deferred<GenerationReadiness>()
    const getReadiness = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { host } = renderDialog({ generation: generationApi({ getReadiness }) })

    await vi.waitFor(() => expect(getReadiness).toHaveBeenCalledOnce())
    click(button(host, 'Retry readiness'))
    expect(getReadiness).toHaveBeenCalledTimes(2)
    second.resolve(blockedReadiness)
    await vi.waitFor(() => expect(host.textContent).toContain('Install Claude Code and sign in from Terminal'))
    setRequest(host, 'Explain this.')
    expect(button(host, 'Send').disabled).toBe(true)
    first.resolve(readyReadiness)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(host.textContent).toContain('Install Claude Code and sign in from Terminal')
    expect(button(host, 'Send').disabled).toBe(true)
  })

  it('shows only brief remediation and Retry when Claude is unavailable', async () => {
    const { host } = renderDialog({ generation: generationApi({ getReadiness: vi.fn().mockResolvedValue(blockedReadiness) }) })
    await vi.waitFor(() => expect(host.textContent).toContain('Install Claude Code and sign in from Terminal'))
    expect(host.textContent).not.toMatch(/Installation:|Sign-in:|Safe generation:|Codex is discovery-only/u)
    expect(button(host, 'Retry readiness')).toBeTruthy()
    expect(button(host, 'Send').disabled).toBe(true)
  })

  it('recovers from readiness failure only through the visible Retry control', async () => {
    const getReadiness = vi.fn().mockRejectedValueOnce(new GenerationApiError('internal_unavailable')).mockResolvedValueOnce(readyReadiness)
    const { host } = renderDialog({ generation: generationApi({ getReadiness }) })
    await vi.waitFor(() => expect(host.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
    setRequest(host, 'Explain this.')
    await vi.waitFor(() => expect(button(host, 'Send').disabled).toBe(true))
    const alert = await vi.waitFor(() => {
      const found = host.querySelector<HTMLElement>('[role="alert"]')
      expect(found?.textContent).toContain('Provider readiness could not be checked')
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(alert.textContent).toContain('Retry')
    click(button(host, 'Retry readiness'))
    await vi.waitFor(() => expect(button(host, 'Send').disabled).toBe(false))
    expect(getReadiness).toHaveBeenCalledTimes(2)
  })

  it('renders generated Markdown links as inert readable text without navigation', async () => {
    const generation = generationApi({ getRun: vi.fn().mockResolvedValue({
      status: 'succeeded',
      markdown: 'Read [docs](https://example.com/path) before continuing.',
      paperId: '1706.03762',
      provider: 'claude_code',
      providerVersion: '1.2.3',
      sourceKind: 'abstract',
      sourceDocumentId: null,
      sourceRevision: null,
      selectionStartUtf8: null,
      selectionEndUtf8: null,
      level: 'explain_simply',
      outputLanguage: 'english',
      generatedAt: '2026-08-19T10:01:30Z'
    }) })
    const { host } = renderDialog({ generation })

    await sendRequest(host)

    const preview = await vi.waitFor(() => {
      const found = host.querySelector<HTMLElement>('.markdown-preview')
      expect(found?.textContent).toContain('docs')
      return found!
    })
    expect(preview.querySelector('a')).toBeNull()
    expect(preview.querySelector('[href]')).toBeNull()
    expect(preview.textContent).toContain('https://example.com/path')
  })

  it('generates an explicit technical-polish preview from saved metadata and renders only a safe run summary', async () => {
    const success: GenerationRun = {
      status: 'succeeded',
      markdown: '# Polished\n\nClear technical prose.',
      paperId: '1706.03762',
      provider: 'claude_code',
      providerVersion: '1.2.3',
      sourceKind: 'document',
      sourceDocumentId: documentItems[0]!.id,
      sourceRevision: 7,
      selectionStartUtf8: null,
      selectionEndUtf8: null,
      level: 'technical_polish',
      outputLanguage: 'korean',
      generatedAt: '2026-08-19T10:02:00Z'
    }
    const generation = generationApi({ getRun: vi.fn().mockResolvedValue(success) })
    const study = studyApi()
    const flushDocument = vi.fn().mockResolvedValue(7)
    const { host } = renderDialog({ flushDocument, generation, study })

    await vi.waitFor(() => expect(host.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
    selectValue(host, 'Context', `document:${documentItems[0]!.id}`)
    await sendRequest(host, 'Please polish this technical text in Korean.')

    await vi.waitFor(() => expect(generation.start).toHaveBeenCalledOnce())
    expect(flushDocument).toHaveBeenCalledWith(documentItems[0]!.id)
    expect(generation.start).toHaveBeenCalledWith({
      paperId: '1706.03762',
      provider: 'claude_code',
      request: 'Please polish this technical text in Korean.',
      source: { kind: 'document', documentId: documentItems[0]!.id, expectedRevision: 7 }
    })
    expect(JSON.stringify(vi.mocked(generation.start).mock.calls[0]?.[0])).not.toMatch(/level|outputLanguage|markdown|sourceText|selectedText|prompt|tone/u)

    await vi.waitFor(() => expect(host.textContent).toContain('Clear technical prose.'))
    expect(host.textContent).toContain('Please polish this technical text in Korean.')
    const summary = host.querySelector('[aria-label="Result metadata"]')
    expect(summary).not.toBeNull()
    expect(summary?.textContent).toContain('Polish technical text')
    expect(summary?.textContent).toContain('Document: Systems Notes · revision 7')
    expect(summary?.textContent).toContain('Korean')
    expect(summary?.textContent).not.toMatch(/document-visible-id|run-1|startUtf8|endUtf8|\/Users\/secret|prompt|stdin|stdout|authenticated/u)
    expect(button(host, 'Save artifact')).toBeTruthy()
    click(button(host, 'Save artifact'))
    await vi.waitFor(() => expect(study.saveArtifact).toHaveBeenCalledWith({ paperId: '1706.03762', runId: 'run-1' }))
    expect(host.textContent).not.toMatch(/Apply|Insert|Replace selection|Link artifact/u)
  })

  it('keeps technical polish bound to an exact captured selection without exposing offsets', async () => {
    const selection = { documentId: documentItems[0]!.id, revision: 7, startUtf8: 4, endUtf8: 19 }
    const generation = generationApi({
      getRun: vi.fn().mockResolvedValue({
        status: 'succeeded',
        markdown: '# Selection preview',
        paperId: '1706.03762',
        provider: 'claude_code',
        providerVersion: '1.2.3',
        sourceKind: 'document_selection',
        sourceDocumentId: selection.documentId,
        sourceRevision: selection.revision,
        selectionStartUtf8: selection.startUtf8,
        selectionEndUtf8: selection.endUtf8,
        level: 'technical_polish',
        outputLanguage: 'korean',
        generatedAt: '2026-08-19T10:02:30Z'
      })
    })
    const { host } = renderDialog({ generation, selection })

    await vi.waitFor(() => expect(host.querySelector('textarea[aria-label="Study request"]')).not.toBeNull())
    const context = [...host.querySelectorAll('label')].find((item) => item.textContent?.includes('Context'))?.querySelector('select')
    expect(context?.value).toBe(`selection:${selection.documentId}`)
    await sendRequest(host, 'Polish this selection without changing citations.')

    await vi.waitFor(() => expect(generation.start).toHaveBeenCalledWith(expect.objectContaining({
      request: 'Polish this selection without changing citations.',
      source: { kind: 'document_selection', documentId: selection.documentId, expectedRevision: 7, startUtf8: 4, endUtf8: 19 }
    })))
    const summary = await vi.waitFor(() => {
      const found = host.querySelector('[aria-label="Result metadata"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(summary.textContent).toContain('Captured selection from Systems Notes · revision 7')
    expect(summary.textContent).not.toMatch(/document-visible-id|startUtf8|endUtf8|\b4\b|\b19\b/u)
  })

  it('disambiguates duplicate context titles and preserves the selected safe provenance label', async () => {
    const duplicates = [
      { id: 'document-alpha-123456', title: 'Shared Notes', revision: 3, updatedAt: '2026-08-19T08:00:00Z' },
      { id: 'document-beta-654321', title: 'Shared Notes', revision: 8, updatedAt: '2026-08-19T09:00:00Z' }
    ]
    const generation = generationApi({ getRun: vi.fn().mockResolvedValue({
      status: 'succeeded',
      markdown: '# Duplicate-safe preview',
      paperId: '1706.03762',
      provider: 'claude_code',
      providerVersion: '1.2.3',
      sourceKind: 'document',
      sourceDocumentId: duplicates[1]!.id,
      sourceRevision: duplicates[1]!.revision,
      selectionStartUtf8: null,
      selectionEndUtf8: null,
      level: 'technical_polish',
      outputLanguage: 'english',
      generatedAt: '2026-08-19T10:02:45Z'
    }) })
    const { host } = renderDialog({ documents: duplicates, generation, flushDocument: vi.fn().mockResolvedValue(8) })

    const context = await vi.waitFor(() => {
      const found = host.querySelector<HTMLSelectElement>('select[aria-label="Context"]')
      expect(found).not.toBeNull()
      return found!
    })
    const documentOptions = [...context.options].filter((option) => option.value.startsWith('document:'))
    expect(documentOptions.map((option) => option.textContent)).toEqual([
      'Document: Shared Notes · revision 3 · item 1',
      'Document: Shared Notes · revision 8 · item 2'
    ])
    expect(new Set(documentOptions.map((option) => option.textContent)).size).toBe(2)
    expect(documentOptions.map((option) => option.textContent).join(' ')).not.toMatch(/123456|654321|document-alpha|document-beta/u)
    selectValue(host, 'Context', `document:${duplicates[1]!.id}`)
    await sendRequest(host, 'Polish the selected Shared Notes document.')

    const summary = await vi.waitFor(() => {
      const found = host.querySelector<HTMLElement>('[aria-label="Result metadata"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(summary.textContent).toContain('Document: Shared Notes · revision 8 · item 2')
    expect(summary.textContent).not.toMatch(/document-beta-654321|654321|\/Users\/|\\Users\\/u)
  })

  it('wraps backward from running status and contains focus when cancellation leaves no enabled controls', async () => {
    const cancellation = deferred<{ status: 'cancel_requested' }>()
    const generation = generationApi({
      getRun: vi.fn().mockReturnValue(new Promise<GenerationRun>(() => undefined)),
      cancel: vi.fn().mockReturnValue(cancellation.promise)
    })
    const { host } = renderDialog({ generation })

    await sendRequest(host)
    await vi.waitFor(() => {
      const found = host.querySelector<HTMLElement>('[data-generation-focus="running"]')
      expect(document.activeElement).toBe(found)
      return found!
    })
    const cancel = button(host, 'Cancel run')
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(backward)
    expect(backward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cancel)

    click(cancel)
    const cancellingStatus = await vi.waitFor(() => {
      expect(cancel.disabled).toBe(true)
      const found = host.querySelector<HTMLElement>('[data-generation-cancelling]')
      expect(found?.textContent).toBe('Cancelling…')
      expect(document.activeElement).toBe(found)
      return found!
    })
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(cancellingStatus)
      expect(host.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true)
    }
  })

  it('keeps a pending start mounted and retries cancellation for the same late run while polling', async () => {
    const started = deferred<{ runId: string }>()
    const retryCancellation = deferred<{ status: 'cancel_requested' }>()
    const terminal = deferred<GenerationRun>()
    const cancel = vi.fn()
      .mockRejectedValueOnce(new GenerationApiError('provider_termination_failed'))
      .mockReturnValueOnce(retryCancellation.promise)
    const generation = generationApi({
      start: vi.fn().mockReturnValue(started.promise),
      getRun: vi.fn().mockReturnValue(terminal.promise),
      cancel
    })
    const onClose = vi.fn()
    const study = studyApi()
    const { host } = renderDialog({ generation, onClose, study })

    await sendRequest(host)
    await vi.waitFor(() => expect(host.textContent).toContain('Starting generation…'))
    click(button(host, 'Cancel start'))

    expect(onClose).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(host.textContent).toContain('Waiting for the run to start so Paprv can cancel it safely.'))
    click(button(host, 'Close'))
    click(host.querySelector('.modal-scrim')!)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()

    started.resolve({ runId: 'late-run' })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('late-run'))
    await vi.waitFor(() => expect(generation.getRun).toHaveBeenCalledWith('late-run'))
    const alert = await vi.waitFor(() => {
      const found = host.querySelector<HTMLElement>('[role="alert"]')
      expect(found?.textContent).toContain('Cancellation could not be requested')
      expect(document.activeElement).toBe(found)
      return found!
    })
    expect(alert.textContent).toContain('could not be stopped safely')
    expect(onClose).not.toHaveBeenCalled()

    const retry = button(host, 'Retry cancellation')
    click(retry)
    click(retry)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(cancel.mock.calls).toEqual([['late-run'], ['late-run']])
    retryCancellation.resolve({ status: 'cancel_requested' })

    terminal.resolve({
      status: 'succeeded',
      markdown: '# Completed before cancellation',
      paperId: '1706.03762',
      provider: 'claude_code',
      providerVersion: '1.2.3',
      sourceKind: 'abstract',
      sourceDocumentId: null,
      sourceRevision: null,
      selectionStartUtf8: null,
      selectionEndUtf8: null,
      level: 'explain_simply',
      outputLanguage: 'korean',
      generatedAt: '2026-08-19T10:03:00Z'
    })
    await vi.waitFor(() => expect(host.textContent).toContain('Completed before cancellation'))
    expect(study.saveArtifact).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    click(button(host, 'Discard preview'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps a completed preview when completion wins the cancellation race', async () => {
    const terminal = deferred<GenerationRun>()
    const cancellation = deferred<{ status: 'cancel_requested' }>()
    const generation = generationApi({
      getRun: vi.fn().mockReturnValue(terminal.promise),
      cancel: vi.fn().mockReturnValue(cancellation.promise)
    })
    const { host } = renderDialog({ generation })

    await sendRequest(host)
    const cancelButton = await vi.waitFor(() => button(host, 'Cancel run'))
    click(cancelButton)
    terminal.resolve({
      status: 'succeeded',
      markdown: '# Completed first',
      paperId: '1706.03762',
      provider: 'claude_code',
      providerVersion: '1.2.3',
      sourceKind: 'abstract',
      sourceDocumentId: null,
      sourceRevision: null,
      selectionStartUtf8: null,
      selectionEndUtf8: null,
      level: 'explain_simply',
      outputLanguage: 'korean',
      generatedAt: '2026-08-19T10:04:00Z'
    })
    await vi.waitFor(() => expect(host.textContent).toContain('Completed first'))

    cancellation.reject(new GenerationApiError('provider_termination_failed'))
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(host.textContent).toContain('Completed first')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(button(host, 'Discard preview')).toBeTruthy()
  })
})
