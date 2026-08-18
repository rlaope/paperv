use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
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
const PAPERS_DDL: &str = r#"CREATE TABLE papers (
  arxiv_id TEXT PRIMARY KEY CHECK (length(arxiv_id) BETWEEN 4 AND 64 AND arxiv_id = trim(arxiv_id)),
  arxiv_version INTEGER NOT NULL CHECK (arxiv_version BETWEEN 1 AND 999999),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 4096 AND title = trim(title)),
  summary TEXT NOT NULL CHECK (length(summary) <= 65536),
  authors_json TEXT NOT NULL CHECK (json_valid(authors_json) AND json_type(authors_json) = 'array'),
  categories_json TEXT NOT NULL CHECK (json_valid(categories_json) AND json_type(categories_json) = 'array'),
  published_at TEXT NOT NULL CHECK (length(published_at) BETWEEN 20 AND 40),
  source_updated_at TEXT NOT NULL CHECK (length(source_updated_at) BETWEEN 20 AND 40),
  imported_at TEXT NOT NULL CHECK (length(imported_at) BETWEEN 20 AND 40),
  metadata_fetched_at TEXT NOT NULL CHECK (length(metadata_fetched_at) BETWEEN 20 AND 40)
)"#;
const PAPERS_ORDER_INDEX_DDL: &str =
    "CREATE INDEX papers_order_idx ON papers(metadata_fetched_at DESC, arxiv_id ASC)";
const NOTES_DDL: &str = r#"CREATE TABLE notes (
  paper_arxiv_id TEXT PRIMARY KEY REFERENCES papers(arxiv_id) ON DELETE CASCADE,
  markdown TEXT NOT NULL CHECK (length(markdown) <= 262144),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
)"#;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("database operation failed")]
    Sql(#[from] rusqlite::Error),
    #[error("migration ledger schema drift")]
    LedgerDrift,
    #[error("application settings schema drift")]
    SettingsDrift,
    #[error("paper schema drift")]
    PapersDrift,
    #[error("note schema drift")]
    NotesDrift,
    #[error("unknown or non-contiguous migration history")]
    MigrationHistory,
    #[error("invalid credential reference")]
    InvalidCredentialReference,
    #[error("paper not found")]
    PaperNotFound,
}

#[derive(Debug, Clone)]
pub struct PaperMetadata {
    pub arxiv_id: String,
    pub arxiv_version: u32,
    pub title: String,
    pub summary: String,
    pub authors: Vec<String>,
    pub categories: Vec<String>,
    pub published_at: String,
    pub source_updated_at: String,
}
#[derive(Debug, Clone)]
pub struct StoredNote {
    pub markdown: String,
    pub updated_at: String,
}
#[derive(Debug, Clone)]
pub struct StoredPaper {
    pub metadata: PaperMetadata,
    pub imported_at: String,
    pub metadata_fetched_at: String,
    pub note: Option<StoredNote>,
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
        let id = value
            .strip_prefix("keychain:paprv:")
            .and_then(|raw| Uuid::parse_str(raw).ok())
            .filter(|id| id.get_version_num() == 4)
            .ok_or(StorageError::InvalidCredentialReference)?;
        let canonical = format!("keychain:paprv:{id}");
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

fn valid_metadata(metadata: &PaperMetadata) -> bool {
    metadata.arxiv_id.chars().count() <= 64
        && !metadata.arxiv_id.is_empty()
        && metadata.arxiv_version > 0
        && metadata.title.chars().count() <= 4_096
        && !metadata.title.trim().is_empty()
        && metadata.title == metadata.title.trim()
        && metadata.summary.chars().count() <= 65_536
        && (1..=64).contains(&metadata.authors.len())
        && (1..=64).contains(&metadata.categories.len())
        && metadata
            .authors
            .iter()
            .all(|value| !value.trim().is_empty() && value.chars().count() <= 512)
        && metadata
            .categories
            .iter()
            .all(|value| !value.trim().is_empty() && value.chars().count() <= 512)
        && [&metadata.published_at, &metadata.source_updated_at]
            .iter()
            .all(|value| (20..=40).contains(&value.chars().count()))
}

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn object_sql(
    connection: &Connection,
    kind: &str,
    name: &str,
) -> Result<Option<String>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
            params![kind, name],
            |row| row.get(0),
        )
        .optional()
}
fn canonical(
    connection: &Connection,
    kind: &str,
    name: &str,
    ddl: &str,
) -> Result<bool, rusqlite::Error> {
    Ok(object_sql(connection, kind, name)?.is_some_and(|sql| normalized(&sql) == normalized(ddl)))
}
fn table_exists(connection: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    Ok(object_sql(connection, "table", name)?.is_some())
}

pub fn open_connection(path: &Path) -> Result<Connection, StorageError> {
    let connection = Connection::open(path)?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    let enabled: i64 = connection.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    if enabled != 1 {
        return Err(StorageError::MigrationHistory);
    };
    Ok(connection)
}
pub fn open_or_initialize(path: &Path) -> Result<Connection, StorageError> {
    let mut c = open_connection(path)?;
    migrate_up(&mut c)?;
    Ok(c)
}
fn ensure_ledger(c: &Connection) -> Result<(), StorageError> {
    if !table_exists(c, "schema_migrations")? {
        c.execute(LEDGER_DDL, [])?;
    }
    if !canonical(c, "table", "schema_migrations", LEDGER_DDL)? {
        return Err(StorageError::LedgerDrift);
    }
    Ok(())
}
pub fn current_version(c: &Connection) -> Result<u32, StorageError> {
    ensure_ledger(c)?;
    let versions = c
        .prepare("SELECT version FROM schema_migrations ORDER BY version")?
        .query_map([], |r| r.get::<_, u32>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let version = match versions.as_slice() {
        [] => 0,
        [1] => 1,
        [1, 2] => 2,
        _ => return Err(StorageError::MigrationHistory),
    };
    let settings = table_exists(c, "app_settings")?;
    let papers = table_exists(c, "papers")?;
    let notes = table_exists(c, "notes")?;
    if (version == 0 && (settings || papers || notes))
        || (version >= 1 && !canonical(c, "table", "app_settings", SETTINGS_DDL)?)
    {
        return Err(StorageError::SettingsDrift);
    };
    if version < 2 && (papers || notes) {
        return Err(StorageError::PapersDrift);
    };
    if version == 2
        && (!canonical(c, "table", "papers", PAPERS_DDL)?
            || !canonical(c, "index", "papers_order_idx", PAPERS_ORDER_INDEX_DDL)?)
    {
        return Err(StorageError::PapersDrift);
    };
    if version == 2 && !canonical(c, "table", "notes", NOTES_DDL)? {
        return Err(StorageError::NotesDrift);
    };
    Ok(version)
}
pub fn migrate_up(c: &mut Connection) -> Result<(), StorageError> {
    let mut version = current_version(c)?;
    while version < 2 {
        let tx = c.transaction()?;
        if version == 0 {
            tx.execute(SETTINGS_DDL, [])?;
            tx.execute(
                "INSERT INTO schema_migrations VALUES(1,'1970-01-01T00:00:00Z')",
                [],
            )?;
        } else {
            tx.execute(PAPERS_DDL, [])?;
            tx.execute(PAPERS_ORDER_INDEX_DDL, [])?;
            tx.execute(NOTES_DDL, [])?;
            tx.execute(
                "INSERT INTO schema_migrations VALUES(2,'1970-01-01T00:00:00Z')",
                [],
            )?;
        }
        tx.commit()?;
        version += 1;
    }
    current_version(c).map(|_| ())
}
pub fn migrate_down(c: &mut Connection) -> Result<(), StorageError> {
    let mut version = current_version(c)?;
    while version > 0 {
        let tx = c.transaction()?;
        if version == 2 {
            tx.execute("DROP TABLE notes", [])?;
            tx.execute("DROP INDEX papers_order_idx", [])?;
            tx.execute("DROP TABLE papers", [])?;
            tx.execute("DELETE FROM schema_migrations WHERE version=2", [])?;
        } else {
            tx.execute("DROP TABLE app_settings", [])?;
            tx.execute("DELETE FROM schema_migrations WHERE version=1", [])?;
        }
        tx.commit()?;
        version -= 1;
    }
    current_version(c).map(|_| ())
}
pub fn save_provider_settings(c: &Connection, s: &ProviderSettings) -> Result<(), StorageError> {
    if current_version(c)? < 1 {
        return Err(StorageError::MigrationHistory);
    };
    c.execute("INSERT INTO app_settings(id,provider,credential_ref,updated_at) VALUES(1,?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,credential_ref=excluded.credential_ref,updated_at=excluded.updated_at",params![s.provider.as_str(),s.credential_ref.0])?;
    Ok(())
}

pub fn upsert_paper(c: &mut Connection, metadata: &PaperMetadata) -> Result<(), StorageError> {
    if !valid_metadata(metadata) {
        return Err(StorageError::PapersDrift);
    }
    if current_version(c)? != 2 {
        return Err(StorageError::MigrationHistory);
    };
    let tx = c.transaction()?;
    tx.execute("INSERT INTO papers(arxiv_id,arxiv_version,title,summary,authors_json,categories_json,published_at,source_updated_at,imported_at,metadata_fetched_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(arxiv_id) DO UPDATE SET arxiv_version=excluded.arxiv_version,title=excluded.title,summary=excluded.summary,authors_json=excluded.authors_json,categories_json=excluded.categories_json,published_at=excluded.published_at,source_updated_at=excluded.source_updated_at,metadata_fetched_at=excluded.metadata_fetched_at",params![metadata.arxiv_id,metadata.arxiv_version,metadata.title,metadata.summary,json!(metadata.authors).to_string(),json!(metadata.categories).to_string(),metadata.published_at,metadata.source_updated_at])?;
    tx.commit()?;
    Ok(())
}
pub fn save_note(c: &mut Connection, id: &str, markdown: &str) -> Result<StoredNote, StorageError> {
    if markdown.chars().count() > 262_144 {
        return Err(StorageError::NotesDrift);
    }
    let tx = c.transaction()?;
    if tx
        .query_row("SELECT 1 FROM papers WHERE arxiv_id=?1", [id], |_| Ok(()))
        .optional()?
        .is_none()
    {
        return Err(StorageError::PaperNotFound);
    };
    tx.execute("INSERT INTO notes(paper_arxiv_id,markdown,created_at,updated_at) VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(paper_arxiv_id) DO UPDATE SET markdown=excluded.markdown,updated_at=excluded.updated_at",params![id,markdown])?;
    let note = tx.query_row(
        "SELECT markdown,updated_at FROM notes WHERE paper_arxiv_id=?1",
        [id],
        |r| {
            Ok(StoredNote {
                markdown: r.get(0)?,
                updated_at: r.get(1)?,
            })
        },
    )?;
    tx.commit()?;
    Ok(note)
}
pub fn get_paper(c: &Connection, id: &str) -> Result<StoredPaper, StorageError> {
    c.query_row("SELECT p.arxiv_id,p.arxiv_version,p.title,p.summary,p.authors_json,p.categories_json,p.published_at,p.source_updated_at,p.imported_at,p.metadata_fetched_at,n.markdown,n.updated_at FROM papers p LEFT JOIN notes n ON n.paper_arxiv_id=p.arxiv_id WHERE p.arxiv_id=?1",[id],row_to_paper).optional()?.ok_or(StorageError::PaperNotFound)
}
pub fn list_papers(c: &Connection) -> Result<Vec<StoredPaper>, StorageError> {
    let mut s=c.prepare("SELECT p.arxiv_id,p.arxiv_version,p.title,p.summary,p.authors_json,p.categories_json,p.published_at,p.source_updated_at,p.imported_at,p.metadata_fetched_at,n.markdown,n.updated_at FROM papers p LEFT JOIN notes n ON n.paper_arxiv_id=p.arxiv_id ORDER BY p.metadata_fetched_at DESC,p.arxiv_id ASC")?;
    s.query_map([], row_to_paper)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}
fn row_to_paper(row: &rusqlite::Row<'_>) -> Result<StoredPaper, rusqlite::Error> {
    let authors: Vec<String> = serde_json::from_str(&row.get::<_, String>(4)?)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    let categories: Vec<String> = serde_json::from_str(&row.get::<_, String>(5)?)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    let markdown: Option<String> = row.get(10)?;
    Ok(StoredPaper {
        metadata: PaperMetadata {
            arxiv_id: row.get(0)?,
            arxiv_version: row.get(1)?,
            title: row.get(2)?,
            summary: row.get(3)?,
            authors,
            categories,
            published_at: row.get(6)?,
            source_updated_at: row.get(7)?,
        },
        imported_at: row.get(8)?,
        metadata_fetched_at: row.get(9)?,
        note: markdown.map(|markdown| StoredNote {
            markdown,
            updated_at: row.get(11).unwrap_or_default(),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        c
    }
    fn sample_metadata() -> PaperMetadata {
        PaperMetadata {
            arxiv_id: "1706.03762".into(),
            arxiv_version: 1,
            title: "Title".into(),
            summary: "".into(),
            authors: vec!["A".into()],
            categories: vec!["cs.CL".into()],
            published_at: "2017-01-01T00:00:00Z".into(),
            source_updated_at: "2017-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn migration_matrix_supports_v0_v1_v2_and_reversible_reinitialization() {
        let mut v0 = fresh();
        migrate_up(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 2);

        let mut v1 = fresh();
        ensure_ledger(&v1).unwrap();
        v1.execute(SETTINGS_DDL, []).unwrap();
        v1.execute(
            "INSERT INTO schema_migrations VALUES(1,'1970-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        assert_eq!(current_version(&v1).unwrap(), 1);
        migrate_up(&mut v1).unwrap();
        assert_eq!(current_version(&v1).unwrap(), 2);

        migrate_down(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 0);
        migrate_up(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 2);
    }

    #[test]
    fn migration_history_and_schema_drift_are_rejected_at_each_version() {
        let unknown = fresh();
        ensure_ledger(&unknown).unwrap();
        unknown
            .execute("INSERT INTO schema_migrations VALUES(3,'future')", [])
            .unwrap();
        assert!(matches!(
            current_version(&unknown),
            Err(StorageError::MigrationHistory)
        ));

        let gap = fresh();
        ensure_ledger(&gap).unwrap();
        gap.execute("INSERT INTO schema_migrations VALUES(2,'future')", [])
            .unwrap();
        assert!(matches!(
            current_version(&gap),
            Err(StorageError::MigrationHistory)
        ));

        let missing_v1 = fresh();
        ensure_ledger(&missing_v1).unwrap();
        missing_v1
            .execute("INSERT INTO schema_migrations VALUES(1,'applied')", [])
            .unwrap();
        assert!(matches!(
            current_version(&missing_v1),
            Err(StorageError::SettingsDrift)
        ));

        let mut missing_v2 = fresh();
        migrate_up(&mut missing_v2).unwrap();
        missing_v2
            .execute("DROP INDEX papers_order_idx", [])
            .unwrap();
        assert!(matches!(
            current_version(&missing_v2),
            Err(StorageError::PapersDrift)
        ));

        let mut drifted_v2 = fresh();
        migrate_up(&mut drifted_v2).unwrap();
        drifted_v2.execute("DROP TABLE notes", []).unwrap();
        drifted_v2
            .execute(
                "CREATE TABLE notes(paper_arxiv_id TEXT PRIMARY KEY, markdown TEXT NOT NULL)",
                [],
            )
            .unwrap();
        assert!(matches!(
            current_version(&drifted_v2),
            Err(StorageError::NotesDrift)
        ));
    }

    #[test]
    fn migration_steps_roll_back_when_the_ledger_rejects_recording() {
        let mut c = fresh();
        ensure_ledger(&c).unwrap();
        c.execute_batch("CREATE TRIGGER reject_version BEFORE INSERT ON schema_migrations BEGIN SELECT RAISE(ABORT, 'rejected'); END;").unwrap();
        assert!(migrate_up(&mut c).is_err());
        assert!(!table_exists(&c, "app_settings").unwrap());
        assert_eq!(current_version(&c).unwrap(), 0);
    }

    #[test]
    fn database_constraints_and_api_reject_invalid_credentials_and_note_writes() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        let credential_ref =
            CredentialRef::try_from("keychain:paprv:550e8400-e29b-41d4-a716-446655440000").unwrap();
        save_provider_settings(
            &c,
            &ProviderSettings {
                provider: ProviderId::Openai,
                credential_ref,
            },
        )
        .unwrap();
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
        ] {
            assert!(c.execute("INSERT OR REPLACE INTO app_settings(id,provider,credential_ref,updated_at) VALUES(1,?1,?2,'now')", params![provider, reference]).is_err());
        }
        assert!(CredentialRef::try_from("***").is_err());
        assert!(save_note(&mut c, "missing", "note").is_err());
        assert!(c.execute("INSERT INTO notes VALUES('missing','note','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')", []).is_err());
        upsert_paper(&mut c, &sample_metadata()).unwrap();
        assert!(save_note(&mut c, "1706.03762", &"x".repeat(262_145)).is_err());
        assert!(c.execute("INSERT INTO notes VALUES('1706.03762',?1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')", [&"x".repeat(262_145)]).is_err());
    }

    #[test]
    fn paper_upsert_preserves_note() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        let meta = sample_metadata();
        upsert_paper(&mut c, &meta).unwrap();
        save_note(&mut c, "1706.03762", "# note").unwrap();
        let mut updated = meta.clone();
        updated.title = "Updated".into();
        upsert_paper(&mut c, &updated).unwrap();
        let paper = get_paper(&c, "1706.03762").unwrap();
        assert_eq!(paper.metadata.title, "Updated");
        assert_eq!(paper.note.unwrap().markdown, "# note");
    }
}
