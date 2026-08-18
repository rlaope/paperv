import initSqlJs, { type Database } from 'sql.js'
import { createRequire } from 'node:module'
import { z } from 'zod'

export type { Database }

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')

interface Migration {
  version: number
  up: string
  down: string
}

const migrations: readonly Migration[] = [{
  version: 1,
  up: `
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  down: 'DROP TABLE app_settings;'
}]

const providerSettings = z.object({
  provider: z.string().min(1),
  credentialRef: z.string().min(1).startsWith('keychain:')
}).strict()

function ensureMigrationTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
}

export function currentVersion(db: Database): number {
  ensureMigrationTable(db)
  const result = db.exec('SELECT COALESCE(MAX(version), 0) FROM schema_migrations')
  return Number(result[0]?.values[0]?.[0] ?? 0)
}

export function migrateUp(db: Database): void {
  ensureMigrationTable(db)
  const version = currentVersion(db)
  for (const migration of migrations.filter((item) => item.version > version)) {
    db.run('BEGIN IMMEDIATE')
    try {
      db.run(migration.up)
      db.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', [migration.version, new Date(0).toISOString()])
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  }
}

export function migrateDown(db: Database): void {
  ensureMigrationTable(db)
  const version = currentVersion(db)
  const migration = migrations.find((item) => item.version === version)
  if (!migration) return
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(migration.down)
    db.run('DELETE FROM schema_migrations WHERE version = ?', [migration.version])
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

export async function createDatabase(bytes?: Uint8Array): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database()
  migrateUp(db)
  return db
}

export function saveProviderSettings(db: Database, input: z.input<typeof providerSettings>): void {
  const settings = providerSettings.parse(input)
  db.run(
    `INSERT INTO app_settings(id, provider, credential_ref, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, credential_ref=excluded.credential_ref, updated_at=excluded.updated_at`,
    [settings.provider, settings.credentialRef, new Date(0).toISOString()]
  )
}
