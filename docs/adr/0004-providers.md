# ADR 0004: Provider boundary

- Status: Historical M0 provider boundary; local CLI generation is revised by ADR 0008 and ADR 0009
- Decision: M0 kept future LLM, embedding, and arXiv integrations behind Rust adapters and implemented no provider call or renderer network permission. API keys belonged in the macOS credential store, not logs, renderer state, or SQLite. SQLite accepted only a canonical app-namespaced credential reference for the closed settings-provider enum.
- Consequences: The M0 credential and logging constraints remain. Current Study generation does not use those stored provider settings or collect an API key; it uses the separately accepted local CLI boundary in [`0008-local-cli-generation.md`](0008-local-cli-generation.md). Pricing, remote provider adapters, retention, model selection, and credential-store integration still require evidence-based decisions.
