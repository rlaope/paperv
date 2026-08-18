use serde::Serialize;

#[cfg(debug_assertions)]
use std::io::Write;
#[cfg(debug_assertions)]
use std::path::{Component, Path, PathBuf};

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

#[cfg(debug_assertions)]
fn renderer_marker(info: &SystemInfo) -> String {
    let platform = match info.platform {
        Platform::Macos => "macos",
        Platform::Windows => "windows",
        Platform::Linux => "linux",
    };
    format!("PAPRV_RENDERER_READY:{platform}:{}", info.version)
}

#[cfg(debug_assertions)]
fn ready_marker(info: &SystemInfo, pid: u32) -> String {
    format!("{}:{pid}", renderer_marker(info))
}

#[cfg(debug_assertions)]
fn validate_runtime_smoke_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path.file_name().and_then(|name| name.to_str()) != Some("renderer-ready")
        || path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err("runtime smoke marker rejected".into());
    }

    let temp_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| "runtime smoke marker rejected".to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "runtime smoke marker rejected".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "runtime smoke marker rejected".to_string())?;
    if parent != canonical_parent || canonical_parent.parent() != Some(temp_root.as_path()) {
        return Err("runtime smoke marker rejected".into());
    }

    let directory_name = canonical_parent
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "runtime smoke marker rejected".to_string())?;
    let Some(suffix) = directory_name.strip_prefix("paprv-runtime-smoke-") else {
        return Err("runtime smoke marker rejected".into());
    };
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err("runtime smoke marker rejected".into());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = canonical_parent
            .metadata()
            .map_err(|_| "runtime smoke marker rejected".to_string())?;
        if !metadata.is_dir() || metadata.permissions().mode() & 0o777 != 0o700 {
            return Err("runtime smoke marker rejected".into());
        }
    }

    match path.symlink_metadata() {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        _ => Err("runtime smoke marker rejected".into()),
    }
}

#[cfg(debug_assertions)]
#[tauri::command]
pub fn runtime_smoke_ready(marker: String) -> Result<bool, String> {
    let Some(path) = std::env::var_os("PAPRV_RUNTIME_SMOKE_PATH").map(PathBuf::from) else {
        return Ok(false);
    };
    let info = system_get_info();
    if marker != renderer_marker(&info) {
        return Err("runtime smoke marker rejected".into());
    }
    let path = validate_runtime_smoke_path(&path)?;
    let marker = ready_marker(&info, std::process::id());
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

    #[cfg(debug_assertions)]
    #[test]
    fn renderer_ready_marker_is_derived_from_validated_system_info_and_process() {
        assert_eq!(
            ready_marker(&system_get_info(), 4242),
            format!("PAPRV_RENDERER_READY:{}:0.0.1:4242", std::env::consts::OS)
        );
    }

    #[cfg(all(debug_assertions, unix))]
    #[test]
    fn runtime_smoke_path_requires_private_canonical_temp_child() {
        use std::os::unix::fs::{PermissionsExt, symlink};

        let root = std::env::temp_dir().canonicalize().unwrap();
        let nonce = uuid::Uuid::new_v4().simple();
        let allowed = root.join(format!("paprv-runtime-smoke-{nonce}"));
        std::fs::create_dir(&allowed).unwrap();
        std::fs::set_permissions(&allowed, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(
            validate_runtime_smoke_path(&allowed.join("renderer-ready")).unwrap(),
            allowed.join("renderer-ready")
        );
        assert!(validate_runtime_smoke_path(&allowed.join("other")).is_err());
        assert!(validate_runtime_smoke_path(&root.join("arbitrary-renderer-ready")).is_err());
        assert!(
            validate_runtime_smoke_path(
                &allowed
                    .join("..")
                    .join(allowed.file_name().unwrap())
                    .join("renderer-ready")
            )
            .is_err()
        );

        let link = root.join(format!("paprv-runtime-smoke-link-{nonce}"));
        symlink(&allowed, &link).unwrap();
        assert!(validate_runtime_smoke_path(&link.join("renderer-ready")).is_err());
        std::fs::remove_file(link).unwrap();

        std::fs::set_permissions(&allowed, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(validate_runtime_smoke_path(&allowed.join("renderer-ready")).is_err());
        std::fs::remove_dir_all(allowed).unwrap();
    }
}
