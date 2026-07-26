# OrbitPM Process Studio Lite status

Last updated: 2026-07-26

## Release state

- Target version: `0.4.5`
- Active product: browser-based Lite application only
- Candidate branch: `release/0.4.5-lite-only`
- Archived baseline: `v0.4.4` at
  `cd842b6e0b8d7283e2704ae71ec207440b9e54f2`
- Publication state: **not tagged or published**

The source is an active release candidate, not a completed release. The final
release requires evidence from the exact merge/tag commit; earlier local builds
and focused test runs are useful engineering evidence but cannot satisfy that
requirement by themselves.

## Implemented candidate scope

- Lite-only root application and allowlisted single-file release assembly
- Directory, OPFS, and single-file workspace adapters
- Portable workspace backup import/export and directory/OPFS recovery history
- Layered validation, source preview/apply, draft-with-errors confirmation, and
  deterministic PDF export
- Script-aware English/Arabic audit, reviewed translation, cancellation, and
  atomic visible-label projection
- Worker-based official/ordinary Excel and CSV import with validation, preview,
  transaction planning, reports, and deterministic templates
- Responsive Details rail and keyboard-oriented process outline
- Browser-direct OpenRouter, Anthropic, and Gemini requests with session-only
  credentials by default, encrypted persistence option, reviewed context
  disclosure, cancellation, bounded retries, and local usage reporting
- Lite-only policy, release, Pages, compliance, coverage, accessibility, and
  performance workflows

## Current objective evidence

The detailed index is [docs/RELEASE_EVIDENCE.md](docs/RELEASE_EVIDENCE.md).
The latest reported candidate checks include:

- Coverage: 1,788 tests; 81.86% lines/statements, 84.75% branches, and 84.59%
  functions. Critical branch profiles are above 90%.
- Validation: 53 focused tests plus real OMG BPMN XSD and bpmnlint
  accept/reject fixtures.
- Malformed archives and spreadsheets: 85 focused archive tests; spreadsheet
  core and integration checks are green.
- Stable-artifact focused browser checks: spreadsheet Chromium 6/6 and the
  final three-case localization spot check 3/3.
- Performance evidence: 500-node and 1,000-node real worker-to-preview medians
  remained inside the 3 s/10 s budgets and 250 ms parse-heartbeat budget.
- Supply chain: exact lock check, license policy, CycloneDX generation, npm
  full/production audit with zero findings, and current/history secret scans
  have reported green candidate runs.

These are not a substitute for rerunning the complete workflow on the final
documentation commit and later on the release tag.

## Known release blockers and pending evidence

1. The standalone `src/sessions` recovery and coordination modules are not
   imported by the production App. Automatic IndexedDB draft recovery,
   `beforeunload` protection, BroadcastChannel collision handling, transactional
   dirty-tab path operations, and the complete external-edit conflict workflow
   must not be claimed as production behavior.
2. The full format/lint/policy suite, fresh build, exact artifact assembly and
   reproducibility, complete Chromium/Firefox/WebKit matrix, and final automated
   accessibility matrix must be rerun from the final candidate commit.
3. A provider E2E assertion still needs to be aligned with the intentional
   `data:` CSP source used for embedded WASM before the full browser suite can
   be considered green.
4. Manual NVDA/Windows, VoiceOver/macOS, Arabic language/pronunciation, real
   Pages browser smoke, and the 48-hour soak are pending.
5. `main`, `origin/main`, and `v0.4.5^{}` do not yet point to one release commit.
   No 0.4.5 tag, draft release, published release, or 0.4.5 Pages deployment has
   been evidenced.
6. Historical executable assets remain published until the final 0.4.5
   artifact and deployment pass the release plan, as required by the archival
   sequence.

No 0.4.5 release or tag should be published while these items remain open.

## Archive state

The 0.4.4 archive branch and annotated archive tag resolve to the published
baseline. Complete source bundles, checksums, and clean recovery clones have
been verified outside the active repository. See
[docs/archive/0.4.4.md](docs/archive/0.4.4.md).
