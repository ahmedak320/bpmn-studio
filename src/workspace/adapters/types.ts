export type WorkspaceMode = 'directory' | 'opfs' | 'single-file'

export type WorkspaceEntryKind = 'file' | 'directory'

export type WorkspacePersistence =
  | 'external-directory'
  | 'external-file'
  | 'origin-private-durable'
  | 'origin-private-best-effort'
  | 'download'
  | 'memory'

export interface WorkspaceCapabilities {
  multipleFiles: boolean
  directories: boolean
  rename: boolean
  move: boolean
  remove: boolean
  backup: boolean
}

export interface WorkspaceStorageInfo {
  persistence: WorkspacePersistence
  portable: boolean
  description: string
  capabilities: WorkspaceCapabilities
}

export type WorkspaceErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'already-exists'
  | 'not-a-file'
  | 'not-a-directory'
  | 'permission-loss'
  | 'cancelled'
  | 'stale-workspace'
  | 'unsupported'
  | 'quota-exceeded'
  | 'integrity-failure'
  | 'storage-failure'

/**
 * A serializable error description. Raw browser exceptions are deliberately
 * not exposed through durable state because DOMException shapes differ across
 * browsers and cannot be cloned reliably.
 */
export interface WorkspaceFailure {
  code: WorkspaceErrorCode
  message: string
  operation: WorkspaceOperation
  path?: string
  name?: string
}

export type WorkspaceOperation =
  | 'list'
  | 'read'
  | 'write'
  | 'rename'
  | 'move'
  | 'remove'
  | 'create-folder'
  | 'export-backup'
  | 'open'

export interface WorkspaceEntry {
  /** Normalized POSIX path relative to the workspace root. */
  path: string
  name: string
  /** Empty for a direct child of the workspace root. */
  parentPath: string
  kind: WorkspaceEntryKind
  size?: number
  modifiedAt?: number
  mimeType?: string
  /**
   * Listing isolates an entry whose metadata cannot be read instead of
   * rejecting the complete workspace refresh.
   */
  readable: boolean
  issue?: WorkspaceFailure
}

export interface FileSnapshot {
  /** Normalized POSIX path relative to the workspace root. */
  path: string
  /** Defensive copy of the exact file bytes. */
  bytes: Uint8Array
  /** Lower-case SHA-256 hex digest of `bytes`. */
  hash: string
  size: number
  /** Epoch milliseconds; 0 when the backing store does not expose it. */
  modifiedAt: number
  mimeType?: string
}

export interface WriteAtomicOptions {
  /**
   * Prevent a queued write from landing in a newly selected workspace. The
   * controller should capture an adapter identity when work starts.
   */
  expectedWorkspaceId?: string
  /**
   * Creation-only compare-and-set. It is mutually exclusive with
   * `expectedHash`.
   */
  expectedMissing?: boolean
  signal?: AbortSignal
}

export interface SuccessfulSaveOutcome {
  ok: true
  status: 'success'
  snapshot: FileSnapshot
  created: boolean
  previousHash?: string
  /**
   * Directory/OPFS writes are committed by closing an atomic writable stream;
   * single-file fallback dispatches a user-visible download.
   */
  disposition: 'workspace' | 'download'
}

export interface PermissionLossSaveOutcome {
  ok: false
  status: 'permission-loss'
  error: WorkspaceFailure
}

export interface ExternalConflictSaveOutcome {
  ok: false
  status: 'external-conflict'
  reason: 'hash-mismatch' | 'missing' | 'already-exists'
  expectedHash?: string
  actual?: FileSnapshot
}

export interface StaleWorkspaceSaveOutcome {
  ok: false
  status: 'stale-workspace'
  expectedWorkspaceId: string
  actualWorkspaceId: string
}

export interface CancelledSaveOutcome {
  ok: false
  status: 'cancelled'
  error: WorkspaceFailure
}

export interface StorageFailureSaveOutcome {
  ok: false
  status: 'storage-failure'
  error: WorkspaceFailure
}

/**
 * Saving never relies on exception text for expected control flow. Consumers
 * must handle every persistence result explicitly.
 */
export type SaveOutcome =
  | SuccessfulSaveOutcome
  | PermissionLossSaveOutcome
  | ExternalConflictSaveOutcome
  | StaleWorkspaceSaveOutcome
  | CancelledSaveOutcome
  | StorageFailureSaveOutcome

export interface BackupExportOptions {
  signal?: AbortSignal
  /** Primarily useful for reproducible tests and release verification. */
  generatedAt?: Date
}

export interface WorkspaceBackupManifestFile {
  path: string
  archivePath: string
  size: number
  sha256: string
  modifiedAt: number
  mimeType?: string
}

export interface WorkspaceBackupManifest {
  format: 'orbitpm-workspace-backup'
  version: 1
  generatedAt: string
  workspace: {
    id: string
    mode: WorkspaceMode
  }
  checksumAlgorithm: 'SHA-256'
  directories: string[]
  files: WorkspaceBackupManifestFile[]
}

/**
 * Backup import is intentionally a reviewed two-phase operation. A codec can
 * populate this plan, while a transaction coordinator owns collision choices
 * and rollback. Keeping the seam here prevents an adapter from silently
 * overwriting files merely because an archive was opened.
 */
export interface WorkspaceBackupImportCandidate {
  path: string
  bytes: Uint8Array
  sha256: string
  modifiedAt?: number
  mimeType?: string
}

export interface WorkspaceBackupCollision {
  path: string
  incomingHash: string
  existing: FileSnapshot
}

export interface WorkspaceBackupImportPlan {
  manifest: WorkspaceBackupManifest
  directories: string[]
  files: WorkspaceBackupImportCandidate[]
  collisions: WorkspaceBackupCollision[]
}

export type WorkspaceBackupExporter = (
  adapter: WorkspaceAdapter,
  options?: BackupExportOptions
) => Promise<Blob>

/**
 * Storage-independent workspace surface. Rename and move both receive complete
 * destination paths; rename is restricted to the same parent, while move may
 * cross parents. Folder removal is recursive.
 */
export interface WorkspaceAdapter {
  readonly id: string
  readonly mode: WorkspaceMode
  readonly storage: WorkspaceStorageInfo

  /** Recursively list descendants of `path` (the root when omitted). */
  list(path?: string): Promise<WorkspaceEntry[]>
  read(path: string): Promise<FileSnapshot>
  writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options?: WriteAtomicOptions
  ): Promise<SaveOutcome>
  rename(from: string, to: string): Promise<void>
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  createFolder(path: string): Promise<void>
  exportBackup(options?: BackupExportOptions): Promise<Blob>
}
