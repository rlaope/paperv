import { describe, expect, it } from 'vitest'
import { createDatabase, saveProviderSettings } from '../../packages/storage/src/index'
import { createSafeLogger } from '../../apps/desktop/src/main/safe-logger'

const opaqueCredentialRef = 'keychain:paprv:550e8400-e29b-41d4-a716-446655440000'

function providerSecrets(): string[] {
  return [
    ['sk', 'proj', '0123456789abcdefghijklmnop'].join('-'),
    ['sk', 'ant', 'api03', '0123456789abcdefghijklmnop'].join('-'),
    `AIza${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`,
    `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'}`,
    `github_pat_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`,
    'eyJhbG...6789',
    `Bearer ${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'}`,
    '0123456789abcdef0123456789abcdef',
    '0123456789abcdef'.repeat(4),
    `xoxb-${'0123456789abcdef'.repeat(3)}`
  ]
}

describe('API key containment', () => {
  it('stores only an app-namespaced UUID credential reference', async () => {
    const db = await createDatabase()
    saveProviderSettings(db, { provider: 'openai', credentialRef: opaqueCredentialRef })

    expect(db.exec('SELECT credential_ref FROM app_settings')[0]?.values).toEqual([[opaqueCredentialRef]])
    db.close()
  })

  it.each([
    '',
    ['sk', 'live', 'never-persist-this-value'].join('-'),
    `AIza${'A'.repeat(35)}`,
    `keychain:${['sk', 'live', 'never-persist-this-value'].join('-')}`,
    'keychain:paprv/openai',
    `keychain:paprv:${'x'.repeat(200)}`,
    `keychain:paprv:AIza${'A'.repeat(35)}`
  ])('rejects a non-opaque credential reference: %s', async (credentialRef) => {
    const db = await createDatabase()
    expect(() => saveProviderSettings(db, { provider: 'openai', credentialRef })).toThrow()
    expect(db.exec('SELECT credential_ref FROM app_settings')).toEqual([])
    db.close()
  })

  it.each(providerSecrets())('rejects a secret-shaped provider without persisting its bytes: %s', async (provider) => {
    const db = await createDatabase()
    const unsafeSave = saveProviderSettings as (database: typeof db, input: unknown) => void

    expect(() => unsafeSave(db, { provider, credentialRef: opaqueCredentialRef })).toThrow()
    expect(new TextDecoder().decode(db.export())).not.toContain(provider)
    db.close()
  })

  it.each(providerSecrets())('rejects secrets at every logger string boundary before writing: %s', (secret) => {
    const lines: string[] = []
    const logger = createSafeLogger((line) => lines.push(line))
    const unsafeError = logger.error as (event: unknown, context?: unknown) => void

    expect(() => unsafeError(secret)).toThrow()
    expect(() => unsafeError('provider.request.failed', { provider: secret })).toThrow()
    expect(() => unsafeError('provider.request.failed', { operation: secret })).toThrow()
    expect(() => unsafeError('provider.request.failed', { errorCode: secret })).toThrow()
    expect(lines).toEqual([])
  })

  it('writes only a fixed event and validated scalar context', () => {
    const lines: string[] = []
    const logger = createSafeLogger((line) => lines.push(line))

    logger.error('provider.request.failed', {
      provider: 'openai',
      operation: 'provider.configure',
      errorCode: 'PROVIDER_UNAVAILABLE',
      durationMs: 12,
      retryable: true
    })

    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'error',
      event: 'provider.request.failed',
      context: {
        provider: 'openai',
        operation: 'provider.configure',
        errorCode: 'PROVIDER_UNAVAILABLE',
        durationMs: 12,
        retryable: true
      }
    })
  })
})
