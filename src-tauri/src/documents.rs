use crate::{papers::AppState, storage};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommandError {
    InvalidInput,
    DocumentNotFound,
    PaperNotFound,
    ArtifactNotFound,
    DocumentConflict,
    DuplicateLink,
    LinkNotFound,
    ByteLimit,
    StorageUnavailable,
}

fn map_error(error: storage::StorageError) -> CommandError {
    match error {
        storage::StorageError::InvalidInput => CommandError::InvalidInput,
        storage::StorageError::DocumentNotFound => CommandError::DocumentNotFound,
        storage::StorageError::PaperNotFound => CommandError::PaperNotFound,
        storage::StorageError::ArtifactNotFound => CommandError::ArtifactNotFound,
        storage::StorageError::DocumentConflict => CommandError::DocumentConflict,
        storage::StorageError::DuplicateLink => CommandError::DuplicateLink,
        storage::StorageError::LinkNotFound => CommandError::LinkNotFound,
        storage::StorageError::ByteLimit => CommandError::ByteLimit,
        _ => CommandError::StorageUnavailable,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    id: String,
    title: String,
    markdown: String,
    revision: i64,
    created_at: String,
    updated_at: String,
}
impl From<storage::StoredDocument> for Document {
    fn from(value: storage::StoredDocument) -> Self {
        Self {
            id: value.id,
            title: value.title,
            markdown: value.markdown,
            revision: value.revision,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentListItem {
    id: String,
    title: String,
    revision: i64,
    updated_at: String,
}
impl From<storage::DocumentListItem> for DocumentListItem {
    fn from(value: storage::DocumentListItem) -> Self {
        Self {
            id: value.id,
            title: value.title,
            revision: value.revision,
            updated_at: value.updated_at,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperLink {
    arxiv_id: String,
    title: String,
    created_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactLink {
    artifact_id: String,
    paper_arxiv_id: String,
    created_at: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProperties {
    document_id: String,
    papers: Vec<PaperLink>,
    artifacts: Vec<ArtifactLink>,
}
impl From<storage::DocumentProperties> for DocumentProperties {
    fn from(value: storage::DocumentProperties) -> Self {
        Self {
            document_id: value.document_id,
            papers: value
                .papers
                .into_iter()
                .map(|link| PaperLink {
                    arxiv_id: link.arxiv_id,
                    title: link.title,
                    created_at: link.created_at,
                })
                .collect(),
            artifacts: value
                .artifacts
                .into_iter()
                .map(|link| ArtifactLink {
                    artifact_id: link.artifact_id,
                    paper_arxiv_id: link.paper_arxiv_id,
                    created_at: link.created_at,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateInput {
    title: String,
    markdown: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInput {
    document_id: String,
    expected_revision: i64,
    title: String,
    markdown: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteInput {
    document_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperLinkInput {
    document_id: String,
    paper_id: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactLinkInput {
    document_id: String,
    artifact_id: String,
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
pub async fn document_list(
    state: State<'_, AppState>,
) -> Result<Vec<DocumentListItem>, CommandError> {
    with_database(state.database_path.clone(), |connection| {
        storage::list_documents(connection)
            .map(|items| items.into_iter().map(DocumentListItem::from).collect())
    })
    .await
}
#[tauri::command]
pub async fn document_get(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<Document, CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::get_document(connection, &document_id).map(Document::from)
    })
    .await
}
#[tauri::command]
pub async fn document_create(
    input: CreateInput,
    state: State<'_, AppState>,
) -> Result<Document, CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::create_document(connection, &input.title, &input.markdown).map(Document::from)
    })
    .await
}
#[tauri::command]
pub async fn document_update(
    input: UpdateInput,
    state: State<'_, AppState>,
) -> Result<Document, CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::update_document(
            connection,
            &input.document_id,
            input.expected_revision,
            &input.title,
            &input.markdown,
        )
        .map(Document::from)
    })
    .await
}
#[tauri::command]
pub async fn document_delete(
    input: DeleteInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::delete_document(connection, &input.document_id)
    })
    .await
}
#[tauri::command]
pub async fn document_get_properties(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<DocumentProperties, CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::document_properties(connection, &document_id).map(DocumentProperties::from)
    })
    .await
}
#[tauri::command]
pub async fn document_link_paper(
    input: PaperLinkInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::link_document_paper(connection, &input.document_id, &input.paper_id)
    })
    .await
}
#[tauri::command]
pub async fn document_unlink_paper(
    input: PaperLinkInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::unlink_document_paper(connection, &input.document_id, &input.paper_id)
    })
    .await
}
#[tauri::command]
pub async fn document_link_artifact(
    input: ArtifactLinkInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::link_document_artifact(connection, &input.document_id, &input.artifact_id)
    })
    .await
}
#[tauri::command]
pub async fn document_unlink_artifact(
    input: ArtifactLinkInput,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    with_database(state.database_path.clone(), move |connection| {
        storage::unlink_document_artifact(connection, &input.document_id, &input.artifact_id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inputs_reject_renderer_ids_and_unknown_source_text() {
        assert!(
            serde_json::from_value::<CreateInput>(serde_json::json!({
                "id":"renderer-id","title":"Doc","markdown":""
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<CreateInput>(serde_json::json!({
                "title":"Doc","markdown":"","sourceText":"private"
            }))
            .is_err()
        );
        assert_eq!(
            serde_json::to_value(CommandError::DocumentConflict).unwrap(),
            "document_conflict"
        );
    }
}
