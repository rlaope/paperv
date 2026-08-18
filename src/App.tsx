import { useCallback, useEffect, useRef, useState } from 'react'
import { getPaper, importArxivPaper, listPapers, savePaperNote, type PaperDetail, type PaperListItem } from './api/papers'
import { signalRuntimeSmokeReady, systemGetInfo, type SystemInfo } from './api/system'
import { NoteWorkspace } from './features/editor/NoteWorkspace'
import { ImportPaperDialog } from './features/import/ImportPaperDialog'
import type { EvidenceBacklink, WorkspacePapersApi } from './features/workspace/types'
import { Icon } from './ui/Icon'

const defaultPapersApi: WorkspacePapersApi = { getPaper, importArxivPaper, listPapers, savePaperNote }
type StartupState = { status: 'loading' } | { status: 'ready'; info: SystemInfo } | { status: 'error' }
type LibraryState = { status: 'loading' } | { status: 'ready'; papers: PaperListItem[] } | { status: 'error' }
type DetailState =
  | { status: 'idle' }
  | { status: 'loading'; arxivId: string }
  | { status: 'ready'; paper: PaperDetail }
  | { status: 'error'; arxivId: string }
type ViewportLayout = 'wide' | 'intermediate' | 'compact'
type Theme = 'dark' | 'light'
const readinessKeys = ['paprvReady', 'paprvPlatform', 'paprvVersion'] as const

function viewportLayout(): ViewportLayout {
  if (window.innerWidth <= 799) return 'compact'
  if (window.innerWidth <= 1023) return 'intermediate'
  return 'wide'
}
function useViewportLayout(): ViewportLayout {
  const [layout, setLayout] = useState<ViewportLayout>(viewportLayout)
  useEffect(() => {
    const update = (): void => setLayout(viewportLayout())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return layout
}
function themeStorage(): Storage | null {
  try { return window.localStorage ?? null } catch { return null }
}
function initialTheme(): Theme {
  const stored = themeStorage()?.getItem('paprv.theme')
  const theme = stored === 'light' || stored === 'dark' ? stored : 'dark'
  document.documentElement.dataset.theme = theme
  return theme
}
function clearReadiness(): void {
  for (const key of readinessKeys) delete document.documentElement.dataset[key]
}

function StartupBoundary({ children }: { children: (info: SystemInfo) => React.ReactNode }): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  const [startup, setStartup] = useState<StartupState>({ status: 'loading' })
  useEffect(() => {
    let active = true
    clearReadiness()
    setStartup({ status: 'loading' })
    void systemGetInfo().then(
      (info) => { if (active) setStartup({ status: 'ready', info }) },
      () => { if (active) setStartup({ status: 'error' }) }
    )
    return () => { active = false; clearReadiness() }
  }, [attempt])
  useEffect(() => {
    if (startup.status !== 'ready') return
    document.documentElement.dataset.paprvPlatform = startup.info.platform
    document.documentElement.dataset.paprvVersion = startup.info.version
    document.documentElement.dataset.paprvReady = 'true'
    void signalRuntimeSmokeReady(startup.info).catch(() => undefined)
    return clearReadiness
  }, [startup])

  if (startup.status === 'loading') {
    return <main className="startup-state" aria-live="polite">
      <span className="startup-mark">Paprv</span>
      <Icon name="loader" className="is-spinning" size={16} />
      <span>Opening your paper workspace…</span>
    </main>
  }
  if (startup.status === 'error') {
    return <main className="startup-state startup-error">
      <div role="alert">
        <Icon name="alert" size={24} />
        <h1>Paprv could not start</h1>
        <p>Reconnect to the desktop runtime, then try again.</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}><Icon name="refresh" size={15} />Try again</button>
      </div>
    </main>
  }
  return <>
    {children(startup.info)}
    <output hidden data-paprv-runtime-ready="true">PAPRV_RENDERER_READY:{startup.info.platform}:{startup.info.version}</output>
  </>
}

type WorkspaceProps = { papersApi: WorkspacePapersApi; theme: Theme; onToggleTheme: () => void }
function Workspace({ onToggleTheme, papersApi, theme }: WorkspaceProps): React.JSX.Element {
  const layout = useViewportLayout()
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })
  const [libraryAttempt, setLibraryAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [searchText, setSearchText] = useState('')
  const searchComposing = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const explorerRef = useRef<HTMLElement>(null)
  const evidenceRef = useRef<HTMLElement>(null)
  const explorerToggleRef = useRef<HTMLButtonElement>(null)
  const evidenceToggleRef = useRef<HTMLButtonElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const importTriggerRef = useRef<HTMLButtonElement>(null)
  const [detail, setDetail] = useState<DetailState>({ status: 'idle' })
  const [evidenceTab, setEvidenceTab] = useState<'evidence' | 'backlinks'>('evidence')
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null)
  const [backlinks, setBacklinks] = useState<EvidenceBacklink[]>([])
  const [drawer, setDrawer] = useState<'explorer' | 'evidence' | null>(null)
  const [drawerAnnouncement, setDrawerAnnouncement] = useState('')
  const drawerReturnFocus = useRef<HTMLElement | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const importReturnFocus = useRef<HTMLElement | null>(null)
  const handleBacklinksChange = useCallback((items: EvidenceBacklink[]) => setBacklinks(items), [])

  const selectPaper = (arxivId: string): void => {
    setSelectedEvidence(null)
    setBacklinks([])
    setDetail({ status: 'loading', arxivId })
    void papersApi.getPaper(arxivId).then(
      (paper) => setDetail((current) => current.status === 'loading' && current.arxivId === arxivId ? { status: 'ready', paper } : current),
      () => setDetail((current) => current.status === 'loading' && current.arxivId === arxivId ? { status: 'error', arxivId } : current)
    )
    if (layout === 'compact') setDrawer(null)
  }
  const closePaper = (): void => {
    setDetail({ status: 'idle' })
    setBacklinks([])
    setSelectedEvidence(null)
  }
  const closeDrawer = (): void => {
    setDrawer(null)
    setDrawerAnnouncement('')
    window.setTimeout(() => drawerReturnFocus.current?.focus(), 0)
  }
  const openDrawer = (target: 'explorer' | 'evidence', trigger: HTMLElement): void => {
    drawerReturnFocus.current = trigger
    setDrawer((current) => current === target ? null : target)
    setDrawerAnnouncement(target === 'explorer' ? 'Paper Explorer opened' : 'Evidence and Backlinks opened')
  }
  const activatePane = (target: 'explorer' | 'evidence', trigger: HTMLElement): void => {
    const paneIsVisible = target === 'explorer' ? layout !== 'compact' : layout === 'wide'
    if (paneIsVisible) {
      const pane = target === 'explorer' ? explorerRef.current : evidenceRef.current
      pane?.querySelector<HTMLElement>('input, button, [tabindex="0"]')?.focus()
    } else {
      openDrawer(target, trigger)
    }
  }
  const activateSearch = (trigger: HTMLElement): void => {
    if (layout === 'compact') {
      drawerReturnFocus.current = trigger
      setDrawer('explorer')
      setDrawerAnnouncement('Paper Explorer opened')
    }
    window.setTimeout(() => searchRef.current?.focus(), 0)
  }
  const selectEvidence = (evidenceId: string): void => {
    setEvidenceTab('evidence')
    setSelectedEvidence(evidenceId)
    if (layout !== 'wide') {
      if (document.activeElement instanceof HTMLElement) drawerReturnFocus.current = document.activeElement
      setDrawer('evidence')
      setDrawerAnnouncement('Evidence and Backlinks opened')
    }
    window.setTimeout(() => document.getElementById(evidenceId)?.focus(), 0)
  }
  const openImport = (trigger: HTMLElement): void => {
    importReturnFocus.current = trigger
    setImportOpen(true)
  }
  const closeImport = (): void => {
    setImportOpen(false)
    window.setTimeout(() => importReturnFocus.current?.focus(), 0)
  }
  const handleImported = (paper: PaperDetail): void => {
    setLibrary((current) => current.status !== 'ready'
      ? { status: 'ready', papers: [paper] }
      : { status: 'ready', papers: [paper, ...current.papers.filter((item) => item.arxivId !== paper.arxivId)] })
    setDetail({ status: 'ready', paper })
    closeImport()
  }

  useEffect(() => {
    let active = true
    setLibrary({ status: 'loading' })
    void papersApi.listPapers().then(
      (papers) => { if (active) setLibrary({ status: 'ready', papers }) },
      () => { if (active) setLibrary({ status: 'error' }) }
    )
    return () => { active = false }
  }, [libraryAttempt, papersApi])
  useEffect(() => {
    if (layout === 'wide') setDrawer(null)
    if (layout === 'intermediate' && drawer === 'explorer') setDrawer(null)
  }, [drawer, layout])
  useEffect(() => {
    if (!drawer || importOpen) return
    const pane = drawer === 'explorer' ? explorerRef.current : evidenceRef.current
    const focusTimer = window.setTimeout(() => pane?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]')?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); return }
      if (event.key !== 'Tab' || !pane) return
      const controls = [...pane.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('keydown', onKeyDown) }
  // closeDrawer only changes local drawer state and focus.
  }, [drawer, importOpen])
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLocaleLowerCase()
      if (key === 'o' && importTriggerRef.current) { event.preventDefault(); openImport(importTriggerRef.current) }
      else if (key === 'k' && searchToggleRef.current) { event.preventDefault(); activateSearch(searchToggleRef.current) }
      else if (key === '1' && explorerToggleRef.current) { event.preventDefault(); activatePane('explorer', explorerToggleRef.current) }
      else if (key === '2' && evidenceToggleRef.current) { event.preventDefault(); activatePane('evidence', evidenceToggleRef.current) }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  // Shortcut handlers intentionally follow the current responsive layout.
  }, [layout])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredPapers = library.status === 'ready'
    ? library.papers.filter((paper) => [paper.title, paper.authors.join(' '), paper.arxivId]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
    : []
  const selectedId = detail.status === 'ready' ? detail.paper.arxivId
    : detail.status === 'loading' || detail.status === 'error' ? detail.arxivId : null
  const explorerHidden = layout === 'compact' && drawer !== 'explorer'
  const evidenceHidden = layout !== 'wide' && drawer !== 'evidence'
  const activeTitle = detail.status === 'ready' ? detail.paper.title
    : detail.status === 'loading' ? 'Loading paper…'
      : detail.status === 'error' ? detail.arxivId : 'Welcome'
  const currentPaper = detail.status === 'ready' ? detail.paper : null

  return <div className={`app-shell layout-${layout}`}>
    <a className="skip-link" href="#note-editor">Skip to editor</a>
    <header className="app-topbar">
      <strong className="app-identity">Paprv</strong>
      <span className="workspace-label">Paper Notes</span>
      <span className="breadcrumb" title={activeTitle}>{activeTitle}</span>
      <span className="topbar-drag-region" aria-hidden="true" />
      <button ref={importTriggerRef} type="button" className="topbar-import" onClick={(event) => openImport(event.currentTarget)}>
        <Icon name="file-plus" size={15} />Fetch from arXiv
      </button>
    </header>

    <nav className="activity-ribbon" aria-label="Workspace tools">
      <button ref={explorerToggleRef} type="button" aria-label="Paper Explorer" title="Paper Explorer" aria-expanded={layout === 'compact' ? drawer === 'explorer' : undefined} aria-current={drawer === 'explorer' ? 'true' : undefined} onClick={(event) => activatePane('explorer', event.currentTarget)}>
        <Icon name="library" />
      </button>
      <button ref={searchToggleRef} type="button" aria-label="Search Papers" title="Search Papers" onClick={(event) => activateSearch(event.currentTarget)}><Icon name="search" /></button>
      <button type="button" aria-label="Fetch from arXiv" title="Fetch from arXiv" onClick={(event) => openImport(event.currentTarget)}><Icon name="file-plus" /></button>
      <button ref={evidenceToggleRef} type="button" aria-label="Evidence and Backlinks" title="Evidence and Backlinks" aria-expanded={layout !== 'wide' ? drawer === 'evidence' : undefined} aria-current={drawer === 'evidence' ? 'true' : undefined} onClick={(event) => activatePane('evidence', event.currentTarget)}>
        <Icon name="quote" />
      </button>
      <button type="button" className="theme-toggle" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={onToggleTheme}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
    </nav>

    <aside ref={explorerRef} className={`library-pane${drawer === 'explorer' ? ' is-open' : ''}`} aria-label="Paper Explorer" role={layout === 'compact' && drawer === 'explorer' ? 'dialog' : undefined} aria-modal={layout === 'compact' && drawer === 'explorer' ? true : undefined} hidden={explorerHidden}>
      <div className="pane-heading"><h2>PAPERS</h2><span>{library.status === 'ready' ? library.papers.length : '—'}</span></div>
      <label className="search-field">
        <Icon name="search" size={15} />
        <span className="visually-hidden">Search papers</span>
        <input ref={searchRef} type="search" aria-label="Search papers" placeholder="Search title, author, or arXiv ID" value={searchText} disabled={library.status !== 'ready'}
          onCompositionStart={() => { searchComposing.current = true }}
          onCompositionEnd={(event) => { searchComposing.current = false; setSearchText(event.currentTarget.value); setQuery(event.currentTarget.value) }}
          onChange={(event) => { setSearchText(event.target.value); if (!searchComposing.current) setQuery(event.target.value) }} />
      </label>
      {library.status === 'loading' && <div className="library-loading">
        <p aria-live="polite"><Icon name="loader" className="is-spinning" size={14} />Loading papers…</p>
        <div className="paper-skeletons" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index}><i /><i /></span>)}</div>
      </div>}
      {library.status === 'error' && <div className="library-message library-error" role="alert">
        <Icon name="alert" size={18} /><p>Papers could not be loaded.</p>
        <button type="button" onClick={() => setLibraryAttempt((value) => value + 1)}><Icon name="refresh" size={14} />Try again</button>
      </div>}
      {library.status === 'ready' && library.papers.length === 0 && <div className="library-message empty-library">
        <Icon name="file-plus" size={20} /><p>No papers in your library yet.</p><span>Fetch a paper from arXiv to start a local reading note.</span>
        <button type="button" onClick={(event) => openImport(event.currentTarget)}>Fetch your first arXiv paper</button>
      </div>}
      {library.status === 'ready' && library.papers.length > 0 && <>
        <div className="tree-section-label">ALL PAPERS</div>
        {filteredPapers.length === 0 ? <div className="library-message no-results"><p>No matching papers.</p><button type="button" onClick={() => { setSearchText(''); setQuery('') }}>Clear search</button></div>
          : <div className="paper-list" role="listbox" aria-label="Paper list">
            {filteredPapers.map((paper, index) => <button type="button" role="option" aria-selected={selectedId === paper.arxivId}
              tabIndex={selectedId ? (selectedId === paper.arxivId ? 0 : -1) : (index === 0 ? 0 : -1)} className="paper-list-item" key={paper.arxivId}
              onClick={() => selectPaper(paper.arxivId)}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const options = [...event.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[role="option"]')]
                const current = options.indexOf(event.currentTarget)
                const target = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                  : event.key === 'ArrowDown' ? Math.min(options.length - 1, current + 1) : Math.max(0, current - 1)
                options[target]?.focus()
              }}>
              <strong>{paper.title}</strong>
              <span>{paper.authors.join(', ') || 'Unknown authors'}</span>
              <small>arXiv:{paper.arxivId} · {paper.primaryCategory ?? 'Uncategorized'}</small>
            </button>)}
          </div>}
      </>}
    </aside>

    <main className={`editor-pane is-${detail.status}`} aria-label="Markdown paper note" id="note-editor" tabIndex={-1}>
      <header className={`paper-properties is-${detail.status}`}>
        {detail.status === 'ready' ? <>
          <h1 title={detail.paper.title}>{detail.paper.title}</h1>
          <dl>
            <div><dt>arXiv</dt><dd title={detail.paper.arxivId}>{detail.paper.arxivId}</dd></div>
            <div><dt>Category</dt><dd title={detail.paper.primaryCategory ?? '—'}>{detail.paper.primaryCategory ?? '—'}</dd></div>
            <div><dt>Published</dt><dd title={detail.paper.publishedAt.slice(0, 10)}>{detail.paper.publishedAt.slice(0, 10)}</dd></div>
            <div className="authors-property"><dt>Authors</dt><dd title={detail.paper.authors.join(', ') || '—'}>{detail.paper.authors.join(', ') || '—'}</dd></div>
          </dl>
        </> : detail.status === 'loading' ? <div className="property-skeleton" aria-label="Loading paper…"><span /><span /><span /></div>
          : detail.status === 'error' ? <div className="paper-detail-error" role="alert"><strong>Paper could not be opened.</strong><span>{detail.arxivId}</span><button type="button" onClick={() => selectPaper(detail.arxivId)}>Try again</button></div>
            : <h1>Paper Notes</h1>}
      </header>
      <NoteWorkspace paper={currentPaper} papersApi={papersApi} onImport={openImport} onClosePaper={closePaper} onEvidenceSelect={selectEvidence} onBacklinksChange={handleBacklinksChange} />
    </main>

    <aside ref={evidenceRef} className={`evidence-pane${drawer === 'evidence' ? ' is-open' : ''}`} aria-label="Evidence and backlinks" role={layout !== 'wide' && drawer === 'evidence' ? 'dialog' : undefined} aria-modal={layout !== 'wide' && drawer === 'evidence' ? true : undefined} hidden={evidenceHidden}>
      <div className="panel-tabs" role="tablist" aria-label="Paper context">
        <button id="evidence-tab" type="button" role="tab" aria-controls="evidence-panel" aria-selected={evidenceTab === 'evidence'} tabIndex={evidenceTab === 'evidence' ? 0 : -1}
          onClick={() => setEvidenceTab('evidence')} onKeyDown={(event) => { if (event.key === 'ArrowRight') { setEvidenceTab('backlinks'); document.getElementById('backlinks-tab')?.focus() } }}>Evidence</button>
        <button id="backlinks-tab" type="button" role="tab" aria-controls="backlinks-panel" aria-selected={evidenceTab === 'backlinks'} tabIndex={evidenceTab === 'backlinks' ? 0 : -1}
          onClick={() => setEvidenceTab('backlinks')} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { setEvidenceTab('evidence'); document.getElementById('evidence-tab')?.focus() } }}>Backlinks</button>
      </div>
      {evidenceTab === 'evidence' ? <div id="evidence-panel" role="tabpanel" aria-labelledby="evidence-tab" className="panel-content">
        {detail.status === 'ready' ? <>
          <section className={selectedEvidence === 'evidence-abstract' ? 'evidence-item is-selected' : 'evidence-item'}>
            <h3 id="evidence-abstract" tabIndex={-1} data-selected={selectedEvidence === 'evidence-abstract'}>Abstract</h3>
            <p>{detail.paper.summary || 'No abstract was provided.'}</p>
          </section>
          <section className={selectedEvidence === 'evidence-categories' ? 'evidence-item is-selected' : 'evidence-item'}>
            <h3 id="evidence-categories" tabIndex={-1} data-selected={selectedEvidence === 'evidence-categories'}>Categories</h3>
            <p>{detail.paper.categories.join(', ') || 'Uncategorized'}</p>
          </section>
          <section className={selectedEvidence === 'evidence-metadata' ? 'evidence-item is-selected' : 'evidence-item'}>
            <h3 id="evidence-metadata" tabIndex={-1} data-selected={selectedEvidence === 'evidence-metadata'}>Source details</h3>
            <dl><dt>arXiv ID</dt><dd>{detail.paper.arxivId}</dd><dt>Published</dt><dd>{detail.paper.publishedAt.slice(0, 10)}</dd><dt>Source updated</dt><dd>{detail.paper.sourceUpdatedAt.slice(0, 10)}</dd></dl>
          </section>
          <section className="reading-prompts"><h3>Reading prompts</h3><p>These questions are prompts for your own note, not claims from the paper.</p><ul>
            <li>State the paper’s problem in one sentence.</li><li>Mark terms in the abstract that remain unclear.</li><li>Note where to look for evidence on the next read.</li>
          </ul></section>
        </> : <p className="inspector-empty">Select a paper to inspect its abstract and source details.</p>}
      </div> : <div id="backlinks-panel" role="tabpanel" aria-labelledby="backlinks-tab" className="panel-content backlinks-panel">
        {backlinks.length === 0 ? <div className="inspector-empty"><Icon name="link" size={20} /><strong>No linked mentions yet.</strong><p>Link to an evidence section from your note to see it here.</p></div>
          : <div className="backlink-list">{backlinks.map((backlink, index) => <button type="button" className="backlink-item" key={`${backlink.evidenceId}-${index}`} onClick={() => selectEvidence(backlink.evidenceId)}>
            <strong><Icon name="link" size={14} />{backlink.label}</strong><span>{backlink.snippet}</span>
          </button>)}</div>}
      </div>}
    </aside>

    {drawer && layout !== 'wide' && <button className="drawer-scrim" type="button" aria-label="Close side panel" onClick={closeDrawer} />}
    <span className="visually-hidden" role="status">{drawerAnnouncement}</span>
    <ImportPaperDialog open={importOpen} papersApi={papersApi} existingIds={new Set(library.status === 'ready' ? library.papers.map((paper) => paper.arxivId) : [])} onClose={closeImport} onImported={handleImported} />
  </div>
}

export function App({ papersApi = defaultPapersApi }: { papersApi?: WorkspacePapersApi }): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  const toggleTheme = (): void => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      themeStorage()?.setItem('paprv.theme', next)
      return next
    })
  }
  return <StartupBoundary>{() => <Workspace papersApi={papersApi} theme={theme} onToggleTheme={toggleTheme} />}</StartupBoundary>
}
