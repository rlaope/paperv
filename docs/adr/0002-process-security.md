# ADR 0002: Process security boundary

- Status: Accepted
- Decision: Separate main, preload, and renderer. Disable Node integration, enable context isolation and sandboxing, expose only validated IPC, deny new windows, and block navigation outside the initial local app origin.
- Consequences: Renderer code cannot directly reach Node, files, SQLite, or credentials. New capabilities must be added as narrow reviewed contracts.
