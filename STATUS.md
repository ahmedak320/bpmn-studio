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
