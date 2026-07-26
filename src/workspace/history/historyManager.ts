import {
  WorkspaceOperationError,
  copyBytes,
  normalizeWorkspacePath,
  sha256Hex,
  workspaceParentPath,
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
export const DEFAULT_HISTORY_TOTAL_BYTES = 100 * 1024 * 1024

export interface PortableHistoryManagerOptions {
  adapter: WorkspaceAdapter
  now?: () => number
  maxPerProcess?: number
  maxTotalBytes?: number
  applicationVersion?: string
}

export interface CreateHistoryRevisionOptions {
  reason: HistoryRevisionReason
  snapshot?: FileSnapshot
  prune?: boolean
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceOperationError && error.code === 'not-found'
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

function byNewest(left: HistoryRevision, right: HistoryRevision): number {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id)
}

function byOldest(left: HistoryRevision, right: HistoryRevision): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

export class PortableHistoryManager {
  readonly #adapter: WorkspaceAdapter
  readonly #now: () => number
  readonly #maxPerProcess: number
  readonly #maxTotalBytes: number
  readonly #applicationVersion?: string
  #sequence = 0

  constructor(options: PortableHistoryManagerOptions) {
    if (!Number.isInteger(options.maxPerProcess ?? DEFAULT_HISTORY_PER_PROCESS)) {
      throw new Error('maxPerProcess must be an integer')
    }
    if ((options.maxPerProcess ?? DEFAULT_HISTORY_PER_PROCESS) < 1) {
      throw new Error('maxPerProcess must preserve at least one revision')
    }
    if ((options.maxTotalBytes ?? DEFAULT_HISTORY_TOTAL_BYTES) < 1) {
      throw new Error('maxTotalBytes must be positive')
    }
    this.#adapter = options.adapter
    this.#now = options.now ?? (() => Date.now())
    this.#maxPerProcess = options.maxPerProcess ?? DEFAULT_HISTORY_PER_PROCESS
    this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_HISTORY_TOTAL_BYTES
    this.#applicationVersion = options.applicationVersion
  }

  async createRevision(
    originalPathInput: string,
    options: CreateHistoryRevisionOptions
  ): Promise<HistoryRevision> {
    const originalPath = normalizeWorkspacePath(originalPathInput)
    if (!/\.bpmn$/i.test(originalPath)) {
      throw new WorkspaceOperationError({
        code: 'unsupported',
        operation: 'write',
        path: originalPath,
        message: 'Portable history revisions are created only for BPMN files.'
      })
    }
    const snapshot = options.snapshot ?? (await this.#adapter.read(originalPath))
    const pathHash = await sha256Hex(encoder.encode(originalPath))
    const createdAt = this.#now()
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

    await this.#adapter.createFolder(folder)
    savedOrThrow(
      await this.#adapter.writeAtomic(contentPath, snapshot.bytes, undefined, {
        expectedWorkspaceId: this.#adapter.id,
        expectedMissing: true
      }),
      contentPath
    )
    try {
      savedOrThrow(
        await this.#adapter.writeAtomic(metadataPath, metadataBytes, undefined, {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: true
        }),
        metadataPath
      )
    } catch (error) {
      try {
        await this.#adapter.remove(contentPath)
      } catch {
        // The exact content remains recoverable as an orphan if cleanup fails.
      }
      throw error
    }

    const revision: HistoryRevision = {
      ...metadata,
      storageBytes: snapshot.size + metadataBytes.byteLength
    }
    if (options.prune !== false) await this.enforceRetention()
    return revision
  }

  async listRevisions(originalPathInput?: string): Promise<HistoryListing> {
    const originalPath =
      originalPathInput === undefined ? undefined : normalizeWorkspacePath(originalPathInput)
    let entries: WorkspaceEntry[]
    try {
      entries = await this.#adapter.list(HISTORY_ROOT)
    } catch (error) {
      if (isNotFound(error)) return { revisions: [], issues: [], totalBytes: 0 }
      throw error
    }
    const byPath = new Map(entries.map((entry) => [entry.path, entry]))
    const revisions: HistoryRevision[] = []
    const issues: HistoryIssue[] = []

    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.path.endsWith('.json')) continue
      if (!entry.readable) {
        issues.push({
          path: entry.path,
          code: 'unreadable',
          message: entry.issue?.message ?? 'History metadata is unreadable.'
        })
        continue
      }
      try {
        const metadataSnapshot = await this.#adapter.read(entry.path)
        const parsed = parseMetadata(decoder.decode(metadataSnapshot.bytes), entry.path)
        if (originalPath !== undefined && parsed.originalPath !== originalPath) continue
        const contentEntry = byPath.get(parsed.contentPath)
        if (!contentEntry || contentEntry.kind !== 'file') {
          issues.push({
            path: entry.path,
            code: 'missing-content',
            message: `History content "${parsed.contentPath}" is missing.`
          })
          continue
        }
        revisions.push({
          ...parsed,
          storageBytes: metadataSnapshot.size + (contentEntry.size ?? parsed.size)
        })
      } catch (error) {
        issues.push({
          path: entry.path,
          code: 'invalid-metadata',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    revisions.sort(byNewest)
    return {
      revisions,
      issues,
      totalBytes: revisions.reduce((total, revision) => total + revision.storageBytes, 0)
    }
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
    reason: HistoryRevisionReason = 'overwrite'
  ): Promise<HistoryWriteResult> {
    const path = normalizeWorkspacePath(pathInput)
    let current: FileSnapshot | undefined
    try {
      current = await this.#adapter.read(path)
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    if (!current) {
      return {
        outcome: await this.#adapter.writeAtomic(path, bytes, expectedHash, {
          expectedWorkspaceId: this.#adapter.id,
          expectedMissing: expectedHash === undefined
        })
      }
    }
    if (expectedHash !== undefined && current.hash !== expectedHash) {
      return {
        outcome: await this.#adapter.writeAtomic(path, bytes, expectedHash, {
          expectedWorkspaceId: this.#adapter.id
        })
      }
    }
    const revision = await this.createRevision(path, {
      reason,
      snapshot: current
    })
    return {
      revision,
      outcome: await this.#adapter.writeAtomic(path, bytes, current.hash, {
        expectedWorkspaceId: this.#adapter.id
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
    destinationPathInput: string
  ): Promise<SaveOutcome> {
    const destinationPath = normalizeWorkspacePath(destinationPathInput)
    const preview = await this.preview(revision)
    return this.#adapter.writeAtomic(destinationPath, preview.bytes, undefined, {
      expectedWorkspaceId: this.#adapter.id,
      expectedMissing: true
    })
  }

  async removeWithRevision(pathInput: string): Promise<HistoryDeleteResult> {
    const path = normalizeWorkspacePath(pathInput)
    const snapshot = await this.#adapter.read(path)
    const revision = await this.createRevision(path, {
      reason: 'delete',
      snapshot
    })
    // Re-read immediately before deletion. File System Access has no portable
    // hash-conditional remove; this closes the ordinary revision→delete race.
    const beforeDelete = await this.#adapter.read(path)
    if (beforeDelete.hash !== snapshot.hash) {
      throw new WorkspaceOperationError({
        code: 'integrity-failure',
        operation: 'remove',
        path,
        message: `Workspace file "${path}" changed before deletion.`
      })
    }
    await this.#adapter.remove(path)
    return { revision, removedSnapshot: snapshot }
  }

  async enforceRetention(): Promise<HistoryRetentionResult> {
    const listing = await this.listRevisions()
    const groups = new Map<string, HistoryRevision[]>()
    for (const revision of listing.revisions) {
      const group = groups.get(revision.originalPath) ?? []
      group.push(revision)
      groups.set(revision.originalPath, group)
    }

    const remove = new Map<string, HistoryRevision>()
    for (const revisions of groups.values()) {
      revisions.sort(byNewest)
      for (const revision of revisions.slice(this.#maxPerProcess)) {
        remove.set(revision.id, revision)
      }
    }

    let retained = listing.revisions.filter((revision) => !remove.has(revision.id))
    let totalBytes = retained.reduce((total, revision) => total + revision.storageBytes, 0)
    const protectedIds = new Set<string>()
    for (const revisions of groups.values()) {
      const newestRetained = revisions.find((revision) => !remove.has(revision.id))
      if (newestRetained) protectedIds.add(newestRetained.id)
    }
    for (const revision of [...retained].sort(byOldest)) {
      if (totalBytes <= this.#maxTotalBytes) break
      if (protectedIds.has(revision.id)) continue
      remove.set(revision.id, revision)
      totalBytes -= revision.storageBytes
    }

    const issues = [...listing.issues]
    const removed: HistoryRevision[] = []
    for (const revision of [...remove.values()].sort(byOldest)) {
      try {
        await this.#adapter.remove(revision.contentPath)
        await this.#adapter.remove(revision.metadataPath)
        removed.push(revision)
      } catch (error) {
        issues.push({
          path: revision.metadataPath,
          code: 'unreadable',
          message: `Could not prune history revision: ${
            error instanceof Error ? error.message : String(error)
          }`
        })
      }
    }
    retained = retained.filter((revision) => !removed.some((item) => item.id === revision.id))
    totalBytes = retained.reduce((total, revision) => total + revision.storageBytes, 0)
    return {
      removed,
      issues,
      totalBytes,
      overLimitBecauseNewestAreProtected: totalBytes > this.#maxTotalBytes
    }
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
  if (
    normalizeWorkspacePath(value.metadataPath) !== metadataPath ||
    !contentPath.startsWith(`${HISTORY_ROOT}/`) ||
    workspaceParentPath(contentPath) !== workspaceParentPath(metadataPath) ||
    !/^[a-f0-9]{64}$/i.test(value.hash) ||
    value.size < 0 ||
    !Number.isFinite(value.createdAt)
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
