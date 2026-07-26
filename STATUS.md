# OrbitPM Process Studio Lite status

Last updated: 2026-07-27

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
- Application-owned document sessions, active-tab-only shortcuts, IndexedDB
  recovery comparisons, `beforeunload` protection, advisory cross-tab leases,
  reviewed external-conflict choices, and transactional dirty-tab path changes
- Versioned `.orbitpm/manifest.json`, editable workspace glossary and accepted
  translation memory, and reviewed localization at workspace import/open/restore
  boundaries
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
The evidence index retains dated, commit-scoped candidate results. More recent
focused gates report session-safety branch coverage at 91.47% (194 tests),
translation-validation branch coverage at 90.92% (150 tests), and
import-transaction branch coverage at 90.05%. Bounded archive extraction and a
runtime CSP negative-egress scenario also have focused candidate coverage.
Earlier overall coverage, standards, browser, performance, accessibility, and
supply-chain snapshots remain historical engineering evidence only.

These are not a substitute for rerunning the complete workflow on the final
documentation commit and later on the release tag.

## Known release blockers and pending evidence

1. The full format/lint/policy suite, fresh build, exact artifact assembly and
   reproducibility, complete Chromium/Firefox/WebKit matrix, and final automated
   accessibility matrix must be rerun from the final candidate commit.
2. Missing-DI ingestion still needs the required rendered before/after
   auto-layout preview; a reviewed textual repair decision and revalidation are
   not sufficient final evidence for that visual acceptance gate.
3. Exact current browser versions and operating systems must be recorded for
   the final Pages/file smoke. Previous-major compatibility has not been
   evidenced and is not currently claimed.
4. Manual NVDA/Windows, VoiceOver/macOS, Arabic language/pronunciation, real
   Pages browser smoke, and the 48-hour soak are pending.
5. `main`, `origin/main`, and `v0.4.5^{}` do not yet point to one release commit.
   No 0.4.5 tag, draft release, published release, or 0.4.5 Pages deployment has
   been evidenced.
6. The release PR still requires substantive review and protected-branch
   evidence. Historical executable assets remain published until the final 0.4.5
   artifact and deployment pass the release plan, as required by the archival
   sequence.

No 0.4.5 release or tag should be published while these items remain open.

## Archive state

The 0.4.4 archive branch and annotated archive tag resolve to the published
baseline. Complete source bundles, checksums, and clean recovery clones have
been verified outside the active repository. See
[docs/archive/0.4.4.md](docs/archive/0.4.4.md).
