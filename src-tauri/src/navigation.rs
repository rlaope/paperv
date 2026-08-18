use tauri::Url;

pub fn is_navigation_allowed(url: &Url) -> bool {
    is_navigation_allowed_for_mode(url, cfg!(dev))
}

fn is_navigation_allowed_for_mode(url: &Url, development: bool) -> bool {
    let has_credentials = !url.username().is_empty() || url.password().is_some();
    if has_credentials {
        return false;
    }
    if development {
        return url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(1420);
    }
    url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(raw: &str, development: bool) -> bool {
        is_navigation_allowed_for_mode(&raw.parse().unwrap(), development)
    }

    #[test]
    fn production_allows_only_the_bundled_tauri_asset_origin() {
        assert!(allowed("tauri://localhost/", false));
        assert!(allowed("tauri://localhost/assets/index.js", false));
        for rejected in [
            "https://evil.example/",
            "javascript:alert(1)",
            "file:///tmp/renderer.html",
            "http://127.0.0.1:1420/",
            "tauri://evil.example/",
            "tauri://user@localhost/",
        ] {
            assert!(!allowed(rejected, false), "unexpectedly allowed {rejected}");
        }
    }

    #[test]
    fn development_allows_only_the_exact_vite_origin() {
        assert!(allowed("http://127.0.0.1:1420/", true));
        assert!(allowed("http://127.0.0.1:1420/src/main.tsx", true));
        for rejected in [
            "http://localhost:1420/",
            "http://127.0.0.1:1421/",
            "https://127.0.0.1:1420/",
            "http://user@127.0.0.1:1420/",
            "tauri://localhost/",
            "https://evil.example/",
            "javascript:alert(1)",
            "file:///tmp/renderer.html",
        ] {
            assert!(!allowed(rejected, true), "unexpectedly allowed {rejected}");
        }
    }
}
