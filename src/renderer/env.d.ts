/// <reference types="vite/client" />

interface WorkspaceApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

interface TreeNode {
  name: string
  relPath: string
  type: 'folder' | 'file'
  children?: TreeNode[]
}

interface WorkspaceApi {
  getRoot: () => Promise<WorkspaceApiResult<string | null>>
  chooseRoot: () => Promise<WorkspaceApiResult<string | null>>
  listTree: () => Promise<WorkspaceApiResult<TreeNode>>
  readFile: (relPath: string) => Promise<WorkspaceApiResult<string>>
  writeFile: (relPath: string, content: string) => Promise<WorkspaceApiResult<boolean>>
  createFolder: (relPath: string) => Promise<WorkspaceApiResult<boolean>>
  createBpmnFile: (
    relPath: string,
    processId: string,
    processName: string
  ) => Promise<WorkspaceApiResult<boolean>>
  rename: (relPath: string, newName: string) => Promise<WorkspaceApiResult<string>>
  move: (fromRelPath: string, toRelPath: string) => Promise<WorkspaceApiResult<boolean>>
  delete: (relPath: string) => Promise<WorkspaceApiResult<boolean>>
  onTreeChanged: (callback: () => void) => () => void
}

interface Window {
  orbitpm: {
    versions: {
      node: string
      chrome: string
      electron: string
    }
    workspace: WorkspaceApi
  }
}
