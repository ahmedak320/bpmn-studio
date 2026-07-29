# ARIS transformation phase checklist

Authoritative source: [aris_transformation.md](/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md)

## Snapshot and methodology

Committed baseline: `feat/aris-only-studio` at commit `5db087426c4632e296e3c56407a6bc30a21c6656`
(short `5db0874`, "fix(aris): close Phase 16 data-loss and coverage defects"), captured 2026-07-29.

**This worktree has two other agents actively landing work in it while this document is being
written.** At the moment this pass started, `git status --short` already showed uncommitted
changes to `src/aris/canvas/**`, `src/aris/layout/**` and `src/aris/shell/**` (lane-band/free-text/
fit-view layout work). Ten minutes later a second cluster of uncommitted changes appeared in
`scripts/browserPerformanceEvidence.ts`, `src/aris/ai/**` and three new `src/aris/shell/arisAi*.ts`
files (AI-creation attachment/placement work). Every number in this document is labelled with
**which state it describes**:

- **"At `5db0874`"** — the last commit, read with `git show <sha>:<path>`, unaffected by either
  agent's in-progress edits.
- **"Live tree, `HH:MM`"** — the uncommitted working tree at a specific timestamp this pass, which
  moved at least twice while this document was being written. Two back-to-back runs of the same
  command 6–11 minutes apart produced different single-test failures each time (see Phase 2 and
  Phase 18 evidence below) — this is concurrent-edit noise, not a regression, and is called out
  explicitly everywhere it appears rather than silently omitted or silently trusted.

Re-run the cited commands to see whether the picture has moved further since this pass.

## Status vocabulary

This document replaces the previous binary Complete/In progress/Pending scheme, which let Phases
2 and 3 be marked "Complete" while `typecheck` and `lint` were both red at HEAD. Every phase below
gets exactly one of:

| Status                             | Meaning                                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exit gate met**                  | Every bullet of the plan's own exit gate for this phase is demonstrated, end to end, including user-visible behavior the gate requires.                                                                                           |
| **Module complete, unit-verified** | The subsystem's own unit/integration tests pass and its logic is real, but at least one exit-gate bullet is not yet demonstrated end to end — the evidence subsection says exactly which bullet(s) are covered and which are not. |
| **Blocked on integration**         | The module-level work is done and unit-verified, but it is not wired into `src/main.tsx` → `src/ArisApp.tsx`. (No phase below carries this status any more — see Integration status.)                                             |
| **Blocked on user**                | The gate cannot close without an artifact, decision, or live system access only the user can supply (a real Arabic-content export, a live ARIS installation, a golden PDF/PNG pair).                                              |
| **Not started**                    | No code exists for this phase.                                                                                                                                                                                                    |

## Integration status — read this first

**This has changed completely since the last pass.** The previous snapshot (`cf13c47`) reported
69 production modules reachable from `src/main.tsx`, with twelve of fifteen `src/aris/**`
subsystems entirely unreachable. Two integration waves have since landed:

```text
$ npm run check:aris-runtime-boundary
ARIS runtime boundary check passed: 231 production modules reachable from src/main.tsx.
```

Re-run five minutes later, against the live (uncommitted) tree, it read 235 — the number keeps
moving upward as the second agent adds files; both readings are independently reproduced in this
pass and both are roughly 3.3× the stale 69 baseline. At commit `abda54a` ("integration wave 1")
it was 153; at `a628068` ("integration wave 2") it was 229. There is no BPMN dependency violation
at any of these points — `check:aris-runtime-boundary` bans the BPMN package set and the legacy
`src/App.tsx`/`src/editor/**` graph, and passes cleanly throughout.

A breakdown of which `src/aris/**` subsystem each reachable file belongs to (own script, same
walk `check-aris-runtime-boundary.mjs` performs, run against the live tree in this pass):

| Subsystem  | Files reached | Subsystem                             | Files reached |
| ---------- | ------------: | ------------------------------------- | ------------: |
| source     |             5 | renderer                              |             7 |
| packages   |            11 | canvas                                |            26 |
| model      |             4 | chat                                  |             7 |
| writer     |            13 | shell                                 |            21 |
| accounting |             5 | (composition layer, not a plan phase) |
| symbols    |             6 |                                       |               |
| excel      |            12 |                                       |               |
| ai         |             9 |                                       |               |
| epc        |             9 |                                       |               |
| layout     |            10 |                                       |               |
| assistant  |            11 |                                       |               |
| details    |             5 |                                       |               |

**All fifteen plan subsystems are reachable; none are missing entirely.** This matches the wave
commit messages exactly: wave 1 ("mount the ARIS subsystems in the shell") wired canvas, packages,
layout, model, accounting, symbols, renderer and details; wave 2 ("wire the remaining six
subsystems") wired writer, excel, ai, and partially assistant/chat/epc — the wave 2 commit message
states assistant 11/15, chat 7/11, epc 9/11 files reached, "the remainder are type-only imports,
barrels and test-only scanners," which is exactly what this pass's independent count reproduces
(11, 7, 9). Source (Phase 3) was already wired before either wave.

Consequently the shipped artifact now has a working canvas, editing, undo/redo, a details rail, an
accounting/fidelity rail, an EPC-findings rail, a chat-improve rail, Excel create, AI create, and a
folder assistant — all reachable from a single mounted `ArisApp.tsx`. What "reachable" does **not**
mean, and what the per-phase evidence below checks separately, is that every exit-gate bullet for
every phase is demonstrated by an end-to-end scenario. Being on the graph is necessary, not
sufficient.

## Phase status

| Phase                                                       | Status                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0. Establish branch and immutable baselines                 | Exit gate met (administrative)                                                                                                                                                                                                                                                                           | [ARIS_PHASE0_BASELINE_2026-07-28.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE0_BASELINE_2026-07-28.md) |
| 1. Freeze retained infrastructure before removing BPMN      | Exit gate met                                                                                                                                                                                                                                                                                            | `npm run test:aris:phase1` — full pass, this pass                                                                   |
| 2. Replace product shell and remove BPMN runtime            | Exit gate met                                                                                                                                                                                                                                                                                            | `npm run test:aris:phase2` — full pass, this pass                                                                   |
| 3. Secure lossless AML input layer                          | Exit gate met                                                                                                                                                                                                                                                                                            | [ARIS_PHASE3_INPUT_LAYER.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE3_INPUT_LAYER.md)                 |
| 4. Immutable source packages and workspace revisions        | Module complete, unit-verified — atomicity and original-preservation demonstrated end to end; dedup/backup-restore/generated-provenance are unit-tested only                                                                                                                                             | [ARIS_PHASE4_TO_15_MODULES.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE4_TO_15_MODULES.md) §packages   |
| 5. Native ARIS working model and command system             | Exit gate met                                                                                                                                                                                                                                                                                            | same doc §model                                                                                                     |
| 6. Build AML writer and derived export                      | Exit gate met (§9.6); §9.5 experimental label stays until Phase 17                                                                                                                                                                                                                                       | same doc §writer                                                                                                    |
| 7. Implement complete source accounting                     | Exit gate met                                                                                                                                                                                                                                                                                            | same doc §accounting                                                                                                |
| 8. Build the ARIS canvas and full supported authoring       | Module complete, unit-verified — move/undo/redo/selection demonstrated live; a from-empty-canvas full manual EPC authoring scenario is unit-tested (`epcEndToEnd.test.ts`) but not exercised through the mounted shell                                                                                   | same doc §canvas                                                                                                    |
| 9. Source-faithful visual renderer                          | Module complete, unit-verified — source geometry and Source/Clean restorability demonstrated live; fidelity-report visibility in the UI not independently confirmed this pass                                                                                                                            | same doc §renderer, §symbols                                                                                        |
| 10. Rich metadata, details panel, and attachments           | Module complete, unit-verified — details rail mounts and selection/highlight works live; per-tab metadata content and attachment backup/export survival not independently confirmed this pass                                                                                                            | same doc §details                                                                                                   |
| 11. EPC semantics, XOR, return paths, and clean layout      | Exit gate met, for the parts the plan's own §14.5/§19.4 criteria gate — see Phase 16 evidence; the confirmation-UI for a _missing_ return route was not exercised (AnimalWF's four named scenarios all have explicit routes already, so there is nothing to confirm against)                             | same doc §epc, §layout                                                                                              |
| 12. Create from a new ARIS-native Excel template            | Exit gate met                                                                                                                                                                                                                                                                                            | same doc §excel                                                                                                     |
| 13. Create with AI from description, DOCX, PDF, and picture | Module complete, unit-verified — description → draft → AML and forbidden-content rejection demonstrated live; DOCX/PDF/image attachment paths are being actively built in the live tree (uncommitted `arisAiAttachments.ts`/`arisAiGeneration.ts`/`arisAiPlacement.ts`) and were not exercised this pass | same doc §ai                                                                                                        |
| 14. Folder-aware ARIS process assistant                     | Module complete, unit-verified — the no-key deterministic path is demonstrated live end to end, including chip selection; the AI-grounded path is unit-tested only                                                                                                                                       | same doc §assistant                                                                                                 |
| 15. Chat improvement and missing-information completion     | Module complete, unit-verified — safe-field auto-apply and undo demonstrated live; confirmation-gating and invalid-patch rejection are unit-tested only (`classification.test.ts`, 40 cases)                                                                                                             | same doc §chat                                                                                                      |
| 16. AnimalWF full-data and natural-layout loop              | Exit gate met — §19.5 gate passes with 0 failures; see the dedicated Phase 16 evidence section below for the honest remainder                                                                                                                                                                            | see Phase 16 evidence below                                                                                         |
| 17. Visual golden pair and ARIS import/re-export            | Blocked on user                                                                                                                                                                                                                                                                                          | no golden AML/PDF/PNG pair supplied; no live ARIS access                                                            |
| 18. Release-quality tests, performance, and publication     | Not started (as a phase); typecheck/lint/unit/integration ad hoc evidence is strong, browser matrix and performance gates are not attempted                                                                                                                                                              | see Phase 18 evidence below                                                                                         |
| Stable definition of done                                   | Not met                                                                                                                                                                                                                                                                                                  | Phase 17 (user), Phase 18 multi-browser/performance evidence, and the Phase 0 identity/version drift remain         |

## Per-phase evidence

### Phase 0 — Establish branch and immutable baselines

Exit gate met at the administrative level: branch exists, baseline doc exists, plan committed.
Not re-audited in this pass (out of scope — no git operations permitted). The drift flagged last
pass is **still open, unchanged**: plan §1 specifies package version `0.1.0-alpha.1` and product
identity `OrbitPM ARIS Studio Lite`; `package.json` at `5db0874` still reads
`"name": "orbitpm-process-studio-lite"`, `"version": "0.4.5"`, `"description": "OrbitPM Process
Studio Lite — a self-contained, bilingual BPMN 2.0 editor that runs in the browser."` — confirmed
directly against the live tree in this pass (`grep -n '"name"\|"version"\|"description"'
package.json`).

### Phase 1 — Freeze retained infrastructure before removing BPMN

**This phase closed since the last pass.** The prior report was that `npm run test:aris:phase1`
failed at its Playwright step because the pinned spec (`tests/e2e/lite-i18n-rtl.spec.ts`) drove
the removed BPMN canvas. Commit `d5e37d3` ("add ARIS shell e2e specs and rebind accessibility
evidence") replaced it with `tests/e2e/aris-i18n-rtl.spec.ts` and retargeted the script. Run fresh
in this pass, against the live tree:

```text
$ npm run test:aris:phase1
=== build single-file artifact ===                              ✓ 620 modules, 4.13s
=== vitest retained-infrastructure characterization set ===      ✓ 12 files, 138 tests
=== chromium English/Arabic dialog characterization (ARIS shell) === ✓ 4/4 (aris-i18n-rtl.spec.ts)
=== chromium provider UI and no-key PDF gate characterization ===    ✓ 3/3 (lite-providers.spec.ts)
=== single-file file:// smoke (ARIS shell) ===                   ✓ passed
ARIS Phase 1 characterization suite passed.
```

All five steps pass, no failures, no skips. This is a direct re-execution, not a citation of the
commit message. **One scope caveat, not independently re-verified this pass:** the composite
script only runs the Chromium project. Commit `d5e37d3`'s own message additionally claims "7 tests
passing on Chromium, Firefox and WebKit" for the two new specs (`aris-i18n-rtl.spec.ts` has 4
tests, `aris-accessibility.spec.ts` has 3 — both counts independently confirmed in this pass by
`grep -c '^\s*test('`); the Firefox/WebKit legs of that claim are sourced from the commit message,
not re-run by this pass.

### Phase 2 — Replace the product shell and remove BPMN runtime

**Also closed since the last pass, and the previous caveat is now moot.** The prior report noted
`npm run test:aris:phase2` failed 12/144 tests, all inside `src/App.integration.test.tsx` — a test
file for the legacy 8,028-line `src/App.tsx` monolith that `check-aris-runtime-boundary.mjs`
already banned from the production graph. Both `src/App.tsx` and `src/App.integration.test.tsx`
have since been deleted outright (confirmed: `ls src/App.tsx src/App.integration.test.tsx` →
"No such file or directory"), and `test:aris:phase2`'s own `package.json` definition no longer
references either. Run fresh in this pass:

```text
$ npm run test:aris:phase2
  (check:aris-runtime-boundary passes, then:)
  Test Files  101 passed (101)
       Tests  1257 passed (1257)
```

Zero failures. **Volatility note, stated plainly because it matters for how to read this:** a
second, independent invocation of the same underlying test set roughly six minutes later — while
the second agent's uncommitted AI-creation work (`arisAiAttachments.ts` etc.) was still landing —
showed one different, unrelated test fail each time (an AI-draft-rejection assertion the second
time; a portable-workspace-container assertion the first time reported in this pass's raw
transcript). Both failing tests are in files under active uncommitted edit by the other agent, and
neither failure recurred on immediate re-run. This is concurrent-edit noise, not attributed to
ARIS-shell logic; the 101/101, 1257/1257 clean run above is the one to trust as this phase's
evidence.

`scripts/check-aris-runtime-boundary.mjs` still bans `src/App.tsx`, `src/editor/**`,
`src/org/orbitpmModdle.ts`, `src/validation/ReadOnlyDiagramPreview.tsx`, and the BPMN package set
from the reachable graph and from `package.json`'s `dependencies`; both checks pass.

### Phase 3 — Build a secure lossless AML input layer

Unchanged in substance from the last pass, now further confirmed by two more independent code
paths. `ArisApp.tsx` still opens files through `createArisXmlSourcePackage` /
`buildArisStudioDocument`; this pass's own execution of `npm run test:aris:phase16` (see below)
independently rebuilds the semantic index from the real AnimalWF export a third time (after the
tokenizer's own tests and the accounting module's own tests) and gets the identical counts every
time: 8 models, 279 object definitions, 494 object occurrences, 465/465 connection
definitions/occurrences, 516 attributes, 774 attribute occurrences, 16 lanes, 69 free-text
records, 0 diagnostics, 174 unknown records. See
[ARIS_PHASE3_INPUT_LAYER.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE3_INPUT_LAYER.md)
for the full writeup. Status: **Exit gate met** — §6.7's parsing/security criteria do not require
UI integration and were already independently reconciled before this pass; they remain so.

### Phase 4 — Immutable source packages and workspace revisions

`src/aris/packages/**`: 11 files, 101 tests (up from 97 — commit `6230016` expanded
`accounting.test.ts` to cover the new derived-vs-raw partition), all passing. Now reachable and,
for two of §7.6's four bullets, demonstrated live through the mounted shell:

- **"Import is atomic"** — `src/ArisApp.test.tsx`: `shows the §7.3 review before committing an
import and writes nothing when it is cancelled` (review dialog shows exact digests/member
  list/fidelity summary; cancel writes zero downloads).
- **"Original bytes survive save/edit/export/backup/restore unchanged"** — partially: `commits a
portable single-file import without overwriting the opened source` shows the imported AML is
  never replaced (the portable container is written to a _sibling_ file); the derived-export test
  (Phase 6, below) independently shows original bytes survive export byte-for-byte. Backup/restore
  specifically was not exercised by any test this pass found in `ArisApp.test.tsx`.
- **"Identical source imports deduplicate"** and **"generated models retain provenance"** — covered
  only by `packages/__tests__/generated.test.ts` and `transaction.test.ts` at the module level; no
  end-to-end shell scenario for either was found this pass.

Status: **Module complete, unit-verified**, with two of four gate bullets now live-demonstrated.

### Phase 5 — Native ARIS working model and command system

`src/aris/model/**`: 4 files, 31 tests (default project) + 2 more in the opt-in
`buildFromSource.animalwf.test.ts` (real-data free-text id stability, added by the Phase 16 defect
fix — see below), all passing. §8.4's bullets:

- **"Working model builds from sanitized AML"** — live: every AML-opening test in `ArisApp.test.tsx`
  depends on this succeeding, most directly `renders an opened AML export on the real ARIS canvas
at its imported coordinates`.
- **"Commands persist and restore"** — live: `round-trips undo and redo through the ARIS command
stack from the toolbar`.
- **"Undo/redo never changes original bytes"** — live, indirectly: the derived-export
  byte-identical test (Phase 6) plus the architectural fact that original bytes are never passed
  through the command system at all (`packages/__tests__/exitGate.test.ts`).
- **"Definition/occurrence behavior is correct"** (a definition may have multiple occurrences;
  occurrence state is per-occurrence) — proven at the unit level
  (`buildFromSource.test.ts`, `commands.test.ts`, `canvas/canonicalGeometry.test.ts`); no shell-level
  scenario specifically exercises one definition with two occurrences.

Status: **Exit gate met** — every bullet has at least one passing demonstration; the last one is
unit-level rather than shell-level, noted here rather than silently upgraded.

### Phase 6 — AML writer and derived export

`src/aris/writer/**`: 9 files, 162 tests (default project) + 3 more in the opt-in
`animalWfRoundTrip.animalwf.test.ts`, all passing. §9.6's exit gate is now demonstrated live, not
just computationally:

```text
src/ArisApp.test.tsx
✓ exports a derived AML that is byte-identical to the untouched original, then carries the clean layout
✓ refuses the derived export when a section 9.3 check fails, and downloads nothing
```

Plus the real-data round trip (opt-in, run fresh this pass):

```text
$ npm run test:aris:animalwf
✓ AnimalWF round trip > reproduces the original byte-for-byte under a no-op edit set
✓ AnimalWF round trip > changes only the renamed id spans and leaves every other byte identical
✓ AnimalWF round trip > passes every export validation after the rename
```

Since the last pass, commit `5db0874` also widened what the writer can express: derived export
now covers the whole working-model diff (renames, bilingual values, creations with source-style id
allocation, deletions with reference cascade, lanes and free text), not only geometry. Eight kinds
remain explicitly unmapped, each with a stated reason (`src/aris/shell/arisDerivedExport.ts`):
`newModel`, `removedModel`, `defaultLocale`, `clearedAttribute`, `missingAnchor`,
`movedConnectionSource`, `linkedModelsOnNewDefinition`, `unknownRecord` — confirmed by reading the
source directly (`grep -n "aris.export.unmapped\." src/aris/shell/arisDerivedExport.ts` → exactly
these 8 keys). Status: **Exit gate met** for §9.6. §9.5's "Experimental ARIS AML export" label
requirement is untouched by any of this and stays until Phase 17; it is pinned by
`src/__tests__/i18n.test.ts`'s `fixes the experimental export label to the plan §9.5 wording
exactly`.

### Phase 7 — Complete source accounting

`src/aris/accounting/**`: 1 file, 10 tests (up from 9). The accounting-rail defect fixed by
`5db0874` (see Phase 16 defects below) is directly confirmed against real data by this pass's own
`test:aris:phase16` run:

```text
accounting: 68036 accounted / 68036 source records, 0 unaccounted, 0 issues
```

— exactly equal, not "68043 of 68036." §10.4's exit gate is demonstrated both computationally (the
above) and live: `ArisApp.test.tsx`'s import-review dialog asserts `within(dialog).getByText(/0
unaccounted/u)` for a real import. Status: **Exit gate met**.

### Phase 8 — ARIS canvas and full supported authoring

`src/aris/canvas/**`: 12 files, 126 tests (default project), all passing, including
`epcEndToEnd.test.ts` (3 tests, "Section 11.6" — full start→function→XOR split→two branches→merge→
end authored through canvas operations). Live in the shell:

```text
✓ round-trips undo and redo through the ARIS command stack from the toolbar
✓ restores the imported geometry with Reset to Source Layout
✓ selects the canvas element behind an accounting row and highlights its relations
```

These demonstrate move/undo/redo/selection-highlight against the real mounted canvas. §11.6's
literal exit-gate wording — "a user can author a complete EPC manually" — is proven only at the
`epcEndToEnd.test.ts` module level (a scripted sequence of canvas API calls, not a click-driven
shell scenario starting from an empty canvas); no `ArisApp.test.tsx` test builds a model from
nothing through simulated clicks. Status: **Module complete, unit-verified**, with strong partial
live coverage (edit/undo/select, on real data) short of the literal from-scratch authoring gate.

### Phase 9 — Source-faithful visual renderer

`src/aris/renderer/**` (8 files, 56 tests) and `src/aris/symbols/**` (1 file, 10 tests), unchanged
in count from the last pass, both passing. Live in the shell:

```text
✓ renders an opened AML export on the real ARIS canvas at its imported coordinates
✓ restores the imported geometry with Reset to Source Layout
```

These demonstrate two of §12.5's three bullets ("source geometry is visible," "Source/Clean modes
are independently restorable") against real data. The third — "unknown visuals are explicit" —
is proven at the module level (`missing-template` fires for exactly all 8 AnimalWF models,
`animalWfRealData.test.ts`) but this pass did not find or run a shell-level assertion that the
fidelity/missing-template finding is surfaced anywhere a user would see it. Status: **Module
complete, unit-verified**.

### Phase 10 — Rich metadata, details panel, and attachments

`src/aris/details/**`: 4 files, 28 tests (default project) + 5 more in two opt-in AnimalWF tests
(`animalWf.animalwf.test.ts`, 4 tests; `localeBilingual.animalwf.test.ts`, 1 test — the latter
title is exact: "surfaces both the English and Arabic name of the one bilingual object," both
confirmed passing this pass). Live in the shell, the details rail mounts and responds to
selection: `selects the canvas element behind an accounting row and highlights its relations`.
§13.5's bullets — "all AnimalWF metadata remains available," "rich display does not distort the
control-flow backbone," "attachments survive backup/export" — are not independently confirmed by
a shell-level test walking every tab/attachment this pass found. Status: **Module complete,
unit-verified**.

### Phase 11 — EPC semantics, XOR, return paths, and clean layout

`src/aris/epc/**` (5 files, 44 tests) and `src/aris/layout/**` (6 files, 139 tests in the default
project, plus 59 more in the opt-in `animalWf.animalwf.test.ts` and 11 new in
`annotations.test.ts`, all passing). This is the phase Phase 16 gates most directly — see the
dedicated Phase 16 evidence
section below for the full per-model breakdown. Summary: every one of the 8 real AnimalWF models'
**clean** layouts is accepted with zero shape overlaps, zero label/satellite overlaps, zero
edge/shape crossings, zero detached endpoints, zero missing/duplicate/zero-length edges — this is
§14.5's "clean layouts pass collision/topology metrics" and §19.4's geometric criteria, both now
demonstrated against the **rendered product**, not just the algorithm in isolation (the distinction
that mattered last pass, when the jsdom test stub made every such assertion vacuous — see Phase 16
defects). §14.3's return-path detection is independently reconciled against all four of §19.3's
named scenarios (see Phase 16 evidence). Live in the shell: `lists EPC validation findings and
selects the offending model, switching models when needed`. The one gate bullet not exercised —
"missing return routes are safely confirmable" — has no live test this pass because AnimalWF's
four named scenarios all already have explicit return routes; there is nothing missing to confirm
against in this fixture. Status: **Exit gate met** for every criterion the plan text actually
gates, with that one bullet's absence of a _negative_-case test noted rather than hidden.

### Phase 12 — Create from a new ARIS-native Excel template

`src/aris/excel/**`: 6 files, 81 tests, unchanged, all passing. §15.6's bullets are directly
demonstrated live:

```text
✓ downloads the deterministic ARIS Excel templates from the single HTML
✓ creates native AML from a filled-in ARIS workbook with no AI at all
✓ rejects the retired BPMN 0.4.5 workbook with migration guidance instead of treating it as ARIS
```

Status: **Exit gate met**.

### Phase 13 — Create with AI from description, DOCX, PDF, and picture

`src/aris/ai/**`: 7 files, 72 tests, unchanged, all passing. Live in the shell:

```text
✓ turns a valid ArisAiDraftV1 into canonical AML, never asking the model for AML
✓ surfaces the validator's rejections verbatim and creates nothing
```

These demonstrate the description-text path and the forbidden-content rejection path. **This pass
found the DOCX/PDF/image attachment paths under active, uncommitted construction**: three new
files appeared in the live tree partway through this pass —
`src/aris/shell/arisAiAttachments.ts`, `arisAiGeneration.ts`, `arisAiPlacement.ts` — none of which
exist at commit `5db0874`. No test exercising an attachment through the shell was found or run this
pass. Status: **Module complete, unit-verified**, with the text-description half of §16.8 live and
the attachment half explicitly open and in flight elsewhere in this same worktree.

### Phase 14 — Folder-aware ARIS process assistant

`src/aris/assistant/**`: 11 files, 98 tests (up from 93 — a new `arisVocabulary.test.ts`, 5 tests),
all passing. Live in the shell: `answers a folder question with no provider and no key, and its
chip selects the model` — this single test demonstrates two of §17.6's three bullets at once
("folder questions work without a key," "source chips open/select correct ARIS elements"). The
third bullet, "AI answers remain grounded and privacy-reviewed," is covered only by
`questionRouter.test.ts`/`retrieval.test.ts` at the module level; no shell-level AI-grounded
assistant scenario was found this pass. Status: **Module complete, unit-verified**, with the
no-key path essentially fully demonstrated.

### Phase 15 — Chat improvement and missing-information completion

`src/aris/chat/**`: 8 files, 140 tests (up from 135 — a new `locale.test.ts`, 5 tests, added by the
`8eba852` locale-classification fix), all passing. Live in the shell: `completes a missing field
through the chat interview, atomically and undoably` — demonstrates §18.8's "safe field completion
auto-applies atomically" and "Undo restores prior revision" bullets directly. Chat now translates
all 15 patch commands (up from 9/15 at wave 2): confirmed by reading
`src/aris/shell/arisChatHost.ts`'s dispatch — `setLocalizedName`, `setAttribute`,
`addAttributeValue`, `setAssignment`, `setRoute`, `reconnect`, `deleteConnection`,
`deleteOccurrence`, `deleteDefinition`, `addMetadataDefinition`, `addMetadataOccurrence`,
`addMetadataConnection`, `addCoreConnection`, `addCoreObject`, `removeAttachment` — 15 distinct
`case` labels, no `default: throw`. The remaining two gate bullets — "topology/destructive changes
remain confirmation-gated" and "invalid AI patches make no changes" — are covered by
`classification.test.ts` (40 tests, the largest single test file in the whole `src/aris` suite) and
`applyEngine.test.ts` (20 tests) at the module level; no shell-level test forcing a topology change
through the confirmation dialog was found this pass. Status: **Module complete, unit-verified**.

### Phase 16 — AnimalWF full-data and natural-layout loop

See the dedicated section below.

### Phase 17 — Visual golden pair and ARIS import/re-export

**Blocked on user, unchanged.** No golden AML + matching ARIS PDF/PNG export pair has been
supplied, and no live ARIS installation is available in this environment. §20.3's live
import/re-export gate and §20.2's visual comparison gate cannot be attempted. The
`aris.export.experimentalLabel` string stays in force until this phase closes; it is pinned by a
test as confirmed under Phase 6 above.

### Phase 18 — Release-quality tests, performance, and publication

Not run as a phase. This pass confirms, against the live tree:

```text
$ npm run typecheck   # tsc --noEmit -p tsconfig.json  →  clean
$ npm run lint        # eslint . --max-warnings 0      →  clean
```

**Both were briefly red earlier in this same pass** — `typecheck` failed with 5 errors in
`scripts/browser-performance-gate.ts` (`REQUIRED_WORKER_INTERACTIONS` and
`evaluateWorkerInteractionGate` not found) because the second agent's uncommitted rename of those
exports to `REQUIRED_ARIS_INTERACTIONS`/`evaluateArisInteractionGate` in
`scripts/browserPerformanceEvidence.ts` had not yet been propagated to the one file that imports
them. Confirmed transient by reading the
committed version at `5db0874` (`git show 5db0874:scripts/browserPerformanceEvidence.ts` /
`scripts/browser-performance-gate.ts` — the two files agree with each other at that commit) and by
the immediate re-run above going clean once the second agent's edit caught up. Not attributed to
any ARIS-shell defect.

Full ARIS-related test count, reconciled in this pass:

- Default project, `src/aris/**`: 100 files, 1223 tests.
- `src/ArisApp.test.tsx`: 24 tests.
- `src/__tests__/i18n.test.ts` (shared with the rest of the product, not ARIS-only): 34 tests.
- Opt-in `npm run test:aris:animalwf` (gated on the private fixture, excluded from the default
  project since commit `d5f085c` fixed a `check:no-skips` false-positive/false-negative pair):
  7 files, 75 tests.

All of the above pass cleanly when run in isolation, in this pass. §21.2 integration tests beyond
what is itemized per-phase above, §21.3's Firefox/WebKit legs of the full browser matrix, and
§21.4's performance gates were not attempted this pass.

## Phase 16 evidence — the AnimalWF full-data and natural-layout loop

### Reproduction conditions

```text
Command:   npm run test:aris:phase16   (= vite-node scripts/aris-animalwf-loop.ts)
Browser:   headless Chromium, via Playwright
Viewport:  1600 × 1000, deviceScaleFactor 1
Artifact:  dist/index.html, built by `npm run build` (NOT `build:aris` — the canonical
           `release/OrbitPM-ARIS-Studio-Lite.html` artifact was not touched by this pass)
Fixture:   ../reference/AnimalWF/ARISAMLExport.xml, 4,376,152 bytes
Fixture sha256: 38db10f0e2160eeb116e2b02564cd0a44662c24a18cb1c3ad82ade608b7926f5
```

Run directly by this pass (not cited from another agent's report); the full console transcript and
the JSON report (`local-evidence/aris-animalwf-loop.json`, git-ignored) are reproducible with the
command above.

### Census / index / accounting reconciliation

Three independent code paths — the raw lexical tag census, the semantic index, and the layout
module's own AML topology extractor — agree exactly:

| Field                       | Value |
| --------------------------- | ----: |
| Models                      |     8 |
| `MT_EEPC` models            |     7 |
| `MT_VAL_ADD_CHN_DGM` models |     1 |
| Object definitions          |   279 |
| Object occurrences          |   494 |
| Connection definitions      |   465 |
| Connection occurrences      |   465 |
| Attribute definitions       |   516 |
| Attribute occurrences       |   774 |
| Free-text records           |    69 |
| Lanes                       |    16 |
| Blobs                       |    28 |
| Font style sheets           |     6 |
| Unknown records             |   174 |
| Semantic diagnostics        |     0 |

Accounting: **68,036 accounted of 68,036 source records, 0 unaccounted, 0 issues** — exactly equal,
confirming the Phase 16 defect fix below (previously printed "68043 of 68036").

### Per-model metrics (§19.4 criteria, clean layout, occurrences node set)

| #   | Model                                                    | Type                 | shpOvl | lblOvl | edgShp | edgEdg (clean) | edgEdg (source) | detach | miss | dup | zero | accepted |
| --- | -------------------------------------------------------- | -------------------- | -----: | -----: | -----: | -------------: | --------------: | -----: | ---: | --: | ---: | -------- |
| 1   | Register an Animal's profile                             | `MT_EEPC`            |      0 |      0 |      0 |            319 |               5 |      0 |    0 |   0 |    0 | PASS     |
| 2   | Request to Register Animal Owner Profile                 | `MT_EEPC`            |      0 |      0 |      0 |            428 |               6 |      0 |    0 |   0 |    0 | PASS     |
| 3   | Animal Profile Closure                                   | `MT_EEPC`            |      0 |      0 |      0 |            142 |               5 |      0 |    0 |   0 |    0 | PASS     |
| 4   | Operator Registration and Renewal                        | `MT_EEPC`            |      0 |      0 |      0 |            467 |               4 |      0 |    0 |   0 |    0 | PASS     |
| 5   | Animal Ownership Transfer between Citizens               | `MT_EEPC`            |      0 |      0 |      0 |            480 |               2 |      0 |    0 |   0 |    0 | PASS     |
| 6   | Animal Welfare Division                                  | `MT_VAL_ADD_CHN_DGM` |     0† |      0 |      0 |              5 |              11 |      0 |    0 |   0 |    0 | PASS     |
| 7   | Renew an Animal's profile                                | `MT_EEPC`            |      0 |      0 |      0 |            136 |               1 |      0 |    0 |   0 |    0 | PASS     |
| 8   | Animal Ownership Transfer between Citizens and Companies | `MT_EEPC`            |      0 |      0 |      0 |            305 |               2 |      0 |    0 |   0 |    0 | PASS     |

†Model 6's **source** layout (not clean) has 24 shape overlaps and 35 edge-through-unrelated-shape
findings — this is a real property of the imported coordinates in that one model, not a product
defect. §19.4 gates the _clean/natural_ layout only; Source Layout is contractually an exact replay
of imported coordinates (§12.4), so `scripts/aris-animalwf-loop.ts` deliberately classifies
source-layout misses as non-gating `observations`, never `failures` — confirmed by reading the
script's own comment at the point it makes this choice (`aris-animalwf-loop.ts`, the `for (const
set of sourceMode.sets)` loop uses `observe(...)`, the equivalent `cleanMode` loop uses `record(...)`).

`edgEdg (clean)` far exceeding `edgEdg (source)` is real and expected: §19.4 does not gate
edge/edge crossings at all (a documented plan gap, unchanged from the last pass), and clean layout
spreads the dense satellite metadata graph, not just the control-flow backbone. All other §19.4
metrics — shape overlap, label/satellite overlap, edge/shape crossing, detached endpoints,
missing/duplicate/zero-length edges — are 0 for every model in every layout mode this pass
measured (32 sets: 8 models × 2 modes × 2 node sets).

### §19.4 acceptance verdict

**§19.5 exit gate: PASS.** `failures.length === 0` across the whole run — reproduced directly by
this pass, not cited. Nine non-gating `observations` remain, all already accounted for above (7
clean-layout crossing-density notes, 2 model-6 source-geometry notes).

### §19.3 named return scenarios

The plan names four scenarios to verify explicitly. All four map onto models whose control-flow
graph has exactly one cycle, closing through an XOR merge (`cfEdges`/`cycles`/`throughXorMerge`
measured directly against the real rendered product, source layout, control-flow edges only):

| §19.3 scenario            | Model                                                                      | Cycles | Through XOR merge |
| ------------------------- | -------------------------------------------------------------------------- | -----: | :---------------- |
| Animal registration       | Register an Animal's profile (or Request to Register Animal Owner Profile) |      1 | yes               |
| Animal Profile Closure    | Animal Profile Closure                                                     |      1 | yes               |
| Operator Registration     | Operator Registration and Renewal                                          |      1 | yes               |
| Renewal-related processes | Renew an Animal's profile                                                  |      1 | yes               |

This confirms the correction to record from the prior pass: **all four §19.3 scenarios have
explicit return routes, each closing on an XOR merge** — not "three of four lacked one," which was
the earlier, wrong claim. Independently re-verified in this pass, not merely re-cited.

### Current open findings

**Zero §19.5 gate failures**, as measured directly by this pass (`npm run test:aris:phase16`,
06:51 local time). This is worth stating plainly because the brief for this pass, written before
this run, expected "35 gate findings, now 5, another agent is actively working on those five" —
**that expectation did not hold up**: the actual measured count this pass is 0 failures / 9
observations, not 5. The nine observations are the clean-layout crossing-density notes and the
two model-6 source-geometry notes tabulated above; none of them are `failures` under the script's
own classification, and none block §19.5. If the "five findings" figure was accurate at some
earlier point in the session, the uncommitted layout/canvas work visible in this pass's `git
status` (new `fitView.ts`, `laneBands.test.ts`, `freeTextLayout.test.ts`, `annotations.ts`, and a
rewritten `jsdomSvg.ts` — see Phase 16 defects below) is the most likely explanation for why it has
since reached zero; none of that work is committed yet, so it is not yet part of the durable
record.

## Defects found by Phase 16

Phase 16 had never been run against the mounted product until this branch's integration waves
landed. Running it found real defects that every existing unit test had passed against. Six are
committed, at `5db0874`; a further cluster was found and appears fixed in the _live, uncommitted_
tree at the time of this pass but is not yet committed — both groups are recorded, clearly
separated, because only the first group is part of the durable git history right now.

### Committed at `5db0874`

1. **69 free-text occurrences were silently dropped.**
   Root cause: `<FFTextOcc>` carries no `id` attribute in real AML, so `sourceId` was `null` and
   `buildFromSource` skipped every one at its `!item.id` guard — while accounting still counted
   them as source records, so nothing could detect the loss.
   Fix: occurrence ids are now synthesized deterministically from the element path, which is
   already the accounting layer's primary key and unique by construction. Regression coverage:
   `buildFromSource.animalwf.test.ts` (new, 2 tests) — "carries all 69 source free-text occurrences
   into the working model" and "produces the exact same 69 free-text ids across two independent
   builds."

2. **`registerById` dropped records with no diagnostic**, the mechanism that let defect 1 go
   unnoticed for nine other record kinds. It returned early on a missing source id, silently.
   Fix: it now emits a missing-source-id warning and retains the record. The real export still
   yields 0 diagnostics and 0 superseded records — loud on malformed input, silent on valid input.

3. **The accounting rail printed "68043 of 68036 source records accounted for."**
   Root cause: `totalAccounted` counted derived rows (synthetic entries with no literal XML
   counterpart, e.g. linked-model assignment rows) together with raw source records, so the
   numerator could legitimately exceed the denominator.
   Fix: raw-source and derived counts are now reported and bounded separately (`derived` flag on
   `ArisAccountingEntry`, `totalAccounted` bounded ≤ `totalSourceRecords` by construction, extended
   again by `6230016` so the invariant "cannot be got wrong from outside"). Confirmed against real
   data this pass: 68,036 of 68,036, exactly.

4. **All 127 ARIS shell i18n keys were unregistered**, so the entire shell UI silently rendered
   English fallback text in both languages.
   (Note: the brief for this pass said 126; this pass's own count of
   `ARIS_SHELL_MESSAGE_KEYS` in `src/aris/shell/shellI18n.ts` is **127** — a minor correction,
   recorded because the brief said to check every number.)
   Root cause: `tk()` calls `t(key as Key, ...)` with `key` typed as a plain `string`, so an
   unregistered key never fails the TypeScript build, and the call site is `tk('...')`, not
   `t('...')`/`tPlural('...')` — the pattern the i18n coverage regex scans for. No test could catch
   this without knowing to look for `tk(` specifically.
   Fix: all keys registered in English and Modern Standard Arabic; `ARIS_SHELL_MESSAGE_KEYS` is now
   covered by `src/__tests__/i18n.test.ts`'s `registers every key in ARIS_SHELL_MESSAGE_KEYS` test.

5. **Derived export covered only geometry**, silently dropping renames, bilingual edits, and
   creations from any downloaded derived AML.
   Fix: derived export now covers the whole working-model diff (renames, bilingual values,
   creations with source-style id allocation, deletions with reference cascade, lanes and free
   text). Eight kinds remain explicitly unmapped, each with a stated reason (never silently
   dropped): `newModel`, `removedModel`, `defaultLocale`, `clearedAttribute`, `missingAnchor`,
   `movedConnectionSource`, `linkedModelsOnNewDefinition`, `unknownRecord`.

6. **Chat translated only 9 of 15 patch commands**; the other six threw and aborted the whole
   batch.
   Root cause: `createConnectionOccurrence`'s precondition demands `definitionId` resolve, but
   `transaction`'s precondition check validates every subcommand against the pre-transaction
   document — so wrapping `createConnectionDefinition` + `createConnectionOccurrence` in one
   `transaction` always failed for the three connection-creating patch kinds.
   Fix: those three now apply as an ORDERED PAIR of top-level commands (the pattern the canvas lane
   already used), documented in all three modules that had each independently assumed otherwise.
   All 15 `ArisChatCommandKind`s now have a real `case` in `arisChatHost.ts`'s dispatch — confirmed
   by direct source read this pass, not by citation.

### Observed fixed in the live, uncommitted tree — not yet committed

The following defects match the brief for this pass almost verbatim, but this pass's own
`git log` shows no commit containing them, and this pass's own `git status` shows the exact files
that would carry such a fix as **currently modified/new and uncommitted**
(`src/aris/canvas/testing/jsdomSvg.ts`, `fitView.ts`/`fitView.test.ts`, `laneBands.test.ts`,
`freeTextLayout.test.ts`, `src/aris/layout/annotations.ts`/`__tests__/annotations.test.ts`,
`cleanLayoutNotes.animalwf.test.ts`). This pass ran the live tree's tests and Phase 16 loop and
they do appear fixed right now — but "fixed in an uncommitted working tree that two agents are
actively editing" is not the same evidentiary weight as "fixed at a commit," and the distinction is
recorded here on purpose rather than folded into the committed list above.

7. **The jsdom SVG test stub returned a constant 1000×1000 from `getBBox()`.** This made every
   canvas geometry assertion — including "is this readable after Zoom Fit?" — vacuous, which is
   how a lane-band frame inflated to roughly 1200×50000 (every model rendering at ~2.3px median
   shape height) passed a fully green unit suite. The live `jsdomSvg.ts` now walks the rendered SVG
   tree and unions real per-element geometry (`rect`/`circle`/`ellipse`/`line`/`polyline`/`polygon`/
   `path`, transform-aware), with an explicit code comment calling out the old constant as the root
   enabler: "Returning a constant here — which this shim used to do — silently makes every
   `canvas.zoom('fit-viewport')` assertion vacuous, which is precisely how a product that fitted
   the viewport to a 50000-unit lane frame kept a green unit suite." This pass's own Phase 16 loop
   run against the live tree shows median rendered shape heights of 8.7–47px across the 8 models
   (readability table, "YES" for all 16 model/mode combinations) — consistent with the fix
   working, not with the ~2.3px symptom the defect described.
8. **Lane orientation case mismatch** and **9. external labels rendering 0×0** — named in the brief
   for this pass; this pass located the general area of uncommitted work (`laneBands.test.ts`,
   `freeTextLayout.test.ts`, `annotations.ts` are all new/modified, and this pass's Phase 16 lane
   band table shows all 8 models with plausible, non-degenerate band geometry) but did not isolate
   a specific before/after diff proving the orientation-case and external-label defects
   specifically, the way it could for the `getBBox` stub. Recorded as "consistent with fixed,
   not independently isolated," rather than claimed as verified.

## Blockers

Every item below names the actor required to close it.

1. **Phase 17 requires the user.** Live ARIS import/re-export and a golden AML + PDF/PNG reference
   pair are both absent. The derived export stays labelled "Experimental ARIS AML export" (plan
   §9.5) until this closes.

2. **No real Arabic business-process content for object/function/event names — re-verified
   directly against the raw XML in this pass, independent of both prior rounds of analysis in this
   project's history (actor: user, for richer content).**

   Independently re-derived in this pass with a structural XML walk (stack-matched `<AttrValue>`
   spans, not regex proximity), not merely re-cited from the prior checklist:

   - **896** Arabic-range XML numeric character references exist in the file, decoding to **60**
     `PlainText TextValue` attributes carrying **9 distinct strings**. This part of the brief for
     this pass was accurate.
   - **The brief for this pass also said "Arabic-locale `AttrValue` blocks contain no Arabic." This
     pass's own re-derivation shows that claim is wrong: 25 of the 60 real-Arabic `PlainText`
     instances (5 of the 9 distinct strings) sit inside `LocaleId="&LocaleId.AEar;"`-tagged
     `AttrValue` blocks.** The other 35 (the remaining 4 distinct strings, plus part of the overlap
     on three shared strings) sit inside `LocaleId="&LocaleId.USen;"` blocks — so more than half of
     the file's genuine Arabic content is filed under the nominally-English locale tag, and roughly
     two-fifths sits under the correctly-labelled Arabic tag. This matches what the _previous_
     checklist pass had already carefully reconciled (25/246 AEar blocks, 5 distinct strings) — so
     the correction here is against the brief for _this_ pass, not against the standing project
     record, which had it right.
   - **249 of 279 object definitions have no `AttrValue` at all under their `AT_NAME` `AttrDef` for
     the Arabic locale** — independently re-derived this pass via a full `xml.etree.ElementTree`
     walk of the real export (not a regex proximity match): of 279 `ObjDef` elements, all 279 have
     an `AT_NAME` `AttrDef`, but 249 have no `LocaleId="&LocaleId.AEar;"` `AttrValue` child under
     it at all. Of the remaining 30 that do have an Arabic-locale slot, only 2 contain genuine
     Arabic script; the other 28 are empty or hold mislabeled English text (the same labeling
     artifact described above, at the object-name level rather than the free-text level). This
     matches plan §19.1's baseline number (249) exactly, under the "no slot at all" definition.

   **Practical consequence, unchanged from the prior pass:** the file's 60 real Arabic instances are
   available today for RTL/bidi/text-measurement testing once a renderer is wired in (Phase 9 is
   now wired — see above). They remain unavailable for testing bilingual `AT_NAME` handling on
   business objects specifically; closing plan §21.3's professional Modern Standard Arabic gate for
   object/function/event _names_ still needs the user to supply an export with populated Arabic
   name slots.

3. **`missing-template` fires for all 8 AnimalWF models (actor: user or template author).**
   Unchanged from the prior pass; plan §20.2 treats missing templates as explicit blockers.

4. **Package identity/version drift from plan §1 (actor: whoever owns Phase 0/repo metadata).**
   Unchanged from the prior pass: `package.json` still declares `orbitpm-process-studio-lite` at
   `0.4.5` with a BPMN description, not `OrbitPM ARIS Studio Lite` at `0.1.0-alpha.1`.

5. **Firefox/WebKit legs of the full browser matrix and §21.4 performance gates (actor: whoever
   runs the manual release-candidate suite).** Not attempted this pass; §21.3/§21.4 remain open for
   the release-candidate gate, separate from the day-to-day phase work above.

6. **The lane-band/orientation/external-label/`getBBox` defect cluster is real, uncommitted work in
   progress (actor: the agent currently editing `src/aris/canvas/**` and `src/aris/layout/**` in
   this same worktree).** Appears fixed in the live tree per this pass's own test runs, but is not
   yet part of the committed record. Re-run `npm run test:aris:phase16` after the next commit to
   confirm it holds once committed.

## Verification run for this document

```text
$ npx prettier --check docs/
```

`docs/` is covered by prettier (`.prettierrc` exists, `format:check` runs `prettier --check .`
with no docs exclusion). This rewrite of `ARIS_PHASE_CHECKLIST.md` and the accompanying update to
`ARIS_PHASE4_TO_15_MODULES.md` are formatted to pass; pre-existing formatting issues in other
`docs/` files are unchanged and out of scope for this pass.
