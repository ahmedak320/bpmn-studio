// Application menu: File / View / Help. File actions that need renderer
// state (new tab, save, export) are round-tripped via webContents.send on
// the MENU_CHANNELS contract — the renderer (owned by other lanes) listens
// via a preload fragment and performs the actual work (see the C3 report
// for the exact preload/App wiring snippet).
//
// buildMenuTemplate is exported separately from buildMenu so tests can
// assert on the plain data (labels/roles/accelerators) without needing a
// real Electron Menu object.

import { Menu, app, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { MENU_CHANNELS } from './menuContract'
import { checkForUpdatesInteractive } from './updater'

function send(getWindow: () => BrowserWindow | null, channel: string): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel)
}

export function buildMenuTemplate(
  getWindow: () => BrowserWindow | null
): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin'
  const isDev = !app.isPackaged

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'New Process',
        accelerator: 'CmdOrCtrl+N',
        click: () => send(getWindow, MENU_CHANNELS.newProcess)
      },
      {
        label: 'Open Workspace Folder…',
        accelerator: 'CmdOrCtrl+O',
        click: () => send(getWindow, MENU_CHANNELS.openWorkspaceFolder)
      },
      { type: 'separator' },
      {
        label: 'Save',
        accelerator: 'CmdOrCtrl+S',
        click: () => send(getWindow, MENU_CHANNELS.save)
      },
      { type: 'separator' },
      {
        label: 'Export as SVG…',
        click: () => send(getWindow, MENU_CHANNELS.exportSvg)
      },
      {
        label: 'Export as PNG…',
        click: () => send(getWindow, MENU_CHANNELS.exportPng)
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : [])
    ]
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    submenu: [
      {
        label: 'Check for Updates…',
        click: () => checkForUpdatesInteractive(getWindow)
      },
      { type: 'separator' },
      {
        label: `Version ${app.getVersion()}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'View on GitHub',
        click: () => {
          void shell.openExternal('https://github.com/ahmedak320/bpmn-studio')
        }
      }
    ]
  }

  return [fileMenu, viewMenu, helpMenu]
}

export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  return Menu.buildFromTemplate(buildMenuTemplate(getWindow))
}
