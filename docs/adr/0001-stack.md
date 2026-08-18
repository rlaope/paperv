# ADR 0001: Tauri 2, React, TypeScript, and Rust

- Status: Accepted; supersedes the original Electron decision through ADR 0006
- Decision: Use Tauri 2 for the macOS-first desktop shell, React and TypeScript for the unprivileged renderer, and Rust for commands, persistence, migrations, provider-setting invariants, and security-sensitive logging. Use pnpm for the web toolchain and Cargo for the backend.
- Alternatives: Electron was implemented for M0 but was explicitly replaced. A browser-only application does not meet the desktop requirement.
- Consequences: Native capabilities and command exposure remain narrow, while SQLite and privileged policy are compiled Rust. The team must maintain both TypeScript and Rust quality gates and Tauri packaging.
