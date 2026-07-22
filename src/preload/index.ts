import { contextBridge, ipcRenderer } from 'electron'
import {
  WORKSPACE_CHANNELS,
  type TreeNode,
  type WorkspaceApiResult
} from '../main/workspace/ipcContract'

// Typed surface exposed to the renderer. Grows in later waves (AI generate
// IPC, secrets, updater) — each lane should add its own namespace object to
// `api` below rather than flattening new top-level keys, and export its
// channel-name constant the same way WORKSPACE_CHANNELS is exported so main
// and preload can't drift on channel strings.
const workspace = {
  getRoot: (): Promise<WorkspaceApiResult<string | null>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.getRoot),
  chooseRoot: (): Promise<WorkspaceApiResult<string | null>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.chooseRoot),
  listTree: (): Promise<WorkspaceApiResult<TreeNode>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.listTree),
  readFile: (relPath: string): Promise<WorkspaceApiResult<string>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.readFile, relPath),
  writeFile: (relPath: string, content: string): Promise<WorkspaceApiResult<boolean>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.writeFile, relPath, content),
  createFolder: (relPath: string): Promise<WorkspaceApiResult<boolean>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.createFolder, relPath),
  createBpmnFile: (
    relPath: string,
    processId: string,
    processName: string
  ): Promise<WorkspaceApiResult<boolean>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.createBpmnFile, relPath, processId, processName),
  rename: (relPath: string, newName: string): Promise<WorkspaceApiResult<string>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.rename, relPath, newName),
  move: (fromRelPath: string, toRelPath: string): Promise<WorkspaceApiResult<boolean>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.move, fromRelPath, toRelPath),
  delete: (relPath: string): Promise<WorkspaceApiResult<boolean>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.delete, relPath),
  /** Subscribe to workspace tree-changed events; returns an unsubscribe fn. */
  onTreeChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(WORKSPACE_CHANNELS.treeChanged, listener)
    return () => ipcRenderer.removeListener(WORKSPACE_CHANNELS.treeChanged, listener)
  }
}

const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  workspace
}

export type OrbitPmApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('orbitpm', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.orbitpm = api
}
