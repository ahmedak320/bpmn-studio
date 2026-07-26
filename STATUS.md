# OrbitPM Process Studio Lite status

## Active release

- Target version: `0.4.5`
- Active product: browser-based Lite application only
- Release branch: `release/0.4.5-lite-only`
- Baseline: published `v0.4.4` commit
  `cd842b6e0b8d7283e2704ae71ec207440b9e54f2`

The 0.4.5 release remains in development until every gate in the release plan
has objective evidence. Source changes, a build, or a tag alone do not make the
release complete.

## Archive state

The 0.4.4 full-product branch/tag, complete source bundles, release assets, and
recovery clones have been verified. Historical executable assets remain
published until the exact 0.4.5 release artifact and Pages deployment pass all
gates. See [docs/archive/0.4.4.md](docs/archive/0.4.4.md).

## Release blockers

The current checklist is maintained in the implementation and verification
workstreams. Publication requires, at minimum:

- Reliable document sessions, recovery, conflicts, history, and storage adapters
- Layered BPMN validation and transactional import/export
- Script-aware bilingual auditing across every ingestion path
- Deterministic offline Excel/CSV generation
- Responsive, keyboard-accessible English/Arabic UI
- Explicit AI privacy review, secure credentials, cancellation, and usage reporting
- Passing unit, integration, three-browser, accessibility, security, performance,
  coverage, clean-checkout, exact-artifact, Pages, and soak gates

No 0.4.5 release or tag is published while any release blocker remains.
