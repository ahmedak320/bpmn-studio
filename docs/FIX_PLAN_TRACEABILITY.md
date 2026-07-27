# Fix-plan traceability — OrbitPM Process Studio Lite 0.4.5

This document maps every numbered requirement in `../fix_plan.md`, plus its
unnumbered completion criteria and mandatory scenario rows, to implementation,
commits, and the strongest evidence that is actually present. It is a
traceability inventory, not a release certificate.

## Reading the status

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `AR` | Archive evidence is verified and the stated archive ref is remote.       |
| `I`  | Implementation is present in the local release candidate.                |
| `P`  | Partial: a stated part or evidence layer is still missing.               |
| `E`  | External action is pending: review, CI, tag, release, Pages, or custody. |
| `H`  | Human evidence is pending.                                               |
| `F`  | Exact-final-commit rerun is pending.                                     |

Automated evidence levels are deliberately distinguished:

| Level | Meaning                                                                                  |
| ----- | ---------------------------------------------------------------------------------------- |
| `U`   | Vitest unit/domain test.                                                                 |
| `I`   | Vitest component or application integration test, normally JSDOM; it is not browser E2E. |
| `B`   | Playwright browser E2E against built `dist/index.html`.                                  |
| `S`   | Static/script/workflow verifier.                                                         |
| `R`   | Retained remote CI, release, or deployment evidence.                                     |
| `M`   | Human/manual evidence.                                                                   |

“Candidate” means the test or implementation exists locally but has not passed
as part of the clean, immutable release commit. A local browser observation is
recorded only as a development checkpoint; without a retained report bound to
the final SHA and exact artifact, it is not release evidence.

## Implementation and evidence bundles

Short bundle codes keep the per-requirement tables readable while still giving
exact files and commits.

| Bundle  | Implementation files                                                                                                                                                                                                        | Commits                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REP`   | `package.json`, `vite.config.ts`, `.github/workflows/*`, `scripts/verify-*.mjs`, `scripts/browser-performance-gate.ts`, `scripts/assemble-release.mjs`, release/archive documentation, outer-repository `archives/` records | `6f0c2eb`, `9b7fb37`, `70c34bd`, `ae8fa05`, `edb8e05`, `58daf42`, `69f2251`, `39b5e51`, `d25bf34`, `fc06839`, `de3fd75`, `75a31e3`, `fb54abe`            |
| `SES`   | `src/sessions/*`, `src/workspace/adapters/*`, `src/workspace/history/*`, `src/workspace/liveWorkspaceIndex.ts`, `src/workspace/workspaceManifest.ts`, `src/App.tsx`                                                         | `d4cfaeb`, `cf012b9`, `41c9b01`, `b559c33`, `09a2cc2`, `f9c4bb9`, `fe0d75f`, `4807d7f`, `7b881b0`, `44115f6`                                             |
| `BPMN`  | `src/validation/*`, `src/generation/*`, `src/library/*`, `src/editor/*`, `src/workspace/importTransaction.ts`, export/print modules                                                                                         | `ddd10d1`, `7dcf651`, `af78fad`, `d7dd2d6`, `b06c428`, `626600d`, `9a70f15`, `96d340f`, `44115f6`                                                        |
| `LOC`   | `src/localization/*`, translation review/execution, `src/i18n/*`, bidi rendering, reviewed-ingestion seams                                                                                                                  | `e2498ac`, `296f03a`, `b4f2a13`, `315c457`, `7bea794`, `9eb915b`, `8a332f5`, `94cb681`, `44115f6`                                                        |
| `XLS`   | `src/spreadsheet/*`, spreadsheet worker, template/mapping/import UI, transaction integration                                                                                                                                | `27bc812`, `4a38bc7`, `dc4a54d`, `7c4b0da`, `537c7a7`, `d60eafa`, `08f8511`, `e862d9b`…`e257577`, `44115f6`                                              |
| `UI`    | `src/shell/*`, `src/common/*`, `src/editor/ProcessOutlineEditor*`, `src/workspace/FolderTreeLite*`, `src/App.tsx`, CSS and i18n                                                                                             | `b77bd2b`, `b354344`, `864c587`, `a98b0bc`, `20da036`, `f6ffffe`, `fb3929f`, `49521ba`, `20faa67`, `c3b5df4`, `8a4481f`, `b906d4e`, `019c2c5`, `44115f6` |
| `AI`    | `src/ai/*`, `src/assist/*`, settings credential code, CSP/security checks                                                                                                                                                   | `ae5d51d`, `4b78cce`, `4d3000b`, `a4903d4`, `0b17d5a`, `199b143`, `917a730`, `86b5ef9`, `44115f6`                                                        |
| `REL-B` | `tests/e2e/lite-mandatory-reliability.spec.ts`, `tests/e2e/fixtures/reliability-fsa.ts`, `tests/e2e/mandatory-reliability-evidence.json`                                                                                    | `332ab23`, `83d1116`, `2f419a7`                                                                                                                          |
| `TR-B`  | `tests/e2e/lite-mandatory-translation.spec.ts`, `tests/e2e/fixtures/mandatory-translation-fsa.ts`                                                                                                                           | `83d1116`                                                                                                                                                |
| `XLS-B` | `tests/e2e/lite-mandatory-spreadsheet.spec.ts`                                                                                                                                                                              | `83d1116`, `c4253e0`, `f7c18ae`                                                                                                                          |
| `UI-B`  | `tests/e2e/mandatory-ui-accessibility-evidence.json` and its mapped Details, outline, i18n, assistant, validation, and responsive suites                                                                                    | `83d1116`                                                                                                                                                |
| `AI-B`  | `tests/e2e/lite-mandatory-ai-security.spec.ts`                                                                                                                                                                              | `83d1116`                                                                                                                                                |

| Evidence bundle | Exact test/evidence locations                                                                                                                                                                          | Level                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E-SES`         | `src/sessions/*.test.ts`, `src/workspace/adapters/**/*.test.ts`, `src/workspace/history/historyManager.test.ts`, `src/workspace/liveWorkspaceIndex.test.ts`, `src/App.integration.test.tsx`            | `U/I`                                                                                                                                                                                                     |
| `E-BPMN`        | `src/validation/**/*.test.ts`, `src/generation/**/*.test.ts`, `src/library/**/*.test.ts`, `src/workspace/importTransaction.test.ts`, editor/export/print tests                                         | `U/I`                                                                                                                                                                                                     |
| `E-LOC`         | `src/localization/**/*.test.ts`, `src/__tests__/i18n.test.ts`, `labelSync.test.ts`, `arabicIdCollision.test.ts`                                                                                        | `U/I`                                                                                                                                                                                                     |
| `E-XLS`         | `src/spreadsheet/**/*.test.ts`, `src/spreadsheet/**/*integration.test.tsx`, `src/workspace/importTransaction.test.ts`                                                                                  | `U/I`                                                                                                                                                                                                     |
| `E-UI`          | shell/common/editor/workspace component tests, `src/App.integration.test.tsx`                                                                                                                          | `U/I`                                                                                                                                                                                                     |
| `E-AI`          | `src/ai/**/*.test.ts`, `src/assist/**/*.test.tsx`, settings integration tests                                                                                                                          | `U/I`                                                                                                                                                                                                     |
| `E-B-CAND`      | all `tests/e2e/*.spec.ts`, including the five mandatory evidence bundles listed here                                                                                                                   | `B`; the retained run passed the complete three-engine matrix on `f7c18ae`; merged-head re-observation pending                                                                                            |
| `E-REL-B`       | the 13 test titles in `tests/e2e/mandatory-reliability-evidence.json`                                                                                                                                  | committed candidate `B`; retained three-engine reports passed on `f7c18ae` (run 30289755296); merged-head re-observation pending                                                                          |
| `E-TR-B`        | the 6 direct scenarios in `tests/e2e/lite-mandatory-translation.spec.ts`                                                                                                                               | committed candidate `B`; retained three-engine reports passed on `f7c18ae`; merged-head re-observation pending                                                                                            |
| `E-XLS-B`       | the 14 browser cases produced by `tests/e2e/lite-mandatory-spreadsheet.spec.ts`                                                                                                                        | committed candidate `B`; retained three-engine reports passed on `f7c18ae`; merged-head re-observation pending                                                                                            |
| `E-UI-B`        | `tests/e2e/mandatory-ui-accessibility-evidence.json`, mapping the nine mandatory UI/accessibility rows to production-browser tests                                                                     | committed candidate `B`; keyboard-only EN/AR, no-selection EN/AR, breakpoint/touch, and responsive evidence exists; retained three-engine reports passed on `f7c18ae`; merged-head re-observation pending |
| `E-AI-B`        | the 12 direct scenarios in `tests/e2e/lite-mandatory-ai-security.spec.ts`                                                                                                                              | committed candidate `B`; retained three-engine reports passed on `f7c18ae`; merged-head re-observation pending                                                                                            |
| `E-FOCUSED-B`   | `lite-aml-naming.spec.ts`, `lite-company-docs.spec.ts`, `lite-subprocess-tree.spec.ts`, `details-responsive.spec.ts`, `lite-assistant.spec.ts`, `lite-smoke.spec.ts`, and `lite-panes-details.spec.ts` | local Chromium candidate `B`: respectively 1/1, 5/5, 1/1, 2/2, 2/2, 6/6, and 10/10; the retained three-engine matrix on `f7c18ae` covers every listed spec; merged-head re-observation pending            |
| `E-A11Y`        | `scripts/accessibility-audit.mjs` across its English/Arabic, light/dark, desktop/mobile cases and audited surfaces                                                                                     | local automated candidate: 12/12 cases and 84/84 surfaces, zero axe violations; retained axe evidence passed on `f7c18ae`; not human AT evidence                                                          |
| `E-REP`         | `.github/workflows/*`, `scripts/verify-*.mjs`, `scripts/soak-gate.ts`, release evidence schemas/docs                                                                                                   | `S`; remote execution state is described below                                                                                                                                                            |

## Truth snapshot

Snapshot date: 2026-07-27, refreshed a third time the same day after the
retained remote CI run recorded below.

- Remote `main` and `v0.4.4` resolve to
  `cd842b6e0b8d7283e2704ae71ec207440b9e54f2`.
- Remote `release/0.4.5-lite-only` and the PR #1 head resolve to
  `f7c18aef97d8bc8ff5da8a1d929eb098c4a97513` (`f7c18ae`).
- Remote archive branch resolves to `cd842b6`; the annotated archive tag object
  is `4fd3fa1` and peels to `cd842b6`.
- PR #1 is open and ready for review against `main`; review is still required
  and no approval exists. Its retained quality run
  `https://github.com/ahmedak320/bpmn-studio/actions/runs/30289755296` on head
  `f7c18ae` completed with all 11 required checks passing. The run's
  `github.sha` is `965c1c396086be9d2891adb627de3656ee50dd9b`, which names the
  retained artifacts below.
- Branch protection requires one approval, last-push approval, and the named
  release checks.
- The only repository collaborator is owner `ahmedak320`. Every protected
  human-gated release environment currently names only that owner while
  preventing self-review. An independent authorized human must be added and
  configured before PR approval or protected release, Pages, finalization, and
  cleanup approvals can succeed.
- `v0.4.4` remains the latest release. There is no `v0.4.5` release or tag.
- Pages still deploys from remote `main`, therefore it is the 0.4.4-era site.
- Both Git bundles verify and clone recovery was checked. The bundles are in
  the outer repository's untracked `archives/` directory; independent
  approved/off-host custody evidence is absent.
- The candidate application source is frozen at app commit
  `75a31e3896a48751a9544a7c63605529e117488b` (`75a31e3`) on
  `release/0.4.5-lite-only`; the freeze covers all application, test, and
  workflow source. Documentation commits may land on top; they do not change
  application bytes. Three stabilization commits landed on top of `a844f0e`
  after the previous snapshot:
  - `2f419a7` test(opfs): replaces the private Playwright `coreBundle`
    factory with the public `webkit` export. Root cause of the follow-up fix
    needed: Playwright Test injects its default en-US locale into manually
    launched contexts, and a localized persistent WebKit context replaces the
    MiniBrowser startup page — the only page where `--features` engine gates
    apply — with a protocol-created page lacking them; the test pins
    `locale: undefined`.
  - `de3fd75` ci(quality): passes a CLI-only `--global-timeout=900000` for
    the WebKit matrix leg; the full serial 134-case WebKit suite measured
    ~10.7 minutes against the 600 s default. Per-test timeouts are unchanged.
  - `75a31e3` fix(performance): the browser performance gate worker proxy now
    binds native `postMessage`/`terminate` at construction. Root cause: the
    lazy `instance.terminate()` lookup recursed through the retained
    inline-worker terminate wrapper (`f975f13`) into `RangeError`, so no
    parse worker could start.
    The documentation commit `64b91a1` recorded that snapshot; five further
    test/CI-hardening commits then landed, none changing application bytes:
  - `fb54abe` ci(quality): installs Chromium in the policy job; the release
    evidence verifier regression tests launch a real browser and failed in CI
    without it. Pre-existing gap — the stale remote head's policy job failed
    the same way.
  - `04e5d3f` test(localization): `latestTranslationReviewProps` in
    `src/App.integration.test.tsx` now waits (`waitFor`, 10 s/25 ms) for the
    mocked review props instead of sampling one render — a CI contention
    flake where the dialog had not rendered yet. Assertions and test count
    are unchanged.
  - `387b6bb` test(localization): two review tests now wait for the
    replacement review after reopen; the postponed review's recorded props
    could otherwise be sampled instead of the fresh render.
  - `c4253e0` test(spreadsheet): the spreadsheet panel helpers probe the
    landing's "New blank diagram" button with a bounded `waitFor` instead of
    a one-shot `isVisible` — on a slow CI boot the probe ran before the
    landing rendered, skipped the editor entry, and the suite timed out on a
    missing side-panel toggle; the Arabic label projection assertions also
    got an explicit wait bound.
  - `f7c18ae` test(e2e): three CI-only environment failures fixed without
    product change — Arabic canvas label assertions now compare text with
    whitespace collapsed (SVG label lines wrap with the host's font metrics
    and drop the space from `textContent`; the Arabic projection itself was
    correct in CI, so the assertion was font-dependent); the source-diff
    summary count is matched by shape
    (`/\d+ changed · \d+ added · \d+ removed/`, the convention the sibling
    layout-preview assertion already used) because the diff input formatting
    is environment-dependent, while hunk/scroll/footer assertions stay exact;
    and the highlight-layer test scrolls left-edge shapes into the clear
    viewport area via the canvas API before clicking (fit-viewport can leave
    them under the open palette on hosts with different fonts). No forced
    actions.
- Retained remote CI evidence now exists. The quality workflow run above on
  PR #1 head `f7c18ae` passed all 11 required checks: immutable source
  identity binding (5s), current-tree and history secret scan (10s),
  policy/types/lint/supply chain (2m5s, including the 194 verifier regression
  tests with a real browser), unit/integration/standards/archives/coverage
  (3m6s), performance budgets at release fixture sizes on the
  reference-hardware Node gate (23s), fresh single-file release build (38s),
  Playwright Chromium (6m3s), Firefox (8m15s), and WebKit (10m15s, using the
  CLI `--global-timeout=900000`) each with zero retries, real XLSX
  worker-to-preview budgets (55s), and the axe EN/AR × light/dark ×
  desktop/mobile matrix (1m40s). The retained artifacts are
  `orbitpm-compliance-`, `orbitpm-coverage-`, `orbitpm-performance-`,
  `orbitpm-tested-pages-`, `orbitpm-accessibility-`,
  `orbitpm-browser-performance-`, and
  `orbitpm-playwright-{chromium,firefox,webkit}-965c1c396086be9d2891adb627de3656ee50dd9b`.
  This documentation commit lands on top without changing application bytes,
  so the final merged head's checks must still be re-observed; until then the
  `f7c18ae` run is the current retained evidence for the automated gates.
- The exact-final local `dist/index.html` built from `75a31e3` has SHA-256
  `3299cff36a594cdac536668713e930bfb927285a7fe6e9f271ac0d9ae863ed51`, raw
  6,271,923 bytes (limit 8,388,608) and release-gate gzip 1,842,107 bytes
  (limit 2,621,440), built with Vite 6.4.3 on Node v22.22.0 and npm 11.13.0
  with Playwright 1.61.1 (chromium-1228, firefox-1532, webkit-2311). Three
  clean-dist rebuilds produced the identical SHA-256. This is a local
  artifact; the retained run above passed the fresh single-file release build
  on `f7c18ae` (`orbitpm-tested-pages-965c1c39…`), and rebuild plus
  reproducibility evidence on the final merged head remains required.
- The exact-final local Vitest coverage run passed all 2,940 tests in 220
  test files with zero skips/retries: overall statements and lines 88.54%,
  branches 84.68%, and functions 89.42%; the required branch profiles passed
  at session 90.36%, translation 90.21%, Excel 91.45%, and import 91.13%
  (thresholds ≥80% overall, ≥90% profiles). The release evidence verifier
  regression tests passed 17/17 under node:test. Retained
  unit/integration/standards/archives/coverage evidence now exists for
  `f7c18ae` (`orbitpm-coverage-965c1c39…`); re-observation on the final
  merged head remains.
- The exact-final Playwright matrix ran against the artifact above with zero
  failures, retries, skips, or interruptions: Chromium 134/134 (5.9 min),
  Firefox 134/134 (8.1 min), and WebKit 134/134 (10.7 min, CLI
  `--global-timeout=900000`). The mandatory and focused suites are included
  in those counts. Retained three-engine reports now exist for `f7c18ae`
  (`orbitpm-playwright-{chromium,firefox,webkit}-965c1c39…`);
  merged-head re-observation remains.
- The exact-final automated accessibility audit passed 12/12 cases across
  84/84 surfaces with zero axe violations (Chromium 149.0.7827.55); the gate
  JSON passed with the artifact SHA bound and `releaseCoverageEligible=true`.
  Retained axe evidence now exists for `f7c18ae`
  (`orbitpm-accessibility-965c1c39…`). This does not replace manual NVDA,
  VoiceOver, and Arabic assistive-technology review, which remain pending.
- The dedicated keyboard-only Process Outline create/edit/save cases for
  English/LTR and Arabic/RTL and the dedicated real-browser
  Details/no-selection cases in both languages and directions ran as part of
  the exact-final three-engine local matrix above, with pointer activity
  required to remain zero. Retained remote execution exists for `f7c18ae` in
  the three Playwright jobs above; merged-head re-observation remains.
- The performance gates passed locally with an exact binding to `75a31e3`:
  Node 1,000-file initial index 159.106 ms (budget ≤5,000), 1% incremental
  refresh 190.324 ms (≤1,000), spreadsheet previews 23.876/38.092 ms; browser
  500-node median 1,070.2 ms (≤3,000), 1,000-node median 1,776.0 ms
  (≤10,000), heartbeat within limits, with complete trusted interaction
  receipts. The hardware profile is local-development-unqualified, so these
  are development-only results, not reference-profile release evidence. The
  retained run's reference-hardware Node gate (23s) and real XLSX
  worker-to-preview budgets (55s) passed on `f7c18ae`
  (`orbitpm-performance-965c1c39…`, `orbitpm-browser-performance-965c1c39…`);
  merged-head re-observation remains.
- Exact-final local static and supply-chain gates all pass: lockfile
  verification (460 packages), Prettier, strict TypeScript, ESLint,
  actionlint across 7 workflows, release-workflow static invariants, no-skips
  across 544 files, Lite-only (648 active files, 43 direct dependencies), UI
  copy, CSP (10 directives), bpmn.io attribution, license policy (131
  records, 84 notices), and the size gate. Validation passed 97/97 plus the
  official XSD/bpmnlint accept/reject fixture gate, and malformed
  ZIP/DOCX/XLSX/CSV tests passed 104/104. npm audit (full and production)
  reports zero vulnerabilities, and checksum-verified Gitleaks 8.30.1 reports
  the current tree and all 230 commits clean. The retained policy (2m5s) and
  secret-scan (10s) jobs passed these gates on `f7c18ae`
  (`orbitpm-compliance-965c1c39…`); merged-head re-observation remains.
- The exact seven-asset release allowlist was assembled and verified locally
  (`release:verify` passed); the release HTML SHA-256 equals the artifact
  SHA-256 above, `release:file-smoke` passed the English and Arabic offline
  smoke, the SBOM contains 131 components, and `SHA256SUMS.txt` is
  consistent. Publication of those assets remains pending.
- The local suite manifest still names all 22 browser specs, including
  mandatory reliability, translation, spreadsheet, UI/accessibility, and
  AI/security. The machine-readable mapping covers exactly
  REL11/TR10/XLS10/UI9/AI10, and `npm run check:no-skips` passes across 544
  discovered test/config files.

## Outcome and completion criteria

| ID       | Criterion/root cause                                                                                                     | Mapping and evidence                                               | Status                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUT-01` | Active repository contains only browser Lite and required shared modules.                                                | `REP`; active-tree verifier `S`.                                   | `I/F`; remote `main` is still 0.4.4 pending merge.                                                                                                             |
| `OUT-02` | Electron/Desktop, bridge, and legacy variants absent from active code, dependencies, docs, CI, Pages, and active assets. | `REP`; allowlist/static gates.                                     | `I/E`; Pages and release promotion pending.                                                                                                                    |
| `OUT-03` | Historical tags intact and older releases marked `[ARCHIVED]`.                                                           | Archive refs are intact.                                           | `P/E`; release titles are not yet prefixed.                                                                                                                    |
| `OUT-04` | Historical executable assets removed only after verified archive.                                                        | Archive manifest/bundle evidence.                                  | `E`; intentionally deferred until final 0.4.5 validation.                                                                                                      |
| `OUT-05` | `v0.4.5`, `main`, and `origin/main` are the same tested commit.                                                          | `REP/E-REP`.                                                       | `E`; tag absent and PR unmerged.                                                                                                                               |
| `OUT-06` | Sole active executable asset is the named Lite HTML.                                                                     | Release assembler and allowlist `S`.                               | `I/E`; no published 0.4.5 assets.                                                                                                                              |
| `OUT-07` | Optional template/checksum/SBOM/docs assets only.                                                                        | `REP`, `XLS`, assembler/verifiers.                                 | `I/E`; the exact seven-asset set is defined locally but not published.                                                                                         |
| `OUT-08` | Full English/Arabic/import/export/generation matrix passes.                                                              | `LOC`, `XLS`, `BPMN`, `E-TR-B`, `E-XLS-B`.                         | `P/F`; mandatory translation passed 6/6 and spreadsheet passed 14/14 in local Chromium, but no complete exact-final multi-engine result exists.                |
| `OUT-09` | Details pane can always expand/collapse.                                                                                 | `UI`, `E-UI`, `E-FOCUSED-B`.                                       | `I/F`; focused Details 2/2 and panes/Details 10/10 passed local Chromium, but the exact-final breakpoint/touch sweep is pending.                               |
| `OUT-10` | Arabic switch shows actual Arabic, never false success.                                                                  | `LOC`, `E-LOC`, `lite-i18n-rtl.spec.ts`.                           | `I/F`; exact-final supported-browser matrix pending.                                                                                                           |
| `OUT-11` | XLSX/CSV deterministically generate complete processes without AI.                                                       | `XLS`, `E-XLS`, `E-XLS-B`.                                         | `I/F`; the 14-case mandatory suite passed once locally on Chromium, but exact-final multi-engine evidence is pending.                                          |
| `OUT-12` | No confirmed P0/P1 reliability/accessibility/privacy/data-loss/validation/release issue remains.                         | All bundles and gates.                                             | `P/H/E`; local automated accessibility and the retained `f7c18ae` quality run passed, but human AT, soak, merged-head re-observation, and final triage remain. |
| `OUT-13` | All tests pass without retries, then exact artifact works from file and Pages.                                           | `E-REP`; all five mandatory evidence bundles are local candidates. | `F/E`; selected local suites pass, but the complete exact-final three-engine run, exact artifact/file check, and Pages checks are pending.                     |
| `RC-01`  | Details reopen control was conditionally absent.                                                                         | `UI` persistent rail; `E-UI`.                                      | `I`, candidate.                                                                                                                                                |
| `RC-02`  | Wrong-script nonblank translation was accepted.                                                                          | `LOC` script audit; `E-LOC`.                                       | `I`, candidate.                                                                                                                                                |

## §2 Delivery, archival, and consolidation

### §2.1 Establish and preserve the 0.4.4 baseline

| ID      | Requirement                                                                               | Implementation/commits                         | Evidence and status                                                           |
| ------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `2.1.1` | Record published v0.4.4 SHA, tag object, refs, release metadata, assets, and checksums.   | `REP`                                          | Archive manifest/docs `S`; `AR`.                                              |
| `2.1.2` | Confirm nested release repository/remote; do not publish outer repository.                | `REP`                                          | Recorded remote and nested-repo audit `S`; `AR`.                              |
| `2.1.3` | Save read-only reports for tree, manifests, workflows, releases/assets, and tests/flakes. | `REP`                                          | Archive/release documentation `S`; `AR`, with final evidence updates pending. |
| `2.1.4` | Require clean worktree and preserve unrelated files/artifacts.                            | Process requirement, no implementation bundle. | `F`: current worktree is dirty, so the precondition is presently false.       |

### §2.2 Archive every non-Lite variant

| ID      | Requirement                                                                                  | Implementation/commits                | Evidence and status                                                         |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| `2.2.1` | Push immutable `archive/full-product-v0.4.4` at exact v0.4.4.                                | `REP`                                 | Remote ref peel verified; `AR`.                                             |
| `2.2.2` | Create annotated `archive-full-product-v0.4.4` without rewriting version tags.               | `REP`                                 | Tag object `4fd3fa1` peels to `cd842b6`; `AR`.                              |
| `2.2.3` | Create full nested-repository and outer Docker/bridge Git bundles.                           | Outer `archives/` records; `REP`.     | Both bundles exist and verify; `AR` locally.                                |
| `2.2.4` | Verify bundles and record filename, SHA-256, timestamp, refs, repositories, SHAs.            | `REP` archive manifest.               | `git bundle verify`, SHA-256, and manifest checked; `AR`.                   |
| `2.2.5` | Store in approved archival custody and publish archive branch/tag.                           | `REP`.                                | `P/E`: branch/tag published; objective independent custody evidence absent. |
| `2.2.6` | Clone bundles and check out recorded commits.                                                | `REP` recovery instructions/evidence. | Recovery clones verified; `AR`.                                             |
| `2.2.7` | Do not remove historical desktop assets until recovery and final release validation succeed. | Release sequencing in `REP`.          | Correctly deferred; `E` final validation then cleanup.                      |

### §2.3 Promote Lite to active root

| ID      | Requirement                                                                                      | Implementation/commits                                       | Evidence and status                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `2.3.1` | Create `release/0.4.5-lite-only` from v0.4.4.                                                    | `REP`, `6f0c2eb`.                                            | Remote branch exists; `AR/I`.                                                                                                         |
| `2.3.2` | Move Lite to repository root preserving history.                                                 | `REP`, `6f0c2eb`.                                            | Git history/tree inspection `S`; `I`.                                                                                                 |
| `2.3.3` | Internalize only used shared modules and remove archived-tree imports.                           | `REP`, plus feature bundles.                                 | Typecheck/allowlist/static imports `S`; `I/F`.                                                                                        |
| `2.3.4` | Remove Electron, packaging, bridge/vendor, desktop tests/docs/assets/workflows from active main. | `REP`.                                                       | Active-tree verifier `S`; `I/E` because remote main is not promoted.                                                                  |
| `2.3.5` | Lite-only root manifest at version 0.4.5.                                                        | `package.json`; `REP`.                                       | Manifest/static verifier `S`; `I`.                                                                                                    |
| `2.3.6` | Lite quality, Pages, and release workflows.                                                      | `.github/workflows/*`; `REP`.                                | Workflow verifier `S`; the retained quality run passed all 11 checks on `f7c18ae`, with merged-head re-observation pending, so `I/E`. |
| `2.3.7` | Update product/support docs and archived-source link.                                            | README/status/Arabic quickstart/contribution/notices; `REP`. | Doc inspection `S`; `I`, final URLs pending.                                                                                          |
| `2.3.8` | CI allowlist blocks legacy runtime/release artifacts.                                            | active-tree/release verifiers; `REP`.                        | Script tests `S`; `I/F`.                                                                                                              |
| `2.3.9` | Preserve retained-component attribution.                                                         | `THIRD_PARTY_NOTICES.md`, SBOM/license scripts; `REP`.       | Supply-chain scripts `S`; `I/F`.                                                                                                      |

### §2.4 Implementation coordination and prescribed commits

The feature content exists, but the actual history was split and did not follow
the ten prescribed subjects/order literally. The open PR is not reviewed or
merged.

| ID       | Prescribed logical commit                          | Actual mapping                                                                                  | Evidence/status                      |
| -------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------ |
| `2.4.1`  | Archive legacy variants and promote Lite.          | `REP`, chiefly `6f0c2eb`.                                                                       | Content `I`; chronology/merge `P/E`. |
| `2.4.2`  | Portable workspaces, recovery, history.            | `SES`: `d4cfaeb`, `41c9b01`.                                                                    | `E-SES`; `I`.                        |
| `2.4.3`  | Central sessions, saves, filesystem safety.        | `SES`: `cf012b9`, `b559c33`, later lifecycle commits.                                           | `E-SES`, `E-REL-B`; `I/F`.           |
| `2.4.4`  | BPMN validation/import/repair/PDF.                 | `BPMN`: `ddd10d1`, `af78fad`, later fixes.                                                      | `E-BPMN`; `I/F`.                     |
| `2.4.5`  | Bilingual normalization/translation.               | `LOC`: `e2498ac` and follow-ups.                                                                | `E-LOC`; `I/F`.                      |
| `2.4.6`  | Excel/CSV generation.                              | `XLS`: `27bc812`, `4a38bc7`, later worker/transaction commits.                                  | `E-XLS`; `I/F`.                      |
| `2.4.7`  | Responsive panes/outline/accessibility.            | `UI`: `b77bd2b`, `b354344`, follow-ups.                                                         | `E-UI`; `I/H/F`.                     |
| `2.4.8`  | AI privacy/capability/retry/cost.                  | `AI`: `ae5d51d` and follow-ups.                                                                 | `E-AI`; `I/F`.                       |
| `2.4.9`  | Bilingual/accessibility/reliability browser gates. | `93356c5`, `9b7fb37`, `efe9149`, `332ab23`, `83d1116`; exact mapping REL11/TR10/XLS10/UI9/AI10. | `B/S` candidate; `I/F`.              |
| `2.4.10` | Release documentation.                             | `ae8fa05`, `b7d6f4c`, `d25bf34`, later local changes.                                           | Docs/scripts `S`; `I/E`.             |

## §3 Implementation changes

### §3.1 Workspace, recovery, and data-loss prevention

| ID       | Requirement                                                                                                                          | Implementation/commits                       | Evidence and status                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.1.1`  | One application-owned session controller with identity, XML baselines, dirty/base metadata, modeler, validation, and recovery state. | `SES`.                                       | `E-SES` `U/I`; `I/F`.                                                                                                                                                                                                            |
| `3.1.2`  | Application-level Ctrl/Cmd+S saves active session only.                                                                              | `SES`.                                       | `E-SES` plus committed candidate `REL-03` `B`; `I/F`.                                                                                                                                                                            |
| `3.1.3`  | `beforeunload` whenever any session is dirty.                                                                                        | `src/sessions/beforeUnload.ts`; `SES`.       | `U/I`; no dedicated release-browser assertion, `I/F`.                                                                                                                                                                            |
| `3.1.4`  | IndexedDB journal: debounce/blur/pagehide, metadata, comparison, safe deletion.                                                      | `SES`.                                       | `E-SES` and `REL-01` `B`; `I/F`.                                                                                                                                                                                                 |
| `3.1.5`  | Portable history: pre-write/delete exact bytes, 20/process, 100 MiB oldest-first, preview/diff/restore/copy.                         | `src/workspace/history/*`; `SES`.            | `U/I`; `REL-09` `B` covers restore, quota failure, and 21→20. Local candidate tests also bound history diff/preview rows, hunks, and characters. Aggregate 100 MiB is `U` only; `I/F`.                                           |
| `3.1.6`  | Transactional dirty rename/move/delete and atomic state/path updates.                                                                | `SES`, `src/App.tsx`.                        | `E-SES`; `REL-02` `B`; `I/F`.                                                                                                                                                                                                    |
| `3.1.7`  | Hash/metadata external conflicts with compare/reload/overwrite/save-as.                                                              | `SES`.                                       | `E-SES`; `REL-04` `B`; `I/F`.                                                                                                                                                                                                    |
| `3.1.8`  | BroadcastChannel lock/change notification prevents silent cross-tab overwrite.                                                       | `src/sessions/workspaceChannel.ts`; `SES`.   | `U/I`; `REL-08` `B`; `I/F`.                                                                                                                                                                                                      |
| `3.1.9`  | Reset workspace-scoped assistant/interview/retrieval/generation/drafts on switch.                                                    | `SES`, `AI`.                                 | `U/I`; `REL-05` `B` for all three in-flight AI surfaces; `I/F`.                                                                                                                                                                  |
| `3.1.10` | Preserve AI prompts, attachments, mapping, generation settings across sidebar collapse/process open.                                 | `AI`, `XLS`, `UI`.                           | Component/application `I`; broad browser matrix absent, `P/F`.                                                                                                                                                                   |
| `3.1.11` | Discard stale generation truthfully and offer recovery download.                                                                     | `AI`, generation workflow.                   | `U/I`; no dedicated browser assertion in `REL-B`, `I/F`.                                                                                                                                                                         |
| `3.1.12` | Keep stored directory handle until committed replacement.                                                                            | `SES`, adapters.                             | `U/I`; `REL-06` `B`; `I/F`.                                                                                                                                                                                                      |
| `3.1.13` | Isolate/report unreadable files during refresh.                                                                                      | adapters/App; `SES`.                         | `U/I`; `REL-07` `B` proves isolation, not every report presentation; `I/F`.                                                                                                                                                      |
| `3.1.14` | Derive catalog/search/links/unresolved/owners/assistant context from live dirty XML overlay.                                         | live index, links, owners, assistant; `SES`. | `U/I`; `REL-11` `B` proves immediate dirty search, catalog, resolved-link detachment, and unresolved-target projection while storage remains unchanged. Owner/assistant overlays remain lower-level/other-suite evidence; `I/F`. |
| `3.1.15` | Optimistic incremental indexing/virtualization; no full rescan per save.                                                             | live index/catalog/UI; `SES`.                | `U/I`; the production-path performance gate covers bounded initial indexing, exact 1% refresh, and reread counts; current-tree exact-final profiling remains `F`.                                                                |
| `3.1.16` | Duplicate-ID diagnosis with paths/repair; ambiguous IDs excluded as links.                                                           | live index/App/links; `SES`.                 | `U/I`; `REL-10` `B` polls persisted repaired bytes; `I/F`.                                                                                                                                                                       |
| `3.1.17` | Unique IDs in fallback documents.                                                                                                    | generation/new-document code; `SES/BPMN`.    | `U`; `I/F`.                                                                                                                                                                                                                      |

### §3.2 Browser workspace compatibility

| ID      | Requirement                                                                                          | Implementation/commits                              | Evidence and status                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `3.2.1` | Common adapter for FSA directory, OPFS, and optional single-file mode.                               | `src/workspace/adapters/*`; `SES`.                  | `U/I`; `REL-01` uses real OPFS and faithful FSA/single-file browser flows; `I/F`.                          |
| `3.2.2` | OPFS supports folders, multiple processes, search, links, backups, history, import/export, recovery. | OPFS adapter plus common workspace services; `SES`. | Broad `U/I` and selected `B`; only recovery is real-OPFS in `REL-B`, so full OPFS browser matrix is `P/F`. |
| `3.2.3` | Complete OPFS ZIP export with manifest/checksums.                                                    | backup adapter/manifest; `SES`.                     | `U/I`; no dedicated real-OPFS browser export assertion, `I/F`.                                             |
| `3.2.4` | Transactional backup import with collision review/rollback.                                          | backup import + transaction; `SES/BPMN`.            | `U/I`, selected existing `B`; `I/F`.                                                                       |
| `3.2.5` | Display storage mode/persistence in both languages.                                                  | App/i18n; `SES/LOC`.                                | `I` and selected `B`; `I/F`.                                                                               |

### §3.3 BPMN validity, repair, import, and export

| ID       | Requirement                                                                                                   | Implementation/commits                        | Evidence and status                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `3.3.1`  | Secure XML, moddle warnings, worker XSD, bpmnlint, and OrbitPM rules.                                         | `BPMN`.                                       | `E-BPMN` `U/I`, selected `B`; `I/F`.                                                                                                                         |
| `3.3.2`  | Generated XML invariants: global/stable IDs, namespace, references, defaults, collaboration/lane/DI validity. | generation/validation; `BPMN`.                | Extensive `U`, generation E2E subsets; `I/F`.                                                                                                                |
| `3.3.3`  | Validate before and after layout.                                                                             | validation/layout pipeline; `BPMN`.           | `U/I`; `I/F`.                                                                                                                                                |
| `3.3.4`  | Missing-DI preview and explicit accepted normalization.                                                       | `96d340f`, workspace preview; `BPMN`.         | `U/I`; no complete browser fixture matrix, `I/F`.                                                                                                            |
| `3.3.5`  | Localized validation center with severity, locations, canvas focus, repair, export.                           | validation UI/i18n; `BPMN/LOC/UI`.            | `U/I`, selected `B`; `I/F`.                                                                                                                                  |
| `3.3.6`  | Block invalid XML; explicit semantic-error draft; zero blocking generation/import errors.                     | validation/apply/import gates; `BPMN`.        | `U/I`, selected `B`; `I/F`.                                                                                                                                  |
| `3.3.7`  | Safe XML source edit, preview/diff/rollback/single-stack Apply.                                               | source editor/transaction; `BPMN`.            | `U/I`, selected `B`; local candidate diff code has explicit input/line/matrix/operation/preview/hunk ceilings and blocks Apply/layout when truncated; `I/F`. |
| `3.3.8`  | Preserve unknown vendor extensions.                                                                           | validation/preservation/import code; `BPMN`.  | `U/I`; exact multi-boundary browser matrix pending, `I/F`.                                                                                                   |
| `3.3.9`  | Process every process and BPMN plane.                                                                         | import/layout/localization; `BPMN/LOC`.       | `U/I`; selected multi-process tests, `I/F`.                                                                                                                  |
| `3.3.10` | Transactional import: prevalidate, review, confirm, full rollback.                                            | `src/workspace/importTransaction.ts`; `BPMN`. | `U/I`; browser coverage selected, `I/F`.                                                                                                                     |
| `3.3.11` | Support documented encodings and report unsupported/undecodable.                                              | library/import decoders; `BPMN`.              | `U`; no consolidated browser encoding suite, `I/F`.                                                                                                          |
| `3.3.12` | Bounded worker ZIP/DOCX decompression and preflight.                                                          | security/library workers; `BPMN`.             | `U/S`; exact release malformed-input gate pending, `I/F`.                                                                                                    |
| `3.3.13` | ARIS conversion report categories.                                                                            | library ARIS report; `BPMN`.                  | `U/I`, `lite-aml-naming.spec.ts` selected `B`; `I/F`.                                                                                                        |
| `3.3.14` | PNG, deterministic PDF, and print pagination/orientation/Arabic/fallback repair.                              | export/print modules; `BPMN/LOC`.             | `U/I`, selected browser export tests; consolidated visual evidence pending, `I/F`.                                                                           |
| `3.3.15` | Complete backup contains BPMN, metadata, translations, history policy, checksums, manifest.                   | adapters/manifest/backup; `SES/BPMN/LOC`.     | `U/I`; exact archive round-trip browser coverage partial, `I/F`.                                                                                             |

### §3.4 Bilingual normalization and real diagram translation

#### Core language model

| ID       | Requirement                                                                | Implementation/commits                 | Evidence and status                                          |
| -------- | -------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `3.4.C1` | Replace nonblank-target logic with script-aware validation.                | localization classifier/audit; `LOC`.  | `E-LOC` `U/I`, selected `B`; `I/F`.                          |
| `3.4.C2` | Classify English, Arabic, mixed, neutral/code, and unknown.                | localization script classifier; `LOC`. | Parameterized `U`; `I/F`.                                    |
| `3.4.C3` | Arabic target requires meaningful Arabic unless approved neutral.          | audit/glossary; `LOC`.                 | `U/I`, selected `B`; `I/F`.                                  |
| `3.4.C4` | English target rejects Arabic words absent explicit proper-name exception. | audit/review model; `LOC`.             | `U/I`; broad exception UX evidence remains candidate, `I/F`. |
| `3.4.C5` | Identical English counterpart in both fields is invalid.                   | audit rules; `LOC`.                    | `U`, wrong-language fixtures in existing `B`; `I/F`.         |
| `3.4.C6` | Neutral handling is narrow; uppercase text is not automatically neutral.   | script/glossary rules; `LOC`.          | `U`; `I/F`.                                                  |
| `3.4.C7` | Seed editable reviewed glossary including API, SLA, DMT HUB.               | glossary resource/editor; `LOC`.       | `U/I`; `I/F`.                                                |
| `3.4.C8` | Preserve valid EN/AR unless explicit replacement.                          | plan/apply transaction; `LOC`.         | `U/I`, selected `B`; `I/F`.                                  |

#### Apply normalization at every ingestion boundary

| ID        | Boundary                           | Implementation/commits                           | Evidence and status                                                                      |
| --------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `3.4.B1`  | Raw BPMN/XML import.               | reviewed XML ingestion; `LOC/BPMN`.              | `U/I`, selected `B`; `I/F`.                                                              |
| `3.4.B2`  | XML source Apply.                  | source apply/review seam; `LOC/BPMN`, `626600d`. | `U/I`, selected `B`; `I/F`.                                                              |
| `3.4.B3`  | ARIS/APC conversion.               | library conversion review; `LOC/BPMN`.           | `U/I`, AML browser subset; `I/F`.                                                        |
| `3.4.B4`  | AI text generation.                | generation review/repair; `LOC/AI/BPMN`.         | `U/I`, selected `B`; `I/F`.                                                              |
| `3.4.B5`  | PDF generation input.              | attachment ingestion review; `LOC/AI`.           | `U/I`, direct production-surface `E-TR-B` passed local Chromium; exact-final matrix `F`. |
| `3.4.B6`  | PNG/image generation input.        | attachment ingestion review; `LOC/AI`.           | `U/I`, direct production-surface `E-TR-B` passed local Chromium; exact-final matrix `F`. |
| `3.4.B7`  | DOCX generation input.             | DOCX ingestion/review; `LOC/AI/BPMN`.            | `U/I`, direct production-surface `E-TR-B` passed local Chromium; exact-final matrix `F`. |
| `3.4.B8`  | Excel/CSV generation.              | spreadsheet bilingual audit; `LOC/XLS`.          | `U/I`, spreadsheet browser subsets; `I/F`.                                               |
| `3.4.B9`  | Interview regeneration.            | assistant interview review/repair; `LOC/AI`.     | `U/I`; selected browser flow, full bilingual boundary assertion pending, `P/F`.          |
| `3.4.B10` | Workspace backup restore.          | backup import/review; `LOC/SES`.                 | `U/I`; no consolidated bilingual browser restore case, `P/F`.                            |
| `3.4.B11` | Historical legacy diagram opening. | legacy-field detector/review; `LOC/SES`.         | `U/I`; exact historical browser fixture matrix pending, `P/F`.                           |

#### Ingestion pipeline

| ID        | Requirement                                                                  | Implementation/commits                           | Evidence and status                                                    |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `3.4.P1`  | Secure parse and structural validation.                                      | `LOC/BPMN`.                                      | `U/I`; `I/F`.                                                          |
| `3.4.P2`  | Extract all translatable fields from every process/plane.                    | extraction; `LOC`.                               | `U` multi-process/field fixtures; `I/F`.                               |
| `3.4.P3`  | Determine source from metadata plus script.                                  | script/source analysis; `LOC`.                   | `U`; `I/F`.                                                            |
| `3.4.P4`  | Audit missing, wrong-script, duplicate, mixed, invalid.                      | audit; `LOC`.                                    | `U/I`; `I/F`.                                                          |
| `3.4.P5`  | Preserve original and report before mutation.                                | review plan/transaction; `LOC`.                  | `U/I`, selected `B`; `I/F`.                                            |
| `3.4.P6`  | Apply approved glossary/TM locally.                                          | glossary/TM; `LOC`.                              | `U/I`; `I/F`.                                                          |
| `3.4.P7`  | Queue unresolved values for explicit translation.                            | plan/review UI; `LOC`.                           | `U/I`, selected `B`; `I/F`.                                            |
| `3.4.P8`  | Revalidate result.                                                           | audit/execution; `LOC`.                          | `U`; `I/F`.                                                            |
| `3.4.P9`  | Project selected language to visible names/text.                             | label synchronization; `LOC`.                    | `U/I`, RTL browser tests; `I/F`.                                       |
| `3.4.P10` | Inspect visible result; every non-neutral Arabic-view label contains Arabic. | visible projection audit; `LOC`.                 | `U` and actual SVG `B`; supported-browser final matrix pending, `I/F`. |
| `3.4.P11` | Commit metadata and projection in one undo transaction.                      | localization transaction/editor commands; `LOC`. | `U/I`, selected undo `B`; `I/F`.                                       |

#### Translation UX and providers

| ID        | Requirement                                                                       | Implementation/commits                      | Evidence and status                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.4.U1`  | Separate switch-language from translate/fill.                                     | translation UI; `LOC/UI`.                   | `I`, selected `B`; `I/F`.                                                                                                                                            |
| `3.4.U2`  | Incomplete switch opens completion review rather than source fallback.            | audit/review routing; `LOC`.                | `U/I`, selected `B`; `I/F`.                                                                                                                                          |
| `3.4.U3`  | Review shows language/counts/fields/provider/disclosure/request count/actions.    | review components; `LOC/AI`.                | `I`, selected `B`; local consent is bound to an exact canonical disclosure snapshot rather than a short fingerprint alone; `I/F`.                                    |
| `3.4.U4`  | No automatic network request on import.                                           | reviewed execution boundary; `LOC/AI`.      | `U/I`, `E-TR-B` network interception and `E-AI-B` exact-consent collision case; `I/F`.                                                                               |
| `3.4.U5`  | Apply glossary/TM before network translation.                                     | plan/execution; `LOC`.                      | `U`; `I/F`.                                                                                                                                                          |
| `3.4.U6`  | Explicit configured AI or named opt-in Google/MyMemory with disclosure.           | provider selection/disclosure; `LOC/AI`.    | `U/I`, provider browser subsets; `I/F`.                                                                                                                              |
| `3.4.U7`  | Replace progress in place; cancel; never simultaneous progress/failure.           | execution/status UI; `LOC`.                 | `U/I`, `E-TR-B`; cancellation, 429, partial failure, per-field retry, and manual recovery passed in the 6/6 local Chromium suite; exact-final matrix pending.        |
| `3.4.U8`  | No “complete” until post-audit finishes.                                          | execution/audit state; `LOC`.               | `U/I`, selected `B`; `I/F`.                                                                                                                                          |
| `3.4.U9`  | Failed/rate-limited fields retain retry/manual actions.                           | review issue UI; `LOC`.                     | `U/I`, direct `E-TR-B` scenario; `I/F`.                                                                                                                              |
| `3.4.U10` | Cache only accepted pairs in translation memory.                                  | TM persistence; `LOC`.                      | `U/I`; local candidate persistence queues accepted pairs through an atomic compare-and-swap and rejects stale Settings replacement; exact-final gate pending, `I/F`. |
| `3.4.U11` | Curated terms stored in workspace glossary JSON.                                  | glossary persistence; `LOC/SES`.            | `U/I`; `I/F`.                                                                                                                                                        |
| `3.4.U12` | Translate all named process/diagram/org/detail fields.                            | extraction/projection; `LOC`.               | Field-table `U`; end-to-end all-field visual matrix is partial, `P/F`.                                                                                               |
| `3.4.U13` | Never translate IDs, paths, links, provider/model names, codes, emails, URLs.     | exclusion rules; `LOC`.                     | `U`; `I/F`.                                                                                                                                                          |
| `3.4.U14` | Read v0.4.4 unsuffixed fields; emit paired fields plus active projection on edit. | compatibility/migration; `LOC`.             | `U/I`; historical browser fixture matrix pending, `I/F`.                                                                                                             |
| `3.4.U15` | AI output requires valid EN/MSA pairs; wrong script enters repair loop.           | generation validator/repair; `LOC/AI/BPMN`. | `U/I`, selected generation `B`; `I/F`.                                                                                                                               |

#### Translation acceptance cases

| ID        | Acceptance case                                                 | Evidence and status                                                                                                                                   |
| --------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.4.A1`  | English duplicated into `nameAr` is detected and repaired.      | `E-LOC` `U/I`, wrong-language browser fixture; `I/F`.                                                                                                 |
| `3.4.A2`  | English-only XML generates and visibly displays real Arabic.    | `U/I/B` candidate, including SVG text assertion; `I/F`.                                                                                               |
| `3.4.A3`  | Arabic-only XML generates English without changing Arabic.      | `U/I/B` candidate; `I/F`.                                                                                                                             |
| `3.4.A4`  | Mixed Arabic/English is segmented and reviewed.                 | `U/I`, direct `E-TR-B` mixed-field case; `I/F`.                                                                                                       |
| `3.4.A5`  | Approved neutral terms remain unchanged.                        | `U`, selected UI coverage; `I/F`.                                                                                                                     |
| `3.4.A6`  | Branch conditions and annotations translate.                    | extraction/projection `U/I`; selected browser coverage, `I/F`.                                                                                        |
| `3.4.A7`  | Multiple processes and planes translate.                        | multi-root `U/I`; direct two-plane XML coverage in `E-TR-B`; `I/F`.                                                                                   |
| `3.4.A8`  | PDF, PNG, DOCX, AI, Excel, ARIS, backup, source use same audit. | Boundaries `B1`–`B11`; `E-TR-B` exercises each named boundary through production UI and passed 6/6 in local Chromium; exact-final matrix remains `F`. |
| `3.4.A9`  | Undo restores entire prior language state.                      | transaction `U/I`, direct save/reopen/undo `E-TR-B`; `I/F`.                                                                                           |
| `3.4.A10` | Provider failure never yields false success.                    | failure-state `U/I`, direct cancellation/429/partial/manual `E-TR-B`; `I/F`.                                                                          |

### §3.5 Generate complete processes from Excel and CSV

#### Supported formats and parser safety

| ID       | Requirement                                                                   | Implementation/commits                | Evidence and status                                                   |
| -------- | ----------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| `3.5.P1` | Localized Excel/CSV tab beside Description and PDF/Image.                     | spreadsheet panel/i18n; `XLS`.        | `I`, `lite-spreadsheet.spec.ts` `B`; `I/F`.                           |
| `3.5.P2` | Macro-free XLSX and UTF-8 CSV with BOM/quoted multiline.                      | parsers/workers; `XLS`.               | `U/I`, direct quoted-multiline Arabic CSV `E-XLS-B`; `I/F`.           |
| `3.5.P3` | Reject XLS/XLSM/XLSB/encrypted/other with localized guidance.                 | preflight/UI; `XLS`.                  | `U/I`, direct encrypted/macro/malformed rejection `E-XLS-B`; `I/F`.   |
| `3.5.P4` | Pinned browser `read-excel-file` and worker Papa Parse.                       | manifest/worker; `XLS/REP`.           | lock/static inspection `S`, parser `U`; `I/F`.                        |
| `3.5.P5` | Preflight XLSX ZIP central directory before parser.                           | archive preflight/worker; `XLS/BPMN`. | `U/S`; `I/F`.                                                         |
| `3.5.P6` | Never execute formulas/macros/scripts/connections/links; cached value policy. | parser validation; `XLS`.             | `U`, direct formula-cache and inert-link/connection `E-XLS-B`; `I/F`. |
| `3.5.P7` | Enforce all input/sheet/row/column/cell/text/node/transaction limits.         | limits/preflight/validation; `XLS`.   | Boundary `U/S`, direct oversize/decompression-bomb `E-XLS-B`; `I/F`.  |
| `3.5.P8` | Warn above 250 nodes.                                                         | validation/preview UI; `XLS`.         | `U/I`; `I/F`.                                                         |
| `3.5.P9` | Worker parse/validate with cancelable progress.                               | spreadsheet worker/controller; `XLS`. | `U/I`, selected `B`; `I/F`.                                           |

#### Versioned workbook sheets and assets

| ID       | Requirement                                          | Implementation/commits                           | Evidence and status                                             |
| -------- | ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `3.5.S0` | Ship blank and example XLSX in app and release.      | template generator/assets; `XLS/REP`.            | Generator/template `U/S`; release assets `E`.                   |
| `3.5.S1` | `Processes` sheet fields and semantics.              | workbook model/template; `XLS`.                  | Schema/template `U`; `I/F`.                                     |
| `3.5.S2` | `Participants` sheet fields and pool/lane hierarchy. | workbook model/template; `XLS`.                  | `U/I`; `I/F`.                                                   |
| `3.5.S3` | `Steps` sheet full bilingual/org/process metadata.   | workbook model/template; `XLS`.                  | `U/I`, official-template and complex-workbook `E-XLS-B`; `I/F`. |
| `3.5.S4` | `Flows` sheet bilingual conditions/defaults.         | workbook model/template; `XLS`.                  | `U/I`, selected browser flow case; `I/F`.                       |
| `3.5.S5` | `Glossary` sheet fields and semantics.               | workbook model/template/localization; `XLS/LOC`. | `U/I`; `I/F`.                                                   |

#### Template rules

| ID        | Requirement                                                       | Implementation/commits                       | Evidence and status                                          |
| --------- | ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `3.5.R1`  | One Processes row produces one BPMN file.                         | graph conversion/transaction; `XLS`.         | `U/I/B` selected; `I/F`.                                     |
| `3.5.R2`  | Process IDs unique in workbook and destination.                   | validation/transaction; `XLS`.               | `U/I`; collision browser subset, `I/F`.                      |
| `3.5.R3`  | Steps reference existing process.                                 | model validation; `XLS`.                     | `U`; `I/F`.                                                  |
| `3.5.R4`  | Explicit IDs unique; deterministic missing IDs previewed.         | normalization/preview; `XLS`.                | `U/I`; selected browser case, `I/F`.                         |
| `3.5.R5`  | Newline/semicolon list delimiters; comma not default.             | mapping/parser; `XLS`.                       | `U`; `I/F`.                                                  |
| `3.5.R6`  | Explicit Flows outrank inferred order.                            | graph builder; `XLS`.                        | `U`; `I/F`.                                                  |
| `3.5.R7`  | Without Flows use next-step mapping, else numeric order.          | graph inference; `XLS`.                      | `U/I`, selected `B`; `I/F`.                                  |
| `3.5.R8`  | Do not guess branching; require target IDs/conditions.            | validation; `XLS`.                           | `U`; `I/F`.                                                  |
| `3.5.R9`  | Preview/confirm synthetic bilingual Start/End.                    | preview/review; `XLS/LOC`.                   | `U/I`, selected `B`; `I/F`.                                  |
| `3.5.R10` | Resolve called process or keep reviewed explicit unresolved call. | validation/link review; `XLS/SES`.           | `U/I`, direct complex-workbook linked-call `E-XLS-B`; `I/F`. |
| `3.5.R11` | Participant/lane refs valid and acyclic.                          | model validation; `XLS`.                     | `U`; `I/F`.                                                  |
| `3.5.R12` | Defaults/conditions comply with BPMN rules.                       | graph validation/BPMN validator; `XLS/BPMN`. | `U/I`; `I/F`.                                                |

#### Mapping wizard

| ID        | Requirement                                                                                                 | Implementation/commits                 | Evidence and status                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| `3.5.W1`  | Detect official template automatically.                                                                     | template detector; `XLS`.              | `U/I/B` selected; `I/F`.                                                       |
| `3.5.W2`  | Guided sheet/header/group/id/order/type/labels/flows/lane/metadata/delimiter/destination/collision mapping. | mapping wizard; `XLS`.                 | `U/I`, ordinary-sheet browser subset; not every page/field combination, `P/F`. |
| `3.5.W3`  | Normalize English/Arabic header aliases.                                                                    | header aliases; `XLS/LOC`.             | `U`; `I/F`.                                                                    |
| `3.5.W4`  | Confidence display and required low-confidence confirmation.                                                | mapping inference/UI; `XLS`.           | `U/I`; `I/F`.                                                                  |
| `3.5.W5`  | Row issues show sheet/cell/raw/normalized/severity/guidance.                                                | validation issue UI; `XLS`.            | `U/I`; `I/F`.                                                                  |
| `3.5.W6`  | Unknown types require explicit supported mapping.                                                           | type mapper/UI; `XLS`.                 | `U/I`; `I/F`.                                                                  |
| `3.5.W7`  | Ignore formatting; import displayed values only.                                                            | parser model; `XLS`.                   | `U`; `I/F`.                                                                    |
| `3.5.W8`  | Read-only graph/process preview before write.                                                               | preview UI; `XLS`.                     | `I/B` selected; `I/F`.                                                         |
| `3.5.W9`  | Shared bilingual audit and completion before generation.                                                    | `XLS/LOC`.                             | `U/I`, selected `B`; `I/F`.                                                    |
| `3.5.W10` | Structural/XSD/lint/link/DI validation after conversion.                                                    | `XLS/BPMN`.                            | `U/I`; `I/F`.                                                                  |
| `3.5.W11` | One transaction; blocking error writes nothing.                                                             | import transaction; `XLS/BPMN`.        | `U/I`, direct collision/no-write and second-write rollback `E-XLS-B`; `I/F`.   |
| `3.5.W12` | Folder placement; single-file direct-open or multi-result ZIP.                                              | destination transaction/UI; `XLS/SES`. | `U/I`, selected `B`; `I/F`.                                                    |
| `3.5.W13` | Download report with mapping/IDs/inference/warnings/status/paths/checksums.                                 | report generator; `XLS`.               | `U/I`, direct provenance/report download assertions in `E-XLS-B`; `I/F`.       |
| `3.5.W14` | Preserve mapping draft across close/navigation.                                                             | wizard state/session; `XLS`.           | `U/I`; dedicated browser navigation case absent, `P/F`.                        |

#### Excel architecture

| ID       | Requirement                                                                             | Implementation/commits           | Evidence and status                                                |
| -------- | --------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `3.5.A1` | Graph-shaped `ProcessWorkbookModel`, not recursive AI IR.                               | spreadsheet model; `XLS`.        | Type/domain `U`; `I`.                                              |
| `3.5.A2` | Validate process/participant/node/flow references before XML.                           | model validation; `XLS`.         | `U`; `I/F`.                                                        |
| `3.5.A3` | Convert through bpmn-moddle and shared layout/validation.                               | conversion pipeline; `XLS/BPMN`. | `U/I`; `I/F`.                                                      |
| `3.5.A4` | Reuse metadata, audit, links, transactions, history.                                    | shared seams; `XLS/LOC/SES`.     | Cross-module `U/I`; browser consolidated assertion partial, `I/F`. |
| `3.5.A5` | Versioned exportable mapping preset keyed by header signature without data/credentials. | preset model/UI; `XLS`.          | `U/I`, direct matching/mismatched-header reuse `E-XLS-B`; `I/F`.   |

### §3.6 Details pane, responsive UI, English/Arabic UX, accessibility

#### Details pane

| ID        | Requirement                                                                    | Implementation/commits            | Evidence and status                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.6.D1`  | Persistent logical-inline-end rail: right LTR, left RTL.                       | DetailsRail/shell; `UI`.          | `E-UI`, `details-responsive.spec.ts`/`lite-panes-details.spec.ts` `B`; `I/F`.                                                                                               |
| `3.6.D2`  | Rail visible expanded or collapsed.                                            | `UI`.                             | `I/B` candidate; `I/F`.                                                                                                                                                     |
| `3.6.D3`  | One localized mirrored keyboard button with ARIA state/control.                | `UI/LOC`.                         | `U/I/B`; `I/F`.                                                                                                                                                             |
| `3.6.D4`  | Minimum 32×44 hit target.                                                      | shell CSS; `UI`.                  | Component/browser geometry plus the responsive touch-pointer path are candidate-tested; exact-final evidence `I/F`.                                                         |
| `3.6.D5`  | Persist state/width; first-use closed.                                         | preferences/DetailsResizer; `UI`. | `U/I/B`; `I/F`.                                                                                                                                                             |
| `3.6.D6`  | Preserve per-tab selection; process guidance with no selection.                | App/details state; `UI`.          | `U/I/B`; dedicated no-selection production-browser cases exist for English/LTR and Arabic/RTL; exact-final evidence `I/F`.                                                  |
| `3.6.D7`  | Double-click optional, not sole route.                                         | editor/shell; `UI`.               | `I/B` selected; `I/F`.                                                                                                                                                      |
| `3.6.D8`  | Keyboard resizer, larger hit area, RTL drag.                                   | DetailsResizer; `UI`.             | `U/I/B` selected; `I/F`.                                                                                                                                                    |
| `3.6.D9`  | Docked desktop and accessible tablet/phone drawer with reachable entry.        | responsive shell; `UI`.           | `U/I/B`; docked and 320/375/768 responsive drawer behavior plus a touch-pointer path are candidate-tested; exact-final evidence `I/F`.                                      |
| `3.6.D10` | Focus restoration/correct expansion focus.                                     | shared dialog/drawer/rail; `UI`.  | `U/I/B` selected; `I/F`.                                                                                                                                                    |
| `3.6.D11` | Test persistence/reset/elements/calls/no-selection/LTR/RTL/touch/narrow/focus. | `E-UI`, `E-UI-B`, existing E2E.   | Machine-readable candidate mapping now includes persistence, selection/no-selection, LTR/RTL, resize/focus, touch-pointer, and narrow-screen cases; exact-final matrix `F`. |

#### Responsive layout

| ID       | Requirement                                                                | Implementation/commits              | Evidence and status                                                                                                                       |
| -------- | -------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `3.6.R1` | `100dvh` with `100vh` fallback.                                            | shell CSS; `UI`.                    | Static/component `S/I`; `I/F`.                                                                                                            |
| `3.6.R2` | Defined desktop/tablet/phone pane behavior.                                | responsive mode/shell; `UI`.        | `U/I/B` candidate; `I/F`.                                                                                                                 |
| `3.6.R3` | Narrow toolbar keeps Save/zoom and labeled overflow for secondary actions. | compact actions; `UI`, `c3b5df4`.   | `I/B` candidate; `I/F`.                                                                                                                   |
| `3.6.R4` | Search keeps usable row/command presentation.                              | header/search UI; `UI`.             | `I/B` selected; `I/F`.                                                                                                                    |
| `3.6.R5` | No chrome overflow at 320/375/768 and 200%/400%.                           | CSS/shell; `UI`, `E-A11Y`.          | The automated audit covers all 12 width×zoom pairs and checks document overflow on every audited surface; exact-final artifact rerun `F`. |
| `3.6.R6` | Landing/dialog/assistant/import/panes fit mobile chrome/keyboards.         | responsive components; `UI/XLS/AI`. | `U/I/B` selected; real mobile/virtual-keyboard evidence pending, `P/H/F`.                                                                 |

#### English, Arabic, embedded controls

| ID       | Requirement                                                         | Implementation/commits                | Evidence and status                                                            |
| -------- | ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| `3.6.L1` | Dictionary parity and hard-coded-copy test.                         | i18n/hardcoded tests; `LOC/UI`.       | `U/S`; `I/F`.                                                                  |
| `3.6.L2` | Localize all listed embedded controls and workflow UI.              | i18n integration; `LOC/UI`.           | `U/I/B` selected; exhaustive surface audit pending, `P/H/F`.                   |
| `3.6.L3` | Mark unavoidable technical terms `lang="en"` in Arabic UI.          | localized components; `LOC/UI`.       | `U/I`, selected DOM checks; manual pronunciation pending, `I/H/F`.             |
| `3.6.L4` | Locale-format dates, numbers, sizes, costs.                         | formatters/i18n; `LOC/AI/UI`.         | `U/I`; `I/F`.                                                                  |
| `3.6.L5` | LTR geometry with correctly shaped/directed/isolated Arabic labels. | bidi renderer/canvas decor; `LOC/UI`. | `U/I/B` actual SVG text; multi-engine visual/manual evidence pending, `I/H/F`. |
| `3.6.L6` | Logical CSS properties throughout.                                  | shell/app CSS; `UI`.                  | Static/browser spot checks; exhaustive CSS audit pending, `P/F`.               |

#### WCAG 2.2 AA remediation

| ID        | Requirement                                                                                                | Implementation/commits                    | Evidence and status                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.6.A1`  | Equivalent outline authoring for navigation/add/edit/reorder/connect/conditions/delete/bidirectional sync. | ProcessOutlineEditor; `UI`.               | Extensive `U/I/B`; dedicated keyboard-only create/edit/save cases for English/LTR and Arabic/RTL require zero pointer activity; exact-final evidence `I/F`. |
| `3.6.A2`  | Palette commands are real keyboard buttons.                                                                | embedded control adapter; `UI`.           | `U/I/B` selected; `I/F`.                                                                                                                                    |
| `3.6.A3`  | Semantic tabs with roving keys/delete/focus restoration.                                                   | ProcessTabList; `UI`.                     | `U/I/B` selected; `I/F`.                                                                                                                                    |
| `3.6.A4`  | Complete keyboard tree/disclosure with reachable actions.                                                  | FolderTreeLite; `UI`.                     | `U/I/B` selected; exact keyboard-only sweep pending, `I/H/F`.                                                                                               |
| `3.6.A5`  | Shared accessible dialog/drawer primitive with trap/inert/Escape/focus return.                             | AccessibleDialog/shell drawers; `UI`.     | `U/I/B` selected; `I/F`.                                                                                                                                    |
| `3.6.A6`  | Complete keyboard menus/search combobox.                                                                   | common menus/search; `UI`.                | `U/I/B` selected; `I/F`.                                                                                                                                    |
| `3.6.A7`  | Landmarks/skip/live statuses/alerts/assistant log.                                                         | App/shell/assist; `UI/AI`.                | `U/I`, axe/browser candidate; `I/F`.                                                                                                                        |
| `3.6.A8`  | Theme-aware AA foreground/non-text contrast.                                                               | theme tokens/CSS; `UI`.                   | Full light/dark automated axe/static candidate coverage exists; exact-final artifact evidence `I/F`.                                                        |
| `3.6.A9`  | 24×24 minimum; prefer 44×44 touch controls.                                                                | CSS/components; `UI`.                     | Selected geometry `B`; exhaustive control inventory/manual touch pending, `P/H/F`.                                                                          |
| `3.6.A10` | Respect reduced motion.                                                                                    | CSS/motion hooks; `UI`.                   | Static/component tests; `I/F`.                                                                                                                              |
| `3.6.A11` | Named canvas SVG and selection announcements; outline is non-pointer equivalent.                           | editor/outline/accessibility shell; `UI`. | `U/I`, axe/browser selected; NVDA/VoiceOver confirmation pending, `I/H/F`.                                                                                  |

### §3.7 AI, privacy, provider reliability, and security

| ID       | Requirement                                                                                       | Implementation/commits                                           | Evidence and status                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3.7.1`  | API keys default to memory/session-only.                                                          | credential store/settings; `AI`.                                 | `E-AI` `U/I`, direct `E-AI-B`; `I/F`.                                                                                                                                                          |
| `3.7.2`  | Optional AES-GCM persistence with unstored passphrase.                                            | encrypted credential store; `AI`.                                | Crypto/storage `U/I`, direct reload/unlock `E-AI-B`; `I/F`.                                                                                                                                    |
| `3.7.3`  | Detect/report storage failure; never false-save.                                                  | credential migration/settings state; `AI`.                       | `U/I`, direct fault-injected `E-AI-B`; `I/F`.                                                                                                                                                  |
| `3.7.4`  | Clearing credentials clears custom headers and ciphertext.                                        | credential cleanup; `AI`.                                        | `U/I`, direct storage scan `E-AI-B`; `I/F`.                                                                                                                                                    |
| `3.7.5`  | Remove nonfunctional Custom provider.                                                             | provider catalog/settings; `AI`.                                 | `U/I/S`; `I/F`.                                                                                                                                                                                |
| `3.7.6`  | Unified explicit provider/model across generation, assistant, interview, translation.             | provider selection; `AI/LOC`.                                    | `U/I`, provider browser suite; `I/F`.                                                                                                                                                          |
| `3.7.7`  | External request review shows provider/model/payload/context/sensitivity/request count.           | request privacy/review UI; `AI`.                                 | `U/I`, direct payload-bound review `E-AI-B`; `I/F`.                                                                                                                                            |
| `3.7.8`  | Context exclusion and name redaction.                                                             | payload builders/review; `AI`.                                   | `U/I`, direct opt-out/redaction payload assertions `E-AI-B`; `I/F`.                                                                                                                            |
| `3.7.9`  | Relevance retrieval; never send unrelated low-confidence first results.                           | assist retrieval/digest; `AI`.                                   | `U/I`, direct browser payload assertion in `E-AI-B`; `I/F`.                                                                                                                                    |
| `3.7.10` | Treat workspace content as quoted untrusted prompt data.                                          | payload/prompt builders; `AI`.                                   | Prompt-injection `U/I`, direct adversarial payload inspection `E-AI-B`; `I/F`.                                                                                                                 |
| `3.7.11` | Require OpenRouter ZDR/data denial and stop unsupported routes.                                   | OpenRouter provider/privacy policy; `AI`.                        | `U/I`, direct outbound-header assertion `E-AI-B`; `I/F`.                                                                                                                                       |
| `3.7.12` | Validate image/PDF model capability before enabling input.                                        | capability probes/catalog/UI; `AI`.                              | `U/I`, direct fail-closed attachment capability `E-AI-B`; `I/F`.                                                                                                                               |
| `3.7.13` | AbortController for generation, translation, assistant, interview, upload parsing.                | cancellation controllers; `AI/LOC/XLS`.                          | Broad `U/I`; `REL-05`, `E-TR-B`, and two `E-AI-B` cancellation cases cover the named browser paths and the committed mandatory suites passed local Chromium; exact-final evidence remains `F`. |
| `3.7.14` | Retry only transient classes with bounded backoff/attempts; no permanent retry/attachment replay. | retry/provider code; `AI`, `199b143`.                            | Retry/provider `U/I`, direct permanent/transient `E-AI-B`; `I/F`.                                                                                                                              |
| `3.7.15` | `navigator.onLine` advisory; report actual network/CORS/provider failure.                         | provider transport; `AI`.                                        | `U/I`, live-CORS browser suite; `I/F`.                                                                                                                                                         |
| `3.7.16` | Disclose Test Connection may be billable.                                                         | settings/provider UI/i18n; `AI/LOC`.                             | `I`, provider browser assertion; `I/F`.                                                                                                                                                        |
| `3.7.17` | Correct session/all-time/reasoning/provider/estimated/unknown/small-cost reporting and refresh.   | usage/cost/credits modules; `AI`.                                | Extensive `U/I`, direct small-cost/reasoning/unknown-cost `E-AI-B` passed local Chromium; exact-final matrix pending, `I/F`.                                                                   |
| `3.7.18` | Minimal CSP and release verifier rejects unexpected hosts.                                        | CSP in `index.html`/build and CSP runtime suite; `AI/REP`.       | `S/U`, `lite-csp-runtime.spec.ts` plus exact built-policy/runtime-block `E-AI-B`; final three-engine run pending, `I/F`.                                                                       |
| `3.7.19` | Telemetry absent.                                                                                 | no telemetry implementation; CSP/network/static scans; `AI/REP`. | Static scans and startup request capture in `E-AI-B`; `I/F`.                                                                                                                                   |

## §4 Interfaces and durable contracts

### Workspace/document contracts

| ID     | Contract                                                                                                        | Implementation/commits             | Evidence and status                                      |
| ------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| `4.W1` | `WorkspaceAdapter` exposes mode/list/read/atomic write/rename/move/remove/folder/backup behavior.               | `src/workspace/adapters/*`; `SES`. | Typecheck and adapter `U/I`; `I/F`.                      |
| `4.W2` | `DocumentSession` carries workspace/path/current/saved/base/dirty/validation/recovery data.                     | `src/sessions/*`; `SES`.           | Typecheck/session `U/I`; `I/F`.                          |
| `4.W3` | `SaveOutcome` distinguishes success, permission loss, conflict, stale workspace, cancellation, storage failure. | adapter/session types; `SES`.      | Exhaustive domain `U`; selected `REL-B` outcomes; `I/F`. |

### Bilingual contracts

| ID     | Contract                                                                       | Implementation/commits                     | Evidence and status                            |
| ------ | ------------------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------- |
| `4.L1` | Language/script/BilingualValue typed model.                                    | localization types; `LOC`.                 | Typecheck/classifier `U`; `I/F`.               |
| `4.L2` | LocalizationIssue identifies boundary/process/element/field/target/code/value. | localization audit types; `LOC`.           | Typecheck/audit `U/I`; `I/F`.                  |
| `4.L3` | Audit is pure/network-free; execution requires reviewed plan and consent.      | audit/plan/execution separation; `LOC/AI`. | `U/I`, no-network browser interception; `I/F`. |

### Spreadsheet contracts

| ID     | Contract                                                                                                                                 | Implementation/commits          | Evidence and status                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `4.X1` | Versioned `ProcessWorkbookModel` includes processes, participants/lanes, bilingual nodes/metadata, flows/defaults, glossary, provenance. | spreadsheet model/types; `XLS`. | Type/model `U`; `I/F`.                                                                 |
| `4.X2` | Versioned mapping preset includes signatures/sheets/mappings/delimiters/inference/locale and excludes data/credentials.                  | mapping preset; `XLS`.          | Serialization/privacy `U/I`; direct matching/mismatched-header reuse `E-XLS-B`; `I/F`. |

### BPMN extension compatibility

| ID     | Requirement                                                      | Implementation/commits                 | Evidence and status                                              |
| ------ | ---------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `4.B1` | Continue OrbitPM extension namespace.                            | descriptor/serialization; `BPMN/LOC`.  | Compatibility `U`; `I/F`.                                        |
| `4.B2` | Read v0.4.4 names, active language, and unsuffixed org metadata. | extraction/migration; `LOC/BPMN`.      | Legacy fixtures `U/I`; historical browser matrix pending, `I/F`. |
| `4.B3` | Add paired EN/AR org attributes.                                 | metadata writer; `LOC/BPMN`.           | Serialization `U/I`; `I/F`.                                      |
| `4.B4` | Retain unsuffixed active projection.                             | label sync/metadata writer; `LOC`.     | `U/I/B` selected; `I/F`.                                         |
| `4.B5` | Preserve unknown extensions byte-semantically where possible.    | preservation validator/import; `BPMN`. | `U/I`; boundary-wide browser matrix partial, `I/F`.              |
| `4.B6` | Document 0.4.5 contract/migration.                               | migration/support docs; `REP/LOC`.     | Doc inspection `S`; final published docs `E`.                    |

### Public/private workspace files

| ID     | Contract                                                                | Implementation/commits                                  | Evidence and status                                             |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `4.F1` | `.orbitpm/history/` stores portable revisions.                          | history manager; `SES`.                                 | `U/I`, `REL-09` `B`; `I/F`.                                     |
| `4.F2` | `.orbitpm/i18n/glossary.json` stores approved terminology.              | glossary persistence; `LOC/SES`.                        | `U/I`; `I/F`.                                                   |
| `4.F3` | `.orbitpm/i18n/translation-memory.json` stores accepted pairs.          | TM persistence; `LOC/SES`.                              | `U/I`; `I/F`.                                                   |
| `4.F4` | `.orbitpm/manifest.json` stores format/policies/checksums.              | workspace manifest; `SES`.                              | `U/I`; `I/F`.                                                   |
| `4.F5` | Drafts/encrypted keys remain browser-private and excluded from exports. | draft/credential stores and backup allowlist; `SES/AI`. | `U/I/S`; exact backup privacy browser assertion partial, `I/F`. |

## §5 Verification, release, and assumptions

### Automated quality gates

| ID      | Gate                                                               | Implementation/evidence                           | Current truthful state                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `5.Q1`  | Lock verification and reproducible install from fresh checkout.    | workflow/lock checks; `REP/E-REP` `S`.            | Retained CI on `f7c18ae` verifies the lock from a fresh checkout in the policy job (run 30289755296); final merged-head re-observation remains `F/E`.                                                                                                                                                                                                                                  |
| `5.Q2`  | Formatting check without rewrite.                                  | Prettier workflow.                                | Retained CI passed the formatting check on `f7c18ae` (policy job); merged-head re-observation remains `F`.                                                                                                                                                                                                                                                                             |
| `5.Q3`  | TypeScript typecheck.                                              | `tsc --noEmit`; workflow.                         | Retained CI passed the strict typecheck on `f7c18ae` (policy job); merged-head re-observation remains `F`.                                                                                                                                                                                                                                                                             |
| `5.Q4`  | ESLint.                                                            | ESLint workflow.                                  | Retained CI passed ESLint on `f7c18ae` (policy job); merged-head re-observation remains `F`.                                                                                                                                                                                                                                                                                           |
| `5.Q5`  | Unit/integration with ≥80% overall and ≥90% safety-branch targets. | Vitest/coverage scripts; `E-REP`.                 | Local exact-final coverage passed 2,940/2,940 in 220 files with zero skips/retries: statements/lines 88.54%, branches 84.68%, functions 89.42%; branch profiles session 90.36%, translation 90.21%, Excel 91.45%, import 91.13%. The retained unit/integration/standards/archives/coverage job passed on `f7c18ae` (`orbitpm-coverage-965c1c39…`); merged-head evidence remains `E/F`. |
| `5.Q6`  | Fresh production build before browser tests.                       | workflow dependency graph/build verifier.         | An exact-final local build (SHA-256 `3299cff3…ed51`, raw 6,271,923 bytes, release-gate gzip 1,842,107 bytes) preceded every artifact-bound gate; the retained fresh single-file release build passed on `f7c18ae` (38s; `orbitpm-tested-pages-965c1c39…`); merged-head rebuild remains `E/F`.                                                                                          |
| `5.Q7`  | Playwright Chromium, Firefox, WebKit.                              | workflow matrix and `E-B-CAND`.                   | The exact-final local matrix passed Chromium 134/134, Firefox 134/134, and WebKit 134/134 with zero failures/retries/skips/interruptions; the retained three-engine jobs passed on `f7c18ae` with zero retries (6m3s/8m15s/10m15s, WebKit on CLI `--global-timeout=900000`; `orbitpm-playwright-{chromium,firefox,webkit}-965c1c39…`); merged-head jobs remain `E/F`.                  |
| `5.Q8`  | Axe EN/AR, light/dark, desktop/mobile.                             | axe workflow/suite; `E-A11Y`.                     | The exact-final artifact-bound local audit passed 12/12 cases, 84/84 surfaces, and zero axe violations with `releaseCoverageEligible=true`; the retained axe job passed on `f7c18ae` (1m40s; `orbitpm-accessibility-965c1c39…`); merged-head evidence remains `E/F`.                                                                                                                   |
| `5.Q9`  | BPMN XSD/lint fixture suite.                                       | validation fixtures; `E-BPMN` `U/S`.              | Exact-final local run passed 97/97 plus the official XSD/bpmnlint accept/reject fixture gate; the retained unit job passed on `f7c18ae`; merged-head `F`.                                                                                                                                                                                                                              |
| `5.Q10` | Malformed ZIP/DOCX/XLSX/decompression-limit suite.                 | security/spreadsheet fixtures; `BPMN/XLS`.        | Exact-final local run passed 104/104; the retained unit job passed on `f7c18ae`; merged-head `F`.                                                                                                                                                                                                                                                                                      |
| `5.Q11` | Secret scan, audit, licenses, SBOM.                                | supply-chain workflow/scripts; `REP`.             | Both dependency audits report zero vulnerabilities, and checksum-verified Gitleaks 8.30.1 current-tree and full 230-commit history scans are clean; license (131 records, 84 notices) and CycloneDX (131 components) generation pass. The retained policy and secret-scan jobs passed on `f7c18ae` (`orbitpm-compliance-965c1c39…`); merged-head retention remains `E/F`.              |
| `5.Q12` | Active-tree proof excludes Desktop/Electron.                       | allowlist verifier; `REP`.                        | The retained policy job passed the active-tree gate on `f7c18ae`; merged-head `F`.                                                                                                                                                                                                                                                                                                     |
| `5.Q13` | Single HTML ≤8 MiB raw and ≤2.5 MiB gzip.                          | size-budget scripts/workflow.                     | The exact-final local artifact is within budget: raw 6,271,923 ≤ 8,388,608 bytes and release-gate gzip 1,842,107 ≤ 2,621,440 bytes; the retained build enforced the budgets on `f7c18ae`; merged-head `F`.                                                                                                                                                                             |
| `5.Q14` | No skips/quarantine/retries/known flakes.                          | `scripts/check-no-skips.mjs` plus suite manifest. | Exact-final local `npm run check:no-skips` passes across 544 discovered files; coverage passed 2,940/2,940 and the three-engine browser matrix ran with zero skips/retries. The retained run executed all jobs with zero retries on `f7c18ae`; merged-head `F`.                                                                                                                        |

### Mandatory browser scenarios — Reliability

The machine-readable mapping is
`tests/e2e/mandatory-reliability-evidence.json`. All rows below have a
production-browser path in committed bundle `REL-B`. The latest current-artifact
Chromium run passed 13/13 with zero skips/retries, and the retained quality
run passed the complete three-engine matrix on `f7c18ae`. Merged-head
re-observation is still required, so these are not final merged-head
three-engine release evidence.

| ID        | Mandatory scenario                                      | Exact browser evidence                                                                                                                                                                                  | Status                                            |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `5.REL1`  | Reload recovery: directory, OPFS, single-file.          | Three `mandatory recovery:` tests; real Chromium OPFS plus production adapters.                                                                                                                         | Committed candidate `B`; `I/F`.                   |
| `5.REL2`  | Dirty rename/move/delete.                               | `mandatory path transactions…`                                                                                                                                                                          | Committed candidate `B`; `I/F`.                   |
| `5.REL3`  | Active-only Ctrl/Cmd+S.                                 | `mandatory save…`                                                                                                                                                                                       | Committed candidate `B`; `I/F`.                   |
| `5.REL4`  | External conflict and all choices.                      | `mandatory conflicts…`                                                                                                                                                                                  | Committed candidate `B`; `I/F`.                   |
| `5.REL5`  | Workspace switch during assistant/interview/generation. | `mandatory workspace switch aborts…` holds and releases all three fetches.                                                                                                                              | Committed candidate `B`; `I/F`.                   |
| `5.REL6`  | Picker cancellation retains reconnection.               | `mandatory workspace switch and picker cancellation…`                                                                                                                                                   | Committed candidate `B`; `I/F`.                   |
| `5.REL7`  | Permission revocation/unreadable isolation.             | `mandatory isolation…`                                                                                                                                                                                  | Committed candidate `B`; `I/F`.                   |
| `5.REL8`  | Cross-tab collision.                                    | `mandatory coordination…`                                                                                                                                                                               | Committed candidate `B`; `I/F`.                   |
| `5.REL9`  | History restore and quota cleanup.                      | Restore/quota test plus genuine 21-save→20 newest/oldest-pruned UI/storage test; 100 MiB cap remains `U`.                                                                                               | Committed candidate `B` + `U`; `I/F`.             |
| `5.REL10` | Duplicate-ID diagnosis/repair.                          | Final index-integrity test repairs, saves, and condition-polls actual persisted IDs.                                                                                                                    | Committed candidate `B`; `I/F`.                   |
| `5.REL11` | Live dirty search/catalog/link updates.                 | Same final test changes caller name/calledElement in the production editor; search and catalog update, the resolved child detaches, unresolved UI names the target, and durable bytes remain unchanged. | Committed candidate `B`; full row covered, `I/F`. |

### Mandatory browser scenarios — Translation

Bundle `TR-B` contains six production-UI browser tests that collectively map
all ten rows. Its latest local Chromium run passed 6/6, and the retained
three-engine matrix passed on `f7c18ae`. Re-observation of the retained
report on the final merged head remains required.

| ID       | Mandatory scenario                             | Strongest evidence                                                                             | Status/gap                                             |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `5.TR1`  | Wrong-language target fields from XML.         | `E-LOC` plus direct two-plane XML import in `E-TR-B`.                                          | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR2`  | Missing English or Arabic counterparts.        | Direct EN-only and AR-only fields in `E-TR-B`.                                                 | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR3`  | Arabic-first and English-first diagrams.       | Direct dual-process active-language assertions in `E-TR-B`.                                    | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR4`  | Mixed/neutral/conditions/annotations/details.  | One direct mixed-field/neutral/condition/annotation/details test in `E-TR-B`.                  | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR5`  | XML/ARIS/PDF/PNG/DOCX/AI/Excel/source/backup.  | Four `E-TR-B` tests traverse every named production ingestion surface.                         | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR6`  | Provider cancel/429/partial/retry/manual edit. | One direct combined recovery test in `E-TR-B`.                                                 | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR7`  | No network before consent.                     | Route interception and consent assertions in `E-TR-B`; exact disclosure collision in `E-AI-B`. | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR8`  | Actual Arabic SVG after switch.                | Visible SVG assertions in `E-TR-B` and `lite-i18n-rtl.spec.ts`.                                | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR9`  | No false completion/stale progress.            | Direct cancellation/partial/retry status assertions in `E-TR-B`.                               | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.TR10` | Undo and save/reopen round trip.               | One direct production source-Apply, undo, save, close, and reopen test.                        | Local Chromium candidate pass; exact-final matrix `F`. |

### Mandatory browser scenarios — Excel/CSV

Bundle `XLS-B` expands to 14 browser cases (three parameterized template cases
plus eleven named cases). One local Chromium run passed 14/14 with one worker
and retries disabled; the suite is committed, and the retained three-engine
matrix passed on `f7c18ae`, with merged-head re-observation pending.

| ID      | Mandatory scenario                                                     | Strongest evidence                                                         | Status/gap                                  |
| ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `5.X1`  | Official EN/AR/bilingual templates.                                    | Three direct production-worker/template cases in `E-XLS-B`.                | Local Chromium 3/3; exact-final matrix `F`. |
| `5.X2`  | Ordinary single-sheet mapping.                                         | Direct noncanonical workbook mapping/review case in `E-XLS-B`.             | Local Chromium pass; exact-final `F`.       |
| `5.X3`  | Multiple processes/folders/participants/lanes/gateways/defaults/calls. | Direct complex official-workbook commit case in `E-XLS-B`.                 | Local Chromium pass; exact-final `F`.       |
| `5.X4`  | Sequential inference and synthetic boundary review.                    | Direct ordinary-workbook inference/review assertions in `E-XLS-B`.         | Local Chromium pass; exact-final `F`.       |
| `5.X5`  | IDs/references/types/circular lanes/invalid defaults.                  | Direct row-level error and repair matrix in `E-XLS-B`.                     | Local Chromium pass; exact-final `F`.       |
| `5.X6`  | Quoted multiline CSV and Arabic Unicode.                               | Direct RFC-4180 worker→XML→visible-language case in `E-XLS-B`.             | Local Chromium pass; exact-final `F`.       |
| `5.X7`  | Formulas with/without cached results.                                  | Direct cached/uncached formula and inert external-link cases in `E-XLS-B`. | Local Chromium pass; exact-final `F`.       |
| `5.X8`  | Oversize/encrypted/macro/malformed/bomb inputs.                        | Direct pre-mapping rejection matrix in `E-XLS-B`.                          | Local Chromium pass; exact-final `F`.       |
| `5.X9`  | Cancel/collision/rollback/report/preset reuse.                         | Four direct cancel/collision/rollback/preset cases with report downloads.  | Local Chromium 4/4; exact-final `F`.        |
| `5.X10` | Generated XML passes import/XSD/lint/link/language/layout.             | Direct ordinary and complex runtime validation-chain assertions.           | Local Chromium pass; exact-final `F`.       |

### Mandatory browser/manual scenarios — UI and accessibility

Focused local Chromium runs passed AML naming 1/1, company docs 5/5,
subprocess tree 1/1, responsive Details 2/2, assistant 2/2, smoke 6/6, and
panes/Details 10/10. The automated accessibility audit also passed 12/12 cases
and 84/84 surfaces with zero axe violations. The retained three-engine matrix
and axe job passed on `f7c18ae`; merged-head re-observation and human
assistive-technology evidence remain pending.

| ID      | Mandatory scenario                                     | Strongest evidence                              | Status/gap                                                                                                        |
| ------- | ------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `5.UI1` | Details rail LTR/RTL at every breakpoint.              | Details E2E suites and `E-UI-B`.                | Candidate breakpoint and direction coverage exists; exact-final matrix `F`.                                       |
| `5.UI2` | Pane state/resize/focus/touch/no-selection.            | `U/I/B`, including EN/AR no-selection cases.    | Candidate mapped coverage includes touch-pointer, focus, resize, state, and no-selection; exact-final matrix `F`. |
| `5.UI3` | Full keyboard-only outline creation/editing.           | Outline `U/I/B` and `E-UI-B`.                   | Dedicated EN/LTR and AR/RTL create/edit/save journeys require zero pointer activity; exact-final matrix `F`.      |
| `5.UI4` | Tabs/tree/search/menus/dialogs/assistant semantics.    | `E-FOCUSED-B`, `E-UI-B`, and `E-A11Y`.          | Local automated candidates exist; exact-final automation `F`, with human AT tracked separately by UI8/UI9.        |
| `5.UI5` | 320/375/768/1280 and 200%/400% zoom.                   | `E-A11Y` full width×zoom covering matrix.       | All 12 required width×zoom pairs are automated; exact-final artifact rerun `F`.                                   |
| `5.UI6` | No chrome overflow.                                    | Responsive E2E plus every `E-A11Y` matrix case. | Automated overflow checks cover every audited surface and width×zoom pair; exact-final artifact rerun `F`.        |
| `5.UI7` | Light/dark contrast and reduced motion.                | `E-A11Y`, static/component candidate.           | Both color schemes and motion preferences are automated; exact-final artifact rerun `F`.                          |
| `5.UI8` | NVDA/Windows and VoiceOver/macOS smoke.                | Manual evidence schema exists.                  | Not performed; `H`.                                                                                               |
| `5.UI9` | Arabic screen-reader language and mixed pronunciation. | DOM language markers `U/I/B` selected.          | Human Arabic AT/pronunciation not performed; `H`.                                                                 |

### Mandatory browser scenarios — AI/security

Bundle `AI-B` contains 12 direct browser scenarios. Its latest local Chromium
run passed 12/12. The suite is committed, and the retained three-engine
matrix passed on `f7c18ae`; merged-head re-observation remains pending.

| ID       | Mandatory scenario                          | Strongest evidence                                                                                                                           | Status/gap                                             |
| -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `5.AI1`  | Session-only and encrypted-key behavior.    | Three credential/storage browser cases in `E-AI-B`, plus `E-AI` `U/I`.                                                                       | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI2`  | Storage failure reporting.                  | Direct injected encrypted-storage failure case in `E-AI-B`.                                                                                  | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI3`  | Request preview/context opt-out.            | Direct reviewed disclosure and sent-payload comparison in `E-AI-B`.                                                                          | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI4`  | OpenRouter privacy flags.                   | Direct outbound request-header/body assertions in `E-AI-B`.                                                                                  | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI5`  | Capability blocking.                        | Direct fail-closed attachment/model capability case in `E-AI-B`.                                                                             | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI6`  | Permanent no-retry/transient bounded retry. | Two direct attempt-count/status cases in `E-AI-B`.                                                                                           | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI7`  | Cancellation of every AI path.              | Two `E-AI-B` cases cover attachment, generation, assistant, interview, workspace replacement, and DOCX parsing; `E-TR-B` covers translation. | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI8`  | Prompt-injection fixtures.                  | Direct adversarial workspace text and sent-payload inspection in `E-AI-B`.                                                                   | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI9`  | Accurate usage/cost updates.                | Direct transient/small-cost/reasoning and unknown-cost UI cases in `E-AI-B`.                                                                 | Local Chromium candidate pass; exact-final matrix `F`. |
| `5.AI10` | CSP network allowlist.                      | Static verifier plus direct built-CSP/startup/forbidden-host runtime case.                                                                   | Local Chromium candidate pass; exact-final matrix `F`. |

### Performance and soak gates

| ID     | Gate                                                              | Evidence                                                   | Status                                                                                                                                                              |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `5.P1` | Index 1,000 ordinary BPMN files within 5 s on reference hardware. | Production-path performance fixture and evidence contract. | Gate implementation measures the real adapter snapshot/index/projection path and fails closed on source identity; exact-final reference-profile result remains `F`. |
| `5.P2` | Incremental 1% refresh within 1 s.                                | Production-path performance fixture and evidence contract. | Gate implementation measures exactly ten changed files and reread counts; exact-final reference-profile result remains `F`.                                         |
| `5.P3` | 500-node preview ≤3 s; 1,000 nodes ≤10 s.                         | Browser worker-to-preview performance gate.                | Real XLSX worker/preview trials are implemented and artifact-bound; the current source still needs exact-final reference-profile evidence, `E/F`.                   |
| `5.P4` | Typing/selection/panes responsive during workers.                 | Browser worker/interaction overlap gate.                   | Typing, selection, and Details actions must overlap real parse requests with heartbeat budgets; exact-final artifact evidence remains `F`.                          |
| `5.P5` | 48-hour edit/recovery/switch/import/translation/history soak.     | `scripts/soak-gate.ts` and evidence schema.                | Not performed for release candidate; `H/E`.                                                                                                                         |
| `5.P6` | Zero unresolved P0/P1 and no unexplained memory/storage growth.   | Soak/human defect evidence.                                | Pending soak and final defect triage; `H/E`.                                                                                                                        |

### Commit, push, release, and archival completion

The local release allowlist is exactly:
`OrbitPM-Process-Studio-Lite-0.4.5.html`,
`OrbitPM-Excel-Template-0.4.5.xlsx`,
`OrbitPM-Excel-Example-0.4.5.xlsx`,
`OrbitPM-Process-Studio-Lite-0.4.5.cyclonedx.json`,
`THIRD_PARTY_NOTICES.md`, `LICENSE`, and `SHA256SUMS.txt`. This is a
candidate definition, not a statement that the assets have been published.

| ID      | Requirement                                                                                           | Implementation/evidence                     | Current state                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `5.R1`  | Merge reviewed PR into protected main.                                                                | PR #1/workflows.                            | `E`: open and ready for review with retained checks green at `f7c18ae`; approval and merge pending, and no independent authorized collaborator is configured. |
| `5.R2`  | Clean worktree and checks bound to merge commit.                                                      | release evidence verifiers.                 | `E/F`: worktree dirty; no merge commit.                                                                                                                       |
| `5.R3`  | All version displays/manifests 0.4.5.                                                                 | manifest/version code; `REP`.               | Candidate `I`; exact final `F`.                                                                                                                               |
| `5.R4`  | Build exactly: Lite HTML, Excel template, Excel example, CycloneDX SBOM, notices, license, checksums. | assembler/template/SBOM scripts; `REP/XLS`. | Candidate exact seven-asset implementation; no published assets, `E/F`.                                                                                       |
| `5.R5`  | Test exact CI-downloaded HTML over `file://`.                                                         | external-release evidence workflow/schema.  | Not performed, `E/F`.                                                                                                                                         |
| `5.R6`  | Annotated `v0.4.5` at merge commit.                                                                   | release workflow.                           | Tag absent, `E`.                                                                                                                                              |
| `5.R7`  | Tag CI clean rebuild/reproducibility/draft/checksums.                                                 | release workflow/verifiers.                 | No tag run, `E`.                                                                                                                                              |
| `5.R8`  | Pages from same commit.                                                                               | Pages workflow/verifier.                    | Pages remains remote main/v0.4.4, `E`.                                                                                                                        |
| `5.R9`  | Pages smoke current Chrome/Edge/Firefox/Safari in EN/AR.                                              | browser compatibility evidence schema.      | Not performed on 0.4.5, `E/H`.                                                                                                                                |
| `5.R10` | Publish v0.4.5 latest stable.                                                                         | release workflow.                           | No release, `E`.                                                                                                                                              |
| `5.R11` | Verify SHA equality, release flags/assets/no desktop/offline/version.                                 | external release verifier.                  | Cannot run until release; `E`.                                                                                                                                |
| `5.R12` | Only then archive older titles/notices/remove executable assets/retain Lite HTML/tags/verify bundles. | archival completion scripts/docs.           | Deliberately pending final release validation; `E`.                                                                                                           |
| `5.R13` | Record URLs, SHA, Pages, checksums, archive refs, report links.                                       | release evidence docs/schema.               | Local templates exist; final values absent, `E`.                                                                                                              |
| `5.R14` | Failure policy: do not publish/move tag; rollback Pages and patch, never retag.                       | workflow/docs policy.                       | Policy implemented `S`; no release event yet, `I/E`.                                                                                                          |

### Explicit assumptions/defaults

| ID       | Assumption/default                                                                                                  | Traceability state                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `5.AS1`  | v0.4.4 is archival baseline, not rebuilt/republished.                                                               | Honored; `AR`.                                                                                                                        |
| `5.AS2`  | Archived means recoverable/unsupported, not rewritten/deleted.                                                      | Archive design honors it; release-title/asset transition pending `E`.                                                                 |
| `5.AS3`  | Lite remains one self-contained downloadable HTML.                                                                  | Build/size/runtime candidate evidence; exact release artifact `F/E`.                                                                  |
| `5.AS4`  | Support XLSX/CSV; exclude legacy/macro Excel.                                                                       | `XLS` implementation/tests; `I/F`.                                                                                                    |
| `5.AS5`  | Template-plus-mapper; offline deterministic default.                                                                | `XLS`; `U/I/B` candidate, `I/F`.                                                                                                      |
| `5.AS6`  | Arabic uses professional MSA.                                                                                       | Localization prompts/resources/docs; automated script checks cannot certify linguistic quality, so human language review `H`.         |
| `5.AS7`  | BPMN geometry LTR; Arabic UI/text RTL.                                                                              | `LOC/UI`; `U/I/B` candidate, multi-engine/manual `F/H`.                                                                               |
| `5.AS8`  | Details at logical inline-end.                                                                                      | `UI`; `U/I/B` candidate, `I/F`.                                                                                                       |
| `5.AS9`  | Offline audit automatic; external translation requires consent.                                                     | `LOC/AI`; no-network/consent `U/I/B`, `I/F`.                                                                                          |
| `5.AS10` | Current/previous Chrome, Edge, Firefox, Safari supported; cloud/roles/DMN/forms/deployment/simulation out of scope. | Support docs define scope. The 16-row current/previous-major compatibility evidence is absent; browser support claim remains `P/E/H`. |

## Release-blocking remainder

The local candidate is frozen at app commit `75a31e3`, and every local
exact-final gate is green against the exact artifact `3299cff3…ed51`: all
static/policy and supply-chain gates, coverage with all four branch profiles,
the validation and malformed-input suites, the complete
Chromium/Firefox/WebKit exact-artifact matrix with zero retries or skips, the
artifact-bound automated accessibility matrix, the development-only
performance budgets, and the exact seven-asset assembly with English/Arabic
offline smoke. The known private-Playwright-API test debt is closed by
`2f419a7`, which uses the public `webkit` export. Retained remote CI evidence
now backs the automated gates at `f7c18ae` (run 30289755296, all 11 required
checks green), but that run predates this documentation commit and the
protected merge, so it is not evidence for the final merged head. This
candidate is not releasable yet. At minimum, the following remain:

- push this documentation commit and re-observe the complete quality workflow
  on the final merged head so retained remote CI evidence binds the exact
  release commit with zero retries;
- complete the current/previous-major Chrome, Edge, Firefox, and Safari EN/AR
  compatibility matrix;
- perform NVDA, VoiceOver, Arabic pronunciation, linguistic review, and the
  genuine uninterrupted 48-hour exact-candidate soak;
- secure independent archive custody evidence;
- add and configure an independent authorized reviewer for the latest-push PR
  approval and every protected human-gated environment;
- obtain PR review/approval, merge, tag, rebuild, publish release and Pages
  from the same commit, verify the exact seven downloaded assets, and only then
  perform historical release-title and executable-asset cleanup while
  retaining the required Lite HTML and archive refs.

No row marked `I`, and no one-off local run, should be interpreted as satisfying
an `F`, `E`, or `H` requirement.
