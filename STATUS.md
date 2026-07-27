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
The candidate application source is frozen at app commit `75a31e3` on
`release/0.4.5-lite-only`, and every local exact-final gate passed against the
exact artifact `dist/index.html` (SHA-256 `3299cff3…ed51`; raw 6,271,923
bytes; release-gate gzip 1,842,107 bytes; three clean rebuilds
byte-identical): all static/policy and supply-chain gates, 2,940/2,940 tests
in 220 files with zero skips/retries, coverage at 88.54% lines/statements,
84.68% branches, and 89.42% functions with all four branch profiles above
their ≥90% thresholds, 97/97 validation tests plus the official XSD/bpmnlint
fixture gate, 104/104 malformed-input tests, the complete
Chromium/Firefox/WebKit exact-artifact matrix (134/134 each, zero
failures/retries/skips), the artifact-bound automated accessibility matrix
(12/12 cases, 84/84 surfaces, zero axe violations), the development-only
performance budgets, and the exact seven-asset assembly with English/Arabic
offline smoke.

These remain local candidate results. They are not a substitute for retained
CI on the final pushed head or for the human evidence below.

## Known release blockers and pending evidence

1. The local exact-final gates are green at `75a31e3`, but the candidate
   branch is not yet pushed. Retained CI must rerun the complete workflow from
   a fresh checkout on the final pushed head (documentation commits may land
   on top without changing application bytes). The missing-DI read-only
   preview acceptance path passed locally with the same exact-final matrix;
   its retained evidence is part of this rerun.
2. Manual NVDA/Windows, VoiceOver/macOS, Arabic language/pronunciation and
   linguistic review, the exact 16-row current/previous-major
   Chrome/Edge/Firefox/Safari Pages matrix, and the genuine uninterrupted
   48-hour soak are pending. Previous-major compatibility has not been
   evidenced and is not currently claimed.
3. The release PR still requires substantive independent review. The only
   repository collaborator is the owner; an independent authorized reviewer
   must be added and configured for PR approval and all five protected
   human-gated environments before any protected release step can succeed.
4. `main`, `origin/main`, and `v0.4.5^{}` do not yet point to one release commit.
   No 0.4.5 tag, draft release, published release, or 0.4.5 Pages deployment has
   been evidenced; the protected merge, tag, rebuild, Pages, and publication
   lifecycle has not run.
5. Independent approved/off-host archive custody evidence is absent; the
   verified bundles remain in the outer repository's untracked `archives/`
   directory.
6. Historical executable assets remain published until the final 0.4.5
   artifact and deployment pass the release plan, as required by the archival
   sequence.

No 0.4.5 release or tag should be published while these items remain open.

## Archive state

The 0.4.4 archive branch and annotated archive tag resolve to the published
baseline. Complete source bundles, checksums, and clean recovery clones have
been verified outside the active repository. See
[docs/archive/0.4.4.md](docs/archive/0.4.4.md).
