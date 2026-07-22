// Auto-update wiring (electron-updater, GitHub provider — see the
// `publish` block in electron-builder.yml). Unsigned build: NEVER set
// verifyUpdateCodeSignature or a publisherName override on autoUpdater —
// the GitHub provider works fine unsigned for per-user (HKCU) NSIS
// installs, and those flags require a code-signing cert we don't have.
//
// Two entry points:
//  - initAutoUpdater(): call once on app ready, packaged builds only.
//    Silent background check via checkForUpdatesAndNotify() — downloads
//    automatically and shows a native OS notification when ready (clicking
//    it quits + installs). Pure no-op in dev (app.isPackaged === false) so
//    `npm run dev` never hits GitHub or needs a dev-app-update.yml.
//  - checkForUpdatesInteractive(getWindow): call from the Help menu.
//    Always shows a dialog covering every outcome — update available /
//    downloading / already up to date / error — and asks for confirmation
//    before downloadUpdate()/quitAndInstall().

import { app, dialog, type BrowserWindow } from 'electron'
// electron-updater ships as CommonJS; a plain named import compiles fine
// under TypeScript's esModuleInterop but fails at runtime in the built ESM
// main bundle ("Named export 'autoUpdater' not found") because
// electron-vite externalizes node_modules for the main process rather than
// bundling/interop-wrapping them, and Node's cjs-module-lexer doesn't
// statically detect this package's named export. A default import doesn't
// work either: `tests/unit/menu.test.ts` mocks this module with
// `vi.mock('electron-updater', () => ({ autoUpdater: {...} }))` (a plain
// named export, no `default` key), so a strict default import breaks the
// test even though it fixes the real build. Resolve both shapes via a
// namespace import: real Node ESM/CJS interop always exposes the full CJS
// `module.exports` as `.default` (so `.default.autoUpdater` works there),
// while Vitest's mock factory return value has no `.default` and exposes
// `.autoUpdater` directly.
import * as electronUpdaterModule from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'

interface AutoUpdaterLike {
  once: (event: string, listener: (...args: unknown[]) => void) => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
  checkForUpdates: () => Promise<unknown>
  checkForUpdatesAndNotify: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
  autoInstallOnAppQuit: boolean
}

const electronUpdaterExports = electronUpdaterModule as unknown as {
  autoUpdater?: AutoUpdaterLike
  default?: { autoUpdater?: AutoUpdaterLike }
}
const autoUpdater =
  electronUpdaterExports.autoUpdater ?? electronUpdaterExports.default?.autoUpdater

if (!autoUpdater) {
  throw new Error('electron-updater: could not resolve autoUpdater export (unexpected module shape)')
}

let backgroundWired = false

/** Background check on app ready. No-op outside packaged builds. */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return
  if (backgroundWired) return
  backgroundWired = true

  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] background check failed:', err)
  })
}

/**
 * Manual "Check for Updates…" flow for the Help menu. Uses one-shot
 * `.once()` listeners per invocation so repeated calls never pile up
 * duplicate handlers on the shared autoUpdater singleton.
 */
export function checkForUpdatesInteractive(getWindow: () => BrowserWindow | null): void {
  const win = getWindow() ?? undefined

  if (!app.isPackaged) {
    void dialog.showMessageBox(win, {
      type: 'info',
      title: 'Check for Updates',
      message: 'Update checking is only available in packaged builds.',
      detail: 'This is a development build — no update feed is configured.'
    })
    return
  }

  const showError = (err: unknown): void => {
    void dialog.showMessageBox(win, {
      type: 'error',
      title: 'Update Check Failed',
      message: 'Could not check for updates.',
      detail: err instanceof Error ? err.message : String(err)
    })
  }

  autoUpdater.once('update-not-available', () => {
    void dialog.showMessageBox(win, {
      type: 'info',
      title: 'No Updates',
      message: "You're up to date.",
      detail: `Current version: ${app.getVersion()}`
    })
  })

  autoUpdater.once('update-available', (info: UpdateInfo) => {
    void dialog
      .showMessageBox(win, {
        type: 'info',
        title: 'Update Available',
        message: `Version ${info.version} is available.`,
        detail: 'Download it now? OrbitPM will restart to finish installing.',
        buttons: ['Download and Install', 'Later'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response !== 0) return

        autoUpdater.once('update-downloaded', () => {
          void dialog
            .showMessageBox(win, {
              type: 'info',
              title: 'Update Ready',
              message: 'The update has been downloaded.',
              detail: 'Restart now to install it?',
              buttons: ['Restart Now', 'Later'],
              defaultId: 0,
              cancelId: 1
            })
            .then((restartResult) => {
              if (restartResult.response === 0) autoUpdater.quitAndInstall()
            })
        })

        autoUpdater.downloadUpdate().catch(showError)
      })
  })

  autoUpdater.once('error', showError)

  // The 'error' listener above already surfaces failures to the user;
  // swallow the promise rejection here so it doesn't also become an
  // unhandled-rejection warning.
  autoUpdater.checkForUpdates().catch(() => {})
}
