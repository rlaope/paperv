use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct SystemInfo {
    platform: Platform,
    version: &'static str,
}

#[tauri::command]
pub fn system_get_info() -> SystemInfo {
    let platform = if cfg!(target_os = "macos") {
        Platform::Macos
    } else if cfg!(target_os = "windows") {
        Platform::Windows
    } else {
        Platform::Linux
    };
    SystemInfo {
        platform,
        version: env!("CARGO_PKG_VERSION"),
    }
}

fn ready_marker(info: &SystemInfo) -> String {
    let platform = match info.platform {
        Platform::Macos => "macos",
        Platform::Windows => "windows",
        Platform::Linux => "linux",
    };
    format!("PAPRV_RENDERER_READY:{platform}:{}", info.version)
}

#[tauri::command]
pub fn runtime_smoke_ready(marker: String) -> Result<bool, String> {
    let Some(path) = std::env::var_os("PAPRV_RUNTIME_SMOKE_PATH").map(PathBuf::from) else {
        return Ok(false);
    };
    if !path.is_absolute() || marker != ready_marker(&system_get_info()) {
        return Err("runtime smoke marker rejected".into());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "runtime smoke marker unavailable".to_string())?;
    file.write_all(marker.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| "runtime smoke marker unavailable".to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_closed_platform_and_package_version() {
        let info = system_get_info();
        assert_eq!(info.version, "0.0.1");
        assert!(matches!(
            info.platform,
            Platform::Macos | Platform::Windows | Platform::Linux
        ));
    }

    #[test]
    fn renderer_ready_marker_is_derived_from_validated_system_info() {
        assert_eq!(
            ready_marker(&system_get_info()),
            format!("PAPRV_RENDERER_READY:{}:0.0.1", std::env::consts::OS)
        );
    }
}
