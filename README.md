# OrbitPM Process Studio

A Windows desktop app for drawing [BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/)
process diagrams, organizing them in folders, linking processes together via
call activities (with drill-down), and generating diagrams from a text
description using AI — when you're online. Everything else works fully
offline. Files are plain `.bpmn` XML on disk, so your workspace is portable,
backs up with whatever you already use (OneDrive, git, a network share), and
opens in other BPMN tools too.

![Screenshot placeholder](docs/screenshot.png)

*(Screenshot coming — open the app and you'll see: a folder tree on the
left, a tabbed diagram editor in the middle, and a collapsible AI panel on
the right.)*

---

## Install

1. Go to the [Releases page](https://github.com/ahmedak320/bpmn-studio/releases)
   and download `OrbitPM Process Studio-Setup-<version>.exe` from the latest
   release's Assets.
2. Run it. **The installer is unsigned**, so Windows SmartScreen will very
   likely show a blue "Windows protected your PC" screen. This is expected —
   click **More info**, then **Run anyway**.
3. The installer is per-user: it installs into your own
   `%LOCALAPPDATA%\Programs\` folder, adds a Start-menu and desktop shortcut,
   and associates `.bpmn` files with the app. **No admin rights are needed**
   and nothing is installed system-wide — this is deliberate, so it works on
   locked-down corporate laptops.
4. The app checks GitHub Releases for updates in the background and can
   update itself in place (still no admin needed).

> **Can't install? Corporate application control blocking the `.exe`?** Some
> managed laptops block *any* unsigned executable (AppLocker/WDAC), even a
> per-user one, after SmartScreen. If that's you, use **Lite** below — it runs
> in your browser, with nothing to install and nothing for app-control to
> block.

## Lite — the zero-install browser version

**OrbitPM Process Studio Lite** is the same editor as a single web page: draw
BPMN 2.0 diagrams, organize them in real folders on your computer, link
processes with call activities (with drill-down), export SVG/PNG, and generate
diagrams from a description with AI. It reuses the desktop app's exact
generation pipeline — there is **nothing to install**, so corporate application
control (which gates executables, not web pages) doesn't block it.

**Two ways to get it:**

1. **Open the hosted page:** <https://ahmedak320.github.io/bpmn-studio/> — just
   open it in Microsoft Edge or Google Chrome.
2. **Download the single file:** grab `OrbitPM-Process-Studio-Lite.html` from
   the [latest release's Assets](https://github.com/ahmedak320/bpmn-studio/releases/latest)
   and double-click it (it opens in your browser). It's one self-contained
   `.html` file — no other files, no internet needed except for AI. You can
   keep it in your OneDrive and open it anywhere.

**How to use it:**

- Click **Open a folder…** and pick a folder on your computer (a OneDrive
  folder is ideal). The browser asks permission the first time and remembers
  the folder for next time (you re-grant access with one click on later
  visits). Your `.bpmn` files are read and written **in place**, exactly like
  the desktop app — Lite is not a sandbox or a copy.
- Right-click the tree for **New process / New folder / Rename / Delete**.
  Double-click a `.bpmn` to open it; **Ctrl+S** saves back to disk.
- Reduced mode: if your browser blocks folder access (older browsers, or a
  policy that disables the File System Access API), Lite falls back to opening
  a **single `.bpmn` file** and **saving via download**. A banner explains
  when you're in this mode. Edge and Chrome support the full folder experience;
  Firefox/Safari get the single-file fallback.

**What works offline:** everything except AI generation — drawing, folders,
opening/saving files, call-activity linking and drill-down, and SVG/PNG export
all work with no internet. Only **Generate with AI** needs to be online.

**AI in Lite — provider support (browser CORS limitation):**

A web page can only call AI providers that allow cross-origin (CORS) browser
requests. Two of the desktop app's seven providers do; the rest must be used
from the desktop app (or a future hosted backend).

| Provider | Works in Lite? | Notes |
|---|---|---|
| **Anthropic (Claude)** | ✅ Yes | Uses the `anthropic-dangerous-direct-browser-access` header. |
| **Google Gemini** | ✅ Yes | The Generative Language API allows browser access. |
| OpenAI | ❌ No | No browser CORS — use the desktop app. |
| Moonshot (Kimi) | ❌ No | No browser CORS — use the desktop app. |
| DeepSeek | ❌ No | No browser CORS — use the desktop app. |
| Azure OpenAI | ❌ No | No browser CORS — use the desktop app. |
| GLM (Zhipu) | ❌ No | No browser CORS — use the desktop app. |

> ⚠️ **API-key storage warning.** A browser page has no OS-encrypted vault, so
> in Lite your Anthropic/Gemini API key is stored **unencrypted in this
> browser profile** (`localStorage`). Anyone with access to this computer
> profile can read it. Only enter a key on a machine you trust, and use
> **Settings → Clear stored key** when you're done on a shared computer. (The
> desktop app, by contrast, encrypts keys with the OS keychain/DPAPI.)

## First run

On first launch you'll be asked to choose a **processes folder** — this is
your workspace root. Everything you draw lives under it as `.bpmn` files in
whatever folder structure you create.

Recommendation: pick a folder **inside your OneDrive** (e.g.
`OneDrive\Processes`). That gives you automatic backup and sync across
machines for free, with no extra setup. A local folder works too, but you
own the backup story at that point.

You can change the workspace root later from the **File** menu.

## Using it

### Folders = organization

The left sidebar is a live folder tree rooted at your workspace. Create
folders to group related processes (by department, by project, however
makes sense to you) and `.bpmn` files inside them. Right-click for
create/rename/delete/move — new-folder, new-process, and rename open a
small in-app dialog to type the name (not a browser-style prompt). Changes
made outside the app (e.g. someone syncs a file via OneDrive) show up
automatically.

### Drawing basics

Double-click a `.bpmn` file (or create a new one) to open it in an editor
tab. It's a full BPMN 2.0 editor (built on
[bpmn-js](https://bpmn.io/toolkit/bpmn-js/)):

- Click the canvas or an element to get the context pad (append
  tasks/gateways/events, connect elements, etc.).
- The properties panel on the right of the canvas edits IDs, names, and
  element-specific fields.
- A minimap in the corner helps navigate large diagrams.

### Save and export

- **Ctrl+S** or the toolbar **Save** button writes the file back to disk
  (atomic write — safe with OneDrive syncing in the background).
- **Export SVG** / **Export PNG** in the toolbar render the current diagram
  to an image file, e.g. for pasting into a doc or slide deck.
- **Zoom to fit** re-centers and scales the diagram to the window.

### Linking processes with call activities

To model one process calling another:

1. Select a **Call Activity** element on the canvas.
2. Use the **Link to process…** button that appears in the toolbar. It
   searches your whole workspace for processes (by their BPMN process ID,
   not filename) and sets the call activity's `calledElement` to the one you
   pick.
3. From then on, double-clicking that call activity opens the linked
   process in a new tab — drill-down navigation between related diagrams.

The footer shows a badge when the current diagram has call activities whose
`calledElement` doesn't resolve to any file in your workspace yet (e.g. the
target hasn't been created, or was renamed/moved) — a hint to fix the link
or create the missing process.

## AI setup (optional — only needed for "Generate")

Everything above works fully offline. AI diagram generation needs an
internet connection and an API key for at least one provider. Open
**Settings** (gear icon), where each provider has its own card:

| Provider | Fields | Notes |
|---|---|---|
| **OpenAI** | API key | Models via `api.openai.com`. |
| **Anthropic** | API key | Claude models via `api.anthropic.com`. |
| **Moonshot (Kimi)** | API key, Base URL | OpenAI-compatible endpoint, default `https://api.moonshot.ai/v1`. Models `kimi-k3` / `kimi-k2.5` / `kimi-latest`. |
| **GLM (Zhipu)** | API key, Base URL | OpenAI-compatible endpoint, default `https://open.bigmodel.cn/api/paas/v4/`. Default model `glm-5.2`; both the base URL and model id are editable text fields if Zhipu changes them. |
| **DeepSeek** | API key | Models via `api.deepseek.com`. |
| **Google Gemini** | API key | Gemini models via the Google Generative AI API. |
| **Azure OpenAI** | API key, Resource endpoint, Deployment name, API version | Four fields because Azure OpenAI is deployment-driven, not model-driven: **Resource endpoint** is your `https://<resource>.openai.azure.com` URL, **Deployment name** is the deployment you created in Azure (not a model name), **API version** defaults to `2024-10-21` but is editable if your resource needs a different one. |

Every card has **Save**, **Clear**, and **Test connection** (does a live
reachability/auth check with the model you've selected). Key fields are
**write-only**: they start empty, and once a key is stored the field shows
a placeholder like `Configured (****ab12)` instead of the real value — the
app never reads a stored key back out to display it. Type a new value and
Save to overwrite it; leave the field blank and Save leaves the stored key
untouched. Keys never leave the main process — they're stored locally,
encrypted with Windows DPAPI via Electron's `safeStorage` (tied to your
Windows user account), and only used from the app's background process to
call the provider's API. They are never sent anywhere except the provider
you configured.

To generate a diagram, open the AI panel (right side), write a description
of the process, pick a provider/model and target folder, and generate. The
result opens as a new tab you can review and keep editing like anything
else.

If you're behind a corporate proxy, no extra configuration is needed — the
app uses your system's proxy settings automatically for AI calls (see
Troubleshooting if a provider still can't be reached).

## Offline / online matrix

| Feature | Works offline? |
|---|---|
| Draw, edit, save diagrams | Yes |
| Folder tree, organize files | Yes |
| Export SVG/PNG | Yes |
| Call-activity linking + drill-down | Yes |
| Settings (enter/save keys) | Yes |
| **AI: Generate from description** | **No — requires internet + a configured provider** |
| **AI: Test connection** | **No — requires internet** |
| Check for / install app updates | No — requires internet |

## Files are standard BPMN 2.0

Every `.bpmn` file this app writes is plain semantic BPMN 2.0 XML — no
proprietary extensions. That means:

- You can open, edit, or import these files in other BPMN tools (e.g.
  Camunda Modeler, SpiffArena, any BPMN 2.0-compliant engine).
- Your workspace folder is just files — git, OneDrive, a zip archive, or a
  network share all work as a backup/versioning story. Nothing is locked
  into this app.

## Troubleshooting

| Problem | What to do |
|---|---|
| SmartScreen blocks the installer | Expected for an unsigned app — click **More info → Run anyway**. See [Install](#install). |
| Corporate proxy / firewall blocks AI calls | The app uses the system proxy automatically, so most corporate proxies work transparently. If a specific provider is still unreachable, it's likely that provider's domain is blocked outbound by your network policy — try **Test connection** in Settings for a clear error, and try a different provider (Azure OpenAI is often already allow-listed in enterprise networks). |
| File seems "stuck" / won't save right after a OneDrive sync | OneDrive can briefly lock a file while syncing. Wait a few seconds and Save again — saves are atomic (write-then-rename) and retried, so this is normally a transient hiccup, not data loss. |
| AI generation fails or times out | Open `%APPDATA%\OrbitPM Process Studio\logs\ai.log` (Settings → each provider's "Test connection" will also surface the immediate error) for the full error detail behind the friendly message shown in the panel. |
| Where are my settings/keys stored? | In your Windows user profile's app-data folder for this app (`%APPDATA%\OrbitPM Process Studio\`), never in the workspace folder you chose — so they don't get swept into OneDrive/git along with your diagrams. |

## Development

```bash
npm ci
npm run dev          # electron-vite dev server + Electron window
npm run typecheck
npm run build         # electron-vite build -> out/
npm test              # vitest unit tests
npm run dist:win      # build + electron-builder --win (Windows CI only for a real .exe)
```

### Smoke test

```bash
npm run build
xvfb-run -a npx electron ./out/main/index.js --smoke-test
```

Runs the app headless; prints `SMOKE_OK` and exits 0 if startup succeeds.

### E2E

Playwright-electron tests live in `tests/e2e` (see `package.json` for the
script that runs them).

### Lite (the browser version)

The zero-install web editor is a standalone Vite + React project in `lite/`
with its **own** `package.json`, dependencies, and tests. It reuses the
desktop app's pure code by importing straight from `../src` (the `@app/*`
alias in `lite/vite.config.ts` + `lite/tsconfig.json`) and builds one
self-contained `dist/index.html` via `vite-plugin-singlefile`.

```bash
cd lite
npm ci
npm run dev          # vite dev server
npm run typecheck    # tsc over lite + the reused ../src files
npm test             # vitest — FS-adapter glue (mocked File System Access handles)
npm run build        # -> lite/dist/index.html (one inlined file, ~2.8 MB)

# E2E smoke (headed chromium; run from the desktop/ repo root where Playwright
# and the chromium browser are installed):
cd .. && DISPLAY=:0 npx playwright test -c lite/tests/e2e/playwright.lite.config.ts
```

It's deployed to GitHub Pages by `.github/workflows/pages.yml` on any push to
`main` that touches `lite/**`. The desktop app's own `npm ci/build/test`
gates are unaffected — `lite/**` is excluded from the root `vitest.config.ts`.

### Release process

Windows installers are built on GitHub Actions (`windows-latest`) by
`.github/workflows/build.yml`, triggered by pushing a `v*` tag (or manually
via `workflow_dispatch`). It runs `npm ci && npm run build && npx
electron-builder --win --publish always`, which both builds the NSIS
installer and publishes it, `latest.yml`, and the `.blockmap` file to a
GitHub Release matching the tag.

**Critical rule: `package.json`'s `version` field and the git tag must
match exactly** (e.g. version `0.1.0` ↔ tag `v0.1.0`). electron-builder
names the release/artifacts from `package.json`'s version, not from the git
tag — if they drift, the release is created under the wrong name/version
and auto-update metadocs (`latest.yml`) won't line up with the tag that
triggered the build. To cut a release:

```bash
# 1. bump package.json "version" (no "v" prefix) and commit
git commit -m "release: v<version>"
git push origin main

# 2. tag exactly "v<version>" and push the tag
git tag v<version>
git push origin v<version>

# 3. watch CI
gh run watch --exit-status
```

Installer is per-user (NSIS `oneClick` + `perMachine: false`), no admin
required, with `.bpmn` file association and auto-update via
`electron-updater` against public GitHub Releases (unsigned — this is
intentional, see `electron-builder.yml`'s notes).

## Acknowledgements

This app is built on open-source tooling, most notably:

- [bpmn-js](https://bpmn.io/toolkit/bpmn-js/) and the rest of the
  [bpmn.io](https://bpmn.io) toolkit — the BPMN 2.0 diagram editor at the
  core of this app, used under the bpmn.io license. The "Powered by
  bpmn.io" link shown in the bottom-right corner of the diagram editor is
  part of that license and is not removed or obscured.
- [Electron](https://www.electronjs.org/) — the desktop app shell.
- [Vercel AI SDK](https://sdk.vercel.ai/) — the multi-provider AI
  integration used for diagram generation.
- [bpmn-auto-layout](https://github.com/bpmn-io/bpmn-auto-layout) — automatic
  diagram layout for AI-generated processes.

See [LICENSE](LICENSE) for this project's own license.

## Repo layout

This directory (`desktop/`) is its own git repository, nested inside the
`bpmn_tool` monorepo checkout and ignored by its parent `.gitignore`. It is
pushed independently to a public GitHub repo (`ahmedak320/bpmn-studio`) so
the private server monorepo stays separate. See `plan.md` for the full
build plan and `STATUS.md` for the wave-by-wave build ledger.

`lite/` is the standalone browser-editor subproject (see the **Lite** section
above and **Development → Lite**); it reuses `src/gen/**`, `src/shared/**`,
and browser-safe renderer helpers from this same tree.
