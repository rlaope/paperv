import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { studyApiErrorFrom, studyArtifactSchema, studyDeleteArtifact, studyGet, studyListArtifacts, studySaveArtifact } from '../../src/api/study'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)
const artifact = { id: '650e8400-e29b-41d4-a716-446655440000', paperId: '1706.03762', provider: 'claude_code' as const, providerVersion: '1.2.3', level: 'explain_simply' as const, outputLanguage: 'english' as const, sourceKind: 'document' as const, sourceDocumentId: '550e8400-e29b-41d4-a716-446655440000', sourceDocumentSnapshotId: '550e8400-e29b-41d4-a716-446655440000', sourceRevision: 3, selectionStartUtf8: null, selectionEndUtf8: null, markdown: '# Aid', generatedAt: '2026-08-18T10:00:00Z', savedAt: '2026-08-18T10:01:00Z', backlinks: [] }
beforeEach(() => invokeMock.mockReset())

describe('study command client', () => {
  it('accepts a persisted technical polish artifact profile', () => {
    expect(studyArtifactSchema.safeParse({ ...artifact, level: 'technical_polish' }).success).toBe(true)
  })

  it('rejects impossible technical polish provenance from a paper abstract', () => {
    expect(studyArtifactSchema.safeParse({
      ...artifact,
      level: 'technical_polish',
      sourceKind: 'abstract',
      sourceDocumentId: null,
      sourceDocumentSnapshotId: null,
      sourceRevision: null
    }).success).toBe(false)
  })

  it('enforces canonical artifact source provenance', () => {
    expect(studyArtifactSchema.safeParse({ ...artifact, sourceKind: 'abstract', sourceDocumentId: artifact.sourceDocumentId, sourceRevision: 3 }).success).toBe(false)
  })

  it('preserves immutable document identity after the live source document is deleted', () => {
    expect(studyArtifactSchema.safeParse({ ...artifact, sourceDocumentId: null }).success).toBe(true)
  })

  it('rejects a raw executable path in persisted provider metadata', () => {
    expect(studyArtifactSchema.safeParse({ ...artifact, providerVersion: '/Users/private/bin/claude' }).success).toBe(false)
  })

  it('preserves known closed backend errors', () => {
    const error = studyApiErrorFrom(Object.assign(new Error('private backend detail'), { code: 'artifact_not_found' }))
    expect({ name: error.name, code: error.code, message: error.message }).toEqual({ name: 'StudyApiError', code: 'artifact_not_found', message: 'artifact_not_found' })
  })

  it('closes invalid renderer inputs before invocation', async () => {
    const error = await Promise.resolve().then(() => studySaveArtifact({ paperId: 'not-arxiv', runId: 'run-1' })).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ name: 'StudyApiError', code: 'invalid_input', message: 'invalid_input' })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('gets a Study without a note and persists artifacts only explicitly', async () => {
    const study = { paperId: '1706.03762', createdAt: '2026-08-18T09:00:00Z', updatedAt: '2026-08-18T10:01:00Z', backlinks: [] }
    invokeMock.mockResolvedValueOnce(study).mockResolvedValueOnce([artifact]).mockResolvedValueOnce(artifact).mockResolvedValueOnce(null)
    await expect(studyGet('1706.03762')).resolves.toEqual(study)
    await expect(studyListArtifacts('1706.03762')).resolves.toEqual([artifact])
    await expect(studySaveArtifact({ paperId: artifact.paperId, runId: 'run-1' })).resolves.toEqual(artifact)
    await expect(studyDeleteArtifact(artifact.id)).resolves.toBeNull()
    expect(invokeMock.mock.calls).toEqual([
      ['study_get', { paperId: artifact.paperId }],
      ['study_list_artifacts', { paperId: artifact.paperId }],
      ['study_save_artifact', { input: { paperId: artifact.paperId, runId: 'run-1' } }],
      ['study_delete_artifact', { artifactId: artifact.id }]
    ])
  })
})
