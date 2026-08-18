# Paprv M0 threat model

## Trust boundary and assets

Assets include future local papers and notes, provider credential references, and usage metadata. The React webview is untrusted relative to the Rust backend. M0 loads only bundled renderer assets in production and exposes one payload-free command.

| Threat | Impact | M0 control | Evidence |
| --- | --- | --- | --- |
| Webview compromise reaches native APIs | File or credential theft | main-window capability has no permissions; no shell/http/fs/dialog/updater plugins | Rust config test and capability JSON |
| Hostile remote navigation/content | Renderer replacement | production `frontendDist`, no remote window URL, strict self-only CSP, loopback-only development URL | Rust config test and Tauri build |
| Malformed or unexpected command data | Privileged behavior | exactly one payload-free `system_get_info` handler; closed serialized response and strict Zod validation | Rust and renderer unit tests |
| API key persistence | Credential disclosure | closed provider enum, canonical UUID-v4 reference type, matching SQLite constraints; raw key rejected | Rust storage tests |
| Secret-bearing log text | Credential disclosure | fixed event/error/provider enums and bounded numeric context; no arbitrary message or error-string parameter | Rust logger test |
| Migration corruption or drift | Data loss or unsafe assumptions | transactional up/down; canonical ledger/table DDL; unknown/gap/drift fail closed | Rust storage tests |

## M0 exclusions and residual risk

PDF parsing/import, URL acquisition, Markdown rendering, provider calls, AI generation, OS credential-store integration, additional windows, and network plugins are intentionally absent. They require new commands, permissions, threat analysis, and tests. Local debug packaging does not establish code signing, notarization, sandbox entitlements, release distribution safety, or remote CI success. CSP allows the two Tauri IPC endpoints in `connect-src`; no general network origin is allowed.
