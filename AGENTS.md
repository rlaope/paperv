# Paprv agent guide

This file defines the working agreement for coding agents in this repository.

## Product

Paprv is an open-source macOS desktop workspace for studying research papers. Library/Study and the Markdown Vault are peer workspaces: Study owns imported paper context and explicitly saved study aids, while the Vault owns independent user-authored documents.

Current product boundaries:

- Tauri 2 desktop application with a Rust backend and React/TypeScript renderer.
- arXiv abstract and PDF links fetch bounded public metadata through the Rust backend; Paprv does not download, display, or parse PDFs.
- SQLite schema v5 stores papers, independent Markdown documents, explicit paper/artifact edges, saved Study artifacts, immutable artifact-source identity snapshots, and the closed `technical_polish` level.
- A paper never owns a Markdown document. Documents and saved artifacts connect only through explicit many-to-many edges.
- Markdown preview uses `react-markdown` and `remark-gfm`; raw HTML is disabled and external links are inert.
- A compatible user-installed and already authenticated Claude Code CLI can generate Study previews from a stored abstract, saved document, or captured selection. `technical_polish` accepts only a saved document or exact selection. Generated output never edits a document and persists only after an explicit artifact-save action.
- Codex is executable-discovery only and fails closed for generation because its supported CLI contract cannot disable all tools.
- PDF viewing, whole-paper analysis, question answering, and paper recommendations are not implemented.

Canonical product and security decisions live under tracked `docs/` and `docs/adr/`. `.omc/` and `.hermes/` are local execution artifacts, not public architecture. Do not describe a planned capability as a working feature.

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

### Vault documents belong to the user

- Markdown documents are independent of papers; do not reintroduce paper-owned or one-note-per-paper storage or UI.
- Track drafts, revisions, saves, conflicts, and stale responses independently per document. Flush the affected document before close, delete, source generation, or native window destruction.
- A stale save response must not overwrite a newer draft or mark it clean. Save failure or conflict blocks the requested destructive transition and preserves recovery UI.
- The document limit is 262,144 UTF-8 bytes. Rust is authoritative; renderer validation mirrors it for feedback.
- A captured selection uses textarea UTF-16 offsets converted to UTF-8 byte offsets and is bound to an exact saved revision. Missing selection never falls back to the whole document.
- A source snapshot preserves only document identity. The artifact row separately holds bounded revision/range provenance; neither stores the source revision text. Do not describe the identity snapshot as a content snapshot.
- Never log document/source text, paper response bodies, generated output, secrets, raw paths, provider envelopes, or arbitrary upstream errors.

### Local generation is fail-closed

- Renderer IPC sends only closed source identity/revision/range inputs; Rust resolves authoritative source text from SQLite and sends it to the provider only on stdin.
- Paprv must not collect credentials, launch login, read subscription secrets, accept executable/argv/cwd/environment injection, or run provider processes from the renderer.
- Every Claude readiness probe and generation uses direct argv, an empty private mode-0700 cwd/TMPDIR, `env_clear` plus the allowlist, strict no-tools/MCP/session/browser/slash-command controls, bounded stdin/stdout/stderr, protocol validation, and one active admission lane. Generation passes an actual empty value after `--tools` and passes `--disallowedTools` with `*`.
- The authentication probe is exactly `claude auth status`. Only its exit status is trusted; stdout and stderr content do not establish authentication.
- No-tools mode constrains Claude's model-visible tools. It does not prove that organization-managed hooks are absent: Claude's managed hooks cannot be disabled outside managed settings. Treat managed deployments as a residual local dependency and do not claim stronger isolation.
- Codex readiness is executable discovery only. Do not spawn Codex while disable-all-tools is unsupported.
- Public readiness and generation share one app-owned fail-fast admission lane, cancellation signal, process-group settlement rules, and shutdown wait. A probe is not a detached subprocess path and must not outlive the application.
- Own every probe and provider process group. Cancellation and shutdown use a one-second TERM grace, unconditional SIGKILL fallback despite intermediate errors, a separate five-second proof budget, leader settlement, and full process-group absence. Never report termination success while the group may still exist.
- Arbitrary `GenerationState` clone drops do not cancel runs. App-owned shutdown begins only after renderer dirty flush permits window destruction, and app-level exit routes must also wait for shutdown.
- Repeated or concurrent artifact save for the same live run returns the same UUID-v4 artifact and one database row. This retry guarantee ends when the in-memory run is replaced or the app restarts.
- `technical_polish` deterministically checks fenced/inline code, supported math delimiters, citation commands/keys, URLs, and DOI spans. Missing code/math spans or missing/novel citation, URL, or DOI spans return `result_preservation_failed`. This is a span-preservation gate, not claim-level or citation-support proof.
- External capability claims use the official [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference), [Claude Code hooks reference](https://code.claude.com/docs/en/hooks), and [Codex CLI reference](https://developers.openai.com/codex/cli/reference), retrieved 2026-08-19.

### Renderer content stays inert by default

- Do not enable raw HTML in Markdown.
- External Markdown links must not navigate the Tauri webview.
- Backlinks must come from stored explicit document↔paper or document↔artifact edges, not generated placeholder data.
- Evidence must come from stored paper metadata. Label learning prompts as prompts, not source evidence.

## Interface conventions

- Authored product UI copy is English. A natural-language Study request is resolved by the provider to a closed English/Korean output value, with Korean as the bounded default when intent is unclear.
- Keep Library/Study and the Markdown Vault as peer workspaces. Study contains metadata, abstract, conversational generation preview, and explicitly saved artifacts; Vault contains independent Markdown documents.
- Keep the Markdown editor central and wide, using a native `<textarea>` whose empty placeholder is exactly `Start writing in Markdown…`. The placeholder is never persisted. Do not add a document Preview mode or visible Title/status/formatting chrome.
- Generation results remain preview-only until explicit save and are never inserted into a document automatically. Artifact save and document linking are separate actions.
- Make the natural-language request the primary Study interaction. Agent and Context may remain compact composer controls; Claude Code is generation-capable and Codex stays disabled, visible, and discovery-only. Do not restore readiness dashboards or Task/Source/Output-language fieldsets.
- Render request, progress, error, result, and validated metadata as a compact conversation. Do not persist the ephemeral request or include source text, raw paths, document/run IDs, byte offsets, prompts, authentication, or provider I/O in summaries, artifacts, or logs.
- A save/flush failure while capturing a selection blocks the transition into Study. Never continue with stale text or silently fall back to a document or abstract.
- A pending generation start stays mounted after cancellation intent. When the exact run ID arrives, cancel that run, allow exact-run cancellation retry, and keep polling until a terminal state is observed.
- Avoid generic dashboard cards, fake analytics, decorative AI copy, and explanatory subtitles that do not help the task.
- Preserve mixed Study/document tabs, independent dirty drafts, compact modal drawers, keyboard access, focus return, last-intent-wins async opens, and dark/light theme geometry.
- Suppress document-level global shortcuts while any modal dialog or compact modal drawer is active.
- Keep muted/accent text contrast at or above 4.5:1 on supported solid surfaces. Reserve a separate 28×28 px close target for every document tab so truncation cannot overlap it.
- Use restrained depth gradients rather than a flat black surface or promotional visual effects.
- Do not claim PDF viewing, whole-paper analysis, Q&A, or recommendations exist until implemented and verified.

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
