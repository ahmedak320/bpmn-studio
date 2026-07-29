# Goal Prompt — ARIS Studio Lite UI & Feature Fixes (feat/aris-only-studio)

You are an **orchestrator only**. You do not implement, edit production code, or
write tests yourself. You evaluate the current state, plan dispatches, launch
worker agents per the model policy below, verify their results against the
plan's gates, and commit/push when gates pass.

Take the five UI/feature fixes described in `desktop/implementation_plan.md`
from the current baseline to completion by dispatching parallel agents, wave by
wave. This is an implementation and verification task, not a planning exercise.
Continue until the definition of completion below is objectively satisfied, or
until every independent in-scope task is finished and only a genuinely
unavoidable human/permission dependency remains.

## Authoritative sources

1. `/home/ahmed/Desktop/bpmn_tool/desktop/implementation_plan.md` — THE lane
   plan. Its wave schedule, file-ownership chains, lane specifications, and
   authorized-product-change list are binding. Its checkboxes are the progress
   ledger: tick them in the same commit as the lane's code.
2. `/home/ahmed/Desktop/bpmn_tool/desktop/aris_transformation.md` — the
   existing product contracts (AML immutability, accounting, §-numbered
   invariants, exit gates). New work must never contradict it.
3. This file — orchestration policy.

Resolve disagreement by inspecting current code, tests, and Git history. Retain
the strictest safety requirement.

## Repository facts (verify before acting)

- Working repository: `/home/ahmed/Desktop/bpmn_tool/desktop` (a nested Git
  repo; the outer `/home/ahmed/Desktop/bpmn_tool` is a separate legacy repo and
  ignores `desktop/`).
- Remote: `https://github.com/ahmedak320/bpmn-studio.git`
- Working branch: `feat/aris-only-studio` — push directly to it.
- Product identity: `OrbitPM ARIS Studio Lite` — a browser SPA (React 18 +
  Vite, single-file build). NOT Electron.
- Canonical rolling artifact: `release/OrbitPM-ARIS-Studio-Lite.html`.
- Private full-data fixture (never commit):
  `/home/ahmed/Desktop/bpmn_tool/reference/AnimalWF/ARISAMLExport.xml`
  (reachable from the repo as `../reference/AnimalWF/ARISAMLExport.xml`).
- **Wave 0 duty:** run the full gate suite at HEAD and record the true baseline
  (SHA + every failure verbatim) into the plan's "Baseline record" section
  BEFORE dispatching anything. Treat any document's completion claims as claims
  to verify, never as evidence.

## Mission

Fix five product issues (full lane detail in `implementation_plan.md`; the UX
decisions below were made by the user and are final):

1. **Folder tree.** Replace the flat explorer lists with the surviving
   `FolderTreeLite` component for multi-file workspaces: folders, chevrons,
   icons, context menus, rename/move/delete, new-folder, drag-and-drop move,
   external import drop, keyboard navigation. Single-file mode keeps the flat
   list. `ArisModelExplorer` (models of the active tab) stays.
2. **Drawing.** The ARIS editing engine already exists — expose it: a "New
   model" flow (blank MT_EEPC or MT_VAL_ADD_CHN_DGM, named, editable
   immediately, persisted as a visible `.aml` in directory workspaces),
   labeled + localized + iconed palette entries, localized context pad, a
   movable palette, and an empty-canvas drawing hint. bpmn-js stays banned from
   the runtime graph — never port it.
3. **Chatbot.** Replace the assistant modal with a chat drawer copied from
   main's UX: floating 💬 FAB, right-edge sliding panel, two tabs ("Ask the
   library" — key-free grounded Q&A with source chips, AI-on-miss behind the
   existing consent card; "Complete this process" — the gap-scan interview that
   applies undoable changes to the open model). The "✨ Generate with AI"
   header button becomes a true collapse toggle. Chat consent is KEPT.
4. **Generate panel.** Rebuild `ArisGenerationPanel` to main's `AiPanelLite`
   visual system, simplified to: Name, per-tab source (description +
   attachment | PDF/image | Excel), and AI provider/model choice. Model type is
   always auto-detected (control removed). The consent checkbox, outbound
   preview, and context/redact toggles are REMOVED from this create path.
   Excel tab keeps its blank/example template downloads prominent.
5. **Translation + fix.** Diagram labels follow the app EN⇄AR header toggle by
   default, with a per-diagram "Labels: EN/AR" override (pure view switch, zero
   undo entries, fallback never blanks a label). A Translate action feeds the
   surviving `TranslationReviewDialog` (free Google→MyMemory chain always;
   configured AI model when a key exists). Newly created models
   (`sourceKind === 'generated'`) auto-translate silently via the free chain —
   toast + single undo + settings opt-out; opened files show an "N
   untranslated" badge instead. A "N issues — Fix…" toolbar badge opens a
   three-tier fix dialog (safe fills / confirm-gated structural proposals /
   route to the chat interview).

## Execution rules

1. Work wave by wave in plan order (waves 0–9). Within a wave, dispatch every
   lane concurrently in a single message. Never start a wave before every lane
   of the previous wave passed its verification commands.
2. **One owner per contended file per wave.** The plan's ownership chains are
   binding. If a lane reports it must touch a file it does not own, stop it,
   re-scope, and re-dispatch — never let two concurrent agents edit one file.
3. Read the existing implementation and tests before changing a subsystem;
   require the same of every worker (each lane's "Read first" list).
4. Never weaken, skip, or delete an assertion to go green — EXCEPT the plan's
   explicitly authorized product-change test updates (consent removal from the
   create path, model-type removal, flat-list→tree, rail→drawer,
   modal→drawer). `npm run check:no-skips` must stay green. Workers must not
   "fix" the product to satisfy old tests that assert removed UI.
5. Every product-code commit must include a freshly built
   `release/OrbitPM-ARIS-Studio-Lite.html` produced by `npm run build:aris`.
6. Before each commit run, at minimum: `npm run typecheck`, `npm run lint`,
   `npm run check:aris-runtime-boundary`, `npm run check:ui-copy`,
   `npm test`, plus the wave's e2e where the plan lists it.
7. Commit in wave-scoped, reviewable commits; push directly to
   `feat/aris-only-studio`. Tick the plan's checkboxes in the same commit as
   the code they describe. No PRs, no GitHub CI runs — fast local loop.
8. Never commit `reference/AnimalWF/**`, API keys, `.claude/` state, or worker
   brief/log scratch files.
9. Never force-push, reset, rewrite history, stash, or checkout across agents
   sharing the worktree. Preserve unrelated user files.
10. Keep the worktree clean between waves.
11. Use the internet (diagram-js docs, ARIS AML references) whenever it reduces
    guesswork.

## Orchestration rules

- The lead session orchestrates and does not implement directly.
- **`sonnet` medium effort and `Kimi K2.7 Coding` are the default workers.**
- **Lane routing is pre-assigned in the plan and binding:**
  - **Kimi K2.7 Coding lanes — L1a, L2a, L1b, L3a, L5a, L3c, L2c, X3.** These
    MUST be dispatched to Kimi. Do not silently reroute them to Claude workers.
    If a Kimi lane fails verification, retry once with a sharper brief before
    escalating per the protocol below.
  - **sonnet medium lanes — X1** and the wave-9 documentation lane.
  - **opus-4.8[1m] high lanes — L2b, L5b, L1c, L3b, L4a, L3d, L5c, L2d, L5d,
    X2.** Dispatch these to the `opus48-1m` agent (defined at
    `~/.claude/agents/opus48-1m.md`: claude-opus-4-8[1m], high effort).
- **Kimi K2.7 Coding** is a local CLI, already authenticated. Invoke it
  headless from the repo root:

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
  owned-files-only rules stated even more explicitly than Claude briefs, plus
  an explicit ban on creating scratch directories inside the repo and on
  creating any file the lane does not list.

- Every agent brief must contain: the lane's full section pasted verbatim from
  `implementation_plan.md`, the files it owns, the files it must not touch,
  the tests it must add/update, the commands it must run with exit codes
  reported verbatim, and that it must not commit, push, stash, or checkout.
- **Escalation protocol for persistent problems.** If a defect survives one
  dedicated fix lane, do NOT dispatch a second lane of the same kind. Escalate:
  1. Dispatch a **`fable` agent at xhigh effort to DEBUG AND PLAN ONLY** —
     reproduce the failure, find the true root cause, and write a detailed fix
     plan. It must not implement. Require stated evidence for the root cause,
     not a hypothesis, and a plain admission if it cannot reproduce.
  2. Then dispatch an **`opus` agent at high effort to APPLY that plan**,
     handing it the diagnosis verbatim. Its job is execution and verification,
     not re-diagnosis.
     This split exists because failures in this project are consistently
     mis-measurement rather than mis-implementation.
- Run independent lanes concurrently in a single dispatch; serialize anything
  that touches the same files (the wave schedule already encodes this — trust
  it).
- The orchestrator owns all builds, commits, and pushes to avoid artifact
  races.

## Wave completion targets

- **Wave 0** — plan docs committed; full gate suite run at HEAD; baseline SHA +
  failures recorded in the plan; any red baseline fixed before wave 1.
- **Wave 1** — L1a/L2a/L2b/L1b/L3a/L5a/L5b all pass their lane verifications;
  `ArisApp.test.tsx` still fully green after the pane extraction; palette
  entries labeled + localized; canvas language projection unit-proven
  (zero-undo contract); localization adapter unit-proven (one-gesture apply).
- **Wave 2** — tree renders folders with context menus/drag-drop in directory
  mode and the updated `ArisApp.test.tsx` + `arisExplorerActions` tests pass;
  drawer UI + aiGate tests pass; StudioTab publishes the chat host and the
  improve rail is gone with `src/aris/shell` green; the rebuilt panel's three
  test files pass with no consent selector in the DOM.
- **Wave 3** — the drawer is mounted; all three openers correct (header button
  → drawer; section header → collapse; panel button → drawer); the old modal
  files are deleted; `ArisApp.test.tsx` green including the re-scripted
  interview test. Movable palette + empty-model hint tests green.
- **Wave 4** — translate toolbar controls + review dialog + silent
  auto-translate proven by `arisTranslateController.test.tsx`; `src/aris/shell`
  and `src/aris/localization` suites green.
- **Wave 5** — New-model dialog creates a blank EPC in directory mode
  (`writeAtomic` + tree row + open tab + hint), in single-file mode, and from
  the picker; collision suffixing proven; `ArisApp.test.tsx` green.
- **Wave 6** — fix planner classification invariant + idempotence tests green;
  the badge + three-tier dialog wired; Tier C routes into the chat drawer.
- **Wave 7** — `i18n.test.ts` green with every `tk()` key registered in
  `ARIS_SHELL_MESSAGE_KEYS` and both dictionaries; `check:ui-copy` green;
  `aris.ai.body` updated in both languages.
- **Wave 8** — every listed existing e2e spec updated and green; the three
  X3 specs written and green (chromium at minimum during the wave; all three
  engines by wave 9).
- **Wave 9** — the full suite in the plan's Wave-9 block passes end to end;
  artifact rebuilt, tracked, pushed; plan checkboxes all ticked; resolution
  evidence recorded.

## Definition of completion

Mark this goal complete only when all of the following are objectively true:

- Every lane checkbox in `implementation_plan.md` is ticked, and the Baseline
  record + Resolution evidence sections are filled.
- The five issues are verifiable in the built artifact:
  1. A directory workspace shows a folder tree with icons, chevrons, selection
     highlight, right-click and keyboard context menus, inline row actions,
     rename/move/delete, new-folder, and drag-and-drop move; `.orbitpm/**` is
     hidden; single-file mode still shows the flat list.
  2. A blank EPC can be created from the picker AND from the tree's New-model
     entries, drawn on immediately via a labeled localized palette, and edits
     undo via Ctrl+Z; the palette is draggable and its position persists.
  3. The 💬 FAB opens the right-edge chat drawer; the library tab answers
     key-free with source chips that reveal elements; the interview tab scans
     gaps, asks ≤3 questions per round, and applies safe changes as one
     undoable gesture; the old centered modal no longer exists; the
     "✨ Generate with AI" header collapses/expands the panel and persists.
  4. The generate panel shows main's visual system with exactly Name +
     per-tab source + provider/model; no model-type, consent, or outbound
     preview controls exist in the DOM; generation still works end-to-end with
     `'auto-detect'`; the Excel tab offers both template downloads.
  5. The header EN⇄AR toggle flips diagram labels (with per-diagram override);
     missing translations fall back and never blank; a generated model
     auto-translates silently with a toast and a single undo; opened files show
     the untranslated badge that opens the review dialog; the fix badge opens
     the three-tier dialog and confirmed fixes apply as one undoable step.
- The full gate suite passes: format, lint, typecheck, aris-runtime-boundary,
  ui-copy, no-skips, lite-only, unit tests, and Playwright e2e on chromium,
  firefox, AND webkit.
- `release/OrbitPM-ARIS-Studio-Lite.html` is deterministic, current, tracked,
  and pushed at `origin/feat/aris-only-studio`.
- The worktree is clean and everything is pushed.

Do not claim completion because code compiles, focused tests pass, or the
branch is pushed. If a gate genuinely requires the user, finish everything
else, state the exact blocker, the required actor, and the safest resume point.

## Required final report

- Final commit SHA on `feat/aris-only-studio` and its pushed state.
- Per-wave, per-lane status with the exact evidence commands and their exit
  codes, and which worker (kimi / sonnet / opus48-1m) executed each lane.
- Canonical artifact path, byte size, and SHA-256.
- Test counts: unit suite total, and per-engine e2e counts for chromium,
  firefox, webkit.
- The list of authorized-test-change diffs (file + what changed + which plan
  authorization item covers it).
- Every remaining external blocker with the actor and action required.
