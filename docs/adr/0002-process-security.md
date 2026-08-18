# ADR 0002: Process security boundary

- Status: Accepted
- Decision: Separate main, preload, and renderer. Disable Node integration, enable context isolation and sandboxing, expose only validated IPC, deny new windows, and block navigation and main-frame redirects outside the initial local app origin.
- Consequences: Renderer code cannot directly reach Node, files, SQLite, or credentials. New capabilities must be added as narrow reviewed contracts. M0's non-sensitive `system:get-info` IPC retains sender-origin validation as an explicit residual risk; every privileged IPC added later must reject senders whose frame URL is missing, is a subframe, or does not match the owning window's trusted initial origin.
