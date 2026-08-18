# Paprv agent guide

This file defines the working agreement for coding agents in this repository.

## Product

Paprv is a macOS desktop workspace for studying research papers. The central artifact is a local Markdown note supported by paper metadata and evidence context.

Current product boundaries:

- Tauri 2 desktop application with a Rust backend and React/TypeScript renderer.
- arXiv abstract and PDF links fetch public metadata through the Rust backend.
- Papers and notes are stored in local SQLite.
- Markdown preview uses `react-markdown` and `remark-gfm`; raw HTML is disabled.
- PDF upload/viewing, model-generated explanations, question answering, and paper recommendations are not implemented.

Do not describe a planned capability as a working feature.

## Working principles

### Think before changing code

- Inspect the relevant files, tests, git state, and project conventions first.
- State assumptions that affect behavior, security, persistence, or scope.
- If the request has materially different interpretations, ask instead of choosing silently.
- Prefer the simpler viable approach and explain any real tradeoff.
- Stop when required context cannot be recovered from the repository or tools.

Trivial, low-risk edits do not need a ceremonial plan.

### Keep the solution small

- Implement only the requested behavior.
- Do not add speculative configuration, extension points, or abstractions.
- Avoid one-use helpers unless they make a security or correctness boundary clearer.
- Match existing patterns before introducing a new dependency or architecture.
- If a solution grows much larger than the problem, reconsider it.

### Make surgical edits

- Every changed line should trace to the request, a reproduced defect, or required verification.
- Do not reformat, rename, or refactor unrelated code.
- Preserve work already present in the shared tree. Never use reset or checkout to erase another lane's changes.
- Remove imports, variables, tests, and comments made obsolete by your own change.
- Report unrelated problems instead of fixing them without permission.

### Work toward observable success

Turn the request into checks before implementation:

1. Identify the behavior and failure mode.
2. Add or update a test that proves the old behavior is wrong when practical.
3. Make the smallest implementation change.
4. Run the focused check.
5. Run the broader checks required by the touched surface.

A changed file, passing compilation, or plausible explanation is not completion evidence by itself.

## Architecture and security boundaries

### Rust owns privileged work

- Renderer code must not perform arbitrary network, filesystem, SQL, shell, or credential operations.
- Expose native behavior through small typed Tauri commands with closed error contracts.
- Keep blocking network work off the Tauri command/UI thread. Existing SQLite commands are synchronous and expected to stay small and bounded; move any newly introduced long-running disk work off the command thread.
- Do not widen capabilities, CSP, navigation, or new-window policy unless the task explicitly requires it and adds threat analysis and tests.

### arXiv interoperability is bounded

- Production metadata requests use only `https://export.arxiv.org/api/query`.
- Accept only canonical supported arXiv IDs and exact supported arXiv URLs.
- Do not add caller-controlled endpoints or arbitrary URL fetching.
- Keep redirects disabled, connect timeout at 3 seconds, total timeout at 10 seconds, and response size capped at 256 KiB.
- Preserve XML DTD/entity rejection, one-entry matching, field bounds, and closed renderer errors.
- Show the required arXiv acknowledgment and do not imply affiliation, review, or approval by arXiv.

### Notes belong to the user

- Reimporting paper metadata must not overwrite a note.
- Dirty notes must be flushed before closing or switching papers.
- The note limit is 262,144 UTF-8 bytes. Rust is the authoritative boundary; renderer validation mirrors it for feedback.
- Never log note text, paper response bodies, secrets, raw paths, or arbitrary upstream errors.

### Renderer content stays inert by default

- Do not enable raw HTML in Markdown.
- External Markdown links must not navigate the Tauri webview.
- Backlinks must come from actual note links, not generated placeholder data.
- Evidence must come from stored paper metadata. Label learning prompts as prompts, not source evidence.

## Interface conventions

- Authored product copy is English.
- Keep the Markdown workspace central and wide.
- Avoid generic dashboard cards, fake analytics, decorative AI copy, and explanatory subtitles that do not help the task.
- Preserve the compact desktop shell, responsive drawers, keyboard access, focus return, and dark/light theme geometry.
- Use restrained depth gradients rather than a flat black surface or promotional visual effects.
- Do not claim PDF upload, PDF reading, or AI features exist until they are implemented and verified.

## Verification

Run focused tests while iterating. Before declaring a code change complete, run the applicable full gate.

Frontend gate:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
pnpm test:eval
pnpm build
```

Rust gate:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
```

Packaged runtime gate for native or integration changes:

```sh
pnpm tauri build --debug
pnpm test:runtime
pnpm test:runtime:concurrent
pnpm test:release-smoke-gate
```

The bounded live arXiv probe performs a real network request and is explicit rather than part of the default suite:

```sh
pnpm test:arxiv-live
```

Also run:

```sh
git diff --check
```

Do not introduce `TODO`, `FIXME`, `#[ignore]`, `test.skip`, `test.only`, stubs, fake success states, or warnings. If an unrelated pre-existing marker appears, report it rather than expanding the task to remove it.

## Git and delivery

- Do not commit, push, create a PR, merge, or publish unless the user explicitly requests it.
- Before a requested commit, verify the repository-local name, email, remote, branch, and staged diff.
- Do not change the global Git identity for this project.
- Keep `.hermes/` and `.omc/` runtime artifacts out of product commits.
- Verify a push by comparing the local SHA with the remote branch SHA.
- A local green test run is not remote CI, signing, notarization, or release evidence.

## Completion report

State:

- what changed,
- which commands actually ran and their results,
- what was not run,
- remaining risks or unsupported behavior,
- commit, remote, or CI evidence only when directly observed.

Do not hide a failed check behind a summary.

## Source

The behavioral principles in this guide are adapted for Paprv from the MIT-licensed [Karpathy Guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md). Project-specific architecture, security, interface, and verification rules come from this repository.
