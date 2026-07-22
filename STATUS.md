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
