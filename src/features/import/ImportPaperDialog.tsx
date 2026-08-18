import { useEffect, useId, useRef, useState } from 'react'
import type { PaperDetail } from '../../api/papers'
import { Icon } from '../../ui/Icon'
import type { WorkspacePapersApi } from '../workspace/types'

type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; paper: PaperDetail; duplicate: boolean }

const modernId = /^\d{4}\.\d{4,5}(?:v\d+)?$/i
const legacyId = /^[a-z0-9-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/i

export function normalizeArxivReference(value: string): string | null {
  const trimmed = value.trim()
  const withoutPrefix = trimmed.replace(/^arxiv:\s*/i, '')
  let candidate = withoutPrefix
  try {
    const url = new URL(withoutPrefix)
    if (url.protocol !== 'https:' || !['arxiv.org', 'www.arxiv.org'].includes(url.hostname)) return null
    const match = url.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i)
    if (!match?.[1]) return null
    candidate = decodeURIComponent(match[1])
  } catch {
    // A bare arXiv identifier is expected to fail URL parsing.
  }
  if (!modernId.test(candidate) && !legacyId.test(candidate)) return null
  return candidate.replace(/v\d+$/i, '')
}

type Props = {
  open: boolean
  papersApi: WorkspacePapersApi
  existingIds: ReadonlySet<string>
  onClose: () => void
  onImported: (paper: PaperDetail) => void
}

export function ImportPaperDialog({ existingIds, onClose, onImported, open, papersApi }: Props): React.JSX.Element | null {
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const loading = status.kind === 'loading'

  useEffect(() => {
    if (!open) return
    setInput('')
    setStatus({ kind: 'idle' })
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !loading) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [loading, onClose, open])

  if (!open) return null

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (loading) return
    const reference = normalizeArxivReference(input)
    if (!reference) {
      setStatus({ kind: 'invalid', message: 'Enter a valid arXiv URL or paper ID.' })
      return
    }
    setStatus({ kind: 'loading' })
    try {
      const importedPaper = await papersApi.importArxivPaper(reference)
      setStatus({ kind: 'success', paper: importedPaper, duplicate: existingIds.has(importedPaper.arxivId) })
    } catch {
      setStatus({ kind: 'error', message: 'The paper could not be fetched from arXiv. Check your connection and try again.' })
    }
  }

  return <div className="modal-layer">
    <button className="modal-scrim" type="button" aria-label="Close arXiv fetch dialog" disabled={loading} onClick={onClose} />
    <div ref={dialogRef} className="import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header className="dialog-heading">
        <div>
          <p className="section-label">PAPERS</p>
          <h2 id={titleId}>Fetch from arXiv</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close arXiv fetch dialog" title="Close arXiv fetch dialog" disabled={loading} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </header>
      <p id={descriptionId} className="dialog-description">
        Fetch paper metadata from arXiv by entering a paper URL or ID. Paprv is not endorsed by arXiv.
      </p>
      <p className="arxiv-acknowledgement">Thank you to arXiv for use of its open access interoperability.</p>
      {status.kind === 'success' ? <div className="import-result" aria-live="polite">
        <Icon name="check" size={20} />
        <strong>{status.paper.title}</strong>
        <p>{status.duplicate ? 'Existing paper refreshed from arXiv.' : 'Paper fetched from arXiv and added to your library.'}</p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" className="primary-button" onClick={() => onImported(status.paper)}>Open paper</button>
        </div>
      </div> : <form onSubmit={(event) => { void submit(event) }}>
        <label htmlFor={`${titleId}-reference`}>arXiv URL or ID</label>
        <input
          ref={inputRef}
          id={`${titleId}-reference`}
          aria-label="arXiv URL or ID"
          aria-invalid={status.kind === 'invalid' || status.kind === 'error'}
          aria-describedby={status.kind === 'invalid' || status.kind === 'error' ? `${titleId}-error` : undefined}
          autoComplete="off"
          placeholder="e.g. 1706.03762 or https://arxiv.org/abs/1706.03762"
          value={input}
          disabled={loading}
          onChange={(event) => {
            setInput(event.target.value)
            if (status.kind === 'invalid' || status.kind === 'error') setStatus({ kind: 'idle' })
          }}
        />
        <div className="import-status-row">
          {(status.kind === 'invalid' || status.kind === 'error') && <p id={`${titleId}-error`} className="field-error" role="alert"><Icon name="alert" size={14} />{status.message}</p>}
          {loading && <p className="import-progress" role="status"><Icon name="loader" className="is-spinning" size={14} />Fetching metadata from arXiv…</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
          <button type="submit" className="primary-button" disabled={loading || input.trim().length === 0}>
            {loading && <Icon name="loader" className="is-spinning" size={14} />}{loading ? 'Fetching…' : 'Fetch paper'}
          </button>
        </div>
      </form>}
    </div>
  </div>
}
