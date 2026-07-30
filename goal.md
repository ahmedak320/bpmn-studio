# Goal Prompt — ARIS Studio Lite: Folder Tree & Nested Processes, Direct Editing & Symbols, Convention Alignment, Import Fidelity (feat/aris-only-studio)

You are an **orchestrator only**. You do not implement, edit production code, or
write tests yourself. You evaluate the current state, plan dispatches, launch
worker agents per the model policy below, verify their results against the
plan's gates, and commit/push when gates pass.

Take the four product issues described in `desktop/implementation_plan.md` from
the current baseline to completion by dispatching parallel agents, wave by wave.
This is an implementation and verification task, not a planning exercise.
Continue until the definition of completion below is objectively satisfied, or
until every independent in-scope task is finished and only a genuinely
unavoidable human/permission dependency remains.

## Authoritative sources

1. `/home/ahmed/Desktop/bpmn_tool/desktop/implementation_plan.md` — THE lane
   plan. Its wave schedule, file-ownership chains, lane specifications,
   embedded convention catalog, per-model fidelity expectation tables, exact
   module interfaces, and authorized-product-change list are binding. Its
   checkboxes are the progress ledger: tick them in the same commit as the
   lane's code.
2. `/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md` — the existing
   product contracts (AML immutability, accounting, §-numbered invariants, exit
   gates). New work must never contradict it.
3. This file — orchestration policy.

Resolve disagreement by inspecting current code, tests, and Git history. Retain
the strictest safety requirement.

## Repository facts (verify before acting)

- Working repository: `/home/ahmed/Desktop/bpmn_tool/desktop` (a nested Git
  repo; the outer `/home/ahmed/Desktop/bpmn_tool` is a separate legacy repo and
  ignores `desktop/`). This directory IS the git root.
- Remote: `https://github.com/ahmedak320/bpmn-studio.git`
- Working branch: `feat/aris-only-studio` — push directly to it. No PRs, no
  GitHub CI runs — fast local loop.
- Product identity: `OrbitPM ARIS Studio Lite` — a browser SPA (React 18 +
  Vite, single-file build). NOT Electron.
- Canonical rolling artifact: `release/OrbitPM-ARIS-Studio-Lite.html`, rebuilt
  via `npm run build:aris` in every product commit (orchestrator's job).
- Private reference assets (NEVER commit; live OUTSIDE the repo under
  `/home/ahmed/Desktop/bpmn_tool/reference/`, reachable as `../reference/`):
  - `../reference/AnimalWF/ARISAMLExport.xml` — the full-data AML fixture.
  - `../reference/AnimalWF/pdf/*.pdf` — the 4 reference process printouts.
  - `../reference/conventions/ARIS_Convention_Manual_DMT_v02.pdf` — the manual.
  - `../reference/AnimalWF/expected/*.expected.json` — fidelity expectation
    files authored during Wave 1 (org data — never commit).
- **Wave 0 duties (orchestrator):** (a) confirm the 5 PDFs are present under
  `../reference/` (copied during planning — re-copy from
  `/home/ahmed/.claude/uploads/e861b876-83f9-425f-b812-da5ebbacb110/` if any are
  missing); (b) run the full gate suite at HEAD and record the true baseline
  (SHA + every failure verbatim) into the plan's "Baseline record" section
  BEFORE dispatching anything; (c) if red at HEAD, dispatch a default-worker fix
  lane before Wave 1 and re-record. Treat any document's completion claims as
  claims to verify, never as evidence. HEAD at planning time was `ff6482b`.

## Mission

Fix four product issues (full lane detail in `implementation_plan.md`; the
product decisions below were made by the user and are final):

1. **Folder tree + nested processes — an exact replica of the main-branch BPMN
   tool.** Importing an ARIS AML/XML in a multi-file workspace (directory/OPFS)
   must keep the main-branch-style folder tree as THE explorer and physically
   write one `.aml` per model into folders mirroring the AML `Group` hierarchy —
   imported and created content becomes real files in the tree, not an in-memory
   view. Replicate main's nested-process handling exactly: background
   cross-file process linking, a marker on a block that has a full subprocess
   drawing, double-click to open that subprocess, multiple nesting levels,
   create-a-missing-subprocess, and link-preservation across rename/move.
   Achieve this by REUSING the surviving `buildProcessHierarchy` +
   `FolderTreeLite` unchanged, fed by new ARIS-side index/graph inputs. Single-
   file mode keeps its current in-memory behavior.
2. **Direct text entry + predetermined symbols.** Placing a new function (or any
   labelable object) opens an inline label editor immediately (type → Enter
   commits; Escape cancels; dblclick/F2 edit existing). Every placeable object
   carries a predetermined ARIS symbol and DMT convention color, offered as
   palette entries and as a post-placement quick-pick for variant families.
3. **Convention-manual alignment.** The program's symbols, colors, connection
   types + labels, RACI mapping, attribute schema, model types, levels, and
   assignment/navigation conventions must follow the DMT ARIS Convention Manual.
   A single `src/aris/conventions/` catalog is the source of truth; new
   validation rules flag convention violations.
4. **Import fidelity vs the reference PDFs.** Importing `ARISAMLExport.xml` must
   render the reference models very close to the PDFs (connections, wiring,
   placement, symbols, colors, satellites, labels, numbering). Iterate on 2
   models to an exact bar; hold out 2 for tuning-free final verification. Nested-
   process handling is validated on the fixture's real 7 VACD→EPC assignments.

## Execution rules

1. Work wave by wave in plan order (waves 0–5). Within a wave, dispatch every
   lane concurrently in a single message. Never start a wave before every lane
   of the previous wave passed its verification commands.
2. **One owner per contended file per wave.** The plan's ownership chains are
   binding. If a lane reports it must touch a file it does not own, stop it,
   re-scope, and re-dispatch — never let two concurrent agents edit one file.
3. Read the existing implementation and tests before changing a subsystem;
   require the same of every worker (each lane's "Read first" list).
4. Never weaken, skip, or delete an assertion to go green — EXCEPT the plan's
   explicitly authorized product-change test updates (import-to-tab →
   import-to-files, model-explorer stacking → `>1` gating, `Model.New` →
   minted-id, palette entry-count/action-id changes). `npm run check:no-skips`
   must stay green. Workers must not "fix" the product to satisfy old tests that
   assert removed behavior; they must not weaken single-file-mode, §7.3 package
   import, or BPMN-reject tests (those stay green unmodified).
5. Every product-code commit must include a freshly built
   `release/OrbitPM-ARIS-Studio-Lite.html` produced by `npm run build:aris`.
6. Before each commit run, at minimum: `npm run typecheck`, `npm run lint`,
   `npm run check:aris-runtime-boundary`, `npm run check:ui-copy`,
   `npm run check:no-skips`, `npm test`, plus the wave's e2e and animalwf runs
   where the plan lists them.
7. Commit in wave-scoped, reviewable commits; push directly to
   `feat/aris-only-studio`. Tick the plan's checkboxes in the same commit as the
   code they describe.
8. **Never commit** `reference/**` in any form — the AML fixture, the PDFs, the
   `expected/*.expected.json` files, or the fidelity-report artifacts — nor API
   keys, `.claude/` state, or worker brief/log scratch files. The fidelity
   expectation JSONs and report artifacts live outside the repo by design.
9. Never force-push, reset, rewrite history, stash, or checkout across agents
   sharing the worktree. Preserve unrelated user files. Keep the worktree clean
   between waves.
10. Use the internet (diagram-js docs, `diagram-js-direct-editing` API, ARIS AML
    references) whenever it reduces guesswork.

## Cross-cutting invariants (binding across all lanes)

- **`element.dblclick` priority split:** the assignment-navigation handler
  (`arisAssignmentUx`) registers at **priority 2000** and returns `false` ONLY
  when it actually navigates an assignment; the direct-editing handler
  registers at **priority 1500**. These two must never collide — a function
  with an assignment drills down on double-click; a function without one opens
  the label editor.
- **Conventions catalog provenance:** every ARIS `OT_*`/`ST_*`/`AT_*`/`CT_*`
  number that is NOT confirmed by the AML fixture sits in ONE contiguous
  `VERIFY-AGAINST-REAL-ARIS-EXPORT` region with a `verification` flag. Standing
  instruction: the moment any real DMT export containing those types becomes
  available, verify that table in one diff. Never let a guessed number leak into
  export output (the exporter emits only authored attributes).
- **Holdout isolation:** holdout fidelity suites (`*.holdout.animalwf.test.ts`)
  and their npm script are run ONCE at Wave-1 delivery to confirm they load,
  then NOT AGAIN until Wave 5. They must never be used to tune Wave-3 fixes.
- **Authored colors win:** symbol descriptor default fills change to DMT colors,
  but imported occurrences carry authored `Pen`/`Brush`, which always override.
  `npm run test:aris:animalwf` is the tripwire that imported renders are
  unchanged.

## Orchestration rules

- The lead session orchestrates and does not implement directly.
- **`sonnet` medium effort and `Kimi K2.7 Coding` are the default workers.**
- **Lane routing is pre-assigned in the plan and binding:**
  - **Kimi K2.7 Coding lanes — T1, T3, C1, C2, F2 (wave 1); T7 (wave 2); T9
    (wave 3); E2 (wave 4).** These MUST be dispatched to Kimi. Do not silently
    reroute them to Claude workers. If a Kimi lane fails verification, retry once
    with a sharper brief before escalating per the protocol below.
  - **sonnet medium lanes — T4, F1 (wave 1); C5 (wave 2); C6, C7 (wave 3); E1,
    E3, X1 (wave 4).**
  - **opus-4.8[1m] high lanes — T2, C3 (wave 1); T5, T6, C4 (wave 2); T8, C8
    (wave 3).** Dispatch these to the `opus48-1m` agent (defined at
    `~/.claude/agents/opus48-1m.md`: claude-opus-4-8[1m], high effort).
- **Kimi K2.7 Coding** is a local CLI, already authenticated. Invoke it headless
  from the repo root:

  ```bash
  /home/ahmed/.kimi-code/bin/kimi -m kimi-code/kimi-for-coding \
    -p "$(cat <brief-file>)" > <log-file> 2>&1
  ```

  Thinking is on by default (`~/.kimi-code/config.toml` sets
  `[thinking] effort = "high"`), and `default_permission_mode = "yolo"`
  auto-approves tools. `-p` cannot be combined with `--auto` or `--yolo` — it
  already runs non-interactively. Run it via **background Bash** so completion
  notifies the orchestrator. Write brief and log files OUTSIDE the repo (the
  session scratchpad), never inside it. Kimi briefs need the no-git and
  owned-files-only rules stated even more explicitly than Claude briefs, plus an
  explicit ban on creating scratch directories inside the repo and on creating
  any file the lane does not list.

- Every agent brief must contain: the lane's full section pasted verbatim from
  `implementation_plan.md`, the files it owns, the files it must not touch, the
  tests it must add/update, the commands it must run with exit codes reported
  verbatim, and that it must not commit, push, stash, or checkout.
- **Escalation protocol for persistent problems.** If a defect survives one
  dedicated fix lane, do NOT dispatch a second lane of the same kind. Escalate:
  1. Dispatch a **`fable` agent at xhigh effort to DEBUG AND PLAN ONLY** —
     reproduce the failure, find the true root cause, and write a detailed fix
     plan. It must not implement. Require stated evidence for the root cause, not
     a hypothesis, and a plain admission if it cannot reproduce.
  2. Then dispatch an **`opus` agent at high effort to APPLY that plan**, handing
     it the diagnosis verbatim. Its job is execution and verification, not
     re-diagnosis.
     This split exists because failures in this project are consistently
     mis-measurement rather than mis-implementation.
- Run independent lanes concurrently in a single dispatch; serialize anything
  that touches the same files (the wave schedule already encodes this — trust
  it).
- The orchestrator owns all builds, commits, and pushes to avoid artifact races.

## Wave completion targets

- **Wave 0** — plan docs committed; 5 PDFs present under `../reference/`; full
  gate suite run at HEAD; baseline SHA + failures recorded; any red baseline
  fixed before Wave 1.
- **Wave 1** — T1 scanner unit + animalwf suites green (8 models, 7 VACD→EPC
  edges, fail-closed ambiguity, cache no-reread proven); T2 splitter re-parses
  every output with zero diagnostics + per-model accounting matches the fixture
  oracle; T3 mints unique Model.IDs + GUID; T4 dictionary parity green; C1
  conventions catalog resolves every symbol + RACI map + legality; C2 comparator
  produces one diff row per mutation class; C3 direct-editing dep added
  (`check:lock` + `check:aris-runtime-boundary` green), editor activates on
  create/dblclick/F2 and commits under the active locale; F1 expectation JSONs +
  4 suites authored, iterate suites load, holdout config loads ONCE; F2 report
  script prints per-category counts.
- **Wave 2** — T5 tree renders semantic nesting (owned rows, reference rows,
  pills) from the real index/graph with the live overlay, model-explorer gated
  to `>1`, `ArisApp.test.tsx` green; T6 ⊞ markers + dblclick@2000 navigation +
  Link-model toolbar + rail Open, dangling-assignment noise gone via
  `externallyKnownModelIds`; T7 split-import staging + dialog tests green; C4
  palette shows every catalog symbol, quick-pick swaps (same-type +
  guarded cross-type) with single-undo, all wave-2/3 dictionary keys registered;
  C5 every catalog symbol resolves with zero fidelity findings and DMT fills,
  `test:aris:animalwf` still green (authored colors unchanged).
- **Wave 3** — T8 multi-file import writes split files (not tabs), cancel writes
  nothing, re-import skips, create-missing writes a pre-linked file in the
  parent's folder, cross-file open + live-overlay undo proven in
  `ArisApp.test.tsx`; T9 animalwf integration asserts the VACD owns 7 EPCs,
  move-safe links, 3-level nesting; C6 details rail surfaces the attribute
  schema with create-on-save; C7 five convention rules flow through
  `buildArisValidationFindings` (markers + rail rows); C8 both iterate fidelity
  suites are EXACT (`test:aris:animalwf` green) after the measured
  label→arrowhead→pen loop, derived-export suites still green.
- **Wave 4** — `aris-nested-processes` + `aris-import-split` +
  `aris-fidelity-screenshots` e2e green on chromium/firefox/webkit;
  `aris-canvas-interaction` covers direct-edit + quick-pick; npm scripts added;
  i18n final sweep green (`check:ui-copy` + `i18n.test.ts`).
- **Wave 5** — `npm run test:aris:animalwf:holdout` green on FIRST tuning-free
  run; the full suite in the plan's Wave-5 block passes end to end; artifact
  rebuilt, tracked, pushed; plan checkboxes all ticked; resolution evidence
  recorded.

## Definition of completion

Mark this goal complete only when all of the following are objectively true:

- Every lane checkbox in `implementation_plan.md` is ticked, and the Baseline
  record + Resolution evidence sections are filled.
- The four issues are verifiable in the built artifact:
  1. A directory/OPFS workspace shows the folder tree (icons, chevrons,
     selection, right-click + keyboard context menus, inline row actions,
     rename/move/delete, new-folder, drag-and-drop, external import drop);
     importing an AML writes one `.aml` per model into group-mirroring folders
     and they appear in the tree; a block with an assigned model shows the ⊞
     marker and double-click opens that model (in-document or cross-file);
     missing targets offer create-missing; multiple nesting levels render;
     rename/move keep links; `.orbitpm/**` is hidden; single-file mode keeps its
     flat list.
  2. A newly placed function accepts typed text immediately (Enter commits,
     Escape cancels, dblclick/F2 edit); the palette offers every convention
     symbol with its DMT color; a post-placement quick-pick swaps within a
     variant family.
  3. Symbols, colors, connection types + labels, RACI, and attribute schema
     follow the manual via `src/aris/conventions/`; convention-violation
     findings surface in the rail and on the canvas.
  4. Importing `ARISAMLExport.xml` renders the 2 iterate models within the
     fidelity bar (topology/numbering/symbol exact, color exact where
     PDF-confirmed, label geometry within ±2px), the 2 holdout models pass on
     the first tuning-free run, and screenshot artifacts exist for human
     comparison against the PDFs.
- The full gate suite passes: format, lint, typecheck, aris-runtime-boundary,
  ui-copy, no-skips, lite-only, check:lock, unit tests, `test:aris:animalwf`,
  `test:aris:animalwf:holdout`, and Playwright e2e on chromium, firefox, AND
  webkit.
- `release/OrbitPM-ARIS-Studio-Lite.html` is deterministic, current, tracked,
  and pushed at `origin/feat/aris-only-studio`.
- The worktree is clean and everything is pushed.

Do not claim completion because code compiles, focused tests pass, or the branch
is pushed. If a gate genuinely requires the user, finish everything else, state
the exact blocker, the required actor, and the safest resume point.

## Required final report

- Final commit SHA on `feat/aris-only-studio` and its pushed state.
- Per-wave, per-lane status with the exact evidence commands and their exit
  codes, and which worker (kimi / sonnet / opus48-1m) executed each lane.
- Canonical artifact path, byte size, and SHA-256.
- Test counts: unit suite total, `test:aris:animalwf` + `:holdout` totals, and
  per-engine e2e counts for chromium, firefox, webkit.
- The fidelity report summary for both iterate models (per-category diff counts,
  all zero at the bar) and the holdout verdict.
- The list of authorized-test-change diffs (file + what changed + which plan
  authorization item covers it).
- Every remaining external blocker with the actor and action required.
