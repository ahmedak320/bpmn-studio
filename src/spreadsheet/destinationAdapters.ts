import { zipSync } from 'fflate'

import type { FileSnapshot, SaveOutcome, WorkspaceAdapter } from '../workspace/adapters'
import { normalizeWorkspacePath, sha256Hex, WorkspaceOperationError } from '../workspace/adapters'
import { HISTORY_ROOT, PortableHistoryManager, type HistoryRevision } from '../workspace/history'
import type {
  DestinationState,
  ImportDestinationInspector,
  ImportDestinationTransaction,
  ImportTransactionCommitOptions,
  ImportTransactionFactory,
  StagedImportWrite
} from './contracts'
import { throwIfAborted } from './errors'

function isNotFound(error: unknown): boolean {
  return error instanceof WorkspaceOperationError && error.code === 'not-found'
}

const RECOVERY_PATH_ENCODER = new TextEncoder()

function saveFailure(outcome: Exclude<SaveOutcome, { ok: true }>): Error {
  if (outcome.status === 'external-conflict') {
    return new Error(`Workspace compare-and-set failed: ${outcome.reason}`)
  }
  if (outcome.status === 'stale-workspace') {
    return new Error('The active workspace changed during the spreadsheet import.')
  }
  return new Error(outcome.error.message)
}

async function requireSave(outcome: SaveOutcome): Promise<FileSnapshot> {
  if (!outcome.ok) throw saveFailure(outcome)
  return outcome.snapshot
}

function reportCommitProgress(
  options: ImportTransactionCommitOptions,
  completed: number,
  total: number
): void {
  try {
    options.onProgress?.(Object.freeze({ completed, total }))
  } catch {
    // Progress is observational and cannot change delivery/rollback truth.
  }
}

export class WorkspaceSpreadsheetDestinationInspector implements ImportDestinationInspector {
  constructor(private readonly adapter: WorkspaceAdapter) {}

  async inspect(paths: readonly string[]): Promise<readonly DestinationState[]> {
    return Object.freeze(
      await Promise.all(
        paths.map(async (path): Promise<DestinationState> => {
          try {
            const snapshot = await this.adapter.read(path)
            return Object.freeze({ path, exists: true, hash: snapshot.hash })
          } catch (error) {
            if (isNotFound(error)) return Object.freeze({ path, exists: false })
            throw error
          }
        })
      )
    )
  }
}

export interface WorkspaceImportTransactionFactoryOptions {
  /**
   * The App supplies its operation mutex here, so preflight, all writes, and
   * automatic rollback are one in-app critical section.
   */
  readonly runExclusive?: <T>(operation: () => Promise<T>) => Promise<T>
  /** Reject a captured adapter after the user switches workspaces. */
  readonly isCurrent?: () => boolean
  /**
   * Reuse the workspace's shared portable history manager when one is already
   * available. A bounded manager is created from `adapter` by default.
   */
  readonly historyManager?: PortableHistoryManager
}

interface AppliedWrite {
  readonly write: StagedImportWrite
  readonly original?: FileSnapshot
  readonly applied: FileSnapshot
}

class WorkspaceImportTransaction implements ImportDestinationTransaction {
  private readonly staged = new Map<string, StagedImportWrite>()
  private readonly originals = new Map<string, FileSnapshot | undefined>()
  private readonly applied: AppliedWrite[] = []
  private readonly recoveryRevisions: HistoryRevision[] = []
  private readonly createdRecoveryDirectoryCandidates = new Set<string>()
  private preexistingRecoveryDirectories: ReadonlySet<string> | undefined
  private state: 'staging' | 'committing' | 'committed' | 'rolling-back' | 'rolled-back' = 'staging'

  constructor(
    private readonly adapter: WorkspaceAdapter,
    private readonly historyManager: PortableHistoryManager,
    private readonly options: WorkspaceImportTransactionFactoryOptions
  ) {}

  async stage(write: StagedImportWrite): Promise<void> {
    if (this.state !== 'staging') throw new Error('The import transaction is closed.')
    if (this.staged.has(write.path)) {
      throw new Error(`Duplicate staged spreadsheet destination: ${write.path}`)
    }
    const bytes = new Uint8Array(write.bytes.byteLength)
    bytes.set(write.bytes)
    this.staged.set(
      write.path,
      Object.freeze({
        ...write,
        bytes
      })
    )
  }

  async commit(options: ImportTransactionCommitOptions = {}): Promise<void> {
    if (this.state !== 'staging') throw new Error('The import transaction is closed.')
    const total = this.staged.size
    reportCommitProgress(options, 0, total)
    throwIfAborted(options.signal)
    this.state = 'committing'
    const run = this.options.runExclusive ?? (async (operation) => await operation())
    await run(async () => {
      try {
        this.checkpoint(options.signal)
        await this.captureAllOriginals(options.signal)
        await this.createRecoveryRevisions(options.signal)
        let completed = 0
        for (const write of this.staged.values()) {
          this.checkpoint(options.signal)
          const outcome = await this.adapter.writeAtomic(
            write.path,
            write.bytes,
            write.expectedHash,
            {
              expectedWorkspaceId: this.adapter.id,
              expectedMissing: write.expectedHash === undefined,
              ...(options.signal ? { signal: options.signal } : {})
            }
          )
          if (!outcome.ok) throwIfAborted(options.signal)
          const snapshot = await requireSave(outcome)
          this.applied.push({
            write,
            original: this.originals.get(write.path),
            applied: snapshot
          })
          completed += 1
          if (completed < total) reportCommitProgress(options, completed, total)
          this.checkpoint(options.signal)
        }
        this.checkpoint(options.signal)
        await this.enforceHistoryRetention()
        this.state = 'committed'
        reportCommitProgress(options, total, total)
      } catch (cause) {
        try {
          await this.rollbackInternal()
        } catch (rollbackCause) {
          throw new AggregateError(
            [cause, rollbackCause],
            'Spreadsheet import failed and automatic rollback was incomplete.'
          )
        }
        throw cause
      }
    })
  }

  async rollback(): Promise<void> {
    if (this.state === 'rolled-back') return
    if (this.state === 'committed') {
      throw new Error('A committed spreadsheet import cannot be rolled back implicitly.')
    }
    const run = this.options.runExclusive ?? (async (operation) => await operation())
    await run(async () => await this.rollbackInternal())
  }

  private assertCurrent(): void {
    if (this.options.isCurrent && !this.options.isCurrent()) {
      throw new Error('The active workspace changed during the spreadsheet import.')
    }
  }

  private checkpoint(signal?: AbortSignal): void {
    this.assertCurrent()
    throwIfAborted(signal)
  }

  private async captureAllOriginals(signal?: AbortSignal): Promise<void> {
    for (const write of this.staged.values()) {
      this.checkpoint(signal)
      try {
        const original = await this.adapter.read(write.path)
        if (!write.expectedHash || original.hash !== write.expectedHash) {
          throw new Error(`Destination changed before import: ${write.path}`)
        }
        this.originals.set(write.path, original)
        this.checkpoint(signal)
      } catch (error) {
        if (!isNotFound(error)) throw error
        if (write.expectedHash) {
          throw new Error(`Overwrite destination disappeared: ${write.path}`)
        }
        this.originals.set(write.path, undefined)
        this.checkpoint(signal)
      }
    }
  }

  private async createRecoveryRevisions(signal?: AbortSignal): Promise<void> {
    if ([...this.staged.values()].some(({ createRecoveryRevision }) => createRecoveryRevision)) {
      this.checkpoint(signal)
      const entries = await this.adapter.list()
      this.preexistingRecoveryDirectories = new Set(
        entries.filter(({ kind }) => kind === 'directory').map(({ path }) => path)
      )
      this.checkpoint(signal)
    }
    for (const write of this.staged.values()) {
      if (!write.createRecoveryRevision) continue
      this.checkpoint(signal)
      const original = this.originals.get(write.path)
      if (!original) {
        throw new Error(`Recovery revision source is missing: ${write.path}`)
      }
      const originalPath = normalizeWorkspacePath(write.path)
      const recoveryFolder = `${HISTORY_ROOT}/${await sha256Hex(
        RECOVERY_PATH_ENCODER.encode(originalPath)
      )}`
      for (const path of ['.orbitpm', HISTORY_ROOT, recoveryFolder]) {
        if (!this.preexistingRecoveryDirectories?.has(path)) {
          this.createdRecoveryDirectoryCandidates.add(path)
        }
      }
      const revision = await this.historyManager.createRevision(write.path, {
        reason: 'backup-import',
        snapshot: original,
        // A failed transaction must not prune older recovery evidence. The
        // shared bounded retention policy runs only after all writes commit.
        prune: false
      })
      this.recoveryRevisions.push(revision)
      this.checkpoint(signal)
    }
  }

  private async pruneCreatedRecoveryDirectories(failures: unknown[]): Promise<void> {
    if (!this.adapter.removeEmptyFolder) return
    const candidates = [...this.createdRecoveryDirectoryCandidates].sort(
      (left, right) =>
        right.split('/').length - left.split('/').length || right.localeCompare(left, 'en')
    )
    for (const path of candidates) {
      try {
        await this.adapter.removeEmptyFolder(path)
      } catch (error) {
        if (!isNotFound(error)) failures.push(error)
      }
    }
  }

  private async enforceHistoryRetention(): Promise<void> {
    if (this.recoveryRevisions.length === 0) return
    await this.historyManager.enforceRetention()
  }

  private async removeRecoveryRevisions(failures: unknown[]): Promise<void> {
    for (let index = this.recoveryRevisions.length - 1; index >= 0; index -= 1) {
      const revision = this.recoveryRevisions[index]!
      let contentRemoved = false
      try {
        await this.adapter.remove(revision.contentPath)
        contentRemoved = true
      } catch (error) {
        if (isNotFound(error)) {
          contentRemoved = true
        } else {
          failures.push(error)
        }
      }
      // Keep the metadata beside recoverable content if content removal
      // failed. If metadata removal alone fails, no hidden raw BPMN remains.
      if (!contentRemoved) continue
      try {
        await this.adapter.remove(revision.metadataPath)
        this.recoveryRevisions.splice(index, 1)
      } catch (error) {
        if (isNotFound(error)) {
          this.recoveryRevisions.splice(index, 1)
        } else {
          failures.push(error)
        }
      }
    }
  }

  private async rollbackInternal(): Promise<void> {
    if (this.state === 'rolled-back') return
    this.state = 'rolling-back'
    const failures: unknown[] = []
    for (let index = this.applied.length - 1; index >= 0; index -= 1) {
      const entry = this.applied[index]!
      try {
        if (entry.original) {
          await requireSave(
            await this.adapter.writeAtomic(
              entry.write.path,
              entry.original.bytes,
              entry.applied.hash,
              { expectedWorkspaceId: this.adapter.id }
            )
          )
        } else {
          const current = await this.adapter.read(entry.write.path)
          if (current.hash !== entry.applied.hash) {
            throw new Error(
              `Refusing to remove externally changed destination: ${entry.write.path}`
            )
          }
          await this.adapter.remove(entry.write.path)
        }
        this.applied.splice(index, 1)
      } catch (error) {
        if (entry.original === undefined && isNotFound(error)) {
          this.applied.splice(index, 1)
          continue
        }
        failures.push(error)
      }
    }
    if (failures.length === 0) {
      await this.removeRecoveryRevisions(failures)
    }
    if (failures.length === 0) {
      await this.pruneCreatedRecoveryDirectories(failures)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Spreadsheet import rollback failed.')
    }
    this.state = 'rolled-back'
  }
}

export class WorkspaceImportTransactionFactory implements ImportTransactionFactory {
  private readonly historyManager: PortableHistoryManager

  constructor(
    private readonly adapter: WorkspaceAdapter,
    private readonly options: WorkspaceImportTransactionFactoryOptions = {}
  ) {
    this.historyManager =
      options.historyManager ??
      new PortableHistoryManager({
        adapter
      })
  }

  async begin(_transactionId: string): Promise<ImportDestinationTransaction> {
    if (this.options.isCurrent && !this.options.isCurrent()) {
      throw new Error('The active workspace changed before spreadsheet import.')
    }
    return new WorkspaceImportTransaction(this.adapter, this.historyManager, this.options)
  }
}

export class EmptySpreadsheetDestinationInspector implements ImportDestinationInspector {
  async inspect(paths: readonly string[]): Promise<readonly DestinationState[]> {
    return Object.freeze(paths.map((path) => Object.freeze({ path, exists: false })))
  }
}

export interface BrowserImportDeliveryOptions {
  readonly openSingle: (xml: string, path: string) => void | Promise<void>
  readonly downloadZip?: (archive: Blob, fileName: string) => void | Promise<void>
}

export function buildSpreadsheetImportZip(
  files: readonly { readonly path: string; readonly bytes: Uint8Array }[]
): Blob {
  const entries: Record<string, Uint8Array> = {}
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    entries[file.path] = file.bytes
  }
  return new Blob([zipSync(entries, { level: 6 })], {
    type: 'application/zip'
  })
}

export function downloadSpreadsheetBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

class BrowserDeliveryTransaction implements ImportDestinationTransaction {
  private readonly staged = new Map<string, Uint8Array>()
  private state: 'staging' | 'delivering' | 'committed' | 'indeterminate' | 'rolled-back' =
    'staging'

  constructor(
    private readonly transactionId: string,
    private readonly options: BrowserImportDeliveryOptions
  ) {}

  async stage(write: StagedImportWrite): Promise<void> {
    if (this.state !== 'staging') throw new Error('The browser delivery is closed.')
    if (this.staged.has(write.path)) throw new Error(`Duplicate delivery path: ${write.path}`)
    const bytes = new Uint8Array(write.bytes.byteLength)
    bytes.set(write.bytes)
    this.staged.set(write.path, bytes)
  }

  async commit(options: ImportTransactionCommitOptions = {}): Promise<void> {
    if (this.state !== 'staging') throw new Error('The browser delivery is closed.')
    const files = [...this.staged].map(([path, bytes]) => ({ path, bytes }))
    if (files.length === 0) throw new Error('There are no generated BPMN files.')
    const total = files.length
    reportCommitProgress(options, 0, total)
    throwIfAborted(options.signal)

    let deliver: () => void | Promise<void>
    if (files.length === 1) {
      const xml = new TextDecoder().decode(files[0]!.bytes)
      const path = files[0]!.path
      deliver = () => this.options.openSingle(xml, path)
    } else {
      const blob = buildSpreadsheetImportZip(files)
      const fileName = `orbitpm-spreadsheet-${this.transactionId.slice(-12)}.zip`
      deliver = () => (this.options.downloadZip ?? downloadSpreadsheetBlob)(blob, fileName)
    }

    // From the callback invocation onward the browser/UI may already have
    // delivered the file. Cancellation cannot prove that it is recallable.
    throwIfAborted(options.signal)
    this.state = 'delivering'
    try {
      await deliver()
    } catch (cause) {
      this.state = 'indeterminate'
      throw cause
    }
    this.state = 'committed'
    reportCommitProgress(options, total, total)
  }

  async rollback(): Promise<void> {
    if (this.state === 'rolled-back') return
    if (this.state !== 'staging')
      throw new Error('A delivered browser download cannot be recalled.')
    this.staged.clear()
    this.state = 'rolled-back'
  }
}

export class BrowserImportDeliveryTransactionFactory implements ImportTransactionFactory {
  constructor(private readonly options: BrowserImportDeliveryOptions) {}

  async begin(transactionId: string): Promise<ImportDestinationTransaction> {
    return new BrowserDeliveryTransaction(transactionId, this.options)
  }
}
