use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

const LEDGER_DDL: &str =
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)";
const SETTINGS_DDL: &str = r#"CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'xai', 'ollama')),
    credential_ref TEXT NOT NULL CHECK (
        length(credential_ref) = 51 AND
        credential_ref = lower(credential_ref) AND
        substr(credential_ref, 1, 15) = 'keychain:paprv:' AND
        substr(credential_ref, 16, 8) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]' AND
        substr(credential_ref, 24, 1) = '-' AND
        substr(credential_ref, 25, 4) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f]' AND
        substr(credential_ref, 29, 1) = '-' AND
        substr(credential_ref, 30, 1) = '4' AND
        substr(credential_ref, 31, 3) GLOB '[0-9a-f][0-9a-f][0-9a-f]' AND
        substr(credential_ref, 34, 1) = '-' AND
        substr(credential_ref, 35, 1) GLOB '[89ab]' AND
        substr(credential_ref, 36, 3) GLOB '[0-9a-f][0-9a-f][0-9a-f]' AND
        substr(credential_ref, 39, 1) = '-' AND
        substr(credential_ref, 40, 12) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
    ),
    updated_at TEXT NOT NULL
)"#;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database operation failed")]
    Sql(#[from] rusqlite::Error),
    #[error("migration ledger schema drift")]
    LedgerDrift,
    #[error("application settings schema drift")]
    SettingsDrift,
    #[error("unknown or non-contiguous migration history")]
    MigrationHistory,
    #[error("invalid credential reference")]
    InvalidCredentialReference,
}

#[derive(Debug, Clone, Copy)]
pub enum ProviderId {
    Openai,
    Anthropic,
    Google,
    Xai,
    Ollama,
}

impl ProviderId {
    fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
            Self::Xai => "xai",
            Self::Ollama => "ollama",
        }
    }
}

#[derive(Debug, Clone)]
pub struct CredentialRef(String);

impl TryFrom<&str> for CredentialRef {
    type Error = StorageError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        let uuid = value
            .strip_prefix("keychain:paprv:")
            .and_then(|raw| Uuid::parse_str(raw).ok())
            .filter(|id| id.get_version_num() == 4)
            .ok_or(StorageError::InvalidCredentialReference)?;
        let canonical = format!("keychain:paprv:{uuid}");
        if value != canonical {
            return Err(StorageError::InvalidCredentialReference);
        }
        Ok(Self(canonical))
    }
}

pub struct ProviderSettings {
    pub provider: ProviderId,
    pub credential_ref: CredentialRef,
}

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn table_sql(connection: &Connection, table: &str) -> Result<Option<String>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get(0),
        )
        .optional()
}

fn is_canonical(connection: &Connection, table: &str, ddl: &str) -> Result<bool, rusqlite::Error> {
    Ok(table_sql(connection, table)?.is_some_and(|sql| normalized(&sql) == normalized(ddl)))
}

pub fn open_or_initialize(path: &Path) -> Result<Connection, StorageError> {
    let mut connection = Connection::open(path)?;
    migrate_up(&mut connection)?;
    Ok(connection)
}

fn ensure_ledger(connection: &Connection) -> Result<(), StorageError> {
    if table_sql(connection, "schema_migrations")?.is_none() {
        connection.execute(LEDGER_DDL, [])?;
    }
    if !is_canonical(connection, "schema_migrations", LEDGER_DDL)? {
        return Err(StorageError::LedgerDrift);
    }
    Ok(())
}

pub fn current_version(connection: &Connection) -> Result<u32, StorageError> {
    ensure_ledger(connection)?;
    let mut statement =
        connection.prepare("SELECT version FROM schema_migrations ORDER BY version")?;
    let versions = statement
        .query_map([], |row| row.get::<_, u32>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let version = match versions.as_slice() {
        [] => 0,
        [1] => 1,
        _ => return Err(StorageError::MigrationHistory),
    };
    let settings_exists = table_sql(connection, "app_settings")?.is_some();
    if version == 0 && settings_exists {
        return Err(StorageError::SettingsDrift);
    }
    if version == 1 && !is_canonical(connection, "app_settings", SETTINGS_DDL)? {
        return Err(StorageError::SettingsDrift);
    }
    Ok(version)
}

pub fn migrate_up(connection: &mut Connection) -> Result<(), StorageError> {
    let version = current_version(connection)?;
    if version == 1 {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    transaction.execute(SETTINGS_DDL, [])?;
    transaction.execute(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (1, '1970-01-01T00:00:00Z')",
        [],
    )?;
    transaction.commit()?;
    if current_version(connection)? != 1 {
        return Err(StorageError::MigrationHistory);
    }
    Ok(())
}

pub fn migrate_down(connection: &mut Connection) -> Result<(), StorageError> {
    if current_version(connection)? == 0 {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    transaction.execute("DROP TABLE app_settings", [])?;
    transaction.execute("DELETE FROM schema_migrations WHERE version = 1", [])?;
    transaction.commit()?;
    if current_version(connection)? != 0 {
        return Err(StorageError::MigrationHistory);
    }
    Ok(())
}

pub fn save_provider_settings(
    connection: &Connection,
    settings: &ProviderSettings,
) -> Result<(), StorageError> {
    if current_version(connection)? != 1 {
        return Err(StorageError::MigrationHistory);
    }
    connection.execute(
        "INSERT INTO app_settings(id, provider, credential_ref, updated_at) VALUES (1, ?1, ?2, '1970-01-01T00:00:00Z') ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, credential_ref = excluded.credential_ref, updated_at = excluded.updated_at",
        params![settings.provider.as_str(), settings.credential_ref.0],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Connection {
        Connection::open_in_memory().unwrap()
    }

    #[test]
    fn migrates_fresh_up_and_down_reversibly() {
        let mut connection = fresh();
        migrate_up(&mut connection).unwrap();
        assert_eq!(current_version(&connection).unwrap(), 1);
        migrate_down(&mut connection).unwrap();
        assert_eq!(current_version(&connection).unwrap(), 0);
        migrate_up(&mut connection).unwrap();
        assert_eq!(current_version(&connection).unwrap(), 1);
    }

    #[test]
    fn rejects_unknown_and_gapped_history() {
        let connection = fresh();
        ensure_ledger(&connection).unwrap();
        connection
            .execute("INSERT INTO schema_migrations VALUES (2, 'future')", [])
            .unwrap();
        assert!(matches!(
            current_version(&connection),
            Err(StorageError::MigrationHistory)
        ));
    }

    #[test]
    fn rejects_ledger_and_application_schema_drift() {
        let ledger_drift = fresh();
        ledger_drift.execute("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, extra TEXT)", []).unwrap();
        assert!(matches!(
            current_version(&ledger_drift),
            Err(StorageError::LedgerDrift)
        ));

        let settings_drift = fresh();
        ensure_ledger(&settings_drift).unwrap();
        settings_drift
            .execute("CREATE TABLE app_settings(id INTEGER PRIMARY KEY)", [])
            .unwrap();
        settings_drift
            .execute("INSERT INTO schema_migrations VALUES (1, 'applied')", [])
            .unwrap();
        assert!(matches!(
            current_version(&settings_drift),
            Err(StorageError::SettingsDrift)
        ));
    }

    #[test]
    fn rolls_back_schema_when_version_recording_fails() {
        let mut connection = fresh();
        ensure_ledger(&connection).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_version BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT, 'rejected'); END;").unwrap();
        assert!(migrate_up(&mut connection).is_err());
        assert!(table_sql(&connection, "app_settings").unwrap().is_none());
    }

    #[test]
    fn persists_only_closed_providers_and_canonical_v4_keychain_references() {
        let mut connection = fresh();
        migrate_up(&mut connection).unwrap();
        let credential_ref =
            CredentialRef::try_from("keychain:paprv:550e8400-e29b-41d4-a716-446655440000").unwrap();
        save_provider_settings(
            &connection,
            &ProviderSettings {
                provider: ProviderId::Openai,
                credential_ref,
            },
        )
        .unwrap();
        let row: (String, String) = connection
            .query_row(
                "SELECT provider, credential_ref FROM app_settings",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (
                "openai".into(),
                "keychain:paprv:550e8400-e29b-41d4-a716-446655440000".into()
            )
        );
        assert!(CredentialRef::try_from("sk-secret-value").is_err());
    }

    #[test]
    fn database_constraints_reject_bypasses() {
        let mut connection = fresh();
        migrate_up(&mut connection).unwrap();
        for (provider, reference) in [
            (
                "secret-provider",
                "keychain:paprv:550e8400-e29b-41d4-a716-446655440000",
            ),
            ("openai", "raw-api-key"),
            (
                "openai",
                "keychain:paprv:550e8400-e29b-61d4-a716-446655440000",
            ),
            (
                "openai",
                "keychain:paprv:550e8400-e29b-41d4-c716-446655440000",
            ),
            (
                "openai",
                "keychain:paprv:550e8400-e29b-41d4-a716-44665544000g",
            ),
        ] {
            assert!(connection.execute("INSERT OR REPLACE INTO app_settings(id, provider, credential_ref, updated_at) VALUES (1, ?1, ?2, 'now')", params![provider, reference]).is_err());
        }
        let count: u32 = connection
            .query_row("SELECT count(*) FROM app_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
