import { describe, expect, it } from 'vitest'
import { createDatabase, currentVersion, migrateDown, migrateUp } from '../../packages/storage/src/index'

describe('SQLite migrations', () => {
  it('creates a fresh database at the latest version', async () => {
    const db = await createDatabase()
    expect(currentVersion(db)).toBe(1)
    expect(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")[0]?.values).toEqual([['app_settings']])
    db.close()
  })

  it('supports down then up without leaving schema drift', async () => {
    const db = await createDatabase()
    migrateDown(db)
    expect(currentVersion(db)).toBe(0)
    expect(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")).toEqual([])
    migrateUp(db)
    expect(currentVersion(db)).toBe(1)
    db.close()
  })
})
