# ADR 0004: Provider boundary

- Status: Accepted as a boundary; provider selection deferred
- Decision: Keep LLM, embedding, and arXiv integrations behind adapters. No provider call is implemented in M0. API keys belong in the macOS credential store, not logs, renderer state, or SQLite.
- Consequences: Pricing, retention, and model selection require a later evidence-based ADR before provider implementation.
