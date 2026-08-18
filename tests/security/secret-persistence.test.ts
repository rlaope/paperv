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
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwYXBydiJ9.signature0123456789',
    `Bearer ${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'}`
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

  it.each(providerSecrets())('removes provider secrets from message and context boundaries', (secret) => {
    const lines: string[] = []
    const logger = createSafeLogger((line) => lines.push(line))

    logger.error(`provider request failed: ${secret}`, {
      detail: secret,
      provider: secret,
      operation: 'provider.configure',
      nested: { value: secret },
      items: [secret],
      durationMs: 12
    })

    const line = lines[0] ?? ''
    expect(line).not.toContain(secret)
    expect(line).toContain('[REDACTED]')
    expect(JSON.parse(line)).toMatchObject({
      level: 'error',
      context: { operation: 'provider.configure', durationMs: 12 }
    })
    expect(JSON.parse(line).context).not.toHaveProperty('detail')
    expect(JSON.parse(line).context).not.toHaveProperty('nested')
    expect(JSON.parse(line).context).not.toHaveProperty('items')
  })
})
