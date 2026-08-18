# Human evaluation protocol

The machine-readable blind rubric is `tests/fixtures/evaluation/human-rubric.json`. Randomize output order, hide system identity, and use two independent reviewers. Reviewers score accuracy, evidence, flow, difficulty, and professional/non-formulaic style from 1–5 using anchored definitions. Record disagreements before reconciliation; do not replace human review with a phrase blacklist. The five-paper corpus is metadata-only and contains no copyrighted PDFs or article text.

M0 supplies only the Tauri/Rust desktop foundation and does not generate or import paper content. Therefore `test:eval` validates fixture and rubric contracts, not model quality. Human scoring becomes an execution gate only after a later milestone introduces generated outputs under a separately approved provider and privacy boundary.
