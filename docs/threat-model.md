# Paprv M0 threat model

## Assets and trust boundaries

Assets are local papers, notes, generated material, provider credentials, and usage metadata. Untrusted inputs will later include PDFs, URLs, arXiv metadata, Markdown, and provider output. The renderer is untrusted relative to the privileged main process; preload is a narrow validation boundary.

## Threats and M0 controls

| Threat | Impact | M0 control | Verification |
|---|---|---|---|
| Renderer compromise reaches Node | File or credential theft | `nodeIntegration=false`, context isolation, sandbox | `test:security` |
| Navigation to hostile content | Renderer code replacement | same-origin initial navigation and main-frame redirect only; deny all new windows | `test:security` |
| Malformed IPC | Privileged action with attacker-controlled shape | strict Zod request/response parsing and channel allowlist | unit tests |
| API key leakage | Credential disclosure | allowlisted scalar log context plus provider-secret message redaction; persist only `keychain:paprv:<UUID>` references | `test:security` |
| Database migration failure | Local data loss | transactional ordered up/down migrations; validate the migration list, applied prefix, and required schema | `test:integration` |
| Copyrighted fixture redistribution | Legal risk | metadata and source-link placeholders only | `test:eval` |

## Deferred attack surface

PDF parsing, URL acquisition, Markdown rendering, provider calls, OS credential-store integration, CSP hardening for viewer/editor dependencies, signing, notarization, and malicious-file fuzzing are excluded from M0 and must receive milestone-specific controls before activation.

The only M0 IPC method, `system:get-info`, returns non-sensitive process metadata. Before adding any privileged or credential-bearing IPC, the main process must validate the sender frame URL against the owning window's trusted initial origin and reject missing, subframe, or mismatched senders in addition to validating payload contracts.
