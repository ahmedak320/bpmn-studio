# Changelog

All notable changes to OrbitPM Process Studio Lite are documented here.

## [0.4.5] - Unreleased

0.4.5 is a release candidate. This section becomes a released entry only after
the annotated tag, exact release assets, and Pages deployment have passed the
final evidence checklist.

### Added

- File System Access directory workspaces, OPFS browser workspaces, and an
  explicit single-file open/download mode behind one workspace adapter.
- Portable workspace ZIP backup import/export with manifests, SHA-256
  verification, collision review, rollback, and bounded archive preflight.
- Portable `.orbitpm/history` revisions for directory and OPFS workspaces,
  including preview, diff, restore, and restore-as-copy.
- Application-owned document sessions with active-tab-only shortcuts, IndexedDB
  draft recovery, dirty-exit protection, advisory cross-tab leases and change
  notifications, transactional path changes, and reviewed external conflicts.
- Versioned public workspace manifests plus editable
  `.orbitpm/i18n/glossary.json` and accepted
  `.orbitpm/i18n/translation-memory.json` resources.
- Layered validation using secure XML preflight, BPMN moddle diagnostics, OMG
  BPMN 2.0 XSD validation, recommended bpmnlint rules, structural/DI checks,
  bilingual checks, and unknown-extension preservation checks.
- Validation Center, XML source preview/apply, reviewed and revalidated
  missing-DI auto-layout, an explicit semantic draft-save path, and
  deterministic direct PDF export.
- Script-aware English/Arabic auditing, reviewed translation plans, visible
  label projection, cancellation, and one-command undo for language changes.
- Deterministic `.xlsx` and UTF-8 `.csv` process generation with official
  blank/example workbooks, ordinary-sheet mapping, row-level findings, graph
  preview, mapping presets, reports, and transaction planning.
- Persistent Details rail, responsive panes, localized editor controls, and a
  keyboard-oriented process outline.
- Browser-direct OpenRouter, Anthropic, and Gemini integration with explicit
  provider/model choice, request disclosure, optional relevant workspace
  context, name redaction, cancellation, bounded retry, and usage reporting.
- Session-only API credentials by default and opt-in AES-GCM encrypted
  persistence using a user passphrase.
- Lite-only quality, Pages, and draft-release workflows with coverage,
  malformed-input, accessibility, performance, supply-chain, CSP, size, and
  exact-asset checks.

### Changed

- Lite is the sole active product. Electron/Desktop, installers, updaters,
  bridge/server variants, and their release jobs are retained only in immutable
  0.4.4 archives.
- Diagram-language switching now projects only valid stored counterparts.
  Missing, duplicated, mixed, or wrong-script values enter review instead of
  producing a false success.
- Generated/imported output must satisfy blocking validation policy before
  creation; semantic errors in an edited document require an explicit
  “Save draft with errors” confirmation.
- OpenRouter requests include zero-data-retention and data-collection-denial
  routing requirements.
- Direct custom provider endpoints were removed from Lite. OpenAI, Azure,
  DeepSeek, Moonshot, and GLM models are available only through a compatible
  browser-callable route such as OpenRouter.

### Security

- Added exact CSP egress validation, current/history secret scanning,
  dependency audit, lockfile-derived license inventory, and CycloneDX 1.6 SBOM
  generation.
- ZIP, DOCX, XLSX, CSV, and workspace-backup readers reject unsafe paths,
  encryption, unsupported compression, malformed metadata, and configured
  size/count/ratio limits before decompression.
- Spreadsheet parsing and archive/DOCX extraction run in cancelable workers.
- Legacy 0.4.4 plaintext provider keys are moved to memory and removed from
  browser storage when Settings performs migration.

### Compatibility and migration

- Existing BPMN 2.0 files remain portable XML.
- The OrbitPM namespace remains
  `http://orbitpm.ae/schema/bpmn/1.0`.
- v0.4.4 unsuffixed organizational attributes remain readable. Edits retain
  the unsuffixed active projection and add paired `*En`/`*Ar` values where
  applicable.
- Unknown vendor extension content is checked for loss or rerouting before a
  normalized source replacement is accepted.

See [docs/MIGRATION_0.4.5.md](docs/MIGRATION_0.4.5.md) for the complete
compatibility contract.

### Known candidate limitations

- Recovery drafts are browser-private and depend on IndexedDB for durability;
  the warned in-memory fallback does not survive reload.
- Single-file mode is a minimal open/edit/download workflow without portable
  history, multi-file backup, manifest, or public workspace glossary/TM files.
- The required rendered before/after preview for missing-DI auto-layout is not
  complete.
- Final browser/version, automated accessibility, manual assistive technology,
  uninterrupted 48-hour soak, tag, release, and Pages evidence remain pending.

See [docs/SUPPORT_AND_LIMITATIONS.md](docs/SUPPORT_AND_LIMITATIONS.md) and
[docs/RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md).

## [0.4.4] - 2026-07-26 archival baseline

0.4.4 is retained as an unsupported historical record. Its full-product source,
release assets, and recovery evidence are described in
[docs/archive/0.4.4.md](docs/archive/0.4.4.md).
