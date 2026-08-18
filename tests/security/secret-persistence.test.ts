import { describe, expect, it } from 'vitest'
import { createDatabase, saveProviderSettings } from '../../packages/storage/src/index'
import { createSafeLogger } from '../../apps/desktop/src/main/safe-logger'

describe('API key containment', () => {
  it('redacts keys from logs and stores only credential references in SQLite', async () => {
    const secret = ['sk', 'live', 'never-persist-this-value'].join('-')
    const lines: string[] = []
    const logger = createSafeLogger((line) => lines.push(line))
    logger.info('provider configured', { apiKey: secret, nested: { authorization: `Bearer ${secret}` } })

    const db = await createDatabase()
    saveProviderSettings(db, { provider: 'openai', credentialRef: 'keychain:paprv/openai' })
    const databaseBytes = db.export()
    const databaseText = new TextDecoder().decode(databaseBytes)
    const logText = lines.join('\n')

    expect(logText).not.toContain(secret)
    expect(logText).toContain('[REDACTED]')
    expect(databaseText).not.toContain(secret)
    expect(databaseText).toContain('keychain:paprv/openai')
    db.close()
  })
})
