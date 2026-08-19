import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { DocumentsApiError, type MarkdownDocument } from '../../api/documents'
import type { WorkspaceDocumentsApi } from '../workspace/types'
import { Icon } from '../../ui/Icon'

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'
type Draft = { document: MarkdownDocument; title: string; markdown: string; baseRevision: number; saveState: SaveState; requestSequence: number; activeSave?: Promise<boolean> }
export type DocumentWorkspaceHandle = {
  openDocument: (id: string) => Promise<boolean>
  flushDocument: (id: string) => Promise<boolean>
  flushAllDirtyDocuments: () => Promise<string | null>
  closeDocument: (id: string) => void
  isComposing: () => boolean
  selectionSnapshot: (id: string) => { startUtf8: number; endUtf8: number } | null
  revision: (id: string) => number | null
}
type Props = { activeDocumentId: string | null; api: WorkspaceDocumentsApi; onDocumentLoaded?: (document: MarkdownDocument) => void; onDocumentSaved?: (document: MarkdownDocument) => void; onCopyCreated?: (document: MarkdownDocument) => void }
const labels: Record<SaveState, string> = { clean: 'No changes', dirty: 'Unsaved changes', saving: 'Saving…', saved: 'Saved', error: 'Save failed', conflict: 'Revision conflict' }

export const DocumentWorkspace = forwardRef<DocumentWorkspaceHandle, Props>(function DocumentWorkspace({ activeDocumentId, api, onCopyCreated, onDocumentLoaded, onDocumentSaved }, ref) {
  const [, render] = useState(0)
  const drafts = useRef(new Map<string, Draft>())
  const timers = useRef(new Map<string, number>())
  const composing = useRef(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const announce = useRef('')
  const refresh = () => render((value) => value + 1)

  const openDocument = async (id: string): Promise<boolean> => {
    if (drafts.current.has(id)) return true
    try { const document = await api.get(id); drafts.current.set(id, { document, title: document.title, markdown: document.markdown, baseRevision: document.revision, saveState: 'clean', requestSequence: 0 }); onDocumentLoaded?.(document); refresh(); return true } catch { announce.current = 'Document could not be opened'; refresh(); return false }
  }
  const save = async (id: string): Promise<boolean> => {
    const record = drafts.current.get(id); if (!record || composing.current) return false
    if (record.activeSave) await record.activeSave
    const current = drafts.current.get(id); if (!current) return false
    if (current.saveState === 'clean' || current.saveState === 'saved') return true
    const markdown = current.markdown; const title = current.title; const expectedRevision = current.baseRevision; const sequence = current.requestSequence + 1
    current.requestSequence = sequence; current.saveState = 'saving'; refresh()
    const operation = api.update({ documentId: id, expectedRevision, title, markdown }).then((saved) => {
      const latest = drafts.current.get(id); if (!latest) return false
      latest.document = saved; latest.baseRevision = saved.revision; onDocumentSaved?.(saved)
      if (latest.requestSequence !== sequence) { latest.saveState = 'dirty'; refresh(); return false }
      latest.saveState = latest.markdown === markdown && latest.title === title ? 'saved' : 'dirty'; announce.current = latest.saveState === 'saved' ? 'Saved' : 'Newer changes remain unsaved'; refresh(); return latest.saveState === 'saved'
    }, (error) => {
      const latest = drafts.current.get(id); if (!latest || latest.requestSequence !== sequence) return false
      if (latest.markdown !== markdown || latest.title !== title) latest.saveState = 'dirty'
      else latest.saveState = error instanceof DocumentsApiError && error.code === 'document_conflict' ? 'conflict' : 'error'
      announce.current = labels[latest.saveState]; refresh(); return false
    })
    current.activeSave = operation
    const result = await operation
    if (drafts.current.get(id)?.activeSave === operation) delete drafts.current.get(id)!.activeSave
    return result
  }
  const flushDocument = async (id: string): Promise<boolean> => {
    if (composing.current) { announce.current = 'Finish text composition before continuing'; refresh(); return false }
    const timer = timers.current.get(id); if (timer) { window.clearTimeout(timer); timers.current.delete(id) }
    while (true) {
      const record = drafts.current.get(id); if (!record) return true
      if (record.activeSave) { await record.activeSave; continue }
      if (record.saveState === 'clean' || record.saveState === 'saved') return true
      if (record.saveState === 'error' || record.saveState === 'conflict') return false
      return save(id)
    }
  }
  const flushAllDirtyDocuments = async (): Promise<string | null> => { for (const id of drafts.current.keys()) if (!(await flushDocument(id))) return id; return null }
  const closeDocument = (id: string) => { const timer=timers.current.get(id);if(timer)window.clearTimeout(timer);timers.current.delete(id);drafts.current.delete(id);refresh() }
  useImperativeHandle(ref, () => ({ openDocument, flushDocument, flushAllDirtyDocuments, closeDocument, isComposing: () => composing.current, selectionSnapshot: (id) => {
    if (id !== activeDocumentId || !editorRef.current) return null
    const record = drafts.current.get(id); if (!record) return null
    const start = editorRef.current.selectionStart; const end = editorRef.current.selectionEnd
    if (start === end) return null
    return { startUtf8: new TextEncoder().encode(record.markdown.slice(0, start)).byteLength, endUtf8: new TextEncoder().encode(record.markdown.slice(0, end)).byteLength }
  }, revision: (id) => drafts.current.get(id)?.baseRevision ?? null }))

  useEffect(() => { if (activeDocumentId) void openDocument(activeDocumentId) }, [activeDocumentId])
  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer) }, [])
  const update = (field: 'title' | 'markdown', value: string) => {
    if (!activeDocumentId) return; const record = drafts.current.get(activeDocumentId); if (!record) return
    record[field] = value; record.saveState = 'dirty'; record.requestSequence += 1; refresh()
    const old = timers.current.get(activeDocumentId); if (old) window.clearTimeout(old)
    if (!composing.current) timers.current.set(activeDocumentId, window.setTimeout(() => { timers.current.delete(activeDocumentId); void save(activeDocumentId) }, 600))
  }
  const retry = () => { if (!activeDocumentId) return; const record = drafts.current.get(activeDocumentId); if (!record) return; record.saveState = 'dirty'; refresh(); void save(activeDocumentId) }
  const reloadAsCopy = async () => { if (!activeDocumentId) return; const record = drafts.current.get(activeDocumentId); if (!record) return; try { const copy = await api.create({ title: `${record.title} (conflicted copy)`, markdown: record.markdown }); onCopyCreated?.(copy) } catch { announce.current = 'Copy could not be created'; refresh() } }
  const formatSelection = (before: string, after: string, fallback: string) => {
    if (!activeDocumentId || !editorRef.current) return
    const record = drafts.current.get(activeDocumentId); if (!record) return
    const start = editorRef.current.selectionStart; const end = editorRef.current.selectionEnd
    const selected = record.markdown.slice(start, end) || fallback
    update('markdown', `${record.markdown.slice(0, start)}${before}${selected}${after}${record.markdown.slice(end)}`)
    window.setTimeout(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(start + before.length, start + before.length + selected.length) }, 0)
  }
  const record = activeDocumentId ? drafts.current.get(activeDocumentId) : undefined
  return <section className="document-workspace" aria-label="Markdown document">
    {!record ? <div className="editor-empty"><Icon name="file" /><h2>Open a Vault document</h2><p>Your Markdown documents are independent from papers.</p></div> : <>
      <div className="editor-context" aria-label={`Vault / ${record.title}.md`}><span>Vault</span><span aria-hidden="true">/</span><input className="document-name-input" aria-label="Document title" value={record.title} onChange={(event) => update('title', event.target.value)} /><span aria-hidden="true">.md</span></div>
      <div className="editor-body"><textarea ref={editorRef} className="markdown-editor" aria-label="Markdown document editor" placeholder="Start writing in Markdown…" spellCheck="false" value={record.markdown} onChange={(event) => update('markdown', event.target.value)} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; update('markdown', editorRef.current?.value ?? record.markdown) }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!composing.current) void save(activeDocumentId!) } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); formatSelection('**','**','bold text') } }} /></div>
      {(record.saveState === 'error' || record.saveState === 'conflict') && <div className="document-recovery editor-statusbar" role="alert"><span>{labels[record.saveState]}</span><button type="button" onClick={retry}>Retry</button>{record.saveState === 'conflict' && <button type="button" onClick={() => { void reloadAsCopy() }}>Reload as copy</button>}</div>}
      <span className="visually-hidden" role="status" aria-live="polite">{announce.current}</span>
    </>}
  </section>
})
