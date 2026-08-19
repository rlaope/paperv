# ADR 0006: Explicit Electron-to-Tauri/Rust transition

- Status: Accepted historical M0 transition; current commands and features are revised by ADRs 0007–0009
- Date: 2026-08-18
- Context: The accepted global plan originally selected Electron for M0 and the repository implemented that foundation. The user explicitly approved replacing it with a Rust-based desktop architecture. The global plan is preserved unchanged; this repository ADR records the authorized override.
- Decision: Remove the Electron runtime, preload, Electron-specific smoke harness, and JavaScript SQLite implementation. Replace them with Tauri 2, a standard Vite React/TypeScript renderer, and a Rust backend owning commands, local storage, migrations, provider-setting invariants, and fixed-event logging.
- Security boundary: At the M0 transition point, the app registered exactly `system_get_info`, granted no Tauri plugin/core API permissions, loaded only bundled assets (or the loopback Vite origin in development), and enabled no shell, HTTP, filesystem, dialog, updater, PDF/import, or AI functionality. This sentence records that historical milestone rather than the current command set; current metadata import, Study/Vault, storage, and local generation contracts are in ADRs 0007–0009.
- Consequences: Existing Electron ADR text is superseded by the revised ADRs 0001–0004. Local debug `.app` output proves buildability but not signing, notarization, distribution, or remote CI execution.
