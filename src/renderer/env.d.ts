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

// --- AI / settings / providers surface (added by C1) ------------------------
// Provider ids are typed as plain `string` here (this is an ambient,
// import-free .d.ts); the strongly-typed ProviderId union lives in
// src/shared/providers.ts and is used by renderer code that imports it.

interface SecretsStatusView {
  encryptionAvailable: boolean
  providers: { id: string; configured: boolean }[]
}

interface AvailableProviderInfo {
  id: string
  configured: boolean
}

interface GenerateRequestIpc {
  description: string
  providerId: string
  modelId: string
  targetFolder: string
  name: string
}

interface GenerateResultIpc {
  ok: boolean
  relPath?: string
  error?: string
  usedFallback?: boolean
  offline?: boolean
}

type TestConnectionResultIpc =
  | { ok: true; message: string }
  | { ok: false; message: string }

interface AiProgressIpc {
  stage: 'contacting-model' | 'laying-out' | 'writing-file'
  detail?: string
}

/** Per-field status returned by settings.getKeys — NEVER the decrypted value
 * itself, only whether it's set and a last-4-chars hint for the UI. */
interface KeyFieldStatusIpc {
  configured: boolean
  last4?: string
}

interface SettingsApi {
  getStatus: () => Promise<SecretsStatusView>
  getKeys: (providerId: string) => Promise<Record<string, KeyFieldStatusIpc>>
  setKey: (providerId: string, fields: Record<string, string>) => Promise<void>
  deleteKey: (providerId: string) => Promise<void>
}

interface AiApi {
  generate: (request: GenerateRequestIpc) => Promise<GenerateResultIpc>
  testConnection: (providerId: string, modelId: string) => Promise<TestConnectionResultIpc>
  onProgress: (callback: (progress: AiProgressIpc) => void) => () => void
}

interface ProvidersApi {
  available: () => Promise<AvailableProviderInfo[]>
}

// --- file-association / theme / menu surface (added by C3, wired by C4) ---

interface OpenFilePayloadIpc {
  relPath: string
}

interface OpenFileApi {
  onOpenFile: (callback: (payload: OpenFilePayloadIpc) => void) => () => void
}

interface ThemeApi {
  get: () => Promise<{ ok: boolean; data?: boolean; error?: string }>
  onChange: (callback: (isDark: boolean) => void) => () => void
}

interface MenuApi {
  channels: {
    newProcess: string
    openWorkspaceFolder: string
    save: string
    exportSvg: string
    exportPng: string
  }
  onAction: (channel: string, callback: () => void) => () => void
}

interface Window {
  orbitpm: {
    versions: {
      node: string
      chrome: string
      electron: string
    }
    workspace: WorkspaceApi
    settings: SettingsApi
    ai: AiApi
    providers: ProvidersApi
    openFile: OpenFileApi
    theme: ThemeApi
    menu: MenuApi
  }
}
