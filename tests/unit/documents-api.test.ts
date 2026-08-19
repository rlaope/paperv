import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  documentCreate, documentDelete, documentGet, documentGetProperties, documentLinkArtifact,
  documentLinkPaper, documentList, documentUnlinkArtifact, documentUnlinkPaper, documentUpdate,
  DocumentsApiError
} from '../../src/api/documents'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)
const document = { id: '550e8400-e29b-41d4-a716-446655440000', title: 'Independent note', markdown: '# Body', revision: 2, createdAt: '2026-08-18T10:00:00Z', updatedAt: '2026-08-18T10:01:00Z' }
const listItem = { id: document.id, title: document.title, revision: 2, updatedAt: document.updatedAt }
beforeEach(() => invokeMock.mockReset())

describe('document command client', () => {
  it('uses exact document CRUD commands and optimistic revision DTOs', async () => {
    invokeMock.mockResolvedValueOnce([listItem]).mockResolvedValueOnce(document).mockResolvedValueOnce(document).mockResolvedValueOnce({ ...document, revision: 3 }).mockResolvedValueOnce(null)
    await expect(documentList()).resolves.toEqual([listItem])
    await expect(documentGet(document.id)).resolves.toEqual(document)
    await expect(documentCreate({ title: document.title, markdown: document.markdown })).resolves.toEqual(document)
    await expect(documentUpdate({ documentId: document.id, expectedRevision: 2, title: document.title, markdown: document.markdown })).resolves.toMatchObject({ revision: 3 })
    await expect(documentDelete({ documentId: document.id })).resolves.toBeNull()
    expect(invokeMock.mock.calls).toEqual([
      ['document_list'], ['document_get', { documentId: document.id }],
      ['document_create', { input: { title: document.title, markdown: document.markdown } }],
      ['document_update', { input: { documentId: document.id, expectedRevision: 2, title: document.title, markdown: document.markdown } }],
      ['document_delete', { input: { documentId: document.id } }]
    ])
  })

  it('loads only stored properties and invokes explicit edge commands', async () => {
    const properties = { documentId: document.id, papers: [{ arxivId: '1706.03762', title: 'Attention', createdAt: '2026-08-18T10:00:00Z' }], artifacts: [{ artifactId: '650e8400-e29b-41d4-a716-446655440000', paperArxivId: '1706.03762', createdAt: '2026-08-18T10:00:00Z' }] }
    invokeMock.mockResolvedValueOnce(properties).mockResolvedValue(null)
    await expect(documentGetProperties(document.id)).resolves.toEqual(properties)
    await documentLinkPaper({ documentId: document.id, paperId: '1706.03762' })
    await documentUnlinkPaper({ documentId: document.id, paperId: '1706.03762' })
    await documentLinkArtifact({ documentId: document.id, artifactId: properties.artifacts[0]!.artifactId })
    await documentUnlinkArtifact({ documentId: document.id, artifactId: properties.artifacts[0]!.artifactId })
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(['document_get_properties', 'document_link_paper', 'document_unlink_paper', 'document_link_artifact', 'document_unlink_artifact'])
  })

  it('rejects extras, byte limit violations, and closes backend errors', async () => {
    invokeMock.mockResolvedValue({ ...document, note: null })
    await expect(documentGet(document.id)).rejects.toEqual(new DocumentsApiError('internal_unavailable'))
    await expect(documentCreate({ title: '가'.repeat(86), markdown: '' })).rejects.toThrow()
    await expect(documentCreate({ title: 'x', markdown: '가'.repeat(87_382) })).rejects.toThrow()
    expect(invokeMock).toHaveBeenCalledTimes(1)
    invokeMock.mockResolvedValue({ ...document, revision: 3, privatePath: '/private/path' })
    try { await documentUpdate({ documentId: document.id, expectedRevision: 2, title: 'x', markdown: '' }); throw new Error('expected rejection') } catch (error) { expect(error).toBeInstanceOf(DocumentsApiError); expect(error).toMatchObject({ code: 'internal_unavailable', message: 'internal_unavailable' }) }
  })
})
