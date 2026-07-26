# Privacy and local data

OrbitPM Process Studio Lite has no application backend, account system,
telemetry, advertising, or cloud synchronization. Most work stays in the
browser or the workspace selected by the user. Optional AI and translation
features contact third parties only as described below.

## Where data is stored

| Data                                                                                              | Default location                                           | Included in a workspace backup?     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| Directory workspace files                                                                         | User-selected folder                                       | Yes                                 |
| Browser workspace files                                                                           | Origin Private File System (OPFS) for this browser profile | Yes, when the user exports a backup |
| Single-file document                                                                              | In the open page until explicitly downloaded               | No workspace backup                 |
| Portable history                                                                                  | `.orbitpm/history` inside a directory or OPFS workspace    | Yes                                 |
| Public workspace manifest, glossary, and accepted translation memory                              | `.orbitpm/manifest.json` and `.orbitpm/i18n/`              | Yes                                 |
| Dirty-document recovery drafts                                                                    | Browser IndexedDB; memory-only fallback when unavailable   | No                                  |
| Remembered directory handle                                                                       | Browser IndexedDB                                          | No                                  |
| Interface language, pane sizes, display preferences, provider/model selection, and mapping drafts | Browser local storage                                      | No                                  |
| Session API keys                                                                                  | Page memory                                                | No                                  |
| Opt-in encrypted API keys                                                                         | Ciphertext in browser local storage                        | No                                  |
| AI usage ledger                                                                                   | Browser local storage                                      | No                                  |

Recovery records contain the document XML, workspace/path identity, base hash,
timestamp, and application version. They are written after a two-second dirty
debounce and on blur or `pagehide`, and are removed only after a confirmed save
or explicit discard. If IndexedDB is unavailable, the App reports that its
memory-only fallback will not survive reload.

Clearing site data can remove OPFS workspaces, recovery drafts, encrypted
credentials, the remembered directory handle, mapping drafts, usage totals,
and preferences. It does not delete a user-selected directory workspace.
Export a workspace backup before clearing browser data or changing
profiles/devices.

## Network behavior

The production CSP permits connections only to:

- `https://api.anthropic.com`
- `https://generativelanguage.googleapis.com`
- `https://openrouter.ai`
- `https://translate.googleapis.com`
- `https://api.mymemory.translated.net`

The `connect-src` directive also permits `data:` so the embedded validation
WASM can be fetched from the document itself. A `data:` URL has no remote host
and does not perform DNS or HTTP egress. The release gate separately attempts
disallowed HTTP origins at runtime; final evidence for that test still belongs
to the exact release commit.

When using the GitHub Pages copy, the browser first downloads the application
from GitHub Pages. A downloaded release HTML loads its application code and
assets from that one local file.

### Process-content requests

Before a process-content AI request, the UI shows:

- selected provider and model;
- the description or attachment being sent;
- relevant workspace processes selected for context;
- whether names or sensitive-looking metadata are present;
- controls to exclude workspace context and redact process names;
- an estimated request count; and
- an explicit consent checkbox.

Workspace context is excluded and name redaction is enabled by default.
Retrieval includes only processes with positive lexical relevance; it does not
send arbitrary first entries when confidence is zero. Changing the reviewed
payload or privacy controls invalidates prior consent.

Translation has a separate review that lists the exact source fields proposed
for an external service. Import and diagram-language switching do not make an
automatic translation request.

The optional free translation path sends reviewed text to Google Translate or
MyMemory. It does not send the entire BPMN file, but the selected field text can
still contain confidential or personal information. Those providers' terms,
logging, retention, location, and rate limits apply.

### Requests that do not contain process content

- OpenRouter balance refresh sends the configured OpenRouter credential to its
  credits endpoint.
- “Test connection” performs a small, potentially billable inference only
  after its separate disclosure checkbox is selected.
- Clicking a “Get key” link navigates to the provider's site.

## API-key handling

Keys entered without encrypted persistence are held only in page memory and are
lost on reload. The settings fields do not reveal the stored value.

Optional persistence uses AES-256-GCM. A key-encryption key is derived with
PBKDF2-SHA-256 using 310,000 iterations and a random salt. The passphrase is
never stored, so the key must be unlocked again after a reload. A forgotten
passphrase cannot be recovered by OrbitPM.

Opening Settings migrates supported 0.4.4 plaintext provider keys into memory
and removes their plaintext browser-storage records. Clearing a provider key
removes its in-memory value, encrypted record, legacy record, and associated
configuration. The removed 0.4.4 Custom provider is not available in Lite.

Encrypted persistence protects a key at rest, not while it is unlocked in the
running page. Use a trusted device and browser profile, review extensions, and
prefer restricted provider keys with spending limits.

## Provider privacy controls

OpenRouter requests set `provider.zdr: true` and
`provider.data_collection: "deny"`. OpenRouter should reject a request when no
route can satisfy those constraints. This does not replace reviewing
OpenRouter's policy or the policy of the routed model provider.

Direct Anthropic and Gemini requests use their browser APIs. OrbitPM cannot
impose a general zero-retention policy on those providers. Do not send data
that organizational policy prohibits from leaving the device.

Imported workspace text is treated as quoted, untrusted data in AI prompts.
That reduces prompt-injection risk but does not make external model output
trusted. Generated BPMN is parsed and validated before it is accepted.

## Backups and sharing

A workspace backup contains every public workspace file, empty-folder
metadata, portable history, an import manifest, and SHA-256 checksums. It can
therefore contain deleted or overwritten process content retained in history.
Review the archive before sharing it.

Browser-private recovery drafts, keys, encrypted key records, provider usage,
preferences, remembered handles, and mapping drafts are not part of a workspace
backup.

## Removing local data

1. Use **Settings → Clear key** for every configured provider.
2. Use the AI usage **Reset** action if local usage totals should be removed.
3. Export any needed OPFS workspace backup.
4. Clear the site's browser storage to remove OPFS, recovery drafts, IndexedDB
   handles, local preferences, encrypted key records, and mapping drafts.
5. Delete directory workspace files and `.orbitpm/history` from the selected
   folder separately if they should also be removed.

See [SECURITY.md](../SECURITY.md) for security reporting and
[AI_AND_COSTS.md](AI_AND_COSTS.md) for provider and billing details.
