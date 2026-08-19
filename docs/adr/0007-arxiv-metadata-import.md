# ADR 0007: Bounded arXiv metadata import

- Status: Accepted; revised by ADR 0009
- Decision: The Rust backend imports metadata only from the fixed HTTPS `https://export.arxiv.org/api/query` endpoint, using a canonical validated arXiv identifier in `id_list`. The client has short connect/overall timeouts, rejects redirects, caps the response at 256 KiB, and accepts exactly one Atom entry matching the requested canonical ID. XML DTDs are rejected; required fields, timestamp parsing, cardinality, and field-length limits are enforced before a transactional SQLite upsert. Independent Markdown documents, saved Study artifacts, and explicit edges are retained unchanged on metadata reimport.
- Consequences: The renderer receives typed paper and Study command results and has no network or SQLite access. Network failure, malformed/oversized Atom, and invalid source identity map to fixed command errors and fixed logger events without response content or arbitrary error text. This is metadata interoperability, not a claim of endorsement, affiliation, or branding by arXiv. The bounded live interoperability probe is intentionally outside the default test suite and can be run explicitly with `pnpm test:arxiv-live`.

Thank you to arXiv for use of its open access interoperability.
