# ARIS Phase 4–15 module inventory

Snapshot: `feat/aris-only-studio` at commit `5db087426c4632e296e3c56407a6bc30a21c6656` (short
`5db0874`), captured 2026-07-29. Companion to
[ARIS_PHASE_CHECKLIST.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE_CHECKLIST.md),
which has the phase-status table, the status vocabulary, and the full integration-status writeup.

**This has changed completely since the last pass.** Every module below is now reachable from
`src/main.tsx` via `src/ArisApp.tsx` — `npm run check:aris-runtime-boundary` reported 231
production modules in this pass (235 five minutes later, against the live tree; both numbers are
far above the stale 69 the previous version of this document described, and the checklist's
Integration status section has the full breakdown). "Satisfies" / "Does not satisfy" below is
judged against the exact plan section cited, specifically whether an end-to-end scenario through
the mounted shell (`src/ArisApp.test.tsx`) demonstrates it, not merely whether the module's own
unit tests pass — that distinction is the entire point of this rewrite. Test counts are from
`npx vitest run --maxWorkers=4 --retry=0 src/aris/<dir>` (default project) plus, where relevant,
the opt-in `npm run test:aris:animalwf` project (gated on the private AnimalWF fixture, excluded
from the default project since commit `d5f085c`). Both were run fresh in this pass.

## §source — `src/aris/source/` (Phase 3, plan §6)

**Tests:** 2 files, 56 tests, unchanged from the last pass.

**Satisfies (§6.7):** parses losslessly, fails safely on malicious fixtures, reconciles
independent raw-tag counts against indexed records — all previously established and unaffected by
this pass's changes. Reached from `ArisApp.tsx` since before either integration wave.

## §packages — `src/aris/packages/` (Phase 4, plan §7)

**Tests:** 11 files, 101 tests (up from 97 — `accounting.test.ts` grew when commit `6230016` gave
`ArisAccountingEntry` an explicit `derived` flag and required the census bound to apply only to
raw-source entries).

**Now reachable, and live-demonstrated for two of §7.6's four bullets:**
`src/ArisApp.test.tsx`'s `shows the §7.3 review before committing an import and writes nothing when
it is cancelled` demonstrates atomic commit-or-nothing; `commits a portable single-file import
without overwriting the opened source` demonstrates original-bytes preservation through a real
import gesture (the portable container is written to a sibling file, never over the opened AML).

**Does not (yet) satisfy live:** "identical source imports deduplicate" and "generated models
retain provenance" are covered only by `generated.test.ts` and `transaction.test.ts` at the module
level; no shell-level scenario for either was found in this pass. Backup/restore specifically was
not exercised by any `ArisApp.test.tsx` test found this pass.

## §model — `src/aris/model/` (Phase 5, plan §8)

**Tests:** 4 files, 31 tests (default project) + 2 more in the opt-in
`buildFromSource.animalwf.test.ts` (added by the Phase 16 free-text defect fix — "carries all 69
source free-text occurrences into the working model" / "produces the exact same 69 free-text ids
across two independent builds").

**Satisfies (§8), now live:** working-model construction from real AML is exercised by every
AML-opening `ArisApp.test.tsx` test; "commands persist and restore" by `round-trips undo and redo
through the ARIS command stack from the toolbar`; "undo/redo never changes original bytes" by the
derived-export byte-identical test (§writer, below) plus the architectural guarantee that original
bytes never enter the command system (`packages/__tests__/exitGate.test.ts`).

**Does not (yet) satisfy live:** the specific "one definition, multiple occurrences" distinction is
proven at the unit level (`buildFromSource.test.ts`, `commands.test.ts`,
`canvas/canonicalGeometry.test.ts`) but no shell-level scenario in this pass specifically exercises
two occurrences of one definition.

## §writer — `src/aris/writer/` (Phase 6, plan §9)

**Tests:** 9 files, 162 tests (default project) + 3 more in the opt-in
`animalWfRoundTrip.animalwf.test.ts`.

**Satisfies (§9), now live, not just computational:**

```text
src/ArisApp.test.tsx
✓ exports a derived AML that is byte-identical to the untouched original, then carries the clean layout
✓ refuses the derived export when a section 9.3 check fails, and downloads nothing
```

Plus the real 4,376,152-byte AnimalWF round trip (opt-in, run fresh this pass): a no-op edit set
reproduces the export byte-for-byte; renaming one `ObjDef` id changes only that id's spans; every
export passes §9.3 validation after the rename.

**Scope widened since the last pass (commit `5db0874`):** derived export now covers the whole
working-model diff (renames, bilingual values, creations with source-style id allocation,
deletions with reference cascade, lanes and free text), not only geometry. Eight kinds remain
explicitly unmapped, each with a stated reason, confirmed by direct source read
(`src/aris/shell/arisDerivedExport.ts`): `newModel`, `removedModel`, `defaultLocale`,
`clearedAttribute`, `missingAnchor`, `movedConnectionSource`, `linkedModelsOnNewDefinition`,
`unknownRecord`.

**Does not satisfy:** §9.5's "Experimental ARIS AML export" label requirement is independent of
§9.6 and stays until Phase 17 (live ARIS round-trip, blocked on the user).

## §accounting — `src/aris/accounting/` (Phase 7, plan §10)

**Tests:** 1 file, 10 tests (up from 9).

**Satisfies (§10), now live:** the "68043 of 68036" defect (Phase 16 finding, see the checklist's
defects section) is fixed — this pass's own `test:aris:phase16` run against real data reads
`68036 accounted / 68036 source records, 0 unaccounted, 0 issues`, exactly equal. The import-review
dialog in `ArisApp.test.tsx` asserts `0 unaccounted` for a real import. §10.4's exit gate is met
both computationally and live.

**Does not satisfy:** §10.3's "selecting a report item opens/selects the corresponding model
element" is demonstrated indirectly by `selects the canvas element behind an accounting row and
highlights its relations` in `ArisApp.test.tsx` — this pass counts that as satisfied, unlike the
prior pass which had no accounting UI to test at all.

## §canvas — `src/aris/canvas/` (Phase 8, plan §11)

**Tests:** 12 files, 126 tests (default project) — `authoring` (15), `boot` (6),
`canonicalGeometry` (7), `commandBridge` (9), `copyPaste` (7), `epcEndToEnd` (3), `fitView` (18,
new), `freeTextLayout` (5, new), `highlight` (13), `laneBands` (20, new), `localization` (5),
`objectTypes` (18).

**Satisfies (§11), now live for part of it:** `round-trips undo and redo through the ARIS command
stack from the toolbar`, `restores the imported geometry with Reset to Source Layout`, and
`selects the canvas element behind an accounting row and highlights its relations` demonstrate
move/undo/redo/selection-highlight against the real mounted canvas on real AnimalWF data —
something the prior pass could not test at all, because nothing was mounted.

**Does not satisfy:** §11.6's literal exit-gate wording, "a user can author a complete EPC
manually," is proven only at the `epcEndToEnd.test.ts` module level (a scripted API sequence, not
click-driven); no `ArisApp.test.tsx` test builds a model from an empty canvas through simulated
user interaction. Three new test files (`fitView`, `freeTextLayout`, `laneBands`) plus a rewritten
`src/aris/canvas/testing/jsdomSvg.ts` are present in the live, **uncommitted** tree at the time of
this pass — see the checklist's Phase 16 defects section for what they appear to fix and why that
is recorded separately from the committed defect list.

## §renderer — `src/aris/renderer/` (Phase 9, plan §12) and §symbols (plan §12.2)

**Tests:** renderer 8 files / 56 tests, symbols 1 file / 10 tests — both unchanged from the last
pass.

**Satisfies (§12), now live for two of three bullets:** `renders an opened AML export on the real
ARIS canvas at its imported coordinates` (source geometry visible) and `restores the imported
geometry with Reset to Source Layout` (Source/Clean independently restorable) are demonstrated
against real data through the mounted shell.

**Does not satisfy:** "unknown visuals are explicit" is proven at the module level
(`missing-template` fires for exactly all 8 AnimalWF models, `animalWfRealData.test.ts`) but this
pass found no shell-level assertion that the fidelity/missing-template finding actually surfaces
somewhere a user would see it.

## §details — `src/aris/details/` (Phase 10, plan §13)

**Tests:** 4 files, 28 tests (default project) — `attachments` (9), `clusters` (5), `metadata` (5),
`tabs` (9) — plus 5 more in two opt-in AnimalWF tests: `animalWf.animalwf.test.ts` (4 tests) and
`localeBilingual.animalwf.test.ts` (1 test, "surfaces both the English and Arabic name of the one
bilingual object"). The real-data test that used to live in the default project moved to the
`*.animalwf.test.ts` convention as part of commit `d5f085c`'s `check:no-skips` fix.

**Satisfies (§13), now live in part:** the details rail mounts and responds to selection —
`selects the canvas element behind an accounting row and highlights its relations` in
`ArisApp.test.tsx`.

**Does not satisfy:** §13.5's "all AnimalWF metadata remains available," "rich display does not
distort the control-flow backbone," and "attachments survive backup/export" are not independently
confirmed by a shell-level test walking every metadata tab and attachment; this pass did not find
one.

## §epc — `src/aris/epc/` (Phase 11, plan §14.1–§14.3) and §layout (plan §14.4)

**Tests:** epc 5 files / 44 tests (unchanged); layout 6 files / 139 tests (default project) + 59
more in the opt-in `animalWf.animalwf.test.ts` + a new `annotations.test.ts` (11 tests, default
project — free-text/note placement in clean layout). The real-data layout test moved to the
`*.animalwf.test.ts` convention along with details, same commit.

**Satisfies (§14), now demonstrated against the _rendered product_, not just the algorithm — the
key change since the last pass.** This pass's own execution of `npm run test:aris:phase16` (a
headless-Chromium run against the built artifact, not a unit test) confirms every one of the 8 real
AnimalWF models' **clean** layouts has `shapeOverlaps: 0`, `labelSatelliteOverlaps: 0`,
`edgeShapeCrossings: 0`, `detachedEndpoints: 0`, `missingEdges: 0`, `duplicateEdges: 0`,
`zeroLengthEdges: 0`, and is `accepted: true` — this is §14.5's "clean layouts pass
collision/topology metrics" and §19.4's geometric criteria, both met against what a user would
actually see, which last pass's jsdom `getBBox()` stub (a constant 1000×1000) made impossible to
tell apart from a vacuous pass (see the checklist's Phase 16 defects section). §14.3's return-path
detection is independently reconciled against all four of plan §19.3's named scenarios: every one
maps to a model whose control-flow graph has exactly one cycle, closing through an XOR merge
(confirmed by this pass's own measurement, not cited). Live in the shell: `lists EPC validation
findings and selects the offending model, switching models when needed`.

**Does not satisfy:** §14.5's "missing return routes are safely confirmable" bullet has no test
this pass found, because AnimalWF's four named scenarios all already have explicit routes — there
is no missing-route case in this fixture to exercise the confirmation UI against. §19.4 still does
not gate edge/edge crossings; full-graph clean-layout crossing counts (319, 428, 142, 467, 480, 5,
136, 305 across the 8 models, measured fresh this pass) remain a real, undocumented-as-a-gate
visual-density characteristic of the dense satellite metadata, unchanged in substance from the
prior pass.

## §excel — `src/aris/excel/` (Phase 12, plan §15)

**Tests:** 6 files, 81 tests, unchanged.

**Satisfies (§15), now live for the whole gate:**

```text
✓ downloads the deterministic ARIS Excel templates from the single HTML
✓ creates native AML from a filled-in ARIS workbook with no AI at all
✓ rejects the retired BPMN 0.4.5 workbook with migration guidance instead of treating it as ARIS
```

§15.6's exit gate — blank/example templates round-trip, Excel creates native editable AML without
AI, legacy-template rejection — is fully demonstrated through the mounted shell.

## §ai — `src/aris/ai/` (Phase 13, plan §16)

**Tests:** 7 files, 72 tests, unchanged.

**Satisfies (§16), live for the description path:**

```text
✓ turns a valid ArisAiDraftV1 into canonical AML, never asking the model for AML
✓ surfaces the validator's rejections verbatim and creates nothing
```

**Does not (yet) satisfy:** the DOCX/PDF/image attachment paths of §16.8 are under active,
**uncommitted** construction elsewhere in this same worktree — three new files appeared partway
through this pass (`src/aris/shell/arisAiAttachments.ts`, `arisAiGeneration.ts`,
`arisAiPlacement.ts`), none of which exist at commit `5db0874`. No test exercising an attachment
through the shell was found or run this pass.

## §assistant — `src/aris/assistant/` (Phase 14, plan §17)

**Tests:** 11 files, 98 tests (up from 93 — a new `arisVocabulary.test.ts`, 5 tests).

**Satisfies (§17), now live for two of three bullets at once:** `answers a folder question with no
provider and no key, and its chip selects the model` demonstrates "folder questions work without a
key" and "source chips open/select correct ARIS elements" in one test, against real data.

**Does not satisfy:** "AI answers remain grounded and privacy-reviewed" is covered only by
`questionRouter.test.ts` (26 tests) / `retrieval.test.ts` (21 tests) at the module level; no
shell-level AI-grounded assistant scenario was found this pass.

## §chat — `src/aris/chat/` (Phase 15, plan §18)

**Tests:** 8 files, 140 tests (up from 135 — a new `locale.test.ts`, 5 tests, added by commit
`8eba852`'s locale-classification fix, which affected the gap scanner's missing-Arabic-name
detection among five other call sites).

**Satisfies (§18), now live for two bullets:** `completes a missing field through the chat
interview, atomically and undoably` demonstrates "safe field completion auto-applies atomically"
and "Undo restores prior revision" directly. Chat now translates all 15 patch commands (up from
9/15 at wave 2, fixed by commit `5db0874`): confirmed by reading `src/aris/shell/arisChatHost.ts`'s
dispatch directly in this pass — 15 distinct `case` labels
(`setLocalizedName`/`setAttribute`/`addAttributeValue`/`setAssignment`/`setRoute`/`reconnect`/
`deleteConnection`/`deleteOccurrence`/`deleteDefinition`/`addMetadataDefinition`/
`addMetadataOccurrence`/`addMetadataConnection`/`addCoreConnection`/`addCoreObject`/
`removeAttachment`), no `default: throw`.

**Does not satisfy:** "topology/destructive changes remain confirmation-gated" and "invalid AI
patches make no changes" are covered by `classification.test.ts` (40 tests, the largest single
test file in the whole `src/aris` suite) and `applyEngine.test.ts` (20 tests) at the module level;
no shell-level test forcing a topology change through the confirmation dialog was found this pass.

## Per-module test counts (`src/aris/**`, default project, `npx vitest run --maxWorkers=4 --retry=0 src/aris`, run fresh this pass)

| Module     |  Files |     Tests | Opt-in (`test:aris:animalwf`)                 |
| ---------- | -----: | --------: | --------------------------------------------- |
| source     |      2 |        56 | —                                             |
| packages   |     11 |       101 | —                                             |
| model      |      4 |        31 | +2 (`buildFromSource`)                        |
| writer     |      9 |       162 | +3 (`animalWfRoundTrip`)                      |
| accounting |      1 |        10 | —                                             |
| symbols    |      1 |        10 | —                                             |
| excel      |      6 |        81 | —                                             |
| ai         |      7 |        72 | —                                             |
| epc        |      5 |        44 | —                                             |
| layout     |      6 |       139 | +59 (`animalWf`) + `annotations` new above    |
| assistant  |     11 |        98 | —                                             |
| details    |      4 |        28 | +5 (`animalWf` + `localeBilingual`)           |
| renderer   |      8 |        56 | —                                             |
| canvas     |     12 |       126 | —                                             |
| chat       |      8 |       140 | —                                             |
| shell      |      4 |        45 | +6 (`arisDerivedExport` + `cleanLayoutNotes`) |
| **Total**  | **99** | **1,199** | **+75**                                       |

`shell` is the wave 1/2 composition layer (`src/aris/shell/**`), not a named plan phase; it did not
exist as a separately-tested unit in the prior pass's inventory because none of the shell existed
yet. Plus `src/ArisApp.test.tsx` (24 tests) and `src/__tests__/i18n.test.ts` (34 tests, shared with
the rest of the product, not ARIS-only) at the shell integration seam. Grand total, all of the
above combined: 101 files / 1,257 tests in the default project (confirmed by a direct combined run
of `npx vitest run --maxWorkers=4 --retry=0 src/ArisApp.test.tsx src/aris
src/__tests__/i18n.test.ts` in this pass — **101 files / 1,257 tests, 0 failures** on the clean
run cited in the checklist) + 75 more in the opt-in AnimalWF-gated project, for **~1,332 tests**
total across ARIS-specific and shell-integration code.

A volatility note carries over from the checklist: two back-to-back re-runs of the same combined
command later in this pass each showed one different, unrelated single-test failure, in files
under active uncommitted edit by a second agent (AI-creation and accounting-rail work). Neither
recurred on immediate re-run and neither is attributed to any change described in this document;
the 101/101, 1,257/1,257 clean run is the one cited as evidence throughout.
