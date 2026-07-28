# ARIS transformation phase checklist

Authoritative source: [aris_transformation.md](/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md)

Snapshot: `feat/aris-only-studio` at commit `cf13c47217e0b4872b01eeb9fe25b29707cc7a3d` (short
`cf13c47`), captured 2026-07-29. **This worktree has other agents actively landing work in it.**
Two commits (`2a94175`, `cf13c47`) landed and an uncommitted `src/aris/shell/` directory appeared
_while this document was being written_; every number below was re-verified against `cf13c47`
after that happened. Treat this file as a snapshot, not a live status board — re-run the commands
in the evidence sections to see whether the picture has since moved.

## Status vocabulary

This document replaces the previous binary Complete/In progress/Pending scheme, which let Phases
2 and 3 be marked "Complete" while `typecheck` and `lint` were both red at HEAD. Every phase below
gets exactly one of:

| Status                             | Meaning                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exit gate met**                  | The plan's own exit-gate bullets for this phase are demonstrated, end to end, including any user-visible behavior the gate requires.                                                                                                                                                      |
| **Module complete, unit-verified** | The subsystem's own unit/integration tests pass and its logic is real, but the plan's exit gate is not fully met — usually because the module is not reachable from the shipped product (see Integration status below), or because the gate asks for something the module doesn't yet do. |
| **Blocked on integration**         | The module-level work is done and unit-verified, but the specific reason it can't close is that it is not wired into `src/main.tsx` → `src/ArisApp.tsx`.                                                                                                                                  |
| **Blocked on user**                | The gate cannot close without an artifact, decision, or live system access only the user can supply (a real Arabic-content export, a live ARIS installation, a golden PDF/PNG pair).                                                                                                      |
| **Not started**                    | No code exists for this phase.                                                                                                                                                                                                                                                            |

A phase can carry more than one status for different parts of its gate; where that happens the
table cell lists the dominant blocking status and the phase's evidence subsection spells out the
split.

## Integration status — read this first

**Twelve of the fifteen implemented `src/aris/**` subsystems are not reachable from the shipped
product.** `src/main.tsx` imports only `ArisApp.tsx`, and `check:aris-runtime-boundary` (a static
import-graph walk from that entry point, `scripts/check-aris-runtime-boundary.mjs`) reports:

```text
$ npm run check:aris-runtime-boundary
ARIS runtime boundary check passed: 69 production modules reachable from src/main.tsx.
```

69 modules, unchanged before and after the two newest commits on this branch. `ArisApp.tsx`
imports exactly one thing from `src/aris/**`: `createArisXmlSourcePackage` from
`src/aris/source/sourcePackage.ts` (which in turn pulls in `xmlTokenizer.ts` and
`semanticIndex.ts`). That import chain is real and live — see the Phase 3 row below, the one
phase whose subsystem is actually mounted. Nothing else is imported: not `src/aris/packages`,
`src/aris/model`, `src/aris/writer`, `src/aris/accounting`, `src/aris/symbols`, `src/aris/excel`,
`src/aris/ai`, `src/aris/epc`, `src/aris/layout`, `src/aris/assistant`, `src/aris/details`,
`src/aris/renderer`, `src/aris/canvas`, or `src/aris/chat`.

Consequently the shipped artifact, `release/OrbitPM-ARIS-Studio-Lite.html`
(711,237 bytes, sha256 `04f71213ca5d2ba40eca232231ae0b8d9a84bd16afdff8ba55003f401db8edb3`, built
before commits `2a94175`/`cf13c47` — see Freshness note below), does not contain a working canvas,
cannot edit a model, cannot export, cannot run Excel/AI/chat/assistant flows, and cannot show
accounting or fidelity reports. It can open an AML/XML file, tokenize and index it off the UI
thread, and display source counts (root element, token/node counts, model/object/connection
counts, diagnostic count) in the details rail. That is the entire user-visible ARIS surface today.

**Every phase whose plan exit gate (§11–§21) describes something a user does — author an EPC,
see metadata in a details panel, get a chat answer, download a derived AML — is not met**,
regardless of how complete or well-tested the underlying module is. The Module-complete numbers
below (writer 164 tests, layout 188 tests, etc.) describe real, passing, meaningfully-scoped unit
suites — they do not describe a working product feature.

**Freshness note on the artifact:** `release/OrbitPM-ARIS-Studio-Lite.html` has mtime
2026-07-29T02:32 UTC+4, which predates commits `2a94175` (02:55) and `cf13c47` (02:57). Its
sha256 is the one recorded in the task brief and reconfirmed by this document, but it does not
reflect the two newest commits on the branch (a canvas addition still unreachable from
`main.tsx`, and i18n dictionary key registration). Per the plan's own rule ("Every product-code
push must include the current canonical HTML"), a rebuild is owed before the next commit that
touches `src/**`; this document does not perform that rebuild (out of scope — no `npm run
build:aris`).

## Phase status

| Phase                                                       | Status                                                                                                                                  | Evidence                                                                                                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Establish branch and immutable baselines                 | Exit gate met (administrative)                                                                                                          | [ARIS_PHASE0_BASELINE_2026-07-28.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE0_BASELINE_2026-07-28.md)                                                        |
| 1. Freeze retained infrastructure before removing BPMN      | Module complete, unit-verified — see caveat                                                                                             | [ARIS_PHASE1_CHARACTERIZATION.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE1_CHARACTERIZATION.md), `npm run test:aris:phase1` (currently **fails**, see below) |
| 2. Replace product shell and remove BPMN runtime            | Exit gate met                                                                                                                           | `npm run check:aris-runtime-boundary`, `npx vitest run src/ArisApp.test.tsx`, `npm run test:aris:file-smoke`                                                               |
| 3. Secure lossless AML input layer                          | Exit gate met (parsing/security); Blocked on integration (editing)                                                                      | [ARIS_PHASE3_INPUT_LAYER.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE3_INPUT_LAYER.md)                                                                        |
| 4. Immutable source packages and workspace revisions        | Blocked on integration                                                                                                                  | [ARIS_PHASE4_TO_15_MODULES.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE4_TO_15_MODULES.md) §packages                                                          |
| 5. Native ARIS working model and command system             | Blocked on integration                                                                                                                  | same doc §model                                                                                                                                                            |
| 6. Build AML writer and derived export                      | Blocked on integration (export §9.6 is computational and passes; §9.5 experimental label needs Phase 17)                                | same doc §writer                                                                                                                                                           |
| 7. Implement complete source accounting                     | Blocked on integration (§10.4 reconciliation is computational and passes)                                                               | same doc §accounting                                                                                                                                                       |
| 8. Build the ARIS canvas and full supported authoring       | Blocked on integration                                                                                                                  | same doc §canvas                                                                                                                                                           |
| 9. Source-faithful visual renderer                          | Blocked on integration                                                                                                                  | same doc §renderer, §symbols                                                                                                                                               |
| 10. Rich metadata, details panel, and attachments           | Blocked on integration                                                                                                                  | same doc §details                                                                                                                                                          |
| 11. EPC semantics, XOR, return paths, and clean layout      | Blocked on integration                                                                                                                  | same doc §epc, §layout                                                                                                                                                     |
| 12. Create from a new ARIS-native Excel template            | Blocked on integration                                                                                                                  | same doc §excel                                                                                                                                                            |
| 13. Create with AI from description, DOCX, PDF, and picture | Blocked on integration                                                                                                                  | same doc §ai                                                                                                                                                               |
| 14. Folder-aware ARIS process assistant                     | Blocked on integration                                                                                                                  | same doc §assistant                                                                                                                                                        |
| 15. Chat improvement and missing-information completion     | Blocked on integration                                                                                                                  | same doc §chat                                                                                                                                                             |
| 16. AnimalWF full-data and natural-layout loop              | Module complete, unit-verified (computational parts only; layout §19.4 crossing criteria pass, §19.4 does not gate edge/edge crossings) | see Phase 16 evidence below                                                                                                                                                |
| 17. Visual golden pair and ARIS import/re-export            | Blocked on user                                                                                                                         | no golden AML/PDF/PNG pair supplied; no live ARIS access                                                                                                                   |
| 18. Release-quality tests, performance, and publication     | Not started (as a phase; ad hoc typecheck/lint/unit evidence exists)                                                                    | see Phase 18 evidence below                                                                                                                                                |
| Stable definition of done                                   | Not met                                                                                                                                 | integration and Phase 17 blockers below                                                                                                                                    |

## Per-phase evidence

### Phase 0 — Establish branch and immutable baselines

Exit gate met at the administrative level: branch exists, baseline doc exists, plan committed.
Not re-audited in this pass (out of scope — no git operations permitted). One drift worth
flagging: plan §1 specifies package version `0.1.0-alpha.1` and product identity `OrbitPM ARIS
Studio Lite`; `package.json` at `cf13c47` still reads `"name": "orbitpm-process-studio-lite"`,
`"version": "0.4.5"`, `"description": "OrbitPM Process Studio Lite — a self-contained, bilingual
BPMN 2.0 editor that runs in the browser."` This is a real, checkable gap against §1, not fixed by
any commit on this branch so far.

### Phase 1 — Freeze retained infrastructure before removing BPMN

The retained-infrastructure vitest characterization set passes in full:

```text
$ npx vitest run --maxWorkers=4 --retry=0 \
    src/assist/__tests__/answerLocal.test.ts src/ai/__tests__/requestPrivacy.test.ts \
    src/assist/__tests__/requestReview.test.ts src/assist/__tests__/AssistantDrawer.interviewCancellation.test.tsx \
    src/ai/__tests__/providerSelection.test.ts src/ai/__tests__/keys.test.ts src/ai/__tests__/keys.crossTab.test.ts \
    src/ai/__tests__/docx.test.ts src/ai/__tests__/pdf.test.ts src/spreadsheet/xlsxPreflight.test.ts \
    src/workspace/adapters/__tests__/directory.test.ts src/workspace/adapters/__tests__/portableModes.test.ts
Test Files  12 passed (12)
     Tests  138 passed (138)
```

**But the composite gate command the previous checklist cited, `npm run test:aris:phase1`,
currently fails (exit code 1).** It runs five steps in sequence: build, the vitest set above
(passes), then `npx playwright test tests/e2e/lite-i18n-rtl.spec.ts --project=chromium`. All 12
tests in that spec fail — every one of them drives a `getByRole('button', { name: /New process/i
})` click that opens a BPMN diagram (`.djs-container svg`, `bpmn-js` canvas, `TextAnnotation`
elements). That UI does not exist in the ARIS-only shell Phase 2 shipped; the spec was written for
the pre-transformation product and was never updated. Because the script aborts on first failure,
the remaining two steps (`lite-providers.spec.ts` characterization, `file://` smoke) never run.
Confirmed by direct execution:

```text
$ npm run test:aris:phase1
=== build single-file artifact ===          ✓ 377 modules transformed, built in 2.26s
=== vitest retained-infrastructure characterization set ===   ✓ 12 files, 138 tests
=== chromium English/Arabic dialog characterization ===
  12 failed  [chromium] › tests/e2e/lite-i18n-rtl.spec.ts  (all 12 tests)
Error: chromium English/Arabic dialog characterization failed with exit code 1
```

This is a genuine, currently-open gap: `tests/e2e/lite-i18n-rtl.spec.ts` needs to be rewritten
against the ARIS shell (or replaced) before Phase 1's own designated verification command can be
trusted again. It is not a security or behavior regression in the retained AI/workspace
infrastructure itself — that part (the vitest set) is green — but the checklist previously cited
`test:aris:phase1` as unqualified evidence for "Complete," and that citation was wrong at HEAD.
Status here is downgraded to **Module complete, unit-verified** with this caveat rather than
**Exit gate met**, because the plan's own gate text ("English/Arabic dialog behavior" pinned by
characterization) is not currently demonstrated by an actually-passing command.

Twenty-one other `tests/e2e/*.spec.ts` files (out of the pre-existing BPMN-era suite) also
reference `djs-container` or `New process` and are similarly stale relative to the ARIS shell;
`lite-i18n-rtl.spec.ts` is simply the one wired into `test:aris:phase1`.

### Phase 2 — Replace the product shell and remove BPMN runtime

Exit gate met, verified directly (not through the stale composite script — see caveat below):

```text
$ npm run check:aris-runtime-boundary
ARIS runtime boundary check passed: 69 production modules reachable from src/main.tsx.

$ npx vitest run --maxWorkers=2 --retry=0 src/ArisApp.test.tsx
✓ src/ArisApp.test.tsx (6 tests)   including "rejects BPMN files at the top-level ARIS shell boundary"

$ npm run test:aris:file-smoke
ARIS exact file:// smoke passed for release/OrbitPM-ARIS-Studio-Lite.html
  using reference AML .../reference/AnimalWF/ARISAMLExport.xml (711237 bytes).
```

`scripts/check-aris-runtime-boundary.mjs` bans `src/App.tsx`, `src/editor/**`,
`src/org/orbitpmModdle.ts`, `src/validation/ReadOnlyDiagramPreview.tsx`, and the BPMN package set
(`bpmn-js`, `bpmn-moddle`, `bpmnlint`, etc.) from the reachable graph and from
`package.json`'s `dependencies`; both checks currently pass.

**Caveat, parallel to Phase 1's:** the composite script `npm run test:aris:phase2` (which the
previous checklist did not cite, but which exists and looks like the obvious Phase 2 gate command)
currently fails: `vitest run src/ArisApp.test.tsx src/App.integration.test.tsx` reports 12 of 144
tests failing, all in `src/App.integration.test.tsx` under the `App directory workspace
orchestration` describe block (editor-dirty-signal/XML-debounce/save-shortcut races). That file
tests the legacy 8,028-line `src/App.tsx` monolith directly — the same file the boundary script
explicitly bans from the production graph — so these failures are dead-code test debt, not a
defect in the shipped ARIS shell. `ArisApp.test.tsx` itself is the one file in that run that
passes (6/6). Recorded here so nobody runs `test:aris:phase2`, sees red, and either wrongly
downgrades Phase 2 or wrongly assumes it's a false alarm without knowing why.

### Phase 3 — Build a secure lossless AML input layer

**This is the one phase whose subsystem is actually wired into the shipped shell.**
`src/ArisApp.tsx:33` imports `createArisXmlSourcePackage` from `src/aris/source/sourcePackage.ts`,
which calls `buildSemanticArisDocument` (the semantic index) and is invoked at `ArisApp.tsx:527`
on file open; the resulting model/object/connection/attribute/diagnostic counts are rendered in
the details rail (`ArisApp.tsx:552–585`). See `docs/ARIS_PHASE3_INPUT_LAYER.md` for the full
writeup and the security-fix detail. Status: **Exit gate met** for §6.7's parsing/security
criteria (below); **Blocked on integration** for anything past parsing, since Phase 3 only covers
input, not editing.

```text
$ npx vitest run --maxWorkers=2 --retry=0 src/aris/source
✓ src/aris/source/xmlTokenizer.test.ts    (36 tests, includes a ~4 MiB synthetic AnimalWF-size case)
✓ src/aris/source/semanticIndex.test.ts   (19 tests, includes real AnimalWF reconciliation)
Test Files  2 passed | Tests 55 passed
```

Against the real 4,376,152-byte AnimalWF export (`buildSemanticArisDocument`): 8 models, 279
object definitions, 494 object occurrences, 465/465 connection definitions/occurrences, 516
attributes, 774 attribute occurrences, 16 lanes, 69 free-text records, 14 attachments/OLE
records, 28 blobs, 6 font style sheets, 1,339 route points, **0 diagnostics**, **174 unknown
records** (13 `GfxObj` + 13 `RoundedRectangle` + 126 `SizeElement` + 19 `Container` + 3 `Union`),
0 unknown attributes.

### Phase 4 — Immutable source packages and workspace revisions

`src/aris/packages/**`: 11 files, 97 tests, all passing. Status: **Blocked on integration** — not
imported by `ArisApp.tsx`. Details in `docs/ARIS_PHASE4_TO_15_MODULES.md`.

### Phase 5 — Native ARIS working model and command system

`src/aris/model/**`: 4 files, 30 tests, all passing. **Blocked on integration.**

### Phase 6 — AML writer and derived export

`src/aris/writer/**`: 10 files, 164 tests, all passing, including a real-data round trip guarded
by fixture presence:

```text
$ npx vitest run src/aris/writer/animalWfRoundTrip.test.ts
✓ reproduces the original byte-for-byte under a no-op edit set
✓ changes only the renamed id spans and leaves every other byte identical
✓ passes every export validation after the rename
```

Observed on the real 4,376,152-byte export: a no-op edit set reproduces all 4,376,152 bytes
exactly (`exported.changed === false`); renaming one `ObjDef` id (23 characters, with references)
rewrites 46 characters, inserts 44, and leaves exactly 4,376,106 bytes byte-identical, verified via
`verifyUnchangedRegions`. §9.6's exit gate (derived AML re-parses, unchanged spans retained,
references validate, original unchanged) is **met at the computational level**. §9.5's
"Experimental ARIS AML export" label requirement is untouched by this — it stays until Phase 17.
Overall status: **Blocked on integration** (nothing calls this writer from the shell; there is no
export button).

### Phase 7 — Complete source accounting

`src/aris/accounting/**`: 1 file, 9 tests. Against the real export
(`src/aris/accounting/accounting.test.ts`):

```text
totalSourceRecords: 68036   totalAccounted: 68043   unaccountedCount: 0
byDisposition: raw-source-only 60983, side-panel 1122, visual-only 5130, attachment 56, editable-native 752
```

(`totalAccounted` exceeds `totalSourceRecords` because some entries are structural summaries that
don't correspond 1:1 to a lexical token; `unaccountedCount: 0` is the number that matters and it's
asserted directly by the test.) §10.4's exit gate — sanitized fixtures and the full local AnimalWF
scan both have zero unaccounted records — is **met at the computational level**. Status:
**Blocked on integration** — there is no accounting UI/report surface in the shipped shell.

### Phase 8 — ARIS canvas and full supported authoring

`src/aris/canvas/**`: 8 files, 78 tests, all passing, including
`src/aris/canvas/epcEndToEnd.test.ts` ("authoring a complete EPC through canvas operations
(Section 11.6)"). Landed in commit `2a94175` ("add Phase 8 native ARIS canvas on generic
diagram-js"), which also moved `diagram-js`/`diagram-js-minimap` into `package.json`
`dependencies` — **correcting an assumption in this task's brief**: `diagram-js` is _not_ a
devDependency needing to be promoted; it is already a production dependency as of this commit.
The correction that stands: none of `src/aris/canvas/**` is imported from `ArisApp.tsx` or
`main.tsx`, so `diagram-js` sits in the dependency graph but is not part of the reachable
69-module set and (per `vite build`'s tree-shaking) should not appear in the shipped bundle.
Status: **Module complete, unit-verified** for the underlying authoring/highlight/copy-paste
logic; **Blocked on integration** for §11.6's actual gate ("a user can author a complete EPC
manually") — there is no canvas mounted anywhere a user can reach.

### Phase 9 — Source-faithful visual renderer

`src/aris/renderer/**` (8 files, 56 tests) and `src/aris/symbols/**` (1 file, 10 tests), both
passing. Against real data (`src/aris/renderer/animalWfRealData.test.ts`): 494 elements, 465
connections, 1,339 route points, 16 lanes, 69 free-text, 14 attachments all round-trip through
`buildArisRenderModel`, and **`missing-template` fires for exactly all 8 AnimalWF models**
(`result.fidelityByKind['missing-template'] === 8`), matching plan §20.2's treatment of missing
templates as explicit, non-hidden blockers. Status: **Blocked on integration** — no renderer is
mounted in the shell.

### Phase 10 — Rich metadata, details panel, and attachments

`src/aris/details/**`: 5 files, 27 tests, all passing. **Blocked on integration** — §13.5's gate
("all AnimalWF metadata remains available" in the UI) is not met; there is no details panel wired
to a real model.

### Phase 11 — EPC semantics, XOR, return paths, and clean layout

`src/aris/epc/**` (5 files, 44 tests) and `src/aris/layout/**` (6 files, 188 tests), both passing.
Against the real 8 AnimalWF models (`src/aris/layout/__tests__/animalWf.test.ts`): every model
passes §19.4's gated criteria — `shapeOverlaps: 0`, `labelSatelliteOverlaps: 0`,
`edgeShapeCrossings: 0`, `detachedEndpoints: 0`, `missingEdges: 0`, `duplicateEdges: 0`,
`zeroLengthEdges: 0` — for all 8 models, and every model's clean layout is `accepted: true`. A
separate control-flow-only check asserts backbone `edgeEdgeCrossings <= 8` per model; measured
values are 0, 4, 0, 1, 0, 5, 0, 0.

**§19.4 does not list edge/edge crossings as a gated criterion, and the full-graph number
(control flow + satellites together) is not bounded by any test.** Measured directly against the
same 8 models (`cleanLayout` on the unfiltered graph): edgeEdgeCrossings = 319, 424, 142, 466,
481, 5, 136, 304 (model 5, the `MT_VAL_ADD_CHN_DGM`, is the low outlier at 5; the seven `MT_EEPC`
models with dense satellite combs range 136–481). This confirms the brief's blocker as stated.
Status: **Blocked on integration** for the phase overall (§14.5's gate is about what a user sees);
the underlying algorithm passes every criterion the plan actually gates.

### Phase 12 — Create from a new ARIS-native Excel template

`src/aris/excel/**`: 6 files, 81 tests, all passing (template schema, workbook parser incl.
browser worker path, limits, issues, template writer). **Blocked on integration** — §15.6's gate
("Excel creates native editable AML without AI," end to end) is not met; there is no Excel import
surface in the shell.

### Phase 13 — Create with AI from description, DOCX, PDF, and picture

`src/aris/ai/**`: 7 files, 72 tests, all passing (contract/schema validation, forbidden-content
scanning, logical-integrity checks, prompt builder, repair-turn logic, type validation).
**Blocked on integration** — no Create-from-AI surface targets the ARIS schema in the shell (the
retained Phase 1 AI transport exists but is not wired to this schema).

### Phase 14 — Folder-aware ARIS process assistant

`src/aris/assistant/**`: 10 files, 93 tests, all passing. Against real data
(`src/aris/assistant/__tests__/realData.test.ts`), digests build for all 8 AnimalWF models with
per-model step/decision/owner/input/output/system counts and answer a representative question
per model. **Blocked on integration** — no assistant surface in the shell reads from this index.

### Phase 15 — Chat improvement and missing-information completion

`src/aris/chat/**`: 7 files, 135 tests, all passing (gap scanner, patch schema, classification,
apply engine, interview loop, transcript, model-command mapping). This module was not itemized in
the task brief's approximate module list — it is a fifteenth subsystem beyond the twelve named,
and its 135 tests are the largest single-module count in the suite after layout (188) and writer
(164). **Blocked on integration.**

### Phase 16 — AnimalWF full-data and natural-layout loop

The plan's §19.1 baseline (8 models: 7 `MT_EEPC` + 1 `MT_VAL_ADD_CHN_DGM`; 279 object defs; 494
object occurrences; 465 connection occurrences [not "approximately," reconciled exactly]; 516
attribute definitions; 774 attribute occurrences; 69 free-text; 16 lanes; 14 OLE records; 28
blobs; 6 font style sheets) is independently reproduced by three separate code paths — the
semantic index, the accounting module, and the layout module's own AML topology extractor — all
of which agree. The **249-object-definitions-missing-Arabic** figure in §19.1 is also
independently reconciled: of 279 object definitions, 249 have no non-empty Arabic `AT_NAME` value
at all (verified by walking the semantic index's attribute records directly). §19.4's geometric
criteria pass for all 8 models (Phase 11 evidence above). §19.2's "render all eight source
layouts... capture screenshots" and the visual-inspection parts of the required iteration cycle
are not done — there is no rendering surface running against the shell to screenshot. Status:
**Module complete, unit-verified** for the computational/geometric parts; the visual-inspection
and screenshot parts of §19.2 are not applicable without Phase 8/9 integration.

### Phase 17 — Visual golden pair and ARIS import/re-export

**Blocked on user.** No golden AML + matching ARIS PDF/PNG export pair has been supplied, and no
live ARIS installation is available in this environment. §20.3's live import/re-export gate and
§20.2's visual comparison gate cannot be attempted, let alone passed. The `aris.export.
experimentalLabel` string (pinned in commit `cf13c47`'s i18n work to the exact plan §9.5 wording)
stays in force until this phase closes.

### Phase 18 — Release-quality tests, performance, and publication

Not run as a phase. Ad hoc, this pass confirms:

```text
$ npm run typecheck   # tsc --noEmit -p tsconfig.json  →  clean, no output
$ npm run lint        # eslint . --max-warnings 0      →  clean, no output
$ npx vitest run --maxWorkers=4 --retry=0 src/aris src/ArisApp.test.tsx
  Test Files  92 passed (92)
       Tests  1145 passed (1145)
```

This is a correction to the task brief's approximate figure ("~1,082 tests / 86 files"): the
actual current count is **92 files / 1,145 tests** for `src/aris/**` plus `src/ArisApp.test.tsx`
(91 files / 1,139 tests for `src/aris/**` alone). Typecheck and lint are both clean at `cf13c47`
— the red baseline the brief warned about (Phases 2/3 marked Complete while these were red) has
since been fixed, first by commit `f182a88` ("repair red typecheck and lint baseline") and again
by `2aa9630` ("repair pre-existing script lint failures"). §21.2 integration tests, §21.3 browser
tests (multi-engine), and §21.4 performance gates are not attempted — there is no integrated
product surface to run them against yet.

## Per-module test counts (`src/aris/**`, `npx vitest run --maxWorkers=4 --retry=0 src/aris`)

| Module     |  Files |     Tests |
| ---------- | -----: | --------: |
| source     |      2 |        55 |
| packages   |     11 |        97 |
| model      |      4 |        30 |
| writer     |     10 |       164 |
| accounting |      1 |         9 |
| symbols    |      1 |        10 |
| excel      |      6 |        81 |
| ai         |      7 |        72 |
| epc        |      5 |        44 |
| layout     |      6 |       188 |
| assistant  |     10 |        93 |
| details    |      5 |        27 |
| renderer   |      8 |        56 |
| canvas     |      8 |        78 |
| chat       |      7 |       135 |
| **Total**  | **91** | **1,139** |

Plus `src/ArisApp.test.tsx` (6 tests) at the shell integration seam, for **92 files / 1,145
tests** overall. All green as of `cf13c47`.

## Blockers

Every item below names the actor required to close it. Nothing here is fixable by more unit
tests on the existing modules.

1. **Integration (actor: implementing agent, next work).** Nothing under `src/aris/packages`,
   `model`, `writer`, `accounting`, `symbols`, `excel`, `ai`, `epc`, `layout`, `assistant`,
   `details`, `renderer`, `canvas`, or `chat` is reachable from `src/main.tsx`. This blocks every
   user-facing exit gate in Phases 4–15 and the visual/integration parts of Phase 16. An
   uncommitted `src/aris/shell/` directory (`shell.css`, `shellI18n.ts`,
   `arisStudioDocument.ts`) exists on disk at time of writing but is not yet imported by
   `ArisApp.tsx` — it looks like the start of this work, not evidence it's done.

2. **No real Arabic business-process content — this figure went through two rounds of
   correction; here is the fully reconciled version (actor: user, for richer content; this
   document, corrected twice, second time against a coordinator re-measurement that was itself
   still partly wrong).**

   The definitive, triple-cross-checked facts, all re-verified directly against the real
   4,376,152-byte AnimalWF export in this pass:

   - **896** Arabic-range XML numeric character references (`&#1575;` etc., codepoints
     U+0600–U+06FF) exist in the file. **All 896, with zero exceptions**, live inside
     `TextValue="..."` attributes of `<PlainText>` elements, which are always nested inside a
     `StyledElement`/`Paragraph` run structure under an `AttrValue`. No Arabic content exists
     anywhere else in the document (verified by span-matching every reference's byte offset
     against every `PlainText TextValue` attribute span; zero fell outside).
   - Those 896 references decode to **60** `PlainText TextValue` attributes containing real
     Arabic script, holding **9 distinct strings**: "المسؤول التنظيمي:" (Organizational Owner:)
     ×14, "رمز العملية:" (Process Code:) ×14, "اسم العملية:" (Process Name:) ×14, a UAE animal-
     welfare regulation citation ×3, a second municipal-authority regulation citation ×3, "إدارة
     الرفق بالحيوان" (Animal Welfare Division) ×2, "الهوية الرقمية" (Digital Identity) ×2, plus
     "ِApplication Rejection" ×4 and "ِApplication Approval" ×4 — the last two are English
     strings carrying a stray leading Arabic kasra (U+0650), a source data-quality artifact, not
     real Arabic content. This exact 896/60/9-string breakdown was supplied by the task's
     coordinator after their own re-measurement and is independently reproduced here.
   - **Where that Arabic sits relative to the 246 `LocaleId="&LocaleId.AEar;"` `AttrValue`
     blocks is more tangled than either round of prior analysis stated, and here is the fully
     reconciled structural picture:**
     - 0 of the 246 AEar-tagged blocks are literally empty — every one has content of some kind.
     - **189** of the 246 contain a nested `StyledElement`/`Paragraph`/`PlainText` rich-text
       run. Of those 189: **25** hold genuine Arabic-script `PlainText` text (5 of the 9 distinct
       strings above: the three ×14 template captions, but only 7 of each caption's 14 total
       occurrences sit under an AEar-tagged block — the other 7 of each sit under a
       _`LocaleId="&LocaleId.USen;"`_ block, see below — plus both ×2 strings, all 7 occurrences
       accounted for one per `MT_EEPC` model); the remaining **164** hold non-Arabic `PlainText`
       content (English captions, numbers, other tokens filed under an Arabic-tagged slot —
       itself a labeling artifact).
     - **57** of the 246 do _not_ contain a nested `PlainText` run at all; these hold simple
       direct content only — `AT_NAME`, `AT_ID`, zero-GUIDs, base64 PNG blobs — and **among these
       57, the count of real Arabic is genuinely zero.**
   - **The other 35 of the 60 real-Arabic `PlainText` attributes (the ×14-each remainder of the
     three template captions, both ×4 kasra artifacts, and both ×3 regulation citations) are
     nested inside `AttrValue` blocks tagged `LocaleId="&LocaleId.USen;"` — nominally the
     _English_ locale.** More than half of all genuine Arabic content in this file (35 of 60
     instances) is filed under the English-locale tag, not the Arabic one. This is a real, if
     minor, source-side mislabeling, not a parser defect: the tokenizer/semantic index decode and
     surface this content correctly regardless of which locale tag it sits under.

   **Correcting both prior rounds explicitly:** the original task brief's "zero Arabic
   codepoints... 189 empty... 57 holding only 9 distinct non-Arabic values" was wrong about
   Arabic being entirely absent (it isn't) and wrong about what "189" and "57" count (they don't
   describe emptiness; 189 is the count of AEar blocks with _any_ nested `PlainText` run, of
   which only 25 happen to be Arabic, and 57 is the count of AEar blocks _without_ a nested
   `PlainText` run at all, which is genuinely 100% non-Arabic). The coordinator's follow-up
   correction fixed the 896/60/9-string top-level numbers exactly right, but its claim that the
   AEar-tagged slots are "genuinely empty... zero Arabic" is also wrong: 25 of the 246 AEar
   blocks do contain real Arabic script, independently re-verified twice in this pass (once via
   the production semantic index's own parsed output, once via raw regex structural
   cross-checking of the source XML) — both methods agree exactly on 25 instances and 5 distinct
   strings. This is stated plainly because the task's own instructions require it, not to
   relitigate — the important shared conclusion below is unaffected by which count was off.

   **The one thing that matters for anyone deciding what to test:** every scrap of genuine
   Arabic content in this reference file — all 60 instances, both the AEar-tagged and the
   USen-tagged ones — lives in exactly one structural location: a `PlainText TextValue`
   attribute nested inside a `StyledElement`/`Paragraph` run. A regression in that one extraction
   path (`src/aris/source/semanticIndex.ts`'s `PlainText`-absorption logic, currently lines
   ~500–540) would silently zero out 100% of the Arabic content this file can exercise. (Note:
   `semanticIndex.ts` has exactly one commit in its history, `a163b38`, so there is no earlier
   "broken" version of this file to compare against — this is a concentration risk to guard
   going forward, not a documented historical regression that was fixed.)

   **Practical consequence:** this free-text/`PlainText`-run Arabic (60 real instances, 9
   distinct professionally-written strings) is available today for testing RTL rendering, bidi
   behavior, and Arabic text measurement/wrapping once a renderer is wired in (Phase 9). It is
   **not** available for testing bilingual `AT_NAME` handling on business objects: of the 279
   object definitions, **249 have no Arabic `AT_NAME` at all** (independently reconciled, matches
   plan §19.1's baseline exactly). Closing plan §21.3's professional Modern Standard Arabic gate
   for object/function/event _names_ still needs the user to supply an export with populated
   Arabic name slots — free-text captions alone don't exercise that gate.

3. **`missing-template` fires for all 8 AnimalWF models (actor: user or template author).**
   Confirmed: `result.fidelityByKind['missing-template'] === 8` in
   `src/aris/renderer/animalWfRealData.test.ts`. Plan §20.2 treats missing templates as explicit
   blockers, not acceptable approximations.

4. **Phase 17 requires the user.** Live ARIS import/re-export and a golden AML + PDF/PNG
   reference pair are both absent. The derived export stays labelled "Experimental ARIS AML
   export" (plan §9.5) until this closes; that label is pinned by a test as of commit `cf13c47`.

5. **`diagram-js` dependency placement — brief was wrong, now corrected.** The brief expected
   `diagram-js` to still be a devDependency needing promotion. As of commit `2a94175`,
   `diagram-js` (`15.22.0`) and `diagram-js-minimap` (`5.4.0`) are already in `package.json`
   `dependencies`. The real remaining issue is unchanged in substance: the canvas that depends on
   them is not reachable from `main.tsx`, so this is still an integration blocker, just not a
   dependency-section blocker.

6. **Layout satellite-region crossings (actor: layout implementer, if this becomes a real
   requirement).** Confirmed directly: full-graph `edgeEdgeCrossings` per AnimalWF model =
   319, 424, 142, 466, 481, 5, 136, 304, while the control-flow backbone alone stays at 0–5
   (bounded ≤8 by a passing test). Edge/edge crossings are not a §19.4 gated criterion, so this
   is not currently a failing test — it is a known visual-quality gap if the plan is later
   read to require it.

7. **Two verification commands cited as phase evidence are currently red — this is dead-code
   test debt, not an ARIS-shell regression (actor: whoever owns `tests/e2e/**` and
   `src/App.integration.test.tsx`).** `npm run test:aris:phase1` fails at its Playwright step:
   exactly **12 of 12** tests in `tests/e2e/lite-i18n-rtl.spec.ts` fail, every one because it
   drives a `getByRole('button', { name: /New process/i })` click and asserts on
   `.djs-container svg` / `bpmn-js` canvas state that no longer exists in the ARIS-only shell.
   `npm run test:aris:phase2` fails: exactly **12 of 144** tests fail in
   `src/App.integration.test.tsx`, all in the `App directory workspace orchestration` describe
   block, all exercising the legacy 8,028-line `src/App.tsx` monolith directly — the same file
   `scripts/check-aris-runtime-boundary.mjs` explicitly bans from the reachable production graph.
   `src/ArisApp.test.tsx`, the other file in that same `test:aris:phase2` run, passes 6/6. Neither
   failure set touches ARIS-shell code; both are pre-existing tests for UI/code paths the
   transformation already intentionally removed or banned, simply never deleted or updated to
   match. Recorded with exact counts here so nobody runs either command, sees red, and either
   wrongly downgrades Phase 1/2 or wrongly dismisses it as a false alarm without knowing why. See
   the Phase 1 and Phase 2 evidence sections above for full command transcripts.

8. **Product identity/version drift from plan §1 (actor: whoever owns Phase 0/repo metadata).**
   `package.json` still declares `orbitpm-process-studio-lite` at version `0.4.5` with a BPMN
   description, not `OrbitPM ARIS Studio Lite` at `0.1.0-alpha.1` as plan §1 specifies.

## Verification run for this document

```text
$ npx prettier --check docs/
```

`docs/` is covered by prettier (`.prettierrc` exists, `format:check` runs `prettier --check .`
with no docs exclusion). At the start of this pass, `docs/ARIS_PHASE_CHECKLIST.md` and
`docs/ARIS_PHASE1_CHARACTERIZATION.md` both failed `prettier --check`; this rewrite of
`ARIS_PHASE_CHECKLIST.md` is formatted to pass. `ARIS_PHASE1_CHARACTERIZATION.md` was not
in scope to edit and its pre-existing formatting issue is unchanged.
