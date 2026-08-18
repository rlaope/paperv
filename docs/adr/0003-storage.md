# ADR 0003: Local storage

- Status: Accepted for M0
- Decision: Use SQLite through `sql.js` (WebAssembly) with ordered reversible migrations. Validate that migration definitions are a unique contiguous sequence from version 1 and that applied rows are an exact prefix with their required tables present. Persistence writes exported bytes atomically in the main process when introduced.
- Consequences: M0 exercises real SQLite semantics without a native Node ABI module, reducing Electron packaging risk. Large-dataset performance and atomic file persistence remain later milestone validation items. API keys are never columns; only opaque app-namespaced OS credential-store references in `keychain:paprv:<UUID>` form may be persisted.
