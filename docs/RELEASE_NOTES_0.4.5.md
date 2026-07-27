# OrbitPM Process Studio Lite 0.4.5

OrbitPM Process Studio Lite 0.4.5 makes the self-contained browser application
the only active OrbitPM product. Native Desktop/Electron packages, installers,
updaters, servers, and bridges are not part of this release. The 0.4.4
full-product source remains available only through the documented immutable
archive references.

## Highlights

- Directory, browser-private OPFS, and explicit single-file storage modes.
- Application-owned document sessions with active-tab-only saving, recovery
  drafts, dirty-exit protection, transactional path changes, advisory cross-tab
  coordination, and reviewed external-change choices.
- Portable workspace backups, bounded history, a versioned public workspace
  manifest, and editable glossary/accepted translation-memory resources.
- Layered BPMN validation, safe source apply, script-aware English/Arabic review,
  and deterministic SVG, PNG, and PDF export.
- Offline `.xlsx` and UTF-8 `.csv` process generation with official templates,
  ordinary-sheet mapping, preview, transactional creation, and import reports.
- Responsive English/Arabic UI, a persistent Details rail, and a
  keyboard-oriented process outline.
- Optional browser-direct OpenRouter, Anthropic, and Gemini requests with
  explicit payload review and consent. AI is not required for ordinary editing,
  validation, workspace management, or spreadsheet generation.

## Privacy and safety boundaries

Ordinary authoring and spreadsheet generation stay local. OrbitPM includes no
telemetry or application backend. API keys are memory-only by default; optional
persistence encrypts them with a passphrase that is not stored.

Recovery drafts are browser-private and are not included in workspace backups.
Cross-tab leases are advisory; expected-hash writes are the final conflict
guard. Single-file mode does not provide portable workspace history, a
multi-file backup, or public workspace glossary/TM files.

External AI and free-translation providers receive process text only after the
app shows the reviewed payload and the user consents. Provider terms, retention,
billing, and availability still apply.

## Assets and verification

The release contains exactly the seven files listed in
[RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md). Verify every downloaded file against
`SHA256SUMS.txt`, then confirm that the application displays version `0.4.5`.
The HTML is the only runnable application asset.

Release, browser, accessibility, performance, security, and soak claims are
valid only when backed by the exact tagged-commit records in
[RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md). Automated accessibility results do
not substitute for the recorded NVDA, VoiceOver, or Arabic pronunciation
checks.

See [MIGRATION_0.4.5.md](MIGRATION_0.4.5.md),
[SUPPORT_AND_LIMITATIONS.md](SUPPORT_AND_LIMITATIONS.md), and
[PRIVACY.md](PRIVACY.md) before adopting the release.
