use crate::{generation, papers::AppState, storage};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandError {
    InvalidInput,
    PaperNotFound,
    DocumentNotFound,
    ArtifactNotFound,
    DocumentConflict,
    ByteLimit,
    StorageUnavailable,
}
fn map_error(error: storage::StorageError) -> CommandError {
    match error {
        storage::StorageError::InvalidInput => CommandError::InvalidInput,
        storage::StorageError::PaperNotFound => CommandError::PaperNotFound,
        storage::StorageError::DocumentNotFound => CommandError::DocumentNotFound,
        storage::StorageError::ArtifactNotFound => CommandError::ArtifactNotFound,
        storage::StorageError::DocumentConflict => CommandError::DocumentConflict,
        storage::StorageError::ByteLimit => CommandError::ByteLimit,
        _ => CommandError::StorageUnavailable,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveArtifactInput {
    paper_id: String,
    run_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    document_id: String,
    title: String,
    created_at: String,
}
impl From<storage::DocumentBacklink> for Backlink {
    fn from(value: storage::DocumentBacklink) -> Self {
        Self {
            document_id: value.document_id,
            title: value.title,
            created_at: value.created_at,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyView {
    paper_id: String,
    created_at: String,
    updated_at: String,
    backlinks: Vec<Backlink>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    id: String,
    paper_id: String,
    provider: String,
    provider_version: String,
    level: String,
    output_language: String,
    source_kind: String,
    source_document_id: Option<String>,
    source_document_snapshot_id: Option<String>,
    source_revision: Option<i64>,
    selection_start_utf8: Option<i64>,
    selection_end_utf8: Option<i64>,
    markdown: String,
    generated_at: String,
    saved_at: String,
    backlinks: Vec<Backlink>,
}
fn artifact(value: storage::StoredStudyArtifact, backlinks: Vec<Backlink>) -> Artifact {
    Artifact {
        id: value.id,
        paper_id: value.paper_arxiv_id,
        provider: value.provider,
        provider_version: value.provider_version,
        level: value.level,
        output_language: value.output_language,
        source_kind: value.source_kind,
        source_document_id: value.source_document_id,
        source_document_snapshot_id: value.source_document_snapshot_id,
        source_revision: value.source_revision,
        selection_start_utf8: value.selection_start_utf8,
        selection_end_utf8: value.selection_end_utf8,
        markdown: value.markdown,
        generated_at: value.generated_at,
        saved_at: value.saved_at,
        backlinks,
    }
}

async fn with_database<T, F>(path: PathBuf, task: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(&mut rusqlite::Connection) -> Result<T, storage::StorageError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let mut connection = storage::open_connection(&path)?;
        task(&mut connection)
    })
    .await
    .map_err(|_| CommandError::StorageUnavailable)?
    .map_err(map_error)
}

#[tauri::command]
pub async fn study_get(
    paper_id: String,
    state: State<'_, AppState>,
) -> Result<StudyView, CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        let study = storage::get_study(connection, &paper_id)?;
        let backlinks = storage::paper_backlinks(connection, &paper_id)?
            .into_iter()
            .map(Backlink::from)
            .collect();
        Ok(StudyView {
            paper_id: study.paper_arxiv_id,
            created_at: study.created_at,
            updated_at: study.updated_at,
            backlinks,
        })
    })
    .await
}
#[tauri::command]
pub async fn study_list_artifacts(
    paper_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Artifact>, CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::list_study_artifacts(connection, &paper_id)?
            .into_iter()
            .map(|stored| {
                let backlinks = storage::artifact_backlinks(connection, &stored.id)?
                    .into_iter()
                    .map(Backlink::from)
                    .collect();
                Ok(artifact(stored, backlinks))
            })
            .collect()
    })
    .await
}
#[tauri::command]
pub async fn study_save_artifact(
    input: SaveArtifactInput,
    app: State<'_, AppState>,
    generation: State<'_, generation::GenerationState>,
) -> Result<Artifact, CommandError> {
    let generation = generation.inner().clone();
    with_database(app.database_path.clone(), move |connection| {
        let stored = generation.save_artifact(connection, &input.run_id, &input.paper_id)?;
        Ok(artifact(stored, Vec::new()))
    })
    .await
}
#[tauri::command]
pub async fn study_delete_artifact(
    artifact_id: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::delete_study_artifact(connection, &artifact_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_input_rejects_private_or_provider_envelope_fields() {
        let base = serde_json::json!({"paperId":"1706.03762","runId":"run-id"});
        assert!(serde_json::from_value::<SaveArtifactInput>(base.clone()).is_ok());
        let mut private = base;
        private["sourceText"] = serde_json::json!("secret");
        assert!(serde_json::from_value::<SaveArtifactInput>(private).is_err());
    }
}
