import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PaperDetail } from '../../api/papers'
import { Icon, type IconName } from '../../ui/Icon'
import type { EvidenceBacklink, WorkspacePapersApi } from '../workspace/types'

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'
type Mode = 'edit' | 'preview'
type DraftMap = Record<string, string>
type SaveMap = Record<string, SaveState>

type Props = {
  paper: PaperDetail | null
  papersApi: WorkspacePapersApi
  onImport: (trigger: HTMLElement) => void
  onClosePaper: () => void
  onEvidenceSelect?: (evidenceId: string) => void
  onBacklinksChange?: (backlinks: EvidenceBacklink[]) => void
}

const saveLabels: Record<SaveState, string> = {
  clean: 'No changes', dirty: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Save failed'
}
const saveIcons: Record<SaveState, IconName> = {
  clean: 'check', dirty: 'edit', saving: 'loader', saved: 'check', error: 'alert'
}
const evidenceLabels: Record<EvidenceBacklink['evidenceId'], string> = {
  'evidence-abstract': 'Abstract',
  'evidence-categories': 'Categories',
  'evidence-metadata': 'Source details'
}

function extractBacklinks(markdown: string): EvidenceBacklink[] {
  const backlinks: EvidenceBacklink[] = []
  for (const line of markdown.split(/\r?\n/u)) {
    const pattern = /\[([^\]]+)\]\(#(evidence-(?:abstract|categories|metadata))\)/gu
    let match: RegExpExecArray | null
    while ((match = pattern.exec(line)) !== null) {
      const evidenceId = match[2] as EvidenceBacklink['evidenceId']
      const plainLine = line
        .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
        .replace(/^[#>*`\s-]+/u, '')
        .trim()
      backlinks.push({
        evidenceId,
        label: evidenceLabels[evidenceId],
        snippet: plainLine.length > 120 ? `${plainLine.slice(0, 117)}…` : plainLine
      })
    }
  }
  return backlinks
}

export function NoteWorkspace({
  onBacklinksChange, onClosePaper, onEvidenceSelect, onImport, paper, papersApi
}: Props): React.JSX.Element {
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [saveStates, setSaveStates] = useState<SaveMap>({})
  const [mode, setMode] = useState<Mode>('edit')
  const [manualAnnouncement, setManualAnnouncement] = useState('')
  const [composing, setComposing] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const latestDrafts = useRef<DraftMap>({})
  const requestIds = useRef<Record<string, number>>({})

  const paperId = paper?.arxivId ?? null
  const initialMarkdown = paper?.note?.markdown ?? ''
  const draft = paper ? (drafts[paper.arxivId] ?? initialMarkdown) : ''
  const saveState = paperId ? (saveStates[paperId] ?? 'clean') : 'clean'
  const wordCount = draft.trim() ? draft.trim().split(/\s+/u).length : 0

  const updateDraft = (next: string): void => {
    if (!paperId) return
    latestDrafts.current[paperId] = next
    setDrafts((items) => ({ ...items, [paperId]: next }))
    setSaveStates((states) => ({ ...states, [paperId]: 'dirty' }))
  }

  const save = async (manual: boolean): Promise<void> => {
    if (!paperId) return
    const id = paperId
    const submittedDraft = latestDrafts.current[id] ?? draft
    const currentRequest = (requestIds.current[id] ?? 0) + 1
    requestIds.current[id] = currentRequest
    setSaveStates((states) => ({ ...states, [id]: 'saving' }))
    if (manual) setManualAnnouncement('Saving…')
    try {
      await papersApi.savePaperNote(id, submittedDraft)
      if (requestIds.current[id] !== currentRequest) return
      const currentDraft = latestDrafts.current[id] ?? submittedDraft
      const nextState = currentDraft === submittedDraft ? 'saved' : 'dirty'
      setSaveStates((states) => ({ ...states, [id]: nextState }))
      if (manual) setManualAnnouncement(nextState === 'saved' ? 'Saved' : 'Newer changes remain unsaved')
    } catch {
      if (requestIds.current[id] !== currentRequest) return
      const currentDraft = latestDrafts.current[id] ?? submittedDraft
      if (currentDraft !== submittedDraft) {
        setSaveStates((states) => ({ ...states, [id]: 'dirty' }))
        if (manual) setManualAnnouncement('Newer changes remain unsaved')
        return
      }
      setSaveStates((states) => ({ ...states, [id]: 'error' }))
      if (manual) setManualAnnouncement('Save failed')
    }
  }

  useEffect(() => {
    if (!paperId || saveState !== 'dirty' || composing) return
    const timer = window.setTimeout(() => { void save(false) }, 600)
    return () => window.clearTimeout(timer)
  // save reads the current paper and draft; restarting this timer on either is intentional.
  }, [composing, draft, paperId, saveState])

  useEffect(() => {
    onBacklinksChange?.(paper ? extractBacklinks(draft) : [])
  // The parent callback is stable; extraction follows only the active note.
  }, [draft, paperId])

  useEffect(() => {
    if (!paperId) setMode('edit')
  }, [paperId])

  useEffect(() => {
    if (!paperId) return
    const onShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        setMode((current) => current === 'edit' ? 'preview' : 'edit')
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [paperId])

  const wrapSelection = (before: string, after = before, placeholder = 'text'): void => {
    const editor = editorRef.current
    if (!editor || !paperId) return
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = draft.slice(start, end) || placeholder
    const next = `${draft.slice(0, start)}${before}${selected}${after}${draft.slice(end)}`
    updateDraft(next)
    window.setTimeout(() => {
      editor.focus()
      editor.setSelectionRange(start + before.length, start + before.length + selected.length)
    }, 0)
  }

  return <>
    <div className="editor-modebar" aria-label="Editor mode">
      <div className="document-tabs" role="tablist" aria-label="Open document">
        <div className="active-document-tab" role="tab" aria-selected="true" title={paper?.title ?? 'Welcome'}>
          <Icon name={paper ? 'file' : 'library'} size={15} />
          <span>{paper?.title ?? 'Welcome'}</span>
          {paper && saveState === 'dirty' && <span className="dirty-dot" aria-label="Unsaved changes" />}
          {paper && <button type="button" className="tab-close" aria-label="Close paper" title="Close paper" onClick={onClosePaper}>
            <Icon name="x" size={14} />
          </button>}
        </div>
      </div>
      {paper && mode === 'edit' && <div className="editor-toolbar" aria-label="Markdown formatting">
        <button type="button" aria-label="Bold" title="Bold" onClick={() => wrapSelection('**')}><Icon name="bold" size={16} /></button>
        <button type="button" aria-label="Link" title="Link" onClick={() => wrapSelection('[', '](https://)', 'link text')}><Icon name="link" size={16} /></button>
        <button type="button" aria-label="Inline code" title="Inline code" onClick={() => wrapSelection('`')}><Icon name="code" size={16} /></button>
      </div>}
      <div className="mode-toggle">
        <button type="button" aria-pressed={mode === 'edit'} disabled={!paper} onClick={() => setMode('edit')}>
          <Icon name="edit" size={15} /><span>Edit</span>
        </button>
        <button type="button" aria-pressed={mode === 'preview'} disabled={!paper} onClick={() => setMode('preview')}>
          <Icon name="eye" size={15} /><span>Preview</span>
        </button>
      </div>
    </div>

    <div className="editor-body">
      {!paper ? <div className="editor-empty">
        <Icon name="file-plus" size={24} />
        <h2>Select a paper to begin a note</h2>
        <p>Choose a paper from the Explorer or fetch one from arXiv.</p>
        <button type="button" onClick={(event) => onImport(event.currentTarget)}><Icon name="file-plus" size={16} />Fetch from arXiv</button>
      </div> : mode === 'edit' ? <textarea
        ref={editorRef}
        className="markdown-editor"
        aria-label="Markdown paper note editor"
        spellCheck="false"
        value={draft}
        onChange={(event) => updateDraft(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
            event.preventDefault()
            void save(true)
          }
        }}
      /> : <article className="markdown-preview">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => {
              if (href?.startsWith('#evidence-')) {
                return <button type="button" className="evidence-link" onClick={() => onEvidenceSelect?.(href.slice(1))}>{children}</button>
              }
              return <span className="external-link-inert" data-external-link="true" title="External navigation is disabled for safety.">
                {children}<Icon name="external-link" size={13} />
              </span>
            }
          }}
        >{draft}</ReactMarkdown>
      </article>}
    </div>

    <footer className="editor-statusbar" role={saveState === 'error' ? 'alert' : undefined} aria-label="Editor status">
      <span className={`save-state is-${saveState}`} data-save-status={paper ? saveState : 'none'}>
        {paper ? <><Icon name={saveIcons[saveState]} className={saveState === 'saving' ? 'is-spinning' : undefined} size={13} />{saveLabels[saveState]}</> : 'No paper selected'}
      </span>
      {saveState === 'error' && <button type="button" onClick={() => { void save(true) }}><Icon name="refresh" size={13} />Retry save</button>}
      <span className="statusbar-detail">Markdown</span>
      <span className="statusbar-detail">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
      <span className="statusbar-detail">{mode === 'edit' ? 'Edit' : 'Preview'}</span>
      <span className="statusbar-detail"><Icon name="command" size={12} />Cmd/Ctrl+S</span>
      <span className="visually-hidden" role="status">{manualAnnouncement}</span>
    </footer>
  </>
}
