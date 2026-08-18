#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use paprv::logger::{ErrorCode, LogContext, LogEvent, stderr_event};
use std::io;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
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
            paprv::storage::open_or_initialize(&app_data.join("paprv.sqlite3")).map_err(|_| {
                stderr_event(
                    LogEvent::StorageMigrationFailed,
                    LogContext {
                        error_code: Some(ErrorCode::MigrationRejected),
                        ..LogContext::default()
                    },
                );
                io::Error::other("database initialization rejected")
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![paprv::system::system_get_info])
        .run(tauri::generate_context!())
        .expect("Paprv runtime failed");
}
