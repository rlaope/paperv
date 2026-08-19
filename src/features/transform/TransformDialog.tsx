import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { GenerationApiError, type GenerationErrorCode, type GenerationInput, type GenerationLevel, type GenerationProvider, type GenerationReadiness, type GenerationSuccess, type OutputLanguage } from '../../api/generation'
import type { DocumentListItem } from '../../api/documents'
import { StudyApiError } from '../../api/study'
import type { WorkspaceGenerationApi, WorkspaceStudyApi } from '../workspace/types'

export function generationErrorCopy(code: GenerationErrorCode): string {
  const copy: Record<GenerationErrorCode, string> = {
    invalid_request: 'The generation request is invalid. Start again.', paper_not_found: 'This paper is no longer available.', source_unavailable: 'The selected source is unavailable.', source_conflict: 'The saved document revision changed.', source_empty: 'The selected source is empty.', input_too_large: 'The request or attached source is too large.', provider_not_installed: 'The selected provider is not installed.', provider_executable_rejected: 'The provider installation could not be used safely.', provider_version_unsupported: 'Update the provider CLI to a supported version.', provider_auth_required: 'Sign in with the provider CLI, then retry.', provider_auth_probe_failed: 'Provider sign-in status could not be verified.', provider_capability_unsupported: 'This provider cannot disable all tools.', provider_isolation_unsupported: 'Required local process isolation is unavailable.', provider_busy: 'Another generation run is already active.', provider_spawn_failed: 'The provider could not be started.', provider_stdin_failed: 'The source could not be sent safely.', provider_output_limit: 'The provider returned too much output.', provider_timeout: 'The generation run timed out after 120 seconds.', provider_termination_failed: 'The provider process could not be stopped safely.', provider_exit_nonzero: 'The provider stopped before completion.', provider_protocol_invalid: 'The provider returned an invalid result.', provider_policy_violation: 'The provider attempted a disallowed action.', result_empty: 'The provider returned an empty result.', result_too_large: 'The generated Markdown is too large.', result_preservation_failed: 'The polished preview could not preserve protected technical content.', run_not_found: 'This generation run is no longer available.', internal_unavailable: 'Generation is temporarily unavailable.'
  }
  return copy[code]
}

type Selection = { documentId: string; revision: number; startUtf8: number; endUtf8: number }
type Props = { paperId: string; documents: DocumentListItem[]; selection: Selection | null; generation: WorkspaceGenerationApi; study: WorkspaceStudyApi; flushDocument: (id: string) => Promise<number | null>; onSaved: () => void; onClose: () => void }
type Status = 'configure' | 'preparing' | 'starting' | 'running' | 'cancelled' | 'succeeded' | 'saving' | 'save_failed' | 'failed' | 'saved'

const levelLabels: Record<GenerationLevel, string> = {
  translate_structure: 'Translate and structure', explain_simply: 'Explain simply', technical_deep_dive: 'Technical deep dive', technical_polish: 'Polish technical text'
}
const languageLabels: Record<OutputLanguage, string> = { english: 'English', korean: 'Korean' }

function documentIdentityLabel(title: string, revision: number | null, ordinal: number): string {
  return `${title} · revision ${revision ?? 'unknown'} · item ${ordinal}`
}

function safeSourceLabel(result: GenerationSuccess, documents: DocumentListItem[]): string {
  if (result.sourceKind === 'abstract') return 'Stored abstract'
  const document = documents.find((item) => item.id === result.sourceDocumentId)
  const ordinal = Math.max(1, documents.findIndex((item) => item.id === result.sourceDocumentId) + 1)
  const identity = document
    ? documentIdentityLabel(document.title, result.sourceRevision, ordinal)
    : `Saved document · revision ${result.sourceRevision ?? 'unknown'}`
  return result.sourceKind === 'document_selection'
    ? `Captured selection from ${identity}`
    : `Document: ${identity}`
}

function readinessRemediation(code: GenerationErrorCode): string {
  if (code === 'provider_not_installed') return 'Install Claude Code and sign in from Terminal, then retry.'
  if (code === 'provider_executable_rejected') return 'Reinstall Claude Code from its official source, then retry.'
  if (code === 'provider_version_unsupported') return 'Update Claude Code to a supported version, then retry.'
  if (code === 'provider_auth_required') return 'Run claude auth login in Terminal, then retry.'
  if (code === 'provider_auth_probe_failed') return 'Run claude auth status in Terminal, then retry.'
  return 'Claude Code is unavailable. Resolve the blocker outside Paprv, then retry.'
}

export function StudyGenerationDialog({ documents, flushDocument, generation, onClose, onSaved, paperId, selection, study }: Props) {
  const [provider, setProvider] = useState<GenerationProvider>('claude_code')
  const [source, setSource] = useState(selection ? `selection:${selection.documentId}` : 'abstract')
  const [draftRequest, setDraftRequest] = useState('')
  const [submittedRequest, setSubmittedRequest] = useState('')
  const [readiness, setReadiness] = useState<GenerationReadiness | null>(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<Status>('configure')
  const [result, setResult] = useState<GenerationSuccess | null>(null)
  const [error, setError] = useState('')
  const [cancellationRequested, setCancellationRequested] = useState(false)
  const [cancellationFailed, setCancellationFailed] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const run = useRef<string | null>(null)
  const saving = useRef(false)
  const beginning = useRef(false)
  const cancelling = useRef(false)
  const cancellationIntent = useRef(false)
  const terminal = useRef(false)
  const attempt = useRef(0)
  const readinessAttempt = useRef(0)
  const pollTimer = useRef<number | null>(null)

  const invalidateAttempt = () => {
    attempt.current += 1
    beginning.current = false
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    pollTimer.current = null
  }
  const close = () => {
    if (status === 'preparing') { invalidateAttempt(); onClose(); return }
    if (status === 'starting') { cancellationIntent.current = true; setCancellationRequested(true); return }
    onClose()
  }
  const checkReadiness = useCallback(() => {
    const current = ++readinessAttempt.current
    setReady(false)
    setReadiness(null)
    setError('')
    void generation.getReadiness().then((value) => {
      if (current !== readinessAttempt.current) return
      const claude = value.providers[0]
      setReadiness(value)
      setReady(claude.overall === 'ready')
    }, () => {
      if (current !== readinessAttempt.current) return
      setError('Provider readiness could not be checked. Retry readiness.')
    })
  }, [generation])

  useEffect(() => { checkReadiness(); window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('textarea,select,button')?.focus(), 0) }, [checkReadiness])
  useEffect(() => () => invalidateAttempt(), [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && status !== 'running') { event.preventDefault(); close() }
      if (event.key !== 'Tab' || !dialog.current) return
      const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')]
      const first = controls[0], last = controls.at(-1)
      const activeIsControl = controls.includes(document.activeElement as HTMLElement)
      if (!first || !last) {
        event.preventDefault()
        dialog.current.querySelector<HTMLElement>('[data-generation-cancelling], [data-generation-focus]')?.focus()
      } else if (event.shiftKey && (!activeIsControl || document.activeElement === first)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (!activeIsControl || document.activeElement === last)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [status])
  useEffect(() => {
    if (status === 'configure') return
    const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLElement>(`[data-generation-focus="${status}"]`)?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [status])
  useEffect(() => {
    if (status !== 'configure' || !error) return
    const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('[data-generation-focus="configure_error"]')?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [error, status])
  useEffect(() => {
    if (!cancellationFailed) return
    const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('[data-generation-cancel-error]')?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [cancellationFailed])
  useEffect(() => {
    if (status !== 'running' || !cancellationRequested) return
    const timer = window.setTimeout(() => dialog.current?.querySelector<HTMLElement>('[data-generation-cancelling]')?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [cancellationRequested, status])

  const poll = async (id: string, current: number) => {
    try {
      const value = await generation.getRun(id)
      if (current !== attempt.current) return
      if (value.status === 'running') {
        pollTimer.current = window.setTimeout(() => { pollTimer.current = null; void poll(id, current) }, 100)
        return
      }
      terminal.current = true
      setCancellationRequested(false)
      setCancellationFailed(false)
      if (value.status === 'succeeded') { setError(''); setResult(value); setStatus('succeeded') }
      else if (value.status === 'failed') { run.current = null; setError(generationErrorCopy(value.errorCode)); setStatus('failed') }
      else { run.current = null; setError('Generation was cancelled.'); setStatus('cancelled') }
    } catch (reason) {
      if (current !== attempt.current) return
      terminal.current = true
      run.current = null
      setError(generationErrorCopy(reason instanceof GenerationApiError ? reason.code : 'internal_unavailable'))
      setStatus('failed')
    }
  }

  const cancelRun = async (current = attempt.current, pollAfterCancellation = false) => {
    const id = run.current
    if (!id || cancelling.current) return
    cancelling.current = true
    cancellationIntent.current = true
    setError('')
    setCancellationFailed(false)
    setCancellationRequested(true)
    try { await generation.cancel(id) }
    catch (reason) {
      if (!terminal.current) {
        setCancellationRequested(false)
        setCancellationFailed(true)
        setError(`Cancellation could not be requested: ${generationErrorCopy(reason instanceof GenerationApiError ? reason.code : 'internal_unavailable')}`)
      }
    } finally {
      cancelling.current = false
      if (pollAfterCancellation && current === attempt.current && !terminal.current && run.current === id) {
        pollTimer.current = window.setTimeout(() => { pollTimer.current = null; void poll(id, current) }, 100)
      }
    }
  }

  const begin = async () => {
    if (beginning.current) return
    const naturalRequest = draftRequest.trim()
    if (!naturalRequest || new TextEncoder().encode(naturalRequest).byteLength > 4_096) {
      setError('Enter a Study request of at most 4096 UTF-8 bytes.')
      return
    }
    beginning.current = true
    const current = ++attempt.current
    cancellationIntent.current = false
    terminal.current = false
    setSubmittedRequest(naturalRequest)
    setError('')
    setCancellationFailed(false)
    setCancellationRequested(false)
    setStatus('preparing')
    let sourceDto: GenerationInput['source'] = { kind: 'abstract' }
    try {
      if (source.startsWith('document:')) {
        const id = source.slice(9)
        const revision = await flushDocument(id)
        if (current !== attempt.current) return
        if (!revision) { setError('Save the selected document before generation.'); setStatus('configure'); beginning.current = false; return }
        sourceDto = { kind: 'document', documentId: id, expectedRevision: revision }
      }
      if (source.startsWith('selection:')) {
        if (!selection) { setError('The captured document selection is no longer available.'); setStatus('configure'); beginning.current = false; return }
        const revision = await flushDocument(selection.documentId)
        if (current !== attempt.current) return
        if (!revision) { setError('Save the selected document before generation.'); setStatus('configure'); beginning.current = false; return }
        if (revision !== selection.revision) { setError(generationErrorCopy('source_conflict')); setStatus('configure'); beginning.current = false; return }
        sourceDto = { kind: 'document_selection', documentId: selection.documentId, expectedRevision: selection.revision, startUtf8: selection.startUtf8, endUtf8: selection.endUtf8 }
      }
      if (current !== attempt.current) return
      setStatus('starting')
      const started = await generation.start({ paperId, provider, request: naturalRequest, source: sourceDto })
      if (current !== attempt.current) { void generation.cancel(started.runId).catch(() => undefined); return }
      beginning.current = false
      run.current = started.runId
      setStatus('running')
      if (cancellationIntent.current) void cancelRun(current, true)
      else void poll(started.runId, current)
    } catch (reason) {
      if (current !== attempt.current) return
      beginning.current = false
      setError(generationErrorCopy(reason instanceof GenerationApiError ? reason.code : 'internal_unavailable'))
      setStatus('failed')
    }
  }

  const save = async () => {
    if (!result || !run.current || saving.current) return
    saving.current = true
    setError('')
    setStatus('saving')
    try { await study.saveArtifact({ paperId, runId: run.current }); setStatus('saved'); onSaved() }
    catch (reason) {
      setError(`${reason instanceof StudyApiError ? `Artifact could not be saved: ${reason.code.replaceAll('_', ' ')}.` : 'Artifact could not be saved: internal unavailable.'} Retrying is safe.`)
      setStatus('save_failed')
    } finally { saving.current = false }
  }

  const claude = readiness?.providers[0]
  const blockedCopy = claude?.blocker ? readinessRemediation(claude.blocker) : null
  const requestValid = draftRequest.trim().length > 0 && new TextEncoder().encode(draftRequest.trim()).byteLength <= 4_096
  const busy = status === 'preparing' || status === 'starting' || status === 'running'

  return <div className="modal-layer">
    <button className="modal-scrim" aria-label="Close generation" disabled={status === 'running'} onClick={close} />
    <div ref={dialog} className="transform-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby="generation-title">
      <header className="dialog-heading"><h2 id="generation-title">Study with AI</h2><button aria-label="Close" disabled={status === 'running'} onClick={close}>×</button></header>
      <div className="agent-conversation">
        {status === 'configure' && <div className="transform-composer chat-composer">
          <label><span className="visually-hidden">Study request</span><textarea className="chat-request" aria-label="Study request" value={draftRequest} maxLength={4096} onChange={(event) => setDraftRequest(event.target.value)} placeholder="Ask for an explanation, translation, deep dive, or technical polish…" /></label>
          <p role="status" aria-live="polite" aria-atomic="true" data-generation-readiness>{!readiness && !error ? 'Checking Claude Code…' : blockedCopy ?? ''}</p>
          <div className="chat-composer-controls">
            <label><span className="visually-hidden">Agent</span><select className="chat-compact-control" aria-label="Agent" value={provider} onChange={(event) => setProvider(event.target.value as GenerationProvider)}><option value="claude_code">Claude Code</option><option value="codex_cli" disabled>Codex CLI (discovery only)</option></select></label>
            <label><span className="visually-hidden">Context</span><select className="chat-compact-control" aria-label="Context" value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="abstract">Stored abstract</option>
              {documents.map((item, index) => <option key={item.id} value={`document:${item.id}`}>Document: {documentIdentityLabel(item.title, item.revision, index + 1)}</option>)}
              {selection && <option value={`selection:${selection.documentId}`}>Captured selection from {documentIdentityLabel(documents.find((item) => item.id === selection.documentId)?.title ?? 'Saved document', selection.revision, Math.max(1, documents.findIndex((item) => item.id === selection.documentId) + 1))}</option>}
            </select></label>
            {!ready && <button type="button" onClick={checkReadiness}>Retry readiness</button>}
            <button className="primary-button" disabled={!ready || !requestValid} onClick={() => { void begin() }}>Send</button>
          </div>
        </div>}

        {submittedRequest && <section aria-label="Conversation" className="transform-thread">
          <div className="transform-message chat-message is-user"><strong>You</strong><p>{submittedRequest}</p></div>
          <div className="transform-message chat-message is-assistant"><strong>Claude Code</strong>
            {status === 'preparing' && <p tabIndex={-1} data-generation-focus="preparing">Preparing source…</p>}
            {status === 'starting' && <div tabIndex={-1} data-generation-focus="starting"><p>Starting generation…</p>{cancellationRequested && <p>Waiting for the run to start so Paprv can cancel it safely.</p>}</div>}
            {status === 'running' && (cancellationRequested
              ? <p tabIndex={-1} data-generation-cancelling>Cancelling…</p>
              : <p tabIndex={-1} data-generation-focus="running">Generating…</p>)}
            {status === 'cancelled' && <p tabIndex={-1} data-generation-focus="cancelled">Generation cancelled</p>}
            {status === 'failed' && <p tabIndex={-1} data-generation-focus="failed">Generation failed</p>}
            {result && ['succeeded', 'saving', 'save_failed', 'saved'].includes(status) && <>
              <h3 tabIndex={-1} data-generation-focus={status === 'succeeded' ? 'succeeded' : undefined}>Preview</h3>
              <div aria-label="Result metadata"><span>{levelLabels[result.level]}</span> · <span>{languageLabels[result.outputLanguage]}</span> · <span>{safeSourceLabel(result, documents)}</span></div>
              <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <span>{children}{href ? ` (${href})` : ''}</span> }}>{result.markdown}</ReactMarkdown></article>
              <p><strong>Generated preview — not evidence.</strong> Verify it against the stored source before saving.</p>
            </>}
            {status === 'saved' && <p tabIndex={-1} data-generation-focus="saved">Artifact saved.</p>}
          </div>
        </section>}
      </div>
      <p role="status" aria-live="polite" className="visually-hidden">{status}</p>
      {error && <p role="alert" tabIndex={status === 'save_failed' || status === 'configure' || cancellationFailed ? -1 : undefined} data-generation-cancel-error={cancellationFailed ? 'true' : undefined} data-generation-focus={status === 'save_failed' ? 'save_failed' : status === 'configure' ? 'configure_error' : undefined} className="transform-error">{error}</p>}
      {status !== 'configure' && <footer className="dialog-actions">
        {status === 'preparing' && <button onClick={close}>Cancel preparation</button>}
        {status === 'starting' && <button disabled={cancellationRequested} onClick={close}>{cancellationRequested ? 'Waiting to cancel…' : 'Cancel start'}</button>}
        {status === 'running' && <button aria-label={cancellationFailed ? 'Cancel run' : undefined} disabled={cancellationRequested} onClick={() => { void cancelRun() }}>{cancellationRequested ? 'Cancelling…' : cancellationFailed ? 'Retry cancellation' : 'Cancel run'}</button>}
        {status === 'cancelled' && <button onClick={close}>Close</button>}
        {status === 'succeeded' && <><button aria-label="Discard" onClick={close}>Discard preview</button><button aria-label="Save artifact" className="primary-button" onClick={() => { void save() }}>Save artifact</button></>}
        {status === 'saving' && <button aria-label="Save artifact" className="primary-button" disabled>Save artifact</button>}
        {status === 'save_failed' && <><button aria-label="Discard" onClick={close}>Discard preview</button><button className="primary-button" onClick={() => { void save() }}>Retry save artifact</button></>}
        {status === 'saved' && <button onClick={close}>Done</button>}
        {status === 'failed' && <><button onClick={close}>Close</button><button onClick={() => { void begin() }}>Retry</button></>}
      </footer>}
    </div>
  </div>
}
