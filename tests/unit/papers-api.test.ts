import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getPaper,
  importArxivPaper,
  listPapers,
  savePaperNote
} from '../../src/api/papers'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)

const listItem = {
  arxivId: '1706.03762',
  arxivVersion: 7,
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani'],
  primaryCategory: 'cs.CL',
  publishedAt: '2017-06-12T17:57:34Z',
  metadataFetchedAt: '2026-08-18T14:58:10.000Z'
}

const detail = {
  ...listItem,
  summary: 'A paper summary.',
  categories: ['cs.CL', 'cs.LG'],
  sourceUpdatedAt: '2017-12-06T17:57:34Z',
  importedAt: '2026-08-18T14:58:10.000Z',
  note: { markdown: '# Note', updatedAt: '2026-08-18T15:00:00.000Z' }
}

beforeEach(() => invokeMock.mockReset())

describe('papers command client', () => {
  it('invokes import with the exact typed argument and validates a detail', async () => {
    invokeMock.mockResolvedValue(detail)
    await expect(importArxivPaper('arXiv:1706.03762v7')).resolves.toEqual(detail)
    expect(invokeMock).toHaveBeenCalledWith('import_arxiv_paper', {
      input: { reference: 'arXiv:1706.03762v7' }
    })
  })

  it('invokes list without a payload and validates list items', async () => {
    invokeMock.mockResolvedValue([listItem])
    await expect(listPapers()).resolves.toEqual([listItem])
    expect(invokeMock).toHaveBeenCalledWith('list_papers')
  })

  it('invokes get with camelCase arxivId', async () => {
    invokeMock.mockResolvedValue({ ...detail, note: null })
    await expect(getPaper('1706.03762')).resolves.toEqual({ ...detail, note: null })
    expect(invokeMock).toHaveBeenCalledWith('get_paper', { arxivId: '1706.03762' })
  })

  it('invokes note save with the exact nested input', async () => {
    const note = { markdown: '', updatedAt: '2026-08-18T15:01:00.000Z' }
    invokeMock.mockResolvedValue(note)
    await expect(savePaperNote('1706.03762', '')).resolves.toEqual(note)
    expect(invokeMock).toHaveBeenCalledWith('save_paper_note', {
      input: { arxivId: '1706.03762', markdown: '' }
    })
  })

  it('validates the note limit in UTF-8 bytes for Korean text', async () => {
    const allowed = '가'.repeat(87_381)
    const tooLarge = '가'.repeat(87_382)
    invokeMock.mockResolvedValue({ markdown: allowed, updatedAt: '2026-08-18T15:01:00.000Z' })

    await expect(savePaperNote('1706.03762', allowed)).resolves.toMatchObject({ markdown: allowed })
    await expect(savePaperNote('1706.03762', tooLarge)).rejects.toThrow()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...listItem, arxivVersion: 0 },
    { ...listItem, publishedAt: 'not-a-date' },
    { ...listItem, authors: 'not-an-array' },
    { ...listItem, unexpected: true }
  ])('rejects malformed list data: %j', async (output) => {
    invokeMock.mockResolvedValue([output])
    await expect(listPapers()).rejects.toThrow()
  })

  it.each([
    ['', ''],
    ['x'.repeat(65), ''],
    ['1706.03762', 'x'.repeat(262145)]
  ])('rejects locally invalid request payloads', async (arxivId, markdown) => {
    await expect(savePaperNote(arxivId, markdown)).rejects.toThrow()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
