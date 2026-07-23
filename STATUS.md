# Status ledger — OrbitPM Process Studio

Append one entry per wave/lane completed.

## Wave A1 scaffold

- electron-vite + React + TypeScript app hand-scaffolded (official
  `@quick-start/electron` CLI is an interactive TUI that would not accept
  piped/non-interactive input in this environment — wrote the standard
  electron-vite layout by hand per plan §3 instead).
- `package.json`: productName "OrbitPM Process Studio", appId
  `ae.orbitpm.processstudio`, version `0.0.1`.
- Main process (`src/main/index.ts`) supports `--smoke-test`: creates the
  `BrowserWindow` with `show: false`, and on `ready-to-show` prints
  `SMOKE_OK` and calls `app.exit(0)` instead of showing the window.
- `electron-builder.yml`: win nsis target, `oneClick: true`,
  `perMachine: false`, `allowElevation: false`, `runAfterFinish: true`,
  `.bpmn` fileAssociations, `publish: { provider: github, owner:
  ahmedak320, repo: bpmn-studio }`.
- `.github/workflows/build.yml`: windows-latest, triggers on `v*` tags and
  `workflow_dispatch`, `npm ci` → `npm run build` → `electron-builder --win
  --publish always` with `GH_TOKEN`; Docker wine fallback documented in
  comments.
- `desktop/` initialized as its own git repo; parent `bpmn_tool/.gitignore`
  updated to ignore `desktop/`.
- Verification (Linux dev env — see task report for exact commands/output):
  `npm install`, `npm run typecheck`, `npm run build`, and a headless
  `--smoke-test` run (via `xvfb-run` if available, else `$DISPLAY` reuse, else
  deferred with build+typecheck as the passing bar per plan).

Next: A2 (early installability gate — CI walking-skeleton Setup.exe,
pre-release, Ahmed tries it on the laptop) can proceed in parallel with wave
B once this scaffold is committed.

## Wave A2: early installability gate

- Created public GitHub repo `ahmedak320/bpmn-studio`, pushed the existing
  desktop root commit as `main`.
- CI fix applied before first tag: added `permissions: contents: write` to
  `.github/workflows/build.yml` (default `GITHUB_TOKEN` scope was otherwise
  ambiguous for release creation on a fresh repo).
- First attempt (`v0.0.1-alpha.1`) built and published successfully on
  `windows-latest`, but electron-builder names/tags GitHub releases from
  `package.json`'s `version` field, not the pushed git tag — it created a
  stray `v0.0.1` draft release instead of `v0.0.1-alpha.1`. Fixed by bumping
  `package.json` version to `0.0.1-alpha.2` to match the tag scheme,
  deleted the stray release/tag, retagged `v0.0.1-alpha.2`, pushed — CI went
  green and published a correctly-tagged release on the second attempt (1
  fix, well within the 3-attempt budget).
- Release published (undrafted + marked prerelease):
  **https://github.com/ahmedak320/bpmn-studio/releases/tag/v0.0.1-alpha.2**
  Assets: `OrbitPM-Process-Studio-Setup-0.0.1-alpha.2.exe` (~78 MB),
  `.exe.blockmap`, `latest.yml` (all present, as required for
  electron-updater's GitHub provider).
- Static sanity on the downloaded .exe: `file` confirms
  `PE32 executable (GUI) ... Nullsoft Installer self-extracting archive`;
  `7z l` confirms NSIS-3 Unicode archive with the expected `$PLUGINSDIR`
  payload (`app-64.7z`) and `Uninstall OrbitPM Process Studio.exe`;
  `strings` on the embedded manifest confirms
  `requestedExecutionLevel level="asInvoker"` — i.e. no admin elevation
  requested, consistent with `oneClick: true` / `perMachine: false` /
  `allowElevation: false` in `electron-builder.yml`.
- Fallback path (local Docker `electronuserland/builder:wine`) was **not
  needed** — CI succeeded within budget.

**Wave A2: alpha installer published at
https://github.com/ahmedak320/bpmn-studio/releases/tag/v0.0.1-alpha.2 —
awaiting laptop install experiment.**

Download URL for the laptop test:
https://github.com/ahmedak320/bpmn-studio/releases/download/v0.0.1-alpha.2/OrbitPM-Process-Studio-Setup-0.0.1-alpha.2.exe

## Wave B (parallel lanes B1–B4)

- **B1 Workspace** (`37dacb5`): root picker (first-run + Settings),
  path-guarded fs IPC (`src/main/workspace`, `WORKSPACE_CHANNELS`:
  getRoot/chooseRoot/listTree/readFile/writeFile/createFolder/
  createBpmnFile/rename/move/delete + `treeChanged` push), atomic
  writes (temp+rename), chokidar-driven tree refresh, `FolderTree` +
  `WorkspacePicker` renderer components. Established the
  no-Electron-import `ipcContract.ts` pattern later lanes reused
  (workspace/openFile/menu/theme/ai contracts).
- **B2 Editor** (`af14980`): `EditorTab` — bpmn-js Modeler + properties
  panel + create-append-anything + minimap, Ctrl+S save, dirty-state
  tracking (`editor/dirty.ts`), SVG/PNG export, call-activity
  double-click hook (`onOpenCalledProcess`), `NEW_DIAGRAM_XML` factory.
- **B3 Pipeline port** (`f84aedc`): `src/gen` — IR Zod schema, validator,
  transformer (+ documented dedup-flow fix), semantic BPMN XML emitter,
  `bpmn-auto-layout@0.4.0` wrapper, prompts, `generateFromDescription`
  with conversational repair loop. Golden-tested against the vendored
  Python transformer's output on all 7 example IRs.
- **B4 Providers + settings** (`9b5573c`): 7-provider catalog
  (`src/main/providers.ts`, `makeCallLLM`), `safeStorage`-backed secrets
  vault (`src/main/secrets.ts`), pure `SettingsModal` UI (delivered
  unwired this wave — wired in Wave C by C1).
- Gate: `npm run typecheck` / `npm run build` / `npm test` green after
  each lane; combined Wave B test count carried into Wave C's baseline.

## Wave C (parallel lanes C1–C3) + C4 integration stitch

- **C1 AI integration** (`d87df64`): `ai:generate`/`ai:testConnection`
  IPC (`src/main/ai/{ai.ts,adapter.ts,ipcContract.ts}`), a B4→B3
  `CallLLM` adapter (`bridgeCallLLM`), Windows-safe slugify
  (`src/shared/slug.ts`), the `AiPanel` renderer UI, and the first real
  `App.tsx` assembly (tabs, save/dirty/confirm-close, AiPanel +
  SettingsModal mounted). Left explicit `TODO(C4)` slots in
  `index.ts`/`preload/index.ts`/`App.tsx`/`env.d.ts` for C2's and C3's
  work, since those two lanes were barred from touching the files C1
  owned this wave.
- **C2 Cross-process linking** (`34fe961`): `src/shared/processIndex.ts`
  (regex-based processId→file index, namespace-prefix agnostic,
  `listUnresolvedCalledElements`), `src/renderer/src/links/**`
  (`useProcessIndex`, `LinkPicker`, `SelectionLinkButton`,
  `setCalledElement` modeling op). Delivered as a standalone,
  fully-tested module tree plus exact integration snippets in its report
  (C2.md) — not wired into `App.tsx`/`EditorTab.tsx` by C2 itself, per
  this wave's file-ownership rules.
- **C3 Windows polish** (`1883a2d`): `src/main/updater.ts`
  (electron-updater GitHub-provider wiring, background + interactive
  check flows, never sets `verifyUpdateCodeSignature`/`publisherName`),
  `src/main/menu.ts` (File/View/Help native menu), `src/main/openFile.ts`
  (`.bpmn` file-association open-path resolution: inside/outside/no-root
  classification + import-copy flow), `src/main/themeContract.ts` +
  `src/renderer/src/theme.ts` (`nativeTheme` dark-mode wiring), real app
  icon (`resources/icon.{svg,png,ico}`) wired into
  `electron-builder.yml`. Also delivered as a standalone module tree +
  exact `index.ts`/`preload.ts` snippets, not wired in by C3 itself.
- **C4 integration stitch (this entry)**: applied C2's and C3's
  documented patch snippets into the three C4-owned files
  (`src/main/index.ts`, `src/preload/index.ts`,
  `src/renderer/src/App.tsx`) plus a toolbar-stitch patch to
  `src/renderer/src/editor/EditorTab.tsx`:
  - `index.ts`: wired `THEME_CHANNELS.get` IPC, `initAutoUpdater()`,
    `Menu.setApplicationMenu(buildMenu(...))`, first-launch
    `did-finish-load` open-path handling, and `second-instance` argv
    forwarding for `.bpmn` double-click opens.
  - `preload/index.ts`: added the `openFile`/`theme`/`menu` namespaces
    alongside the existing `workspace`/`settings`/`ai`/`providers` ones;
    `src/renderer/env.d.ts` extended to match.
  - `App.tsx`: wired `useProcessIndex` + a real call-activity
    drill-down handler (resolves `calledElement` → file via the process
    index, `window.alert` fallback for unresolved links — no toast
    infra exists yet, matches C2's documented placeholder copy),
    subscribed to `openFile.onOpenFile` (file-association opens) and
    `menu.onAction` (File-menu Save/Export/New Process/Open Workspace
    Folder), and added an unresolved-call-activity-links badge to the
    status bar (footer), computed against the active tab's loaded XML.
  - `EditorTab.tsx` (toolbar-stitch only): added `onModelerReady` (so a
    parent can read the live modeler for `SelectionLinkButton`),
    `onCommandsReady` (a small typed command bus — each mounted tab
    reports `{save, exportSvg, exportPng}`; `App.tsx` looks up whichever
    entry belongs to the active tab for the native File-menu's
    Save/Export items instead of a broadcast event), and `toolbarExtra`
    (an opaque `ReactNode` slot at the end of the toolbar, used to mount
    `SelectionLinkButton` only for the active tab).
  - **Bug found + fixed during smoke testing** (not present in any lane's
    report): `src/main/updater.ts`'s `import { autoUpdater } from
    'electron-updater'` type-checked and unit-tested fine but crashed the
    *built* app at runtime — `SyntaxError: Named export 'autoUpdater' not
    found` (electron-vite externalizes `node_modules` for the main
    process; Node's `cjs-module-lexer` doesn't statically detect this
    package's named export). A plain default-import fix would have broken
    `tests/unit/menu.test.ts`'s existing `vi.mock('electron-updater', ...)`
    (which returns a named `autoUpdater` export with no `default`). Fixed
    with a namespace import + dual-shape resolver
    (`electronUpdaterExports.autoUpdater ??
    electronUpdaterExports.default?.autoUpdater`) that satisfies both the
    real Node ESM/CJS interop shape and the test mock shape.
- Gates (final, on the fully-stitched tree): `npm run typecheck` clean,
  `npm run build` clean (main 78.9 kB / preload 4.86 kB / renderer
  3.18 MB — bpmn-js + AI SDK providers are the bulk), `npm test` → **24
  test files / 196 tests, all green**. `--smoke-test` run
  (`DISPLAY=:0 npx electron ./out/main/index.js --smoke-test
  --no-sandbox`) prints `SMOKE_OK` and exits 0. A 15s untouched
  interactive launch (`--no-sandbox`, no `--smoke-test`) produced zero
  stdout/stderr output — no runtime errors during startup. No screenshot
  tool was available in this environment (`scrot`/`import`/`spectacle`/
  `gnome-screenshot` all absent) — skipped per instructions rather than
  installing one unprompted.
- Committed: `stitch: wire linking, polish, theme; full app assembly`.
  Pushed `main` to `origin` (this lane's responsibility per the wave
  plan — no earlier Wave B/C lane pushed).

**Wave C complete: AI generation, cross-process linking, and Windows
polish (updater/menu/file-association/dark-mode/icon) are all wired end
to end in a single assembled app. Remaining gaps are listed in this
lane's report for Wave D.**

## Wave D — lane D2 (docs + v0.1.0 pre-release)

Running in parallel with D1 (playwright-electron e2e suite, `tests/e2e`),
which owns its own file tree and isn't touched by this entry.

- **README.md**: full user-first rewrite — what the app is, install
  (download `Setup.exe` from Releases, SmartScreen "More info → Run
  anyway", per-user/no-admin install), first run (workspace-root picker,
  OneDrive folder recommended), using it (folder tree, drawing basics,
  save/export, call-activity linking + drill-down + the unresolved-links
  footer badge), AI setup (Settings gear → per-provider field table for
  all 7 providers incl. Moonshot/Kimi and GLM's OpenAI-compatible base
  URL + model fields and Azure's 4-field deployment-driven config, keys
  stored via `safeStorage`/DPAPI and never leaving the workspace),
  offline/online feature matrix, "files are standard BPMN 2.0" portability
  note, troubleshooting table (SmartScreen, corporate proxy — system
  proxy is used automatically, OneDrive lock hiccups, `ai.log` location,
  where keys/settings live), dev section (npm ci/dev/build/test, smoke
  test, e2e pointer, release process with the version==tag rule spelled
  out explicitly).
- **package.json**: bumped `version` from `0.0.1-alpha.2` to `0.1.0`
  (direct edit — no dependency changes, so the `.npm-lock` install
  protocol doesn't apply here).
- **Release v0.1.0**: tagged and pushed after `typecheck`/`build`/`test`
  gates passed locally; CI (`.github/workflows/build.yml`, unchanged —
  still green from A2/C4) built on `windows-latest` and published the
  GitHub Release. See this lane's report (`D2.md`) for the exact CI run
  URL, asset list, and static installer checks performed on the
  downloaded `.exe`.

**Wave D (D2 scope) status: README complete, v0.1.0 tagged/released.
Findings/URLs in the D2 lane report; D1's e2e results are tracked
separately in that lane's own report.**

## Wave R — lane R1 (release repair: v0.1.0 → v0.1.1)

`v0.1.0` (=`0db4ff2`) was built and released **before**
`169d6b1` ("e2e: playwright-electron suite with fake-LLM hook") landed
on `main`. That commit — besides adding the playwright-electron e2e
suite — contains three ship-blocking app fixes that were only
discovered by actually running the built app:

1. **Preload must be CommonJS** (`out/preload/index.cjs`). The
   released `v0.1.0` build's preload was `.mjs`, which fails to load
   under `sandbox:true`, leaving `window.orbitpm` `undefined` and the
   app hanging forever on "Loading workspace…". **v0.1.0 was DOA** —
   nobody could get past the loading screen.
2. `EditorTab` was missing `CreateAppendElementTemplatesModule`,
   which crashed on every diagram open.
3. A process-index root race in `App.tsx`.

Because `v0.1.0` cannot be used at all, it was pulled rather than
patched forward:

- `git push` — landed `169d6b1` on `origin/main` (was local-only,
  1 commit ahead).
- `gh release delete v0.1.0 --yes` — removed the GitHub Release (and
  its assets) so nobody downloads the broken installer.
- `git push --delete origin v0.1.0` + `git tag -d v0.1.0` — removed
  the tag locally and on `origin`.
- Bumped `package.json` version `0.1.0` → `0.1.1` (no dependency
  changes; `.npm-lock` protocol used per convention anyway).
- Quick gates re-run against the fixed commit before tagging:
  `npm run typecheck` (clean), `npm run build` (confirms
  `out/preload/index.cjs` — CommonJS, the fix — is what's emitted),
  `npm test` — **196/196 passed**.
- Committed `release: v0.1.1 (supersedes v0.1.0 — includes
  e2e-discovered runtime fixes)`, pushed `main`, tagged `v0.1.1`,
  pushed the tag. CI (`.github/workflows/build.yml`) builds on
  `windows-latest` and publishes the GitHub Release automatically off
  the tag push.
- See this lane's report (`R1.md`) for the CI run URL, the
  `gh release view` asset/flag confirmation (Setup exe, `latest.yml`,
  blockmap), the static NSIS/`asInvoker` checks on the downloaded
  installer, and the `latest.yml` version confirmation.

**`v0.1.1` is an INTERNAL release only** — it supersedes the DOA
`v0.1.0` and unblocks e2e/CI, but a further planned `v0.1.2` (after
the `window.prompt`-in-Electron CRUD-flow issue flagged by the e2e
lane as UNCONFIRMED-in-real-Electron is investigated/fixed) is what
should actually be handed to the end user for install.

## Wave F — lanes F1/F2 (confirmed-findings fixes) + F3 (docs/licensing + v0.1.2 release)

- **F1** (`b3920a6`, E1-1/E2-1): replaced `window.prompt` (unimplemented in
  Electron's `BrowserWindow`, silently returns `null`) with a real in-app
  modal (`src/renderer/src/common/{TextInputModal,PromptProvider}.tsx`,
  `usePromptText`). New Process / New Folder / Rename in the folder tree —
  and File → New Process, which previously just opened the AI panel — now
  actually work in the packaged app. e2e's `window.prompt` stub removed and
  replaced with a real modal-driving flow; added a regression spec
  (`tests/e2e/prompt-modal.spec.ts`) that fails on any resurfaced
  `prompt() is not supported` page error.
- **F2** (`bf97c17`, E1-2/3/5/6/7): CSP `font-src 'self' data:` (bpmn-js's
  icon font was silently blocked, breaking palette/context-pad/
  properties-panel icons); `secrets.getKeys` now returns only
  `{configured, last4}` — provider key fields are write-only in Settings
  (empty by default, `Configured (****last4)` placeholder when a key is
  stored, blank-and-save never clobbers an existing key, "Show" reveal
  control removed); `setWindowOpenHandler`/`will-navigate`/`will-redirect`
  hardened to deny all non-http(s) external navigation and block
  in-app navigation away from the app's own origin; secrets vault file
  written with mode `0o600`; XML emitter strips XML-1.0-illegal control
  characters before escaping (regression test added). Gate at landing:
  typecheck/build clean, `npm test` 200/200 (was 196 — added
  xml-control-chars + vault-mode tests), `npm run test:e2e` 7/7.
- **F3 (this entry) — docs/licensing + the v0.1.2 release**:
  - **E2-2** (README `ai.log` path): corrected the invented
    `<install-folder-data>\logs\ai.log` token to the real
    `%APPDATA%\OrbitPM Process Studio\logs\ai.log`. Also updated the
    AI-setup section to describe F2's write-only key fields
    (`Configured (****last4)` placeholder, no reveal control) and the
    "Folders = organization" section to mention F1's in-app rename/create
    dialogs (replacing the old browser-`prompt()` framing that was never
    accurate for the packaged app).
  - **E2-3** (licensing): added a top-level `LICENSE` (MIT, copyright
    "2026 Ahmed Alkatheeri") and a `"license": "MIT"` field in
    `package.json`. **MIT was chosen as a reasonable default for a public
    repo** — permissive, standard, and trivial for Ahmed to swap for a
    different license later (single file + one `package.json` field, no
    code depends on it). Added a README **Acknowledgements** section
    crediting bpmn.io/bpmn-js (used under the bpmn.io license; the
    "Powered by bpmn.io" watermark is retained, unmodified, per E2's
    licensing review), Electron, the Vercel AI SDK, and
    `bpmn-auto-layout`.
  - **E2-4** (plan.md DoD): ticked `plan.md` §6 boxes 1–3 (Vitest goldens,
    Playwright-electron suite, CI-produces-installer) with one-line
    evidence pointers into this ledger and the live test run this lane
    performed. Boxes 4 (Ahmed's laptop, wave G) and 5's "project memory
    updated" tail are left unticked — legitimately still pending a human
    gate this lane can't perform.
  - **Full gate re-run at HEAD before release** (this lane, live):
    `npm run typecheck` clean; `npm run build` clean; `npm test` →
    **25 files / 200 tests, all green**; `npm run test:e2e`
    (`DISPLAY=:0`) → **8/8 passed** (workspace, editor, ai-generate,
    linking ×2 specs, prompt-modal, settings, boot-and-first-run).
  - **Tracked maintenance item (not fixed this wave)**: Electron is
    pinned at `^33.3.1` (installed `33.4.11`); `npm outdated` shows
    latest is `43.2.0` — ten majors behind. Left as-is deliberately (a
    major Electron bump is a real compatibility/regression risk, out of
    scope for a docs/licensing/release lane); flagging here as a
    tracked-not-forgotten maintenance item for a future wave.
  - **Release v0.1.2**: bumped `package.json` version `0.1.1` → `0.1.2`
    (no dependency changes). This is the first release intended for
    actual end-user install — tagged, pushed, built by CI on
    `windows-latest`, and published **not as a prerelease** (unlike
    `v0.0.1-alpha.2` and `v0.1.1`, which stay marked prerelease) so
    electron-updater's GitHub-provider auto-update treats it as the
    current stable release. See this lane's report (`F3.md`) for the CI
    run URL, asset list, static NSIS/`asInvoker` checks, and
    `latest.yml` version confirmation.

**Wave F status: all E1/E2 findings routed to this wave are resolved (F1
window.prompt fix, F2 CSP/secrets/nav/XML hardening, F3 docs/licensing) or
explicitly tracked as deferred maintenance (Electron major upgrade).
`v0.1.2` is the first non-prerelease, end-user-installable release.**

## 2026-07-22 — Cross-check: desktop pipeline → SpiffArena import ✅
- Desktop gen pipeline (validate→transform→xml→layout, no LLM, nested-exclusive fixture) produced a 5.6KB BPMN+DI file; imported into the running SpiffArena via the bridge → model created, byte-identical on disk, git-committed, and **accepted by SpiffArena's own BPMN parser** (`bpmn_process_ids: ['Process_1']`). Zero incompatibilities. Test model deleted; fixture restored. Closes the interop DoD item — remaining boxes are all wave-G laptop items (install, live keys, auto-update proof).

## 2026-07-22 — Wave G gate result: UNSIGNED INSTALLER BLOCKED on target laptop ❌
- Ahmed's laptop: SmartScreen bypass worked ("Run anyway") but corporate application control then blocked execution ("Windows cannot access the specified device, path, or file" + "blocked by your company, request support" dialog) — AppLocker/WDAC or enterprise SmartScreen. Risk #1 materialized in its strong form.
- Claude Desktop precedent reinterpreted: per-user installs are fine, but the policy gates on PUBLISHER SIGNATURE/reputation — unsigned exes are blocked regardless.
- Viable legitimate routes: (1) IT approval request (block dialog offers it); (2) Azure Trusted Signing (~$10/mo) so builds carry a stable publisher identity — also makes IT approval durable across auto-updates (publisher rule, not per-hash); (3) browser-delivered fallbacks (single-file editor / future web version) which app-control does not gate. NO policy-evasion workarounds will be attempted.

## 2026-07-22 — Wave G2 lane L1: portable-exe experiment

- **Framing**: this is a *test of whether packaging form matters* to the
  Wave G corporate-app-control block, run openly on the same laptop — not
  a workaround. Expected result going in: an unsigned portable exe should
  hit the same publisher-reputation gate as the unsigned NSIS installer.
  Either outcome (blocked identically, or something more specific like
  "runs but flags differently") is useful data for deciding between IT
  approval, Azure Trusted Signing, or the browser-delivered fallback (L2,
  this wave).
- Added `.github/workflows/portable-experiment.yml` — `workflow_dispatch`
  only (never runs on tag pushes), `windows-latest`, `permissions:
  contents: write`. Deliberately does **not** touch the committed
  `electron-builder.yml` or `package.json`: it generates a throwaway
  `electron-builder.portable.yml` at runtime (same appId/icon/files, `win
  .target` swapped to `portable`, nsis block dropped) and builds against
  that, so the real NSIS release pipeline config stays byte-for-byte
  untouched. Uploads the resulting exe as a workflow artifact
  (`--publish never`, no release side-effect from the build step itself).
- CI run `29941270325` on `main` (commit `630d268`) went green on the
  first attempt (`build-portable` job, ~2m49s) — no retry needed.
- Downloaded the artifact (`gh run download`) and verified statically:
  `file` → `PE32 executable (GUI) ... Nullsoft Installer self-extracting
  archive`; `7z l` → NSIS-3 Unicode, single `$PLUGINSDIR/app-64.7z`
  payload (electron-builder's portable target is still NSIS-based — a
  self-extracting single exe, not a true zero-extraction PE, but there is
  no separate install step: it unpacks to a temp dir and runs); `strings`
  on the embedded manifest confirms `requestedExecutionLevel
  level="asInvoker" uiAccess="false"` — same no-admin posture as the
  regular installer.
- Renamed to `OrbitPM-Process-Studio-Portable-0.1.2.exe` and attached to
  the **existing** `v0.1.2` release via `gh release upload` (no retag, no
  change to the other three assets — `latest.yml` and the NSIS
  Setup.exe/.blockmap pair are untouched, confirmed via `gh release
  view`).
- **Download URL for the laptop test**:
  https://github.com/ahmedak320/bpmn-studio/releases/download/v0.1.2/OrbitPM-Process-Studio-Portable-0.1.2.exe
- **Instructions for Ahmed** (test openly — if the same "blocked by your
  company, request support" dialog appears, that confirms the block is
  publisher-based, not installer-form-based, and IT approval / Azure
  Trusted Signing remain the real paths forward):
  1. Download `OrbitPM-Process-Studio-Portable-0.1.2.exe` from the link
     above (it will land in `Downloads`, same as the Setup.exe before it).
  2. Run it directly from `Downloads` — no install step, it launches (or
     attempts to launch) the app directly.
  3. Note the *exact* error text if blocked (screenshot or copy-paste is
     ideal) — same corporate app-control dialog as before, a different
     message, or a silent failure are all distinct, useful signals.

## 2026-07-22 — Wave G2 lane L2: OrbitPM Process Studio Lite (zero-install web editor)

- **What it is**: a standalone Vite + React + TS subproject in `lite/` whose
  build emits ONE self-contained `dist/index.html` (via
  `vite-plugin-singlefile`; JS, CSS, and the bpmn.io icon fonts all inlined as
  `data:` — zero external requests at load, only the user's own AI calls go
  out). App-control gates executables, not web pages, so this sidesteps the
  Wave G block entirely.
- **Reuse (not reinvented)**: imports the desktop app's pure code straight from
  `../src` via the `@app/*` Vite alias + tsconfig paths — `src/gen/**` (the
  whole IR→validate→transform→xml→layout→generateFromDescription pipeline,
  incl. `bpmn-auto-layout`), `src/shared/{processIndex,slug}.ts`, and the
  browser-safe renderer helpers `editor/{dirty,callActivity,exportImage,
  newDiagram}`, `editor/EditorTab.css`, `links/{LinkPicker,modelerOps}`, and
  `common/{PromptProvider,TextInputModal}`. Only two React shells that touch
  bpmn-js — `EditorTab` and `SelectionLinkButton` — are *ported* into
  `lite/src` (they still reuse all the pure helpers + CSS above); porting was
  required because (a) bpmn-js's nested `bpmn-moddle@10` named export only
  resolves when the import originates from `lite/src`, and (b) both desktop
  files carry latent type annotations (a canvas cast, an incompatible
  interface-`extends`) that a real `tsc` surfaces — see the deviations note.
- **New (lite-only)**: `fs/fsAccess.ts` — the File System Access API adapter
  (recursive `.bpmn` tree, read/write via handles, create/rename/delete,
  slug dedup) written pure so it's unit-testable with mock handles;
  `fs/idb.ts` (persist the directory handle) + `fs/workspaceHandle.ts`
  (pick / remember / re-request permission, with the single-file fallback when
  `showDirectoryPicker` is unavailable); `ai/browserAi.ts` (browser-direct
  `generateObject` through the SAME `generateFromDescription`, Anthropic via
  the `anthropic-dangerous-direct-browser-access` header + Gemini);
  `ai/keys.ts` (localStorage keys with the unencrypted-storage warning); and
  the 3-zone `App.tsx` (folder tree · tabbed bpmn-js editor + props panel +
  minimap · collapsible AI panel), settings dialog, and picker/tree/AI
  components.
- **Graceful degradation**: full folder mode on Edge/Chrome; automatic
  single-file open + download-on-save fallback (with an explanatory banner) on
  browsers without the File System Access API.
- **AI CORS reality**: only Anthropic + Gemini are reachable from a browser;
  the panel + README state plainly that OpenAI/Kimi/DeepSeek/Azure/GLM need the
  desktop app (or a future web backend).
- **Verification (all green, live this lane)**:
  - `lite` unit tests: **18/18** (`vitest` — the FS-adapter glue with mocked
    handles: tree build, read/write round-trip, create/rename/delete, dedup,
    flatten-for-index).
  - `lite` typecheck: `tsc --noEmit` **clean** (over lite + every reused
    `../src` file it pulls in).
  - `lite` build: one `dist/index.html`, **2.81 MB** (fonts inlined; within the
    2–5 MB target); verified `dist/` contains exactly one file and no
    non-`data:` `url()`/`<script src>`/`<link href>`.
  - **E2E** (`playwright` chromium, **headed** `DISPLAY=:0`, loads the BUILT
    file over `file://`): **2/2** — page renders, forced single-file fallback →
    New blank diagram → bpmn-js canvas shows shapes (start-event circle) →
    Export SVG yields real SVG content; **request interception asserts ZERO
    network/sub-resource requests at load** (proves self-containment); second
    spec asserts the browser-only provider note. FS-picker flows can't be
    automated (native dialog) — covered the fallback path per the plan.
  - **CI-build simulation**: rebuilt in an isolated tree with **no parent
    `node_modules`** (only `lite/ npm ci`) → **byte-identical** artifact,
    proving the Pages workflow resolves the `../src` reuse to `lite/node_modules`
    via Vite `dedupe`.
  - **Parent gates unaffected**: `npm run typecheck` clean, `npm run build`
    clean, `npm test` **200/200** (back to baseline after excluding `lite/**`
    from the root `vitest.config.ts`).
- **Delivery**:
  - `.github/workflows/pages.yml` (new) — on push to `main` touching `lite/**`,
    `npm ci && npm run build` in `lite/`, then `upload-pages-artifact` +
    `deploy-pages` (`permissions: pages: write, id-token: write`).
  - GitHub Pages enabled via `gh api` (`build_type=workflow`).
  - **Live page**: <https://ahmedak320.github.io/bpmn-studio/>
  - **Release asset**: `OrbitPM-Process-Studio-Lite.html` attached to the
    existing `v0.1.2` release (renamed copy of `dist/index.html`; the other
    v0.1.2 assets — NSIS Setup.exe/.blockmap, latest.yml, and L1's Portable
    exe — untouched).
  - README **Lite** section (what it is, the two ways to get it, offline
    matrix, the AI provider-support table, the localStorage key warning) +
    a Development → Lite subsection.
- **Deviation (flagged)**: touched one shared file outside this lane's stated
  ownership — added `'lite/**'` to the root `vitest.config.ts` `exclude` (one
  line). Without it the desktop `npm test` gate collects lite's vitest + throws
  on lite's Playwright spec. This is the minimal change that keeps the parent
  gate green (a wave rule), and is disjoint from L1's files. Did NOT edit the
  reused desktop renderer files (ported the two problematic shells into
  `lite/` instead) to keep all other changes inside `lite/**`.
- **Instructions for Ahmed (laptop)**: open
  <https://ahmedak320.github.io/bpmn-studio/> in **Edge** → click **Open a
  folder…** → pick a OneDrive folder → draw / organize / link; **Ctrl+S**
  saves in place. AI: **Settings → paste an Anthropic or Gemini key** (note the
  unencrypted-storage warning), then **Generate**. Offline-only machine or a
  browser that blocks folders → it drops to single-file open + download-on-save
  automatically. Alternatively download `OrbitPM-Process-Studio-Lite.html` from
  the v0.1.2 release and double-click it — same app, one file, keep it in
  OneDrive.

## 2026-07-22 — Azure Trusted Signing: NO-GO for UAE (verified, $0 spent)
- Microsoft's Artifact Signing (ex-Trusted Signing) Public Trust identity validation is limited to orgs in USA/Canada/EU/UK and individuals in USA/Canada (FAQ dated 2026-05/06); individual onboarding paused; "no ETA" for other countries. UAE ineligible on both paths → agent halted at the go/no-go gate, created nothing.
- Fallbacks on the table: (A) SSL.com OV + eSigner cloud (~$20/mo, turnkey headless CI signing via official GH Action + electron-builder custom sign hook — note: repo has electron-builder 25.1.8; native azureSignOptions would have needed v26, moot now); (B) Certum Open Source cert (~$58, qualifies — public MIT repo — but SimplySign signing is GUI/manual, weak CI fit); (C) Azure **Private Trust** IS UAE-eligible but only works if the target org's IT deploys the private root (WDAC) — an IT-cooperation path; (D) IT-first: ask what they'd allowlist before buying.
- Awaiting Ahmed's decision. Lite editor (no executable) live meanwhile at https://ahmedak320.github.io/bpmn-studio/

## 2026-07-22 — Decision: signing PARKED (Ahmed)
- No cert purchase, no IT request for now. The Lite editor (https://ahmedak320.github.io/bpmn-studio/) is the laptop solution; the full desktop app remains for unrestricted machines. Signing options stay documented above for when/if revisited (SSL.com eSigner ~$20/mo = best CI fit for UAE; Certum ~$58 manual; Azure Private Trust only via target-org IT; Microsoft Public Trust pending UAE availability).
- Still open when circumstances allow: live AI-key verification (needs any provider key), Windows auto-update proof (needs any unrestricted Windows machine), Electron 33→43 upgrade (tracked maintenance).

## 2026-07-22 — Lite: empty-folder dead-end fixed + drawing/linking polish (LF1)
- **Bug (from the laptop, folder mode on corporate Edge)**: opening an EMPTY folder rendered a blank tree with **no visible way to create anything** — the folder-tree only drew rows for existing files and the sole create path was a non-obvious right-click on a zero-height area.
- **FIX 1 (dead end)** — starting a process is now unmissable, three ways: an always-visible header **＋ New process** button (both modes); a sidebar **create bar** (New process / New folder); and a **"No processes yet"** empty-state card (big **Create your first process** button + a line explaining folder→file) whenever the folder holds no `.bpmn`. New-process flow: TextInputModal → slugify → create a file whose `<process id>` derives from the slug (`Process_<slug>`, a **stable calledElement target**) with the entered name as `name` — real file in folder mode, in-memory download-on-save tab in fallback. Right-click menu retained as the secondary path once files exist.
- **FIX 2 (drawing completeness)** — audited `EditorTab` against bpmn-js Modeler defaults: full palette (events/tasks/gateways/sub-process/call-activity/data objects/pool), context pad, label editing, snapping/align, copy-paste and **create-append-anything** (core module only — the element-templates variant needs an `elementTemplates` service and crashes) are all present. Added visible **zoom ＋ / − / Fit** buttons (ctrl+scroll already on). Confirmed **keyboard shortcuts** (undo/redo/copy/paste/delete/select-all) work: bpmn-js 18 **auto-binds them to the focusable canvas SVG** (`tabindex=0`) — the old `keyboard.bindTo: document` is *unsupported now* and, with multiple live tabs, would let background diagrams react to a Delete — so it is deliberately not set (verified by an e2e Ctrl+Z undo).
- **FIX 3 (reusable blocks)** — an unresolved `calledElement` now offers **"create this process now"** (double-click the call activity, or click the footer **unresolved-links badge**): creates a `.bpmn` whose `<process id>` is fixed to the calledElement so the link resolves immediately; existing link → double-click still drills in; properties panel still allows manual calledElement entry.
- **FIX 4 (intuitiveness)** — tooltips on every toolbar/header/sidebar button; a brand-new-diagram **"Start drawing"** hint overlay that latches away on the first edit (and never returns after a Save); clearer dirty label; **Escape closes** the LinkPicker and Settings modals (TextInputModal already did; focus/select verified).
- **Shared (@app) edits, justified & additive**: `createNamedDiagramXml` added to `renderer/editor/newDiagram.ts`; Escape handling added to `renderer/links/LinkPicker.tsx`. Parent `typecheck`/`test`/`build` stayed green.
- **Gates**: lite `tsc` 0 · lite vitest **35** (added newProcessDoc both-mode + dangling-link resolution, countBpmnFiles empty-tree, EmptyWorkspaceCard render) · lite e2e **4** (new-process modal → full-palette check → programmatic task → Ctrl+Z undo → export, all zero-network; Escape-closes-modal) run **twice** green · desktop typecheck 0 / test 200 / build ok.
- **Shipped**: single file rebuilt (self-contained, **2.75 MB / gzip ~777 KB**, 1 file). Pushed to main → Pages run `29946714370` green; live <https://ahmedak320.github.io/bpmn-studio/> serves the new build (content-length 2 815 168, markers "Create your first process"/"Start drawing" present). Release asset `OrbitPM-Process-Studio-Lite.html` on **v0.1.2** re-uploaded (`--clobber`, 2 815 168 bytes).

## 2026-07-22/23 — Wave 2: provider expansion + company-doc completeness + Arabic i18n/RTL (W2A+W2B+W2C)

Three lanes landed in sequence on top of LF1, each rebased onto the previous
and gate-verified before the next started; this entry summarizes all three.

- **W2A — provider expansion + PDF-to-BPMN** (commit `79ce43c`): added
  **OpenRouter** (one BYOK key reaching GLM-5.2/Kimi K3/DeepSeek V4/Claude/
  Gemini via `provider/model` slugs, live-verified against
  `GET /api/v1/models`) and a **Custom OpenAI-compatible endpoint** (base URL +
  model + extra headers) to the four browser-callable Lite providers; a
  Settings **"Test connection"** probe per provider that truthfully
  distinguishes a CORS block from an auth failure; and **PDF-to-BPMN**
  generation (native PDF understanding via each provider's own document/
  inlineData/file part — no bundled `pdfjs-dist` — with client-side size
  gates per provider and an optional "which process?" hint field, EN/AR
  placeholder).
- **W2B — company-documentation completeness** (commit `a1fcb5b`, rebased onto
  W2A): file **rename/delete/move** (context menu, hover icons, drag-and-drop,
  a "Move to…" dialog, non-empty-folder delete requires typing the name);
  workspace-wide **search** (name/file/id/diagram-text, ≤2 MB content cap,
  grouped by folder); drag-in **import** of `.bpmn` files/folders from
  Explorer with collision auto-suffix; a **catalog/home view** (sortable,
  search-aware, click-to-open); **Back/Forward** navigation (Alt+Left/Right)
  + a folder **breadcrumb**; a workspace-wide **unresolved-links panel**
  (Create now / Open source per row); and a dedicated **Print/PDF** view
  (`window.print()`, landscape, full-page SVG — no PDF library).
- **W2C — Arabic i18n + RTL sweep** (this lane, commit `94e046b`, rebased onto
  W2B): a from-scratch `lite/src/i18n/` module (`t()`/`tPlural()` lookup +
  localStorage-persisted language state + a `useSyncExternalStore` React hook,
  ~35 lines of logic) with complete EN/AR dictionaries (280+ keys) covering
  every string introduced across all three lanes — app chrome, every dialog,
  the empty-state card, the folder-tree context menu, Settings (incl. W2A's
  provider-expansion + test-connection UI), the AI panel (incl. W2A's PDF
  flow), the editor toolbar, the link picker, and W2B's catalog/search/
  unresolved-links/print/toast/confirm/move UI. A header **language toggle**
  (EN ⇄ العربية, also on the landing/picker screen since the header doesn't
  exist there) persists the choice and flips `<html dir/lang>` immediately (no
  flash-of-wrong-direction). **RTL**: physical CSS properties converted to
  logical ones (`borderInlineEnd/Start`, `paddingInlineStart`,
  `insetInlineEnd`, `textAlign:'start'`) so the 3-pane layout (tree · editor ·
  AI panel) mirrors correctly under Arabic via CSS Grid's own RTL-aware track
  placement — the bpmn-js canvas + toolbar + properties panel are deliberately
  pinned `dir="ltr"` as one "work-surface island" (`.orbitpm-editor`) since
  bpmn-js/its palette/context-pad/minimap have no RTL mode of their own and
  hardcode LTR-assuming absolute positioning; toolbar button *labels* inside
  that island are still translated. **Arabic content correctness**: added
  `deriveFileBaseName()` to `newProcessDoc.ts` so a non-Latin process name
  keeps its script verbatim in the `.bpmn` file name (only Windows-illegal
  characters stripped) while `deriveProcessId()` still falls back to a stable
  ASCII `<process id>` (`Process_process`, deduplicated `_2`/`_3`/…) for the
  calledElement-linkable id — wired through every App.tsx creation path (new
  process, missing-link process, Explorer import, AI placement) so Arabic
  names work end-to-end in both directory and fallback modes.
- **Deviation (flagged)**: touched the shared `src/renderer/src/links/
  LinkPicker.tsx` (desktop + Lite both consume it) for a one-line
  `textAlign: 'left'` → `'start'` logical-property fix only — no string
  translation there (importing Lite's i18n module into a file the Electron
  desktop app also bundles would be wrong; the LinkPicker modal's own text
  stays English in Lite too, a residual gap, not a functional regression).
- **Known residual i18n gaps (honest, not silently dropped)**: bpmn-js's own
  palette/context-pad tooltips and the `@bpmn-io/properties-panel` field
  labels are English-only (third-party libraries, their own `translate`
  service override is out of scope this wave); a handful of deep AI-provider
  diagnostic strings (Settings "Test connection" verdict messages,
  `browserAi.ts`'s `classifyBrowserError` network/HTTP-status internals) stay
  English — the main generation-flow errors (`ai.error.*`) and the PDF
  size-gate messages ARE translated; the AI panel's provider **names/
  descriptions** (OpenRouter, Anthropic, model labels) stay English per the
  same "proper/product names aren't transliterated" convention as OrbitPM/
  BPMN; the vertical-tab `collapsedBtn`'s `rotate(180deg)` in `AiPanelLite.tsx`
  is not RTL-flipped (prep flagged this as needing a manual visual QA call
  this lane can't make from code alone).
- **Tests**: unit — a dictionary-completeness test (`i18n.test.ts`, walks
  every `.ts`/`.tsx` under `lite/src`, extracts every `t()`/`tPlural()` call
  site via regex, asserts full coverage in both `en` and `ar` plus
  placeholder-token parity — **12 tests**) + Arabic slug/id/file-name behavior
  (`deriveFileBaseName`, `buildNewProcessDoc`/`buildMissingProcessDoc` with
  Arabic names, and end-to-end `fsAccess` mock-handle tests proving an Arabic
  `.bpmn` file name round-trips through create/list/read — **9 new tests** in
  `newProcessDoc.test.ts`); e2e — 3 new specs: language toggle sets
  `dir=rtl`/`lang=ar` and persists to localStorage then back to `ltr`/`en`;
  create a process with an Arabic name in fallback mode, set an Arabic label
  on the canvas via the `__ORBITPM_LITE__` automation hook, assert the
  rendered SVG `<tspan>` and the exported SVG file both contain the Arabic
  text; assert `.orbitpm-editor` stays `dir="ltr"` while the app root is
  `dir="rtl"`.
- **Gates**: lite `tsc --noEmit` clean · lite `vitest` **155/155** (134
  existing + 21 new: 12 i18n-dictionary + 9 Arabic newProcessDoc/fsAccess) ·
  lite e2e (BUILT file over `file://`, `DISPLAY=:0`) **16/16** (13 existing +
  3 new i18n/RTL specs; 3 live-CORS specs self-skip without
  `LITE_LIVE_CORS=1`) run **twice** green · lite build: one `dist/index.html`,
  **2.49 MB / gzip 695 KB** (< 4 MB) · parent gates untouched: `typecheck`
  clean, `vitest` **200/200**, `electron-vite build` ok.
- **Shipped**: pushed to `main` (`94e046b`) → Pages run `29953398147` green;
  live <https://ahmedak320.github.io/bpmn-studio/> serves the new build
  (content-length 2 493 719, matching `dist/index.html` byte-for-byte;
  markers `app.lang.toggle` / `عملية جديدة` present). Release asset
  `OrbitPM-Process-Studio-Lite.html` on **v0.1.2** re-uploaded (`--clobber`,
  2 493 719 bytes) — this refresh carries all three W2 lanes (A+B+C), per
  W2B's note deferring the release-asset re-upload to this final wave
  integration point.

## Wave FX (post-review fixes)

Two independent reviews of `c5de138..94e046b` (Claude live-review + Codex
GPT-5.6-Sol code-review) found issues; three lanes (FX1, FX2, FX3) fixed and
shipped them. Commits: `32f7c84` (FX1), `d49635d` (FX2), `ae33e7d` (FX3).

- **Claude-review fixes (2)**:
  1. **CSP/OpenRouter** — `lite/index.html`'s `connect-src` now whitelists
     exactly `'self' https://api.anthropic.com
     https://generativelanguage.googleapis.com https://openrouter.ai` (was
     broader/inconsistent with the shipped provider set). The Custom
     OpenAI-compatible endpoint is a closed allowlist by nature (arbitrary
     origin), so it was made **desktop-app only**: marked
     `providersLite.desktopOnly`, Test-connection disabled in Settings,
     Generate disabled in the AI panel, copy updated (en+ar). New e2e
     (`lite-providers.spec.ts`) asserts the **BUILT dist** CSP whitelists
     exactly those 3 origins.
  2. **e2e headless config** — `playwright.lite.config.ts` shipped with
     `headless: false`, requiring a live `DISPLAY`; in a sandbox/CI with no
     display Playwright blocks waiting for a browser window that never
     appears — the root cause of a prior ~4h hang. bpmn-js renders fully in
     headless chromium (real Canvas/SVG, no GPU dependency), so headed mode
     bought no coverage. Switched to `headless: true` with `actionTimeout`/
     `navigationTimeout`/`globalTimeout` backstops; dropped the now-unneeded
     `DISPLAY=:0` from README and the opt-in live-CORS spec's run
     instructions.

- **Codex fixes (10 by id, + minors)**:
  - **C1** (critical) — workspace-switch cross-write: `activateWorkspace`
    bumps a workspace generation + resets ALL state (tree/tabs/contents/
    dirty/modelers/history/dialogs) before the new scan; every `Tab` carries
    `gen`; saves refuse to write through a stale generation. Unsaved-switch
    dialog (Save all / Discard / Cancel) added.
  - **C2** (critical) — binary-safe folder copy: `copyTree`/`relocate` now
    copy raw bytes (`arrayBuffer`/`writeBytesAt`), never `file.text()`, so
    non-`.bpmn` files (PDFs, images, spreadsheets) survive move/rename
    intact. Toast reports file + non-BPMN counts.
  - **M3** (major) — collision atomicity: `createBpmnFileUnique` re-probes
    existence at write time and all create/import/AI-place writes serialize
    through a mutex; the slug is recomputed inside the lock.
  - **M4** (major) — PDF memory: Gemini gate lowered 40→32 MiB, single
    base64 encode (no re-encode downstream), soft warning above 15 MiB
    (en+ar).
  - **M5** (major) — OpenRouter PDF engine: stopped forcing
    `pdf.engine:'native'` (broken for the default text-input model
    `z-ai/glm-5.2`); now sends `plugins:[{id:'file-parser'}]` so the
    provider falls back per model. PDF UI notes "engine managed by
    provider".
  - **M6** (major) — Arabic process-id collisions: `deriveProcessId` derives
    from the (Arabic-preserving) file base name; non-Latin names hash to a
    unique `Process_<8-char FNV-1a>` id instead of all collapsing to
    `Process_process`; filename dedup transfers to id uniqueness.
  - **M7** (major) — external-change staleness: manual **Refresh** button in
    the tree header + debounced (2s) auto-refresh on window focus /
    visibilitychange.
  - **M8** (major) — out-of-order refreshes: `refreshWorkspace` claims a
    token from a refresh guard and commits only if it's the latest token
    for the still-active handle, so a slower earlier scan can no longer
    clobber a later one.
  - **M9** (major) — transport vs. model-output errors: new `TransportError`
    (401/403/429/CORS/network/timeout) is thrown by the browser AI client
    and rethrown immediately by the repair loop — no retry, no re-upload of
    the PDF attachment, on a permanent failure.
  - **M10** (major) — missing timeouts: `fetchWithTimeout` (AbortController)
    on every fetch — 180s for generation, 15s for test-connection — timeout
    surfaces as a typed `TransportError` with i18n copy (en+ar).
  - **Minors fixed**: search over-emitting unrelated processes from
    multi-process files (now matches on the process's own name/id/content
    only); Arabic-sweep gaps — provider descriptions, test-connection
    verdicts, and error classifications now render via i18n keys instead of
    hardcoded English; rename accepting names that drop `.bpmn` or embed a
    path separator (now auto-appends `.bpmn`, rejects `/`/`\`); unhandled
    promise rejections on drag/picker/fallback-open import (now caught,
    surfaced as a toast); the CORS discriminator marking every rejected
    fetch as "CORS-blocked" regardless of cause (now reports "Blocked or
    unreachable (CORS, offline, or DNS)" — resolved HTTP responses were
    already classified correctly).
  - **Deferred (residual, flagged not silently dropped)**: *whole-workspace
    traversal performance* — every mutation still re-traverses and re-reads
    the entire workspace tree (`refreshWorkspace` scans + reads all `.bpmn`
    files fully into memory), and the search 2 MiB guard only skips
    building `contentText` after the full XML is already loaded. Not a
    correctness bug at the workspace sizes this tool targets (a handful to
    low hundreds of processes); flagged as a scaling concern for very large
    workspaces (thousands of files) — no lane in this wave addressed it.

- **Policy decision**: the Custom OpenAI-compatible provider (arbitrary
  base URL) is **desktop-app only**. The web/Pages build's CSP is a closed
  allowlist (`self` + the 3 browser-callable providers) by design for
  zero-network-at-load + no attacker-controlled origin in a page anyone can
  load; the desktop Electron app has no such CSP constraint and keeps full
  Custom-endpoint support.

- **Gates (this wave, all green)**: lite `tsc` clean · lite `vitest`
  **191/191** · lite e2e **HEADLESS** (built dist over `file://`, no
  `DISPLAY` needed) **17 passed / 3 self-skipped** (live-CORS opt-in), run
  **twice**, ~11–14s each (was an unbounded hang under `headless:false` with
  no display) · lite `vite build`: **one file**, `dist/index.html`
  **2 508 529 bytes / 2.39 MB** (< 4 MB) · parent `typecheck` clean ·
  parent `vitest` **203/203** · parent `electron-vite build` ok.

- **Built dist verified**: single file (`find dist -type f` → 1) · CSP
  `connect-src` = exactly `'self' https://api.anthropic.com
  https://generativelanguage.googleapis.com https://openrouter.ai` · size
  2 508 529 bytes (2.39 MB, well under the 4 MB budget) · zero-network-at-load
  spec (`lite-smoke.spec.ts`) green in both headless runs.

- **Shipped**: pushed to `main` (`ae33e7d`) → Pages run `29959364765`
  **success**; live <https://ahmedak320.github.io/bpmn-studio/> is
  **byte-identical** to the local build (`sha256
  d23e8578ab31c8ebf67a08ccc0842baf4f5da0e1e64571f7ed29baec6c7b3c9b`,
  content-length 2 508 529 matches). Release asset
  `OrbitPM-Process-Studio-Lite.html` on **v0.1.2** re-uploaded (`--clobber`,
  2 508 529 bytes, sha256-verified against the local build by re-downloading
  it) — supersedes the prior 2 493 719-byte asset with all of FX1+FX2's
  fixes.

- **Live spot-checks**: this sandbox has no working browser-automation
  extension (`claude-in-chrome` reports "extension not connected" — a
  sandbox limitation, not a product issue), so the OpenRouter Test-connection
  click could not be driven end-to-end from here. Verified the documented
  fallback instead: (a) the **live** page's CSP whitelists `openrouter.ai`
  (confirmed above, byte-identical to local); (b) `curl
  https://openrouter.ai/api/v1/models` → **200** from this sandbox (egress to
  OpenRouter is NOT blocked here, better than expected); (c) `curl
  https://api.anthropic.com/v1/models` → **401** and `curl
  https://generativelanguage.googleapis.com/v1beta/models` → **403**, i.e.
  both reachable (server responded; only auth is missing) — consistent with
  Anthropic/Gemini Test-connection reporting reachable. Arabic toggle sanity
  was verified against this exact artifact by the headless e2e suite
  (`lite-i18n-rtl.spec.ts`, both runs green): language toggle sets
  `<html dir="rtl">`, translates chrome strings, and the bpmn-js canvas
  island stays `dir="ltr"`. **What the user should click to get final
  browser-side proof of OpenRouter**: open
  <https://ahmedak320.github.io/bpmn-studio/> → Settings → Test connection
  next to OpenRouter — expect "reachable" (a 4xx/CORS-open response), not
  "blocked".

## 2026-07-23 — Lite: robust Escape handling for modals (intermittent close flake fixed)

- **The flake**: headless e2e `lite-smoke.spec.ts:189` "Escape closes the
  New-process modal" failed intermittently (independently reproduced 1-of-2
  full runs): the modal opened, Escape was pressed, and the dialog never
  closed (locator count stayed 1 through the full 5 s / 14-retry window — the
  handler simply didn't fire that run, not a frame race).
- **Root cause**: the shared `TextInputModal` (src/renderer/src/common/,
  which Lite imports via `@app/renderer/src/common` for every `promptText`
  flow) handled Escape only through a React `onKeyDown` bound to the dialog
  `<div>`, which fires **only when focus is inside that div**. Focus is moved
  into the input asynchronously in a `requestAnimationFrame` on open; until
  that rAF lands, focus is still on the button that opened the modal —
  **outside** the dialog — so an Escape dispatched in that pre-focus window
  is delivered to the button and never reaches the dialog handler. The e2e
  test presses Escape immediately after the dialog becomes visible, without
  waiting for focus, so it hits this window under load. Proven deterministically
  with a scratch repro that stole focus back to the trigger button before
  Escape: **5/5 FAIL** on the pre-fix build, **5/5 PASS** after (repro removed,
  not committed — minimal diff).
- **Fix** (`TextInputModal.tsx`, +28/−3): added a window-level **capture**
  keydown listener active exactly while the modal is open (removed on close),
  which closes the modal on Escape regardless of where focus is — the same
  focus-independent pattern the app's other modals already use (workspace
  `Modal.tsx`, `SettingsDialogLite`). Latest-cancel-handler ref keeps the
  listener subscribed for the whole open lifetime without re-binding per
  keystroke. Enter-to-confirm, autofocus/select, and overlay/Cancel dismissal
  are unchanged; the dialog `onKeyDown` now owns Enter only. Lite's sibling
  modals were audited and already robust, so no other changes were needed.
- **Proof**: `-g "Escape closes" --repeat-each 15` → **15/15 green** (was
  flaky). Full Lite e2e suite **twice** headless → 17 passed / 3 skipped
  (live-CORS) each run. Lite `tsc` clean; Lite vitest **191/191** (20 files).
  Parent gates unchanged: `tsc` clean, vitest **203/203** (25 files),
  `electron-vite build` OK.
- **Ship**: commit `926ce7c` pushed to `main`. Pages workflow dispatched
  (the fix lives in `src/`, outside the workflow's `lite/**` path filter, so
  it doesn't auto-trigger) and watched to green; **live** page content-length
  went **2 508 529 → 2 508 727** bytes. Release asset
  `OrbitPM-Process-Studio-Lite.html` on **v0.1.2** re-uploaded (`--clobber`,
  now 2 508 727 bytes).

## 2026-07-23 — Lite: remediation round — close Codex re-review findings (FX4)

A Codex GPT-5.6-Sol re-review of the FX1+FX2 wave found 9 findings still
partially open plus 2 regressions the prior wave introduced. This lane closed
all 13, **test-first** (test written and shown FAILING on pre-fix code, then
fixed, then shown passing). Lite unit suite **191 → 230** (28 files; +39 new
tests across 8 new files). Full per-item ledger:

- **[NEW-C1] Case-only rename/move deleted files on case-insensitive FS.**
  Root cause: `relocate()` compared `destRel !== fromRel` case-sensitively, so
  `Order.bpmn → order.bpmn` on macOS/Windows (one inode) ran copy-then-delete
  and the delete removed the file it had just written. Fix (`fsAccess.ts`):
  `isSameEntryTarget()` detects a same-parent case-only name match, confirmed via
  `isSameEntry` handle identity where available; when same-entry, `safeSelfRename()`
  stages through a temp name (`copy → delete source → copy temp → delete temp`),
  covering files AND folders. Test evidence: `fsCaseInsensitive.test.ts` with a
  new case-insensitive mock (`newRootCI`) — 3 case-only tests FAIL on pre-fix
  (`NotFound`, data lost) → 5/5 PASS after.

- **[NEW-C2] `saveAllDirty` silently discarded fallback tabs.** Root cause:
  `saveAllDirty` skipped tabs with `relPath === null` while `guardWorkspaceSwitch`
  counted them — "Save all & switch" dropped their unsaved work. Fix: pure
  `partitionDirtyTabs()` (`workspace/dirtySave.ts`) splits dirty tabs into
  `writable` (to disk) vs `downloadable` (fallback → download-on-save);
  `saveAllDirty` now downloads fallback tabs. Test: `dirtySave.test.ts` — buggy
  drop version FAILS 3/4 (downloadable empty) → 4/4 PASS after routing fallbacks
  to `downloadable`.

- **[ORIG-1] Cross-workspace holes.** (a) Async file read in `openDirectoryFile`
  could commit stale content after a mid-read folder switch. (b) AI placement
  could write into the switched-in workspace after a mid-generation switch. Fix:
  new pure `commitIfCurrent()` (`workspaceSession.ts`) commits a producer's
  result only if the generation is unchanged; `openDirectoryFile` reads through
  the live handle mirror under it; `placeGenerated` threads the
  generation-at-start (new `getWorkspaceGen` prop on `AiPanelLite` → `onPlaceGenerated`)
  and refuses at write time both before AND inside the op-mutex (new i18n
  `alert.staleGeneration`). Test: `workspaceSession.test.ts` — mid-read and
  mid-generation scenarios FAIL on absent guard (no export) → 10/10 PASS.

- **[ORIG-6] Arabic id collisions.** (a) Mixed names ("طلب A" / "موافقة A")
  stripped to the same short residue `_a` → both `Process__A`. Fix
  (`deriveProcessId`): hash the name when the ASCII residue is < 3 letters (was:
  only when zero Latin). (b) Both production call sites now pass the
  `dedupeProcessId` predicate against the live `processIndex` so any collision
  (incl. hash) is suffixed. Test: `arabicIdCollision.test.ts` — mixed-name
  distinctness + forced-hash-collision dedupe FAIL on pre-fix (`Process__A` ==
  `Process__A`) → 7/7 PASS; existing 25 `newProcessDoc` tests unchanged.

- **[ORIG-10] Timeout now covers the response BODY.** Root cause:
  `fetchWithTimeout` cleared the timer once headers arrived, so a stalled
  `res.json()`/`res.text()` could hang generation forever. Fix: it now takes a
  `consume(res)` callback and keeps the AbortController armed through body
  consumption; only our abort becomes `timeout`, HTTP/empty/JSON errors keep
  their own type (401→auth, 500→ProviderHttpError, empty→plain retriable).
  Test: `timeout.test.ts` — stalled-body mock stays `pending` (hangs) on pre-fix
  → resolves to `timeout` after; error-typing regression guards included. 4/4 PASS.

- **[ORIG-3-partial] Rename/move routed through the op-mutex.** `handleRename`
  and `performMove` now run inside `opMutexRef.runExclusive`, serialized with
  create/import/AI-place; `relocate` re-probes the destination inside that
  critical section immediately before writing. **Residual limitation documented**
  in code + here: the File System Access API has no atomic create/rename, so an
  EXTERNAL writer can still land a name between our probe and write — unfixable
  without native atomicity (see deferred "true FS-API atomic create"). Test:
  `opSerialization.test.ts` — proves shared-mutex create→rename never interleaves
  (and that bypassing it DOES interleave). 3/3 PASS.

- **[NEW-minor] `copyTree` retry-ability.** A folder copy that failed partway
  left a partial/stale destination; a retry would be `source ∪ leftovers`. Fix:
  `copyTree` cleans the destination first (deterministic overwrite). Test:
  `fsRetry.test.ts` — a stale `ghost.bpmn` survives on pre-fix → removed after. 2/2.

- **[NEW-minor] Single-refresh coherence.** `refreshWorkspace` did two
  independent walks (`buildTree` + `scanWorkspaceFiles`) that could disagree if
  the folder changed between them. Fix: one `snapshotWorkspace()` traversal
  yields both the tree and file-metas from a single listing under the same
  refresh token. Test: `fsSnapshot.test.ts` with a root that mutates between
  enumerations — naive two-walk version FAILS (tree lacks `late.bpmn`, scan has
  it) → single-traversal PASSES; a companion test documents the old incoherence.
  3/3.

- **[ORIG-11] Search honesty (per-process content attribution).** Root cause:
  content was file-level, so a term inside process A's elements emitted process B
  too. Fix (`searchIndex.ts`): `splitProcessContent()` splits diagram text by
  `<process>` element ranges; each process matches only its OWN content; text
  outside any process is labeled file-level ("matched in file", no `processId`).
  Test: `searchIndex.test.ts` — "request" (in A only) now emits A alone, and an
  out-of-process "vendor" hit is file-level; 4 pre-fix over-broad assertions FAIL
  → 19/19 PASS (updated the test that pinned the old 2-hit semantics).

- **[ORIG-12] Raw-English picker error passthroughs.** The two untemplated
  `setPickError(errMsg(err))` sites (open-folder, reconnect) surfaced raw browser
  exception text. Fix: pure `classifyPickerError()` (`workspaceHandle.ts`) →
  stable code → i18n key (`alert.picker.security/notAllowed/unknown`, en+ar MSA;
  `aborted` = no error). Audit found exactly these two untemplated sites; all
  other error surfaces already route through i18n templates. Test:
  `pickerError.test.ts` FAILS on missing export → 4/4 PASS.

- **[ORIG-14] `corsBlocked` → `blockedOrUnreachable`.** A fetch reject is CORS OR
  offline OR DNS; the old flag overclaimed "CORS". Renamed on `TestConnectionResult`
  and every construction/consumer (`browserAi.ts`, `SettingsDialogLite.tsx`), and
  the regression test that pinned the old semantics updated
  (`testConnection.test.ts`, message + field). 7/7 PASS.

- **[NEW-minor] CSP hardening.** Added `object-src 'none'; base-uri 'self';
  form-action 'self'` to `lite/index.html` (connect-src left EXACTLY as-is).
  Built-CSP e2e assertion added (`lite-providers.spec.ts`). Verified in the built
  `dist/index.html`: connect-src unchanged, three hardening directives present.

- **[ORIG-4] Gemini PDF cap lowered to 20 MiB.** All three browser providers now
  share the 20 MiB cap (was Gemini 32 MiB); the >15 MiB soft warning stays; the
  over-limit advice is now "split the file" (no misleading "try Gemini"); and a
  new PDF UI hint (`ai.pdf.memoryNote`, en+ar) documents the base64 (~+33%) +
  JSON-copy in-memory multiplier. Test: `pdf.test.ts` — old 32-MiB assertions
  FAIL → 12/12 PASS.

- **DEFERRED (documented, not fixed):** ORIG-16 whole-workspace scaling (re-reads
  every `.bpmn` on each refresh — acceptable for the target small/medium
  workspaces); true FS-API atomic create/rename (no browser primitive exists —
  the op-mutex + re-probe is the best available in-app mitigation).

- **Gates (all green, run twice for e2e):** Lite `tsc` clean; Lite `vitest`
  **230/230** (28 files); Lite e2e headless **18 passed / 3 skipped** (live-CORS,
  key-gated) on BOTH runs incl. the new CSP-hardening assertion. Parent `tsc`
  clean; parent `vitest` **203/203** (25 files); parent `electron-vite build` OK.
  Built `dist/index.html`: single file, **2 514 266 bytes**, sha256
  `231dbbe13074fd535cf5218215f67c4c92c8ef75e814fc6a340a660e9cb695a7`.

- **Ship:** one commit `lite: remediation round — close Codex re-review findings
  (FX4)`; all changed paths under `lite/**`, so the push AUTO-triggers the Pages
  workflow (no `workflow_dispatch` needed). Live content-length re-verified
  against the local build and the **v0.1.2** `OrbitPM-Process-Studio-Lite.html`
  release asset re-clobbered post-deploy (see task report for the exact bytes).

## 2026-07-23 — Lite: sidebar, banded print, AI linking + credits, DMT org pack, assistant, library (Phases A+B)

Two-phase feature wave. **Phase A** (`4c0c4b3`) landed eight disjoint modules
in parallel, each with its own file tree and standalone unit tests; **Phase
B** (`8993a76`) then integrated all eight into the live app across five
sequential lanes, each rebased onto the previous and gate-verified before the
next started.

- **Phase A — 8 parallel module lanes**:
  1. `src/gen`: `callActivity` IR type + `calledElement` emission + an
     optional workspace-catalog prompt section (byte-golden safe — a
     `catalog-prompt.test.ts` assertion pins "no catalog ⇒ byte-identical to
     the golden render").
  2. `lite/src/ai/credits.ts`: OpenRouter `/api/v1/credits` balance fetch +
     a local per-provider usage ledger.
  3. `lite/src/owner`: workspace-wide owners index (regex-scanned
     `orbitpm:owner*` attributes across all files), searchable
     `OwnerPicker`, CSV export.
  4. `lite/src/links`: morph-any-linkable-activity-to-CallActivity + link,
     `calledElement` strip, 🔗 badge overlay installer.
  5. `lite/src/print`: pure A4-landscape band-wrap engine (`computeBandPlan`)
     + `svgSlice`, plus the banded `PrintView`.
  6. `lite/src/org`: `orbitpm` moddle extension (`extends: ['bpmn:BaseElement']`,
     so every flow node/process/start-event gains the attributes), DMT
     palette/renderer, the org-styling settings flag.
  7. `lite/src/assist`: process digests, retrieval/ranking, local
     deterministic next-step answerer.
  8. `lite/src/library`: fflate-based zip export/import with safe-path
     validation.
  - Gate: lite vitest 396 (new baseline), desktop tests/unit 169 — both green.
- **Phase B — 5 sequential integration lanes**:
  - **B1** wired the single collapsible left sidebar (tree + embedded AI
    generator) into `App.tsx`, the 16px rail toggle, auto-collapse-on-open,
    and the properties-panel **Panel** toolbar button; repaired existing e2e
    specs and added a new rail smoke test.
  - **B2** wired print to the band engine (A4 landscape, wide diagrams wrap
    into stacked bands), swapped `document.title` to the process name so the
    browser's Save-as-PDF dialog defaults to it, and added the owner line to
    the print header.
  - **B3** wired usage capture into every provider call, the
    OpenRouter-balance/session-usage `CreditsLine` into the AI panel +
    Settings, the workspace catalog into generation, the
    confident/unsure/unmatched proposed-link partition + `LinkVerifyDialog`,
    the link-any-task morph button, and the 🔗 badge installer per modeler.
  - **B4** registered the `orbitpm` moddle extension + DMT renderer in the
    editor, wired the unified `StepDetailsDialog` (owner/RACI, note, channel,
    CC, trigger), the owners CSV export, and the Settings org-styling toggle
    with a live re-render.
  - **B5** wired the process-assistant chat drawer (LLM answer with a local
    deterministic fallback), whole-library zip export/import, and
    experimental ARIS `.apc` conversion on import.
- **Bug found + fixed during B5** (production-only — not caught by Phase A's
  own gate): `lite/src/library/zipImport.ts`'s control-character regex was
  written with **literal raw control bytes** in the source. That survived
  Node/Vitest fine (git even stored the file as *binary* in the Phase A diff,
  `Bin 0 -> 2629 bytes`), but broke once Vite's production bundler processed
  it — `"Range out of order in character class"` — which would have taken
  down the whole built app the moment B5 wired the module into `App.tsx`, not
  just library import. Fixed by rewriting the same character class with
  `\x` escape sequences (`/[\x00-\x1f\x7f]/`, with a comment recording why the
  raw-byte form is unsafe once bundled) before it ever reached `main`.
- **Gates (final, whole tree)**: `npm run typecheck` clean; **lite vitest
  436/436**; **desktop tests/unit 169/169**; **playwright 23 passed / 3
  skipped** (the three `lite-live-cors.spec.ts` probes self-skip without
  `LITE_LIVE_CORS=1` set); single-file build **2,663 kB** (one
  `lite/dist/index.html`, no secondary assets).
- **Remaining open items** (flagged, not addressed this wave):
  - **Live LLM link-generation is untested without a real API key** — the
    confident/unsure/unmatched partition and `LinkVerifyDialog` flow are
    unit- and e2e-tested against mocked/local responses only; no lane in this
    sandbox held a live Anthropic/Gemini/OpenRouter key to exercise a real
    model's confidence output end-to-end.
  - **The `.apc` (ARIS) converter is awaiting a real ARIS sample** —
    `apcImport.ts` is tested only against a hand-written, synthetic AML
    fixture (`apcImport.test.ts`); it has never parsed an actual ARIS export,
    so its best-effort AML handling is unverified against real-world file
    quirks.
  - **DMT org-styling on a collaboration/multi-participant diagram is
    verified only for single-process diagrams** — `orgModel.ts`'s
    `getProcessElement` has a documented fallback that follows a
    `bpmn:Collaboration`'s first participant (unit-tested in isolation,
    `orgModel.test.ts`), but neither `lite-org.spec.ts` nor any other e2e
    spec exercises the Details dialog/DMT renderer against a real
    multi-pool collaboration diagram — only single-process fixtures are
    covered end to end.
