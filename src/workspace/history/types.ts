import type { FileSnapshot, SaveOutcome } from '../adapters'

export type HistoryRevisionReason = 'overwrite' | 'delete' | 'restore' | 'manual' | 'backup-import'

export interface HistoryRevisionMetadata {
  format: 'orbitpm-history-revision'
  version: 1
  id: string
  originalPath: string
  contentPath: string
  metadataPath: string
  hash: string
  size: number
  createdAt: number
  reason: HistoryRevisionReason
  applicationVersion?: string
}

export interface HistoryRevision extends HistoryRevisionMetadata {
  /** Revision bytes plus its portable metadata file. */
  storageBytes: number
}

export interface HistoryIssue {
  path: string
  code:
    | 'unreadable'
    | 'invalid-metadata'
    | 'missing-content'
    | 'checksum-mismatch'
    | 'orphan-content'
    | 'retention-limit'
  message: string
}

export interface HistoryListOptions {
  /**
   * Maximum combined number of revisions and issues returned in this page.
   * Omit it for the legacy complete listing.
   */
  limit?: number
  /** Opaque continuation returned by the preceding page. */
  cursor?: string
  signal?: AbortSignal
}

export interface HistoryListing {
  revisions: HistoryRevision[]
  issues: HistoryIssue[]
  /**
   * Complete listings report all matching revision bytes. Bounded/cursor
   * listings report only bytes represented by the returned page.
   */
  totalBytes: number
  /**
   * Exact bytes of every file in the scanned history storage scope. Omitted
   * when the backing adapter could not determine even one file size.
   */
  storageBytes?: number
  /**
   * Exact number of logical history records (`.json` metadata plus unmatched
   * `.bpmn` content) in the scanned scope, including corrupt records.
   */
  recordCount?: number
  /** Present when more metadata entries remain after this bounded page. */
  nextCursor?: string
  /** True when this result reached the end of the matching history metadata. */
  complete?: boolean
}

export interface HistoryPreview {
  revision: HistoryRevision
  bytes: Uint8Array
  xml: string
}

export interface HistoryDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  removed: string[]
  added: string[]
}

export interface HistoryDiffOmitted {
  oldInputCharacters: number
  newInputCharacters: number
  oldInputLines: number
  newInputLines: number
  operations: number
  previewRows: number
  previewCharacters: number
  hunks: number
}

export interface HistoryDiff {
  identical: boolean
  oldLineCount: number
  newLineCount: number
  hunks: HistoryDiffHunk[]
  /** False when a bounded replacement block was used instead of detailed LCS alignment. */
  aligned: boolean
  /** True when the bounded result omits any input or rendered-preview detail. */
  truncated: boolean
  omitted: HistoryDiffOmitted
}

export interface HistoryRetentionResult {
  /** Bounded oldest-first evidence for successfully removed revisions. */
  removed: HistoryRevision[]
  /** Aggregate count, including removals omitted from `removed`. */
  removedRevisionCount: number
  /** Aggregate exact storage bytes represented by all successful removals. */
  removedStorageBytes: number
  /** Successful removals omitted from the bounded `removed` evidence. */
  omittedRemovedRevisionCount: number
  /** Bounded corruption, cleanup, and aggregate retention-limit evidence. */
  issues: HistoryIssue[]
  /** Aggregate issue count, including details omitted from `issues`. */
  issueCount: number
  /** Issues omitted from the bounded `issues` evidence. */
  omittedIssueCount: number
  /**
   * Exact bytes of every post-cleanup file under `.orbitpm/history`. Omitted
   * when unreadable backing metadata makes the byte total indeterminate.
   */
  storageBytes?: number
  totalBytes: number
  totalRevisions: number
  /** Valid, corrupt, and orphan logical records counted against the global cap. */
  totalRecords: number
  /** Exact post-cleanup compliance across per-process count and global count/bytes. */
  withinLimits: boolean
  /**
   * True when the newest revision of every process alone exceeds the global
   * count or byte limit; those protected revisions are never silently removed.
   */
  overLimitBecauseNewestAreProtected: boolean
}

export interface HistoryWriteResult {
  revision?: HistoryRevision
  outcome: SaveOutcome
}

export interface HistoryDeleteResult {
  revision: HistoryRevision
  removedSnapshot: FileSnapshot
}
