/** @vitest-environment jsdom */
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/App'
import { DocumentsApiError } from '../../src/api/documents'
import { signalRuntimeSmokeReady, systemGetInfo } from '../../src/api/system'
import type { WorkspaceApis } from '../../src/features/workspace/types'

vi.mock('../../src/api/system', () => ({ systemGetInfo: vi.fn(), signalRuntimeSmokeReady: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn().mockResolvedValue(vi.fn()), destroy: vi.fn() })
}))
vi.mocked(systemGetInfo).mockResolvedValue({ platform: 'macos', version: '0.0.1' })
vi.mocked(signalRuntimeSmokeReady).mockResolvedValue(false)

const paper = {
  arxivId: '1706.03762', arxivVersion: 7, title: 'Attention', authors: ['Author'],
  primaryCategory: 'cs.CL', publishedAt: '2017-06-12T17:57:34Z',
  metadataFetchedAt: '2026-08-18T06:00:00Z', summary: 'Stored abstract.',
  categories: ['cs.CL'], sourceUpdatedAt: '2023-08-02T00:00:00Z', importedAt: '2026-08-18T06:00:00Z'
}
const documentValue = {
  id: '550e8400-e29b-41d4-a716-446655440000', title: 'Draft', markdown: 'original', revision: 4,
  createdAt: '2026-08-18T06:00:00Z', updatedAt: '2026-08-18T06:00:00Z'
}

function apis(saveFailure: unknown): WorkspaceApis {
  return {
    papers: {
      listPapers: vi.fn().mockResolvedValue([paper]),
      getPaper: vi.fn().mockResolvedValue(paper),
      importArxivPaper: vi.fn()
    },
    documents: {
      list: vi.fn().mockResolvedValue([{ id: documentValue.id, title: documentValue.title, revision: documentValue.revision, updatedAt: documentValue.updatedAt }]),
      get: vi.fn().mockResolvedValue(documentValue),
      create: vi.fn(),
      update: vi.fn().mockRejectedValue(saveFailure),
      delete: vi.fn(),
      getProperties: vi.fn().mockResolvedValue({ documentId: documentValue.id, papers: [], artifacts: [] }),
      linkPaper: vi.fn(), unlinkPaper: vi.fn(), linkArtifact: vi.fn(), unlinkArtifact: vi.fn()
    },
    study: {
      get: vi.fn().mockResolvedValue({ paperId: paper.arxivId, createdAt: paper.importedAt, updatedAt: paper.importedAt, backlinks: [] }),
      listArtifacts: vi.fn().mockResolvedValue([]),
      saveArtifact: vi.fn(), deleteArtifact: vi.fn()
    },
    generation: {
      getReadiness: vi.fn(), start: vi.fn(), getRun: vi.fn(), cancel: vi.fn()
    }
  }
}

let root: Root | undefined
const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const button = (host: ParentNode, name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)!
const input = (element: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function render(api: WorkspaceApis) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(<App apis={api} />)
  return host
}

afterEach(() => {
  root?.unmount()
  root = undefined
  document.body.innerHTML = ''
  window.innerWidth = 1024
  vi.clearAllMocks()
})

describe('Study transition safety', () => {
  it.each([
    ['revision conflict', new DocumentsApiError('document_conflict'), true],
    ['save failure', new Error('sensitive raw backend error'), false]
  ])('blocks Study without abstract fallback when selection flush has a %s', async (_label, failure, expectsCopyRecovery) => {
    const api = apis(failure)
    const host = render(api)

    click(await vi.waitFor(() => { const found = button(host, 'Vault'); expect(found).toBeTruthy(); return found }))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-document-id]'); expect(found).not.toBeNull(); return found! }))
    const editor = await vi.waitFor(() => { const found = host.querySelector<HTMLTextAreaElement>('textarea'); expect(found).not.toBeNull(); return found! })
    input(editor, 'draft a한글 selection')
    editor.setSelectionRange(6, 9)

    click(button(host, 'Library'))
    click(await vi.waitFor(() => { const found = host.querySelector('[data-paper-id]'); expect(found).not.toBeNull(); return found! }))

    await vi.waitFor(() => expect(api.documents.update).toHaveBeenCalledWith({
      documentId: documentValue.id,
      expectedRevision: 4,
      title: 'Draft',
      markdown: 'draft a한글 selection'
    }))
    await vi.waitFor(() => expect(host.textContent).toContain('Study blocked: save this document before opening Study'))

    expect(api.papers.getPaper).not.toHaveBeenCalled()
    expect(api.study.get).not.toHaveBeenCalled()
    expect(api.study.listArtifacts).not.toHaveBeenCalled()
    expect(api.generation.getReadiness).not.toHaveBeenCalled()
    expect(api.generation.start).not.toHaveBeenCalled()
    expect(host.querySelector(`[data-tab-key="document:${documentValue.id}"]`)?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector(`[data-tab-key="study:${paper.arxivId}"]`)).toBeNull()
    expect(host.querySelector('.document-host')?.hasAttribute('hidden')).toBe(false)
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft a한글 selection')
    expect(host.textContent).not.toContain('Stored abstract.')
    expect(button(host, 'Generate study aid')).toBeUndefined()
    expect(document.activeElement).toBe(button(host, 'Retry'))
    expect(Boolean(button(host, 'Reload as copy'))).toBe(expectsCopyRecovery)
    expect(host.textContent).not.toContain('sensitive raw backend error')
  })
})
