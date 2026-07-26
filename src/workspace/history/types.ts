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
  code: 'unreadable' | 'invalid-metadata' | 'missing-content' | 'checksum-mismatch'
  message: string
}

export interface HistoryListing {
  revisions: HistoryRevision[]
  issues: HistoryIssue[]
  totalBytes: number
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

export interface HistoryDiff {
  identical: boolean
  oldLineCount: number
  newLineCount: number
  hunks: HistoryDiffHunk[]
}

export interface HistoryRetentionResult {
  removed: HistoryRevision[]
  issues: HistoryIssue[]
  totalBytes: number
  /**
   * May remain true when the newest revision of every process alone exceeds
   * the global limit; those protected revisions are never silently removed.
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
