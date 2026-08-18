# ADR 0003: Rust-owned SQLite storage

- Status: Accepted; revised for Tauri by ADR 0006
- Decision: Use `rusqlite` with bundled SQLite in the Rust backend. Migrations are ordered, transactional, reversible, and fail closed on an unknown version, a version gap, migration-ledger drift, application-table column/constraint drift, or a partially applied transaction. Validate canonical `schema_migrations` and `app_settings` DDL.
- Consequences: The renderer has no database API. `ProviderId` is a closed Rust enum (`openai`, `anthropic`, `google`, `xai`, `ollama`). Only canonical `keychain:paprv:<UUID-v4>` references may be persisted; raw API keys are rejected by the Rust type boundary and SQLite constraints. OS credential-store integration remains outside M0.
