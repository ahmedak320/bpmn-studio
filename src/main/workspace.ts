// Workspace layer: root selection + persistence, guarded fs IPC, and a
// chokidar watcher that pushes tree-changed events to the renderer.
//
// This is the single entry point wave C/other lanes should import from.
// Everything else under src/main/workspace/ is an implementation detail.
//
// Usage from src/main/index.ts (owned by this lane this wave):
//   import { registerWorkspaceIpc } from './workspace'
//   registerWorkspaceIpc(mainWindow)

import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  createBpmnFile,
  createFolder,
  deleteEntry,
  listTree,
  moveEntry,
  readFileText,
  renameEntry,
  writeFileText,
  WorkspaceFsError
} from './workspace/fsOps'
import { WORKSPACE_CHANNELS, type TreeNode, type WorkspaceApiResult } from './workspace/ipcContract'
import { SettingsStore } from './workspace/settingsStore'
import { watchWorkspace, type WorkspaceWatcher } from './workspace/watcher'
import { promises as fs } from 'node:fs'

export { WORKSPACE_CHANNELS }

function ok<T>(data: T): WorkspaceApiResult<T> {
  return { ok: true, data }
}

function fail(error: unknown): WorkspaceApiResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}

let settingsStore: SettingsStore | null = null
let currentRoot: string | null = null
let watcher: WorkspaceWatcher | null = null

function getSettingsStore(): SettingsStore {
  if (!settingsStore) {
    settingsStore = new SettingsStore(fs, app.getPath('userData'))
  }
  return settingsStore
}

async function setRoot(root: string, mainWindow: BrowserWindow): Promise<void> {
  currentRoot = root
  await getSettingsStore().write({ root })

  if (watcher) {
    await watcher.close()
    watcher = null
  }
  watcher = watchWorkspace(root, () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(WORKSPACE_CHANNELS.treeChanged)
    }
  })
}

function requireRoot(): string {
  if (!currentRoot) {
    throw new Error('No workspace root selected yet')
  }
  return currentRoot
}

/**
 * Registers all workspace:* IPC handlers against `mainWindow`. Call once
 * from src/main/index.ts after the window is created. Idempotent-ish: if
 * called twice, ipcMain.handle will throw ("second handler") — callers
 * should only invoke it once per app lifetime, same as other registrations.
 */
export function registerWorkspaceIpc(mainWindow: BrowserWindow): void {
  ipcMain.handle(WORKSPACE_CHANNELS.getRoot, async () => {
    try {
      if (!currentRoot) {
        const settings = await getSettingsStore().read()
        if (settings.root) {
          currentRoot = settings.root
          await setRoot(settings.root, mainWindow)
        }
      }
      return ok(currentRoot)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(WORKSPACE_CHANNELS.chooseRoot, async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose your processes folder'
      })
      if (result.canceled || result.filePaths.length === 0) {
        return ok(currentRoot)
      }
      const root = result.filePaths[0]
      await setRoot(root, mainWindow)
      return ok(root)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(WORKSPACE_CHANNELS.listTree, async (): Promise<WorkspaceApiResult<TreeNode>> => {
    try {
      return ok(await listTree(requireRoot()))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    WORKSPACE_CHANNELS.readFile,
    async (_event: IpcMainInvokeEvent, relPath: string) => {
      try {
        return ok(await readFileText(requireRoot(), relPath))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.writeFile,
    async (_event: IpcMainInvokeEvent, relPath: string, content: string) => {
      try {
        await writeFileText(requireRoot(), relPath, content)
        return ok(true)
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.createFolder,
    async (_event: IpcMainInvokeEvent, relPath: string) => {
      try {
        await createFolder(requireRoot(), relPath)
        return ok(true)
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.createBpmnFile,
    async (
      _event: IpcMainInvokeEvent,
      relPath: string,
      processId: string,
      processName: string
    ) => {
      try {
        await createBpmnFile(requireRoot(), relPath, processId, processName)
        return ok(true)
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.rename,
    async (_event: IpcMainInvokeEvent, relPath: string, newName: string) => {
      try {
        return ok(await renameEntry(requireRoot(), relPath, newName))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.move,
    async (_event: IpcMainInvokeEvent, fromRelPath: string, toRelPath: string) => {
      try {
        await moveEntry(requireRoot(), fromRelPath, toRelPath)
        return ok(true)
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(WORKSPACE_CHANNELS.delete, async (_event: IpcMainInvokeEvent, relPath: string) => {
    try {
      await deleteEntry(requireRoot(), relPath, (absPath) => shell.trashItem(absPath))
      return ok(true)
    } catch (err) {
      return fail(err)
    }
  })
}

export { WorkspaceFsError }
export type { TreeNode }
