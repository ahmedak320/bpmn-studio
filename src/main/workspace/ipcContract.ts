// Shared IPC contract for the workspace surface: channel names + payload
// types, importable from BOTH main (workspace.ts) and preload (no Electron
// main-process imports here) so the two can never drift on channel strings
// or shapes, and preload's bundle never pulls in main-only Electron APIs
// (app/dialog/ipcMain) transitively.

export const WORKSPACE_CHANNELS = {
  getRoot: 'workspace:getRoot',
  chooseRoot: 'workspace:chooseRoot',
  listTree: 'workspace:listTree',
  readFile: 'workspace:readFile',
  writeFile: 'workspace:writeFile',
  createFolder: 'workspace:createFolder',
  createBpmnFile: 'workspace:createBpmnFile',
  rename: 'workspace:rename',
  move: 'workspace:move',
  delete: 'workspace:delete',
  treeChanged: 'workspace:tree-changed'
} as const

export interface WorkspaceApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface TreeNode {
  name: string
  /** posix-style path relative to the workspace root, e.g. "sub/dir/file.bpmn" */
  relPath: string
  type: 'folder' | 'file'
  children?: TreeNode[]
}
