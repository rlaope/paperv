# Paprv M0 threat model

## Assets and trust boundaries

Assets are local papers, notes, generated material, provider credentials, and usage metadata. Untrusted inputs will later include PDFs, URLs, arXiv metadata, Markdown, and provider output. The renderer is untrusted relative to the privileged main process; preload is a narrow validation boundary.

## Threats and M0 controls

| Threat | Impact | M0 control | Verification |
|---|---|---|---|
| Renderer compromise reaches Node | File or credential theft | `nodeIntegration=false`, context isolation, sandbox | `test:security` |
| Navigation to hostile content | Renderer code replacement | same-origin initial navigation only; deny all new windows | `test:security` |
| Malformed IPC | Privileged action with attacker-controlled shape | strict Zod request/response parsing and channel allowlist | unit tests |
| API key leakage | Credential disclosure | recursive log redaction; persist credential references only | `test:security` |
| Database migration failure | Local data loss | transactional, ordered up/down migrations | `test:integration` |
| Copyrighted fixture redistribution | Legal risk | metadata and source-link placeholders only | `test:eval` |

## Deferred attack surface

PDF parsing, URL acquisition, Markdown rendering, provider calls, OS credential-store integration, CSP hardening for viewer/editor dependencies, signing, notarization, and malicious-file fuzzing are excluded from M0 and must receive milestone-specific controls before activation.
