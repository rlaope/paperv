import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { GenerationApiError, generationGetReadiness, generationGetRun, generationStart, type GenerationInput } from '../../src/api/generation'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)
beforeEach(() => invokeMock.mockReset())

const readiness = {
  checkedAt: '2026-08-19T10:00:00Z',
  providers: [
    {
      provider: 'claude_code',
      displayName: 'Claude Code',
      integration: 'generation',
      installation: 'installed',
      authentication: 'authenticated',
      capability: 'supported',
      overall: 'ready',
      blocker: null,
      version: '1.2.3'
    },
    {
      provider: 'codex_cli',
      displayName: 'Codex CLI',
      integration: 'discovery_only',
      installation: 'installed',
      authentication: 'not_checked',
      capability: 'unsupported',
      overall: 'blocked',
      blocker: 'provider_capability_unsupported',
      version: null
    }
  ]
}

describe('generation readiness DTO', () => {
  it('accepts the exact stable Claude generation and Codex discovery-only tuple', async () => {
    invokeMock.mockResolvedValue(readiness)

    await expect(generationGetReadiness()).resolves.toEqual(readiness)
    expect(invokeMock).toHaveBeenCalledWith('generation_get_readiness')
  })

  it('rejects an impossible authenticated Claude row with an authentication blocker', async () => {
    invokeMock.mockResolvedValue({
      ...readiness,
      providers: [
        { ...readiness.providers[0], overall: 'blocked', blocker: 'provider_auth_required' },
        readiness.providers[1]
      ]
    })

    await expect(generationGetReadiness()).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })

  it('rejects a raw executable path disguised as a provider version', async () => {
    invokeMock.mockResolvedValue({
      ...readiness,
      providers: [{ ...readiness.providers[0], version: '/Users/private/bin/claude' }, readiness.providers[1]]
    })
    await expect(generationGetReadiness()).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })

  it.each([
    ['duplicate provider', { ...readiness, providers: [readiness.providers[0], readiness.providers[0]] }],
    ['unstable order', { ...readiness, providers: [readiness.providers[1], readiness.providers[0]] }],
    ['extra provider', { ...readiness, providers: [...readiness.providers, readiness.providers[1]] }],
    ['raw executable path', { ...readiness, providers: [{ ...readiness.providers[0], executablePath: '/Users/private/bin/claude' }, readiness.providers[1]] }],
    ['raw provider output', { ...readiness, providers: [readiness.providers[0], { ...readiness.providers[1], providerOutput: 'private auth response' }] }],
    ['ready Codex', { ...readiness, providers: [readiness.providers[0], { ...readiness.providers[1], overall: 'ready' }] }]
  ])('rejects unsafe readiness state: %s', async (_name, value) => {
    invokeMock.mockResolvedValue(value)
    await expect(generationGetReadiness()).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })
})

describe('generation natural request DTO', () => {
  const base: GenerationInput = {
    paperId: '1706.03762', provider: 'claude_code', request: 'Explain the main idea simply in Korean.', source: { kind: 'abstract' }
  }

  it.each<GenerationInput['source']>([
    { kind: 'abstract' },
    { kind: 'document', documentId: 'legacy-note:1706.03762', expectedRevision: 2 },
    { kind: 'document_selection', documentId: '550e8400-e29b-41d4-a716-446655440000', expectedRevision: 2, startUtf8: 1, endUtf8: 4 }
  ])('sends a trimmed natural request with exact closed source metadata: $kind', async (source) => {
    invokeMock.mockResolvedValue({ runId: 'run-1' })
    await generationStart({ ...base, request: '  Explain this in Korean.  ', source })
    expect(invokeMock).toHaveBeenCalledWith('generation_start', { input: { ...base, request: 'Explain this in Korean.', source } })
    expect(JSON.stringify(invokeMock.mock.calls[0])).not.toMatch(/level|outputLanguage|markdown|sourceText|selectedText|prompt|tone/u)
  })

  it.each([
    ['', 'empty', 'invalid_request'],
    ['   \n\t ', 'whitespace', 'invalid_request'],
    ['unsafe\u0000request', 'NUL', 'invalid_request'],
    ['unsafe\u0007request', 'control', 'invalid_request'],
    ['한'.repeat(1366) + 'a', 'over 4096 UTF-8 bytes', 'input_too_large']
  ] as const)('rejects a %s request before invoking the backend', async (request, _description, code) => {
    await expect(generationStart({ ...base, request })).rejects.toEqual(new GenerationApiError(code))
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('accepts a request at the exact 4096 UTF-8 byte boundary', async () => {
    const request = '한'.repeat(1365) + 'a'
    invokeMock.mockResolvedValue({ runId: 'run-1' })
    await expect(generationStart({ ...base, request })).resolves.toEqual({ runId: 'run-1' })
  })

  it('rejects internally inconsistent succeeded provenance', async () => {
    invokeMock.mockResolvedValue({ status: 'succeeded', markdown: '# Aid', paperId: '1706.03762', provider: 'claude_code', providerVersion: '1', sourceKind: 'abstract', sourceDocumentId: '550e8400-e29b-41d4-a716-446655440000', sourceRevision: 2, selectionStartUtf8: null, selectionEndUtf8: null, level: 'explain_simply', outputLanguage: 'english', generatedAt: '2026-08-18T08:00:00Z' })
    await expect(generationGetRun('run-1')).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })

  it('rejects an impossible technical polish result from an abstract', async () => {
    invokeMock.mockResolvedValue({ status: 'succeeded', markdown: '# Aid', paperId: '1706.03762', provider: 'claude_code', providerVersion: '1', sourceKind: 'abstract', sourceDocumentId: null, sourceRevision: null, selectionStartUtf8: null, selectionEndUtf8: null, level: 'technical_polish', outputLanguage: 'korean', generatedAt: '2026-08-18T08:00:00Z' })
    await expect(generationGetRun('run-1')).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })

  it('rejects a raw executable path in succeeded provider metadata', async () => {
    invokeMock.mockResolvedValue({ status: 'succeeded', markdown: '# Aid', paperId: '1706.03762', provider: 'claude_code', providerVersion: '/Users/private/bin/claude', sourceKind: 'abstract', sourceDocumentId: null, sourceRevision: null, selectionStartUtf8: null, selectionEndUtf8: null, level: 'explain_simply', outputLanguage: 'korean', generatedAt: '2026-08-18T08:00:00Z' })
    await expect(generationGetRun('run-1')).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })

  it('closes malformed backend output without exposing details', async () => {
    invokeMock.mockResolvedValue({ runId: 'valid-run', privateDetail: '/tmp/secret' })
    await expect(generationStart(base)).rejects.toEqual(new GenerationApiError('internal_unavailable'))
  })
})
