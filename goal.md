# Goal Prompt — ARIS Studio Lite Waves 11–16: Translation, Docked Tools & Friendly Types, Render Fidelity, AI-Creation Evaluation (feat/aris-only-studio)

You are an **orchestrator only**. You do not implement, edit production code, or
write tests yourself. You evaluate the current state, plan dispatches, launch
worker agents per the model policy below, verify their results against the
plan's gates, and commit/push when gates pass.

Take the 13 issues described in `desktop/implementation_plan.md` from the current
baseline to completion by dispatching parallel agents, wave by wave (Waves
11–16). This is an implementation, evaluation, and verification task, not a
planning exercise. Continue until the Definition of Completion below is
objectively satisfied, or until every independent in-scope task is finished and
only a genuinely unavoidable human/permission dependency remains.

## Authoritative sources

1. `/home/ahmed/Desktop/bpmn_tool/desktop/implementation_plan.md` — THE lane
   plan. Its wave schedule, file-ownership matrix, lane specifications, embedded
   reference facts, verified anchors, i18n key tables, eval protocols, and
   authorized-product-change list are binding. Its checkboxes are the progress
   ledger: tick them in the same commit as the lane's code.
2. `/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md` — the existing
   product contracts (AML immutability, §-numbered invariants, exit gates). New
   work must never contradict it.
3. This file — orchestration policy.

Resolve disagreement by inspecting current code, tests, and Git history. Retain
the strictest safety requirement.

## Repository facts (verify before acting)

- Working repository: `/home/ahmed/Desktop/bpmn_tool/desktop` (a nested Git repo;
  the outer `/home/ahmed/Desktop/bpmn_tool` is a separate legacy repo and ignores
  `desktop/`). This directory IS the git root.
- Remote: `https://github.com/ahmedak320/bpmn-studio.git`
- Working branch: `feat/aris-only-studio` — push directly to it. No PRs, no GitHub
  CI runs — fast local loop. HEAD at planning time: `abe1d57`.
- Product identity: `OrbitPM ARIS Studio Lite` — a browser SPA (React 18 + Vite,
  single-file build). NOT Electron.
- Canonical rolling artifact: `release/OrbitPM-ARIS-Studio-Lite.html`, rebuilt via
  `npm run build:aris` in every product commit (orchestrator's job).
- **Second worktree (read/run-only):** `/home/ahmed/Desktop/bpmn_tool/desktop-w10`
  on branch `feat/aris-w10-cfp2` holds the deferred Wave-10 create-from-PDF v2
  pipeline. Lane P13 RUNS its harness there; it is **never merged** into
  `feat/aris-only-studio`. Do not commit its changes onto this branch.
- Private reference assets (NEVER commit; live OUTSIDE the repo under
  `/home/ahmed/Desktop/bpmn_tool/reference/`, reachable as `../reference/`):
  - `../reference/AnimalWF/ARISAMLExport.xml` — the full-data AML fixture (1 VACD plus 7 EPC models).
  - `../reference/AnimalWF/pdf/*.pdf` — the 4 reference process printouts.
  - `../reference/conventions/ARIS_Convention_Manual_DMT_v02.pdf` — the manual.
  - `../reference/AnimalWF/expected/*.expected.json` — fidelity expectations for 4
    processes.
  - `../reference/AnimalWF/crops/` — oracle crops + icon board (staged in Wave 11).
  - `../reference/AnimalWF/gen-tests/` — all P11/P12/P13 descriptions, workbooks,
    eval runs, and reports (never committed).
  - `../reference/openrouter.env` — the `OPENROUTER_API_KEY` for glm-5.2 (staged in
    Wave 11 from `~/.claude/jobs/501f0ce4/tmp/openrouter.env`).
- **Secrets:** lanes that call model APIs source keys via
  `set -a; . ../reference/openrouter.env; set +a` (OpenRouter/glm-5.2) or
  `set -a; . /home/ahmed/Desktop/bpmn_tool/.env; set +a`
  (`OPENAI_API_KEY` for gpt-5.6-terra, `ANTHROPIC_API_KEY` for claude-opus-4-8,
  `GEMINI_API_KEY`). NEVER print a key value, never commit it, never write it into
  a brief or log.
- **No Playwright MCP is configured** for this repo. Visual verification (zoom
  screenshots, before/after crops) uses the repo's own Playwright harness
  (`npm run test:e2e`, `tests/e2e/*.spec.ts`); the `claude-in-chrome` MCP is only
  a fallback for interactive spot checks.
- **Wave 11 duties (orchestrator):** run the full gate suite at HEAD and record
  the true baseline (SHA + every failure verbatim) into the plan's "Baseline
  record" section BEFORE dispatching anything; stage the `../reference/` assets
  and the OpenRouter key per the plan's `W11-ORCH` command block; install the
  humanizer skill (`git clone https://github.com/blader/humanizer
~/.claude/skills/humanizer`); smoke-test both a codex and an opus48-1m dispatch.
  If red at HEAD, dispatch a default-worker fix lane before Wave 12 and re-record.
  Treat any document's completion claims as claims to verify, never as evidence.

## Mission

Fix 10 product defects and run 3 AI-creation evaluation campaigns (full lane
detail in `implementation_plan.md`; the product decisions below were made by the
user and are final):

1. **Translation just works, and every process is auto-translated both ways.**
   Clicking Translate… → Translate now reliably produces translations and always
   reports its outcome; nothing is ever silent. Every created OR imported document
   is automatically translated so the user can toggle AR↔EN and always see
   translated labels — no manual steps. Importing the AnimalWF AML auto-translates
   its ~8 models; the language toggle then flips every function label.
2. **The tools palette is docked, not floating.** It moves into the right rail on
   the same pane as the details view, with tabs to switch between Details and
   Tools. Placement (click and drag) still works from the docked panel.
3. **The VACD "overall process" renders clean** — like the 7 EPC subprocesses,
   with no overlapping or huge blocks. Its grouping chevrons become background
   frames and its hierarchy lines are hidden, per the DMT convention manual.
4. **Text never leaks a block.** Function/step-block captions and the top-right
   reference-block text stay fully contained at every zoom, for long English and
   Arabic labels alike, via a systemic fix (not per-node edits).
5. **Gateway marks are zoom-stable and legended.** The X/∨/∧ inside XOR/OR/AND
   circles keep a consistent thickness relative to the circle at every zoom, and
   the three gateways appear in the bottom legend.
6. **The Requirements hand icon matches the ARIS reference PDF** (a fist with the
   index finger raised), redrawn from a high-DPI crop.
7. **The RACI legend shows Arabic** translations of R/A/C/I alongside the English.
8. **Small function / system-function blocks enforce a minimum size** so their
   icons never squish; imported and programmatic bounds stay verbatim.
9. **The process-interface block loses its grey duplication slab** under the
   caption — a clean grey banner with a white inset panel, per the ARIS original.
10. **Friendly type names everywhere.** Tooltips and the details pane show human
    names ("Log block", "Email block") — never raw `OT_/ST_/MT_` codes; hovering a
    placed block shows its friendly object type; right-click offers "Change object
    type…", which preserves connections, attributes, and names.
11. **Create-from-description is proven with glm-5.2.** Author humanized,
    scrambled, human-like descriptions of the AnimalWF processes at 3 detail levels
    in English, Modern Standard Arabic, and Emirati dialect; drive the real
    create-from-description pipeline; compare the drawing to the original;
    evaluate; improve the feature; repeat until a documented capture bar is met,
    producing the per-level "questions to ask the writer" list.
12. **Create-from-Excel is proven** the same way: fill the template as a human
    would at 3 fidelity levels, drive the real pipeline, evaluate, improve the
    template, and iterate to a documented capture bar.
13. **Create-from-PDF is re-evaluated** with gpt-5.6-terra and claude-opus-4-8
    against the current models, on both the v1 pipeline (this branch) and the w10
    v2 coarse-to-fine pipeline (the `desktop-w10` worktree). Report the result —
    **evaluation only, no production fix.**

## Model policy / worker routing (NEW — supersedes all earlier policies)

The 2026-07-31 "no codex" note is REVOKED: as of 2026-08-01 the user re-authorized
codex for complex lanes and set this scheme.

- **sonnet medium — simple / mechanical lanes.** `Agent` tool, `model: "sonnet"`.
  Lanes: L-I18N, L-P8, L-P10a, L-P10b, L-P7, L-P9→P6, L-P11-runner, and asset
  authoring.
- **codex gpt-5.6-sol xhigh — complex implementation lanes.** Lanes: L-P1a, L-P1b,
  L-P2, L-P10c, the P11/P12 improvement lanes, and the Emirati authoring/review.
  Dispatch via the codex plugin (`codex:codex-rescue` subagent or the
  `codex:rescue` skill) OR headless from the repo/worktree root:

  ```bash
  cd /home/ahmed/Desktop/bpmn_tool/desktop && \
  codex exec -m gpt-5.6-sol -c model_reasoning_effort="xhigh" "$(cat <brief-file>)" > <log> 2>&1
  ```

  (codex-cli 0.145.0 is installed; verify flags with `codex exec --help` on first
  use. Run via **background Bash** so completion notifies the orchestrator. Write
  briefs and logs OUTSIDE the repo, in the session scratchpad. Codex edits files
  directly, so its briefs must state owned-files-only + no-git + no scratch
  directories inside the repo + create no file the lane does not list.)

- **claude-opus-4-8[1m] high — complex Claude lanes.** Lanes: L-P4, L-P5, L-P3,
  L-P13. Dispatch: `Agent` tool with `subagent_type: "opus48-1m"` (defined at
  `~/.claude/agents/opus48-1m.md`: claude-opus-4-8[1m], high effort).
- **fable max — DEBUG + PLAN + JUDGE ONLY, never implements.** Use for the
  escalation diagnosis step, the P11/P12 per-round failure diagnoses, and the P13
  judging. Dispatch: `Agent` tool with `model: "fable"`, instructed to produce an
  evidence-backed root cause and a detailed plan, with a plain admission when it
  cannot reproduce.
- **Escalation protocol.** If a defect survives one dedicated fix lane, do NOT
  dispatch a second lane of the same kind. Escalate:
  1. Dispatch a **fable agent at max effort to DEBUG AND PLAN ONLY** — reproduce
     the failure, find the true root cause with stated evidence (not a
     hypothesis), and write a detailed fix plan. It must not implement.
  2. Then dispatch an **opus48-1m or codex lane to APPLY that plan**, handing it the
     diagnosis verbatim. Its job is execution and verification, not re-diagnosis.
     This split exists because failures in this project are consistently
     mis-measurement rather than mis-implementation.
- **Lane routing is pre-assigned in the plan's schedule table and binding.** If a
  Kimi-style local CLI is preferred later, the routing table is the source of
  truth; do not silently reroute. Retry a failed lane once with a sharper brief
  before escalating.

## Parallelization rules

1. Work wave by wave in plan order (Waves 11–16). Within a wave, dispatch every
   lane concurrently in a single message (multiple `Agent` calls and/or background
   Bash together). Never start a wave before every lane of the previous wave
   passed its verification commands.
2. **One owner per contended file per wave.** The plan's ownership matrix is
   binding. If a lane reports it must touch a file it does not own, stop it,
   re-scope, and re-dispatch — never let two concurrent agents edit one file.
3. The long-running P11/P12 tracks span Waves 12–15 and own only their disjoint
   directories (`src/aris/ai/*`, `src/aris/excel/*`, `../reference/.../gen-tests/**`);
   they must never collide with a wave lane's owned files.
4. Anything that would overlap another lane's files runs in a sibling `git
worktree` (keeps `../reference` paths valid; symlink `node_modules`; commit on
   the worktree's branch, then merge into the main tree only when it is clean).
5. Read the existing implementation and tests before changing a subsystem; require
   the same of every worker (each lane's "Read first" list).
6. The orchestrator owns ALL builds, commits, and pushes to avoid artifact races.
   Workers never run mutating git.

## Execution rules

1. Never weaken, skip, or delete an assertion to go green — EXCEPT the plan's
   explicitly authorized product-change test updates (floating-palette →
   docked-tools selectors; raw-code → friendly-name detail rows; generated-only →
   universal auto-translate e2e; 19 → 22 legend tiles; English-only → bilingual
   RACI; unconstrained → floored resize). `npm run check:no-skips` must stay green.
   Workers must not "fix" the product to satisfy old tests that assert removed
   behavior.
2. Every product-code commit must include a freshly built
   `release/OrbitPM-ARIS-Studio-Lite.html` produced by `npm run build:aris`.
3. Before each commit run, at minimum: `npm run typecheck`, `npm run lint`,
   `npm run check:aris-runtime-boundary`, `npm run check:ui-copy`,
   `npm run check:no-skips`, `npm test`, plus the wave's e2e and animalwf runs
   where the plan lists them.
4. Commit in wave-scoped, reviewable commits using the plan's commit messages;
   push directly to `feat/aris-only-studio`. Tick the plan's checkboxes in the same
   commit as the code they describe.
5. **Never commit** `reference/**` in any form (the AML fixture, the PDFs, the
   `expected/*.expected.json` files, the crops, the `gen-tests/**` descriptions /
   workbooks / runs / reports, or `openrouter.env`), nor API keys, `.claude/`
   state, or worker brief/log scratch files.
6. Never force-push, reset, rewrite history, stash, or checkout across agents
   sharing the worktree. Preserve unrelated user files. Keep the worktree clean
   between waves.
7. Use the internet whenever it reduces guesswork (diagram-js docs, OpenRouter /
   OpenAI / Anthropic model docs, Emirati-dialect references, the humanizer skill).

## Wave completion targets

- **Wave 11** — baseline recorded (SHA + failures verbatim); `../reference/` assets
  - OpenRouter key staged and reachable; humanizer installed; codex + opus48-1m
    smoke dispatches round-trip; L-I18N registered every campaign key with EN/AR
    parity green (`i18n.test.ts` + `check:ui-copy`).
- **Wave 12** — L-P1a translation-reliability suites green (T1–T4, T6, T7);
  L-P4 five weight-aware call sites + hard-break + clip, `typography.animalwf`
  fixture-fit green, before/after zoom screenshots captured; L-P8 resize floor
  tests green (min applied interactively, import verbatim); L-P10a resolver green;
  L-ASSETS descriptions authored at all levels/langs with verified facts manifests
  (humanized + scrambled; Emirati authenticity reviewed).
- **Wave 13** — L-P1b universal auto-translate: e2e `TR-auto-import` +
  `TR-auto-animalwf` green, badge equals review-row count, opt-out sweep applied to
  the unrelated specs; L-P5 zoom-ladder screenshots show a constant X:circle ratio
  and the legend has 22 tiles; L-P10b details rail shows friendly names with no raw
  `OT_/ST_` and the 3 keys deleted; L-P13 model-A/B report delivered; L-P11-runner
  `structureCompare` + both eval scripts green on a mock run.
- **Wave 14** — L-P2 rail-tools e2e green with no `.djs-palette` on the canvas and
  working docked placement; L-P3 VACD snapshot green (3 container frames, 12 hidden
  hierarchy edges) + screenshot vs manual p.18; L-P9/P6 process-interface + hand
  icon matched to the 600-dpi crops; L-P7 bilingual RACI screenshots in both
  languages; P11/P12 round 1 complete with a fable-max diagnosis.
- **Wave 15** — L-P10c change-type e2e green (connections survive a type change,
  single undo); P11/P12 converged to their capture bars OR plateaued for 2 rounds,
  with the eval reports + "questions to ask the writer" lists written.
- **Wave 16** — full gate suite green on chromium/firefox/webkit; artifact rebuilt,
  tracked, pushed; the evidence set + three eval reports present; every checkbox
  ticked; Baseline record + Resolution evidence sections filled.

## Definition of completion

Mark this goal complete only when all of the following are objectively true:

- Every lane checkbox in `implementation_plan.md` is ticked, and the Baseline
  record + Resolution evidence sections are filled.
- The 10 product fixes are verifiable in the built artifact:
  1. Importing the AnimalWF AML auto-translates (toast + `done` state); the content
     language toggle flips every function label to Arabic; Translate… → Translate
     now always reports a summary and never fails silently.
  2. The right rail has Details / Tools tabs; the Tools tab holds the symbol
     library with working click-and-drag placement; there is no floating palette on
     the canvas.
  3. The VACD overview renders as clean containing frames with no overlapping/huge
     blocks and no stray hierarchy lines, matching the 7 EPC subprocesses' style.
  4. Long English and Arabic captions stay inside their blocks at every zoom, and
     the top-right reference blocks no longer overflow.
  5. XOR/OR/AND marks hold a constant thickness relative to their circle at zoom
     0.4/1/2/4, and the three gateways appear in the legend.
  6. The Requirements hand icon matches the reference crop.
  7. The RACI legend shows Arabic alongside English.
  8. A newly placed function/system-function block cannot be resized below its
     descriptor default; imported blocks keep their exact bounds.
  9. The process-interface block shows a clean grey banner + white panel, no grey
     slab under the caption.
  10. Tooltips and the details pane show "Log block"-style names (never raw codes);
      hovering a block shows its friendly type; right-click → Change object type…
      converts a block while preserving its connections, attributes, and names.
- The 3 eval campaigns produced reports under `../reference/AnimalWF/gen-tests/`:
  `description-eval-report.md` (P11, glm-5.2, EN/MSA/Emirati × 3 levels, per-round
  score tables meeting the capture bar or an openly recorded plateau, plus the
  "questions to ask the writer" lists), `excel-eval-report.md` (P12, 3 fidelity
  levels, template improvements, before/after), and `pdf-model-ab-report.md` (P13,
  gpt-5.6-terra + claude-opus-4-8 vs baselines on v1 and w10-v2, with a
  recommendation).
- The full gate suite passes: format, lint, typecheck, aris-runtime-boundary,
  ui-copy, no-skips, csp, unit tests, `test:aris:animalwf`,
  `test:aris:animalwf:holdout`, and Playwright e2e on chromium, firefox, AND
  webkit.
- `release/OrbitPM-ARIS-Studio-Lite.html` is deterministic, current, tracked, and
  pushed at `origin/feat/aris-only-studio`.
- The worktree is clean and everything is pushed.

Do not claim completion because code compiles, focused tests pass, or the branch
is pushed. If a gate genuinely requires the user (e.g. a missing API key, an
exhausted live-eval budget), finish everything else, state the exact blocker, the
required actor, and the safest resume point.

## Required final report

- Final commit SHA on `feat/aris-only-studio` and its pushed state.
- Per-wave, per-lane status with the exact evidence commands and their exit codes,
  and which worker (sonnet / codex gpt-5.6-sol / opus48-1m / fable) executed each
  lane.
- Canonical artifact path, byte size, and SHA-256.
- Test counts: unit suite total, `test:aris:animalwf` + `:holdout` totals, and
  per-engine e2e counts for chromium, firefox, webkit.
- The P11 + P12 final-round score tables (per process × level × language) with the
  capture-bar verdict, and the P13 model-A/B recommendation.
- The list of authorized-test-change diffs (file + what changed + which plan
  authorization item covers it).
- Every remaining external blocker with the actor and action required.
