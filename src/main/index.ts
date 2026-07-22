import { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerWorkspaceIpc } from './workspace'
import { registerAiIpc } from './ai/ai'
import { buildMenu } from './menu'
import { initAutoUpdater } from './updater'
import { findAndHandleOpenFileArgs } from './openFile'
import { THEME_CHANNELS } from './themeContract'

const isSmokeTest = process.argv.includes('--smoke-test')
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// E2E test hook (gated, no production effect): let the Playwright suite redirect
// Electron's userData directory to a per-run temp dir so each test is isolated
// (its own workspace-settings.json, secrets vault, logs). Must run before the
// single-instance lock (whose lock file lives in userData) and before ready.
// When ORBITPM_USERDATA is unset, this is a no-op and behavior is unchanged.
if (process.env.ORBITPM_USERDATA) {
  app.setPath('userData', process.env.ORBITPM_USERDATA)
}

// Single-instance lock: focus the existing window on relaunch (e.g. via .bpmn
// file-association double-click) instead of spawning a second app instance.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock && !isSmokeTest) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // CommonJS preload (index.cjs) — required because the renderer is
      // sandboxed; a sandboxed renderer cannot load an ESM preload. The
      // electron.vite.config.ts preload build emits `.cjs` to match.
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (isSmokeTest) {
      // Smoke-test mode: never show a window, just prove main + renderer boot
      // cleanly end-to-end, then exit with success.
      // eslint-disable-next-line no-console
      console.log('SMOKE_OK')
      app.exit(0)
      return
    }
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // --- IPC registrations -----------------------------------------------
  // Each lane owning an IPC surface registers its channels here. Add new
  // `register*Ipc(mainWindow)` calls to this list as later waves add
  // features (ai.ts, updater.ts, ...) — keep each registration in its own
  // module (electron imports injectable/mockable) rather than inlining
  // ipcMain.handle calls in this file.
  const REGISTRATIONS: Array<(win: BrowserWindow) => void> = [
    registerWorkspaceIpc,
    registerAiIpc,
    () => {
      ipcMain.handle(THEME_CHANNELS.get, () => ({
        ok: true,
        data: nativeTheme.shouldUseDarkColors
      }))
    }
  ]
  for (const register of REGISTRATIONS) {
    register(mainWindow)
  }
  // -----------------------------------------------------------------------

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Windows file-association / first-launch open path: only fires once for
  // the initial page load. Subsequent double-click opens while the app is
  // already running are handled via 'second-instance' below.
  mainWindow.webContents.once('did-finish-load', () => {
    findAndHandleOpenFileArgs(process.argv, () => mainWindow)
  })
}

// nativeTheme is a singleton; forward OS theme changes to the renderer
// regardless of which window is current.
nativeTheme.on('updated', () => {
  mainWindow?.webContents.send(THEME_CHANNELS.changed, nativeTheme.shouldUseDarkColors)
})

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    findAndHandleOpenFileArgs(argv, () => mainWindow)
  }
})

app.whenReady().then(() => {
  createWindow()
  initAutoUpdater()
  Menu.setApplicationMenu(buildMenu(() => mainWindow))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
