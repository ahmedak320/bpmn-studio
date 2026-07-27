import { DEFAULT_XML_PREFLIGHT_LIMITS } from '../validation/preflight'
import type {
  FileSnapshot,
  WorkspaceAdapter,
  WorkspaceEntry,
  WorkspaceFailure,
  WorkspaceOperation
} from './adapters'
import {
  DEFAULT_WORKSPACE_LIST_LIMITS,
  WorkspaceListLimitError,
  WorkspaceOperationError,
  WorkspaceReadLimitError,
  errorName,
  workspaceFailure
} from './adapters'

export interface WorkspaceBpmnScanLimits {
  /** Maximum number of recursive workspace entries materialized by listing. */
  readonly maxEntries: number
  /** Maximum recursive workspace path depth materialized by listing. */
  readonly maxDepth: number
  /** Maximum number of user BPMN files considered by one scan. */
  readonly maxFiles: number
  /** Maximum encoded bytes accepted from any one BPMN file. */
  readonly maxFileBytes: number
  /** Maximum encoded bytes retained across all BPMN files in one scan. */
  readonly maxTotalBytes: number
}

export interface WorkspaceBpmnScanOptions {
  readonly limits?: Partial<WorkspaceBpmnScanLimits>
  readonly readConcurrency?: number
  readonly signal?: AbortSignal
}

export const DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS: Readonly<WorkspaceBpmnScanLimits> = Object.freeze({
  maxEntries: DEFAULT_WORKSPACE_LIST_LIMITS.maxEntries,
  maxDepth: DEFAULT_WORKSPACE_LIST_LIMITS.maxDepth,
  maxFiles: 2_500,
  maxFileBytes: DEFAULT_XML_PREFLIGHT_LIMITS.maxBytes,
  maxTotalBytes: 100 * 1024 * 1024
})

export const MAX_WORKSPACE_BPMN_SCAN_CONCURRENCY = 16

interface PreparedBpmnScan {
  readonly entries: WorkspaceEntry[]
  readonly issues: WorkspaceFailure[]
  readonly totalFiles: number
}

interface ReservedEntry {
  readonly entry: WorkspaceEntry
  readonly maxBytes: number
}

interface SuccessfulRead<T> {
  readonly ok: true
  readonly bytes: number
  readonly value: T
}

interface FailedRead {
  readonly ok: false
  readonly error: unknown
}

export interface BoundedBpmnReadResult<T> {
  readonly values: T[]
  readonly issues: WorkspaceFailure[]
  readonly totalFiles: number
  readonly loadedBytes: number
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`)
  }
  return value
}

function positiveSafeIntegerAtMost(value: number, label: string, hardLimit: number): number {
  const resolved = positiveSafeInteger(value, label)
  if (resolved > hardLimit) {
    throw new TypeError(`${label} cannot exceed the hard limit of ${hardLimit}.`)
  }
  return resolved
}

export function resolveWorkspaceBpmnScanLimits(
  overrides: Partial<WorkspaceBpmnScanLimits> = {}
): Readonly<WorkspaceBpmnScanLimits> {
  return Object.freeze({
    maxEntries: positiveSafeIntegerAtMost(
      overrides.maxEntries ?? DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS.maxEntries,
      'Workspace scan maxEntries',
      DEFAULT_WORKSPACE_LIST_LIMITS.maxEntries
    ),
    maxDepth: positiveSafeIntegerAtMost(
      overrides.maxDepth ?? DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS.maxDepth,
      'Workspace scan maxDepth',
      DEFAULT_WORKSPACE_LIST_LIMITS.maxDepth
    ),
    maxFiles: positiveSafeInteger(
      overrides.maxFiles ?? DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS.maxFiles,
      'Workspace BPMN maxFiles'
    ),
    maxFileBytes: positiveSafeInteger(
      overrides.maxFileBytes ?? DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS.maxFileBytes,
      'Workspace BPMN maxFileBytes'
    ),
    maxTotalBytes: positiveSafeInteger(
      overrides.maxTotalBytes ?? DEFAULT_WORKSPACE_BPMN_SCAN_LIMITS.maxTotalBytes,
      'Workspace BPMN maxTotalBytes'
    )
  })
}

export function resolveWorkspaceBpmnReadConcurrency(
  value: number | undefined,
  fallback: number
): number {
  const resolved = positiveSafeInteger(value ?? fallback, 'Workspace BPMN readConcurrency')
  return Math.min(resolved, MAX_WORKSPACE_BPMN_SCAN_CONCURRENCY)
}

export function assertWorkspaceListingWithinLimits(
  listed: readonly WorkspaceEntry[],
  limits: WorkspaceBpmnScanLimits
): void {
  if (listed.length > limits.maxEntries) {
    throw new WorkspaceListLimitError(
      listed[limits.maxEntries]?.path,
      'entries',
      limits.maxEntries,
      listed.length
    )
  }
  for (const entry of listed) {
    const depth = entry.path.split('/').filter(Boolean).length
    if (depth > limits.maxDepth) {
      throw new WorkspaceListLimitError(entry.path, 'depth', limits.maxDepth, depth)
    }
  }
}

export function throwIfWorkspaceScanAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error && signal.reason.name === 'AbortError') {
    throw signal.reason
  }
  const message =
    typeof signal.reason === 'string' && signal.reason.trim()
      ? signal.reason
      : 'Workspace scan was cancelled.'
  throw new DOMException(message, 'AbortError')
}

export function isInternalWorkspacePath(path: string): boolean {
  const first = path.split('/')[0] ?? ''
  return first.toLocaleLowerCase('en-US') === '.orbitpm'
}

export function isWorkspaceBpmnEntry(entry: WorkspaceEntry): boolean {
  return (
    entry.kind === 'file' && /\.bpmn$/iu.test(entry.name) && !isInternalWorkspacePath(entry.path)
  )
}

function scanFailure(
  message: string,
  operation: WorkspaceOperation,
  path?: string
): WorkspaceFailure {
  return {
    code: 'storage-failure',
    message,
    operation,
    path,
    name: 'WorkspaceBpmnScanLimitError'
  }
}

function fileCountFailure(totalFiles: number, maxFiles: number): WorkspaceFailure {
  const skipped = totalFiles - maxFiles
  return scanFailure(
    `Workspace contains ${totalFiles} BPMN files; the scan limit is ${maxFiles}. ` +
      `${skipped} ${skipped === 1 ? 'file was' : 'files were'} not scanned.`,
    'list'
  )
}

function fileSizeFailure(path: string, actualBytes: number, maxBytes: number): WorkspaceFailure {
  return scanFailure(
    `Workspace BPMN file "${path}" is ${actualBytes} bytes; the per-file scan limit is ${maxBytes} bytes.`,
    'read',
    path
  )
}

function aggregateFailure(
  path: string | undefined,
  actualBytes: number,
  maxBytes: number
): WorkspaceFailure {
  const subject = path ? `Workspace BPMN file "${path}"` : 'Workspace BPMN metadata'
  return scanFailure(
    `${subject} would raise the scan total to ${actualBytes} bytes; the aggregate scan limit is ${maxBytes} bytes.`,
    'read',
    path
  )
}

function unreadableFailure(entry: WorkspaceEntry): WorkspaceFailure {
  return (
    entry.issue ??
    scanFailure(
      `Workspace BPMN file "${entry.path}" is unreadable and was not scanned.`,
      'read',
      entry.path
    )
  )
}

function missingSizeFailure(path: string): WorkspaceFailure {
  return scanFailure(
    `Workspace BPMN file "${path}" does not expose trustworthy byte-size metadata.`,
    'read',
    path
  )
}

function knownEntrySize(entry: WorkspaceEntry): number | undefined {
  return Number.isSafeInteger(entry.size) && entry.size! >= 0 ? entry.size : undefined
}

function preparedBpmnScan(
  listed: readonly WorkspaceEntry[],
  limits: WorkspaceBpmnScanLimits
): PreparedBpmnScan {
  const allBpmnEntries = listed
    .filter(isWorkspaceBpmnEntry)
    .sort((left, right) => left.path.localeCompare(right.path, 'en-US'))
  const totalFiles = allBpmnEntries.length
  const entries = allBpmnEntries.slice(0, limits.maxFiles)

  const issues: WorkspaceFailure[] = []
  if (totalFiles > limits.maxFiles) issues.push(fileCountFailure(totalFiles, limits.maxFiles))

  const readable: WorkspaceEntry[] = []
  for (const entry of entries) {
    if (!entry.readable) {
      issues.push(unreadableFailure(entry))
      continue
    }
    const size = knownEntrySize(entry)
    if (size !== undefined && size > limits.maxFileBytes) {
      issues.push(fileSizeFailure(entry.path, size, limits.maxFileBytes))
      continue
    }
    readable.push(entry)
  }
  return { entries: readable, issues, totalFiles }
}

function throwFailure(failure: WorkspaceFailure): never {
  throw new WorkspaceOperationError({
    code: failure.code,
    operation: failure.operation,
    path: failure.path,
    message: failure.message
  })
}

function assertStrictMetadataFits(
  prepared: PreparedBpmnScan,
  limits: WorkspaceBpmnScanLimits
): void {
  if (prepared.issues.length > 0) throwFailure(prepared.issues[0])
  let knownBytes = 0
  for (const entry of prepared.entries) {
    const size = knownEntrySize(entry)
    if (size === undefined) throwFailure(missingSizeFailure(entry.path))
    knownBytes += size
    if (!Number.isSafeInteger(knownBytes) || knownBytes > limits.maxTotalBytes) {
      throwFailure(aggregateFailure(undefined, knownBytes, limits.maxTotalBytes))
    }
  }
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || errorName(error) === 'AbortError'
}

/**
 * Reads BPMN files under a byte-budgeted worker pool.
 *
 * Known metadata is rejected before `adapter.read`. Unknown-size entries are
 * given only the remaining aggregate budget, which conforming adapters enforce
 * before copying or hashing bytes. The transform therefore never receives a
 * file that exceeds its reservation.
 */
export async function readBoundedWorkspaceBpmn<T>(
  adapter: WorkspaceAdapter,
  listed: readonly WorkspaceEntry[],
  options: WorkspaceBpmnScanOptions & {
    readonly defaultConcurrency: number
    readonly failClosed: boolean
    readonly transform: (
      entry: WorkspaceEntry,
      snapshot: FileSnapshot,
      signal: AbortSignal | undefined
    ) => Promise<T> | T
  }
): Promise<BoundedBpmnReadResult<T>> {
  throwIfWorkspaceScanAborted(options.signal)
  const limits = resolveWorkspaceBpmnScanLimits(options.limits)
  const concurrency = resolveWorkspaceBpmnReadConcurrency(
    options.readConcurrency,
    options.defaultConcurrency
  )
  assertWorkspaceListingWithinLimits(listed, limits)
  const prepared = preparedBpmnScan(listed, limits)
  if (options.failClosed) assertStrictMetadataFits(prepared, limits)

  const issues = [...prepared.issues]
  const values: T[] = []
  let cursor = 0
  let loadedBytes = 0

  while (cursor < prepared.entries.length) {
    throwIfWorkspaceScanAborted(options.signal)
    const batch: ReservedEntry[] = []
    let reservedBytes = 0

    while (batch.length < concurrency && cursor < prepared.entries.length) {
      const entry = prepared.entries[cursor]
      const remaining = limits.maxTotalBytes - loadedBytes - reservedBytes
      const knownSize = knownEntrySize(entry)
      if (knownSize !== undefined && knownSize > remaining) {
        if (batch.length > 0) break
        const issue = aggregateFailure(entry.path, loadedBytes + knownSize, limits.maxTotalBytes)
        if (options.failClosed) throwFailure(issue)
        issues.push(issue)
        cursor += 1
        continue
      }
      if (knownSize === undefined && remaining === 0 && batch.length > 0) break

      batch.push({
        entry,
        maxBytes: knownSize ?? Math.min(limits.maxFileBytes, Math.max(0, remaining))
      })
      reservedBytes += batch.at(-1)!.maxBytes
      cursor += 1
    }

    if (batch.length === 0) continue
    const readResults = await Promise.all(
      batch.map(async ({ entry, maxBytes }): Promise<SuccessfulRead<T> | FailedRead> => {
        try {
          throwIfWorkspaceScanAborted(options.signal)
          const snapshot = await adapter.read(entry.path, {
            maxBytes,
            signal: options.signal
          })
          throwIfWorkspaceScanAborted(options.signal)
          const actualBytes = snapshot.bytes.byteLength
          if (actualBytes > maxBytes) {
            throw new WorkspaceReadLimitError(entry.path, maxBytes, actualBytes)
          }
          if (snapshot.size !== actualBytes) {
            throw new WorkspaceOperationError({
              code: 'integrity-failure',
              operation: 'read',
              path: entry.path,
              message: `Workspace BPMN file "${entry.path}" returned inconsistent byte-size metadata.`
            })
          }
          const value = await options.transform(entry, snapshot, options.signal)
          throwIfWorkspaceScanAborted(options.signal)
          return { ok: true, bytes: actualBytes, value }
        } catch (error) {
          if (isAbort(error, options.signal)) {
            throwIfWorkspaceScanAborted(options.signal)
            throw error
          }
          return { ok: false, error }
        }
      })
    )

    for (let index = 0; index < readResults.length; index += 1) {
      const result = readResults[index]
      if (!result.ok) {
        if (options.failClosed) throw result.error
        const entry = batch[index].entry
        const failure =
          result.error instanceof WorkspaceOperationError
            ? result.error.toFailure()
            : workspaceFailure(result.error, 'read', entry.path)
        issues.push(failure)
        continue
      }
      loadedBytes += result.bytes
      values.push(result.value)
    }
  }

  throwIfWorkspaceScanAborted(options.signal)
  return {
    values,
    issues,
    totalFiles: prepared.totalFiles,
    loadedBytes
  }
}
