# ADR 0003: Local storage

- Status: Accepted for M0
- Decision: Use SQLite through `sql.js` (WebAssembly) with ordered reversible migrations. Persistence writes exported bytes atomically in the main process when introduced.
- Consequences: M0 exercises real SQLite semantics without a native Node ABI module, reducing Electron packaging risk. Large-dataset performance and atomic file persistence remain later milestone validation items. API keys are never columns; only OS credential-store references may be persisted.
