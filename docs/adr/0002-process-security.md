# ADR 0002: Tauri capability and command boundary

- Status: Accepted; revised for Tauri by ADR 0006
- Decision: Treat the webview renderer as untrusted. Expose only `system_get_info` through `generate_handler!`; it accepts no request payload. Validate its response again with Zod in the renderer. Bind the sole capability to the `main` window with an empty permissions list. Do not enable shell, HTTP, filesystem, dialog, updater, remote URL, or additional-window permissions in M0. Enforce a strict CSP from Tauri configuration.
- Consequences: The renderer cannot directly access files, SQLite, credentials, network plugins, or process APIs. Every future command or permission requires a security review, typed input validation, and negative tests.
