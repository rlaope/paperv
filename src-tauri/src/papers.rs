use crate::{
    arxiv::{ArxivApiClient, ArxivApiError, ArxivId},
    logger::{ErrorCode, LogContext, LogEvent, stderr_event},
    storage,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

pub struct AppState {
    pub database_path: PathBuf,
    pub arxiv_client: ArxivApiClient,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArxivPaperInput {
    pub reference: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperListItem {
    pub arxiv_id: String,
    pub arxiv_version: u32,
    pub title: String,
    pub authors: Vec<String>,
    pub primary_category: Option<String>,
    pub published_at: String,
    pub metadata_fetched_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperDetail {
    pub arxiv_id: String,
    pub arxiv_version: u32,
    pub title: String,
    pub summary: String,
    pub authors: Vec<String>,
    pub primary_category: Option<String>,
    pub categories: Vec<String>,
    pub published_at: String,
    pub source_updated_at: String,
    pub imported_at: String,
    pub metadata_fetched_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandError {
    InvalidArxivReference,
    PaperNotFound,
    ArxivMetadataUnavailable,
    ArxivMetadataInvalid,

    StorageUnavailable,
}

fn paper_detail(paper: storage::StoredPaper) -> PaperDetail {
    let metadata = paper.metadata;
    PaperDetail {
        arxiv_id: metadata.arxiv_id,
        arxiv_version: metadata.arxiv_version,
        title: metadata.title,
        summary: metadata.summary,
        authors: metadata.authors,
        primary_category: metadata.categories.first().cloned(),
        categories: metadata.categories,
        published_at: metadata.published_at,
        source_updated_at: metadata.source_updated_at,
        imported_at: paper.imported_at,
        metadata_fetched_at: paper.metadata_fetched_at,
    }
}

fn storage_error(error: storage::StorageError) -> CommandError {
    match error {
        storage::StorageError::PaperNotFound => CommandError::PaperNotFound,
        _ => CommandError::StorageUnavailable,
    }
}

fn arxiv_error(error: ArxivApiError) -> CommandError {
    match error {
        ArxivApiError::InvalidMetadata => {
            stderr_event(LogEvent::ArxivMetadataRejected, LogContext::default());
            CommandError::ArxivMetadataInvalid
        }
        ArxivApiError::Unavailable => {
            stderr_event(
                LogEvent::ArxivMetadataRejected,
                LogContext {
                    error_code: Some(ErrorCode::ArxivUnavailable),
                    ..LogContext::default()
                },
            );
            CommandError::ArxivMetadataUnavailable
        }
    }
}

async fn run_blocking<T, F>(task: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|_| CommandError::ArxivMetadataUnavailable)?
}

#[tauri::command]
pub async fn import_arxiv_paper(
    input: ImportArxivPaperInput,
    state: State<'_, AppState>,
) -> Result<PaperDetail, CommandError> {
    let id =
        ArxivId::parse_input(&input.reference).map_err(|_| CommandError::InvalidArxivReference)?;
    let client = state.arxiv_client.clone();
    let fetch_id = id.clone();
    let metadata =
        run_blocking(move || client.fetch_metadata(&fetch_id).map_err(arxiv_error)).await?;
    let database_path = state.database_path.clone();
    let paper = run_blocking(move || {
        let mut connection = storage::open_connection(&database_path)
            .map_err(|_| CommandError::StorageUnavailable)?;
        storage::upsert_paper(&mut connection, &metadata).map_err(storage_error)?;
        storage::get_paper(&connection, id.base_id()).map_err(storage_error)
    })
    .await?;
    stderr_event(LogEvent::ArxivPaperImported, LogContext::default());
    Ok(paper_detail(paper))
}

#[tauri::command]
pub fn list_papers(state: State<'_, AppState>) -> Result<Vec<PaperListItem>, CommandError> {
    let connection = storage::open_connection(&state.database_path)
        .map_err(|_| CommandError::StorageUnavailable)?;
    let papers = storage::list_papers(&connection).map_err(storage_error)?;
    Ok(papers
        .into_iter()
        .map(|paper| PaperListItem {
            arxiv_id: paper.metadata.arxiv_id,
            arxiv_version: paper.metadata.arxiv_version,
            title: paper.metadata.title,
            primary_category: paper.metadata.categories.first().cloned(),
            authors: paper.metadata.authors,
            published_at: paper.metadata.published_at,
            metadata_fetched_at: paper.metadata_fetched_at,
        })
        .collect())
}

#[tauri::command]
pub fn get_paper(
    arxiv_id: String,
    state: State<'_, AppState>,
) -> Result<PaperDetail, CommandError> {
    let id = ArxivId::parse_canonical_base(&arxiv_id)
        .map_err(|_| CommandError::InvalidArxivReference)?;
    let connection = storage::open_connection(&state.database_path)
        .map_err(|_| CommandError::StorageUnavailable)?;
    storage::get_paper(&connection, id.base_id())
        .map(paper_detail)
        .map_err(storage_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_detail_serializes_first_category_as_primary_category() {
        let detail = paper_detail(storage::StoredPaper {
            metadata: storage::PaperMetadata {
                arxiv_id: "1706.03762".into(),
                arxiv_version: 7,
                title: "Attention Is All You Need".into(),
                summary: "Summary".into(),
                authors: vec!["Ashish Vaswani".into()],
                categories: vec!["cs.CL".into(), "cs.LG".into()],
                published_at: "2017-06-12T17:57:34Z".into(),
                source_updated_at: "2023-08-02T00:41:18Z".into(),
            },
            imported_at: "2026-08-18T00:00:00Z".into(),
            metadata_fetched_at: "2026-08-18T00:00:00Z".into(),
        });
        assert_eq!(detail.primary_category.as_deref(), Some("cs.CL"));
        assert_eq!(
            serde_json::to_value(detail).unwrap()["primaryCategory"],
            "cs.CL"
        );
    }

    #[test]
    fn blocking_work_runs_off_the_async_executor() {
        tauri::async_runtime::block_on(async {
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let blocking = tauri::async_runtime::spawn(run_blocking(move || {
                release_rx.recv().unwrap();
                Ok::<_, CommandError>(42)
            }));
            let responsive = tauri::async_runtime::spawn(async { 7 });

            assert_eq!(responsive.await.unwrap(), 7);
            release_tx.send(()).unwrap();
            assert_eq!(blocking.await.unwrap().unwrap(), 42);
        });
    }

    #[test]
    fn maps_arxiv_and_storage_failures_to_fixed_command_errors() {
        assert!(matches!(
            arxiv_error(ArxivApiError::Unavailable),
            CommandError::ArxivMetadataUnavailable
        ));
        assert!(matches!(
            arxiv_error(ArxivApiError::InvalidMetadata),
            CommandError::ArxivMetadataInvalid
        ));
        assert!(matches!(
            storage_error(storage::StorageError::PaperNotFound),
            CommandError::PaperNotFound
        ));
        assert!(matches!(
            storage_error(storage::StorageError::PapersDrift),
            CommandError::StorageUnavailable
        ));
    }
}
