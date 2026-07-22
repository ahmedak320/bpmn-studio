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
