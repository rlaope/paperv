# Study, Vault, links, and local generation contract

## Product model

Paprv has two peer workspaces:

- **Library → Paper Study**: imported paper metadata, the stored arXiv abstract, a natural-request composer, conversational generation progress/results, and explicitly saved AI artifacts.
- **Vault → Markdown documents**: independent user-authored documents. Users may create, open, rename, edit, and delete any number of documents without selecting a paper. The current Vault is editor-first and has no document Preview mode.

A paper does not own a Markdown document. AI output never creates, appends, replaces, or otherwise mutates a document automatically. Explicit edges connect documents to papers and saved artifacts. The current product has no PDF body; no source or result may claim whole-paper, figure, table, appendix, experiment, or reference coverage.

## SQLite v5

Keep v1 `app_settings` and v2 `papers` unchanged. SQLite v3 replaces legacy `notes` with the Study/Vault objects below. SQLite v4 adds `artifact_source_snapshots` so a saved artifact retains the source document's identity after the live document is deleted. SQLite v5 rebuilds `study_artifacts` to add the closed `technical_polish` level and require a document-backed source. The identity snapshot contains no source revision text:

```sql
CREATE TABLE study_workspaces (
  paper_arxiv_id TEXT PRIMARY KEY REFERENCES papers(arxiv_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
);

CREATE TABLE markdown_documents (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 255 AND title = trim(title)),
  markdown TEXT NOT NULL CHECK (length(markdown) <= 262144),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  updated_at TEXT NOT NULL CHECK (length(updated_at) BETWEEN 20 AND 40)
);
CREATE INDEX markdown_documents_order_idx ON markdown_documents(updated_at DESC, id ASC);

CREATE TABLE study_artifacts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128 AND id = trim(id)),
  paper_arxiv_id TEXT NOT NULL REFERENCES study_workspaces(paper_arxiv_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('claude_code', 'codex_cli')),
  provider_version TEXT NOT NULL CHECK (length(provider_version) BETWEEN 1 AND 128),
  level TEXT NOT NULL CHECK (level IN ('translate_structure','explain_simply','technical_deep_dive','technical_polish')),
  output_language TEXT NOT NULL CHECK (output_language IN ('english','korean')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('abstract','document','document_selection')),
  source_document_id TEXT REFERENCES markdown_documents(id) ON DELETE SET NULL,
  source_revision INTEGER CHECK (source_revision IS NULL OR source_revision >= 1),
  selection_start_utf8 INTEGER CHECK (selection_start_utf8 IS NULL OR selection_start_utf8 >= 0),
  selection_end_utf8 INTEGER CHECK (selection_end_utf8 IS NULL OR selection_end_utf8 > 0),
  markdown TEXT NOT NULL CHECK (length(markdown) BETWEEN 1 AND 131072),
  generated_at TEXT NOT NULL CHECK (length(generated_at) BETWEEN 20 AND 40),
  saved_at TEXT NOT NULL CHECK (length(saved_at) BETWEEN 20 AND 40),
  CHECK (
    (source_kind='abstract' AND source_document_id IS NULL AND source_revision IS NULL AND selection_start_utf8 IS NULL AND selection_end_utf8 IS NULL) OR
    (source_kind='document' AND source_revision IS NOT NULL AND selection_start_utf8 IS NULL AND selection_end_utf8 IS NULL) OR
    (source_kind='document_selection' AND source_revision IS NOT NULL AND selection_start_utf8 IS NOT NULL AND selection_end_utf8 IS NOT NULL AND selection_start_utf8 < selection_end_utf8)
  ),
  CHECK (level!='technical_polish' OR source_kind IN ('document','document_selection'))
);
CREATE INDEX study_artifacts_paper_order_idx ON study_artifacts(paper_arxiv_id, saved_at DESC, id ASC);

CREATE TABLE artifact_source_snapshots (
  artifact_id TEXT PRIMARY KEY REFERENCES study_artifacts(id) ON DELETE CASCADE,
  source_document_snapshot_id TEXT NOT NULL CHECK (
    length(source_document_snapshot_id) BETWEEN 1 AND 128
    AND source_document_snapshot_id = trim(source_document_snapshot_id)
  )
);

CREATE TABLE document_paper_links (
  document_id TEXT NOT NULL REFERENCES markdown_documents(id) ON DELETE CASCADE,
  paper_arxiv_id TEXT NOT NULL REFERENCES papers(arxiv_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  PRIMARY KEY (document_id, paper_arxiv_id)
);
CREATE INDEX document_paper_links_paper_idx ON document_paper_links(paper_arxiv_id, document_id);

CREATE TABLE document_artifact_links (
  document_id TEXT NOT NULL REFERENCES markdown_documents(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES study_artifacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL CHECK (length(created_at) BETWEEN 20 AND 40),
  PRIMARY KEY (document_id, artifact_id)
);
CREATE INDEX document_artifact_links_artifact_idx ON document_artifact_links(artifact_id, document_id);

CREATE TABLE legacy_note_origins (
  document_id TEXT PRIMARY KEY REFERENCES markdown_documents(id) ON DELETE CASCADE,
  paper_arxiv_id TEXT NOT NULL UNIQUE REFERENCES papers(arxiv_id) ON DELETE CASCADE
);
CREATE TABLE v3_migration_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  legacy_note_count INTEGER NOT NULL CHECK (legacy_note_count >= 0)
);
```

Authoritative Rust limits are 255 UTF-8 bytes for a document title, 262,144 UTF-8 bytes for document Markdown, and 131,072 UTF-8 bytes for artifact Markdown. IDs are UUID-v4 values generated by Rust except deterministic legacy IDs. Duplicate titles are allowed. Document updates use `WHERE id=? AND revision=?`, increment revision exactly once, and return `document_conflict` when no row changes. Edge creation is always a separate explicit command. Paper import/upsert creates its Study row in the same transaction and cannot mutate documents, artifacts, or links. `artifact_source_snapshots` preserves only the source document ID. The artifact row separately records its revision and exact selection byte offsets, but neither table stores the source revision text.

## Deterministic legacy migration

The complete v2 → v3 step and ledger insert run in one transaction:

1. Validate canonical v2 ledger, `papers`, index, and `notes`.
2. Create every v3 object.
3. Create a Study row for every paper ordered by arXiv ID.
4. For every legacy note ordered by paper ID, create `legacy-note:<paper-id>`, title it `Notes — <paper title>` truncated safely to 255 UTF-8 bytes, copy Markdown/timestamps byte-for-byte with revision 1, and create one paper link and origin row.
5. Store and verify the original note count.
6. Drop `notes`, insert migration 3, and commit.

Any v2→v3 schema, ID, count, byte-limit, ledger, or constraint failure rolls back to untouched v2. The v3→v4 transaction first rejects every document/document-selection artifact that no longer has a recoverable `source_document_id`; it then creates `artifact_source_snapshots`, copies every required source identity, verifies complete one-to-one identity coverage with no snapshot on abstract artifacts, records migration 4, and rolls back atomically on failure. New document/document-selection artifacts write both the nullable live FK and the immutable identity snapshot in one transaction. Deleting the live document may set `source_document_id` to null but never removes `source_document_snapshot_id`. The v4→v5 step rebuilds only `study_artifacts`, copies every row and provenance field, adds the new level/source checks, verifies foreign keys, records migration 5, and restores foreign-key enforcement before returning.

Developer downgrade is allowed only when every field removed by the step is losslessly representable. Any `technical_polish` artifact blocks v5→v4; otherwise the artifact table is rebuilt under the v4 constraint without changing rows or provenance. A populated v4 identity snapshot blocks v4→v3. The v3→v2 step additionally requires the deterministic legacy document ID/title and revision 1, document/origin counts equal to the recorded legacy count, exactly one origin paper edge per document, and no artifacts or extra links. Markdown and timestamps are copied back into v2. A v2→v1 downgrade requires both `papers` and `notes` to be empty, and v1→v0 requires `app_settings` to be empty. Any unsafe rollback returns `rollback_unsafe` without changing schema, ledger, or data. Production never downgrades automatically.

## Typed commands

Paper commands no longer return or save a note:

```text
import_arxiv_paper
list_papers
get_paper

study_get(paperId)
study_list_artifacts(paperId)
study_save_artifact({paperId, runId})
study_delete_artifact(artifactId)

document_list
document_get(documentId)
document_create({title, markdown})
document_update({documentId, expectedRevision, title, markdown})
document_delete({documentId})
document_get_properties(documentId)
document_link_paper / document_unlink_paper
document_link_artifact / document_unlink_artifact

generation_get_readiness
generation_start
generation_get_run
generation_cancel
```

Closed errors distinguish invalid input, missing paper/document/artifact, revision conflict, duplicate/missing link, byte limit, unsafe rollback, storage unavailable, and the existing provider/run failures. Renderer Zod schemas reject extras and mirror UUID, revision, timestamp, byte-limit, and discriminated-union constraints.

## Generation source and artifact contract

```ts
type GenerationInput = {
  paperId: ArxivId
  provider: 'claude_code' | 'codex_cli'
  request: string
  source:
    | { kind: 'abstract' }
    | { kind: 'document'; documentId: string; expectedRevision: number }
    | { kind: 'document_selection'; documentId: string; expectedRevision: number; startUtf8: number; endUtf8: number }
}
```

`request` is trimmed at the trust boundary, must be non-empty and at most 4096 UTF-8 bytes, and rejects control characters except newline, carriage return, and tab. It is ephemeral to the open dialog. The renderer cannot select a skill, output language, tone, model, source text, or arbitrary provider option.

One Claude invocation interprets the natural request and selects exactly one closed skill plus one output language before generating Markdown. The abstract schema permits `translate_structure`, `explain_simply`, or `technical_deep_dive`; the document schema additionally permits `technical_polish`. Both permit only `english` or `korean`. Rust rejects every other shape, rejects `technical_polish` for an abstract, and applies its deterministic preservation gate to accepted polish output. A request may express intent but cannot dispatch a shell, tool, slash command, or arbitrary skill.

Rust resolves all source text from SQLite. The renderer never sends source text. Rust places the request and separately resolved source in one JSON envelope on provider stdin; neither becomes a CLI argument. The request is never logged, persisted, or returned in `generation_start`, `generation_get_run`, a saved artifact, result metadata, or a summary. Using a document as a source creates no edge. Results remain memory-only until the user chooses **Save artifact** in Study. Saving persists only validated Markdown and bounded provenance. The provider-selected skill and output language use the existing SQLite v5 `level` and `output_language` fields; this composer contract requires no v6. Linking the saved artifact to a Vault document is a later explicit action. `study_save_artifact({paperId, runId})` is idempotent while that completed generation run remains in memory: sequential or concurrent retries return the original committed UUID-v4 artifact and never insert a second row. This covers an ambiguous IPC response after commit. An app restart or replacement by a newer run invalidates the old ephemeral `runId`; Paprv rejects it rather than recreating content. Document/document-selection artifacts expose both nullable `sourceDocumentId` (the live FK) and required `sourceDocumentSnapshotId` (immutable identity); abstract artifacts expose null for both. The snapshot is an identity record, not a copy of the source revision. Saving does not persist request/source/selection text, prompt or provider envelopes, stderr, executable paths, cwd, auth state, failures, or conversational UI state, and it creates no document edge.

For `technical_polish`, Rust compares protected spans before completing the run. Fenced and inline code plus supported dollar, `\(...\)`, and `\[...\]` math spans must remain present with at least their source multiplicity. Citation commands/keys, HTTP(S) URLs, and DOI spans must match exactly as a multiset, which rejects missing and novel references. Failure closes as `result_preservation_failed`. This deterministic gate does not parse claims, prove meaning preservation, validate citation support, or establish factual correctness.

### Provider boundary

Paprv does not bundle a CLI/model, collect credentials, start login flows, mutate global provider configuration, source shell files, accept executable/argv/cwd/environment/model IDs from the renderer, or log request/source/result/provider details. The compact Agent select defaults to Claude Code. Codex CLI appears as a disabled discovery-only option and is never spawned. Readiness probes still run internally, but a normal ready state does not render provider rows, installation/sign-in/capability tables, or raw version details. An unavailable state shows only bounded remediation and Retry.

Claude Code runs through direct argv with strict empty MCP, an actual empty value after `--tools`, `--disallowedTools '*'`, disabled slash commands/browser/session persistence, `dontAsk`, JSON schema output, and one turn. Source JSON goes only to stdin. Authentication readiness runs exactly `claude auth status`; the exit status alone maps to authenticated or unauthenticated and both output bodies are ignored. The version and help probes inspect only the bounded fields needed for compatibility.

Public readiness and generation use the same app-owned `GenerationState`. One fail-fast admission lane prevents overlap; every probe and run installs an exact active-operation ID and cancellation flag before spawn. Every spawned process has a fresh mode-0700 empty cwd/TMPDIR, `env_clear`, validated HOME/USER/PATH/locale/certificate/proxy values, bounded pipe drains, and process-group ownership. Cancellation and shutdown give the owned group a one-second TERM grace, then attempt SIGKILL despite intermediate observation or reap errors and allow a separate bounded five-second proof window. Success requires both leader settlement and `kill(-pgid, 0)` proving the complete group absent. If the first proof window expires, Paprv retains the exact child/group and monitors it until those conditions are proven; persistent groups remain owned and keep shutdown blocked, while later proven absence settles only the matching operation. App shutdown closes admission, cancels the exact active probe or run, and waits for settlement. Generation additionally has a 120-second timeout. Executable discovery rejects unsafe directories and group/world-writable executable files.

The flags remove Claude's model-visible tools, but they do not prove that organization-managed hooks are absent. Claude documents that managed hooks cannot be disabled outside managed settings. Paprv treats the installed binary, upstream service, and managed policy as trusted local dependencies. Codex installation is detected by safe executable discovery only. Paprv never launches it because the official CLI reference documents sandbox/approval controls but no all-tools-off contract.

## Desktop information architecture

```ts
type Activity = 'library' | 'vault'
type OpenTab =
  | { key: `study:${string}`; kind: 'study'; paperId: string }
  | { key: `document:${string}`; kind: 'document'; documentId: string }
```

- Activity ribbon: Library, Vault, quick-open/search, theme.
- Library explorer: paper search/list and arXiv fetch. Opening a paper focuses a Study tab.
- Study tab: paper properties, stored abstract, Generate study aid, dense Claude-like composer, conversational assistant progress/error/result/metadata, explicit Save artifact, saved-artifact history.
- Vault explorer: New document, search, flat document list. Folder hierarchy is deferred.
- Document tab: wide native `<textarea>` with a subtle inline `Vault / name.md` breadcrumb whose name segment is the document-title input. There is no visible Title/status label, Edit/Preview switch, formatting toolbar, revision badge, word count, or ordinary save-state chrome.
- Right inspector: Properties and Backlinks derived only from explicit edge tables.
- Mixed Study/document tabs remain open while switching activities.

The generation dialog deliberately uses conversational structure: the submitted natural request is the user message, while progress, closed errors, result Markdown, and validated skill/language/source metadata are assistant content. It is a compact one-request interaction, not an AI dashboard or open-ended agent session. It has no provider-readiness table and no always-visible Task, Source, or Output-language controls. Safe metadata may show the selected skill, language, and source label after success. It must not include the request, source text, raw paths, document/run IDs, selection offsets, authentication state, or provider stdin/stdout/stderr. There is no assistant avatar, auto-created document, or generated evidence link.

## Multi-document drafts

Keep per-document `{draft,title,baseRevision,state,requestSequence,activeSave}` keyed by document ID. Autosave after 600 ms while not composing. Normal clean/dirty/saving/saved state is announced only in a visually hidden polite aria-live region. Visible recovery appears only for save failure or conflict and offers Retry; conflict also offers reload-as-copy. Saves for one document are serialized; different documents may save concurrently. Switching tabs preserves drafts. Closing/deleting a document flushes it first. Generation from a document flushes only that source document and captures its returned integer revision. Capturing a selection before entering Study also flushes that document; failure blocks the Study transition and preserves the document tab instead of falling back to whole-document or abstract input. App/window close uses `flushAllDirtyDocuments()`; after the renderer permits window destruction, or when a native app-level exit is requested, Rust permanently closes generation, cancels the exact owned probe or run, proves its process group absent, and waits for the active slot to settle before exit. Dropping temporary generation-state handles never initiates shutdown.

A failed/conflicting save blocks the requested close/delete/transition, retains the draft, focuses the affected tab, and offers Retry or reload-as-copy. Stale success/failure may update only its request sequence and cannot clear a newer draft. IME composition blocks save, close, delete, and generation snapshots.

After generation start is requested, cancellation intent does not unmount the dialog while the start call is pending. When the exact late `runId` arrives, the renderer cancels that ID, permits guarded retries against the same ID after a cancellation error, and continues exact-run polling until a terminal state is observed. A terminal success that wins the race remains a discardable preview and is never saved automatically.

## Accessibility and responsive states

- `Cmd/Ctrl+1`: Library; `Cmd/Ctrl+2`: Vault; `Cmd/Ctrl+N`: new document; `Cmd/Ctrl+S`: save; `Cmd/Ctrl+K`: quick open; `Cmd/Ctrl+Shift+T`: open generation from an active Study tab. The dialog may then choose an eligible saved document or selection as its source. App-level shortcuts are suppressed while any modal or compact modal drawer is open.
- Document/Study tabs support Left/Right, Home/End, and predictable close focus.
- Explorer uses a labelled list with one roving tab stop.
- Generate uses one labelled request textarea, compact native Agent and Context selects, trapped/restored focus, explicit cancellation, polite status, and assertive failures. There are no task/source/language fieldsets or radios; the model selects English or Korean inside the closed response schema, preferring Korean when intent is unclear.
- Dirty/link/readiness state never relies on color alone. Raw HTML remains disabled and external navigation inert in generated Markdown preview; there is no Vault document Preview mode to secure or describe.
- Muted and accent text keep at least 4.5:1 contrast on supported solid surfaces in both themes. Each document tab reserves a separate 28×28 px close target, and title ellipsis cannot overlap that target.
- At ≥1024 px show ribbon/explorer/center/inspector. At 800–1023 show inspector as a drawer. At ≤799 show explorer and inspector as mutually exclusive modal drawers. Preserve 720×520 minimum without page-level horizontal overflow.

## TDD and verification

Required RED coverage includes atomic v2→v5 migration/data preservation and lossless rollback; independent document CRUD/revisions/byte limits; link cascades and duplicate rejection; explicit artifact persistence and privacy; generation from abstract/document/selection with stale revisions and UTF-8 boundaries; the document-only technical-polish profile and `result_preservation_failed`; exact closed IPC with no source text; shared owned readiness/generation admission, cancellation and shutdown settlement; safe run-summary exclusions; separate Library/Vault activities and mixed tabs; independent dirty drafts; no AI path mutating a document; stored-edge backlinks; keyboard/focus/IME/responsive states; deterministic contrast and tab-close geometry.

Full gate:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:a11y
pnpm test:eval
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
pnpm tauri build --debug
pnpm test:runtime
pnpm test:runtime:concurrent
pnpm test:release-smoke-gate
git diff --check
```

An authenticated Claude probe uses synthetic content and reports only bounded statuses. It is a separate interoperability gate, not a default CI requirement. A readiness result establishes only the bounded installation/version/capability/authentication checks from that operation; it is not a generation result or a persistent provider guarantee.

## Official references

Retrieved 2026-08-19:

- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- [Codex authentication](https://developers.openai.com/codex/auth)
- [OpenAI Codex source](https://github.com/openai/codex)
