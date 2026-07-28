# ARIS Phase 4–15 module inventory

Snapshot: `feat/aris-only-studio` at commit `cf13c47217e0b4872b01eeb9fe25b29707cc7a3d`, captured
2026-07-29. Companion to [ARIS_PHASE_CHECKLIST.md](/home/ahmed/Desktop/bpmn_tool/desktop/docs/ARIS_PHASE_CHECKLIST.md),
which has the phase-status table, the status vocabulary, and the integration-status warning that
applies to every module below: **none of the modules in this document are imported by
`src/main.tsx` or `src/ArisApp.tsx`.** `npm run check:aris-runtime-boundary` reports 69 reachable
production modules regardless of which of these subsystems exist on disk. Every "public seam"
listed below is real, typed, and unit-tested — none of it is currently reachable by a user.

Test counts are from `npx vitest run --maxWorkers=4 --retry=0 src/aris/<dir>`, all green at
`cf13c47`. "Satisfies" / "Does not satisfy" are judged against the exact plan section cited, not
against general code quality.

## §packages — `src/aris/packages/` (Phase 4, plan §7)

**Scope:** immutable source-package storage layout, manifest schema, atomic transactional
writes, revision history, portable-workspace packaging, backup, and secret handling so API keys
never enter a package.

**Public seam** (`src/aris/packages/index.ts`, re-exports 10 files): `canonicalJson`, `layout`
(the `.orbitpm/aris/<sha256>/...` path scheme), `secrets`, `manifest`
(`ArisSourcePackageManifestV1`), `accounting`, `revisions`, `atomicWrite`, `store`, `transaction`,
`packageBackup`, `portable`.

**Tests:** 11 files, 97 tests — `layout` (15), `accounting` (4), `secrets` (4), `portable` (17),
`transaction` (16), `generated` (5), `store` (8), `packageBackup` (4), `exitGate` (2), `manifest`
(12), `revisions` (10).

**Satisfies (§7):** the manifest schema (§7.2) matches the plan's `ArisSourcePackageManifestV1`
shape; atomic transaction commit/rollback (§7.3 steps 7–10) is tested in `transaction.test.ts`;
`generated.test.ts` covers §7.5's provenance-for-AI/Excel-generated-models path; `secrets.test.ts`
confirms API keys never enter a package (§7.4's last bullet); `exitGate.test.ts` (2 tests) is an
explicit self-check against §7.6's exit-gate bullets at the module level.

**Does not satisfy:** §7.6's exit gate is written as user-facing ("original bytes survive
save/edit/export/backup/restore unchanged") — that survival has only been demonstrated inside
this module's own test harness, not through an actual save/edit/export/backup/restore user
action, because there is no UI path that calls this module.

## §model — `src/aris/model/` (Phase 5, plan §8)

**Scope:** the native `ArisWorkingDocument`/`ArisModel`/`ArisObjectDefinition`/
`ArisObjectOccurrence`/`ArisConnectionOccurrence` contracts and the command system
(`ArisEditCommand`) with undo/redo.

**Public seam** (`src/aris/model/index.ts`): `types`, `buildFromSource`, `commands`,
`commandStack`, `serialize`.

**Tests:** 4 files, 30 tests — `buildFromSource` (9), `commands` (9), `laneFreeText` (6),
`attributeCommands` (6).

**Satisfies (§8):** §8.1's contracts are implemented as specified (definition vs. occurrence
identity, `ArisEditCommand` shape with `baseRevision`/`affectedSourceIds`/`origin`); §8.2's
required distinctions (a definition may have multiple occurrences; occurrence geometry/style is
per-occurrence, not per-definition) are exercised by `buildFromSource.test.ts` and
`commands.test.ts`; §8.3's atomicity/undo/redo/revision-serialization requirements are covered by
`commandStack` tests reached transitively through `commands.test.ts`.

**Does not satisfy:** §8.4's exit gate ("working model builds from sanitized AML" and "commands
persist and restore") is demonstrated against fixtures inside the test suite, not against a live
document a user opened and edited — there is no command palette, canvas gesture, or details-panel
edit in the shipped shell that constructs an `ArisEditCommand`.

## §writer — `src/aris/writer/` (Phase 6, plan §9)

**Scope:** span-preserving AML patch/emit, export validation, ID allocation, XML escaping, the
derived-AML compatibility label.

**Public seam** (`src/aris/writer/index.ts`, 10 files): `compatibility`, `edits`, `emit`,
`errors`, `escapeXml`, `exportDerivedAml`, `ids`, `patch`, `sourceSeam`, `sourceView`, `spans`,
`validate`.

**Tests:** 10 files, 164 tests — `ids` (12), `patch` (20), `compatibility` (6), `emit` (12),
`writer` (31), `validate` (23), `sourceView` (12), `sourceSeam` (5), `escapeXml` (39), plus the
real-data `animalWfRoundTrip` (4, see below).

**Satisfies (§9):** §9.1's span-preserving patch behavior (attribute order, quote style, unrelated
whitespace/comments/unknown-XML preservation) is directly demonstrated on the real AnimalWF
export: a no-op edit set reproduces all 4,376,152 bytes exactly; renaming one `ObjDef` id changes
only the id's own spans, verified by `verifyUnchangedRegions` to leave 4,376,106 of 4,376,152
bytes byte-identical. §9.3's export validation (well-formedness, unique IDs, reference resolution)
is covered by `validate.test.ts`'s 23 cases. §9.5's "Experimental ARIS AML export" label exists in
`compatibility.ts` and is pinned by a test to the exact plan wording. §9.6's exit gate — derived
AML re-parses, unchanged spans retained, references validate, original unchanged — is **met at
the computational level**, independently confirmed against real data in this pass (see
`ARIS_PHASE_CHECKLIST.md` Phase 6 evidence).

**Does not satisfy:** there is no export button or download path in the shipped shell; nothing
calls `prepareDerivedAml` from a user gesture. §9.5's label removal requires Phase 17 (live ARIS
round-trip), which is blocked on the user.

## §accounting — `src/aris/accounting/` (Phase 7, plan §10)

**Scope:** the `ArisAccountingEntry` disposition model, lexical census, reconciliation between
census and semantic index, and a deterministic, filterable, SHA-256'd report.

**Public seam:** `accounting.ts` (`buildAccountingEntries`, `elementNameFromEntryPath`),
`lexicalCensus.ts`, `reconcile.ts`, `report.ts` (`buildAccountingReport`,
`computeReportSha256`, three `filterReportBy*` functions, `serializeAccountingReport`),
`semanticIndexAdapter.ts`.

**Tests:** 1 file, 9 tests, including the two real-AnimalWF cases.

**Satisfies (§10):** §10.2's "account for everything" list is covered — the real-data test
asserts exact per-kind counts for models, object/connection definitions and occurrences,
attributes, attribute occurrences, lanes, free text, OLE, blobs, font style sheets, and route
points, all reconciled against the lexical census with **zero unaccounted records** out of
**68,036** total source records censused (disposition split: 60,983 raw-source-only, 5,130
visual-only, 1,122 side-panel, 752 editable-native, 56 attachment). §10.3's determinism
requirement ("selecting a report item...", "export as deterministic JSON") is covered for the
JSON-determinism half (`serializeAccountingReport` is asserted to be stable across two builds of
the same report) but not for "selecting a report item opens/selects the corresponding model
element," which needs a UI. §10.4's exit gate (zero unaccounted records, both sanitized fixtures
and the full AnimalWF scan) is **met at the computational level**.

**Does not satisfy:** there is no accounting/fidelity report screen anywhere in the shipped
product; §10.3's UI-selection requirement is untested because there is nothing to test it against.

## §canvas — `src/aris/canvas/` (Phase 8, plan §11)

**Scope:** the `diagram-js`-based canvas bridge — element registry, command bridge between
`ArisEditCommand` and `diagram-js`'s `CommandStack`, authoring (create/rename/move/resize/
connect/delete), context pad, palette, search, copy/paste, selection highlighting, EPC rules.

**Public seam** (`src/aris/canvas/index.ts`, 27 files total): `ArisCanvas`, `ArisAuthoring`,
`ArisCanvasSync`, `ArisDocumentStore`, `ArisModeling`, `ArisRenderer`, `ArisRules`,
`ArisPaletteProvider`, `ArisContextPadProvider`, `ArisSearchProvider`, plus geometry/ids/
clipboard/highlight helpers.

**Tests:** 8 files, 78 tests — `authoring` (15), `highlight` (13), `objectTypes` (18),
`commandBridge` (9), `epcEndToEnd` (3), `copyPaste` (7), `canonicalGeometry` (7), `boot` (6).

**Satisfies (§11):** landed in commit `2a94175`, which also moved `diagram-js`/
`diagram-js-minimap` into `package.json` production `dependencies` — matching plan §5.4's
instruction to "retain generic `diagram-js`" (this corrects an assumption in this task's brief
that `diagram-js` was still a devDependency; it is not). `epcEndToEnd.test.ts` is explicitly
titled against "Section 11.6" and builds start event → function → XOR split → two branches →
merge → end event through canvas operations, exercising create/connect/undo. `objectTypes.test.ts`
(18 tests) exercises the §11.3 AnimalWF object-type list. `highlight.test.ts` (13 tests) targets
§11.5's selection-highlighting behavior.

**Does not satisfy:** §11.6's actual exit gate ("a user can author a complete EPC manually") is
not met — the canvas is not mounted in `ArisApp.tsx`, so there is no way for a user to reach it.
The bridge design (documented in the commit message: every gesture is planned against an
immutable scratch document before either the ARIS command stack or `diagram-js`'s history is
touched, so a precondition failure rejects the gesture before divergence is possible) is sound
engineering but unverifiable by a user today.

## §renderer — `src/aris/renderer/` (Phase 9, plan §12) and §symbols (plan §12.2)

**Scope:** source-faithful render-model construction (position/size/symbol/z-order/pen/brush/
route/font/lane/free-text/OLE), the fidelity report (missing font/template/symbol, unsupported
brush/pen, etc.), Source vs. Clean layout modes, RTL/bidi text handling, text wrapping. Symbols:
the `model type + object type + SymbolNum` registry and unknown-symbol fallback.

**Public seam:** `src/aris/renderer/index.ts` (10 files: `types`, `input`, `color`, `font`,
`bidi`, `textWrap`, `symbolAdapter`, `fidelity`, `buildRenderModel`, `layoutModes`);
`src/aris/symbols/index.ts` (`types`, `registry`, `fidelity`, `UNKNOWN_SYMBOL_DESCRIPTOR`).

**Tests:** renderer 8 files / 56 tests (`buildRenderModel` 13, `fidelity` 10, `layoutModes` 6,
`font` 5, `color` 10, `textWrap` 7, `bidi` 4, plus the real-data case); symbols 1 file / 10 tests.

**Satisfies (§12):** the real-data test (`animalWfRealData.test.ts`, "Section 12.5 exit gate")
builds a render model for all 8 AnimalWF models and confirms element/connection/route-point/lane/
free-text/attachment counts match the accounting module's independently-derived totals (494/465/
1,339/16/69/14), with every element's source geometry surviving unmodified (finite, non-negative
bounds). **`missing-template` fires for exactly 8 of the fidelity findings** —
`result.fidelityByKind['missing-template'] === 8` — one per model, matching plan §20.2's
requirement that missing templates be explicit, reported blockers rather than silently
approximated. §12.2's "unknown/custom symbols use a visible fallback" is covered by
`UNKNOWN_SYMBOL_DESCRIPTOR` and its test.

**Does not satisfy:** §12.5's exit gate ("source geometry is visible," "unknown visuals are
explicit," "Source/Clean modes are independently restorable") describes what a user sees; there is
no rendering surface mounted in the shell, so nothing is visible to anyone.

## §details — `src/aris/details/` (Phase 10, plan §13)

**Scope:** default-visible metadata layers (owners, systems, inputs/outputs, etc.), collision-
aware satellite clustering, the side-panel tab set, and attachment extraction/preview/download
with safe MIME sniffing.

**Public seam** (`src/aris/details/index.ts`): `seam`, `metadata`, `clusters`, `tabs`,
`attachments`, `xmlScan`.

**Tests:** 5 files, 27 tests — `clusters` (5), `attachments` (9), `metadata` (5), `tabs` (4), plus
the real-data case (4).

**Satisfies (§13):** `metadata.test.ts` and the real-data test cover §13.1's default-visible
metadata layers against actual AnimalWF records; `clusters.test.ts` covers §13.2's collision-aware
grouping-by-owning-function; `tabs.test.ts` covers the §13.3 tab list; `attachments.test.ts`
covers §13.4's safe-extraction/MIME-detection/no-OLE-execution requirements.

**Does not satisfy:** §13.5's exit gate is explicitly about the UI ("all AnimalWF metadata remains
available," "rich display does not distort the control-flow backbone," "attachments survive
backup/export") — none of it is checkable without a details panel mounted against a real
document, which does not exist in the shipped shell.

## §epc — `src/aris/epc/` (Phase 11, plan §14.1–§14.3) and §layout (plan §14.4)

**Scope:** EPC validation (event/function/rule chronology, split/merge, connected-component
integrity), Arabic-aware return-path detection (native "return/رجوع" outcome terms), XOR
split/merge handling. Layout: the clean-layout algorithm (graph separation, cycle classification,
spine placement, collision resolution) and its metrics/rejection gate.

**Public seam:** `src/aris/epc/index.ts` (`validate`, `xor`, `returnPath`, `arabicNormalize`,
`adapter`, `flowGraph`, `constants`); `src/aris/layout/index.ts` (`cleanLayout`,
`measureLayoutResult`, `cleanLayoutRevision`/`resetToSourceLayout`/`sourceLayoutRevision`,
`analyzeLayout`, plus `graph`/`geometry`/`axis`/`placement`/`routing`/`satellites`/`rejection`).

**Tests:** epc 5 files / 44 tests (`immutability` 7, `returnPath` 10, `validate` 14, `xor` 6, plus
real-data 7); layout 6 files / 188 tests (`geometry` 27, `metrics` 22, `graph` 14, `animalWf` 60,
`cleanLayout` 45, `rejection` 20).

**Satisfies (§14):** against all 8 real AnimalWF models, every clean layout is `accepted: true`
with `shapeOverlaps: 0`, `labelSatelliteOverlaps: 0`, `edgeShapeCrossings: 0`,
`detachedEndpoints: 0`, `missingEdges: 0`, `duplicateEdges: 0`, `zeroLengthEdges: 0` — this is
§14.5's "clean layouts pass collision/topology metrics" and §19.4's geometric criteria, both met
at the computational level. §14.5's "explicit cycles are preserved" is directly tested per model
(`keeps every explicit cycle visible and traceable`, asserting every back-edge/self-loop route has
positive length). §14.3's return-path detection (English/Arabic return/returned/modify/rework
terms, ranking editable functions by graph distance) is covered by `returnPath.test.ts`;
`src/aris/epc/realData.test.ts` confirms the real export contains at least one explicit return
path.

**Does not satisfy — and an important scoping nuance:** §19.4 does **not** list edge/edge
crossings among its gated criteria, and no test bounds the full-graph (control-flow + satellite)
crossing count. Measured directly in this pass against the real 8 models: full-graph
`edgeEdgeCrossings` = 319, 424, 142, 466, 481, 5, 136, 304 (the `MT_VAL_ADD_CHN_DGM` model is the
outlier at 5; the seven satellite-heavy `MT_EEPC` models range 136–481), while the isolated
control-flow backbone stays at 0–5 (bounded ≤8 by a passing test). This is not a failing test —
it is a real visual-density characteristic of dense satellite metadata that the plan's own
criteria don't currently gate. §14.5's actual exit-gate bullets are otherwise about what a user
sees ("missing return routes are safely confirmable"), which needs a UI that doesn't exist yet.

## §excel — `src/aris/excel/` (Phase 12, plan §15)

**Scope:** the ARIS-native `.xlsx` template schema (`Models`/`Objects`/`Connections`/
`Attributes`/`Assignments`/`Lanes`/`FreeText`/`Styles`/`Glossary` sheets), secure ZIP/XLSX
preflight and limits, browser worker parsing, template writer, and issue reporting.

**Public seam** (`src/aris/excel/index.ts`, 10 files): `browserWorkbookParser`, `issues`,
`limits`, `templateSchema`, `templateWriter`, `workbookModel`, `workbookParser`,
`workbookParserWorkerProtocol`, `xlsxReader`, `xlsxWriter`.

**Tests:** 6 files, 81 tests — `workbookParser` (40), `templateWriter` (8), `browserWorkbookParser`
(6), `issues` (5), `templateSchema` (10), `limits` (12, including a ~11s ZIP-bomb/limit-boundary
case).

**Satisfies (§15):** §15.2's full sheet/column schema is encoded in `templateSchema.ts` and
covered by its 10 tests; §15.3's pipeline (extension/MIME validation, secure ZIP preflight, macro/
encryption/ActiveX/executable/unsafe-path/ZIP-bomb rejection, worker parsing, cell-address
provenance) is covered across `limits.test.ts` and `workbookParser.test.ts`; §15.4's numeric
limits (20 MiB compressed, 100 MiB declared uncompressed, 10,000 ZIP entries, etc.) are asserted
directly in `limits.test.ts`.

**Does not satisfy:** §15.6's exit gate ("Excel creates native editable AML without AI," "blank/
example templates round-trip," end to end) needs an Excel import surface in the shell; none
exists. The generated-AML-parse/export test from §15.5's list is covered at the module boundary
(workbook → `ArisWorkbookModel` → generated AML), not as a user-triggered action.

## §ai — `src/aris/ai/` (Phase 13, plan §16)

**Scope:** the `ArisAiDraftV1` contract, forbidden-content scanning (no raw AML/XML/real ARIS
IDs/coordinates in AI output), logical-ID integrity checks, the ARIS-native prompt builder
(EPC conventions, native AND/OR/XOR, logical IDs, untrusted-content fencing), bounded semantic
repair-turn logic, draft validation.

**Public seam** (`src/aris/ai/index.ts`): `contract` types, `findings`, `forbiddenContent`,
`logicalIntegrity`, `validateDraft`, `promptBuilder` (`buildArisAiPrompt`, `fenceUntrustedText`),
`repairTurn`, `typeValidation`.

**Tests:** 7 files, 72 tests — `validateDraft` (6), `contract` (9), `forbiddenContent` (16),
`repairTurn` (10), `promptBuilder` (11), `logicalIntegrity` (14), `typeValidation` (6).

**Satisfies (§16):** §16.4's contract shape (`ArisAiDraftV1`, `ArisAiObject`, `ArisAiRelation`
with `logicalId`/`confidence`/`evidence`) matches the plan exactly and is exercised by
`contract.test.ts`; §16.4's "must not emit raw AML, real ARIS IDs, XML, coordinates" constraint is
enforced and tested by `forbiddenContent.test.ts` (16 cases); §16.5's prompt rules (EPC
conventions, native AND/OR/XOR, logical-IDs-only, untrusted-content fencing via
`fenceUntrustedText`) are covered by `promptBuilder.test.ts`; §16.6 step 10's "up to three
semantic repair turns" is covered by `repairTurn.test.ts`.

**Does not satisfy:** §16.8's exit gate ("description, DOCX, PDF, and image create editable
native ARIS models") needs a Create surface wired to this schema; the retained Phase 1 AI
transport (provider selection, key storage, privacy review, DOCX/PDF parsing) exists and is
tested separately, but nothing currently connects it to `buildArisAiPrompt`/`validateArisAiDraft`.

## §assistant — `src/aris/assistant/` (Phase 14, plan §17)

**Scope:** the `ArisProcessDigest`/`ArisDigestStep`/`ArisDigestDecision` model, folder/portable/
single-file indexing (worker-backed), Arabic-normalized retrieval and ranking, deterministic
no-key question answering, and formatted answers with source chips.

**Public seam:** `answer`, `arisVocabulary`, `assistantIndex`, `browserAssistantIndexer`,
`digest`, `formatAnswer`, `i18n`, `indexBuilder.worker` + `indexWorkerProtocol`, `matching`,
`questionRouter`, `retrieval`, `seamAdapter`, `stepGraph`, `types` (14 files; no barrel
`index.ts` — consumers import the specific modules they need).

**Tests:** 10 files, 93 tests — `indexBuilderWorker` (6), `assistantIndex` (10), `digest` (14),
`formatAnswer` (2), `matching` (5), `seamAdapter` (5), `i18n` (3), `questionRouter` (26),
`retrieval` (21), plus the real-data case (1).

**Satisfies (§17):** the real-data test builds digests for all 8 AnimalWF models and prints
per-model stats (steps/decisions/triggers/owners/inputs/outputs/systems/missingInformation), then
answers a representative question against each — e.g. model 2 ("Request to Register Animal Owner
Profile"): 45 steps, 9 decisions, 10 steps with a named responsible party, 83 missing-information
findings. §17.4's deterministic no-key answer list (what comes next/before, who's responsible,
inputs/outputs, XOR outcomes, return targets, assigned models, missing information, topic search)
is covered across `questionRouter.test.ts` (26 cases) and `retrieval.test.ts` (21 cases).

**Does not satisfy:** §17.6's exit gate ("folder questions work without a key," "source chips
open/select correct ARIS elements") needs an assistant surface reading from a live workspace;
none is mounted. The retained Phase 1 assistant drawer exists but answers from the pre-ARIS
BPMN-era digest, not this one.

## §chat — `src/aris/chat/` (Phase 15, plan §18)

**Scope:** the deterministic gap scanner (§18.1's full list — missing names/process code/owner/
inputs/outputs/systems/decision basis/XOR outcomes/return target/start-end/dangling refs/etc.),
the interview loop (bounded rounds/questions), the `ArisPatchProposalV1` command set and its
automatic-vs-confirmation classification, atomic safe-apply with rollback, and transcript/
privacy handling.

**Public seam** (`src/aris/chat/index.ts`, barrel over 9 files): `types`, `locale`,
`gapScanner`, `patchSchema`, `classification`, `modelCommandMapping`, `applyEngine`,
`interviewLoop`, `transcript`, `messageKeys`.

**Tests:** 7 files, 135 tests — `classification` (40, the largest single test file in the whole
`src/aris` suite), `applyEngine` (20), `patchSchema` (29), `gapScanner` (20), `interviewLoop` (9),
`transcript` (13), `modelCommandMapping` (4). **This module was not named in the task brief's
approximate module list** (which stopped at renderer/canvas); it is a real fifteenth subsystem.

**Satisfies (§18):** §18.1's gap list is directly enumerated and tested in `gapScanner.test.ts`;
§18.3's exact patch-command set (`setLocalizedName`, `setAttribute`, `addCoreObject`,
`deleteDefinition`, etc.) and §18.4's automatic-vs-confirmation split (safe fields auto-apply;
new core objects/connections, return back-edges, reconnection, deletion, ID changes require
confirmation) are both encoded in `classification.ts` and covered by its 40 tests — this is the
most heavily-tested single decision surface in the module set. §18.5's atomic-apply-with-rollback
requirement is covered by `applyEngine.test.ts`.

**Does not satisfy:** §18.8's exit gate ("safe field completion auto-applies atomically,"
"Undo restores prior revision," "invalid AI patches make no changes") describes a live chat
session against a real document; there is no chat surface wired to a real `ArisWorkingDocument`
in the shell, so none of this is demonstrated end to end.
