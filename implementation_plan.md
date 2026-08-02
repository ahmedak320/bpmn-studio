# ARIS Studio Lite — Waves 17–23: EPC Engine as a Service (Canonical Schema, Projection, Headless SVG, Package + CLI, Verification Contract, Enterprise Handoff) — Implementation Plan

> **For the orchestrator:** the commit protocol and worktree conventions live in `goal.md` (Waves 11–16 vintage); where this file's model policy, lane matrix, or dispatch mechanics differ from goal.md, THIS file supersedes it for Waves 17–23. THIS file is the work ledger — its checkboxes are the single source of progress truth. Tick them in the same commit as the lane's code. Kimi lanes dispatch via the fenced block in Global Constraints; Claude-family lanes via normal Agent/model settings. Lanes may equally be run by the user in their own sessions — this plan is executor-agnostic: every lane is self-sufficient from this file alone.
>
> **For workers:** you own ONLY the files your lane lists under "Owns". If completing your lane seems to require touching any other file, STOP and report back — do not touch it. Every step uses checkbox (`- [ ]`) syntax. Never run mutating git commands (commit, push, stash, checkout, reset, branch, rebase). Run every verification command listed for your lane and report each exit code verbatim. Your final message is machine-consumed: return raw findings, file lists, and command results — no pleasantries. Everything you need is in THIS file — you do not need the master-plan document or any prior conversation.
>
> **Previous campaign (Waves 11–16, COMPLETE)** lives at `8bbc01a` (the last commit carrying that ledger) — do not resurrect it. `aris_transformation.md` Phases 17/18 (§20–§21) stay PARKED, not superseded: Phase 17 is blocked on user-supplied ARIS artifacts, Phase 18 is release QA. The Experimental AML-export label (`ARIS_EXPORT_COMPATIBILITY_STATUS = 'experimental'`, `src/aris/writer/compatibility.ts:25`, keys `aris.export.experimentalLabel|Notice`) is NOT touched by this campaign.

**Goal:** Make bpmn-studio consumable by a private Azure enterprise repo (master-plan Part II §3) as a versioned dependency, while the studio UX ships unchanged. Six deliverables:

1. **CanonicalProcessV1** — a notation-neutral, bilingual (en/ar), evidence-linked zod `strictObject` contract + hand-written JSON Schema emitter under `src/aris/canonical/`, with valid + invalid fixtures.
2. **Projection canonical→EPC** — a deterministic pure function CanonicalProcessV1 → `ArisAiDraftV1`-shaped draft → existing AML/import/layout pipeline, with specified EPC expansion rules, alternation completion, structural validation BEFORE render, and a machine-readable bilingual findings artifact keyed by canonical logicalIds. Includes 2 NEW EPC rules the master plan requires (labeled decision branches, reachable end outcomes).
3. **Headless SVG render** — jsdom-booted `ArisCanvas` behind a `src/aris/headless/` entry: byte-stable SVG with embedded version/hash metadata (incl. a caller-supplied `sourceVersionId`) and `data-epc-node`/`data-epc-edge` anchors; model-derived bounds replace `getBBox`. PNG is **consumer-side** (the enterprise worker rasterizes via the injected-deps path — no engine rasterizer dependency).
4. **Package + CLI** — sub-package `packages/epc-engine/` (own manifest, jsdom-only runtime dep, built by a new `vite.lib.config.ts` into `packages/epc-engine/dist/`, NO npm workspaces, root manifest name/private untouched) + CLI `packages/epc-engine/bin/epc-project.mjs` (`validate` / `project` / `render`), CI-smoked.
5. **Review/verification contract** — anchored SVG + findings JSON + `buildVerificationPackage()` (purpose, trigger, outcome, owner, main flow, roles, systems, decisions, approvals (authority + threshold), unknowns, evidence summary, `narrativeSummary`) + a deterministic bilingual `narrative.md` from the same canonical version, all keyed by logicalId so the enterprise portal can implement Confirm/Correct per element. No React export — documented embed pattern only.
6. **Docs + handoff** — `docs/EPC_PROJECTION.md` + `docs/ENTERPRISE_HANDOFF.md` (interface contracts only), README/CONTRIBUTING updates.

### Enterprise EPC milestone alignment (user decisions, 2026-08-02)

Cross-checked against the enterprise "EPC generation and human verification" milestone. The architecture matches — notation-neutral canonical model, EPC as a generated view, deterministic regeneration (no duplicate artifacts), logicalId-anchored verification, corrections-as-new-versions. The workflow **states** (`ready_for_epc … verification_rejected`), the four review **actions'** persistence, the immutable **evidence store**, version **history** (v001/v002/v003), regeneration **jobs**, and Blob **storage** are ENTERPRISE-repo responsibilities: bpmn-studio stays a stateless engine (canonical in → artifacts out) and documents these only as interface contracts (L-DOCS). Repository protection / org-repo creation is enterprise-side and outside this repo's access. These decisions AMEND the lanes below:

- **Narrative = deterministic, in bpmn-studio.** A bilingual (EN/AR) `narrative.md` is derived by template from the same `CanonicalProcessV1` (no LLM → byte-stable, consistent with the model; Gold-Case criterion 3, master-plan §7 step 5). New `buildProcessNarrative(process): ProcessNarrativeV1` in `src/aris/canonical/narrative.ts`, **folded into L-VPKG** (same sonnet-medium lane, same canonical spine). The CLI `render`/`project` write `narrative.md`; `buildVerificationPackage` embeds a `narrativeSummary`.
- **PNG = consumer-side (unchanged).** The engine guarantees SVG + metadata only; the Azure worker rasterizes to PNG via the injected-deps path (`arisSvgToPngDataUrl`). No engine rasterizer dependency (keeps the jsdom-only runtime dep).
- **Adapter maps to CanonicalProcessV1 (contract unchanged).** `CanonicalProcessV1` stays binding; the thin enterprise `epc-adapter` maps the flat payload → contract: `processId → identity.id`, `versionId → renderCanonicalProcess options.sourceVersionId`, `name → identity.names`, `evidenceReferences → facts[].evidenceRefs`. Documented in `ENTERPRISE_HANDOFF.md` (L-DOCS).
- **`sourceVersionId` passthrough.** `renderCanonicalProcess(process, {sourceVersionId?})` stamps `data-epc-source-version` on the SVG root and into `metadata.json`; the CLI gains `--version <id>`. Amends L-HEADLESS T4 + L-CLI.
- **`purpose` + approvals.** `identity.purpose?: CanonicalText` added to the contract (L-SCHEMA); `buildVerificationPackage` gains `purpose` and `approvals: [{decisionId, authority (owner/approver role id), threshold?: CanonicalText}]` (Gold-Case criterion 4). Amends L-SCHEMA + L-VPKG.
- **Extra fixtures/tests.** L-FIXTURES adds a loop/return-path process and a missing-role process (surfaced as an `unknown`, not a hard error); L-PROJECT asserts the return path survives projection and interacts correctly with the reachability rule.
- **AnimalWF corpus now available** (user-supplied 2026-08-02, sha256 `38db10f0…7926f5`; 8 models / 279 ObjDef / 465 Cxn / 16 lanes; bilingual AEar+USen). No longer unconditionally environment-blocked — when placed at `../reference/AnimalWF/ARISAMLExport.xml` (never committed; ephemeral per session), the fidelity/golden/animalwf suites run, adding real-model validation of the headless render (D3). Amends the Private-reference-assets constraint + W17-ORCH baseline + campaign verification.

**Architecture:** The engine stays where it is — ALL implementation lands under `src/aris/**` (so vitest include, the 80 % coverage denominator, lint, and typecheck keep working); `packages/epc-engine/` is a build artifact + manifest + bin shim only. The canonical→EPC projection lives INSIDE bpmn-studio (public, reusable); the private repo's `epc-adapter/` stays thin (subprocess/import of this engine). The headless path reuses the live diagram-js renderer under jsdom (the recommended path: ~90 % existing code, two seams), NOT a second string renderer. The studio browser app is untouched except the Authorized product changes below.

**Tech stack:** React 18.3 + Vite 6 single-file SPA (unchanged); diagram-js 15.22.0 canvas; zod 4.4.3; vitest 3.2.7; Playwright 1.61.1; jsdom 29.1.1 (already a root devDependency — ZERO new root dependencies is a hard target). New: Vite library build (`vite.lib.config.ts`) + Node CLI. Browser SPA, single-file build. NOT Electron. NOT a server — the CLI is a headless batch tool for the same engine, no server/bridge/desktop shell.

---

## Global Constraints

Every task's requirements implicitly include this section.

- Repo: `/home/user/bpmn-studio` (this directory IS the git root). **Campaign branch: `claude/bpmn-studio-implementation-plan-c13dn3`** at baseline HEAD `8bbc01a`. The repo default branch is `main`; the old `feat/aris-only-studio` does NOT exist on this remote — never reference it in commands. Canonical artifact: `release/OrbitPM-ARIS-Studio-Lite.html`, rebuilt via `npm run build:aris` in every product commit (orchestrator's job).
- **Private reference assets** (`../reference/AnimalWF/**`). The AnimalWF export was **user-supplied on 2026-08-02** (sha256 `38db10f0…7926f5`; 8 models, 279 ObjDef, 465 Cxn, 16 lanes, bilingual AEar+USen). It is NOT committed (private asset, gitignored) and is NOT auto-present in a fresh remote container — it must be placed at `../reference/AnimalWF/ARISAMLExport.xml` (one level above the repo root) at the start of any session/env that runs the fidelity suites; because containers are ephemeral it is re-supplied per session. Where absent, `*.animalwf.test.ts`, `test:aris:animalwf|holdout|phase16|golden|fidelity-report` self-guard (throw-at-module-load, by design — never a skip) and are recorded as environment-blocked; where present, they run and provide real-model validation of the projection + headless render. No campaign deliverable strictly depends on them (synthetic fixtures cover the contract), but they are the strongest available evidence — run them whenever the asset is placed.
- **Gate commands** every lane runs before reporting done (plus lane-specific extras listed per lane):

  ```bash
  npm run typecheck && npm run lint && npm run check:aris-runtime-boundary && npm run check:ui-copy && npm run check:no-skips && npm run check:lite-only
  npx vitest run <lane's test paths>
  npx prettier --write <every file the lane touched>   # format:check is a CI gate; prettier also checks packages/** and docs/**
  ```

- **Kimi execution mechanics** — the orchestrator dispatches kimi lanes through the Claude Code CLI against Moonshot's Anthropic-compatible endpoint:

  ```bash
  export ANTHROPIC_BASE_URL="https://api.kimi.com/anthropic"   # or https://api.moonshot.ai/anthropic
  export ANTHROPIC_AUTH_TOKEN="$KIMI_API_KEY"                  # from local secrets, never committed
  export ANTHROPIC_MODEL="<kimi-k2.7 model id>"                # verify exact id at dispatch: /model or provider docs
  export ANTHROPIC_SMALL_FAST_MODEL="<kimi-k2.7 model id>"
  MAX_THINKING_TOKENS=32000 claude -p "<lane prompt>"          # xhigh lanes: kimi k3 id + larger thinking budget
  ```

  Exact model IDs are **verify-at-dispatch** (do not treat the placeholders as facts). `kimi k3 xhigh` lanes use the kimi k3 model id with a larger `MAX_THINKING_TOKENS` budget. Claude-family lanes (`sonnet medium`, `opus48 high`, `fable max (judge)`) dispatch via normal Agent/model settings. Any lane may instead be executed by the user in their own session — the lane briefs below are complete either way. NEVER echo a key value, never commit one, never write one into a brief or log.

- **Determinism is a first-class requirement everywhere.** No `Date.now`, no `Math.random`, no `crypto.getRandomValues`-derived ids in ANY new module. Same input + same engine version ⇒ byte-identical output for: projection draft JSON (via `canonicalJsonText`), AML, layout, findings JSON, SVG markup, verification package. Every producing lane ships a double-run byte-identity test. The one existing determinism hole — `src/aris/writer/ids.ts` `defaultRandom()` (:158-179) — is AVOIDED: all campaign ids use the `prefix.logicalId` scheme (`arisIdForLogicalId`, `src/aris/shell/arisAiCreate.ts:49-51`). Never import the ids.ts allocator in campaign code.
- **Runtime-boundary rules** (`scripts/check-aris-runtime-boundary.mjs` walks runtime imports from `src/main.tsx`; type-only imports exempt): the new `src/aris/headless/**` and `src/aris/canonical/**` entries are NOT reachable from `src/main.tsx` and are therefore not walked — legal. But any unresolved local import INSIDE the walked graph fails hard, and moving ANY `bpmn-*` package from devDependencies to dependencies fails immediately. The new EPC rules (L-EPC-RULES) DO enter the walked graph via `src/aris/epc/validate.ts` — keep them dependency-clean (epc/ imports nothing outside epc/).
- **dist/ purity:** `scripts/check-artifact-size.mjs:13-34` fails if `dist/` contains anything but `index.html`. The library build emits ONLY into `packages/epc-engine/dist/` (git-ignored), NEVER into `dist/`. `scripts/clean-output.mjs:6` allowlists only `'dist'` — L-PKG edits the allowlist (authorized change 3).
- **Root manifest discipline:** root `package.json` keeps `"name": "orbitpm-aris-studio-lite"` (pinned by `check-lite-only.mjs`) and `"private": true`. The ONLY root-manifest edits authorized are script additions (`build:lib`, `clean:lib`). ZERO new root dependencies or devDependencies; lockfile untouched (`check:lock` requires exact pins + JSON-identical manifest/lock roots; CI runs `git diff --exit-code package.json package-lock.json` after `npm ci`). Consequently `license:check` (19-license allowlist) and `sbom` (production lockfile closure) are unaffected — verify they still pass, change nothing in them.
- **Coverage / test placement:** the `overall` coverage profile is `src/**/*.{ts,tsx}` at 80 % branches/functions/lines/statements (`scripts/run-coverage.mjs`), and vitest `include` is `src/**` ONLY — tests outside `src/` never run. Therefore: every new `src/` module ships with its unit tests IN THE SAME LANE, tests live under `src/aris/{canonical,headless}/`, and the CLI (which must print to stdout — `no-console` is an error in `src/**`) lives OUTSIDE `src/` in `packages/epc-engine/bin/` with its coverage provided by `scripts/epc-engine-cli.test.mjs` (node:test, wired into quality.yml exactly once — `check:no-skips` enforces this).
- **Path-segment bans** (`check-lite-only.mjs`): `packages/`, `bin/`, `cli/` are legal path segments; `server`, `bridge`, `desktop`, `installer`, `updater`, `docker` are banned at any depth — never name anything with them, including in docs filenames.
- **Workflow discipline:** NO new workflow files this campaign. Touch exactly (a) the two workflow-inventory scripts (authorized change 1) and (b) the `node --test` line in `quality.yml`'s policy job (authorized change 4). `check-release-workflows.mjs` pins the exact job lists of release.yml/pages.yml/pages-rollback.yml — never add jobs there. **npm registry publishing is DEFERRED**: the package is consumed via `npm pack` tarball or git dependency (see `docs/ENTERPRISE_HANDOFF.md`); a future publish workflow is a noted follow-up requiring its own authorized change + both inventory updates + `id-token: write`.
- **Version drift (note-only, parked):** root version is `0.5.0` while release.yml/pages.yml/`release-workflow-critical-invariants.mjs` pin `v0.4.5`. This campaign does not touch the tag-release path; `packages/epc-engine` versions independently at `0.1.0`.
- **i18n rules:** any user-visible STUDIO string goes through `t()` with keys in BOTH `en`/`ar` maps of `src/i18n/dictionaries.ts` (parity compile-enforced). This campaign adds NO new `.tsx` — `check:ui-copy` scans `src/**/*.tsx` only, so pure-`.ts` engine modules are out of its scope; the two new EPC rule messageKeys ARE registered in dictionaries (they surface in the live rail). The canonical module carries its own EN/AR finding-message tables for the machine-readable artifact, drift-tested against the dictionaries.
- **Lint:** `--max-warnings 0`; `no-console` error in `src/**` (only `console.error|warn`); new non-`src` locations get eslint coverage per authorized change 3.
- **No test games:** no `.skip`/`.only`, retries, quarantines, or inflated timeouts — `npm run check:no-skips` stays green. New `scripts/*.test.mjs` must appear exactly once in a `node --test` command in quality.yml; any new e2e spec must be added to `REQUIRED_BROWSER_SUITES` in `scripts/release-suite-manifest.mjs` (both directions enforced).
- **Worktrees** (goal.md conventions): within a wave, lanes sharing no files run in the main tree; if the orchestrator wants physical isolation, use sibling worktrees `git worktree add ../bpmn-studio-w<lane> <branch>` and fold back via the orchestrator (workers never run mutating git). Orchestrator owns all builds/commits/pushes.

### Authorized product changes

The user explicitly requested these; updating tests/guards that assert the OLD behavior is **required work, not assertion-weakening**. Workers must NOT "fix" the product to satisfy old guards.

1. **Workflow-inventory fix (pre-existing red at HEAD):** `pages-aris.yml` is added to the hard-coded inventories in `scripts/check-actions.mjs:9-15` and `scripts/check-release-workflows.mjs:8-14`. This makes `check:actions` and the release-invariants script green again; `pages-aris.yml` is already SHA-pinned and avoids `upload-pages-artifact` (verified), so the pin/ban scans it now enters must pass unchanged.
2. **CONTRIBUTING.md carve-out:** lines 3-5 ban an "alternate executable application". Amend to explicitly permit "a headless Node CLI for the same engine (`packages/epc-engine/bin/`), which is a batch projection/render tool — still no server, bridge, desktop shell, installer, or updater." This is the house mechanism for exactly this change.
3. **New-location plumbing edits:** `scripts/clean-output.mjs:6` allowlist gains `'packages/epc-engine/dist'`; `eslint.config.js` gains `packages/epc-engine/bin/**/*.mjs` (node globals, mirroring the exception block at `eslint.config.js:66-79`) and ignores `packages/epc-engine/dist/**`; `.prettierignore` and `.gitignore` gain `packages/epc-engine/dist/`; root `package.json` gains scripts `build:lib` + `clean:lib` (nothing else); `tsconfig.json` is expected to need NO edit (`*.config.ts` already covers `vite.lib.config.ts`; the bin is `.mjs`) — an include addition is pre-authorized only if a stray `.ts` proves necessary.
4. **quality.yml `node --test` line:** `scripts/epc-engine-cli.test.mjs` is appended to the existing folded `node --test` command in the policy job (the 10-file list becomes 11). No other workflow edit.
5. **README scope note:** a short "EPC engine as a service" section (what `packages/epc-engine` is, that the studio UX is unchanged, pointer to the two docs).
6. **New EPC rules surface in the product:** `epc.rule.unlabeledDecisionBranch` and `epc.startEnd.unreachableEnd` (both `error`) join `validateEpcGraph` — they will appear in the live EPC rail, canvas markers, gap scanner, and AI-generation repair turns. Updating `arisEpcFindings`/`gapScanner`/`epcSemantics` tests and any fixture counts they change is required work. Fixtures that were only "valid" by omission (unlabeled XOR branches) get labels, not weakened assertions.
7. **e2e manifest addition:** `tests/e2e/aris-headless-parity.spec.ts` is added to `REQUIRED_BROWSER_SUITES` (`scripts/release-suite-manifest.mjs`).

Nothing else in the studio UX, CSP, providers, or release lifecycle changes.

---

## Wave / lane schedule + ownership matrix

Within a wave, every lane is dispatched concurrently. No wave starts before every lane of the previous wave passed its verification commands. **One owner per contended file per wave** — the "Owns" column is binding.

| Wave | Lane        | Worker                                  | Owns (exclusive this wave)                                                                                                                                                                                                                                        |
| ---- | ----------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17   | W17-ORCH    | orchestrator                            | baseline record; branch/worktree setup; kimi + claude dispatch smoke; environment-blocked-suite census                                                                                                                                                            |
| 17   | L-POLICY    | kimi k2.7                               | `scripts/check-actions.mjs`, `scripts/check-release-workflows.mjs`, `CONTRIBUTING.md`, `README.md`                                                                                                                                                                |
| 18   | L-SCHEMA    | sonnet medium                           | NEW `src/aris/canonical/contract.ts`, NEW `src/aris/canonical/jsonSchema.ts`, NEW `src/aris/canonical/index.ts`, NEW `src/aris/canonical/contract.test.ts`, NEW `src/aris/canonical/jsonSchema.test.ts`                                                           |
| 18   | L-FIXTURES  | kimi k2.7                               | NEW `src/aris/canonical/fixtures.ts`, NEW `src/aris/canonical/fixtures.test.ts`                                                                                                                                                                                   |
| 18   | L-EPC-RULES | kimi k3 xhigh                           | `src/aris/epc/validate.ts`, the epc validate test file, `src/aris/ai/epcSemantics.ts`, `src/aris/shell/arisValidationFindings.ts`, `src/i18n/dictionaries.ts` (2 keys EN+AR only), their touched tests                                                            |
| 19   | L-PROJECT   | kimi k3 xhigh                           | NEW `src/aris/canonical/projectToEpc.ts`, NEW `src/aris/canonical/findings.ts`, NEW `src/aris/canonical/findingMessages.ts`, NEW `src/aris/canonical/projectToEpc.test.ts`, NEW `src/aris/canonical/findings.test.ts`, `src/aris/canonical/index.ts` (re-exports) |
| 19   | L-VPKG      | sonnet medium                           | NEW `src/aris/canonical/verificationPackage.ts`, NEW `src/aris/canonical/verificationPackage.test.ts`, NEW `src/aris/canonical/narrative.ts`, NEW `src/aris/canonical/narrative.test.ts`                                                                          |
| 20   | L-HEADLESS  | opus48 high                             | NEW `src/aris/headless/*` (index, environment, render, version, tests), `src/aris/canvas/testing/jsdomSvg.ts` + `harness.ts` (header/promotion edits), `src/aris/canvas/exportArisPdf.ts` (+its test)                                                             |
| 21   | L-PKG       | opus48 high                             | NEW `vite.lib.config.ts`, NEW `packages/epc-engine/package.json`, NEW `packages/epc-engine/README.md`, `scripts/clean-output.mjs`, `eslint.config.js`, `.prettierignore`, `.gitignore`, root `package.json` (scripts only)                                        |
| 21   | L-PARITY    | opus48 high                             | NEW `tests/e2e/aris-headless-parity.spec.ts`, NEW `tests/e2e/helpers/arisHeadlessRender.ts`, NEW `tests/e2e/fixtures/epc-parity-canonical.json`, `scripts/release-suite-manifest.mjs`                                                                             |
| 22   | L-CLI       | sonnet medium                           | NEW `packages/epc-engine/bin/epc-project.mjs`, NEW `scripts/epc-engine-cli.test.mjs`, `.github/workflows/quality.yml` (node --test line only)                                                                                                                     |
| 22   | L-DOCS      | kimi k2.7                               | NEW `docs/EPC_PROJECTION.md`, NEW `docs/ENTERPRISE_HANDOFF.md`                                                                                                                                                                                                    |
| 23   | W23-JUDGE   | fable max (judge)                       | read-only review reports (scratchpad only — judge never implements)                                                                                                                                                                                               |
| 23   | W23-FIX     | opus48 high / sonnet medium (as routed) | files named by accepted judge findings only                                                                                                                                                                                                                       |
| 23   | W23-SHIP    | orchestrator                            | full gates, artifact, evidence, ledger, push                                                                                                                                                                                                                      |

**Serialization rationale (binding):** `src/aris/epc/validate.ts` is owned ONCE (L-EPC-RULES, W18) and thereafter read-only — L-PROJECT (W19) consumes the new rules through `validateEpcGraph`, never edits them. `src/aris/canonical/index.ts` chain: L-SCHEMA (W18) creates it → L-PROJECT (W19) is its sole W19 owner and adds BOTH its own re-exports AND the `buildVerificationPackage` re-export line (the export name is fixed by this plan, so L-PROJECT does not need L-VPKG's file to exist first); L-VPKG touches only its own two files. `src/i18n/dictionaries.ts` is touched ONLY by L-EPC-RULES (W18). `src/aris/canvas/testing/*` and `exportArisPdf.ts` only by L-HEADLESS (W20). Root `package.json`, `eslint.config.js`, `clean-output.mjs`, ignore files only by L-PKG (W21). `quality.yml` and `scripts/` workflow-guard files: L-POLICY (W17, the two inventory scripts) → L-CLI (W22, quality.yml + the new scripts test) — never both in one wave. `scripts/release-suite-manifest.mjs` only by L-PARITY (W21). This ordering also guarantees the CLI (W22) builds against a lib build config that already exists (W21), and the parity spec (W21) runs against headless code that landed in W20.

---

## Embedded reference facts (workers use these instead of re-deriving)

All anchors verified against the working tree at `8bbc01a`. Corrections found during verification are marked **[VERIFIED]**.

### Build system + guard scripts (constraints on every lane)

`npm run build` = `vite build` → single inlined `dist/index.html`; plugin order `embedAppVersionMarker(), stripLegacyBpmnSvgFont(), react(), viteSingleFile()` (`vite.config.ts:72`). `embedAppVersionMarker()` THROWS if `data-orbitpm-app-version` already exists — it must NOT be reused in the lib config. `check:size` (`scripts/check-artifact-size.mjs:13-34`): when the artifact is `index.html`, its directory must contain ONLY `index.html`; raw ≤ 8 MiB, gzip ≤ 2.5 MiB. `clean-output.mjs:6` — `allowedTargets = new Set(['dist'])`. `build:aris` = build + `scripts/update-rolling-artifact.mjs` → `release/OrbitPM-ARIS-Studio-Lite.html`. `check:lock`: lockfileVersion 3, `npm@11.13.0`, every dep exact `x.y.z`, manifest/lock roots JSON-identical; CI Node `22.22.0`. `check:lite-only`: banned path segments `desktop|installer|updater|server|bridge|docker` at any depth; root manifest name pinned `orbitpm-aris-studio-lite`; electron/docker word-scan of the scripts blob; import scan of `src|tests|scripts`. `check:aris-runtime-boundary`: TS-AST BFS from `src/main.tsx` only; type-only imports exempt; fails on any unresolved local import in the graph and on any `bpmn-*` package in `dependencies`. `check:no-skips`: no `.skip/.only/retries` anywhere in `src|tests|scripts/*.test.mjs`; every tracked `scripts/*.test.mjs` exactly once in a quality.yml `node --test` command (current list: 10 files in the policy job, step "Release evidence verifier regression tests"); `REQUIRED_BROWSER_SUITES` (`scripts/release-suite-manifest.mjs`, currently 22 specs) must equal tracked `tests/e2e/*.spec.ts` exactly. `check:ui-copy` scans `src/**/*.tsx` ONLY. Coverage: `scripts/run-coverage.mjs` `overall` profile = `src/**/*.{ts,tsx}` at 80 % b/f/l/s (plus 4 focused 90 % profiles, none touching aris). vitest: `environment: 'node'`, `include: src/**/*.test.ts(x)`, jsdom opt-in per file via `// @vitest-environment jsdom` docblock. eslint: `applicationFiles = ['src/**/*.{ts,tsx}','tests/**/*.{ts,tsx}','*.{config,setup}.ts']`, `scripts/**/*.mjs` covered with node globals at `eslint.config.js:23-29`, exception-block pattern at `:66-79`. Prettier checks everything not in `.prettierignore` (which already has `*.xml`, `*.xlsx`; NOT `.svg` — prettier has no svg parser, so committed SVG fixtures are safe). Workflow inventory red at HEAD: 6 files on disk, `check-actions.mjs:9-15` + `check-release-workflows.mjs:8-14` expect 5 (missing `pages-aris.yml`); `pages-aris.yml` is SHA-pinned, uses `upload-artifact`+`deploy-pages` (NOT the banned `upload-pages-artifact`), single job `deploy` **[VERIFIED]**.

### Engine module map + purity verdicts

Pure Node (no DOM at all): `src/aris/model/**` (`ArisWorkingDocument` `types.ts:335`; `buildFromSource` `buildFromSource.ts:623`; `applyCommand` `commands.ts:1125`), `src/aris/epc/**` (`toEpcGraph` `adapter.ts`, structurally typed — the sanctioned producer seam), `src/aris/layout/**` (all 12 modules; `cleanLayout` `cleanLayout.ts:483`, header :19-24 documents "no Math.random and no clock… byte-identical JSON"), `src/aris/renderer/**` (incl. `textWrap.ts` AFM tables + 3-tier Arabic table, `measureTextWidth` :340), `src/aris/source/xmlTokenizer.ts` (`tokenizeXmlDocument` :705) + `semanticIndex.ts` (`buildSemanticArisDocument` :956), `src/aris/canvas/layoutSeam.ts` `buildLayoutGraph` (:115), `canvasSync.ts` geometry helpers (`modelContentBounds` :318), `typography.ts`, `bidi.ts`, `fitView.ts` (`arisContentBounds` :88 — includes occurrence/freeText/**label**/connection elements, i.e. external captions, which the jsdom `getBBox` shim misses), `printFrame.ts` `buildPrintFrame`, `emptyDocument.ts`. jsdom-OK (needs only `createElementNS` + the shim): `svg.ts`, `renderer.ts` `drawShape`:1040/`drawConnection`:1396, `ArisCanvas.create` (`ArisCanvas.ts:72`; `applyCleanLayout` :268; `setPrintFrameVisible(false)` `renderer.ts:905`) + the full diagram-js module list — proven by ~40 canvas suites booting via `src/aris/canvas/testing/harness.ts` `bootCanvas` (:48) + `src/aris/canvas/testing/jsdomSvg.ts` `installJsdomSvgSupport()` (:329) / `createCanvasContainer(w=1200,h=800)` (:427). jsdom-approximate: `measureArisCanvasSvgBounds` (`exportArisPdf.ts:480`, `getBBox`-based — the shim returns null for `<text>` at `jsdomSvg.ts:252-256`), `collectArisExportTextRuns` (:507, `getScreenCTM` — PDF-only). Browser-only: `browserArisSvgToPngDeps` (:611), `exportArisCanvasPdf` (:642). `arisSvgToPngDataUrl(markup, size, deps)` (:360) takes INJECTED `createCanvas`/`loadImage` deps — Node-testable, PNG stays optional with no new rasterizer dependency. `EXPORT_STRIP_SELECTOR` (:426-427) = `.djs-outline, .djs-segment-dragger, .djs-bendpoint, [data-aris-kind="lane"]`; `buildArisExportSvgMarkup(svgRoot, bounds, padding)` (:448) accepts arbitrary bounds and clones the live SVG (attributes on `.djs-element` groups survive). Vite-only specifier trap: `src/aris/source/browserXmlTokenizer.ts:1` imports `./xmlTokenizer.worker?worker&inline` — the headless entry NEVER imports `browserXmlTokenizer`/`sourcePackage`; it calls `tokenizeXmlDocument` directly. Arabic/RTL works headlessly: measurement is table-driven (`textWrap.ts`), direction attrs from `canvas/bidi.ts:27` (`direction=rtl` + `unicode-bidi=plaintext` when Arabic present); the SVG references font families by name only (`Noto Sans Arabic`, Arial) — consumers rasterizing must provide fonts (documented, not solved here).

### The recommended headless pipeline (build exactly this chain)

```
CanonicalProcessV1
  → parseCanonicalProcess (zod)          src/aris/canonical/contract.ts       [NEW, pure]
  → projectCanonicalToDraft              src/aris/canonical/projectToEpc.ts   [NEW, pure] → ArisAiDraftV1 + anchor map
  → validateArisAiDraft                  src/aris/ai/validateDraft.ts:58-75   [pure]
  → per-model toEpcGraph + validateEpcGraph  (template: src/aris/ai/epcSemantics.ts:103-153 adapterModelFor)  ← GATE BEFORE RENDER
  → buildAmlFromArisAiDraft              src/aris/shell/arisAiCreate.ts:76    [pure; ids = prefix.logicalId :49-51; geometry col x=240,y=120+i*160]
  → tokenizeXmlDocument                  src/aris/source/xmlTokenizer.ts:705  [pure]
  → buildSemanticArisDocument            src/aris/source/semanticIndex.ts:956 [pure]
  → buildFromSource                      src/aris/model/buildFromSource.ts:623[pure] → ArisWorkingDocument
  → jsdom boot + installJsdomSvgSupport() + createCanvasContainer            [src/aris/canvas/testing/jsdomSvg.ts]
  → ArisCanvas.create({container, document, modelId, minimap:false})          [ArisCanvas.ts:72]
  → canvas.applyCleanLayout((graph) => cleanLayout(graph))                    [ArisCanvas.ts:268 — the app's own one-liner]
  → setPrintFrameVisible(false) on the renderer                              [renderer.ts:905]
  → stamp data-epc-node/data-epc-edge on live .djs-element groups via elementRegistry
  → bounds = arisContentBounds(elementRegistry.getAll())                     [fitView.ts:88 — replaces getBBox]
  → buildArisExportSvgMarkup(svgRoot, bounds)                                [exportArisPdf.ts:448; no text-runs overlay]
```

### Live IR + vocabularies (the projection target)

`ArisAiDraftV1` (`src/aris/ai/contract.ts:271-291`, zod `strictObject`, no defaults/coercion): `{version:1, models[], objects[], relations[], attributes[], assignments[], uncertainties[]}`. `ArisAiObject` (:153-177): `logicalId, modelLogicalId, objectType, symbolType?, names{en?,ar?}, attributes[], suggestedOrder?, evidence?, confidence('high'|'medium'|'low')`. `ArisAiRelation` (:183-205): `…, connectionType, names?, returnOutcome?`. `ArisAiUncertainty` (:238-265): kinds `missing-field|missing-translation|ambiguous-mapping|unclear-symbol|other`. Vocab (`src/aris/ai/typeValidation.ts`): 12 object types (:22-35 — incl. `OT_FUNC, OT_EVT, OT_RULE, OT_INFO_CARR, OT_BUSINESS_RULE, OT_APPL_SYS, OT_PERS, OT_PERS_TYPE, OT_POLICY, OT_REQUIREMENT, OT_ENT_TYPE, OT_PERF`), 17 connection types (:52-70), rule symbols `ST_OPR_AND_1|ST_OPR_OR_1|ST_OPR_XOR_1` (:81-85). **[VERIFIED]** `symbolType` is vocab-checked ONLY on `OT_RULE` (:116-128) — `symbolType:'ST_PRCS_IF'` on an `OT_FUNC` passes validation, flows into both definition and occurrence symbols (`arisAiCreate.ts:133` and `:197` — `object.symbolType ?? DEFAULT_SYMBOLS[objectType] ?? 'ST_FUNC'`), and renders via the catalog (`ST_PRCS_IF` at `conventions/catalog.ts:111`; also `excel/templateSchema.ts:119`) — so the handoff projection needs NO vocabulary expansion. JSON Schema emitter pattern to mirror: `buildArisAiDraftJsonSchema()` (`src/aris/ai/draftJsonSchema.ts:174-197` — hand-written, enum-locked, `additionalProperties:false`). Draft validation composition (`validateDraft.ts:58-75`): forbidden-content → zod → types → logical integrity, never throws.

### EPC rule table + the two gaps this campaign closes

`validateEpcGraph(graph, {knownModelIds})` (`src/aris/epc/validate.ts:29-44`; rule table comment :14-28): `epc.alternation` (error, :51-79, exception `CT_IS_PREDEC_OF_1` Func→Func), `epc.startEnd.missingStart`/`missingEnd` (error, :82-111 — existence only), `epc.rule.splitMergeConflict` (error, :119), `epc.event.decisionViolation` (error, :147), `epc.connectivity.orphanNode` (warning, :177), `epc.rule.unrecognizedSymbol` (warning, :210), `epc.connection.missingType` (error, :229), `epc.linkedModel.danglingReference` (error, :250). `EpcFinding` (`epc/types.ts:88-95`): `{ruleId, severity, messageKey, messageParams?, nodeIds[], edgeIds[]}` — i18n keys, never prose. Existing dictionary keys `aris.epc.finding.*` EN `dictionaries.ts:2511-2523` / AR `:5507-5519`. Wiring surface for a NEW rule (5 places): `epc/validate.ts` (+rule table comment), `epcSemantics.ts:50-70` `EPC_RULE_MESSAGES` (English repair prompts), `arisValidationFindings.ts:47-57` `EPC_RULE_GAP_KINDS`, `src/i18n/dictionaries.ts` EN+AR keys, and the canonical findings message tables (L-PROJECT). **Missing vs master plan:** labeled-XOR-conditions (nothing validates decision-branch labels) and reachable-end-outcomes (`missingEnd` checks existence, not reachability from a start).

### Determinism facts

Deterministic today (with in-code proof headers): `buildArisAiPrompt`, `normalizeArisAiDraft`, `buildAmlFromArisAiDraft` (ids `prefix.logicalId`, sort with index tie-break `:155-159`, fixed geometry `:36-40`), `cleanLayout` (byte-identical JSON, `cleanLayout.ts:19-24`), `scanArisChatGaps`, revision ids (`packages/revisions.ts:11-13` "No Date.now() or Math.random()"), `canonicalJsonText/Bytes` (`src/aris/packages/canonicalJson.ts:153-167` — sorted keys, trailing newline part of hashed content). NOT deterministic: `src/aris/writer/ids.ts` allocator (:158-179) — never used by the AI/canonical path; keep it that way.

### Master-plan contract facts (what the enterprise repo expects)

EPC generation sequence (master plan Part IV §7): freeze normalized draft → project canonical nodes/edges into EPC events/functions/connectors/lanes → **validate EPC structural rules BEFORE rendering** → SVG as the primary artifact, PNG/PDF only when needed → narrative → verification package showing **trigger, outcome, owner, main flow, roles, systems, decisions, unresolved questions, evidence summary** → contributor corrections create evidence + a NEW version, never direct diagram edits. Canonical taxonomy (Part III §3): notation-neutral; objects = events, activities, decisions, roles/units, information objects, systems, controls, exceptions; edges = sequence, conditional branch, parallel dependency, handoff, data flow, exception route; every citable object has an ID; evidence-linked facts; unknowns + critical gaps; versions immutable; artifact metadata must record generator/renderer + mapping/schema versions. Repository split (Part II §3): bpmn-studio stays the public reusable engine; the private repo consumes it as a package/versioned dependency with a thin `packages/epc-adapter/`.

### Versions

Root `orbitpm-aris-studio-lite@0.5.0`, `private:true`, `type:module`. Runtime deps: diagram-js 15.22.0, diagram-js-direct-editing 3.5.1, diagram-js-minimap 5.4.0, fflate 0.8.3, jspdf 4.2.1, papaparse 5.5.4, react/react-dom 18.3.1, read-excel-file 9.3.4, xmllint-wasm 5.2.0, zod 4.4.3. Relevant devDeps: **jsdom 29.1.1**, vite 6.4.3, vite-node 3.2.4, vitest 3.2.7, @playwright/test 1.61.1, typescript 5.9.3. Node pin 22.22.0 / npm 11.13.0 in CI. New sub-package: `@orbitpm/epc-engine@0.1.0`.

---

## Wave 17 — Prep (orchestrator) + policy/CI foundation

### W17-ORCH — orchestrator prep

- [ ] Record the true baseline into the **Baseline record** section below: HEAD SHA (`git rev-parse HEAD`, expect `8bbc01a`), branch (`claude/bpmn-studio-implementation-plan-c13dn3`), and the full gate suite at HEAD with every failure verbatim:

  ```bash
  cd /home/user/bpmn-studio
  npm ci
  npm run typecheck; npm run lint; npm run format:check
  npm run check:actions            # EXPECTED RED at HEAD (pages-aris.yml inventory) — record verbatim
  node scripts/check-release-workflows.mjs   # EXPECTED RED at HEAD — record verbatim
  npm run check:lite-only; npm run check:no-skips; npm run check:aris-runtime-boundary; npm run check:ui-copy; npm run check:csp; npm run check:lock
  npm test
  npm run test:aris:animalwf || echo "ENV-BLOCKED (expected: ../reference/AnimalWF absent)"   # record as environment-blocked, NOT red
  ```

- [ ] Place the user-supplied AnimalWF asset at `../reference/AnimalWF/ARISAMLExport.xml` (sha256 `38db10f0…7926f5`; never commit it — verify `git status` stays clean and `../reference` is outside the repo root), then record which fidelity/golden/animalwf suites now RUN vs. remain environment-blocked; confirm `release/OrbitPM-ARIS-Studio-Lite.html` is tracked and `npm run check:aris-studio-artifact` passes.
- [ ] Kimi dispatch smoke: using the fenced block in Global Constraints (verify the exact k2.7/k3 model ids at dispatch time via `/model` or provider docs), run one trivial `claude -p "print KIMI-SMOKE-OK"` per tier and record the tokens. One `opus48 high` and one `sonnet medium` Agent dispatch must round-trip too. If kimi endpoints are unavailable, record it and route kimi lanes to the fallback (`kimi k2.7`→`sonnet medium`, `kimi k3 xhigh`→`opus48 high`) — note every substitution in the ledger.
- [ ] Worktree setup (optional, per goal.md): sibling worktrees only if the orchestrator parallelizes physically; otherwise dispatch in the main tree wave-by-wave.

### Lane L-POLICY (Wave 17) — workflow-inventory fix + CONTRIBUTING carve-out + README note _(authorized changes 1, 2, 5)_

**Worker:** kimi k2.7. **Read first:** `scripts/check-actions.mjs:9-24`, `scripts/check-release-workflows.mjs:8-17` and `:60-72`, `.github/workflows/pages-aris.yml` (whole file), `CONTRIBUTING.md:1-10`, `README.md` (top sections).

### Verified ground truth

Six workflow files exist; both inventory scripts hard-code five, so `check:actions` and `check-release-workflows` fail at HEAD `8bbc01a`. `check-actions.mjs` uses a sorted string-array compare (:20) then runs actionlint over `expectedWorkflows` — adding the file means actionlint now lints it. `check-release-workflows.mjs` derives its inventory from `Object.values(workflowFiles).sort()` (:8-14, :60-72); adding an entry ALSO subjects `pages-aris.yml` to `findActionPinFailures` (it is fully SHA-pinned: `actions/checkout@11d5960…`, `actions/upload-artifact@ea165f8…`, `actions/deploy-pages@d6db901…` **[VERIFIED]**) and to the global ban scans (it deliberately does NOT use `actions/upload-pages-artifact@` — the header comment explains the tar+upload-artifact workaround) — all pass. `requireJobs` is only called for release/pages/rollback; `pages-aris.yml`'s single `deploy` job is unconstrained. CONTRIBUTING.md:3-5 currently reads "Changes must not add a native shell, installer, updater, server, bridge, or alternate executable application."

### Steps (TDD)

- [ ] **T1 — inventory fix.** `scripts/check-actions.mjs:9-15`: insert `'pages-aris.yml',` into `expectedWorkflows` (keep the array sorted: it belongs first). `scripts/check-release-workflows.mjs:8-14`: add `pagesAris: 'pages-aris.yml'` to `workflowFiles`. Verify BOTH scripts exit 0, and that the node:test verifier suite still passes: `node --test scripts/release-workflow-critical-invariants.test.mjs scripts/workflow-action-pins.test.mjs scripts/check-no-skips.test.mjs` (these test the helper functions, not the inventories — confirm, and report if any fixture assumes 5 files; updating such a fixture is authorized change 1).
- [ ] **T2 — CONTRIBUTING carve-out.** After the sentence ending "alternate executable application." append exactly one new sentence: `The one permitted executable addition is the headless Node CLI for this same engine under packages/epc-engine/bin/ — a batch projection/render tool with no server, bridge, desktop shell, installer, or updater.` (`check:lite-only` prose-scans README/docs for legacy-promotion phrases like "desktop app only" — this sentence contains none.)
- [ ] **T3 — README scope note.** Add a short section `## EPC engine as a service` (3-6 sentences): the studio UX is unchanged; `packages/epc-engine/` packages the same `src/aris` engine (canonical schema → EPC projection → validation → headless SVG) for consumption by a private enterprise repository via `npm pack`/git dependency; pointers to `docs/EPC_PROJECTION.md` and `docs/ENTERPRISE_HANDOFF.md` (authored in Wave 22 — forward references are fine).
- **Commit:** `ci(policy): add pages-aris.yml to both workflow inventories; authorize the headless engine CLI in CONTRIBUTING; README scope note`

**Verification:** `npm run check:actions` → 0; `node scripts/check-release-workflows.mjs` → 0; `npm run check:lite-only` → 0; `npm run format:check` → 0; the node --test triple above → 0. **Gates:** global block. **Risks:** actionlint findings inside `pages-aris.yml` itself would surface for the first time — if any appear, fix the YAML (shell quoting only), never the linter; rollback lever = reverting the two one-line inventory insertions restores the exact HEAD state.

---

## Lane L-SCHEMA (Wave 18) — CanonicalProcessV1 contract + JSON Schema emitter _(deliverable 1)_

**Worker:** sonnet medium. **Read first:** `src/aris/ai/contract.ts` (whole file — the strictObject house style to mirror), `src/aris/ai/draftJsonSchema.ts:1-197`, `src/aris/packages/canonicalJson.ts:153-167`, master-plan taxonomy in Embedded reference facts.

### Verified ground truth

The live IR is ARIS-typed at every level (`OT_*`/`CT_*`/`ST_*`) — notation-neutrality is the core gap. Strongest existing matches to reuse as shape precedents: `ArisAiUncertainty` (:238-265) for unknowns, `ArisAiConfidence` `'high'|'medium'|'low'` on every entity, `ArisAiLocalizedText {en?, ar?}` min-1 (:67-77). Missing entirely from the live IR: triggers/outcomes as first-class, wait, handoff, exception, labeled conditional edges, ID-keyed facts. zod is 4.4.3 (`z.strictObject`, `.strict()`, `z.enum`, `z.literal`). The emitter pattern is hand-written nested plain objects with `additionalProperties:false` + `enum` locks (`draftJsonSchema.ts:174-197`), NOT zod-to-json-schema tooling.

### Steps (TDD)

- [ ] **T1 — the contract.** New `src/aris/canonical/contract.ts` exporting interfaces + zod schemas (all `strictObject`, no defaults, no coercion) + `parseCanonicalProcess(raw: unknown): CanonicalParseResult` (never throws; `{ok:true, process}` | `{ok:false, issues}` with zod paths). Shape (field names binding — the enterprise repo codes against them):

  ```ts
  export const CANONICAL_SCHEMA_VERSION = 1 as const
  export type CanonicalConfidence = 'high' | 'medium' | 'low'
  export interface CanonicalText {
    readonly en?: string
    readonly ar?: string
  } // min 1 key, min length 1
  export type CanonicalNodeKind =
    'event' | 'activity' | 'decision' | 'wait' | 'handoff' | 'exception'
  export type CanonicalEdgeKind =
    'sequence' | 'conditional' | 'parallel' | 'handoff' | 'data-flow' | 'exception-route'
  export interface CanonicalProcessV1 {
    readonly version: 1
    readonly identity: {
      id
      names: CanonicalText
      purpose?: CanonicalText
      code?
      processVersion?: string
      confidence
    }
    readonly nodes: CanonicalNode[] // {id, kind, names, description?, waitDetail?(wait only),
    //  targetProcessRef?(handoff only), factIds?, confidence}
    readonly decisions: CanonicalDecision[] // {id, nodeId → a 'decision' node, criteria?: CanonicalText,
    //  outcomes: [{id, names: CanonicalText, targetNodeId}] (min 2), factIds?, confidence}
    readonly edges: CanonicalEdge[] // {id, kind, sourceNodeId, targetNodeId,
    //  condition?: CanonicalText (REQUIRED iff kind==='conditional'),
    //  factIds?, confidence}
    readonly roles: CanonicalRole[] // {id, names, unit?: CanonicalText, nodeIds[], owner?: boolean, factIds?, confidence}
    readonly systems: CanonicalSystem[] // {id, names, nodeIds[], factIds?, confidence}
    readonly informationObjects: CanonicalInformationObject[] // {id, names, inputToNodeIds[], outputOfNodeIds[], factIds?, confidence}
    readonly controls: CanonicalControl[] // {id, names, kind: 'policy'|'business-rule'|'requirement', nodeIds[], factIds?, confidence}
    readonly facts: CanonicalFact[] // {id, statement: CanonicalText, evidenceRefs: string[] (opaque IDs into the caller's evidence store), confidence}
    readonly unknowns: CanonicalUnknown[] // {targetId, kind: 'missing-field'|'missing-translation'|'ambiguous-mapping'|'unclear-symbol'|'other', field?, message: CanonicalText, factIds?}
  }
  ```

  Cross-reference refinements (zod `.superRefine`, each with a stable issue code): unique ids across ALL entity arrays; every `edge.sourceNodeId/targetNodeId`, `decision.nodeId/outcome.targetNodeId`, `role/system/control.nodeIds[*]`, `informationObjects.*NodeIds[*]` resolves to a declared node; every `factIds[*]` resolves to `facts[*].id`; every `unknowns[*].targetId` resolves to some declared id; `condition` present iff `kind==='conditional'`; every `decision.nodeId` points at a node of kind `'decision'` and each decision node is referenced by exactly one `decisions[]` entry; a `'decision'` node's outgoing control-flow is expressed ONLY through its `decisions[]` outcomes (no plain `sequence` edge out of a decision node). Test `src/aris/canonical/contract.test.ts`: minimal valid process parses; each refinement fires with its intended code/path; unknown key anywhere ⇒ rejected; determinism — `canonicalJsonText(parse(x).process)` identical across two parses.

- [ ] **T2 — JSON Schema emitter.** New `src/aris/canonical/jsonSchema.ts` `buildCanonicalProcessJsonSchema(): Record<string, unknown>` — hand-written, mirroring `draftJsonSchema.ts` (:174-197 pattern): `additionalProperties:false` everywhere, enum-locked `kind` fields, `required` arrays matching the zod contract exactly. Test `jsonSchema.test.ts`: (a) the emitted schema is itself stable (`canonicalJsonText` snapshot equality across two calls); (b) contract↔schema drift guard — for every valid fixture, zod accepts ⇔ enumerate the schema's `required`/`properties` keys per object and assert they equal `Object.keys` of the zod shape (structural drift test, no ajv dependency — ZERO new deps).
- [ ] **T3 — barrel.** New `src/aris/canonical/index.ts` re-exporting contract + emitter (L-PROJECT extends this file in Wave 19).
- **Commit:** `feat(canonical): CanonicalProcessV1 — notation-neutral bilingual process contract + enum-locked JSON Schema emitter`

**Verification:** `npx vitest run src/aris/canonical` → 0; global gate block (boundary walker unaffected — canonical/ is outside the main graph). **Gates:** coverage — this lane's tests must exercise every refinement branch (the 80 % floor over `src/**` includes these new files). **Risks:** shape churn after L-PROJECT starts would ripple — the field names above are BINDING; if projection needs an addition, it goes through a W19 plan-note, never a silent contract edit.

---

## Lane L-FIXTURES (Wave 18) — valid + invalid canonical fixtures _(deliverable 1)_

**Worker:** kimi k2.7. **Read first:** L-SCHEMA's contract shape above (binding), master-plan fixture rule ("one hand-written valid example and at least five invalid examples… every invalid example fails for the intended reason").

### Steps (TDD)

- [ ] **T1 — fixtures module.** New `src/aris/canonical/fixtures.ts` exporting plain frozen objects (TS, not JSON files — vitest include is `src/**` and TS keeps them typed): `VALID_CANONICAL_MINIMAL` (start event → activity → end event, one role, bilingual names, 2 facts, 1 unknown); `VALID_CANONICAL_FULL` — one process exercising EVERY kind: start event, 3 activities, 1 decision (criteria + 2 labeled outcomes en/ar), 1 parallel fan-out/fan-in, 1 wait, 1 handoff (with `targetProcessRef`), 1 exception (+`exception-route` edge to a rejected-end event), 2 roles (one `owner:true`, with unit), 2 systems, 2 information objects (one input, one output), 2 controls (policy + business-rule), ≥6 facts with evidenceRefs, ≥2 unknowns, mixed confidence values, bilingual everywhere; and 10 `INVALID_CANONICAL_*` objects (typed `unknown`), each broken in exactly one intended way: unknown key, missing `confidence`, dangling `edge.targetNodeId`, duplicate id across arrays, empty `names`, `conditional` edge without `condition`, `sequence` edge out of a decision node, decision with 1 outcome, dangling `factIds`, dangling `unknowns.targetId`.
- [ ] **T2 — intent test.** New `src/aris/canonical/fixtures.test.ts`: both valid fixtures parse ok; each invalid fixture fails AND the failure's issue path/code matches the intended break (a table `[fixture, expectedPathFragment]` — asserting the reason, not just failure); `canonicalJsonText(VALID_CANONICAL_FULL)` is byte-identical across two serializations.
- **Commit:** `test(canonical): hand-written valid + 10 intent-labeled invalid CanonicalProcessV1 fixtures`

**Verification:** `npx vitest run src/aris/canonical` → 0. **Risks:** none beyond contract drift (same-wave coordination: L-SCHEMA's shape in this plan is the single source; if the parse rejects a fixture for an unplanned reason, report — do not adjust the contract).

---

## Lane L-EPC-RULES (Wave 18) — labeled decision branches + reachable end outcomes _(deliverable 2, new rules; authorized change 6)_

**Worker:** kimi k3 xhigh. **Read first:** `src/aris/epc/validate.ts` (whole file), `src/aris/epc/flowGraph.ts` (`buildFlowGraphIndex`, `flowEdgesBySource/ByTarget`), `src/aris/epc/xor.ts:23-56` (`classifyRule`), `src/aris/epc/constants.ts` (:49-76 `FLOW_CONNECTION_TYPES`/`isControlFlowTriple`, :88-95 `classifyRuleSymbol`), `src/aris/ai/epcSemantics.ts:50-70`, `src/aris/shell/arisValidationFindings.ts:47-57`, `src/i18n/dictionaries.ts:2511-2523` + `:5507-5519`, the epc test files next to `validate.ts`.

### Verified ground truth

`checkStartEndCompleteness` (:82-111) checks only EXISTENCE of in-degree-0/out-degree-0 events. Nothing validates decision-branch labels anywhere (`gapScanner.missingXorOutcomes` checks decision-basis connections, not branch labels). `EpcFinding.messageKey` is an i18n key; the rail renders via `t()`, AI repair prompts use the separate English `EPC_RULE_MESSAGES` map. New error rules will surface in three products: live rail (`arisEpcFindings.ts`), gap scanner (via `EPC_RULE_GAP_KINDS`), AI repair turns (`epcSemantics.ts`) — updating their tests is authorized change 6. Edge names arrive as `EpcEdge.names?: Readonly<Record<string,string>>`; node names as `EpcNode.names`. A branch is "labeled" when the edge carries a non-empty name in ANY locale OR its target is an `OT_EVT` with a non-empty name in any locale (both EPC conventions accepted — the projection emits labeled outcome events; hand-drawn models may label edges).

### Steps (TDD)

- [ ] **T1 — `epc.rule.unlabeledDecisionBranch` (error).** Test first (in the epc validate test file): XOR split with 2 outgoing edges, one edge unnamed AND targeting an unnamed event ⇒ exactly one finding `{ruleId:'epc.rule.unlabeledDecisionBranch', severity:'error', messageKey:'aris.epc.finding.unlabeledDecisionBranch', nodeIds:[ruleId, targetId], edgeIds:[edgeId]}`; named-edge branch ⇒ no finding; unnamed-edge-but-named-target-event ⇒ no finding; AND rules exempt; OR rules included; out-degree-1 rules exempt. Impl in `validate.ts` (new `checkLabeledDecisionBranches(index)` appended to the composition list :34-43 and to the rule-table comment :14-28):

  ```ts
  export function checkLabeledDecisionBranches(index: FlowGraphIndex): readonly EpcFinding[] {
    const findings: EpcFinding[] = []
    for (const node of index.graph.nodes) {
      if (node.objectType !== OT_RULE) continue
      const kind = classifyRuleSymbol(node.symbolType)
      if (kind !== 'xor' && kind !== 'or') continue
      const outgoing = index.flowEdgesBySource.get(node.id) ?? []
      if (outgoing.length < 2) continue
      for (const edge of outgoing) {
        const named = Object.values(edge.names ?? {}).some((v) => v.trim().length > 0)
        const target = index.nodeById.get(edge.target)
        const targetLabeled =
          target?.objectType === OT_EVT &&
          Object.values(target.names).some((v) => v.trim().length > 0)
        if (named || targetLabeled) continue
        findings.push({
          ruleId: 'epc.rule.unlabeledDecisionBranch',
          severity: 'error',
          messageKey: 'aris.epc.finding.unlabeledDecisionBranch',
          nodeIds: target ? [node.id, target.id] : [node.id],
          edgeIds: [edge.id]
        })
      }
    }
    return findings
  }
  ```

  (Adjust `classifyRuleSymbol`'s exact return vocabulary to the real one in `constants.ts:88-95` — do not guess; read it.)

- [ ] **T2 — `epc.startEnd.unreachableEnd` (error).** Test first: linear start→…→end ⇒ no finding; a start event whose forward BFS (flow edges only) reaches NO out-degree-0 event (e.g. it feeds a cycle) ⇒ one finding per such start `{nodeIds:[startId]}`; graphs already failing `missingStart`/`missingEnd` produce those findings unchanged (no double-reporting: skip this check when there are zero start events or zero end events). Impl: new `checkEndReachability(index)` — deterministic BFS with sorted frontier (iterate edges in stored order; collect findings in start-node id order via an explicit sort before push) so output order is byte-stable.
- [ ] **T3 — wire the 4 remaining places.** (a) `epcSemantics.ts:50-70` `EPC_RULE_MESSAGES` gains: `'epc.rule.unlabeledDecisionBranch': 'A decision branch out of an XOR/OR rule has no label: name the outgoing relation or the outcome event it leads to.'` and `'epc.startEnd.unreachableEnd': 'No end event is reachable from a start event by following control flow. Connect the flow so every start can finish.'` (b) `arisValidationFindings.ts:47-57` `EPC_RULE_GAP_KINDS` gains `'epc.rule.unlabeledDecisionBranch': 'missingXorOutcomes'` and `'epc.startEnd.unreachableEnd': 'missingStartOrEndEvent'`. (c) `dictionaries.ts` EN after `:2523` + AR after `:5519`: `aris.epc.finding.unlabeledDecisionBranch`: EN `This decision branch has no label — name the connection or the outcome event.` / AR `هذا الفرع من القرار بلا تسمية — سمِّ الوصلة أو حدث النتيجة.`; `aris.epc.finding.unreachableEnd`: EN `No end event can be reached from this start event.` / AR `لا يمكن الوصول إلى أي حدث نهاية انطلاقًا من حدث البداية هذا.` (d) reconcile every unit test the new errors break (rail counts, gap-scanner fixtures, AI-generation fixtures whose XOR branches were unlabeled — LABEL the fixtures, per authorized change 6).
- **Commit:** `feat(epc): enforce labeled decision branches and start→end reachability (master-plan rules), wired into rail, gaps, and AI repair`

**Verification:** `npx vitest run src/aris/epc src/aris/ai src/aris/shell src/aris/chat src/__tests__/i18n.test.ts` → 0; `npm run test:aris:phase2` → 0 (boundary + full aris tree); global gate block. **Gates:** i18n parity test must stay green (identical EN/AR key sets). **Risks:** the reachability BFS on large imported models — O(V+E) per start, bounded; if `arisEpcFindings` shows noisy findings on real imported models (unverifiable in this environment), the rules are still correct per the master plan — record it; rollback lever = removing the two entries from the composition list at `validate.ts:34-43` (each rule is a self-contained function).

---

## Lane L-PROJECT (Wave 19) — deterministic canonical→EPC projection + findings artifact _(deliverable 2)_

**Worker:** kimi k3 xhigh. **Read first:** `src/aris/canonical/contract.ts` (from W18), `src/aris/ai/contract.ts:102-291`, `src/aris/ai/validateDraft.ts:58-75`, `src/aris/ai/epcSemantics.ts:103-199` (`adapterModelFor` is the projection-to-EpcGraph template), `src/aris/epc/validate.ts` (incl. W18 rules), `src/aris/shell/arisAiCreate.ts:36-51,119-209` (symbol fallback + id scheme + geometry), `src/aris/packages/canonicalJson.ts:153-167`, `src/aris/canonical/fixtures.ts`, typeValidation vocab facts in Embedded reference facts.

### Verified ground truth

The projection target is a fully-valid `ArisAiDraftV1`: 12 object types / 17 connection types / 3 rule symbols; `symbolType` free on non-rule objects (**[VERIFIED]** `ST_PRCS_IF` on `OT_FUNC` passes `validateArisAiTypes` and renders — `typeValidation.ts:116-128`, `arisAiCreate.ts:133/:197`, catalog `:111`). Draft logicalIds become ARIS ids as `ObjDef.<logicalId>`/`ObjOcc.<logicalId>` (`arisAiCreate.ts:49-51`) — so canonical logicalIds embedded in draft logicalIds survive verbatim into canvas element ids (the anchor mechanism L-HEADLESS relies on). Draft ordering: `suggestedOrder ?? index` with index tie-break (:155-159) — the projection MUST set `suggestedOrder` explicitly for a stable spine. `validateEpcGraph` runs per model over the `adapterModelFor`-shaped projection of the draft (logical ids as occurrence ids). `EpcFinding.messageKey` values are the `aris.epc.finding.*` keys (incl. the two new ones).

### Expansion rules (BINDING — implement exactly; document verbatim in docs/EPC_PROJECTION.md)

Draft logicalId scheme (all deterministic, derived only from canonical ids — never random; `<cid>` = canonical id): primary node `n:<cid>`; decision rule `x:<cid>` (cid = decision id); outcome event `xo:<cid>:<outcomeId>`; parallel split `ps:<cid>` / merge `pm:<cid>` (cid = the fan node); exception rule `xe:<cid>` + exception event `xev:<cid>` (cid = exception node); alternation filler event `fe:<edgeCid>` / filler function `ff:<edgeCid>`; satellites `r:<cid>` (role), `s:<cid>` (system), `io:<cid>` (info object), `c:<cid>` (control); relations `e:<cid>` (canonical edge) and synthesized relations `re:<sourceDraftId>:<targetDraftId>`.

| Canonical                                                                     | EPC projection                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event` node                                                                  | `OT_EVT`/`ST_EV`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `activity` node                                                               | `OT_FUNC`/`ST_FUNC`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `wait` node                                                                   | `OT_EVT`/`ST_EV`; `waitDetail` → draft attribute `AT_DESC` with values `{en: 'wait: '+detail.en, ar: 'انتظار: '+detail.ar}` (whichever locales exist)                                                                                                                                                                                                                                                                                                                        |
| `handoff` node                                                                | `OT_FUNC` + `symbolType:'ST_PRCS_IF'`; when `targetProcessRef` is set, ALSO emit a placeholder `ArisAiModel` `{logicalId:'m:'+ref, modelType:'MT_EEPC', names: from ref}` + `ArisAiAssignment {assignmentType:'linked-model', objectLogicalId, assignedModelLogicalId:'m:'+ref}` (satisfies `epc.linkedModel.danglingReference`)                                                                                                                                             |
| `decision` node + its `decisions[]` entry                                     | the decision node itself → `OT_FUNC`/`ST_FUNC` (the deciding step; `criteria` → `AT_DESC` attribute); then `OT_RULE`/`ST_OPR_XOR_1` `x:<id>`; per outcome an `OT_EVT` `xo:<id>:<oid>` named by the outcome label (en/ar); relations: decision-func → rule (`CT_LEADS_TO_1`), rule → each outcome event (`CT_ACTIV_1`, `names` = outcome label — belt-and-braces for `epc.rule.unlabeledDecisionBranch`), outcome event → projection of `outcome.targetNodeId` (`CT_ACTIV_1`) |
| `parallel` edges (≥2 out of one node)                                         | insert `OT_RULE`/`ST_OPR_AND_1` `ps:<nodeId>` after the node; node→ps, ps→each target. ≥2 parallel edges INTO one node: `pm:<nodeId>` before it                                                                                                                                                                                                                                                                                                                              |
| `exception` node + `exception-route` edge                                     | at the route's source: `OT_RULE`/`ST_OPR_XOR_1` `xe:<excId>` spliced into the outgoing flow; branch A continues the normal flow, branch B → `OT_EVT` `xev:<excId>` named from the exception node's names → then to the route's target if one exists, else it IS the (rejected) end event                                                                                                                                                                                     |
| `sequence` / `handoff` edge                                                   | control-flow relation `CT_ACTIV_1` when source is `OT_EVT`→func, `CT_CRT_1` when func→event, `CT_LEADS_TO_1` into/out of rules (pick by endpoint types exactly as `promptBuilder`'s cheat sheet does — read `src/aris/ai/promptBuilder.ts:108-150` and reuse its endpoint-type table as a pure helper); `handoff` edges carry `names` from the canonical edge if present                                                                                                     |
| `conditional` edge                                                            | only legal out of decisions in the canonical contract — realized through the outcome-event chain above; the `condition` text becomes the outcome event's name when the outcome lacks its own label                                                                                                                                                                                                                                                                           |
| `data-flow` edge via `informationObjects`                                     | `OT_INFO_CARR` `io:<id>`; `inputToNodeIds` → `CT_IS_INP_FOR` (info→func); `outputOfNodeIds` → `CT_HAS_OUT` (func→info)                                                                                                                                                                                                                                                                                                                                                       |
| `roles`                                                                       | `OT_PERS_TYPE` `r:<id>` + `CT_EXEC_1` (role→func) per `nodeIds` entry; `owner:true` additionally emits attribute `AT_PERS_RESP` on the model carrying the role's names                                                                                                                                                                                                                                                                                                       |
| `systems`                                                                     | `OT_APPL_SYS` `s:<id>` + `CT_SUPP_3` per node                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `controls`                                                                    | kind `policy`→`OT_POLICY` + `CT_AFFECTS`; `business-rule`→`OT_BUSINESS_RULE` + `CT_IS_EVAL_BY_1`; `requirement`→`OT_REQUIREMENT` + `CT_REFS_TO_2`                                                                                                                                                                                                                                                                                                                            |
| facts / unknowns                                                              | `facts` referenced by an entity's `factIds` → the entity's `evidence` string = comma-joined sorted fact ids; every canonical unknown → `ArisAiUncertainty` (kind maps 1:1 — the enum was mirrored by design) targeting the projected draft id                                                                                                                                                                                                                                |
| **alternation completion** (final deterministic pass over the assembled flow) | for every flow relation func→func (except `CT_IS_PREDEC_OF_1`): splice `OT_EVT` `fe:<edgeId>` named EN `<source en name> completed` / AR `اكتمل <source ar name>` (omit a locale when the source lacks it); for evt→evt: splice `OT_FUNC` `ff:<edgeId>` named EN `Handle <target en name>` / AR `معالجة <target ar name>`                                                                                                                                                    |

`suggestedOrder`: depth-first from the start event over canonical `sequence|conditional|parallel|handoff|exception-route` edges, children visited in edge-array order, synthesized nodes ordered immediately after their trigger — assign 0..n; satellites get no order (they are not flow nodes).

### Steps (TDD)

- [ ] **T1 — projection core.** New `src/aris/canonical/projectToEpc.ts` exporting `PROJECTION_VERSION = 1`, `canonicalFlowOrder(process): readonly string[]` (the DFS spine above — exported for L-VPKG), and `projectCanonicalToDraft(process: CanonicalProcessV1): CanonicalProjectionResult` where result = `{draft: ArisAiDraftV1, anchors: {nodeByDraftId: Readonly<Record<string,string>>, edgeByDraftId: Readonly<Record<string,string>>}}` (every draft object/relation maps back to the canonical id that caused it; synthesized entities map to their causing canonical node/edge/decision id). Tests `projectToEpc.test.ts` against `VALID_CANONICAL_FULL` (fixtures): exact expected draft object/relation counts; every table row above asserted by at least one case (handoff emits ST_PRCS_IF + assignment; decision emits XOR + 2 named outcome events; parallel emits AND pair; exception emits XOR + event; wait emits AT_DESC; role/system/info/control connection types; alternation filler present exactly where expected and NOWHERE else on an already-alternating chain); `validateArisAiDraft(draft).ok === true`; anchors cover 100 % of draft ids; **determinism** — two calls produce `canonicalJsonText`-identical drafts, and `buildAmlFromArisAiDraft(draft).xml` is string-identical across two full runs.
- [ ] **T2 — structural gate + findings artifact.** New `src/aris/canonical/findings.ts`: `validateProjectedDraft(result, canonical): EpcProjectionFindings` — runs `validateArisAiDraft` then per-model `toEpcGraph`+`validateEpcGraph` exactly as `epcSemantics.adapterModelFor` does (copy the adapter shape, do not import the ai-repair wrapper), then maps every `EpcFinding` through the anchor tables. Artifact shape (BINDING):

  ```ts
  export interface EpcProjectionFinding {
    readonly ruleId: string
    readonly severity: 'error' | 'warning'
    readonly messageKey: string // aris.epc.finding.*
    readonly messageEn: string
    readonly messageAr: string
    readonly canonicalNodeIds: readonly string[]
    readonly canonicalEdgeIds: readonly string[]
    readonly draftNodeIds: readonly string[]
    readonly draftEdgeIds: readonly string[]
  }
  export interface EpcProjectionFindings {
    readonly schemaVersion: 1
    readonly projectionVersion: 1
    readonly inputSha256: string // sha256 of canonicalJsonBytes(process)
    readonly ok: boolean // no error-severity findings
    readonly findings: readonly EpcProjectionFinding[]
  }
  ```

  New `src/aris/canonical/findingMessages.ts`: pure EN + AR message tables keyed by every `aris.epc.finding.*` messageKey (+ params interpolation identical to the dictionaries' `{param}` convention). Tests: drift test — every messageKey producible by `validateEpcGraph` (enumerate the rule-table ids) has EN + AR entries here AND exists in `src/i18n/dictionaries.ts` (read the dictionaries module directly in the test); the mapping path validated on a hand-mutilated draft (a valid CanonicalProcessV1 is correct-by-construction for the new rules — outcomes require names); findings JSON is `canonicalJsonText`-stable; `inputSha256` matches an independently computed `crypto.subtle` digest.

- [ ] **T3 — barrel.** Extend `src/aris/canonical/index.ts`: re-export projection, findings, `buildVerificationPackage` (name fixed; module lands from L-VPKG this same wave), fixtures stay unexported (test-internal import path is fine).
- **Commit:** `feat(canonical): deterministic CanonicalProcessV1→EPC projection with anchor maps, pre-render structural gate, and bilingual machine-readable findings`

**Verification:** `npx vitest run src/aris/canonical src/aris/ai src/aris/epc` → 0; global gate block. **Gates:** coverage floor (the expansion table is branch-heavy — every row needs a test). **Risks:** connection-type selection per endpoint pair is the subtle part — the promptBuilder cheat sheet (`promptBuilder.ts:108-150`) is the single source; if a pairing is ambiguous, prefer the type `epc/constants.ts` lists in `FLOW_CONNECTION_TYPES` and record the choice in the module header. Rollback lever = the projection is additive (no existing file changes except the barrel); reverting the lane touches nothing live.

---

## Lane L-VPKG (Wave 19) — verification package builder _(deliverable 5)_

**Worker:** sonnet medium. **Read first:** master-plan verification-package field list in Embedded reference facts, `src/aris/canonical/contract.ts`, `src/aris/packages/canonicalJson.ts:153-167`.

### Steps (TDD)

- [ ] **T1 — builder.** New `src/aris/canonical/verificationPackage.ts`: `buildVerificationPackage(process: CanonicalProcessV1): VerificationPackageV1` — pure, deterministic, everything keyed by canonical logicalId so the portal can implement per-element Confirm/Correct. Shape (BINDING): `{schemaVersion:1, processId, names, code?, processVersion?, trigger: entries[] (start events: in-degree 0 over control-flow edge kinds), outcomes: entries[] (end events + decision outcomes that terminate), owner: role entry with owner:true | null, mainFlow: ordered [{id, kind, names}] via `canonicalFlowOrder`(exported by L-PROJECT this same wave — if dispatch ordering makes it unavailable, implement the DFS locally to the identical spec and leave a`// TODO(W23): dedupe with canonicalFlowOrder` marker for the judge), roles[], systems[], informationObjects[], decisions: [{id, names, criteria?, outcomes[]}], unknowns[], evidenceSummary: [{factId, statement, evidenceRefs, referencedBy: sorted ids}], confidenceRollup: {high, medium, low} counts}`. Every array explicitly sorted by id; output `canonicalJsonText`-stable (double-build test).
- [ ] **T2 — tests.** `verificationPackage.test.ts` against both valid fixtures: trigger/outcome/owner extraction exact; mainFlow order matches the projection spine; evidenceSummary reverse-references correct; determinism double-run byte-identity; a process with no `owner:true` role yields `owner: null` AND (if any unknown targets a role) surfaces it — never a throw.
- [ ] **T3 — extend the package + narrative (enterprise-alignment amendment).** Extend the Shape above with `purpose?: CanonicalText` (from `identity.purpose`), `approvals: [{decisionId, authority: role logicalId with owner:true or an approver role referenced by the decision, threshold?: CanonicalText}]` (Gold-Case criterion 4 — derive from decisions + owner/approver roles + any control of kind `policy`/`requirement` bound to the decision node), and `narrativeSummary: CanonicalText` (the first paragraph of the narrative). NEW `src/aris/canonical/narrative.ts`: `buildProcessNarrative(process: CanonicalProcessV1): ProcessNarrativeV1` — pure, deterministic, bilingual (EN + AR), template-derived from the canonical spine (`canonicalFlowOrder`): purpose → trigger → main flow (activity/decision/outcome sentences) → end outcomes → roles/systems → open unknowns. Output shape `{schemaVersion:1, en: string, ar: string}` (markdown body per locale). NO LLM — consistency with the model is by construction. Test `narrative.test.ts`: both valid fixtures produce non-empty EN+AR; every main-flow node id's name appears; double-run byte-identity; a missing-locale name degrades gracefully (that locale's sentence omitted, never `undefined`).
- **Commit:** `feat(canonical): buildVerificationPackage (purpose, approvals, narrativeSummary) + deterministic bilingual buildProcessNarrative`

**Verification:** `npx vitest run src/aris/canonical/verificationPackage.test.ts` → 0; global gate block.

---

## Lane L-HEADLESS (Wave 20) — headless SVG render entry _(deliverable 3)_

**Worker:** opus48 high. **Read first:** `src/aris/canvas/testing/jsdomSvg.ts` (:1-16 header, :282-329 measure/install, :427 container), `src/aris/canvas/testing/harness.ts:48-69` (`bootCanvas` — the literal recipe), `src/aris/canvas/exportArisPdf.ts:426-596`, `src/aris/canvas/fitView.ts:88-118`, `src/aris/canvas/canvasSync.ts:300-336`, `src/aris/canvas/ArisCanvas.ts:72-146,268-271`, `src/aris/canvas/renderer.ts:895-915`, `src/aris/packages/canonicalJson.ts`, the pipeline chain in Embedded reference facts, `src/aris/canvas/exportArisPdf.test.ts` (jsdom precedent).

### Verified ground truth

`bootCanvas` proves the whole boot under jsdom: `installJsdomSvgSupport()` + `createCanvasContainer()` + `ArisCanvas.create({container, document, modelId, minimap:false})`. Under plain Node (vitest node env / CLI), the missing piece vs the test suites (which run with `@vitest-environment jsdom`) is constructing the jsdom window FIRST and publishing `document/window/HTMLElement/SVGElement/SVGSVGElement/DOMParser/XMLSerializer/Element/Node/navigator` onto `globalThis` before importing anything DOM-touching — jsdom 29.1.1 is already a devDependency. `captureArisCanvasSvg` (:583-596) composes measure(getBBox) + textRuns(getScreenCTM) + markup; the shim's `getBBox` ignores `<text>` (`jsdomSvg.ts:252-256`) — replacement bounds come from `arisContentBounds(elementRegistry.getAll())` (`fitView.ts:88` — pure math over element rects INCLUDING label elements, strictly better than the shim). Text-runs are PDF-only and dropped. Print frame off via `setPrintFrameVisible(false)` (`renderer.ts:905`). Canvas element ids ARE `ObjOcc.<draftLogicalId>` / connection ids `CxnOcc.<draftLogicalId>`; with L-PROJECT's anchors, canonical ids are recoverable per element. The headless entry is NOT reachable from `src/main.tsx` (boundary-legal); it must never import `browserXmlTokenizer`/`sourcePackage` (`?worker&inline`) — use `tokenizeXmlDocument` directly.

### Steps (TDD)

- [ ] **T1 — environment module.** New `src/aris/headless/environment.ts`: `ensureHeadlessDom(): void` — if `globalThis.document` exists, no-op; else build a `new JSDOM('<!doctype html><html><body></body></html>')` via a static `import { JSDOM } from 'jsdom'` (jsdom resolves in Node; the lib build externalizes it; the studio build never imports headless/), publish the globals listed above, then `installJsdomSvgSupport()`. Update `jsdomSvg.ts` + `harness.ts` headers: replace "test support only" with "shared by the canvas test suites AND the headless render entry (`src/aris/headless`)" — header-only edits, zero behavior change (~40 canvas suites keep their imports).
- [ ] **T2 — bounds + capture options.** `exportArisPdf.ts`: extend `captureArisCanvasSvg(container, options?: {bounds?: ArisCanvasSvgBounds; includeTextRuns?: boolean})` — when `bounds` given, skip `measureArisCanvasSvgBounds`; when `includeTextRuns === false`, return `textRuns: []` without touching `getScreenCTM`. Browser PDF path (`exportArisCanvasPdf` :642) passes nothing ⇒ byte-identical behavior (rollback lever). Tests in `exportArisPdf.test.ts` (jsdom): provided-bounds path produces the exact viewBox `buildArisExportSvgMarkup` math implies; `includeTextRuns:false` never calls the CTM chain (spy on a stubbed `getScreenCTM`).
- [ ] **T3 — render entry.** New `src/aris/headless/render.ts`: `renderCanonicalProcess(process: CanonicalProcessV1, options?: {modelIndex?: number; sourceVersionId?: string}): Promise<HeadlessRenderResult>` implementing the Embedded-reference-facts chain verbatim: parse (reject ⇒ typed error result, no throw) → project → `validateProjectedDraft` (errors ⇒ `{ok:false, findings}` — **structural validation BEFORE rendering**, no canvas boot on failure) → `buildAmlFromArisAiDraft` → tokenize → semantic → `buildFromSource` → `ensureHeadlessDom()` → `createCanvasContainer(1600,1200)` → `ArisCanvas.create(…)` → `applyCleanLayout((g) => cleanLayout(g))` → print frame OFF → anchor stamping: for every element in the registry whose id maps through anchors (strip the `ObjOcc.`/`CxnOcc.` prefix), `gfx.setAttribute('data-epc-node'|'data-epc-edge', canonicalId)` on the `.djs-element` group → `bounds = arisContentBounds(elementRegistry.getAll())` → `captureArisCanvasSvg(container, {bounds, includeTextRuns:false})` → destroy canvas + remove container. Result: `{ok:true, svg: string, findings, metadata, debugAml: string}`.
- [ ] **T4 — metadata + version.** New `src/aris/headless/version.ts`: `export const EPC_ENGINE_VERSION = '0.1.0'` (+ a test that reads `packages/epc-engine/package.json` when it exists — `existsSync` guard on a REPO path is fine; the `check-no-skips` `existsSync` ban applies only to `reference/…` literals — and asserts equality; until W21 the file is absent and the assertion is vacuous-by-guard, then W21 activates it). Stamp the SVG ROOT: `data-epc-engine-version`, `data-epc-schema-version="1"`, `data-epc-projection-version="1"`, `data-epc-input-sha256` (sha256 of `canonicalJsonBytes(process)` via `globalThis.crypto.subtle`), and — when `options.sourceVersionId` is set — `data-epc-source-version` (the caller's process version id, e.g. `v002`, passed through verbatim; determinism holds because it is an explicit input) — added to the live root pre-capture so the clone carries them, then stripped from the live root after capture. Metadata object mirrors those fields + `modelId`.
- [ ] **T5 — determinism + Arabic tests.** New `src/aris/headless/render.test.ts` (run under the DEFAULT node env — no jsdom docblock — to prove the CLI path): `VALID_CANONICAL_FULL` renders `ok:true`; the SVG contains `data-epc-node` for every canonical node id and `data-epc-edge` for every flow edge; anchors survive the strip selector (assert on the FINAL markup string); the four metadata attributes present with expected values; **byte-identity**: two full `renderCanonicalProcess` runs produce identical `svg` strings — plus a committed sha256 snapshot-hash constant (updating the constant is an explicit reviewed act, the "engine version changed" signal); Arabic: an AR-only fixture renders `direction="rtl"`-attributed text and non-empty wrapped tspans; a validation-failing canonical input returns `ok:false` with findings and NEVER boots the canvas (assert `globalThis.document` untouched when the pre-gate fails under naked node env).
- [ ] **T6 — barrel + PNG note.** New `src/aris/headless/index.ts` (environment, render, version re-exports) with a header note: PNG = `arisSvgToPngDataUrl(markup, size, deps)` (`exportArisPdf.ts:360`) with consumer-injected `createCanvas`/`loadImage`; this campaign adds NO rasterizer dependency.
- **Commit:** `feat(headless): jsdom-booted canonical→SVG render entry — model-derived bounds, logicalId anchors, versioned metadata, byte-stable output`

**Verification:** `npx vitest run src/aris/headless src/aris/canvas/exportArisPdf.test.ts` → 0; `npm run test:aris:phase2` → 0 (proves the ~40 canvas suites survived the header edits and capture-signature change); global gate block. **Gates:** boundary walker unaffected (headless/ not in the main graph — but `exportArisPdf.ts` IS: keep its new options type-local, no new imports). **Risks:** jsdom boot cost per render (~100-300 ms) — acceptable for batch; if diagram-js touches an unshimmed API under naked Node (vs vitest's jsdom env), extend `jsdomSvg.ts` (its explicit purpose) — never stub in render.ts. Rollback lever = `captureArisCanvasSvg` options default to legacy behavior; deleting `src/aris/headless/` restores HEAD.

---

## Lane L-PKG (Wave 21) — library build + sub-package manifest _(deliverable 4, packaging half; authorized change 3)_

**Worker:** opus48 high. **Read first:** `vite.config.ts` (whole file — what NOT to reuse), `scripts/check-artifact-size.mjs:13-34`, `scripts/clean-output.mjs`, `eslint.config.js:6-29,66-79`, `.prettierignore`, `.gitignore`, `scripts/check-lite-only.mjs` manifest/name checks, `scripts/check-lockfile.mjs` behavior notes in Embedded reference facts.

### Verified ground truth

The single-file config cannot be reused: `embedAppVersionMarker()` throws on non-HTML/second use; `viteSingleFile()` is HTML-only. `check:size` forbids anything beside `index.html` in `dist/` ⇒ lib outDir MUST be `packages/epc-engine/dist/`. `clean-output.mjs` hard-allowlists `'dist'` (:6). Root manifest name is pinned; `private:true` stays; NO npm workspaces (root `package.json` gains only scripts; lockfile byte-untouched — `git diff --exit-code package.json package-lock.json` runs in CI after `npm ci`; script-only manifest edits keep `check:lock`'s manifest/lock-root dep-object identity intact). The sub-package is never `npm install`-ed inside this repo (no nested lockfile, no node_modules) — `license:check`/`sbom` walk the ROOT production closure only and are untouched. `check-lite-only` name-pins the ROOT manifest specifically; the sub-package manifest is a tracked JSON file whose path (`packages/…`) is legal — verify with the command, and if the scan proves broader than documented, STOP and report (do not weaken the guard).

### Steps (TDD)

- [ ] **T1 — lib config.** New `vite.lib.config.ts` (root — already inside tsconfig `*.config.ts` and eslint `*.{config,setup}.ts`):

  ```ts
  import { resolve } from 'node:path'
  import { defineConfig } from 'vite'
  export default defineConfig({
    resolve: { alias: { '@': resolve(__dirname, 'src') }, dedupe: ['zod'] },
    build: {
      target: 'es2022',
      outDir: 'packages/epc-engine/dist',
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: {
          index: resolve(__dirname, 'src/aris/headless/index.ts'),
          canonical: resolve(__dirname, 'src/aris/canonical/index.ts')
        },
        formats: ['es']
      },
      rollupOptions: { external: ['jsdom', /^node:/] }
    }
  })
  ```

  NO react/singlefile/version-marker plugins. diagram-js + friends bundle IN (they are runtime deps of the engine; the sub-package must not require the consumer to install them). Verify the emitted chunks contain no `?worker` residue and no `import "react"` (grep over `packages/epc-engine/dist/*.js`).

- [ ] **T2 — sub-package manifest.** New `packages/epc-engine/package.json`:

  ```json
  {
    "name": "@orbitpm/epc-engine",
    "version": "0.1.0",
    "description": "OrbitPM EPC engine as a service — CanonicalProcessV1 → EPC projection, validation, headless SVG render",
    "license": "MIT",
    "type": "module",
    "exports": { ".": "./dist/index.js", "./canonical": "./dist/canonical.js" },
    "bin": { "epc-project": "./bin/epc-project.mjs" },
    "files": ["dist", "bin", "README.md"],
    "engines": { "node": ">=22 <23" },
    "dependencies": { "jsdom": "29.1.1" }
  }
  ```

  jsdom is the ONLY runtime dep, exact-pinned to the version already vetted at root (29.1.1). New `packages/epc-engine/README.md` (short: what it is, build with `npm run build:lib` from repo root, consume via `npm pack`/git dep, pointer to the two docs). The `bin` entry references L-CLI's W22 file — committed path is fine one wave early (npm pack runs in the verification wave, after W22).

- [ ] **T3 — plumbing (authorized change 3).** `scripts/clean-output.mjs:6` → `const allowedTargets = new Set(['dist', 'packages/epc-engine/dist'])` (the path-containment check already guards traversal). Root `package.json` scripts: `"build:lib": "vite build --config vite.lib.config.ts"`, `"clean:lib": "node scripts/clean-output.mjs packages/epc-engine/dist"`. `eslint.config.js`: add `'packages/epc-engine/dist/**'` to `ignores` and `'packages/epc-engine/bin/**/*.mjs'` to the node-globals files block (mirror `:23-29`/`:66-79` patterns). `.gitignore` + `.prettierignore`: add `packages/epc-engine/dist/`.
- [ ] **T4 — purity proofs.** Run and record: `npm run clean:dist && npm run build && npm run check:size` → 0 (dist untouched by the lib config); `npm run build:lib` → 0 and `ls dist/` unchanged; `npm run check:lite-only` → 0; `npm run check:lock` → 0; `git diff --exit-code package-lock.json` → 0; `npm run lint` + `npm run format:check` → 0.
- **Commit:** `build(epc-engine): vite library config into packages/epc-engine/dist + sub-package manifest (jsdom-only runtime dep); clean/lint/ignore plumbing`

**Verification:** the T4 command list, exit codes verbatim; `node -e "import('./packages/epc-engine/dist/index.js').then(m => console.error(Object.keys(m).length))"` → 0 with a non-trivial export count. **Gates:** global block. **Risks:** Vite lib-mode multi-entry chunking may split shared chunks — fine (all inside the package `dist/`, `files` allowlists the dir); CSS must NOT exist in the lib graph (the canvas module graph imports no CSS — if Vite emits a `.css`, find and sever the stray import; report it). Rollback lever = delete `vite.lib.config.ts` + `packages/` + revert the 5 plumbing edits; nothing in the app graph changed.

---

## Lane L-PARITY (Wave 21) — browser-vs-headless parity e2e _(deliverable 3; authorized change 7)_

**Worker:** opus48 high. **Read first:** `tests/e2e/helpers/arisRoundtripCompare.ts:1-30` (the vite-node-helper pattern AND the loader constraint: canvas/renderer's extensionless diagram-js ESM imports resolve ONLY under vite/vite-node — Playwright's own loader cannot import them), `tests/e2e/aris-sequence-1.spec.ts` (spawn pattern), `scripts/release-suite-manifest.mjs`, `playwright.config.ts` (file:// against `dist/index.html`, retries 0), L-HEADLESS's render contract.

### Verified ground truth

The house pattern for canvas-importing Node work inside e2e: the spec spawns `npx vite-node tests/e2e/helpers/<helper>.ts …` and parses ONE JSON line from stdout. Do not import ANY engine module from the Playwright loader (partial-graph imports are fragile there) — generate everything in the vite-node helper and pass files. Both sides run the identical deterministic pipeline (same `cleanLayout`), so positions agree exactly in model space; the browser side reads shape-group transforms (model coordinates inside the viewport group); tolerance ±2 model units absorbs rounding. The committed spec must compare in ONE consistent coordinate space (translate x/y plus anchor-set equality; width comparison only if converted to model space via the viewport matrix).

### Steps (TDD)

- [ ] **T1 — fixture + helper.** New `tests/e2e/fixtures/epc-parity-canonical.json` — a JSON serialization of a compact-but-complete canonical process (start→activity→decision(2 outcomes)→ends, one parallel pair, one role, one system, AR+EN names; hand-write it to parse cleanly against `contract.ts`). New `tests/e2e/helpers/arisHeadlessRender.ts` (vite-node, `@/` imports): read the fixture path from argv → `renderCanonicalProcess` → write `<outDir>/parity.svg` + `<outDir>/parity.aml.xml` (the `debugAml` from the same run) → print ONE JSON line `{anchors: {id: {x,y,width,height}}, svgSha256, metadata}` extracted by parsing the SVG's `data-epc-node` groups.
- [ ] **T2 — spec.** New `tests/e2e/aris-headless-parity.spec.ts` (core body embedded in the e2e scenario section below): spawn the helper into `testInfo.outputPath(...)`, boot the built app over file://, import `parity.aml.xml` via the file input, wait for the canvas, run Clean Layout via the toolbar (adapt selectors from current specs — read `ArisStudioTab.tsx` for stable `data-orbitpm-*` hooks, never invent), then for every headless anchor id assert a canvas element with the matching `ObjOcc.`-suffixed `data-element-id` exists and its model-space position matches within ±2; assert counts both directions; assert the headless `metadata` fields present. Runs on all three engines like every suite.
- [ ] **T3 — manifest (authorized change 7).** Add `'tests/e2e/aris-headless-parity.spec.ts'` to `REQUIRED_BROWSER_SUITES` (keep sorted). `npm run check:no-skips` → 0 proves the two-way equality.
- **Commit:** `test(e2e): browser-vs-headless parity — same canonical input, same layout, matching anchored geometry across all three engines`

**Verification:** `npm run clean:dist && npm run build && npx playwright test tests/e2e/aris-headless-parity.spec.ts --project=chromium` → 0 (orchestrator repeats firefox/webkit in Wave 23's full run); `npm run check:no-skips` → 0. **Gates:** global block. **Risks:** engine-specific flake — the spec only imports a file and reads geometry (no dragging). Rollback lever = removing spec + manifest line together (one commit) restores the suite set.

---

## Lane L-CLI (Wave 22) — `epc-project` CLI + CI smoke _(deliverable 4, CLI half; authorized change 4)_

**Worker:** sonnet medium. **Read first:** `packages/epc-engine/dist/` export surface (from W21: `./dist/index.js` = headless barrel, `./dist/canonical.js`), `scripts/clean-output.mjs` pattern for argv handling, quality.yml policy job step "Release evidence verifier regression tests" (the folded `node --test` list), `scripts/check-no-skips.mjs` facts in Embedded reference facts, an existing `scripts/*.test.mjs` for node:test house style.

### Verified ground truth

The CLI lives OUTSIDE `src/**` (stdout printing is banned inside by `no-console`), under `packages/epc-engine/bin/` (eslint-covered since W21). It imports the BUILT lib (`../dist/index.js`) — never `src/` (plain Node cannot resolve the TS/vite graph). Exit-code contract (BINDING for the enterprise worker): `0` success, `1` validation findings with `severity:'error'` (findings JSON still written/emitted — a failure ARTIFACT, not a crash), `2` usage/IO/parse-of-JSON errors. `scripts/epc-engine-cli.test.mjs` must appear EXACTLY once in a quality.yml `node --test` command; the policy job has no lib build step, so the test builds the lib itself.

### Steps (TDD)

- [ ] **T1 — smoke test first.** New `scripts/epc-engine-cli.test.mjs` (node:test): `before` hook runs `npm run build:lib` once (`execFileSync`); tests: (a) `validate` on an inline-written valid canonical JSON tmp file → exit 0, stdout parses as `EpcProjectionFindings` with `ok:true`; (b) `validate` on an invalid file (unknown key) → exit 2 with a zod-path message on stderr; (c) `project --out <dir>` → exit 0, writes `draft.json` + `model.aml.xml` + `findings.json`; (d) `render --out <dir>` → exit 0, writes `process.svg` + `metadata.json` + `findings.json` + `narrative.md`, SVG root carries the `data-epc-*` metadata attributes and ≥1 `data-epc-node`; with `--version v002`, `metadata.json` + the SVG carry `data-epc-source-version="v002"`; (e) **determinism**: run `render` twice into two dirs → `process.svg` bytes identical, `metadata.json` identical; (f) stdin mode: `validate -` with the JSON piped → exit 0. No `.skip`/`.only`/`todo` anywhere.
- [ ] **T2 — the CLI.** New `packages/epc-engine/bin/epc-project.mjs` (~150 lines, plain ESM):

  ```js
  #!/usr/bin/env node
  // Usage: epc-project <validate|project|render> <input.json|-> [--out <dir>] [--model <index>] [--version <id>]
  // 0 = ok · 1 = EPC validation errors (findings written) · 2 = usage/IO error
  ```

  Read file or stdin; `import('../dist/canonical.js')` for `parseCanonicalProcess`/`projectCanonicalToDraft`/`validateProjectedDraft` and `import('../dist/index.js')` for `renderCanonicalProcess` (render only — `validate`/`project` never boot jsdom); `validate` prints findings JSON to stdout; `project` writes `draft.json` (canonicalJsonText), `model.aml.xml`, `findings.json`, `narrative.md`; `render` writes `process.svg`, `findings.json`, `metadata.json` sidecar, `narrative.md`; `--version <id>` flows to `renderCanonicalProcess`'s `sourceVersionId`; parse errors → stderr + exit 2; error-severity findings → artifacts written + exit 1; logging on stderr only (stdout is data). Executable bit set.

- [ ] **T3 — wire quality.yml (authorized change 4).** Append `scripts/epc-engine-cli.test.mjs` to the folded `node --test` block in the policy job. `npm run check:no-skips` → 0; `npm run check:actions` → 0 (actionlint re-passes the edited workflow).
- **Commit:** `feat(epc-engine): epc-project CLI (validate/project/render, deterministic artifacts, typed exit codes) + CI smoke wired into quality.yml`

**Verification:** `node --test scripts/epc-engine-cli.test.mjs` → 0 (includes the double-run diff); `npm run check:no-skips` → 0; `npm run check:actions` → 0; `npm run lint` → 0; global gate block. **Risks:** lib-build time inside the CI test (~30-60 s) inflates the policy job — acceptable (the job already installs Chromium); if it proves >2 min, note for a future cache step, do NOT remove the build. Rollback lever = revert bin + test + the single quality.yml line together.

---

## Lane L-DOCS (Wave 22) — projection + handoff documentation _(deliverable 6)_

**Worker:** kimi k2.7. **Read first:** L-PROJECT's expansion-rules table (transcribe VERBATIM), L-EPC-RULES' two new rules, L-HEADLESS metadata/anchor contract, L-CLI exit-code contract, L-VPKG package shape, master-plan facts section, `docs/` existing file style.

### Steps

- [ ] **T1 — `docs/EPC_PROJECTION.md`.** Sections: (1) CanonicalProcessV1 — field-by-field reference + `buildCanonicalProcessJsonSchema` as the machine copy; (2) Expansion rules — the L-PROJECT table verbatim, incl. the draft-logicalId scheme and alternation-completion templates; (3) Validation — the full 11-rule table (9 existing + the 2 new) with severities and the "structural validation BEFORE rendering" ordering guarantee; (4) Determinism + versioning — same input + same engine version ⇒ byte-identical draft/AML/SVG/findings; the four SVG metadata attributes and when each version field increments; (5) Findings artifact — `EpcProjectionFindings` shape, bilingual messages, canonical-id anchoring.
- [ ] **T2 — `docs/ENTERPRISE_HANDOFF.md`.** Interface-only (NO enterprise implementation): (1) Consumption — build (`npm run build:lib`), `npm pack` from `packages/epc-engine/` → tarball dependency, or git dependency pinned to a tag/SHA; registry publishing deferred (future follow-up: new workflow + both inventory updates); (2) CLI-from-Python — subprocess contract for the Azure worker (`epc-project render input.json --out artifacts/`), exit codes 0/1/2, stdout=data stderr=logs, findings.json as the failure artifact the worker persists; (3) Artifact/metadata contract — SVG primary + `narrative.md` + sidecar `metadata.json` (carries engine/schema/projection versions, input sha256, and the passed-through `data-epc-source-version`); PNG is explicitly consumer-side (the worker rasterizes via the injected-deps `arisSvgToPngDataUrl` path — the engine ships no rasterizer), font caveat (SVG names `Arial`/`Noto Sans Arabic` by family; rasterizing consumers must install them or accept substitution); (4) Review anchor contract — `data-epc-node`/`data-epc-edge` = canonical logicalIds; a worked ~20-line vanilla-JS embed example (inline the SVG, delegate `click` on `[data-epc-node]`, map the id into the verification package for Confirm/Correct — explicitly: no React component is exported); (5) `buildVerificationPackage` field reference; (6) Adapter payload mapping — the enterprise's flat payload maps onto `CanonicalProcessV1` (the binding contract): `processId → identity.id`, `versionId → --version / renderCanonicalProcess.sourceVersionId`, `name → identity.names`, `evidenceReferences → facts[].evidenceRefs`; the contract is a superset (adds `informationObjects`, `controls`, `unknowns`, `confidence`, bilingual) — the adapter supplies what it has and omits optional fields. What the private `epc-adapter/` should contain (thin: schema types + payload mapping + subprocess/import glue) and what it must NOT re-implement (projection, validation, layout, render, narrative).
- [ ] **T3 — cross-links.** Both docs link each other + README's scope note. `check:lite-only` prose scan stays green (no banned promotion phrases; mind that banned path segments also match inside prose paths — write "backend service" descriptions without banned tokens where a real path is not being named).
- **Commit:** `docs(epc-engine): projection reference + enterprise handoff (consumption, CLI subprocess, artifact/metadata/anchor/failure contracts)`

**Verification:** `npm run format:check` → 0; `npm run check:lite-only` → 0. **Risks:** drift vs code — every table is transcribed from THIS plan's binding specs; the W23 judge cross-checks docs against shipped code.

---

## e2e scenario scripts (embed verbatim)

`tests/e2e/aris-headless-parity.spec.ts` core (boot/import helpers copied from `aris-sequence-1.spec.ts`'s pattern; L-PARITY adapts selectors from the current specs, never invents new ones):

```ts
test('headless render and browser canvas agree on anchored geometry', async ({
  page
}, testInfo) => {
  const outDir = testInfo.outputPath('parity')
  const helper = spawnSync(
    'npx',
    [
      'vite-node',
      'tests/e2e/helpers/arisHeadlessRender.ts',
      'tests/e2e/fixtures/epc-parity-canonical.json',
      outDir
    ],
    { encoding: 'utf8', timeout: 240_000 }
  )
  expect(helper.status).toBe(0)
  const lines = helper.stdout.trim().split('\n')
  const headless = JSON.parse(lines[lines.length - 1]) as {
    anchors: Record<string, { x: number; y: number; width: number; height: number }>
    svgSha256: string
    metadata: Record<string, string>
  }
  expect(Object.keys(headless.anchors).length).toBeGreaterThan(5)
  expect(headless.metadata['data-epc-schema-version']).toBe('1')

  await gotoLanding(page)
  await importArisFile(page, join(outDir, 'parity.aml.xml'))
  await runCleanLayout(page) // toolbar hook, same engine the headless path ran
  for (const [canonicalId, rect] of Object.entries(headless.anchors)) {
    const shape = page.locator(`[data-element-id$="${canonicalId}"]`).first()
    await expect(shape).toBeVisible()
    const model = await shape.evaluate((el) => {
      const m = /translate\(([-\d.]+)[ ,]([-\d.]+)\)/.exec(el.getAttribute('transform') ?? '')
      return { tx: m ? Number(m[1]) : NaN, ty: m ? Number(m[2]) : NaN }
    })
    expect(Math.abs(model.tx - rect.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(model.ty - rect.y)).toBeLessThanOrEqual(2)
  }
})
```

---

## Campaign-wide verification (Wave 23)

### W23-JUDGE — cross-model adversarial review (fable max, judge only — never implements)

- [ ] **J1 — schema vs master plan:** field-by-field audit of `CanonicalProcessV1` against the taxonomy (identity/events/activities/decisions+criteria+labeled outcomes/roles+units/systems/information objects/controls/exceptions/waits; 6 edge kinds; facts/evidence, unknowns, confidence, bilingual). Report gaps with quotes.
- [ ] **J2 — projection semantics:** for `VALID_CANONICAL_FULL`, manually trace 5 expansion rows (decision, parallel, exception, handoff, alternation filler) through the emitted draft JSON; verify anchor-map completeness; verify NO random/clock call sites: `grep -rn "Math.random\|Date.now\|getRandomValues" src/aris/canonical src/aris/headless` must be empty.
- [ ] **J3 — artifact review:** open `process.svg` from a CLI render; check anchors, metadata attrs, RTL text attrs on Arabic labels, no stray interaction furniture, viewBox sanity; check docs (L-DOCS) against shipped exports/exit codes.
- [ ] Findings go to the orchestrator as a ranked list; accepted findings dispatch **W23-FIX** mini-lanes (`opus48 high` for engine code, `sonnet medium` for docs/CLI), each with its own test-first step and named owned files, appended to this ledger.

### W23-SHIP — full gate ladder (orchestrator)

```bash
cd /home/user/bpmn-studio
npm run typecheck && npm run lint && npm run format:check
npm run check:actions && node scripts/check-release-workflows.mjs
npm run check:lite-only && npm run check:no-skips && npm run check:aris-runtime-boundary && npm run check:ui-copy && npm run check:lock
npm run test:coverage                      # overall 80% over src/** incl. canonical/ + headless/
npx vitest run                             # full unit suite
node --test scripts/browser-environment-evidence.test.mjs scripts/check-no-skips.test.mjs \
  scripts/pages-evidence-chain.test.mjs scripts/release-evidence-chain.test.mjs \
  scripts/release-reporter.test.mjs scripts/release-review-gate.test.mjs \
  scripts/release-workflow-critical-invariants.test.mjs scripts/verify-browser-compatibility-evidence.test.mjs \
  scripts/verify-external-release-evidence.test.mjs scripts/workflow-action-pins.test.mjs \
  scripts/epc-engine-cli.test.mjs
npm run clean:dist && npm run build && npm run check:size && npm run check:csp -- dist/index.html && npm run check:attribution -- dist/index.html
npm run build:aris                         # canonical artifact refresh (byte-diff recorded)
npm run clean:lib && npm run build:lib
node packages/epc-engine/bin/epc-project.mjs render tests/e2e/fixtures/epc-parity-canonical.json --out /tmp/epc-a
node packages/epc-engine/bin/epc-project.mjs render tests/e2e/fixtures/epc-parity-canonical.json --out /tmp/epc-b
diff /tmp/epc-a/process.svg /tmp/epc-b/process.svg && diff /tmp/epc-a/metadata.json /tmp/epc-b/metadata.json   # determinism double-run
cd packages/epc-engine && npm pack --dry-run && cd ../..   # tarball contents sanity (dist/ + bin/ + README)
npm run test:e2e                           # clean build + full playwright, chromium/firefox/webkit (incl. aris-headless-parity)
# AnimalWF present (user-supplied): place ../reference/AnimalWF/ARISAMLExport.xml, then run for real-model validation of projection + headless render:
npm run test:aris:animalwf && npm run test:aris:animalwf:holdout && npm run test:aris:fidelity-report
# (if the asset is absent in a given env, these self-guard and are recorded environment-blocked — never skipped)
```

**Verification surface (authoritative):** D1 CanonicalProcessV1 is guarded by `src/aris/canonical/{contract,jsonSchema,fixtures}.test.ts` (every refinement + every invalid fixture's intended reason + schema/contract drift); D2 projection by `projectToEpc.test.ts` (every expansion row + draft validity + anchor completeness + double-run byte-identity) and `findings.test.ts` (bilingual message drift vs dictionaries + sha256), with the two NEW EPC rules guarded in the epc validate tests and their product surfacing in the rail/gap/AI-repair suites (`test:aris:phase2`); D3 headless render by `src/aris/headless/render.test.ts` (anchors, metadata, RTL, snapshot-hash byte-stability, gate-before-boot) plus `exportArisPdf.test.ts` (bounds/text-runs options leave the browser path byte-identical) and the tri-engine `aris-headless-parity.spec.ts`; D4 by `scripts/epc-engine-cli.test.mjs` (build + 3 commands + exit codes + determinism double-run — wired exactly once into quality.yml) and the L-PKG purity command list (`check:size` proves dist/ purity, `check:lock` proves the lockfile untouched, `check:lite-only` proves policy compliance); D5 by `verificationPackage.test.ts` + `narrative.test.ts` (field extraction incl. purpose/approvals/narrativeSummary + logicalId keying + bilingual deterministic narrative + byte-stability); D6 by judge review J3 (docs vs shipped contracts, incl. adapter payload mapping + PNG-consumer-side note). The pre-existing CI red is closed by L-POLICY and re-proven every time `check:actions` runs. Baseline record + Resolution evidence filled; every checkbox ticked.

---

## Baseline record (Wave 17 fills this in)

- HEAD SHA at campaign start: `________` (expect `8bbc01a`; branch `claude/bpmn-studio-implementation-plan-c13dn3`; remote default branch `main`; `feat/aris-only-studio` absent on this remote — confirmed).
- Full gate suite result at HEAD (run \_\_\_\_): one bullet per command with exit code verbatim; expected reds: `check:actions` + `check-release-workflows.mjs` (pages-aris.yml inventory — fixed by L-POLICY).
- Environment-blocked census: \_\_\_\_ (expected: all `*.animalwf` suites + `test:aris:{animalwf,holdout,phase16,golden,fidelity-report}` — `../reference/AnimalWF` absent in this container; unaffected: everything else).
- Kimi dispatch smoke: k2.7 model id `________` → token `________`; k3 model id `________` → token `________`; opus48/sonnet smokes; substitutions (if any) recorded.
- Red-at-HEAD fixes dispatched before Wave 18: L-POLICY (the two inventory scripts) — result `________`.

## Resolution evidence (Wave 23 fills this in)

- **Final commit SHA + pushed state:** \_\_\_\_ (wave commit chain W17 `____` → W18 `____` → W19 `____` → W20 `____` → W21 `____` → W22 `____` → W23 `____`).
- **Per-lane worker + evidence command exit codes:** \_\_\_\_ (lane → worker/model actually used → commit → gate exits verbatim; kimi model ids as dispatched).
- **Artifact paths / bytes / SHA-256:** `release/OrbitPM-ARIS-Studio-Lite.html` \_\_\_\_; `packages/epc-engine` pack contents \_\_\_\_; determinism double-run diff result \_\_\_\_; headless SVG snapshot hash \_\_\_\_.
- **Test counts:** unit \_\_\_\_ / phase2 \_\_\_\_ / node --test verifiers \_\_\_\_ / per-engine e2e (chromium \_\_ / firefox \_\_ / webkit \_\_) / static gates \_\_\_\_; baseline→final growth \_\_\_\_; environment-blocked suites re-run status where assets exist \_\_\_\_.
- **Judge findings + dispositions:** \_\_\_\_ (accepted → fix lane + commit; rejected → reason).
- **Authorized-change diffs (file · change · authorization #):** \_\_\_\_ · **Remaining external blockers (Actor + Action):** \_\_\_\_ (expected: npm registry publishing deferred — _Actor:_ user; _Action:_ future authorized follow-up adding a publish workflow + both inventory updates; nothing shipped is blocked).
