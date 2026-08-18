use serde::Serialize;

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
}
