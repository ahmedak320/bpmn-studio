import {
  WorkspaceOperationError,
  WorkspaceReadLimitError,
  copyBytes,
  normalizeWorkspacePath,
  removeFileIfHash,
  sha256Hex,
  workspaceParentPath,
  workspacePathName,
  type FileSnapshot,
  type SaveOutcome,
  type WorkspaceAdapter,
  type WorkspaceEntry
} from '../adapters'
import { diffXml } from './diff'
import type {
  HistoryDeleteResult,
  HistoryDiff,
  HistoryIssue,
  HistoryListOptions,
  HistoryListing,
  HistoryPreview,
  HistoryRetentionResult,
  HistoryRevision,
  HistoryRevisionMetadata,
  HistoryRevisionReason,
  HistoryWriteResult
} from './types'

export const HISTORY_ROOT = '.orbitpm/history'
export const DEFAULT_HISTORY_PER_PROCESS = 20
export const DEFAULT_HISTORY_TOTAL_REVISIONS = 1_000
export const DEFAULT_HISTORY_TOTAL_BYTES = 100 * 1024 * 1024
export const HISTORY_RETENTION_RESULT_DETAIL_LIMIT = 100
export const HISTORY_ISSUE_MESSAGE_MAX_CODE_POINTS = 512

const HISTORY_SCAN_BATCH_SIZE = 64
const HISTORY_CURSOR_PREFIX = 'orbitpm-history-v1:'

export interface PortableHistoryManagerOptions {
  adapter: WorkspaceAdapter
  now?: () => number
  maxPerProcess?: number
  maxTotalRevisions?: number
  maxTotalBytes?: number
  applicationVersion?: string
  /** Injectable for deterministic tests; production yields to the next task. */
  cooperativeYield?: () => Promise<void>
}

export interface CreateHistoryRevisionOptions {
  reason: HistoryRevisionReason
  snapshot?: FileSnapshot
  prune?: boolean
  signal?: AbortSignal
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceOperationError && error.code === 'not-found'
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  path: string,
  operation: 'list' | 'remove' | 'write' = 'write'
): void {
  if (!signal?.aborted) return
  throw cancellationError(signal, path, operation)
}

function boundIssueMessage(message: string): string {
  let result = ''
  let count = 0
  for (const codePoint of message) {
    if (count >= HISTORY_ISSUE_MESSAGE_MAX_CODE_POINTS) break
    result += codePoint
    count += 1
  }
  return result
}

function errorMessage(error: unknown, fallback = 'Unknown portable history failure.'): string {
  try {
    if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
      return boundIssueMessage(error.message)
    }
    const detail = String(error)
    return boundIssueMessage(detail.trim() ? detail : fallback)
  } catch {
    return fallback
  }
}

function entryIssueMessage(entry: WorkspaceEntry, fallback: string): string {
  try {
    return errorMessage(entry.issue?.message ?? fallback, fallback)
  } catch {
    return fallback
  }
}

function savedOrThrow(outcome: SaveOutcome, path: string): FileSnapshot {
  if (outcome.status === 'success') return outcome.snapshot
  const detail =
    outcome.status === 'external-conflict'
      ? `History entry "${path}" unexpectedly collided.`
      : 'error' in outcome
        ? outcome.error.message
        : `History write failed with ${outcome.status}.`
  throw new WorkspaceOperationError({
    code:
      outcome.status === 'permission-loss'
        ? 'permission-loss'
        : outcome.status === 'cancelled'
          ? 'cancelled'
          : outcome.status === 'stale-workspace'
            ? 'stale-workspace'
            : 'storage-failure',
    operation: 'write',
    path,
    message: detail
  })
}

interface HistorySortKey {
  createdAt: number
  sequence: number
  id: string
  path: string
}

interface HistoryCursor {
  version: 1
  root: string
  key: HistorySortKey
}

type HistoryScanRecord =
  { kind: 'revision'; revision: HistoryRevision } | { kind: 'issue'; issue: HistoryIssue }

interface HistoryRetentionPlan {
  removals: HistoryRevision[]
  protectedOverLimit: boolean
  projectedWithinLimits: boolean
}

interface HistoryProtection {
  protectedPaths: Set<string>
  invalidPaths: Set<string>
  issues: HistoryIssue[]
}

interface HistoryRevisionRollbackReceipt {
  revision: HistoryRevision
  contentSnapshot: FileSnapshot
  metadataSnapshot: FileSnapshot
  attempted: boolean
}

function compareTextDescending(left: string, right: string): number {
  if (left === right) return 0
  return left > right ? -1 : 1
}

function compareTextAscending(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareHistoryKeysNewest(left: HistorySortKey, right: HistorySortKey): number {
  return (
    right.createdAt - left.createdAt ||
    right.sequence - left.sequence ||
    compareTextDescending(left.id, right.id) ||
    compareTextAscending(left.path, right.path)
  )
}

function revisionSortKey(revision: HistoryRevision): HistorySortKey {
  const match = /^(\d+)-(\d+)-[a-f0-9]{12}$/iu.exec(revision.id)
  return {
    createdAt: revision.createdAt,
    sequence: match ? Number(match[2]) : Number.MIN_SAFE_INTEGER,
    id: revision.id,
    path: revision.metadataPath
  }
}

function metadataSortKey(entry: WorkspaceEntry): HistorySortKey {
  const fileName = workspacePathName(entry.path)
  const id = fileName.replace(/\.(?:bpmn|json)$/iu, '')
  const match = /^(\d+)-(\d+)-[a-f0-9]{12}$/iu.exec(id)
  const encodedCreatedAt = match ? Number(match[1]) : Number.NaN
  const encodedSequence = match ? Number(match[2]) : Number.NaN
  const createdAt = Number.isSafeInteger(encodedCreatedAt)
    ? encodedCreatedAt
    : Number.isSafeInteger(entry.modifiedAt)
      ? Math.trunc(entry.modifiedAt!)
      : Number.MIN_SAFE_INTEGER
  const sequence = Number.isSafeInteger(encodedSequence) ? encodedSequence : Number.MIN_SAFE_INTEGER
  return { createdAt, sequence, id, path: entry.path }
}

function byNewest(left: HistoryRevision, right: HistoryRevision): number {
  return compareHistoryKeysNewest(revisionSortKey(left), revisionSortKey(right))
}

function byOldest(left: HistoryRevision, right: HistoryRevision): number {
  return -byNewest(left, right)
}

function encodeHistoryCursor(root: string, key: HistorySortKey): string {
  return `${HISTORY_CURSOR_PREFIX}${encodeURIComponent(
    JSON.stringify({ version: 1, root, key } satisfies HistoryCursor)
  )}`
}

function decodeHistoryCursor(cursor: string, root: string): HistorySortKey {
  if (!cursor.startsWith(HISTORY_CURSOR_PREFIX) || cursor.length > 8_192) {
    throw new TypeError('History listing cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(
      decodeURIComponent(cursor.slice(HISTORY_CURSOR_PREFIX.length))
    ) as Partial<HistoryCursor>
    const key = parsed.key as Partial<HistorySortKey> | undefined
    if (
      parsed.version !== 1 ||
      parsed.root !== root ||
      !key ||
      !Number.isSafeInteger(key.createdAt) ||
      !Number.isSafeInteger(key.sequence) ||
      typeof key.id !== 'string' ||
      !key.id ||
      typeof key.path !== 'string' ||
      !key.path.startsWith(`${root}/`) ||
      (!key.path.endsWith('.json') && !key.path.endsWith('.bpmn'))
    ) {
      throw new TypeError('History listing cursor is invalid.')
    }
    return {
      createdAt: Number(key.createdAt),
      sequence: Number(key.sequence),
      id: key.id,
      path: key.path
    }
  } catch (error) {
    if (error instanceof TypeError && error.message === 'History listing cursor is invalid.') {
      throw error
    }
    throw new TypeError('History listing cursor is invalid.')
  }
}

function cancellationError(
  signal: AbortSignal,
  path: string,
  operation: 'list' | 'remove' | 'write'
): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'cancelled',
    operation,
    path,
    message: `Portable history ${operation} was cancelled.`,
    cause: signal.reason
  })
}

async function awaitWithAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
  path: string,
  operation: 'list' | 'remove' | 'write'
): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) throw cancellationError(signal, path, operation)
  return new Promise<T>((resolve, reject) => {
    const handleAbort = (): void => reject(cancellationError(signal, path, operation))
    signal.addEventListener('abort', handleAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', handleAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', handleAbort)
        reject(error)
      }
    )
  })
}

export class PortableHistoryManager {
  readonly #adapter: WorkspaceAdapter
  readonly #now: () => number
  readonly #maxPerProcess: number
  readonly #maxTotalRevisions: number
  readonly #maxTotalBytes: number
  readonly #applicationVersion?: string
  readonly #cooperativeYield: () => Promise<void>
  readonly #historyFolderCache = new Map<string, Promise<string>>()
  #sequence = 0

  constructor(options: PortableHistoryManagerOptions) {
    if (!Number.isInteger(options.maxPerProcess ?? DEFAULT_HISTORY_PER_PROCESS)) {
      throw new Error('maxPerProcess must be an integer')
    }
    if ((options.maxPerProcess ?? DEFAULT_HISTORY_PER_PROCESS) < 1) {
      throw new Error('maxPerProcess must preserve at least one revision')
    }
    if (!Number.isInteger(options.maxTotalRevisions ?? DEFAULT_HISTORY_TOTAL_REVISIONS)) {
      throw new Error('maxTotalRevisions must be an integer')
    }
    if ((options.maxTotalRevisions ?? DEFAULT_HISTORY_TOTAL_REVISIONS) < 1) {
      throw new Error('maxTotalRevisions must preserve at least one revision')
    }
    if (
      !Number.isSafeInteger(options.maxTotalBytes ?? DEFAULT_HISTORY_TOTAL_BYTES) ||
      (options.maxTotalBytes ?? DEFAULT_HISTORY_TOTAL_BYTES) < 1
    ) {
      throw new Error('maxTotalBytes must be positive')
    }
    this.#adapter = options.adapter
    this.#now = options.now ?? (() => Date.now())
    this.#maxPerProcess = options.maxPerProcess ?? DEFAULT_HISTORY_PER_PROCESS
    this.#maxTotalRevisions = options.maxTotalRevisions ?? DEFAULT_HISTORY_TOTAL_REVISIONS
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_HISTORY_TOTAL_BYTES
    this.#applicationVersion = options.applicationVersion
    this.#cooperativeYield =
      options.cooperativeYield ??
      (() => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0)))
  }

  async createRevision(
    originalPathInput: string,
    options: CreateHistoryRevisionOptions
  ): Promise<HistoryRevision> {
    const originalPath = normalizeWorkspacePath(originalPathInput)
    throwIfAborted(options.signal, originalPath)
    if (!/\.bpmn$/i.test(originalPath)) {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'write',
        path: originalPath,
        message: 'Portable history revisions are created only for BPMN files.'
      })
    }
    const snapshot = options.snapshot ?? (await this.#adapter.read(originalPath))
    throwIfAborted(options.signal, originalPath)
    const pathHash = await sha256Hex(encoder.encode(originalPath))
    throwIfAborted(options.signal, originalPath)
    const createdAt = this.#now()
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new TypeError('Portable history timestamps must be non-negative safe integers.')
    }
    const id = `${createdAt}-${++this.#sequence}-${snapshot.hash.slice(0, 12)}`
    const folder = `${HISTORY_ROOT}/${pathHash}`
    const contentPath = `${folder}/${id}.bpmn`
    const metadataPath = `${folder}/${id}.json`
    const metadata: HistoryRevisionMetadata = {
      format: 'orbitpm-history-revision',
      version: 1,
      id,
      originalPath,
      contentPath,
      metadataPath,
      hash: snapshot.hash,
      size: snapshot.size,
      createdAt,
      reason: options.reason,
      applicationVersion: this.#applicationVersion
    }
    const metadataBytes = encoder.encode(JSON.stringify(metadata, null, 2))

    throwIfAborted(options.signal, folder)
    await this.#adapter.createFolder(folder)
    throwIfAborted(options.signal, folder)
    let contentWriteSnapshot: FileSnapshot | undefined
    let metadataWriteSnapshot: FileSnapshot | undefined
    try {
      throwIfAborted(options.signal, contentPath)
      contentWriteSnapshot = savedOrThrow(
        await this.#adapter.writeAtomic(contentPath, snapshot.bytes, undefined, {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: true,
          signal: options.signal
        }),
        contentPath
      )
      throwIfAborted(options.signal, contentPath)
      throwIfAborted(options.signal, metadataPath)
      metadataWriteSnapshot = savedOrThrow(
        await this.#adapter.writeAtomic(metadataPath, metadataBytes, undefined, {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: true,
          signal: options.signal
        }),
        metadataPath
      )
      throwIfAborted(options.signal, metadataPath)
    } catch (error) {
      // Compensating cleanup must run even when cancellation caused the
      // failure, otherwise an unreported partial revision remains.
      const rollbackErrors: unknown[] = []
      if (metadataWriteSnapshot) {
        try {
          await removeFileIfHash(this.#adapter, metadataPath, metadataWriteSnapshot.hash)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (contentWriteSnapshot) {
        try {
          await removeFileIfHash(this.#adapter, contentPath, contentWriteSnapshot.hash)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (rollbackErrors.length > 0) {
        throw new WorkspaceOperationError({
          code: 'storage-failure',
          operation: 'write',
          path: originalPath,
          message:
            'Portable history creation failed and its partial-write rollback was incomplete; changed or inaccessible history evidence was preserved.',
          cause: new AggregateError(
            [error, ...rollbackErrors],
            'Portable history partial-write rollback failed.'
          )
        })
      }
      throw error
    }

    if (!contentWriteSnapshot || !metadataWriteSnapshot) {
      throw new WorkspaceOperationError({
        code: 'storage-failure',
        operation: 'write',
        path: originalPath,
        message: 'Portable history creation completed without verifiable write snapshots.'
      })
    }
    const revision: HistoryRevision = {
      ...metadata,
      storageBytes: snapshot.size + metadataBytes.byteLength
    }
    const rollbackReceipt: HistoryRevisionRollbackReceipt = {
      revision,
      contentSnapshot: contentWriteSnapshot,
      metadataSnapshot: metadataWriteSnapshot,
      attempted: false
    }
    if (options.prune !== false) {
      try {
        throwIfAborted(options.signal, originalPath)
        await this.#enforceRetention(options.signal, rollbackReceipt)
        throwIfAborted(options.signal, originalPath)
      } catch (error) {
        if (!rollbackReceipt.attempted) await this.#rollbackRevision(rollbackReceipt)
        throw error
      }
    }
    return revision
  }

  async listRevisions(
    originalPathInput?: string,
    options: HistoryListOptions = {}
  ): Promise<HistoryListing> {
    if (
      options.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) || options.limit < 1)
    ) {
      throw new TypeError('History listing limit must be a positive integer.')
    }
    const originalPath =
      originalPathInput === undefined ? undefined : normalizeWorkspacePath(originalPathInput)
    throwIfAborted(options.signal, originalPath ?? HISTORY_ROOT, 'list')
    const root =
      originalPath === undefined
        ? HISTORY_ROOT
        : `${HISTORY_ROOT}/${await sha256Hex(encoder.encode(originalPath))}`
    throwIfAborted(options.signal, root, 'list')
    let entries: WorkspaceEntry[]
    try {
      entries = await awaitWithAbort(
        this.#adapter.list(root, { signal: options.signal }),
        options.signal,
        root,
        'list'
      )
    } catch (error) {
      throwIfAborted(options.signal, root, 'list')
      if (isNotFound(error)) {
        return {
          revisions: [],
          issues: [],
          totalBytes: 0,
          storageBytes: 0,
          recordCount: 0,
          complete: true
        }
      }
      throw error
    }
    throwIfAborted(options.signal, root, 'list')
    let storageBytes: number | undefined = 0
    for (const entry of entries) {
      if (entry.kind !== 'file') continue
      if (
        entry.size === undefined ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        !Number.isSafeInteger(storageBytes + entry.size)
      ) {
        storageBytes = undefined
        break
      }
      storageBytes += entry.size
    }
    const byPath = new Map(entries.map((entry) => [entry.path, entry]))
    const metadataEntries = entries
      .filter(
        (entry) =>
          entry.kind === 'file' &&
          (entry.path.endsWith('.json') ||
            (entry.path.endsWith('.bpmn') &&
              !byPath.has(`${entry.path.slice(0, -'.bpmn'.length)}.json`)))
      )
      .sort((left, right) =>
        compareHistoryKeysNewest(metadataSortKey(left), metadataSortKey(right))
      )
    const cursorKey =
      options.cursor === undefined ? undefined : decodeHistoryCursor(options.cursor, root)
    const cursorIndex =
      cursorKey === undefined
        ? 0
        : metadataEntries.findIndex(
            (entry) => compareHistoryKeysNewest(metadataSortKey(entry), cursorKey) > 0
          )
    const startIndex = cursorIndex < 0 ? metadataEntries.length : cursorIndex
    const revisions: HistoryRevision[] = []
    const issues: HistoryIssue[] = []
    const limit = options.limit ?? Number.POSITIVE_INFINITY
    let index = startIndex
    let returned = 0
    let totalBytes = 0
    let lastKey: HistorySortKey | undefined

    while (index < metadataEntries.length && returned < limit) {
      throwIfAborted(options.signal, root, 'list')
      const remaining = Math.min(
        HISTORY_SCAN_BATCH_SIZE,
        metadataEntries.length - index,
        limit - returned
      )
      const batch = metadataEntries.slice(index, index + remaining)
      const records = await Promise.all(
        batch.map((entry) => this.#scanHistoryEntry(entry, byPath, originalPath))
      )
      throwIfAborted(options.signal, root, 'list')
      for (let offset = 0; offset < records.length; offset += 1) {
        const record = records[offset]!
        const entry = batch[offset]!
        lastKey = metadataSortKey(entry)
        returned += 1
        if (record.kind === 'revision') {
          revisions.push(record.revision)
          totalBytes += record.revision.storageBytes
        } else {
          issues.push(record.issue)
        }
      }
      index += batch.length
      if (index < metadataEntries.length && returned < limit) {
        await this.#yieldAndCheck(options.signal, root, 'list')
      }
    }
    revisions.sort(byNewest)
    const complete = index >= metadataEntries.length
    return {
      revisions,
      issues,
      totalBytes,
      ...(storageBytes === undefined ? {} : { storageBytes }),
      recordCount: metadataEntries.length,
      ...(complete || !lastKey ? {} : { nextCursor: encodeHistoryCursor(root, lastKey) }),
      complete
    }
  }

  async #scanHistoryEntry(
    entry: WorkspaceEntry,
    byPath: ReadonlyMap<string, WorkspaceEntry>,
    originalPath: string | undefined
  ): Promise<HistoryScanRecord> {
    if (entry.path.endsWith('.bpmn')) {
      return {
        kind: 'issue',
        issue: {
          path: entry.path,
          code: 'orphan-content',
          message: 'History content has no matching revision metadata.'
        }
      }
    }
    if (!entry.readable) {
      return {
        kind: 'issue',
        issue: {
          path: entry.path,
          code: 'unreadable',
          message: entryIssueMessage(entry, 'History metadata is unreadable.')
        }
      }
    }
    try {
      const metadataSnapshot = await this.#adapter.read(entry.path)
      const parsed = parseMetadata(decoder.decode(metadataSnapshot.bytes), entry.path)
      if (originalPath !== undefined && parsed.originalPath !== originalPath) {
        throw new Error('History metadata is stored under the wrong process path.')
      }
      const expectedFolder = await this.#historyFolderFor(parsed.originalPath)
      if (workspaceParentPath(entry.path) !== expectedFolder) {
        throw new Error('History metadata is stored outside its process history folder.')
      }
      const contentEntry = byPath.get(parsed.contentPath)
      if (!contentEntry || contentEntry.kind !== 'file') {
        return {
          kind: 'issue',
          issue: {
            path: entry.path,
            code: 'missing-content',
            message: boundIssueMessage(`History content "${parsed.contentPath}" is missing.`)
          }
        }
      }
      if (!contentEntry.readable) {
        return {
          kind: 'issue',
          issue: {
            path: parsed.contentPath,
            code: 'unreadable',
            message: entryIssueMessage(contentEntry, 'History content is unreadable.')
          }
        }
      }
      return {
        kind: 'revision',
        revision: {
          ...parsed,
          storageBytes: metadataSnapshot.size + (contentEntry.size ?? parsed.size)
        }
      }
    } catch (error) {
      return {
        kind: 'issue',
        issue: {
          path: entry.path,
          code: 'invalid-metadata',
          message: errorMessage(error)
        }
      }
    }
  }

  #historyFolderFor(originalPath: string): Promise<string> {
    const cached = this.#historyFolderCache.get(originalPath)
    if (cached) return cached
    const folder = sha256Hex(encoder.encode(originalPath)).then(
      (pathHash) => `${HISTORY_ROOT}/${pathHash}`
    )
    this.#historyFolderCache.set(originalPath, folder)
    return folder
  }

  async preview(revision: HistoryRevision): Promise<HistoryPreview> {
    const snapshot = await this.#adapter.read(revision.contentPath)
    if (snapshot.hash !== revision.hash || snapshot.size !== revision.size) {
      throw new WorkspaceOperationError({
        code: 'integrity-failure',
        operation: 'read',
        path: revision.contentPath,
        message: `History revision "${revision.id}" failed checksum verification.`
      })
    }
    return {
      revision,
      bytes: copyBytes(snapshot.bytes),
      xml: decoder.decode(snapshot.bytes)
    }
  }

  async diff(revision: HistoryRevision, currentXml?: string): Promise<HistoryDiff> {
    const preview = await this.preview(revision)
    const liveXml =
      currentXml ?? decoder.decode((await this.#adapter.read(revision.originalPath)).bytes)
    return diffXml(preview.xml, liveXml)
  }

  async writeWithRevision(
    pathInput: string,
    bytes: Uint8Array,
    expectedHash?: string,
    reason: HistoryRevisionReason = 'overwrite',
    signal?: AbortSignal
  ): Promise<HistoryWriteResult> {
    const path = normalizeWorkspacePath(pathInput)
    throwIfAborted(signal, path)
    let current: FileSnapshot | undefined
    try {
      current = await this.#adapter.read(path)
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    throwIfAborted(signal, path)
    if (!current) {
      throwIfAborted(signal, path)
      return {
        outcome: await this.#adapter.writeAtomic(path, bytes, expectedHash, {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: expectedHash === undefined,
          signal
        })
      }
    }
    if (expectedHash !== undefined && current.hash !== expectedHash) {
      throwIfAborted(signal, path)
      return {
        outcome: await this.#adapter.writeAtomic(path, bytes, expectedHash, {
          expectedWorkspaceId: this.#adapter.id,
          signal
        })
      }
    }
    throwIfAborted(signal, path)
    const revision = await this.createRevision(path, {
      reason,
      snapshot: current,
      signal
    })
    throwIfAborted(signal, path)
    return {
      revision,
      outcome: await this.#adapter.writeAtomic(path, bytes, current.hash, {
        expectedWorkspaceId: this.#adapter.id,
        signal
      })
    }
  }

  async restore(
    revision: HistoryRevision,
    expectedCurrentHash: string | null
  ): Promise<HistoryWriteResult> {
    const preview = await this.preview(revision)
    if (expectedCurrentHash === null) {
      return {
        outcome: await this.#adapter.writeAtomic(revision.originalPath, preview.bytes, undefined, {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: true
        })
      }
    }
    if (!/^[0-9a-f]{64}$/iu.test(expectedCurrentHash)) {
      throw new TypeError('expectedCurrentHash must be a SHA-256 digest or null.')
    }
    return this.writeWithRevision(
      revision.originalPath,
      preview.bytes,
      expectedCurrentHash.toLowerCase(),
      'restore'
    )
  }

  async restoreAsCopy(
    revision: HistoryRevision,
    destinationPathInput: string,
    signal?: AbortSignal
  ): Promise<SaveOutcome> {
    const destinationPath = normalizeWorkspacePath(destinationPathInput)
    throwIfAborted(signal, destinationPath)
    const preview = await this.preview(revision)
    throwIfAborted(signal, destinationPath)
    return this.#adapter.writeAtomic(destinationPath, preview.bytes, undefined, {
      expectedWorkspaceId: this.#adapter.id,
      expectedMissing: true,
      signal
    })
  }

  async removeWithRevision(pathInput: string): Promise<HistoryDeleteResult> {
    const path = normalizeWorkspacePath(pathInput)
    const snapshot = await this.#adapter.read(path)
    const revision = await this.createRevision(path, {
      reason: 'delete',
      snapshot
    })
    await removeFileIfHash(this.#adapter, path, snapshot.hash)
    return { revision, removedSnapshot: snapshot }
  }

  async enforceRetention(signal?: AbortSignal): Promise<HistoryRetentionResult> {
    return this.#enforceRetention(signal)
  }

  async #enforceRetention(
    signal?: AbortSignal,
    rollbackReceipt?: HistoryRevisionRollbackReceipt
  ): Promise<HistoryRetentionResult> {
    const rollbackRevision = rollbackReceipt?.revision
    throwIfAborted(signal, HISTORY_ROOT, 'remove')
    const listing = await this.listRevisions(undefined, { signal })
    if (
      rollbackRevision &&
      !listing.revisions.some((revision) => revision.metadataPath === rollbackRevision.metadataPath)
    ) {
      await this.#rollbackRevision(rollbackReceipt)
      throw new WorkspaceOperationError({
        code: 'storage-failure',
        operation: 'write',
        path: rollbackRevision.originalPath,
        message: 'The new portable history revision could not be verified and was rolled back.'
      })
    }
    const protection = await this.#buildHistoryProtection(
      listing.revisions,
      rollbackRevision,
      signal
    )
    const plan = this.#planRetention(
      listing.revisions,
      listing.storageBytes,
      listing.recordCount ?? listing.revisions.length + listing.issues.length,
      protection.protectedPaths,
      protection.invalidPaths
    )
    if (
      rollbackRevision &&
      (protection.invalidPaths.has(rollbackRevision.metadataPath) ||
        !plan.projectedWithinLimits ||
        plan.removals.some((revision) => revision.metadataPath === rollbackRevision.metadataPath))
    ) {
      await this.#rollbackRevision(rollbackReceipt)
      throw new WorkspaceOperationError({
        code: plan.protectedOverLimit ? 'quota-exceeded' : 'storage-failure',
        operation: 'write',
        path: rollbackRevision.originalPath,
        message: plan.protectedOverLimit
          ? 'Portable history cannot preserve the newest revision of every process within its global retention limits.'
          : 'Portable history contains unaccounted or corrupt storage that prevents retention compliance.'
      })
    }

    const retentionLimitIssue: HistoryIssue | undefined = !plan.projectedWithinLimits
      ? {
          path: HISTORY_ROOT,
          code: 'retention-limit',
          message: plan.protectedOverLimit
            ? 'Portable history exceeds its global limit because the newest revision of every process is protected.'
            : 'Portable history contains corrupt or orphan storage that prevents retention compliance.'
        }
      : undefined
    const initialIssues = retentionLimitIssue
      ? [retentionLimitIssue, ...listing.issues, ...protection.issues]
      : [...listing.issues, ...protection.issues]
    const issues = initialIssues.slice(0, HISTORY_RETENTION_RESULT_DETAIL_LIMIT)
    let issueCount = initialIssues.length
    const appendIssue = (issue: HistoryIssue): void => {
      issueCount += 1
      if (issues.length < HISTORY_RETENTION_RESULT_DETAIL_LIMIT) issues.push(issue)
    }

    const removed: HistoryRevision[] = []
    let removedRevisionCount = 0
    let removedStorageBytes = 0
    let cleanupFailed = false
    for (let index = 0; index < plan.removals.length; index += 1) {
      throwIfAborted(signal, HISTORY_ROOT, 'remove')
      const revision = plan.removals[index]!
      try {
        await this.#removeRevisionForRetention(revision)
        removedRevisionCount += 1
        removedStorageBytes += revision.storageBytes
        if (removed.length < HISTORY_RETENTION_RESULT_DETAIL_LIMIT) removed.push(revision)
      } catch (error) {
        cleanupFailed = true
        appendIssue({
          path: revision.metadataPath,
          code: 'unreadable',
          message: boundIssueMessage(`Could not prune history revision: ${errorMessage(error)}`)
        })
        break
      }
      if (index + 1 < plan.removals.length && (index + 1) % HISTORY_SCAN_BATCH_SIZE === 0) {
        await this.#yieldAndCheck(signal, HISTORY_ROOT, 'remove')
      }
    }

    const finalListing =
      plan.removals.length > 0 ? await this.listRevisions(undefined, { signal }) : listing
    const withinLimits = !cleanupFailed && this.#listingWithinLimits(finalListing)
    if (rollbackRevision && !withinLimits) {
      await this.#rollbackRevision(rollbackReceipt)
      throw new WorkspaceOperationError({
        code: 'storage-failure',
        operation: 'write',
        path: rollbackRevision.originalPath,
        message:
          'Portable history cleanup did not satisfy its retention limits; the new revision was rolled back.'
      })
    }
    return {
      removed,
      removedRevisionCount,
      removedStorageBytes,
      omittedRemovedRevisionCount: removedRevisionCount - removed.length,
      issues,
      issueCount,
      omittedIssueCount: issueCount - issues.length,
      ...(finalListing.storageBytes === undefined
        ? {}
        : { storageBytes: finalListing.storageBytes }),
      totalBytes: finalListing.totalBytes,
      totalRevisions: finalListing.revisions.length,
      totalRecords:
        finalListing.recordCount ?? finalListing.revisions.length + finalListing.issues.length,
      withinLimits,
      overLimitBecauseNewestAreProtected: plan.protectedOverLimit
    }
  }

  async #buildHistoryProtection(
    revisions: readonly HistoryRevision[],
    rollbackRevision: HistoryRevision | undefined,
    signal: AbortSignal | undefined
  ): Promise<HistoryProtection> {
    const protectedPaths = new Set<string>()
    const invalidPaths = new Set<string>()
    const issues: HistoryIssue[] = []
    const validity = new Map<string, boolean>()
    let checks = 0

    const isValidRecovery = async (revision: HistoryRevision): Promise<boolean> => {
      const cached = validity.get(revision.metadataPath)
      if (cached !== undefined) return cached
      throwIfAborted(signal, revision.contentPath, 'remove')
      try {
        const snapshot = await this.#adapter.read(revision.contentPath, {
          maxBytes: revision.size,
          signal
        })
        throwIfAborted(signal, revision.contentPath, 'remove')
        const valid = snapshot.size === revision.size && snapshot.hash === revision.hash
        validity.set(revision.metadataPath, valid)
        if (!valid) {
          invalidPaths.add(revision.metadataPath)
          issues.push({
            path: revision.contentPath,
            code: 'checksum-mismatch',
            message: 'History content no longer matches its revision checksum.'
          })
        }
        return valid
      } catch (error) {
        throwIfAborted(signal, revision.contentPath, 'remove')
        invalidPaths.add(revision.metadataPath)
        validity.set(revision.metadataPath, false)
        issues.push({
          path: revision.contentPath,
          code: error instanceof WorkspaceReadLimitError ? 'checksum-mismatch' : 'unreadable',
          message:
            error instanceof WorkspaceReadLimitError
              ? 'History content no longer matches its revision size.'
              : errorMessage(error, 'History content could not be verified.')
        })
        return false
      } finally {
        checks += 1
        if (checks % HISTORY_SCAN_BATCH_SIZE === 0) {
          await this.#yieldAndCheck(signal, HISTORY_ROOT, 'remove')
        }
      }
    }

    const groups = new Map<string, HistoryRevision[]>()
    for (const revision of revisions) {
      const group = groups.get(revision.originalPath) ?? []
      group.push(revision)
      groups.set(revision.originalPath, group)
    }

    for (const processRevisions of groups.values()) {
      processRevisions.sort(byNewest)
      if (
        rollbackRevision &&
        processRevisions.some((revision) => revision.metadataPath === rollbackRevision.metadataPath)
      ) {
        if (await isValidRecovery(rollbackRevision)) {
          protectedPaths.add(rollbackRevision.metadataPath)
        }
        for (const revision of processRevisions) {
          if (revision.metadataPath === rollbackRevision.metadataPath) continue
          if (await isValidRecovery(revision)) {
            protectedPaths.add(revision.metadataPath)
            break
          }
        }
        continue
      }
      for (const revision of processRevisions) {
        if (await isValidRecovery(revision)) {
          protectedPaths.add(revision.metadataPath)
          break
        }
      }
    }

    return { protectedPaths, invalidPaths, issues }
  }

  #planRetention(
    revisions: readonly HistoryRevision[],
    actualStorageBytes: number | undefined,
    actualRecordCount: number,
    protectedPaths: ReadonlySet<string>,
    invalidPaths: ReadonlySet<string>
  ): HistoryRetentionPlan {
    const groups = new Map<string, HistoryRevision[]>()
    for (const revision of revisions) {
      const group = groups.get(revision.originalPath) ?? []
      group.push(revision)
      groups.set(revision.originalPath, group)
    }

    const removalPaths = new Set<string>()
    for (const processRevisions of groups.values()) {
      processRevisions.sort(byNewest)
      let requiredRemovals = Math.max(0, processRevisions.length - this.#maxPerProcess)
      for (const revision of [...processRevisions].sort(byOldest)) {
        if (requiredRemovals === 0) break
        if (protectedPaths.has(revision.metadataPath)) continue
        removalPaths.add(revision.metadataPath)
        requiredRemovals -= 1
      }
    }

    const retained = revisions.filter((revision) => !removalPaths.has(revision.metadataPath))
    let projectedRecordCount = actualRecordCount - removalPaths.size
    let projectedStorageBytes =
      actualStorageBytes === undefined
        ? undefined
        : actualStorageBytes -
          revisions
            .filter((revision) => removalPaths.has(revision.metadataPath))
            .reduce((total, revision) => total + revision.storageBytes, 0)
    const globalRemovalOrder = [...retained].sort((left, right) => {
      const invalidOrder =
        Number(invalidPaths.has(right.metadataPath)) - Number(invalidPaths.has(left.metadataPath))
      return invalidOrder || byOldest(left, right)
    })
    for (const revision of globalRemovalOrder) {
      if (projectedStorageBytes === undefined) break
      if (
        projectedRecordCount <= this.#maxTotalRevisions &&
        projectedStorageBytes <= this.#maxTotalBytes
      ) {
        break
      }
      if (protectedPaths.has(revision.metadataPath)) continue
      removalPaths.add(revision.metadataPath)
      projectedRecordCount -= 1
      projectedStorageBytes -= revision.storageBytes
    }

    const protectedRevisions = revisions.filter((revision) =>
      protectedPaths.has(revision.metadataPath)
    )
    const protectedStorageBytes = protectedRevisions.reduce(
      (total, revision) => total + revision.storageBytes,
      0
    )
    const protectedOverLimit =
      protectedRevisions.length > this.#maxTotalRevisions ||
      protectedStorageBytes > this.#maxTotalBytes ||
      [...groups.values()].some(
        (processRevisions) =>
          processRevisions.filter((revision) => protectedPaths.has(revision.metadataPath)).length >
          this.#maxPerProcess
      )
    const projectedWithinLimits =
      projectedStorageBytes !== undefined &&
      projectedRecordCount <= this.#maxTotalRevisions &&
      projectedStorageBytes <= this.#maxTotalBytes &&
      [...groups.values()].every(
        (processRevisions) =>
          processRevisions.filter((revision) => !removalPaths.has(revision.metadataPath)).length <=
          this.#maxPerProcess
      )
    return {
      removals: projectedWithinLimits
        ? revisions.filter((revision) => removalPaths.has(revision.metadataPath)).sort(byOldest)
        : [],
      protectedOverLimit,
      projectedWithinLimits
    }
  }

  #listingWithinLimits(listing: HistoryListing): boolean {
    if (listing.storageBytes === undefined) return false
    if (
      (listing.recordCount ?? listing.revisions.length + listing.issues.length) >
      this.#maxTotalRevisions
    ) {
      return false
    }
    if (listing.storageBytes > this.#maxTotalBytes) return false
    const counts = new Map<string, number>()
    for (const revision of listing.revisions) {
      const count = (counts.get(revision.originalPath) ?? 0) + 1
      if (count > this.#maxPerProcess) return false
      counts.set(revision.originalPath, count)
    }
    return true
  }

  async #removeRevisionForRetention(revision: HistoryRevision): Promise<void> {
    await this.#adapter.remove(revision.contentPath)
    await this.#adapter.remove(revision.metadataPath)
    await this.#confirmFileMissing(revision.contentPath)
    await this.#confirmFileMissing(revision.metadataPath)
  }

  async #confirmFileMissing(path: string): Promise<void> {
    try {
      await this.#adapter.read(path, { maxBytes: 0 })
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
    throw new WorkspaceOperationError({
      code: 'storage-failure',
      operation: 'remove',
      path,
      message: 'Portable history cleanup could not confirm that a file was removed.'
    })
  }

  async #rollbackRevision(receipt: HistoryRevisionRollbackReceipt): Promise<void> {
    receipt.attempted = true
    const rollbackErrors: unknown[] = []
    try {
      await removeFileIfHash(
        this.#adapter,
        receipt.revision.metadataPath,
        receipt.metadataSnapshot.hash
      )
    } catch (error) {
      rollbackErrors.push(error)
    }
    try {
      await removeFileIfHash(
        this.#adapter,
        receipt.revision.contentPath,
        receipt.contentSnapshot.hash
      )
    } catch (error) {
      rollbackErrors.push(error)
    }
    if (rollbackErrors.length === 0) return
    throw new WorkspaceOperationError({
      code: 'storage-failure',
      operation: 'write',
      path: receipt.revision.originalPath,
      message:
        'Portable history creation failed and its conditional rollback was incomplete; changed or inaccessible history evidence was preserved.',
      cause: new AggregateError(rollbackErrors, 'Portable history revision rollback failed.')
    })
  }

  async #yieldAndCheck(
    signal: AbortSignal | undefined,
    path: string,
    operation: 'list' | 'remove'
  ): Promise<void> {
    throwIfAborted(signal, path, operation)
    await this.#cooperativeYield()
    throwIfAborted(signal, path, operation)
  }
}

function parseMetadata(raw: string, metadataPath: string): HistoryRevisionMetadata {
  const value = JSON.parse(raw) as Partial<HistoryRevisionMetadata>
  if (
    value.format !== 'orbitpm-history-revision' ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.originalPath !== 'string' ||
    typeof value.contentPath !== 'string' ||
    typeof value.metadataPath !== 'string' ||
    typeof value.hash !== 'string' ||
    typeof value.size !== 'number' ||
    typeof value.createdAt !== 'number' ||
    typeof value.reason !== 'string'
  ) {
    throw new Error('Unsupported or incomplete history metadata.')
  }
  const originalPath = normalizeWorkspacePath(value.originalPath)
  const contentPath = normalizeWorkspacePath(value.contentPath)
  const idMatch = /^(\d+)-([1-9]\d*)-[a-f0-9]{12}$/iu.exec(value.id)
  if (
    normalizeWorkspacePath(value.metadataPath) !== metadataPath ||
    !contentPath.startsWith(`${HISTORY_ROOT}/`) ||
    workspaceParentPath(contentPath) !== workspaceParentPath(metadataPath) ||
    workspacePathName(metadataPath) !== `${value.id}.json` ||
    workspacePathName(contentPath) !== `${value.id}.bpmn` ||
    !idMatch ||
    Number(idMatch[1]) !== value.createdAt ||
    !Number.isSafeInteger(Number(idMatch[2])) ||
    !/^[a-f0-9]{64}$/i.test(value.hash) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0
  ) {
    throw new Error('History metadata contains unsafe or inconsistent paths.')
  }
  return {
    format: 'orbitpm-history-revision',
    version: 1,
    id: value.id,
    originalPath,
    contentPath,
    metadataPath,
    hash: value.hash.toLowerCase(),
    size: value.size,
    createdAt: value.createdAt,
    reason: value.reason as HistoryRevisionReason,
    applicationVersion: value.applicationVersion
  }
}
