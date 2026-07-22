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
