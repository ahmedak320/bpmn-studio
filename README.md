# OrbitPM Process Studio

A Windows desktop app (per-user, no-admin install) for drawing BPMN 2.0
diagrams, organizing them in folders, linking processes via call activities
with drill-down, and generating diagrams from text descriptions using AI
when online. Files are standard `.bpmn` XML on disk.

Status: **early scaffold** (wave A1). See `plan.md` for the full build plan
and `STATUS.md` for the wave-by-wave ledger.

## Development (Linux/macOS/Windows)

```bash
npm install
npm run dev        # electron-vite dev server + Electron window
npm run typecheck
npm run build       # electron-vite build -> out/
npm run dist:win    # build + electron-builder --win (Windows CI only for a real .exe)
```

## Smoke test

The main process supports a `--smoke-test` flag: it creates the
`BrowserWindow` hidden, and once the window is ready to show it prints
`SMOKE_OK` and exits with code 0 instead of showing the UI. Useful for CI /
headless verification:

```bash
npm run build
xvfb-run -a npx electron ./out/main/index.js --smoke-test
```

## Packaging

Windows installers are built on GitHub Actions (`windows-latest`) via
`.github/workflows/build.yml`, triggered by pushing a `v*` tag or manually
via `workflow_dispatch`. See that file for a local Docker
(`electronuserland/builder:wine`) fallback if CI is unavailable.

Installer is per-user (NSIS `oneClick` + `perMachine: false`), no admin
required, with `.bpmn` file association and auto-update via
`electron-updater` against public GitHub Releases (unsigned).

## Repo layout

This directory (`desktop/`) is its own git repository, nested inside the
`bpmn_tool` monorepo checkout and ignored by its parent `.gitignore`. It is
pushed independently to a public GitHub repo (`ahmedak320/bpmn-studio`) so
the server monorepo stays private.
