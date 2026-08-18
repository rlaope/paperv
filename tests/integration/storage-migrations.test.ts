import { describe, expect, it } from 'vitest'
import {
  createDatabase,
  currentVersion,
  migrateDown,
  migrateUp,
  validateMigrationVersions
} from '../../packages/storage/src/index'

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

  it.each([
    { versions: [1, 3] },
    { versions: [1, 1] },
    { versions: [2, 1] }
  ])('rejects a migration list that is not a sorted unique sequence from one: $versions', ({ versions }) => {
    expect(() => validateMigrationVersions(versions)).toThrow(/migration list/i)
  })

  it('accepts a sorted unique migration sequence from one', () => {
    expect(() => validateMigrationVersions([1, 2, 3])).not.toThrow()
  })

  it('rejects an unknown future applied migration', async () => {
    const db = await createDatabase()
    db.run("INSERT INTO schema_migrations(version, applied_at) VALUES (999, 'future')")
    expect(() => currentVersion(db)).toThrow(/applied migration prefix/i)
    db.close()
  })

  it('rejects a gap in applied migrations', async () => {
    const db = await createDatabase()
    db.run('DELETE FROM schema_migrations')
    db.run("INSERT INTO schema_migrations(version, applied_at) VALUES (2, 'gap')")
    expect(() => currentVersion(db)).toThrow(/applied migration prefix/i)
    db.close()
  })

  it('rejects a version row when its required table is absent', async () => {
    const db = await createDatabase()
    db.run('DROP TABLE app_settings')
    expect(() => currentVersion(db)).toThrow(/schema mismatch/i)
    db.close()
  })

  it('rejects an applied migration backed by an impostor app_settings schema', async () => {
    const db = await createDatabase()
    migrateDown(db)
    db.run('CREATE TABLE app_settings(foo TEXT)')
    db.run("INSERT INTO schema_migrations(version, applied_at) VALUES (1, 'impostor')")

    expect(() => currentVersion(db)).toThrow(/schema mismatch/i)
    db.close()
  })

  it('rejects drift in app_settings column constraints and id check', async () => {
    const db = await createDatabase()
    db.run('DROP TABLE app_settings')
    db.run(`CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY,
      provider TEXT,
      credential_ref BLOB NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    expect(() => currentVersion(db)).toThrow(/schema mismatch/i)
    db.close()
  })

  it('rejects canonical columns when the singleton id check is absent', async () => {
    const db = await createDatabase()
    db.run('DROP TABLE app_settings')
    db.run(`CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY,
      provider TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    expect(() => currentVersion(db)).toThrow(/schema mismatch/i)
    db.close()
  })

  it('rolls back schema changes and the version row when a migration fails', async () => {
    const db = await createDatabase()
    migrateDown(db)
    db.run(`
      CREATE TRIGGER reject_migration_version
      BEFORE INSERT ON schema_migrations
      BEGIN
        SELECT RAISE(ABORT, 'injected migration failure');
      END;
    `)

    expect(() => migrateUp(db)).toThrow(/injected migration failure/i)
    expect(db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")).toEqual([])
    expect(db.exec('SELECT version FROM schema_migrations')).toEqual([])
    db.close()
  })
})
