# Paprv M0 threat model

## Trust boundary and assets

Assets include future local papers and notes, provider credential references, and usage metadata. The React webview is untrusted relative to the Rust backend. Production loads only the local `tauri://localhost` asset origin; development allows exactly `http://127.0.0.1:1420`. The app exposes the payload-free system-info command plus a fail-closed runtime-smoke signal that can only create a preselected marker when the parent process supplies an absolute path.

| Threat | Impact | M0 control | Evidence |
| --- | --- | --- | --- |
| Webview compromise reaches native APIs | File or credential theft | main-window capability has no permissions; no shell/http/fs/dialog/updater plugins | Rust config test and capability JSON |
| Hostile remote navigation/content | Renderer replacement | manually created main webview rejects every top-level production navigation except `tauri://localhost`, permits only exact Vite origin in development, and denies every new-window request; strict self-only CSP remains enforced | URL mutation tests, config test, Tauri runtime smoke |
| Malformed or unexpected command data | Privileged behavior | payload-free `system_get_info`; runtime-smoke marker must equal backend-derived system info and writes only to an absolute environment-selected create-new path; closed serialized response and strict Zod validation | Rust and renderer unit tests |
| Empty, missing, or IPC-disconnected packaged renderer | False-green desktop build | React commits a renderer-owned marker only after validated `system_get_info`, then signals the Rust smoke seam; packaged debug smoke requires the exact marker within a bounded timeout | `pnpm test:runtime` after debug bundle build |
| API key persistence | Credential disclosure | closed provider enum, canonical UUID-v4 reference type, matching SQLite constraints; raw key rejected | Rust storage tests |
| Secret-bearing log text | Credential disclosure | fixed event/error/provider enums and bounded numeric context; no arbitrary message or error-string parameter | Rust logger test |
| Migration corruption or drift | Data loss or unsafe assumptions | transactional up/down; canonical ledger/table DDL; unknown/gap/drift fail closed | Rust storage tests |

## M0 exclusions and residual risk

PDF parsing/import, URL acquisition, Markdown rendering, provider calls, AI generation, OS credential-store integration, additional windows, and network plugins are intentionally absent. They require new commands, permissions, threat analysis, and tests. Local debug packaging does not establish code signing, notarization, sandbox entitlements, release distribution safety, or remote CI success. CSP allows the two Tauri IPC endpoints in `connect-src`; no general network origin is allowed.
