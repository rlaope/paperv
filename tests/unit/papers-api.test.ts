import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { getPaper, importArxivPaper, listPapers } from '../../src/api/papers'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)
const paper = { arxivId: '1706.03762', arxivVersion: 7, title: 'Attention', authors: ['Author'], primaryCategory: 'cs.CL', publishedAt: '2017-06-12T17:57:34Z', metadataFetchedAt: '2026-08-18T06:00:00Z', summary: 'Abstract', categories: ['cs.CL'], sourceUpdatedAt: '2023-08-02T00:00:00Z', importedAt: '2026-08-18T06:00:00Z' }
beforeEach(() => invokeMock.mockReset())
describe('paper command client', () => {
  it('has no paper-owned note in any response', async () => { const item = { arxivId:paper.arxivId, arxivVersion:paper.arxivVersion, title:paper.title, authors:paper.authors, primaryCategory:paper.primaryCategory, publishedAt:paper.publishedAt, metadataFetchedAt:paper.metadataFetchedAt }; invokeMock.mockResolvedValueOnce([item]).mockResolvedValueOnce(paper).mockResolvedValueOnce(paper); await listPapers(); await getPaper(paper.arxivId); await importArxivPaper(paper.arxivId); expect(JSON.stringify(invokeMock.mock.calls)).not.toContain('note') })
  it('strictly rejects a legacy note property', async () => { invokeMock.mockResolvedValue({ ...paper, note: null }); await expect(getPaper(paper.arxivId)).rejects.toThrow() })
})
