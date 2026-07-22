// Shared IPC contract for the AI + provider-settings surface: channel names +
// payload types, importable from BOTH main (ai.ts) and preload (src/preload).
// No Electron main-process imports here (app/ipcMain/net) so preload's bundle
// never transitively pulls them in — same discipline as workspace/ipcContract.
//
// The renderer does NOT import this module: it sees these shapes through the
// contextBridge-exposed `window.orbitpm.*` types declared in
// src/renderer/env.d.ts. Keep the two structurally aligned.

import type { ProviderId } from '../../shared/providers'

/** AI generation + connection-test channels (handled in main by ai.ts). */
export const AI_CHANNELS = {
  generate: 'ai:generate',
  testConnection: 'ai:testConnection',
  /** main -> renderer progress pushes during a generation. */
  progress: 'ai:progress'
} as const

/** Provider availability channel. */
export const PROVIDER_CHANNELS = {
  available: 'providers:available'
} as const

/** Secrets vault channels — reused from B4's wiring snippet (report B4.md). */
export const SECRETS_CHANNELS = {
  getStatus: 'secrets:getStatus',
  getKeys: 'secrets:getKeys',
  setKey: 'secrets:setKey',
  deleteKey: 'secrets:deleteKey'
} as const

/** Payload for `ai:generate`. */
export interface GenerateRequest {
  /** Natural-language process description fed to the pipeline. */
  description: string
  providerId: ProviderId
  modelId: string
  /** Workspace-relative folder to write the `.bpmn` into (`''` = root). */
  targetFolder: string
  /** User-supplied diagram name; slugified for the filename. */
  name: string
}

/** Result of `ai:generate`. */
export interface GenerateResult {
  ok: boolean
  /** Workspace-relative path of the written `.bpmn` on success. */
  relPath?: string
  /** User-friendly error message on failure. */
  error?: string
  /** True when the provider needed the text+loose-parse fallback path. */
  usedFallback?: boolean
  /** True when the failure looks like a connectivity problem (offline/proxy). */
  offline?: boolean
}

/** Result of `ai:testConnection`. Mirrors the Settings UI's TestConnectionResult. */
export type TestConnectionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/** One entry from `providers:available`. */
export interface AvailableProviderInfo {
  id: ProviderId
  configured: boolean
}

/** Shape returned by `secrets:getStatus` (mirrors main/secrets.ts SecretsStatus). */
export interface SecretsStatusView {
  encryptionAvailable: boolean
  providers: { id: ProviderId; configured: boolean }[]
}

/** Shape of one field's entry in `secrets:getKeys`'s result (mirrors
 * main/secrets.ts KeyFieldStatus). NEVER carries the decrypted value — only
 * whether it's set and a last-4-chars hint for the Settings UI. */
export interface KeyFieldStatusView {
  configured: boolean
  last4?: string
}

/** Progress event pushed on `ai:progress` during a generation. */
export interface AiProgress {
  stage: 'contacting-model' | 'laying-out' | 'writing-file'
  detail?: string
}
