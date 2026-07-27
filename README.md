# OrbitPM Process Studio Lite

OrbitPM Process Studio Lite is a bilingual, browser-based BPMN 2.0 editor. It
runs from one self-contained HTML file, works offline for ordinary authoring,
and stores processes as portable `.bpmn` XML.

Version 0.4.5 is currently a release candidate. It is not the published stable
release until the final commit, tag, release assets, and GitHub Pages deployment
have passed the checklist in [docs/RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md).
The hosted application remains at
[ahmedak320.github.io/bpmn-studio](https://ahmedak320.github.io/bpmn-studio/);
check its visible version before using it as 0.4.5.

## What 0.4.5 Lite provides

- English and Arabic application chrome, BPMN labels, metadata, and exports.
- Script-aware bilingual auditing with separate commands for switching stored
  diagram language and filling missing or invalid translations.
- Directory workspaces through the File System Access API, browser-private OPFS
  workspaces where supported, and an explicit single-file open/download mode.
- Portable workspace ZIP backups and bounded history for directory and OPFS
  workspaces.
- Application-owned document sessions with active-tab-only saving, dirty-exit
  protection, local recovery drafts, reviewed external-change choices, and
  transactional rename, move, and delete operations.
- Versioned public workspace manifests plus editable glossary and accepted
  translation-memory files in directory and OPFS workspaces.
- Layered BPMN validation, a validation center, safe source preview/apply, and
  deterministic PNG, SVG, and PDF export.
- Deterministic, offline `.xlsx` and UTF-8 `.csv` process generation, including
  official templates and a mapping workflow for ordinary spreadsheets.
- A keyboard-oriented process outline alongside the graphical BPMN canvas.
- Optional browser-direct AI through OpenRouter, Anthropic, or Google Gemini.
  Process-content requests require a review and explicit consent.

AI is not required for editing, validation, workspace management, or
spreadsheet generation.

## Start using it

1. Open the hosted application, or after 0.4.5 is published download
   `OrbitPM-Process-Studio-Lite-0.4.5.html`.
2. Choose a storage mode:
   - **Folder workspace** in browsers that expose the File System Access API,
     principally Chrome and Edge.
   - **Browser workspace** when OPFS is available. Export backups regularly
     because browser storage durability depends on browser and device policy.
   - **Single file** for a minimal open, edit, and download workflow.
3. Create or open a `.bpmn` process.
4. Save from the header or with Ctrl/Cmd+S.
5. Use the diagram language command to project an already valid English or
   Arabic value. If a counterpart is incomplete, review it before choosing any
   external translation service.

For an Arabic quick start, see
[docs/QUICKSTART.ar.md](docs/QUICKSTART.ar.md).

## Privacy in one minute

- Ordinary BPMN editing and Excel/CSV generation are local.
- No telemetry is included.
- API keys remain in memory by default. Optional persistence encrypts a key
  with AES-GCM using a passphrase that the application does not store.
- Workspace context is excluded from AI requests by default. A request review
  shows the provider/model, included text or attachment, relevant workspace
  context, sensitivity indicators, and estimated requests before consent.
- Free translation uses Google Translate or MyMemory only after the translation
  review and consent flow. Their terms and data practices apply.
- Browser-private credentials and preferences are not included in workspace
  backups. Public workspace history is included.

Read [docs/PRIVACY.md](docs/PRIVACY.md) and
[docs/AI_AND_COSTS.md](docs/AI_AND_COSTS.md) before enabling an external
provider.

## Important limitations

Recovery drafts are browser-private and are not a substitute for saving or
exporting a backup. They normally use IndexedDB; if durable browser storage is
unavailable, the App warns that its in-memory fallback will not survive a
reload. Cross-tab leases are advisory, with expected-hash writes as the final
conflict guard.

Single-file mode is intentionally minimal; multi-file backup, portable history,
workspace manifests, and workspace glossary/TM editing are for directory and
OPFS workspaces. The final browser/version matrix, manual NVDA and VoiceOver
verification, Arabic screen-reader review, and required uninterrupted 48-hour
soak have not been completed. No final browser-support or WCAG conformance claim
is made for this candidate.

See [docs/SUPPORT_AND_LIMITATIONS.md](docs/SUPPORT_AND_LIMITATIONS.md) for the
full support boundary and [STATUS.md](STATUS.md) for release readiness.

## Development

Use Node.js 22 and npm 11. The complete automated candidate checks are defined
in `.github/workflows/quality.yml`; common local checks are:

```bash
npm ci
npm run format:check
npm run check:actions
npm run check:lock
npm run check:lite-only
npm run check:no-skips
npm run check:csp
npm run typecheck
npm run lint
npm run test:coverage
npm run test:validation
npm run test:archives
npm run test:performance
npm run clean:dist
npm run build
npm run check:size
npm run test:e2e:built
```

The production build must contain exactly `dist/index.html`. Release assembly
renames that byte-identical file to
`OrbitPM-Process-Studio-Lite-0.4.5.html` and adds only the allowlisted templates,
checksums, SBOM, license, and generated third-party notices.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements and
[CHANGELOG.md](CHANGELOG.md) for the 0.4.5 release notes.

## Lite-only product policy and migration

The active repository, CI, Pages site, documentation, and 0.4.5 release are for
the browser application only. Native shells, installers, updaters, servers, and
bridges are not supported 0.4.5 products.

The immutable 0.4.4 full-product source remains available on the
[`archive/full-product-v0.4.4`](https://github.com/ahmedak320/bpmn-studio/tree/archive/full-product-v0.4.4)
branch and the annotated `archive-full-product-v0.4.4` tag. See
[docs/MIGRATION_0.4.5.md](docs/MIGRATION_0.4.5.md) and
[docs/archive/0.4.4.md](docs/archive/0.4.4.md).

## License

OrbitPM Process Studio Lite is released under the [MIT License](LICENSE).
Retained component attribution is summarized in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the exact release asset
contains the lockfile-derived dependency inventory and license texts.
