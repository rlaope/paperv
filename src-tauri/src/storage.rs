use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::json;
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

pub const DOCUMENT_TITLE_LIMIT: usize = 255;
pub const DOCUMENT_MARKDOWN_LIMIT: usize = 262_144;
pub const ARTIFACT_MARKDOWN_LIMIT: usize = 131_072;

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

const STUDY_WORKSPACES_DDL: &str = r#"CREATE TABLE study_workspaces (
  paper_arxiv_id TEXT PRIMARY KEY REFERENCES papers(arxiv_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
)"#;
const DOCUMENTS_DDL: &str = r#"CREATE TABLE markdown_documents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255 AND title = trim(title)),
  markdown TEXT NOT NULL CHECK (length(markdown) <= 262144),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
)"#;
const DOCUMENTS_INDEX_DDL: &str =
    "CREATE INDEX markdown_documents_order_idx ON markdown_documents(updated_at DESC, id ASC)";
const ARTIFACTS_DDL: &str = r#"CREATE TABLE study_artifacts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
  paper_arxiv_id TEXT NOT NULL REFERENCES study_workspaces(paper_arxiv_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('claude_code', 'codex_cli')),
  provider_version TEXT NOT NULL CHECK (length(provider_version) BETWEEN 1 AND 128),
  level TEXT NOT NULL CHECK (level IN ('translate_structure','explain_simply','technical_deep_dive')),
  output_language TEXT NOT NULL CHECK (output_language IN ('english','korean')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('abstract','document','document_selection')),
  source_document_id TEXT REFERENCES markdown_documents(id) ON DELETE SET NULL,
  source_revision INTEGER CHECK (source_revision IS NULL OR source_revision >= 1),
  selection_start_utf8 INTEGER CHECK (selection_start_utf8 IS NULL OR selection_start_utf8 >= 0),
  selection_end_utf8 INTEGER CHECK (selection_end_utf8 IS NULL OR selection_end_utf8 > 0),
  markdown TEXT NOT NULL CHECK (length(markdown) BETWEEN 1 AND 131072),
  generated_at TEXT NOT NULL CHECK (length(generated_at) BETWEEN 20 AND 40),
  saved_at TEXT NOT NULL CHECK (length(saved_at) BETWEEN 20 AND 40),
  CHECK (
    (source_kind='abstract' AND source_document_id IS NULL AND source_revision IS NULL AND selection_start_utf8 IS NULL AND selection_end_utf8 IS NULL) OR
    (source_kind='document' AND source_revision IS NOT NULL AND selection_start_utf8 IS NULL AND selection_end_utf8 IS NULL) OR
    (source_kind='document_selection' AND source_revision IS NOT NULL AND selection_start_utf8 IS NOT NULL AND selection_end_utf8 IS NOT NULL AND selection_start_utf8 < selection_end_utf8)
  )
)"#;
const ARTIFACTS_V5_DDL: &str = r#"CREATE TABLE study_artifacts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
  paper_arxiv_id TEXT NOT NULL REFERENCES study_workspaces(paper_arxiv_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('claude_code', 'codex_cli')),
  provider_version TEXT NOT NULL CHECK (length(provider_version) BETWEEN 1 AND 128),
  level TEXT NOT NULL CHECK (level IN ('translate_structure','explain_simply','technical_deep_dive','technical_polish')),
  output_language TEXT NOT NULL CHECK (output_language IN ('english','korean')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('abstract','document','document_selection')),
  source_document_id TEXT REFERENCES markdown_documents(id) ON DELETE SET NULL,
  source_revision INTEGER CHECK (source_revision IS NULL OR source_revision >= 1),
  selection_start_utf8 INTEGER CHECK (selection_start_utf8 IS NULL OR selection_start_utf8 >= 0),
  selection_end_utf8 INTEGER CHECK (selection_end_utf8 IS NULL OR selection_end_utf8 > 0),
  markdown TEXT NOT NULL CHECK (length(markdown) BETWEEN 1 AND 131072),
  generated_at TEXT NOT NULL CHECK (length(generated_at) BETWEEN 20 AND 40),
  saved_at TEXT NOT NULL CHECK (length(saved_at) BETWEEN 20 AND 40),
  CHECK (
    (source_kind='abstract' AND source_document_id IS NULL AND source_revision IS NULL AND selection_start_utf8 IS NULL AND selection_end_utf8 IS NULL) OR
    (source_kind='document' AND source_revision IS NOT NULL AND selection_start_utf8 IS NULL AND selection_end_utf8 IS NULL) OR
    (source_kind='document_selection' AND source_revision IS NOT NULL AND selection_start_utf8 IS NOT NULL AND selection_end_utf8 IS NOT NULL AND selection_start_utf8 < selection_end_utf8)
  ),
  CHECK (level!='technical_polish' OR source_kind IN ('document','document_selection'))
)"#;
const ARTIFACTS_INDEX_DDL: &str = "CREATE INDEX study_artifacts_paper_order_idx ON study_artifacts(paper_arxiv_id, saved_at DESC, id ASC)";
const DOCUMENT_PAPER_LINKS_DDL: &str = r#"CREATE TABLE document_paper_links (
  document_id TEXT NOT NULL REFERENCES markdown_documents(id) ON DELETE CASCADE,
  paper_arxiv_id TEXT NOT NULL REFERENCES papers(arxiv_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  PRIMARY KEY (document_id, paper_arxiv_id)
)"#;
const DOCUMENT_PAPER_LINKS_INDEX_DDL: &str = "CREATE INDEX document_paper_links_paper_idx ON document_paper_links(paper_arxiv_id, document_id)";
const DOCUMENT_ARTIFACT_LINKS_DDL: &str = r#"CREATE TABLE document_artifact_links (
  document_id TEXT NOT NULL REFERENCES markdown_documents(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES study_artifacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  PRIMARY KEY (document_id, artifact_id)
)"#;
const DOCUMENT_ARTIFACT_LINKS_INDEX_DDL: &str = "CREATE INDEX document_artifact_links_artifact_idx ON document_artifact_links(artifact_id, document_id)";
const LEGACY_ORIGINS_DDL: &str = r#"CREATE TABLE legacy_note_origins (
  document_id TEXT PRIMARY KEY REFERENCES markdown_documents(id) ON DELETE CASCADE,
  paper_arxiv_id TEXT NOT NULL UNIQUE REFERENCES papers(arxiv_id) ON DELETE CASCADE
)"#;
const V3_STATE_DDL: &str = r#"CREATE TABLE v3_migration_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  legacy_note_count INTEGER NOT NULL CHECK (legacy_note_count >= 0)
)"#;
const ARTIFACT_SOURCE_SNAPSHOTS_DDL: &str = r#"CREATE TABLE artifact_source_snapshots (
  artifact_id TEXT PRIMARY KEY REFERENCES study_artifacts(id) ON DELETE CASCADE,
  source_document_snapshot_id TEXT NOT NULL CHECK (length(source_document_snapshot_id) BETWEEN 1 AND 128 AND source_document_snapshot_id = trim(source_document_snapshot_id))
)"#;

const V3_OBJECTS: &[(&str, &str, &str)] = &[
    ("table", "study_workspaces", STUDY_WORKSPACES_DDL),
    ("table", "markdown_documents", DOCUMENTS_DDL),
    ("index", "markdown_documents_order_idx", DOCUMENTS_INDEX_DDL),
    ("table", "study_artifacts", ARTIFACTS_DDL),
    (
        "index",
        "study_artifacts_paper_order_idx",
        ARTIFACTS_INDEX_DDL,
    ),
    ("table", "document_paper_links", DOCUMENT_PAPER_LINKS_DDL),
    (
        "index",
        "document_paper_links_paper_idx",
        DOCUMENT_PAPER_LINKS_INDEX_DDL,
    ),
    (
        "table",
        "document_artifact_links",
        DOCUMENT_ARTIFACT_LINKS_DDL,
    ),
    (
        "index",
        "document_artifact_links_artifact_idx",
        DOCUMENT_ARTIFACT_LINKS_INDEX_DDL,
    ),
    ("table", "legacy_note_origins", LEGACY_ORIGINS_DDL),
    ("table", "v3_migration_state", V3_STATE_DDL),
];

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
    #[error("v3 schema drift")]
    V3Drift,
    #[error("unknown or non-contiguous migration history")]
    MigrationHistory,
    #[error("invalid credential reference")]
    InvalidCredentialReference,
    #[error("invalid input")]
    InvalidInput,
    #[error("paper not found")]
    PaperNotFound,
    #[error("document not found")]
    DocumentNotFound,
    #[error("artifact not found")]
    ArtifactNotFound,
    #[error("document revision conflict")]
    DocumentConflict,
    #[error("link already exists")]
    DuplicateLink,
    #[error("link not found")]
    LinkNotFound,
    #[error("byte limit exceeded")]
    ByteLimit,
    #[error("rollback is not lossless")]
    RollbackUnsafe,
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
pub struct StoredPaper {
    pub metadata: PaperMetadata,
    pub imported_at: String,
    pub metadata_fetched_at: String,
}
#[derive(Debug, Clone)]
pub struct StoredDocument {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone)]
pub struct DocumentListItem {
    pub id: String,
    pub title: String,
    pub revision: i64,
    pub updated_at: String,
}
#[derive(Debug, Clone)]
pub struct PaperLink {
    pub arxiv_id: String,
    pub title: String,
    pub created_at: String,
}
#[derive(Debug, Clone)]
pub struct ArtifactLink {
    pub artifact_id: String,
    pub paper_arxiv_id: String,
    pub created_at: String,
}
#[derive(Debug, Clone)]
pub struct DocumentProperties {
    pub document_id: String,
    pub papers: Vec<PaperLink>,
    pub artifacts: Vec<ArtifactLink>,
}
#[derive(Debug, Clone)]
pub struct DocumentBacklink {
    pub document_id: String,
    pub title: String,
    pub created_at: String,
}
#[derive(Debug, Clone)]
pub struct StudyWorkspace {
    pub paper_arxiv_id: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone)]
pub struct NewStudyArtifact {
    pub paper_arxiv_id: String,
    pub provider: String,
    pub provider_version: String,
    pub level: String,
    pub output_language: String,
    pub source_kind: String,
    pub source_document_id: Option<String>,
    pub source_revision: Option<i64>,
    pub selection_start_utf8: Option<i64>,
    pub selection_end_utf8: Option<i64>,
    pub markdown: String,
    pub generated_at: String,
}
#[derive(Debug, Clone)]
pub struct StoredStudyArtifact {
    pub id: String,
    pub paper_arxiv_id: String,
    pub provider: String,
    pub provider_version: String,
    pub level: String,
    pub output_language: String,
    pub source_kind: String,
    pub source_document_id: Option<String>,
    pub source_document_snapshot_id: Option<String>,
    pub source_revision: Option<i64>,
    pub selection_start_utf8: Option<i64>,
    pub selection_end_utf8: Option<i64>,
    pub markdown: String,
    pub generated_at: String,
    pub saved_at: String,
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

fn normalized(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn object_sql(c: &Connection, kind: &str, name: &str) -> rusqlite::Result<Option<String>> {
    c.query_row(
        "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
        params![kind, name],
        |row| row.get(0),
    )
    .optional()
}
fn canonical(c: &Connection, kind: &str, name: &str, ddl: &str) -> rusqlite::Result<bool> {
    Ok(object_sql(c, kind, name)?.is_some_and(|sql| normalized(&sql) == normalized(ddl)))
}
fn table_exists(c: &Connection, name: &str) -> rusqlite::Result<bool> {
    Ok(object_sql(c, "table", name)?.is_some())
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
fn base_v2_is_canonical(c: &Connection) -> Result<(), StorageError> {
    if !canonical(c, "table", "papers", PAPERS_DDL)?
        || !canonical(c, "index", "papers_order_idx", PAPERS_ORDER_INDEX_DDL)?
    {
        return Err(StorageError::PapersDrift);
    }
    Ok(())
}
fn v3_is_canonical(c: &Connection) -> Result<(), StorageError> {
    for (kind, name, ddl) in V3_OBJECTS {
        if !canonical(c, kind, name, ddl)? {
            return Err(StorageError::V3Drift);
        }
    }
    if table_exists(c, "notes")? {
        return Err(StorageError::V3Drift);
    }
    Ok(())
}

fn v5_is_canonical(c: &Connection) -> Result<(), StorageError> {
    for (kind, name, ddl) in V3_OBJECTS {
        let expected = if *name == "study_artifacts" {
            ARTIFACTS_V5_DDL
        } else {
            ddl
        };
        if !canonical(c, kind, name, expected)? {
            return Err(StorageError::V3Drift);
        }
    }
    if table_exists(c, "notes")? {
        return Err(StorageError::V3Drift);
    }
    Ok(())
}

pub fn open_connection(path: &Path) -> Result<Connection, StorageError> {
    let c = Connection::open(path)?;
    c.pragma_update(None, "foreign_keys", "ON")?;
    if c.query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))? != 1 {
        return Err(StorageError::MigrationHistory);
    }
    Ok(c)
}
pub fn open_or_initialize(path: &Path) -> Result<Connection, StorageError> {
    let mut c = open_connection(path)?;
    migrate_up(&mut c)?;
    Ok(c)
}
pub fn current_version(c: &Connection) -> Result<u32, StorageError> {
    ensure_ledger(c)?;
    let versions = c
        .prepare("SELECT version FROM schema_migrations ORDER BY version")?
        .query_map([], |row| row.get::<_, u32>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let version = match versions.as_slice() {
        [] => 0,
        [1] => 1,
        [1, 2] => 2,
        [1, 2, 3] => 3,
        [1, 2, 3, 4] => 4,
        [1, 2, 3, 4, 5] => 5,
        _ => return Err(StorageError::MigrationHistory),
    };
    let settings = table_exists(c, "app_settings")?;
    let papers = table_exists(c, "papers")?;
    let notes = table_exists(c, "notes")?;
    let any_v3 = V3_OBJECTS
        .iter()
        .any(|(kind, name, _)| object_sql(c, kind, name).ok().flatten().is_some());
    let v4 = table_exists(c, "artifact_source_snapshots")?;
    if (version == 0 && (settings || papers || notes || any_v3 || v4))
        || (version >= 1 && !canonical(c, "table", "app_settings", SETTINGS_DDL)?)
    {
        return Err(StorageError::SettingsDrift);
    }
    if version < 2 && (papers || notes || any_v3 || v4) {
        return Err(StorageError::PapersDrift);
    }
    if version >= 2 {
        base_v2_is_canonical(c)?;
    }
    if version == 2 {
        if !canonical(c, "table", "notes", NOTES_DDL)? {
            return Err(StorageError::NotesDrift);
        }
        if any_v3 || v4 {
            return Err(StorageError::V3Drift);
        }
    }
    if version == 3 {
        v3_is_canonical(c)?;
        if v4 {
            return Err(StorageError::V3Drift);
        }
    }
    if version == 4 || version == 5 {
        if version == 4 {
            v3_is_canonical(c)?;
        } else {
            v5_is_canonical(c)?;
        }
        if !canonical(
            c,
            "table",
            "artifact_source_snapshots",
            ARTIFACT_SOURCE_SNAPSHOTS_DDL,
        )? {
            return Err(StorageError::V3Drift);
        }
        let invalid_snapshots: i64 = c.query_row(
            "SELECT count(*) FROM study_artifacts a LEFT JOIN artifact_source_snapshots s ON s.artifact_id=a.id WHERE (a.source_kind IN ('document','document_selection') AND (s.artifact_id IS NULL OR (a.source_document_id IS NOT NULL AND a.source_document_id != s.source_document_snapshot_id))) OR (a.source_kind='abstract' AND s.artifact_id IS NOT NULL)",
            [],
            |row| row.get(0),
        )?;
        if invalid_snapshots != 0 {
            return Err(StorageError::V3Drift);
        }
    }
    Ok(version)
}

fn create_v3_objects(tx: &Transaction<'_>) -> Result<(), StorageError> {
    for (_, _, ddl) in V3_OBJECTS {
        tx.execute(ddl, [])?;
    }
    Ok(())
}
fn truncate_utf8(input: &str, max: usize) -> &str {
    if input.len() <= max {
        return input;
    }
    let mut end = max;
    while !input.is_char_boundary(end) {
        end -= 1;
    }
    &input[..end]
}
fn migrate_v2_to_v3(c: &mut Connection) -> Result<(), StorageError> {
    let tx = c.transaction()?;
    create_v3_objects(&tx)?;
    tx.execute(
        "INSERT INTO study_workspaces SELECT arxiv_id,imported_at,metadata_fetched_at FROM papers ORDER BY arxiv_id",
        [],
    )?;
    let legacy_count: i64 = tx.query_row("SELECT count(*) FROM notes", [], |row| row.get(0))?;
    let notes = {
        let mut statement = tx.prepare("SELECT n.paper_arxiv_id,p.title,n.markdown,n.created_at,n.updated_at FROM notes n JOIN papers p ON p.arxiv_id=n.paper_arxiv_id ORDER BY n.paper_arxiv_id")?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (paper_id, paper_title, markdown, created_at, updated_at) in notes {
        if markdown.len() > DOCUMENT_MARKDOWN_LIMIT {
            return Err(StorageError::ByteLimit);
        }
        let document_id = format!("legacy-note:{paper_id}");
        if document_id.len() > 128 {
            return Err(StorageError::V3Drift);
        }
        let full_title = format!("Notes — {paper_title}");
        let title = truncate_utf8(&full_title, DOCUMENT_TITLE_LIMIT);
        tx.execute(
            "INSERT INTO markdown_documents(id,title,markdown,revision,created_at,updated_at) VALUES(?1,?2,?3,1,?4,?5)",
            params![document_id, title, markdown, created_at, updated_at],
        )?;
        tx.execute(
            "INSERT INTO document_paper_links(document_id,paper_arxiv_id,created_at) VALUES(?1,?2,?3)",
            params![document_id, paper_id, created_at],
        )?;
        tx.execute(
            "INSERT INTO legacy_note_origins(document_id,paper_arxiv_id) VALUES(?1,?2)",
            params![document_id, paper_id],
        )?;
    }
    tx.execute(
        "INSERT INTO v3_migration_state(id,legacy_note_count) VALUES(1,?1)",
        [legacy_count],
    )?;
    for table in [
        "markdown_documents",
        "document_paper_links",
        "legacy_note_origins",
    ] {
        let count: i64 = tx.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })?;
        if count != legacy_count {
            return Err(StorageError::V3Drift);
        }
    }
    let foreign_key_failures: i64 =
        tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if foreign_key_failures != 0 {
        return Err(StorageError::V3Drift);
    }
    tx.execute("DROP TABLE notes", [])?;
    tx.execute(
        "INSERT INTO schema_migrations VALUES(3,'1970-01-01T00:00:00Z')",
        [],
    )?;
    tx.commit()?;
    Ok(())
}

fn rebuild_artifacts_for_version(
    c: &mut Connection,
    target_ddl: &str,
    target_version: u32,
) -> Result<(), StorageError> {
    c.pragma_update(None, "foreign_keys", "OFF")?;
    c.pragma_update(None, "legacy_alter_table", "ON")?;
    let operation = (|| {
        let tx = c.transaction()?;
        tx.execute("DROP INDEX study_artifacts_paper_order_idx", [])?;
        tx.execute(
            "ALTER TABLE study_artifacts RENAME TO study_artifacts_previous",
            [],
        )?;
        tx.execute(target_ddl, [])?;
        tx.execute(
            "INSERT INTO study_artifacts(id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,source_document_id,source_revision,selection_start_utf8,selection_end_utf8,markdown,generated_at,saved_at) SELECT id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,source_document_id,source_revision,selection_start_utf8,selection_end_utf8,markdown,generated_at,saved_at FROM study_artifacts_previous",
            [],
        )?;
        tx.execute("DROP TABLE study_artifacts_previous", [])?;
        tx.execute(ARTIFACTS_INDEX_DDL, [])?;
        if target_version == 5 {
            tx.execute(
                "INSERT INTO schema_migrations VALUES(5,'1970-01-01T00:00:00Z')",
                [],
            )?;
        } else {
            tx.execute("DELETE FROM schema_migrations WHERE version=5", [])?;
        }
        let foreign_key_failures: i64 =
            tx.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        if foreign_key_failures != 0 {
            return Err(StorageError::V3Drift);
        }
        tx.commit()?;
        Ok(())
    })();
    let legacy_result = c.pragma_update(None, "legacy_alter_table", "OFF");
    let foreign_keys_result = c.pragma_update(None, "foreign_keys", "ON");
    operation?;
    legacy_result?;
    foreign_keys_result?;
    Ok(())
}

pub fn migrate_up(c: &mut Connection) -> Result<(), StorageError> {
    let mut version = current_version(c)?;
    while version < 5 {
        if version == 4 {
            rebuild_artifacts_for_version(c, ARTIFACTS_V5_DDL, 5)?;
        } else if version == 3 {
            let tx = c.transaction()?;
            let unrecoverable_sources: i64 = tx.query_row(
                "SELECT count(*) FROM study_artifacts WHERE source_kind IN ('document','document_selection') AND source_document_id IS NULL",
                [],
                |row| row.get(0),
            )?;
            if unrecoverable_sources != 0 {
                return Err(StorageError::RollbackUnsafe);
            }
            tx.execute(ARTIFACT_SOURCE_SNAPSHOTS_DDL, [])?;
            tx.execute(
                "INSERT INTO artifact_source_snapshots(artifact_id,source_document_snapshot_id) SELECT id,source_document_id FROM study_artifacts WHERE source_kind IN ('document','document_selection')",
                [],
            )?;
            tx.execute(
                "INSERT INTO schema_migrations VALUES(4,'1970-01-01T00:00:00Z')",
                [],
            )?;
            tx.commit()?;
        } else if version == 2 {
            migrate_v2_to_v3(c)?;
        } else {
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
        }
        version += 1;
    }
    current_version(c).map(|_| ())
}
fn rollback_v3(tx: &Transaction<'_>) -> Result<(), StorageError> {
    let legacy_count: i64 = tx.query_row(
        "SELECT legacy_note_count FROM v3_migration_state WHERE id=1",
        [],
        |row| row.get(0),
    )?;
    let documents: i64 = tx.query_row("SELECT count(*) FROM markdown_documents", [], |row| {
        row.get(0)
    })?;
    let origins: i64 = tx.query_row("SELECT count(*) FROM legacy_note_origins", [], |row| {
        row.get(0)
    })?;
    let bad_edges: i64 = tx.query_row(
        "SELECT count(*) FROM document_paper_links l LEFT JOIN legacy_note_origins o ON o.document_id=l.document_id AND o.paper_arxiv_id=l.paper_arxiv_id WHERE o.document_id IS NULL",
        [],
        |row| row.get(0),
    )?;
    let artifacts: i64 =
        tx.query_row("SELECT count(*) FROM study_artifacts", [], |row| row.get(0))?;
    let artifact_links: i64 =
        tx.query_row("SELECT count(*) FROM document_artifact_links", [], |row| {
            row.get(0)
        })?;
    let link_count: i64 = tx.query_row("SELECT count(*) FROM document_paper_links", [], |row| {
        row.get(0)
    })?;
    let legacy_metadata_is_lossless = {
        let mut statement = tx.prepare(
            "SELECT d.id,d.title,d.revision,o.paper_arxiv_id,p.title FROM legacy_note_origins o JOIN markdown_documents d ON d.id=o.document_id JOIN papers p ON p.arxiv_id=o.paper_arxiv_id ORDER BY o.paper_arxiv_id",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().all(
            |(document_id, document_title, revision, paper_id, paper_title)| {
                let expected_title = format!("Notes — {paper_title}");
                document_id == format!("legacy-note:{paper_id}")
                    && document_title == truncate_utf8(&expected_title, DOCUMENT_TITLE_LIMIT)
                    && revision == 1
            },
        )
    };
    if documents != legacy_count
        || origins != legacy_count
        || link_count != legacy_count
        || bad_edges != 0
        || artifacts != 0
        || artifact_links != 0
        || !legacy_metadata_is_lossless
    {
        return Err(StorageError::RollbackUnsafe);
    }
    tx.execute(NOTES_DDL, [])?;
    tx.execute(
        "INSERT INTO notes(paper_arxiv_id,markdown,created_at,updated_at) SELECT o.paper_arxiv_id,d.markdown,d.created_at,d.updated_at FROM legacy_note_origins o JOIN markdown_documents d ON d.id=o.document_id ORDER BY o.paper_arxiv_id",
        [],
    )?;
    for sql in [
        "DROP TABLE document_artifact_links",
        "DROP TABLE document_paper_links",
        "DROP TABLE study_artifacts",
        "DROP TABLE legacy_note_origins",
        "DROP TABLE markdown_documents",
        "DROP TABLE study_workspaces",
        "DROP TABLE v3_migration_state",
    ] {
        tx.execute(sql, [])?;
    }
    tx.execute("DELETE FROM schema_migrations WHERE version=3", [])?;
    Ok(())
}
pub fn migrate_down(c: &mut Connection) -> Result<(), StorageError> {
    let version = current_version(c)?;
    if version == 0 {
        return Ok(());
    }
    if version == 5 {
        let technical_polish_rows: i64 = c.query_row(
            "SELECT count(*) FROM study_artifacts WHERE level='technical_polish'",
            [],
            |row| row.get(0),
        )?;
        if technical_polish_rows != 0 {
            return Err(StorageError::RollbackUnsafe);
        }
        rebuild_artifacts_for_version(c, ARTIFACTS_DDL, 4)?;
        return current_version(c).map(|_| ());
    }
    let tx = c.transaction()?;
    match version {
        4 => {
            let snapshots: i64 = tx.query_row(
                "SELECT count(*) FROM artifact_source_snapshots",
                [],
                |row| row.get(0),
            )?;
            if snapshots != 0 {
                return Err(StorageError::RollbackUnsafe);
            }
            tx.execute("DROP TABLE artifact_source_snapshots", [])?;
            tx.execute("DELETE FROM schema_migrations WHERE version=4", [])?;
        }
        3 => rollback_v3(&tx)?,
        2 => {
            let retained_rows: i64 = tx.query_row(
                "SELECT (SELECT count(*) FROM papers) + (SELECT count(*) FROM notes)",
                [],
                |row| row.get(0),
            )?;
            if retained_rows != 0 {
                return Err(StorageError::RollbackUnsafe);
            }
            tx.execute("DROP TABLE notes", [])?;
            tx.execute("DROP INDEX papers_order_idx", [])?;
            tx.execute("DROP TABLE papers", [])?;
            tx.execute("DELETE FROM schema_migrations WHERE version=2", [])?;
        }
        1 => {
            let retained_rows: i64 =
                tx.query_row("SELECT count(*) FROM app_settings", [], |row| row.get(0))?;
            if retained_rows != 0 {
                return Err(StorageError::RollbackUnsafe);
            }
            tx.execute("DROP TABLE app_settings", [])?;
            tx.execute("DELETE FROM schema_migrations WHERE version=1", [])?;
        }
        _ => return Err(StorageError::MigrationHistory),
    }
    tx.commit()?;
    current_version(c).map(|_| ())
}

fn valid_metadata(metadata: &PaperMetadata) -> bool {
    metadata.arxiv_id.len() <= 64
        && metadata.arxiv_id.len() >= 4
        && metadata.arxiv_id == metadata.arxiv_id.trim()
        && (1..=999_999).contains(&metadata.arxiv_version)
        && !metadata.title.trim().is_empty()
        && metadata.title == metadata.title.trim()
        && metadata.title.chars().count() <= 4_096
        && metadata.summary.chars().count() <= 65_536
        && (1..=64).contains(&metadata.authors.len())
        && (1..=64).contains(&metadata.categories.len())
        && metadata
            .authors
            .iter()
            .chain(metadata.categories.iter())
            .all(|value| !value.trim().is_empty() && value.chars().count() <= 512)
        && [&metadata.published_at, &metadata.source_updated_at]
            .iter()
            .all(|value| (20..=40).contains(&value.chars().count()))
}
pub fn save_provider_settings(c: &Connection, s: &ProviderSettings) -> Result<(), StorageError> {
    if current_version(c)? < 1 {
        return Err(StorageError::MigrationHistory);
    }
    c.execute("INSERT INTO app_settings(id,provider,credential_ref,updated_at) VALUES(1,?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,credential_ref=excluded.credential_ref,updated_at=excluded.updated_at", params![s.provider.as_str(), s.credential_ref.0])?;
    Ok(())
}
pub fn upsert_paper(c: &mut Connection, metadata: &PaperMetadata) -> Result<(), StorageError> {
    if !valid_metadata(metadata) {
        return Err(StorageError::InvalidInput);
    }
    if current_version(c)? != 5 {
        return Err(StorageError::MigrationHistory);
    }
    let tx = c.transaction()?;
    tx.execute("INSERT INTO papers(arxiv_id,arxiv_version,title,summary,authors_json,categories_json,published_at,source_updated_at,imported_at,metadata_fetched_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(arxiv_id) DO UPDATE SET arxiv_version=excluded.arxiv_version,title=excluded.title,summary=excluded.summary,authors_json=excluded.authors_json,categories_json=excluded.categories_json,published_at=excluded.published_at,source_updated_at=excluded.source_updated_at,metadata_fetched_at=excluded.metadata_fetched_at", params![metadata.arxiv_id, metadata.arxiv_version, metadata.title, metadata.summary, json!(metadata.authors).to_string(), json!(metadata.categories).to_string(), metadata.published_at, metadata.source_updated_at])?;
    tx.execute("INSERT INTO study_workspaces(paper_arxiv_id,created_at,updated_at) VALUES(?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(paper_arxiv_id) DO UPDATE SET updated_at=excluded.updated_at", [&metadata.arxiv_id])?;
    tx.commit()?;
    Ok(())
}
fn row_to_paper(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredPaper> {
    Ok(StoredPaper {
        metadata: PaperMetadata {
            arxiv_id: row.get(0)?,
            arxiv_version: row.get(1)?,
            title: row.get(2)?,
            summary: row.get(3)?,
            authors: serde_json::from_str(&row.get::<_, String>(4)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?,
            categories: serde_json::from_str(&row.get::<_, String>(5)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?,
            published_at: row.get(6)?,
            source_updated_at: row.get(7)?,
        },
        imported_at: row.get(8)?,
        metadata_fetched_at: row.get(9)?,
    })
}
pub fn get_paper(c: &Connection, id: &str) -> Result<StoredPaper, StorageError> {
    c.query_row("SELECT arxiv_id,arxiv_version,title,summary,authors_json,categories_json,published_at,source_updated_at,imported_at,metadata_fetched_at FROM papers WHERE arxiv_id=?1", [id], row_to_paper).optional()?.ok_or(StorageError::PaperNotFound)
}
pub fn list_papers(c: &Connection) -> Result<Vec<StoredPaper>, StorageError> {
    let mut statement = c.prepare("SELECT arxiv_id,arxiv_version,title,summary,authors_json,categories_json,published_at,source_updated_at,imported_at,metadata_fetched_at FROM papers ORDER BY metadata_fetched_at DESC,arxiv_id ASC")?;
    statement
        .query_map([], row_to_paper)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}

fn valid_document(title: &str, markdown: &str) -> Result<(), StorageError> {
    if title.is_empty() || title != title.trim() {
        return Err(StorageError::InvalidInput);
    }
    if title.len() > DOCUMENT_TITLE_LIMIT || markdown.len() > DOCUMENT_MARKDOWN_LIMIT {
        return Err(StorageError::ByteLimit);
    }
    Ok(())
}
fn row_to_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredDocument> {
    Ok(StoredDocument {
        id: row.get(0)?,
        title: row.get(1)?,
        markdown: row.get(2)?,
        revision: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}
pub fn create_document(
    c: &mut Connection,
    title: &str,
    markdown: &str,
) -> Result<StoredDocument, StorageError> {
    valid_document(title, markdown)?;
    let id = Uuid::new_v4().to_string();
    let tx = c.transaction()?;
    tx.execute("INSERT INTO markdown_documents(id,title,markdown,revision,created_at,updated_at) VALUES(?1,?2,?3,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![id, title, markdown])?;
    let document = tx.query_row("SELECT id,title,markdown,revision,created_at,updated_at FROM markdown_documents WHERE id=?1", [&id], row_to_document)?;
    tx.commit()?;
    Ok(document)
}
pub fn get_document(c: &Connection, id: &str) -> Result<StoredDocument, StorageError> {
    c.query_row("SELECT id,title,markdown,revision,created_at,updated_at FROM markdown_documents WHERE id=?1", [id], row_to_document).optional()?.ok_or(StorageError::DocumentNotFound)
}
pub fn list_documents(c: &Connection) -> Result<Vec<DocumentListItem>, StorageError> {
    let mut statement = c.prepare("SELECT id,title,revision,updated_at FROM markdown_documents ORDER BY updated_at DESC,id ASC")?;
    statement
        .query_map([], |row| {
            Ok(DocumentListItem {
                id: row.get(0)?,
                title: row.get(1)?,
                revision: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}
pub fn update_document(
    c: &mut Connection,
    id: &str,
    expected_revision: i64,
    title: &str,
    markdown: &str,
) -> Result<StoredDocument, StorageError> {
    valid_document(title, markdown)?;
    if expected_revision < 1 {
        return Err(StorageError::InvalidInput);
    }
    let tx = c.transaction()?;
    let changed = tx.execute("UPDATE markdown_documents SET title=?1,markdown=?2,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?3 AND revision=?4", params![title, markdown, id, expected_revision])?;
    if changed == 0 {
        return if tx
            .query_row("SELECT 1 FROM markdown_documents WHERE id=?1", [id], |_| {
                Ok(())
            })
            .optional()?
            .is_some()
        {
            Err(StorageError::DocumentConflict)
        } else {
            Err(StorageError::DocumentNotFound)
        };
    }
    let document = tx.query_row("SELECT id,title,markdown,revision,created_at,updated_at FROM markdown_documents WHERE id=?1", [id], row_to_document)?;
    tx.commit()?;
    Ok(document)
}
pub fn delete_document(c: &mut Connection, id: &str) -> Result<(), StorageError> {
    if c.execute("DELETE FROM markdown_documents WHERE id=?1", [id])? == 0 {
        return Err(StorageError::DocumentNotFound);
    }
    Ok(())
}
fn require_document(c: &Connection, id: &str) -> Result<(), StorageError> {
    c.query_row("SELECT 1 FROM markdown_documents WHERE id=?1", [id], |_| {
        Ok(())
    })
    .optional()?
    .ok_or(StorageError::DocumentNotFound)
}
fn map_link_insert(error: rusqlite::Error) -> StorageError {
    match &error {
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            StorageError::DuplicateLink
        }
        _ => StorageError::Sql(error),
    }
}
pub fn link_document_paper(
    c: &mut Connection,
    document_id: &str,
    paper_id: &str,
) -> Result<(), StorageError> {
    require_document(c, document_id)?;
    if get_paper(c, paper_id).is_err() {
        return Err(StorageError::PaperNotFound);
    }
    c.execute("INSERT INTO document_paper_links(document_id,paper_arxiv_id,created_at) VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![document_id, paper_id]).map_err(map_link_insert)?;
    Ok(())
}
pub fn unlink_document_paper(
    c: &mut Connection,
    document_id: &str,
    paper_id: &str,
) -> Result<(), StorageError> {
    require_document(c, document_id)?;
    if c.execute(
        "DELETE FROM document_paper_links WHERE document_id=?1 AND paper_arxiv_id=?2",
        params![document_id, paper_id],
    )? == 0
    {
        return Err(StorageError::LinkNotFound);
    }
    Ok(())
}
pub fn link_document_artifact(
    c: &mut Connection,
    document_id: &str,
    artifact_id: &str,
) -> Result<(), StorageError> {
    require_document(c, document_id)?;
    if c.query_row(
        "SELECT 1 FROM study_artifacts WHERE id=?1",
        [artifact_id],
        |_| Ok(()),
    )
    .optional()?
    .is_none()
    {
        return Err(StorageError::ArtifactNotFound);
    }
    c.execute("INSERT INTO document_artifact_links(document_id,artifact_id,created_at) VALUES(?1,?2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", params![document_id, artifact_id]).map_err(map_link_insert)?;
    Ok(())
}
pub fn unlink_document_artifact(
    c: &mut Connection,
    document_id: &str,
    artifact_id: &str,
) -> Result<(), StorageError> {
    require_document(c, document_id)?;
    if c.execute(
        "DELETE FROM document_artifact_links WHERE document_id=?1 AND artifact_id=?2",
        params![document_id, artifact_id],
    )? == 0
    {
        return Err(StorageError::LinkNotFound);
    }
    Ok(())
}
pub fn document_properties(c: &Connection, id: &str) -> Result<DocumentProperties, StorageError> {
    require_document(c, id)?;
    let papers = {
        let mut statement = c.prepare("SELECT p.arxiv_id,p.title,l.created_at FROM document_paper_links l JOIN papers p ON p.arxiv_id=l.paper_arxiv_id WHERE l.document_id=?1 ORDER BY p.title,p.arxiv_id")?;
        statement
            .query_map([id], |row| {
                Ok(PaperLink {
                    arxiv_id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let artifacts = {
        let mut statement = c.prepare("SELECT a.id,a.paper_arxiv_id,l.created_at FROM document_artifact_links l JOIN study_artifacts a ON a.id=l.artifact_id WHERE l.document_id=?1 ORDER BY a.saved_at DESC,a.id")?;
        statement
            .query_map([id], |row| {
                Ok(ArtifactLink {
                    artifact_id: row.get(0)?,
                    paper_arxiv_id: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    Ok(DocumentProperties {
        document_id: id.into(),
        papers,
        artifacts,
    })
}
pub fn paper_backlinks(
    c: &Connection,
    paper_id: &str,
) -> Result<Vec<DocumentBacklink>, StorageError> {
    if get_paper(c, paper_id).is_err() {
        return Err(StorageError::PaperNotFound);
    }
    let mut statement = c.prepare("SELECT d.id,d.title,l.created_at FROM document_paper_links l JOIN markdown_documents d ON d.id=l.document_id WHERE l.paper_arxiv_id=?1 ORDER BY d.updated_at DESC,d.id")?;
    statement
        .query_map([paper_id], |row| {
            Ok(DocumentBacklink {
                document_id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}
pub fn artifact_backlinks(
    c: &Connection,
    artifact_id: &str,
) -> Result<Vec<DocumentBacklink>, StorageError> {
    if c.query_row(
        "SELECT 1 FROM study_artifacts WHERE id=?1",
        [artifact_id],
        |_| Ok(()),
    )
    .optional()?
    .is_none()
    {
        return Err(StorageError::ArtifactNotFound);
    }
    let mut statement = c.prepare("SELECT d.id,d.title,l.created_at FROM document_artifact_links l JOIN markdown_documents d ON d.id=l.document_id WHERE l.artifact_id=?1 ORDER BY d.updated_at DESC,d.id")?;
    statement
        .query_map([artifact_id], |row| {
            Ok(DocumentBacklink {
                document_id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}

pub fn get_study(c: &Connection, paper_id: &str) -> Result<StudyWorkspace, StorageError> {
    c.query_row(
        "SELECT paper_arxiv_id,created_at,updated_at FROM study_workspaces WHERE paper_arxiv_id=?1",
        [paper_id],
        |row| {
            Ok(StudyWorkspace {
                paper_arxiv_id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or(StorageError::PaperNotFound)
}
fn valid_artifact(input: &NewStudyArtifact) -> Result<(), StorageError> {
    if input.markdown.trim().is_empty()
        || input.provider_version.is_empty()
        || input.provider_version.len() > 128
        || !(20..=40).contains(&input.generated_at.len())
    {
        return Err(StorageError::InvalidInput);
    }
    if input.markdown.len() > ARTIFACT_MARKDOWN_LIMIT {
        return Err(StorageError::ByteLimit);
    }
    let provenance_valid = match input.source_kind.as_str() {
        "abstract" => {
            input.source_document_id.is_none()
                && input.source_revision.is_none()
                && input.selection_start_utf8.is_none()
                && input.selection_end_utf8.is_none()
        }
        "document" => {
            input.source_document_id.is_some()
                && input.source_revision.is_some_and(|v| v >= 1)
                && input.selection_start_utf8.is_none()
                && input.selection_end_utf8.is_none()
        }
        "document_selection" => {
            input.source_document_id.is_some()
                && input.source_revision.is_some_and(|v| v >= 1)
                && matches!((input.selection_start_utf8, input.selection_end_utf8), (Some(start), Some(end)) if start >= 0 && start < end)
        }
        _ => false,
    };
    let level_valid = matches!(
        input.level.as_str(),
        "translate_structure" | "explain_simply" | "technical_deep_dive" | "technical_polish"
    ) && (input.level != "technical_polish"
        || matches!(
            input.source_kind.as_str(),
            "document" | "document_selection"
        ));
    if !matches!(input.provider.as_str(), "claude_code" | "codex_cli")
        || !level_valid
        || !matches!(input.output_language.as_str(), "english" | "korean")
        || !provenance_valid
    {
        return Err(StorageError::InvalidInput);
    }
    Ok(())
}
fn row_to_artifact(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredStudyArtifact> {
    Ok(StoredStudyArtifact {
        id: row.get(0)?,
        paper_arxiv_id: row.get(1)?,
        provider: row.get(2)?,
        provider_version: row.get(3)?,
        level: row.get(4)?,
        output_language: row.get(5)?,
        source_kind: row.get(6)?,
        source_document_id: row.get(7)?,
        source_document_snapshot_id: row.get(8)?,
        source_revision: row.get(9)?,
        selection_start_utf8: row.get(10)?,
        selection_end_utf8: row.get(11)?,
        markdown: row.get(12)?,
        generated_at: row.get(13)?,
        saved_at: row.get(14)?,
    })
}
pub fn get_study_artifact(c: &Connection, id: &str) -> Result<StoredStudyArtifact, StorageError> {
    c.query_row("SELECT a.id,a.paper_arxiv_id,a.provider,a.provider_version,a.level,a.output_language,a.source_kind,a.source_document_id,s.source_document_snapshot_id,a.source_revision,a.selection_start_utf8,a.selection_end_utf8,a.markdown,a.generated_at,a.saved_at FROM study_artifacts a LEFT JOIN artifact_source_snapshots s ON s.artifact_id=a.id WHERE a.id=?1", [id], row_to_artifact)
        .optional()?
        .ok_or(StorageError::ArtifactNotFound)
}

pub fn save_study_artifact(
    c: &mut Connection,
    input: &NewStudyArtifact,
) -> Result<StoredStudyArtifact, StorageError> {
    let id = Uuid::new_v4().to_string();
    save_study_artifact_with_id(c, &id, input)
}

pub(crate) fn save_study_artifact_with_id(
    c: &mut Connection,
    id: &str,
    input: &NewStudyArtifact,
) -> Result<StoredStudyArtifact, StorageError> {
    let parsed_id = Uuid::parse_str(id).map_err(|_| StorageError::InvalidInput)?;
    if parsed_id.get_version_num() != 4 || parsed_id.to_string() != id {
        return Err(StorageError::InvalidInput);
    }
    valid_artifact(input)?;
    get_study(c, &input.paper_arxiv_id)?;
    if let Some(document_id) = &input.source_document_id {
        let document = get_document(c, document_id)?;
        let source_revision = input.source_revision.ok_or(StorageError::InvalidInput)?;
        if source_revision > document.revision {
            return Err(StorageError::DocumentConflict);
        }
        if input.source_kind == "document_selection" && source_revision == document.revision {
            let start = usize::try_from(input.selection_start_utf8.unwrap())
                .map_err(|_| StorageError::InvalidInput)?;
            let end = usize::try_from(input.selection_end_utf8.unwrap())
                .map_err(|_| StorageError::InvalidInput)?;
            if end > document.markdown.len()
                || !document.markdown.is_char_boundary(start)
                || !document.markdown.is_char_boundary(end)
            {
                return Err(StorageError::InvalidInput);
            }
        }
    }
    let tx = c.transaction()?;
    let inserted = tx.execute("INSERT INTO study_artifacts(id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,source_document_id,source_revision,selection_start_utf8,selection_end_utf8,markdown,generated_at,saved_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING", params![id, input.paper_arxiv_id, input.provider, input.provider_version, input.level, input.output_language, input.source_kind, input.source_document_id, input.source_revision, input.selection_start_utf8, input.selection_end_utf8, input.markdown, input.generated_at])?;
    if inserted == 1 {
        if let Some(source_document_id) = &input.source_document_id {
            tx.execute(
                "INSERT INTO artifact_source_snapshots(artifact_id,source_document_snapshot_id) VALUES(?1,?2)",
                params![id, source_document_id],
            )?;
        }
    }
    let artifact = tx.query_row("SELECT a.id,a.paper_arxiv_id,a.provider,a.provider_version,a.level,a.output_language,a.source_kind,a.source_document_id,s.source_document_snapshot_id,a.source_revision,a.selection_start_utf8,a.selection_end_utf8,a.markdown,a.generated_at,a.saved_at FROM study_artifacts a LEFT JOIN artifact_source_snapshots s ON s.artifact_id=a.id WHERE a.id=?1", [id], row_to_artifact)?;
    if inserted == 0
        && (artifact.paper_arxiv_id != input.paper_arxiv_id
            || artifact.provider != input.provider
            || artifact.provider_version != input.provider_version
            || artifact.level != input.level
            || artifact.output_language != input.output_language
            || artifact.source_kind != input.source_kind
            || artifact.source_document_id != input.source_document_id
            || artifact.source_document_snapshot_id != input.source_document_id
            || artifact.source_revision != input.source_revision
            || artifact.selection_start_utf8 != input.selection_start_utf8
            || artifact.selection_end_utf8 != input.selection_end_utf8
            || artifact.markdown != input.markdown
            || artifact.generated_at != input.generated_at)
    {
        return Err(StorageError::InvalidInput);
    }
    tx.commit()?;
    Ok(artifact)
}
pub fn list_study_artifacts(
    c: &Connection,
    paper_id: &str,
) -> Result<Vec<StoredStudyArtifact>, StorageError> {
    get_study(c, paper_id)?;
    let mut statement = c.prepare("SELECT a.id,a.paper_arxiv_id,a.provider,a.provider_version,a.level,a.output_language,a.source_kind,a.source_document_id,s.source_document_snapshot_id,a.source_revision,a.selection_start_utf8,a.selection_end_utf8,a.markdown,a.generated_at,a.saved_at FROM study_artifacts a LEFT JOIN artifact_source_snapshots s ON s.artifact_id=a.id WHERE a.paper_arxiv_id=?1 ORDER BY a.saved_at DESC,a.id ASC")?;
    statement
        .query_map([paper_id], row_to_artifact)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StorageError::from)
}
pub fn delete_study_artifact(c: &mut Connection, id: &str) -> Result<(), StorageError> {
    if c.execute("DELETE FROM study_artifacts WHERE id=?1", [id])? == 0 {
        return Err(StorageError::ArtifactNotFound);
    }
    Ok(())
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
            summary: "abstract".into(),
            authors: vec!["A".into()],
            categories: vec!["cs.CL".into()],
            published_at: "2017-01-01T00:00:00Z".into(),
            source_updated_at: "2017-01-01T00:00:00Z".into(),
        }
    }
    fn migrate_to_v2(c: &mut Connection) {
        ensure_ledger(c).unwrap();
        c.execute(SETTINGS_DDL, []).unwrap();
        c.execute(
            "INSERT INTO schema_migrations VALUES(1,'1970-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        c.execute(PAPERS_DDL, []).unwrap();
        c.execute(PAPERS_ORDER_INDEX_DDL, []).unwrap();
        c.execute(NOTES_DDL, []).unwrap();
        c.execute(
            "INSERT INTO schema_migrations VALUES(2,'1970-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }
    fn insert_v2_paper_and_note(c: &Connection, title: &str, markdown: &str) {
        let metadata = sample_metadata();
        c.execute(
            "INSERT INTO papers VALUES(?1,1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                metadata.arxiv_id,
                title,
                metadata.summary,
                json!(metadata.authors).to_string(),
                json!(metadata.categories).to_string(),
                metadata.published_at,
                metadata.source_updated_at,
                "2026-08-18T00:00:00Z",
                "2026-08-18T00:00:01Z"
            ],
        )
        .unwrap();
        c.execute(
            "INSERT INTO notes VALUES(?1,?2,?3,?4)",
            params![
                metadata.arxiv_id,
                markdown,
                "2026-08-18T00:00:02Z",
                "2026-08-18T00:00:03Z"
            ],
        )
        .unwrap();
    }

    fn migrate_to_v4(c: &mut Connection) {
        migrate_to_v2(c);
        insert_v2_paper_and_note(c, "Title", "source body");
        migrate_v2_to_v3(c).unwrap();
        let tx = c.transaction().unwrap();
        tx.execute(ARTIFACT_SOURCE_SNAPSHOTS_DDL, []).unwrap();
        tx.execute(
            "INSERT INTO artifact_source_snapshots(artifact_id,source_document_snapshot_id) SELECT id,source_document_id FROM study_artifacts WHERE source_kind IN ('document','document_selection')",
            [],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO schema_migrations VALUES(4,'1970-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        tx.commit().unwrap();
    }

    #[test]
    fn v5_downgrade_preserves_v4_compatible_rows_and_provenance() {
        let mut c = fresh();
        migrate_to_v4(&mut c);
        let source = get_document(&c, "legacy-note:1706.03762").unwrap();
        let id = "550e8400-e29b-41d4-a716-446655440004";
        let input = NewStudyArtifact {
            paper_arxiv_id: "1706.03762".into(),
            provider: "claude_code".into(),
            provider_version: "1.0.0".into(),
            level: "explain_simply".into(),
            output_language: "english".into(),
            source_kind: "document".into(),
            source_document_id: Some(source.id.clone()),
            source_revision: Some(1),
            selection_start_utf8: None,
            selection_end_utf8: None,
            markdown: "existing".into(),
            generated_at: "2026-08-18T00:00:00Z".into(),
        };
        save_study_artifact_with_id(&mut c, id, &input).unwrap();
        migrate_up(&mut c).unwrap();

        migrate_down(&mut c).unwrap();

        assert_eq!(current_version(&c).unwrap(), 4);
        let retained = get_study_artifact(&c, id).unwrap();
        assert_eq!(retained.markdown, "existing");
        assert_eq!(retained.source_document_snapshot_id, Some(source.id));
        assert_eq!(
            c.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            },)
                .unwrap(),
            0
        );
    }

    #[test]
    fn v5_downgrade_rejects_technical_polish_rows_without_mutation() {
        let mut c = fresh();
        migrate_to_v4(&mut c);
        migrate_up(&mut c).unwrap();
        let source = get_document(&c, "legacy-note:1706.03762").unwrap();
        let input = NewStudyArtifact {
            paper_arxiv_id: "1706.03762".into(),
            provider: "claude_code".into(),
            provider_version: "1.0.0".into(),
            level: "technical_polish".into(),
            output_language: "english".into(),
            source_kind: "document".into(),
            source_document_id: Some(source.id),
            source_revision: Some(1),
            selection_start_utf8: None,
            selection_end_utf8: None,
            markdown: "polished".into(),
            generated_at: "2026-08-18T00:00:00Z".into(),
        };
        save_study_artifact_with_id(&mut c, "550e8400-e29b-41d4-a716-446655440003", &input)
            .unwrap();

        assert!(matches!(
            migrate_down(&mut c),
            Err(StorageError::RollbackUnsafe)
        ));
        assert_eq!(current_version(&c).unwrap(), 5);
        assert_eq!(
            get_study_artifact(&c, "550e8400-e29b-41d4-a716-446655440003")
                .unwrap()
                .level,
            "technical_polish"
        );
    }

    #[test]
    fn technical_polish_storage_accepts_only_document_backed_sources() {
        let mut c = fresh();
        migrate_to_v4(&mut c);
        migrate_up(&mut c).unwrap();
        let source = get_document(&c, "legacy-note:1706.03762").unwrap();
        let document_input = NewStudyArtifact {
            paper_arxiv_id: "1706.03762".into(),
            provider: "claude_code".into(),
            provider_version: "1.0.0".into(),
            level: "technical_polish".into(),
            output_language: "korean".into(),
            source_kind: "document".into(),
            source_document_id: Some(source.id.clone()),
            source_revision: Some(1),
            selection_start_utf8: None,
            selection_end_utf8: None,
            markdown: "다듬은 결과".into(),
            generated_at: "2026-08-18T00:00:00Z".into(),
        };
        let saved = save_study_artifact_with_id(
            &mut c,
            "550e8400-e29b-41d4-a716-446655440001",
            &document_input,
        )
        .unwrap();
        assert_eq!(saved.level, "technical_polish");

        let mut abstract_input = document_input;
        abstract_input.source_kind = "abstract".into();
        abstract_input.source_document_id = None;
        abstract_input.source_revision = None;
        assert!(matches!(
            save_study_artifact_with_id(
                &mut c,
                "550e8400-e29b-41d4-a716-446655440002",
                &abstract_input,
            ),
            Err(StorageError::InvalidInput)
        ));
        assert!(c
            .execute(
                "INSERT INTO study_artifacts(id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,markdown,generated_at,saved_at) VALUES('raw-polish','1706.03762','claude_code','1.0.0','technical_polish','english','abstract','x','2026-08-18T00:00:00Z','2026-08-18T00:00:00Z')",
                [],
            )
            .is_err());
    }

    #[test]
    fn v4_to_v5_extends_only_level_constraint_and_preserves_rows_and_provenance() {
        let mut c = fresh();
        migrate_to_v4(&mut c);
        let source = get_document(&c, "legacy-note:1706.03762").unwrap();
        let artifact_id = "550e8400-e29b-41d4-a716-446655440000";
        let input = NewStudyArtifact {
            paper_arxiv_id: "1706.03762".into(),
            provider: "claude_code".into(),
            provider_version: "1.0.0".into(),
            level: "technical_deep_dive".into(),
            output_language: "english".into(),
            source_kind: "document".into(),
            source_document_id: Some(source.id.clone()),
            source_revision: Some(1),
            selection_start_utf8: None,
            selection_end_utf8: None,
            markdown: "existing artifact".into(),
            generated_at: "2026-08-18T00:00:00Z".into(),
        };
        save_study_artifact_with_id(&mut c, artifact_id, &input).unwrap();

        migrate_up(&mut c).unwrap();

        assert_eq!(current_version(&c).unwrap(), 5);
        let retained = get_study_artifact(&c, artifact_id).unwrap();
        assert_eq!(retained.markdown, "existing artifact");
        assert_eq!(retained.level, "technical_deep_dive");
        assert_eq!(
            retained.source_document_snapshot_id.as_deref(),
            Some(source.id.as_str())
        );
        let columns = c
            .prepare("PRAGMA table_info(study_artifacts)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            columns,
            [
                "id",
                "paper_arxiv_id",
                "provider",
                "provider_version",
                "level",
                "output_language",
                "source_kind",
                "source_document_id",
                "source_revision",
                "selection_start_utf8",
                "selection_end_utf8",
                "markdown",
                "generated_at",
                "saved_at",
            ]
        );
    }

    #[test]
    fn migration_matrix_supports_v0_through_v5_and_safe_reinitialization() {
        let mut v0 = fresh();
        migrate_up(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 5);
        let mut v1 = fresh();
        ensure_ledger(&v1).unwrap();
        v1.execute(SETTINGS_DDL, []).unwrap();
        v1.execute(
            "INSERT INTO schema_migrations VALUES(1,'1970-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        migrate_up(&mut v1).unwrap();
        assert_eq!(current_version(&v1).unwrap(), 5);
        let mut v2 = fresh();
        migrate_to_v2(&mut v2);
        migrate_up(&mut v2).unwrap();
        assert_eq!(current_version(&v2).unwrap(), 5);
        migrate_down(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 4);
        migrate_down(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 3);
        migrate_down(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 2);
        migrate_down(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 1);
        migrate_down(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 0);
        migrate_up(&mut v0).unwrap();
        assert_eq!(current_version(&v0).unwrap(), 5);
    }

    #[test]
    fn v2_migration_is_lossless_and_truncates_title_at_utf8_boundary() {
        let mut c = fresh();
        migrate_to_v2(&mut c);
        let long_title = "가".repeat(100);
        let markdown = "# byte-for-byte\n가";
        insert_v2_paper_and_note(&c, &long_title, markdown);
        migrate_up(&mut c).unwrap();
        let document = get_document(&c, "legacy-note:1706.03762").unwrap();
        assert_eq!(document.markdown, markdown);
        assert_eq!(document.created_at, "2026-08-18T00:00:02Z");
        assert_eq!(document.updated_at, "2026-08-18T00:00:03Z");
        assert!(document.title.len() <= DOCUMENT_TITLE_LIMIT);
        assert!(document.title.is_char_boundary(document.title.len()));
        assert_eq!(
            document_properties(&c, &document.id).unwrap().papers.len(),
            1
        );
        assert!(!table_exists(&c, "notes").unwrap());
    }

    #[test]
    fn safe_v3_downgrade_restores_lossless_v2_note() {
        let mut c = fresh();
        migrate_to_v2(&mut c);
        insert_v2_paper_and_note(&c, "Title", "original bytes 가");
        migrate_up(&mut c).unwrap();
        migrate_down(&mut c).unwrap();
        assert_eq!(current_version(&c).unwrap(), 4);
        migrate_down(&mut c).unwrap();
        assert_eq!(current_version(&c).unwrap(), 3);
        migrate_down(&mut c).unwrap();
        assert_eq!(current_version(&c).unwrap(), 2);
        assert_eq!(
            c.query_row(
                "SELECT markdown,created_at,updated_at FROM notes WHERE paper_arxiv_id='1706.03762'",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            )
            .unwrap(),
            (
                "original bytes 가".into(),
                "2026-08-18T00:00:02Z".into(),
                "2026-08-18T00:00:03Z".into()
            )
        );
    }

    #[test]
    fn populated_v2_rejects_downgrade_without_changing_schema_ledger_or_data() {
        let mut c = fresh();
        migrate_to_v2(&mut c);
        insert_v2_paper_and_note(&c, "Retained title", "retained note");

        assert!(matches!(
            migrate_down(&mut c),
            Err(StorageError::RollbackUnsafe)
        ));

        assert_eq!(current_version(&c).unwrap(), 2);
        assert!(canonical(&c, "table", "papers", PAPERS_DDL).unwrap());
        assert!(canonical(&c, "table", "notes", NOTES_DDL).unwrap());
        assert!(canonical(&c, "index", "papers_order_idx", PAPERS_ORDER_INDEX_DDL).unwrap());
        assert_eq!(
            c.query_row(
                "SELECT p.title,n.markdown FROM papers p JOIN notes n ON n.paper_arxiv_id=p.arxiv_id",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            )
            .unwrap(),
            ("Retained title".into(), "retained note".into())
        );
    }

    #[test]
    fn populated_v1_rejects_downgrade_without_changing_schema_ledger_or_data() {
        let mut c = fresh();
        ensure_ledger(&c).unwrap();
        c.execute(SETTINGS_DDL, []).unwrap();
        c.execute(
            "INSERT INTO schema_migrations VALUES(1,'1970-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        let credential_ref =
            CredentialRef::try_from("keychain:paprv:550e8400-e29b-41d4-a716-446655440000").unwrap();
        save_provider_settings(
            &c,
            &ProviderSettings {
                provider: ProviderId::Anthropic,
                credential_ref,
            },
        )
        .unwrap();

        assert!(matches!(
            migrate_down(&mut c),
            Err(StorageError::RollbackUnsafe)
        ));

        assert_eq!(current_version(&c).unwrap(), 1);
        assert!(canonical(&c, "table", "app_settings", SETTINGS_DDL).unwrap());
        assert_eq!(
            c.query_row(
                "SELECT provider,credential_ref FROM app_settings WHERE id=1",
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            )
            .unwrap(),
            (
                "anthropic".into(),
                "keychain:paprv:550e8400-e29b-41d4-a716-446655440000".into()
            )
        );
    }

    #[test]
    fn failed_v3_ledger_insert_rolls_back_to_untouched_v2() {
        let mut c = fresh();
        migrate_to_v2(&mut c);
        insert_v2_paper_and_note(&c, "Title", "original");
        c.execute_batch("CREATE TRIGGER reject_v3 BEFORE INSERT ON schema_migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'rejected'); END;").unwrap();
        assert!(migrate_up(&mut c).is_err());
        assert_eq!(current_version(&c).unwrap(), 2);
        assert_eq!(
            c.query_row("SELECT markdown FROM notes", [], |row| row
                .get::<_, String>(0))
                .unwrap(),
            "original"
        );
        assert!(!table_exists(&c, "markdown_documents").unwrap());
    }

    #[test]
    fn v4_migration_rejects_deleted_document_source_atomically() {
        let mut c = fresh();
        migrate_to_v2(&mut c);
        insert_v2_paper_and_note(&c, "Title", "legacy note");
        migrate_v2_to_v3(&mut c).unwrap();
        let source = create_document(&mut c, "Source", "source body").unwrap();
        c.execute(
            "INSERT INTO study_artifacts(id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,source_document_id,source_revision,selection_start_utf8,selection_end_utf8,markdown,generated_at,saved_at) VALUES('artifact-deleted-source','1706.03762','claude_code','1.0.0','explain_simply','english','document',?1,1,NULL,NULL,'artifact','2026-08-18T00:00:00Z','2026-08-18T00:00:01Z')",
            [&source.id],
        )
        .unwrap();
        delete_document(&mut c, &source.id).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT source_document_id FROM study_artifacts WHERE id='artifact-deleted-source'",
                [],
                |row| row.get::<_, Option<String>>(0)
            )
            .unwrap(),
            None
        );

        assert!(matches!(
            migrate_up(&mut c),
            Err(StorageError::RollbackUnsafe)
        ));

        assert_eq!(current_version(&c).unwrap(), 3);
        assert!(!table_exists(&c, "artifact_source_snapshots").unwrap());
        assert_eq!(
            c.query_row(
                "SELECT source_kind,source_revision,markdown FROM study_artifacts WHERE id='artifact-deleted-source'",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                }
            )
            .unwrap(),
            ("document".into(), 1, "artifact".into())
        );
    }

    #[test]
    fn unsafe_downgrade_is_rejected_without_changes() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        create_document(&mut c, "new", "data").unwrap();
        migrate_down(&mut c).unwrap();
        migrate_down(&mut c).unwrap();
        assert!(matches!(
            migrate_down(&mut c),
            Err(StorageError::RollbackUnsafe)
        ));
        assert_eq!(current_version(&c).unwrap(), 3);
        assert_eq!(list_documents(&c).unwrap().len(), 1);
    }

    #[test]
    fn renamed_legacy_document_rejects_downgrade_without_changes() {
        let mut c = fresh();
        migrate_to_v2(&mut c);
        insert_v2_paper_and_note(&c, "Title", "original bytes");
        migrate_up(&mut c).unwrap();
        let original = get_document(&c, "legacy-note:1706.03762").unwrap();
        update_document(&mut c, &original.id, 1, "Renamed", &original.markdown).unwrap();
        migrate_down(&mut c).unwrap();
        migrate_down(&mut c).unwrap();

        assert!(matches!(
            migrate_down(&mut c),
            Err(StorageError::RollbackUnsafe)
        ));
        assert_eq!(current_version(&c).unwrap(), 3);
        let retained = get_document(&c, &original.id).unwrap();
        assert_eq!(retained.title, "Renamed");
        assert_eq!(retained.revision, 2);
        assert!(!table_exists(&c, "notes").unwrap());
    }

    #[test]
    fn v5_canonical_check_requires_snapshots_for_every_document_source_kind() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        upsert_paper(&mut c, &sample_metadata()).unwrap();
        let source = create_document(&mut c, "Source", "source body").unwrap();
        for (id, kind, start, end) in [
            ("document-artifact", "document", None, None),
            ("selection-artifact", "document_selection", Some(0), Some(6)),
        ] {
            c.execute(
                "INSERT INTO study_artifacts(id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,source_document_id,source_revision,selection_start_utf8,selection_end_utf8,markdown,generated_at,saved_at) VALUES(?1,'1706.03762','claude_code','1.0.0','explain_simply','english',?2,?3,1,?4,?5,'artifact','2026-08-18T00:00:00Z','2026-08-18T00:00:01Z')",
                params![id, kind, source.id, start, end],
            )
            .unwrap();
            c.execute(
                "INSERT INTO artifact_source_snapshots VALUES(?1,?2)",
                params![id, source.id],
            )
            .unwrap();
        }

        for id in ["document-artifact", "selection-artifact"] {
            c.execute(
                "DELETE FROM artifact_source_snapshots WHERE artifact_id=?1",
                [id],
            )
            .unwrap();
            assert!(matches!(current_version(&c), Err(StorageError::V3Drift)));
            c.execute(
                "INSERT INTO artifact_source_snapshots VALUES(?1,?2)",
                params![id, source.id],
            )
            .unwrap();
            assert_eq!(current_version(&c).unwrap(), 5);
        }
    }

    #[test]
    fn v4_canonical_check_rejects_live_source_snapshot_mismatches() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        upsert_paper(&mut c, &sample_metadata()).unwrap();
        let source = create_document(&mut c, "Source", "source body").unwrap();
        let other = create_document(&mut c, "Other", "other body").unwrap();

        for (id, kind, start, end) in [
            ("document-mismatch", "document", None, None),
            ("selection-mismatch", "document_selection", Some(0), Some(6)),
        ] {
            c.execute(
                "INSERT INTO study_artifacts(id,paper_arxiv_id,provider,provider_version,level,output_language,source_kind,source_document_id,source_revision,selection_start_utf8,selection_end_utf8,markdown,generated_at,saved_at) VALUES(?1,'1706.03762','claude_code','1.0.0','explain_simply','english',?2,?3,1,?4,?5,'artifact','2026-08-18T00:00:00Z','2026-08-18T00:00:01Z')",
                params![id, kind, source.id, start, end],
            )
            .unwrap();
            c.execute(
                "INSERT INTO artifact_source_snapshots VALUES(?1,?2)",
                params![id, source.id],
            )
            .unwrap();
            assert_eq!(current_version(&c).unwrap(), 5);

            c.execute(
                "UPDATE artifact_source_snapshots SET source_document_snapshot_id=?2 WHERE artifact_id=?1",
                params![id, other.id],
            )
            .unwrap();
            assert!(matches!(current_version(&c), Err(StorageError::V3Drift)));

            c.execute(
                "UPDATE artifact_source_snapshots SET source_document_snapshot_id=?2 WHERE artifact_id=?1",
                params![id, source.id],
            )
            .unwrap();
            assert_eq!(current_version(&c).unwrap(), 5);
        }

        delete_document(&mut c, &source.id).unwrap();
        assert_eq!(current_version(&c).unwrap(), 5);
        assert_eq!(
            c.query_row(
                "SELECT count(*) FROM study_artifacts a JOIN artifact_source_snapshots s ON s.artifact_id=a.id WHERE a.source_document_id IS NULL AND s.source_document_snapshot_id=?1",
                [&source.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            2
        );
    }

    #[test]
    fn schema_and_ledger_drift_are_rejected() {
        let unknown = fresh();
        ensure_ledger(&unknown).unwrap();
        unknown
            .execute("INSERT INTO schema_migrations VALUES(5,'future')", [])
            .unwrap();
        assert!(matches!(
            current_version(&unknown),
            Err(StorageError::MigrationHistory)
        ));
        let mut drifted = fresh();
        migrate_up(&mut drifted).unwrap();
        drifted
            .execute("DROP INDEX document_paper_links_paper_idx", [])
            .unwrap();
        assert!(matches!(
            current_version(&drifted),
            Err(StorageError::V3Drift)
        ));
    }

    #[test]
    fn document_crud_revisions_limits_and_uuid_ids_are_enforced() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        let document = create_document(&mut c, "Independent", "# body").unwrap();
        assert_eq!(Uuid::parse_str(&document.id).unwrap().get_version_num(), 4);
        assert_eq!(document.revision, 1);
        let updated = update_document(&mut c, &document.id, 1, "Renamed", "next").unwrap();
        assert_eq!(updated.revision, 2);
        assert!(matches!(
            update_document(&mut c, &document.id, 1, "stale", "stale"),
            Err(StorageError::DocumentConflict)
        ));
        assert!(matches!(
            create_document(&mut c, &"가".repeat(86), ""),
            Err(StorageError::ByteLimit)
        ));
        assert!(matches!(
            create_document(&mut c, "ok", &"가".repeat(87_382)),
            Err(StorageError::ByteLimit)
        ));
        delete_document(&mut c, &document.id).unwrap();
        assert!(matches!(
            get_document(&c, &document.id),
            Err(StorageError::DocumentNotFound)
        ));
    }

    #[test]
    fn explicit_links_reject_duplicates_and_cascade() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        upsert_paper(&mut c, &sample_metadata()).unwrap();
        let document = create_document(&mut c, "Independent", "# body").unwrap();
        link_document_paper(&mut c, &document.id, "1706.03762").unwrap();
        assert!(matches!(
            link_document_paper(&mut c, &document.id, "1706.03762"),
            Err(StorageError::DuplicateLink)
        ));
        assert_eq!(paper_backlinks(&c, "1706.03762").unwrap().len(), 1);
        delete_document(&mut c, &document.id).unwrap();
        assert!(paper_backlinks(&c, "1706.03762").unwrap().is_empty());
    }

    #[test]
    fn artifacts_are_explicit_private_and_retain_provenance_after_source_delete() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        upsert_paper(&mut c, &sample_metadata()).unwrap();
        let source = create_document(&mut c, "Source", "saved source").unwrap();
        let input = NewStudyArtifact {
            paper_arxiv_id: "1706.03762".into(),
            provider: "claude_code".into(),
            provider_version: "1.0.0".into(),
            level: "explain_simply".into(),
            output_language: "english".into(),
            source_kind: "document".into(),
            source_document_id: Some(source.id.clone()),
            source_revision: Some(1),
            selection_start_utf8: None,
            selection_end_utf8: None,
            markdown: "artifact".into(),
            generated_at: "2026-08-18T00:00:00Z".into(),
        };
        let artifact = save_study_artifact(&mut c, &input).unwrap();
        assert_eq!(Uuid::parse_str(&artifact.id).unwrap().get_version_num(), 4);
        assert!(
            document_properties(&c, &source.id)
                .unwrap()
                .artifacts
                .is_empty()
        );
        delete_document(&mut c, &source.id).unwrap();
        let retained = list_study_artifacts(&c, "1706.03762").unwrap();
        assert_eq!(retained[0].source_document_id, None);
        assert_eq!(
            retained[0].source_document_snapshot_id.as_deref(),
            Some(source.id.as_str())
        );
        assert_eq!(retained[0].source_revision, Some(1));
    }

    #[test]
    fn paper_upsert_creates_study_and_preserves_documents_links_and_artifacts() {
        let mut c = fresh();
        migrate_up(&mut c).unwrap();
        let mut metadata = sample_metadata();
        upsert_paper(&mut c, &metadata).unwrap();
        let document = create_document(&mut c, "Doc", "body").unwrap();
        link_document_paper(&mut c, &document.id, &metadata.arxiv_id).unwrap();
        metadata.title = "Updated".into();
        upsert_paper(&mut c, &metadata).unwrap();
        assert_eq!(
            get_study(&c, &metadata.arxiv_id).unwrap().paper_arxiv_id,
            metadata.arxiv_id
        );
        assert_eq!(get_document(&c, &document.id).unwrap().markdown, "body");
        assert_eq!(
            document_properties(&c, &document.id).unwrap().papers.len(),
            1
        );
    }

    #[test]
    fn credential_storage_remains_closed() {
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
        assert!(CredentialRef::try_from("raw-api-key").is_err());
    }
}
