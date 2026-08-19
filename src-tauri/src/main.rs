#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use paprv::logger::{ErrorCode, LogContext, LogEvent, stderr_event};
use std::io;
use tauri::Manager;

fn main() {
    let builder = tauri::Builder::default().setup(|app| {
        let app_data = app.path().app_data_dir().map_err(|_| {
            stderr_event(
                LogEvent::AppStartupFailed,
                LogContext {
                    error_code: Some(ErrorCode::AppDataUnavailable),
                    ..LogContext::default()
                },
            );
            io::Error::other("application data directory unavailable")
        })?;
        std::fs::create_dir_all(&app_data).map_err(|_| {
            stderr_event(
                LogEvent::AppStartupFailed,
                LogContext {
                    error_code: Some(ErrorCode::AppDataUnavailable),
                    ..LogContext::default()
                },
            );
            io::Error::other("application data directory unavailable")
        })?;
        let database_path = app_data.join("paprv.sqlite3");
        paprv::storage::open_or_initialize(&database_path).map_err(|_| {
            stderr_event(
                LogEvent::StorageMigrationFailed,
                LogContext {
                    error_code: Some(ErrorCode::MigrationRejected),
                    ..LogContext::default()
                },
            );
            io::Error::other("database initialization rejected")
        })?;
        let arxiv_client = paprv::arxiv::ArxivApiClient::new().map_err(|_| {
            stderr_event(
                LogEvent::AppStartupFailed,
                LogContext {
                    error_code: Some(ErrorCode::ArxivUnavailable),
                    ..LogContext::default()
                },
            );
            io::Error::other("arxiv client initialization unavailable")
        })?;
        app.manage(paprv::papers::AppState {
            database_path,
            arxiv_client,
        });
        app.manage(paprv::generation::GenerationState::from_process_environment());
        let window_config = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .cloned()
            .ok_or_else(|| io::Error::other("main window configuration unavailable"))?;
        let window = tauri::WebviewWindowBuilder::from_config(app, &window_config)?
            .on_navigation(paprv::navigation::is_navigation_allowed)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()?;
        let app_handle = app.handle().clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                app_handle
                    .state::<paprv::generation::GenerationState>()
                    .shutdown_and_wait();
            }
        });
        Ok(())
    });

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        paprv::system::system_get_info,
        paprv::system::runtime_smoke_ready,
        paprv::papers::import_arxiv_paper,
        paprv::papers::list_papers,
        paprv::papers::get_paper,
        paprv::documents::document_list,
        paprv::documents::document_get,
        paprv::documents::document_create,
        paprv::documents::document_update,
        paprv::documents::document_delete,
        paprv::documents::document_get_properties,
        paprv::documents::document_link_paper,
        paprv::documents::document_unlink_paper,
        paprv::documents::document_link_artifact,
        paprv::documents::document_unlink_artifact,
        paprv::study::study_get,
        paprv::study::study_list_artifacts,
        paprv::study::study_save_artifact,
        paprv::study::study_delete_artifact,
        paprv::generation::generation_get_readiness,
        paprv::generation::generation_start,
        paprv::generation::generation_get_run,
        paprv::generation::generation_cancel,
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        paprv::system::system_get_info,
        paprv::papers::import_arxiv_paper,
        paprv::papers::list_papers,
        paprv::papers::get_paper,
        paprv::documents::document_list,
        paprv::documents::document_get,
        paprv::documents::document_create,
        paprv::documents::document_update,
        paprv::documents::document_delete,
        paprv::documents::document_get_properties,
        paprv::documents::document_link_paper,
        paprv::documents::document_unlink_paper,
        paprv::documents::document_link_artifact,
        paprv::documents::document_unlink_artifact,
        paprv::study::study_get,
        paprv::study::study_list_artifacts,
        paprv::study::study_save_artifact,
        paprv::study::study_delete_artifact,
        paprv::generation::generation_get_readiness,
        paprv::generation::generation_start,
        paprv::generation::generation_get_run,
        paprv::generation::generation_cancel,
    ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("Paprv runtime failed");
    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            let generation = app_handle.state::<paprv::generation::GenerationState>();
            if !generation.is_closed() {
                api.prevent_exit();
                if let Some(window) = app_handle.get_webview_window("main") {
                    if window.close().is_err() {
                        stderr_event(
                            LogEvent::NativeWindowCloseFailed,
                            LogContext {
                                error_code: Some(ErrorCode::WindowCloseRejected),
                                ..LogContext::default()
                            },
                        );
                    }
                }
            }
        }
        tauri::RunEvent::Exit => app_handle
            .state::<paprv::generation::GenerationState>()
            .shutdown_and_wait(),
        _ => {}
    });
}
