import type { ReviewedXmlIngestionEvidence } from '../../localization'

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
  | 'invalid-encoding'
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

export interface ReadFileOptions {
  /** Reject from backing metadata before allocating/copying/hashing file bytes. */
  maxBytes?: number
  signal?: AbortSignal
}

export interface ListWorkspaceOptions {
  /** Reject before returning more than this many recursive descendants. */
  maxEntries?: number
  /** Maximum descendant depth relative to the requested listing root. */
  maxDepth?: number
  signal?: AbortSignal
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
  readonly path: string
  readonly bytes: Uint8Array
  /** Hash of the exact archive bytes before any reviewed localization edits. */
  readonly archiveSha256: string
  /** Hash of the exact reviewed bytes that may be written. */
  readonly sha256: string
  readonly modifiedAt?: number
  readonly mimeType?: string
  /**
   * Present for every active, non-reserved `.bpmn` candidate. Reserved
   * `.orbitpm` BPMN files are immutable internal/recovery evidence and retain
   * their exact archive bytes until an explicit restore reviews them.
   */
  readonly reviewedBpmn?: WorkspaceBackupReviewedBpmn
}

export interface WorkspaceBackupReviewedBpmn {
  readonly reviewDigest: string
  readonly outputDigest: string
  readonly processIds: readonly string[]
  readonly replacesProcessIds: readonly string[]
  readonly evidence: ReviewedXmlIngestionEvidence
}

export interface WorkspaceProcessIdentitySnapshotEntry {
  readonly processId: string
  /**
   * Null exists only for the legacy Set-only compatibility input. Such an
   * identity cannot be verified for execution and therefore fails closed.
   */
  readonly path: string | null
}

export interface WorkspaceBackupCollision {
  path: string
  incomingHash: string
  existing: FileSnapshot
  identical: boolean
}

export interface WorkspaceBackupImportPlan {
  readonly manifest: WorkspaceBackupManifest
  readonly directories: readonly string[]
  readonly files: readonly WorkspaceBackupImportCandidate[]
  readonly collisions: readonly WorkspaceBackupCollision[]
  readonly compressedBytes: number
  readonly declaredUncompressedBytes: number
  readonly workspaceId: string
  readonly workspaceMultipleFiles: boolean
  readonly processIdentitySnapshot: readonly WorkspaceProcessIdentitySnapshotEntry[]
  readonly processIdentityDigest: string
  /** Digest of exact candidate bytes, evidence, collisions and identity state. */
  readonly integrityDigest: string
  /** Digest the human-reviewed apply action must echo. */
  readonly reviewDigest: string
}

export type WorkspaceBackupCollisionDecision =
  { action: 'replace' } | { action: 'skip' } | { action: 'keep-both'; destinationPath?: string }

export interface WorkspaceBackupImportOptions {
  decisions?: Readonly<Record<string, WorkspaceBackupCollisionDecision>>
  /** Must echo the exact immutable plan shown before any writes are allowed. */
  reviewedDigest?: string
  /** Optional caller snapshot; otherwise the adapter is securely rescanned. */
  currentProcessIndex?: ReadonlyMap<string, { readonly relPath: string }>
  currentProcessIds?: ReadonlySet<string>
  processIdentityInspector?: WorkspaceProcessIdentityInspector
  signal?: AbortSignal
  /**
   * Called immediately before an existing file is overwritten. App integration
   * uses this to create the mandatory portable history revision.
   */
  beforeOverwrite?: (path: string, existing: FileSnapshot) => Promise<void>
}

export type WorkspaceProcessIdentityInspector = (
  xml: string,
  signal?: AbortSignal
) => Promise<{ readonly processIds: readonly string[] }>

export interface WorkspaceBackupAppliedFile {
  sourcePath: string
  destinationPath: string
  replaced: boolean
  snapshot: FileSnapshot
}

export type WorkspaceBackupImportOutcome =
  | {
      status: 'needs-review'
      unresolvedCollisions: WorkspaceBackupCollision[]
    }
  | {
      status: 'committed'
      applied: WorkspaceBackupAppliedFile[]
      skipped: string[]
    }
  | {
      status: 'rolled-back' | 'rollback-failed'
      appliedBeforeFailure: WorkspaceBackupAppliedFile[]
      skipped: string[]
      error: WorkspaceFailure
      rollbackErrors: WorkspaceFailure[]
    }

export type WorkspaceBackupExporter = (
  adapter: WorkspaceAdapter,
  options?: BackupExportOptions
) => Promise<Blob>

export type RemoveEmptyFolderResult = 'removed' | 'not-empty'
export type CreateFolderIfMissingResult = 'created' | 'existing'

/**
 * Storage-independent workspace surface. Rename and move both receive complete
 * destination paths; rename is restricted to the same parent, while move may
 * cross parents. Folder removal is recursive.
 */
export interface WorkspaceAdapter {
  readonly id: string
  readonly mode: WorkspaceMode
  readonly storage: WorkspaceStorageInfo

  /**
   * Recursively list descendants of `path` (the root when omitted).
   * Built-in adapters always enforce their hard entry/depth ceilings; options
   * may lower, but never raise, those ceilings.
   */
  list(path?: string, options?: ListWorkspaceOptions): Promise<WorkspaceEntry[]>
  read(path: string, options?: ReadFileOptions): Promise<FileSnapshot>
  writeAtomic(
    path: string,
    bytes: Uint8Array,
    expectedHash?: string,
    options?: WriteAtomicOptions
  ): Promise<SaveOutcome>
  rename(from: string, to: string): Promise<void>
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  /**
   * Remove a file only when its bytes still match `expectedHash`.
   *
   * Implementations must serialize the final app-observable hash check and
   * delete entry, and must fail with an integrity error when the file changed
   * or disappeared. The File System Access API has no native compare-and-delete
   * primitive: its implementation is a final check immediately before
   * `removeEntry`. Cooperating OrbitPM tabs are additionally serialized by the
   * workspace lock protocol, but an arbitrary OS writer can still race that
   * final browser call and callers must not describe it as filesystem-atomic.
   *
   * Optional third-party adapters are treated as unable to prove safe
   * rollback/delete and callers must fail closed.
   */
  removeIfHash?(path: string, expectedHash: string): Promise<void>
  /**
   * Atomically remove `path` only when it is still an empty directory.
   * Implementations must never recurse. Optional adapters are treated as
   * unable to prove safe cleanup.
   */
  removeEmptyFolder?(path: string): Promise<RemoveEmptyFolderResult>
  createFolder(path: string): Promise<void>
  /**
   * Create exactly the requested directory when it is missing and report
   * whether this adapter operation created it. The parent must already exist;
   * implementations must not create unreported ancestor directories.
   *
   * Implementations serialize the final app-observable existence check and
   * creation. File System Access has no exclusive mkdir primitive, so its
   * final missing probe followed by `getDirectoryHandle({ create: true })`
   * remains vulnerable to an arbitrary OS writer. Cooperating OrbitPM tabs are
   * additionally serialized by the workspace lock protocol.
   *
   * Optional third-party adapters cannot establish cleanup ownership. Callers
   * that require rollback-safe folder creation must fail closed.
   */
  createFolderIfMissing?(path: string): Promise<CreateFolderIfMissingResult>
  exportBackup(options?: BackupExportOptions): Promise<Blob>
}
