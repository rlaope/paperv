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

const appSettingsDdl = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'xai', 'ollama')),
    credential_ref TEXT NOT NULL CHECK (
      length(credential_ref) = 51 AND
      substr(credential_ref, 1, 15) = 'keychain:paprv:' AND
      substr(credential_ref, 16, 8) NOT GLOB '*[^0-9a-f]*' AND
      substr(credential_ref, 24, 1) = '-' AND
      substr(credential_ref, 25, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(credential_ref, 29, 1) = '-' AND
      substr(credential_ref, 30, 1) IN ('1', '2', '3', '4', '5') AND
      substr(credential_ref, 30, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(credential_ref, 34, 1) = '-' AND
      substr(credential_ref, 35, 1) IN ('8', '9', 'a', 'b') AND
      substr(credential_ref, 35, 4) NOT GLOB '*[^0-9a-f]*' AND
      substr(credential_ref, 39, 1) = '-' AND
      substr(credential_ref, 40, 12) NOT GLOB '*[^0-9a-f]*'
    ),
    updated_at TEXT NOT NULL
  );
`

const schemaMigrationsDdl = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`

const migrations: readonly Migration[] = [{
  version: 1,
  up: appSettingsDdl,
  down: 'DROP TABLE app_settings;',
  requiredTables: ['app_settings']
}]

const providerSettings = z.object({
  provider: z.enum(['openai', 'anthropic', 'google', 'xai', 'ollama']),
  credentialRef: z.string().regex(
    /^keychain:paprv:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'credentialRef must be a keychain:paprv UUID reference'
  )
}).strict()

export type ProviderId = z.infer<typeof providerSettings>['provider']

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
  if (!tableExists(db, 'schema_migrations')) db.run(schemaMigrationsDdl)
  if (!hasCanonicalTableSchema(db, 'schema_migrations', expectedSchemaMigrationsColumns, schemaMigrationsDdl)) {
    throw new Error('Database schema_migrations schema mismatch: columns or constraints')
  }
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

const expectedAppSettingsColumns = [
  ['id', 'INTEGER', 0, 1],
  ['provider', 'TEXT', 1, 0],
  ['credential_ref', 'TEXT', 1, 0],
  ['updated_at', 'TEXT', 1, 0]
] as const

const expectedSchemaMigrationsColumns = [
  ['version', 'INTEGER', 0, 1],
  ['applied_at', 'TEXT', 1, 0]
] as const

type ExpectedColumn = readonly [name: string, type: string, notNull: number, primaryKey: number]

function normalizeCreateTableSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=])\s*/g, '$1')
    .trim()
    .replace(/;$/, '')
}

function hasCanonicalTableSchema(
  db: Database,
  table: string,
  expectedColumns: readonly ExpectedColumn[],
  expectedDdl: string
): boolean {
  const tableInfo = db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []
  const columnsMatch = tableInfo.length === expectedColumns.length && tableInfo.every((row, index) => {
    const expected = expectedColumns[index]
    return expected !== undefined &&
      row[1] === expected[0] &&
      row[2] === expected[1] &&
      row[3] === expected[2] &&
      row[5] === expected[3]
  })
  if (!columnsMatch) return false

  const statement = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
  try {
    statement.bind([table])
    if (!statement.step()) return false
    const sql = statement.get()[0]
    return typeof sql === 'string' && normalizeCreateTableSql(sql) === normalizeCreateTableSql(expectedDdl)
  } finally {
    statement.free()
  }
}

function hasCanonicalAppSettingsSchema(db: Database): boolean {
  return hasCanonicalTableSchema(db, 'app_settings', expectedAppSettingsColumns, appSettingsDdl)
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
    if (shouldExist && migration.version === 1 && !hasCanonicalAppSettingsSchema(db)) {
      throw new Error('Database schema mismatch for migration 1: app_settings columns or constraints')
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
