# ADR 0007: Bounded arXiv metadata import

- Status: Accepted
- Decision: The Rust backend imports metadata only from the fixed HTTPS `https://export.arxiv.org/api/query` endpoint, using a canonical validated arXiv identifier in `id_list`. The client has short connect/overall timeouts, rejects redirects, caps the response at 256 KiB, and accepts exactly one Atom entry matching the requested canonical ID. XML DTDs are rejected; required fields, timestamp parsing, cardinality, and field-length limits are enforced before a transactional SQLite upsert. User notes are stored separately and retained on metadata reimport.
- Consequences: The renderer receives typed paper/note command results and no network or SQLite access. Network failure, malformed/oversized Atom, and invalid source identity map to fixed command errors and fixed logger events without response content or arbitrary error text. This is metadata interoperability, not a claim of endorsement, affiliation, or branding by arXiv.

Thank you to arXiv for use of its open access interoperability.
