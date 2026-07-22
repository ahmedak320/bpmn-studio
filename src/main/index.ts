import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerWorkspaceIpc } from './workspace'

const isSmokeTest = process.argv.includes('--smoke-test')
const __dirname = fileURLToPath(new URL('.', import.meta.url))

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
      preload: join(__dirname, '../preload/index.mjs'),
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
  const REGISTRATIONS: Array<(win: BrowserWindow) => void> = [registerWorkspaceIpc]
  for (const register of REGISTRATIONS) {
    register(mainWindow)
  }
  // -----------------------------------------------------------------------

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
