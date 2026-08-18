# ADR 0006: Explicit Electron-to-Tauri/Rust transition

- Status: Accepted
- Date: 2026-08-18
- Context: The accepted global plan originally selected Electron for M0 and the repository implemented that foundation. The user explicitly approved replacing it with a Rust-based desktop architecture. The global plan is preserved unchanged; this repository ADR records the authorized override.
- Decision: Remove the Electron runtime, preload, Electron-specific smoke harness, and JavaScript SQLite implementation. Replace them with Tauri 2, a standard Vite React/TypeScript renderer, and a Rust backend owning commands, local storage, migrations, provider-setting invariants, and fixed-event logging.
- Security boundary: M0 registers exactly `system_get_info`, grants no Tauri plugin/core API permissions, loads only bundled assets (or the loopback Vite origin in development), and enables no shell, HTTP, filesystem, dialog, updater, PDF/import, or AI functionality.
- Consequences: Existing Electron ADR text is superseded by the revised ADRs 0001–0004. Local debug `.app` output proves buildability but not signing, notarization, distribution, or remote CI execution.
