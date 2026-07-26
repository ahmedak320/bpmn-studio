/**
 * Application-owned document session contracts.
 *
 * The session id is deliberately independent from the workspace-relative path.
 * Renaming or moving a document therefore does not destroy its modeler, command
 * stack, undo history, or command registration.
 */

export type SessionId = string

export type WorkspaceStorageMode = 'directory' | 'opfs' | 'single-file' | 'memory'

export interface WorkspaceIdentity {
  /** Stable identity of the selected workspace, not merely its display name. */
  id: string
  /**
   * Monotonically increasing application generation. A session may only use an
   * adapter that is still bound to this exact workspace generation.
   */
  generation: number
  mode: WorkspaceStorageMode
}

export interface DocumentIdentity {
  workspace: WorkspaceIdentity
  /** POSIX-style path relative to the workspace, or null for a virtual file. */
  path: string | null
}

export interface FileFingerprint {
  /** Content hash (normally SHA-256) of the bytes read or written. */
  hash: string
  size: number
  /** File.lastModified-compatible epoch milliseconds. */
  modifiedAt: number
}

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  code: string
  severity: ValidationSeverity
  message: string
  elementId?: string
  location?: { line: number; column: number }
}

export interface SessionValidationState {
  status: 'unknown' | 'validating' | 'valid' | 'invalid'
  /** XML revision for which the result is valid, or null if not yet validated. */
  revision: number | null
  issues: readonly ValidationIssue[]
}

export type DraftRecoveryState =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'available'; draftId: string; timestamp: number; baseHash: string | null }
  | { status: 'restored'; draftId: string; timestamp: number }
  | { status: 'dismissed'; draftId: string; timestamp: number }
  | { status: 'error'; message: string }

export type SessionSavePhase =
  | 'idle'
  | 'capturing'
  | 'checking-external'
  | 'awaiting-conflict-decision'
  | 'acquiring-lock'
  | 'writing'

export interface SessionSaveState {
  phase: SessionSavePhase
  requestId: string | null
  startedRevision: number | null
  startedAt: number | null
  lastOutcome: string | null
}

export type PathMigrationPhase =
  | 'idle'
  | 'awaiting-dirty-decision'
  | 'saving'
  | 'ready'
  | 'applying'
  | 'committed'
  | 'cancelled'
  | 'rolling-back'
  | 'failed'

export interface SessionPathMigrationState {
  transactionId: string | null
  phase: PathMigrationPhase
  fromPath: string | null
  toPath: string | null
  error: string | null
}

export interface SessionEditorBinding {
  modeler: unknown | null
  commandStack: unknown | null
  /**
   * Optional serialization hook. Integrations that already push every current
   * XML revision into the store do not need to provide it.
   */
  readXml?: (() => Promise<string>) | null
}

export interface DocumentSession {
  id: SessionId
  identity: DocumentIdentity
  title: string
  currentXml: string
  lastSavedXml: string
  dirty: boolean
  /** Incremented for every distinct current-XML update. */
  revision: number
  /** Revision whose XML most recently reached durable storage. */
  lastSavedRevision: number
  base: FileFingerprint | null
  modeler: unknown | null
  commandStack: unknown | null
  readXml: (() => Promise<string>) | null
  validation: SessionValidationState
  draftRecovery: DraftRecoveryState
  save: SessionSaveState
  pathMigration: SessionPathMigrationState
  createdAt: number
  updatedAt: number
}

export interface DocumentSessionSnapshot {
  version: number
  activeSessionId: SessionId | null
  sessions: readonly DocumentSession[]
}

export const UNKNOWN_VALIDATION: SessionValidationState = {
  status: 'unknown',
  revision: null,
  issues: []
}

export const NO_DRAFT_RECOVERY: DraftRecoveryState = { status: 'none' }

export const IDLE_SAVE_STATE: SessionSaveState = {
  phase: 'idle',
  requestId: null,
  startedRevision: null,
  startedAt: null,
  lastOutcome: null
}

export const IDLE_PATH_MIGRATION: SessionPathMigrationState = {
  transactionId: null,
  phase: 'idle',
  fromPath: null,
  toPath: null,
  error: null
}

export function sameWorkspace(a: WorkspaceIdentity, b: WorkspaceIdentity): boolean {
  return a.id === b.id && a.generation === b.generation && a.mode === b.mode
}

export function sameDocumentIdentity(a: DocumentIdentity, b: DocumentIdentity): boolean {
  return sameWorkspace(a.workspace, b.workspace) && a.path === b.path
}

export function documentIdentityKey(identity: DocumentIdentity): string {
  return JSON.stringify([
    identity.workspace.id,
    identity.workspace.generation,
    identity.workspace.mode,
    identity.path
  ])
}

