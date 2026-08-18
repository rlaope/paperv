# ADR 0004: Provider boundary

- Status: Accepted as a boundary; provider selection and calls deferred
- Decision: Keep future LLM, embedding, and arXiv integrations behind Rust adapters. No provider call or network permission is implemented in M0. API keys belong in the macOS credential store, not logs, renderer state, or SQLite. SQLite may contain only a canonical app-namespaced credential reference for the closed provider enum.
- Consequences: Pricing, retention, model selection, network scopes, and credential-store integration require later evidence-based ADRs. The M0 logger accepts only fixed event and context enums plus bounded numeric scalars, never arbitrary messages or error strings.
