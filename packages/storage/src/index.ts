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
  requiredTables: readonly string[]
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
  down: 'DROP TABLE app_settings;',
  requiredTables: ['app_settings']
}]

const providerSettings = z.object({
  provider: z.string().min(1),
  credentialRef: z.string().regex(
    /^keychain:paprv:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'credentialRef must be a keychain:paprv UUID reference'
  )
}).strict()

export function validateMigrationVersions(versions: readonly number[]): void {
  for (let index = 0; index < versions.length; index += 1) {
    if (!Number.isSafeInteger(versions[index]) || versions[index] !== index + 1) {
      throw new Error('Migration list must be sorted, unique, and contiguous from version 1')
    }
  }
}

function validateMigrationList(): void {
  validateMigrationVersions(migrations.map((migration) => migration.version))
}

function ensureMigrationTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
}

function readAppliedVersions(db: Database): number[] {
  const result = db.exec('SELECT version FROM schema_migrations ORDER BY version')
  return (result[0]?.values ?? []).map((row) => Number(row[0]))
}

function tableExists(db: Database, table: string): boolean {
  const statement = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
  try {
    statement.bind([table])
    return statement.step()
  } finally {
    statement.free()
  }
}

function validateAppliedPrefix(db: Database): number[] {
  const applied = readAppliedVersions(db)
  if (
    applied.length > migrations.length ||
    applied.some((version, index) => version !== migrations[index]?.version)
  ) {
    throw new Error('Database applied migration prefix does not match the application migration list')
  }

  for (const [index, migration] of migrations.entries()) {
    const shouldExist = index < applied.length
    for (const table of migration.requiredTables) {
      if (tableExists(db, table) !== shouldExist) {
        throw new Error(`Database schema mismatch for migration ${migration.version}: table ${table}`)
      }
    }
  }
  return applied
}

export function currentVersion(db: Database): number {
  validateMigrationList()
  ensureMigrationTable(db)
  const applied = validateAppliedPrefix(db)
  return applied.at(-1) ?? 0
}

export function migrateUp(db: Database): void {
  validateMigrationList()
  ensureMigrationTable(db)
  const version = currentVersion(db)
  for (const migration of migrations.slice(version)) {
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
  currentVersion(db)
}

export function migrateDown(db: Database): void {
  validateMigrationList()
  ensureMigrationTable(db)
  const version = currentVersion(db)
  const migration = migrations[version - 1]
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
  currentVersion(db)
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
