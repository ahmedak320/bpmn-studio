import { contextBridge, ipcRenderer } from 'electron'
import {
  WORKSPACE_CHANNELS,
  type TreeNode,
  type WorkspaceApiResult
} from '../main/workspace/ipcContract'
import {
  AI_CHANNELS,
  PROVIDER_CHANNELS,
  SECRETS_CHANNELS,
  type AiProgress,
  type AvailableProviderInfo,
  type GenerateRequest,
  type GenerateResult,
  type SecretsStatusView,
  type TestConnectionResult
} from '../main/ai/ipcContract'
import type { ProviderId } from '../shared/providers'
import { OPEN_FILE_CHANNELS, type OpenFilePayload } from '../main/openFileContract'
import { THEME_CHANNELS } from '../main/themeContract'
import { MENU_CHANNELS } from '../main/menuContract'

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

// B4 secrets vault surface (see report B4.md). The renderer builds its
// Settings modal's `SettingsHandlers` from these.
const settings = {
  getStatus: (): Promise<SecretsStatusView> => ipcRenderer.invoke(SECRETS_CHANNELS.getStatus),
  getKeys: (providerId: ProviderId): Promise<Record<string, string>> =>
    ipcRenderer.invoke(SECRETS_CHANNELS.getKeys, providerId),
  setKey: (providerId: ProviderId, fields: Record<string, string>): Promise<void> =>
    ipcRenderer.invoke(SECRETS_CHANNELS.setKey, providerId, fields),
  deleteKey: (providerId: ProviderId): Promise<void> =>
    ipcRenderer.invoke(SECRETS_CHANNELS.deleteKey, providerId)
}

// AI generation surface (C1). testConnection doubles as the Settings modal's
// onTestConnection handler.
const ai = {
  generate: (request: GenerateRequest): Promise<GenerateResult> =>
    ipcRenderer.invoke(AI_CHANNELS.generate, request),
  testConnection: (providerId: ProviderId, modelId: string): Promise<TestConnectionResult> =>
    ipcRenderer.invoke(AI_CHANNELS.testConnection, providerId, modelId),
  /** Subscribe to generation progress pushes; returns an unsubscribe fn. */
  onProgress: (callback: (progress: AiProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: AiProgress): void => callback(progress)
    ipcRenderer.on(AI_CHANNELS.progress, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.progress, listener)
  }
}

const providers = {
  available: (): Promise<AvailableProviderInfo[]> =>
    ipcRenderer.invoke(PROVIDER_CHANNELS.available)
}

// C3: .bpmn file-association open-path surface (double-click / second
// instance / import-from-outside-workspace) — main pushes, renderer opens a tab.
const openFile = {
  onOpenFile: (callback: (payload: OpenFilePayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: OpenFilePayload): void => callback(payload)
    ipcRenderer.on(OPEN_FILE_CHANNELS.openFile, listener)
    return () => ipcRenderer.removeListener(OPEN_FILE_CHANNELS.openFile, listener)
  }
}

// C3: nativeTheme (dark/light) forwarding.
const theme = {
  get: (): Promise<{ ok: boolean; data?: boolean; error?: string }> =>
    ipcRenderer.invoke(THEME_CHANNELS.get),
  onChange: (callback: (isDark: boolean) => void): (() => void) => {
    const listener = (_event: unknown, isDark: boolean): void => callback(isDark)
    ipcRenderer.on(THEME_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(THEME_CHANNELS.changed, listener)
  }
}

// C3: native application-menu action round-trips (File/View/Help items that
// need renderer state, e.g. Save/Export/New Process).
const menu = {
  channels: MENU_CHANNELS,
  onAction: (channel: string, callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },
  workspace,
  settings,
  ai,
  providers,
  openFile,
  theme,
  menu
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
