#[cfg(test)]
mod tests {
    use serde_json::Value;

    #[test]
    fn tauri_configuration_is_local_and_capability_is_empty() {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], "ai.sionic.paprv");
        assert_eq!(config["build"]["frontendDist"], "../dist");
        assert_eq!(config["build"]["devUrl"], "http://127.0.0.1:1420");
        assert!(config["app"]["windows"][0].get("url").is_none());
        assert_eq!(config["app"]["windows"][0]["create"], false);
        let main = include_str!("main.rs");
        assert!(main.contains(".on_navigation(paprv::navigation::is_navigation_allowed)"));
        assert!(main.contains("NewWindowResponse::Deny"));
        let csp = config["app"]["security"]["csp"].as_str().unwrap();
        assert!(csp.starts_with("default-src 'self'"));
        assert!(!csp.contains("https:"));
        assert!(!csp.contains("unsafe-eval"));

        let capability: Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        assert_eq!(capability["permissions"], serde_json::json!([]));
        for denied in ["shell", "http", "fs", "dialog", "updater"] {
            assert!(!include_str!("../capabilities/default.json").contains(denied));
        }
    }
}
